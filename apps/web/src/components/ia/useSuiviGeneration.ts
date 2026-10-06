"use client";

import { useEffect, useRef, useState } from "react";
import { api, ErreurApi } from "../../lib/api";
import { messageErreurIa } from "../../lib/ia";
import {
  cheminGeneration,
  delaiInterrogation,
  DUREE_MAX_SUIVI_MS,
  estTerminal,
  type GenerationIa,
} from "../../lib/ia-contenu";

export interface SuiviGeneration {
  generation: GenerationIa;
  /** Remplace la génération affichée (réponse d'une action : modifier, valider, annuler). */
  remplacer: (g: GenerationIa) => void;
  /** Relit la génération (après un refus qui signale un état changé ailleurs). */
  relire: () => Promise<void>;
  /** Suivi interrompu (réseau, génération devenue invisible) : message affichable. */
  erreur: string | null;
  /** Le suivi a dépassé sa durée maximale : proposer de recharger. */
  arrete: boolean;
}

/**
 * Suit une génération en file par interrogation ESPACÉE de GET /api/ia/generations/:id
 * (1 s, 2 s, 3 s, 5 s, 8 s puis 10 s ; doublé après une erreur réseau), jusqu'à un statut
 * terminal. Pas d'interrogation quand l'onglet est masqué ; arrêt au bout de 15 minutes.
 * Monter le composant avec `key={generation.id}` pour suivre une autre génération.
 */
export function useSuiviGeneration(
  initiale: GenerationIa,
  onChange?: (g: GenerationIa) => void,
): SuiviGeneration {
  const [generation, setGeneration] = useState(initiale);
  const [erreur, setErreur] = useState<string | null>(null);
  const [arrete, setArrete] = useState(false);
  const refOnChange = useRef(onChange);
  useEffect(() => {
    refOnChange.current = onChange;
  });
  const terminal = estTerminal(generation.statut);
  const id = generation.id;

  const remplacer = (g: GenerationIa) => {
    setGeneration(g);
    setErreur(null);
    refOnChange.current?.(g);
  };

  const relire = async () => {
    try {
      remplacer(await api.get<GenerationIa>(cheminGeneration(id)));
    } catch (e) {
      setErreur(messageErreurIa(e));
    }
  };

  useEffect(() => {
    if (terminal) return;
    const debut = Date.now();
    const controleur = new AbortController();
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    let tentative = 0;
    let erreurs = 0;
    let fini = false;

    const planifier = () => {
      if (fini) return;
      if (Date.now() - debut > DUREE_MAX_SUIVI_MS) {
        setArrete(true);
        return;
      }
      minuterie = setTimeout(interroger, delaiInterrogation(tentative, erreurs));
    };

    const interroger = async () => {
      // Onglet masqué : on n'interroge pas, on réessaie plus tard.
      if (typeof document !== "undefined" && document.hidden) {
        planifier();
        return;
      }
      try {
        const g = await api.get<GenerationIa>(cheminGeneration(id), {
          signal: controleur.signal,
        });
        if (fini) return;
        tentative += 1;
        erreurs = 0;
        setErreur(null);
        setGeneration(g);
        refOnChange.current?.(g);
        if (!estTerminal(g.statut)) planifier();
      } catch (e) {
        if (fini) return;
        if (e instanceof ErreurApi && (e.statut === 403 || e.statut === 404)) {
          setErreur(messageErreurIa(e));
          return;
        }
        erreurs += 1;
        setErreur("Suivi de la génération interrompu (réseau) : nouvel essai dans un instant.");
        planifier();
      }
    };

    planifier();
    return () => {
      fini = true;
      if (minuterie) clearTimeout(minuterie);
      controleur.abort();
    };
  }, [id, terminal]);

  return { generation, remplacer, relire, erreur, arrete };
}
