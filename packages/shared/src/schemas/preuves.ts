import { z } from "zod";
import { dateIsoSchema, texte } from "./commun";
import {
  classeRisqueSchema,
  codeReferentielSchema,
  fiabilitePreuveSchema,
  sensPreuveSchema,
  TYPES_SOURCE_PREUVE,
  typeSourcePreuveSchema,
} from "./fondations";

/*
 * Registre des preuves (PRV-01 à PRV-05, PRD complémentaire §6) : contrat des routes
 * /api/missions/:id/preuves, /api/missions/:id/assertions, /api/preuves/** et
 * /api/assertions/**. L'indice de solidité n'est JAMAIS reçu : il sort du moteur
 * (packages/engines/src/preuves) et se sert en lecture seule.
 *
 * Aucune route de modification destructive : une correction est une nouvelle version (motif
 * obligatoire), un lien retiré est un événement, un arbitrage est une décision signée.
 */

const uuid = z.string().uuid();

/** Plafonds par mission (déni de service : les synthèses chargent la mission entière). */
export const PREUVES_MISSION_MAX = 5_000;
export const ASSERTIONS_MISSION_MAX = 2_000;
export const DIMENSIONS_MISSION_MAX = 100;
export const DIMENSIONS_PAR_PREUVE_MAX = 20;

export const RATTACHEMENTS_ASSERTION = ["dimension", "hypothese", "risque"] as const;
export type RattachementAssertion = (typeof RATTACHEMENTS_ASSERTION)[number];
export const rattachementAssertionSchema = z.enum(RATTACHEMENTS_ASSERTION);
export const RATTACHEMENT_LIBELLES: Record<RattachementAssertion, string> = {
  dimension: "Dimension",
  hypothese: "Hypothèse",
  risque: "Risque",
};

export const STATUTS_ASSERTION = ["brouillon", "retenue", "abandonnee"] as const;
export type StatutAssertion = (typeof STATUTS_ASSERTION)[number];
export const statutAssertionSchema = z.enum(STATUTS_ASSERTION);
export const STATUT_ASSERTION_LIBELLES: Record<StatutAssertion, string> = {
  brouillon: "Brouillon",
  retenue: "Retenue",
  abandonnee: "Abandonnée",
};

export const DECISIONS_ARBITRAGE = ["contradiction_levee", "contradiction_maintenue"] as const;
export type DecisionArbitrage = (typeof DECISIONS_ARBITRAGE)[number];
export const decisionArbitrageSchema = z.enum(DECISIONS_ARBITRAGE);
export const DECISION_ARBITRAGE_LIBELLES: Record<DecisionArbitrage, string> = {
  contradiction_levee: "Contradiction levée (la preuve contraire est écartée)",
  contradiction_maintenue: "Contradiction maintenue (assumée, l'assertion est nuancée)",
};

export const FIABILITE_LIBELLES: Record<"A" | "B" | "C" | "D", string> = {
  A: "A · Très fiable",
  B: "B · Fiable",
  C: "C · Moyennement fiable",
  D: "D · Peu fiable",
};

export const LECTURES_SOLIDITE = ["solide", "etayee", "fragile"] as const;
export type LectureSoliditeApi = (typeof LECTURES_SOLIDITE)[number];
export const LECTURE_SOLIDITE_LIBELLES: Record<LectureSoliditeApi, string> = {
  solide: "Solide",
  etayee: "Étayée",
  fragile: "Fragile",
};

// ---------------------------------------------------------------------------
// Preuves
// ---------------------------------------------------------------------------

const dimensionsPreuveSchema = z
  .array(codeReferentielSchema)
  .max(DIMENSIONS_PAR_PREUVE_MAX)
  .refine((v) => new Set(v).size === v.length, "Dimensions en double.");

const champsPreuve = {
  type_source: typeSourcePreuveSchema,
  source_precise: texte(300),
  date_preuve: dateIsoSchema,
  /** Membre du cabinet qui a recueilli la preuve (défaut : l'utilisateur qui saisit). */
  auteur_id: uuid.optional(),
  fiabilite: fiabilitePreuveSchema,
  extrait: texte(4000).nullable().optional(),
  fichier_id: uuid.nullable().optional(),
  reponse_id: uuid.nullable().optional(),
  document_id: uuid.nullable().optional(),
  dimensions: dimensionsPreuveSchema.default([]),
  /** L'extrait identifie une personne (verbatim d'entretien). */
  nominatif: z.boolean().default(false),
  /** La personne a donné son accord pour que l'extrait soit cité. */
  accord_nominatif: z.boolean().default(false),
};

function controlerPreuve(
  v: {
    fichier_id?: string | null;
    reponse_id?: string | null;
    document_id?: string | null;
    nominatif: boolean;
    accord_nominatif: boolean;
  },
  ctx: z.RefinementCtx,
): void {
  const liens = [v.fichier_id, v.reponse_id, v.document_id].filter((x) => x != null);
  if (liens.length > 1) {
    ctx.addIssue({
      code: "custom",
      message: "Un seul lien (fichier, réponse ou document) par preuve.",
    });
  }
  if (v.accord_nominatif && !v.nominatif) {
    ctx.addIssue({
      code: "custom",
      path: ["accord_nominatif"],
      message: "L'accord ne s'applique qu'à un extrait nominatif.",
    });
  }
}

export const preuveCreationSchema = z.object(champsPreuve).strict().superRefine(controlerPreuve);

/** Correction : état complet de la nouvelle version et motif (version précédente conservée). */
export const preuveCorrectionSchema = z
  .object({ ...champsPreuve, motif: texte(500) })
  .strict()
  .superRefine(controlerPreuve);

const limite = z.coerce.number().int().min(1).max(100).default(30);
const curseur = z.string().max(500).optional();

export const preuvesQuerySchema = z
  .object({
    limite,
    curseur,
    type_source: typeSourcePreuveSchema.optional(),
    fiabilite: fiabilitePreuveSchema.optional(),
    dimension: codeReferentielSchema.optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Dimensions de la mission
// ---------------------------------------------------------------------------

export const dimensionCreationSchema = z
  .object({ code: codeReferentielSchema, libelle: texte(200) })
  .strict();

export const dimensionModificationSchema = z
  .object({ libelle: texte(200).optional(), actif: z.boolean().optional() })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Au moins un champ à modifier.");

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const champsAssertion = {
  enonce: texte(2000),
  rattachement_type: rattachementAssertionSchema.nullable().optional(),
  rattachement_code: texte(120).nullable().optional(),
  /** Livrable cible (nom libre) ; sa classe de risque détermine le contrôle PRV-03. */
  livrable: texte(200).nullable().optional(),
  classe_risque: classeRisqueSchema,
  statut: statutAssertionSchema.default("brouillon"),
  /** Assertion assumée comme avis d'expert, sans preuve. */
  avis_expert: z.boolean().default(false),
  avis_expert_motif: texte(1000).nullable().optional(),
  /** Signe l'avis d'expert au nom de l'utilisateur qui écrit cette version. */
  signer_avis: z.boolean().default(false),
};

function controlerAssertion(
  v: {
    rattachement_type?: string | null;
    rattachement_code?: string | null;
    avis_expert: boolean;
    avis_expert_motif?: string | null;
    signer_avis: boolean;
  },
  ctx: z.RefinementCtx,
): void {
  if ((v.rattachement_type == null) !== (v.rattachement_code == null)) {
    ctx.addIssue({
      code: "custom",
      path: ["rattachement_code"],
      message: "Le type et le code du rattachement vont ensemble.",
    });
  }
  if (v.avis_expert && v.avis_expert_motif == null) {
    ctx.addIssue({
      code: "custom",
      path: ["avis_expert_motif"],
      message: "Un avis d'expert se justifie.",
    });
  }
  if (!v.avis_expert && (v.avis_expert_motif != null || v.signer_avis)) {
    ctx.addIssue({
      code: "custom",
      path: ["avis_expert"],
      message: "Le motif et la signature supposent un avis d'expert.",
    });
  }
}

export const assertionCreationSchema = z
  .object(champsAssertion)
  .strict()
  .superRefine(controlerAssertion);

export const assertionCorrectionSchema = z
  .object({ ...champsAssertion, motif: texte(500) })
  .strict()
  .superRefine(controlerAssertion);

export const assertionsQuerySchema = z
  .object({
    limite,
    curseur,
    statut: statutAssertionSchema.optional(),
    classe_risque: classeRisqueSchema.optional(),
    livrable: texte(200).optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

export const lienPreuveSchema = z.object({ preuve_id: uuid, sens: sensPreuveSchema }).strict();

export const arbitrageSchema = z
  .object({ preuve_id: uuid, decision: decisionArbitrageSchema, motif: texte(1000) })
  .strict();

// ---------------------------------------------------------------------------
// Synthèses
// ---------------------------------------------------------------------------

/** Liste séparée par des virgules (paramètre de requête) → tableau de types de source. */
const typesSourceListe = z
  .string()
  .max(200)
  .transform((s) => s.split(",").filter((x) => x !== ""))
  .pipe(
    z
      .array(z.enum(TYPES_SOURCE_PREUVE))
      .min(1)
      .refine((v) => new Set(v).size === v.length, "Types en double."),
  );

export const triangulationQuerySchema = z
  .object({
    /** Types de source attendus sur la mission (défaut : les cinq). */
    types_attendus: typesSourceListe.optional(),
    /** Types distincts pour qu'une dimension soit triangulée (défaut 2). */
    types_minimum: z.coerce.number().int().min(1).max(TYPES_SOURCE_PREUVE.length).optional(),
    fiabilite_minimale: fiabilitePreuveSchema.optional(),
  })
  .strict();

export const controleQuerySchema = z.object({ livrable: texte(200).optional() }).strict();

export const contradictionsQuerySchema = z
  .object({ resolues: z.enum(["oui", "non"]).default("non") })
  .strict();
