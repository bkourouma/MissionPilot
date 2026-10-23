import { z } from "zod";

/*
 * Plan vivant (PLA-18, PRD complémentaire §11.3) : réalisés trimestriels et
 * re-prévisions. Ces schémas ne valident que la FORME des saisies, avec les
 * mêmes bornes que le moteur (`reprevoirExercice`, @missionpilot/engines) :
 * montants entiers sûrs, trimestre 1 à 4, exercice 2000 à 2100, méthodes du
 * moteur, répartition de quatre parts pour mille de somme 1000. Les écarts,
 * la décomposition de l'EBE et les faits sortent du moteur ; l'API ne calcule
 * rien.
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

export const EXERCICE_PLAN_VIVANT = { min: 2000, max: 2100 } as const;
export const TRIMESTRES_PLAN_VIVANT = 4;
export const METHODES_REPREVISION_PLAN = ["reste_du_plan", "tendance"] as const;
export type MethodeReprevisionPlan = (typeof METHODES_REPREVISION_PLAN)[number];
export const METHODE_REPREVISION_PLAN_LIBELLES: Record<MethodeReprevisionPlan, string> = {
  reste_du_plan: "Reste du plan",
  tendance: "Tendance",
};
export const SEUIL_REPREVISION_PLAN = { min: 1, max: 1000, defaut: 100 } as const;
export const REPARTITION_REPREVISION_PLAN_DEFAUT = [250, 250, 250, 250] as const;
export const COMMENTAIRE_REALISE_MAX = 1000;

const exerciceSchema = z.number().int().min(EXERCICE_PLAN_VIVANT.min).max(EXERCICE_PLAN_VIVANT.max);
const exerciceCoerceSchema = z.coerce
  .number()
  .int()
  .min(EXERCICE_PLAN_VIVANT.min)
  .max(EXERCICE_PLAN_VIVANT.max);

/** Montant entier de la devise du plan (entier sûr, jamais un flottant). */
const montantSchema = z.number().int().safe();

/** Texte sans caractère de contrôle (comme la contrainte de la base). */
const commentaireSchema = z
  .string()
  .max(COMMENTAIRE_REALISE_MAX)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s), "Caractères de contrôle interdits.");

/** Adresse d'un réalisé : plan, exercice, trimestre (1 à 4). */
export const planRealiseParamsSchema = z
  .object({
    id: z.string().uuid(),
    exercice: exerciceCoerceSchema,
    trimestre: z.coerce.number().int().min(1).max(TRIMESTRES_PLAN_VIVANT),
  })
  .strict();

/**
 * Saisie (ou correction : une nouvelle version) d'un réalisé. Chiffre
 * d'affaires positif ou nul ; résultat net et trésorerie facultatifs (null =
 * non saisi, jamais 0).
 */
export const planRealiseSaisieSchema = z
  .object({
    chiffre_affaires: montantSchema.min(0),
    ebe: montantSchema,
    resultat_net: montantSchema.nullable().default(null),
    tresorerie_fin: montantSchema.nullable().default(null),
    commentaire: commentaireSchema.nullable().default(null),
  })
  .strict();
export type PlanRealiseSaisie = z.infer<typeof planRealiseSaisieSchema>;

export const planRealisesQuerySchema = z
  .object({ exercice: exerciceCoerceSchema.optional() })
  .strict();

const repartitionSchema = z
  .tuple([
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
  ])
  .refine((r) => r[0] + r[1] + r[2] + r[3] === 1000, {
    message: "La somme des quatre parts doit valoir 1000 pour mille.",
  });

/** Lancement d'une re-prévision sur une version VALIDÉE du modèle. */
export const planReprevisionCreationSchema = z
  .object({
    version: z.number().int().min(1).max(100_000),
    exercice: exerciceSchema,
    methode: z.enum(METHODES_REPREVISION_PLAN).default("reste_du_plan"),
    repartition: repartitionSchema.optional(),
    seuil: z
      .number()
      .int()
      .min(SEUIL_REPREVISION_PLAN.min)
      .max(SEUIL_REPREVISION_PLAN.max)
      .optional(),
  })
  .strict();
export type PlanReprevisionCreation = z.infer<typeof planReprevisionCreationSchema>;

export const planReprevisionParamsSchema = z
  .object({ id: z.string().uuid(), revId: z.string().uuid() })
  .strict();

export const planReprevisionListeQuerySchema = z
  .object({
    limite: limiteSchema,
    curseur: curseurSchema,
    exercice: exerciceCoerceSchema.optional(),
  })
  .strict();
