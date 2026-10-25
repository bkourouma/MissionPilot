import { ajouterJours } from "@missionpilot/engines";
import type { MissionTrouvee } from "./casting.js";
import { moisEntre } from "./kpi-series.js";
import type { SpecMissionKpi } from "./kpi-types.js";

/*
 * Fenêtre des données datées de l'étape « kpi » pour UNE mission : du premier jour du mois qui
 * précède le début de la mission (mesure de référence initiale) jusqu'à min(date de fin de la
 * mission, 30 septembre 2026). Rien de daté (mesure, cible, incident, revue, échéance, effet,
 * passage du suivi) n'est semé hors de cette fenêtre ; une mission signée mais pas démarrée a une
 * fenêtre vide (aucune mesure). Seule exception : la revue PLANIFIÉE d'une mission en cours, qui
 * peut rester dans les semaines qui suivent « aujourd'hui ».
 * La fenêtre est calculée à l'exécution depuis les dates de la mission (jamais de constante).
 */

/** Dernier jour de mesure du seed : jamais de mesure au-delà (pas de mesure future). */
export const DERNIERE_DATE_MESURE = "2026-09-30";

/** Horizon maximal d'une revue planifiée d'une mission en cours, après « aujourd'hui ». */
const HORIZON_REVUE_PLANIFIEE_JOURS = 30;

export interface FenetreKpi {
  /** Premier jour du mois précédant le début de la mission (début du suivi des KPI). */
  debut: string;
  /** min(fin de mission, DERNIERE_DATE_MESURE) ; antérieure à `debut` si la fenêtre est vide. */
  fin: string;
  /** Mois `AAAA-MM` mesurés, du mois précédant le début au mois de `fin` ; vide si non démarrée. */
  mois: string[];
  /** Fin de mission (borne la dernière date de mesure d'une mission terminée). */
  dateFinMission: string;
  /** Mission encore en cours à « aujourd'hui » (la fin de mission n'est pas passée). */
  enCours: boolean;
}

function moisPrecedent(mois: string): string {
  const [a, m] = mois.split("-").map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export function fenetreMission(mission: MissionTrouvee, aujourdhui: string): FenetreKpi {
  if (!mission.dateDebut || !mission.dateFin) {
    throw new Error(`Mission « ${mission.intitule} » sans dates : fenêtre des KPI indéterminée.`);
  }
  const premierMois = moisPrecedent(mission.dateDebut.slice(0, 7));
  const fin = mission.dateFin < DERNIERE_DATE_MESURE ? mission.dateFin : DERNIERE_DATE_MESURE;
  return {
    debut: `${premierMois}-01`,
    fin,
    mois: moisEntre(premierMois, fin.slice(0, 7)),
    dateFinMission: mission.dateFin,
    enCours: mission.dateFin >= aujourdhui,
  };
}

/**
 * Dates des passages du suivi quotidien rejoués : le 8 de chaque mois (délai de grâce passé)
 * suivant le premier mois mesuré, dans la fenêtre ; mission terminée : un dernier passage à sa
 * fin ; mission en cours : jusqu'à « aujourd'hui » (qui détecte les retards du dernier mois).
 */
export function datesDeSuivi(f: FenetreKpi, aujourdhui: string): string[] {
  if (f.mois.length === 0) return [];
  const limite = f.enCours ? aujourdhui : f.dateFinMission;
  const dates = moisEntre(f.mois[1] ?? f.mois[0]!, limite.slice(0, 7))
    .map((m) => `${m}-08`)
    .filter((d) => d > f.debut && d < limite);
  return [...dates, limite];
}

/** Vérifie qu'une date appartient à la fenêtre ; sinon erreur explicite (donnée de seed fautive). */
function exigerDans(f: FenetreKpi, date: string, quoi: string): void {
  if (date < f.debut || date > f.fin) {
    throw new Error(`${quoi} : ${date} hors de la fenêtre [${f.debut} ; ${f.fin}] de la mission.`);
  }
}

/**
 * Contrôle toutes les données datées d'une spécification (mois d'incidents, de corrections, de
 * révisions de cible ; revues, décisions, actions) contre la fenêtre de la mission.
 */
export function verifierSpecDansFenetre(
  spec: SpecMissionKpi,
  f: FenetreKpi,
  aujourdhui: string,
): void {
  const nom = spec.mission.intitule;
  if (f.mois.length === 0) {
    if (spec.revues.length > 0 || spec.actions.length > 0 || spec.arbre) {
      throw new Error(`${nom} : mission non démarrée, ni revue, ni action, ni arbre.`);
    }
    if (
      spec.kpis.some((k) => k.revision || k.correction || k.annulation || k.portail?.correction)
    ) {
      throw new Error(`${nom} : mission non démarrée, aucune révision ni correction de mesure.`);
    }
    return;
  }
  const premier = f.mois[0]!;
  const dernier = f.mois[f.mois.length - 1]!;
  const moisOk = (m: string, quoi: string) => {
    if (m < premier || m > dernier) {
      throw new Error(`${nom} : ${quoi} (${m}) hors de la fenêtre ${premier} à ${dernier}.`);
    }
  };
  for (const k of spec.kpis) {
    if (k.revision) moisOk(k.revision.mois, `révision de la cible « ${k.libelle} »`);
    for (const e of [k.correction, k.annulation, k.portail?.correction]) {
      if (e) moisOk(e.mois, `erreur de saisie « ${k.libelle} »`);
    }
    for (const m of Object.keys("type" in k.serie ? {} : (k.serie.incidents ?? {}))) {
      moisOk(m, `incident « ${k.libelle} »`);
    }
  }
  const futureAutorisee = ajouterJours(aujourdhui, HORIZON_REVUE_PLANIFIEE_JOURS);
  const actions = [
    ...spec.actions,
    ...spec.revues.flatMap((r) => r.decisions.flatMap((d) => d.actions)),
  ];
  for (const r of spec.revues) {
    const futurePermise =
      f.enCours && r.etat === "planifiee" && r.date > aujourdhui && r.date <= futureAutorisee;
    if (!futurePermise) exigerDans(f, r.date, `Revue « ${r.titre} »`);
    for (const d of r.decisions) exigerDans(f, d.echeance, `Décision « ${d.libelle} »`);
  }
  for (const a of actions) {
    exigerDans(f, a.echeance, `Action « ${a.titre} »`);
    if (a.dateEffet) exigerDans(f, a.dateEffet, `Date d'effet de l'action « ${a.titre} »`);
  }
}
