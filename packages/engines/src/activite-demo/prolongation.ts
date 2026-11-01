/**
 * Avenant mensuel de prolongation (DT1, DT11, DT12) : besoin de chaque collaborateur sur la fenêtre
 * du mois, net de ses affectations ; mission « socle » de chacun et composition des avenants
 * (plafonds par mission et par mois) ; cohérence du découpage avec le budget de référence ;
 * libellés ; répartition du supplément d'honoraires en échéances hebdomadaires. Pur, en centièmes
 * entiers ; les montants passent par `finance/monnaie.ts` (aucune unité mineure perdue).
 */
import { type Montant, repartirEgalement } from "../finance/monnaie";
import { type ParametresCalendrier, listerJoursOuvres } from "../planning/calendrier";
import { type Absence, type Affectation, joursAffectesSurPeriode } from "../planning/capacite";
import { type DateISO, type Periode, ajouterJours, verifierPeriode } from "../planning/dates";
import { versCentiemes } from "../planning/unites";
import { type DisponibiliteDemo, capacitesJoursDemo } from "./feuille";
import {
  PARAMETRES_ACTIVITE_DEMO,
  type ParametresActiviteDemo,
  comparerTexteDemo,
  exigerCentiemes,
  exigerLundiDemo,
  plancherPas,
} from "./parametres";
import { libelleMoisDemo } from "./semaines";

/** Phase qui reçoit les tâches de prolongation, réutilisée d'un mois à l'autre. */
export const LIBELLE_PHASE_PROLONGATION_DEMO = "Prolongations (démonstration)";

/** « Prolongation — novembre 2026 ». */
export function libelleTacheProlongationDemo(mois: string): string {
  return `Prolongation — ${libelleMoisDemo(mois)}`;
}

/** « Avenant de prolongation novembre 2026 (démonstration) » : motif de la révision du budget. */
export function motifAvenantDemo(mois: string): string {
  return `Avenant de prolongation ${libelleMoisDemo(mois)} (démonstration)`;
}

export interface EntreeBesoinDemo {
  collaborateurId: string;
  capacitePct: number;
  absences: readonly Absence[];
  /** Affectations existantes du collaborateur, toutes missions (celles d'un autre sont ignorées). */
  affectations: readonly Affectation[];
  /** Seulement chef ou directeur, sans affectation : cible d'occupation réduite. */
  encadrant: boolean;
}

export interface BesoinMembreDemo {
  collaborateurId: string;
  centiemes: number;
  debut: DateISO;
  fin: DateISO;
}

interface BesoinSemaine {
  lundi: DateISO;
  fin: DateISO;
  centiemes: number;
}

/** Besoin d'une semaine : max(0, plancher_pas(capacité × cible %) − jours déjà affectés). */
function besoinSemaine(
  e: EntreeBesoinDemo,
  semaine: Periode,
  d: DisponibiliteDemo,
  ciblePct: number,
  p: ParametresActiviteDemo,
): number {
  const capacite = capacitesJoursDemo(semaine, d, p).reduce((s, j) => s + j.centiemes, 0);
  const visee = plancherPas(Math.floor((capacite * ciblePct) / 100), p.pasCentiemes);
  let affecte = 0;
  for (const a of e.affectations) {
    if (a.personneId !== e.collaborateurId) continue;
    affecte += versCentiemes(joursAffectesSurPeriode(a, semaine, d.calendrier));
  }
  return Math.max(0, visee - affecte);
}

/**
 * Besoin d'un collaborateur sur la fenêtre du mois (qui commence un lundi), semaine par semaine et
 * net de ses affectations existantes : cible de 85 % de la capacité saisissable (50 % pour un
 * encadrant). `null` sous un jour au total. Début : lundi de la première semaine à besoin ; fin :
 * dimanche de la dernière semaine à besoin (borné par la fin de la fenêtre).
 */
export function besoinMembreDemo(
  e: EntreeBesoinDemo,
  fenetre: Periode,
  calendrier: ParametresCalendrier,
  moisClotures: readonly string[],
  p: ParametresActiviteDemo = PARAMETRES_ACTIVITE_DEMO,
): BesoinMembreDemo | null {
  verifierPeriode(fenetre);
  exigerLundiDemo(fenetre.debut);
  const { absences, capacitePct } = e;
  const d: DisponibiliteDemo = { calendrier, moisClotures, absences, capacitePct };
  const { occupationEquipePct, occupationEncadrementPct } = p.prolongation;
  const cible = e.encadrant ? occupationEncadrementPct : occupationEquipePct;
  const semaines: BesoinSemaine[] = [];
  for (let l = fenetre.debut; l <= fenetre.fin; l = ajouterJours(l, 7)) {
    const dimanche = ajouterJours(l, 6);
    const fin = dimanche < fenetre.fin ? dimanche : fenetre.fin;
    const centiemes = besoinSemaine(e, { debut: l, fin }, d, cible, p);
    if (centiemes > 0) semaines.push({ lundi: l, fin, centiemes });
  }
  const total = semaines.reduce((s, w) => s + w.centiemes, 0);
  if (total < p.prolongation.minimumMembreCentiemes) return null;
  const premiere = semaines[0] as BesoinSemaine;
  const derniere = semaines[semaines.length - 1] as BesoinSemaine;
  return {
    collaborateurId: e.collaborateurId,
    centiemes: total,
    debut: premiere.lundi,
    fin: derniere.fin,
  };
}

export interface CandidatSocleDemo {
  missionId: string;
  dateDebut: DateISO | null;
  dateFin: DateISO | null;
  budgetCentiemes: number;
  affectes: readonly string[];
  encadrants: readonly string[];
  /** Clés du budget de référence : `grade:CODE` ou `collaborateur:ID`. */
  clesBudget: readonly string[];
  eligible: boolean;
}

export interface MembreAvenantDemo {
  collaborateurId: string;
  cleBudget: string;
  centiemes: number;
  debut: DateISO;
  fin: DateISO;
}

export interface AvenantDemo {
  missionId: string;
  debut: DateISO;
  fin: DateISO;
  /** Membres par id. */
  membres: MembreAvenantDemo[];
  /** Jours par clé de budget, par clé. */
  lignes: { cle: string; centiemes: number }[];
  totalCentiemes: number;
}

/** Clé de budget d'un membre dans une mission : nominative d'abord, puis celle de son grade. */
function cleDe(
  collaborateurId: string,
  grade: string | null,
  cles: readonly string[],
): string | null {
  const nominative = `collaborateur:${collaborateurId}`;
  if (cles.includes(nominative)) return nominative;
  if (grade !== null && cles.includes(`grade:${grade}`)) return `grade:${grade}`;
  return null;
}

/** 0 : affecté à la mission ; 1 : seulement encadrant ; `null` : étranger à la mission. */
function rangDans(c: CandidatSocleDemo, collaborateurId: string): number | null {
  if (c.affectes.includes(collaborateurId)) return 0;
  return c.encadrants.includes(collaborateurId) ? 1 : null;
}

/** Date de fin décroissante, mission sans date de fin en dernier. */
function parDateFin(a: DateISO | null, b: DateISO | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return comparerTexteDemo(b, a);
}

interface OptionSocle {
  candidat: CandidatSocleDemo;
  rang: number;
  cle: string;
}

function parSocle(a: OptionSocle, b: OptionSocle): number {
  return (
    a.rang - b.rang ||
    parDateFin(a.candidat.dateFin, b.candidat.dateFin) ||
    b.candidat.budgetCentiemes - a.candidat.budgetCentiemes ||
    comparerTexteDemo(a.candidat.missionId, b.candidat.missionId)
  );
}

/** Mission socle d'un membre : éligible, où il est affecté (sinon encadrant) et où il a une clé. */
function socleDe(
  collaborateurId: string,
  grade: string | null,
  candidats: readonly CandidatSocleDemo[],
): OptionSocle | null {
  const options: OptionSocle[] = [];
  for (const c of candidats) {
    const rang = rangDans(c, collaborateurId);
    const cle = cleDe(collaborateurId, grade, c.clesBudget);
    if (c.eligible && rang !== null && cle !== null) options.push({ candidat: c, rang, cle });
  }
  return options.sort(parSocle)[0] ?? null;
}

function lignesDe(membres: readonly MembreAvenantDemo[]): { cle: string; centiemes: number }[] {
  const parCle = new Map<string, number>();
  for (const m of membres) parCle.set(m.cleBudget, (parCle.get(m.cleBudget) ?? 0) + m.centiemes);
  const cles = [...parCle.keys()].sort(comparerTexteDemo);
  return cles.map((cle) => ({ cle, centiemes: parCle.get(cle) as number }));
}

/**
 * Avenant d'une mission : membres par id jusqu'au plafond de 60 jours (le dernier retenu est
 * tronqué ; un membre réduit sous un jour est écarté). `null` si aucun membre n'est retenu.
 */
function composerAvenant(
  missionId: string,
  membres: readonly MembreAvenantDemo[],
  p: ParametresActiviteDemo,
): AvenantDemo | null {
  const { maximumMissionCentiemes, minimumMembreCentiemes } = p.prolongation;
  const retenus: MembreAvenantDemo[] = [];
  let total = 0;
  for (const m of membres) {
    const centiemes = Math.min(m.centiemes, maximumMissionCentiemes - total);
    if (centiemes < minimumMembreCentiemes) continue;
    retenus.push({ ...m, centiemes });
    total += centiemes;
  }
  if (retenus.length === 0) return null;
  const debuts = retenus.map((m) => m.debut).sort(comparerTexteDemo);
  const fins = retenus.map((m) => m.fin).sort(comparerTexteDemo);
  return {
    missionId,
    debut: debuts[0] as DateISO,
    fin: fins[fins.length - 1] as DateISO,
    membres: retenus,
    lignes: lignesDe(retenus),
    totalCentiemes: total,
  };
}

const parCollaborateur = (a: BesoinMembreDemo, b: BesoinMembreDemo): number =>
  comparerTexteDemo(a.collaborateurId, b.collaborateurId);

const parTotal = (a: AvenantDemo, b: AvenantDemo): number =>
  b.totalCentiemes - a.totalCentiemes || comparerTexteDemo(a.missionId, b.missionId);

/**
 * Avenants du mois : chaque membre rejoint sa mission socle, c'est-à-dire la première mission
 * éligible où il est affecté (sinon encadrant) et où existe une clé de budget pour lui
 * (`collaborateur:ID`, puis `grade:CODE`), par affecté d'abord, date de fin décroissante (sans
 * date en dernier), budget décroissant, puis id ; un membre sans clé est exclu. Au plus 60 jours
 * par mission (membres par id) et 10 avenants (total décroissant, puis id).
 */
export function choisirAvenantsDemo(
  besoins: readonly BesoinMembreDemo[],
  grades: Readonly<Record<string, string | null>>,
  candidats: readonly CandidatSocleDemo[],
  p: ParametresActiviteDemo = PARAMETRES_ACTIVITE_DEMO,
): AvenantDemo[] {
  const parMission = new Map<string, MembreAvenantDemo[]>();
  for (const b of [...besoins].sort(parCollaborateur)) {
    exigerCentiemes(b.centiemes, "Besoin d'un membre");
    const socle = socleDe(b.collaborateurId, grades[b.collaborateurId] ?? null, candidats);
    if (socle === null) continue;
    const membres = parMission.get(socle.candidat.missionId) ?? [];
    membres.push({ ...b, cleBudget: socle.cle });
    parMission.set(socle.candidat.missionId, membres);
  }
  const avenants: AvenantDemo[] = [];
  for (const [missionId, membres] of parMission) {
    const a = composerAvenant(missionId, membres, p);
    if (a !== null) avenants.push(a);
  }
  return avenants.sort(parTotal).slice(0, p.prolongation.avenantsMaxParMois);
}

/** Somme par clé, valeurs nulles retirées. */
function sommesParCle(lignes: readonly { cle: string; centiemes: number }[]): Map<string, number> {
  const parCle = new Map<string, number>();
  for (const l of lignes) {
    if (!Number.isSafeInteger(l.centiemes)) {
      throw new RangeError(`Centièmes non entiers pour « ${l.cle} » : ${l.centiemes}`);
    }
    parCle.set(l.cle, (parCle.get(l.cle) ?? 0) + l.centiemes);
  }
  for (const [cle, v] of [...parCle]) if (v === 0) parCle.delete(cle);
  return parCle;
}

/**
 * Cohérence du découpage avec le budget de référence (DT12) : mêmes clés et mêmes jours par clé
 * (lignes de même clé additionnées, clés à zéro ignorées). Un écart signale une saisie d'un
 * visiteur : la mission n'est pas prolongée, pour ne pas l'écraser.
 */
export function decoupageCoherentDemo(
  decoupage: readonly { cle: string; centiemes: number }[],
  reference: readonly { cle: string; centiemes: number }[],
): boolean {
  const a = sommesParCle(decoupage);
  const b = sommesParCle(reference);
  if (a.size !== b.size) return false;
  for (const [cle, v] of a) if (b.get(cle) !== v) return false;
  return true;
}

/** Durée en jours ouvrés d'une tâche couvrant la période, bornée à [1 ; 1000] (CHECK de `0012`). */
export function joursOuvresDemo(periode: Periode, calendrier: ParametresCalendrier): number {
  verifierPeriode(periode);
  return Math.min(1000, Math.max(1, listerJoursOuvres(periode, calendrier).length));
}

/**
 * Supplément d'honoraires réparti en parts égales sur les lundis (croissants, sans doublon), sans
 * perdre une unité mineure : le reste va à la dernière part. Vide si le supplément n'est pas
 * positif ou s'il n'y a aucun lundi.
 */
export function repartirEcheancesDemo(
  delta: Montant,
  lundis: readonly DateISO[],
): { date: DateISO; montant: Montant }[] {
  const dates = [...new Set(lundis)].sort(comparerTexteDemo);
  for (const date of dates) exigerLundiDemo(date);
  if (delta.valeur <= 0 || dates.length === 0) return [];
  const parts = repartirEgalement(delta, dates.length);
  return dates.map((date, i) => ({ date, montant: parts[i] as Montant }));
}
