"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLangue } from "../i18n/FournisseurLangue";
import { annonceChangementPage, focusAReprendre } from "./page";

/** Délai laissé à Next pour poser le titre de la nouvelle page avant de le lire. */
const DELAI_TITRE_MS = 250;

/**
 * Après une navigation côté client : annonce poliment le titre de la nouvelle page (région
 * `aria-live`, invisible) et, si le focus s'est perdu avec l'ancienne page, le ramène sur la zone
 * de contenu (`<main id="contenu">`) sans faire défiler. Le défilement en haut de page est fait
 * par le routeur de Next ; le focus du rail, du menu, d'onglets restés affichés ou d'un champ en
 * cours de saisie n'est jamais déplacé.
 */
export function AnnonceNavigation() {
  const chemin = usePathname();
  const langue = useLangue();
  const [annonce, setAnnonce] = useState("");
  const precedent = useRef(chemin);

  useEffect(() => {
    if (precedent.current === chemin) return;
    precedent.current = chemin;
    const minuterie = setTimeout(() => {
      setAnnonce(annonceChangementPage(document.title, langue));
      const actif = document.activeElement;
      const contenu = document.getElementById("contenu");
      const surDocument = !actif || actif === document.body || actif === document.documentElement;
      const dansChampSaisie =
        actif instanceof HTMLElement &&
        (actif.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(actif.tagName));
      if (focusAReprendre({ surDocument, dansChampSaisie })) {
        contenu?.focus({ preventScroll: true });
      }
    }, DELAI_TITRE_MS);
    return () => clearTimeout(minuterie);
  }, [chemin, langue]);

  return (
    <div className="mp-visuellement-cache" role="status" aria-live="polite" aria-atomic="true">
      {annonce}
    </div>
  );
}
