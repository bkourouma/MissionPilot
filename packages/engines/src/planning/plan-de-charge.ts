/**
 * Plan de charge du cabinet : grille collaborateurs × semaines (PLN-06).
 */
import {
  type Absence,
  type Affectation,
  type AffectationPreparee,
  type EtatCharge,
  type SeuilsCharge,
  SEUILS_CHARGE_DEFAUT,
  capacite,
  etatCharge,
  joursAffectesPrepares,
  preparerAffectation,
  tauxOccupation,
} from "./capacite";
import type { ParametresCalendrier } from "./calendrier";
import {
  type DateISO,
  type Periode,
  ajouterJours,
  lundiDeLaSemaine,
  versJourUTC,
  verifierPeriode,
} from "./dates";
import { sommerJours } from "./unites";

/** Semaines ISO (lundi → dimanche) couvrant la période, de la première à la dernière. */
export function semainesCouvrant(periode: Periode): Periode[] {
  verifierPeriode(periode);
  const semaines: Periode[] = [];
  const fin = versJourUTC(periode.fin);
  for (let lundi = lundiDeLaSemaine(periode.debut); versJourUTC(lundi) <= fin;) {
    semaines.push({ debut: lundi, fin: ajouterJours(lundi, 6) });
    lundi = ajouterJours(lundi, 7);
  }
  return semaines;
}

/** Collaborateur vu par le plan de charge. */
export interface CollaborateurCharge {
  readonly id: string;
  /** Temps de travail en % (100 = temps plein). Défaut 100. */
  readonly tempsTravailPct?: number;
  /** Calendrier propre (pays du bureau) ; sinon celui du plan. */
  readonly calendrier?: ParametresCalendrier;
  readonly absences?: readonly Absence[];
}

/** Cellule de la grille. */
export interface CelluleCharge {
  readonly semaine: Periode;
  readonly capacite: number;
  readonly joursAffectes: number;
  readonly tauxOccupation: number | null;
  readonly etat: EtatCharge;
}

export interface LigneCharge {
  readonly collaborateurId: string;
  readonly cellules: readonly CelluleCharge[];
}

export interface EntreePlanDeCharge {
  readonly collaborateurs: readonly CollaborateurCharge[];
  readonly affectations: readonly Affectation[];
  readonly periode: Periode;
  readonly calendrier?: ParametresCalendrier;
  readonly seuils?: SeuilsCharge;
}

function cellule(
  c: CollaborateurCharge,
  preparees: () => readonly AffectationPreparee[],
  semaine: Periode,
  calendrier: ParametresCalendrier,
  seuils: SeuilsCharge,
): CelluleCharge {
  const cap = capacite(semaine, calendrier, c.absences ?? [], c.tempsTravailPct ?? 100);
  const affectes = sommerJours(preparees().map((p) => joursAffectesPrepares(p, semaine)));
  return {
    semaine,
    capacite: cap,
    joursAffectes: affectes,
    tauxOccupation: tauxOccupation(affectes, cap),
    etat: etatCharge(affectes, cap, seuils),
  };
}

/**
 * Construit la grille collaborateurs × semaines. Les jours ouvrés de chaque
 * affectation sont listés une fois (au premier besoin, après le contrôle de
 * la capacité, pour garder l'ordre des erreurs), puis chaque semaine se
 * calcule par différence de cumuls.
 */
export function planDeCharge(entree: EntreePlanDeCharge): LigneCharge[] {
  const semaines = semainesCouvrant(entree.periode);
  const seuils = entree.seuils ?? SEUILS_CHARGE_DEFAUT;
  const parPersonne = new Map<string, Affectation[]>();
  for (const a of entree.affectations) {
    const liste = parPersonne.get(a.personneId);
    if (liste) liste.push(a);
    else parPersonne.set(a.personneId, [a]);
  }
  return entree.collaborateurs.map((c) => {
    const calendrier = c.calendrier ?? entree.calendrier ?? {};
    const siennes = parPersonne.get(c.id) ?? [];
    let preparees: AffectationPreparee[] | undefined;
    const lesPreparees = (): AffectationPreparee[] =>
      (preparees ??= siennes.map((a) => preparerAffectation(a, calendrier)));
    return {
      collaborateurId: c.id,
      cellules: semaines.map((s) => cellule(c, lesPreparees, s, calendrier, seuils)),
    };
  });
}

/** Cellules en surcharge de la grille, pour signalement (PLN-06). */
export function surcharges(
  grille: readonly LigneCharge[],
): { collaborateurId: string; semaine: DateISO; joursAffectes: number; capacite: number }[] {
  return grille.flatMap((l) =>
    l.cellules
      .filter((c) => c.etat === "surcharge")
      .map((c) => ({
        collaborateurId: l.collaborateurId,
        semaine: c.semaine.debut,
        joursAffectes: c.joursAffectes,
        capacite: c.capacite,
      })),
  );
}
