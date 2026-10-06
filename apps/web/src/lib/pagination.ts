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
