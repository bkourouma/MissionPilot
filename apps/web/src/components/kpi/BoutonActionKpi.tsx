"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { messagePilotage } from "../../lib/kpi-pilotage";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { Bouton, type VarianteBouton } from "../ui/Bouton";
import { useEffacementSucces } from "./useEffacementSucces";

export interface ConfirmationActionKpi {
  /** Question posée avant l'action, ex. « Annuler cette revue ? Cet état est définitif. ». */
  question: string;
  /** Libellé du bouton de confirmation, ex. « Oui, annuler la revue ». */
  libelleConfirmation: string;
}

export interface BoutonActionKpiProps {
  libelle: string;
  chemin: string;
  methode?: "POST" | "PATCH" | "PUT";
  corps?: unknown;
  /** Message annoncé après succès. */
  succes: string;
  titreErreur?: string;
  variante?: VarianteBouton;
  texteChargement?: string;
  /**
   * Action irréversible ou lourde de conséquences (annuler, tenir, clôturer une revue) : un
   * premier clic demande confirmation (`BoutonConfirmation`), le second lance l'appel.
   */
  confirmation?: ConfirmationActionKpi;
}

/**
 * Action d'un clic sur l'API du pilotage augmenté (générer l'ordre du jour, tenir ou clôturer une
 * revue, passer une action « en cours »…) : appel authentifié par le cookie de session, erreur
 * focalisée et annoncée, page rafraîchie après succès. L'API reste seule juge de l'état. Avec
 * `confirmation`, l'appel ne part qu'après un second clic.
 */
export function BoutonActionKpi({
  libelle,
  chemin,
  methode = "POST",
  corps = {},
  succes,
  titreErreur = "Action impossible",
  variante = "secondaire",
  texteChargement = "En cours…",
  confirmation,
}: BoutonActionKpiProps) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reussi, setReussi] = useState<string | null>(null);
  const refAlerte = useRef<HTMLDivElement>(null);
  // Le message de réussite s'efface dès qu'une autre action démarre sur la page.
  const signaler = useEffacementSucces(() => setReussi(null));
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  /** Vrai si l'appel a abouti (la confirmation revient alors à son état de repos après rafraîchissement). */
  async function lancer(): Promise<boolean> {
    signaler();
    setErreur(null);
    setReussi(null);
    setEnCours(true);
    try {
      if (methode === "POST") await api.post(chemin, corps);
      else if (methode === "PUT") await api.put(chemin, corps);
      else await api.patch(chemin, corps);
      setReussi(succes);
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messagePilotage(e));
      return false;
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={erreur}
        succes={reussi}
        refAlerte={refAlerte}
        titreErreur={titreErreur}
      />
      <div className="mp-actions-formulaire">
        {confirmation ? (
          <BoutonConfirmation
            libelle={libelle}
            question={confirmation.question}
            libelleConfirmation={confirmation.libelleConfirmation}
            variante={variante}
            texteChargement={texteChargement}
            action={lancer}
          />
        ) : (
          <Bouton
            variante={variante}
            chargement={enCours}
            texteChargement={texteChargement}
            onClick={() => void lancer()}
          >
            {libelle}
          </Bouton>
        )}
      </div>
    </div>
  );
}
