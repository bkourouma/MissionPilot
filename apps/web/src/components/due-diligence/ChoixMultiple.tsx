"use client";

import { useId, useState } from "react";
import { Bouton } from "../ui/Bouton";
import { Select, type OptionSelect } from "../ui/Select";

export interface ChoixMultipleProps {
  libelle: string;
  options: readonly OptionSelect[];
  valeurs: readonly string[];
  onChange: (valeurs: string[]) => void;
  aide?: string;
  erreur?: string;
  /** Texte du bouton d'ajout. */
  libelleAjout?: string;
  /** Nombre maximal d'éléments (au-delà, l'ajout est désactivé). */
  max?: number;
}

/**
 * Choix de plusieurs éléments dans une longue liste (secteurs, pays) : une liste déroulante
 * native, un bouton « Ajouter » et des puces retirables au clavier. Les valeurs sont des codes de
 * référentiel, toujours affichés par leur libellé.
 */
export function ChoixMultiple({
  libelle,
  options,
  valeurs,
  onChange,
  aide,
  erreur,
  libelleAjout = "Ajouter",
  max = 20,
}: ChoixMultipleProps) {
  const id = useId();
  const [courant, setCourant] = useState("");
  const libelleDe = (v: string) =>
    options.find((o) => o.valeur === v)?.libelle ?? "Libellé indisponible";
  const disponibles = options.filter((o) => !valeurs.includes(o.valeur));

  function ajouter() {
    if (courant === "" || valeurs.includes(courant) || valeurs.length >= max) return;
    onChange([...valeurs, courant]);
    setCourant("");
  }

  return (
    <div className="mp-choix-multiple">
      <Select
        libelle={libelle}
        invite="Choisir…"
        options={disponibles}
        value={courant}
        onChange={(e) => setCourant(e.target.value)}
        aide={aide}
        erreur={erreur}
      />
      <div>
        <Bouton
          variante="secondaire"
          icone="plus"
          disabled={courant === "" || valeurs.length >= max}
          onClick={ajouter}
        >
          {libelleAjout}
        </Bouton>
      </div>
      {valeurs.length > 0 ? (
        <ul
          className="mp-choix-multiple__puces"
          aria-label={`${libelle} : éléments retenus`}
          id={`${id}-liste`}
        >
          {valeurs.map((v) => (
            <li key={v} className="mp-choix-multiple__puce">
              <span>{libelleDe(v)}</span>
              <button
                type="button"
                aria-label={`Retirer ${libelleDe(v)}`}
                onClick={() => onChange(valeurs.filter((x) => x !== v))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mp-texte-doux mp-texte-petit">Aucun élément retenu.</p>
      )}
    </div>
  );
}
