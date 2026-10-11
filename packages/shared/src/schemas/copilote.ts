import { z } from "zod";
import { dateIsoBorneeSchema } from "./commun";
import { lienInterneSur } from "./planification";

/*
 * AGT-08 : copilote conversationnel unique, dans les droits de l'utilisateur.
 *
 * - Entrée : un message (1 000 caractères au plus) et, facultativement, la mission affichée à
 *   l'écran. Aucune conversation n'est persistée : le fil vit dans le navigateur.
 * - Choix du modèle de langage (quand l'IA est activée) : `{ outil, parametres }` validé par un
 *   schéma STRICT sur une liste FERMÉE d'outils, sans aucun identifiant ; toute autre sortie
 *   (outil inconnu, clé en trop, type erroné) est refusée et le routage déterministe reprend.
 * - Sortie : une réponse construite par le code (gabarits), jamais du texte libre du modèle ;
 *   une action modifiante est une PROPOSITION (`action`) que l'utilisateur confirme ensuite.
 *
 * La liste d'outils reprend celle de `@missionpilot/engines` (`OUTILS_COPILOTE`), qui reste la
 * source de routage : un test de l'API vérifie qu'elles sont identiques.
 */

export const IDENTIFIANTS_OUTILS_COPILOTE = [
  "mes_taches",
  "mes_feuilles_temps",
  "resume_mission",
  "kpi_rouges",
  "factures_echues",
  "recherche",
  "creer_tache",
] as const;
export type IdentifiantOutilCopilote = (typeof IDENTIFIANTS_OUTILS_COPILOTE)[number];

/** Outils qui modifient des données : jamais exécutés sans confirmation. */
export const IDENTIFIANTS_ACTIONS_COPILOTE = ["creer_tache"] as const;
export type IdentifiantActionCopilote = (typeof IDENTIFIANTS_ACTIONS_COPILOTE)[number];

export const MESSAGE_COPILOTE_LONGUEUR_MAX = 1000;
/** Une proposition d'action expire au bout de ce délai. */
export const EXPIRATION_ACTION_COPILOTE_MINUTES = 5;
/** Messages admis par utilisateur sur la fenêtre glissante (429 au-delà). */
export const MESSAGES_COPILOTE_PAR_FENETRE = 30;
export const FENETRE_MESSAGES_COPILOTE_MINUTES = 10;

/** Caractères de contrôle refusés (hors tabulation et sauts de ligne). */
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const uuid = z.string().uuid();

const texteCourt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((t) => !CONTROLES.test(t), "Caractère de contrôle refusé.");

/** Corps de `POST /api/copilote/messages`. */
export const messageCopiloteSchema = z
  .object({
    message: texteCourt(1, MESSAGE_COPILOTE_LONGUEUR_MAX),
    contexte: z.object({ mission_id: uuid }).strict().optional(),
  })
  .strict();
export type MessageCopilote = z.infer<typeof messageCopiloteSchema>;

/* ----- Choix du modèle de langage ----- */

/** Les valeurs « null » d'un modèle bavard valent « absent » ; jamais de clé inconnue. */
const facultatif = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v): z.infer<T> | undefined => v ?? undefined);

const sansParametres = z.object({}).strict().default({});

export const choixModeleCopiloteSchema = z.discriminatedUnion("outil", [
  z.object({ outil: z.literal("mes_taches"), parametres: sansParametres }).strict(),
  z.object({ outil: z.literal("mes_feuilles_temps"), parametres: sansParametres }).strict(),
  z
    .object({
      outil: z.literal("resume_mission"),
      parametres: z
        .object({ mission: facultatif(texteCourt(1, 200)) })
        .strict()
        .default({}),
    })
    .strict(),
  z.object({ outil: z.literal("kpi_rouges"), parametres: sansParametres }).strict(),
  z.object({ outil: z.literal("factures_echues"), parametres: sansParametres }).strict(),
  z
    .object({
      outil: z.literal("recherche"),
      parametres: z.object({ texte: texteCourt(2, 200) }).strict(),
    })
    .strict(),
  z
    .object({
      outil: z.literal("creer_tache"),
      parametres: z
        .object({
          titre: texteCourt(1, 200),
          echeance: facultatif(dateIsoBorneeSchema),
          pour: facultatif(texteCourt(1, 100)),
          mission: facultatif(texteCourt(1, 200)),
        })
        .strict(),
    })
    .strict(),
  // Le modèle ne reconnaît aucun outil : le routage déterministe prend le relais.
  z.object({ outil: z.literal("aucun"), parametres: sansParametres }).strict(),
]);
export type ChoixModeleCopilote = z.infer<typeof choixModeleCopiloteSchema>;

/* ----- Réponses ----- */

export const STATUTS_REPONSE_COPILOTE = [
  "ok",
  "refuse",
  "non_compris",
  "precision_requise",
  "aide",
  "action_proposee",
] as const;
export type StatutReponseCopilote = (typeof STATUTS_REPONSE_COPILOTE)[number];

export const elementCopiloteSchema = z
  .object({
    libelle: z.string(),
    detail: z.string().optional(),
    // Lien relatif INTERNE sûr (une seule « / » initiale, ni « //hôte », ni « \ », ni schéma, ni
    // espace ou caractère de contrôle) : même règle que les notifications (`lienInterneSur`).
    lien: z.string().refine(lienInterneSur, "Lien interne invalide."),
  })
  .strict();
export type ElementReponseCopilote = z.infer<typeof elementCopiloteSchema>;

export const actionProposeeSchema = z
  .object({
    action_id: uuid,
    outil: z.enum(IDENTIFIANTS_ACTIONS_COPILOTE),
    libelle: z.string(),
    /** Ce qui sera fait, en français, champs exacts : texte construit par le code. */
    resume: z.string(),
    expire_le: z.string(),
  })
  .strict();
export type ActionProposeeCopilote = z.infer<typeof actionProposeeSchema>;

export const reponseCopiloteSchema = z
  .object({
    /** « ia » : le modèle a choisi l'outil ; « deterministe » : mode sans IA. */
    mode: z.enum(["ia", "deterministe"]),
    /**
     * En mode sans IA : l'IA est désactivée par le cabinet, momentanément indisponible, ou non
     * ouverte au rôle de l'utilisateur (« ia.utiliser »).
     */
    repli: z.enum(["ia_desactivee", "indisponible", "non_autorisee"]).optional(),
    outil: z.enum(IDENTIFIANTS_OUTILS_COPILOTE).nullable(),
    statut: z.enum(STATUTS_REPONSE_COPILOTE),
    texte: z.string(),
    elements: z.array(elementCopiloteSchema).max(10),
    action: actionProposeeSchema.optional(),
  })
  .strict();
export type ReponseCopilote = z.infer<typeof reponseCopiloteSchema>;

export const resultatActionCopiloteSchema = z
  .object({
    statut: z.enum(["confirmee", "annulee"]),
    texte: z.string(),
    elements: z.array(elementCopiloteSchema).max(10),
  })
  .strict();
export type ResultatActionCopilote = z.infer<typeof resultatActionCopiloteSchema>;
