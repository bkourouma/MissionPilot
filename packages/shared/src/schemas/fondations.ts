import { z } from "zod";

/*
 * Fondations de la vague 1 (V3, PRD complémentaire) : vocabulaire commun aux
 * lots référentiel de méthodes (STD), dossier client (DOS), registre des
 * preuves (PRV), agents IA (AGT) et qualité (QUA). Chaque lot ajoute les
 * schémas de SES routes dans son propre fichier ; celui-ci ne porte que les
 * types partagés.
 *
 * La forme JSON d'un facteur de contexte et d'une règle de modulation est
 * IDENTIQUE aux types du moteur (`packages/engines/src/modulation/types.ts`) :
 * une règle validée ici se stocke telle quelle (jsonb) et s'évalue sans
 * conversion. Les bornes sont celles du moteur (REGLES_MODULATION_MAX…).
 */

// ---------------------------------------------------------------------------
// Classes de risque (QUA-01) et niveaux d'autonomie (AGT-03)
// ---------------------------------------------------------------------------

export const CLASSES_RISQUE = ["R0", "R1", "R2", "R3"] as const;
export type ClasseRisque = (typeof CLASSES_RISQUE)[number];
export const classeRisqueSchema = z.enum(CLASSES_RISQUE);

export const CLASSE_RISQUE_LIBELLES: Record<ClasseRisque, string> = {
  R0: "Opérationnel interne",
  R1: "Analyse interne",
  R2: "Livrable client",
  R3: "Engageant",
};

export const NIVEAUX_AUTONOMIE = ["N0", "N1", "N2", "N3", "N4"] as const;
export type NiveauAutonomie = (typeof NIVEAUX_AUTONOMIE)[number];
export const niveauAutonomieSchema = z.enum(NIVEAUX_AUTONOMIE);

export const NIVEAU_AUTONOMIE_LIBELLES: Record<NiveauAutonomie, string> = {
  N0: "Pas d'IA",
  N1: "Suggestion à la demande",
  N2: "Brouillon automatique, validation obligatoire",
  N3: "Exécution automatique interne, contrôle par échantillonnage",
  N4: "Exécution automatique, y compris vers le client",
};

// ---------------------------------------------------------------------------
// Preuves (PRV-01, PRV-02)
// ---------------------------------------------------------------------------

export const FIABILITES_PREUVE = ["A", "B", "C", "D"] as const;
export type FiabilitePreuve = (typeof FIABILITES_PREUVE)[number];
export const fiabilitePreuveSchema = z.enum(FIABILITES_PREUVE);

export const TYPES_SOURCE_PREUVE = [
  "questionnaire",
  "entretien",
  "observation",
  "document",
  "donnee_externe",
] as const;
export type TypeSourcePreuve = (typeof TYPES_SOURCE_PREUVE)[number];
export const typeSourcePreuveSchema = z.enum(TYPES_SOURCE_PREUVE);

export const TYPE_SOURCE_PREUVE_LIBELLES: Record<TypeSourcePreuve, string> = {
  questionnaire: "Questionnaire",
  entretien: "Entretien",
  observation: "Observation de terrain",
  document: "Document",
  donnee_externe: "Donnée externe",
};

export const SENS_PREUVE = ["pour", "contre"] as const;
export type SensPreuve = (typeof SENS_PREUVE)[number];
export const sensPreuveSchema = z.enum(SENS_PREUVE);

// ---------------------------------------------------------------------------
// Facteurs de contexte (STD-04)
// ---------------------------------------------------------------------------

/** Bornes du moteur de modulation (`packages/engines/src/modulation/types.ts`). */
export const REGLES_MODULATION_MAX = 500;
export const EFFETS_PAR_REGLE_MAX = 50;
export const PROFONDEUR_CONDITION_MAX = 8;
export const NOEUDS_CONDITION_MAX = 100;
export const PRIORITE_MODULATION_MAX = 1_000;
export const VALEURS_LISTE_MAX = 200;
export const FACTEURS_CONTEXTE_MAX = 200;

/**
 * Code de référentiel (facteur, brique, item, cible, choix, recommandation,
 * règle) : minuscules, chiffres, `_`, `.` et `-`, 120 caractères au plus (un
 * identifiant uuid convient aussi). Plus strict que le moteur, qui accepte
 * toute chaîne sans blanc de bord.
 */
export const codeReferentielSchema = z
  .string()
  .regex(
    /^[a-z0-9_.-]{1,120}$/,
    "Code : minuscules, chiffres, « _ », « . » et « - », 120 caractères au plus.",
  );

export const TYPES_FACTEUR_CONTEXTE = ["booleen", "nombre", "enumeration", "liste"] as const;
export type TypeFacteurContexte = (typeof TYPES_FACTEUR_CONTEXTE)[number];
export const typeFacteurContexteSchema = z.enum(TYPES_FACTEUR_CONTEXTE);

const valeursPermisesSchema = z
  .array(codeReferentielSchema)
  .min(1)
  .max(VALEURS_LISTE_MAX)
  .refine((v) => new Set(v).size === v.length, "Valeurs en double.");

const nombreFini = z.number().finite();

export const definitionFacteurContexteSchema = z
  .discriminatedUnion("type", [
    z.object({ code: codeReferentielSchema, type: z.literal("booleen") }).strict(),
    z
      .object({
        code: codeReferentielSchema,
        type: z.literal("nombre"),
        min: nombreFini.optional(),
        max: nombreFini.optional(),
      })
      .strict(),
    z
      .object({
        code: codeReferentielSchema,
        type: z.literal("enumeration"),
        valeurs: valeursPermisesSchema,
      })
      .strict(),
    z
      .object({
        code: codeReferentielSchema,
        type: z.literal("liste"),
        valeurs: valeursPermisesSchema,
      })
      .strict(),
  ])
  .refine(
    (d) => d.type !== "nombre" || d.min === undefined || d.max === undefined || d.min <= d.max,
    "Borne minimale supérieure à la maximale.",
  );
export type DefinitionFacteurContexte = z.infer<typeof definitionFacteurContexteSchema>;

export const valeurFacteurContexteSchema = z.union([
  z.boolean(),
  nombreFini,
  codeReferentielSchema,
  z.array(codeReferentielSchema).max(VALEURS_LISTE_MAX),
]);
export type ValeurFacteurContexte = z.infer<typeof valeurFacteurContexteSchema>;

/** Contexte d'une mission : valeur par code de facteur ; `null` = non renseigné. */
export const contexteModulationSchema = z
  .record(codeReferentielSchema, valeurFacteurContexteSchema.nullable())
  .refine((c) => Object.keys(c).length <= FACTEURS_CONTEXTE_MAX, "Trop de facteurs.");
export type ContexteModulationApi = z.infer<typeof contexteModulationSchema>;

// ---------------------------------------------------------------------------
// Règles de modulation (STD-05)
// ---------------------------------------------------------------------------

export const COMPARATEURS_MODULATION = [
  "egal",
  "different",
  "inferieur",
  "inferieur_ou_egal",
  "superieur",
  "superieur_ou_egal",
  "dans",
  "contient",
] as const;
export type ComparateurModulation = (typeof COMPARATEURS_MODULATION)[number];
export const comparateurModulationSchema = z.enum(COMPARATEURS_MODULATION);

const listeComparee = <T extends z.ZodTypeAny>(element: T) =>
  z.array(element).min(1).max(VALEURS_LISTE_MAX);

export const valeurCompareeSchema = z.union([
  z.boolean(),
  nombreFini,
  codeReferentielSchema,
  listeComparee(codeReferentielSchema),
  listeComparee(nombreFini),
]);
export type ValeurComparee = z.infer<typeof valeurCompareeSchema>;

/** Condition d'une règle (récursive) ; profondeur et taille contrôlées par la règle. */
export type ConditionModulationApi =
  | { type: "tous"; conditions: ConditionModulationApi[] }
  | { type: "au_moins_un"; conditions: ConditionModulationApi[] }
  | { type: "non"; condition: ConditionModulationApi }
  | {
      type: "comparaison";
      facteur: string;
      comparateur: ComparateurModulation;
      valeur: ValeurComparee;
    }
  | { type: "brique_active"; brique: string };

export const conditionModulationSchema: z.ZodType<ConditionModulationApi> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("tous"),
        conditions: z.array(conditionModulationSchema).min(1).max(NOEUDS_CONDITION_MAX),
      })
      .strict(),
    z
      .object({
        type: z.literal("au_moins_un"),
        conditions: z.array(conditionModulationSchema).min(1).max(NOEUDS_CONDITION_MAX),
      })
      .strict(),
    z.object({ type: z.literal("non"), condition: conditionModulationSchema }).strict(),
    z
      .object({
        type: z.literal("comparaison"),
        facteur: codeReferentielSchema,
        comparateur: comparateurModulationSchema,
        valeur: valeurCompareeSchema,
      })
      .strict(),
    z.object({ type: z.literal("brique_active"), brique: codeReferentielSchema }).strict(),
  ]),
);

/** Imbrication JSON maximale d'une condition reçue (deux niveaux par niveau de condition). */
const IMBRICATION_CONDITION_MAX = 2 * PROFONDEUR_CONDITION_MAX + 2;

/**
 * Vrai si l'imbrication JSON de la valeur ne dépasse pas `max` : parcours
 * ITÉRATIF, borné, AVANT l'analyse récursive du schéma, pour qu'une entrée
 * hostile très imbriquée soit refusée en 400 et n'épuise jamais la pile.
 */
export function imbricationAuPlus(valeur: unknown, max: number): boolean {
  const pile: [unknown, number][] = [[valeur, 1]];
  let objets = 0;
  while (pile.length > 0) {
    const [v, profondeur] = pile.pop()!;
    if (typeof v !== "object" || v === null) continue;
    objets += 1;
    if (profondeur > max || objets > 10_000) return false;
    for (const x of Object.values(v)) pile.push([x, profondeur + 1]);
  }
  return true;
}

/** Condition reçue d'une requête : imbrication bornée, puis schéma récursif. */
export const conditionModulationBorneeSchema = z
  .unknown()
  .refine(
    (v) => imbricationAuPlus(v, IMBRICATION_CONDITION_MAX),
    `Condition trop imbriquée : profondeur ${PROFONDEUR_CONDITION_MAX} au plus.`,
  )
  .pipe(conditionModulationSchema);

export const TYPES_EFFET_MODULATION = [
  "activer_brique",
  "retirer_brique",
  "activer_item",
  "retirer_item",
  "ponderation",
  "seuil",
  "benchmark",
  "gabarit",
  "formulation",
  "recommandation_candidate",
  "relever_classe_risque",
] as const;
export type TypeEffetModulation = (typeof TYPES_EFFET_MODULATION)[number];

const effetChoix = <T extends "benchmark" | "gabarit" | "formulation">(type: T) =>
  z
    .object({ type: z.literal(type), cible: codeReferentielSchema, choix: codeReferentielSchema })
    .strict();

export const effetModulationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activer_brique"), brique: codeReferentielSchema }).strict(),
  z.object({ type: z.literal("retirer_brique"), brique: codeReferentielSchema }).strict(),
  z.object({ type: z.literal("activer_item"), item: codeReferentielSchema }).strict(),
  z.object({ type: z.literal("retirer_item"), item: codeReferentielSchema }).strict(),
  z
    .object({
      type: z.literal("ponderation"),
      cible: codeReferentielSchema,
      valeur: nombreFini.min(0),
    })
    .strict(),
  z.object({ type: z.literal("seuil"), cible: codeReferentielSchema, valeur: nombreFini }).strict(),
  effetChoix("benchmark"),
  effetChoix("gabarit"),
  effetChoix("formulation"),
  z
    .object({ type: z.literal("recommandation_candidate"), recommandation: codeReferentielSchema })
    .strict(),
  z
    .object({
      type: z.literal("relever_classe_risque"),
      cible: codeReferentielSchema,
      classe: classeRisqueSchema,
    })
    .strict(),
]);
export type EffetModulationApi = z.infer<typeof effetModulationSchema>;

const ORDONNES: readonly ComparateurModulation[] = [
  "inferieur",
  "inferieur_ou_egal",
  "superieur",
  "superieur_ou_egal",
];

/** Forme de la valeur attendue selon le comparateur (règle du moteur, `structure.ts`). */
export function valeurCompareeAdmise(
  comparateur: ComparateurModulation,
  valeur: ValeurComparee,
): boolean {
  if (ORDONNES.includes(comparateur)) return typeof valeur === "number";
  if (comparateur === "dans") return Array.isArray(valeur);
  if (comparateur === "contient") {
    return typeof valeur === "string" || (Array.isArray(valeur) && typeof valeur[0] === "string");
  }
  return !Array.isArray(valeur);
}

/** Parcourt la condition : profondeur, nombre de nœuds et forme des valeurs comparées. */
function controlerCondition(
  condition: ConditionModulationApi,
  ctx: z.RefinementCtx,
  chemin: (string | number)[],
  profondeur: number,
  etat: { noeuds: number; trop: boolean },
): void {
  if (etat.trop) return;
  etat.noeuds += 1;
  if (profondeur > PROFONDEUR_CONDITION_MAX || etat.noeuds > NOEUDS_CONDITION_MAX) {
    etat.trop = true;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: chemin,
      message: `Condition trop complexe : profondeur ${PROFONDEUR_CONDITION_MAX} et ${NOEUDS_CONDITION_MAX} éléments au plus.`,
    });
    return;
  }
  if (condition.type === "tous" || condition.type === "au_moins_un") {
    condition.conditions.forEach((c, i) =>
      controlerCondition(c, ctx, [...chemin, "conditions", i], profondeur + 1, etat),
    );
  } else if (condition.type === "non") {
    controlerCondition(condition.condition, ctx, [...chemin, "condition"], profondeur + 1, etat);
  } else if (
    condition.type === "comparaison" &&
    !valeurCompareeAdmise(condition.comparateur, condition.valeur)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...chemin, "valeur"],
      message: "Valeur comparée incompatible avec le comparateur.",
    });
  }
}

export const regleModulationSchema = z
  .object({
    code: codeReferentielSchema,
    libelle: z.string().trim().max(200).optional(),
    priorite: z.number().int().min(0).max(PRIORITE_MODULATION_MAX),
    condition: conditionModulationBorneeSchema,
    effets: z.array(effetModulationSchema).max(EFFETS_PAR_REGLE_MAX),
    active: z.boolean().optional(),
  })
  .strict()
  .superRefine((regle, ctx) =>
    controlerCondition(regle.condition, ctx, ["condition"], 1, { noeuds: 0, trop: false }),
  );
export type RegleModulationApi = z.infer<typeof regleModulationSchema>;

/** Jeu de règles : codes uniques, 500 règles au plus. */
export const jeuReglesModulationSchema = z
  .array(regleModulationSchema)
  .max(REGLES_MODULATION_MAX)
  .superRefine((regles, ctx) => {
    const vus = new Set<string>();
    regles.forEach((r, i) => {
      if (vus.has(r.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "code"],
          message: "Code de règle en double.",
        });
      }
      vus.add(r.code);
    });
  });
