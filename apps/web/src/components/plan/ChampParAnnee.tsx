"use client";

import { useId } from "react";
import type { SaisieParAnnee } from "../../lib/plan-hypotheses";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";

export interface ChampParAnneeProps {
  /** Nom du groupe, ex. « Croissance du chiffre d'affaires (%) ». */
  legende: string;
  valeur: SaisieParAnnee;
  onChange: (v: SaisieParAnnee) => void;
  /** Clé d'erreur du champ (« croissance ») ; les années portent « croissance.0 »… */
  cle: string;
  erreurs: Partial<Record<string, string>>;
  requis?: boolean;
  aide?: string;
  /** Exercices de l'horizon, pour nommer les cases (« Année 1 (2027) »). */
  exercices: readonly (number | null)[];
}

/**
 * Hypothèse annuelle du moteur : une seule valeur appliquée chaque année, ou une valeur par
 * année de l'horizon (case à cocher). Les erreurs sont liées à chaque case.
 */
export function ChampParAnnee({
  legende,
  valeur,
  onChange,
  cle,
  erreurs,
  requis,
  aide,
  exercices,
}: ChampParAnneeProps) {
  const id = useId();
  const annuel = valeur.mode === "annuel";
  return (
    <fieldset className="mp-plan-annuel" aria-describedby={aide ? `${id}-aide` : undefined}>
      <legend className="mp-champ__libelle">
        {legende}
        {requis ? (
          <span className="mp-champ__requis">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="mp-visuellement-cache">(obligatoire)</span>
          </span>
        ) : null}
      </legend>
      {aide ? (
        <p className="mp-champ__aide" id={`${id}-aide`}>
          {aide}
        </p>
      ) : null}
      <CaseACocher
        libelle="Une valeur par année"
        checked={annuel}
        onChange={(e) => onChange({ ...valeur, mode: e.target.checked ? "annuel" : "unique" })}
      />
      {annuel ? (
        <div className="mp-plan-annuel__annees">
          {valeur.annees.map((v, i) => (
            <Champ
              key={i}
              libelle={`Année ${i + 1}${exercices[i] ? ` (${exercices[i]})` : ""}`}
              inputMode="decimal"
              autoComplete="off"
              value={v}
              onChange={(e) =>
                onChange({
                  ...valeur,
                  annees: valeur.annees.map((x, j) => (j === i ? e.target.value : x)),
                })
              }
              erreur={erreurs[`${cle}.${i}`] ?? (i === 0 ? erreurs[cle] : undefined)}
            />
          ))}
        </div>
      ) : (
        <Champ
          libelle="Chaque année"
          inputMode="decimal"
          autoComplete="off"
          value={valeur.unique}
          onChange={(e) => onChange({ ...valeur, unique: e.target.value })}
          erreur={erreurs[cle]}
        />
      )}
    </fieldset>
  );
}
