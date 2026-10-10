"use client";

import { useCallback, useEffect, useId, useRef } from "react";

const EVENEMENT = "mp-kpi-action";

/**
 * Un message de réussite (« Décision enregistrée. ») ne doit pas rester affiché quand l'utilisateur
 * passe à autre chose sur la même page : chaque formulaire ou bouton d'action du pilotage annonce
 * « je lance une action » avant son envoi, et les autres efface leur message de réussite.
 *
 * - `signaler()` : à appeler au début d'une action ; ne touche pas le message de l'appelant.
 * - `effacer` : appelé quand une AUTRE action démarre sur la page.
 */
export function useEffacementSucces(effacer: () => void): () => void {
  const id = useId();
  const dernier = useRef(effacer);
  useEffect(() => {
    dernier.current = effacer;
  }, [effacer]);
  useEffect(() => {
    const ecouteur = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) dernier.current();
    };
    window.addEventListener(EVENEMENT, ecouteur);
    return () => window.removeEventListener(EVENEMENT, ecouteur);
  }, [id]);
  return useCallback(() => {
    window.dispatchEvent(new CustomEvent<string>(EVENEMENT, { detail: id }));
  }, [id]);
}
