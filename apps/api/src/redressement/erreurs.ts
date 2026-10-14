import { ErreurRedressement } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Traduction des erreurs du redressement en erreurs HTTP (jamais de 500 pour une règle métier) :
 * SQLSTATE MPZ01 à MPZ11 des déclencheurs (migrations 0480 à 0486), contraintes CHECK (23514),
 * unicité (23505), référence (23503) et invariants du moteur (`ErreurRedressement`, code stable
 * préfixé par RED_). Les messages sont en français et ne recopient jamais une valeur saisie
 * (ni montant, ni nom, ni condition de négociation).
 */

const SQL: Record<string, [number, string, string]> = {
  MPZ01: [409, "RED_HISTORIQUE_IMMUABLE", "L'historique du redressement est en ajout seul."],
  MPZ02: [
    400,
    "RED_RATTACHEMENT_INCOHERENT",
    "Référence incohérente pour ce dossier de redressement.",
  ],
  MPZ03: [
    409,
    "RED_MISSION_CLOTUREE",
    "La mission est clôturée ou le dossier de redressement est clos.",
  ],
  MPZ04: [409, "RED_CHAMP_FIGE", "Ce champ est figé : il ne change plus après la création."],
  MPZ05: [
    409,
    "RED_VERSION_NON_CONSECUTIVE",
    "Les versions se suivent : une version plus récente existe ou ce numéro n'est pas le suivant.",
  ],
  MPZ06: [409, "RED_TRANSITION_INVALIDE", "Ce changement de statut n'est pas admis."],
  MPZ07: [
    403,
    "SEPARATION_DES_TACHES",
    "Séparation des tâches : l'auteur ne valide pas son propre travail, et le rôle doit y être habilité.",
  ],
  MPZ08: [
    409,
    "RED_REALISE_INCOHERENT",
    "Un réalisé corrige la ligne courante de la même semaine.",
  ],
  MPZ09: [
    409,
    "RED_NEGOCIATION_INCOHERENTE",
    "Cet événement est incohérent avec l'état de la négociation.",
  ],
  MPZ10: [409, "RED_PLAFOND_ATTEINT", "Le plafond de volume est atteint pour cet objet."],
  MPZ11: [
    409,
    "RED_TROP_DE_CORRECTIONS",
    "Une semaine de réalisé ne se corrige pas plus de dix fois.",
  ],
};

/** Codes du moteur qui sont des conflits d'état (409) plutôt que des entrées mal formées (400). */
const CODES_409 = new Set([
  "PAIEMENT_EXCESSIF",
  "ACCORD_ROMPU",
  "BASE_INCOMPLETE",
  "REALISE_NON_CONTIGU",
]);

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurRedressement(error: unknown): unknown {
  if (error instanceof ErreurRedressement) {
    return new AppError(
      CODES_409.has(error.code) ? 409 : 400,
      `RED_${error.code}`,
      error.message,
      error.manquants.length > 0 ? { manquants: [...error.manquants] } : undefined,
    );
  }
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23514") {
    return new AppError(
      400,
      "REQUETE_INVALIDE",
      "Valeurs incohérentes pour ce dossier de redressement.",
    );
  }
  if (code === "23505") {
    const table = champ(error, "table");
    if (table === "red_dossiers") {
      return new AppError(409, "RED_EXISTE", "Cette mission a déjà un dossier de redressement.");
    }
    if (table === "red_creanciers") {
      return new AppError(
        409,
        "RED_CREANCIER_EN_DOUBLE",
        "Un créancier de même nom et de même catégorie existe déjà dans ce dossier.",
      );
    }
    return new AppError(
      409,
      "CONFLIT",
      "Une écriture simultanée a pris le même numéro ou la même ligne : réessayez dans un instant.",
    );
  }
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
