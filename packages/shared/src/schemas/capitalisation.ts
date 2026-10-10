import { z } from "zod";
import { texte } from "./commun";
import { codeReferentielSchema, contexteModulationSchema } from "./fondations";
import { TYPES_LIVRABLE } from "./qualite";

/*
 * Capitalisation (PRD complémentaire §12, lot CAP, vague 3) : retour d'expérience (CAP-01),
 * base d'estimation (CAP-02), analyse des dérogations (CAP-05), matrice de compétences (CAP-06),
 * recherche unifiée (CAP-07). Objets stricts ; le même schéma sert l'API et le web.
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

/* ----- CAP-01 : retour d'expérience ----- */

export const STATUTS_RETOUR_EXPERIENCE = ["brouillon", "valide"] as const;
export type StatutRetourExperience = (typeof STATUTS_RETOUR_EXPERIENCE)[number];

/** Origine d'une version : gabarit déterministe, brouillon IA, ou rédaction humaine. */
export const ORIGINES_RETOUR = ["gabarit", "ia", "humain"] as const;
export type OrigineRetour = (typeof ORIGINES_RETOUR)[number];

export const SECTIONS_RETOUR = ["contexte", "methode", "ecarts", "lecons"] as const;
export type SectionRetour = (typeof SECTIONS_RETOUR)[number];
export const SECTION_RETOUR_LIBELLES: Record<SectionRetour, string> = {
  contexte: "Contexte",
  methode: "Méthode",
  ecarts: "Écarts",
  lecons: "Leçons",
};
export const LONGUEUR_SECTION_RETOUR_MAX = 8000;

/** Nouvelle version rédigée par le chef de mission (les quatre sections, obligatoires). */
export const retourVersionSchema = z
  .object({
    contexte: texte(LONGUEUR_SECTION_RETOUR_MAX),
    methode: texte(LONGUEUR_SECTION_RETOUR_MAX),
    ecarts: texte(LONGUEUR_SECTION_RETOUR_MAX),
    lecons: texte(LONGUEUR_SECTION_RETOUR_MAX),
  })
  .strict();
export type RetourVersion = z.infer<typeof retourVersionSchema>;

/** Validation d'une version précise (évite de valider une version qu'on n'a pas lue). */
export const retourValidationSchema = z
  .object({
    version: z.number().int().min(1).max(1000),
    /** Obligatoire pour une version IA dont un nombre n'a pas été reconnu par la garde-chiffres. */
    acquitte_chiffres: z.boolean().default(false),
  })
  .strict();

export const retoursQuerySchema = z
  .object({
    statut: z.enum(STATUTS_RETOUR_EXPERIENCE).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

/* ----- CAP-02 : base d'estimation ----- */

/** Rattachement d'une tâche de mission à une brique de la méthode (null : détacher). */
export const tacheBriqueSchema = z
  .object({ brique_code: codeReferentielSchema.nullable() })
  .strict();

/**
 * Effectif minimum d'une estimation : plancher 3 (une durée de mission ne se déduit pas d'une ou
 * deux observations), identique au moteur (`EFFECTIF_MINIMUM_PLANCHER`) et revérifié côté serveur.
 */
export const EFFECTIF_MINIMUM_ESTIMATION = { min: 3, defaut: 3, max: 20 } as const;

export const estimationDemandeSchema = z
  .object({
    briques: z
      .array(codeReferentielSchema)
      .min(1)
      .max(100)
      .transform((l) => [...new Set(l)]),
    contexte: contexteModulationSchema.optional(),
    methode_code: codeReferentielSchema.optional(),
    effectif_minimum: z
      .number()
      .int()
      .min(EFFECTIF_MINIMUM_ESTIMATION.min)
      .max(EFFECTIF_MINIMUM_ESTIMATION.max)
      .optional(),
  })
  .strict();
export type EstimationDemande = z.infer<typeof estimationDemandeSchema>;

/* ----- CAP-05 : analyse des dérogations ----- */

export const analyseDerogationsQuerySchema = z
  .object({
    seuil: z.coerce.number().int().min(2).max(100).optional(),
    similarite: z.coerce.number().int().min(10).max(100).optional(),
  })
  .strict();

/** Proposition d'évolution du standard tirée d'un groupe de dérogations (clé de l'analyse). */
export const propositionDerogationsSchema = z
  .object({
    cle: z
      .string()
      .max(300)
      .regex(/^[0-9a-z_-]{1,40}\|[a-z0-9_.-]{1,120}\|[a-z_]{1,40}$/, "Clé de groupe invalide."),
    seuil: z.number().int().min(2).max(100).optional(),
  })
  .strict();

/* ----- CAP-06 : compétences ----- */

export const NIVEAUX_COMPETENCE_API = [1, 2, 3, 4] as const;
export const NIVEAU_COMPETENCE_LIBELLES: Record<number, string> = {
  1: "Notions",
  2: "Pratique",
  3: "Maîtrise",
  4: "Expertise",
};
const niveauCompetenceSchema = z.number().int().min(1).max(4);

export const competenceCreationSchema = z
  .object({
    code: codeReferentielSchema,
    libelle: texte(200),
    description: texte(2000).optional(),
    briques: z
      .array(codeReferentielSchema)
      .max(50)
      .default([])
      .transform((l) => [...new Set(l)]),
    types_livrable: z
      .array(z.enum(TYPES_LIVRABLE))
      .max(TYPES_LIVRABLE.length)
      .default([])
      .transform((l) => [...new Set(l)]),
  })
  .strict();
export type CompetenceCreation = z.infer<typeof competenceCreationSchema>;

export const competenceModificationSchema = z
  .object({
    libelle: texte(200).optional(),
    description: texte(2000).nullable().optional(),
    briques: z
      .array(codeReferentielSchema)
      .max(50)
      .transform((l) => [...new Set(l)])
      .optional(),
    types_livrable: z
      .array(z.enum(TYPES_LIVRABLE))
      .max(TYPES_LIVRABLE.length)
      .transform((l) => [...new Set(l)])
      .optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Au moins un champ attendu.");

export const declarationCompetenceSchema = z
  .object({
    /** Absent : soi-même (collaborateur rattaché à l'utilisateur connecté). */
    collaborateur_id: z.string().uuid().optional(),
    competence_id: z.string().uuid(),
    niveau: niveauCompetenceSchema,
    commentaire: texte(1000).optional(),
  })
  .strict();

export const decisionCompetenceSchema = z
  .object({
    decision: z.enum(["validee", "refusee"]),
    commentaire: texte(1000).optional(),
  })
  .strict()
  .refine((v) => v.decision === "validee" || v.commentaire !== undefined, {
    message: "Un refus est motivé.",
    path: ["commentaire"],
  });

export const matriceQuerySchema = z
  .object({ competence_id: z.string().uuid().optional() })
  .strict();

/* ----- CAP-07 : recherche unifiée ----- */

export const TYPES_RESULTAT_RECHERCHE = [
  "mission",
  "livrable",
  "rapport",
  "preuve",
  "connaissance",
] as const;
export type TypeResultatRecherche = (typeof TYPES_RESULTAT_RECHERCHE)[number];
export const TYPE_RESULTAT_LIBELLES: Record<TypeResultatRecherche, string> = {
  mission: "Mission",
  livrable: "Livrable",
  rapport: "Rapport",
  preuve: "Preuve",
  connaissance: "Retour d'expérience",
};

export const RECHERCHE_LIMITE = { defaut: 10, max: 30 } as const;

export const rechercheQuerySchema = z
  .object({
    q: z.string().trim().min(2, "Deux caractères au moins.").max(200),
    /** Types séparés par des virgules (« mission,preuve ») ; absent : tous. */
    types: z
      .string()
      .max(200)
      .transform((s) => [
        ...new Set(
          s
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t !== ""),
        ),
      ])
      .pipe(z.array(z.enum(TYPES_RESULTAT_RECHERCHE)).max(TYPES_RESULTAT_RECHERCHE.length))
      .optional(),
    limite: z.coerce
      .number()
      .int()
      .min(1)
      .max(RECHERCHE_LIMITE.max)
      .default(RECHERCHE_LIMITE.defaut),
  })
  .strict();
export type RechercheQuery = z.infer<typeof rechercheQuerySchema>;
