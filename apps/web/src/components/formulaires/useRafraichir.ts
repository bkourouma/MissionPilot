"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** Délai avant de redemander un rafraîchissement qui n'a pas abouti. */
export const DELAI_RELANCE_MS = 1500;
/** Délai de secours : l'attente est levée même si les données n'ont pas changé. */
export const DELAI_SECOURS_MS = 8000;

/** Valeur interne : aucun suivi de données (l'attente suit alors la seule transition React). */
const SANS_CLE = Symbol("sans-cle");

interface RouteurRafraichissable {
  refresh: () => void;
}

/**
 * Lance `router.refresh()` à l'intérieur d'une transition React du composant (celle de
 * `useTransition`). Next 15.5 enveloppe déjà son `refresh` dans `startTransition` mais ne rend
 * aucune promesse : sans transition propre au composant, rien ne signale que l'ancien écran est
 * encore affiché et le commit des nouvelles données (suspendu sur la requête RSC) n'est pas
 * attendu.
 */
export function rafraichirEnTransition(
  demarrer: (action: () => void) => void,
  routeur: RouteurRafraichissable,
): void {
  demarrer(() => routeur.refresh());
}

/**
 * Programme une relance unique après `delaiRelance` et l'abandon de l'attente après
 * `delaiSecours`. Rend la fonction d'annulation des deux minuteries.
 */
export function planifierRelance(options: {
  relancer: () => void;
  abandonner: () => void;
  delaiRelance?: number;
  delaiSecours?: number;
}): () => void {
  const relance = setTimeout(options.relancer, options.delaiRelance ?? DELAI_RELANCE_MS);
  const secours = setTimeout(options.abandonner, options.delaiSecours ?? DELAI_SECOURS_MS);
  return () => {
    clearTimeout(relance);
    clearTimeout(secours);
  };
}

/** Fenêtre pendant laquelle une relance déjà émise par une autre instance du hook suffit. */
const FENETRE_DEDOUBLONNAGE_MS = 500;
let derniereRelanceMs = Number.NEGATIVE_INFINITY;

/**
 * Plusieurs instances du hook peuvent coexister dans un même composant (chacune avec sa
 * transition) : toutes relanceraient à 1,5 s, soit autant de requêtes RSC. `router.refresh()`
 * recharge toute la page : une seule relance par fenêtre suffit, les autres instances gardent leur
 * transition en cours (elles aboutissent avec la même réponse).
 */
export function autoriserRelance(
  maintenant: number = Date.now(),
  fenetre: number = FENETRE_DEDOUBLONNAGE_MS,
): boolean {
  if (maintenant - derniereRelanceMs < fenetre) return false;
  derniereRelanceMs = maintenant;
  return true;
}

/** Remet à zéro le dédoublonnage (tests). */
export function reinitialiserRelances(): void {
  derniereRelanceMs = Number.NEGATIVE_INFINITY;
}

/**
 * État d'attente affiché. Avec `cle` : attente demandée OU transition en cours. Sans `cle` : la
 * transition seule, plafonnée au délai de secours (`abandonne`) pour qu'une requête RSC sans
 * réponse ne verrouille pas indéfiniment les boutons.
 */
export function attenteAffichee(etat: {
  suivi: boolean;
  attenteCle: boolean;
  enTransition: boolean;
  abandonne: boolean;
}): boolean {
  return etat.suivi ? etat.attenteCle || etat.enTransition : etat.enTransition && !etat.abandonne;
}

export interface OptionsRafraichir {
  /**
   * Valeur observable qui change quand les données rafraîchies arrivent (statut, version…).
   * Absente : l'attente est celle de la transition React (`isPending`).
   */
  cle?: unknown;
  /** Appelé quand le délai de secours expire sans changement de `cle`. */
  surSecours?: () => void;
}

/**
 * Rafraîchissement des données serveur après une écriture : `router.refresh()` dans une
 * transition (`rafraichir`), état d'attente (`enAttente`), une relance si l'écran n'a pas changé
 * au bout de 1,5 s (une seule relance par fenêtre pour tous les hooks de la page), abandon de l'attente à 8 s. `marquer` ne demande rien à Next : il signale
 * seulement qu'un rafraîchissement est attendu (l'appelant le lance lui-même). Sans `cle`,
 * l'attente est la transition React, plafonnée à 8 s : elle ne peut jamais rester bloquée plus longtemps.
 *
 * Lot 13a : la cause des écrans périmés (perte du « ping » de React sous une frontière Suspense)
 * est contournée pour toute l'application par `DebloqueurRendu` (layout racine). La relance à
 * 1,5 s et le secours à 8 s restent des filets de sécurité ; ils ne devraient plus servir.
 */
export function useRafraichir(options: OptionsRafraichir = {}) {
  const router = useRouter();
  const suivi = "cle" in options;
  const cle = suivi ? options.cle : SANS_CLE;
  const [enTransition, demarrer] = useTransition();
  const [attenteCle, setAttenteCle] = useState(false);
  const [abandonne, setAbandonne] = useState(false);
  const surSecours = useRef(options.surSecours);
  surSecours.current = options.surSecours;

  useEffect(() => {
    setAttenteCle(false);
  }, [cle]);

  const enAttente = attenteAffichee({ suivi, attenteCle, enTransition, abandonne });
  const aSurveiller = suivi ? attenteCle : enTransition;

  useEffect(() => {
    if (!aSurveiller) return;
    return planifierRelance({
      relancer: () => {
        if (autoriserRelance()) rafraichirEnTransition(demarrer, router);
      },
      abandonner: () => {
        if (suivi) setAttenteCle(false);
        else setAbandonne(true);
        surSecours.current?.();
      },
    });
  }, [aSurveiller, suivi, router]);

  return {
    rafraichir: () => {
      if (suivi) setAttenteCle(true);
      setAbandonne(false);
      rafraichirEnTransition(demarrer, router);
    },
    marquer: () => setAttenteCle(true),
    enAttente,
  };
}
