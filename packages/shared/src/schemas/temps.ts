import { z } from "zod";
import {
  auMoinsUnChamp,
  codeSchema,
  dateIsoSchema,
  MESSAGE_CORPS_VIDE,
  texte,
  texteOptionnel,
} from "./commun";
import { joursSchema } from "./missions";

/*
 * Temps (TPS-01 à TPS-10) : feuilles de temps hebdomadaires, activités
 * internes, reste à faire, suivi budgétaire, clôture mensuelle, corrections
 * tracées, import de l'historique et discipline de saisie. Aucun schéma de ce
 * fichier ne porte de donnée financière : tout est en jours-homme ou en heures.
 */

/* ----- Paramètres (SOC-04, TPS-01, TPS-07) ----- */

/** Dépassement de la capacité d'un jour : signalé (avertissement) ou refusé. */
export const CONTROLES_CAPACITE = ["signaler", "refuser"] as const;
export type ControleCapacite = (typeof CONTROLES_CAPACITE)[number];

/** Seuil d'alerte de consommation par défaut (TPS-07) : 80 % du budget. */
export const SEUIL_CONSOMMATION_DEFAUT_PCT = 80;

export const tempsParametresSchema = z
  .object({
    controle_capacite: z.enum(CONTROLES_CAPACITE),
    seuil_consommation_pct: z.number().int().min(1).max(100),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/* ----- Activités internes non facturables (TPS-02) ----- */

export const activiteInterneCreationSchema = z
  .object({
    code: codeSchema,
    libelle: texte(120),
    /** Absence (congés…) : exclue du contrôle de capacité journalière. */
    est_absence: z.boolean().optional(),
  })
  .strict();

export const activiteInterneModificationSchema = z
  .object({ libelle: texte(120), actif: z.boolean() })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/* ----- Feuilles de temps (TPS-01, TPS-03) ----- */

export const STATUTS_FEUILLE = [
  "brouillon",
  "soumise",
  "validee",
  "rejetee",
  "verrouillee",
] as const;
export type StatutFeuille = (typeof STATUTS_FEUILLE)[number];

/** Une ligne au plus 3 jours, ou 24 heures ; 300 lignes au plus par feuille. */
export const FEUILLE_MAX_LIGNES = 300;

export const semaineQuerySchema = z
  .object({
    /** Une date quelconque de la semaine voulue (par défaut : aujourd'hui). */
    semaine: dateIsoSchema.optional(),
  })
  .strict();

export const feuilleCreationSchema = z
  .object({
    /** Une date quelconque de la semaine (ramenée au lundi). */
    semaine: dateIsoSchema,
    /** Pré-remplir depuis les affectations de la semaine (défaut : oui). */
    pre_remplir: z.boolean().default(true),
  })
  .strict();

const joursLigneSchema = joursSchema.refine(
  (v) => v > 0 && v <= 3,
  "Entre 0 et 3 jours par ligne.",
);
const heuresLigneSchema = z
  .number()
  .gt(0, "Heures strictement positives.")
  .max(24, "24 heures au plus par ligne.");

/**
 * Ligne saisie : une tâche affectée OU une activité interne, un jour, en jours
 * (cabinet à la demi-journée) OU en heures (cabinet à l'heure).
 */
export const ligneTempsSaisieSchema = z
  .object({
    date: dateIsoSchema,
    tache_id: z.string().uuid().optional(),
    activite_id: z.string().uuid().optional(),
    jours: joursLigneSchema.optional(),
    heures: heuresLigneSchema.optional(),
    commentaire: texteOptionnel(500),
  })
  .strict()
  .refine(
    (l) => (l.tache_id === undefined) !== (l.activite_id === undefined),
    "Une ligne porte sur une tâche ou sur une activité interne, pas les deux.",
  )
  .refine(
    (l) => (l.jours === undefined) !== (l.heures === undefined),
    "Une ligne se saisit en jours ou en heures, pas les deux.",
  );

export const feuilleLignesSchema = z
  .object({ lignes: z.array(ligneTempsSaisieSchema).max(FEUILLE_MAX_LIGNES) })
  .strict();

/** Partie d'une feuille à décider : une mission, ou les activités internes. */
const partieSchema = {
  mission_id: z.string().uuid().optional(),
  interne: z.literal(true).optional(),
};
const unePartieAuPlus = (p: { mission_id?: string; interne?: true }) =>
  !(p.mission_id !== undefined && p.interne !== undefined);
const MESSAGE_PARTIE = "Indiquer une mission ou les activités internes, pas les deux.";

export const feuilleValidationSchema = z
  .object(partieSchema)
  .strict()
  .refine(unePartieAuPlus, MESSAGE_PARTIE);

export const feuilleRejetSchema = z
  .object({ ...partieSchema, motif: texte(500) })
  .strict()
  .refine(unePartieAuPlus, MESSAGE_PARTIE);

export const VUES_FEUILLES = ["miennes", "a_valider", "toutes"] as const;

export const feuillesListeQuerySchema = z
  .object({
    vue: z.enum(VUES_FEUILLES).default("miennes"),
    statut: z.enum(STATUTS_FEUILLE).optional(),
    collaborateur_id: z.string().uuid().optional(),
    /** Une date de la semaine voulue. */
    semaine: dateIsoSchema.optional(),
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/* ----- Reste à faire (TPS-05) ----- */

export const resteAFaireDeclarationSchema = z
  .object({
    /** Semaine de la déclaration (par défaut : la semaine courante). */
    semaine: dateIsoSchema.optional(),
    lignes: z
      .array(
        z
          .object({
            tache_id: z.string().uuid(),
            /** Par défaut : le collaborateur de l'utilisateur connecté. */
            collaborateur_id: z.string().uuid().optional(),
            jours: joursSchema,
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const resteAFaireQuerySchema = z
  .object({
    tache_id: z.string().uuid().optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/* ----- Clôture mensuelle et corrections (TPS-09) ----- */

/** Mois civil AAAA-MM. */
export const moisSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois au format AAAA-MM.");

export const paramsMoisSchema = z.object({ mois: moisSchema }).strict();

export const periodesQuerySchema = z
  .object({ annee: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict();

export const reouvertureSchema = z.object({ motif: texte(500) }).strict();

export const STATUTS_CORRECTION = ["demandee", "validee", "rejetee"] as const;

export const correctionDemandeSchema = z
  .object({
    collaborateur_id: z.string().uuid(),
    date: dateIsoSchema,
    tache_id: z.string().uuid().optional(),
    activite_id: z.string().uuid().optional(),
    /** Nouvelle valeur (0 : retirer le temps) en jours, ou en heures. */
    jours: joursSchema.refine((v) => v <= 3, "3 jours au plus.").optional(),
    heures: z.number().min(0).max(24).optional(),
    motif: texte(500),
  })
  .strict()
  .refine(
    (l) => (l.tache_id === undefined) !== (l.activite_id === undefined),
    "Une correction porte sur une tâche ou sur une activité interne, pas les deux.",
  )
  .refine(
    (l) => (l.jours === undefined) !== (l.heures === undefined),
    "La nouvelle valeur se saisit en jours ou en heures, pas les deux.",
  );

export const correctionRejetSchema = z.object({ motif: texte(500) }).strict();

export const correctionsQuerySchema = z
  .object({
    statut: z.enum(STATUTS_CORRECTION).optional(),
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/* ----- Import de l'historique (TPS-10) ----- */

/** Bornes de l'import : 5 000 lignes et 500 000 caractères au plus. */
export const IMPORT_TEMPS_MAX_LIGNES = 5000;
export const IMPORT_TEMPS_MAX_CARACTERES = 500_000;

/** Colonnes attendues (en-tête, sans accent ni casse imposés). */
export const IMPORT_TEMPS_COLONNES = [
  "collaborateur",
  "mission",
  "tache",
  "date",
  "jours",
] as const;

export const importTempsQuerySchema = z
  .object({
    /** Simulation par défaut : l'exécution exige `simulation=false` explicitement. */
    simulation: z.enum(["true", "false"]).default("true"),
  })
  .strict();

export const importTempsSchema = z
  .object({ csv: z.string().min(1).max(IMPORT_TEMPS_MAX_CARACTERES) })
  .strict();

/* ----- Discipline de saisie (TPS-04) ----- */

export const DISCIPLINE_MAX_SEMAINES = 26;

export const disciplineQuerySchema = z
  .object({
    debut: dateIsoSchema.optional(),
    fin: dateIsoSchema.optional(),
    /** Date d'évaluation (par défaut : aujourd'hui). */
    date_reference: dateIsoSchema.optional(),
    /** Collaborateurs affectés à cette mission. */
    equipe: z.string().uuid().optional(),
    limite: z.coerce.number().int().min(1).max(100).default(50),
    curseur: z.string().max(500).optional(),
  })
  .strict()
  .refine(
    (q) => !q.debut || !q.fin || q.fin >= q.debut,
    "La date de fin précède la date de début.",
  );

export type LigneTempsSaisie = z.infer<typeof ligneTempsSaisieSchema>;
export type CorrectionDemande = z.infer<typeof correctionDemandeSchema>;
