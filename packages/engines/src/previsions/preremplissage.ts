/**
 * Pré-remplissage des temps (AUT-09) : proposition de lignes pour une semaine de
 * feuille de temps, à CONFIRMER par le consultant (rien n'est enregistré ici).
 *
 * Fonctions pures. Sources : les affectations nominatives (jours planifiés par
 * jour et par tâche, calculés par l'appelant avec les moteurs du plan de charge)
 * et l'activité du consultant sur la plateforme (commentaires, tâches faites,
 * documents déposés). Aucune source d'agenda n'existe dans le dépôt.
 *
 * RÈGLES (à valider par le métier, voir docs/DECISIONS.md)
 * - Une ligne n'est proposée que sur une tâche AFFECTÉE au consultant (comme la
 *   saisie) ; une activité sur une autre tâche est comptée, jamais proposée.
 * - Jamais sur un jour verrouillé (période clôturée) ni non travaillé
 *   (capacité nulle : week-end, férié, absence) ; jamais deux fois la même
 *   tâche le même jour (ligne déjà saisie).
 * - Le total d'un jour ne dépasse pas la capacité restante du jour (capacité −
 *   déjà saisi) : on sert d'abord les lignes confirmées par l'activité, puis les
 *   plus longues ; la part servie est arrondie vers le bas au pas de saisie.
 * - Confiance : « haute » si planifié ET activité constatée ; « moyenne » si
 *   planifié seul ; « faible » si activité seule (une demi-journée proposée sur
 *   une tâche affectée de la semaine mais non planifiée ce jour-là).
 */
import {
  arrondirAuPas,
  CENTIEMES_PAR_JOUR,
  depuisCentiemes,
  versCentiemes,
  type Granularite,
} from "../planning/unites";
import { ajouterJours, type DateISO, type Periode } from "../planning/dates";

export type SourceProposition = "affectation" | "activite" | "affectation_et_activite";
export type ConfianceProposition = "haute" | "moyenne" | "faible";
export type MotifNonPropose =
  | "jour_verrouille"
  | "jour_non_travaille"
  | "deja_saisi"
  | "capacite_atteinte"
  | "tache_non_affectee";

/** Jours planifiés (affectation) d'une tâche un jour donné. */
export interface PlanifieJour {
  readonly date: DateISO;
  readonly missionId: string;
  readonly tacheId: string;
  readonly jours: number;
}

/** Activité constatée sur la plateforme (`tacheId` nul : activité au niveau de la mission). */
export interface ActiviteJour {
  readonly date: DateISO;
  readonly missionId: string;
  readonly tacheId: string | null;
  readonly evenements: number;
}

/** Ligne déjà présente dans la feuille (hors absences), tâche ou activité interne. */
export interface SaisieExistante {
  readonly date: DateISO;
  readonly tacheId: string | null;
  readonly jours: number;
}

export interface EntreePreRemplissage {
  readonly semaine: Periode;
  readonly granularite: Granularite;
  readonly heuresParJour: number;
  readonly planifie: readonly PlanifieJour[];
  readonly activite: readonly ActiviteJour[];
  /** Tâches affectées au consultant sur la semaine (au moins un jour planifié ou affectation couvrant la semaine). */
  readonly tachesAffectees: readonly { missionId: string; tacheId: string }[];
  readonly saisies: readonly SaisieExistante[];
  /** Capacité du jour en jours, par date (absente ou nulle : jour non travaillé). */
  readonly capaciteParJour: Readonly<Record<string, number>>;
  readonly joursVerrouilles: readonly DateISO[];
}

export interface PropositionTemps {
  readonly date: DateISO;
  readonly missionId: string;
  readonly tacheId: string;
  readonly jours: number;
  readonly source: SourceProposition;
  readonly confiance: ConfianceProposition;
  readonly raisons: readonly string[];
}

export interface PropositionEcartee {
  readonly date: DateISO;
  readonly missionId: string | null;
  readonly tacheId: string | null;
  readonly jours: number;
  readonly motif: MotifNonPropose;
}

export interface ResultatPreRemplissage {
  readonly propositions: readonly PropositionTemps[];
  readonly ecartees: readonly PropositionEcartee[];
  readonly totalJours: number;
}

interface Candidat {
  date: DateISO;
  missionId: string;
  tacheId: string;
  /** Centièmes demandés. */
  demande: number;
  planifie: boolean;
  activite: boolean;
}

/** Pas de saisie en centièmes de jour. */
function pasCentiemes(granularite: Granularite): number {
  return granularite === "demi_journee" ? CENTIEMES_PAR_JOUR / 2 : 1;
}

/** Les 7 jours de la semaine, du lundi au dimanche. */
function joursDe(semaine: Periode): DateISO[] {
  return Array.from({ length: 7 }, (_, i) => ajouterJours(semaine.debut, i));
}

/** Propose des lignes de temps pour la semaine (voir les règles en tête de fichier). */
export function proposerSaisieSemaine(entree: EntreePreRemplissage): ResultatPreRemplissage {
  const pas = pasCentiemes(entree.granularite);
  const demiJournee = versCentiemes(arrondirAuPas(0.5, entree.granularite, entree.heuresParJour));
  const verrouilles = new Set(entree.joursVerrouilles);
  const affectees = new Map(entree.tachesAffectees.map((t) => [t.tacheId, t.missionId]));
  const tachesDeMission = new Map<string, string[]>();
  for (const t of entree.tachesAffectees) {
    const liste = tachesDeMission.get(t.missionId) ?? [];
    liste.push(t.tacheId);
    tachesDeMission.set(t.missionId, liste);
  }
  for (const liste of tachesDeMission.values()) liste.sort();

  const propositions: PropositionTemps[] = [];
  const ecartees: PropositionEcartee[] = [];

  for (const date of joursDe(entree.semaine)) {
    const capaciteJour = versCentiemes(entree.capaciteParJour[date] ?? 0);
    const saisiesDuJour = entree.saisies.filter((s) => s.date === date);
    const dejaSaisi = saisiesDuJour.reduce((t, s) => t + versCentiemes(s.jours), 0);
    const tachesSaisies = new Set(saisiesDuJour.flatMap((s) => (s.tacheId ? [s.tacheId] : [])));

    // Candidats du jour : planifié d'abord, puis activité.
    const candidats = new Map<string, Candidat>();
    for (const p of entree.planifie.filter((x) => x.date === date)) {
      const demande = versCentiemes(p.jours);
      if (demande <= 0) continue;
      const existant = candidats.get(p.tacheId);
      if (existant) existant.demande += demande;
      else
        candidats.set(p.tacheId, {
          date,
          missionId: p.missionId,
          tacheId: p.tacheId,
          demande,
          planifie: true,
          activite: false,
        });
    }
    const hors: PropositionEcartee[] = [];
    for (const a of entree.activite.filter((x) => x.date === date && x.evenements > 0)) {
      const cible =
        a.tacheId ??
        // Activité de mission : on la rattache à la première tâche affectée de la mission
        // qui est déjà planifiée ce jour-là, sinon à la première tâche affectée.
        (tachesDeMission.get(a.missionId) ?? []).find((t) => candidats.has(t)) ??
        (tachesDeMission.get(a.missionId) ?? [])[0] ??
        null;
      if (cible === null || !affectees.has(cible)) {
        hors.push({
          date,
          missionId: a.missionId,
          tacheId: a.tacheId,
          jours: 0,
          motif: "tache_non_affectee",
        });
        continue;
      }
      const existant = candidats.get(cible);
      if (existant) existant.activite = true;
      else
        candidats.set(cible, {
          date,
          missionId: affectees.get(cible) as string,
          tacheId: cible,
          demande: demiJournee,
          planifie: false,
          activite: true,
        });
    }
    ecartees.push(...hors);

    const liste = [...candidats.values()];
    if (liste.length === 0) continue;

    const ecarter = (c: Candidat, motif: MotifNonPropose) =>
      ecartees.push({
        date,
        missionId: c.missionId,
        tacheId: c.tacheId,
        jours: depuisCentiemes(c.demande),
        motif,
      });

    if (verrouilles.has(date)) {
      liste.forEach((c) => ecarter(c, "jour_verrouille"));
      continue;
    }
    if (capaciteJour <= 0) {
      liste.forEach((c) => ecarter(c, "jour_non_travaille"));
      continue;
    }

    // Priorité : confirmé par l'activité, plus long, puis identifiant.
    liste.sort(
      (x, y) =>
        Number(y.planifie && y.activite) - Number(x.planifie && x.activite) ||
        y.demande - x.demande ||
        x.tacheId.localeCompare(y.tacheId),
    );
    let restant = Math.max(0, capaciteJour - dejaSaisi);
    for (const c of liste) {
      if (tachesSaisies.has(c.tacheId)) {
        ecarter(c, "deja_saisi");
        continue;
      }
      const accorde = Math.floor(Math.min(c.demande, restant) / pas) * pas;
      if (accorde <= 0) {
        ecarter(c, "capacite_atteinte");
        continue;
      }
      restant -= accorde;
      const source: SourceProposition =
        c.planifie && c.activite
          ? "affectation_et_activite"
          : c.planifie
            ? "affectation"
            : "activite";
      const raisons: string[] = [];
      if (c.planifie) raisons.push("Jours planifiés dans votre affectation.");
      if (c.activite) raisons.push("Activité constatée sur la plateforme ce jour-là.");
      if (accorde < c.demande) raisons.push("Réduit pour respecter la capacité du jour.");
      propositions.push({
        date,
        missionId: c.missionId,
        tacheId: c.tacheId,
        jours: depuisCentiemes(accorde),
        source,
        confiance: c.planifie && c.activite ? "haute" : c.planifie ? "moyenne" : "faible",
        raisons,
      });
    }
  }

  propositions.sort((x, y) => x.date.localeCompare(y.date) || x.tacheId.localeCompare(y.tacheId));
  return {
    propositions,
    ecartees,
    totalJours: depuisCentiemes(propositions.reduce((t, p) => t + versCentiemes(p.jours), 0)),
  };
}
