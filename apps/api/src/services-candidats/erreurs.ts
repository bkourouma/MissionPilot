import { AppError, requeteInvalide } from "../errors.js";

/** SQLSTATE des déclencheurs des services candidats (migration 0563). */
const SQL_GUICHET_FIGE = "MQV01";
const SQL_PLAFOND_GUICHETS = "MQV02";
/** Violation d'une contrainte CHECK : une valeur hors des bornes de la base est une requête invalide. */
const SQL_CONTRAINTE_CHECK = "23514";

/** Nombre maximal de guichets par cabinet (doublé en base par MQV02). */
export const PLAFOND_GUICHETS = 500;

export const guichetFige = () =>
  new AppError(
    409,
    "GUICHET_FIGE",
    "Identité d'un guichet figée : cabinet, auteur et date de création ne changent pas.",
  );

export const plafondGuichets = () =>
  new AppError(
    409,
    "PLAFOND_GUICHETS_ATTEINT",
    `Le cabinet compte déjà ${PLAFOND_GUICHETS} guichets : désactivez ou réutilisez un guichet existant.`,
  );

/**
 * Traduit les erreurs des déclencheurs et contraintes des services candidats (MQV01 → 409,
 * MQV02 → 409, CHECK 23514 → 400) ; le reste remonte.
 */
export function traduireErreurServicesCandidats(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (code === SQL_GUICHET_FIGE) return guichetFige();
  if (code === SQL_PLAFOND_GUICHETS) return plafondGuichets();
  if (code === SQL_CONTRAINTE_CHECK) {
    return requeteInvalide("Une valeur dépasse les bornes autorisées pour ce guichet ou ce prix.");
  }
  return error;
}
