import { z } from "zod";
import { definitionQuestionnaireSchema, identifiantGrilleSchema } from "../grilles/schemas";
import { roleClientSchema } from "../roles";
import { dateIsoSchema, texte, texteOptionnel } from "./commun";

/*
 * Questionnaires (SOC-10) : contrat des routes /api/questionnaires/** (côté
 * cabinet : questionnaire.lire, questionnaire.gerer) et
 * /api/portail/questionnaires/** (côté client, répondants désignés).
 *
 * La FORME des définitions est contrôlée par `definitionQuestionnaireSchema`
 * (grilles/schemas.ts) ; leur cohérence (conditions, cycles) et la validité
 * des réponses le sont par le moteur (`validerDefinition`, `validerReponses`).
 */

const uuid = z.string().uuid();

export const questionnaireListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/** Gabarits génériques de MissionPilot copiables par le cabinet. */
export const GABARITS_QUESTIONNAIRE = ["notation_generique", "preliminaire_dirigeants"] as const;
export type GabaritQuestionnaire = (typeof GABARITS_QUESTIONNAIRE)[number];

export const MODES_QUESTIONNAIRE = ["individuel", "collectif", "par_fonction"] as const;
export type ModeEnvoiQuestionnaire = (typeof MODES_QUESTIONNAIRE)[number];

export const MODE_QUESTIONNAIRE_LIBELLES: Record<ModeEnvoiQuestionnaire, string> = {
  individuel: "Individuel",
  collectif: "Collectif (réponse partagée)",
  par_fonction: "Par fonction",
};

/**
 * Création d'un modèle : depuis une définition saisie, un gabarit générique
 * ou une copie d'un modèle du cabinet (dernière version). La version 1 naît
 * en brouillon ; l'identifiant et le numéro de version de la définition sont
 * posés par le serveur (code du modèle, numéro de version).
 */
export const modeleQuestionnaireCreationSchema = z
  .object({
    code: identifiantGrilleSchema,
    titre: texte(200).optional(),
    source: z.discriminatedUnion("type", [
      z
        .object({ type: z.literal("definition"), definition: definitionQuestionnaireSchema })
        .strict(),
      z.object({ type: z.literal("gabarit"), gabarit: z.enum(GABARITS_QUESTIONNAIRE) }).strict(),
      z.object({ type: z.literal("copie"), modele_id: uuid }).strict(),
    ]),
  })
  .strict();
export type ModeleQuestionnaireCreation = z.infer<typeof modeleQuestionnaireCreationSchema>;

/** Nouvelle version brouillon : définition fournie, ou copie de la dernière version. */
export const versionQuestionnaireCreationSchema = z
  .object({ definition: definitionQuestionnaireSchema.optional() })
  .strict();

/** Modification d'une version brouillon (remplacement complet de la définition). */
export const versionQuestionnaireModificationSchema = z
  .object({ definition: definitionQuestionnaireSchema })
  .strict();

const repondantEnvoiSchema = z
  .object({ utilisateur_id: uuid, fonction: texteOptionnel(120) })
  .strict();

/** Envoi d'une version validée aux répondants du client de la mission (brouillon). */
export const envoiQuestionnaireCreationSchema = z
  .object({
    version_id: uuid,
    mode: z.enum(MODES_QUESTIONNAIRE),
    repondants: z.array(repondantEnvoiSchema).min(1).max(200),
    relances_auto: z.boolean().default(true),
    date_limite: dateIsoSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => new Set(v.repondants.map((r) => r.utilisateur_id)).size === v.repondants.length, {
    message: "Un répondant n'est désigné qu'une fois.",
    path: ["repondants"],
  })
  .refine((v) => v.mode !== "par_fonction" || v.repondants.every((r) => Boolean(r.fonction)), {
    message: "En mode « par fonction », chaque répondant indique sa fonction.",
    path: ["repondants"],
  });
export type EnvoiQuestionnaireCreation = z.infer<typeof envoiQuestionnaireCreationSchema>;

export const envoiQuestionnaireModificationSchema = z
  .object({
    relances_auto: z.boolean().optional(),
    date_limite: dateIsoSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => v.relances_auto !== undefined || v.date_limite !== undefined, {
    message: "Au moins un champ à modifier est attendu.",
  });

/** Relance manuelle : répondants ciblés (défaut : tous ceux qui n'ont pas soumis). */
export const relanceQuestionnaireSchema = z
  .object({ repondant_ids: z.array(uuid).min(1).max(200).optional() })
  .strict();

/**
 * Répondant désignable (GET /api/missions/:id/questionnaires/repondants-eligibles,
 * questionnaire.gerer) : utilisateur du portail ACTIF du client (actif) de la
 * mission, dirigeant ou contributeur client (jamais l'investisseur seul).
 * Projection fermée : identité et rôles, rien d'autre (ni 2FA, ni statut).
 */
export const repondantEligibleSchema = z
  .object({
    id: uuid,
    nom: z.string(),
    email: z.string(),
    roles: z.array(roleClientSchema),
  })
  .strict();
export type RepondantEligible = z.infer<typeof repondantEligibleSchema>;

export const repondantsEligiblesReponseSchema = z
  .object({
    elements: z.array(repondantEligibleSchema),
    curseur_suivant: z.string().nullable(),
  })
  .strict();
export type RepondantsEligiblesReponse = z.infer<typeof repondantsEligiblesReponseSchema>;

export const ecartsQuestionnaireQuerySchema = z
  .object({ seuil: z.coerce.number().int().min(1).max(9).optional() })
  .strict();

/* ----- Réponses (portail client) ----- */

/** Valeur d'une réponse : nombre, texte, booléen, liste de codes, ou null (effacer). */
export const valeurReponseSchema = z.union([
  z.number().finite(),
  z.string().max(20_000),
  z.boolean(),
  z.array(z.string().max(80)).max(50),
  z.null(),
]);

/**
 * Saisie (sauvegarde automatique) : réponses aux questions citées, fusionnées
 * avec celles déjà enregistrées ; une valeur vide efface la réponse.
 */
export const saisieReponsesSchema = z
  .object({
    reponses: z
      .record(identifiantGrilleSchema, valeurReponseSchema)
      .refine((r) => Object.keys(r).length <= 1_000, "1 000 réponses au plus par saisie."),
  })
  .strict();
export type SaisieReponses = z.infer<typeof saisieReponsesSchema>;

export * from "./notation";
