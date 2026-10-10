/**
 * Cohérence des unités d'un arbre d'indicateurs (KPI-13).
 *
 * Une relation « somme » additionne les valeurs de ses leviers : elles doivent donc être exprimées
 * dans la même unité (« 55 jours + 72 % » n'a aucun sens). Une relation « produit » multiplie
 * des facteurs : des unités différentes y sont légitimes (volume × panier moyen = chiffre
 * d'affaires). Le moteur de décomposition (`arbre.ts`) ne manipule que des nombres : cette règle
 * se vérifie ici, à partir de l'unité du KPI lié à chaque nœud.
 *
 * - Les unités se comparent sans tenir compte des majuscules ni des espaces superflus.
 * - Un nœud sans KPI lié (levier libre) ou dont l'unité est vide n'a pas d'unité connue : il n'est
 *   jamais signalé.
 * - L'unité de référence d'une somme est celle du nœud parent ; sans unité connue pour le parent,
 *   celle du premier levier (dans l'ordre d'entrée) qui en a une.
 * - Un coefficient ne convertit pas une unité : pour additionner des francs et des milliers de
 *   francs, les deux KPI doivent partager la même unité.
 *
 * Fonctions pures, déterministes ; aucun LLM.
 */
import { ErreurKpi } from "./erreurs";
import type { RelationArbreKpi } from "./arbre";

export interface NoeudUniteKpi {
  readonly id: string;
  /** null : la racine. */
  readonly parentId: string | null;
  /** Façon dont les enfants de ce nœud se combinent. */
  readonly relation: RelationArbreKpi;
  /** Unité du KPI lié ; null si le nœud n'a pas de KPI (levier libre). */
  readonly unite: string | null;
  /** Libellé du nœud, pour le message d'erreur (facultatif). */
  readonly libelle?: string;
}

export interface IncoherenceUniteKpi {
  /** Nœud « somme » dont un levier a une unité différente. */
  readonly parentId: string;
  /** Levier d'unité différente. */
  readonly noeudId: string;
  /** Unité attendue (celle du parent, ou à défaut du premier levier qui en a une). */
  readonly uniteReference: string;
  /** Unité du levier. */
  readonly unite: string;
}

/** Forme comparable d'une unité : sans espaces superflus, sans différence de casse. */
export function normaliserUniteKpi(unite: string | null | undefined): string {
  return (unite ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr-FR");
}

/**
 * Leviers dont l'unité diffère de celle de leur parent sous une relation « somme ». Les nœuds sous
 * un « produit » ne sont jamais signalés. L'ordre du résultat suit l'ordre d'entrée des nœuds.
 */
export function unitesIncoherentesArbreKpi(
  noeuds: readonly NoeudUniteKpi[],
): IncoherenceUniteKpi[] {
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  const enfants = new Map<string, NoeudUniteKpi[]>();
  for (const n of noeuds) {
    if (n.parentId === null || !parId.has(n.parentId)) continue;
    const liste = enfants.get(n.parentId) ?? [];
    liste.push(n);
    enfants.set(n.parentId, liste);
  }
  const sortie: IncoherenceUniteKpi[] = [];
  for (const parent of noeuds) {
    const fils = enfants.get(parent.id);
    if (!fils || parent.relation !== "somme") continue;
    const reference =
      normaliserUniteKpi(parent.unite) !== ""
        ? (parent.unite as string).trim()
        : fils.find((f) => normaliserUniteKpi(f.unite) !== "")?.unite?.trim();
    if (reference === undefined) continue;
    const attendue = normaliserUniteKpi(reference);
    for (const f of fils) {
      const u = normaliserUniteKpi(f.unite);
      if (u === "" || u === attendue) continue;
      sortie.push({
        parentId: parent.id,
        noeudId: f.id,
        uniteReference: reference,
        unite: (f.unite as string).trim(),
      });
    }
  }
  return sortie;
}

/** Phrase française d'une incohérence (libellés des nœuds si connus, sinon leurs identifiants). */
export function messageUniteIncoherenteKpi(
  i: IncoherenceUniteKpi,
  noeuds: readonly NoeudUniteKpi[],
): string {
  const nom = (id: string) => noeuds.find((n) => n.id === id)?.libelle ?? id;
  return (
    `Unités différentes : la somme n'a pas de sens. « ${nom(i.noeudId)} » est en « ${i.unite} » ` +
    `alors que « ${nom(i.parentId)} » additionne des « ${i.uniteReference} ». ` +
    "Liez un KPI de même unité, ou combinez les leviers par un produit."
  );
}

/**
 * Lève `ARBRE_UNITES` si une somme additionne des unités différentes. `ignorer` liste les
 * incohérences déjà présentes avant une modification (clé `parentId|noeudId`) : seules les
 * nouvelles sont refusées, afin qu'un arbre ancien ne bloque pas toute évolution.
 */
export function exigerUnitesCoherentesKpi(
  noeuds: readonly NoeudUniteKpi[],
  ignorer: ReadonlySet<string> = new Set(),
): void {
  const nouvelle = unitesIncoherentesArbreKpi(noeuds).find(
    (i) => !ignorer.has(cleIncoherenceUniteKpi(i)),
  );
  if (nouvelle) throw new ErreurKpi("ARBRE_UNITES", messageUniteIncoherenteKpi(nouvelle, noeuds));
}

/** Clé stable d'une incohérence (comparaison avant/après une modification). */
export const cleIncoherenceUniteKpi = (i: Pick<IncoherenceUniteKpi, "parentId" | "noeudId">) =>
  `${i.parentId}|${i.noeudId}`;
