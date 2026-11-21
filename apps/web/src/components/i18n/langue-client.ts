import { COOKIE_LANGUE, resoudreLangue, type Langue } from "@missionpilot/shared";

/** Valeur du cookie de langue dans une chaîne `document.cookie`, ou `null`. */
export function lireCookieLangue(cookie: string): string | null {
  for (const morceau of cookie.split(";")) {
    const [nom, ...reste] = morceau.trim().split("=");
    if (nom === COOKIE_LANGUE) return reste.join("=") || null;
  }
  return null;
}

/**
 * Langue à utiliser hors du fournisseur de langue (error boundary racine) : le cookie du
 * sélecteur prime, puis l'attribut `lang` du document, puis le français.
 */
export function langueHorsFournisseur(cookie: string, langueDocument: string | null): Langue {
  return resoudreLangue(lireCookieLangue(cookie), langueDocument);
}
