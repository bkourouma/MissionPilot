"use client";

import { useEffect, useState } from "react";
import { useRafraichir } from "./useRafraichir";

/**
 * Panneau d'édition fermé seulement quand les données rafraîchies arrivent (`cle` change) ou au
 * bout de 8 s. Constat de recette (Next 15.5) : un `router.refresh()` lancé dans la foulée d'un
 * enregistrement laissait parfois l'écran sur les anciennes valeurs alors que l'API avait
 * enregistré la modification. Si rien n'a changé après 1,5 s, un second rafraîchissement est
 * demandé dans une transition (voir `useRafraichir`).
 */
export function useFermetureDifferee<T>(
  cle: unknown,
): [T | null, (v: T | null) => void, () => void] {
  const [ouvert, setOuvert] = useState<T | null>(null);
  const { marquer } = useRafraichir({ cle, surSecours: () => setOuvert(null) });
  useEffect(() => {
    setOuvert(null);
  }, [cle]);
  return [ouvert, setOuvert, marquer];
}
