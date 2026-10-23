"use client";

import { useEffect, useRef, useState } from "react";
import {
  etatFroideChange,
  messageFroide,
  violationsIndependance,
  type ViolationIndependance,
} from "../../lib/qualite-froide";
import { useRafraichir } from "../formulaires/useRafraichir";

/**
 * Action de la revue à froid (vérifier, affecter, clore, supprimer un constat…) : un appel à
 * l'API, l'erreur globale focalisée et annoncée, les raisons d'inéligibilité conservées, puis le
 * rafraîchissement des données serveur. Après un refus 404/409, l'état affiché est périmé : la
 * page est rafraîchie aussi.
 */
export function useActionFroide() {
  const { rafraichir, enAttente } = useRafraichir();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [violations, setViolations] = useState<ViolationIndependance[]>([]);
  const refAlerte = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function agir<R>(
    appel: () => Promise<R>,
    options: { succes?: string; rafraichir?: boolean } = {},
  ): Promise<{ ok: true; valeur: R } | { ok: false }> {
    setErreur(null);
    setSucces(null);
    setViolations([]);
    setEnCours(true);
    try {
      const valeur = await appel();
      if (options.succes) setSucces(options.succes);
      if (options.rafraichir !== false) rafraichir();
      return { ok: true, valeur };
    } catch (e) {
      setErreur(messageFroide(e));
      setViolations(violationsIndependance(e));
      if (etatFroideChange(e)) rafraichir();
      return { ok: false };
    } finally {
      setEnCours(false);
    }
  }

  return { enCours: enCours || enAttente, erreur, succes, violations, refAlerte, agir };
}
