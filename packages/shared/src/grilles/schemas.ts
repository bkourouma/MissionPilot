import { z } from "zod";
import { dateIsoSchema } from "../schemas/commun";

/*
 * Schémas des définitions de questionnaires (SOC-10) et des grilles de
 * notation (NOT-01), partagés par l'API et l'interface. Ils contrôlent la
 * FORME (types, longueurs, bornes) ; la cohérence (références des
 * conditions, cycles, profondeur, accord grille/questionnaire) est vérifiée
 * par les moteurs de `@missionpilot/engines` (`validerDefinition`,
 * `validerGrille`, `verifierCoherence`). La profondeur des conditions est EN
 * PLUS bornée ici, avant toute récursion (`conditionTropProfonde`), pour
 * qu'un corps de requête très imbriqué réponde 400 et non par un débordement
 * de pile.
 *
 * Les types déclarés ici sont structurellement identiques à ceux des moteurs.
 */

/** Identifiant stable : minuscules, chiffres, `_`, `.`, `-`, 80 caractères au plus. */
export const identifiantGrilleSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_.-]{0,79}$/,
    "Identifiant : minuscules, chiffres, « _ », « . » ou « - », 80 caractères au plus.",
  );

const libelle = (max: number) => z.string().trim().min(1).max(max);
const points = z.number().finite().min(0).max(100);

/* ----- Conditions d'affichage ----- */

export type ValeurConditionAffichage = string | number | boolean;

export type ConditionAffichage =
  | { op: "egal"; question: string; valeur: ValeurConditionAffichage }
  | { op: "different"; question: string; valeur: ValeurConditionAffichage }
  | { op: "dans"; question: string; valeurs: ValeurConditionAffichage[] }
  | { op: "superieur"; question: string; valeur: number | string }
  | { op: "inferieur"; question: string; valeur: number | string }
  | { op: "vide"; question: string }
  | { op: "et"; conditions: ConditionAffichage[] }
  | { op: "ou"; conditions: ConditionAffichage[] }
  | { op: "non"; condition: ConditionAffichage };

const valeurCondition = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

/**
 * Profondeur maximale d'une condition d'affichage : une comparaison vaut 1,
 * chaque combinaison (`et`, `ou`, `non`) ajoute 1 (même règle que le moteur,
 * `PROFONDEUR_MAX_CONDITION` de @missionpilot/engines).
 */
export const PROFONDEUR_MAX_CONDITION = 5;

/**
 * Vrai si une condition NON ENCORE VALIDÉE dépasse `max` niveaux. Parcours
 * ITÉRATIF à pile explicite, borné par la profondeur : une entrée
 * malveillante très imbriquée (ou cyclique) ne fait jamais déborder la pile
 * d'appels, contrairement à la récursion de `z.lazy`.
 */
export function conditionTropProfonde(valeur: unknown, max = PROFONDEUR_MAX_CONDITION): boolean {
  const pile: [unknown, number][] = [[valeur, 1]];
  for (let element = pile.pop(); element; element = pile.pop()) {
    const [noeud, profondeur] = element;
    if (typeof noeud !== "object" || noeud === null) continue;
    const { op, condition, conditions } = noeud as Record<string, unknown>;
    const enfants = op === "non" ? [condition] : op === "et" || op === "ou" ? conditions : null;
    if (!Array.isArray(enfants) || enfants.length === 0) continue;
    if (profondeur + 1 > max) return true;
    for (const enfant of enfants) pile.push([enfant, profondeur + 1]);
  }
  return false;
}

const conditionNonBornee: z.ZodType<ConditionAffichage> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z
      .object({ op: z.literal("egal"), question: identifiantGrilleSchema, valeur: valeurCondition })
      .strict(),
    z
      .object({
        op: z.literal("different"),
        question: identifiantGrilleSchema,
        valeur: valeurCondition,
      })
      .strict(),
    z
      .object({
        op: z.literal("dans"),
        question: identifiantGrilleSchema,
        valeurs: z.array(valeurCondition).min(1).max(50),
      })
      .strict(),
    z
      .object({
        op: z.literal("superieur"),
        question: identifiantGrilleSchema,
        valeur: z.union([z.number().finite(), z.string().max(10)]),
      })
      .strict(),
    z
      .object({
        op: z.literal("inferieur"),
        question: identifiantGrilleSchema,
        valeur: z.union([z.number().finite(), z.string().max(10)]),
      })
      .strict(),
    z.object({ op: z.literal("vide"), question: identifiantGrilleSchema }).strict(),
    z
      .object({ op: z.literal("et"), conditions: z.array(conditionNonBornee).min(1).max(20) })
      .strict(),
    z
      .object({ op: z.literal("ou"), conditions: z.array(conditionNonBornee).min(1).max(20) })
      .strict(),
    z.object({ op: z.literal("non"), condition: conditionNonBornee }).strict(),
  ]),
);

/**
 * Condition d'affichage : profondeur bornée AVANT la validation récursive de
 * Zod (erreur fatale, la récursion n'est pas entamée), puis forme.
 */
export const conditionAffichageSchema: z.ZodType<ConditionAffichage, z.ZodTypeDef, unknown> =
  z.preprocess((valeur, ctx) => {
    if (conditionTropProfonde(valeur)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Condition trop imbriquée : ${PROFONDEUR_MAX_CONDITION} niveaux au plus.`,
        fatal: true,
      });
      return z.NEVER;
    }
    return valeur;
  }, conditionNonBornee);

/* ----- Questions ----- */

const commun = {
  id: identifiantGrilleSchema,
  libelle: libelle(500),
  aide: libelle(1_000).optional(),
  obligatoire: z.boolean(),
  condition: conditionAffichageSchema.optional(),
};

const optionChoixSchema = z
  .object({ code: identifiantGrilleSchema, libelle: libelle(200) })
  .strict();
const options = z.array(optionChoixSchema).min(2).max(50);

export const questionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...commun,
      type: z.literal("likert"),
      points: z.number().int().min(2).max(10),
      libelles: z.array(libelle(120)).min(2).max(10),
    })
    .strict(),
  z.object({ ...commun, type: z.literal("choix_unique"), options }).strict(),
  z
    .object({
      ...commun,
      type: z.literal("choix_multiple"),
      options,
      minSelections: z.number().int().min(1).optional(),
      maxSelections: z.number().int().min(1).optional(),
    })
    .strict(),
  z
    .object({
      ...commun,
      type: z.literal("texte"),
      longueurMax: z.number().int().min(1).max(20_000).optional(),
    })
    .strict(),
  z
    .object({
      ...commun,
      type: z.literal("numerique"),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      unite: libelle(30).optional(),
      entier: z.boolean().optional(),
    })
    .strict(),
  z.object({ ...commun, type: z.literal("oui_non") }).strict(),
  z
    .object({
      ...commun,
      type: z.literal("date"),
      min: dateIsoSchema.optional(),
      max: dateIsoSchema.optional(),
    })
    .strict(),
]);
export type QuestionQuestionnaire = z.infer<typeof questionSchema>;

export const sectionQuestionnaireSchema = z
  .object({
    id: identifiantGrilleSchema,
    titre: libelle(200),
    description: libelle(2_000).optional(),
    condition: conditionAffichageSchema.optional(),
    questions: z.array(questionSchema).min(1).max(200),
  })
  .strict();
export type SectionQuestionnaire = z.infer<typeof sectionQuestionnaireSchema>;

export const definitionQuestionnaireSchema = z
  .object({
    id: identifiantGrilleSchema,
    version: z.number().int().min(1),
    titre: libelle(200),
    sections: z.array(sectionQuestionnaireSchema).min(1).max(50),
  })
  .strict();
export type DefinitionQuestionnaireDonnees = z.infer<typeof definitionQuestionnaireSchema>;

/* ----- Grilles de notation ----- */

const pointsOptionSchema = z.object({ code: identifiantGrilleSchema, points }).strict();

export const regleConversionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("likert"),
      points: z.number().int().min(2).max(10),
      inverse: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("choix"), valeurs: z.array(pointsOptionSchema).min(1).max(50) })
    .strict(),
  z
    .object({
      type: z.literal("choix_multiple"),
      valeurs: z.array(pointsOptionSchema).min(1).max(50),
    })
    .strict(),
  z.object({ type: z.literal("oui_non"), oui: points, non: points }).strict(),
  z
    .object({
      type: z.literal("seuils"),
      paliers: z
        .array(z.object({ min: z.number().finite(), points }).strict())
        .min(1)
        .max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("interpolation"),
      points: z
        .array(z.object({ x: z.number().finite(), y: points }).strict())
        .min(2)
        .max(20),
    })
    .strict(),
]);
export type RegleConversionDonnees = z.infer<typeof regleConversionSchema>;

const poids = z.number().finite().min(0).max(10_000);

export const indicateurGrilleSchema = z
  .object({
    id: identifiantGrilleSchema,
    question: identifiantGrilleSchema,
    poids: poids.refine((p) => p > 0, "Le poids d'un indicateur doit être positif."),
    conversion: regleConversionSchema,
  })
  .strict();

export const dimensionGrilleSchema = z
  .object({
    id: identifiantGrilleSchema,
    libelle: libelle(200),
    famille: identifiantGrilleSchema,
    poids,
    indicateurs: z.array(indicateurGrilleSchema).min(1).max(100),
  })
  .strict();

export const surchargeSecteurSchema = z
  .object({
    secteur: identifiantGrilleSchema,
    libelle: libelle(200).optional(),
    poids: z.array(z.object({ dimension: identifiantGrilleSchema, poids }).strict()).max(50),
  })
  .strict();

export const grilleNotationSchema = z
  .object({
    id: identifiantGrilleSchema,
    version: z.number().int().min(1),
    titre: libelle(200),
    dimensions: z.array(dimensionGrilleSchema).min(1).max(50),
    secteurs: z.array(surchargeSecteurSchema).max(50).optional(),
  })
  .strict();
export type GrilleNotationDonnees = z.infer<typeof grilleNotationSchema>;
