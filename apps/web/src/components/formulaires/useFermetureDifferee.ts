"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Panneau d'édition fermé seulement quand les données rafraîchies arrivent (`cle` change) ou au
 * bout de 8 s. Constat de recette (Next 15.5) : un `router.refresh()` lancé dans la foulée d'un
 * enregistrement était parfois abandonné (requête RSC annulée) et l'écran restait sur les
 * anciennes valeurs alors que l'API avait enregistré la modification. Si rien n'a changé après
 * 1,5 s, un second rafraîchissement est donc demandé, au repos.
 */
export function useFermetureDifferee<T>(
  cle: unknown,
): [T | null, (v: T | null) => void, () => void] {
  const router = useRouter();
  const [ouvert, setOuvert] = useState<T | null>(null);
  const [fermeture, setFermeture] = useState(false);
  useEffect(() => {
    setFermeture(false);
    setOuvert(null);
  }, [cle]);
  useEffect(() => {
    if (!fermeture) return;
    const relance = setTimeout(() => router.refresh(), 1500);
    const minuterie = setTimeout(() => {
      setFermeture(false);
      setOuvert(null);
    }, 8000);
    return () => {
      clearTimeout(relance);
      clearTimeout(minuterie);
    };
  }, [fermeture, router]);
  return [ouvert, setOuvert, () => setFermeture(true)];
}
