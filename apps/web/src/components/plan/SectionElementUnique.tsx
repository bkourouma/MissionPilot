"use client";

import { useEffect, useRef, useState } from "react";
import type { TypeElementPlan } from "@missionpilot/shared";
import type { Devise } from "../../lib/format";
import type { PersonnePlan } from "../../lib/plan-elements";
import type { ElementPlan } from "../../lib/plan-strategique";
import { Alerte } from "../ui/Alerte";
import { EtatVide } from "../ui/EtatListe";
import { AjoutElement } from "./AjoutElement";
import { ElementPlanCarte, type DroitsElement } from "./ElementPlanCarte";

export interface SectionElementUniqueProps {
  planId: string;
  type: TypeElementPlan;
  element: ElementPlan | null;
  horizon: number;
  devise: Devise;
  personnes: readonly PersonnePlan[];
  partage: boolean;
  droits: DroitsElement;
  libelleAjout: string;
  /** Explication de l'état vide. */
  texteVide: string;
}

/**
 * Contenu présent au plus une fois par plan (diagnostic, SWOT, vision et mission) : la carte
 * du contenu, ou l'état vide et son formulaire d'ajout. Le message de réussite est gardé ici
 * pour survivre au passage du formulaire à la carte.
 */
export function SectionElementUnique({
  planId,
  type,
  element,
  horizon,
  devise,
  personnes,
  partage,
  droits,
  libelleAjout,
  texteVide,
}: SectionElementUniqueProps) {
  const [succes, setSucces] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (succes) ref.current?.focus();
  }, [succes]);

  return (
    <div className="mp-plan__section">
      {succes ? (
        <Alerte ref={ref} tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      {element ? (
        <ElementPlanCarte
          planId={planId}
          element={element}
          horizon={horizon}
          devise={devise}
          personnes={personnes}
          partage={partage}
          droits={droits}
        />
      ) : (
        <>
          <EtatVide titre="Pas encore rédigé." icone="crayon">
            <p>{texteVide}</p>
          </EtatVide>
          {droits.rediger ? (
            <AjoutElement
              planId={planId}
              type={type}
              libelle={libelleAjout}
              horizon={horizon}
              devise={devise}
              personnes={personnes}
              partage={partage}
              onCree={setSucces}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
