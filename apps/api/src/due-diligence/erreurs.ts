import { ErreurDueDiligence } from "@missionpilot/engines";
import { AppError } from "../errors.js";

/*
 * Erreurs du service #2 « Due diligence » (lot 3b) : SQLSTATE MPZ21 à MPZ32 des déclencheurs
 * (migrations 0500 à 0507), contraintes (23505, 23503, 23514) et invariants des moteurs
 * (`ErreurDueDiligence`). Jamais de 500 pour une règle métier, jamais le message technique de la
 * base. La lettre Z est PARTAGÉE avec le redressement (numéros 21 à 32 seulement, SPEC-3b §3.2).
 * Portail investisseur (0509) : MQD01 à MQD08 (second préfixe « MQ », CODING_STANDARDS §2).
 */

const SQL: Record<string, [number, string, string]> = {
  MPZ21: [
    409,
    "HISTORIQUE_AJOUT_SEUL",
    "La due diligence est en ajout seul : corrigez par une nouvelle version.",
  ],
  MPZ22: [400, "RATTACHEMENT_INCOHERENT", "Référence incohérente avec le dossier ou la mission."],
  MPZ23: [
    409,
    "CONFLIT",
    "Une autre modification vient d'être enregistrée : rechargez la page puis recommencez.",
  ],
  MPZ24: [
    409,
    "VERDICT_SANS_SOURCE",
    "Un verdict confirmé ou infirmé cite des assertions liées à l'hypothèse, dans le bon sens.",
  ],
  MPZ25: [
    403,
    "SEPARATION_DES_TACHES",
    "Un verdict ne se valide ni par son proposant, ni par l'auteur de l'hypothèse ou d'une assertion citée (sauf associé).",
  ],
  MPZ26: [
    403,
    "SEPARATION_DES_TACHES",
    "Une note ne se valide ni par son créateur, ni par l'auteur d'une de ses versions (sauf associé).",
  ],
  MPZ27: [
    409,
    "VERDICT_PERIME",
    "Ce verdict n'est plus à jour : l'hypothèse a changé ou un autre verdict l'a remplacé.",
  ],
  MPZ28: [
    403,
    "SEPARATION_DES_TACHES",
    "L'auteur du filtrage ne décide pas lui-même d'une exclusion (sauf associé).",
  ],
  MPZ29: [
    409,
    "NOTE_BLOQUEE",
    "La version soumise de la note est incohérente avec sa base figée : elle n'est pas soumissible.",
  ],
  MPZ30: [
    400,
    "LIEN_INCOHERENT",
    "Le responsable, l'initiative ou le KPI de l'action ne correspond pas à l'équipe ou au client du dossier.",
  ],
  MPZ31: [
    400,
    "PARAMETRE_SANS_SOURCE",
    "Chaque paramètre cite une preuve de la mission ou un avis d'expert motivé.",
  ],
  MPZ32: [409, "VERDICT_EN_ATTENTE", "Un verdict de cette hypothèse attend déjà une décision."],
  MPR04: [409, "NOTE_NON_VALIDEE", "Seule une version validée de la note se rend en rapport."],
  // Portail investisseur (migration 0509), second préfixe « MQD » (MQD01 à MQD10 à ce chantier).
  MQD01: [
    400,
    "DD_PORTAIL_COMPTE_NON_ADMISSIBLE",
    "Seul un investisseur actif du portail, rattaché au client du dossier, est invitable.",
  ],
  MQD02: [
    409,
    "DD_PORTAIL_INVITATION_INCOHERENTE",
    "L'invitation de ce compte a changé : rechargez la page puis recommencez.",
  ],
  MQD03: [
    409,
    "NOTE_NON_VALIDEE",
    "Seule la dernière version soumise et validée de la note se publie.",
  ],
  MQD04: [
    409,
    "DD_PORTAIL_INSTANTANE_INCOHERENT",
    "Le contenu publié doit être celui de la version validée de la note.",
  ],
  MQD05: [
    409,
    "DD_PORTAIL_PUBLICATION_ACTIVE",
    "Une publication de cette note est déjà active : retirez-la avant d'en publier une autre.",
  ],
  MQD06: [400, "RATTACHEMENT_INCOHERENT", "Référence incohérente avec la publication."],
  MQD07: [
    400,
    "DD_PORTAIL_PIECE_NON_ADMISSIBLE",
    "Chaque pièce est un rapport validé de la version publiée de la note, encore disponible.",
  ],
  MQD08: [409, "PLAFOND_ATTEINT", "Plafond atteint pour le portail investisseur."],
};

const UNICITES: Record<string, [string, string]> = {
  dd_signaux_cabinet_id_code_key: ["SIGNAL_EXISTANT", "Un signal porte déjà ce code."],
  dd_exclusion_listes_cabinet_id_nom_key: [
    "LISTE_EXISTANTE",
    "Une liste d'exclusion porte déjà ce nom.",
  ],
  dd_verdict_validations_verdict_id_key: [
    "VERDICT_DEJA_DECIDE",
    "Ce verdict a déjà fait l'objet d'une décision.",
  ],
  dd_note_validations_note_version_id_key: [
    "NOTE_DEJA_DECIDEE",
    "Cette version de la note a déjà fait l'objet d'une décision.",
  ],
  dd_portail_publication_retraits_publication_id_key: [
    "DD_PORTAIL_PUBLICATION_RETIREE",
    "Cette publication est déjà retirée du portail.",
  ],
  dd_portail_pieces_publication_id_rapport_id_key: [
    "CONFLIT",
    "Un rapport n'est choisi qu'une fois par publication.",
  ],
  dd_elements_assertion_uniq: [
    "CONFLIT",
    "Cette assertion est déjà utilisée par un autre élément.",
  ],
};

/** CHECK de taille en octets (jsonb) : le message nomme la liste ou le champ concerné. */
const TAILLES: Record<string, string> = {
  dd_exclusion_liste_versions_regles_octets:
    "Les règles de la liste d'exclusion dépassent la taille admise (700 000 octets) : réduisez le nombre ou la longueur des règles.",
  dd_filtrages_declarations_octets:
    "Les déclarations du filtrage dépassent la taille admise (20 000 octets) : raccourcissez les activités ou les codes déclarés.",
  dd_filtrages_themes_octets:
    "Les thèmes du filtrage dépassent la taille admise (20 000 octets) : raccourcissez les justifications.",
  dd_verdicts_citees_octets:
    "Les assertions citées par le verdict dépassent la taille admise (20 000 octets).",
};

function champ(error: unknown, nom: string): string {
  return typeof error === "object" && error !== null && nom in error
    ? String((error as Record<string, unknown>)[nom] ?? "")
    : "";
}

/** Codes du moteur qui relèvent d'une saisie de dimensionnement. */
const CODES_DIMENSIONNEMENT = new Set([
  "PARAMETRE_INVALIDE",
  "PARAMETRE_MANQUANT",
  "BORNES_INCOHERENTES",
]);

export function traduireErreurDueDiligence(error: unknown): unknown {
  if (error instanceof ErreurDueDiligence) {
    if (error.code === "DEPASSEMENT") return new AppError(400, "DEPASSEMENT", error.message);
    if (CODES_DIMENSIONNEMENT.has(error.code)) {
      return new AppError(400, "DIMENSIONNEMENT_INVALIDE", error.message);
    }
    return new AppError(400, `DUE_DILIGENCE_${error.code}`, error.message);
  }
  const code = champ(error, "code");
  const sql = SQL[code];
  if (sql) {
    // MPZ27 couvre la validation d'un verdict ET celle d'une note : la fonction de contrôle dit laquelle.
    if (code === "MPZ27" && champ(error, "where").includes("controler_dd_note_validation")) {
      return new AppError(
        409,
        "NOTE_PERIMEE",
        "Cette version n'est plus la dernière version soumise de la note.",
      );
    }
    // MPZ28 : une règle absente des règles touchées n'est pas une affaire de séparation des tâches.
    if (code === "MPZ28" && champ(error, "hint") === "regle_inconnue") {
      return new AppError(
        400,
        "RATTACHEMENT_INCOHERENT",
        "Cette règle ne figure pas parmi les règles touchées du filtrage.",
      );
    }
    return new AppError(sql[0], sql[1], sql[2]);
  }
  if (code === "23505") {
    const unicite = UNICITES[champ(error, "constraint")];
    if (unicite) return new AppError(409, unicite[0], unicite[1]);
    return new AppError(
      409,
      "CONFLIT",
      "Une autre modification vient d'être enregistrée : rechargez la page puis recommencez.",
    );
  }
  if (code === "23514") {
    if (champ(error, "constraint") === "dd_note_versions_base_taille_check") {
      return new AppError(
        409,
        "NOTE_TROP_VOLUMINEUSE",
        "La base figée de la note dépasse 1 Mo : réduisez le contenu du dossier.",
      );
    }
    const taille = TAILLES[champ(error, "constraint")];
    if (taille) return new AppError(400, "CONTENU_TROP_VOLUMINEUX", taille);
    return new AppError(400, "REQUETE_INVALIDE", "Valeurs incohérentes pour la due diligence.");
  }
  if (code === "23503") return new AppError(400, "REQUETE_INVALIDE", "Référence inconnue.");
  return error;
}
