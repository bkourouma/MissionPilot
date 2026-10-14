"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageRedressement } from "../../lib/redressement";

export interface PageRed<T> {
  elements: T[];
  suivant: string | null;
}

/**
 * Pagination « Charger plus » d'un historique : la première page vient du serveur, les suivantes
 * de l'API par curseur (`chemin(curseur)` doit contenir un chemin `/api/...`, jamais une URL
 * reçue). Une erreur reste affichée sans perdre les lignes déjà chargées.
 */
export function useChargerPlus<T>(
  initial: readonly T[],
  suivantInitial: string | null,
  chemin: (curseur: string) => string,
) {
  const [elements, setElements] = useState<T[]>([...initial]);
  const [suivant, setSuivant] = useState<string | null>(suivantInitial);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function chargerPlus() {
    if (suivant === null || enCours) return;
    setEnCours(true);
    setErreur(null);
    try {
      const page = await api.get<PageRed<T>>(chemin(suivant));
      setElements((x) => [...x, ...page.elements]);
      setSuivant(page.suivant ?? null);
    } catch (e) {
      setErreur(messageRedressement(e));
    } finally {
      setEnCours(false);
    }
  }

  return { elements, suivant, enCours, erreur, chargerPlus };
}
