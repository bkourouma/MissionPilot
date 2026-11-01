/**
 * Feuille de temps de démonstration d'un collaborateur pour une semaine (D4, D5, DT5, DT7) : une
 * ligne par jour ouvré et par tâche (ou activité interne), part mission plafonnée par les jours
 * affectés et par 80 % de la capacité, reste du jour en activité interne, et redéclarations « pour
 * soi » du reste à faire. Calcul pur en centièmes entiers au pas de 50 ; le résultat ne dépend pas
 * de l'ordre des entrées (tris totaux, aucune horloge, aucun hasard).
 */
import { type ParametresCalendrier, listerJoursOuvres } from "../planning/calendrier";
import {
  type Absence,
  type Affectation,
  capacite,
  joursAffectesSurPeriode,
} from "../planning/capacite";
import { type DateISO, type Periode, ajouterJours } from "../planning/dates";
import { estDateSaisieModifiable } from "../planning/discipline";
import { versCentiemes } from "../planning/unites";
import {
  PARAMETRES_ACTIVITE_DEMO,
  type ParametresActiviteDemo,
  comparerTexteDemo,
  exigerCentiemes,
  exigerLundiDemo,
  plancherPas,
} from "./parametres";

/** Suivi d'une tâche au début de la semaine, plus le temps que le job y a déjà planifié. */
export interface TacheCapaciteDemo {
  tacheId: string;
  missionId: string;
  /** Budget de la tâche (`tache_budget_lignes`). */
  budgetCentiemes: number;
  /** Réalisé des feuilles validées ou verrouillées. */
  realiseCentiemes: number;
  /** Temps soumis, pas encore validés. */
  attenteCentiemes: number;
  /** Dernière déclaration de reste à faire de chaque collaborateur ; vide : tâche estimée. */
  declarations: Readonly<Record<string, number>>;
  /** Temps planifié par le job cette semaine, tous collaborateurs confondus. */
  planifieCentiemes: number;
  planifieParCollaborateur: Readonly<Record<string, number>>;
  /** Tâche de la mission maintenue en dérive (DT6) : le budget seul la borne. */
  missionEnDerive: boolean;
}

export interface AffectationSemaineDemo extends Affectation {
  missionId: string;
}

/** Ce qui borne la capacité saisissable d'un collaborateur, jour par jour. */
export interface DisponibiliteDemo {
  calendrier: ParametresCalendrier;
  moisClotures: readonly string[];
  absences: readonly Absence[];
  capacitePct: number;
}

export interface EntreeFeuilleDemo extends DisponibiliteDemo {
  /** Lundi de la semaine. */
  lundi: DateISO;
  collaborateurId: string;
  /** Affectations du collaborateur (celles d'un autre sont ignorées). */
  affectations: readonly AffectationSemaineDemo[];
  taches: ReadonlyMap<string, TacheCapaciteDemo>;
  /** Activité interne qui reçoit le reste du jour ; `null` : jours laissés incomplets. */
  activiteInterneId: string | null;
}

export interface LigneFeuilleDemo {
  date: DateISO;
  tacheId: string | null;
  missionId: string | null;
  activiteId: string | null;
  centiemes: number;
}

/** Quantité en centièmes rattachée à une tâche (consommation ou redéclaration). */
export interface QuantiteTacheDemo {
  tacheId: string;
  missionId: string;
  centiemes: number;
}

export interface PlanFeuilleDemo {
  lignes: LigneFeuilleDemo[];
  /** Centièmes planifiés par tâche, triés par tâche. */
  consommations: QuantiteTacheDemo[];
  /** Nouveau reste à faire « pour soi » des tâches déclarées, hors mission en dérive. */
  redeclarations: QuantiteTacheDemo[];
  motif: "ok" | "aucun_jour" | "capacite_nulle";
}

/** Capacité saisissable d'un jour, en centièmes. */
export interface CapaciteJourDemo {
  date: DateISO;
  centiemes: number;
}

function verifierTache(t: TacheCapaciteDemo): void {
  exigerCentiemes(t.budgetCentiemes, "Budget de tâche");
  exigerCentiemes(t.realiseCentiemes, "Réalisé de tâche");
  exigerCentiemes(t.attenteCentiemes, "Temps en attente");
  exigerCentiemes(t.planifieCentiemes, "Temps planifié");
  for (const v of Object.values(t.planifieParCollaborateur)) exigerCentiemes(v, "Temps planifié");
  for (const v of Object.values(t.declarations)) exigerCentiemes(v, "Reste à faire déclaré");
}

/**
 * Capacité restante d'une tâche pour un collaborateur (DT5), en centièmes :
 * - libre = max(0, budget − réalisé − attente − déjà planifié cette semaine) ;
 * - mission en dérive, ou tâche sans aucune déclaration : libre ;
 * - le collaborateur a déclaré d : min(libre, d − ce qu'il a déjà planifié) ;
 * - un autre a déclaré, pas lui : 0 (on ne consomme pas le reste à faire d'autrui).
 */
export function capaciteRestanteTacheDemo(t: TacheCapaciteDemo, collaborateurId: string): number {
  verifierTache(t);
  const consomme = t.realiseCentiemes + t.attenteCentiemes + t.planifieCentiemes;
  const libre = Math.max(0, t.budgetCentiemes - consomme);
  if (t.missionEnDerive || Object.keys(t.declarations).length === 0) return libre;
  const declaree = t.declarations[collaborateurId];
  if (declaree === undefined) return 0;
  const deja = t.planifieParCollaborateur[collaborateurId] ?? 0;
  return Math.min(libre, Math.max(0, declaree - deja));
}

/**
 * Jours ouvrés de la période hors mois clôturés, avec leur capacité saisissable (éventuellement
 * nulle) : capacité du calendrier (fériés, absences, temps de travail) arrondie au pas inférieur,
 * au plus une journée. Partagée par la feuille et par le besoin de l'avenant (prolongation.ts).
 */
export function capacitesJoursDemo(
  periode: Periode,
  d: DisponibiliteDemo,
  p: ParametresActiviteDemo = PARAMETRES_ACTIVITE_DEMO,
): CapaciteJourDemo[] {
  return listerJoursOuvres(periode, d.calendrier)
    .filter((date) => estDateSaisieModifiable(date, { moisClotures: d.moisClotures }))
    .map((date) => {
      const jours = capacite({ debut: date, fin: date }, d.calendrier, d.absences, d.capacitePct);
      const centiemes = plancherPas(versCentiemes(jours), p.pasCentiemes);
      return { date, centiemes: Math.min(p.ligneMaxCentiemes, centiemes) };
    });
}

/** Ajoute `n` centièmes planifiés par le collaborateur `c` sur la tâche. */
function avecPlanifie(t: TacheCapaciteDemo, c: string, n: number): TacheCapaciteDemo {
  const deja = t.planifieParCollaborateur[c] ?? 0;
  return {
    ...t,
    planifieCentiemes: t.planifieCentiemes + n,
    planifieParCollaborateur: { ...t.planifieParCollaborateur, [c]: deja + n },
  };
}

const affectationsDe = (e: EntreeFeuilleDemo): AffectationSemaineDemo[] =>
  e.affectations.filter((a) => a.personneId === e.collaborateurId);

/** Quota mission de la semaine : min(jours affectés, 80 % de la capacité), au pas inférieur. */
function quotaMission(
  e: EntreeFeuilleDemo,
  semaine: Periode,
  capaciteTotale: number,
  p: ParametresActiviteDemo,
): number {
  let affectes = 0;
  for (const a of affectationsDe(e)) {
    affectes += versCentiemes(joursAffectesSurPeriode(a, semaine, e.calendrier));
  }
  const plafond = Math.floor((capaciteTotale * p.tauxMissionPct) / 100);
  return plancherPas(Math.min(affectes, plafond), p.pasCentiemes);
}

/** Remplissage en cours : tâches (avec le temps déjà planifié), quota restant, consommations. */
interface EtatFeuille {
  taches: Map<string, TacheCapaciteDemo>;
  quota: number;
  consommations: Map<string, QuantiteTacheDemo>;
}

interface CandidateJour {
  tache: TacheCapaciteDemo;
  cap: number;
}

const parCapacite = (a: CandidateJour, b: CandidateJour): number =>
  b.cap - a.cap || comparerTexteDemo(a.tache.tacheId, b.tache.tacheId);

/** Tâches affectées le jour, à capacité positive au pas, par capacité décroissante puis par id. */
function tachesDuJour(
  date: DateISO,
  e: EntreeFeuilleDemo,
  etat: EtatFeuille,
  p: ParametresActiviteDemo,
): CandidateJour[] {
  const ids = new Set<string>();
  for (const a of affectationsDe(e)) if (a.debut <= date && date <= a.fin) ids.add(a.tacheId);
  const candidates: CandidateJour[] = [];
  for (const id of ids) {
    const tache = etat.taches.get(id);
    if (tache === undefined) continue;
    const cap = plancherPas(capaciteRestanteTacheDemo(tache, e.collaborateurId), p.pasCentiemes);
    if (cap > 0) candidates.push({ tache, cap });
  }
  return candidates.sort(parCapacite);
}

const tacheDe = (t: TacheCapaciteDemo) => ({ tacheId: t.tacheId, missionId: t.missionId });

const parTache = (a: QuantiteTacheDemo, b: QuantiteTacheDemo): number =>
  comparerTexteDemo(a.tacheId, b.tacheId);

/** Planifie `n` centièmes du collaborateur `c` sur la tâche : temps planifié, quota, consommation. */
function planifier(etat: EtatFeuille, t: TacheCapaciteDemo, c: string, n: number): void {
  etat.taches.set(t.tacheId, avecPlanifie(t, c, n));
  etat.quota -= n;
  const total = (etat.consommations.get(t.tacheId)?.centiemes ?? 0) + n;
  etat.consommations.set(t.tacheId, { ...tacheDe(t), centiemes: total });
}

/** Lignes d'un jour : au plus deux tâches, puis le reste du jour en activité interne. */
function remplirJour(
  jour: CapaciteJourDemo,
  e: EntreeFeuilleDemo,
  etat: EtatFeuille,
  p: ParametresActiviteDemo,
): LigneFeuilleDemo[] {
  const lignes: LigneFeuilleDemo[] = [];
  let reste = jour.centiemes;
  const candidates = tachesDuJour(jour.date, e, etat, p).slice(0, p.tachesMaxParJour);
  for (const { tache, cap } of candidates) {
    const n = plancherPas(Math.min(reste, cap, etat.quota), p.pasCentiemes);
    if (n === 0) break;
    lignes.push({ date: jour.date, ...tacheDe(tache), activiteId: null, centiemes: n });
    planifier(etat, tache, e.collaborateurId, n);
    reste -= n;
  }
  if (reste > 0 && e.activiteInterneId !== null) {
    const interne = { tacheId: null, missionId: null, activiteId: e.activiteInterneId };
    lignes.push({ date: jour.date, ...interne, centiemes: reste });
  }
  return lignes;
}

/** Reste à faire « pour soi » après la semaine : d − déjà planifié − consommé, au pas inférieur. */
function redeclarationsDe(
  e: EntreeFeuilleDemo,
  consommations: readonly QuantiteTacheDemo[],
  p: ParametresActiviteDemo,
): QuantiteTacheDemo[] {
  const resultat: QuantiteTacheDemo[] = [];
  for (const c of consommations) {
    const t = e.taches.get(c.tacheId) as TacheCapaciteDemo;
    const declaree = t.declarations[e.collaborateurId];
    if (t.missionEnDerive || declaree === undefined) continue;
    const deja = t.planifieParCollaborateur[e.collaborateurId] ?? 0;
    const reste = Math.max(0, declaree - deja - c.centiemes);
    resultat.push({ ...c, centiemes: plancherPas(reste, p.pasCentiemes) });
  }
  return resultat;
}

const planVide = (motif: PlanFeuilleDemo["motif"]): PlanFeuilleDemo => ({
  lignes: [],
  consommations: [],
  redeclarations: [],
  motif,
});

/**
 * Feuille complète de la semaine de `e.lundi` (DT7) :
 * - jours : jours ouvrés de la semaine, hors mois clôturés (sinon `aucun_jour`) et hors jours de
 *   capacité nulle (tous nuls : `capacite_nulle`) ;
 * - quota mission : min(Σ jours affectés de la semaine, 80 % de Σ capacités), au pas inférieur ;
 * - chaque jour, au plus deux tâches affectées ce jour-là, par capacité restante décroissante puis
 *   par id, chaque ligne valant min(reste du jour, capacité, quota restant) au pas inférieur ; le
 *   reste du jour va sur l'activité interne si elle existe ;
 * - redéclarations : tâches hors dérive où le collaborateur a une déclaration et a consommé.
 */
export function planifierFeuilleDemo(
  e: EntreeFeuilleDemo,
  p: ParametresActiviteDemo = PARAMETRES_ACTIVITE_DEMO,
): PlanFeuilleDemo {
  exigerLundiDemo(e.lundi);
  const semaine: Periode = { debut: e.lundi, fin: ajouterJours(e.lundi, 6) };
  const jours = capacitesJoursDemo(semaine, e, p);
  if (jours.length === 0) return planVide("aucun_jour");
  const utiles = jours.filter((j) => j.centiemes > 0);
  if (utiles.length === 0) return planVide("capacite_nulle");
  const capaciteTotale = utiles.reduce((total, j) => total + j.centiemes, 0);
  const etat: EtatFeuille = {
    taches: new Map(e.taches),
    quota: quotaMission(e, semaine, capaciteTotale, p),
    consommations: new Map(),
  };
  const lignes = utiles.flatMap((j) => remplirJour(j, e, etat, p));
  const consommations = [...etat.consommations.values()].sort(parTache);
  const redeclarations = redeclarationsDe(e, consommations, p);
  return { lignes, consommations, redeclarations, motif: "ok" };
}

/**
 * Reporte le plan d'un collaborateur sur les tâches : le temps planifié cette semaine s'ajoute,
 * pour que la feuille du collaborateur suivant ne consomme pas deux fois le même budget. Les
 * déclarations restent celles du début de semaine (la redéclaration est une écriture de l'appelant).
 */
export function appliquerPlanFeuilleDemo(
  t: ReadonlyMap<string, TacheCapaciteDemo>,
  collaborateurId: string,
  plan: PlanFeuilleDemo,
): Map<string, TacheCapaciteDemo> {
  const resultat = new Map(t);
  for (const c of plan.consommations) {
    const tache = resultat.get(c.tacheId);
    if (tache === undefined) throw new RangeError(`Tâche absente du suivi : ${c.tacheId}`);
    resultat.set(c.tacheId, avecPlanifie(tache, collaborateurId, c.centiemes));
  }
  return resultat;
}
