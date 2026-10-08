import { ErreurModulation, ErreurQualite } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/** SQLSTATE des déclencheurs du référentiel de méthodes (migrations 0200 à 0205). */
const SQL_PUBLIEE = "MPM01";
const SQL_INCOHERENT = "MPM02";
const SQL_AJOUT_SEUL = "MPM03";
const SQL_DEROGATION = "MPM04";
const SQL_PROPOSITION = "MPM05";
const SQL_LIAISON = "MPM06";
const SQL_VARIANTE_DESSERREE = "MPM07";
const SQL_VARIANTE_QUATRE_YEUX = "MPM08";

export const versionPubliee = () =>
  new AppError(
    409,
    "VERSION_PUBLIEE",
    "Version publiée immuable : créer une nouvelle version pour la modifier.",
  );

export const standardLectureSeule = () =>
  new AppError(
    403,
    "STANDARD_LECTURE_SEULE",
    "Le standard MissionPilot est en lecture seule : créer une variante du cabinet.",
  );

export const separationVariante = () =>
  new AppError(
    403,
    "SEPARATION_DES_TACHES",
    "Une variante n'est pas publiée par le créateur de la version (sauf associé).",
  );

export const plafondAtteint = (quoi: string, max: number) =>
  new AppError(409, "PLAFOND_ATTEINT", `${quoi} : ${max} au plus par version.`);

/**
 * Traduit les erreurs des moteurs (modulation, qualité) et des déclencheurs du
 * référentiel en erreurs HTTP : version publiée → 409 ; incohérence → 409 ;
 * historique en ajout seul → 409 ; décision de dérogation ou séparation des
 * tâches → 409 ; proposition → 409 ; liaison de mission → 409. Un jeu de
 * règles refusé par le moteur → 400 avec son code (le client traduit le
 * code, le message cite le chemin). Le reste remonte au gestionnaire de
 * l'application.
 */
export function traduireErreurStandard(error: unknown): unknown {
  if (error instanceof ErreurModulation) {
    const chemin = error.chemin ? ` (${error.chemin})` : "";
    return new AppError(400, `MODULATION_${error.code}`, `${error.message}${chemin}`);
  }
  if (error instanceof ErreurQualite)
    return new AppError(400, `QUALITE_${error.code}`, error.message);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  switch (code) {
    case SQL_PUBLIEE:
      return versionPubliee();
    case SQL_INCOHERENT:
      return new AppError(
        409,
        "REFERENTIEL_INCOHERENT",
        "Opération incohérente avec l'état du référentiel.",
      );
    case SQL_AJOUT_SEUL:
      return new AppError(409, "HISTORIQUE_AJOUT_SEUL", "Historique en ajout seul.");
    case SQL_DEROGATION:
      return new AppError(
        409,
        "DEROGATION_DECISION_REFUSEE",
        "Décision refusée : dérogation déjà décidée, ou approbation par son demandeur.",
      );
    case SQL_PROPOSITION:
      return new AppError(
        409,
        "PROPOSITION_TRANSITION_REFUSEE",
        "Transition refusée : circuit proposée → en revue → acceptée → publiée, relecteur distinct de l'auteur.",
      );
    case SQL_LIAISON:
      return new AppError(
        409,
        "VERSION_NON_LIABLE",
        "Seule une version publiée (plus récente, pour une migration) de la méthode se lie à la mission.",
      );
    case SQL_VARIANTE_DESSERREE:
      return new AppError(
        409,
        "VERSION_INCOHERENTE",
        "Publication refusée : une variante n'abaisse pas la classe de risque ni ne relève l'autonomie d'une brique du standard.",
      );
    case SQL_VARIANTE_QUATRE_YEUX:
      return separationVariante();
    default:
      return error;
  }
}
