import { z } from "zod";
import { texte, texteOptionnel } from "./commun";
import {
  CLASSES_RISQUE,
  classeRisqueSchema,
  codeReferentielSchema,
  contexteModulationSchema,
  effetModulationSchema,
  niveauAutonomieSchema,
  typeFacteurContexteSchema,
  VALEURS_LISTE_MAX,
  type ClasseRisque,
} from "./fondations";

/*
 * Référentiel de méthodes (lot STD, V3 : STD-01 à STD-12, PRD complémentaire §4, ADR-004) :
 * schémas des routes de `apps/api/src/routes/standard.ts`. Les règles de modulation gardent
 * la forme du schéma partagé `regleModulationSchema` (fondations.ts), identique au moteur.
 * Clés JSON en snake_case français (CODING_STANDARDS §2) ; l'API convertit les cas types
 * vers la forme du moteur (`briquesDeBase`, `reglesDeclenchees`…).
 */

// ---------------------------------------------------------------------------
// Bornes
// ---------------------------------------------------------------------------

/** Contenu d'une version de méthode : bornes appliquées par l'API à chaque ajout. */
export const BORNES_VERSION_METHODE = {
  etapes: 50,
  briques: 300,
  elements: 500,
  rubriques: 100,
  regles: 500,
  casTypes: 100,
} as const;

/** Facteurs de contexte propres à un cabinet (en plus du standard). */
export const FACTEURS_CABINET_MAX = 200;

const texteCourt = texte(200).refine((v) => !/\p{Cc}/u.test(v), {
  message: "Caractères de contrôle interdits.",
});
const texteLong = (max = 4000) => texte(max);
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);
const curseurSchema = z.string().max(500).optional();

// ---------------------------------------------------------------------------
// Dictionnaire de données et taxonomies (STD-10)
// ---------------------------------------------------------------------------

export const TAXONOMIES = [
  "secteur",
  "filiere",
  "pays",
  "zone",
  "taille",
  "fonction",
  "processus",
  "kpi",
  "risque",
] as const;
export type Taxonomie = (typeof TAXONOMIES)[number];
export const taxonomieSchema = z.enum(TAXONOMIES);

export const TAXONOMIE_LIBELLES: Record<Taxonomie, string> = {
  secteur: "Secteurs (CITI rév. 4)",
  filiere: "Filières",
  pays: "Pays",
  zone: "Zones économiques",
  taille: "Tailles d'entreprise",
  fonction: "Fonctions",
  processus: "Processus",
  kpi: "Familles de KPI",
  risque: "Familles de risques",
};

export const taxonomieQuerySchema = z
  .object({ taxonomie: taxonomieSchema.optional(), limite: limiteSchema, curseur: curseurSchema })
  .strict();

export const taxonomieCreationSchema = z
  .object({
    taxonomie: taxonomieSchema,
    code: codeReferentielSchema,
    libelle: texteCourt,
    parent_code: codeReferentielSchema.nullable().optional(),
    description: texteOptionnel(2000),
  })
  .strict();
export type TaxonomieCreation = z.infer<typeof taxonomieCreationSchema>;

// ---------------------------------------------------------------------------
// Facteurs de contexte (STD-04)
// ---------------------------------------------------------------------------

export const PORTEURS_FACTEUR = ["dossier", "mission"] as const;
export type PorteurFacteur = (typeof PORTEURS_FACTEUR)[number];

const valeurFacteurLibelleeSchema = z
  .object({ code: codeReferentielSchema, libelle: texteCourt })
  .strict();

export const facteurCreationSchema = z
  .object({
    code: codeReferentielSchema,
    libelle: texteCourt,
    description: texteOptionnel(2000),
    type: typeFacteurContexteSchema,
    valeurs: z.array(valeurFacteurLibelleeSchema).min(1).max(VALEURS_LISTE_MAX).optional(),
    min: z.number().finite().nullable().optional(),
    max: z.number().finite().nullable().optional(),
    porte_par: z.enum(PORTEURS_FACTEUR).default("mission"),
  })
  .strict()
  .superRefine((f, ctx) => {
    const avecValeurs = f.type === "enumeration" || f.type === "liste";
    if (avecValeurs !== (f.valeurs !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valeurs"],
        message: "Valeurs obligatoires pour une énumération ou une liste, interdites sinon.",
      });
    }
    if (f.valeurs && new Set(f.valeurs.map((v) => v.code)).size !== f.valeurs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valeurs"],
        message: "Valeurs en double.",
      });
    }
    const bornes = [f.min, f.max].some((b) => b !== undefined && b !== null);
    if (f.type !== "nombre" && bornes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["min"],
        message: "Bornes réservées aux facteurs numériques.",
      });
    }
    if (typeof f.min === "number" && typeof f.max === "number" && f.min > f.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message: "Borne minimale supérieure à la maximale.",
      });
    }
  });
export type FacteurCreation = z.infer<typeof facteurCreationSchema>;

// ---------------------------------------------------------------------------
// Notes de contexte (STD-06)
// ---------------------------------------------------------------------------

export const CIBLES_NOTE_CONTEXTE = [
  "service",
  "methode",
  "brique",
  "facteur",
  "taxonomie",
] as const;
export type CibleNoteContexte = (typeof CIBLES_NOTE_CONTEXTE)[number];

export const noteContexteCreationSchema = z
  .object({
    cible_type: z.enum(CIBLES_NOTE_CONTEXTE),
    cible_code: codeReferentielSchema,
    contexte: texteOptionnel(120),
    texte: texteLong(4000),
  })
  .strict();

export const noteContexteQuerySchema = z
  .object({
    cible_type: z.enum(CIBLES_NOTE_CONTEXTE).optional(),
    cible_code: codeReferentielSchema.optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Méthodes, versions et contenu (STD-01 à STD-03, STD-09, STD-11)
// ---------------------------------------------------------------------------

/**
 * Moteurs de calcul de `packages/engines` qu'une brique peut référencer (code → libellé).
 * Une brique sans moteur relève du jugement de l'expert ; un code inconnu bloque la publication.
 */
export const MOTEURS_STANDARD = {
  "questionnaires.etat": "Questionnaires : état et visibilité des questions",
  "questionnaires.notation_repondants": "Questionnaires : notes par répondant",
  "notation.score_global": "Notation : score global et classe",
  "notation.ecarts_perception": "Notation : écarts entre populations de répondants",
  "notation.forces_faiblesses": "Notation : forces et faiblesses",
  "notation.ajustement": "Notation : ajustement motivé",
  "notation.comparaison": "Notation : comparaison de deux notations",
  "plan.modele_financier": "Plan : modèle financier",
  "plan.scenarios": "Plan : scénarios du modèle",
  "plan.feuille_de_route": "Plan : recalage de la feuille de route",
  "plan.dependances": "Plan : contrôle des dépendances",
  "kpi.evaluation": "KPI : évaluation et alertes",
  "preuves.solidite": "Preuves : indice de solidité",
  "modulation.application": "Méthodes : application des règles de modulation",
} as const;
export type CodeMoteurStandard = keyof typeof MOTEURS_STANDARD;
export const CODES_MOTEURS_STANDARD = Object.keys(MOTEURS_STANDARD) as CodeMoteurStandard[];

export const STATUTS_VERSION_METHODE = ["brouillon", "publiee"] as const;
export type StatutVersionMethode = (typeof STATUTS_VERSION_METHODE)[number];

export const TYPES_ELEMENT_METHODE = [
  "livrable",
  "item",
  "kpi_type",
  "initiative_type",
  "risque_type",
  "gabarit",
  "automatisation",
] as const;
export type TypeElementMethode = (typeof TYPES_ELEMENT_METHODE)[number];

export const TYPE_ELEMENT_LIBELLES: Record<TypeElementMethode, string> = {
  livrable: "Livrable",
  item: "Item",
  kpi_type: "KPI type",
  initiative_type: "Initiative type",
  risque_type: "Risque type",
  gabarit: "Gabarit",
  automatisation: "Automatisation",
};

export const methodeListeQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

export const methodeCreationSchema = z
  .object({
    service_id: z.string().uuid(),
    code: codeReferentielSchema,
    libelle: texteCourt,
    description: texteOptionnel(4000),
  })
  .strict();

export const varianteCreationSchema = z
  .object({
    code: codeReferentielSchema.optional(),
    libelle: texteCourt.optional(),
  })
  .strict();

export const versionCreationSchema = z
  .object({
    /** Variante : repartir de la dernière version publiée du standard en gardant ses écarts. */
    rebaser: z.boolean().default(false),
    notes_version: texteOptionnel(4000),
  })
  .strict();

export const versionModificationSchema = z.object({ notes_version: texteOptionnel(4000) }).strict();

export const comparaisonVersionsQuerySchema = z.object({ avec: z.string().uuid() }).strict();

const ordreSchema = z.number().int().min(0).max(10_000);

export const etapeCreationSchema = z
  .object({
    code: codeReferentielSchema,
    libelle: texteCourt,
    description: texteOptionnel(2000),
    ordre: ordreSchema.optional(),
  })
  .strict();

export const etapeModificationSchema = z
  .object({
    libelle: texteCourt.optional(),
    description: texteOptionnel(2000),
    ordre: ordreSchema.optional(),
  })
  .strict();

const champsBrique = {
  libelle: texteCourt,
  objet: texteLong(2000),
  entrees: texteOptionnel(2000),
  moteur: codeReferentielSchema.nullable().optional(),
  agent: codeReferentielSchema.nullable().optional(),
  classe_risque: classeRisqueSchema,
  garde: texteOptionnel(1000),
  sortie: texteOptionnel(2000),
  definition_termine: texteOptionnel(2000),
  temps_type_jours: z.number().finite().min(0).max(1000).multipleOf(0.25).nullable().optional(),
  profil_temps: texteOptionnel(120),
  niveau_autonomie_max: niveauAutonomieSchema,
  active_par_defaut: z.boolean(),
  ordre: ordreSchema.optional(),
};

export const briqueCreationSchema = z
  .object({ etape_id: z.string().uuid(), code: codeReferentielSchema, ...champsBrique })
  .strict();
export type BriqueCreation = z.infer<typeof briqueCreationSchema>;

export const briqueModificationSchema = z
  .object({
    etape_id: z.string().uuid().optional(),
    libelle: champsBrique.libelle.optional(),
    objet: champsBrique.objet.optional(),
    entrees: champsBrique.entrees,
    moteur: champsBrique.moteur,
    agent: champsBrique.agent,
    classe_risque: champsBrique.classe_risque.optional(),
    garde: champsBrique.garde,
    sortie: champsBrique.sortie,
    definition_termine: champsBrique.definition_termine,
    temps_type_jours: champsBrique.temps_type_jours,
    profil_temps: champsBrique.profil_temps,
    niveau_autonomie_max: champsBrique.niveau_autonomie_max.optional(),
    active_par_defaut: z.boolean().optional(),
    ordre: ordreSchema.optional(),
  })
  .strict();

export const elementMethodeCreationSchema = z
  .object({
    type: z.enum(TYPES_ELEMENT_METHODE),
    code: codeReferentielSchema,
    libelle: texteCourt,
    description: texteOptionnel(2000),
    brique_id: z.string().uuid().nullable().optional(),
    essentiel: z.boolean().default(false),
    actif_par_defaut: z.boolean().default(true),
  })
  .strict();

const exempleAncrageSchema = z.object({ contexte: texte(120), texte: texteLong(1000) }).strict();

const ancrageSchema = z
  .object({
    niveau: z.number().int().min(1).max(5),
    description: texteLong(1000),
    exemples: z.array(exempleAncrageSchema).max(10).default([]),
  })
  .strict();

/** Rubrique à ancrages (STD-09) : cinq niveaux décrits par des comportements observables. */
export const rubriqueCreationSchema = z
  .object({
    code: codeReferentielSchema,
    libelle: texteCourt,
    dimension: codeReferentielSchema.nullable().optional(),
    brique_id: z.string().uuid().nullable().optional(),
    ancrages: z
      .array(ancrageSchema)
      .length(5)
      .refine(
        (a) => a.every((x, i) => x.niveau === i + 1),
        "Cinq niveaux attendus, du niveau 1 au niveau 5, dans l'ordre.",
      ),
  })
  .strict();

/** Cas type d'un jeu de règles (STD-05), en clés de l'API. */
export const casTypeCreationSchema = z
  .object({
    code: codeReferentielSchema,
    libelle: texteOptionnel(200),
    contexte: contexteModulationSchema,
    briques_de_base: z.array(codeReferentielSchema).max(300).optional(),
    attendu: z
      .object({
        presents: z.array(effetModulationSchema).max(100).optional(),
        absents: z.array(effetModulationSchema).max(100).optional(),
        regles_declenchees: z.array(codeReferentielSchema).max(500).optional(),
        conflits_non_resolus: z.number().int().min(0).max(1000).optional(),
      })
      .strict(),
  })
  .strict();
export type CasTypeCreation = z.infer<typeof casTypeCreationSchema>;

/** Simulation d'un jeu de règles sur deux contextes (STD-05). */
export const simulationModulationSchema = z
  .object({
    contexte_avant: contexteModulationSchema,
    contexte_apres: contexteModulationSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Mission figée sur une version (STD-08) et dérogations (STD-07)
// ---------------------------------------------------------------------------

export const missionMethodeLiaisonSchema = z
  .object({ version_id: z.string().uuid(), contexte: contexteModulationSchema.default({}) })
  .strict();

export const missionContexteSchema = z
  .object({ contexte: contexteModulationSchema, motif: texteOptionnel(2000) })
  .strict();

export const missionMigrationQuerySchema = z.object({ version_id: z.string().uuid() }).strict();

export const missionMigrationSchema = z
  .object({ version_id: z.string().uuid(), motif: texte(2000).pipe(z.string().min(10)) })
  .strict();

export const NATURES_DEROGATION = ["retirer_brique", "activer_brique", "adapter_brique"] as const;
export type NatureDerogation = (typeof NATURES_DEROGATION)[number];

export const NATURE_DEROGATION_LIBELLES: Record<NatureDerogation, string> = {
  retirer_brique: "Retirer la brique",
  activer_brique: "Activer la brique",
  adapter_brique: "Adapter la brique",
};

export const STATUTS_DEROGATION = ["demandee", "approuvee", "refusee"] as const;
export type StatutDerogation = (typeof STATUTS_DEROGATION)[number];

/** Étapes de garde (moteur `qualite`, `ETAPES_GARDE`), dans l'ordre où elles se franchissent. */
export const ETAPES_GARDE_DEROGATION = [
  "validation_auteur",
  "validation_consultant",
  "relecture_chef_mission",
  "revue_second_expert",
  "signature_directeur_mission",
] as const;
export type EtapeGardeDerogation = (typeof ETAPES_GARDE_DEROGATION)[number];

export const ETAPE_GARDE_DEROGATION_LIBELLES: Record<EtapeGardeDerogation, string> = {
  validation_auteur: "Validation de l'auteur",
  validation_consultant: "Validation du consultant",
  relecture_chef_mission: "Relecture du chef de mission",
  revue_second_expert: "Revue d'un second expert",
  signature_directeur_mission: "Signature du directeur de mission",
};

export const derogationCreationSchema = z
  .object({
    brique_code: codeReferentielSchema,
    nature: z.enum(NATURES_DEROGATION),
    description: texteOptionnel(2000),
    motif: texte(2000).pipe(z.string().min(10, "Motif de 10 caractères au moins.")),
  })
  .strict()
  .refine((d) => d.nature !== "adapter_brique" || Boolean(d.description), {
    message: "Décrire l'adaptation demandée.",
    path: ["description"],
  });

export const derogationDecisionSchema = z
  .object({
    etape: z.enum(ETAPES_GARDE_DEROGATION),
    decision: z.enum(["approuve", "refuse"]),
    commentaire: texteOptionnel(2000),
  })
  .strict()
  .refine((d) => d.decision === "approuve" || Boolean(d.commentaire), {
    message: "Motiver le refus.",
    path: ["commentaire"],
  });

export const derogationsQuerySchema = z
  .object({
    statut: z.enum(STATUTS_DEROGATION).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Comité méthode : propositions de changement (STD-12)
// ---------------------------------------------------------------------------

export const STATUTS_PROPOSITION_STANDARD = [
  "proposee",
  "en_revue",
  "acceptee",
  "refusee",
  "publiee",
] as const;
export type StatutPropositionStandard = (typeof STATUTS_PROPOSITION_STANDARD)[number];

export const STATUT_PROPOSITION_LIBELLES: Record<StatutPropositionStandard, string> = {
  proposee: "Proposée",
  en_revue: "En revue",
  acceptee: "Acceptée",
  refusee: "Refusée",
  publiee: "Publiée",
};

export const propositionStandardCreationSchema = z
  .object({
    methode_id: z.string().uuid().nullable().optional(),
    titre: texteCourt,
    description: texteLong(4000),
  })
  .strict();

export const propositionStandardRevueSchema = z
  .object({
    action: z.enum(["prendre_en_revue", "accepter", "refuser"]),
    avis: texteOptionnel(4000),
  })
  .strict()
  .refine((d) => d.action !== "refuser" || Boolean(d.avis), {
    message: "Motiver le refus.",
    path: ["avis"],
  });

export const propositionStandardPublicationSchema = z
  .object({ version_id: z.string().uuid() })
  .strict();

export const propositionsStandardQuerySchema = z
  .object({
    statut: z.enum(STATUTS_PROPOSITION_STANDARD).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Libellés communs
// ---------------------------------------------------------------------------

export const ORIGINE_METHODE_LIBELLES = {
  standard: "Standard MissionPilot",
  variante: "Variante du cabinet",
  cabinet: "Méthode du cabinet",
} as const;
export type OrigineMethode = keyof typeof ORIGINE_METHODE_LIBELLES;

/** Rang d'une classe de risque (R0 → 0) : affichage de la classe relevée. */
export function rangClasse(classe: ClasseRisque): number {
  return CLASSES_RISQUE.indexOf(classe);
}
