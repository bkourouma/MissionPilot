import { z } from "zod";
import { dateIsoBorneeSchema } from "./commun";
import { moisSchema } from "./temps";

/*
 * Activité de démonstration automatique (job « activite_demo », migration 0584) : charge d'une
 * tâche. La tâche MENSUELLE porte le seul mois (`AAAA-MM`) ; une tâche de SUITE porte aussi le
 * lundi de sa semaine, que le handler revérifie (lundi du mois : `estLundiDuMoisDemo` du moteur).
 * Schéma strict : une clé inconnue rend la tâche définitivement invalide.
 */
export const chargeActiviteDemoSchema = z
  .object({ mois: moisSchema, semaine: dateIsoBorneeSchema.optional() })
  .strict();
export type ChargeActiviteDemo = z.infer<typeof chargeActiviteDemoSchema>;
