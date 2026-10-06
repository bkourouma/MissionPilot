import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Icone } from "./Icone";

export interface CaseACocherProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "id"
> {
  libelle: ReactNode;
  aide?: ReactNode;
  id?: string;
}

/** Case à cocher avec libellé cliquable (cible tactile de 44 px). */
export function CaseACocher({ libelle, aide, id, className, ...reste }: CaseACocherProps) {
  const auto = useId();
  const idCase = id ?? auto;
  const idAide = aide ? `${idCase}-aide` : undefined;
  return (
    <div className={className ? `mp-case ${className}` : "mp-case"}>
      <input
        {...reste}
        type="checkbox"
        id={idCase}
        className="mp-case__controle"
        aria-describedby={
          [reste["aria-describedby"], idAide].filter(Boolean).join(" ") || undefined
        }
      />
      <label htmlFor={idCase} className="mp-case__libelle">
        {libelle}
        {aide ? (
          <span id={idAide} className="mp-case__aide">
            {aide}
          </span>
        ) : null}
      </label>
    </div>
  );
}

export interface GroupeCasesProps {
  legende: string;
  aide?: ReactNode;
  erreur?: string;
  requis?: boolean;
  options: readonly { valeur: string; libelle: string }[];
  valeurs: readonly string[];
  onChange: (valeurs: string[]) => void;
  /** Préfixe du nom des cases (envoi de formulaire, tests). */
  nom: string;
  disposition?: "colonne" | "ligne";
  desactive?: boolean;
}

/** Groupe de cases dans un fieldset : la légende nomme le groupe, l'erreur lui est liée. */
export function GroupeCases({
  legende,
  aide,
  erreur,
  requis,
  options,
  valeurs,
  onChange,
  nom,
  disposition = "colonne",
  desactive,
}: GroupeCasesProps) {
  const id = useId();
  const idAide = aide ? `${id}-aide` : undefined;
  const idErreur = erreur ? `${id}-erreur` : undefined;
  const basculer = (v: string, coche: boolean) =>
    onChange(coche ? [...valeurs, v] : valeurs.filter((x) => x !== v));
  return (
    <fieldset
      className={erreur ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}
      aria-describedby={[idAide, idErreur].filter(Boolean).join(" ") || undefined}
      aria-invalid={erreur ? true : undefined}
      disabled={desactive}
    >
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
        <p className="mp-champ__aide" id={idAide}>
          {aide}
        </p>
      ) : null}
      <div className={`mp-groupe__options mp-groupe__options--${disposition}`}>
        {options.map((o) => (
          <CaseACocher
            key={o.valeur}
            name={`${nom}`}
            value={o.valeur}
            libelle={o.libelle}
            checked={valeurs.includes(o.valeur)}
            onChange={(e) => basculer(o.valeur, e.target.checked)}
          />
        ))}
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
