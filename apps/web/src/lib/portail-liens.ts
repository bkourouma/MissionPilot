/** Espace client : liens, pagination des listes et résumé des partages de l'accueil. */
import type { ProfilPortail } from "./portail-contrats";
import { peut } from "./portail-menus";
import { CHEMIN_PORTAIL } from "./portail-routes";

// --- Liens ---------------------------------------------------------------------------------

/** Téléchargement (ou ouverture dans un onglet) d'un livrable partagé : même origine, cookie. */
export function hrefLivrable(id: string, affichage: "inline" | "attachment" = "attachment") {
  return `/api/portail/livrables/${encodeURIComponent(id)}/fichier?affichage=${affichage}`;
}

/** Document imprimable d'une facture (HTML sûr servi par l'API, sans script). */
export const hrefDocumentFacture = (id: string) =>
  `/api/portail/factures/${encodeURIComponent(id)}/document`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estIdentifiant = (v: string) => UUID.test(v);

/** Curseur reçu dans l'URL : base64url borné, sinon ignoré (retour au début de la liste). */
export function lireCurseur(v: string | string[] | undefined): string | null {
  const brut = (Array.isArray(v) ? v[0] : v) ?? "";
  return brut !== "" && brut.length <= 500 && /^[A-Za-z0-9_-]+$/.test(brut) ? brut : null;
}

/** Taille d'une page des listes du portail. */
export const TAILLE_PAGE_PORTAIL = 20;

/** Requête de l'API pour une page. */
export function requetePage(chemin: string, curseur: string | null): string {
  const r = new URLSearchParams({ limite: String(TAILLE_PAGE_PORTAIL) });
  if (curseur) r.set("curseur", curseur);
  return `${chemin}?${r.toString()}`;
}

/** Lien vers une page d'une liste du portail. */
export function hrefPage(chemin: string, curseur: string | null): string {
  return curseur ? `${chemin}?${new URLSearchParams({ curseur }).toString()}` : chemin;
}

// --- Accueil -------------------------------------------------------------------------------

export interface ElementPartage {
  id: "missions" | "documents" | "factures";
  texte: string;
  /** Lien vers la rubrique, si l'utilisateur peut l'ouvrir. */
  href: string | null;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Résumé des partages pour l'accueil ; liste vide : rien n'a encore été partagé (ou rien
 * que ce rôle puisse voir). Une clé absente de la réponse compte comme rien de partagé.
 */
export function resumePartages(
  partages: ProfilPortail["partages"],
  roles: readonly string[],
): ElementPartage[] {
  const missions = peut(roles, "portail.missions.lire");
  const nbMissions = partages.missions ?? 0;
  const nbDocuments = partages.documents ?? 0;
  const elements: ElementPartage[] = [];
  if (nbMissions > 0) {
    elements.push({
      id: "missions",
      texte: pluriel(nbMissions, "mission partagée", "missions partagées"),
      href: missions ? `${CHEMIN_PORTAIL}/missions` : null,
    });
  }
  if (nbDocuments > 0) {
    elements.push({
      id: "documents",
      texte: pluriel(nbDocuments, "document mis à disposition", "documents mis à disposition"),
      href: missions ? `${CHEMIN_PORTAIL}/missions` : null,
    });
  }
  if (partages.factures === true) {
    elements.push({
      id: "factures",
      texte: "Factures émises consultables",
      href: peut(roles, "portail.factures.lire") ? `${CHEMIN_PORTAIL}/factures` : null,
    });
  }
  return elements;
}
