/** Notation augmentée : paramètres de confiance du cabinet (NOT-11) (voir `notation-augmentee.ts`). */
import { entier } from "./notation-augmentee-commun";
import {
  aPermission,
  creerTraduire,
  LOCALES_INTL,
  type Langue,
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
export function formaterSeuil(v: number, langue: Langue = "fr"): string {
  return v.toLocaleString(LOCALES_INTL[langue], {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
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
  langue: Langue = "fr",
): Resultat<
  { seuil_confiance: number; repondants_cible: number },
  "seuil_confiance" | "repondants_cible"
> {
  const t = creerTraduire(langue);
  const e: Partial<Record<"seuil_confiance" | "repondants_cible", string>> = {};
  const seuil = lireNombre(s.seuil);
  if (seuil === null || Number.isNaN(seuil)) {
    e.seuil_confiance = t(
      "Saisissez un nombre entre 0,3 et 1 (ex. 0,5).",
      "Enter a number between 0.3 and 1 (e.g. 0.5).",
    );
  } else if (seuil < SEUIL_CONFIANCE_PLANCHER) {
    e.seuil_confiance = t(
      `Seuil de confiance : ${formaterSeuil(SEUIL_CONFIANCE_PLANCHER)} au moins (plancher qui garde la publication exigeante).`,
      `Confidence threshold: at least ${formaterSeuil(SEUIL_CONFIANCE_PLANCHER, langue)} (floor that keeps publication demanding).`,
    );
  } else if (seuil > 1) {
    e.seuil_confiance = t("Seuil de confiance : 1 au plus.", "Confidence threshold: 1 at most.");
  } else if (Math.abs(Math.round(seuil * 10_000) - seuil * 10_000) >= 1e-6) {
    e.seuil_confiance = t("Quatre décimales au plus.", "Four decimals at most.");
  }
  const repondants = entier(s.repondants);
  if (repondants === null) {
    e.repondants_cible = t(
      "Saisissez un nombre entier de répondants.",
      "Enter a whole number of respondents.",
    );
  } else if (repondants < REPONDANTS_CIBLE_PLANCHER) {
    e.repondants_cible = t(
      `Cible de répondants : ${REPONDANTS_CIBLE_PLANCHER} au moins (plancher).`,
      `Respondent target: at least ${REPONDANTS_CIBLE_PLANCHER} (floor).`,
    );
  } else if (repondants > REPONDANTS_CIBLE_MAX) {
    e.repondants_cible = t(
      `Cible de répondants : ${REPONDANTS_CIBLE_MAX} au plus.`,
      `Respondent target: at most ${REPONDANTS_CIBLE_MAX}.`,
    );
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

export const MESSAGE_SEPARATION_PARAMETRES_EN =
  "Your account also holds the business expert role: it publishes ratings and therefore does not set the confidence threshold it must meet (separation of duties). Ask a partner who is not a business expert; saving will be refused.";

/** Droits d'AFFICHAGE des paramètres de confiance : `cabinet.gerer` règle, pas un expert métier. */
export function droitsParametres(
  roles: readonly Role[],
  langue: Langue = "fr",
): DroitsParametresNotation {
  if (!aPermission(roles, "cabinet.gerer")) {
    return {
      modifier: false,
      avertissement: null,
      explication: creerTraduire(langue)(
        "Le seuil de confiance et la cible de répondants se règlent par un associé du cabinet (gestion du cabinet).",
        "The confidence threshold and the respondent target are set by a partner of the firm (firm administration).",
      ),
    };
  }
  return {
    modifier: true,
    avertissement: roles.includes("expert_metier")
      ? langue === "en"
        ? MESSAGE_SEPARATION_PARAMETRES_EN
        : MESSAGE_SEPARATION_PARAMETRES
      : null,
    explication: null,
  };
}
