import { AppError } from "../errors.js";
import { traduireErreurDueDiligence } from "./erreurs.js";

/*
 * Erreurs des modèles d'analyse sectoriels (DD-07, migration 0511) : SQLSTATE MQD11 (point à
 * examiner invalide), unicité du modèle et taille, puis repli sur la traduction commune de la due
 * diligence (MPZ21, MPZ23, 23503…). Jamais de 500 pour une règle métier.
 */

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurModeles(error: unknown): unknown {
  const code = champ(error, "code");
  if (code === "MQD11") {
    return new AppError(
      400,
      "POINT_MODELE_INVALIDE",
      "Chaque point à examiner porte une catégorie de l'analyse et un libellé de 1 à 300 caractères.",
    );
  }
  const contrainte = champ(error, "constraint");
  if (code === "23505" && contrainte === "dd_modeles_secteur_cabinet_id_secteur_code_analyse_key") {
    return new AppError(
      409,
      "MODELE_EXISTANT",
      "Un modèle existe déjà pour ce secteur et cette analyse : ajoutez-lui une version.",
    );
  }
  if (code === "23514" && contrainte === "dd_modele_versions_points_octets") {
    return new AppError(
      400,
      "CONTENU_TROP_VOLUMINEUX",
      "Les points du modèle dépassent la taille admise (40 000 octets) : raccourcissez les libellés.",
    );
  }
  return traduireErreurDueDiligence(error);
}
