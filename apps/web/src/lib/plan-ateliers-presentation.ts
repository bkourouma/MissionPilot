/** Ateliers stratégiques (PLA-15) : libellés, présentation des centièmes du moteur et droits d'affichage. */
import {
  METHODE_ATELIER_LIBELLES,
  OPTIONS_ATELIER_MIN,
  STATUT_ATELIER_LIBELLES,
  aPermission,
  type MethodeAtelier,
  type Role,
  type StatutAtelier,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterNombre } from "./format";
import type { DroitsPlan } from "./plan-strategique";
import type { AtelierDetail, ParticipationAtelier } from "./plan-ateliers-types";

/* ----- Présentation ----- */

export const TONALITE_STATUT_ATELIER: Record<StatutAtelier, TonaliteStatut> = {
  brouillon: "neutre",
  ouvert: "succes",
  clos: "neutre",
};
export const libelleStatutAtelier = (s: string) =>
  STATUT_ATELIER_LIBELLES[s as StatutAtelier] ?? "—";
export const libelleMethode = (m: string) => METHODE_ATELIER_LIBELLES[m as MethodeAtelier] ?? m;

export const QUADRANT_LIBELLES: Record<string, string> = {
  gains_rapides: "Gains rapides",
  projets_majeurs: "Projets majeurs",
  complements: "Compléments",
  a_ecarter: "À écarter",
};
export const libelleQuadrant = (q: string | null) =>
  q === null ? "Non placée" : (QUADRANT_LIBELLES[q] ?? q);

/** Centièmes de pourcent du moteur → « 66,67 % » (présentation seule). */
export function formaterTauxCentiemes(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${formaterNombre(n / 100, 2)} %`;
}

/** Centièmes du moteur (moyenne, rang moyen) → « 4,00 » (présentation seule). */
export function formaterCentiemes(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : formaterNombre(n / 100, 2);
}

/** Phrase de participation pendant l'atelier. */
export function phraseParticipation(p: ParticipationAtelier): string {
  if (p.ayant_contribue === null)
    return `${p.invites} personne${p.invites > 1 ? "s" : ""} invitée${p.invites > 1 ? "s" : ""}.`;
  return `${p.ayant_contribue} participant${p.ayant_contribue > 1 ? "s" : ""} sur ${p.invites} invité${p.invites > 1 ? "s" : ""} (${formaterTauxCentiemes(p.taux_centiemes_pourcent)}).`;
}

export const libelleOption = (options: readonly { id: string; libelle: string }[], id: string) =>
  options.find((o) => o.id === id)?.libelle ?? "Option retirée";

/** Lignes d'un tableau de résultats, dans l'ordre des rangs (le moteur a déjà tranché les égalités). */
export function lignesParRang<T extends { rang: number }>(lignes: readonly T[]): T[] {
  return [...lignes].sort((a, b) => a.rang - b.rang);
}

/* ----- Droits d'affichage (l'API décide) ----- */

export interface DroitsAtelier {
  lire: boolean;
  /** Créer, modifier, ouvrir, clore, inviter un membre du cabinet. */
  ecrire: boolean;
  /** Inviter un dirigeant du client. */
  inviterClient: boolean;
  /** Générer la synthèse IA d'un atelier clos. */
  synthese: boolean;
  /** La mission est clôturée : tout est en lecture seule. */
  cloturee: boolean;
}

export function droitsAtelier(roles: readonly Role[], droitsPlan: DroitsPlan): DroitsAtelier {
  return {
    lire: aPermission(roles, "plan.lire"),
    ecrire: droitsPlan.rediger,
    inviterClient: droitsPlan.rediger && aPermission(roles, "portail.gerer"),
    synthese: droitsPlan.rediger && aPermission(roles, "ia.utiliser"),
    cloturee: droitsPlan.cloturee,
  };
}

/** Le membre du cabinet est-il invité à cet atelier (et l'atelier ouvert) ? */
export function peutContribuerCabinet(
  a: Pick<AtelierDetail, "statut" | "participants">,
  moi: string,
) {
  return a.statut === "ouvert" && a.participants.some((p) => p.utilisateur_id === moi);
}

/** Pourquoi « Ouvrir » n'est pas proposé (null s'il l'est). */
export function raisonOuvertureImpossible(
  a: Pick<AtelierDetail, "statut" | "options" | "participants">,
): string | null {
  if (a.statut !== "brouillon") return "Seul un atelier en brouillon s'ouvre.";
  if (a.options.length < OPTIONS_ATELIER_MIN) return "Ajoutez au moins deux options.";
  if (a.participants.length < 1) return "Invitez au moins un participant.";
  return null;
}
