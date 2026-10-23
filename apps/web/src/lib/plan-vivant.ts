/**
 * Plan vivant (PLA-18) : types des réponses de l'API, saisie et contrôle des réalisés, libellés,
 * lignes des tableaux d'écarts, phrase d'explication de l'écart d'EBE, chemins et messages. Logique
 * pure, testée dans `plan-vivant.test.ts`. Sous-modules : `plan-vivant-types` (réponses de l'API),
 * `plan-vivant-libelles`, `plan-vivant-ecarts`, `plan-vivant-saisie`.
 *
 * RÈGLE : aucun chiffre métier n'est calculé ici. Écarts, écarts relatifs, marqueur « significatif »,
 * re-prévision annuelle, effet volume et effet de marge viennent TELS QUELS de l'API (moteur
 * `reprevoirExercice`) ; ce module choisit des champs, les met en forme et convertit les montants
 * saisis (unités usuelles) en unités mineures entières. Le plan validé n'est jamais modifié.
 */
import {
  EXERCICE_PLAN_VIVANT,
  METHODES_REPREVISION_PLAN,
  type MethodeReprevisionPlan,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { cheminPlan, hrefPlan } from "./plan-strategique";

export { METHODES_REPREVISION_PLAN, type MethodeReprevisionPlan };
export * from "./plan-vivant-types";
export * from "./plan-vivant-libelles";
export * from "./plan-vivant-ecarts";
export * from "./plan-vivant-saisie";

// --- Chemins ----------------------------------------------------------------------------------

const seg = (id: string) => encodeURIComponent(id);

export const cheminRealises = (planId: string, exercice?: number | null) =>
  `${cheminPlan(planId)}/realises${exercice ? `?exercice=${exercice}` : ""}`;
export const cheminRealise = (planId: string, exercice: number, trimestre: number) =>
  `${cheminPlan(planId)}/realises/${exercice}/${trimestre}`;
export const cheminReprevisions = (planId: string) => `${cheminPlan(planId)}/reprevisions`;
export function cheminListeReprevisions(
  planId: string,
  limite: number,
  curseur: string | null,
  exercice?: number | null,
) {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  if (exercice) q.set("exercice", String(exercice));
  return `${cheminReprevisions(planId)}?${q.toString()}`;
}
export const cheminReprevision = (planId: string, revId: string) =>
  `${cheminReprevisions(planId)}/${seg(revId)}`;
export const cheminExplication = (planId: string, revId: string) =>
  `${cheminReprevision(planId, revId)}/explication`;

export function hrefPlanVivant(
  missionId: string,
  planId: string,
  q: {
    exercice?: number | null;
    reprevision?: string | null;
    curseur?: string | null;
  } = {},
): string {
  const p = new URLSearchParams();
  if (q.exercice) p.set("exercice", String(q.exercice));
  if (q.reprevision) p.set("reprevision", q.reprevision);
  if (q.curseur) p.set("curseur", q.curseur);
  const s = p.toString();
  return `${hrefPlan(missionId, planId)}/plan-vivant${s ? `?${s}` : ""}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant de re-prévision lu dans l'URL, ou `null` s'il est absent ou mal formé. */
export function lireIdReprevision(v: string | string[] | undefined): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x && UUID.test(x) ? x : null;
}

/** Exercice lu dans l'URL, ou `null` s'il est absent, mal formé ou hors bornes. */
export function lireExercice(v: string | string[] | undefined): number | null {
  const x = Array.isArray(v) ? v[0] : v;
  if (!x || !/^\d{4}$/.test(x)) return null;
  const n = Number(x);
  return n >= EXERCICE_PLAN_VIVANT.min && n <= EXERCICE_PLAN_VIVANT.max ? n : null;
}

// --- Messages ---------------------------------------------------------------------------------

/** Message français d'un refus de l'API (jamais de montant dans le message). */
export function messagePlanVivant(e: unknown): string {
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "REALISE_TRIMESTRE_NON_CONSECUTIF":
        return "Les trimestres se saisissent dans l'ordre, sans trou : saisissez d'abord le trimestre précédent.";
      case "REALISES_PLAFOND":
        return "Le nombre maximal de versions de réalisés est atteint pour ce trimestre.";
      case "REALISE_VERSION_CONFLIT":
      case "REPREVISION_VERSION_CONFLIT":
        return "Une autre personne vient d'enregistrer : rechargez la page puis recommencez.";
      case "MODELE_NON_VALIDE":
        return "La re-prévision se calcule sur une version validée du modèle financier.";
      case "REPREVISION_EXERCICE_HORS_HORIZON":
        return "Cet exercice ne fait pas partie de l'horizon de la version du modèle choisie.";
      case "REPREVISION_INVALIDE":
        return e.message;
      case "REPREVISIONS_PLAFOND":
        return "Cet exercice a atteint le nombre maximal de re-prévisions enregistrées.";
      case "CONFLIT":
        return "La mission est clôturée : le plan reste consultable mais ne se modifie plus.";
      default:
        break;
    }
    if (e.statut === 403) return "Cette action est réservée aux rédacteurs du plan.";
    if (e.statut === 404) {
      return "Ce plan, cette version du modèle ou cette re-prévision est introuvable ou ne vous est plus accessible.";
    }
  }
  return messageErreur(e);
}
