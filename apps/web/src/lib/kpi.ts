/**
 * Pilotage par KPI d'une mission (service 4, KPI-01 à KPI-04) côté cabinet : contrats des
 * réponses de l'API, libellés, chemins, droits d'affichage, messages d'erreur et mise en
 * forme. Logique pure, testée dans `kpi.test.ts`.
 *
 * Tous les chiffres (statut, atteinte, écart, tendance, projection, score composite,
 * alertes) sont ceux du moteur de l'API (`packages/engines/src/kpi`) : ce module les met en
 * forme et ne les recalcule jamais. Rien n'est conservé dans le navigateur.
 */
import {
  aPermission,
  DATE_SUIVI_KPI_MIN,
  HORIZON_ARRETE_KPI_JOURS,
  PERSPECTIVES_KPI,
  ROLE_LIBELLES,
  type FrequenceKpiApi,
  type NatureKpiApi,
  type PerspectiveKpi,
  type Role,
  type SensLectureKpiApi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { api, ErreurApi, messageErreur } from "./api";
import { formaterDate, formaterNombre, formaterPourcentage, VALEUR_ABSENTE } from "./format";
import type { MissionDetaillee } from "./missions";
import { dateValide } from "./periode";

// --- Réponses de l'API ----------------------------------------------------------------------

export type StatutKpi = "vert" | "orange" | "rouge" | "non_mesure" | "sans_cible";
export type DirectionKpi = "hausse" | "baisse" | "stable" | "indeterminee";
export type EvolutionKpi = "amelioration" | "degradation" | "stable" | "indeterminee";
export type MethodeProjectionKpi = "prorata" | "regression" | "reconduction" | "aucune";
export type CodeAlerteKpi =
  "DEGRADATION_CONSECUTIVE" | "MESURE_EN_RETARD" | "SEUIL_HAUT" | "SEUIL_BAS" | "VARIATION";

export interface AtteinteKpiVue {
  /** Taux borné, 4 décimales (0,95 = 95 %). */
  taux: number;
  taux_exact: string;
  taux_brut_exact: string;
  /** « binaire » : cible nulle, atteinte tout ou rien. */
  mode: "relatif" | "binaire";
  borne: "plafond" | "plancher" | null;
}

export interface EcartKpiVue {
  ecart: number;
  ecart_exact: string;
  ecart_relatif: number | null;
  /** Positif = mieux que la cible dans le sens de lecture du KPI. */
  ecart_oriente: number;
  cible_atteinte: boolean;
}

/** Période évaluée (`vuePeriode` de l'API). */
export interface PeriodeKpiVue {
  periode: string;
  debut: string;
  fin: string;
  close: boolean;
  valeur: number | null;
  nombre_mesures: number;
  cible: number | null;
  statut: StatutKpi;
  atteinte: AtteinteKpiVue | null;
  ecart: EcartKpiVue | null;
}

export interface TendanceKpiVue {
  direction: DirectionKpi;
  evolution: EvolutionKpi;
  pente: number | null;
  variation: number | null;
  variation_relative: number | null;
  points: number;
}

export interface ProjectionKpiVue {
  valeur_projetee: number | null;
  valeur_exacte: string | null;
  methode: MethodeProjectionKpi;
  jours_ecoules: number;
  jours_total: number;
}

/** Alerte du moteur (`vueAlerte`), datée par sa période. */
export type AlerteKpiVue =
  | { code: "DEGRADATION_CONSECUTIVE"; periode: string; periodes: number; seuil: number }
  | {
      code: "MESURE_EN_RETARD";
      periode: string;
      periode_attendue: string;
      echeance: string;
      jours_de_retard: number;
      periodes_manquantes: number;
      derniere_periode_due: string;
    }
  | { code: "SEUIL_HAUT" | "SEUIL_BAS"; periode: string; valeur: number; seuil: number }
  | {
      code: "VARIATION";
      periode: string;
      valeur: number;
      precedente: number;
      variation_relative: number | null;
      seuil: number;
    };

export interface ScoreKpiVue {
  score: number | null;
  score_exact: string | null;
  statut: StatutKpi;
  /** Part du poids total effectivement mesurée (0..1). */
  couverture: number;
  contributions: {
    kpi_id: string;
    poids_normalise: number;
    taux: number;
    contribution: number;
    statut: StatutKpi;
  }[];
  exclus: { kpi_id: string; raison: "non_mesure" | "sans_cible" }[];
}

/** Définition d'un KPI (`vueDefinition`). */
export interface DefinitionKpi {
  id: string;
  mission_id: string;
  client_id: string;
  libelle: string;
  description: string | null;
  unite: string;
  perspective: PerspectiveKpi | null;
  sens: SensLectureKpiApi;
  nature: NatureKpiApi;
  frequence: FrequenceKpiApi;
  ponderation: number;
  seuil_vert: number | null;
  seuil_orange: number | null;
  alerte_haut: number | null;
  alerte_bas: number | null;
  alerte_variation: number | null;
  proprietaire_id: string | null;
  debut_suivi: string;
  fin_suivi: string | null;
  rappels_actifs: boolean;
  actif: boolean;
  cible_actuelle: number | null;
  cree_le: string;
  modifie_le: string;
}

export interface PeriodeEnCoursKpi extends PeriodeKpiVue {
  projection: ProjectionKpiVue;
  statut_projete: StatutKpi;
}

/** KPI du tableau de bord : définition et évaluation à la date d'arrêté. */
export interface KpiTableau extends DefinitionKpi {
  date_reference: string;
  statut: StatutKpi;
  derniere_periode: PeriodeKpiVue | null;
  tendance: TendanceKpiVue;
  periode_en_cours: PeriodeEnCoursKpi | null;
  alertes: AlerteKpiVue[];
}

export interface PerspectiveTableau {
  perspective: PerspectiveKpi | null;
  nombre_kpi: number;
  score: ScoreKpiVue | null;
}

/** Réponse de `GET /api/missions/:id/kpi/tableau-de-bord`. */
export interface TableauDeBordKpi {
  mission_id: string;
  date_reference: string;
  score_global: ScoreKpiVue | null;
  perspectives: PerspectiveTableau[];
  kpis: KpiTableau[];
  alertes: (AlerteKpiVue & { kpi_id: string; libelle: string })[];
}

export interface CibleKpiVue {
  version: number;
  valeur: number | null;
  a_partir_de: string;
  motif: string | null;
  cree_par: string;
  cree_le: string;
}

export interface ContributeurKpi {
  id: string;
  nom: string;
  email: string;
}

/** Réponse de `GET /api/kpi/:id` (et des écritures de gestion). */
export interface DetailKpi extends DefinitionKpi {
  cibles: CibleKpiVue[];
  contributeurs: ContributeurKpi[];
}

/** Ligne de l'historique des mesures (`vueMesure`), en ajout seul. */
export interface MesureKpi {
  id: string;
  kpi_id: string;
  date_mesure: string;
  periode: string;
  /** null : ligne d'annulation. */
  valeur: number | null;
  annulation: boolean;
  remplace_id: string | null;
  /** Ni annulée, ni remplacée, et pas une ligne d'annulation. */
  active: boolean;
  motif: string | null;
  commentaire: string | null;
  justificatif: string | null;
  origine: "cabinet" | "portail";
  saisie_par: { id: string; nom: string | null };
  saisie_le: string;
}

export interface PageKpi<T> {
  elements: T[];
  curseur_suivant: string | null;
}

/** Alerte enregistrée (`GET /api/kpi/:id/alertes`), détails en snake_case. */
export interface AlerteEnregistree {
  id: string;
  code: string;
  periode: string;
  details: Record<string, unknown> | null;
  detectee_le: string;
}

/** Réglages du pilotage par KPI du cabinet (`GET /api/kpi/parametres`). */
export interface ParametresKpi {
  rappels_actifs: boolean;
  delai_grace_jours: number;
  periodes_degradation: number;
  valeurs_validees: boolean;
}

export const FORMAT_EXPORT_KPI = "missionpilot.kpi.v1";

/** KPI de l'export versionné (`GET /api/missions/:id/kpi/export`). */
export interface KpiExporte {
  definition: DefinitionKpi;
  cibles: CibleKpiVue[];
  mesures: MesureKpi[];
  mesures_tronquees: boolean;
  statut: StatutKpi;
  tendance: TendanceKpiVue;
  periodes_total: number;
  periodes: PeriodeKpiVue[];
  alertes: AlerteKpiVue[];
}

export interface ExportKpi {
  format: typeof FORMAT_EXPORT_KPI;
  genere_le: string;
  date_reference: string;
  periodes_exportees_max: number;
  mesures_exportees_max: number;
  mission: { id: string; intitule: string | null };
  score_global: ScoreKpiVue | null;
  kpis: KpiExporte[];
}

/** Série par période d'un KPI (`GET /api/missions/:id/kpi/series`, sans audit d'export). */
export interface KpiSerie {
  definition: DefinitionKpi;
  statut: StatutKpi;
  periodes_total: number;
  periodes: PeriodeKpiVue[];
}

export interface SerieKpiMission {
  mission_id: string;
  date_reference: string;
  periodes_max: number;
  kpis: KpiSerie[];
}

// --- Règles affichées (rappel des décisions, jamais recalculées ici) --------------------------

/** Seuils de statut par défaut du moteur (DECISIONS.md, KPI-03) : affichage seulement. */
export const SEUILS_STATUT_DEFAUT = { vert: 0.95, orange: 0.8 } as const;
/** Corrections successives d'une même mesure admises par l'API (migration 0160, MPK07). */
export const MAX_CORRECTIONS_PAR_MESURE = 20;
/** Contributeurs du portail par KPI (schéma partagé). */
export const MAX_CONTRIBUTEURS_KPI = 50;
/** Périodes servies par KPI dans l'export (la série affichée vient de l'export). */
export const PERIODES_EXPORTEES_MAX = 36;

// --- Libellés -------------------------------------------------------------------------------

interface LibelleTonalite {
  libelle: string;
  tonalite: TonaliteStatut;
}

/** Statut : libellé TOUJOURS écrit (la couleur et l'icône ne portent jamais seules le sens). */
export const STATUT_KPI: Record<StatutKpi, LibelleTonalite> = {
  vert: { libelle: "Vert : cible atteinte", tonalite: "succes" },
  orange: { libelle: "Orange : à surveiller", tonalite: "attention" },
  rouge: { libelle: "Rouge : en retard sur la cible", tonalite: "danger" },
  non_mesure: { libelle: "Non mesuré", tonalite: "neutre" },
  sans_cible: { libelle: "Sans cible", tonalite: "neutre" },
};

export function libelleStatutKpi(statut: string | null | undefined): LibelleTonalite {
  return statut && statut in STATUT_KPI
    ? STATUT_KPI[statut as StatutKpi]
    : { libelle: "Statut inconnu", tonalite: "neutre" };
}

export const SENS_LIBELLES: Record<SensLectureKpiApi, string> = {
  plus_haut_mieux: "Plus haut = mieux",
  plus_bas_mieux: "Plus bas = mieux",
};

export const NATURE_LIBELLES: Record<NatureKpiApi, string> = {
  flux: "Flux : somme des mesures de la période",
  stock: "Stock : dernière valeur de la période",
};

export const FREQUENCE_LIBELLES: Record<FrequenceKpiApi, string> = {
  hebdomadaire: "Hebdomadaire",
  mensuelle: "Mensuelle",
  trimestrielle: "Trimestrielle",
  semestrielle: "Semestrielle",
  annuelle: "Annuelle",
};

export const PERSPECTIVE_LIBELLES: Record<PerspectiveKpi, string> = {
  finances: "Finances",
  clients: "Clients",
  processus: "Processus internes",
  apprentissage: "Apprentissage et croissance",
};

export const SANS_PERSPECTIVE = "Sans perspective";

export const libellePerspective = (p: PerspectiveKpi | null | undefined) =>
  p ? (PERSPECTIVE_LIBELLES[p] ?? SANS_PERSPECTIVE) : SANS_PERSPECTIVE;

export const METHODE_PROJECTION_LIBELLES: Record<MethodeProjectionKpi, string> = {
  prorata: "prorata temporel du cumul de la période",
  regression: "tendance linéaire des mesures",
  reconduction: "reconduction de la dernière valeur",
  aucune: "aucune mesure exploitable",
};

export const ORIGINE_LIBELLES: Record<MesureKpi["origine"], string> = {
  cabinet: "Cabinet",
  portail: "Portail client",
};

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const MOIS_COURTS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

const rangOrdinal = (n: number) => (n === 1 ? "1er" : `${n}e`);

/**
 * Clé de période de l'API → libellé : « 2026-03 » → « mars 2026 », « 2026-W41 » →
 * « semaine 41 de 2026 », « 2026-T1 » → « 1er trimestre 2026 », « 2026-S2 » →
 * « 2e semestre 2026 », « 2026 » → « année 2026 ». Clé inconnue : rendue telle quelle.
 */
export function libellePeriode(cle: string | null | undefined): string {
  if (!cle) return VALEUR_ABSENTE;
  let m = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (m) return `semaine ${Number(m[2])} de ${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(cle);
  if (m) {
    const mois = MOIS[Number(m[2]) - 1];
    return mois ? `${mois} ${m[1]}` : cle;
  }
  m = /^(\d{4})-T([1-4])$/.exec(cle);
  if (m) return `${rangOrdinal(Number(m[2]))} trimestre ${m[1]}`;
  m = /^(\d{4})-S([12])$/.exec(cle);
  if (m) return `${rangOrdinal(Number(m[2]))} semestre ${m[1]}`;
  if (/^\d{4}$/.test(cle)) return `année ${cle}`;
  return cle;
}

/** Libellé court d'axe de graphique : « mars 26 », « S41 26 », « T1 26 », « S2 26 », « 2026 ». */
export function libellePeriodeCourt(cle: string): string {
  let m = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (m) return `S${Number(m[2])} ${m[1]!.slice(2)}`;
  m = /^(\d{4})-(\d{2})$/.exec(cle);
  if (m) {
    const mois = MOIS_COURTS[Number(m[2]) - 1];
    return mois ? `${mois} ${m[1]!.slice(2)}` : cle;
  }
  m = /^(\d{4})-([TS])([1-4])$/.exec(cle);
  if (m) return `${m[2]}${m[3]} ${m[1]!.slice(2)}`;
  return cle;
}

// --- Mise en forme des chiffres du moteur ------------------------------------------------------

const NBSP = "\u00a0";

/** Valeur d'un KPI avec son unité : « 1 250,5 kFCFA » (six décimales au plus, comme l'API). */
export function formaterValeurKpi(valeur: number | null | undefined, unite: string): string {
  const n = formaterNombre(valeur, 6);
  if (n === VALEUR_ABSENTE) return n;
  return unite ? `${n}${NBSP}${unite}` : n;
}

/** Taux d'atteinte ou score (fraction) → « 87,5 % ». */
export const formaterTauxKpi = (taux: number | null | undefined) => formaterPourcentage(taux, 1);

function signe(v: number, options: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("fr-FR", { ...options, signDisplay: "exceptZero" }).format(v);
}

/**
 * Écart à la cible (calculé par le moteur) : « +120 kFCFA (+12 %), favorable ». « Favorable »
 * suit le sens de lecture du KPI (écart orienté positif ou nul).
 */
export function texteEcart(e: EcartKpiVue | null | undefined, unite: string): string {
  if (!e || !Number.isFinite(e.ecart)) return VALEUR_ABSENTE;
  const brut = `${signe(e.ecart, { maximumFractionDigits: 6 })}${unite ? `${NBSP}${unite}` : ""}`;
  const relatif =
    e.ecart_relatif === null || !Number.isFinite(e.ecart_relatif)
      ? ""
      : ` (${signe(e.ecart_relatif, { style: "percent", maximumFractionDigits: 1 })})`;
  return `${brut}${relatif}, ${e.ecart_oriente >= 0 ? "favorable" : "défavorable"}`;
}

/** Atteinte : « 87,5 % de la cible » ; cible nulle : atteinte binaire (respectée ou non). */
export function texteAtteinte(a: AtteinteKpiVue | null | undefined): string {
  if (!a) return VALEUR_ABSENTE;
  if (a.mode === "binaire") {
    return a.taux >= 1 ? "Cible nulle respectée (100 %)" : "Cible nulle non respectée (0 %)";
  }
  const borne =
    a.borne === "plafond" ? " (plafonné)" : a.borne === "plancher" ? " (plancher atteint)" : "";
  return `${formaterTauxKpi(a.taux)} de la cible${borne}`;
}

export interface DescriptionTendance {
  /** Flèche décorative (masquée aux lecteurs d'écran : le texte porte le sens). */
  fleche: "↑" | "↓" | "→" | "?";
  texte: string;
  tonalite: TonaliteStatut;
}

const FLECHES: Record<DirectionKpi, DescriptionTendance["fleche"]> = {
  hausse: "↑",
  baisse: "↓",
  stable: "→",
  indeterminee: "?",
};

/** Tendance du moteur → flèche ET texte (« En hausse : amélioration, sur 4 périodes »). */
export function descriptionTendance(t: TendanceKpiVue | null | undefined): DescriptionTendance {
  if (!t || t.direction === "indeterminee" || t.evolution === "indeterminee") {
    return {
      fleche: "?",
      texte: "Tendance indéterminée : moins de deux périodes closes mesurées",
      tonalite: "neutre",
    };
  }
  const sur = `, sur ${t.points} période${t.points > 1 ? "s" : ""} mesurée${t.points > 1 ? "s" : ""}`;
  if (t.direction === "stable" || t.evolution === "stable") {
    return { fleche: "→", texte: `Stable${sur}`, tonalite: "neutre" };
  }
  const direction = t.direction === "hausse" ? "En hausse" : "En baisse";
  const amelioration = t.evolution === "amelioration";
  return {
    fleche: FLECHES[t.direction],
    texte: `${direction} : ${amelioration ? "amélioration" : "dégradation"}${sur}`,
    tonalite: amelioration ? "succes" : "danger",
  };
}

/** Projection à la fin de la période en cours, avec sa méthode (moteur). */
export function texteProjection(p: ProjectionKpiVue | null | undefined, unite: string): string {
  if (!p || p.valeur_projetee === null) {
    return "Projection indisponible : aucune mesure exploitable dans la période en cours.";
  }
  const methode = METHODE_PROJECTION_LIBELLES[p.methode] ?? p.methode;
  return `${formaterValeurKpi(p.valeur_projetee, unite)} en fin de période (${methode}, ${p.jours_ecoules} jour${p.jours_ecoules > 1 ? "s" : ""} écoulé${p.jours_ecoules > 1 ? "s" : ""} sur ${p.jours_total})`;
}

/** Seuils de statut du KPI (ou ceux du moteur), écrits : « vert dès 95 %, orange dès 80 % ». */
export function texteSeuilsStatut(def: Pick<DefinitionKpi, "seuil_vert" | "seuil_orange">): string {
  const propres = def.seuil_vert !== null && def.seuil_orange !== null;
  const vert = propres ? (def.seuil_vert as number) : SEUILS_STATUT_DEFAUT.vert;
  const orange = propres ? (def.seuil_orange as number) : SEUILS_STATUT_DEFAUT.orange;
  return `Vert à partir de ${formaterTauxKpi(vert)} de la cible, orange de ${formaterTauxKpi(orange)} à ${formaterTauxKpi(vert)}, rouge en dessous de ${formaterTauxKpi(orange)}${propres ? " (seuils propres à ce KPI)" : " (seuils par défaut)"}.`;
}

export interface DescriptionAlerte {
  titre: string;
  texte: string;
  tonalite: "attention" | "danger";
}

const nombreLu = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const texteLu = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Alerte du moteur (tableau de bord) ou enregistrée → titre et phrase française. */
export function descriptionAlerte(
  alerte: { code: string; periode?: string | null } & Record<string, unknown>,
  unite: string,
): DescriptionAlerte {
  const periode = libellePeriode(texteLu(alerte.periode));
  const valeur = (v: unknown) => formaterValeurKpi(nombreLu(v), unite);
  switch (alerte.code) {
    case "DEGRADATION_CONSECUTIVE": {
      const n = nombreLu(alerte.periodes);
      return {
        titre: "Dégradation continue",
        texte: `La valeur se dégrade depuis ${n ?? VALEUR_ABSENTE} périodes consécutives, jusqu'à ${periode} (alerte à partir de ${nombreLu(alerte.seuil) ?? VALEUR_ABSENTE}).`,
        tonalite: "danger",
      };
    }
    case "MESURE_EN_RETARD": {
      const jours = nombreLu(alerte.jours_de_retard);
      const manquantes = nombreLu(alerte.periodes_manquantes) ?? 1;
      const suite =
        manquantes > 1
          ? ` ${manquantes} périodes sont sans mesure, jusqu'à ${libellePeriode(texteLu(alerte.derniere_periode_due))}.`
          : "";
      return {
        titre: "Mesure en retard",
        texte: `Aucune mesure pour ${libellePeriode(texteLu(alerte.periode_attendue))}, attendue au plus tard le ${formaterDate(texteLu(alerte.echeance))} (${jours ?? VALEUR_ABSENTE} jour${jours !== null && jours > 1 ? "s" : ""} de retard).${suite}`,
        tonalite: "attention",
      };
    }
    case "SEUIL_HAUT":
      return {
        titre: "Seuil d'alerte haut dépassé",
        texte: `${capitaliser(periode)} : ${valeur(alerte.valeur)}, au-dessus du seuil de ${valeur(alerte.seuil)}.`,
        tonalite: "danger",
      };
    case "SEUIL_BAS":
      return {
        titre: "Seuil d'alerte bas franchi",
        texte: `${capitaliser(periode)} : ${valeur(alerte.valeur)}, en dessous du seuil de ${valeur(alerte.seuil)}.`,
        tonalite: "danger",
      };
    case "VARIATION": {
      const relative = nombreLu(alerte.variation_relative);
      const variation =
        relative === null
          ? "depuis une valeur nulle"
          : signe(relative, { style: "percent", maximumFractionDigits: 1 });
      return {
        titre: "Variation inhabituelle",
        texte: `${capitaliser(periode)} : ${valeur(alerte.valeur)} contre ${valeur(alerte.precedente)} la période précédente (${variation}), au-delà de la variation admise de ${formaterTauxKpi(nombreLu(alerte.seuil))}.`,
        tonalite: "attention",
      };
    }
    default:
      return {
        titre: "Alerte",
        texte: `Alerte signalée par le moteur pour ${periode}.`,
        tonalite: "attention",
      };
  }
}

/** Alerte enregistrée (détails en objet) → même forme qu'une alerte du tableau de bord. */
export function alerteDepuisEnregistrement(
  a: AlerteEnregistree,
): { code: string; periode: string } & Record<string, unknown> {
  return { ...(a.details ?? {}), code: a.code, periode: a.periode };
}

function capitaliser(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// --- Chemins de l'API et des pages ----------------------------------------------------------

const seg = (id: string) => encodeURIComponent(id);

function avecRequete(base: string, params: Record<string, string | number | null | undefined>) {
  const r = new URLSearchParams();
  for (const [cle, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") r.set(cle, String(v));
  }
  const q = r.toString();
  return q ? `${base}?${q}` : base;
}

export const cheminKpiMission = (missionId: string) => `/api/missions/${seg(missionId)}/kpi`;
export const cheminTableauKpi = (missionId: string, date: string | null) =>
  avecRequete(`/api/missions/${seg(missionId)}/kpi/tableau-de-bord`, { date });
export const cheminExportKpi = (missionId: string, date: string | null) =>
  avecRequete(`/api/missions/${seg(missionId)}/kpi/export`, { date });
export const cheminSerieKpi = (missionId: string, date: string | null) =>
  avecRequete(`/api/missions/${seg(missionId)}/kpi/series`, { date });
export const cheminKpi = (kpiId: string) => `/api/kpi/${seg(kpiId)}`;
export const cheminCiblesKpi = (kpiId: string) => `/api/kpi/${seg(kpiId)}/cibles`;
export const cheminContributeursKpi = (kpiId: string) => `/api/kpi/${seg(kpiId)}/contributeurs`;
export const cheminMesuresKpi = (
  kpiId: string,
  page: { limite?: number; curseur?: string | null } = {},
) => avecRequete(`/api/kpi/${seg(kpiId)}/mesures`, page);
export const cheminAlertesKpi = (
  kpiId: string,
  page: { limite?: number; curseur?: string | null } = {},
) => avecRequete(`/api/kpi/${seg(kpiId)}/alertes`, page);
export const cheminCorrectionMesure = (mesureId: string) =>
  `/api/kpi/mesures/${seg(mesureId)}/corrections`;
export const cheminAnnulationMesure = (mesureId: string) =>
  `/api/kpi/mesures/${seg(mesureId)}/annulation`;
export const CHEMIN_PARAMETRES_KPI = "/api/kpi/parametres";

export const hrefTableauKpi = (missionId: string, date: string | null = null) =>
  avecRequete(`/missions/${seg(missionId)}/kpi`, { date });
export const hrefNouveauKpi = (missionId: string) => `/missions/${seg(missionId)}/kpi/nouveau`;
export const hrefParametresKpi = (missionId: string) =>
  `/missions/${seg(missionId)}/kpi/parametres`;
export const hrefKpi = (
  missionId: string,
  kpiId: string,
  params: Record<string, string | null | undefined> = {},
) => avecRequete(`/missions/${seg(missionId)}/kpi/${seg(kpiId)}`, params);
export const hrefModifierKpi = (missionId: string, kpiId: string) =>
  `/missions/${seg(missionId)}/kpi/${seg(kpiId)}/modifier`;

/** Paramètre d'URL unique (`?curseur=…`) ; un curseur trop long est ignoré (l'API le refuserait). */
export function lireCurseur(v: string | string[] | undefined): string | null {
  const brut = Array.isArray(v) ? v[0] : v;
  return typeof brut === "string" && brut !== "" && brut.length <= 500 ? brut : null;
}

// --- Date d'arrêté (bornée comme l'API) -----------------------------------------------------

/** Ajoute `jours` à une date « AAAA-MM-JJ » (calendrier UTC). */
export function ajouterJoursIso(date: string, jours: number): string {
  const [a, m, j] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j + jours)).toISOString().slice(0, 10);
}

/** Bornes du sélecteur : du 2000-01-01 à aujourd'hui + 366 jours (schéma partagé). */
export function bornesDateArrete(aujourdhui: string): { min: string; max: string } {
  return { min: DATE_SUIVI_KPI_MIN, max: ajouterJoursIso(aujourdhui, HORIZON_ARRETE_KPI_JOURS) };
}

export interface DateArrete {
  /** Date demandée et valide, ou null (l'API arrête alors à aujourd'hui). */
  date: string | null;
  /** Message affiché quand la date demandée a été écartée. */
  erreur: string | null;
}

/** Date d'arrêté lue dans l'URL (`?date=`), contrôlée AVANT l'appel (l'API la refuserait). */
export function lireDateArrete(v: string | string[] | undefined, aujourdhui: string): DateArrete {
  const brut = Array.isArray(v) ? v[0] : v;
  if (brut === undefined || brut === "") return { date: null, erreur: null };
  const { min, max } = bornesDateArrete(aujourdhui);
  if (!dateValide(brut)) {
    return {
      date: null,
      erreur: "Date d'arrêté illisible : le tableau de bord est arrêté à aujourd'hui.",
    };
  }
  if (brut < min || brut > max) {
    return {
      date: null,
      erreur: `Date d'arrêté hors bornes (du ${formaterDate(min)} au ${formaterDate(max)}) : le tableau de bord est arrêté à aujourd'hui.`,
    };
  }
  return { date: brut, erreur: null };
}

// --- Droits (confort d'affichage : l'API décide) -----------------------------------------------

export interface DroitsKpi {
  /** Créer, modifier, cibles, contributeurs, désactiver ; annuler une mesure du portail. */
  gerer: boolean;
  /** Saisir, corriger, annuler une mesure côté cabinet. */
  saisir: boolean;
  /** Modifier les réglages du cabinet (rappels, délai de grâce, dégradation). */
  parametres: boolean;
}

type MissionDroits = Pick<MissionDetaillee, "statut" | "directeur_id" | "chef_id" | "equipe">;

/**
 * Miroir de `apps/api/src/kpi/acces.ts` : gérer exige `kpi.gerer` et une mission modifiable
 * (directeur, chef ou « modifier toutes les missions ») non clôturée ; saisir exige
 * `kpi.saisir`, une mission non clôturée, un KPI actif, et d'être responsable, membre de
 * l'équipe ou propriétaire du KPI (lire toutes les missions ne suffit pas).
 */
export function droitsKpi(
  roles: readonly Role[],
  utilisateurId: string,
  mission: MissionDroits,
  def?: Pick<DefinitionKpi, "proprietaire_id" | "actif">,
): DroitsKpi {
  const a = (p: Parameters<typeof aPermission>[1]) => aPermission(roles, p);
  const ouverte = mission.statut !== "cloturee";
  const responsable =
    a("mission.modifier_toutes") ||
    (mission.directeur_id !== null && mission.directeur_id === utilisateurId) ||
    (mission.chef_id !== null && mission.chef_id === utilisateurId);
  const equipe = mission.equipe.some((e) => e.utilisateur_id === utilisateurId);
  const proprietaire = def?.proprietaire_id != null && def.proprietaire_id === utilisateurId;
  return {
    gerer: a("kpi.gerer") && responsable && ouverte,
    saisir:
      a("kpi.saisir") && ouverte && (def?.actif ?? true) && (responsable || equipe || proprietaire),
    parametres: a("cabinet.gerer"),
  };
}

/** Raison affichée quand la saisie n'est pas proposée. */
export function raisonSansSaisie(
  mission: Pick<MissionDetaillee, "statut">,
  def: Pick<DefinitionKpi, "actif">,
  roles: readonly Role[],
): string {
  if (mission.statut === "cloturee") return "La mission est clôturée : les mesures sont figées.";
  if (!def.actif) return "Ce KPI est désactivé : réactivez-le pour saisir de nouvelles mesures.";
  if (!aPermission(roles, "kpi.saisir")) {
    return "Votre rôle permet de consulter les KPI, pas d'en saisir les mesures.";
  }
  return "La saisie est réservée au directeur, au chef de mission, aux membres de l'équipe et au propriétaire du KPI.";
}

// --- Personnes : propriétaire et contributeurs ------------------------------------------------

export interface OptionPersonne {
  valeur: string;
  libelle: string;
}

/**
 * Propriétaires proposés : directeur, chef et membres de l'équipe de la mission (règle 5 de
 * l'API, qui vérifie en plus que la personne est active et lit les KPI). `noms` complète les
 * noms connus (référentiel des collaborateurs).
 */
export function candidatsProprietaire(
  mission: Pick<MissionDetaillee, "directeur_id" | "chef_id" | "equipe">,
  noms: ReadonlyMap<string, string>,
): OptionPersonne[] {
  const options: OptionPersonne[] = [];
  const vus = new Set<string>();
  const ajouter = (id: string | null, nom: string | undefined, role: string) => {
    if (!id || vus.has(id)) return;
    vus.add(id);
    options.push({ valeur: id, libelle: `${nom ?? noms.get(id) ?? "Collaborateur"} (${role})` });
  };
  ajouter(mission.directeur_id, undefined, "directeur de mission");
  ajouter(mission.chef_id, undefined, "chef de mission");
  for (const e of [...mission.equipe].sort((x, y) => x.nom.localeCompare(y.nom, "fr"))) {
    ajouter(e.utilisateur_id, e.nom, "équipe");
  }
  return options;
}

/** Nom du propriétaire d'un KPI, ou « Aucun propriétaire ». */
export function nomProprietaire(
  id: string | null,
  options: readonly OptionPersonne[],
  noms: ReadonlyMap<string, string>,
): string {
  if (!id) return "Aucun propriétaire désigné";
  return (
    options.find((o) => o.valeur === id)?.libelle ??
    noms.get(id) ??
    "Collaborateur hors de l'équipe actuelle"
  );
}

/** Compte du portail d'un client (`GET /api/portail/utilisateurs?client_id=`). */
export interface ComptePortailKpi {
  id: string;
  nom: string;
  email: string;
  roles: string[];
  statut: string;
}

export interface CandidatContributeur {
  id: string;
  nom: string;
  email: string;
  role: string;
  desactive: boolean;
}

const ROLES_CONTRIBUTEURS = ["client_dirigeant", "client_contributeur"] as const;

/**
 * Contributeurs possibles : dirigeants et contributeurs du portail du client de la mission
 * (jamais l'investisseur), plus les contributeurs déjà désignés (pour pouvoir les retirer).
 */
export function candidatsContributeurs(
  comptes: readonly ComptePortailKpi[],
  actuels: readonly ContributeurKpi[],
): CandidatContributeur[] {
  const liste = new Map<string, CandidatContributeur>();
  for (const c of comptes) {
    const role = ROLES_CONTRIBUTEURS.find((r) => c.roles.includes(r));
    if (!role) continue;
    liste.set(c.id, {
      id: c.id,
      nom: c.nom,
      email: c.email,
      role: ROLE_LIBELLES[role],
      desactive: c.statut !== "actif",
    });
  }
  for (const a of actuels) {
    if (!liste.has(a.id)) {
      liste.set(a.id, {
        id: a.id,
        nom: a.nom,
        email: a.email,
        role: "Contributeur",
        desactive: false,
      });
    }
  }
  return [...liste.values()].sort((x, y) => x.nom.localeCompare(y.nom, "fr"));
}

// --- Regroupements d'affichage ---------------------------------------------------------------

/** KPI du tableau de bord regroupés par perspective, dans l'ordre du tableau de bord prospectif. */
export function kpisParPerspective(
  kpis: readonly KpiTableau[],
): { perspective: PerspectiveKpi | null; libelle: string; kpis: KpiTableau[] }[] {
  return [...PERSPECTIVES_KPI, null]
    .map((perspective) => ({
      perspective,
      libelle: libellePerspective(perspective),
      kpis: kpis.filter((k) => (k.perspective ?? null) === perspective),
    }))
    .filter((g) => g.kpis.length > 0);
}

export interface EtatLigneMesure {
  libelle: string;
  tonalite: TonaliteStatut;
}

/**
 * État d'une ligne de l'historique (ajout seul) : active, corrigée, annulée ou ligne
 * d'annulation. `lignes` sert à retrouver la ligne qui l'a remplacée quand elle est chargée.
 */
export function etatLigneMesure(m: MesureKpi, lignes: readonly MesureKpi[]): EtatLigneMesure {
  if (m.annulation) return { libelle: "Annulation", tonalite: "neutre" };
  if (m.active) {
    return m.remplace_id
      ? { libelle: "Active (correction)", tonalite: "succes" }
      : { libelle: "Active", tonalite: "succes" };
  }
  const remplacante = lignes.find((l) => l.remplace_id === m.id);
  if (remplacante?.annulation) return { libelle: "Annulée", tonalite: "attention" };
  if (remplacante) return { libelle: "Corrigée", tonalite: "attention" };
  return { libelle: "Corrigée ou annulée", tonalite: "attention" };
}

/**
 * Rang de correction d'une mesure dans la chaîne chargée (0 : saisie initiale). Approximation
 * d'affichage : seules les lignes chargées sont suivies ; l'API reste seule juge (409).
 */
export function rangCorrection(m: MesureKpi, lignes: readonly MesureKpi[]): number {
  const parId = new Map(lignes.map((l) => [l.id, l]));
  let rang = 0;
  let courante: MesureKpi | undefined = m;
  const vus = new Set<string>();
  while (courante?.remplace_id && !vus.has(courante.id)) {
    vus.add(courante.id);
    rang++;
    courante = parId.get(courante.remplace_id);
  }
  return rang;
}

// --- Erreurs de l'API -----------------------------------------------------------------------

/** Codes dont le message de l'API, explicite et en français, est affiché tel quel. */
const CODES_MESSAGE_API = new Set([
  "KPI_TROP_DE_PERIODES",
  "KPI_CHAMP_FIGE",
  "KPI_HISTORIQUE_IMMUABLE",
]);

export const MESSAGES_KPI: Record<string, string> = {
  KPI_DEBUT_SUIVI_TROP_ANCIEN:
    "Le suivi d'un KPI commence au plus 10 ans avant sa création (la date est ramenée au premier jour de sa période) : choisissez un début de suivi plus récent.",
  KPI_TROP_DE_CORRECTIONS: `Cette mesure a déjà été corrigée ${MAX_CORRECTIONS_PAR_MESURE} fois, le maximum admis : annulez-la (avec un motif), puis saisissez à nouveau la valeur à cette date.`,
  KPI_MESURE_EN_DOUBLE:
    "Une mesure active existe déjà à cette date : corrigez-la depuis l'historique plutôt que d'en saisir une seconde.",
  KPI_HORS_PERIODE:
    "La date de mesure doit être comprise entre le début du suivi et aujourd'hui (ou la fin du suivi si elle est passée).",
  KPI_INACTIF: "Ce KPI est désactivé : réactivez-le avant de saisir des mesures.",
  KPI_INCOHERENT:
    "Choix refusé : un contributeur doit être un dirigeant ou un contributeur du portail de ce client.",
};

const MESSAGE_INTROUVABLE_KPI =
  "Ce KPI ou cette mesure n'existe plus ou ne vous est plus accessible : rechargez la page.";

/** Message affichable (français) pour une erreur des écrans KPI. */
export function messageKpi(e: unknown): string {
  if (e instanceof ErreurApi) {
    const specifique = MESSAGES_KPI[e.code];
    if (specifique) return specifique;
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_KPI;
    // Conflits explicites de l'API : déjà corrigée ou annulée, mission clôturée, plafond de KPI.
    if (e.statut === 409) return e.message;
    // Règles métier refusées par l'API (propriétaire, cible avant le suivi, invariant du
    // moteur…) : message français. « Données invalides. » (validation) reste générique.
    if (e.statut === 400 && e.message !== "Données invalides.") return e.message;
  }
  return messageErreur(e);
}

/** Refus d'annuler une mesure saisie depuis le portail (403). */
export function messageAnnulationKpi(e: unknown, origine: MesureKpi["origine"]): string {
  if (e instanceof ErreurApi && e.statut === 403 && origine === "portail") {
    return "Seul un responsable de la mission (directeur ou chef, avec la gestion des KPI) peut annuler une mesure saisie depuis le portail client.";
  }
  return messageKpi(e);
}

/** Après ce refus, l'écran est probablement périmé : rafraîchir les données. */
export const etatKpiChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Export JSON ----------------------------------------------------------------------------

export function estExportKpi(v: unknown): v is ExportKpi {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { format?: unknown }).format === FORMAT_EXPORT_KPI &&
    Array.isArray((v as { kpis?: unknown }).kpis)
  );
}

/** Export versionné de la mission à la date d'arrêté ; refuse un format inattendu. */
export async function chargerExportKpi(missionId: string, date: string | null): Promise<ExportKpi> {
  const donnees = await api.get<unknown>(cheminExportKpi(missionId, date), { delaiMs: 30_000 });
  if (!estExportKpi(donnees)) {
    throw new ErreurApi(
      "EXPORT_INATTENDU",
      `Le serveur a renvoyé un export dans un format inattendu (attendu : ${FORMAT_EXPORT_KPI}).`,
      200,
    );
  }
  return donnees;
}

export function estSerieKpi(v: unknown): v is SerieKpiMission {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { mission_id?: unknown }).mission_id === "string" &&
    Array.isArray((v as { kpis?: unknown }).kpis)
  );
}

/** Séries par période de la mission à la date d'arrêté (lecture, sans écriture au journal d'export). */
export async function chargerSerieKpi(
  missionId: string,
  date: string | null,
): Promise<SerieKpiMission> {
  const donnees = await api.get<unknown>(cheminSerieKpi(missionId, date), { delaiMs: 30_000 });
  if (!estSerieKpi(donnees)) {
    throw new ErreurApi(
      "SERIE_INATTENDUE",
      "Le serveur a renvoyé les séries dans un format inattendu.",
      200,
    );
  }
  return donnees;
}

/** « kpi-pilotage-de-la-performance-2026-05-15.json » (ASCII, sans caractère spécial). */
export function nomFichierExportKpi(intitule: string | null, date: string): string {
  const base = (intitule ?? "mission")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `kpi-${base || "mission"}-${date}.json`;
}
