import { z } from "zod";
import {
  auMoinsUnChamp,
  codeSchema,
  dateIsoSchema,
  deviseSchema,
  listeLibelles,
  MESSAGE_CORPS_VIDE,
  montantSchema,
  texte,
} from "./commun";

// --- Grades -----------------------------------------------------------------
// Le taux de vente standard d'un grade est une donnée financière (FIN-02) :
// il n'apparaît que dans les schémas « taux », jamais dans ceux du grade.

export const gradeCreationSchema = z
  .object({
    code: codeSchema,
    libelle: texte(80),
    ordre: z.number().int().min(0).max(1000).default(0),
  })
  .strict();

export const gradeModificationSchema = z
  .object({
    libelle: texte(80).optional(),
    ordre: z.number().int().min(0).max(1000).optional(),
    actif: z.boolean().optional(),
    /** Seule transition permise : « valeur de départ » → validée par le métier. */
    a_valider: z.literal(false).optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const gradeTauxSchema = z
  .object({ taux_vente_standard: montantSchema.nullable(), devise: deviseSchema })
  .strict();

// --- Collaborateurs ---------------------------------------------------------

export const TYPES_COLLABORATEUR = ["interne", "externe", "sous_traitant"] as const;
export type TypeCollaborateur = (typeof TYPES_COLLABORATEUR)[number];

const champsCollaborateur = {
  nom: texte(160),
  utilisateur_id: z.string().uuid().nullable(),
  grade_id: z.string().uuid().nullable(),
  competences: listeLibelles(),
  secteurs: listeLibelles(),
  langues: listeLibelles(20, 40),
  /** Part du temps disponible (temps partiel) : 0 à 100 %. */
  capacite_pct: z.number().int().min(0).max(100),
  type: z.enum(TYPES_COLLABORATEUR),
  actif: z.boolean(),
};

export const collaborateurCreationSchema = z
  .object({
    ...champsCollaborateur,
    utilisateur_id: champsCollaborateur.utilisateur_id.default(null),
    grade_id: champsCollaborateur.grade_id.default(null),
    competences: champsCollaborateur.competences.default([]),
    secteurs: champsCollaborateur.secteurs.default([]),
    langues: champsCollaborateur.langues.default(["français"]),
    capacite_pct: champsCollaborateur.capacite_pct.default(100),
    type: champsCollaborateur.type.default("interne"),
    actif: champsCollaborateur.actif.default(true),
  })
  .strict();

export const collaborateurModificationSchema = z
  .object(champsCollaborateur)
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/**
 * Nouvelle ligne de coûts (FIN-02) : l'historique n'est jamais modifié, une
 * révision crée une ligne datée `depuis_le`.
 */
export const collaborateurCoutsSchema = z
  .object({
    cout_journalier: montantSchema.nullable().default(null),
    taux_vente_specifique: montantSchema.nullable().default(null),
    /** Coût d'achat journalier d'un expert externe ou sous-traitant (PLN-08). */
    cout_achat: montantSchema.nullable().default(null),
    devise: deviseSchema,
    depuis_le: dateIsoSchema,
  })
  .strict()
  .refine(
    (v) => v.cout_journalier !== null || v.taux_vente_specifique !== null || v.cout_achat !== null,
    "Au moins un montant est attendu.",
  );

export type CollaborateurCreation = z.infer<typeof collaborateurCreationSchema>;
export type CollaborateurModification = z.infer<typeof collaborateurModificationSchema>;
export type CollaborateurCouts = z.infer<typeof collaborateurCoutsSchema>;
