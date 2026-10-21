import { AppError } from "../errors.js";

/** SQLSTATE des déclencheurs des ateliers stratégiques (migrations 0425 et 0426, préfixe « MQL »). */
const SQL_FIGE = "MQL01";
const SQL_INCOHERENT = "MQL02";
const SQL_ETAT = "MQL03";
const SQL_PARTICIPANT = "MQL04";
const SQL_CONTRIBUTION = "MQL05";
const SQL_INCOMPLETE = "MQL06";
const SQL_AJOUT_SEUL = "MQL07";
const SQL_PLAFOND = "MQL08";

/**
 * Traduit les erreurs des déclencheurs des ateliers en erreurs HTTP, jamais en 500 : atelier figé,
 * incohérent ou dans le mauvais état → 409 ; participant inadmissible → 409 ; contribution hors règle
 * (méthode, budget de points, option inconnue, classement) → 400 ; plafond atteint → 409. Les messages
 * ne citent ni libellé d'option ni contribution. Le reste remonte (chaîné avec `traduireErreurPlan`).
 */
export function traduireErreurAtelier(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  switch (code) {
    case SQL_FIGE:
      return new AppError(
        409,
        "ATELIER_FIGE",
        "Cette opération n'est plus possible dans l'état actuel de l'atelier.",
      );
    case SQL_INCOHERENT:
      return new AppError(
        409,
        "ATELIER_INCOHERENT",
        "Atelier incohérent : au moins deux options et un participant sont requis pour l'ouvrir.",
      );
    case SQL_ETAT:
      return new AppError(
        409,
        "ATELIER_ETAT",
        "L'atelier n'est pas dans l'état attendu pour cette opération.",
      );
    case SQL_PARTICIPANT:
      return new AppError(
        409,
        "ATELIER_PARTICIPANT_REFUSE",
        "Participant non admissible pour cet atelier.",
      );
    case SQL_CONTRIBUTION:
      return new AppError(
        400,
        "ATELIER_CONTRIBUTION_INVALIDE",
        "Contribution refusée : méthode, option, version ou budget de points non conformes.",
      );
    case SQL_INCOMPLETE:
      return new AppError(
        400,
        "ATELIER_CONTRIBUTION_INCOMPLETE",
        "Contribution incomplète ou classement non contigu.",
      );
    case SQL_AJOUT_SEUL:
      return new AppError(
        409,
        "ATELIER_AJOUT_SEUL",
        "Participants et contributions se complètent sans se modifier.",
      );
    case SQL_PLAFOND:
      return new AppError(
        409,
        "ATELIER_PLAFOND",
        "Plafond atteint (ateliers par plan, options, participants ou versions d'une contribution).",
      );
    default:
      return error;
  }
}
