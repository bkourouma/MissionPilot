/**
 * Langue de l'interface (PRD, « Localisation » : français en V1, anglais ensuite).
 * Partagé par le web (sélecteur, rendu) et l'API (messages d'erreur) : même cookie, mêmes règles.
 * Le français reste la langue par défaut et la langue de référence des textes.
 */

export const LANGUES = ["fr", "en"] as const;
export type Langue = (typeof LANGUES)[number];

export const LANGUE_PAR_DEFAUT: Langue = "fr";

/** Cookie posé par le sélecteur de langue ; lisible par le web et relayé à l'API (même origine). */
export const COOKIE_LANGUE = "mp_langue";

/** En-tête transmis par les appels serveur du web vers l'API (qui n'ont pas les cookies du navigateur). */
export const ENTETE_LANGUE = "x-mp-langue";

export const LIBELLES_LANGUES: Record<Langue, string> = { fr: "Français", en: "English" };

/** Locale `Intl` d'une langue : formats de dates et de nombres. */
export const LOCALES_INTL: Record<Langue, string> = { fr: "fr-FR", en: "en-GB" };

export function estLangue(valeur: unknown): valeur is Langue {
  return typeof valeur === "string" && (LANGUES as readonly string[]).includes(valeur);
}

/**
 * Langue retenue : le choix explicite (cookie ou en-tête) prime ; à défaut, la première langue
 * reconnue de `Accept-Language` ; à défaut, le français.
 */
export function resoudreLangue(
  choix: string | null | undefined,
  acceptLanguage?: string | null,
): Langue {
  if (estLangue(choix)) return choix;
  if (acceptLanguage) {
    for (const morceau of acceptLanguage.split(",")) {
      const code = morceau.split(";")[0]?.trim().slice(0, 2).toLowerCase();
      if (estLangue(code)) return code;
    }
  }
  return LANGUE_PAR_DEFAUT;
}

/** Traduction en ligne : chaque texte porte ses deux versions là où il est écrit. */
export type Traduire = (fr: string, en: string) => string;

export function creerTraduire(langue: Langue): Traduire {
  return langue === "en" ? (_fr, en) => en : (fr) => fr;
}
