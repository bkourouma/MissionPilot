"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, messageErreur } from "../../lib/api";
import {
  confirmerEnvoi,
  delaiReprise,
  estReessayable,
  mettreEnFile,
  type EtatSynchro,
  type Instantane,
  type Stockage,
} from "../../lib/file-sauvegarde";
import type { Resultat } from "../../lib/saisie";
import type { Avertissement, LigneCharge } from "../../lib/temps";

/** `localStorage` s'il est utilisable (navigation privée, quota, refus : `null`). */
export function stockageLocal(): Stockage | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.localStorage;
    const test = "mp-test";
    s.setItem(test, "1");
    s.removeItem(test);
    return s;
  } catch {
    return null;
  }
}

const DELAI_SAISIE_MS = 1200;

export interface OptionsSauvegarde {
  feuilleId: string;
  construire: (i: Instantane) => Resultat<{ lignes: LigneCharge[] }, string>;
}

/**
 * Sauvegarde automatique du brouillon : chaque modification est d'abord gardée sur l'appareil
 * (file locale), puis envoyée 1,2 s après la dernière frappe. Une coupure réseau ne perd rien :
 * l'envoi est retenté (2 s, 4 s… 30 s) et au retour du réseau. Un refus de l'API (valeur
 * invalide, capacité dépassée en mode « refuser ») n'est pas retenté : il est affiché.
 */
export function useSauvegardeFeuille({ feuilleId, construire }: OptionsSauvegarde) {
  const [etat, setEtat] = useState<EtatSynchro>("a_jour");
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreursCases, setErreursCases] = useState<Record<string, string>>({});
  const [avertissements, setAvertissements] = useState<Avertissement[]>([]);
  const attente = useRef<Instantane | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envoiEnCours = useRef<Promise<boolean> | null>(null);
  const tentatives = useRef(0);
  const construireRef = useRef(construire);
  construireRef.current = construire;

  const arreterMinuterie = () => {
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = null;
  };

  const envoyerUneFois = useCallback(async (): Promise<boolean> => {
    const i = attente.current;
    if (!i) return true;
    const c = construireRef.current(i);
    if (!c.ok) {
      setErreursCases(c.erreurs as Record<string, string>);
      setErreur("Certaines cases sont invalides : corrigez-les pour enregistrer.");
      setEtat("refuse");
      return false;
    }
    setErreursCases({});
    setErreur(null);
    setEtat("enregistrement");
    try {
      const r = await api.put<{ avertissements?: Avertissement[] }>(
        `/api/feuilles-temps/${encodeURIComponent(feuilleId)}/lignes`,
        c.charge,
        { delaiMs: 20_000 },
      );
      confirmerEnvoi(stockageLocal(), feuilleId, i.modifieLe);
      tentatives.current = 0;
      setErreur(null);
      setAvertissements(r.avertissements ?? []);
      if (attente.current === i) {
        attente.current = null;
        setEtat("a_jour");
      }
      return true;
    } catch (e) {
      if (estReessayable(e)) {
        setEtat("hors_ligne");
        arreterMinuterie();
        minuterie.current = setTimeout(() => void envoyer(), delaiReprise(tentatives.current++));
      } else {
        setErreur(messageErreur(e));
        setEtat("refuse");
      }
      return false;
    }
    // `envoyer` (relance différée) est stable : il ne dépend que de cette fonction.
  }, [feuilleId]);

  /** Envoie l'instantané en attente ; un envoi déjà en cours est attendu, puis relancé. */
  const envoyer = useCallback(async (): Promise<boolean> => {
    arreterMinuterie();
    if (envoiEnCours.current) await envoiEnCours.current;
    if (!attente.current) return true;
    const p = envoyerUneFois();
    envoiEnCours.current = p;
    try {
      const ok = await p;
      // Modification arrivée pendant l'envoi : elle part à son tour.
      if (ok && attente.current) return envoyer();
      return ok;
    } finally {
      if (envoiEnCours.current === p) envoiEnCours.current = null;
    }
  }, [envoyerUneFois]);

  const modifier = useCallback(
    (i: Instantane) => {
      attente.current = i;
      mettreEnFile(stockageLocal(), i);
      setEtat("modifie");
      arreterMinuterie();
      minuterie.current = setTimeout(() => void envoyer(), DELAI_SAISIE_MS);
    },
    [envoyer],
  );

  useEffect(() => {
    const reprendre = () => {
      if (attente.current) void envoyer();
    };
    window.addEventListener("online", reprendre);
    return () => {
      window.removeEventListener("online", reprendre);
      arreterMinuterie();
    };
  }, [envoyer]);

  return {
    etat,
    erreur,
    erreursCases,
    avertissements,
    modifier,
    /** Envoie tout de suite ce qui attend (avant la soumission). */
    enregistrerMaintenant: envoyer,
    enAttente: () => attente.current !== null,
  };
}
