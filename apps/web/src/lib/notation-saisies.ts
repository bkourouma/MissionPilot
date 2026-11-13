/** Notation : saisies locales et messages d'erreur (voir `notation.ts`). */
import { creerTraduire, type Langue, type StrategieNotation } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { EnvoiQuestionnaire } from "./notation-types";
import { normaliserNombreSaisi, type Resultat } from "./saisie";

// --- Saisies (validation locale ; l'API et le moteur restent juges) --------------------------

export interface SaisieCalcul {
  envoiId: string;
  grilleVersionId: string;
  secteur: string;
  strategie: string;
}

export interface ChargeCalcul {
  envoi_id: string;
  grille_version_id: string | null;
  secteur: string | null;
  strategie: StrategieNotation;
}

export function validerCalcul(
  s: SaisieCalcul,
  envois: readonly Pick<EnvoiQuestionnaire, "id" | "reponses_soumises">[],
  langue: Langue = "fr",
): Resultat<ChargeCalcul, "envoiId" | "strategie"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"envoiId" | "strategie", string>> = {};
  const envoi = envois.find((e) => e.id === s.envoiId);
  if (!envoi) {
    erreurs.envoiId = t(
      "Choisissez le questionnaire dont les réponses seront notées.",
      "Choose the questionnaire whose answers will be rated.",
    );
  } else if (envoi.reponses_soumises < 1) {
    erreurs.envoiId = t(
      "Ce questionnaire n'a encore aucune réponse soumise.",
      "This questionnaire has no submitted answers yet.",
    );
  }
  if (s.strategie !== "ignorer" && s.strategie !== "penaliser") {
    erreurs.strategie = t(
      "Choisissez le traitement des réponses manquantes.",
      "Choose how missing answers are handled.",
    );
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      envoi_id: s.envoiId,
      grille_version_id: s.grilleVersionId === "" ? null : s.grilleVersionId,
      secteur: s.secteur === "" ? null : s.secteur,
      strategie: s.strategie as StrategieNotation,
    },
  };
}

export const MOTIF_MAX = 2000;

/**
 * Écart d'ajustement saisi à la française (« -4,5 », « +3 », « −2 ») : nombre, ou null si
 * illisible. Une décimale au plus, non nul, entre −100 et 100 (règles du moteur).
 */
export function lireEcart(v: string): number | null {
  const brut = normaliserNombreSaisi(v).replace("−", "-").replace(/^\+/, "");
  if (!/^-?\d{1,3}(\.\d)?$/.test(brut)) return null;
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
}

export interface SaisieAjustement {
  dimension: string;
  delta: string;
  motif: string;
}

export function validerAjustement(
  s: SaisieAjustement,
  dimensionsNotables: readonly string[],
  langue: Langue = "fr",
): Resultat<{ dimension: string; delta: number; motif: string }, "dimension" | "delta" | "motif"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"dimension" | "delta" | "motif", string>> = {};
  if (!dimensionsNotables.includes(s.dimension)) {
    erreurs.dimension = t(
      "Choisissez une dimension notable à ajuster.",
      "Choose a rated dimension to adjust.",
    );
  }
  const delta = lireEcart(s.delta);
  if (s.delta.trim() === "") {
    erreurs.delta = t(
      "Indiquez l'écart en points (ex. -4,5 ou 3).",
      "Enter the difference in points (e.g. -4.5 or 3).",
    );
  } else if (delta === null) {
    erreurs.delta = t(
      "Écart illisible : un nombre avec une décimale au plus (ex. -4,5 ou 3).",
      "Unreadable difference: a number with at most one decimal (e.g. -4.5 or 3).",
    );
  } else if (delta === 0 || Math.abs(delta) > 100) {
    erreurs.delta = t(
      "L'écart doit être non nul et compris entre −100 et 100 points.",
      "The difference must be non-zero and between −100 and 100 points.",
    );
  }
  const motif = s.motif.trim();
  if (motif === "") {
    erreurs.motif = t(
      "Le motif est obligatoire : citez la note terrain ou l'entretien qui le justifie.",
      "The reason is required: cite the field note or interview that supports it.",
    );
  } else if (motif.length > MOTIF_MAX) {
    erreurs.motif = t(
      `Le motif ne doit pas dépasser ${MOTIF_MAX} caractères.`,
      `The reason must not exceed ${MOTIF_MAX} characters.`,
    );
  }
  if (Object.keys(erreurs).length > 0 || delta === null) return { ok: false, erreurs };
  return { ok: true, charge: { dimension: s.dimension, delta, motif } };
}

export function validerMotifRenvoi(
  motif: string,
  langue: Langue = "fr",
): Resultat<{ motif: string }, "motif"> {
  const t = creerTraduire(langue);
  const m = motif.trim();
  if (m === "") {
    return {
      ok: false,
      erreurs: {
        motif: t(
          "Le motif du renvoi est obligatoire : indiquez ce qui doit être revu.",
          "The reason for sending back is required: state what needs to be reviewed.",
        ),
      },
    };
  }
  if (m.length > MOTIF_MAX) {
    return {
      ok: false,
      erreurs: {
        motif: t(
          `Le motif ne doit pas dépasser ${MOTIF_MAX} caractères.`,
          `The reason must not exceed ${MOTIF_MAX} characters.`,
        ),
      },
    };
  }
  return { ok: true, charge: { motif: m } };
}

// --- Erreurs ----------------------------------------------------------------------------------

/** Codes de l'API dont le message (français, explicite) est affiché tel quel. */
const CODES_MESSAGE_API = new Set([
  "SEPARATION_DES_TACHES",
  "EXPERT_METIER_REQUIS",
  "AJUSTEMENT_INVALIDE",
  "DIMENSION_INCONNUE",
  "DIMENSION_NON_NOTABLE",
  "NOTATION_IMMUABLE",
  "NOTATION_ETAT",
  "TRANSITION_REFUSEE",
  "GRILLE_FIGEE",
]);

export const MESSAGE_INTROUVABLE_NOTATION =
  "Cette notation (ou la mission, le questionnaire ou la grille choisis) n'est plus accessible. Actualisez la page.";

export const MESSAGE_INTROUVABLE_NOTATION_EN =
  "This rating (or the engagement, questionnaire or framework chosen) is no longer accessible. Refresh the page.";

/** Message d'une erreur d'action de notation (400, 403, 404, 409…) dans la langue demandée. */
export function messageNotation(e: unknown, langue: Langue = "fr"): string {
  if (e instanceof ErreurApi) {
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) {
      return langue === "en" ? MESSAGE_INTROUVABLE_NOTATION_EN : MESSAGE_INTROUVABLE_NOTATION;
    }
    // Conflits de l'API : messages métier explicites (version en revue, aucune réponse…).
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e, langue);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatNotationChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);
