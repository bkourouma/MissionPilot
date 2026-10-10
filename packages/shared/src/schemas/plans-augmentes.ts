import { z } from "zod";
import {
  codeSchema,
  dateIsoBorneeSchema,
  dateIsoSchema,
  deviseSchema,
  montantSchema,
  paysSchema,
  texte,
  texteOptionnel,
} from "./commun";
import { TAILLES_CLIENT } from "./clients";
import { PERSPECTIVES_PLAN } from "./plans";

/*
 * Plan stratégique augmenté (PRD complémentaire §11.3) : cascade en graphe
 * (PLA-12), bibliothèque d'initiatives types (PLA-13), priorisation du
 * portefeuille (PLA-14) et bancabilité (PLA-17). Les chiffres (taux de
 * couverture, scores, optimisation, ratios bancaires, plan de financement)
 * sortent du moteur (`@missionpilot/engines`, plan-strategique) : ces schémas
 * ne valident que la FORME des saisies.
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);
const uuid = z.string().uuid();
/** Jours-homme ou jours calendaires : entier borné. */
const jours = (max: number) => z.number().int().min(0).max(max);

/* ----- PLA-12 : cascade stratégique ----- */

/** Types de nœud de la cascade portés par le plan lui-même (au-delà des éléments existants). */
export const TYPES_NOEUD_CASCADE_PLAN = ["projet", "jalon"] as const;
export type TypeNoeudCascadePlan = (typeof TYPES_NOEUD_CASCADE_PLAN)[number];

export const STATUTS_PROJET = ["a_lancer", "en_cours", "termine", "suspendu", "abandonne"] as const;
export type StatutProjet = (typeof STATUTS_PROJET)[number];
export const STATUT_PROJET_LIBELLES: Record<StatutProjet, string> = {
  a_lancer: "À lancer",
  en_cours: "En cours",
  termine: "Terminé",
  suspendu: "Suspendu",
  abandonne: "Abandonné",
};

export const STATUTS_JALON = ["prevu", "atteint", "manque"] as const;
export type StatutJalon = (typeof STATUTS_JALON)[number];
export const STATUT_JALON_LIBELLES: Record<StatutJalon, string> = {
  prevu: "Prévu",
  atteint: "Atteint",
  manque: "Manqué",
};

/** Éléments du plan dont le porteur se désigne à part (l'initiative a déjà son responsable). */
export const TYPES_ELEMENT_A_PORTEUR = ["vision_mission", "axe", "objectif"] as const;

/** PUT /plans/:id/elements/:elementId/porteur : porteur interne actif, ou null pour le retirer. */
export const planPorteurSchema = z.object({ porteur_id: uuid.nullable() }).strict();

export const DONNEES_NOEUD_CASCADE = {
  projet: z
    .object({
      titre: texte(200),
      description: texteOptionnel(5_000),
      porteur_id: uuid.nullable().optional(),
      debut: dateIsoBorneeSchema.nullable().optional(),
      echeance: dateIsoBorneeSchema,
      statut: z.enum(STATUTS_PROJET).default("a_lancer"),
    })
    .strict(),
  jalon: z
    .object({
      titre: texte(200),
      description: texteOptionnel(5_000),
      porteur_id: uuid.nullable().optional(),
      echeance: dateIsoBorneeSchema,
      statut: z.enum(STATUTS_JALON).default("prevu"),
    })
    .strict(),
} as const;

/** Création : projet sous une initiative du plan, jalon sous un projet du plan. */
export const planNoeudCascadeCreationSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("projet"), parent_id: uuid, donnees: DONNEES_NOEUD_CASCADE.projet })
    .strict(),
  z
    .object({ type: z.literal("jalon"), parent_id: uuid, donnees: DONNEES_NOEUD_CASCADE.jalon })
    .strict(),
]);
export type PlanNoeudCascadeCreation = z.infer<typeof planNoeudCascadeCreationSchema>;

/** Nouvelle version d'un projet ou d'un jalon (contenu complet, validé selon son type). */
export const DONNEES_NOEUD_CLES_MAX = 30;
export const DONNEES_NOEUD_OCTETS_MAX = 20_000;
export const planNoeudCascadeVersionSchema = z
  .object({
    // Forme libre ici (le type du nœud n'est connu que de la base) : borne amont de la taille,
    // le contenu est ensuite validé par DONNEES_NOEUD_CASCADE selon le type.
    donnees: z
      .record(z.string().max(60), z.unknown())
      .refine((d) => Object.keys(d).length <= DONNEES_NOEUD_CLES_MAX, "Trop de champs.")
      .refine(
        (d) => JSON.stringify(d).length <= DONNEES_NOEUD_OCTETS_MAX,
        "Contenu trop volumineux.",
      ),
    retire: z.boolean().default(false),
  })
  .strict();

export const planNoeudCascadeParamsSchema = z.object({ id: uuid, noeudId: uuid }).strict();

/* ----- PLA-13 : bibliothèque d'initiatives types ----- */

export const NIVEAUX_RISQUE_INITIATIVE = ["faible", "moyen", "eleve"] as const;
export const NIVEAU_RISQUE_INITIATIVE_LIBELLES: Record<
  (typeof NIVEAUX_RISQUE_INITIATIVE)[number],
  string
> = {
  faible: "Faible",
  moyen: "Moyen",
  eleve: "Élevé",
};

/** Durée type maximale d'une initiative (DUREE_INITIATIVE_MAX_JOURS du moteur, doublé en base). */
export const DUREE_INITIATIVE_TYPE_MAX = 3650;

export const initiativeTypeDonneesSchema = z
  .object({
    titre: texte(200),
    description: texteOptionnel(5_000),
    perspective: z.enum(PERSPECTIVES_PLAN).nullable().optional(),
    prerequis: z.array(texte(300)).max(20).default([]),
    risques: z
      .array(z.object({ libelle: texte(300), niveau: z.enum(NIVEAUX_RISQUE_INITIATIVE) }).strict())
      .max(20)
      .default([]),
    cout_min: montantSchema,
    cout_type: montantSchema,
    cout_max: montantSchema,
    devise: deviseSchema.default("XOF"),
    duree_type_jours: z.number().int().min(1).max(DUREE_INITIATIVE_TYPE_MAX),
    /** Charge type en jours-homme (capacité du portefeuille, PLA-14). */
    charge_type_jours: jours(100_000).nullable().optional(),
  })
  .strict()
  .refine((d) => d.cout_min <= d.cout_type && d.cout_type <= d.cout_max, {
    message: "Coûts ordonnés : minimum ≤ type ≤ maximum.",
    path: ["cout_type"],
  });
export type InitiativeTypeDonnees = z.infer<typeof initiativeTypeDonneesSchema>;

/** Création : initiative propre au cabinet (code) ou variante d'une initiative du standard. */
export const initiativeTypeCreationSchema = z.union([
  z.object({ code: codeSchema, donnees: initiativeTypeDonneesSchema }).strict(),
  z.object({ standard_id: uuid, donnees: initiativeTypeDonneesSchema }).strict(),
]);
export type InitiativeTypeCreation = z.infer<typeof initiativeTypeCreationSchema>;

export const initiativeTypeVersionSchema = z
  .object({ donnees: initiativeTypeDonneesSchema, retire: z.boolean().default(false) })
  .strict();

/** Contexte facultatif de lecture de l'efficacité observée (sinon : contexte global). */
const contexteQuery = {
  secteur: texte(80).optional(),
  taille: z.enum(TAILLES_CLIENT).optional(),
  pays: paysSchema.optional(),
};

export const bibliothequeContexteQuerySchema = z.object(contexteQuery).strict();

export const bibliothequeListeQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema, ...contexteQuery })
  .strict();

export const bibliothequeParamsSchema = z.object({ id: uuid }).strict();

/** Observation d'efficacité (0 à 100) d'une initiative type dans un contexte. */
export const initiativeTypeObservationSchema = z
  .object({
    secteur: texteOptionnel(80),
    taille: z.enum(TAILLES_CLIENT).nullable().optional(),
    pays: paysSchema.nullable().optional(),
    efficacite: z.number().int().min(0).max(100),
    /** Initiative d'un plan du cabinet dont l'observation est tirée. */
    plan_initiative_id: uuid.nullable().optional(),
    commentaire: texteOptionnel(1_000),
  })
  .strict();
export type InitiativeTypeObservation = z.infer<typeof initiativeTypeObservationSchema>;

/**
 * Création d'une initiative du plan depuis la bibliothèque : budget (coût type si la devise est
 * celle du plan) et échéance (début + durée type, moteur) proposés, modifiables.
 */
export const planInitiativeDepuisBibliothequeSchema = z
  .object({
    initiative_type_id: uuid,
    parent_id: uuid,
    debut: dateIsoSchema,
    echeance: dateIsoSchema.optional(),
    budget: montantSchema.optional(),
    titre: texte(200).optional(),
    responsable_id: uuid.nullable().optional(),
  })
  .strict();
export type PlanInitiativeDepuisBibliotheque = z.infer<
  typeof planInitiativeDepuisBibliothequeSchema
>;

/* ----- PLA-14 : portefeuille ----- */

const note = z.number().int().min(1).max(5);

/** PUT /plans/:id/portefeuille/initiatives/:elementId : évaluation (nouvelle version). */
export const planEvaluationPortefeuilleSchema = z
  .object({
    valeur: note,
    effort: note,
    risque: note,
    charge_jours: jours(100_000),
    commentaire: texteOptionnel(1_000),
  })
  .strict();
export type PlanEvaluationPortefeuille = z.infer<typeof planEvaluationPortefeuilleSchema>;

const poidsSchema = z
  .object({
    valeur: z.number().int().min(0).max(10),
    effort: z.number().int().min(0).max(10),
    risque: z.number().int().min(0).max(10),
  })
  .strict()
  .refine((p) => p.valeur + p.effort + p.risque > 0, "Au moins un poids non nul.");

export const planContraintesPortefeuilleSchema = z
  .object({
    budget_max: montantSchema.nullable(),
    capacite_max: jours(10_000_000).nullable(),
    poids: poidsSchema.optional(),
    obligatoires: z.array(uuid).max(300).default([]),
    exclues: z.array(uuid).max(300).default([]),
  })
  .strict()
  .refine(
    (c) => {
      const o = new Set(c.obligatoires.map((x) => x.toLowerCase()));
      return !c.exclues.some((x) => o.has(x.toLowerCase()));
    },
    { message: "Une initiative n'est pas à la fois obligatoire et exclue.", path: ["exclues"] },
  );
export type PlanContraintesPortefeuille = z.infer<typeof planContraintesPortefeuilleSchema>;

/**
 * Arbitrage humain : la proposition du moteur est recalculée par l'API avec ces contraintes ;
 * toute initiative dont la décision s'écarte de la proposition exige un motif.
 */
export const planArbitrageSchema = z
  .object({
    contraintes: planContraintesPortefeuilleSchema,
    retenues: z.array(uuid).max(300),
    motifs: z
      .array(z.object({ initiative_id: uuid, motif: texte(1_000) }).strict())
      .max(300)
      .default([]),
    commentaire: texteOptionnel(2_000),
  })
  .strict()
  .refine(
    (a) => new Set(a.retenues.map((x) => x.toLowerCase())).size === a.retenues.length,
    "Initiative retenue en double.",
  );
export type PlanArbitrage = z.infer<typeof planArbitrageSchema>;

export const planArbitragesListeQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

/* ----- PLA-17 : bancabilité ----- */

/** Version VALIDÉE du modèle financier ; défaut : la dernière validée. */
export const planBancabiliteQuerySchema = z
  .object({ version: z.coerce.number().int().min(1).max(100_000).optional() })
  .strict();

export const STATUT_RATIO_LIBELLES = {
  conforme: "Conforme",
  hors_seuil: "Hors seuil",
  sans_objet: "Sans objet",
  non_calculable: "Non calculable",
} as const;

export const VERDICT_BANCABILITE_LIBELLES = {
  favorable: "Favorable",
  a_renforcer: "À renforcer",
  defavorable: "Défavorable",
} as const;
