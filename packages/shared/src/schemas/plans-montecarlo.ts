import { z } from "zod";

/*
 * Simulation de Monte-Carlo du plan financier (PLA-16, PRD complémentaire
 * §11.3). Ces schémas ne valident que la FORME des saisies, avec les mêmes
 * bornes que le moteur (`@missionpilot/engines`, plan-strategique/monte-carlo)
 * : lois, cibles, tirages, graine. La distribution de la VAN, les
 * probabilités et l'empreinte sortent du moteur ; l'API ne calcule rien.
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

export const GRAINE_MONTE_CARLO_MAX = 4_294_967_295;
export const TIRAGES_MONTE_CARLO_MIN = 100;
export const TIRAGES_MONTE_CARLO_MAX = 2000;
export const TIRAGES_MONTE_CARLO_DEFAUT = 1000;
export const HYPOTHESES_MONTE_CARLO_MAX = 5;
/** Valeur absolue maximale d'un paramètre de loi (points, % ou jours). */
export const AMPLEUR_MAX_LOI_MONTE_CARLO = 1000;

/** Hypothèses pouvant être rendues incertaines (ordre de tirage du moteur). */
export const CIBLES_MONTE_CARLO = [
  "croissanceChiffreAffaires",
  "tauxMargeBrute",
  "tauxChargesVariables",
  "chargesFixes",
  "delaiClientsJours",
] as const;
export type CibleMonteCarlo = (typeof CIBLES_MONTE_CARLO)[number];

export const CIBLE_MONTE_CARLO_LIBELLES: Record<CibleMonteCarlo, string> = {
  croissanceChiffreAffaires: "Croissance du chiffre d'affaires",
  tauxMargeBrute: "Taux de marge brute",
  tauxChargesVariables: "Taux de charges variables",
  chargesFixes: "Charges fixes",
  delaiClientsJours: "Délai de paiement des clients",
};

/** Unité de l'écart tiré pour chaque cible. */
export const CIBLE_MONTE_CARLO_UNITES: Record<CibleMonteCarlo, string> = {
  croissanceChiffreAffaires: "points",
  tauxMargeBrute: "points",
  tauxChargesVariables: "points",
  chargesFixes: "%",
  delaiClientsJours: "jours",
};

export const TYPES_LOI_MONTE_CARLO = ["uniforme", "triangulaire", "normale"] as const;
export type TypeLoiMonteCarlo = (typeof TYPES_LOI_MONTE_CARLO)[number];
export const TYPE_LOI_MONTE_CARLO_LIBELLES: Record<TypeLoiMonteCarlo, string> = {
  uniforme: "Uniforme",
  triangulaire: "Triangulaire",
  normale: "Normale tronquée",
};

const nombre = z
  .number()
  .finite()
  .min(-AMPLEUR_MAX_LOI_MONTE_CARLO)
  .max(AMPLEUR_MAX_LOI_MONTE_CARLO);

const loiBrute = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uniforme"), min: nombre, max: nombre }).strict(),
  z.object({ type: z.literal("triangulaire"), min: nombre, mode: nombre, max: nombre }).strict(),
  z
    .object({
      type: z.literal("normale"),
      moyenne: nombre,
      ecartType: nombre,
      min: nombre,
      max: nombre,
    })
    .strict(),
]);

/** Loi d'un écart, validée comme le moteur (bornes ordonnées, mode et moyenne dans l'intervalle). */
export const loiMonteCarloSchema = loiBrute.superRefine((loi, ctx) => {
  const refuser = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (!(loi.min < loi.max)) refuser("max", "max doit être strictement supérieur à min.");
  if (loi.type === "triangulaire" && (loi.mode < loi.min || loi.mode > loi.max)) {
    refuser("mode", "mode doit être compris entre min et max.");
  }
  if (loi.type === "normale") {
    if (!(loi.ecartType > 0)) refuser("ecartType", "ecartType doit être strictement positif.");
    if (loi.moyenne < loi.min || loi.moyenne > loi.max) {
      refuser("moyenne", "moyenne doit être comprise entre min et max.");
    }
  }
});
export type LoiMonteCarlo = z.infer<typeof loiMonteCarloSchema>;

export const hypotheseIncertaineSchema = z
  .object({ cible: z.enum(CIBLES_MONTE_CARLO), loi: loiMonteCarloSchema })
  .strict();
export type HypotheseIncertaineSaisie = z.infer<typeof hypotheseIncertaineSchema>;

/** Lancement d'une simulation : graine absente = tirée par le serveur (et renvoyée). */
export const planMonteCarloSimulationSchema = z
  .object({
    version: z.number().int().min(1).max(100_000),
    graine: z.number().int().min(0).max(GRAINE_MONTE_CARLO_MAX).optional(),
    tirages: z
      .number()
      .int()
      .min(TIRAGES_MONTE_CARLO_MIN)
      .max(TIRAGES_MONTE_CARLO_MAX)
      .default(TIRAGES_MONTE_CARLO_DEFAUT),
    hypotheses: z.array(hypotheseIncertaineSchema).min(1).max(HYPOTHESES_MONTE_CARLO_MAX),
  })
  .strict()
  .superRefine((corps, ctx) => {
    const vues = new Set<string>();
    corps.hypotheses.forEach((h, i) => {
      if (vues.has(h.cible)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["hypotheses", i, "cible"],
          message: "Une seule loi par hypothèse.",
        });
      }
      vues.add(h.cible);
    });
  });
export type PlanMonteCarloSimulation = z.infer<typeof planMonteCarloSimulationSchema>;

export const planMonteCarloParamsSchema = z
  .object({ id: z.string().uuid(), simId: z.string().uuid() })
  .strict();

export const planMonteCarloListeQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

/** Lois de départ : version du modèle (défaut : la dernière validée, sinon la dernière). */
export const planMonteCarloDefautsQuerySchema = z
  .object({ version: z.coerce.number().int().min(1).max(100_000).optional() })
  .strict();
