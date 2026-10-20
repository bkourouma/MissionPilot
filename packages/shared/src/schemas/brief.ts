import { z } from "zod";
import { dateIsoBorneeSchema } from "./commun";

/*
 * Brief quotidien par rôle (AUT-07, PRD complémentaire §8.3) : schéma de la requête et de la
 * réponse de `GET /api/brief`. Le brief est un calcul déterministe (moteur `brief` de
 * `packages/engines`), jamais un texte de modèle de langage. Les identifiants de type et de
 * famille sont ceux du moteur ; les libellés français servent à l'affichage.
 *
 * Données financières (FIN-02) : `montant` et `devise` sont ABSENTS d'un élément sans
 * `finance.lire`, jamais masqués par un zéro ; `ecart_pct` (jours, pas d'argent) suit
 * `budget.lire_jours`.
 */

export const FAMILLES_BRIEF_API = ["decider", "deriver", "envoyer"] as const;
export const familleBriefSchema = z.enum(FAMILLES_BRIEF_API);
export type FamilleBriefApi = z.infer<typeof familleBriefSchema>;

export const LIBELLES_FAMILLE_BRIEF: Record<FamilleBriefApi, string> = {
  decider: "À décider",
  deriver: "Ça dérive",
  envoyer: "Prêt à envoyer",
};

export const GRAVITES_BRIEF_API = ["haute", "moyenne", "basse"] as const;
export const graviteBriefSchema = z.enum(GRAVITES_BRIEF_API);
export type GraviteBriefApi = z.infer<typeof graviteBriefSchema>;

export const LIBELLES_GRAVITE_BRIEF: Record<GraviteBriefApi, string> = {
  haute: "Urgent",
  moyenne: "À suivre",
  basse: "Récent",
};

export const TYPES_ELEMENT_BRIEF_API = [
  "facture_a_approuver",
  "debours_a_valider",
  "feuille_a_valider",
  "conge_a_valider",
  "proposition_a_valider",
  "notation_a_publier",
  "livrable_a_relire",
  "livrable_a_signer",
  "derogation_a_accorder",
  "piece_a_examiner",
  "brouillon_automatisation",
  "retour_a_valider",
  "cloture_en_attente",
  "offre_technique_a_valider",
  "plan_a_valider",
  "revision_budget_a_valider",
  "kpi_rouge",
  "kpi_orange_consecutif",
  "atterrissage_depasse",
  "facture_echue",
  "jalon_en_retard",
  "tache_en_retard",
  "feuille_non_soumise",
  "questionnaire_sans_reponse",
  "proposition_a_envoyer",
  "facture_a_emettre",
  "facture_a_envoyer",
  "relance_prete",
  "demande_salle_a_envoyer",
  "livrable_signe",
] as const;
export const typeElementBriefSchema = z.enum(TYPES_ELEMENT_BRIEF_API);
export type TypeElementBriefApi = z.infer<typeof typeElementBriefSchema>;

/** `GET /api/brief?date=` : date de référence facultative (rejeu), bornée à 2000–2100. */
export const briefQuerySchema = z.object({ date: dateIsoBorneeSchema.optional() }).strict();

/** Lien relatif interne (jamais une adresse externe ni un `//`). */
const lienInterneSchema = z
  .string()
  .regex(/^\/[A-Za-z0-9._~/?=&%#-]*$/)
  .refine((v) => !v.startsWith("//") && v.length <= 300);

export const elementBriefSchema = z
  .object({
    type: typeElementBriefSchema,
    famille: familleBriefSchema,
    libelle: z.string().min(1).max(200),
    entite_id: z.string().min(1).max(64),
    mission_id: z.string().uuid().nullable(),
    mission_libelle: z.string().max(200).nullable(),
    lien: lienInterneSchema,
    gravite: graviteBriefSchema,
    anciennete_jours: z.number().int().min(0),
    ecart_pct: z.number().optional(),
    montant: z.number().int().optional(),
    devise: z.string().min(1).max(8).optional(),
  })
  .strict();
export type ElementBriefApi = z.infer<typeof elementBriefSchema>;

export const familleComposeeBriefSchema = z
  .object({
    total: z.number().int().min(0),
    tronque: z.boolean(),
    elements: z.array(elementBriefSchema).max(50),
  })
  .strict();
export type FamilleComposeeBriefApi = z.infer<typeof familleComposeeBriefSchema>;

export const briefSchema = z
  .object({
    date_reference: dateIsoBorneeSchema,
    familles: z
      .object({
        decider: familleComposeeBriefSchema,
        deriver: familleComposeeBriefSchema,
        envoyer: familleComposeeBriefSchema,
      })
      .strict(),
    total: z.number().int().min(0),
    vide: z.boolean(),
  })
  .strict();
export type BriefApi = z.infer<typeof briefSchema>;

/**
 * Charge de la tâche « brief_quotidien » (jobs.charge) : `date` du brief (AAAA-MM-JJ, 2000 à 2100 ;
 * à défaut, le jour du worker) et, pour une tâche de SUITE, `apres_id`, dernier utilisateur du lot
 * précédent (curseur : la tâche reprend aux identifiants suivants). Toute autre clé est refusée.
 */
export const chargeBriefQuotidienSchema = z
  .object({ date: dateIsoBorneeSchema.optional(), apres_id: z.string().uuid().optional() })
  .strict();
export type ChargeBriefQuotidien = z.infer<typeof chargeBriefQuotidienSchema>;
