import { z } from "zod";
import { dateIsoSchema, deviseSchema, montantSchema, texte, texteOptionnel } from "./commun";

/*
 * Planification stratégique et modèle financier (service #3, PLA-01 à PLA-09).
 *
 * L'IA propose, l'expert dispose : chaque contenu porte un statut
 * (brouillon, brouillon_ia, modifie, valide) et son historique ; seul un
 * contenu « valide » peut être exposé au client. Les chiffres du modèle
 * financier sortent du moteur (`@missionpilot/engines`, plan-strategique) :
 * ces schémas ne valident que la FORME des hypothèses, le moteur valide leurs
 * bornes et refuse toute valeur hors limites (jamais corrigée en silence).
 *
 * Conventions du moteur : montants en entiers d'unités mineures, taux en
 * points (25 pour 25 %), délais en jours d'une année de 360 jours ; une
 * hypothèse annuelle est une valeur unique ou exactement « horizon » valeurs.
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

/** Horizon du plan (DECISIONS.md, PLA-06) : 5 ans par défaut, de 3 à 5 ans, fixé à la création. */
export const HORIZON_PLAN = { defaut: 5, min: 3, max: 5 } as const;

export const STATUTS_CONTENU_PLAN = ["brouillon", "brouillon_ia", "modifie", "valide"] as const;
export type StatutContenuPlan = (typeof STATUTS_CONTENU_PLAN)[number];

export const TYPES_ELEMENT_PLAN = [
  "diagnostic",
  "swot",
  "vision_mission",
  "axe",
  "objectif",
  "initiative",
] as const;
export type TypeElementPlan = (typeof TYPES_ELEMENT_PLAN)[number];

export const TYPE_ELEMENT_PLAN_LIBELLES: Record<TypeElementPlan, string> = {
  diagnostic: "Diagnostic",
  swot: "Analyse SWOT",
  vision_mission: "Vision et mission",
  axe: "Axe stratégique",
  objectif: "Objectif",
  initiative: "Initiative",
};

/** Prédécesseurs d'une initiative (DEPENDANCES_PAR_INITIATIVE_MAX du moteur, doublé en base). */
export const DEPENDANCES_INITIATIVE_MAX = 20;

/** Perspectives du tableau de bord prospectif (PLA-03). */
export const PERSPECTIVES_PLAN = ["finances", "clients", "processus", "apprentissage"] as const;
export type PerspectivePlan = (typeof PERSPECTIVES_PLAN)[number];

export const STATUTS_INITIATIVE = [
  "a_lancer",
  "en_cours",
  "terminee",
  "suspendue",
  "abandonnee",
] as const;
export type StatutInitiative = (typeof STATUTS_INITIATIVE)[number];

export const STATUT_INITIATIVE_LIBELLES: Record<StatutInitiative, string> = {
  a_lancer: "À lancer",
  en_cours: "En cours",
  terminee: "Terminée",
  suspendue: "Suspendue",
  abandonnee: "Abandonnée",
};

/* ----- Plan ----- */

export const planCreationSchema = z
  .object({
    titre: texte(200),
    horizon: z.number().int().min(HORIZON_PLAN.min).max(HORIZON_PLAN.max).default(5),
    devise: deviseSchema.default("XOF"),
  })
  .strict();
export type PlanCreation = z.infer<typeof planCreationSchema>;

export const planListeQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

export const planPartageSchema = z.object({ partage_client: z.boolean() }).strict();

/* ----- Éléments du plan (contenus versionnés) ----- */

const listeConstats = z.array(texte(500)).max(30);

/** Données d'une version, par type d'élément (une version reprend l'ensemble du contenu). */
export const DONNEES_ELEMENT_PLAN = {
  diagnostic: z.object({ synthese: texte(20_000) }).strict(),
  swot: z
    .object({
      forces: listeConstats,
      faiblesses: listeConstats,
      opportunites: listeConstats,
      menaces: listeConstats,
    })
    .strict(),
  vision_mission: z
    .object({
      vision: texte(2_000),
      mission: texte(2_000),
      valeurs: z.array(texte(200)).max(20).optional(),
    })
    .strict(),
  axe: z.object({ titre: texte(200), description: texteOptionnel(5_000) }).strict(),
  objectif: z
    .object({
      titre: texte(200),
      description: texteOptionnel(5_000),
      perspective: z.enum(PERSPECTIVES_PLAN),
      indicateur: texteOptionnel(200),
      cible: texteOptionnel(200),
      echeance: dateIsoSchema.nullable().optional(),
    })
    .strict(),
  initiative: z
    .object({
      titre: texte(200),
      description: texteOptionnel(5_000),
      responsable_id: z.string().uuid().nullable().optional(),
      debut: dateIsoSchema.nullable().optional(),
      echeance: dateIsoSchema,
      /** Budget de l'initiative (investissement initial du calcul de ROI), unités mineures. */
      budget: montantSchema,
      statut: z.enum(STATUTS_INITIATIVE).default("a_lancer"),
      /**
       * Gains nets annuels attendus (années 1 à l'horizon), saisis par le
       * consultant : base du ROI (VAN et TRI calculés par le moteur).
       */
      gains_annuels: z
        .array(z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER))
        .max(HORIZON_PLAN.max)
        .optional(),
      /**
       * Initiatives du même plan qui doivent se terminer avant celle-ci (PLA-05, dépendance
       * « fin → début ») ; le moteur refuse doublons et cycles, la base les identifiants
       * étrangers au plan (0184).
       */
      dependances: z.array(z.string().uuid()).max(DEPENDANCES_INITIATIVE_MAX).optional(),
    })
    .strict(),
} as const;

export type DonneesElementPlan = {
  [T in TypeElementPlan]: z.infer<(typeof DONNEES_ELEMENT_PLAN)[T]>;
};

const D = DONNEES_ELEMENT_PLAN;
const parentId = z.string().uuid();

/** Création : objectif sous un axe ; initiative sous un axe ou un objectif ; autres sans parent. */
export const planElementCreationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("diagnostic"), donnees: D.diagnostic }).strict(),
  z.object({ type: z.literal("swot"), donnees: D.swot }).strict(),
  z.object({ type: z.literal("vision_mission"), donnees: D.vision_mission }).strict(),
  z.object({ type: z.literal("axe"), donnees: D.axe }).strict(),
  z.object({ type: z.literal("objectif"), parent_id: parentId, donnees: D.objectif }).strict(),
  z.object({ type: z.literal("initiative"), parent_id: parentId, donnees: D.initiative }).strict(),
]);
export type PlanElementCreation = z.infer<typeof planElementCreationSchema>;

/** Nouvelle version d'un élément : contenu complet du type de l'élément (validé par l'API). */
export const planElementVersionSchema = z
  .object({ donnees: z.record(z.unknown()), retire: z.boolean().default(false) })
  .strict();

export const planElementParamsSchema = z
  .object({ id: z.string().uuid(), elementId: z.string().uuid() })
  .strict();

export const planHistoriqueQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

export const feuilleDeRouteQuerySchema = z
  .object({ pas: z.enum(["trimestre", "semestre"]).default("trimestre") })
  .strict();

/**
 * Application du recalage de la feuille de route (PLA-05) : initiatives dont l'utilisateur a
 * vu le décalage proposé. Chacune doit être encore à recaler (sinon 409) ; chacune reçoit une
 * nouvelle version datée par le moteur, à valider de nouveau.
 */
export const planRecalageSchema = z
  .object({ initiatives: z.array(z.string().uuid()).min(1).max(300) })
  .strict()
  // Un UUID s'écrit en majuscules ou en minuscules : le doublon se cherche sur la forme minuscule.
  .refine(
    (c) => new Set(c.initiatives.map((id) => id.toLowerCase())).size === c.initiatives.length,
    "Initiative en double.",
  );
export type PlanRecalage = z.infer<typeof planRecalageSchema>;

/* ----- Diagnostic : lien vers une notation publiée (service #1) ----- */

/** Version publiée d'une notation du même client, ou null pour retirer le lien. */
export const planNotationLienSchema = z
  .object({ notation_version_id: z.string().uuid().nullable() })
  .strict();
export type PlanNotationLien = z.infer<typeof planNotationLienSchema>;

/* ----- Modèle financier (forme des hypothèses du moteur) ----- */

const nombre = z.number().finite();
const entier = z.number().int();
const parAnnee = z.union([nombre, z.array(nombre).min(1).max(HORIZON_PLAN.max)]);
const libelle = texte(120);

const categorieEffectifSchema = z
  .object({
    libelle,
    effectifs: parAnnee,
    salaireAnnuelBrut: entier,
    tauxChargesSociales: nombre,
    revalorisationAnnuelle: nombre.optional(),
  })
  .strict();

const investissementSchema = z
  .object({ libelle, annee: entier, montant: entier, dureeAmortissement: entier })
  .strict();

const empruntSchema = z
  .object({
    libelle,
    anneeDeblocage: entier,
    montant: entier,
    tauxAnnuel: nombre,
    duree: entier,
    differe: entier.optional(),
    mode: z.enum(["annuites_constantes", "amortissement_constant"]).optional(),
  })
  .strict();

const bilanOuvertureSchema = z
  .object({
    immobilisationsNettes: entier.optional(),
    dureeResiduelleImmobilisations: entier.optional(),
    stocks: entier.optional(),
    creancesClients: entier.optional(),
    tresorerie: entier.optional(),
    capital: entier.optional(),
    reserves: entier.optional(),
    dettesFournisseurs: entier.optional(),
    deficitsReportables: entier.optional(),
  })
  .strict();

/**
 * Hypothèses saisies (HypothesesPlan du moteur) SANS horizon ni devise :
 * l'API y ajoute ceux du plan, fixés à sa création.
 */
export const hypothesesPlanSchema = z
  .object({
    premierExercice: entier,
    chiffreAffairesReference: entier,
    croissanceChiffreAffaires: parAnnee,
    tauxMargeBrute: parAnnee,
    tauxChargesVariables: parAnnee.optional(),
    chargesFixes: parAnnee.optional(),
    effectifs: z.array(categorieEffectifSchema).max(50).optional(),
    investissements: z.array(investissementSchema).max(100).optional(),
    emprunts: z.array(empruntSchema).max(30).optional(),
    augmentationsCapital: z
      .array(z.object({ annee: entier, montant: entier }).strict())
      .max(20)
      .optional(),
    delaiClientsJours: parAnnee.optional(),
    delaiFournisseursJours: parAnnee.optional(),
    stocksJours: parAnnee.optional(),
    tauxImpotSocietes: nombre.optional(),
    tauxDistributionDividendes: nombre.optional(),
    tauxActualisation: nombre.optional(),
    bilanOuverture: bilanOuvertureSchema.optional(),
  })
  .strict();
export type HypothesesPlanSaisies = z.infer<typeof hypothesesPlanSchema>;

const ecartsScenarioSchema = z
  .object({
    croissanceChiffreAffaires: nombre.optional(),
    tauxMargeBrute: nombre.optional(),
    tauxChargesVariables: nombre.optional(),
    chargesFixes: nombre.optional(),
    delaiClientsJours: nombre.optional(),
  })
  .strict();

/** Écarts des scénarios optimiste et pessimiste (défaut du moteur s'ils sont absents). */
export const ecartsScenariosSchema = z
  .object({ optimiste: ecartsScenarioSchema, pessimiste: ecartsScenarioSchema })
  .strict();

export const planModeleCreationSchema = z
  .object({
    hypotheses: hypothesesPlanSchema,
    ecarts: ecartsScenariosSchema.optional(),
    commentaire: texteOptionnel(1_000),
  })
  .strict();
export type PlanModeleCreation = z.infer<typeof planModeleCreationSchema>;

export const planModeleSimulationSchema = z
  .object({ hypotheses: hypothesesPlanSchema, ecarts: ecartsScenariosSchema.optional() })
  .strict();

export const planModeleParamsSchema = z
  .object({ id: z.string().uuid(), version: z.coerce.number().int().min(1).max(100_000) })
  .strict();

export const planModeleListeQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

export const planComparaisonQuerySchema = z
  .object({
    de: z.coerce.number().int().min(1).max(100_000),
    a: z.coerce.number().int().min(1).max(100_000),
  })
  .strict()
  .refine((q) => q.de !== q.a, "Deux versions différentes sont attendues.");

/** Version du modèle utilisée (ROI, données de rapport) ; défaut : dernière validée, sinon dernière. */
export const planVersionQuerySchema = z
  .object({ version: z.coerce.number().int().min(1).max(100_000).optional() })
  .strict();
