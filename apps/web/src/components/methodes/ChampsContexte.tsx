"use client";

import type { Facteur, SaisieContexte } from "../../lib/methodes";
import { GroupeCases } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

/**
 * Saisie d'un contexte de mission, champ par facteur typé (STD-04) : oui/non, nombre, liste
 * déroulante ou cases à cocher. Un champ laissé vide = facteur non renseigné (une règle ne se
 * déclenche jamais sur une donnée inconnue).
 */
export function ChampsContexte({
  facteurs,
  valeur,
  onChange,
  erreurs = {},
  prefixe,
}: {
  facteurs: Facteur[];
  valeur: SaisieContexte;
  onChange: (v: SaisieContexte) => void;
  erreurs?: Partial<Record<string, string>>;
  prefixe: string;
}) {
  const maj = (code: string, v: string | string[]) => onChange({ ...valeur, [code]: v });
  return (
    <div className="mp-grille-champs">
      {facteurs.map((f) => {
        const v = valeur[f.code];
        if (f.type === "liste") {
          return (
            <GroupeCases
              key={f.code}
              nom={`${prefixe}-${f.code}`}
              legende={f.libelle}
              options={(f.valeurs ?? []).map((x) => ({ valeur: x.code, libelle: x.libelle }))}
              valeurs={Array.isArray(v) ? v : []}
              onChange={(l) => maj(f.code, l)}
              erreur={erreurs[f.code]}
            />
          );
        }
        if (f.type === "nombre") {
          return (
            <Champ
              key={f.code}
              libelle={f.libelle}
              inputMode="decimal"
              value={typeof v === "string" ? v : ""}
              onChange={(e) => maj(f.code, e.target.value)}
              erreur={erreurs[f.code]}
            />
          );
        }
        const options =
          f.type === "booleen"
            ? [
                { valeur: "oui", libelle: "Oui" },
                { valeur: "non", libelle: "Non" },
              ]
            : (f.valeurs ?? []).map((x) => ({ valeur: x.code, libelle: x.libelle }));
        return (
          <Select
            key={f.code}
            libelle={f.libelle}
            value={typeof v === "string" ? v : ""}
            onChange={(e) => maj(f.code, e.target.value)}
            invite="Non renseigné"
            options={options}
            erreur={erreurs[f.code]}
          />
        );
      })}
    </div>
  );
}
