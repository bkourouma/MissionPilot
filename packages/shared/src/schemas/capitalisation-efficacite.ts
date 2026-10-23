import { z } from "zod";
import { dateIsoBorneeSchema, texte } from "./commun";

/*
 * Efficacité des recommandations (CAP-03, PRD complémentaire §12) : initiative recommandée ->
 * mise en oeuvre -> effet mesuré sur les KPI -> score d'efficacité par contexte. Objets
 * stricts ; le même schéma sert l'API et le web. Aucun chiffre ne vient de l'IA.
 */

export const STATUTS_EFFICACITE = ["recommandee", "mise_en_oeuvre", "abandonnee"] as const;
export type StatutEfficacite = (typeof STATUTS_EFFICACITE)[number];

export const STATUT_EFFICACITE_LIBELLES: Record<StatutEfficacite, string> = {
  recommandee: "Recommandée",
  mise_en_oeuvre: "Mise en oeuvre",
  abandonnee: "Abandonnée",
};

/** Valeur décimale du KPI en texte (6 décimales au plus), jamais un flottant. */
export const efficaciteValeurSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,15}(\.\d{1,6})?$/, "Valeur décimale attendue (6 décimales au plus).");

// eslint-disable-next-line no-control-regex -- rejet volontaire des caractères de contrôle
const typeInitiativeSchema = texte(80).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), {
  message: "Caractères de contrôle interdits.",
});

export const efficaciteRecommandationCreationSchema = z
  .object({
    mission_id: z.string().uuid(),
    kpi_id: z.string().uuid(),
    plan_initiative_id: z.string().uuid().nullable().optional(),
    libelle: texte(200),
    type_initiative: typeInitiativeSchema,
    valeur_cible: efficaciteValeurSchema,
  })
  .strict();
export type EfficaciteRecommandationCreation = z.infer<
  typeof efficaciteRecommandationCreationSchema
>;

export const efficaciteMiseEnOeuvreSchema = z
  .object({ mise_en_oeuvre_le: dateIsoBorneeSchema })
  .strict();

export const efficaciteAbandonSchema = z.object({ motif: texte(500) }).strict();

export const efficaciteListeQuerySchema = z
  .object({
    mission_id: z.string().uuid().optional(),
    statut: z.enum(STATUTS_EFFICACITE).optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** Plancher du seuil d'observations (aligné sur `EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT` du moteur). */
export const EFFICACITE_SEUIL_OBSERVATIONS_MIN = 5;

export const efficaciteScoresQuerySchema = z
  .object({
    // Le seuil ne peut que RELEVER le masquage (5 observations au moins, CAP-03).
    seuil: z.coerce.number().int().min(EFFICACITE_SEUIL_OBSERVATIONS_MIN).max(100).optional(),
  })
  .strict();
