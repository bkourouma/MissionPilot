"use client";

import { useEffect, useState } from "react";
import { creerDebloqueur, estRessourceDeRendu } from "./debloqueur";

/**
 * Monté une fois dans le layout racine. Contourne la perte de « ping » de React 19.2 (canary
 * embarqué par Next 15.5) qui laissait l'ancien écran affiché après `router.refresh()` ou une
 * navigation (anomalies A-04 et R-02, cause détaillée dans `debloqueur.ts`) : après chaque
 * réponse RSC ou morceau JavaScript reçu, quelques mises à jour d'état non transitoires de ce
 * composant vide permettent à React de reprendre la transition bloquée. Aucune requête réseau.
 */
export function DebloqueurRendu() {
  const [, setTic] = useState(0);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const debloqueur = creerDebloqueur(() => setTic((t) => (t + 1) % 1_000_000));
    const observateur = new PerformanceObserver((liste) => {
      if (liste.getEntries().some((e) => estRessourceDeRendu(e.name, window.location.origin))) {
        debloqueur.signaler();
      }
    });
    try {
      observateur.observe({ type: "resource", buffered: false });
    } catch {
      // Navigateur sans Resource Timing observable : comportement d'origine.
      return debloqueur.arreter;
    }
    return () => {
      observateur.disconnect();
      debloqueur.arreter();
    };
  }, []);

  return null;
}
