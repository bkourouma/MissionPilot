/** Notation augmentée : messages d'erreur de l'API (voir `notation-augmentee.ts`). */
import { ErreurApi } from "./api";
import { messageNotation } from "./notation";

/* ----- Messages d'erreur de l'API ----- */

/** Codes dont le message de l'API est déjà un texte français destiné à l'utilisateur. */
const CODES_MESSAGE_FRANCAIS = new Set([
  "SEPARATION_DES_TACHES",
  "EXPERT_METIER_REQUIS",
  "ITEM_FIGE",
  "CALIBRATION_FIGEE",
  "CONFIANCE_INSUFFISANTE",
  "SELECTION_REFUSEE",
  "CONFLIT",
]);

export interface AnomalieNotationAugmentee {
  code: string;
  chemin: string;
  message: string;
}

/** Anomalies du moteur (`details.erreurs`) d'une erreur de l'API, vides si absentes. */
export function anomaliesErreur(e: unknown): AnomalieNotationAugmentee[] {
  if (!(e instanceof ErreurApi)) return [];
  const d = e.details as { erreurs?: unknown } | undefined;
  if (!d || !Array.isArray(d.erreurs)) return [];
  return d.erreurs.flatMap((a): AnomalieNotationAugmentee[] => {
    if (typeof a !== "object" || a === null) return [];
    const { code, chemin, message } = a as Record<string, unknown>;
    return typeof message === "string"
      ? [
          {
            code: typeof code === "string" ? code : "",
            chemin: typeof chemin === "string" ? chemin : "",
            message,
          },
        ]
      : [];
  });
}

/** Chemin technique d'une anomalie → partie de l'item concernée, en français. */
export function libelleCheminAnomalie(chemin: string): string {
  const indexe = /^(formulations|ancrages)\[(\d+)\]$/.exec(chemin);
  if (indexe) {
    const rang = Number(indexe[2]) + 1;
    return indexe[1] === "formulations" ? `Formulation n° ${rang}` : `Ancrage du niveau ${rang}`;
  }
  if (chemin.startsWith("etalonnage")) return "Étalonnage";
  const LIBELLES: Record<string, string> = {
    code: "Code",
    dimension: "Dimension",
    pratique: "Pratique",
    intitule: "Intitulé",
    "echelle.niveaux": "Échelle",
    "echelle.libelles": "Libellés de l'échelle",
    ancrages: "Ancrages",
    formulations: "Formulations",
    poids: "Poids",
    priorite: "Priorité",
    dureeSecondes: "Durée de réponse",
  };
  return LIBELLES[chemin] ?? "";
}

/**
 * Message français d'une erreur de la notation augmentée (banque, calibrations, paramètres) :
 * refus du moteur avec ses anomalies (« Item de banque invalide. Formulation n° 2 : Formulation
 * vide. »), règles métier de l'API (séparation des tâches, item figé, session close…), sinon le
 * message commun de la notation.
 */
export function messageNotationAugmentee(e: unknown): string {
  if (e instanceof ErreurApi) {
    const anomalies = anomaliesErreur(e);
    if (anomalies.length > 0) {
      const lignes = anomalies.slice(0, 8).map((a) => {
        const partie = libelleCheminAnomalie(a.chemin);
        return partie ? `${partie} : ${a.message}` : a.message;
      });
      return `${e.message} ${lignes.join(" ")}`;
    }
    if (CODES_MESSAGE_FRANCAIS.has(e.code)) return e.message;
    if (e.statut === 404) return "Cet élément n'est plus accessible. Actualisez la page.";
  }
  return messageNotation(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatNotationAugmenteeChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);
