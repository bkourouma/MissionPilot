import type { ReactNode, Ref } from "react";
import { Icone, type NomIcone } from "./Icone";

export type TonaliteAlerte = "info" | "succes" | "attention" | "danger";

const ICONES: Record<TonaliteAlerte, NomIcone> = {
  info: "info",
  succes: "succes",
  attention: "attention",
  danger: "danger",
};

export interface AlerteProps {
  tonalite?: TonaliteAlerte;
  titre?: ReactNode;
  children?: ReactNode;
  /**
   * Annonce aux lecteurs d'écran : « alert » (interrompt, pour une erreur bloquante) ou
   * « status » (poli). Par défaut : « alert » pour danger, « status » sinon. `aucune` pour un
   * message statique présent dès l'affichage de la page.
   */
  annonce?: "alert" | "status" | "aucune";
  /** Pour déplacer le focus sur l'alerte (elle reçoit tabIndex -1). */
  ref?: Ref<HTMLDivElement>;
}

export function Alerte({ tonalite = "info", titre, children, annonce, ref }: AlerteProps) {
  const role = annonce ?? (tonalite === "danger" ? "alert" : "status");
  return (
    <div
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      className={`mp-alerte mp-alerte--${tonalite}`}
      role={role === "aucune" ? undefined : role}
    >
      <Icone nom={ICONES[tonalite]} className="mp-alerte__icone" />
      <div className="mp-alerte__contenu">
        {titre ? <p className="mp-alerte__titre">{titre}</p> : null}
        {children ? <div className="mp-alerte__texte">{children}</div> : null}
      </div>
    </div>
  );
}
