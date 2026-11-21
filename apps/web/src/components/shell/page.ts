/** Aides pures pour le changement de page : annonce vocale et reprise du focus. */

import type { Langue } from "@missionpilot/shared";

/** Retire le suffixe de marque (« Missions — CabinetPilot » devient « Missions »). */
export function titreDePage(titreDocument: string): string {
  const [titre] = titreDocument.split(" — ");
  return (titre ?? "").trim();
}

/** Phrase lue par la région vocale après une navigation ; vide si le titre est inexploitable. */
export function annonceChangementPage(titreDocument: string, langue: Langue): string {
  const titre = titreDePage(titreDocument);
  if (!titre || titre === "CabinetPilot") return "";
  return langue === "en" ? `Page: ${titre}` : `Page : ${titre}`;
}

/**
 * Le focus revient au contenu seulement s'il est perdu (le lien cliqué a disparu avec l'ancienne
 * page, le focus est retombé sur le document) : on ne l'arrache pas à une personne qui navigue au
 * clavier dans le rail, le menu ou des onglets qui restent affichés, ni à un champ qu'elle remplit.
 */
export function focusAReprendre(etat: { surDocument: boolean; dansChampSaisie: boolean }): boolean {
  return etat.surDocument && !etat.dansChampSaisie;
}
