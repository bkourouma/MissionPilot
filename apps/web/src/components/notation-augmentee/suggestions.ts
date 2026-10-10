import { GRILLE_GENERIQUE } from "@missionpilot/shared";

/**
 * Suggestions de saisie de la banque d'items, tirées de la grille générique de notation : la
 * saisie reste libre (un cabinet peut avoir ses propres dimensions et pratiques). À utiliser
 * depuis les composants SERVEUR (les pages passent le résultat en propriété) : importé côté
 * navigateur, il embarquerait toute la grille.
 */
export interface SuggestionDimension {
  id: string;
  libelle: string;
  pratiques: string[];
}

export function suggestionsDimensions(): SuggestionDimension[] {
  return GRILLE_GENERIQUE.dimensions.map((d) => ({
    id: d.id,
    libelle: d.libelle,
    pratiques: d.indicateurs.map((i) => i.id),
  }));
}

/** Libellé de la dimension si elle est connue de la grille générique, sinon son identifiant. */
export function libelleDimensionBanque(id: string): string {
  return GRILLE_GENERIQUE.dimensions.find((d) => d.id === id)?.libelle ?? id;
}
