"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  COOKIE_LANGUE,
  creerTraduire,
  LANGUE_PAR_DEFAUT,
  type Langue,
  type Traduire,
} from "@missionpilot/shared";

interface ContexteLangue {
  langue: Langue;
  t: Traduire;
}

const Contexte = createContext<ContexteLangue>({
  langue: LANGUE_PAR_DEFAUT,
  t: creerTraduire(LANGUE_PAR_DEFAUT),
});

/** Monté au layout racine avec la langue lue côté serveur : rendu serveur et client identiques. */
export function FournisseurLangue({ langue, children }: { langue: Langue; children: ReactNode }) {
  const valeur = useMemo(() => ({ langue, t: creerTraduire(langue) }), [langue]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/** Langue de l'interface (composants clients). */
export function useLangue(): Langue {
  return useContext(Contexte).langue;
}

/** `t(fr, en)` dans la langue de l'interface (composants clients). */
export function useT(): Traduire {
  return useContext(Contexte).t;
}

const UN_AN_S = 365 * 24 * 60 * 60;

/**
 * Enregistre le choix (cookie lu par le web et relayé à l'API) puis recharge la page : serveur et
 * client repartent ensemble dans la nouvelle langue, sans état mêlé.
 */
export function changerLangue(langue: Langue): void {
  document.cookie = `${COOKIE_LANGUE}=${langue}; Path=/; Max-Age=${UN_AN_S}; SameSite=Lax`;
  window.location.reload();
}
