"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { champsRefuses, messageErreur } from "../../lib/api";
import type { Resultat } from "../../lib/saisie";

export const MESSAGE_CHAMP_REFUSE = "Valeur refusée par le serveur : vérifiez ce champ.";

export interface OptionsEnvoi<R> {
  /** Message de succès annoncé (role="status"). */
  succes?: string;
  /** Message propre à une erreur métier (ex. dernier associé), sinon message générique. */
  messageSpecifique?: (e: unknown) => string | null;
  /** Après succès : rafraîchir les données serveur de la page (vrai par défaut). */
  rafraichir?: boolean;
  apres?: (resultat: R) => void;
}

/**
 * État commun d'un formulaire envoyé à l'API : validation locale (messages français, focus
 * sur le premier champ en erreur), appel, erreur globale focalisée, succès annoncé.
 */
export function useFormulaire<K extends string>() {
  const router = useRouter();
  const [erreurs, setErreurs] = useState<Partial<Record<K, string>>>({});
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [tentative, setTentative] = useState(0);
  const refFormulaire = useRef<HTMLFormElement>(null);
  const refAlerte = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tentative === 0) return;
    if (erreurGlobale) {
      refAlerte.current?.focus();
      return;
    }
    const champ = refFormulaire.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"] input, [aria-invalid="true"]:not(fieldset)',
    );
    champ?.focus();
  }, [tentative, erreurGlobale]);

  async function envoyer<C, R>(
    validation: Resultat<C, K>,
    appel: (charge: C) => Promise<R>,
    options: OptionsEnvoi<R> = {},
  ): Promise<boolean> {
    setErreurGlobale(null);
    setSucces(null);
    if (!validation.ok) {
      setErreurs(validation.erreurs);
      setTentative((t) => t + 1);
      return false;
    }
    setErreurs({});
    setEnCours(true);
    try {
      const r = await appel(validation.charge);
      if (options.succes) setSucces(options.succes);
      options.apres?.(r);
      if (options.rafraichir !== false) router.refresh();
      return true;
    } catch (e) {
      const refuses = champsRefuses(e);
      if (refuses.length > 0) {
        setErreurs(
          Object.fromEntries(refuses.map((c) => [c, MESSAGE_CHAMP_REFUSE])) as Partial<
            Record<K, string>
          >,
        );
      }
      setErreurGlobale(options.messageSpecifique?.(e) ?? messageErreur(e));
      setTentative((t) => t + 1);
      return false;
    } finally {
      setEnCours(false);
    }
  }

  return {
    erreurs,
    erreurGlobale,
    succes,
    enCours,
    envoyer,
    refFormulaire,
    refAlerte,
    effacerSucces: () => setSucces(null),
  };
}
