/**
 * Priorisation du portefeuille d'initiatives (PLA-14) : score et
 * optimisation sous contraintes, fonctions pures et déterministes.
 *
 * Score (0 à 100, entier) : valeur, effort et risque notés de 1 à 5 par le
 * consultant, pondérés (0 à 10 chacun, 5 / 3 / 2 par défaut) ; une valeur
 * haute, un effort et un risque bas rapprochent de 100 :
 *   score = 100 × (pV(valeur − 1) + pE(5 − effort) + pR(5 − risque)) / (4 (pV + pE + pR)).
 *
 * Optimisation : choisir l'ensemble d'initiatives de score total maximal
 * dont le coût total tient dans le budget et la charge totale (jours-homme)
 * dans la capacité, avec :
 * - les initiatives OBLIGATOIRES retenues d'office, avec leurs prérequis ;
 * - les initiatives EXCLUES écartées, avec celles qui en dépendent ;
 * - une initiative retenue entraîne ses prérequis (dépendances « fin →
 *   début » vers d'autres candidates ; une dépendance hors portefeuille est
 *   ignorée) ;
 * - une initiative de score nul n'est retenue que comme prérequis.
 * Recherche exacte par séparation et évaluation (bornes par relaxation
 * fractionnaire), ordre fixe (score décroissant, coût croissant,
 * identifiant) : à égalité de score total, la première solution trouvée
 * reste. Au-delà de `noeudsMax` nœuds explorés, la meilleure solution trouvée
 * est rendue avec `optimal: false`. Le moteur PROPOSE : l'arbitrage reste
 * humain et tracé par l'API.
 */
import { pourcentageEntier } from "./cascade";
import { ErreurPlan } from "./erreurs";

export const NOTE_PORTEFEUILLE = { min: 1, max: 5 } as const;
export const POIDS_PORTEFEUILLE_MAX = 10;
export const CANDIDATS_PORTEFEUILLE_MAX = 300;
export const NOEUDS_PORTEFEUILLE_MAX = 100_000;

export interface PoidsPortefeuille {
  readonly valeur: number;
  readonly effort: number;
  readonly risque: number;
}

/** Pondération par défaut (à calibrer au pilote). */
export const POIDS_PORTEFEUILLE_DEFAUT: PoidsPortefeuille = { valeur: 5, effort: 3, risque: 2 };

export interface CandidatPortefeuille {
  readonly id: string;
  readonly valeur: number;
  readonly effort: number;
  readonly risque: number;
  /** Coût (budget de l'initiative), entier d'unités mineures ≥ 0. */
  readonly cout: number;
  /** Charge en jours-homme, entier ≥ 0. */
  readonly charge: number;
  readonly obligatoire?: boolean;
  readonly exclue?: boolean;
  readonly dependances?: readonly string[];
}

export interface ContraintesPortefeuille {
  /** Budget maximal (unités mineures) ; null : sans limite. */
  readonly budgetMax: number | null;
  /** Capacité maximale en jours-homme ; null : sans limite. */
  readonly capaciteMax: number | null;
  readonly poids?: PoidsPortefeuille;
}

export type MotifPortefeuille =
  "obligatoire" | "optimisation" | "exclue" | "depend_d_une_exclue" | "contraintes" | "score_nul";

export interface DecisionCandidat {
  readonly id: string;
  readonly score: number;
  readonly retenue: boolean;
  readonly motif: MotifPortefeuille;
}

export interface PropositionPortefeuille {
  readonly decisions: readonly DecisionCandidat[];
  readonly retenues: readonly string[];
  readonly totaux: { readonly score: number; readonly cout: number; readonly charge: number };
  /** Faux : les obligatoires (et leurs prérequis) dépassent une contrainte ou dépendent d'une exclue. */
  readonly realisable: boolean;
  readonly optimal: boolean;
  readonly noeudsExplores: number;
  readonly poids: PoidsPortefeuille;
}

const estNote = (n: number) =>
  Number.isInteger(n) && n >= NOTE_PORTEFEUILLE.min && n <= NOTE_PORTEFEUILLE.max;
const estEntierPositif = (n: number) => Number.isSafeInteger(n) && n >= 0;

function controlerPoids(p: PoidsPortefeuille): void {
  for (const cle of ["valeur", "effort", "risque"] as const) {
    const v = p[cle];
    if (!Number.isInteger(v) || v < 0 || v > POIDS_PORTEFEUILLE_MAX) {
      throw new ErreurPlan("PORTEFEUILLE_INVALIDE", "Poids entre 0 et 10.", `poids.${cle}`);
    }
  }
  if (p.valeur + p.effort + p.risque === 0) {
    throw new ErreurPlan("PORTEFEUILLE_INVALIDE", "Au moins un poids non nul.", "poids");
  }
}

/** Score de priorité (0 à 100) d'une initiative notée de 1 à 5. */
export function scorerInitiative(
  c: Pick<CandidatPortefeuille, "valeur" | "effort" | "risque">,
  poids: PoidsPortefeuille = POIDS_PORTEFEUILLE_DEFAUT,
): number {
  controlerPoids(poids);
  if (!estNote(c.valeur) || !estNote(c.effort) || !estNote(c.risque)) {
    throw new ErreurPlan("PORTEFEUILLE_INVALIDE", "Notes de 1 à 5.", "notes");
  }
  const points =
    poids.valeur * (c.valeur - 1) + poids.effort * (5 - c.effort) + poids.risque * (5 - c.risque);
  return pourcentageEntier(points, 4 * (poids.valeur + poids.effort + poids.risque));
}

function controlerEntrees(
  candidats: readonly CandidatPortefeuille[],
  contraintes: ContraintesPortefeuille,
): void {
  if (candidats.length > CANDIDATS_PORTEFEUILLE_MAX) {
    throw new ErreurPlan("PORTEFEUILLE_INVALIDE", "Trop d'initiatives candidates.", "candidats");
  }
  const vus = new Set<string>();
  candidats.forEach((c, i) => {
    if (vus.has(c.id)) {
      throw new ErreurPlan("PORTEFEUILLE_INVALIDE", "Initiative en double.", `candidats[${i}]`);
    }
    vus.add(c.id);
    if (!estEntierPositif(c.cout) || !estEntierPositif(c.charge)) {
      throw new ErreurPlan(
        "PORTEFEUILLE_INVALIDE",
        "Coût et charge : entiers positifs.",
        `candidats[${i}]`,
      );
    }
  });
  for (const cle of ["budgetMax", "capaciteMax"] as const) {
    const v = contraintes[cle];
    if (v !== null && !estEntierPositif(v)) {
      throw new ErreurPlan("PORTEFEUILLE_INVALIDE", "Contrainte : entier positif.", cle);
    }
  }
}

/** Fermeture transitive selon `liens` (identifiant inclus). */
function fermeture(depart: string, liens: ReadonlyMap<string, readonly string[]>): Set<string> {
  const vus = new Set<string>([depart]);
  const pile = [depart];
  while (pile.length) {
    for (const s of liens.get(pile.pop() as string) ?? []) {
      if (!vus.has(s)) {
        vus.add(s);
        pile.push(s);
      }
    }
  }
  return vus;
}

interface Graphe {
  prerequis: Map<string, Set<string>>;
  dependants: Map<string, Set<string>>;
}

function graphe(candidats: readonly CandidatPortefeuille[]): Graphe {
  const ids = new Set(candidats.map((c) => c.id));
  const amont = new Map<string, string[]>();
  const aval = new Map<string, string[]>(candidats.map((c) => [c.id, []]));
  for (const c of candidats) {
    const deps = (c.dependances ?? []).filter((d) => ids.has(d) && d !== c.id);
    amont.set(c.id, deps);
    for (const d of deps) aval.get(d)?.push(c.id);
  }
  return {
    prerequis: new Map(candidats.map((c) => [c.id, fermeture(c.id, amont)])),
    dependants: new Map(candidats.map((c) => [c.id, fermeture(c.id, aval)])),
  };
}

type Etat = "in" | "out";

class Recherche {
  readonly etat = new Map<string, Etat>();
  score = 0;
  cout = 0;
  charge = 0;
  noeuds = 0;
  coupe = false;
  meilleur: { score: number; retenues: Set<string> };

  constructor(
    private readonly parId: ReadonlyMap<string, CandidatPortefeuille & { score: number }>,
    private readonly g: Graphe,
    private readonly c: ContraintesPortefeuille,
    private readonly libres: readonly string[],
    private readonly ordreCout: readonly string[],
    private readonly ordreCharge: readonly string[],
    private readonly noeudsMax: number,
  ) {
    this.meilleur = { score: -1, retenues: new Set() };
  }

  /** Inclut l'initiative et ses prérequis ; null si impossible (exclu ou contrainte). */
  inclure(id: string): string[] | null {
    const ajout = [...(this.g.prerequis.get(id) as Set<string>)].filter(
      (x) => this.etat.get(x) !== "in",
    );
    if (ajout.some((x) => this.etat.get(x) === "out")) return null;
    const p = ajout.map((x) => this.parId.get(x) as CandidatPortefeuille & { score: number });
    const cout = this.cout + p.reduce((s, x) => s + x.cout, 0);
    const charge = this.charge + p.reduce((s, x) => s + x.charge, 0);
    if (this.c.budgetMax !== null && cout > this.c.budgetMax) return null;
    if (this.c.capaciteMax !== null && charge > this.c.capaciteMax) return null;
    for (const x of p) this.etat.set(x.id, "in");
    this.cout = cout;
    this.charge = charge;
    this.score += p.reduce((s, x) => s + x.score, 0);
    return ajout;
  }

  /** Écarte l'initiative et ses dépendantes ; null si une dépendante est déjà retenue. */
  exclure(id: string): string[] | null {
    const retrait = [...(this.g.dependants.get(id) as Set<string>)].filter(
      (x) => this.etat.get(x) !== "out",
    );
    if (retrait.some((x) => this.etat.get(x) === "in")) return null;
    for (const x of retrait) this.etat.set(x, "out");
    return retrait;
  }

  annuler(ids: readonly string[], inclus: boolean): void {
    for (const x of ids) {
      this.etat.delete(x);
      if (inclus) {
        const p = this.parId.get(x) as CandidatPortefeuille & { score: number };
        this.cout -= p.cout;
        this.charge -= p.charge;
        this.score -= p.score;
      }
    }
  }

  /** Relaxation fractionnaire sur une ressource (null : sans limite → somme des scores). */
  private relaxation(ordre: readonly string[], cle: "cout" | "charge", reste: number | null) {
    let total = 0;
    let disponible = reste;
    for (const id of ordre) {
      if (this.etat.has(id)) continue;
      const p = this.parId.get(id) as CandidatPortefeuille & { score: number };
      if (p.score === 0) continue;
      if (disponible === null || p[cle] <= disponible) {
        total += p.score;
        if (disponible !== null) disponible -= p[cle];
      } else {
        total += (p.score * disponible) / p[cle];
        break;
      }
    }
    return total;
  }

  borne(): number {
    const b = this.c.budgetMax === null ? null : this.c.budgetMax - this.cout;
    const k = this.c.capaciteMax === null ? null : this.c.capaciteMax - this.charge;
    return (
      this.score +
      Math.min(
        this.relaxation(this.ordreCout, "cout", b),
        this.relaxation(this.ordreCharge, "charge", k),
      )
    );
  }

  explorer(k: number): void {
    if (this.coupe) return;
    if (++this.noeuds > this.noeudsMax) {
      this.coupe = true;
      return;
    }
    if (this.score > this.meilleur.score) {
      this.meilleur = {
        score: this.score,
        retenues: new Set([...this.etat].filter(([, e]) => e === "in").map(([id]) => id)),
      };
    }
    let i = k;
    while (i < this.libres.length && this.etat.has(this.libres[i] as string)) i++;
    if (i >= this.libres.length) return;
    // Scores entiers : une amélioration vaut au moins 1.
    if (this.borne() + 1e-9 < this.meilleur.score + 1) return;
    const id = this.libres[i] as string;
    if ((this.parId.get(id) as { score: number }).score > 0) {
      const ajout = this.inclure(id);
      if (ajout) {
        this.explorer(i + 1);
        this.annuler(ajout, true);
      }
    }
    const retrait = this.exclure(id);
    if (retrait) {
      this.explorer(i + 1);
      this.annuler(retrait, false);
    }
  }
}

/** Ordre de lecture d'une ressource pour la relaxation : score par unité décroissant. */
function ordreRelaxation(
  libres: readonly (CandidatPortefeuille & { score: number })[],
  cle: "cout" | "charge",
): string[] {
  const ratio = (x: CandidatPortefeuille & { score: number }) =>
    x[cle] === 0 ? Number.POSITIVE_INFINITY : x.score / x[cle];
  return [...libres]
    .sort((a, b) => ratio(b) - ratio(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => x.id);
}

/** Propose le portefeuille de score total maximal sous contraintes (voir l'en-tête). */
export function optimiserPortefeuille(
  candidats: readonly CandidatPortefeuille[],
  contraintes: ContraintesPortefeuille,
  noeudsMax: number = NOEUDS_PORTEFEUILLE_MAX,
): PropositionPortefeuille {
  const poids = contraintes.poids ?? POIDS_PORTEFEUILLE_DEFAUT;
  controlerPoids(poids);
  controlerEntrees(candidats, contraintes);
  if (!Number.isInteger(noeudsMax) || noeudsMax < 1) {
    throw new ErreurPlan(
      "PORTEFEUILLE_INVALIDE",
      "Le plafond de nœuds explorés est un entier d'au moins 1.",
      "noeudsMax",
    );
  }
  const notes = candidats.map((c) => ({ ...c, score: scorerInitiative(c, poids) }));
  const parId = new Map(notes.map((c) => [c.id, c]));
  const g = graphe(candidats);
  const exclues = new Set(
    notes.filter((c) => c.exclue).flatMap((c) => [...(g.dependants.get(c.id) ?? [])]),
  );
  const imposees = new Set(
    notes.filter((c) => c.obligatoire).flatMap((c) => [...(g.prerequis.get(c.id) ?? [])]),
  );
  const somme = (ids: Iterable<string>, cle: "cout" | "charge" | "score") =>
    [...ids].reduce((s, id) => s + (parId.get(id) as (typeof notes)[number])[cle], 0);
  const realisable =
    ![...imposees].some((id) => exclues.has(id)) &&
    (contraintes.budgetMax === null || somme(imposees, "cout") <= contraintes.budgetMax) &&
    (contraintes.capaciteMax === null || somme(imposees, "charge") <= contraintes.capaciteMax);
  let retenues = new Set([...imposees].filter((id) => !exclues.has(id)));
  let optimal = true;
  let noeuds = 0;
  if (realisable) {
    const libres = notes
      .filter((c) => !imposees.has(c.id) && !exclues.has(c.id))
      .sort((a, b) => b.score - a.score || a.cout - b.cout || (a.id < b.id ? -1 : 1));
    const r = new Recherche(
      parId,
      g,
      contraintes,
      libres.map((c) => c.id),
      ordreRelaxation(libres, "cout"),
      ordreRelaxation(libres, "charge"),
      noeudsMax,
    );
    for (const id of imposees) r.etat.set(id, "in");
    for (const id of exclues) r.etat.set(id, "out");
    r.score = somme(imposees, "score");
    r.cout = somme(imposees, "cout");
    r.charge = somme(imposees, "charge");
    r.explorer(0);
    retenues = r.meilleur.retenues;
    optimal = !r.coupe;
    noeuds = r.noeuds;
  }
  const exclueDirecte = new Set(notes.filter((c) => c.exclue).map((c) => c.id));
  const decisions: DecisionCandidat[] = notes.map((c) => {
    const retenue = retenues.has(c.id);
    const motif: MotifPortefeuille =
      imposees.has(c.id) && retenue
        ? "obligatoire"
        : retenue
          ? "optimisation"
          : exclueDirecte.has(c.id)
            ? "exclue"
            : exclues.has(c.id)
              ? "depend_d_une_exclue"
              : c.score === 0
                ? "score_nul"
                : "contraintes";
    return { id: c.id, score: c.score, retenue, motif };
  });
  return {
    decisions,
    retenues: notes.filter((c) => retenues.has(c.id)).map((c) => c.id),
    totaux: {
      score: somme(retenues, "score"),
      cout: somme(retenues, "cout"),
      charge: somme(retenues, "charge"),
    },
    realisable,
    optimal,
    noeudsExplores: noeuds,
    poids,
  };
}
