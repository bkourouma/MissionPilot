/** Aide pure du tri de `Tableau` : l'état de tri vit dans l'URL (`?tri=cle&sens=asc`). */

export type SensTri = "asc" | "desc";

/** Valeur de `aria-sort` d'un en-tête de colonne triable. */
export type AriaSort = "ascending" | "descending" | "none";

/** Cycle d'un clic sur un en-tête : aucun tri, puis croissant, puis décroissant, puis aucun. */
export function sensSuivant(sens: SensTri | null): SensTri | null {
  if (sens === null) return "asc";
  if (sens === "asc") return "desc";
  return null;
}

export function ariaSort(sens: SensTri | null): AriaSort {
  if (sens === "asc") return "ascending";
  if (sens === "desc") return "descending";
  return "none";
}

/** Lit un sens de tri depuis un paramètre d'URL ; toute autre valeur donne `null`. */
export function lireSens(valeur: string | null | undefined): SensTri | null {
  return valeur === "asc" || valeur === "desc" ? valeur : null;
}

export interface OptionsHrefTri {
  /** Nom du paramètre portant la colonne triée (défaut `tri`). */
  paramTri?: string;
  /** Nom du paramètre portant le sens (défaut `sens`). */
  paramSens?: string;
  /** Paramètre de page, supprimé : changer le tri revient à la première page (défaut `page`). */
  paramPage?: string;
}

/**
 * Lien d'un en-tête triable. `chemin` peut déjà porter une requête (filtres conservés).
 * Le clic applique `sensSuivant` : croissant, décroissant, puis retrait du tri. Le curseur et
 * la page sont retirés, car l'ordre change.
 *
 * `hrefTri("/clients?q=a&page=3", "nom", "asc")` → `/clients?q=a&tri=nom&sens=desc`.
 */
export function hrefTri(
  chemin: string,
  cle: string,
  sensActuel: SensTri | null,
  { paramTri = "tri", paramSens = "sens", paramPage = "page" }: OptionsHrefTri = {},
): string {
  const [base = "", requete = ""] = chemin.split("?", 2);
  const params = new URLSearchParams(requete);
  params.delete(paramPage);
  params.delete("curseur");
  const suivant = sensSuivant(sensActuel);
  if (suivant === null) {
    params.delete(paramTri);
    params.delete(paramSens);
  } else {
    params.set(paramTri, cle);
    params.set(paramSens, suivant);
  }
  const texte = params.toString();
  return texte ? `${base}?${texte}` : base;
}

/** Sens de tri actuel d'une colonne, d'après les paramètres d'URL (`null` si autre colonne). */
export function sensDeColonne(
  cle: string,
  triActuel: string | null | undefined,
  sensActuel: string | null | undefined,
): SensTri | null {
  return triActuel === cle ? lireSens(sensActuel) : null;
}

export type AlignementColonne = "gauche" | "droite" | "centre";

export function classeAlignement(alignement: AlignementColonne | undefined): string | undefined {
  if (alignement === "droite") return "mp-aligne-droite";
  if (alignement === "centre") return "mp-aligne-centre";
  return undefined;
}

/** Assemble des classes CSS en ignorant les valeurs vides. */
export function classes(...parties: (string | false | null | undefined)[]): string {
  return parties.filter(Boolean).join(" ");
}
