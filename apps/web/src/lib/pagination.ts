// --- Listes paginées par curseur (`GET /api/missions`, `GET /api/opportunites`) ----------

/** Page renvoyée par l'API : `suivant` est le curseur de la page suivante, null à la fin. */
export interface PageCurseur<T> {
  elements: T[];
  suivant: string | null;
}

/** Résultat de chargement (forme de `chargerServeur`, sans dépendre de `next/headers`). */
export type ChargementPage<T> =
  { ok: true; donnees: T } | { ok: false; message: string; statut: number };

/** Taille de page demandée quand on charge toute la liste (plafond de l'API). */
export const LIMITE_PAGE_MAX = 500;
/** Garde-fou : au-delà, la liste est rendue partielle avec `tronquee: true`. */
export const PAGES_MAX = 20;

/** Ajoute `limite` et `curseur` à un chemin d'API qui a déjà, ou non, une requête. */
export function cheminPage(chemin: string, limite: number, curseur: string | null): string {
  const [base, requete = ""] = chemin.split("?", 2);
  const r = new URLSearchParams(requete);
  r.set("limite", String(limite));
  if (curseur) r.set("curseur", curseur);
  else r.delete("curseur");
  return `${base}?${r.toString()}`;
}

/**
 * Charge TOUTES les pages d'une liste paginée par curseur (listes de choix, filtres
 * appliqués côté web). Une erreur sur une page rend l'erreur ; un curseur qui revient
 * (réponse incohérente) arrête le parcours. Au-delà de `pagesMax` pages, la liste est
 * rendue partielle et marquée `tronquee`.
 */
export async function chargerToutesLesPages<T>(
  charger: (chemin: string) => Promise<ChargementPage<PageCurseur<T>>>,
  chemin: string,
  { limite = LIMITE_PAGE_MAX, pagesMax = PAGES_MAX }: { limite?: number; pagesMax?: number } = {},
): Promise<ChargementPage<{ elements: T[]; tronquee: boolean }>> {
  const elements: T[] = [];
  const vus = new Set<string>();
  let curseur: string | null = null;
  for (let page = 0; page < pagesMax; page++) {
    const r = await charger(cheminPage(chemin, limite, curseur));
    if (!r.ok) return r;
    elements.push(...r.donnees.elements);
    curseur = r.donnees.suivant ?? null;
    if (curseur === null || vus.has(curseur)) {
      return { ok: true, donnees: { elements, tronquee: false } };
    }
    vus.add(curseur);
  }
  return { ok: true, donnees: { elements, tronquee: true } };
}

// --- Numéros de page ------------------------------------------------------------------------

export type ElementPagination = number | "ellipse";

/**
 * Pages à afficher autour de la page courante, avec ellipses :
 * (5, 10) → [1, "ellipse", 4, 5, 6, "ellipse", 10]. Pages numérotées à partir de 1.
 */
export function pagesAffichees(page: number, totalPages: number, voisins = 1): ElementPagination[] {
  const total = Math.max(0, Math.floor(totalPages));
  if (total === 0) return [];
  const courante = Math.min(Math.max(1, Math.floor(page)), total);
  const pages = new Set<number>([1, total]);
  for (let p = courante - voisins; p <= courante + voisins; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const triees = [...pages].sort((a, b) => a - b);
  const resultat: ElementPagination[] = [];
  let precedente = 0;
  for (const p of triees) {
    if (p - precedente === 2) resultat.push(p - 1);
    else if (p - precedente > 2) resultat.push("ellipse");
    resultat.push(p);
    precedente = p;
  }
  return resultat;
}
