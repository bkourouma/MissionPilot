import { z } from "zod";
import { auMoinsUnChamp, dateIsoSchema, MESSAGE_CORPS_VIDE, texte, texteOptionnel } from "./commun";

/*
 * Pilotage par KPI (service #4, KPI-01 à KPI-04) : contrat des routes
 * /api/missions/:id/kpi, /api/kpi/** et /api/portail/kpi/**.
 *
 * Les valeurs (mesures, cibles, seuils d'alerte) sont des nombres décimaux
 * d'au plus 15 chiffres SIGNIFICATIFS (dont au plus 15 entiers et 6
 * décimales), transmis tels quels au moteur (packages/engines/src/kpi) et
 * conservés en base (numeric) sous leur écriture décimale la plus courte.
 * Un nombre JSON est un double IEEE 754, exact jusqu'à 15 chiffres
 * significatifs : au-delà, le nombre reçu n'est plus celui saisi
 * (123456789012345.123456 arrive en 123456789012345.12) ; il est REFUSÉ,
 * jamais arrondi en silence.
 */

export const SENS_LECTURE_KPI = ["plus_haut_mieux", "plus_bas_mieux"] as const;
export const NATURES_KPI = ["flux", "stock"] as const;
export const FREQUENCES_KPI = [
  "hebdomadaire",
  "mensuelle",
  "trimestrielle",
  "semestrielle",
  "annuelle",
] as const;
/** Les 4 perspectives du tableau de bord prospectif (KPI-03, PLA-03). */
export const PERSPECTIVES_KPI = ["finances", "clients", "processus", "apprentissage"] as const;

export type SensLectureKpiApi = (typeof SENS_LECTURE_KPI)[number];
export type NatureKpiApi = (typeof NATURES_KPI)[number];
export type FrequenceKpiApi = (typeof FREQUENCES_KPI)[number];
export type PerspectiveKpi = (typeof PERSPECTIVES_KPI)[number];

const uuid = z.string().uuid();

/** Chiffres significatifs au plus d'une valeur : limite d'exactitude d'un double IEEE 754. */
export const CHIFFRES_SIGNIFICATIFS_KPI = 15;

/** Premier jour de suivi admis d'un KPI (contrainte de la migration 0160). */
export const DATE_SUIVI_KPI_MIN = "2000-01-01";

/** La date d'arrêté du tableau de bord et de l'export ne dépasse pas aujourd'hui + 366 jours. */
export const HORIZON_ARRETE_KPI_JOURS = 366;

/** Chiffres de l'écriture décimale `s` (sans signe, virgule ni zéros de tête). */
const chiffresSignificatifs = (s: string) => s.replace(/[-.]/g, "").replace(/^0+/, "").length;

/**
 * Écriture décimale d'au plus `entiers` chiffres entiers, `decimales` décimales et
 * CHIFFRES_SIGNIFICATIFS_KPI chiffres significatifs (sinon le nombre reçu a déjà été arrondi).
 */
function decimalBorne(entiers: number, decimales: number) {
  const motif = new RegExp(`^-?\\d{1,${entiers}}(\\.\\d{1,${decimales}})?$`);
  return z
    .number()
    .finite()
    .refine((v) => {
      const s = String(v);
      return motif.test(s) && chiffresSignificatifs(s) <= CHIFFRES_SIGNIFICATIFS_KPI;
    }, `Nombre d'au plus ${CHIFFRES_SIGNIFICATIFS_KPI} chiffres significatifs, ${entiers} chiffres entiers et ${decimales} décimales attendu.`);
}

/** Date d'arrêté la plus lointaine admise (UTC), recalculée à chaque validation. */
function dateArreteMax(): string {
  return new Date(Date.now() + HORIZON_ARRETE_KPI_JOURS * 86_400_000).toISOString().slice(0, 10);
}

/** Valeur d'un KPI (mesure, cible, seuil d'alerte). */
export const valeurKpiSchema = decimalBorne(15, 6);

/** Fraction de la cible (0,95 = 95 %), quatre décimales. */
const fractionSchema = decimalBorne(1, 4).refine((v) => v >= 0 && v <= 1, "Entre 0 et 1.");

const ponderationSchema = decimalBorne(4, 4).refine((v) => v >= 0, "Pondération positive.");

/** Variation relative maximale admise (0,2 = 20 %), de 0 à 100. */
const variationSchema = decimalBorne(3, 4).refine((v) => v >= 0 && v <= 100, "Entre 0 et 100.");

const seuilsCoherents = (v: { seuil_vert?: number | null; seuil_orange?: number | null }) =>
  (v.seuil_vert === undefined) === (v.seuil_orange === undefined) &&
  (v.seuil_vert == null) === (v.seuil_orange == null) &&
  (v.seuil_vert == null || (v.seuil_orange as number) < v.seuil_vert);

const MESSAGE_SEUILS = "Seuils vert et orange fournis ensemble, avec orange < vert.";

const alertesCoherentes = (v: { alerte_haut?: number | null; alerte_bas?: number | null }) =>
  v.alerte_haut == null || v.alerte_bas == null || v.alerte_bas <= v.alerte_haut;

const MESSAGE_ALERTES = "Le seuil d'alerte bas dépasse le seuil haut.";

const champsModifiables = {
  libelle: texte(200),
  description: texteOptionnel(2000),
  unite: texte(40),
  perspective: z.enum(PERSPECTIVES_KPI).nullable(),
  ponderation: ponderationSchema,
  seuil_vert: fractionSchema.nullable(),
  seuil_orange: fractionSchema.nullable(),
  alerte_haut: valeurKpiSchema.nullable(),
  alerte_bas: valeurKpiSchema.nullable(),
  alerte_variation: variationSchema.nullable(),
  proprietaire_id: uuid.nullable(),
  fin_suivi: dateIsoSchema.nullable(),
  rappels_actifs: z.boolean(),
};

/** Création d'un KPI (KPI-01) avec sa cible initiale facultative. */
export const kpiCreationSchema = z
  .object({
    ...champsModifiables,
    perspective: champsModifiables.perspective.optional(),
    ponderation: ponderationSchema.default(1),
    seuil_vert: champsModifiables.seuil_vert.optional(),
    seuil_orange: champsModifiables.seuil_orange.optional(),
    alerte_haut: champsModifiables.alerte_haut.optional(),
    alerte_bas: champsModifiables.alerte_bas.optional(),
    alerte_variation: champsModifiables.alerte_variation.optional(),
    proprietaire_id: champsModifiables.proprietaire_id.optional(),
    fin_suivi: champsModifiables.fin_suivi.optional(),
    rappels_actifs: z.boolean().default(true),
    sens: z.enum(SENS_LECTURE_KPI),
    nature: z.enum(NATURES_KPI),
    frequence: z.enum(FREQUENCES_KPI),
    debut_suivi: dateIsoSchema,
    cible: valeurKpiSchema.nullable().optional(),
  })
  .strict()
  .refine(seuilsCoherents, MESSAGE_SEUILS)
  .refine(alertesCoherentes, MESSAGE_ALERTES)
  .refine((v) => v.fin_suivi == null || v.fin_suivi >= v.debut_suivi, "Fin de suivi avant début.");

/** Modification d'un KPI : sens, nature, fréquence et début de suivi sont figés. */
export const kpiModificationSchema = z
  .object({
    libelle: champsModifiables.libelle.optional(),
    description: champsModifiables.description,
    unite: champsModifiables.unite.optional(),
    perspective: champsModifiables.perspective.optional(),
    ponderation: champsModifiables.ponderation.optional(),
    seuil_vert: champsModifiables.seuil_vert.optional(),
    seuil_orange: champsModifiables.seuil_orange.optional(),
    alerte_haut: champsModifiables.alerte_haut.optional(),
    alerte_bas: champsModifiables.alerte_bas.optional(),
    alerte_variation: champsModifiables.alerte_variation.optional(),
    proprietaire_id: champsModifiables.proprietaire_id.optional(),
    fin_suivi: champsModifiables.fin_suivi.optional(),
    rappels_actifs: champsModifiables.rappels_actifs.optional(),
    actif: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE)
  .refine(seuilsCoherents, MESSAGE_SEUILS)
  .refine(alertesCoherentes, MESSAGE_ALERTES);

/**
 * Nouvelle version de cible (historique versionné, ajout seul). `a_partir_de`
 * est ramené au premier jour de sa période ; `valeur: null` = sans cible.
 */
export const kpiCibleSchema = z
  .object({
    valeur: valeurKpiSchema.nullable(),
    a_partir_de: dateIsoSchema,
    motif: texteOptionnel(500),
  })
  .strict();

/** Remplacement complet des contributeurs du portail d'un KPI. */
export const kpiContributeursSchema = z
  .object({
    utilisateurs: z
      .array(uuid)
      .max(50)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

/** Saisie d'une mesure datée (KPI-02), par le cabinet ou un contributeur du portail. */
export const kpiMesureSchema = z
  .object({
    date_mesure: dateIsoSchema,
    valeur: valeurKpiSchema,
    commentaire: texteOptionnel(1000),
    justificatif: texteOptionnel(500),
  })
  .strict();

/** Correction : nouvelle mesure qui remplace la précédente, motif obligatoire. */
export const kpiCorrectionSchema = z
  .object({
    date_mesure: dateIsoSchema,
    valeur: valeurKpiSchema,
    motif: texte(500),
    commentaire: texteOptionnel(1000),
    justificatif: texteOptionnel(500),
  })
  .strict();

/** Annulation d'une mesure saisie par erreur (ligne d'annulation, motif obligatoire). */
export const kpiAnnulationSchema = z.object({ motif: texte(500) }).strict();

/**
 * Date d'arrêté du tableau de bord et de l'export (défaut : aujourd'hui), bornée : du
 * premier jour de suivi admis à aujourd'hui + HORIZON_ARRETE_KPI_JOURS (le nombre de
 * périodes évaluées en dépend).
 */
export const kpiTableauQuerySchema = z
  .object({
    date: dateIsoSchema
      .refine(
        (d) => d >= DATE_SUIVI_KPI_MIN && d <= dateArreteMax(),
        `Date d'arrêté entre le ${DATE_SUIVI_KPI_MIN} et aujourd'hui + ${HORIZON_ARRETE_KPI_JOURS} jours.`,
      )
      .optional(),
  })
  .strict();

export const kpiMesuresQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(50),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/** Réglages du cabinet (valeurs de départ : rappels actifs, 5 jours de grâce, 3 périodes). */
export const kpiParametresSchema = z
  .object({
    rappels_actifs: z.boolean().optional(),
    delai_grace_jours: z.number().int().min(0).max(60).optional(),
    periodes_degradation: z.number().int().min(1).max(24).optional(),
    valeurs_validees: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export type KpiCreation = z.infer<typeof kpiCreationSchema>;
export type KpiModification = z.infer<typeof kpiModificationSchema>;
export type KpiCible = z.infer<typeof kpiCibleSchema>;
export type KpiMesure = z.infer<typeof kpiMesureSchema>;
export type KpiCorrection = z.infer<typeof kpiCorrectionSchema>;
export type KpiParametres = z.infer<typeof kpiParametresSchema>;
