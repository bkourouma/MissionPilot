/** Notation augmentée : paramètres de confiance du cabinet (NOT-11) (voir `notation-augmentee.ts`). */
import { entier } from "./notation-augmentee-commun";
import {
  aPermission,
  REPONDANTS_CIBLE_PLANCHER,
  SEUIL_CONFIANCE_PLANCHER,
  type Role,
} from "@missionpilot/shared";
import { lireNombre, type Resultat } from "./saisie";

/* =====================================================================================
 * NOT-11 : paramètres de confiance du cabinet
 * ===================================================================================== */

/** Réponse de `GET` et `PUT /api/notation/parametres`. */
export interface ParametresNotation {
  seuil_confiance: number;
  repondants_cible: number;
  /** Aucun réglage enregistré : valeurs par défaut du moteur. */
  par_defaut: boolean;
  modifie_le: string | null;
}

export const CHEMIN_PARAMETRES_NOTATION = "/api/notation/parametres";
export const HREF_PARAMETRES_NOTATION = "/parametres/notation";
export const REPONDANTS_CIBLE_MAX = 1000;
export { REPONDANTS_CIBLE_PLANCHER, SEUIL_CONFIANCE_PLANCHER };

/** Seuil de confiance à la française, 4 décimales au plus (« 0,5 », « 0,3125 »). */
export function formaterSeuil(v: number): string {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export interface SaisieParametresNotation {
  seuil: string;
  repondants: string;
}

export function saisieParametres(p: ParametresNotation): SaisieParametresNotation {
  return { seuil: formaterSeuil(p.seuil_confiance), repondants: String(p.repondants_cible) };
}

/** Contrôle des paramètres de confiance (planchers : seuil 0,3 ; au moins 2 répondants). */
export function validerParametres(
  s: SaisieParametresNotation,
): Resultat<
  { seuil_confiance: number; repondants_cible: number },
  "seuil_confiance" | "repondants_cible"
> {
  const e: Partial<Record<"seuil_confiance" | "repondants_cible", string>> = {};
  const seuil = lireNombre(s.seuil);
  if (seuil === null || Number.isNaN(seuil)) {
    e.seuil_confiance = "Saisissez un nombre entre 0,3 et 1 (ex. 0,5).";
  } else if (seuil < SEUIL_CONFIANCE_PLANCHER) {
    e.seuil_confiance = `Seuil de confiance : ${formaterSeuil(SEUIL_CONFIANCE_PLANCHER)} au moins (plancher qui garde la publication exigeante).`;
  } else if (seuil > 1) {
    e.seuil_confiance = "Seuil de confiance : 1 au plus.";
  } else if (Math.abs(Math.round(seuil * 10_000) - seuil * 10_000) >= 1e-6) {
    e.seuil_confiance = "Quatre décimales au plus.";
  }
  const repondants = entier(s.repondants);
  if (repondants === null) {
    e.repondants_cible = "Saisissez un nombre entier de répondants.";
  } else if (repondants < REPONDANTS_CIBLE_PLANCHER) {
    e.repondants_cible = `Cible de répondants : ${REPONDANTS_CIBLE_PLANCHER} au moins (plancher).`;
  } else if (repondants > REPONDANTS_CIBLE_MAX) {
    e.repondants_cible = `Cible de répondants : ${REPONDANTS_CIBLE_MAX} au plus.`;
  }
  if (e.seuil_confiance || e.repondants_cible) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: { seuil_confiance: seuil as number, repondants_cible: repondants as number },
  };
}

export interface DroitsParametresNotation {
  /** Formulaire d'édition affiché (`cabinet.gerer`). */
  modifier: boolean;
  /** Avertissement affiché au-dessus du formulaire, `null` s'il n'y en a pas. */
  avertissement: string | null;
  /** Explication quand la modification n'est pas proposée. */
  explication: string | null;
}

export const MESSAGE_SEPARATION_PARAMETRES =
  "Votre compte cumule le rôle d'expert métier : il publie les notations et ne règle donc pas le seuil de confiance qu'il doit franchir (séparation des tâches). Demandez à un associé qui n'est pas expert métier ; l'enregistrement sera refusé.";

/** Droits d'AFFICHAGE des paramètres de confiance : `cabinet.gerer` règle, pas un expert métier. */
export function droitsParametres(roles: readonly Role[]): DroitsParametresNotation {
  if (!aPermission(roles, "cabinet.gerer")) {
    return {
      modifier: false,
      avertissement: null,
      explication:
        "Le seuil de confiance et la cible de répondants se règlent par un associé du cabinet (gestion du cabinet).",
    };
  }
  return {
    modifier: true,
    avertissement: roles.includes("expert_metier") ? MESSAGE_SEPARATION_PARAMETRES : null,
    explication: null,
  };
}
