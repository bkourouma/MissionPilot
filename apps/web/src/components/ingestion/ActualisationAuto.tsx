"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { rafraichirEnTransition } from "../formulaires/useRafraichir";
import { INTERVALLE_RAFRAICHISSEMENT_MS } from "./ListeDocumentsIngestion";

/** Un tick est sauté tant que la transition du tick précédent n'est pas terminée (pas d'empilement). */
export function doitSauterTick(transitionEnCours: boolean): boolean {
  return transitionEnCours;
}

/**
 * Recharge les données de la page toutes les 3 s tant que `actif` (document en cours de lecture),
 * puis s'arrête. Annonce poliment l'actualisation automatique. Ne conserve rien dans le navigateur.
 *
 * Volontairement sans `useRafraichir` : sa relance à 1,5 s et son suivi d'attente créeraient des
 * requêtes RSC parasites à chaque tick. On n'utilise que la transition, sans relance.
 */
export function ActualisationAuto({ actif }: { actif: boolean }) {
  const router = useRouter();
  const [enTransition, demarrer] = useTransition();
  const enCours = useRef(false);
  enCours.current = enTransition;
  useEffect(() => {
    if (!actif) return;
    const minuterie = setInterval(() => {
      if (doitSauterTick(enCours.current)) return;
      rafraichirEnTransition(demarrer, router);
    }, INTERVALLE_RAFRAICHISSEMENT_MS);
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
