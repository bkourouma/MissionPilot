import { ErreurQualite, type ViolationGarde } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Erreurs du lot qualité (jamais de 500 pour une règle métier) : SQLSTATE MPY… des déclencheurs
 * (migrations 0280 à 0286), contraintes CHECK (23514), unicité (23505), référence (23503) et
 * invariants du moteur (`ErreurQualite`). Codes d'erreur de l'API : voir SECURITY.md §5 ter.
 */

/** Refus de garde : 409 `GARDE_VIOLEE` avec la liste des violations du moteur (`details`). */
export class ErreurGarde extends AppError {
  constructor(
    message: string,
    readonly violations: readonly ViolationGarde[],
  ) {
    super(409, "GARDE_VIOLEE", message, { violations });
  }
}

const SQL: Record<string, [number, string, string]> = {
  MPY01: [409, "QUALITE_HISTORIQUE_IMMUABLE", "L'historique qualité est en ajout seul."],
  MPY02: [
    409,
    "SUIVI_QUALITE_FIGE",
    "Le suivi qualité n'accepte que le relèvement de la classe et l'avancement du statut.",
  ],
  MPY03: [
    409,
    "SUIVI_QUALITE_VALIDE",
    "Le suivi qualité est validé : le parcours de revue est clos.",
  ],
  MPY04: [409, "SESSION_REVUE_CLOSE", "Cette session de revue est déjà terminée."],
  MPY05: [409, "ETAPE_IMPOSSIBLE", "Cette étape de garde est impossible dans l'état du suivi."],
  MPY06: [409, "SIGNATURE_IMPOSSIBLE", "Signature impossible : le suivi n'est pas validé."],
  MPY07: [409, "RELATION_EN_DOUBLE", "Cette relation est déjà déclarée (dans un sens ou l'autre)."],
  MPY08: [
    409,
    "PARCOURS_VIDE",
    "Un livrable client (R2, R3) ne se valide pas sur un parcours de revue vide.",
  ],
  MPY09: [
    409,
    "NIVEAU_RISQUE_ABAISSE",
    "Une décision a été prise : le niveau de risque retenu ne s'abaisse plus.",
  ],
  MPY10: [
    409,
    "ATTESTATION_PAR_AUTEUR",
    "L'auteur du livrable n'atteste pas sa propre définition de terminé.",
  ],
  MPY11: [400, "AUTEUR_NON_MEMBRE", "L'auteur désigné doit être un membre actif de la mission."],
  // Revue à froid (QUA-05, migrations 0287 à 0290).
  MQQ01: [409, "FROIDE_HISTORIQUE_IMMUABLE", "L'historique de la revue à froid est en ajout seul."],
  MQQ02: [409, "FROIDE_CAMPAGNE_FIGEE", "La campagne de revue à froid et son tirage sont figés."],
  MQQ03: [
    409,
    "RELECTEUR_NON_INDEPENDANT",
    "Le relecteur n'est pas indépendant de la mission tirée.",
  ],
  MQQ04: [409, "REVUE_FROIDE_TERMINEE", "La revue est terminée : elle est figée."],
  MQQ05: [409, "MISSION_TIREE_INVALIDE", "Seule une mission clôturée de la population se tire."],
  MQQ06: [409, "ACTION_TRANSITION_IMPOSSIBLE", "Cette action ne peut pas changer ainsi."],
  MQQ07: [409, "RELECTEUR_NON_HABILITE", "Le relecteur n'est pas habilité à la revue à froid."],
  MQQ08: [400, "RESPONSABLE_INVALIDE", "Le responsable doit être un utilisateur actif du cabinet."],
  MQQ09: [409, "PLAFOND_ATTEINT", "Le plafond de cette liste est atteint."],
  MQQ10: [
    409,
    "REVUES_NON_TERMINEES",
    "Toutes les revues doivent être terminées avant de clore la campagne.",
  ],
  MQQ11: [409, "REVUE_ETAT_IMPOSSIBLE", "Cette opération est impossible dans l'état de la revue."],
  MQQ12: [
    409,
    "CONSTAT_INVALIDE",
    "Le constat doit venir d'une revue terminée de la même campagne.",
  ],
  MQQ13: [
    409,
    "REAFFECTATION_EN_REVUE",
    "Le relecteur ne se remplace pas une fois la revue commencée.",
  ],
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

const UNICITES: Record<string, [string, string]> = {
  qualite_suivis_version_unique: [
    "SUIVI_EXISTANT",
    "Un suivi qualité existe déjà pour cette version du livrable.",
  ],
  qualite_revue_sessions_ouverte_uniq: [
    "SESSION_OUVERTE",
    "Une session de revue est déjà ouverte sur ce livrable.",
  ],
  qualite_acceptations_mission_id_rang_key: [
    "CONFLIT",
    "Une évaluation vient d'être enregistrée : rechargez la page.",
  ],
  qualite_satisfactions_mission_id_cle_rang_key: [
    "CONFLIT",
    "Une note vient d'être enregistrée : rechargez la page.",
  ],
  qualite_froide_echantillon_mission_uniq: [
    "MISSION_DEJA_TIREE",
    "Cette mission est déjà dans l'échantillon de la campagne.",
  ],
  qualite_froide_evaluations_critere_uniq: [
    "CONFLIT",
    "Ce critère vient d'être évalué : rechargez la page.",
  ],
  qualite_froide_actions_historique_rang_uniq: [
    "CONFLIT",
    "Cette action vient d'être modifiée : rechargez la page.",
  ],
  qualite_relations_retraits_relation_id_key: [
    "RELATION_DEJA_RETIREE",
    "Cette relation vient d'être retirée : rechargez la page.",
  ],
};

export function traduireErreurQualite(error: unknown): unknown {
  if (error instanceof ErreurQualite)
    return new AppError(400, `QUALITE_${error.code}`, error.message);
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) return new AppError(sql[0], sql[1], sql[2]);
  if (code === "23505") {
    const u = UNICITES[champ(error, "constraint")];
    if (u) return new AppError(409, u[0], u[1]);
    return new AppError(409, "CONFLIT", "Cette écriture entre en conflit avec une autre.");
  }
  if (code === "23514") {
    return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes pour ce suivi qualité.");
  }
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
