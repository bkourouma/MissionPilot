"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Instantane, Stockage } from "../../lib/file-sauvegarde";
import { rejouer, envoyerSaisie, type ReponseLignes } from "../../lib/hors-ligne/envoi";
import type { EtatSaisie } from "../../lib/hors-ligne/etats";
import {
  abandonner,
  delaiReprise,
  libelleMotif,
  lister,
  mettreEnFile,
  nouvelleCle,
  renvoyer,
  type SaisieEnAttente,
} from "../../lib/hors-ligne/file-temps";
import { abonner, obtenirMagasin } from "../../lib/hors-ligne/magasins";
import type { Resultat } from "../../lib/saisie";
import type { Avertissement, LigneCharge, UniteSaisie } from "../../lib/temps";

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
  utilisateurId: string;
  /** Lundi de la semaine (AAAA-MM-JJ). */
  semaine: string;
  unite: UniteSaisie;
  construire: (i: Instantane) => Resultat<{ lignes: LigneCharge[] }, string>;
}

const versInstantane = (e: SaisieEnAttente): Instantane => ({
  feuilleId: e.feuilleId,
  rangees: e.rangees,
  valeurs: e.valeurs,
  modifieLe: e.creeLe,
});

/**
 * Sauvegarde automatique du brouillon : chaque modification est d'abord mise en file sur
 * l'appareil (IndexedDB, voir `lib/hors-ligne`), puis la file est rejouée 1,2 s après la
 * dernière frappe. Une coupure ne perd rien : « en attente d'envoi », nouvelle tentative (2 s,
 * 4 s… 30 s) et au retour du réseau. Un conflit (feuille soumise ou validée, période clôturée)
 * ou un refus de l'API n'est pas retenté : la saisie est gardée et présentée pour décision.
 */
export function useSauvegardeFeuille(options: OptionsSauvegarde) {
  const { feuilleId, utilisateurId } = options;
  const [etat, setEtat] = useState<EtatSaisie>("a_jour");
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreursCases, setErreursCases] = useState<Record<string, string>>({});
  const [avertissements, setAvertissements] = useState<Avertissement[]>([]);
  const [memoireSeule, setMemoireSeule] = useState(false);
  /** Saisie de cette feuille mise de côté (conflit, refus), en attente de décision. */
  const [deCote, setDeCote] = useState<SaisieEnAttente | null>(null);
  const attente = useRef<Instantane | null>(null);
  const ecriture = useRef<Promise<void>>(Promise.resolve());
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envoiEnCours = useRef<Promise<boolean> | null>(null);
  const tentatives = useRef(0);
  const opts = useRef(options);
  opts.current = options;

  const arreterMinuterie = () => {
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = null;
  };

  const entreeDeLaFeuille = useCallback(async () => {
    const m = await obtenirMagasin();
    return (await lister(m, utilisateurId)).find((e) => e.feuilleId === feuilleId);
  }, [feuilleId, utilisateurId]);

  const envoyerUneFois = useCallback(async (): Promise<boolean> => {
    await ecriture.current;
    const i = attente.current;
    if (!i) return true;
    const c = opts.current.construire(i);
    if (!c.ok) {
      setErreursCases(c.erreurs as Record<string, string>);
      setErreur("Certaines cases sont invalides : corrigez-les pour enregistrer.");
      setEtat("refuse");
      return false;
    }
    setErreursCases({});
    setErreur(null);
    setEtat("enregistrement");
    const m = await obtenirMagasin();
    const bilan = await rejouer({ magasin: m, utilisateurId, envoyer: envoyerSaisie }).catch(
      () => null,
    );
    const envoye = bilan?.envoyes.filter((x) => x.feuilleId === feuilleId).at(-1);
    if (envoye)
      setAvertissements((envoye.reponse as ReponseLignes | undefined)?.avertissements ?? []);
    const reste = await entreeDeLaFeuille();
    if (!reste) {
      tentatives.current = 0;
      if (attente.current === i) {
        attente.current = null;
        setEtat("a_jour");
      }
      return true;
    }
    if (reste.etat === "conflit" || reste.etat === "refuse") {
      setDeCote(reste);
      setErreur(libelleMotif(reste.motif));
      setEtat(reste.etat);
      return false;
    }
    if (reste.etat === "a_corriger") {
      setErreur("Certaines cases sont invalides : corrigez-les pour enregistrer.");
      setEtat("refuse");
      return false;
    }
    if (bilan?.arret === "session") {
      setEtat("session");
      return false;
    }
    if (!bilan || bilan.arret === "reseau" || attente.current === i) {
      setEtat("en_attente");
      arreterMinuterie();
      minuterie.current = setTimeout(() => void envoyer(), delaiReprise(tentatives.current++));
      return false;
    }
    // Une saisie plus récente est arrivée pendant le rejeu : `envoyer` relance.
    return true;
    // `envoyer` (relance différée) est stable : il ne dépend que de cette fonction.
  }, [feuilleId, utilisateurId, entreeDeLaFeuille]);

  /** Envoie la file ; un envoi déjà en cours est attendu, puis relancé. */
  const envoyer = useCallback(async (): Promise<boolean> => {
    arreterMinuterie();
    if (envoiEnCours.current) await envoiEnCours.current;
    if (!attente.current) return true;
    const p = envoyerUneFois();
    envoiEnCours.current = p;
    try {
      const ok = await p;
      if (ok && attente.current) return envoyer();
      return ok;
    } finally {
      if (envoiEnCours.current === p) envoiEnCours.current = null;
    }
  }, [envoyerUneFois]);

  const modifier = useCallback(
    (i: Instantane) => {
      attente.current = i;
      setDeCote(null);
      const { construire, semaine, unite } = opts.current;
      const c = construire(i);
      ecriture.current = ecriture.current
        .then(async () => {
          const m = await obtenirMagasin();
          await mettreEnFile(m, {
            cle: nouvelleCle(),
            utilisateurId,
            feuilleId,
            semaine,
            unite,
            creeLe: i.modifieLe,
            rangees: i.rangees,
            valeurs: i.valeurs,
            charge: c.ok ? c.charge : null,
          });
          setMemoireSeule(!m.persistant);
        })
        .catch(() => setMemoireSeule(true));
      setEtat("modifie");
      arreterMinuterie();
      minuterie.current = setTimeout(() => void envoyer(), DELAI_SAISIE_MS);
    },
    [envoyer, feuilleId, utilisateurId],
  );

  /** Reprend une saisie restée en file (sans en créer une nouvelle). */
  const reprendre = useCallback(
    (e: SaisieEnAttente) => {
      attente.current = versInstantane(e);
      if (e.etat === "conflit" || e.etat === "refuse") {
        setDeCote(e);
        setErreur(libelleMotif(e.motif));
        setEtat(e.etat);
        return;
      }
      void envoyer();
    },
    [envoyer],
  );

  /** Décision sur une saisie mise de côté. */
  const decider = useCallback(
    async (choix: "renvoyer" | "abandonner", e: SaisieEnAttente) => {
      const m = await obtenirMagasin();
      setDeCote(null);
      setErreur(null);
      if (choix === "abandonner") {
        await abandonner(m, e.cle);
        attente.current = null;
        setEtat("a_jour");
        return true;
      }
      await renvoyer(m, e.cle);
      attente.current = versInstantane(e);
      return envoyer();
    },
    [envoyer],
  );

  useEffect(() => {
    const reprise = () => {
      if (attente.current) void envoyer();
    };
    window.addEventListener("online", reprise);
    // Décision prise dans un autre onglet ou dans le panneau : l'état affiché suit.
    const desabonner = abonner(() => {
      void entreeDeLaFeuille().then((e) => {
        if (!e && attente.current === null) setDeCote(null);
      });
    });
    return () => {
      window.removeEventListener("online", reprise);
      desabonner();
      arreterMinuterie();
    };
  }, [envoyer, entreeDeLaFeuille]);

  return {
    etat,
    erreur,
    erreursCases,
    avertissements,
    memoireSeule,
    deCote,
    modifier,
    reprendre,
    decider,
    /** Envoie tout de suite ce qui attend (avant la soumission). */
    enregistrerMaintenant: envoyer,
    enAttente: () => attente.current !== null,
  };
}
