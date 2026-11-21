"use client";

import { useEffect, type RefObject } from "react";

const PREMIER_CHAMP =
  "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])";

/**
 * Place le focus sur le premier champ d'un formulaire qui vient de s'ouvrir (panneau déplié à la
 * demande) : le clavier et les lecteurs d'écran n'ont pas à le chercher.
 */
export function useFocusInitial(formulaire: RefObject<HTMLElement | null>, actif = true) {
  useEffect(() => {
    if (!actif) return;
    formulaire.current?.querySelector<HTMLElement>(PREMIER_CHAMP)?.focus();
  }, [formulaire, actif]);
}
