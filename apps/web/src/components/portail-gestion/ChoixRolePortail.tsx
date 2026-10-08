"use client";

import { useId } from "react";
import { Icone } from "../ui/Icone";
import "./portail-gestion.css";

export interface ChoixRolePortailProps {
  options: readonly { valeur: string; libelle: string; aide: string }[];
  valeur: string;
  onChange: (valeur: string) => void;
  erreur?: string;
  desactive?: boolean;
}

/**
 * Rôle d'une personne invitée sur le portail : boutons radio natifs (un seul rôle), chacun
 * accompagné de ce qu'il permet. L'erreur est liée au groupe (aria-describedby).
 */
export function ChoixRolePortail({
  options,
  valeur,
  onChange,
  erreur,
  desactive,
}: ChoixRolePortailProps) {
  const id = useId();
  const idErreur = erreur ? `${id}-erreur` : undefined;
  return (
    <fieldset
      className={erreur ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}
      aria-describedby={idErreur}
      aria-invalid={erreur ? true : undefined}
      disabled={desactive}
    >
      <legend className="mp-champ__libelle">
        Rôle sur le portail
        <span className="mp-champ__requis">
          {" "}
          <span aria-hidden="true">*</span>
          <span className="mp-visuellement-cache">(obligatoire)</span>
        </span>
      </legend>
      <div className="mp-groupe__options mp-groupe__options--colonne">
        {options.map((o) => {
          const idOption = `${id}-${o.valeur}`;
          return (
            <div key={o.valeur} className="mp-case">
              <input
                type="radio"
                id={idOption}
                name={`${id}-role`}
                value={o.valeur}
                className="mp-case__controle"
                checked={valeur === o.valeur}
                onChange={() => onChange(o.valeur)}
                // Nom : le rôle ; description : ce qu'il permet (lu une seule fois).
                aria-labelledby={`${idOption}-nom`}
                aria-describedby={`${idOption}-aide`}
              />
              <label htmlFor={idOption} className="mp-case__libelle">
                <span id={`${idOption}-nom`} className="mp-choix-role__libelle">
                  {o.libelle}
                </span>
                <span id={`${idOption}-aide`} className="mp-case__aide">
                  {o.aide}
                </span>
              </label>
            </div>
          );
        })}
      </div>
      {erreur ? (
        <p className="mp-champ__erreur" id={idErreur}>
          <Icone nom="attention" taille={16} />
          <span>{erreur}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
