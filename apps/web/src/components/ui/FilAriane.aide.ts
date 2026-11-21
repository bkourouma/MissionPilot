/** Aide pure de `FilAriane` : normalise les maillons du fil. */

export interface MaillonFil {
  href?: string;
  libelle: string;
}

export interface ElementFil {
  libelle: string;
  /** Lien du maillon ; `null` pour la page courante et pour un maillon sans lien. */
  href: string | null;
  /** Dernier maillon : la page courante (`aria-current="page"`, jamais un lien). */
  courant: boolean;
}

/**
 * Le dernier maillon est la page courante, sans lien. Les maillons au libellé vide sont
 * ignorés ; un maillon intermédiaire sans `href` reste un simple texte.
 */
export function elementsFil(fil: readonly MaillonFil[]): ElementFil[] {
  const utiles = fil.filter((m) => m.libelle.trim() !== "");
  return utiles.map((m, i) => {
    const courant = i === utiles.length - 1;
    return { libelle: m.libelle, href: courant ? null : (m.href ?? null), courant };
  });
}
