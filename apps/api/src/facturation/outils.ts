import {
  convertir,
  figerTauxChange,
  GRILLE_SEUILS_PAR_DEFAUT,
  PARITE_EUR_FCFA,
  roleApprobateur,
  type Devise,
  type GrilleSeuils,
  type Montant,
  type ObjetApprobation,
  type RoleApprobateur,
  type TauxChange,
} from "@missionpilot/engines";
import { aPermission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { AppError } from "../errors.js";
import type { Db } from "../db/pool.js";
import {
  estAssocie,
  exigerMissionVisible,
  peutModifierMission,
  type MissionAcces,
} from "../missions/acces.js";
import { tauxChangeMission } from "../missions/budget.js";
import { traduireErreurMoteur } from "../missions/moteur.js";

/** Codes SQLSTATE des déclencheurs de la facturation (migrations 0041 à 0043). */
const ERREURS_SQL: Record<string, [string, string]> = {
  MPB01: ["FACTURE_FIGEE", "Facture soumise ou émise : la corriger par un avoir."],
  MPB02: ["DEBOURS_FIGE", "Débours soumis ou validé : figé."],
  MPB03: ["ECHEANCE_FACTUREE", "Échéance facturée : figée."],
  MPB04: ["NUMEROTATION", "Numérotation des factures : opération refusée."],
};

/** Erreurs des moteurs et des déclencheurs de facturation → 409/400. */
export function traduireErreurFacturation(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const sql = ERREURS_SQL[code];
  if (sql) return new AppError(409, sql[0], sql[1]);
  return traduireErreurMoteur(error);
}

/**
 * Mission visible, ou null si elle est invisible (404) : l'appelant répond
 * alors 404 sur la ressource rattachée. Toute autre erreur remonte.
 */
export async function missionVisibleOuNull(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<MissionAcces | null> {
  try {
    return await exigerMissionVisible(db, auth, id, verrouiller);
  } catch (error) {
    if (error instanceof AppError && error.statut === 404) return null;
    throw error;
  }
}

/**
 * Gérer l'échéancier d'une mission (FIN-06) : « facture.emettre »
 * (gestionnaire, associé), ou « budget.ecrire » ET être responsable de la
 * mission (chef, directeur ; « mission.modifier_toutes »).
 */
export function peutGererEcheancier(auth: Auth, mission: MissionAcces): boolean {
  return (
    aPermission(auth.roles, "facture.emettre") ||
    (aPermission(auth.roles, "budget.ecrire") && peutModifierMission(auth, mission))
  );
}

/**
 * Valider un débours (FIN-05) : un associé, ou le chef ou le directeur de
 * CETTE mission portant « debours.valider ». Jamais l'auteur, sauf associé.
 */
export function peutValiderDebours(auth: Auth, mission: MissionAcces): boolean {
  return (
    estAssocie(auth) ||
    (aPermission(auth.roles, "debours.valider") &&
      (mission.chef_id === auth.utilisateurId || mission.directeur_id === auth.utilisateurId))
  );
}

/** Voit tous les débours d'une mission (sinon : seulement les siens). */
export function voitDeboursMission(auth: Auth, mission: MissionAcces): boolean {
  return peutValiderDebours(auth, mission) || aPermission(auth.roles, "facture.emettre");
}

const estFcfa = (d: string) => d === "XOF" || d === "XAF";

export interface ConversionSeuils {
  grille: GrilleSeuils;
  /** Montant déjà converti (USD → EUR par le taux figé de la mission). */
  pivot?: (m: Montant) => Montant;
  tauxChange?: TauxChange;
}

/**
 * Comment comparer un montant de facture aux seuils FIN-15 (grille du moteur,
 * exprimée en FCFA) :
 * - XOF ou XAF : directement (parité 1:1) ;
 * - EUR : parité fixe légale 655,957 ;
 * - USD : taux de change figé à la signature de la mission vers la devise du
 *   cabinet (FCFA, ou EUR puis parité fixe) ;
 * - sinon (aucun taux connu) : null → l'appelant exige un associé (palier le
 *   plus haut). C'est le comportement sûr pour un cabinet en EUR ou USD : pas
 *   d'erreur bloquante, mais l'approbation la plus exigeante.
 */
export function conversionSeuils(devise: Devise, mission: MissionAcces): ConversionSeuils | null {
  const date = mission.date_signature ?? "2000-01-01";
  const grilleFcfa = (d: Devise): GrilleSeuils => ({
    ...GRILLE_SEUILS_PAR_DEFAUT,
    deviseReference: d,
  });
  if (estFcfa(devise)) return { grille: grilleFcfa(devise) };
  const parite = figerTauxChange("EUR", "XOF", PARITE_EUR_FCFA, date);
  if (devise === "EUR") return { grille: grilleFcfa("XOF"), tauxChange: parite };
  const taux = tauxChangeMission(mission);
  if (!taux || taux.source !== devise) return null;
  if (estFcfa(taux.cible)) return { grille: grilleFcfa(taux.cible), tauxChange: taux };
  if (taux.cible === "EUR") {
    return { grille: grilleFcfa("XOF"), tauxChange: parite, pivot: (m) => convertir(m, taux) };
  }
  return null;
}

const ORDRE: readonly RoleApprobateur[] = ["chef_mission", "directeur_mission", "associe"];

export const plusExigeant = (roles: readonly RoleApprobateur[]): RoleApprobateur =>
  roles.reduce<RoleApprobateur>(
    (max, r) => (ORDRE.indexOf(r) > ORDRE.indexOf(max) ? r : max),
    "chef_mission",
  );

/** Rôle exigé par les seuils pour un objet et un montant (moteur), ou associé par sûreté. */
export function roleSelonSeuils(
  objet: ObjetApprobation,
  montant: Montant,
  mission: MissionAcces,
): RoleApprobateur {
  const conversion = conversionSeuils(montant.devise, mission);
  if (conversion === null) return "associe";
  const valeur = conversion.pivot ? conversion.pivot(montant) : montant;
  return roleApprobateur({
    objet,
    montant: valeur,
    grille: conversion.grille,
    ...(conversion.tauxChange && valeur.devise !== conversion.grille.deviseReference
      ? { tauxChange: conversion.tauxChange }
      : {}),
  });
}
