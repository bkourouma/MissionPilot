/**
 * Plan de charge du cabinet : grille collaborateurs × semaines (PLN-06).
 */
import {
  type Absence,
  type Affectation,
  type EtatCharge,
  type SeuilsCharge,
  SEUILS_CHARGE_DEFAUT,
  capacite,
  etatCharge,
  joursAffectesSurPeriode,
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
  affectations: readonly Affectation[],
  semaine: Periode,
  calendrier: ParametresCalendrier,
  seuils: SeuilsCharge,
): CelluleCharge {
  const cap = capacite(semaine, calendrier, c.absences ?? [], c.tempsTravailPct ?? 100);
  const affectes = sommerJours(
    affectations.map((a) => joursAffectesSurPeriode(a, semaine, calendrier)),
  );
  return {
    semaine,
    capacite: cap,
    joursAffectes: affectes,
    tauxOccupation: tauxOccupation(affectes, cap),
    etat: etatCharge(affectes, cap, seuils),
  };
}

/** Construit la grille collaborateurs × semaines. */
export function planDeCharge(entree: EntreePlanDeCharge): LigneCharge[] {
  const semaines = semainesCouvrant(entree.periode);
  const seuils = entree.seuils ?? SEUILS_CHARGE_DEFAUT;
  return entree.collaborateurs.map((c) => {
    const calendrier = c.calendrier ?? entree.calendrier ?? {};
    const siennes = entree.affectations.filter((a) => a.personneId === c.id);
    return {
      collaborateurId: c.id,
      cellules: semaines.map((s) => cellule(c, siennes, s, calendrier, seuils)),
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
