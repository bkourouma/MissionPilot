import { ErreurCanaux } from "@missionpilot/engines";
import { AppError } from "../errors.js";
import { ErreurSignature, ErreurTranscription } from "./ports.js";

/*
 * Traduction des erreurs du lot canaux simulés (lot 3c) : SQLSTATE MPH01 à MPH12 des déclencheurs
 * (migrations 0540 à 0547), contraintes d'unicité et CHECK, erreurs des moteurs (`ErreurCanaux`) et
 * des ports. Jamais un 500 pour une règle métier : 409 par défaut, 400 pour un document non
 * signable (MPH11). Les messages des déclencheurs sont des textes fixes, en français et sans donnée
 * (jamais un numéro, un texte de message ni un code) : ils sont rendus tels quels.
 */

const SQL: Record<string, [number, string]> = {
  MPH01: [409, "HISTORIQUE_IMMUABLE"],
  MPH02: [409, "CONSENTEMENT_INCOHERENT"],
  MPH03: [409, "ENVOI_TRANSITION_REFUSEE"],
  MPH04: [409, "ACTIVATION_RESERVEE_ASSOCIE"],
  MPH05: [409, "SAISIE_TRANSITION_REFUSEE"],
  MPH06: [409, "TRANSCRIPTION_HISTORIQUE_IMMUABLE"],
  MPH07: [409, "TRANSCRIPTION_VALIDATION_REFUSEE"],
  MPH08: [409, "SIGNATURE_TRANSITION_REFUSEE"],
  MPH09: [409, "SIGNATAIRE_INCOHERENT"],
  MPH10: [409, "PREUVE_IMMUABLE"],
  MPH11: [400, "DOCUMENT_NON_SIGNABLE"],
  MPH12: [409, "DESTINATAIRE_INCOHERENT"],
};

const UNICITE: Record<string, [string, string]> = {
  // Deux personnes ne vérifient pas le même numéro : même réponse que pour un code faux épuisé
  // (aucun détail sur l'existence ou le titulaire d'un numéro, constat M5).
  canaux_destinataires_numero_verifie_uniq: [
    "CODE_INVALIDE",
    "Code incorrect : trop d'essais, demandez un nouveau code.",
  ],
  signatures_demandes_ouverte_uniq: [
    "SIGNATURE_EN_COURS",
    "Une demande de signature est déjà ouverte pour ce document.",
  ],
  transcriptions_cabinet_id_fichier_id_key: [
    "FICHIER_DEJA_TRANSCRIT",
    "Ce fichier fait déjà l'objet d'une transcription.",
  ],
  canaux_saisies_kpi_cabinet_id_evenement_ref_key: ["CONFLIT", "Cet événement a déjà été traité."],
};

const ERREURS_CANAUX: Partial<Record<string, [number, string]>> = {
  NUMERO_INVALIDE: [400, "NUMERO_INVALIDE"],
  VARIABLE_INVALIDE: [400, "REQUETE_INVALIDE"],
  ENTREE_INVALIDE: [400, "REQUETE_INVALIDE"],
};

/** Erreur du lot (PostgreSQL, moteur, port) → AppError ; toute autre erreur est rendue telle quelle. */
export function traduireErreurCanaux(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof ErreurCanaux) {
    const [statut, code] = ERREURS_CANAUX[error.code] ?? [400, "REQUETE_INVALIDE"];
    return new AppError(statut, code, error.message);
  }
  if (error instanceof ErreurSignature) return new AppError(400, "REQUETE_INVALIDE", error.message);
  if (error instanceof ErreurTranscription) {
    return new AppError(error.reessayable ? 503 : 400, "REQUETE_INVALIDE", error.message);
  }
  if (typeof error !== "object" || error === null) return error;
  const e = error as { code?: string; message?: string; constraint?: string };
  const sql = SQL[e.code ?? ""];
  if (sql) return new AppError(sql[0], sql[1], e.message ?? "Opération refusée.");
  if (e.code === "23514") {
    return new AppError(400, "REQUETE_INVALIDE", "Valeur refusée par les contrôles de la base.");
  }
  if (e.code === "23505") {
    const connue = UNICITE[e.constraint ?? ""];
    if (connue) return new AppError(409, connue[0], connue[1]);
  }
  return error;
}

/** Erreur d'API du lot (code stable, message en français sans donnée sensible). */
export const erreurCanal = (statut: number, code: string, message: string) =>
  new AppError(statut, code, message);

export const numeroInvalide = () =>
  erreurCanal(
    400,
    "NUMERO_INVALIDE",
    "Numéro de téléphone invalide (format international attendu).",
  );
export const numeroReelRefuse = () =>
  erreurCanal(
    400,
    "NUMERO_REEL_REFUSE_EN_SIMULE",
    "Numéro refusé : tant qu'un fournisseur simulé est actif, seuls les numéros de test sont acceptés.",
  );
export const codeInvalide = (essaisRestants: number) =>
  erreurCanal(
    409,
    "CODE_INVALIDE",
    `Code incorrect. Il vous reste ${essaisRestants} essai${essaisRestants > 1 ? "s" : ""}.`,
  );
export const codeExpire = () =>
  erreurCanal(409, "CODE_EXPIRE", "Ce code a expiré : demandez-en un nouveau.");
export const mentionPerimee = () =>
  erreurCanal(409, "MENTION_PERIMEE", "La mention de consentement a changé : relisez-la.");
export const canalNonActif = () =>
  erreurCanal(409, "CANAL_NON_ACTIF", "Ce canal n'est pas activé pour le cabinet.");
export const consentementRequis = () =>
  erreurCanal(
    409,
    "CONSENTEMENT_REQUIS",
    "Un consentement accordé sur un numéro vérifié est requis.",
  );
export const tropDeTentativesCode = () =>
  erreurCanal(429, "TROP_DE_TENTATIVES", "Trop de codes demandés : réessayez plus tard.");
export const plafondTranscription = () =>
  erreurCanal(
    429,
    "PLAFOND_TRANSCRIPTION",
    "Le plafond de transcription du cabinet est atteint pour le moment.",
  );
export const documentNonSignable = (
  message = "Ce document ne peut pas faire l'objet d'une signature.",
) => erreurCanal(409, "DOCUMENT_NON_SIGNABLE", message);
export const portailNonPartage = () =>
  erreurCanal(
    409,
    "PORTAIL_NON_PARTAGE",
    "La mission doit d'abord être partagée avec le client pour envoyer une demande de signature.",
  );
export const tropDeRequetes = (message = "Trop de requêtes : réessayez dans quelques minutes.") =>
  erreurCanal(429, "TROP_DE_REQUETES", message);
