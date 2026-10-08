import { z } from "zod";
import { dateIsoSchema, texte } from "./commun";
import { classeRisqueSchema, type ClasseRisque } from "./fondations";

/*
 * Qualité et responsabilité professionnelle (lot QUA, PRD complémentaire §10) : contrat des routes
 * /api/qualite/**. La séparation des tâches et les gardes par classe sont celles du moteur
 * (`packages/engines/src/qualite`) ; ces schémas ne portent que la forme des échanges.
 */

const uuid = z.string().uuid();

export const TYPES_LIVRABLE = [
  "rapport",
  "notation",
  "plan",
  "questionnaire",
  "etat",
  "autre",
] as const;
export type TypeLivrable = (typeof TYPES_LIVRABLE)[number];
export const typeLivrableSchema = z.enum(TYPES_LIVRABLE);

export const TYPE_LIVRABLE_LIBELLES: Record<TypeLivrable, string> = {
  rapport: "Rapport",
  notation: "Notation publiée",
  plan: "Plan stratégique",
  questionnaire: "Questionnaire",
  etat: "État financier",
  autre: "Autre livrable",
};

/** Classe minimale d'un type de livrable (QUA-01) : la classe d'un suivi se relève, jamais en dessous. */
export const CLASSE_MINIMALE_PAR_TYPE: Record<TypeLivrable, ClasseRisque> = {
  rapport: "R2",
  notation: "R3",
  plan: "R3",
  questionnaire: "R2",
  etat: "R3",
  autre: "R1",
};

export const STATUTS_SUIVI = ["brouillon", "en_revue", "valide", "signe"] as const;
export type StatutSuivi = (typeof STATUTS_SUIVI)[number];
export const STATUT_SUIVI_LIBELLES: Record<StatutSuivi, string> = {
  brouillon: "Brouillon",
  en_revue: "En revue",
  valide: "Validé",
  signe: "Signé",
};

export const ETAPES_GARDE_QUALITE = [
  "validation_auteur",
  "validation_consultant",
  "relecture_chef_mission",
  "revue_second_expert",
  "signature_directeur_mission",
] as const;
export type EtapeGardeQualite = (typeof ETAPES_GARDE_QUALITE)[number];
export const etapeGardeSchema = z.enum(ETAPES_GARDE_QUALITE);
export const ETAPE_GARDE_LIBELLES: Record<EtapeGardeQualite, string> = {
  validation_auteur: "Validation de l'auteur",
  validation_consultant: "Validation du consultant",
  relecture_chef_mission: "Relecture du chef de mission",
  revue_second_expert: "Revue d'un second expert (quatre yeux)",
  signature_directeur_mission: "Signature du directeur de mission",
};

export const KINDS_ELEMENT_REVUE = ["assertion_fragile", "chiffre", "recommandation"] as const;
export type KindElementRevue = (typeof KINDS_ELEMENT_REVUE)[number];
export const kindElementRevueSchema = z.enum(KINDS_ELEMENT_REVUE);
export const KIND_ELEMENT_LIBELLES: Record<KindElementRevue, string> = {
  assertion_fragile: "Assertion fragile",
  chiffre: "Chiffre",
  recommandation: "Recommandation",
};

export const STATUTS_VERIFICATION = [
  "conforme",
  "non_conforme",
  "non_evaluable",
  "atteste",
] as const;
export type StatutVerification = (typeof STATUTS_VERIFICATION)[number];
export const STATUT_VERIFICATION_LIBELLES: Record<StatutVerification, string> = {
  conforme: "Conforme",
  non_conforme: "Non conforme",
  non_evaluable: "À attester",
  atteste: "Attesté",
};

// ---------------------------------------------------------------------------
// Suivi d'un livrable
// ---------------------------------------------------------------------------

export const suiviOuvertureSchema = z
  .object({
    mission_id: uuid,
    type_livrable: typeLivrableSchema,
    livrable_id: uuid,
    libelle: texte(200),
    version: z.number().int().min(1).max(100000).default(1),
    /** Relèvement éventuel ; jamais sous la classe minimale du type. */
    classe: classeRisqueSchema.optional(),
    /**
     * Auteur humain d'un livrable OPAQUE (`etat`, `autre`) : membre actif de la mission ; `null` :
     * produit par un agent. Ignoré pour un type lisible par le module qualité (l'auteur est celui
     * du module) ; `null` y est refusé.
     */
    auteur_id: uuid.nullable().optional(),
  })
  .strict();
export type SuiviOuverture = z.infer<typeof suiviOuvertureSchema>;

export const suiviListeQuerySchema = z
  .object({
    mission_id: uuid.optional(),
    statut: z.enum(STATUTS_SUIVI).optional(),
    type_livrable: typeLivrableSchema.optional(),
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();

export const classeRelevementSchema = z
  .object({ classe: classeRisqueSchema, motif: texte(1000) })
  .strict();

/**
 * Source RÉSOLUE d'un élément de revue, posée par le serveur seul : `moteur` (calcul d'un moteur
 * MissionPilot), `preuve` (preuve du registre de la mission). Un chiffre n'est « tracé » pour la
 * définition de terminé que si sa source est résolue, jamais sur un texte libre.
 */
export const SOURCES_RESOLUES = ["moteur", "preuve"] as const;
export type SourceResolue = (typeof SOURCES_RESOLUES)[number];

const cleElementRevue = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/);

/**
 * Élément déposé par le SERVICE INTERNE `ajouterElementsRevue` (modules rapports, notation,
 * preuves) : lui seul fixe `obligatoire`, la `source` et son type résolu. Jamais reçu d'une requête.
 */
export const elementRevueSchema = z
  .object({
    cle: cleElementRevue,
    kind: kindElementRevueSchema,
    libelle: texte(500),
    ordre: z.number().int().min(0).max(100000).default(0),
    obligatoire: z.boolean().default(true),
    source: texte(300).nullable().optional(),
    source_type: z.enum(SOURCES_RESOLUES).nullable().optional(),
    reference: texte(200).nullable().optional(),
  })
  .strict()
  .refine((v) => v.source_type == null || v.source != null, {
    message: "Une source résolue porte son libellé.",
    path: ["source"],
  });
export type ElementRevueSaisi = z.input<typeof elementRevueSchema>;

/**
 * Élément ajouté par un relecteur (route `POST /qualite/suivis/:id/elements`) : toujours
 * obligatoire, sans source libre. Un chiffre se trace par une preuve du registre de la mission
 * (`preuve_id`, vérifiée par le serveur) ; sans elle, il reste « sans source ».
 */
export const elementRevueRelecteurSchema = z
  .object({
    cle: cleElementRevue,
    kind: kindElementRevueSchema,
    libelle: texte(500),
    ordre: z.number().int().min(0).max(100000).default(0),
    reference: texte(200).nullable().optional(),
    preuve_id: uuid.optional(),
  })
  .strict()
  .refine((v) => v.preuve_id === undefined || v.kind === "chiffre", {
    message: "Seul un chiffre se rattache à une preuve.",
    path: ["preuve_id"],
  });
export type ElementRevueRelecteur = z.infer<typeof elementRevueRelecteurSchema>;

export const ELEMENTS_REVUE_PAR_APPEL_MAX = 200;
export const elementsRevueSchema = z
  .object({
    elements: z.array(elementRevueRelecteurSchema).min(1).max(ELEMENTS_REVUE_PAR_APPEL_MAX),
  })
  .strict();

export const attestationSchema = z.object({ commentaire: texte(1000) }).strict();

export const validationEtapeSchema = z
  .object({
    etape: etapeGardeSchema,
    commentaire: texte(2000).nullable().optional(),
  })
  .strict();

export const signatureSchema = z
  .object({ commentaire: texte(2000).nullable().optional() })
  .strict();

// ---------------------------------------------------------------------------
// Acceptation de mission (QUA-07)
// ---------------------------------------------------------------------------

export const NATURES_RELATION_CLIENT = ["meme_groupe", "investisseur_cible", "concurrent"] as const;
export type NatureRelationClient = (typeof NATURES_RELATION_CLIENT)[number];
export const NATURE_RELATION_LIBELLES: Record<NatureRelationClient, string> = {
  meme_groupe: "Même groupe",
  investisseur_cible: "Investisseur et société cible",
  concurrent: "Concurrent déclaré",
};

export const relationClientSchema = z
  .object({
    client_id: uuid,
    client_lie_id: uuid,
    nature: z.enum(NATURES_RELATION_CLIENT),
    note: texte(500).nullable().optional(),
  })
  .strict()
  .refine((v) => v.client_id !== v.client_lie_id, {
    message: "Un client ne peut pas être lié à lui-même.",
    path: ["client_lie_id"],
  });

export const NIVEAUX_RISQUE_CLIENT = ["faible", "moyen", "eleve"] as const;
export type NiveauRisqueClient = (typeof NIVEAUX_RISQUE_CLIENT)[number];
export const niveauRisqueClientSchema = z.enum(NIVEAUX_RISQUE_CLIENT);
export const NIVEAU_RISQUE_LIBELLES: Record<NiveauRisqueClient, string> = {
  faible: "Faible",
  moyen: "Moyen",
  eleve: "Élevé",
};

/** Facteurs de risque du client (profil, QUA-07) et niveau que chacun impose au minimum. */
export const FACTEURS_RISQUE_CLIENT = [
  { code: "pays_a_risque", libelle: "Pays ou zone à risque élevé", niveau: "eleve" },
  {
    code: "personne_exposee",
    libelle: "Dirigeant ou actionnaire politiquement exposé",
    niveau: "eleve",
  },
  { code: "litige_en_cours", libelle: "Litige ou contentieux important en cours", niveau: "eleve" },
  { code: "client_en_difficulte", libelle: "Client en difficulté financière", niveau: "eleve" },
  { code: "secteur_reglemente", libelle: "Secteur fortement réglementé", niveau: "moyen" },
  { code: "gouvernance_opaque", libelle: "Gouvernance ou actionnariat opaque", niveau: "moyen" },
  {
    code: "information_incomplete",
    libelle: "Informations du client incomplètes",
    niveau: "moyen",
  },
  { code: "dependance_honoraires", libelle: "Dépendance du cabinet à ce client", niveau: "moyen" },
] as const satisfies readonly { code: string; libelle: string; niveau: NiveauRisqueClient }[];
export type FacteurRisqueClient = (typeof FACTEURS_RISQUE_CLIENT)[number]["code"];

export const DECISIONS_ACCEPTATION = [
  "en_attente",
  "acceptee",
  "acceptee_sous_conditions",
  "refusee",
] as const;
export type DecisionAcceptation = (typeof DECISIONS_ACCEPTATION)[number];
export const DECISION_ACCEPTATION_LIBELLES: Record<DecisionAcceptation, string> = {
  en_attente: "En attente",
  acceptee: "Acceptée",
  acceptee_sous_conditions: "Acceptée sous conditions",
  refusee: "Refusée",
};

export const acceptationSchema = z
  .object({
    facteurs: z
      .array(z.enum(FACTEURS_RISQUE_CLIENT.map((f) => f.code) as [string, ...string[]]))
      .max(20)
      .default([]),
    /** Relèvement du niveau calculé (jamais en dessous). */
    niveau_retenu: niveauRisqueClientSchema.optional(),
    decision: z.enum(DECISIONS_ACCEPTATION),
    motif: texte(2000).nullable().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Satisfaction du client (QUA-08)
// ---------------------------------------------------------------------------

export const MOMENTS_SATISFACTION = ["jalon", "cloture"] as const;
/**
 * Origine d'une note : `saisie_par_equipe` (le cabinet saisit pour le compte du client, seule
 * voie en V1, donc l'équipe évaluée peut saisir sa propre note) ou `client` (saisie directe par le
 * client, réservée). Tracée en base, sans effet sur le calcul du NPS.
 */
export const ORIGINES_SATISFACTION = ["saisie_par_equipe", "client"] as const;
export type OrigineSatisfaction = (typeof ORIGINES_SATISFACTION)[number];
export const satisfactionSchema = z
  .object({
    moment: z.enum(MOMENTS_SATISFACTION),
    jalon_id: uuid.nullable().optional(),
    /** Note de recommandation de 0 à 10 (NPS). */
    note: z.number().int().min(0).max(10),
    commentaire: texte(2000).nullable().optional(),
    repondant: texte(200).nullable().optional(),
  })
  .strict()
  .refine((v) => (v.moment === "jalon") === (typeof v.jalon_id === "string"), {
    message: "Un jalon est attendu pour le moment « jalon », et seulement dans ce cas.",
    path: ["jalon_id"],
  });

export const satisfactionSyntheseQuerySchema = z
  .object({
    depuis: dateIsoSchema.optional(),
    limite: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
