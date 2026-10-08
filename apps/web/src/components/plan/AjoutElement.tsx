"use client";

import { useEffect, useRef, useState } from "react";
import type { TypeElementPlan } from "@missionpilot/shared";
import type { Devise } from "../../lib/format";
import type { OptionInitiative, PersonnePlan } from "../../lib/plan-elements";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { FormulaireElement } from "./FormulaireElement";

export interface AjoutElementProps {
  planId: string;
  type: TypeElementPlan;
  /** Axe (pour un objectif) ou axe/objectif (pour une initiative). */
  parentId?: string;
  libelle: string;
  horizon: number;
  devise: Devise;
  personnes: readonly PersonnePlan[];
  /** Initiatives du plan : prédécesseurs proposés à une nouvelle initiative (PLA-05). */
  initiatives?: readonly OptionInitiative[];
  partage: boolean;
  /** Formulaire ouvert d'emblée (contenu encore absent du plan). */
  ouvertParDefaut?: boolean;
  /**
   * Message de réussite remonté au parent (qui l'affiche) : utile quand ce composant disparaît
   * après la création (contenu unique : diagnostic, SWOT, vision et mission).
   */
  onCree?: (message: string) => void;
}

/** Bouton « Ajouter… » qui déplie le formulaire de création (version 1, brouillon). */
export function AjoutElement({
  planId,
  type,
  parentId,
  libelle,
  horizon,
  devise,
  personnes,
  initiatives = [],
  partage,
  ouvertParDefaut = false,
  onCree,
}: AjoutElementProps) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  const [succes, setSucces] = useState<string | null>(null);
  const refSucces = useRef<HTMLDivElement>(null);
  const refBouton = useRef<HTMLButtonElement>(null);
  const [rendreFocus, setRendreFocus] = useState(false);

  useEffect(() => {
    if (succes) refSucces.current?.focus();
  }, [succes]);
  useEffect(() => {
    if (rendreFocus && !ouvert) refBouton.current?.focus();
  }, [rendreFocus, ouvert]);

  return (
    <div className="mp-plan__section">
      {succes ? (
        <Alerte ref={refSucces} tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      {ouvert ? (
        <FormulaireElement
          planId={planId}
          type={type}
          mode={{ nature: "creation", parentId }}
          horizon={horizon}
          devise={devise}
          personnes={personnes}
          initiatives={initiatives}
          partage={partage}
          onAnnuler={
            ouvertParDefaut
              ? undefined
              : () => {
                  setRendreFocus(true);
                  setOuvert(false);
                }
          }
          onTermine={(message) => {
            setOuvert(ouvertParDefaut);
            if (onCree) onCree(message);
            else setSucces(message);
          }}
        />
      ) : (
        <div>
          <Bouton
            ref={refBouton}
            variante="secondaire"
            icone="plus"
            onClick={() => {
              setSucces(null);
              setRendreFocus(false);
              setOuvert(true);
            }}
          >
            {libelle}
          </Bouton>
        </div>
      )}
    </div>
  );
}
