import { z } from "zod";
import { auMoinsUnChamp, codeSchema, MESSAGE_CORPS_VIDE, texte, texteOptionnel } from "./commun";

export const MODES_FACTURATION = ["forfait", "regie", "forfait_variable", "abonnement"] as const;
export type ModeFacturation = (typeof MODES_FACTURATION)[number];

/** Niveaux du modèle hiérarchique d'un type de mission (MIS-02). */
export const NIVEAUX_MODELE = { phase: 1, lot: 2, tache: 3 } as const;

/** Équipe type : nombre de collaborateurs par grade. */
export const equipeTypeSchema = z
  .array(z.object({ grade_code: codeSchema, nombre: z.number().int().min(1).max(50) }).strict())
  .max(20);

/** Jours types par grade, au pas de la demi-journée : { "senior": 2.5 }. */
export const joursParGradeSchema = z
  .record(
    codeSchema,
    z
      .number()
      .min(0)
      .max(1000)
      .refine((v) => Number.isInteger(v * 2), "Jours au pas de 0,5."),
  )
  .refine((v) => Object.keys(v).length <= 20, "20 grades au plus.");

const champsType = {
  code: codeSchema,
  libelle: texte(160),
  domaine: texteOptionnel(120),
  mode_facturation: z.enum(MODES_FACTURATION),
  /** Durée calendaire type, en jours. */
  duree_type_jours: z.number().int().min(1).max(3650).nullable(),
  equipe_type: equipeTypeSchema,
  actif: z.boolean(),
};

export const typeMissionCreationSchema = z
  .object({
    ...champsType,
    duree_type_jours: champsType.duree_type_jours.default(null),
    equipe_type: champsType.equipe_type.default([]),
    actif: champsType.actif.default(true),
  })
  .strict();

export const typeMissionModificationSchema = z
  .object({ ...champsType, a_valider: z.literal(false) })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const typeMissionDuplicationSchema = z
  .object({ code: codeSchema, libelle: texte(160) })
  .strict();

export const elementCreationSchema = z
  .object({
    /** Absent ou null : phase (niveau 1). Sinon le niveau vaut celui du parent + 1. */
    parent_id: z.string().uuid().nullable().default(null),
    libelle: texte(200),
    ordre: z.number().int().min(0).max(10000).default(0),
    jours_par_grade: joursParGradeSchema.default({}),
    est_livrable: z.boolean().default(false),
    est_jalon: z.boolean().default(false),
  })
  .strict();

export const elementModificationSchema = z
  .object({
    libelle: texte(200),
    ordre: z.number().int().min(0).max(10000),
    jours_par_grade: joursParGradeSchema,
    est_livrable: z.boolean(),
    est_jalon: z.boolean(),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export type TypeMissionCreation = z.infer<typeof typeMissionCreationSchema>;
export type ElementCreation = z.infer<typeof elementCreationSchema>;
