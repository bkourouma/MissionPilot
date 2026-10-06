import { z } from "zod";
import { MESSAGE_CORPS_VIDE, texte } from "./commun";
import { confirmationIdentiteSchema } from "./double-authentification";
import { STATUTS_CONTENU } from "./documents";

/*
 * Socle IA de la V2 (ADR-003) : paramétrage par cabinet, prompts versionnés,
 * générations tracées (SOC-06), coûts.
 *
 * Principe : l'IA propose, l'expert dispose. Toute sortie porte un
 * `statut_contenu` (brouillon_ia, modifie, valide) ; seul un contenu
 * « valide » peut devenir un livrable client. Aucun chiffre ne vient du
 * modèle : les nombres de la sortie absents des chiffres fournis par les
 * moteurs marquent la génération `chiffres_non_verifies`.
 *
 * Coûts en micro-dollars US (µUSD, 1 USD = 1 000 000) : unité des tarifs du
 * fournisseur, convertie dans la devise de la mission pour le ratio coût/prix.
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

/* ----- Tâches et modèles ----- */

export const TACHES_IA = [
  "redaction",
  "analyse",
  "extraction",
  "classification",
  "embedding",
] as const;
export type TacheIa = (typeof TACHES_IA)[number];
export const tacheIaSchema = z.enum(TACHES_IA);

/** Tâches qui produisent un contenu (l'embedding sert la recherche sémantique). */
export const TACHES_GENERATIVES = ["redaction", "analyse", "extraction", "classification"] as const;
export type TacheGenerative = (typeof TACHES_GENERATIVES)[number];
export const tacheGenerativeSchema = z.enum(TACHES_GENERATIVES);

export const TACHE_IA_LIBELLES: Record<TacheIa, string> = {
  redaction: "Rédaction",
  analyse: "Analyse",
  extraction: "Extraction",
  classification: "Classification",
  embedding: "Vectorisation (recherche sémantique)",
};

/**
 * Format d'un identifiant de modèle OpenRouter : « fournisseur/modèle »,
 * variante facultative (« :free »). Liste blanche de FORMAT, pas de modèles :
 * les identifiants évoluent ; même contrôle en base (0100).
 */
export const FORMAT_MODELE_IA =
  /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,99}(:[a-z0-9._-]{1,30})?$/;
export const modeleIaSchema = z
  .string()
  .trim()
  .regex(FORMAT_MODELE_IA, "Identifiant de modèle attendu : « fournisseur/modèle ».");

/** Plafond mensuel : 100 000 USD au plus. */
export const PLAFOND_IA_MAX_MICRO_USD = 100_000_000_000;

/** Clé API : caractères sûrs uniquement (aucun saut de ligne ni espace : pas d'injection d'en-tête). */
export const cleApiIaSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,200}$/, "Clé API : 20 à 200 lettres, chiffres, tirets ou tirets bas.");

const modelesModification = z
  .object(
    Object.fromEntries(TACHES_IA.map((t) => [t, modeleIaSchema.nullable().optional()])) as Record<
      TacheIa,
      z.ZodOptional<z.ZodNullable<typeof modeleIaSchema>>
    >,
  )
  .strict();

/**
 * PUT /api/ia/parametres (ia.configurer). `cle_api` : nouvelle clé du cabinet
 * (jamais renvoyée), `null` pour la retirer (repli sur la clé de plateforme).
 * `modeles` : modèle par tâche, `null` pour revenir au modèle recommandé ; seuls
 * les modèles au tarif connu de l'API sont admis (`modeles_autorises` du GET).
 *
 * `confirmation` (mot de passe, et code TOTP ou code de secours si la 2FA est
 * active) : EXIGÉE quand `cle_api` est présent (définition ou retrait) ou que
 * le plafond mensuel est RELEVÉ ; 403 CONFIRMATION_REQUISE sinon. Une clé
 * substituée détournerait les données des clients vers un autre compte.
 */
export const iaParametresModificationSchema = z
  .object({
    ia_activee: z.boolean().optional(),
    plafond_mensuel_micro_usd: z.number().int().min(0).max(PLAFOND_IA_MAX_MICRO_USD).optional(),
    cle_api: cleApiIaSchema.nullable().optional(),
    modeles: modelesModification.optional(),
    confirmation: confirmationIdentiteSchema.optional(),
  })
  .strict()
  .refine(
    (v) => Object.entries(v).some(([champ, x]) => champ !== "confirmation" && x !== undefined),
    MESSAGE_CORPS_VIDE,
  );

/** POST /api/ia/parametres/tester : appel minimal avec le modèle de la tâche. */
export const iaTestSchema = z
  .object({ tache: tacheGenerativeSchema.default("classification") })
  .strict();

/* ----- Schéma de sortie d'un prompt ----- */

const NOM_CHAMP = /^[a-z][a-z0-9_]{0,39}$/;
const codeChoix = z
  .string()
  .regex(/^[a-z0-9_]{1,40}$/, "Valeur : minuscules, chiffres, tiret bas.");

/**
 * Champ d'une sortie structurée. Pas de type « nombre » : un nombre ne vient
 * jamais du modèle (les chiffres sortent des moteurs de calcul).
 */
export const champSortieSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("texte"),
      longueur_max: z.number().int().min(1).max(20_000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("liste_texte"),
      max_elements: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z.object({ type: z.literal("booleen") }).strict(),
  z
    .object({
      type: z.literal("choix"),
      valeurs: z.array(codeChoix).min(1).max(30),
      /** Valeur retenue par le gabarit déterministe si aucun mot-clé ne correspond. */
      defaut: codeChoix.optional(),
    })
    .strict(),
]);
export type ChampSortie = z.infer<typeof champSortieSchema>;

/** Sortie attendue : texte libre, ou objet JSON aux champs typés (tous requis). */
export const schemaSortieSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("texte"),
        longueur_max: z.number().int().min(1).max(50_000).optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("objet"), champs: z.record(z.string(), champSortieSchema) })
      .strict(),
  ])
  .superRefine((s, ctx) => {
    if (s.type !== "objet") return;
    const noms = Object.keys(s.champs);
    if (noms.length < 1 || noms.length > 20) {
      ctx.addIssue({ code: "custom", message: "Un objet a de 1 à 20 champs." });
    }
    for (const [nom, champ] of Object.entries(s.champs)) {
      if (!NOM_CHAMP.test(nom)) {
        ctx.addIssue({ code: "custom", message: `Nom de champ invalide : ${nom.slice(0, 40)}.` });
      }
      if (champ.type === "choix" && champ.defaut && !champ.valeurs.includes(champ.defaut)) {
        ctx.addIssue({ code: "custom", message: `Champ ${nom} : défaut hors des valeurs.` });
      }
    }
  });
export type SchemaSortie = z.infer<typeof schemaSortieSchema>;

/* ----- Prompts versionnés ----- */

export const NOM_PROMPT = /^[a-z][a-z0-9_]{0,59}$/;
export const NOM_VARIABLE = /^[a-z][a-z0-9_]{0,39}$/;
/**
 * Variable réservée : remplie par l'API avec les chiffres fournis par les
 * moteurs (liste « libellé : valeur »), jamais par l'appelant.
 */
export const VARIABLE_CHIFFRES = "chiffres";

export const nomPromptSchema = z
  .string()
  .trim()
  .regex(NOM_PROMPT, "Nom : minuscules, chiffres, tiret bas ; commence par une lettre.");

/** POST /api/ia/prompts (ia.configurer) : nouvelle version d'un prompt (1 pour un nouveau nom). */
export const promptCreationSchema = z
  .object({
    nom: nomPromptSchema,
    tache: tacheGenerativeSchema,
    description: z.string().trim().max(500).default(""),
    gabarit_systeme: z.string().max(20_000).default(""),
    gabarit_utilisateur: texte(20_000),
    schema_sortie: schemaSortieSchema,
    /** Prompt de démonstration, utilisable par la génération manuelle de test. */
    exemple: z.boolean().default(false),
    /** Activer cette version dès sa création (défaut : oui). */
    activer: z.boolean().default(true),
  })
  .strict();
export type PromptCreation = z.infer<typeof promptCreationSchema>;

export const promptsQuerySchema = z
  .object({ nom: nomPromptSchema.optional(), limite: limiteSchema, curseur: curseurSchema })
  .strict();

/** POST /api/ia/prompts/:id/activer : aucun corps. */
export const promptActivationSchema = z.object({}).strict();

/* ----- Générations ----- */

export const STATUTS_GENERATION = ["en_file", "en_cours", "terminee", "echec", "annulee"] as const;
export type StatutGeneration = (typeof STATUTS_GENERATION)[number];

/** Chiffre calculé par un moteur, seul nombre que la sortie peut citer. */
export const chiffreContexteSchema = z
  .object({
    libelle: texte(200),
    valeur: z.number().finite(),
    unite: z.string().trim().max(20).optional(),
  })
  .strict();
export type ChiffreContexte = z.infer<typeof chiffreContexteSchema>;

export const CATEGORIES_TERME_SENSIBLE = ["personne", "organisation", "lieu", "autre"] as const;

/** Terme masqué avant envoi (nom propre, raison sociale…) : chaîne seule = personne. */
export const termeSensibleSchema = z.union([
  texte(200),
  z.object({ valeur: texte(200), categorie: z.enum(CATEGORIES_TERME_SENSIBLE) }).strict(),
]);
export type TermeSensible = z.infer<typeof termeSensibleSchema>;

/** Source citée : référence vérifiée par l'API (existe dans le cabinet et visible). */
export const TYPES_SOURCE_IA = ["mission", "mission_document", "moteur"] as const;
export const sourceIaSchema = z
  .object({
    type: z.enum(TYPES_SOURCE_IA),
    id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{1,100}$/, "Identifiant de source invalide."),
    libelle: texte(200),
  })
  .strict();
export type SourceIa = z.infer<typeof sourceIaSchema>;

const variablesSchema = z
  .record(z.string().regex(NOM_VARIABLE, "Nom de variable invalide."), z.string().max(50_000))
  .refine((v) => Object.keys(v).length <= 30, "30 variables au plus.")
  .refine((v) => !(VARIABLE_CHIFFRES in v), "La variable « chiffres » est réservée à l'API.");

/** Champ refusé par la route HTTP de test (fourni par le serveur seul, ou sans objet). */
const refuseParHttp = (message: string) => z.never({ invalid_type_error: message }).optional();

export const MESSAGE_CHIFFRES_SERVEUR =
  "Les chiffres des moteurs sont fournis par le serveur, jamais par la requête.";
export const MESSAGE_SOURCE_MOTEUR_SERVEUR =
  "Une source « moteur » est déclarée par le serveur, jamais par la requête.";
export const MESSAGE_ESSAI_SANS_MISSION =
  "Un essai avec un prompt « exemple » n'est rattaché à aucune mission.";

/**
 * POST /api/ia/generations (ia.utiliser) : génération manuelle de TEST avec
 * un prompt « exemple ». `mode` : « file » (job, progression lisible) ou
 * « immediat ». `repli_si_plafond` : plafond atteint → gabarit au lieu d'un 409.
 *
 * REFUSÉS (400), car seule l'API les établit : `contexte_chiffres` (la liste
 * blanche de la garde-chiffres sort des moteurs de calcul, construite par le
 * code des services), une source de type « moteur », et `mission_id` (un
 * essai n'est jamais rattaché à une mission ni livrable à un client).
 */
export const generationCreationSchema = z
  .object({
    prompt_nom: nomPromptSchema,
    variables: variablesSchema.default({}),
    contexte_chiffres: refuseParHttp(MESSAGE_CHIFFRES_SERVEUR),
    termes_sensibles: z.array(termeSensibleSchema).max(200).default([]),
    sources: z
      .array(sourceIaSchema.refine((s) => s.type !== "moteur", MESSAGE_SOURCE_MOTEUR_SERVEUR))
      .max(50)
      .default([]),
    mission_id: refuseParHttp(MESSAGE_ESSAI_SANS_MISSION),
    mode: z.enum(["file", "immediat"]).default("file"),
    repli_si_plafond: z.boolean().default(false),
  })
  .strict();
export type GenerationCreation = z.infer<typeof generationCreationSchema>;

/** POST /api/ia/generations/:id/modifier : nouvelle version « modifie ». */
export const generationModificationSchema = z
  .object({ texte: z.string().trim().min(1).max(100_000) })
  .strict();

/**
 * POST /api/ia/generations/:id/valider. Une génération aux chiffres non
 * vérifiés exige `acquitte_chiffres: true` (l'humain atteste les nombres).
 */
export const generationValidationSchema = z
  .object({ acquitte_chiffres: z.boolean().optional() })
  .strict();

export const generationsQuerySchema = z
  .object({
    mission_id: z.string().uuid().optional(),
    statut: z.enum(STATUTS_GENERATION).optional(),
    statut_contenu: z.enum(STATUTS_CONTENU).optional(),
    tache: tacheIaSchema.optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

/* ----- Coûts ----- */

/** Coût IA d'une mission rapporté à son prix : cible ≤ 5 % (PRD, objectifs). */
export const SEUIL_RATIO_COUT_IA = 0.05;
/** Seuils d'alerte de consommation du plafond mensuel (%). */
export const SEUILS_ALERTE_PLAFOND_IA = [80, 100] as const;

const moisSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois au format AAAA-MM attendu.");

export const coutsQuerySchema = z.object({ mois: moisSchema.optional() }).strict();

export const coutsMissionsQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();
