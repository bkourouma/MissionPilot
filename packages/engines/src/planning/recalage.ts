/**
 * Recalage de planning (PLN-03, PLN-09) : dépendances fin → début avec
 * décalage, dates au plus tôt en jours ouvrés, décalage d'une phase.
 *
 * Règle : une tâche démarre au plus tôt à la plus tardive de (sa date de début
 * souhaitée, lendemain ouvré de la fin de chaque prédécesseur + décalage). Le
 * recalage pousse les successeurs vers l'avant mais ne les avance jamais.
 */
import { type ParametresCalendrier, ajouterJoursOuvres } from "./calendrier";
import { type DateISO, versJourUTC } from "./dates";

/** Tâche planifiée ; la durée est en jours ouvrés (≥ 1). */
export interface TachePlanifiee {
  readonly id: string;
  readonly debut: DateISO;
  readonly dureeJoursOuvres: number;
  readonly phaseId?: string;
}

/** Dépendance fin → début ; `decalage` en jours ouvrés (négatif = chevauchement). */
export interface Dependance {
  readonly predecesseur: string;
  readonly successeur: string;
  readonly decalage?: number;
}

export interface DatesTache {
  readonly debut: DateISO;
  readonly fin: DateISO;
}

/** Erreur levée quand les dépendances forment un cycle. */
export class CycleDependancesError extends Error {
  constructor(readonly tachesEnCycle: readonly string[]) {
    super(`Cycle de dépendances entre les tâches : ${tachesEnCycle.join(", ")}`);
    this.name = "CycleDependancesError";
  }
}

function indexer(taches: readonly TachePlanifiee[]): Map<string, TachePlanifiee> {
  const index = new Map<string, TachePlanifiee>();
  for (const t of taches) {
    if (index.has(t.id)) throw new RangeError(`Tâche en double : « ${t.id} »`);
    if (!Number.isInteger(t.dureeJoursOuvres) || t.dureeJoursOuvres < 1) {
      throw new RangeError(`Durée invalide pour « ${t.id} » : ${t.dureeJoursOuvres}`);
    }
    index.set(t.id, t);
  }
  return index;
}

/** Tri topologique (Kahn) ; lève `CycleDependancesError` si un cycle existe. */
export function ordonnerTaches(
  taches: readonly TachePlanifiee[],
  dependances: readonly Dependance[],
): string[] {
  const index = indexer(taches);
  const entrants = new Map<string, number>([...index.keys()].map((id) => [id, 0]));
  for (const d of dependances) {
    for (const id of [d.predecesseur, d.successeur]) {
      if (!index.has(id)) throw new RangeError(`Dépendance vers une tâche inconnue : « ${id} »`);
    }
    entrants.set(d.successeur, Number(entrants.get(d.successeur)) + 1);
  }
  const prets = [...index.keys()].filter((id) => entrants.get(id) === 0);
  const ordre: string[] = [];
  while (prets.length > 0) {
    const id = prets.shift() as string;
    ordre.push(id);
    for (const d of dependances.filter((x) => x.predecesseur === id)) {
      const reste = Number(entrants.get(d.successeur)) - 1;
      entrants.set(d.successeur, reste);
      if (reste === 0) prets.push(d.successeur);
    }
  }
  if (ordre.length < index.size) {
    throw new CycleDependancesError([...index.keys()].filter((id) => !ordre.includes(id)));
  }
  return ordre;
}

function plusTardive(a: DateISO, b: DateISO): DateISO {
  return versJourUTC(a) >= versJourUTC(b) ? a : b;
}

/** Dates au plus tôt de chaque tâche, en jours ouvrés. */
export function calculerDatesAuPlusTot(
  taches: readonly TachePlanifiee[],
  dependances: readonly Dependance[],
  calendrier: ParametresCalendrier = {},
): Map<string, DatesTache> {
  const ordre = ordonnerTaches(taches, dependances);
  const index = indexer(taches);
  const dates = new Map<string, DatesTache>();
  for (const id of ordre) {
    const t = index.get(id) as TachePlanifiee;
    let debut = ajouterJoursOuvres(t.debut, 0, calendrier);
    for (const d of dependances.filter((x) => x.successeur === id)) {
      const finPred = (dates.get(d.predecesseur) as DatesTache).fin;
      debut = plusTardive(debut, ajouterJoursOuvres(finPred, 1 + (d.decalage ?? 0), calendrier));
    }
    const fin = ajouterJoursOuvres(debut, t.dureeJoursOuvres - 1, calendrier);
    dates.set(id, { debut, fin });
  }
  return dates;
}

/** Changement de dates d'une tâche après recalage. */
export interface TacheDecalee {
  readonly id: string;
  readonly avant: DatesTache;
  readonly apres: DatesTache;
}

export interface ResultatDecalage<A> {
  readonly dates: Map<string, DatesTache>;
  readonly tachesDecalees: readonly TacheDecalee[];
  /** Affectations des tâches décalées : personnes à prévenir (PLN-09). */
  readonly affectationsImpactees: readonly A[];
}

export interface EntreeDecalagePhase<A extends { readonly tacheId: string }> {
  readonly taches: readonly TachePlanifiee[];
  readonly dependances: readonly Dependance[];
  readonly phaseId: string;
  /** Décalage en jours ouvrés (négatif = avancer la phase). */
  readonly decalageJoursOuvres: number;
  readonly affectations: readonly A[];
  readonly calendrier?: ParametresCalendrier;
}

/**
 * Décale toutes les tâches d'une phase de N jours ouvrés, recale les tâches
 * dépendantes et renvoie les tâches dont les dates changent ainsi que les
 * affectations impactées.
 */
export function decalerPhase<A extends { readonly tacheId: string }>(
  entree: EntreeDecalagePhase<A>,
): ResultatDecalage<A> {
  const cal = entree.calendrier ?? {};
  const avant = calculerDatesAuPlusTot(entree.taches, entree.dependances, cal);
  const decalees = entree.taches.map((t) =>
    t.phaseId === entree.phaseId
      ? {
          ...t,
          debut: ajouterJoursOuvres(
            (avant.get(t.id) as DatesTache).debut,
            entree.decalageJoursOuvres,
            cal,
          ),
        }
      : { ...t, debut: (avant.get(t.id) as DatesTache).debut },
  );
  const apres = calculerDatesAuPlusTot(decalees, entree.dependances, cal);
  const tachesDecalees = entree.taches
    .map((t) => ({
      id: t.id,
      avant: avant.get(t.id) as DatesTache,
      apres: apres.get(t.id) as DatesTache,
    }))
    .filter((c) => c.avant.debut !== c.apres.debut || c.avant.fin !== c.apres.fin);
  const ids = new Set(tachesDecalees.map((c) => c.id));
  return {
    dates: apres,
    tachesDecalees,
    affectationsImpactees: entree.affectations.filter((a) => ids.has(a.tacheId)),
  };
}
