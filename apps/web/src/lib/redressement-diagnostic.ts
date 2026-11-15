/**
 * Redressement, onglet « Diagnostic » (RED-03 check-lists métier, RED-04 causes racines proposées
 * par l'IA) et paramétrage des modèles : chemins d'API, liens, libellés, textes fixes, règles
 * d'affichage et messages d'erreur. Logique pure, testée dans `redressement-diagnostic.test.ts`.
 *
 * Aucun chiffre n'est calculé ici : complétude et conformité sont des points de base déjà
 * calculés par le moteur (on les met en forme sans rien additionner). Aucun texte ne qualifie
 * juridiquement la situation du client : une check-list est un constat de saisie.
 */
import {
  RED_CHECKLIST_MENTION_A_VALIDER,
  RED_CHECKLIST_ORIGINE_LIBELLES,
  RED_CHECKLIST_REPONSE_LIBELLES,
  RED_CHECKLIST_REPONSES,
  RED_CHECKLIST_STATUT_LIBELLES,
  RED_CHECKLIST_STATUT_VERSION_LIBELLES,
  RED_NIVEAU_CONFIANCE_CAUSE_LIBELLES,
  RED_NIVEAUX_CONFIANCE_CAUSE,
  RED_STATUT_CONTENU_CAUSES_LIBELLES,
  type Langue,
  type RedCausesVersionVue,
  type RedChecklistOrigine,
  type RedChecklistReponse,
  type RedChecklistStatut,
  type RedChecklistStatutVersion,
  type RedNiveauConfianceCause,
  type StatutContenu,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { VALEUR_ABSENTE } from "./format";
import { formaterPointsDeBase, messageRedressement } from "./redressement";

const enc = encodeURIComponent;

// --- Chemins d'API ----------------------------------------------------------------------------------

export const CHEMIN_CHECKLISTS_REFERENTIEL = "/api/redressement/checklists/referentiel";
export const CHEMIN_CHECKLISTS_MODELES = "/api/redressement/checklists/modeles";
export const HREF_CHECKLISTS_RED = "/redressement/checklists";

export const cheminModelesChecklists = (secteur?: string) =>
  secteur ? `${CHEMIN_CHECKLISTS_MODELES}?secteur=${enc(secteur)}` : CHEMIN_CHECKLISTS_MODELES;
export const cheminVersionsModele = (modeleId: string) =>
  `${CHEMIN_CHECKLISTS_MODELES}/${enc(modeleId)}/versions`;
export const cheminPublicationChecklist = (versionId: string) =>
  `/api/redressement/checklists/versions/${enc(versionId)}/publication`;
export const cheminChecklistsDossier = (
  dossierId: string,
  statut: "active" | "archivee" | "toutes" = "active",
) => `/api/redressement/dossiers/${enc(dossierId)}/checklists?statut=${statut}`;
export const cheminActivationChecklist = (dossierId: string) =>
  `/api/redressement/dossiers/${enc(dossierId)}/checklists`;
export const cheminChecklist = (id: string) => `/api/redressement/checklists/${enc(id)}`;
export const cheminReponsesChecklist = (id: string) => `${cheminChecklist(id)}/reponses`;
export const cheminArchivageChecklist = (id: string) => `${cheminChecklist(id)}/archivage`;

export const cheminCauses = (dossierId: string) =>
  `/api/redressement/dossiers/${enc(dossierId)}/causes`;
export const cheminGenerationCauses = (dossierId: string) =>
  `${cheminCauses(dossierId)}/generation`;
export const cheminCartographie = (id: string) => `/api/redressement/causes/${enc(id)}`;
export const cheminValidationCauses = (id: string) => `${cheminCartographie(id)}/validation`;

// --- Textes fixes -----------------------------------------------------------------------------------

export const MENTION_CHECKLIST_A_VALIDER = RED_CHECKLIST_MENTION_A_VALIDER;
export const MENTION_CHECKLIST_A_VALIDER_EN =
  "Provisional starting content, to be approved by an expert before any reference use.";

export const BANDEAU_CAUSES_IA =
  "Proposition de l'IA, à valider par un consultant : aucun chiffre ne vient du modèle.";
export const BANDEAU_CAUSES_IA_EN =
  "AI proposal, to be approved by a consultant: no figure comes from the model.";
export const TEXTE_CAUSES_GABARIT = "Proposition de secours sans IA";
export const TEXTE_CAUSES_GABARIT_EN = "Fallback proposal without AI";
export const TEXTE_CAUSES_GABARIT_AIDE =
  "L'IA n'a pas pu répondre : un gabarit déterministe a été utilisé. Relisez-le et adaptez-le.";
export const TEXTE_CAUSES_GABARIT_AIDE_EN =
  "The AI could not respond: a deterministic template was used. Review and adapt it.";
export const TEXTE_CAUSES_LECTURE_SEULE =
  "Cartographie validée : elle est en lecture seule. Demandez une nouvelle proposition pour la faire évoluer.";
export const TEXTE_CAUSES_LECTURE_SEULE_EN =
  "Approved mapping: it is read-only. Request a new proposal to update it.";
export const TEXTE_CAUSES_AUCUNE =
  "Aucune cartographie pour l'instant. Demandez une proposition à l'IA : elle s'appuie sur le diagnostic du dossier.";
export const TEXTE_CAUSES_AUCUNE_EN =
  "No mapping yet. Ask the AI for a proposal: it relies on the file's diagnostic.";
export const TEXTE_PUBLICATION_CHECKLIST =
  "La publication revient à un expert métier ou à un associé autre que l'auteur de la version.";
export const TEXTE_PUBLICATION_CHECKLIST_EN =
  "Publication is reserved for a subject-matter expert or a partner other than the version's author.";
export const TEXTE_CHECKLISTS_LECTURE_SEULE =
  "Lecture seule : la saisie des réponses est réservée aux membres habilités du dossier.";
export const TEXTE_CHECKLISTS_LECTURE_SEULE_EN =
  "Read-only: entering answers is reserved for authorized members of the file.";
export const TEXTE_MODELES_LECTURE_SEULE =
  "Lecture seule : la création et la publication des modèles reviennent aux experts du cabinet.";
export const TEXTE_MODELES_LECTURE_SEULE_EN =
  "Read-only: creating and publishing templates is reserved for the firm's experts.";

// --- Libellés ---------------------------------------------------------------------------------------

const REPONSE_CHECKLIST_EN: Record<RedChecklistReponse, string> = {
  oui: "Yes",
  non: "No",
  partiel: "Partially",
  sans_objet: "N/A",
};
const ORIGINE_CHECKLIST_EN: Record<RedChecklistOrigine, string> = {
  depart: "Starting content",
  modele: "Firm template",
};
const STATUT_CHECKLIST_EN: Record<RedChecklistStatut, string> = {
  active: "Active",
  archivee: "Archived",
};
const STATUT_VERSION_CHECKLIST_EN: Record<RedChecklistStatutVersion, string> = {
  brouillon: "Draft",
  publiee: "Published",
};
const STATUT_CONTENU_CAUSES_EN: Record<StatutContenu, string> = {
  brouillon_ia: "AI draft",
  modifie: "Edited",
  valide: "Approved",
};
const CONFIANCE_CAUSE_EN: Record<RedNiveauConfianceCause, string> = {
  faible: "Low confidence",
  moyen: "Medium confidence",
  eleve: "High confidence",
};

export const libelleReponseChecklist = (r: RedChecklistReponse, langue: Langue = "fr") =>
  (langue === "en" ? REPONSE_CHECKLIST_EN : RED_CHECKLIST_REPONSE_LIBELLES)[r] ?? r;
export const libelleOrigineChecklist = (o: RedChecklistOrigine, langue: Langue = "fr") =>
  (langue === "en" ? ORIGINE_CHECKLIST_EN : RED_CHECKLIST_ORIGINE_LIBELLES)[o] ?? o;
export const libelleStatutChecklist = (s: RedChecklistStatut, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_CHECKLIST_EN : RED_CHECKLIST_STATUT_LIBELLES)[s] ?? s;
export const libelleStatutVersionChecklist = (
  s: RedChecklistStatutVersion,
  langue: Langue = "fr",
) =>
  (langue === "en" ? STATUT_VERSION_CHECKLIST_EN : RED_CHECKLIST_STATUT_VERSION_LIBELLES)[s] ?? s;
export const libelleStatutContenuCauses = (s: StatutContenu, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_CONTENU_CAUSES_EN : RED_STATUT_CONTENU_CAUSES_LIBELLES)[s] ?? s;
export const libelleConfianceCause = (c: RedNiveauConfianceCause | null, langue: Langue = "fr") =>
  c === null
    ? langue === "en"
      ? "Confidence not indicated"
      : "Confiance non indiquée"
    : ((langue === "en" ? CONFIANCE_CAUSE_EN : RED_NIVEAU_CONFIANCE_CAUSE_LIBELLES)[c] ?? c);

export const OPTIONS_REPONSES_CHECKLIST = RED_CHECKLIST_REPONSES.map((r) => ({
  valeur: r,
  libelle: RED_CHECKLIST_REPONSE_LIBELLES[r],
}));
export const optionsReponsesChecklist = (langue: Langue = "fr") =>
  RED_CHECKLIST_REPONSES.map((r) => ({ valeur: r, libelle: libelleReponseChecklist(r, langue) }));
export const OPTIONS_CONFIANCE_CAUSE = RED_NIVEAUX_CONFIANCE_CAUSE.map((c) => ({
  valeur: c,
  libelle: RED_NIVEAU_CONFIANCE_CAUSE_LIBELLES[c],
}));
export const optionsConfianceCause = (langue: Langue = "fr") =>
  RED_NIVEAUX_CONFIANCE_CAUSE.map((c) => ({
    valeur: c,
    libelle: libelleConfianceCause(c, langue),
  }));

export const tonaliteStatutChecklist = (s: RedChecklistStatut): TonaliteStatut =>
  s === "active" ? "succes" : "neutre";
export const tonaliteStatutVersionChecklist = (s: RedChecklistStatutVersion): TonaliteStatut =>
  s === "publiee" ? "succes" : "attention";

// --- Mise en forme ----------------------------------------------------------------------------------

/** Taux en points de base du moteur (10 000 = 100 %) → « 75,00 % » ; `null` → « — ». */
export function formaterTaux(pb: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return VALEUR_ABSENTE;
  return formaterPointsDeBase(pb, "pourcentage", langue);
}

// --- Règles d'affichage (l'API reste juge) ----------------------------------------------------------

/** Cartographie retouchable : brouillon (non validée) et droit d'écriture. */
export function cartographieModifiable(
  v: Pick<RedCausesVersionVue, "statut">,
  ecrire: boolean,
): boolean {
  return ecrire && v.statut === "brouillon";
}

/** Validation proposée : brouillon, droit « valider ». */
export function validationProposee(
  v: Pick<RedCausesVersionVue, "statut">,
  valider: boolean,
): boolean {
  return valider && v.statut === "brouillon";
}

/** Des nombres non vérifiés bloquent la validation tant qu'ils ne sont pas acquittés. */
export function acquittementRequis(
  v: Pick<RedCausesVersionVue, "chiffres_non_verifies" | "chiffres_acquittes">,
): boolean {
  return v.chiffres_non_verifies && !v.chiffres_acquittes;
}

/** Corps de validation : l'acquittement n'est envoyé que s'il est coché ET requis. */
export function corpsValidationCauses(
  v: Pick<RedCausesVersionVue, "chiffres_non_verifies" | "chiffres_acquittes">,
  coche: boolean,
): { acquitte_chiffres?: boolean } {
  return acquittementRequis(v) && coche ? { acquitte_chiffres: true } : {};
}

/** Raison affichée quand « Valider » est bloqué (jamais de bouton désactivé sans raison). */
export function raisonValidationBloquee(
  v: Pick<RedCausesVersionVue, "chiffres_non_verifies" | "chiffres_acquittes">,
  coche: boolean,
  langue: Langue = "fr",
): string | null {
  if (!acquittementRequis(v) || coche) return null;
  return langue === "en"
    ? "Tick the attestation for unverified numbers to be able to approve."
    : "Cochez l'attestation des nombres non vérifiés pour pouvoir valider.";
}

export function libelleRangHistorique(
  r: {
    rang: number;
    statut_contenu: StatutContenu;
    auteur: { nom: string };
  },
  langue: Langue = "fr",
): string {
  const statut = libelleStatutContenuCauses(r.statut_contenu, langue);
  return langue === "en"
    ? `Rank ${r.rang}: ${statut}, by ${r.auteur.nom}`
    : `Rang ${r.rang} : ${statut}, par ${r.auteur.nom}`;
}

// --- Messages d'erreur ------------------------------------------------------------------------------

const MESSAGES_DIAGNOSTIC: Record<string, string> = {
  APPROBATION_REQUISE:
    "Validation impossible : la cartographie doit être validée par un autre consultant que celui qui l'a rédigée ou modifiée, ou par un associé.",
  SEPARATION_DES_TACHES:
    "Action impossible : elle revient à un autre membre que l'auteur de la version, ou à un associé.",
  CHIFFRES_NON_VERIFIES:
    "Des nombres de la proposition ne viennent pas d'un moteur de calcul : vérifiez-les puis cochez l'attestation avant de valider.",
  RED_CAUSES_VALIDEES: "Cette cartographie est validée : elle n'est plus modifiable.",
  RED_CAUSES_SANS_DIAGNOSTIC:
    "Aucune proposition possible : le dossier n'a pas encore de diagnostic (ratios ou urgence à renseigner).",
  GENERATION_IA_ECHEC:
    "L'IA n'a pas pu produire de proposition. Réessayez dans un instant ou rédigez les causes à la main.",
  RED_TROP_DE_PROPOSITIONS_CAUSES:
    "Trop de propositions demandées en peu de temps : patientez avant de réessayer.",
  RED_PLAFOND_ATTEINT: "Le plafond de volume du dossier est atteint.",
  RED_DOSSIER_CLOS: "Le dossier est clos : il est en lecture seule.",
  RED_MISSION_CLOTUREE: "La mission est clôturée : le dossier est en lecture seule.",
  RED_CHECKLIST_FIGEE: "Cette check-list est archivée : elle n'est plus modifiable.",
  RED_CHECKLIST_DEJA_ACTIVE: "Cette check-list est déjà activée dans le dossier.",
  RED_CHECKLIST_CODE_EXISTE: "Ce code de modèle existe déjà dans le cabinet.",
  RED_CHECKLIST_BROUILLON_EN_COURS:
    "Ce modèle a déjà un brouillon : publiez-le avant d'en créer un autre.",
  RED_CHECKLIST_NON_BROUILLON: "Seule une version en brouillon peut être publiée.",
  RED_CHECKLIST_SANS_VERSION_PUBLIEE:
    "Ce modèle n'a aucune version publiée : il ne peut pas encore être activé.",
};

const MESSAGES_DIAGNOSTIC_EN: Record<string, string> = {
  APPROBATION_REQUISE:
    "Approval not possible: the mapping must be approved by a consultant other than the one who wrote or edited it, or by a partner.",
  SEPARATION_DES_TACHES:
    "Action not possible: it falls to a member other than the version's author, or to a partner.",
  CHIFFRES_NON_VERIFIES:
    "Some numbers in the proposal do not come from a calculation engine: check them, then tick the attestation before approving.",
  RED_CAUSES_VALIDEES: "This mapping is approved: it can no longer be edited.",
  RED_CAUSES_SANS_DIAGNOSTIC:
    "No proposal possible: the file has no diagnostic yet (ratios or urgency to fill in).",
  GENERATION_IA_ECHEC:
    "The AI could not produce a proposal. Try again in a moment or write the causes by hand.",
  RED_TROP_DE_PROPOSITIONS_CAUSES:
    "Too many proposals requested in a short time: wait before trying again.",
  RED_PLAFOND_ATTEINT: "The file's volume limit has been reached.",
  RED_DOSSIER_CLOS: "The file is closed: it is read-only.",
  RED_MISSION_CLOTUREE: "The engagement is closed: the file is read-only.",
  RED_CHECKLIST_FIGEE: "This checklist is archived: it can no longer be edited.",
  RED_CHECKLIST_DEJA_ACTIVE: "This checklist is already activated in the file.",
  RED_CHECKLIST_CODE_EXISTE: "This template code already exists in the firm.",
  RED_CHECKLIST_BROUILLON_EN_COURS:
    "This template already has a draft: publish it before creating another.",
  RED_CHECKLIST_NON_BROUILLON: "Only a draft version can be published.",
  RED_CHECKLIST_SANS_VERSION_PUBLIEE:
    "This template has no published version: it cannot be activated yet.",
};

/** Message d'une erreur d'API de l'onglet Diagnostic ou des modèles de check-lists. */
export function messageDiagnostic(e: unknown, langue: Langue = "fr"): string {
  if (e instanceof ErreurApi) {
    const fixe = (langue === "en" ? MESSAGES_DIAGNOSTIC_EN : MESSAGES_DIAGNOSTIC)[e.code];
    if (fixe) return fixe;
  }
  return messageRedressement(e, langue);
}

/** Tous les textes fixes de ce module (relus par le test de vocabulaire). */
export function tousLesTextesDiagnostic(): string[] {
  return [
    MENTION_CHECKLIST_A_VALIDER,
    BANDEAU_CAUSES_IA,
    TEXTE_CAUSES_GABARIT,
    TEXTE_CAUSES_GABARIT_AIDE,
    TEXTE_CAUSES_LECTURE_SEULE,
    TEXTE_CAUSES_AUCUNE,
    TEXTE_PUBLICATION_CHECKLIST,
    TEXTE_CHECKLISTS_LECTURE_SEULE,
    TEXTE_MODELES_LECTURE_SEULE,
    ...Object.values(MESSAGES_DIAGNOSTIC),
    ...OPTIONS_REPONSES_CHECKLIST.map((o) => o.libelle),
    ...OPTIONS_CONFIANCE_CAUSE.map((o) => o.libelle),
  ];
}
