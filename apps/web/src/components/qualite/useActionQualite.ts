"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  etatQualiteChange,
  messageQualite,
  violationsDeErreur,
  type Violation,
} from "../../lib/qualite";

/**
 * Action de l'écran qualité (marquer vu, vérifier, valider, signer…) : un appel à l'API,
 * l'erreur globale focalisée et annoncée, les violations de garde conservées, puis le
 * rafraîchissement des données serveur. Après un refus 404/409, l'état affiché est périmé : la
 * page est rafraîchie aussi.
 */
export function useActionQualite() {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const refAlerte = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function agir<R>(appel: () => Promise<R>, messageSucces?: string): Promise<R | undefined> {
    setErreur(null);
    setSucces(null);
    setViolations([]);
    setEnCours(true);
    try {
      const r = await appel();
      if (messageSucces) setSucces(messageSucces);
      router.refresh();
      return r;
    } catch (e) {
      setErreur(messageQualite(e));
      setViolations(violationsDeErreur(e));
      if (etatQualiteChange(e)) router.refresh();
      return undefined;
    } finally {
      setEnCours(false);
    }
  }

  return { enCours, erreur, succes, violations, refAlerte, agir };
}
