import { useId, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { CadreChamp, idsDescription } from "./Champ";

export interface ZoneTexteProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  libelle: string;
  aide?: ReactNode;
  erreur?: string;
  id?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Zone de texte multiligne, même structure accessible que `Champ`. */
export function ZoneTexte({
  libelle,
  aide,
  erreur,
  id,
  required,
  rows = 3,
  ...reste
}: ZoneTexteProps) {
  const auto = useId();
  const idChamp = id ?? auto;
  const { describedBy } = idsDescription(idChamp, Boolean(aide), Boolean(erreur));
  return (
    <CadreChamp id={idChamp} libelle={libelle} aide={aide} erreur={erreur} requis={required}>
      <textarea
        {...reste}
        id={idChamp}
        rows={rows}
        required={required}
        className="mp-champ__controle mp-zone-texte"
        aria-invalid={erreur ? true : undefined}
        aria-describedby={describedBy}
      />
    </CadreChamp>
  );
}
