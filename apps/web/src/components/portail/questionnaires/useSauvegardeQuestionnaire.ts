"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import {
  ANNONCE_BROUILLON,
  cheminApiReponses,
  delaiNouvelleTentative,
  estReessayable,
  issueRefus,
  type EtatSauvegarde,
  type IssueRefus,
  type QuestionnairePortail,
  type ValeurReponse,
} from "../../../lib/portail-questionnaires";
import type { ChargeBrouillon } from "../../../lib/portail-questionnaires-saisie";

/** Délai d'inactivité avant l'enregistrement automatique. */
const DELAI_SAISIE_MS = 2_000;
/** Pendant une saisie continue, un enregistrement au moins toutes les 10 s. */
const ATTENTE_MAX_MS = 10_000;
/** Envois enchaînés au plus par passage (saisie pendant l'échange, questions refusées écartées). */
const PASSAGES_MAX = 4;

export type Envoye = Readonly<Record<string, ValeurReponse | null>>;

export interface OptionsSauvegarde {
  questionnaireId: string;
  derniereSauvegarde: string | null;
  /** Réponses à envoyer maintenant et champs non enregistrables (invalides, refusés, conflits). */
  preparer: () => ChargeBrouillon;
  /** Intègre la réponse du serveur à une sauvegarde réussie. */
  appliquer: (vue: QuestionnairePortail, envoye: Envoye) => void;
  /**
   * Refus non retentable. `true` : l'appelant a écarté les questions refusées, renvoyer le
   * reste aussitôt ; `false` : arrêt (verrouillage, droits… traités par l'appelant).
   */
  refuser: (e: unknown, issue: IssueRefus) => boolean;
  annoncer: (message: string) => void;
}

type Passage = "envoye" | "rien" | "echec" | "reprendre";

/**
 * Sauvegarde automatique du brouillon d'un questionnaire : 2 s après la dernière modification
 * (au moins toutes les 10 s pendant une saisie continue), ou à la demande. Les envois sont
 * sérialisés (jamais deux à la fois) ; une coupure ou une indisponibilité est retentée (2 s,
 * 4 s… 30 s, et au retour du réseau). Rien n'est gardé dans le navigateur : tant qu'une saisie
 * n'est pas enregistrée, quitter la page demande une confirmation.
 */
export function useSauvegardeQuestionnaire(options: OptionsSauvegarde) {
  const [etat, setEtatAffiche] = useState<EtatSauvegarde>("a_jour");
  const [derniere, setDerniere] = useState<string | null>(options.derniereSauvegarde);
  const etatRef = useRef<EtatSauvegarde>("a_jour");
  const opts = useRef(options);
  opts.current = options;
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const premiere = useRef<number | null>(null);
  const tentatives = useRef(0);
  const chaine = useRef<Promise<unknown>>(Promise.resolve());
  const relancer = useRef<() => void>(() => undefined);

  /** Lu à chaque appel : l'état change pendant les échanges (TypeScript ne le voit pas). */
  const estBloque = () => etatRef.current === "bloque";

  const setEtat = useCallback((e: EtatSauvegarde) => {
    etatRef.current = e;
    setEtatAffiche(e);
  }, []);

  const arreterMinuterie = () => {
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = null;
  };

  const programmer = useCallback((delai: number) => {
    arreterMinuterie();
    minuterie.current = setTimeout(() => relancer.current(), delai);
  }, []);

  const passage = useCallback(async (): Promise<Passage> => {
    const charge = opts.current.preparer();
    if (Object.keys(charge.reponses).length === 0) return "rien";
    setEtat("enregistrement");
    try {
      const vue = await api.patch<QuestionnairePortail>(
        cheminApiReponses(opts.current.questionnaireId),
        { reponses: charge.reponses },
        { redirigerSi401: false },
      );
      tentatives.current = 0;
      opts.current.appliquer(vue, charge.reponses);
      setDerniere(vue.reponse.derniere_saisie ?? new Date().toISOString());
      return "envoye";
    } catch (e) {
      const issue = issueRefus(e);
      if (estReessayable(issue)) {
        setEtat(issue === "reseau" ? "hors_ligne" : "indisponible");
        programmer(delaiNouvelleTentative(tentatives.current++));
        return "echec";
      }
      if (issue === "session") {
        setEtat("session");
        return "echec";
      }
      if (opts.current.refuser(e, issue)) return "reprendre";
      if (!estBloque()) {
        setEtat(issue === "invalide" || issue === "autre" ? "refuse" : "bloque");
      }
      return "echec";
    }
  }, [programmer, setEtat]);

  /** Envoie tout ce qui attend ; `envoye` : au moins une sauvegarde a abouti. */
  const boucle = useCallback(async (): Promise<{ ok: boolean; envoye: boolean }> => {
    if (estBloque()) return { ok: false, envoye: false };
    let envoye = false;
    for (let i = 0; i < PASSAGES_MAX; i++) {
      const r = await passage();
      if (r === "echec") return { ok: false, envoye };
      if (r === "rien") break;
      if (r === "envoye") envoye = true;
    }
    if (estBloque()) return { ok: false, envoye };
    premiere.current = null;
    const reste = opts.current.preparer();
    const enAttente = Object.keys(reste.reponses).length > 0;
    setEtat(reste.invalides.length > 0 ? "refuse" : enAttente ? "modifie" : "a_jour");
    if (enAttente) programmer(DELAI_SAISIE_MS);
    if (envoye) opts.current.annoncer(ANNONCE_BROUILLON);
    return { ok: !enAttente, envoye };
  }, [passage, programmer, setEtat]);

  const enFileBilan = useCallback(() => {
    arreterMinuterie();
    const p = chaine.current.then(boucle, boucle);
    chaine.current = p.catch(() => undefined);
    return p;
  }, [boucle]);

  /** Enregistre maintenant ce qui attend ; `true` si plus rien de valide n'attend. */
  const envoyer = useCallback(async () => (await enFileBilan()).ok, [enFileBilan]);
  relancer.current = () => void envoyer();

  /** Bouton « Enregistrer le brouillon » : annonce aussi quand tout était déjà enregistré. */
  const enregistrer = useCallback(async () => {
    tentatives.current = 0;
    const r = await enFileBilan();
    if (r.ok && !r.envoye) opts.current.annoncer("Toutes vos réponses sont déjà enregistrées.");
    return r.ok;
  }, [enFileBilan]);

  /** Exécute une tâche entre deux sauvegardes (jamais en même temps qu'un envoi). */
  const enFile = useCallback(<T>(tache: () => Promise<T>): Promise<T> => {
    const p = chaine.current.then(tache, tache);
    chaine.current = p.catch(() => undefined);
    return p;
  }, []);

  /** Une modification vient d'être saisie : enregistrement différé. */
  const signaler = useCallback(() => {
    if (estBloque()) return;
    if (etatRef.current !== "session") setEtat("modifie");
    const maintenant = Date.now();
    premiere.current ??= maintenant;
    programmer(maintenant - premiere.current >= ATTENTE_MAX_MS ? 0 : DELAI_SAISIE_MS);
  }, [programmer, setEtat]);

  /** Arrête toute sauvegarde (questionnaire envoyé, verrouillé, clos ou inaccessible). */
  const bloquer = useCallback(() => {
    arreterMinuterie();
    setEtat("bloque");
  }, [setEtat]);

  useEffect(() => {
    const reprise = () => {
      if (etatRef.current === "hors_ligne" || etatRef.current === "indisponible") {
        tentatives.current = 0;
        relancer.current();
      }
    };
    const avantDepart = (ev: BeforeUnloadEvent) => {
      if (etatRef.current === "a_jour" || etatRef.current === "bloque") return;
      ev.preventDefault();
      // Navigateurs anciens (Chrome < 119) : la confirmation exige aussi `returnValue`.
      ev.returnValue = true;
    };
    // Téléphone : l'application passe en arrière-plan (et peut être fermée) : on enregistre.
    const masquage = () => {
      if (document.visibilityState === "hidden" && etatRef.current === "modifie") {
        relancer.current();
      }
    };
    window.addEventListener("online", reprise);
    window.addEventListener("beforeunload", avantDepart);
    document.addEventListener("visibilitychange", masquage);
    return () => {
      window.removeEventListener("online", reprise);
      window.removeEventListener("beforeunload", avantDepart);
      document.removeEventListener("visibilitychange", masquage);
      // Navigation interne (lien de la barre) : la saisie en attente part quand même.
      const enAttente = minuterie.current !== null && etatRef.current === "modifie";
      arreterMinuterie();
      if (enAttente) relancer.current();
    };
  }, []);

  return { etat, derniere, signaler, envoyer, enregistrer, enFile, bloquer };
}
