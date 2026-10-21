import { z } from "zod";
import { texte, texteOptionnel } from "./commun";

/*
 * Ateliers stratégiques en ligne (PLA-15, PRD complémentaire §11.3) : vote par points, priorisation par
 * classement, matrice impact/effort, rattachés à un plan stratégique. Les agrégats (points, rangs,
 * moyennes, taux de participation) sortent du moteur (`@missionpilot/engines`, plan-strategique/atelier) :
 * ces schémas ne valident que la FORME des saisies. Les libellés et la consigne saisis par des
 * personnes sont des données non fiables pour l'IA (jamais des consignes).
 */

const uuid = z.string().uuid();
const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);
/** Texte d'une ligne : aucun caractère de contrôle (CHECK SQL). */
const ligne = (max: number) =>
  texte(max).refine((v) => !/\p{Cc}/u.test(v), "Caractères de contrôle interdits.");

export const METHODES_ATELIER = ["vote", "priorisation", "matrice"] as const;
export type MethodeAtelier = (typeof METHODES_ATELIER)[number];
export const METHODE_ATELIER_LIBELLES: Record<MethodeAtelier, string> = {
  vote: "Vote par points",
  priorisation: "Priorisation par classement",
  matrice: "Matrice impact / effort",
};

export const STATUTS_ATELIER = ["brouillon", "ouvert", "clos"] as const;
export type StatutAtelier = (typeof STATUTS_ATELIER)[number];
export const STATUT_ATELIER_LIBELLES: Record<StatutAtelier, string> = {
  brouillon: "Brouillon",
  ouvert: "Ouvert",
  clos: "Clos",
};

/** Plafonds, doublés par la base (déclencheurs MQL08) et par le moteur. */
export const ATELIERS_PAR_PLAN_MAX = 100;
export const OPTIONS_ATELIER_MAX = 50;
export const OPTIONS_ATELIER_MIN = 2;
export const PARTICIPANTS_ATELIER_MAX = 100;
export const VERSIONS_CONTRIBUTION_MAX = 20;
export const BUDGET_POINTS_ATELIER_DEFAUT = 10;

export const PARTIES_PARTICIPANT = ["cabinet", "client"] as const;
export type PartieParticipant = (typeof PARTIES_PARTICIPANT)[number];

export const optionAtelierSchema = z
  .object({
    libelle: ligne(200),
    description: texteOptionnel(500),
  })
  .strict();

const axeSchema = z.object({ libelle: ligne(60), inverse: z.boolean() }).strict();
export const AXES_ATELIER_DEFAUT = {
  x: { libelle: "Valeur / impact", inverse: false },
  y: { libelle: "Effort", inverse: true },
} as const;

const methodesSchema = z
  .array(z.enum(METHODES_ATELIER))
  .min(1, "Au moins une méthode.")
  .max(METHODES_ATELIER.length)
  .refine((m) => new Set(m).size === m.length, "Méthode en double.");

const optionsSchema = z
  .array(optionAtelierSchema)
  .min(OPTIONS_ATELIER_MIN, `Au moins ${OPTIONS_ATELIER_MIN} options.`)
  .max(OPTIONS_ATELIER_MAX);

const budgetSchema = z.number().int().min(1).max(100);

/** POST /plans/:id/ateliers. */
export const atelierCreationSchema = z
  .object({
    titre: ligne(200),
    consigne: z.string().trim().max(4000).default(""),
    methodes: methodesSchema,
    budget_points: budgetSchema.default(BUDGET_POINTS_ATELIER_DEFAUT),
    plafond_par_option: budgetSchema.nullable().default(null),
    axes: z.object({ x: axeSchema, y: axeSchema }).strict().default(AXES_ATELIER_DEFAUT),
    options: optionsSchema,
  })
  .strict()
  .refine(
    (a) => a.plafond_par_option === null || a.plafond_par_option <= a.budget_points,
    "Le plafond par option ne dépasse pas le budget de points.",
  );
export type AtelierCreation = z.infer<typeof atelierCreationSchema>;

/** PATCH /plans/:id/ateliers/:atelierId (brouillon) : les options, si fournies, remplacent les actuelles. */
export const atelierModificationSchema = z
  .object({
    titre: ligne(200).optional(),
    consigne: z.string().trim().max(4000).optional(),
    methodes: methodesSchema.optional(),
    budget_points: budgetSchema.optional(),
    plafond_par_option: budgetSchema.nullable().optional(),
    axes: z.object({ x: axeSchema, y: axeSchema }).strict().optional(),
    options: optionsSchema.optional(),
  })
  .strict()
  .refine((m) => Object.keys(m).length > 0, "Aucune modification.");
export type AtelierModification = z.infer<typeof atelierModificationSchema>;

export const atelierParamsSchema = z.object({ id: uuid, atelierId: uuid }).strict();
export const ateliersListeQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

/** POST /plans/:id/ateliers/:atelierId/participants. */
export const atelierParticipantSchema = z.object({ utilisateur_id: uuid }).strict();

const optionUnique = <T extends { option_id: string }>(lignes: T[]) =>
  new Set(lignes.map((l) => l.option_id)).size === lignes.length;

export const contributionVoteSchema = z
  .object({
    points: z
      .array(z.object({ option_id: uuid, points: z.number().int().min(0).max(100) }).strict())
      .min(1)
      .max(OPTIONS_ATELIER_MAX)
      .refine(optionUnique, "Option répétée."),
  })
  .strict();
export const contributionPriorisationSchema = z
  .object({
    classement: z
      .array(uuid)
      .min(1)
      .max(OPTIONS_ATELIER_MAX)
      .refine((c) => new Set(c).size === c.length, "Option classée deux fois."),
  })
  .strict();
export const contributionMatriceSchema = z
  .object({
    positions: z
      .array(
        z
          .object({
            option_id: uuid,
            x: z.number().int().min(1).max(5),
            y: z.number().int().min(1).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(OPTIONS_ATELIER_MAX)
      .refine(optionUnique, "Option placée deux fois."),
  })
  .strict();
export type AtelierContributionVote = z.infer<typeof contributionVoteSchema>;
export type AtelierContributionPriorisation = z.infer<typeof contributionPriorisationSchema>;
export type AtelierContributionMatrice = z.infer<typeof contributionMatriceSchema>;

export const SCHEMAS_CONTRIBUTION = {
  vote: contributionVoteSchema,
  priorisation: contributionPriorisationSchema,
  matrice: contributionMatriceSchema,
} as const;

/** PUT …/contribution/:methode (cabinet) et /portail/ateliers/:id/contribution/:methode. */
export const atelierMethodeParamsSchema = z
  .object({ id: uuid, atelierId: uuid, methode: z.enum(METHODES_ATELIER) })
  .strict();
export const portailAtelierParamsSchema = z.object({ id: uuid }).strict();
export const portailAtelierMethodeParamsSchema = z
  .object({ id: uuid, methode: z.enum(METHODES_ATELIER) })
  .strict();
export const portailAteliersQuerySchema = ateliersListeQuerySchema;
