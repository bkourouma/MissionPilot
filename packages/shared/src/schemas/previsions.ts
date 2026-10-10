import { z } from "zod";
import { dateIsoBorneeSchema } from "./commun";

/**
 * Prévisions du cabinet (AUT-12) : le premier mois est celui de la date (par défaut :
 * aujourd'hui). Date bornée (2000 à 2100) : une date extrême est un 400, jamais une erreur interne.
 */
export const previsionsQuerySchema = z
  .object({
    date_reference: dateIsoBorneeSchema.optional(),
  })
  .strict();

export type PrevisionsQuery = z.infer<typeof previsionsQuerySchema>;
