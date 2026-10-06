"use client";

import { useEffect, useState } from "react";

/**
 * Après une action réussie, `router.refresh()` recharge les données serveur sans rendre de
 * promesse : pendant cet intervalle, l'ancien écran reste affiché et ses boutons cliquables
 * (double envoi). Ce crochet marque l'attente jusqu'à ce que `cle` (ex. le statut affiché)
 * change, signe que les nouvelles données sont arrivées. Délai de secours : 8 s.
 */
export function useAttenteRafraichissement(cle: unknown): [boolean, () => void] {
  const [attente, setAttente] = useState(false);
  useEffect(() => {
    setAttente(false);
  }, [cle]);
  useEffect(() => {
    if (!attente) return;
    const minuterie = setTimeout(() => setAttente(false), 8000);
    return () => clearTimeout(minuterie);
  }, [attente]);
  return [attente, () => setAttente(true)];
}
