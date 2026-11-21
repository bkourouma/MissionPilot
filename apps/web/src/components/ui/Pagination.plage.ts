/** Aide pure de `Pagination` : la plage d'éléments affichée (« 21–40 sur 134 »). */

export interface PlageAffichee {
  /** Premier élément affiché (numéroté à partir de 1). */
  debut: number;
  /** Dernier élément affiché. */
  fin: number;
  total: number;
}

/**
 * Plage de la page `page` pour `taillePage` éléments par page. `null` quand elle n'a pas de sens
 * (total absent, nul ou invalide, taille invalide). La page est ramenée dans les bornes.
 */
export function plageAffichee(
  page: number,
  taillePage: number | undefined,
  total: number | undefined,
): PlageAffichee | null {
  if (total === undefined || taillePage === undefined) return null;
  if (!Number.isFinite(total) || !Number.isFinite(taillePage) || !Number.isFinite(page))
    return null;
  const t = Math.floor(total);
  const taille = Math.floor(taillePage);
  if (t <= 0 || taille <= 0) return null;
  const pages = Math.ceil(t / taille);
  const courante = Math.min(Math.max(1, Math.floor(page)), pages);
  return { debut: (courante - 1) * taille + 1, fin: Math.min(courante * taille, t), total: t };
}

/** « 21–40 sur 134 » (français) ou « 21–40 of 134 » (anglais), nombres groupés selon la langue. */
export function libellePlage(plage: PlageAffichee, langue: "fr" | "en"): string {
  const nombre = new Intl.NumberFormat(langue === "en" ? "en-US" : "fr-FR");
  const debut = nombre.format(plage.debut);
  const fin = nombre.format(plage.fin);
  const total = nombre.format(plage.total);
  const portee = plage.debut === plage.fin ? debut : `${debut}–${fin}`;
  return `${portee} ${langue === "en" ? "of" : "sur"} ${total}`;
}
