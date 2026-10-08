import { z } from "zod";
import {
  auMoinsUnChamp,
  dateIsoSchema,
  deviseSchema,
  listeLibelles,
  MESSAGE_CORPS_VIDE,
  montantSchema,
  paysSchema,
  texte,
  texteOptionnel,
} from "./commun";
import { termeSensibleSchema } from "./ia";

/*
 * Appels d'offres, lot AO-A (AO-01 à AO-03, AO-08, PRD complémentaire §9) : contrat des routes
 * /api/appels-offres/**. Les scores (rapprochement, go/no-go), la synthèse de conformité, le
 * rétro-planning et les alertes ne sont JAMAIS reçus : ils sortent du moteur
 * (packages/engines/src/appels-offres) et se servent en lecture seule.
 *
 * Droits : `ao.lire`, `ao.gerer`, `ao.decider` (associé seul) ; la marge estimée d'une
 * évaluation go/no-go est une donnée FIN-02 (`finance.lire`) ; confier une étape exige en plus
 * `tache.assigner` ; l'extraction par l'IA exige en plus `ia.utiliser`.
 */

const uuid = z.string().uuid();
const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

export const STATUTS_APPEL_OFFRES = [
  "detecte",
  "go_no_go",
  "en_reponse",
  "depose",
  "gagne",
  "perdu",
  "no_go",
] as const;
export type StatutAppelOffres = (typeof STATUTS_APPEL_OFFRES)[number];
export const statutAppelOffresSchema = z.enum(STATUTS_APPEL_OFFRES);
export const STATUT_APPEL_OFFRES_LIBELLES: Record<StatutAppelOffres, string> = {
  detecte: "Détecté",
  go_no_go: "Go/no-go",
  en_reponse: "En réponse",
  depose: "Déposé",
  gagne: "Gagné",
  perdu: "Perdu",
  no_go: "No-go",
};

export const CATEGORIES_EXIGENCE_AO = [
  "administrative",
  "technique",
  "financiere",
  "references",
  "personnel",
  "autre",
] as const;
export type CategorieExigenceAo = (typeof CATEGORIES_EXIGENCE_AO)[number];
export const categorieExigenceAoSchema = z.enum(CATEGORIES_EXIGENCE_AO);
export const CATEGORIE_EXIGENCE_AO_LIBELLES: Record<CategorieExigenceAo, string> = {
  administrative: "Administrative",
  technique: "Technique",
  financiere: "Financière",
  references: "Références",
  personnel: "Personnel clé",
  autre: "Autre",
};

export const STATUTS_CONFORMITE_AO = [
  "a_traiter",
  "en_cours",
  "conforme",
  "partiel",
  "non_conforme",
  "sans_objet",
] as const;
export type StatutConformiteAo = (typeof STATUTS_CONFORMITE_AO)[number];
export const statutConformiteAoSchema = z.enum(STATUTS_CONFORMITE_AO);
export const STATUT_CONFORMITE_AO_LIBELLES: Record<StatutConformiteAo, string> = {
  a_traiter: "À traiter",
  en_cours: "En cours",
  conforme: "Conforme",
  partiel: "Partiel",
  non_conforme: "Non conforme",
  sans_objet: "Sans objet",
};

export const DECISIONS_GO_NO_GO = ["go", "no_go"] as const;
export type DecisionGoNoGo = (typeof DECISIONS_GO_NO_GO)[number];
export const RECOMMANDATION_GO_NO_GO_LIBELLES: Record<"go" | "a_examiner" | "no_go", string> = {
  go: "Go recommandé",
  a_examiner: "À examiner",
  no_go: "No-go recommandé",
};

/** Plafonds (déni de service). */
export const AO_IMPORT_MAX = 200;
export const AO_DOSSIER_TEXTE_MAX = 200_000;
export const AO_DOSSIER_TEXTE_MIN = 50;
export const AO_EXIGENCES_MAX = 2_000;

const urlAvis = z
  .string()
  .trim()
  .max(500)
  .url("Adresse invalide.")
  .refine((u) => /^https?:\/\/[^\s<>"]+$/i.test(u), "Adresse http ou https attendue.");

const champsFiche = {
  reference: texteOptionnel(80),
  titre: texte(300),
  objet: texteOptionnel(4000),
  bailleur: texteOptionnel(150),
  pays: paysSchema.nullable().optional(),
  secteur: texteOptionnel(120),
  montant_estime: montantSchema.nullable().optional(),
  devise: deviseSchema.optional(),
  date_publication: dateIsoSchema.nullable().optional(),
  date_limite: dateIsoSchema.nullable().optional(),
  source_libelle: texteOptionnel(150),
  url: z.preprocess((v) => (v === "" ? null : v), urlAvis.nullable().optional()),
  mots_cles: listeLibelles(30, 80).optional(),
  responsable_id: uuid.nullable().optional(),
};

export const appelOffresCreationSchema = z.object(champsFiche).strict();
export type AppelOffresCreation = z.infer<typeof appelOffresCreationSchema>;

export const appelOffresModificationSchema = z
  .object(champsFiche)
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);
export type AppelOffresModification = z.infer<typeof appelOffresModificationSchema>;

/** Import manuel d'un lot de fiches (AO-01, sans connecteur) : doublons de référence ignorés. */
export const appelsOffresImportSchema = z
  .object({
    fiches: z.array(appelOffresCreationSchema).min(1).max(AO_IMPORT_MAX),
    source_libelle: texteOptionnel(150),
  })
  .strict();
export type AppelsOffresImport = z.infer<typeof appelsOffresImportSchema>;

export const appelsOffresQuerySchema = z
  .object({
    statut: statutAppelOffresSchema.optional(),
    q: z.string().trim().max(100).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

/** Statuts posés à la main ; « en réponse » et « no-go » passent par la décision de l'associé. */
export const appelOffresStatutSchema = z
  .object({
    statut: z.enum(["depose", "gagne", "perdu"]),
    motif: texteOptionnel(2000),
  })
  .strict();

const entierBorne = (max: number) => z.number().int().min(0).max(max);

/**
 * Entrées d'une évaluation go/no-go (AO-02). L'adéquation et les références pertinentes valent
 * par défaut le rapprochement (AO-01) ; la marge estimée (points de base, 1 % = 100) est une
 * donnée FIN-02 : seule une personne qui a `finance.lire` la renseigne.
 */
export const evaluationGoNoGoSchema = z
  .object({
    adequation: entierBorne(100).optional(),
    references_pertinentes: entierBorne(1_000).optional(),
    references_exigees: entierBorne(100).default(0),
    jours_disponibles: entierBorne(100_000),
    jours_requis: entierBorne(100_000),
    marge_estimee_bp: z.number().int().min(-10_000).max(10_000).nullable().optional(),
    marge_cible_bp: z.number().int().min(1).max(10_000).default(2_000),
    concurrents_connus: entierBorne(100).default(0),
    concurrents_forts: entierBorne(100).default(0),
  })
  .strict()
  .refine((v) => v.concurrents_forts <= v.concurrents_connus, {
    message: "Les concurrents forts font partie des concurrents connus.",
    path: ["concurrents_forts"],
  });
export type EvaluationGoNoGo = z.infer<typeof evaluationGoNoGoSchema>;

export const decisionGoNoGoSchema = z
  .object({
    evaluation_id: uuid,
    decision: z.enum(DECISIONS_GO_NO_GO),
    motif: z.string().trim().min(10, "Motivez la décision (10 caractères au moins).").max(2000),
  })
  .strict();
export type DecisionGoNoGoCorps = z.infer<typeof decisionGoNoGoSchema>;

/** Dossier d'appel d'offres : texte collé OU fichier texte téléversé (POST /api/fichiers). */
export const dossierAppelOffresSchema = z
  .object({
    texte: z.string().min(AO_DOSSIER_TEXTE_MIN).max(AO_DOSSIER_TEXTE_MAX).optional(),
    fichier_id: uuid.optional(),
  })
  .strict()
  .refine((v) => (v.texte === undefined) !== (v.fichier_id === undefined), {
    message: "Fournissez soit le texte du dossier, soit un fichier.",
  });

export const extractionExigencesSchema = z
  .object({
    dossier_id: uuid,
    mode: z.enum(["ia", "deterministe"]).default("ia"),
    termes_sensibles: z.array(termeSensibleSchema).max(200).default([]),
  })
  .strict();
export type ExtractionExigences = z.infer<typeof extractionExigencesSchema>;

/** Validation humaine d'une extraction : `retenues` = rangs gardés (tous si omis). */
export const decisionExtractionSchema = z
  .object({
    decision: z.enum(["validee", "rejetee"]),
    retenues: z.array(z.number().int().min(0).max(199)).max(200).optional(),
    motif: texteOptionnel(1000),
    /** Obligatoire pour valider une extraction dont les nombres n'ont pas pu être vérifiés. */
    acquitte_chiffres: z.boolean().optional(),
  })
  .strict();
export type DecisionExtraction = z.infer<typeof decisionExtractionSchema>;

export const exigenceCreationSchema = z
  .object({
    libelle: texte(1000),
    categorie: categorieExigenceAoSchema,
    obligatoire: z.boolean().default(true),
    reference: texteOptionnel(60),
    responsable_id: uuid.nullable().optional(),
  })
  .strict();
export type ExigenceCreation = z.infer<typeof exigenceCreationSchema>;

export const exigenceModificationSchema = z
  .object({
    statut: statutConformiteAoSchema.optional(),
    commentaire: texteOptionnel(2000),
    piece: texteOptionnel(300),
    responsable_id: uuid.nullable().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);
export type ExigenceModification = z.infer<typeof exigenceModificationSchema>;

export const etapeRetroplanningModificationSchema = z
  .object({
    date_prevue: dateIsoSchema.optional(),
    responsable_id: uuid.nullable().optional(),
    faite: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);
export type EtapeRetroplanningModification = z.infer<typeof etapeRetroplanningModificationSchema>;

export const etapeTacheSchema = z
  .object({
    assignee_id: uuid,
    description: texteOptionnel(2000),
  })
  .strict();
export type EtapeTache = z.infer<typeof etapeTacheSchema>;

/** Génération du rétro-planning : aucun paramètre (dates calculées par le moteur). */
export const retroplanningGenerationSchema = z.object({}).strict();
