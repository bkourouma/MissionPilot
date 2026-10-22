/** Notation : saisies locales et messages d'erreur (voir `notation.ts`). */
import type { StrategieNotation } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { EnvoiQuestionnaire } from "./notation-types";
import type { Resultat } from "./saisie";

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
): Resultat<ChargeCalcul, "envoiId" | "strategie"> {
  const erreurs: Partial<Record<"envoiId" | "strategie", string>> = {};
  const envoi = envois.find((e) => e.id === s.envoiId);
  if (!envoi) erreurs.envoiId = "Choisissez le questionnaire dont les réponses seront notées.";
  else if (envoi.reponses_soumises < 1) {
    erreurs.envoiId = "Ce questionnaire n'a encore aucune réponse soumise.";
  }
  if (s.strategie !== "ignorer" && s.strategie !== "penaliser") {
    erreurs.strategie = "Choisissez le traitement des réponses manquantes.";
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
  const brut = v.replace(/\s/g, "").replace("−", "-").replace(/^\+/, "").replace(",", ".");
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
): Resultat<{ dimension: string; delta: number; motif: string }, "dimension" | "delta" | "motif"> {
  const erreurs: Partial<Record<"dimension" | "delta" | "motif", string>> = {};
  if (!dimensionsNotables.includes(s.dimension)) {
    erreurs.dimension = "Choisissez une dimension notable à ajuster.";
  }
  const delta = lireEcart(s.delta);
  if (s.delta.trim() === "") erreurs.delta = "Indiquez l'écart en points (ex. -4,5 ou 3).";
  else if (delta === null) {
    erreurs.delta = "Écart illisible : un nombre avec une décimale au plus (ex. -4,5 ou 3).";
  } else if (delta === 0 || Math.abs(delta) > 100) {
    erreurs.delta = "L'écart doit être non nul et compris entre −100 et 100 points.";
  }
  const motif = s.motif.trim();
  if (motif === "") {
    erreurs.motif =
      "Le motif est obligatoire : citez la note terrain ou l'entretien qui le justifie.";
  } else if (motif.length > MOTIF_MAX) {
    erreurs.motif = `Le motif ne doit pas dépasser ${MOTIF_MAX} caractères.`;
  }
  if (Object.keys(erreurs).length > 0 || delta === null) return { ok: false, erreurs };
  return { ok: true, charge: { dimension: s.dimension, delta, motif } };
}

export function validerMotifRenvoi(motif: string): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "") {
    return {
      ok: false,
      erreurs: { motif: "Le motif du renvoi est obligatoire : indiquez ce qui doit être revu." },
    };
  }
  if (m.length > MOTIF_MAX) {
    return {
      ok: false,
      erreurs: { motif: `Le motif ne doit pas dépasser ${MOTIF_MAX} caractères.` },
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

/** Message français d'une erreur d'action de notation (400, 403, 404, 409…). */
export function messageNotation(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_NOTATION;
    // Conflits de l'API : messages métier explicites (version en revue, aucune réponse…).
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatNotationChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);
