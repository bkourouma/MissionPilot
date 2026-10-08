"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Après une action réussie, `router.refresh()` recharge les données serveur sans rendre de
 * promesse : pendant cet intervalle, l'ancien écran reste affiché et ses boutons cliquables
 * (double envoi). Ce crochet marque l'attente jusqu'à ce que `cle` (ex. le statut affiché)
 * change, signe que les nouvelles données sont arrivées. Si rien n'a changé après 1,5 s, un
 * second rafraîchissement est demandé (un rafraîchissement lancé dans la foulée d'une action
 * peut être abandonné par Next). Délai de secours : 8 s.
 */
export function useAttenteRafraichissement(cle: unknown): [boolean, () => void] {
  const router = useRouter();
  const [attente, setAttente] = useState(false);
  useEffect(() => {
    setAttente(false);
  }, [cle]);
  useEffect(() => {
    if (!attente) return;
    const relance = setTimeout(() => router.refresh(), 1500);
    const minuterie = setTimeout(() => setAttente(false), 8000);
    return () => {
      clearTimeout(relance);
      clearTimeout(minuterie);
    };
  }, [attente, router]);
  return [attente, () => setAttente(true)];
}
