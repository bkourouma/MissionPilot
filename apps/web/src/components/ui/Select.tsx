import { useId, type ReactNode, type Ref, type SelectHTMLAttributes } from "react";
import { CadreChamp, idsDescription } from "./Champ";

export interface OptionSelect {
  valeur: string;
  libelle: string;
  desactivee?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  libelle: string;
  options: readonly OptionSelect[];
  /** Première option vide (« Choisir… »), utile quand aucune valeur n'est imposée. */
  invite?: string;
  aide?: ReactNode;
  erreur?: string;
  id?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** Liste déroulante native (meilleure accessibilité et ergonomie mobile qu'un composant maison). */
export function Select({
  libelle,
  options,
  invite,
  aide,
  erreur,
  id,
  required,
  className,
  ...reste
}: SelectProps) {
  const auto = useId();
  const idChamp = id ?? auto;
  const { describedBy } = idsDescription(idChamp, Boolean(aide), Boolean(erreur));
  return (
    <CadreChamp id={idChamp} libelle={libelle} aide={aide} erreur={erreur} requis={required}>
      <select
        {...reste}
        id={idChamp}
        required={required}
        className={
          className ? `mp-champ__controle mp-select ${className}` : "mp-champ__controle mp-select"
        }
        aria-invalid={erreur ? true : undefined}
        aria-describedby={describedBy}
      >
        {invite !== undefined ? <option value="">{invite}</option> : null}
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur} disabled={o.desactivee}>
            {o.libelle}
          </option>
        ))}
      </select>
    </CadreChamp>
  );
}
