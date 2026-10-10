import { z } from "zod";
import { identifiantGrilleSchema } from "../grilles/schemas";
import {
  MESSAGE_CORPS_VIDE,
  auMoinsUnChamp,
  dateIsoBorneeSchema,
  texte,
  texteOptionnel,
} from "./commun";

/*
 * Notation augmentée (PRD complémentaire §11.1) : contrat des routes
 * /api/notation/banque, /api/notation/parametres, /api/notation/calibrations,
 * /api/notation/initiatives-types, /api/missions/:id/notation/selections et
 * /api/notations/:id/{constats,confiance,explication,plans-action}.
 *
 * - NOT-09 : banque d'items (contenu au format du moteur, contrôlé en plus par
 *   `exigerItemValide`) ; sélection adaptative par le moteur ou proposition contrôlée.
 * - NOT-11 : paramètres de confiance du cabinet (seuil à 4 décimales).
 * - NOT-12 : classe visée du simulateur.
 * - NOT-13 : sessions de calibrage et cotations.
 * - NOT-17 : initiatives types, impacts observés, plan d'action.
 */

const uuid = z.string().uuid();
const libelle = (max: number) => z.string().trim().min(1).max(max);

export const PUBLICS_ITEM_NOTATION = ["tous", "dirigeant", "manager", "equipe", "externe"] as const;
export type PublicItemNotation = (typeof PUBLICS_ITEM_NOTATION)[number];
export const PUBLIC_ITEM_LIBELLES: Record<PublicItemNotation, string> = {
  tous: "Tous publics",
  dirigeant: "Dirigeants",
  manager: "Managers",
  equipe: "Équipes",
  externe: "Parties externes",
};
const publicSchema = z.enum(PUBLICS_ITEM_NOTATION);

/** Contenu d'un item de la banque (forme identique au type `ItemBanque` du moteur). */
export const itemBanqueSchema = z
  .object({
    code: identifiantGrilleSchema,
    dimension: identifiantGrilleSchema,
    pratique: identifiantGrilleSchema,
    intitule: libelle(200),
    echelle: z
      .object({
        niveaux: z.number().int().min(2).max(10),
        libelles: z.array(libelle(120)).min(2).max(10),
      })
      .strict(),
    ancrages: z
      .array(
        z
          .object({
            niveau: z.number().int().min(1).max(10),
            comportement: libelle(1000),
            exemples: z
              .array(z.object({ contexte: libelle(200), texte: libelle(1000) }).strict())
              .max(10)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    formulations: z
      .array(z.object({ public: publicSchema, texte: libelle(500) }).strict())
      .min(1)
      .max(PUBLICS_ITEM_NOTATION.length),
    poids: z.number().finite().gt(0).max(100),
    priorite: z.number().int().min(1).max(9),
    dureeSecondes: z.number().int().min(5).max(600),
    etalonnage: z
      .object({
        echantillon: z.number().int().min(0).max(1_000_000),
        moyenne: z.number().finite().min(0).max(10),
        ecartType: z.number().finite().min(0).max(10),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ItemBanqueDonnees = z.infer<typeof itemBanqueSchema>;

export const itemBanqueCorpsSchema = z.object({ contenu: itemBanqueSchema }).strict();

export const banqueListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
    dimension: identifiantGrilleSchema.optional(),
    statut: z.enum(["brouillon", "valide"]).optional(),
  })
  .strict();

const listeIdentifiants = (max: number) => z.array(identifiantGrilleSchema).max(max);

export const reglesSelectionSchema = z
  .object({
    public: publicSchema,
    dimensions: listeIdentifiants(50).min(1).optional(),
    max_par_dimension: z.number().int().min(1).max(50).default(3),
    duree_max_secondes: z.number().int().min(5).max(86_400).optional(),
    exclure: listeIdentifiants(500).optional(),
    pratiques_connues: listeIdentifiants(500).optional(),
  })
  .strict();
export type ReglesSelectionNotation = z.infer<typeof reglesSelectionSchema>;

/**
 * Sélection d'un questionnaire adaptatif : par le moteur (sans `proposition`), ou proposition
 * (IA ou consultant) contrôlée par le moteur — jamais d'item hors banque validée ni de
 * formulation libre.
 */
export const selectionNotationSchema = z
  .object({
    regles: reglesSelectionSchema,
    proposition: z
      .array(z.object({ code: identifiantGrilleSchema, public: publicSchema }).strict())
      .min(1)
      .max(200)
      .optional(),
    titre: libelle(200).optional(),
    enregistrer: z.boolean().default(false),
  })
  .strict();
export type SelectionNotation = z.infer<typeof selectionNotationSchema>;

/**
 * Planchers des paramètres de confiance : ils empêchent de vider la garde de publication de sa
 * substance (un seuil nul ou un seul répondant la rend sans objet). À CALIBRER AU PILOTE ; doublés
 * en base par la migration 0404 (CHECK) : les changer exige une nouvelle migration.
 */
export const SEUIL_CONFIANCE_PLANCHER = 0.3;
export const REPONDANTS_CIBLE_PLANCHER = 2;

/**
 * Seuil de confiance (de `SEUIL_CONFIANCE_PLANCHER` à 1, 4 décimales au plus) et cible de
 * répondants (au moins `REPONDANTS_CIBLE_PLANCHER`) du cabinet.
 */
export const parametresNotationSchema = z
  .object({
    seuil_confiance: z
      .number()
      .min(SEUIL_CONFIANCE_PLANCHER, `Seuil de confiance : ${SEUIL_CONFIANCE_PLANCHER} au moins.`)
      .max(1)
      .refine(
        (v) => Math.abs(Math.round(v * 10_000) - v * 10_000) < 1e-6,
        "Quatre décimales au plus.",
      )
      .optional(),
    repondants_cible: z
      .number()
      .int()
      .min(
        REPONDANTS_CIBLE_PLANCHER,
        `Cible de répondants : ${REPONDANTS_CIBLE_PLANCHER} au moins.`,
      )
      .max(1000)
      .optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const CLASSES_VISEES_NOTATION = ["A", "B", "C", "D"] as const;

export const explicationNotationQuerySchema = z
  .object({
    version: z.coerce.number().int().min(1).max(100000).optional(),
    cible: z.enum(CLASSES_VISEES_NOTATION).optional(),
  })
  .strict();

export const calibrationCreationSchema = z
  .object({
    titre: texte(200),
    cas: z
      .array(z.object({ code: identifiantGrilleSchema, libelle: libelle(200) }).strict())
      .min(1)
      .max(200)
      .refine((l) => new Set(l.map((c) => c.code)).size === l.length, "Code de cas en double."),
    niveaux: z.number().int().min(2).max(10).default(5),
    tolerance: z.number().int().min(0).max(9).default(0),
    notation_id: uuid.nullable().default(null),
  })
  .strict()
  .refine((v) => v.tolerance < v.niveaux, "La tolérance est inférieure au nombre de niveaux.");

export const cotationsCalibrationSchema = z
  .object({
    cotations: z
      .array(
        z
          .object({
            cas: identifiantGrilleSchema,
            niveau: z.number().int().min(1).max(10),
            motif: texteOptionnel(2000),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .refine((l) => new Set(l.map((c) => c.cas)).size === l.length, "Cas coté deux fois."),
  })
  .strict();

export const clotureCalibrationSchema = z.object({ conclusion: texte(4000) }).strict();

const dimensionsCiblees = z
  .array(identifiantGrilleSchema)
  .min(1)
  .max(20)
  .refine((l) => new Set(l).size === l.length, "Dimension en double.");

export const initiativeNotationCreationSchema = z
  .object({
    code: identifiantGrilleSchema,
    titre: texte(200),
    description: texteOptionnel(4000),
    dimensions: dimensionsCiblees,
    effort: z.number().int().min(1).max(5),
    duree_mois: z.number().int().min(1).max(60),
  })
  .strict();

export const initiativeNotationModificationSchema = z
  .object({
    titre: texte(200).optional(),
    description: texteOptionnel(4000),
    dimensions: dimensionsCiblees.optional(),
    effort: z.number().int().min(1).max(5).optional(),
    duree_mois: z.number().int().min(1).max(60).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const impactInitiativeNotationSchema = z
  .object({
    secteur: identifiantGrilleSchema.nullable().default(null),
    taille: identifiantGrilleSchema.nullable().default(null),
    gain: z
      .number()
      .min(0)
      .max(100)
      .refine((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-6, "Une décimale au plus."),
    source: texte(500),
    observe_le: dateIsoBorneeSchema,
  })
  .strict();

export const initiativesNotationListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
    actives: z.enum(["oui", "non"]).optional(),
  })
  .strict();

/** Proposition (lecture) ou enregistrement d'un plan d'action priorisé. */
export const planActionNotationSchema = z
  .object({
    version: z.coerce.number().int().min(1).max(100000).optional(),
    capacite: z.coerce.number().int().min(1).max(100).default(10),
    max_initiatives: z.coerce.number().int().min(1).max(100).optional(),
    secteur: identifiantGrilleSchema.optional(),
    taille: identifiantGrilleSchema.optional(),
  })
  .strict();
export type PlanActionNotation = z.infer<typeof planActionNotationSchema>;

export const listeNotationAugmenteeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();
