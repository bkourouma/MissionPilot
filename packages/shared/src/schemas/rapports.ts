import { z } from "zod";
import { confirmationIdentiteSchema } from "./double-authentification";

/*
 * Rapports générés (SOC-07) : notation publiée (NOT-07), plan stratégique
 * (PLA-11) et paramètres des rapports du cabinet (conservation, mention de la
 * contribution de l'IA, PRD complémentaire 21.2). Les rapports d'état
 * d'avancement gardent leur schéma de requête (routes/rapports.ts).
 */

/** Formats des rapports de service : PDF et Word. */
export const FORMATS_RAPPORT_SERVICE = ["pdf", "docx"] as const;
export type FormatRapportService = (typeof FORMATS_RAPPORT_SERVICE)[number];

/**
 * POST /notations/:id/rapports et POST /plans/:id/rapports : format, et
 * version (notation : version publiée, par défaut la dernière publiée ; plan :
 * version du modèle financier, par défaut la dernière validée, sinon la
 * dernière).
 */
export const rapportServiceQuerySchema = z
  .object({
    format: z.enum(FORMATS_RAPPORT_SERVICE),
    version: z.coerce.number().int().min(1).max(100000).optional(),
  })
  .strict();
export type RapportServiceQuery = z.infer<typeof rapportServiceQuerySchema>;

/** Listes de rapports paginées par curseur (plus récent d'abord). */
export const rapportsListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/** Durée de conservation des rapports générés, en jours (migration 0132). */
export const CONSERVATION_RAPPORTS = { defaut: 1095, min: 90, max: 3650 } as const;

/**
 * PUT /rapports/parametres : remplacement complet. `confirmation` (mot de passe, et code TOTP ou
 * code de secours si la 2FA est active) est exigée pour RACCOURCIR la durée de conservation : les
 * rapports plus anciens sont purgés au prochain passage du job, sans retour possible (la
 * génération est refusée sur une mission clôturée).
 */
export const rapportsParametresSchema = z
  .object({
    conservation_jours: z
      .number()
      .int()
      .min(CONSERVATION_RAPPORTS.min)
      .max(CONSERVATION_RAPPORTS.max),
    mention_ia_active: z.boolean(),
    /** Texte propre au cabinet, sur une ligne ; vide ou null : mention par défaut. */
    mention_ia: z
      .string()
      .max(300)
      .regex(/^[^\p{Cc}]*$/u, "La mention tient sur une ligne, sans caractère de contrôle.")
      .nullable(),
    confirmation: confirmationIdentiteSchema.optional(),
  })
  .strict();
export type RapportsParametres = z.infer<typeof rapportsParametresSchema>;
