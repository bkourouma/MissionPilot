import { z } from "zod";
import {
  auMoinsUnChamp,
  dateIsoSchema,
  deviseSchema,
  MESSAGE_CORPS_VIDE,
  paysSchema,
  texte,
} from "./commun";

export const UNITES_SAISIE_TEMPS = ["demi_journee", "heure"] as const;
export type UniteSaisieTemps = (typeof UNITES_SAISIE_TEMPS)[number];

/** Jours travaillés, numérotation ISO : 1 = lundi … 7 = dimanche. */
export const joursTravaillesSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .transform((jours) => [...new Set(jours)].sort((a, b) => a - b));

export const cabinetModificationSchema = z
  .object({
    nom: texte(200)
      .refine((v) => !/[\r\n]/.test(v), "Le nom ne peut pas contenir de saut de ligne.")
      .optional(),
    pays: paysSchema.optional(),
    devise_base: deviseSchema.optional(),
    unite_saisie_temps: z.enum(UNITES_SAISIE_TEMPS).optional(),
    heures_par_jour: z
      .number()
      .min(1)
      .max(24)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, "Deux décimales au plus.")
      .optional(),
    jours_travailles: joursTravaillesSchema.optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const ferieCreationSchema = z
  .object({
    date: dateIsoSchema,
    libelle: texte(120),
    nationale: z.boolean().default(true),
  })
  .strict();

export type CabinetModification = z.infer<typeof cabinetModificationSchema>;
export type FerieCreation = z.infer<typeof ferieCreationSchema>;
