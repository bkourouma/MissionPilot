import { ErreurKpi } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Traduction des erreurs du pilotage par KPI en erreurs HTTP (jamais de 500
 * pour une règle métier) : SQLSTATE MPK… des déclencheurs (migration 0160),
 * contraintes CHECK (23514), unicité (23505), référence (23503) et
 * invariants du moteur (`ErreurKpi`, code stable préfixé par KPI_).
 */

const SQL: Record<string, [number, string, string]> = {
  MPK01: [
    409,
    "KPI_CHAMP_FIGE",
    "Sens, nature, fréquence, mission et début de suivi d'un KPI sont figés.",
  ],
  MPK02: [400, "KPI_INCOHERENT", "Référence incohérente pour ce KPI."],
  MPK03: [409, "KPI_INACTIF", "KPI inactif : aucune mesure ne peut être saisie."],
  MPK04: [409, "KPI_MESURE_EN_DOUBLE", "Une mesure existe déjà à cette date : corrigez-la."],
  MPK05: [409, "KPI_HISTORIQUE_IMMUABLE", "L'historique des KPI est en ajout seul."],
  MPK06: [400, "KPI_HORS_PERIODE", "Date de mesure hors de la période de suivi du KPI."],
  MPK07: [
    409,
    "KPI_TROP_DE_CORRECTIONS",
    "Cette mesure a atteint le nombre maximal de corrections : annulez-la puis saisissez-la à nouveau.",
  ],
  // Pilotage augmenté (0440-0442) : arbres, revues, décisions, actions correctives.
  MPK10: [
    400,
    "KPI_RATTACHEMENT_INCOHERENT",
    "Le KPI, l'alerte, la revue ou la décision n'appartient pas à cette mission.",
  ],
  MPK11: [409, "KPI_CHAMP_FIGE", "Ce champ est figé : il ne change plus après la création."],
  MPK12: [
    400,
    "KPI_NOEUD_PARENT_INVALIDE",
    "Le parent du nœud est invalide (autre arbre ou nœud désactivé).",
  ],
  MPK13: [
    409,
    "KPI_ARBRE_TROP_GRAND",
    "Un arbre compte au plus 50 nœuds actifs, 200 nœuds au total et 6 niveaux sous la racine.",
  ],
  MPK14: [400, "KPI_COEFFICIENT_PRODUIT", "Sous un produit, le coefficient d'un levier est 1."],
  MPK15: [
    409,
    "KPI_NOEUD_NON_DESACTIVABLE",
    "Désactivez d'abord les enfants du nœud ; la racine ne se désactive pas.",
  ],
  MPK16: [409, "KPI_MISSION_CLOTUREE", "La mission est clôturée."],
  MPK20: [409, "KPI_REVUE_STATUT_INITIAL", "Une revue naît planifiée."],
  MPK21: [409, "KPI_REVUE_TRANSITION", "Cette revue ne peut pas changer de statut ainsi."],
  MPK22: [409, "KPI_REVUE_FIGEE", "Le contenu d'une revue tenue est figé."],
  MPK23: [
    409,
    "KPI_REVUE_OUVERTE",
    "Des décisions ou des actions de la revue sont encore ouvertes.",
  ],
  MPK24: [409, "KPI_DECISION_REVUE", "Une décision se prend dans une revue tenue et non clôturée."],
  MPK25: [409, "KPI_DECISION_TRANSITION", "Cette décision ne peut pas changer de statut ainsi."],
  MPK26: [409, "KPI_ACTION_TRANSITION", "Cette action ne peut pas changer de statut ainsi."],
  MPK27: [409, "KPI_ACTION_REVUE", "Une action se rattache à une revue tenue et non clôturée."],
};

/** Numérotations par mission ou par revue : deux créations simultanées, la seconde réessaie. */
const NUMEROTATIONS = new Set([
  "kpi_actions_cabinet_id_mission_id_numero_key",
  "kpi_revues_cabinet_id_mission_id_numero_key",
  "kpi_revue_decisions_cabinet_id_revue_id_numero_key",
]);

/** Contraintes CHECK dont le refus mérite un message propre (sinon message générique). */
const CONTRAINTES: Record<string, [string, string]> = {
  kpi_definitions_debut_suivi_borne: [
    "KPI_DEBUT_SUIVI_TROP_ANCIEN",
    "Le suivi d'un KPI commence au plus 10 ans avant sa création.",
  ],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

export function traduireErreurKpi(error: unknown): unknown {
  if (error instanceof ErreurKpi) return new AppError(400, `KPI_${error.code}`, error.message);
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23514") {
    const contrainte = CONTRAINTES[champ(error, "constraint")];
    if (contrainte) return new AppError(400, contrainte[0], contrainte[1]);
    return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes pour ce KPI.");
  }
  if (code === "23505" && champ(error, "constraint") === "kpi_mesures_remplace_uniq") {
    return new AppError(409, "CONFLIT", "Cette mesure a déjà été corrigée ou annulée.");
  }
  if (code === "23505" && NUMEROTATIONS.has(champ(error, "constraint"))) {
    return new AppError(
      409,
      "CONFLIT",
      "Une création simultanée a pris le même numéro : réessayez dans un instant.",
    );
  }
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
