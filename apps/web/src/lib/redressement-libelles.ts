/** Redressement : textes fixes, libellés et tonalités (SPEC-3a §10.3 et §10.6). */
import {
  RED_CATEGORIE_FLUX_LIBELLES,
  RED_CATEGORIE_CREANCIER_LIBELLES,
  RED_CRITERE_ALERTE_LIBELLES,
  RED_DOMAINE_LIBELLES,
  RED_FAMILLE_LEVIER_LIBELLES,
  RED_LEVIER_LIBELLES,
  RED_NIVEAU_ALERTE_LIBELLES,
  RED_POSTE_LIBELLES,
  RED_REPONSE_URGENCE_LIBELLES,
  RED_SECTEUR_LIBELLES,
  RED_SECTEURS,
  RED_SENS_FLUX_LIBELLES,
  RED_STATUT_ACCORD_LIBELLES,
  RED_STATUT_ACTION_LIBELLES,
  RED_STATUT_DOSSIER_LIBELLES,
  RED_STATUT_SEUILS_LIBELLES,
  RED_STATUT_VERSION_PLAN_LIBELLES,
  RED_STATUTS_DOSSIER,
  RED_TYPE_EVENEMENT_ACTION_LIBELLES,
  RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES,
  RED_VOLET_LIBELLES,
  RED_VOYANT_LIBELLES,
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  type RedCategorieCreancier,
  type RedCritereAlerte,
  type RedNiveauAlerte,
  type RedSecteur,
  type RedSensFlux,
  type RedStatutAccord,
  type RedStatutAction,
  type RedStatutDossier,
  type RedVoyant,
  type Langue,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";

// --- Textes fixes (SPEC-3a §10.3 et §10.6 : à reprendre à l'identique) ----------------------------

export const MENTION_SCORE =
  "Indicatif. Ce score est une aide à la décision du consultant ; il ne constitue ni une procédure d'alerte au sens du droit OHADA ni un avis juridique.";
export const MENTION_SCORE_EN =
  "Indicative. This score is a decision aid for the consultant; it is neither an alert procedure under OHADA law nor legal advice.";
export const AVERTISSEMENT_SEUILS_DEFAUT =
  "Seuils par défaut du moteur (provisoires) : à remplacer par ceux de vos experts.";
export const AVERTISSEMENT_SEUILS_DEFAUT_EN =
  "Engine default thresholds (provisional): replace them with those set by your experts.";
export const TEXTE_TENSION =
  "Une semaine de tension est une semaine où le solde projeté passe sous le seuil que vous avez fixé. Ce n'est pas une qualification juridique de la situation de l'entreprise.";
export const TEXTE_TENSION_EN =
  "A tight week is a week in which the projected balance falls below the threshold you set. It is not a legal characterization of the company's situation.";
export const BANDEAU_CONFIDENTIALITE =
  "Les conditions négociées sont confidentielles : elles ne sont pas reprises dans le journal d'audit.";
export const BANDEAU_CONFIDENTIALITE_EN =
  "Negotiated terms are confidential: they are not copied into the audit log.";
export const TEXTE_LEVIERS =
  "Ordre de grandeur calculé par le moteur à partir du dernier état accepté. Ce n'est pas une recommandation : les effets ne se cumulent pas mécaniquement.";
export const TEXTE_LEVIERS_EN =
  "Order of magnitude computed by the engine from the latest accepted statement. This is not a recommendation: effects do not simply add up.";
export const TEXTE_ANALYSES_INDICATIVES =
  "Les comptes du client ne sont pas certifiés ou leur fiabilité est faible : les analyses sont indicatives.";
export const TEXTE_ANALYSES_INDICATIVES_EN =
  "The client's accounts are not audited or their reliability is low: the analyses are indicative.";
export const AVERTISSEMENT_CORRESPONDANCE =
  "Références indicatives, à confirmer par un expert-comptable ; les postes sans référence sont à renseigner à la main.";
export const AVERTISSEMENT_CORRESPONDANCE_EN =
  "Indicative references, to be confirmed by an accountant; items without a reference must be filled in by hand.";
export const TEXTE_URGENCE_INTRO =
  "Questionnaire d'urgence : 15 questions, environ 15 minutes, à remplir avec le dirigeant. Répondre « Oui » signale un point plus grave.";
export const TEXTE_URGENCE_INTRO_EN =
  'Urgency questionnaire: 15 questions, about 15 minutes, to be completed with the company head. Answering "Yes" flags a more serious point.';
export const TEXTE_PUBLICATION_SEUILS =
  "La publication revient à un expert métier ou à un associé autre que l'auteur de la version.";
export const TEXTE_PUBLICATION_SEUILS_EN =
  "Publication is reserved for a subject-matter expert or a partner other than the version's author.";
export const TEXTE_VALIDATION_PLAN =
  "La validation revient à un autre membre que l'auteur de la version, ou à un associé.";
export const TEXTE_VALIDATION_PLAN_EN =
  "Approval is reserved for a member other than the version's author, or a partner.";
export const TEXTE_SEUILS_AUCUNE_VERSION =
  "Aucune version publiée : les valeurs par défaut du moteur s'appliquent (provisoires).";
export const TEXTE_SEUILS_AUCUNE_VERSION_EN =
  "No published version: the engine default values apply (provisional).";
export const TEXTE_PLAN_MODIFIE = "Le plan a changé depuis la version validée.";
export const TEXTE_PLAN_MODIFIE_EN = "The plan has changed since the approved version.";
/** Le besoin de financement est une projection : réalisé constaté des semaines écoulées, prévu ensuite. */
export const LIBELLE_BESOIN_FINANCEMENT = "Besoin de financement prévu";
export const LIBELLE_BESOIN_FINANCEMENT_EN = "Projected funding need";
export const TEXTE_BESOIN_FINANCEMENT =
  "Projeté sur la base du réalisé constaté et du prévu : montant qui ramènerait le solde le plus bas de la fenêtre au seuil de tension.";
export const TEXTE_BESOIN_FINANCEMENT_EN =
  "Projected from actuals and forecast: the amount that would bring the lowest balance in the window back to the tension threshold.";
export const TEXTE_ETATS_ABSENTS =
  "Aucun état financier accepté pour ce client. Importez un état dans le dossier client et faites-le accepter.";
export const TEXTE_ETATS_ABSENTS_EN =
  "No accepted financial statement for this client. Import a statement in the client file and have it accepted.";

// --- Libellés anglais (le français reste dans `@missionpilot/shared`) -----------------------------

const SECTEUR_EN: Record<RedSecteur, string> = {
  general: "General",
  industrie: "Industry",
  commerce: "Trade",
  services: "Services",
  btp: "Construction",
  agriculture: "Agriculture and agribusiness",
};
const STATUT_DOSSIER_EN: Record<RedStatutDossier, string> = {
  ouvert: "Open",
  diagnostic: "Diagnostic",
  plan_valide: "Plan approved",
  mise_en_oeuvre: "Implementation",
  clos: "Closed",
};
const VOYANT_EN: Record<RedVoyant, string> = {
  vert: "Under control",
  orange: "Watch",
  rouge: "Critical",
  non_evalue: "Not assessed",
};
const NIVEAU_ALERTE_EN: Record<RedNiveauAlerte, string> = {
  insuffisant: "Insufficient data",
  faible: "Low",
  modere: "Moderate",
  eleve: "High",
  critique: "Critical",
};
const DOMAINE_EN: Record<keyof typeof RED_DOMAINE_LIBELLES, string> = {
  tresorerie: "Cash and payments",
  activite: "Commercial activity",
  exploitation: "Operations",
  social: "Social and human resources",
  financement: "Financing and governance",
};
const REPONSE_EN: Record<keyof typeof RED_REPONSE_URGENCE_LIBELLES, string> = {
  non: "No",
  partiellement: "Partially",
  oui: "Yes",
  inconnu: "I don't know",
};
const STATUT_ACTION_EN: Record<RedStatutAction, string> = {
  a_faire: "To do",
  en_cours: "In progress",
  bloquee: "Blocked",
  terminee: "Done",
  abandonnee: "Dropped",
};
const VOLET_EN: Record<keyof typeof RED_VOLET_LIBELLES, string> = {
  quick_win: "Quick wins (3 to 6 months)",
  restructuration: "Restructuring and upgrade (6 to 24 months)",
};
const STATUT_ACCORD_EN: Record<RedStatutAccord, string> = {
  respecte: "On track",
  en_retard: "Overdue",
  solde: "Settled",
  rompu: "Broken",
};
const CATEGORIE_CREANCIER_EN: Record<RedCategorieCreancier, string> = {
  fournisseur: "Supplier",
  banque: "Bank",
  fiscal: "Tax authority",
  social: "Social security body",
  bailleur: "Landlord",
  autre: "Other",
};
const TYPE_EVENEMENT_EN: Record<keyof typeof RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES, string> = {
  ouverture: "Opening",
  proposition: "Company proposal",
  contre_proposition: "Creditor counter-proposal",
  accord: "Agreement",
  rupture: "Agreement broken",
  paiement: "Payment",
  annulation_paiement: "Payment cancelled",
  note: "Note",
};
const TYPE_EVENEMENT_ACTION_EN: Record<keyof typeof RED_TYPE_EVENEMENT_ACTION_LIBELLES, string> = {
  creation: "Creation",
  statut: "Status change",
  modification: "Edit",
  commentaire: "Comment",
};
const STATUT_VERSION_PLAN_EN: Record<keyof typeof RED_STATUT_VERSION_PLAN_LIBELLES, string> = {
  brouillon: "Draft",
  valide: "Approved",
};
const STATUT_SEUILS_EN: Record<keyof typeof RED_STATUT_SEUILS_LIBELLES, string> = {
  brouillon: "Draft",
  publiee: "Published",
};
const SENS_FLUX_EN: Record<RedSensFlux, string> = {
  encaissement: "Receipt",
  decaissement: "Disbursement",
};
const POSTE_EN: Record<string, string> = {
  stocks: "Inventory",
  creances_clients: "Trade receivables",
  autres_creances: "Other receivables",
  tresorerie_actif: "Cash (asset)",
  capital: "Share capital",
  capitaux_propres: "Equity",
  dettes_financieres: "Financial debt",
  dettes_fournisseurs: "Trade payables",
  dettes_court_terme: "Short-term debt",
  chiffre_affaires: "Revenue",
  cout_ventes: "Cost of sales",
  resultat_exploitation: "Operating income",
  charges_financieres: "Financial expenses",
  resultat_net: "Net income",
};
const LEVIER_EN: Record<keyof typeof RED_LEVIER_LIBELLES, string> = {
  reduction_delai_clients: "Shorten client payment terms",
  reduction_stocks: "Reduce inventory",
  allongement_delai_fournisseurs: "Extend supplier payment terms",
  reduction_charges_fixes: "Reduce fixed costs",
  hausse_prix: "Raise prices",
  cession_actif: "Sell an asset",
};
const FAMILLE_LEVIER_EN: Record<keyof typeof RED_FAMILLE_LEVIER_LIBELLES, string> = {
  bfr: "Working capital",
  couts_fixes: "Fixed costs",
  prix: "Pricing",
  cessions: "Disposals",
};
const CRITERE_EN: Record<RedCritereAlerte, string> = {
  liquidite_generale: "Current ratio",
  liquidite_immediate: "Cash ratio",
  autonomie_financiere: "Financial autonomy",
  endettement: "Debt level",
  couverture_charges_financieres: "Interest coverage",
  marge_nette: "Net margin",
  bfr_jours: "Working capital in days of revenue",
  croissance_ca: "Revenue growth",
  variation_marge_brute: "Change in gross margin",
  rejets_bancaires_12m: "Bank rejections over 12 months",
  retards_fournisseurs_90j: "Suppliers paid more than 90 days late",
  arrieres_fiscaux_sociaux: "Tax or social contribution arrears",
};
const CATEGORIE_FLUX_EN: Record<string, string> = {
  clients: "Clients",
  autres_encaissements: "Other receipts",
  financement: "Financing",
  cessions: "Disposals",
  fournisseurs: "Suppliers",
  salaires: "Salaries",
  fiscal_social: "Taxes and social charges",
  loyers_charges: "Rent and charges",
  service_dette: "Debt service",
  investissements: "Capital expenditure",
  autres_decaissements: "Other disbursements",
};

// --- Libellés ---------------------------------------------------------------------------------------

const choix = <T extends string>(
  fr: Record<T, string>,
  en: Record<T, string>,
  v: T,
  langue: Langue,
): string => (langue === "en" ? en[v] : fr[v]) ?? v;

export const libelleSecteur = (s: RedSecteur, langue: Langue = "fr") =>
  choix(RED_SECTEUR_LIBELLES, SECTEUR_EN, s, langue);
export const libelleStatutDossier = (s: RedStatutDossier, langue: Langue = "fr") =>
  choix(RED_STATUT_DOSSIER_LIBELLES, STATUT_DOSSIER_EN, s, langue);
export const libelleVoyant = (v: RedVoyant, langue: Langue = "fr") =>
  choix(RED_VOYANT_LIBELLES, VOYANT_EN, v, langue);
export const libelleNiveauAlerte = (n: RedNiveauAlerte, langue: Langue = "fr") =>
  choix(RED_NIVEAU_ALERTE_LIBELLES, NIVEAU_ALERTE_EN, n, langue);
export const libelleDomaine = (d: keyof typeof RED_DOMAINE_LIBELLES, langue: Langue = "fr") =>
  choix(RED_DOMAINE_LIBELLES, DOMAINE_EN, d, langue);
export const libelleReponse = (
  r: keyof typeof RED_REPONSE_URGENCE_LIBELLES,
  langue: Langue = "fr",
) => choix(RED_REPONSE_URGENCE_LIBELLES, REPONSE_EN, r, langue);
export const libelleStatutAction = (s: RedStatutAction, langue: Langue = "fr") =>
  choix(RED_STATUT_ACTION_LIBELLES, STATUT_ACTION_EN, s, langue);
export const libelleVolet = (v: keyof typeof RED_VOLET_LIBELLES, langue: Langue = "fr") =>
  choix(RED_VOLET_LIBELLES, VOLET_EN, v, langue);
export const libelleStatutAccord = (s: RedStatutAccord, langue: Langue = "fr") =>
  choix(RED_STATUT_ACCORD_LIBELLES, STATUT_ACCORD_EN, s, langue);
export const libelleCategorieCreancier = (c: RedCategorieCreancier, langue: Langue = "fr") =>
  choix(RED_CATEGORIE_CREANCIER_LIBELLES, CATEGORIE_CREANCIER_EN, c, langue);
export const libelleTypeEvenement = (
  t: keyof typeof RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES,
  langue: Langue = "fr",
) => choix(RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES, TYPE_EVENEMENT_EN, t, langue);
export const libelleTypeEvenementAction = (
  t: keyof typeof RED_TYPE_EVENEMENT_ACTION_LIBELLES,
  langue: Langue = "fr",
) => choix(RED_TYPE_EVENEMENT_ACTION_LIBELLES, TYPE_EVENEMENT_ACTION_EN, t, langue);
export const libelleStatutVersionPlan = (
  s: keyof typeof RED_STATUT_VERSION_PLAN_LIBELLES,
  langue: Langue = "fr",
) => choix(RED_STATUT_VERSION_PLAN_LIBELLES, STATUT_VERSION_PLAN_EN, s, langue);
export const libelleStatutSeuils = (
  s: keyof typeof RED_STATUT_SEUILS_LIBELLES,
  langue: Langue = "fr",
) => choix(RED_STATUT_SEUILS_LIBELLES, STATUT_SEUILS_EN, s, langue);

/**
 * Statut affiché d'une version de seuils : « Brouillon », « En vigueur » (publiée la plus
 * récente) ou « Remplacée » (publiée, mais une version publiée plus récente existe).
 */
export function libelleEtatVersionSeuils(
  v: {
    statut: keyof typeof RED_STATUT_SEUILS_LIBELLES;
    remplacee?: boolean;
  },
  langue: Langue = "fr",
): string {
  if (v.statut === "brouillon") return libelleStatutSeuils("brouillon", langue);
  if (langue === "en") return v.remplacee === true ? "Superseded" : "In force";
  return v.remplacee === true ? "Remplacée" : "En vigueur";
}

export function tonaliteEtatVersionSeuils(v: {
  statut: keyof typeof RED_STATUT_SEUILS_LIBELLES;
  remplacee?: boolean;
}): TonaliteStatut {
  if (v.statut === "brouillon") return "attention";
  return v.remplacee === true ? "neutre" : "succes";
}
export const libelleSensFlux = (s: RedSensFlux, langue: Langue = "fr") =>
  choix(RED_SENS_FLUX_LIBELLES, SENS_FLUX_EN, s, langue);
export const libellePoste = (p: string, langue: Langue = "fr") =>
  (langue === "en" ? POSTE_EN : (RED_POSTE_LIBELLES as Record<string, string>))[p] ?? p;
export const libelleLevier = (c: keyof typeof RED_LEVIER_LIBELLES, langue: Langue = "fr") =>
  choix(RED_LEVIER_LIBELLES, LEVIER_EN, c, langue);
export const libelleFamilleLevier = (
  f: keyof typeof RED_FAMILLE_LEVIER_LIBELLES,
  langue: Langue = "fr",
) => choix(RED_FAMILLE_LEVIER_LIBELLES, FAMILLE_LEVIER_EN, f, langue);
export const libelleCritere = (c: RedCritereAlerte, langue: Langue = "fr") =>
  choix(RED_CRITERE_ALERTE_LIBELLES, CRITERE_EN, c, langue);

/** Libellé d'une catégorie de flux (le sens est porté par la ligne). */
export const libelleCategorieFlux = (categorie: string, langue: Langue = "fr") =>
  (langue === "en" ? CATEGORIE_FLUX_EN : (RED_CATEGORIE_FLUX_LIBELLES as Record<string, string>))[
    categorie
  ] ?? categorie;

/** Catégories proposées pour un sens, avec leurs libellés. */
export function optionsCategories(
  sens: RedSensFlux,
  langue: Langue = "fr",
): { valeur: string; libelle: string }[] {
  const liste: readonly string[] =
    sens === "encaissement" ? RED_CATEGORIES_ENCAISSEMENT : RED_CATEGORIES_DECAISSEMENT;
  return liste.map((c) => ({ valeur: c, libelle: libelleCategorieFlux(c, langue) }));
}

export const RED_SENS_OPTIONS = (Object.keys(RED_SENS_FLUX_LIBELLES) as RedSensFlux[]).map((s) => ({
  valeur: s,
  libelle: RED_SENS_FLUX_LIBELLES[s],
}));
/** Options du sens d'un flux dans la langue demandée. */
export const optionsSensFlux = (langue: Langue = "fr") =>
  (Object.keys(RED_SENS_FLUX_LIBELLES) as RedSensFlux[]).map((s) => ({
    valeur: s,
    libelle: libelleSensFlux(s, langue),
  }));

/** Libellé d'un secteur par défaut « Général » pour une valeur inconnue de cette version du web. */
export const OPTIONS_SECTEURS = RED_SECTEURS.map((s) => ({
  valeur: s,
  libelle: RED_SECTEUR_LIBELLES[s],
}));
export const optionsSecteurs = (langue: Langue = "fr") =>
  RED_SECTEURS.map((s) => ({ valeur: s, libelle: libelleSecteur(s, langue) }));
export const OPTIONS_STATUTS_DOSSIER = RED_STATUTS_DOSSIER.map((s) => ({
  valeur: s,
  libelle: RED_STATUT_DOSSIER_LIBELLES[s],
}));
export const optionsStatutsDossier = (langue: Langue = "fr") =>
  RED_STATUTS_DOSSIER.map((s) => ({ valeur: s, libelle: libelleStatutDossier(s, langue) }));

// --- Tonalités (le texte accompagne toujours la couleur et l'icône) -------------------------------

export function tonaliteVoyant(v: RedVoyant): TonaliteStatut {
  if (v === "vert") return "succes";
  if (v === "orange") return "attention";
  if (v === "rouge") return "danger";
  return "neutre";
}

export function tonaliteNiveauAlerte(n: RedNiveauAlerte): TonaliteStatut {
  if (n === "faible") return "succes";
  if (n === "modere") return "attention";
  if (n === "eleve" || n === "critique") return "danger";
  return "neutre";
}

export function tonaliteStatutDossier(s: RedStatutDossier): TonaliteStatut {
  return s === "plan_valide" || s === "mise_en_oeuvre" ? "succes" : "neutre";
}

export function tonaliteStatutAccord(s: RedStatutAccord): TonaliteStatut {
  if (s === "respecte") return "succes";
  if (s === "en_retard" || s === "rompu") return "danger";
  return "neutre";
}

export function tonaliteStatutAction(s: RedStatutAction): TonaliteStatut {
  if (s === "terminee") return "succes";
  if (s === "bloquee") return "danger";
  if (s === "en_cours") return "attention";
  return "neutre";
}
