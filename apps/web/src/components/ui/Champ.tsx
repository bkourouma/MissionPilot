import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { T } from "../i18n/T";
import { Icone } from "./Icone";

/** Identifiants des textes d'aide et d'erreur liés à un champ par aria-describedby. */
export function idsDescription(id: string, aide: boolean, erreur: boolean, extra?: string) {
  const idAide = aide ? `${id}-aide` : undefined;
  const idErreur = erreur ? `${id}-erreur` : undefined;
  // `extra` : aria-describedby fourni par l'appelant, conservé en tête.
  const describedBy = [extra, idAide, idErreur].filter(Boolean).join(" ") || undefined;
  return { idAide, idErreur, describedBy };
}

interface CadreChampProps {
  id: string;
  libelle: string;
  aide?: ReactNode;
  erreur?: string;
  requis?: boolean;
  children: ReactNode;
}

/** Libellé, contrôle, aide et erreur : structure commune à Champ et Select. */
export function CadreChamp({ id, libelle, aide, erreur, requis, children }: CadreChampProps) {
  const { idAide, idErreur } = idsDescription(id, Boolean(aide), Boolean(erreur));
  return (
    <div className={erreur ? "mp-champ mp-champ--erreur" : "mp-champ"}>
      <label className="mp-champ__libelle" htmlFor={id}>
        {libelle}
        {requis ? (
          <span className="mp-champ__requis">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="mp-visuellement-cache">
              <T fr="(obligatoire)" en="(required)" />
            </span>
          </span>
        ) : null}
      </label>
      {aide ? (
        <p className="mp-champ__aide" id={idAide}>
          {aide}
        </p>
      ) : null}
      {children}
      {erreur ? (
        <p className="mp-champ__erreur" id={idErreur}>
          <Icone nom="attention" taille={16} />
          <span>{erreur}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface ChampProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  libelle: string;
  aide?: ReactNode;
  erreur?: string;
  id?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Champ de saisie : `aide` et `erreur` sont annoncés par aria-describedby. */
export function Champ({ libelle, aide, erreur, id, required, className, ...reste }: ChampProps) {
  const auto = useId();
  const idChamp = id ?? auto;
  const { describedBy } = idsDescription(
    idChamp,
    Boolean(aide),
    Boolean(erreur),
    reste["aria-describedby"],
  );
  return (
    <CadreChamp id={idChamp} libelle={libelle} aide={aide} erreur={erreur} requis={required}>
      <input
        {...reste}
        id={idChamp}
        required={required}
        className={className ? `mp-champ__controle ${className}` : "mp-champ__controle"}
        aria-invalid={erreur ? true : reste["aria-invalid"]}
        aria-describedby={describedBy}
      />
    </CadreChamp>
  );
}
