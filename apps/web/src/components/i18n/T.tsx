"use client";

import { useT } from "./FournisseurLangue";

/**
 * Texte bilingue utilisable PARTOUT dans du JSX, y compris dans un composant serveur ou un
 * composant sans directive partagé entre les deux mondes : `<T fr="Enregistrer" en="Save" />`.
 * Pour un attribut (placeholder, aria-label, title) ou une chaîne calculée, utiliser `useT()`
 * (client) ou `await obtenirT()` (serveur).
 */
export function T({ fr, en }: { fr: string; en: string }) {
  return <>{useT()(fr, en)}</>;
}
