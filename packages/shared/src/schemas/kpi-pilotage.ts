import { z } from "zod";
import { auMoinsUnChamp, dateIsoSchema, MESSAGE_CORPS_VIDE, texte, texteOptionnel } from "./commun";
import { dateArreteMax, DATE_SUIVI_KPI_MIN } from "./kpi";

/*
 * Pilotage augmenté des KPI (PRD complémentaire §11.4) : contrat des routes
 * /api/missions/:id/kpi/arbres, /api/kpi/arbres/**, /api/missions/:id/kpi/qualite-donnees,
 * /api/missions/:id/kpi/revues, /api/kpi/revues/** et /api/missions/:id/kpi/actions,
 * /api/kpi/actions/**.
 *
 * - KPI-13 arbres d'indicateurs ; KPI-15 qualité des données ; KPI-17 revue de performance ;
 *   KPI-18 actions correctives. Tous les chiffres sortent des moteurs
 *   (packages/engines/src/kpi) ; ces schémas ne portent que des saisies.
 */

const uuid = z.string().uuid();

/** Date d'arrêté d'une situation : entre le 2000-01-01 et aujourd'hui + 366 jours. */
const dateArrete = dateIsoSchema.refine(
  (d) => d >= DATE_SUIVI_KPI_MIN && d <= dateArreteMax(),
  `Date entre le ${DATE_SUIVI_KPI_MIN} et aujourd'hui + 366 jours.`,
);

const listeQuery = {
  limite: z.coerce.number().int().min(1).max(100).default(50),
  curseur: z.string().max(500).optional(),
};

/* ----- KPI-13 : arbres d'indicateurs ----- */

export const RELATIONS_ARBRE_KPI = ["somme", "produit"] as const;
export const RELATION_ARBRE_KPI_LIBELLES: Record<(typeof RELATIONS_ARBRE_KPI)[number], string> = {
  somme: "Somme pondérée des leviers",
  produit: "Produit des leviers",
};

/** Coefficient d'un levier : au plus 4 chiffres entiers et 4 décimales, signé. */
const coefficientSchema = z
  .number()
  .finite()
  .refine((v) => /^-?\d{1,4}(\.\d{1,4})?$/.test(String(v)), "Au plus 4 entiers et 4 décimales.")
  .refine((v) => Math.abs(v) <= 1000, "Entre -1000 et 1000.");

export const kpiArbreCreationSchema = z
  .object({
    kpi_racine_id: uuid,
    libelle: texte(200),
    description: texteOptionnel(2000),
  })
  .strict();

export const kpiArbreModificationSchema = z
  .object({
    libelle: texte(200).optional(),
    description: texteOptionnel(2000),
    actif: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const kpiNoeudCreationSchema = z
  .object({
    parent_id: uuid,
    kpi_id: uuid.nullable().optional(),
    libelle: texte(200),
    relation: z.enum(RELATIONS_ARBRE_KPI).default("somme"),
    coefficient: coefficientSchema.default(1),
    rang: z.number().int().min(0).max(999).default(0),
  })
  .strict();

export const kpiNoeudModificationSchema = z
  .object({
    kpi_id: uuid.nullable().optional(),
    libelle: texte(200).optional(),
    relation: z.enum(RELATIONS_ARBRE_KPI).optional(),
    coefficient: coefficientSchema.optional(),
    rang: z.number().int().min(0).max(999).optional(),
    actif: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/** Deux situations comparées : `avant` doit précéder `apres` (défaut : aujourd'hui). */
export const kpiArbreContributionsQuerySchema = z
  .object({ avant: dateArrete, apres: dateArrete.optional() })
  .strict();

/* ----- KPI-18 : actions correctives ----- */

export const STATUTS_ACTION_KPI = ["a_faire", "en_cours", "terminee", "abandonnee"] as const;
export type StatutActionKpi = (typeof STATUTS_ACTION_KPI)[number];
export const STATUT_ACTION_KPI_LIBELLES: Record<StatutActionKpi, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  terminee: "Terminée",
  abandonnee: "Abandonnée",
};

export const kpiActionCreationSchema = z
  .object({
    kpi_id: uuid,
    alerte_id: uuid.nullable().optional(),
    decision_id: uuid.nullable().optional(),
    titre: texte(200),
    description: texteOptionnel(2000),
    responsable_id: uuid,
    echeance: dateIsoSchema,
  })
  .strict();

export const kpiActionModificationSchema = z
  .object({
    titre: texte(200).optional(),
    description: texteOptionnel(2000),
    responsable_id: uuid.optional(),
    echeance: dateIsoSchema.optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/**
 * Une date d'effet plus ancienne que ce nombre de jours avant aujourd'hui exige un commentaire
 * qui la justifie (elle détermine les fenêtres avant/après de l'efficacité mesurée).
 */
export const DELAI_DATE_EFFET_SANS_MOTIF_JOURS = 31;

/** Changement de statut : une action terminée porte sa date d'effet, une abandonnée son motif. */
export const kpiActionStatutSchema = z
  .object({
    statut: z.enum(["en_cours", "terminee", "abandonnee"]),
    date_effet: dateIsoSchema.optional(),
    motif: texte(500).optional(),
    commentaire: texteOptionnel(1000),
  })
  .strict()
  .refine((v) => v.statut === "abandonnee" || v.motif === undefined, {
    message: "Le motif ne concerne que l'abandon.",
    path: ["motif"],
  })
  .refine((v) => v.statut === "terminee" || v.date_effet === undefined, {
    message: "La date d'effet ne concerne que la clôture d'une action.",
    path: ["date_effet"],
  })
  .refine((v) => v.statut !== "abandonnee" || v.motif !== undefined, {
    message: "Un motif est obligatoire pour abandonner une action.",
    path: ["motif"],
  });

export const kpiActionCommentaireSchema = z.object({ commentaire: texte(1000) }).strict();

export const kpiActionsQuerySchema = z
  .object({
    statut: z.enum(STATUTS_ACTION_KPI).optional(),
    kpi_id: uuid.optional(),
    alerte_id: uuid.optional(),
    responsable_id: uuid.optional(),
    ...listeQuery,
  })
  .strict();

/** Fenêtre (périodes) de part et d'autre de la date d'effet pour mesurer l'efficacité. */
export const kpiEfficaciteQuerySchema = z
  .object({
    fenetre: z.coerce.number().int().min(1).max(12).optional(),
    date: dateArrete.optional(),
  })
  .strict();

/* ----- KPI-17 : revue de performance ----- */

export const STATUTS_REVUE_KPI = ["planifiee", "tenue", "cloturee", "annulee"] as const;
export type StatutRevueKpi = (typeof STATUTS_REVUE_KPI)[number];
export const STATUT_REVUE_KPI_LIBELLES: Record<StatutRevueKpi, string> = {
  planifiee: "Planifiée",
  tenue: "Tenue",
  cloturee: "Clôturée",
  annulee: "Annulée",
};

export const STATUTS_DECISION_KPI = ["ouverte", "en_cours", "executee", "abandonnee"] as const;
export type StatutDecisionKpi = (typeof STATUTS_DECISION_KPI)[number];
export const STATUT_DECISION_KPI_LIBELLES: Record<StatutDecisionKpi, string> = {
  ouverte: "Ouverte",
  en_cours: "En cours",
  executee: "Exécutée",
  abandonnee: "Abandonnée",
};

export const kpiRevueCreationSchema = z
  .object({
    titre: texte(200),
    date_prevue: dateIsoSchema,
    /** Date d'arrêté des KPI examinés (défaut : la date prévue). */
    date_reference: dateArrete.optional(),
    animateur_id: uuid.nullable().optional(),
  })
  .strict();

export const kpiRevueModificationSchema = z
  .object({
    titre: texte(200).optional(),
    date_prevue: dateIsoSchema.optional(),
    date_reference: dateArrete.optional(),
    animateur_id: uuid.nullable().optional(),
    compte_rendu: texteOptionnel(8000),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/** Point saisi à la main dans l'ordre du jour (en plus ou à la place de ceux du moteur). */
export const kpiRevuePointSchema = z
  .object({
    libelle: texte(300),
    kpi_id: uuid.nullable().optional(),
    duree_minutes: z.number().int().min(1).max(240),
  })
  .strict();

export const kpiRevueOrdreDuJourSchema = z
  .object({ points: z.array(kpiRevuePointSchema).max(40) })
  .strict();

export const kpiRevueTenueSchema = z.object({ compte_rendu: texteOptionnel(8000) }).strict();

export const kpiDecisionCreationSchema = z
  .object({
    libelle: texte(500),
    kpi_id: uuid.nullable().optional(),
    responsable_id: uuid.nullable().optional(),
    echeance: dateIsoSchema.nullable().optional(),
  })
  .strict();

export const kpiDecisionStatutSchema = z
  .object({
    statut: z.enum(["en_cours", "executee", "abandonnee"]),
    motif: texte(500).optional(),
    commentaire: texteOptionnel(1000),
  })
  .strict()
  .refine((v) => v.statut !== "abandonnee" || v.motif !== undefined, {
    message: "Un motif est obligatoire pour abandonner une décision.",
    path: ["motif"],
  })
  .refine((v) => v.statut !== "executee" || (v.commentaire ?? "") !== "", {
    message:
      "Un commentaire (ce qui a été fait) est obligatoire pour déclarer une décision exécutée.",
    path: ["commentaire"],
  })
  .refine((v) => v.statut === "abandonnee" || v.motif === undefined, {
    message: "Le motif ne concerne que l'abandon.",
    path: ["motif"],
  });

export const kpiRevuesQuerySchema = z
  .object({ statut: z.enum(STATUTS_REVUE_KPI).optional(), ...listeQuery })
  .strict();

export const FORMATS_DOSSIER_REVUE_KPI = ["pdf", "docx", "pptx"] as const;
export const kpiRevueDossierQuerySchema = z
  .object({ format: z.enum(FORMATS_DOSSIER_REVUE_KPI) })
  .strict();
