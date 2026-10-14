/**
 * Transcription vocale (AGT-11, lot 3c, SPEC §9.7). Fonctions pures : validation du résultat d'un
 * transcripteur, confiance moyenne en pour mille, plafond mensuel et coût en micro-dollars (entiers,
 * jamais de virgule flottante). Une transcription n'est qu'un BROUILLON à relire.
 */
import { ErreurCanaux } from "./erreurs";

/** Durée maximale d'un audio : 30 minutes. */
export const TRANSCRIPTION_DUREE_MAX_MS = 1_800_000;
export const TRANSCRIPTION_SEGMENTS_MAX = 5000;
export const TRANSCRIPTION_TEXTE_MAX = 200_000;
export const CONFIANCE_MAX_PM = 1000;

export interface SegmentTranscrit {
  readonly debutMs: number;
  readonly finMs: number;
  readonly texte: string;
  /** Entier de 0 à 1000 (pour mille). */
  readonly confiance: number;
}

export interface ResultatTranscriptionAValider {
  readonly texte: string;
  readonly segments: readonly SegmentTranscrit[];
  readonly dureeAudioMs: number;
}

export interface LimitesTranscription {
  readonly dureeMaxMs?: number;
  readonly segmentsMax?: number;
  readonly texteMax?: number;
}

/**
 * Valide le résultat d'un transcripteur : texte non vide (`TEXTE_VIDE`) et d'au plus 200 000
 * caractères (`TEXTE_TROP_LONG`), durée entière positive d'au plus 1 800 000 ms (`DUREE_INVALIDE`,
 * `DUREE_MAX`), au plus 5 000 segments (`SEGMENTS_TROP_NOMBREUX`), confiance entière de 0 à 1000
 * (`CONFIANCE_INVALIDE`), segments dans la durée (`SEGMENT_HORS_DUREE`), triés et sans
 * chevauchement (`SEGMENTS_CHEVAUCHANT`) ; des segments qui se touchent sont admis.
 */
export function validerResultatTranscription(
  resultat: ResultatTranscriptionAValider,
  limites: LimitesTranscription = {},
): void {
  const dureeMax = limites.dureeMaxMs ?? TRANSCRIPTION_DUREE_MAX_MS;
  const segmentsMax = limites.segmentsMax ?? TRANSCRIPTION_SEGMENTS_MAX;
  const texteMax = limites.texteMax ?? TRANSCRIPTION_TEXTE_MAX;

  if (typeof resultat.texte !== "string" || resultat.texte.trim() === "") {
    throw new ErreurCanaux("TEXTE_VIDE");
  }
  if (resultat.texte.length > texteMax) throw new ErreurCanaux("TEXTE_TROP_LONG");
  const duree = resultat.dureeAudioMs;
  if (!Number.isInteger(duree) || duree < 0) throw new ErreurCanaux("DUREE_INVALIDE");
  if (duree > dureeMax) throw new ErreurCanaux("DUREE_MAX");
  if (resultat.segments.length > segmentsMax) throw new ErreurCanaux("SEGMENTS_TROP_NOMBREUX");

  let precedentFin = 0;
  for (const s of resultat.segments) {
    if (!Number.isInteger(s.confiance) || s.confiance < 0 || s.confiance > CONFIANCE_MAX_PM) {
      throw new ErreurCanaux("CONFIANCE_INVALIDE");
    }
    if (!Number.isInteger(s.debutMs) || !Number.isInteger(s.finMs)) {
      throw new ErreurCanaux("DUREE_INVALIDE");
    }
    if (s.debutMs < 0 || s.finMs < s.debutMs || s.finMs > duree) {
      throw new ErreurCanaux("SEGMENT_HORS_DUREE");
    }
    if (s.debutMs < precedentFin) throw new ErreurCanaux("SEGMENTS_CHEVAUCHANT");
    precedentFin = s.finMs;
  }
}

/**
 * Confiance moyenne en pour mille, pondérée par la durée des segments, ARRONDIE AU DEMI SUPÉRIEUR
 * (700,5 donne 701). Sans durée cumulée, moyenne simple ; sans segment, 0 (« faible »).
 */
export function confianceMoyennePm(segments: readonly SegmentTranscrit[]): number {
  if (segments.length === 0) return 0;
  let numerateur = 0;
  let denominateur = 0;
  for (const s of segments) {
    const duree = s.finMs - s.debutMs;
    numerateur += s.confiance * duree;
    denominateur += duree;
  }
  if (denominateur === 0) {
    numerateur = segments.reduce((somme, s) => somme + s.confiance, 0);
    denominateur = segments.length;
  }
  return Math.floor((2 * numerateur + denominateur) / (2 * denominateur));
}

export type NiveauConfianceTranscription = "bon" | "moyen" | "faible";

/** `bon` à partir de 800, `moyen` à partir de 600, sinon `faible`. */
export function niveauConfiance(pm: number): NiveauConfianceTranscription {
  return pm >= 800 ? "bon" : pm >= 600 ? "moyen" : "faible";
}

export interface EntreePlafondTranscription {
  /** Durée déjà consommée par le cabinet sur le mois civil UTC. */
  readonly utiliseesMs: number;
  /** Durée déclarée de l'audio ; nulle si inconnue (cas le plus défavorable : 30 minutes). */
  readonly ajoutMs: number | null;
  readonly plafondMinutes: number;
}

export interface DecisionPlafondTranscription {
  readonly autorise: boolean;
  /** Durée retenue pour le calcul (la durée déclarée, ou 30 minutes sans durée déclarée). */
  readonly ajoutRetenuMs: number;
  readonly restantMs: number;
}

/** Refus si `utiliseesMs + ajoutMs > plafondMinutes × 60 000` (l'égalité est admise). */
export function verifierPlafondTranscription(
  entree: EntreePlafondTranscription,
): DecisionPlafondTranscription {
  const { utiliseesMs, plafondMinutes } = entree;
  const ajoutRetenuMs = entree.ajoutMs ?? TRANSCRIPTION_DUREE_MAX_MS;
  for (const n of [utiliseesMs, ajoutRetenuMs, plafondMinutes]) {
    if (!Number.isInteger(n) || n < 0) throw new ErreurCanaux("ENTREE_INVALIDE");
  }
  const plafondMs = plafondMinutes * 60_000;
  return {
    autorise: utiliseesMs + ajoutRetenuMs <= plafondMs,
    ajoutRetenuMs,
    restantMs: Math.max(0, plafondMs - utiliseesMs),
  };
}

/**
 * Coût estimé en micro-dollars : `ceil(dureeMs / 60 000) × tarifParMinute` (entiers ; tarif
 * simulé 0, valeur réelle OUVERTE : O-08). FIN-02 : à ne montrer qu'avec `finance.lire`.
 */
export function coutTranscriptionMicroUsd(dureeMs: number, tarifParMinute: number): number {
  if (!Number.isInteger(dureeMs) || dureeMs < 0) throw new ErreurCanaux("DUREE_INVALIDE");
  if (!Number.isInteger(tarifParMinute) || tarifParMinute < 0) {
    throw new ErreurCanaux("ENTREE_INVALIDE");
  }
  const cout = Math.ceil(dureeMs / 60_000) * tarifParMinute;
  if (!Number.isSafeInteger(cout)) throw new ErreurCanaux("ENTREE_INVALIDE");
  return cout;
}
