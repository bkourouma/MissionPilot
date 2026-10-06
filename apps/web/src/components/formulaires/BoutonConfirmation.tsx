"use client";

import { useEffect, useRef, useState } from "react";
import { Bouton, type VarianteBouton } from "../ui/Bouton";
import type { NomIcone } from "../ui/Icone";

export interface BoutonConfirmationProps {
  /** Libellé du premier bouton, ex. « Supprimer ». */
  libelle: string;
  /** Question affichée avant confirmation, ex. « Supprimer ce jour férié ? ». */
  question: string;
  /** Libellé du bouton de confirmation, ex. « Oui, supprimer ». */
  libelleConfirmation: string;
  action: () => Promise<boolean | void>;
  variante?: VarianteBouton;
  icone?: NomIcone;
  texteChargement?: string;
  /** Nom accessible complet du premier bouton quand le libellé seul est ambigu. */
  ariaLabel?: string;
}

/**
 * Action sensible en deux temps (sans boîte de dialogue du navigateur, dont les boutons ne
 * sont pas forcément en français) : un premier clic affiche la question et la confirmation.
 */
export function BoutonConfirmation({
  libelle,
  question,
  libelleConfirmation,
  action,
  variante = "secondaire",
  icone,
  texteChargement = "En cours…",
  ariaLabel,
}: BoutonConfirmationProps) {
  const [etape, setEtape] = useState<"repos" | "question">("repos");
  const [enCours, setEnCours] = useState(false);
  const refConfirmer = useRef<HTMLButtonElement>(null);
  const refInitial = useRef<HTMLButtonElement>(null);
  const [rendreFocus, setRendreFocus] = useState(false);

  useEffect(() => {
    if (etape === "question") refConfirmer.current?.focus();
    else if (rendreFocus) refInitial.current?.focus();
  }, [etape, rendreFocus]);

  async function confirmer() {
    setEnCours(true);
    try {
      const r = await action();
      if (r === false) {
        setEtape("repos");
        setRendreFocus(true);
      }
    } finally {
      setEnCours(false);
    }
  }

  if (etape === "repos") {
    return (
      <Bouton
        ref={refInitial}
        variante={variante}
        icone={icone}
        aria-label={ariaLabel}
        onClick={() => {
          setRendreFocus(false);
          setEtape("question");
        }}
      >
        {libelle}
      </Bouton>
    );
  }
  return (
    <div className="mp-confirmation" role="group" aria-label={question}>
      <p className="mp-confirmation__question">{question}</p>
      <div className="mp-confirmation__boutons">
        <Bouton
          ref={refConfirmer}
          variante="danger"
          chargement={enCours}
          texteChargement={texteChargement}
          onClick={confirmer}
        >
          {libelleConfirmation}
        </Bouton>
        <Bouton
          variante="secondaire"
          disabled={enCours}
          onClick={() => {
            setRendreFocus(true);
            setEtape("repos");
          }}
        >
          Annuler
        </Bouton>
      </div>
    </div>
  );
}
