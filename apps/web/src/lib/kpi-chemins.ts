/**
 * Chemins de l'API et des pages KPI, paramètres d'URL et date d'arrêté. Voir `kpi.ts`, point
 * d'entrée du module.
 */
import { DATE_SUIVI_KPI_MIN, HORIZON_ARRETE_KPI_JOURS } from "@missionpilot/shared";
import { formaterDate } from "./format";
import { dateValide } from "./periode";

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
