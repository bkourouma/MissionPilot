import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { T } from "../i18n/T";
import { Icone } from "./Icone";

export interface CaseACocherProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "id"
> {
  libelle: ReactNode;
  aide?: ReactNode;
  /** Message d'erreur en ligne (icône + texte), lié à la case par aria-describedby. */
  erreur?: string;
  id?: string;
}

/** Case à cocher avec libellé cliquable (cible tactile de 44 px). */
export function CaseACocher({ libelle, aide, erreur, id, className, ...reste }: CaseACocherProps) {
  const auto = useId();
  const idCase = id ?? auto;
  const idAide = aide ? `${idCase}-aide` : undefined;
  const idErreur = erreur ? `${idCase}-erreur` : undefined;
  const classes = ["mp-case", erreur ? "mp-case--erreur" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <input
        {...reste}
        type="checkbox"
        id={idCase}
        className="mp-case__controle"
        aria-invalid={erreur ? true : reste["aria-invalid"]}
        aria-describedby={
          [reste["aria-describedby"], idAide, idErreur].filter(Boolean).join(" ") || undefined
        }
      />
      <div className="mp-case__texte">
        <label htmlFor={idCase} className="mp-case__libelle">
          {libelle}
          {aide ? (
            <span id={idAide} className="mp-case__aide">
              {aide}
            </span>
          ) : null}
        </label>
        {erreur ? (
          <p className="mp-champ__erreur" id={idErreur}>
            <Icone nom="attention" taille={16} />
            <span>{erreur}</span>
          </p>
        ) : null}
      </div>
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
      disabled={desactive}
    >
      <legend className="mp-champ__libelle">
        {legende}
        {requis ? (
          <span className="mp-champ__requis">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="mp-visuellement-cache">
              <T fr="(obligatoire)" en="(required)" />
            </span>
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
