import { z } from "zod";
import { grilleNotationSchema, identifiantGrilleSchema } from "../grilles/schemas";
import { texte } from "./commun";

/*
 * Notation (service 1, NOT-01 à NOT-08) : contrat des routes
 * /api/notation/** et /api/missions/:id/notation.
 *
 * - Grilles : la grille générique sert par défaut ; le cabinet la copie et
 *   l'affine (brouillon), un détenteur de « notation.publier » valide.
 * - Calcul : par le moteur (noterQuestionnaire / noterRepondants), sur les
 *   réponses SOUMISES d'un questionnaire de la mission ; résultat figé.
 * - Ajustement motivé (NOT-04) : écart en points (1 décimale), contrôlé par
 *   le moteur (appliquerAjustement).
 * - Revue : brouillon → en revue → publiée (expert métier, NOT-07).
 */

const uuid = z.string().uuid();

export const STRATEGIES_NOTATION = ["ignorer", "penaliser"] as const;
export type StrategieNotation = (typeof STRATEGIES_NOTATION)[number];

export const STATUTS_VERSION_NOTATION = ["brouillon", "en_revue", "publiee", "remplacee"] as const;
export type StatutVersionNotation = (typeof STATUTS_VERSION_NOTATION)[number];

export const STATUT_VERSION_NOTATION_LIBELLES: Record<StatutVersionNotation, string> = {
  brouillon: "Brouillon",
  en_revue: "En revue (expert)",
  publiee: "Publiée",
  remplacee: "Remplacée par un nouveau calcul",
};

/** Création d'une grille du cabinet : copie de la grille générique, d'une grille, ou contenu saisi. */
export const grilleNotationCreationSchema = z
  .object({
    code: identifiantGrilleSchema,
    titre: texte(200).optional(),
    source: z.discriminatedUnion("type", [
      z.object({ type: z.literal("generique") }).strict(),
      z.object({ type: z.literal("copie"), grille_id: uuid }).strict(),
      z.object({ type: z.literal("contenu"), contenu: grilleNotationSchema }).strict(),
    ]),
  })
  .strict();
export type GrilleNotationCreation = z.infer<typeof grilleNotationCreationSchema>;

export const grilleNotationVersionCreationSchema = z
  .object({ contenu: grilleNotationSchema.optional() })
  .strict();

export const grilleNotationVersionModificationSchema = z
  .object({ contenu: grilleNotationSchema })
  .strict();

/**
 * Calcul d'une nouvelle version : questionnaire (envoi) de la mission, grille
 * validée du cabinet (null : grille générique), secteur de pondération (code
 * d'une surcharge de la grille), stratégie des réponses manquantes.
 */
export const calculNotationSchema = z
  .object({
    envoi_id: uuid,
    grille_version_id: uuid.nullable().default(null),
    secteur: identifiantGrilleSchema.nullable().default(null),
    strategie: z.enum(STRATEGIES_NOTATION).default("ignorer"),
  })
  .strict();
export type CalculNotation = z.infer<typeof calculNotationSchema>;

/** Ajustement motivé d'une dimension (NOT-04). */
export const ajustementNotationSchema = z
  .object({
    dimension: identifiantGrilleSchema,
    delta: z.number().finite().min(-100).max(100),
    motif: texte(2000),
  })
  .strict();
export type AjustementNotation = z.infer<typeof ajustementNotationSchema>;

/** Renvoi d'une version en revue vers le brouillon : motif obligatoire. */
export const renvoiNotationSchema = z.object({ motif: texte(2000) }).strict();

export const versionNotationQuerySchema = z
  .object({ version: z.coerce.number().int().min(1).max(100000).optional() })
  .strict();
