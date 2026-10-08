import { z } from "zod";
import { texte } from "./commun";
import { classeRisqueSchema, codeReferentielSchema, niveauAutonomieSchema } from "./fondations";
import { chiffreContexteSchema, NOM_VARIABLE, nomPromptSchema, VARIABLE_CHIFFRES } from "./ia";

/*
 * Agents IA (lot AGT de la vague 1, PRD complémentaire §7, ADR-005) : registre
 * des agents, autonomie par brique et par cabinet, exécutions tracées,
 * contribution de l'IA, jeux d'essai et évaluations de non-régression.
 *
 * Rappels : un agent agit dans les droits de l'utilisateur qui le déclenche ;
 * ses sorties sont validées par schéma (AGT-02) ; les contenus des clients
 * sont des DONNÉES, jamais des instructions (AGT-07) ; aucun chiffre ne vient
 * du modèle (les chiffres d'un cas d'essai sont ceux qu'un moteur fournirait).
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

/** Code d'un agent du registre (« analyste », « avant_vente »…). */
export const CODE_AGENT = /^[a-z][a-z_]{1,39}$/;
export const codeAgentSchema = z
  .string()
  .regex(CODE_AGENT, "Code d'agent : minuscules et tiret bas, 40 caractères au plus.");

/** Les 14 agents du standard (PRD complémentaire §7). */
export const AGENTS_STANDARD = [
  "avant_vente",
  "cadrage",
  "collecte",
  "documentaire",
  "entretien",
  "terrain",
  "analyste",
  "contradicteur",
  "redacteur",
  "qualite",
  "pmo",
  "veille",
  "capitalisation",
  "copilote",
] as const;
export type CodeAgentStandard = (typeof AGENTS_STANDARD)[number];

/**
 * Outils qu'un agent peut appeler : liste FERMÉE (même liste en base, migration 0260).
 * Les outils « proposer_* » ne produisent qu'une proposition soumise à un humain ;
 * « envoyer_relance » et « accuser_reception » sont les seules actions vers le client,
 * réservées au niveau N4 d'une brique R0 (DECISIONS.md, 2026-10-08).
 */
export const OUTILS_AGENT = [
  "lire_mission",
  "lire_documents",
  "lire_reponses",
  "lire_preuves",
  "lire_banque_items",
  "lire_methode",
  "lire_dossier_client",
  "lire_planning",
  "lire_kpi",
  "lire_sources_externes",
  "proposer_brouillon",
  "proposer_classement",
  "proposer_extraction",
  "proposer_assertion",
  "proposer_relance",
  "envoyer_relance",
  "accuser_reception",
] as const;
export type OutilAgent = (typeof OUTILS_AGENT)[number];
export const outilAgentSchema = z.enum(OUTILS_AGENT);

/** Outils qui modifient des données ou écrivent au client : jamais déclenchés par une sortie. */
export const OUTILS_AGENT_MODIFIANTS: readonly OutilAgent[] = [
  "envoyer_relance",
  "accuser_reception",
];

/* ----- Registre (AGT-01) ----- */

/** PUT /api/agents/:code/restriction (agent.gerer) : un cabinet ne peut que RESTREINDRE. */
export const restrictionAgentSchema = z
  .object({
    actif: z.boolean(),
    /** Niveau maximal du cabinet pour cet agent ; null = celui du standard. */
    niveau_max: niveauAutonomieSchema.nullable().default(null),
    motif: texte(1000),
  })
  .strict();
export type RestrictionAgent = z.infer<typeof restrictionAgentSchema>;

/* ----- Autonomie par brique (AGT-03) ----- */

/** POST /api/agents/briques (agent.gerer) : brique confiée à un agent, avec sa classe de risque. */
export const briqueAgentCreationSchema = z
  .object({
    brique_code: codeReferentielSchema,
    agent_code: codeAgentSchema,
    classe_risque: classeRisqueSchema,
    niveau_max: niveauAutonomieSchema,
  })
  .strict()
  .refine(
    (b) => b.niveau_max !== "N4" || b.classe_risque === "R0",
    "N4 est réservé aux briques de classe R0.",
  );
export type BriqueAgentCreation = z.infer<typeof briqueAgentCreationSchema>;

/** Paramètre `:code` d'une brique. */
export const paramsBriqueAgentSchema = z.object({ code: codeReferentielSchema }).strict();
export const paramsAgentSchema = z.object({ code: codeAgentSchema }).strict();

/**
 * POST /api/agents/briques/:code/decisions (autonomie.decider, associé seul) : nouveau
 * niveau accordé. Une hausse se fait palier par palier ; N3 et N4 exigent l'éligibilité
 * calculée par le moteur ; une baisse est toujours possible.
 */
export const decisionAutonomieSchema = z
  .object({ niveau: niveauAutonomieSchema, motif: texte(2000) })
  .strict();
export type DecisionAutonomie = z.infer<typeof decisionAutonomieSchema>;

export const GRAVITES_INCIDENT_AUTONOMIE = ["mineur", "majeur"] as const;
export type GraviteIncidentAutonomieApi = (typeof GRAVITES_INCIDENT_AUTONOMIE)[number];

/** POST /api/agents/briques/:code/incidents (agent.lire) : un incident majeur rétrograde. */
export const incidentAutonomieSchema = z
  .object({
    gravite: z.enum(GRAVITES_INCIDENT_AUTONOMIE),
    description: texte(2000),
    execution_id: z.string().uuid().optional(),
  })
  .strict();

/** PUT /api/agents/coupe-circuit : N4 coupé pour tout le cabinet (activer : agent.gerer ; lever : associé). */
export const coupeCircuitAgentsSchema = z
  .object({ actif: z.boolean(), motif: texte(1000) })
  .strict();

/* ----- Exécutions (AGT-09) ----- */

export const DECISIONS_EXECUTION_AGENT = ["acceptee", "modifiee", "rejetee"] as const;
export type DecisionExecutionAgent = (typeof DECISIONS_EXECUTION_AGENT)[number];

/**
 * POST /api/agents/executions/:id/decision. « validee » : la génération liée a été validée
 * par le circuit humain (ia/generations) ; l'API mesure l'édition (AGT-05) et classe la
 * décision en « acceptee » ou « modifiee » (modification majeure). « rejetee » : motif requis.
 */
export const decisionExecutionAgentSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("validee") }).strict(),
  z.object({ decision: z.literal("rejetee"), motif: texte(2000) }).strict(),
]);
export type DecisionExecutionAgentApi = z.infer<typeof decisionExecutionAgentSchema>;

export const executionsAgentsQuerySchema = z
  .object({
    agent: codeAgentSchema.optional(),
    brique: codeReferentielSchema.optional(),
    mission_id: z.string().uuid().optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

/* ----- Contribution (AGT-05) ----- */

export const contributionsIaQuerySchema = z
  .object({
    agent: codeAgentSchema.optional(),
    brique: codeReferentielSchema.optional(),
    mission_id: z.string().uuid().optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

/* ----- Plafond de coût par mission (AGT-06) ----- */

/** PUT /api/agents/missions/:id/plafond (ia.configurer) : null retire le plafond de la mission. */
export const plafondIaMissionSchema = z
  .object({
    plafond_micro_usd: z.number().int().min(0).max(100_000_000_000).nullable(),
  })
  .strict();

/* ----- Jeux d'essai et évaluations (AGT-04) ----- */

export const CAS_ESSAI_AGENT_MAX = 50;

const variablesCasEssaiSchema = z
  .record(z.string().regex(NOM_VARIABLE, "Nom de variable invalide."), z.string().max(20_000))
  .refine((v) => Object.keys(v).length <= 30, "30 variables au plus.")
  .refine((v) => !(VARIABLE_CHIFFRES in v), "La variable « chiffres » est réservée à l'API.");

/**
 * Critères DÉTERMINISTES d'un cas : la sortie est toujours validée par le schéma du prompt
 * (AGT-02) ; `sans_chiffres_non_verifies` (vrai par défaut) exige la garde-chiffres verte.
 */
export const attenduCasEssaiSchema = z
  .object({
    contient: z.array(texte(200)).max(20).default([]),
    ne_contient_pas: z.array(texte(200)).max(20).default([]),
    /** Valeur exacte attendue d'un champ « choix » ou « booleen » d'une sortie objet. */
    champs: z
      .record(z.string().regex(NOM_VARIABLE), z.union([z.string().max(40), z.boolean()]))
      .refine((v) => Object.keys(v).length <= 20, "20 champs au plus.")
      .default({}),
    sans_chiffres_non_verifies: z.boolean().default(true),
  })
  .strict();

export const casEssaiSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9_]{1,40}$/, "Code du cas : minuscules, chiffres, tiret bas."),
    variables: variablesCasEssaiSchema,
    /** Chiffres que fournirait un moteur (seuls nombres que la sortie peut citer). */
    chiffres: z.array(chiffreContexteSchema).max(50).default([]),
    attendu: attenduCasEssaiSchema.default({}),
  })
  .strict();
export type CasEssai = z.infer<typeof casEssaiSchema>;

/** POST /api/agents/jeux-essai (agent.gerer) : nouvelle version du jeu d'un prompt. */
export const jeuEssaiCreationSchema = z
  .object({
    prompt_nom: nomPromptSchema,
    brique_code: codeReferentielSchema.optional(),
    description: z.string().trim().max(1000).default(""),
    cas: z
      .array(casEssaiSchema)
      .min(1)
      .max(CAS_ESSAI_AGENT_MAX)
      .refine((c) => new Set(c.map((x) => x.code)).size === c.length, "Codes de cas en double."),
  })
  .strict();
export type JeuEssaiCreation = z.infer<typeof jeuEssaiCreationSchema>;

/**
 * POST /api/agents/evaluations (agent.gerer) : rejoue le DERNIER jeu d'essai du prompt sur
 * une version candidate (et, pour comparaison, sur la version active), avec le modèle
 * candidat (défaut : modèle de la tâche). Exécution sur le fournisseur LOCAL déterministe :
 * aucun appel à un modèle externe dans cette version.
 */
export const evaluationAgentCreationSchema = z
  .object({
    prompt_id: z.string().uuid(),
    modele: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,99}$/,
        "Identifiant de modèle attendu : « fournisseur/modèle ».",
      )
      .optional(),
  })
  .strict();

export const evaluationsAgentsQuerySchema = z
  .object({
    prompt_nom: nomPromptSchema.optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

export const jeuxEssaiAgentsQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();
