import { z } from "zod";
import { equipeTypeSchema } from "./catalogue";
import {
  auMoinsUnChamp,
  codeSchema,
  dateIsoSchema,
  deviseSchema,
  MESSAGE_CORPS_VIDE,
  montantSchema,
  texte,
} from "./commun";

/** Étapes d'une opportunité ouverte (MIS-04). */
export const ETAPES_OPPORTUNITE = [
  "prospection",
  "qualification",
  "proposition",
  "negociation",
] as const;
export type EtapeOpportunite = (typeof ETAPES_OPPORTUNITE)[number];

export const STATUTS_OPPORTUNITE = ["ouverte", "gagnee", "perdue"] as const;
export type StatutOpportunite = (typeof STATUTS_OPPORTUNITE)[number];

const champsOpportunite = {
  client_id: z.string().uuid(),
  intitule: texte(200),
  type_mission_id: z.string().uuid().nullable(),
  montant_estime: montantSchema,
  devise: deviseSchema,
  probabilite: z.number().int().min(0).max(100),
  etape: z.enum(ETAPES_OPPORTUNITE),
  responsable_id: z.string().uuid().nullable(),
  date_cloture_prevue: dateIsoSchema.nullable(),
};

export const opportuniteCreationSchema = z
  .object({
    ...champsOpportunite,
    type_mission_id: champsOpportunite.type_mission_id.default(null),
    montant_estime: champsOpportunite.montant_estime.default(0),
    devise: champsOpportunite.devise.default("XOF"),
    probabilite: champsOpportunite.probabilite.default(50),
    etape: champsOpportunite.etape.default("prospection"),
    responsable_id: champsOpportunite.responsable_id.default(null),
    date_cloture_prevue: champsOpportunite.date_cloture_prevue.default(null),
  })
  .strict();

export const opportuniteModificationSchema = z
  .object(champsOpportunite)
  .omit({ etape: true })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const opportuniteEtapeSchema = z.object({ etape: z.enum(ETAPES_OPPORTUNITE) }).strict();

/** Issue d'une opportunité : gagnée, ou perdue avec un motif obligatoire. */
export const opportuniteIssueSchema = z.discriminatedUnion("statut", [
  z.object({ statut: z.literal("gagnee") }).strict(),
  z.object({ statut: z.literal("perdue"), motif_perte: texte(1000) }).strict(),
]);

/** Propositions techniques et financières (MIS-05). */
export const STATUTS_PROPOSITION = [
  "brouillon",
  "a_valider",
  "validee",
  "envoyee",
  "acceptee",
  "refusee",
] as const;
export type StatutProposition = (typeof STATUTS_PROPOSITION)[number];

/** Statuts où la proposition est figée (validée par un associé, puis suite). */
export const STATUTS_PROPOSITION_FIGEE: readonly StatutProposition[] = [
  "validee",
  "envoyee",
  "acceptee",
  "refusee",
];

export const propositionGenerationSchema = z
  .object({
    /** Par défaut : le type de mission de l'opportunité. */
    type_mission_id: z.string().uuid().optional(),
    intitule: texte(200).optional(),
    /** Par défaut : la devise de l'opportunité. */
    devise: deviseSchema.optional(),
    /** Date de référence des taux ; par défaut, la date du jour. */
    date_reference: dateIsoSchema.optional(),
  })
  .strict();

export const propositionModificationSchema = z
  .object({
    intitule: texte(200),
    equipe: equipeTypeSchema,
    date_reference: dateIsoSchema,
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/** Jours d'un élément de proposition, par code de grade, au centième de jour. */
export const joursParGradeCentiemesSchema = z
  .record(
    codeSchema,
    z
      .number()
      .min(0)
      .max(1000)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, "Jours au centième."),
  )
  .refine((v) => Object.keys(v).length <= 20, "20 grades au plus.");

export const propositionElementModificationSchema = z
  .object({ libelle: texte(200), jours_par_grade: joursParGradeCentiemesSchema })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/** Taux journaliers de vente par code de grade ; null retire le taux. */
export const propositionTauxSchema = z
  .object({
    taux: z
      .record(codeSchema, montantSchema.nullable())
      .refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 20, "1 à 20 grades."),
  })
  .strict();

export const propositionStatutSchema = z.object({ statut: z.enum(STATUTS_PROPOSITION) }).strict();

export type OpportuniteCreation = z.infer<typeof opportuniteCreationSchema>;
