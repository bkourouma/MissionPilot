import { z } from "zod";
import type { Permission } from "../roles";
import { dateIsoSchema, texte } from "./commun";
import { codeAgentSchema } from "./agents";
import {
  codeReferentielSchema,
  imbricationAuPlus,
  type ClasseRisque,
  type NiveauAutonomie,
} from "./fondations";
import { NOM_VARIABLE, nomPromptSchema } from "./ia";

/*
 * Moteur d'automatisation (lot AUT-CORE de la vague 2, PRD complémentaire §8, ADR-006) :
 * catalogue des événements métier (AUT-01), règles déclencheur → conditions → actions
 * (AUT-02), bibliothèque standard (AUT-03), simulation (AUT-04), garde des actions (AUT-05),
 * journal, annulation et coupe-circuits (AUT-06).
 *
 * La forme JSON d'une condition est IDENTIQUE au type du moteur
 * (`packages/engines/src/automatisation/types.ts`) : elle se stocke telle quelle (jsonb). Les
 * contrôles croisés (champ connu de l'événement, opérateur compatible avec son type, gabarits,
 * champs exigés par une action) sont faits par l'API avec le moteur.
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

// ---------------------------------------------------------------------------
// Catalogue des événements (AUT-01)
// ---------------------------------------------------------------------------

export const TYPES_CHAMP_EVENEMENT = ["texte", "nombre", "booleen", "date", "identifiant"] as const;
export type TypeChampEvenementApi = (typeof TYPES_CHAMP_EVENEMENT)[number];

export interface ChampCatalogue {
  readonly type: TypeChampEvenementApi;
  readonly requis: boolean;
  readonly libelle: string;
}

/**
 * Origine d'un événement : `base` (déclencheur PostgreSQL de la table du module, même si le
 * code est contourné), `detection` (tâche quotidienne qui constate un état dans le temps),
 * `module` (publié par le service du module, `publierEvenement`).
 */
export const SOURCES_EVENEMENT = ["base", "detection", "module"] as const;
export type SourceEvenement = (typeof SOURCES_EVENEMENT)[number];
export const SOURCE_EVENEMENT_LIBELLES: Record<SourceEvenement, string> = {
  base: "Enregistré par la base dès le changement",
  detection: "Détecté chaque jour",
  module: "Publié par le module",
};

export interface DefinitionEvenement {
  readonly libelle: string;
  readonly module: string;
  readonly source: SourceEvenement;
  readonly description: string;
  readonly champs: Readonly<Record<string, ChampCatalogue>>;
}

const MISSION: ChampCatalogue = { type: "identifiant", requis: true, libelle: "Mission" };

export const CATALOGUE_EVENEMENTS = {
  "mission.signee": {
    libelle: "Mission signée",
    module: "Missions",
    source: "base",
    description: "La lettre de mission vient d'être signée (budget initial figé).",
    champs: { mission_id: MISSION },
  },
  "mission.jalon_atteint": {
    libelle: "Jalon atteint",
    module: "Missions",
    source: "base",
    description: "Un jalon du découpage de la mission vient d'être marqué atteint.",
    champs: {
      mission_id: MISSION,
      jalon_id: { type: "identifiant", requis: true, libelle: "Jalon" },
      libelle: { type: "texte", requis: true, libelle: "Libellé du jalon" },
    },
  },
  "mission.cloture_demandee": {
    libelle: "Clôture demandée",
    module: "Clôture",
    source: "module",
    description: "La clôture de la mission est demandée (check-list de clôture, AUT-08).",
    champs: { mission_id: MISSION },
  },
  "questionnaire.clos": {
    libelle: "Questionnaire clos",
    module: "Questionnaires",
    source: "base",
    description: "La collecte d'un questionnaire envoyé vient d'être close.",
    champs: {
      mission_id: MISSION,
      envoi_id: { type: "identifiant", requis: true, libelle: "Envoi du questionnaire" },
    },
  },
  "questionnaire.sans_reponse": {
    libelle: "Questionnaire sans réponse",
    module: "Questionnaires",
    source: "detection",
    description:
      "Un questionnaire envoyé attend encore des réponses à J+3, J+7, J+10 puis J+14 (un événement par palier).",
    champs: {
      mission_id: MISSION,
      envoi_id: { type: "identifiant", requis: true, libelle: "Envoi du questionnaire" },
      titre: { type: "texte", requis: true, libelle: "Titre du questionnaire" },
      jours_sans_reponse: {
        type: "nombre",
        requis: true,
        libelle: "Jours depuis l'envoi (palier)",
      },
      repondants_en_attente: { type: "nombre", requis: true, libelle: "Répondants en attente" },
    },
  },
  "kpi.rouge_deux_periodes": {
    libelle: "KPI au rouge deux périodes de suite",
    module: "KPI",
    source: "detection",
    description:
      "Les dernières périodes mesurées d'un KPI sont au rouge au moins deux fois de suite (un événement par période).",
    champs: {
      mission_id: MISSION,
      kpi_id: { type: "identifiant", requis: true, libelle: "KPI" },
      libelle: { type: "texte", requis: true, libelle: "Libellé du KPI" },
      periode: { type: "texte", requis: true, libelle: "Dernière période mesurée" },
      periodes_rouges: { type: "nombre", requis: true, libelle: "Périodes rouges consécutives" },
    },
  },
} as const satisfies Record<string, DefinitionEvenement>;

export type CodeEvenementAutomatisation = keyof typeof CATALOGUE_EVENEMENTS;
export const CODES_EVENEMENT_AUTOMATISATION = Object.keys(
  CATALOGUE_EVENEMENTS,
) as CodeEvenementAutomatisation[];
export const codeEvenementAutomatisationSchema = z.enum(
  CODES_EVENEMENT_AUTOMATISATION as [CodeEvenementAutomatisation, ...CodeEvenementAutomatisation[]],
);

/** Définition d'un événement du catalogue (null si le code est inconnu). */
export function evenementDuCatalogue(code: string): DefinitionEvenement | null {
  return Object.prototype.hasOwnProperty.call(CATALOGUE_EVENEMENTS, code)
    ? (CATALOGUE_EVENEMENTS as Record<string, DefinitionEvenement>)[code]!
    : null;
}

// ---------------------------------------------------------------------------
// Registre des actions typées (AUT-02, AUT-05)
// ---------------------------------------------------------------------------

export const TYPES_ACTION_AUTOMATISATION = [
  "creer_tache",
  "notifier",
  "brouillon",
  "facture_brouillon",
  "appeler_agent",
  "relance_questionnaire",
] as const;
export type TypeActionAutomatisation = (typeof TYPES_ACTION_AUTOMATISATION)[number];

export interface MetaActionAutomatisation {
  readonly libelle: string;
  readonly description: string;
  /** Permission que l'exécutant doit détenir ; null : tout membre du cabinet. */
  readonly permission: Permission | null;
  /** Classe de risque ; null : celle de la brique de l'agent appelé (R1 sans brique). */
  readonly classe_risque: ClasseRisque | null;
  /** L'action atteint le client (exécution N4, classe R0 seulement). */
  readonly vers_client: boolean;
  readonly annulable: boolean;
  /** Champs que l'événement doit porter pour cette action. */
  readonly champs_requis: readonly string[];
  /** Niveau d'autonomie effectif minimal de la brique (appel d'un agent). */
  readonly niveau_agent_requis: NiveauAutonomie | null;
}

export const REGISTRE_ACTIONS_AUTOMATISATION: Record<
  TypeActionAutomatisation,
  MetaActionAutomatisation
> = {
  creer_tache: {
    libelle: "Créer une tâche",
    description: "Assigne une tâche de collaboration à une personne de la mission.",
    permission: "tache.assigner",
    classe_risque: "R0",
    vers_client: false,
    annulable: false,
    champs_requis: [],
    niveau_agent_requis: null,
  },
  notifier: {
    libelle: "Notifier",
    description: "Notification interne (et e-mail) à des personnes du cabinet.",
    permission: null,
    classe_risque: "R0",
    vers_client: false,
    annulable: false,
    champs_requis: [],
    niveau_agent_requis: null,
  },
  brouillon: {
    libelle: "Brouillon tracé",
    description:
      "Note en brouillon rattachée à la mission, à valider, modifier ou rejeter par un humain.",
    permission: null,
    classe_risque: "R1",
    vers_client: false,
    annulable: true,
    champs_requis: ["mission_id"],
    niveau_agent_requis: null,
  },
  facture_brouillon: {
    libelle: "Facture en brouillon",
    description:
      "Facture en brouillon depuis les échéances rattachées au jalon ; l'approbation reste humaine.",
    permission: "facture.emettre",
    classe_risque: "R1",
    vers_client: false,
    annulable: true,
    champs_requis: ["mission_id", "jalon_id"],
    niveau_agent_requis: null,
  },
  appeler_agent: {
    libelle: "Appeler un agent IA",
    description:
      "Exécution d'un agent (brouillon à valider), dans le niveau d'autonomie effectif de sa brique.",
    permission: "ia.utiliser",
    classe_risque: null,
    vers_client: false,
    annulable: false,
    champs_requis: [],
    niveau_agent_requis: "N2",
  },
  relance_questionnaire: {
    libelle: "Relancer les répondants",
    description:
      "Relance R0 des répondants d'un questionnaire (envoi au client : N4, coupe-circuits respectés).",
    permission: "questionnaire.gerer",
    classe_risque: "R0",
    vers_client: true,
    annulable: false,
    champs_requis: ["envoi_id"],
    niveau_agent_requis: null,
  },
};

/** Personne visée par une action, résolue à l'exécution. */
export const DESTINATAIRES_AUTOMATISATION = [
  "chef_mission",
  "directeur_mission",
  "responsable",
  "declencheur",
] as const;
export type DestinataireAutomatisation = (typeof DESTINATAIRES_AUTOMATISATION)[number];
export const DESTINATAIRE_AUTOMATISATION_LIBELLES: Record<DestinataireAutomatisation, string> = {
  chef_mission: "Chef de la mission",
  directeur_mission: "Directeur de la mission",
  responsable: "Responsable de l'automatisation",
  declencheur: "Personne à l'origine de l'événement",
};
const destinataireSchema = z.enum(DESTINATAIRES_AUTOMATISATION);

export const NATURES_BROUILLON_AUTOMATISATION = [
  "note_alerte",
  "rappel_checklist",
  "note",
] as const;
export type NatureBrouillonAutomatisation = (typeof NATURES_BROUILLON_AUTOMATISATION)[number];
export const NATURE_BROUILLON_LIBELLES: Record<NatureBrouillonAutomatisation, string> = {
  note_alerte: "Note d'alerte",
  rappel_checklist: "Rappel de check-list",
  note: "Note",
};

/** Texte à gabarit : `{{champ}}` repris du contenu de l'événement. */
const gabarit = (max: number) => z.string().trim().min(1).max(max);
const gabaritOptionnel = (max: number) => z.string().trim().max(max).default("");

export const actionAutomatisationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("creer_tache"),
      titre: gabarit(200),
      description: gabaritOptionnel(2000),
      assigne: destinataireSchema,
      echeance_jours: z.number().int().min(0).max(365).nullable().default(null),
    })
    .strict(),
  z
    .object({
      type: z.literal("notifier"),
      destinataires: z
        .array(destinataireSchema)
        .min(1)
        .max(DESTINATAIRES_AUTOMATISATION.length)
        .refine((d) => new Set(d).size === d.length, "Destinataire en double."),
      titre: gabarit(200),
      corps: gabaritOptionnel(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("brouillon"),
      nature: z.enum(NATURES_BROUILLON_AUTOMATISATION),
      titre: gabarit(200),
      corps: gabarit(5000),
    })
    .strict(),
  z.object({ type: z.literal("facture_brouillon") }).strict(),
  z
    .object({
      type: z.literal("appeler_agent"),
      agent_code: codeAgentSchema,
      brique_code: codeReferentielSchema.nullable().default(null),
      prompt_nom: nomPromptSchema,
      variables: z
        .record(z.string().regex(NOM_VARIABLE, "Nom de variable invalide."), z.string().max(2000))
        .refine((v) => Object.keys(v).length <= 20, "20 variables au plus.")
        .default({}),
    })
    .strict(),
  z.object({ type: z.literal("relance_questionnaire") }).strict(),
]);
export type ActionAutomatisationApi = z.infer<typeof actionAutomatisationSchema>;
export type ActionAutomatisationSaisie = z.input<typeof actionAutomatisationSchema>;

// ---------------------------------------------------------------------------
// Conditions (AUT-02) — forme du moteur
// ---------------------------------------------------------------------------

export const OPERATEURS_AUTOMATISATION = [
  "egal",
  "different",
  "inferieur",
  "inferieur_ou_egal",
  "superieur",
  "superieur_ou_egal",
  "dans",
  "contient",
] as const;
export type OperateurAutomatisationApi = (typeof OPERATEURS_AUTOMATISATION)[number];
export const OPERATEUR_AUTOMATISATION_LIBELLES: Record<OperateurAutomatisationApi, string> = {
  egal: "est égal à",
  different: "est différent de",
  inferieur: "est inférieur à",
  inferieur_ou_egal: "est inférieur ou égal à",
  superieur: "est supérieur à",
  superieur_ou_egal: "est supérieur ou égal à",
  dans: "est l'une des valeurs",
  contient: "contient",
};

/** Bornes du moteur (`packages/engines/src/automatisation/types.ts`). */
export const PROFONDEUR_CONDITION_AUTOMATISATION_MAX = 4;
export const NOEUDS_CONDITION_AUTOMATISATION_MAX = 30;
export const ACTIONS_PAR_AUTOMATISATION_MAX = 10;

const nombreFini = z.number().finite();
const valeurTexte = z.string().trim().min(1).max(200);
const listeDe = <T extends z.ZodTypeAny>(element: T) => z.array(element).min(1).max(50);

export const valeurCompareeAutomatisationSchema = z.union([
  z.boolean(),
  nombreFini,
  valeurTexte,
  listeDe(valeurTexte),
  listeDe(nombreFini),
]);

export type ConditionAutomatisationApi =
  | { type: "tous"; conditions: ConditionAutomatisationApi[] }
  | { type: "au_moins_un"; conditions: ConditionAutomatisationApi[] }
  | { type: "non"; condition: ConditionAutomatisationApi }
  | {
      type: "comparaison";
      champ: string;
      operateur: OperateurAutomatisationApi;
      valeur: z.infer<typeof valeurCompareeAutomatisationSchema>;
    }
  | { type: "renseigne"; champ: string };

const nomChampSchema = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/, "Nom de champ invalide.");

export const conditionAutomatisationSchema: z.ZodType<ConditionAutomatisationApi> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("tous"),
        conditions: z
          .array(conditionAutomatisationSchema)
          .min(1)
          .max(NOEUDS_CONDITION_AUTOMATISATION_MAX),
      })
      .strict(),
    z
      .object({
        type: z.literal("au_moins_un"),
        conditions: z
          .array(conditionAutomatisationSchema)
          .min(1)
          .max(NOEUDS_CONDITION_AUTOMATISATION_MAX),
      })
      .strict(),
    z.object({ type: z.literal("non"), condition: conditionAutomatisationSchema }).strict(),
    z
      .object({
        type: z.literal("comparaison"),
        champ: nomChampSchema,
        operateur: z.enum(OPERATEURS_AUTOMATISATION),
        valeur: valeurCompareeAutomatisationSchema,
      })
      .strict(),
    z.object({ type: z.literal("renseigne"), champ: nomChampSchema }).strict(),
  ]),
);

/** Condition reçue d'une requête : imbrication JSON bornée AVANT l'analyse récursive. */
export const conditionAutomatisationBorneeSchema = z
  .unknown()
  .refine(
    (v) => imbricationAuPlus(v, 2 * PROFONDEUR_CONDITION_AUTOMATISATION_MAX + 2),
    `Condition trop imbriquée : profondeur ${PROFONDEUR_CONDITION_AUTOMATISATION_MAX} au plus.`,
  )
  .pipe(conditionAutomatisationSchema);

// ---------------------------------------------------------------------------
// Automatisations du cabinet (AUT-02, AUT-03)
// ---------------------------------------------------------------------------

/**
 * Identité d'exécution : `responsable` (compte d'automatisation : les droits ACTUELS du
 * responsable de l'automatisation, limités aux actions du registre) ou `declencheur` (les
 * droits de la personne à l'origine de l'événement ; aucun pour un événement système).
 */
export const MODES_EXECUTION_AUTOMATISATION = ["responsable", "declencheur"] as const;
export type ModeExecutionAutomatisation = (typeof MODES_EXECUTION_AUTOMATISATION)[number];
export const MODE_EXECUTION_LIBELLES: Record<ModeExecutionAutomatisation, string> = {
  responsable: "Compte d'automatisation (droits du responsable)",
  declencheur: "Droits de la personne à l'origine de l'événement",
};

export const definitionAutomatisationSchema = z
  .object({
    evenement_code: codeEvenementAutomatisationSchema,
    condition: conditionAutomatisationBorneeSchema.nullable().default(null),
    actions: z.array(actionAutomatisationSchema).min(1).max(ACTIONS_PAR_AUTOMATISATION_MAX),
    mode_execution: z.enum(MODES_EXECUTION_AUTOMATISATION).default("responsable"),
  })
  .strict();
export type DefinitionAutomatisationApi = z.infer<typeof definitionAutomatisationSchema>;
export type DefinitionAutomatisationSaisie = z.input<typeof definitionAutomatisationSchema>;

export const automatisationCreationSchema = z
  .object({
    nom: texte(200),
    description: z.string().trim().max(2000).default(""),
    definition: definitionAutomatisationSchema,
  })
  .strict();
export type AutomatisationCreation = z.infer<typeof automatisationCreationSchema>;

export const automatisationModificationSchema = z
  .object({
    nom: texte(200).optional(),
    description: z.string().trim().max(2000).optional(),
    definition: definitionAutomatisationSchema.optional(),
  })
  .strict()
  .refine((m) => Object.keys(m).length > 0, "Aucune modification.");
export type AutomatisationModification = z.infer<typeof automatisationModificationSchema>;

export const automatisationsQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

/** Coupe-circuit du cabinet ou d'une automatisation (AUT-06). */
export const coupeCircuitAutomatisationSchema = z
  .object({ actif: z.boolean(), motif: texte(1000) })
  .strict();

/** Simulation sur les événements passés (AUT-04). */
const bornesSimulation = {
  depuis: dateIsoSchema.optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
};
export const simulationAutomatisationSchema = z.object(bornesSimulation).strict();
export const simulationDefinitionSchema = z
  .object({ definition: definitionAutomatisationSchema, ...bornesSimulation })
  .strict();

// ---------------------------------------------------------------------------
// Journal, annulation, brouillons (AUT-06)
// ---------------------------------------------------------------------------

export const ISSUES_EXECUTION_AUTOMATISATION = [
  "declenchee",
  "conditions_non_remplies",
  "bloquee",
] as const;
export type IssueExecutionAutomatisation = (typeof ISSUES_EXECUTION_AUTOMATISATION)[number];
export const ISSUE_EXECUTION_LIBELLES: Record<IssueExecutionAutomatisation, string> = {
  declenchee: "Déclenchée",
  conditions_non_remplies: "Conditions non remplies",
  bloquee: "Bloquée par un coupe-circuit",
};

export const STATUTS_RESULTAT_ACTION = ["reussie", "refusee", "echec", "ignoree"] as const;
export type StatutResultatAction = (typeof STATUTS_RESULTAT_ACTION)[number];
export const STATUT_RESULTAT_LIBELLES: Record<StatutResultatAction | "en_file", string> = {
  reussie: "Réussie",
  refusee: "Refusée par la garde",
  echec: "En échec",
  ignoree: "Sans objet",
  en_file: "En file",
};

export const REFUS_GARDE_LIBELLES: Record<string, string> = {
  COUPE_CIRCUIT_CABINET: "Coupe-circuit du cabinet",
  COUPE_CIRCUIT_AUTOMATISATION: "Coupe-circuit de l'automatisation",
  COUPE_CIRCUIT_N4: "Coupe-circuit N4 (aucun envoi automatique au client)",
  CONTENU_R2_R3_VERS_CLIENT: "Contenu R2 ou R3 : jamais envoyé au client sans validation",
  N4_RESERVE_R0: "Envoi automatique au client réservé à la classe R0",
  NIVEAU_AGENT_INSUFFISANT: "Niveau d'autonomie de la brique insuffisant",
  DROITS_INSUFFISANTS: "L'exécutant n'a pas la permission de l'action",
  MISSION_INVISIBLE: "L'exécutant ne voit pas la mission",
  EXECUTANT_INDISPONIBLE: "Aucun exécutant actif",
  AGENT_INCONNU: "Agent ou brique inconnus",
};

export const executionsAutomatisationQuerySchema = z
  .object({
    automatisation_id: z.string().uuid().optional(),
    issue: z.enum(ISSUES_EXECUTION_AUTOMATISATION).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

export const annulationActionAutomatisationSchema = z.object({ motif: texte(1000) }).strict();

export const DECISIONS_BROUILLON_AUTOMATISATION = ["validee", "modifiee", "rejetee"] as const;
export const DECISION_BROUILLON_LIBELLES: Record<
  (typeof DECISIONS_BROUILLON_AUTOMATISATION)[number] | "annulee",
  string
> = {
  validee: "Validé",
  modifiee: "Modifié puis validé",
  rejetee: "Rejeté",
  annulee: "Annulé",
};

export const decisionBrouillonAutomatisationSchema = z
  .object({
    decision: z.enum(DECISIONS_BROUILLON_AUTOMATISATION),
    texte_final: texte(5000).optional(),
    motif: texte(1000).optional(),
  })
  .strict()
  .refine(
    (d) => (d.decision === "modifiee") === (d.texte_final !== undefined),
    "Le texte final accompagne une modification, et seulement elle.",
  )
  .refine((d) => d.decision !== "rejetee" || d.motif !== undefined, "Motif requis pour un rejet.");

export const brouillonsAutomatisationQuerySchema = z
  .object({
    a_valider: z.enum(["true", "false"]).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Bibliothèque standard (AUT-03) — en données, validée par les schémas ci-dessus
// ---------------------------------------------------------------------------

export interface AutomatisationStandard {
  readonly code: string;
  readonly nom: string;
  readonly description: string;
  /** Ce qui reste une décision humaine (PRD complémentaire §8.2). */
  readonly decision_humaine: string;
  readonly definition: DefinitionAutomatisationSaisie;
}

export const AUTOMATISATIONS_STANDARD: readonly AutomatisationStandard[] = [
  {
    code: "jalon_facture_brouillon",
    nom: "Jalon atteint : facture en brouillon",
    description:
      "Quand un jalon est atteint, prépare la facture en brouillon depuis les échéances qui lui sont rattachées et prévient le responsable.",
    decision_humaine: "Approbation et émission de la facture.",
    definition: {
      evenement_code: "mission.jalon_atteint",
      condition: null,
      mode_execution: "responsable",
      actions: [
        { type: "facture_brouillon" },
        {
          type: "notifier",
          destinataires: ["responsable"],
          titre: "Jalon « {{libelle}} » atteint : facture à vérifier",
          corps:
            "Une facture en brouillon est préparée si une échéance est rattachée à ce jalon. Vérifiez-la puis soumettez-la au circuit d'approbation.",
        },
      ],
    },
  },
  {
    code: "questionnaire_sans_reponse_alerte",
    nom: "Questionnaire sans réponse : alerte au chef de mission",
    description:
      "Dix jours après l'envoi, si des répondants n'ont toujours pas répondu malgré les relances J+3 et J+7, alerte le chef de mission.",
    decision_humaine: "Relance personnelle du client.",
    definition: {
      evenement_code: "questionnaire.sans_reponse",
      condition: {
        type: "comparaison",
        champ: "jours_sans_reponse",
        operateur: "egal",
        valeur: 10,
      },
      mode_execution: "responsable",
      actions: [
        {
          type: "notifier",
          destinataires: ["chef_mission"],
          titre: "Questionnaire « {{titre}} » sans réponse depuis {{jours_sans_reponse}} jours",
          corps:
            "{{repondants_en_attente}} répondant(s) n'ont pas répondu malgré les relances J+3 et J+7. Une relance personnelle est recommandée.",
        },
      ],
    },
  },
  {
    code: "cloture_rappel_checklist",
    nom: "Clôture demandée : rappel de la check-list",
    description:
      "Quand la clôture d'une mission est demandée, rappelle au chef et au directeur de mission la check-list bloquante.",
    decision_humaine: "Clôture de la mission.",
    definition: {
      evenement_code: "mission.cloture_demandee",
      condition: null,
      mode_execution: "responsable",
      actions: [
        {
          type: "notifier",
          destinataires: ["chef_mission", "directeur_mission"],
          titre: "Clôture demandée : vérifiez la check-list",
          corps:
            "Temps validés, débours traités, factures émises, livrables signés, capitalisation faite : la clôture reste bloquée tant que la check-list n'est pas complète.",
        },
      ],
    },
  },
  {
    code: "kpi_rouge_note_alerte",
    nom: "KPI au rouge deux périodes : note d'alerte",
    description:
      "Quand un KPI est au rouge deux périodes de suite, prépare une note d'alerte en brouillon et prévient le chef de mission.",
    decision_humaine: "Analyse, action corrective et éventuelle offre au client.",
    definition: {
      evenement_code: "kpi.rouge_deux_periodes",
      condition: { type: "comparaison", champ: "periodes_rouges", operateur: "egal", valeur: 2 },
      mode_execution: "responsable",
      actions: [
        {
          type: "brouillon",
          nature: "note_alerte",
          titre: "Note d'alerte : KPI « {{libelle}} » au rouge",
          corps:
            "Le KPI « {{libelle}} » est au rouge depuis {{periodes_rouges}} périodes consécutives (dernière période : {{periode}}). Analyse de l'écart et action corrective à rédiger ; toute offre au client reste une décision humaine.",
        },
        {
          type: "notifier",
          destinataires: ["chef_mission"],
          titre: "Note d'alerte à valider : KPI « {{libelle}} »",
          corps: "Une note d'alerte en brouillon attend votre validation.",
        },
      ],
    },
  },
];

export const CODES_AUTOMATISATION_STANDARD = AUTOMATISATIONS_STANDARD.map((a) => a.code);
export const paramsAutomatisationStandardSchema = z
  .object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Code invalide.") })
  .strict();
