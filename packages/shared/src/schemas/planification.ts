import { z } from "zod";
import { auMoinsUnChamp, dateIsoSchema, MESSAGE_CORPS_VIDE, texte, texteOptionnel } from "./commun";
import { joursSchema } from "./missions";

/*
 * Planification (PLN-04 à PLN-10) : affectations, congés et absences, plan de
 * charge, « Mon planning », re-planification ; notifications in-app (SOC-08).
 * Aucun schéma de ce fichier ne porte de donnée financière.
 */

const MESSAGE_PERIODE = "La date de fin précède la date de début.";
const periodeCoherente = (v: { date_debut?: string; date_fin?: string }) =>
  !v.date_debut || !v.date_fin || v.date_fin >= v.date_debut;

/** Années servies par la planification : 2000 à 2100 (bornes aussi posées en base, 0021). */
export const PLANIFICATION_DATE_MIN = "2000-01-01";
export const PLANIFICATION_DATE_MAX = "2100-12-31";

/**
 * Date de planification : AAAA-MM-JJ valide, entre 2000 et 2100. Sans borne,
 * une période de l'an 1 à l'an 9999 ferait calculer des millions de jours
 * ouvrés à chaque plan de charge (déni de service).
 */
export const datePlanificationSchema = dateIsoSchema.refine(
  (v) => v >= PLANIFICATION_DATE_MIN && v <= PLANIFICATION_DATE_MAX,
  "Date hors de la plage autorisée (années 2000 à 2100).",
);

/** Écart en jours calendaires entre deux dates AAAA-MM-JJ (fin − début). */
export function ecartJours(debut: string, fin: string): number {
  return Math.round(
    (Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000,
  );
}

/** Une affectation couvre au plus 366 jours calendaires (fin − début ≤ 365). */
export const AFFECTATION_MAX_JOURS = 366;
/** Une absence dure au plus un an (fin − début ≤ 366, règle d'origine conservée). */
export const ABSENCE_MAX_ECART_JOURS = 366;
/** Affectations au plus par tâche (PLN-04). */
export const AFFECTATIONS_MAX_PAR_TACHE = 200;

const MESSAGE_DUREE_AFFECTATION = `Une affectation couvre au plus ${AFFECTATION_MAX_JOURS} jours.`;
const dureeAffectationBornee = (v: { date_debut?: string; date_fin?: string }) =>
  !v.date_debut || !v.date_fin || ecartJours(v.date_debut, v.date_fin) < AFFECTATION_MAX_JOURS;

/** Jours alloués : strictement positifs, au centième (le pas du cabinet est vérifié par l'API). */
const joursAllouesSchema = joursSchema.refine((v) => v > 0, "Jours alloués strictement positifs.");

/** Profil à pourvoir (PLN-04) : un grade, une compétence facultative. */
export const profilAPourvoirSchema = z
  .object({ grade_id: z.string().uuid(), competence: texteOptionnel(80) })
  .strict();

/**
 * Affectation (PLN-04) : nominative (`collaborateur_id`) OU profil à pourvoir
 * (`profil`), jours alloués et période.
 */
export const affectationCreationSchema = z
  .object({
    tache_id: z.string().uuid(),
    collaborateur_id: z.string().uuid().optional(),
    profil: profilAPourvoirSchema.optional(),
    jours_alloues: joursAllouesSchema,
    date_debut: datePlanificationSchema,
    date_fin: datePlanificationSchema,
  })
  .strict()
  .refine(
    (a) => (a.collaborateur_id === undefined) !== (a.profil === undefined),
    "Une affectation est nominative (collaborateur) ou à pourvoir (profil), pas les deux.",
  )
  .refine(periodeCoherente, MESSAGE_PERIODE)
  .refine(dureeAffectationBornee, MESSAGE_DUREE_AFFECTATION);

export const affectationModificationSchema = z
  .object({
    tache_id: z.string().uuid(),
    jours_alloues: joursAllouesSchema,
    date_debut: datePlanificationSchema,
    date_fin: datePlanificationSchema,
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE)
  .refine(periodeCoherente, MESSAGE_PERIODE)
  .refine(dureeAffectationBornee, MESSAGE_DUREE_AFFECTATION);

/** Transformation d'un profil à pourvoir en affectation nominative. */
export const affectationPourvoirSchema = z.object({ collaborateur_id: z.string().uuid() }).strict();

/* ----- Congés et absences (PLN-07) ----- */

export const TYPES_ABSENCE = ["conge_paye", "maladie", "formation", "autre"] as const;
export type TypeAbsence = (typeof TYPES_ABSENCE)[number];

export const STATUTS_ABSENCE = ["demandee", "validee", "refusee", "annulee"] as const;
export type StatutAbsence = (typeof STATUTS_ABSENCE)[number];

export const absenceDemandeSchema = z
  .object({
    type: z.enum(TYPES_ABSENCE),
    date_debut: datePlanificationSchema,
    date_fin: datePlanificationSchema,
    commentaire: texteOptionnel(500),
  })
  .strict()
  .refine(periodeCoherente, MESSAGE_PERIODE)
  .refine(
    (a) => ecartJours(a.date_debut, a.date_fin) <= ABSENCE_MAX_ECART_JOURS,
    "Une absence dure au plus un an.",
  );

export const absenceRefusSchema = z.object({ motif: texte(500) }).strict();

export const absencesListeQuerySchema = z
  .object({
    statut: z.enum(STATUTS_ABSENCE).optional(),
    collaborateur_id: z.string().uuid().optional(),
    /** Absences qui chevauchent [debut ; fin]. */
    debut: datePlanificationSchema.optional(),
    fin: datePlanificationSchema.optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/* ----- Plan de charge (PLN-06) et « Mon planning » (PLN-10) ----- */

/** Plafond du plan de charge : 26 semaines par requête, 100 collaborateurs par page. */
export const PLAN_DE_CHARGE_MAX_SEMAINES = 26;
export const PLAN_DE_CHARGE_MAX_COLLABORATEURS = 100;
/**
 * Écart maximal (fin − début, en jours) d'une requête de plan de charge : 26
 * semaines, plus 6 jours pour un début en milieu de semaine. Vérifié AVANT de
 * construire les semaines (schéma et API).
 */
export const PLAN_DE_CHARGE_MAX_ECART_JOURS = PLAN_DE_CHARGE_MAX_SEMAINES * 7 + 6;

export const planDeChargeQuerySchema = z
  .object({
    debut: datePlanificationSchema.optional(),
    fin: datePlanificationSchema.optional(),
    /** Équipe d'une mission : collaborateurs affectés nominativement à cette mission. */
    equipe: z.string().uuid().optional(),
    grade_id: z.string().uuid().optional(),
    type: z.enum(["interne", "externe", "sous_traitant"]).optional(),
    limite: z.coerce.number().int().min(1).max(PLAN_DE_CHARGE_MAX_COLLABORATEURS).default(50),
    curseur: z.string().max(500).optional(),
  })
  .strict()
  .refine((q) => !q.debut || !q.fin || q.fin >= q.debut, "La date de fin précède la date de début.")
  .refine(
    (q) => !q.debut || !q.fin || ecartJours(q.debut, q.fin) <= PLAN_DE_CHARGE_MAX_ECART_JOURS,
    `Le plan de charge couvre ${PLAN_DE_CHARGE_MAX_SEMAINES} semaines au plus par requête.`,
  );

export const monPlanningQuerySchema = z
  .object({
    /** Une date quelconque de la semaine voulue (par défaut : aujourd'hui). */
    semaine: datePlanificationSchema.optional(),
  })
  .strict();

/* ----- Re-planification (PLN-09) ----- */

export const replanificationSchema = z
  .object({
    phase_id: z.string().uuid(),
    decalage_jours_ouvres: z
      .number()
      .int()
      .min(-260)
      .max(260)
      .refine((v) => v !== 0, "Un décalage nul ne change rien."),
  })
  .strict();

/** Liste paginée des affectations d'une mission (PLN-04). */
export const affectationsListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(AFFECTATIONS_MAX_PAR_TACHE).default(100),
    curseur: z.string().max(500).optional(),
  })
  .strict();

export const replanificationQuerySchema = z
  .object({ apercu: z.enum(["true", "false"]).optional() })
  .strict();

/* ----- Jours fériés par défaut (SOC-04) ----- */

export const feriesParDefautSchema = z
  .object({ annee: z.number().int().min(2000).max(2100) })
  .strict();

/* ----- Notifications in-app (SOC-08) ----- */

export const notificationsQuerySchema = z
  .object({
    non_lues: z.enum(["true", "false"]).optional(),
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/**
 * Lien relatif interne d'une notification : commence par une seule « / »,
 * sans schéma, sans « \ » ni caractère de contrôle (aucune redirection externe).
 */
export function lienInterneSur(lien: string): boolean {
  return /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%#]*$/.test(lien) && lien.length <= 300;
}

export type AffectationCreation = z.infer<typeof affectationCreationSchema>;
export type AffectationModification = z.infer<typeof affectationModificationSchema>;
export type AbsenceDemande = z.infer<typeof absenceDemandeSchema>;
