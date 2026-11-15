"use client";

import { useEffect, useState } from "react";
import { lireNombre } from "../../lib/saisie";
import { useT } from "../i18n/FournisseurLangue";
import { Champ } from "../ui/Champ";

export interface ChampNombreProps {
  libelle: string;
  valeur: number | undefined;
  /** Appelé avec le nombre lu, ou `undefined` si le champ (facultatif) est vidé. */
  onChange: (valeur: number | undefined) => void;
  entier?: boolean;
  aide?: string;
  erreur?: string;
  requis?: boolean;
  name?: string;
}

const versTexte = (v: number | undefined) => (v === undefined ? "" : String(v).replace(".", ","));

/**
 * Nombre saisi à la française (« 2,5 », « 1 500 ») : le texte reste tel que tapé, seul un
 * nombre lisible est transmis ; une saisie illisible est signalée sans être transmise.
 */
export function ChampNombre({
  libelle,
  valeur,
  onChange,
  entier = false,
  aide,
  erreur,
  requis,
  name,
}: ChampNombreProps) {
  const t = useT();
  const [texte, setTexte] = useState(() => versTexte(valeur));
  const [probleme, setProbleme] = useState<"illisible" | "vide" | null>(null);

  // Valeur changée de l'extérieur (changement de type, échelle type) : on la reprend.
  useEffect(() => {
    setTexte((courant) => {
      const lu = lireNombre(courant);
      return lu === (valeur ?? null) ? courant : versTexte(valeur);
    });
  }, [valeur]);

  return (
    <Champ
      libelle={libelle}
      name={name}
      inputMode={entier ? "numeric" : "decimal"}
      autoComplete="off"
      required={requis}
      value={texte}
      aide={aide}
      erreur={
        probleme === "vide"
          ? t("Une valeur est obligatoire.", "A value is required.")
          : probleme === "illisible"
            ? entier
              ? t("Nombre entier attendu (ex. 12).", "Whole number expected (e.g. 12).")
              : t("Nombre attendu (ex. 12 ou 2,5).", "Number expected (e.g. 12 or 2.5).")
            : erreur
      }
      onChange={(e) => {
        const saisi = e.target.value;
        setTexte(saisi);
        const n = lireNombre(saisi);
        if (n === null) {
          // Champ obligatoire vidé : la dernière valeur est gardée, le manque est signalé.
          setProbleme(requis ? "vide" : null);
          if (!requis) onChange(undefined);
        } else if (Number.isNaN(n) || (entier && !Number.isInteger(n))) {
          setProbleme("illisible");
        } else {
          setProbleme(null);
          onChange(n);
        }
      }}
    />
  );
}
