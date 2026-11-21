"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Index de la ligne qui reçoit le focus après le retrait de la ligne `retiree` : la suivante (qui
 * a pris sa place), sinon la précédente ; `null` s'il ne reste aucune ligne.
 */
export function indexFocusApresRetrait(retiree: number, restantes: number): number | null {
  if (restantes <= 0) return null;
  return Math.min(Math.max(retiree, 0), restantes - 1);
}

const CHAMPS =
  "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)";

/**
 * Focus des listes de lignes éditables : après « Retirer » ou « Ajouter », le focus va au premier
 * champ de la ligne concernée au lieu de se perdre avec le bouton disparu. À brancher sur la
 * liste (`refListe`) ; `focaliser(index)` s'appelle dans le gestionnaire de clic.
 */
export function useFocusLignes<E extends HTMLElement = HTMLUListElement>() {
  const refListe = useRef<E | null>(null);
  const [cible, setCible] = useState<{ index: number } | null>(null);
  useEffect(() => {
    if (cible === null) return;
    const ligne = refListe.current?.children.item(cible.index);
    ligne?.querySelector<HTMLElement>(CHAMPS)?.focus();
    setCible(null);
  }, [cible]);
  return {
    refListe,
    focaliser: (index: number | null) => {
      if (index !== null) setCible({ index });
    },
  };
}
