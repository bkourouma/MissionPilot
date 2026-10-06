"use client";

import { useState } from "react";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { api } from "../../../../lib/api";
import {
  confirmationDemandee,
  messageReconfirmation,
  SAISIE_CONFIRMATION_VIDE,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "../../../../lib/double-authentification";
import { avecConfirmationIa, messageErreurIa, type ParametresIa } from "../../../../lib/ia";
import type { Resultat } from "../../../../lib/saisie";

export interface OptionsEnregistrementIa {
  succes: string;
  /** Ce changement exige la reconfirmation (clé API, hausse du plafond) : elle est jointe. */
  exigerConfirmation?: boolean;
}

/**
 * Enregistrement d'une partie des paramètres IA (PUT /api/ia/parametres). La reconfirmation
 * d'identité est jointe quand le changement l'exige, ou dès que l'API la demande (403
 * CONFIRMATION_REQUISE). Mot de passe et code sont effacés après chaque envoi.
 */
export function useEnregistrementIa<K extends string>() {
  const f = useFormulaire<K | ChampConfirmation>();
  const [confirmation, setConfirmation] = useState<SaisieConfirmation | null>(null);

  async function enregistrer<C extends object>(
    v: Resultat<C, K>,
    options: OptionsEnregistrementIa,
  ): Promise<boolean> {
    const saisie = options.exigerConfirmation
      ? (confirmation ?? SAISIE_CONFIRMATION_VIDE)
      : confirmation;
    const ok = await f.envoyer(
      avecConfirmationIa(v, saisie),
      (c) => api.put<ParametresIa>("/api/ia/parametres", c, { redirigerSi401: false }),
      {
        succes: options.succes,
        messageSpecifique: (e) => {
          if (confirmationDemandee(e)) setConfirmation((c) => c ?? SAISIE_CONFIRMATION_VIDE);
          return messageReconfirmation(e, saisie?.facteur ?? "totp") ?? messageErreurIa(e);
        },
      },
    );
    setConfirmation((c) => (ok ? null : c ? { ...c, motDePasse: "", code: "" } : c));
    return ok;
  }

  return { f, confirmation, setConfirmation, enregistrer };
}
