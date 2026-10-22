"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { INTERVALLE_RAFRAICHISSEMENT_MS } from "./ListeDocumentsIngestion";

/**
 * Recharge les données de la page toutes les 3 s tant que `actif` (document en cours de lecture),
 * puis s'arrête. Annonce poliment l'actualisation automatique. Ne conserve rien dans le navigateur.
 */
export function ActualisationAuto({ actif }: { actif: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!actif) return;
    const minuterie = setInterval(() => router.refresh(), INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => clearInterval(minuterie);
  }, [actif, router]);
  return (
    <p className="mp-visuellement-cache" role="status" aria-live="polite">
      {actif
        ? "Lecture en cours : la page se met à jour automatiquement toutes les 3 secondes."
        : ""}
    </p>
  );
}
