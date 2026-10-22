"use client";

import { useRafraichir } from "./useRafraichir";

/**
 * Après une action réussie, `router.refresh()` recharge les données serveur sans rendre de
 * promesse : pendant cet intervalle, l'ancien écran reste affiché et ses boutons cliquables
 * (double envoi). Ce crochet marque l'attente jusqu'à ce que `cle` (ex. le statut affiché)
 * change, signe que les nouvelles données sont arrivées. Si rien n'a changé après 1,5 s, un
 * second rafraîchissement est demandé, dans une transition (voir `useRafraichir`). Délai de
 * secours : 8 s.
 */
export function useAttenteRafraichissement(cle: unknown): [boolean, () => void] {
  const { enAttente, marquer } = useRafraichir({ cle });
  return [enAttente, marquer];
}
