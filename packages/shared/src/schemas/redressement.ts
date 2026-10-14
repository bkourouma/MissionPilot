import { z } from "zod";
import {
  type Devise,
  auMoinsUnChamp,
  dateIsoBorneeSchema,
  MESSAGE_CORPS_VIDE,
  texte,
  texteOptionnel,
} from "./commun";

/*
 * Service #5 « Redressement » (lot 3a, vague 4, RED-01, 02, 05, 06, 07, 10, 11, 12, 14) :
 * contrat des routes /api/redressement/**, /api/missions/:id/redressement et des types de
 * réponse. SPEC-3a-redressement.md, §7.
 *
 * - Tous les chiffres (ratios, voyants, scores, soldes, écarts, point mort, échéanciers,
 *   situations, avancement, impacts) sortent de `packages/engines/src/redressement` ; ces
 *   schémas ne portent que des saisies et des libellés.
 * - `packages/shared` n'importe pas `packages/engines` : les listes d'énumérations sont
 *   DUPLIQUÉES (comme `SECTIONS_ETAT_FINANCIER_DOSSIER`) ; un test d'API vérifie la parité
 *   moteur ↔ schémas (`redressement-parite.test.ts`).
 * - Aucune qualification juridique dans les libellés : un voyant ou un score est un constat
 *   de saisie, jamais une situation de droit.
 */

const uuid = z.string().uuid();

/* ----- Constantes, libellés et plafonds ----- */

export const RED_MONTANT_MAX = 10_000_000_000_000;

export const RED_SECTEURS = [
  "general",
  "industrie",
  "commerce",
  "services",
  "btp",
  "agriculture",
] as const;
export type RedSecteur = (typeof RED_SECTEURS)[number];
export const RED_SECTEUR_LIBELLES: Record<RedSecteur, string> = {
  general: "Général",
  industrie: "Industrie",
  commerce: "Commerce",
  services: "Services",
  btp: "BTP",
  agriculture: "Agriculture et agro-industrie",
};

export const RED_STATUTS_DOSSIER = [
  "ouvert",
  "diagnostic",
  "plan_valide",
  "mise_en_oeuvre",
  "clos",
] as const;
export type RedStatutDossier = (typeof RED_STATUTS_DOSSIER)[number];
export const RED_STATUT_DOSSIER_LIBELLES: Record<RedStatutDossier, string> = {
  ouvert: "Ouvert",
  diagnostic: "Diagnostic",
  plan_valide: "Plan validé",
  mise_en_oeuvre: "Mise en œuvre",
  clos: "Clos",
};

export const RED_POSTES = [
  "stocks",
  "creances_clients",
  "autres_creances",
  "tresorerie_actif",
  "capital",
  "capitaux_propres",
  "dettes_financieres",
  "dettes_fournisseurs",
  "dettes_court_terme",
  "chiffre_affaires",
  "cout_ventes",
  "resultat_exploitation",
  "charges_financieres",
  "resultat_net",
] as const;
export type RedPoste = (typeof RED_POSTES)[number];
export const RED_POSTE_LIBELLES: Record<RedPoste, string> = {
  stocks: "Stocks",
  creances_clients: "Créances clients",
  autres_creances: "Autres créances",
  tresorerie_actif: "Trésorerie (actif)",
  capital: "Capital",
  capitaux_propres: "Capitaux propres",
  dettes_financieres: "Dettes financières",
  dettes_fournisseurs: "Dettes fournisseurs",
  dettes_court_terme: "Dettes à court terme",
  chiffre_affaires: "Chiffre d'affaires",
  cout_ventes: "Coût des ventes",
  resultat_exploitation: "Résultat d'exploitation",
  charges_financieres: "Charges financières",
  resultat_net: "Résultat net",
};

export const RED_CLES_RATIO = [
  "liquidite_generale",
  "liquidite_reduite",
  "liquidite_immediate",
  "autonomie_financiere",
  "solvabilite_generale",
  "endettement",
  "marge_brute",
  "marge_nette",
  "couverture_charges_financieres",
  "bfr_jours",
] as const;
export type RedCleRatio = (typeof RED_CLES_RATIO)[number];
export const RED_RATIO_LIBELLES: Record<RedCleRatio, string> = {
  liquidite_generale: "Liquidité générale",
  liquidite_reduite: "Liquidité réduite",
  liquidite_immediate: "Liquidité immédiate",
  autonomie_financiere: "Autonomie financière",
  solvabilite_generale: "Solvabilité générale",
  endettement: "Endettement",
  marge_brute: "Marge brute",
  marge_nette: "Marge nette",
  couverture_charges_financieres: "Couverture des charges financières",
  bfr_jours: "BFR en jours de chiffre d'affaires",
};
/** Unité de la valeur d'un ratio : points de base (10 000 = 1) ou jours (BFR). */
export type RedUniteRatio = "pb" | "jours";
export const RED_RATIO_UNITES: Record<RedCleRatio, RedUniteRatio> = {
  liquidite_generale: "pb",
  liquidite_reduite: "pb",
  liquidite_immediate: "pb",
  autonomie_financiere: "pb",
  solvabilite_generale: "pb",
  endettement: "pb",
  marge_brute: "pb",
  marge_nette: "pb",
  couverture_charges_financieres: "pb",
  bfr_jours: "jours",
};

export const RED_STATUTS_RATIO = [
  "calcule",
  "sans_objet",
  "non_calculable",
  "non_significatif",
] as const;
export type RedStatutRatio = (typeof RED_STATUTS_RATIO)[number];
export const RED_STATUT_RATIO_LIBELLES: Record<RedStatutRatio, string> = {
  calcule: "Calculé",
  sans_objet: "Sans objet",
  non_calculable: "Non calculable",
  non_significatif: "Non significatif",
};
export const RED_RAISONS_RATIO = [
  "postes_manquants",
  "totaux_absents",
  "denominateur_non_positif",
  "sans_dette",
  "sans_charges_financieres",
] as const;
export type RedRaisonRatio = (typeof RED_RAISONS_RATIO)[number];
export const RED_RAISON_RATIO_LIBELLES: Record<RedRaisonRatio, string> = {
  postes_manquants: "Postes à renseigner",
  totaux_absents: "Totaux du bilan absents",
  denominateur_non_positif: "Dénominateur nul ou négatif",
  sans_dette: "Aucune dette",
  sans_charges_financieres: "Aucune charge financière",
};

export const RED_DOMAINES = [
  "tresorerie",
  "activite",
  "exploitation",
  "social",
  "financement",
] as const;
export type RedDomaine = (typeof RED_DOMAINES)[number];
export const RED_DOMAINE_LIBELLES: Record<RedDomaine, string> = {
  tresorerie: "Trésorerie et paiements",
  activite: "Activité commerciale",
  exploitation: "Exploitation",
  social: "Social et ressources humaines",
  financement: "Financement et gouvernance",
};

export const RED_REPONSES_URGENCE = ["non", "partiellement", "oui", "inconnu"] as const;
export type RedReponseUrgence = (typeof RED_REPONSES_URGENCE)[number];
export const RED_REPONSE_URGENCE_LIBELLES: Record<RedReponseUrgence, string> = {
  non: "Non",
  partiellement: "Partiellement",
  oui: "Oui",
  inconnu: "Je ne sais pas",
};

export const RED_VOYANTS = ["vert", "orange", "rouge", "non_evalue"] as const;
export type RedVoyant = (typeof RED_VOYANTS)[number];
export const RED_VOYANT_LIBELLES: Record<RedVoyant, string> = {
  vert: "Maîtrisé",
  orange: "Vigilance",
  rouge: "Critique",
  non_evalue: "Non évalué",
};

export const RED_CRITERES_ALERTE = [
  "liquidite_generale",
  "liquidite_immediate",
  "autonomie_financiere",
  "endettement",
  "couverture_charges_financieres",
  "marge_nette",
  "bfr_jours",
  "croissance_ca",
  "variation_marge_brute",
  "rejets_bancaires_12m",
  "retards_fournisseurs_90j",
  "arrieres_fiscaux_sociaux",
] as const;
export type RedCritereAlerte = (typeof RED_CRITERES_ALERTE)[number];
export const RED_CRITERE_ALERTE_LIBELLES: Record<RedCritereAlerte, string> = {
  liquidite_generale: "Liquidité générale",
  liquidite_immediate: "Liquidité immédiate",
  autonomie_financiere: "Autonomie financière",
  endettement: "Endettement",
  couverture_charges_financieres: "Couverture des charges financières",
  marge_nette: "Marge nette",
  bfr_jours: "BFR en jours de chiffre d'affaires",
  croissance_ca: "Croissance du chiffre d'affaires",
  variation_marge_brute: "Variation de la marge brute",
  rejets_bancaires_12m: "Rejets bancaires sur 12 mois",
  retards_fournisseurs_90j: "Fournisseurs payés avec plus de 90 jours de retard",
  arrieres_fiscaux_sociaux: "Arriérés d'impôts ou de cotisations",
};
/** Unité de la valeur et des seuils d'un critère. */
export type RedUniteCritere = "pb" | "jours" | "nombre" | "oui_non";
export const RED_CRITERE_ALERTE_UNITES: Record<RedCritereAlerte, RedUniteCritere> = {
  liquidite_generale: "pb",
  liquidite_immediate: "pb",
  autonomie_financiere: "pb",
  endettement: "pb",
  couverture_charges_financieres: "pb",
  marge_nette: "pb",
  bfr_jours: "jours",
  croissance_ca: "pb",
  variation_marge_brute: "pb",
  rejets_bancaires_12m: "nombre",
  retards_fournisseurs_90j: "nombre",
  arrieres_fiscaux_sociaux: "oui_non",
};
/** Intrinsèque au critère (comme dans le moteur) : les experts fixent les seuils, pas le sens. */
export type RedSensCritere = "bas_pire" | "haut_pire";
export const RED_CRITERE_ALERTE_SENS: Record<RedCritereAlerte, RedSensCritere> = {
  liquidite_generale: "bas_pire",
  liquidite_immediate: "bas_pire",
  autonomie_financiere: "bas_pire",
  endettement: "haut_pire",
  couverture_charges_financieres: "bas_pire",
  marge_nette: "bas_pire",
  bfr_jours: "haut_pire",
  croissance_ca: "bas_pire",
  variation_marge_brute: "bas_pire",
  rejets_bancaires_12m: "haut_pire",
  retards_fournisseurs_90j: "haut_pire",
  arrieres_fiscaux_sociaux: "haut_pire",
};

export const RED_NIVEAUX_ALERTE = ["insuffisant", "faible", "modere", "eleve", "critique"] as const;
export type RedNiveauAlerte = (typeof RED_NIVEAUX_ALERTE)[number];
export const RED_NIVEAU_ALERTE_LIBELLES: Record<RedNiveauAlerte, string> = {
  insuffisant: "Données insuffisantes",
  faible: "Faible",
  modere: "Modéré",
  eleve: "Élevé",
  critique: "Critique",
};

export const RED_STATUTS_SEUILS = ["brouillon", "publiee"] as const;
export type RedStatutSeuils = (typeof RED_STATUTS_SEUILS)[number];
export const RED_STATUT_SEUILS_LIBELLES: Record<RedStatutSeuils, string> = {
  brouillon: "Brouillon",
  publiee: "Publiée",
};
export const RED_SOURCES_SEUILS = ["cabinet", "defaut_moteur"] as const;
export type RedSourceSeuils = (typeof RED_SOURCES_SEUILS)[number];
export const RED_SOURCE_SEUILS_LIBELLES: Record<RedSourceSeuils, string> = {
  cabinet: "Seuils du cabinet",
  defaut_moteur: "Seuils par défaut (provisoires)",
};

export const RED_CATEGORIES_ENCAISSEMENT = [
  "clients",
  "autres_encaissements",
  "financement",
  "cessions",
] as const;
export const RED_CATEGORIES_DECAISSEMENT = [
  "fournisseurs",
  "salaires",
  "fiscal_social",
  "loyers_charges",
  "service_dette",
  "investissements",
  "autres_decaissements",
] as const;
export type RedCategorieEncaissement = (typeof RED_CATEGORIES_ENCAISSEMENT)[number];
export type RedCategorieDecaissement = (typeof RED_CATEGORIES_DECAISSEMENT)[number];
export const RED_SENS_FLUX = ["encaissement", "decaissement"] as const;
export type RedSensFlux = (typeof RED_SENS_FLUX)[number];
export const RED_SENS_FLUX_LIBELLES: Record<RedSensFlux, string> = {
  encaissement: "Encaissement",
  decaissement: "Décaissement",
};
export const RED_CATEGORIE_ENCAISSEMENT_LIBELLES: Record<RedCategorieEncaissement, string> = {
  clients: "Clients",
  autres_encaissements: "Autres encaissements",
  financement: "Financement",
  cessions: "Cessions",
};
export const RED_CATEGORIE_DECAISSEMENT_LIBELLES: Record<RedCategorieDecaissement, string> = {
  fournisseurs: "Fournisseurs",
  salaires: "Salaires",
  fiscal_social: "Impôts, taxes et charges sociales",
  loyers_charges: "Loyers et charges",
  service_dette: "Service de la dette",
  investissements: "Investissements",
  autres_decaissements: "Autres décaissements",
};
/** Libellé d'une catégorie de flux, quel que soit le sens. */
export const RED_CATEGORIE_FLUX_LIBELLES: Record<
  RedCategorieEncaissement | RedCategorieDecaissement,
  string
> = { ...RED_CATEGORIE_ENCAISSEMENT_LIBELLES, ...RED_CATEGORIE_DECAISSEMENT_LIBELLES };

export const RED_CATEGORIES_CREANCIER = [
  "fournisseur",
  "banque",
  "fiscal",
  "social",
  "bailleur",
  "autre",
] as const;
export type RedCategorieCreancier = (typeof RED_CATEGORIES_CREANCIER)[number];
export const RED_CATEGORIE_CREANCIER_LIBELLES: Record<RedCategorieCreancier, string> = {
  fournisseur: "Fournisseur",
  banque: "Banque",
  fiscal: "Administration fiscale",
  social: "Organisme social",
  bailleur: "Bailleur",
  autre: "Autre",
};

export const RED_TYPES_EVENEMENT_NEGOCIATION = [
  "ouverture",
  "proposition",
  "contre_proposition",
  "accord",
  "rupture",
  "paiement",
  "annulation_paiement",
  "note",
] as const;
export type RedTypeEvenementNegociation = (typeof RED_TYPES_EVENEMENT_NEGOCIATION)[number];
export const RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES: Record<RedTypeEvenementNegociation, string> =
  {
    ouverture: "Ouverture",
    proposition: "Proposition de l'entreprise",
    contre_proposition: "Contre-proposition du créancier",
    accord: "Accord",
    rupture: "Rupture de l'accord",
    paiement: "Paiement",
    annulation_paiement: "Annulation d'un paiement",
    note: "Note",
  };

export const RED_STATUTS_ACCORD = ["respecte", "en_retard", "solde", "rompu"] as const;
export type RedStatutAccord = (typeof RED_STATUTS_ACCORD)[number];
export const RED_STATUT_ACCORD_LIBELLES: Record<RedStatutAccord, string> = {
  respecte: "Respecté",
  en_retard: "En retard",
  solde: "Soldé",
  rompu: "Rompu",
};

export const RED_VOLETS = ["quick_win", "restructuration"] as const;
export type RedVolet = (typeof RED_VOLETS)[number];
export const RED_VOLET_LIBELLES: Record<RedVolet, string> = {
  quick_win: "Quick wins (3 à 6 mois)",
  restructuration: "Restructuration et mise à niveau (6 à 24 mois)",
};

export const RED_STATUTS_ACTION = [
  "a_faire",
  "en_cours",
  "bloquee",
  "terminee",
  "abandonnee",
] as const;
export type RedStatutAction = (typeof RED_STATUTS_ACTION)[number];
export const RED_STATUT_ACTION_LIBELLES: Record<RedStatutAction, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  bloquee: "Bloquée",
  terminee: "Terminée",
  abandonnee: "Abandonnée",
};
/** Colonnes du kanban : les quatre premiers statuts (les abandonnées sont à part). */
export const RED_COLONNES_KANBAN = ["a_faire", "en_cours", "bloquee", "terminee"] as const;
export type RedColonneKanban = (typeof RED_COLONNES_KANBAN)[number];

export const RED_TYPES_EVENEMENT_ACTION = [
  "creation",
  "statut",
  "modification",
  "commentaire",
] as const;
export type RedTypeEvenementAction = (typeof RED_TYPES_EVENEMENT_ACTION)[number];
export const RED_TYPE_EVENEMENT_ACTION_LIBELLES: Record<RedTypeEvenementAction, string> = {
  creation: "Création",
  statut: "Changement de statut",
  modification: "Modification",
  commentaire: "Commentaire",
};

export const RED_STATUTS_VERSION_PLAN = ["brouillon", "valide"] as const;
export type RedStatutVersionPlan = (typeof RED_STATUTS_VERSION_PLAN)[number];
export const RED_STATUT_VERSION_PLAN_LIBELLES: Record<RedStatutVersionPlan, string> = {
  brouillon: "Brouillon",
  valide: "Validée",
};

export const RED_CODES_LEVIER = [
  "reduction_delai_clients",
  "reduction_stocks",
  "allongement_delai_fournisseurs",
  "reduction_charges_fixes",
  "hausse_prix",
  "cession_actif",
] as const;
export type RedCodeLevier = (typeof RED_CODES_LEVIER)[number];
export const RED_LEVIER_LIBELLES: Record<RedCodeLevier, string> = {
  reduction_delai_clients: "Réduire le délai de paiement des clients",
  reduction_stocks: "Réduire les stocks",
  allongement_delai_fournisseurs: "Allonger le délai de paiement des fournisseurs",
  reduction_charges_fixes: "Réduire les charges fixes",
  hausse_prix: "Augmenter les prix",
  cession_actif: "Céder un actif",
};
export const RED_FAMILLES_LEVIER = ["bfr", "couts_fixes", "prix", "cessions"] as const;
export type RedFamilleLevier = (typeof RED_FAMILLES_LEVIER)[number];
export const RED_FAMILLE_LEVIER_LIBELLES: Record<RedFamilleLevier, string> = {
  bfr: "BFR",
  couts_fixes: "Coûts fixes",
  prix: "Prix",
  cessions: "Cessions",
};

/* Plafonds de volume (SPEC-3a §9.5 ; PROVISOIRES, garde-fous sans source : §13). */
export const RED_CORRESPONDANCES_MAX = 100;
export const RED_URGENCES_MAX = 200;
export const RED_SCORES_MAX = 500;
export const RED_SEUILS_PAR_SECTEUR_MAX = 50;
export const RED_VERSIONS_TRESORERIE_MAX = 200;
export const RED_LIGNES_TRESORERIE_MAX = 600;
export const RED_REALISES_MAX = 1000;
export const RED_CORRECTIONS_SEMAINE_MAX = 10;
export const RED_CREANCIERS_MAX = 200;
export const RED_CREANCES_MAX = 100;
export const RED_EVENEMENTS_NEGOCIATION_MAX = 300;
export const RED_ECHEANCES_MAX = 60;
export const RED_ACTIONS_MAX = 300;
export const RED_EVENEMENTS_ACTION_MAX = 200;
export const RED_VERSIONS_PLAN_MAX = 100;
/** `limite` maximale des listes paginées (à déclarer au web : `limiteMax`). */
export const RED_LIMITE_DOSSIERS_MAX = 100;
export const RED_LIMITE_HISTORIQUE_MAX = 50;

export const RED_PLAFONDS = {
  correspondances: RED_CORRESPONDANCES_MAX,
  urgences: RED_URGENCES_MAX,
  scores: RED_SCORES_MAX,
  seuils_par_secteur: RED_SEUILS_PAR_SECTEUR_MAX,
  versions_tresorerie: RED_VERSIONS_TRESORERIE_MAX,
  lignes_tresorerie: RED_LIGNES_TRESORERIE_MAX,
  realises: RED_REALISES_MAX,
  corrections_semaine: RED_CORRECTIONS_SEMAINE_MAX,
  creanciers: RED_CREANCIERS_MAX,
  creances: RED_CREANCES_MAX,
  evenements_negociation: RED_EVENEMENTS_NEGOCIATION_MAX,
  echeances: RED_ECHEANCES_MAX,
  actions: RED_ACTIONS_MAX,
  evenements_action: RED_EVENEMENTS_ACTION_MAX,
  versions_plan: RED_VERSIONS_PLAN_MAX,
} as const;

/* ----- Briques communes des schémas ----- */

const montant = z.number().int().min(0).max(RED_MONTANT_MAX);
const montantPositif = z.number().int().min(1).max(RED_MONTANT_MAX);
const solde = z.number().int().min(-RED_MONTANT_MAX).max(RED_MONTANT_MAX);

/** Lundi : une « date de semaine » (les CHECK de la base exigent `isodow = 1`). */
const lundi = dateIsoBorneeSchema.refine(
  (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1,
  "Un lundi est attendu.",
);

const codeLigneEtat = z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/, "Code de ligne invalide.");

const listeQuery = (limiteMax: number, limiteParDefaut: number) => ({
  limite: z.coerce.number().int().min(1).max(limiteMax).default(limiteParDefaut),
  curseur: z.string().max(500).optional(),
});

/** Paramètres d'un levier : clés alphanumériques, entiers (les bornes sont celles du moteur). */
const parametresLevier = z
  .record(z.string().regex(/^[A-Za-z0-9]{1,40}$/, "Clé de paramètre invalide."), montant)
  .refine((p) => Object.keys(p).length <= 10, "Dix paramètres au plus.");

/* ----- Dossier ----- */

export const redDossierCreationSchema = z
  .object({
    intitule: texte(200),
    secteur: z.enum(RED_SECTEURS).default("general"),
  })
  .strict();

export const redDossierModificationSchema = z
  .object({
    intitule: texte(200).optional(),
    secteur: z.enum(RED_SECTEURS).optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/** `clos` exige un motif d'au moins 10 caractères (tracé, jamais journalisé). */
export const redDossierStatutSchema = z
  .object({
    statut: z.enum(["mise_en_oeuvre", "clos"]),
    motif: texteOptionnel(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.statut === "clos" && (v.motif ?? "").length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["motif"],
        message: "Un motif d'au moins 10 caractères est exigé pour clore le dossier.",
      });
    }
  });

export const redListeDossiersQuerySchema = z
  .object({
    ...listeQuery(RED_LIMITE_DOSSIERS_MAX, 30),
    statut: z.enum(RED_STATUTS_DOSSIER).optional(),
    secteur: z.enum(RED_SECTEURS).optional(),
    client_id: uuid.optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

/* ----- RED-02 : correspondance de postes ----- */

const affectationPosteSchema = z
  .object({
    codes: z.array(codeLigneEtat).max(50),
    sans_objet: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.sans_objet && v.codes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["codes"],
        message: "Un poste sans objet ne porte aucun code.",
      });
    }
    if (!v.sans_objet && v.codes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["codes"],
        message: "Un poste porte au moins un code, ou est déclaré sans objet.",
      });
    }
  });

export const redCorrespondanceCreationSchema = z
  .object({
    postes: z
      .record(z.enum(RED_POSTES), affectationPosteSchema)
      .refine((p) => Object.keys(p).length >= 1, "Au moins un poste est attendu."),
    motif: texteOptionnel(500),
  })
  .strict();

/* ----- RED-01 : urgence ----- */

export const redUrgenceCreationSchema = z
  .object({
    reponses: z
      .record(
        z.string().regex(/^[TAESF][1-3]$/, "Code de question invalide."),
        z.enum(RED_REPONSES_URGENCE),
      )
      .refine((r) => {
        const n = Object.keys(r).length;
        return n >= 1 && n <= 15;
      }, "De 1 à 15 réponses sont attendues."),
    duree_secondes: z.number().int().min(0).max(86_400).optional(),
    commentaire: texteOptionnel(2000),
  })
  .strict();

/* ----- RED-10 : seuils et score d'alerte ----- */

const seuilCritere = z
  .object({
    orange: z.number().int().safe(),
    rouge: z.number().int().safe(),
    poids: z.number().int().safe(),
  })
  .strict();

/** Forme seulement : les règles (sens, somme des poids, niveaux) sont dans `validerSeuilsAlerte`. */
export const redSeuilsSchema = z
  .object({
    criteres: z
      .object({
        liquidite_generale: seuilCritere,
        liquidite_immediate: seuilCritere,
        autonomie_financiere: seuilCritere,
        endettement: seuilCritere,
        couverture_charges_financieres: seuilCritere,
        marge_nette: seuilCritere,
        bfr_jours: seuilCritere,
        croissance_ca: seuilCritere,
        variation_marge_brute: seuilCritere,
        rejets_bancaires_12m: seuilCritere,
        retards_fournisseurs_90j: seuilCritere,
        arrieres_fiscaux_sociaux: seuilCritere,
      })
      .strict(),
    niveaux: z
      .object({
        modere: z.number().int().safe(),
        eleve: z.number().int().safe(),
        critique: z.number().int().safe(),
      })
      .strict(),
    part_minimale_evaluee_pct: z.number().int().safe(),
  })
  .strict();

export const redSeuilsCreationSchema = z
  .object({
    secteur: z.enum(RED_SECTEURS),
    seuils: redSeuilsSchema,
    motif: texteOptionnel(500),
  })
  .strict();

export const redSeuilsQuerySchema = z.object({ secteur: z.enum(RED_SECTEURS).optional() }).strict();

/** Corps de la publication d'une version de seuils : vide (l'identifiant est dans le chemin). */
export const redSeuilsPublicationSchema = z.object({}).strict();

export const redScoreCreationSchema = z
  .object({
    incidents: z
      .object({
        rejets_bancaires_12m: z.number().int().min(0).max(999).nullable().optional(),
        retards_fournisseurs_90j: z.number().int().min(0).max(999).nullable().optional(),
        arrieres_fiscaux_sociaux: z.boolean().nullable().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const redHistoriqueQuerySchema = z
  .object(listeQuery(RED_LIMITE_HISTORIQUE_MAX, 20))
  .strict();

/* ----- RED-06, RED-11 : trésorerie à 13 semaines et point mort ----- */

const ligneTresorerieSchema = z
  .object({
    semaine: z.number().int().min(1).max(13),
    sens: z.enum(RED_SENS_FLUX),
    categorie: z.string(),
    libelle: texteOptionnel(200),
    montant: montantPositif,
    creancier_id: uuid.optional(),
    echeance_id: uuid.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const liste: readonly string[] =
      v.sens === "encaissement" ? RED_CATEGORIES_ENCAISSEMENT : RED_CATEGORIES_DECAISSEMENT;
    if (!liste.includes(v.categorie)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categorie"],
        message: "Catégorie hors de la liste de ce sens.",
      });
    }
    if (v.echeance_id !== undefined && v.creancier_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creancier_id"],
        message: "Une échéance se rattache à son créancier.",
      });
    }
  });

export const redTresorerieVersionCreationSchema = z
  .object({
    date_debut: lundi,
    solde_initial: solde,
    seuil_tension: montant.default(0),
    lignes: z.array(ligneTresorerieSchema).max(RED_LIGNES_TRESORERIE_MAX),
    motif: texteOptionnel(500),
  })
  .strict();

export const redRealiseCreationSchema = z
  .object({
    semaine_debut: lundi,
    flux: z
      .object({
        encaissement: z.record(z.enum(RED_CATEGORIES_ENCAISSEMENT), montant).optional(),
        decaissement: z.record(z.enum(RED_CATEGORIES_DECAISSEMENT), montant).optional(),
      })
      .strict(),
    solde_constate: solde.nullable().optional(),
    commentaire: texteOptionnel(1000),
  })
  .strict();

export const redPointMortSchema = z
  .object({
    chiffre_affaires: montant,
    charges_variables: montant,
    charges_fixes: montant,
    periode_jours: z.number().int().min(1).max(366).optional(),
  })
  .strict();

/* ----- RED-12 : créanciers et négociations ----- */

export const redCreancierCreationSchema = z
  .object({
    nom: texte(200),
    categorie: z.enum(RED_CATEGORIES_CREANCIER),
    garanti: z.boolean().default(false),
    reference: texteOptionnel(120),
    principal: montant,
    interets: montant.default(0),
    date_arrete: dateIsoBorneeSchema,
    echeance_initiale: dateIsoBorneeSchema.optional(),
    nature: texteOptionnel(200),
  })
  .strict();

export const redCreancierModificationSchema = z
  .object({
    nom: texte(200).optional(),
    garanti: z.boolean().optional(),
    reference: texteOptionnel(120),
    actif: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const redCreanceCreationSchema = z
  .object({
    principal: montant,
    interets: montant.default(0),
    date_arrete: dateIsoBorneeSchema,
    echeance_initiale: dateIsoBorneeSchema.optional(),
    nature: texteOptionnel(200),
    commentaire: texteOptionnel(1000),
  })
  .strict();

const evenementSimple = <T extends "ouverture" | "proposition" | "contre_proposition" | "note">(
  type: T,
) =>
  z
    .object({
      type: z.literal(type),
      date_evenement: dateIsoBorneeSchema,
      montant: montant.optional(),
      conditions: texteOptionnel(2000),
    })
    .strict();

const echeancierAccordSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("regulier"),
      nombre_echeances: z.number().int().min(1).max(RED_ECHEANCES_MAX),
      date_premiere: dateIsoBorneeSchema,
      periodicite_mois: z.number().int().min(1).max(12),
    })
    .strict(),
  z
    .object({
      mode: z.literal("explicite"),
      lignes: z
        .array(z.object({ date: dateIsoBorneeSchema, montant: montantPositif }).strict())
        .min(1)
        .max(RED_ECHEANCES_MAX),
    })
    .strict(),
]);

export const redEvenementNegociationSchema = z.discriminatedUnion("type", [
  evenementSimple("ouverture"),
  evenementSimple("proposition"),
  evenementSimple("contre_proposition"),
  evenementSimple("note"),
  z
    .object({
      type: z.literal("accord"),
      date_evenement: dateIsoBorneeSchema,
      montant: montantPositif,
      conditions: texteOptionnel(2000),
      echeancier: echeancierAccordSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("paiement"),
      date_evenement: dateIsoBorneeSchema,
      montant: montantPositif,
      accord_id: uuid,
      echeance_rang: z.number().int().min(1).max(RED_ECHEANCES_MAX).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("annulation_paiement"),
      date_evenement: dateIsoBorneeSchema,
      paiement_annule_id: uuid,
    })
    .strict(),
  z
    .object({
      type: z.literal("rupture"),
      date_evenement: dateIsoBorneeSchema,
      accord_id: uuid,
      conditions: texteOptionnel(2000),
    })
    .strict(),
]);

/* ----- RED-05, RED-07, RED-14 : plan, kanban, leviers ----- */

const leviersAction = z
  .object({
    code: z.enum(RED_CODES_LEVIER),
    parametres: parametresLevier,
  })
  .strict();

export const redActionCreationSchema = z
  .object({
    titre: texte(200),
    description: texteOptionnel(2000),
    volet: z.enum(RED_VOLETS),
    domaine: z.enum(RED_DOMAINES),
    echeance: dateIsoBorneeSchema,
    responsable_id: uuid,
    levier: leviersAction.optional(),
    creer_tache: z.boolean().default(false),
  })
  .strict();

/** Mêmes champs, tous facultatifs ; `levier: null` retire le levier ; pas de `creer_tache`. */
export const redActionModificationSchema = z
  .object({
    titre: texte(200).optional(),
    description: texteOptionnel(2000),
    volet: z.enum(RED_VOLETS).optional(),
    domaine: z.enum(RED_DOMAINES).optional(),
    echeance: dateIsoBorneeSchema.optional(),
    responsable_id: uuid.optional(),
    levier: leviersAction.nullable().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const redActionDeplacementSchema = z
  .object({
    statut: z.enum(RED_STATUTS_ACTION),
    rang: z.number().int().min(0).max(100_000).optional(),
    motif: texteOptionnel(1000),
    termine_le: dateIsoBorneeSchema.optional(),
  })
  .strict();

export const redCommentaireSchema = z.object({ commentaire: texte(1000) }).strict();

export const redPlanVersionCreationSchema = z
  .object({ date_reference: dateIsoBorneeSchema.optional() })
  .strict();

export const redPlanValidationSchema = z.object({ motif: texteOptionnel(2000) }).strict();

export const redLevierSimulationSchema = z
  .object({
    code: z.enum(RED_CODES_LEVIER),
    parametres: parametresLevier,
  })
  .strict();

/* ----- Types d'entrée ----- */

export type RedDossierCreation = z.infer<typeof redDossierCreationSchema>;
export type RedDossierModification = z.infer<typeof redDossierModificationSchema>;
export type RedDossierStatutEntree = z.infer<typeof redDossierStatutSchema>;
export type RedCorrespondanceCreation = z.infer<typeof redCorrespondanceCreationSchema>;
export type RedUrgenceCreation = z.infer<typeof redUrgenceCreationSchema>;
export type RedSeuilsCreation = z.infer<typeof redSeuilsCreationSchema>;
export type RedScoreCreation = z.infer<typeof redScoreCreationSchema>;
export type RedTresorerieVersionCreation = z.infer<typeof redTresorerieVersionCreationSchema>;
export type RedRealiseCreation = z.infer<typeof redRealiseCreationSchema>;
export type RedPointMortEntree = z.infer<typeof redPointMortSchema>;
export type RedCreancierCreation = z.infer<typeof redCreancierCreationSchema>;
export type RedCreanceCreation = z.infer<typeof redCreanceCreationSchema>;
export type RedEvenementNegociation = z.infer<typeof redEvenementNegociationSchema>;
export type RedActionCreation = z.infer<typeof redActionCreationSchema>;
export type RedActionModification = z.infer<typeof redActionModificationSchema>;
export type RedActionDeplacement = z.infer<typeof redActionDeplacementSchema>;
export type RedPlanVersionCreation = z.infer<typeof redPlanVersionCreationSchema>;
export type RedLevierSimulation = z.infer<typeof redLevierSimulationSchema>;

/* ----- Types de réponse partagés (SPEC-3a §7.3) -----
 *
 * Une sortie de moteur est rendue par un MIROIR snake_case de l'interface du moteur (mêmes
 * champs, mêmes types, sans `readonly`) ; l'API le fabrique dans `redressement/vues.ts` par un
 * transformateur explicite (jamais par un parcours générique des clés de données comme les
 * codes de questions « T1 » ou les noms de postes). Les montants sont des entiers d'unités
 * mineures ; les ratios sont en points de base (BFR : jours) ; les dates sont `AAAA-MM-JJ` ou
 * des horodatages ISO.
 */

export interface RedPersonne {
  id: string;
  nom: string;
}

export interface RedAffectationPosteVue {
  codes: string[];
  sans_objet: boolean;
}
export type RedPostesVue = Partial<Record<RedPoste, RedAffectationPosteVue>>;

export interface RedCorrespondanceVue {
  version: number;
  postes: RedPostesVue;
  motif: string | null;
  cree_par: RedPersonne;
  cree_le: string;
}
/** Route 8 : `{ courante, historique, indicative }`. */
export interface RedCorrespondancesVue {
  courante: RedCorrespondanceVue | null;
  historique: { version: number; cree_par: RedPersonne; cree_le: string; motif: string | null }[];
  indicative: RedPostesVue;
}

/* Ratios (↔ RatiosExercice, TendancesRedressement). */
export interface RedRatioVue {
  /** Points de base (BFR : jours) ; null sauf statut « calcule ». */
  valeur: number | null;
  statut: RedStatutRatio;
  raison: RedRaisonRatio | null;
  manquants: RedPoste[];
}
export interface RedRatiosExerciceVue {
  exercice: number;
  devise: Devise;
  postes: Partial<Record<RedPoste, number>>;
  ratios: Record<RedCleRatio, RedRatioVue>;
}
/** Exercice rendu par la route 10 : le miroir du moteur, avec l'état du dossier dont il vient. */
export interface RedRatiosExerciceEtatVue extends RedRatiosExerciceVue {
  etat_id: string;
  date_cloture: string | null;
  accepte_sous_reserve: boolean;
}
export interface RedTendancesVue {
  croissance_ca_pb: number | null;
  variation_marge_brute_pb: number | null;
  raison: "devises_differentes" | "exercice_precedent_absent" | null;
}
export interface RedRatiosVue {
  correspondance_version: number | null;
  /** Au plus 3, le plus récent d'abord. */
  exercices: RedRatiosExerciceEtatVue[];
  tendances: RedTendancesVue | null;
  etats_non_utilises: { etat_id: string; exercice: number; statut: string }[];
  analyses_indicatives: boolean;
  fiabilite: { classe: string; points: number };
}

/* Urgence (↔ ResultatUrgence). */
export interface RedResultatDomaineUrgenceVue {
  domaine: RedDomaine;
  voyant: RedVoyant;
  pourcentage: number | null;
  points_ponderes: number;
  points_maximum: number;
  poids_repondu: number;
  poids_total: number;
  inconnues: string[];
  absentes: string[];
}
export interface RedResultatUrgenceVue {
  version: number;
  domaines: RedResultatDomaineUrgenceVue[];
  voyant: RedVoyant;
  domaines_rouges: RedDomaine[];
  domaines_oranges: RedDomaine[];
  domaines_non_evalues: RedDomaine[];
  complet: boolean;
  questions_repondues: number;
  questions_total: number;
}
export interface RedUrgenceVue {
  id: string;
  grille_version: number;
  reponses: Record<string, RedReponseUrgence>;
  resultat: RedResultatUrgenceVue;
  voyant: RedVoyant;
  duree_secondes: number | null;
  commentaire: string | null;
  saisi_par: RedPersonne;
  cree_le: string;
}

/* Seuils et score d'alerte (↔ SeuilsAlerte, ScoreAlerte). */
export interface RedSeuilCritere {
  orange: number;
  rouge: number;
  poids: number;
}
/** Forme JSON des seuils (snake_case ; stockée en base et rendue telle quelle). */
export interface RedSeuils {
  criteres: Record<RedCritereAlerte, RedSeuilCritere>;
  niveaux: { modere: number; eleve: number; critique: number };
  part_minimale_evaluee_pct: number;
}
export interface RedSeuilsVersionVue {
  id: string;
  secteur: RedSecteur;
  version: number;
  statut: RedStatutSeuils;
  seuils: RedSeuils;
  motif: string | null;
  cree_par: RedPersonne;
  cree_le: string;
  publiee_par: RedPersonne | null;
  publiee_le: string | null;
}
/** Route 13. `peut_publier` (par secteur : brouillon, rôle et auteur) est un confort d'affichage : l'API reste juge. */
export interface RedSeuilsEtatVue {
  secteurs: {
    secteur: RedSecteur;
    en_vigueur: RedSeuilsVersionVue | null;
    brouillon: RedSeuilsVersionVue | null;
    historique: RedSeuilsVersionVue[];
    peut_publier: boolean;
  }[];
  defaut_moteur: RedSeuils;
}
export interface RedResultatCritereAlerteVue {
  critere: RedCritereAlerte;
  valeur: number | null;
  statut: RedVoyant;
  points: 0 | 1 | 2 | null;
  poids: number;
  motif: "signal_critique" | "sans_objet" | "non_calculable" | "non_renseigne" | null;
}
export interface RedScoreAlerteVue {
  version: number;
  score: number | null;
  niveau: RedNiveauAlerte;
  criteres: RedResultatCritereAlerteVue[];
  points_ponderes: number;
  poids_evalue: number;
  poids_total: number;
  criteres_rouges: RedCritereAlerte[];
  criteres_oranges: RedCritereAlerte[];
}
/** Entrées conservées d'un score (`red_scores.entrees`) : le score se rejoue à l'identique. */
export interface RedEntreesScoreVue {
  exercice_reference: number | null;
  etat_id: string | null;
  correspondance_version: number | null;
  ratios: RedRatiosExerciceVue | null;
  tendances: RedTendancesVue | null;
  incidents: {
    rejets_bancaires_12m: number | null;
    retards_fournisseurs_90j: number | null;
    arrieres_fiscaux_sociaux: boolean | null;
  };
  analyses_indicatives: boolean;
  devise: Devise;
}
export interface RedScoreVue {
  id: string;
  secteur: RedSecteur;
  seuils_source: RedSourceSeuils;
  seuils_version_id: string | null;
  seuils_version: number | null;
  /** Instantané complet des seuils appliqués. */
  seuils: RedSeuils;
  version_moteur: number;
  date_reference: string;
  entrees: RedEntreesScoreVue;
  resultat: RedScoreAlerteVue;
  score: number | null;
  niveau: RedNiveauAlerte;
  calcule_par: RedPersonne;
  cree_le: string;
}

/* Trésorerie (↔ ResultatTresorerie, PropositionEcheances, ResultatPointMort). */
export interface RedFluxRealiseVue {
  encaissement?: Partial<Record<RedCategorieEncaissement, number>>;
  decaissement?: Partial<Record<RedCategorieDecaissement, number>>;
}
export interface RedEcartCategorieVue {
  sens: RedSensFlux;
  categorie: string;
  prevu: number;
  realise: number | null;
  ecart: number | null;
}
export interface RedSemaineTresorerieVue {
  semaine: number;
  debut: string;
  fin: string;
  encaissements_prevus: number;
  decaissements_prevus: number;
  flux_net_prevu: number;
  solde_ouverture_prevu: number;
  solde_cloture_prevu: number;
  realise: {
    encaissements: number;
    decaissements: number;
    flux_net: number;
    solde_constate: number | null;
  } | null;
  ecart_encaissements: number | null;
  ecart_decaissements: number | null;
  ecart_flux_net: number | null;
  ecart_rapprochement: number | null;
  solde_ouverture_retenu: number;
  solde_cloture_retenu: number;
  tension: boolean;
  par_categorie: RedEcartCategorieVue[];
}
export interface RedProjectionVue {
  semaines: RedSemaineTresorerieVue[];
  solde_minimum: { semaine: number; montant: number };
  semaines_tension: number[];
  premiere_semaine_tension: number | null;
  besoin_financement: number;
  derniere_semaine_realisee: number | null;
  ecart_cumule_flux_net: number;
  totaux: { encaissements_prevus: number; decaissements_prevus: number; flux_net_prevu: number };
}
export interface RedLigneTresorerieVue {
  id: string;
  rang: number;
  semaine: number;
  sens: RedSensFlux;
  categorie: string;
  libelle: string | null;
  montant: number;
  creancier_id: string | null;
  echeance_id: string | null;
}
export interface RedTresorerieVersionVue {
  id: string;
  version: number;
  date_debut: string;
  solde_initial: number;
  seuil_tension: number;
  motif: string | null;
  cree_par: RedPersonne;
  cree_le: string;
  lignes: RedLigneTresorerieVue[];
}
export interface RedRealiseVue {
  id: string;
  semaine_debut: string;
  /** Index 1..13 dans la fenêtre de la version courante. */
  semaine: number;
  flux: RedFluxRealiseVue;
  solde_constate: number | null;
  commentaire: string | null;
  saisi_par: RedPersonne;
  cree_le: string;
  /** Nombre de corrections déjà enregistrées pour cette semaine. */
  corrections: number;
}
/** Route 18. */
export interface RedTresorerieVue {
  version: RedTresorerieVersionVue | null;
  realises: RedRealiseVue[];
  realises_hors_fenetre: number;
  projection: RedProjectionVue | null;
  historique: {
    id: string;
    version: number;
    date_debut: string;
    cree_par: RedPersonne;
    cree_le: string;
    motif: string | null;
  }[];
}
export interface RedLigneProposeeVue {
  semaine: number;
  sens: RedSensFlux;
  categorie: string;
  montant: number;
  echeance_id: string;
  creancier_id: string;
}
export interface RedPropositionEcheancesVue {
  lignes: RedLigneProposeeVue[];
  anterieures: number;
  ulterieures: number;
}
export interface RedPointMortVue {
  statut: "beneficiaire" | "equilibre" | "deficitaire" | "non_calculable" | "impossible";
  periode_jours: number;
  marge_cout_variable: number;
  taux_marge_cout_variable_pb: number | null;
  resultat_exploitation: number;
  seuil_rentabilite: number | null;
  marge_securite: number | null;
  marge_securite_pb: number | null;
  point_mort_jours: number | null;
}

/* Créanciers (↔ SituationCreancier, SynthesePassif). */
export interface RedEcheanceRestanteVue {
  rang: number;
  date: string;
  montant_restant: number;
}
export interface RedSituationCreancierVue {
  encours_initial: number;
  accord: {
    statut: RedStatutAccord;
    montant_convenu: number;
    remise: number;
    total_paye: number;
    reste_a_payer: number;
    echeances_echues: number;
    montant_echu: number;
    retard: number;
    prochaine_non_soldee: RedEcheanceRestanteVue | null;
    echeances_restantes: RedEcheanceRestanteVue[];
  } | null;
  encours_restant: number;
  echu: number;
}
export interface RedSynthesePassifVue {
  nombre: number;
  total_encours: number;
  total_echu: number;
  part_garantie_pb: number | null;
  concentration_top3_pb: number | null;
  par_categorie: {
    categorie: RedCategorieCreancier;
    nombre: number;
    encours: number;
    echu: number;
    part_pb: number | null;
  }[];
}
export interface RedCreancierResume {
  id: string;
  nom: string;
  categorie: RedCategorieCreancier;
  garanti: boolean;
  reference: string | null;
  actif: boolean;
  /** Créance courante (dernière version). */
  version_creance: number;
  principal: number;
  interets: number;
  date_arrete: string;
  echeance_initiale: string | null;
  nature: string | null;
  situation: RedSituationCreancierVue;
  cree_le: string;
  modifie_le: string;
}
export interface RedCreanceVue {
  id: string;
  version: number;
  principal: number;
  interets: number;
  date_arrete: string;
  echeance_initiale: string | null;
  nature: string | null;
  commentaire: string | null;
  saisi_par: RedPersonne;
  cree_le: string;
}
export interface RedEvenementNegociationVue {
  id: string;
  type: RedTypeEvenementNegociation;
  date_evenement: string;
  montant: number | null;
  conditions: string | null;
  accord_id: string | null;
  echeance_rang: number | null;
  auteur: RedPersonne;
  cree_le: string;
}
export interface RedAccordVue {
  id: string;
  date_evenement: string;
  montant_convenu: number;
  conditions: string | null;
  echeances: { rang: number; date: string; montant: number }[];
  /** Paiements non annulés : `id` sert à l'annulation (événement `annulation_paiement`). */
  paiements: { id: string; date: string; montant: number; echeance_rang: number | null }[];
}
export interface RedCreancierVue extends RedCreancierResume {
  creances: RedCreanceVue[];
  evenements: RedEvenementNegociationVue[];
  accord_en_vigueur: RedAccordVue | null;
}
/** Route 23. */
export interface RedCreanciersVue {
  elements: RedCreancierResume[];
  synthese: RedSynthesePassifVue;
  date_reference: string;
}

/* Leviers (↔ ImpactLevier, DefinitionLevier). */
export interface RedImpactLevierVue {
  code: RedCodeLevier;
  devise: Devise;
  tresorerie_unique: number;
  resultat_annuel: number;
  tresorerie_annee1: number;
  plus_ou_moins_value: number | null;
  base: Partial<Record<RedPoste, number>>;
  hypotheses: string[];
  version_catalogue: number;
}
export interface RedDefinitionLevierVue {
  code: RedCodeLevier;
  famille: RedFamilleLevier;
  libelle: string;
  description: string;
  postes_base: RedPoste[];
  parametres: {
    cle: string;
    libelle: string;
    unite: "jours" | "pb" | "mois" | "montant";
    min: number;
    max: number;
  }[];
  hypotheses: string[];
}

/* Plan et kanban (↔ EvaluationPlan, EcartPlan). */
export interface RedActionVue {
  id: string;
  numero: number;
  titre: string;
  description: string | null;
  volet: RedVolet;
  domaine: RedDomaine;
  echeance: string;
  statut: RedStatutAction;
  rang: number;
  motif: string | null;
  termine_le: string | null;
  responsable: RedPersonne;
  levier: {
    code: RedCodeLevier;
    parametres: Record<string, number>;
    impact: RedImpactLevierVue;
  } | null;
  tache_collaboration_id: string | null;
  en_retard: boolean;
  cree_par: RedPersonne;
  cree_le: string;
  modifie_le: string;
}
export interface RedActionEvenementVue {
  id: string;
  type: RedTypeEvenementAction;
  statut_avant: RedStatutAction | null;
  statut_apres: RedStatutAction;
  commentaire: string | null;
  auteur: RedPersonne;
  cree_le: string;
}
/** Route 34 : l'action et son fil d'événements (200 au plus). */
export interface RedActionDetailVue extends RedActionVue {
  evenements: RedActionEvenementVue[];
}
export interface RedAvancementVoletVue {
  total: number;
  terminees: number;
  abandonnees: number;
  en_retard: number;
  avancement_pb: number | null;
}
export interface RedEvaluationPlanVue {
  par_volet: Record<RedVolet, RedAvancementVoletVue>;
  en_retard: number[];
  anomalies: {
    code:
      | "AUCUNE_ACTION"
      | "AUCUN_QUICK_WIN"
      | "QUICK_WIN_HORS_FENETRE"
      | "RESTRUCTURATION_HORS_FENETRE";
    numero: number | null;
    bloquante: boolean;
  }[];
  bloquants_validation: string[];
  impact_tresorerie_unique: number;
  impact_resultat_annuel: number;
}
export interface RedEcartPlanVue {
  ajoutees: number[];
  retirees: number[];
  modifiees: number[];
}
export interface RedActionCanoniqueVue {
  numero: number;
  titre: string;
  volet: RedVolet;
  domaine: RedDomaine;
  echeance: string;
  responsable_id: string;
  levier_code: string | null;
  impact_tresorerie_unique: number | null;
  impact_resultat_annuel: number | null;
}
export interface RedPlanVersionVue {
  id: string;
  version: number;
  statut: RedStatutVersionPlan;
  date_reference: string;
  cree_par: RedPersonne;
  cree_le: string;
  valide_par: RedPersonne | null;
  valide_le: string | null;
  motif: string | null;
  /** Confort d'affichage : même fonction que la validation. */
  peut_valider: boolean;
  /** Présent seulement à la création (route 35) : jamais reçu d'un client. */
  contenu?: { version: 1; actions: RedActionCanoniqueVue[] };
}
/** Route 29. */
export interface RedPlanVue {
  kanban: {
    colonnes: Record<RedColonneKanban, RedActionVue[]>;
    abandonnees: RedActionVue[];
  };
  evaluation: RedEvaluationPlanVue;
  date_reference: string;
  versions: RedPlanVersionVue[];
  version_validee: string | null;
  ecart_avec_version_validee: RedEcartPlanVue | null;
}

/* Dossier (routes 2 à 5). */
export interface RedDossierResume {
  id: string;
  mission: { id: string; intitule: string };
  client: { id: string; raison_sociale: string };
  intitule: string;
  secteur: RedSecteur;
  devise: Devise;
  statut: RedStatutDossier;
  ouvert_le: string;
  dernier_voyant_urgence: RedVoyant | null;
  dernier_niveau_alerte: RedNiveauAlerte | null;
  dernier_score: number | null;
}
export interface RedDossierVue extends RedDossierResume {
  modifie_le: string;
  clos_le: string | null;
  motif_cloture: string | null;
  urgence: {
    id: string;
    voyant: RedVoyant;
    cree_le: string;
    voyants_par_domaine: Record<RedDomaine, RedVoyant>;
  } | null;
  alerte: {
    id: string;
    score: number | null;
    niveau: RedNiveauAlerte;
    cree_le: string;
    seuils_source: RedSourceSeuils;
    seuils_version: number | null;
  } | null;
  tresorerie: {
    version: number;
    date_debut: string;
    semaines_tension: number[];
    premiere_semaine_tension: number | null;
    solde_minimum: { semaine: number; montant: number };
    besoin_financement: number;
    derniere_semaine_realisee: number | null;
  } | null;
  creanciers: { nombre: number; encours_total: number; echu_total: number };
  plan: {
    actions_par_statut: Record<RedStatutAction, number>;
    en_retard: number;
    version_courante: number | null;
    modifie_depuis_validation: boolean;
  };
  correspondance_version: number | null;
  etats_acceptes: number;
  analyses_indicatives: boolean;
  /** Confort d'affichage : l'API reste juge. */
  droits: { ecrire: boolean; valider: boolean };
}

/** Route 1 : référentiel du moteur, sans lecture en base. */
export interface RedReferentielVue {
  version_moteur: number;
  version_grille_urgence: number;
  version_moteur_alerte: number;
  version_catalogue_leviers: number;
  grille_urgence: { code: string; domaine: RedDomaine; libelle: string; critique: boolean }[];
  parametres_urgence: {
    seuil_orange_pct: number;
    seuil_rouge_pct: number;
    poids_critique: number;
    part_minimale_repondue_pct: number;
  };
  seuils_defaut: RedSeuils;
  leviers: RedDefinitionLevierVue[];
  correspondance_indicative: RedPostesVue;
  plafonds: Record<string, number>;
}
