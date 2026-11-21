import { useId, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { CadreChamp, idsDescription } from "./Champ";
import { longueurSaisie } from "./ZoneTexte.aide";
import { ZoneTexteCompteur } from "./ZoneTexteCompteur";

export interface ZoneTexteProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  libelle: string;
  aide?: ReactNode;
  erreur?: string;
  id?: string;
  /** Affiche un compteur de caractères (« 12 / 500 » si `maxLength` est posé). */
  compteur?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Zone de texte multiligne, même structure accessible que `Champ`. Redimensionnable en vertical. */
export function ZoneTexte({
  libelle,
  aide,
  erreur,
  id,
  required,
  rows = 3,
  compteur = false,
  className,
  ...reste
}: ZoneTexteProps) {
  const auto = useId();
  const idChamp = id ?? auto;
  const { describedBy } = idsDescription(
    idChamp,
    Boolean(aide),
    Boolean(erreur),
    reste["aria-describedby"],
  );
  const controlee = reste.value !== undefined;
  return (
    <CadreChamp id={idChamp} libelle={libelle} aide={aide} erreur={erreur} requis={required}>
      <textarea
        {...reste}
        id={idChamp}
        rows={rows}
        required={required}
        className={
          className
            ? `mp-champ__controle mp-zone-texte ${className}`
            : "mp-champ__controle mp-zone-texte"
        }
        aria-invalid={erreur ? true : reste["aria-invalid"]}
        aria-describedby={describedBy}
      />
      {compteur ? (
        <ZoneTexteCompteur
          idZone={idChamp}
          max={reste.maxLength}
          longueurControlee={controlee ? longueurSaisie(reste.value) : undefined}
          longueurInitiale={longueurSaisie(reste.defaultValue)}
        />
      ) : null}
    </CadreChamp>
  );
}
