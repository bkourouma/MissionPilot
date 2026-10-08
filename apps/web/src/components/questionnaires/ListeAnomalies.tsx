import type { Ref } from "react";
import {
  ancreChemin,
  localiserChemin,
  type Anomalie,
  type Definition,
} from "../../lib/questionnaires-definition";
import { Alerte } from "../ui/Alerte";
import "./questionnaires.css";

export interface ListeAnomaliesProps {
  anomalies: readonly Anomalie[];
  definition: Definition | null;
  /** Origine des anomalies : contrôle local (forme) ou moteur de l'API (cohérence). */
  origine: "locale" | "serveur";
  /** Lien vers l'élément en cause (éditeur affiché). */
  avecLiens?: boolean;
  refAlerte?: Ref<HTMLDivElement>;
}

/**
 * Anomalies d'une définition : message, emplacement lisible (lien vers l'élément de
 * l'éditeur), puis code et chemin techniques (ceux du moteur `validerDefinition`).
 */
export function ListeAnomalies({
  anomalies,
  definition,
  origine,
  avecLiens = true,
  refAlerte,
}: ListeAnomaliesProps) {
  if (anomalies.length === 0) return null;
  const n = anomalies.length;
  const titre =
    n === 1
      ? "Une anomalie à corriger avant d'enregistrer"
      : `${n} anomalies à corriger avant d'enregistrer`;
  return (
    <Alerte ref={refAlerte} tonalite="danger" titre={titre}>
      <p>
        {origine === "locale"
          ? "Contrôle de forme effectué avant l'envoi : rien n'a été enregistré."
          : "Contrôle de cohérence du moteur MissionPilot (conditions, références, échelles) : rien n'a été enregistré."}
      </p>
      <ol className="mp-qe-anomalies">
        {anomalies.map((a, i) => {
          const lieu = localiserChemin(a.chemin, definition);
          const ancre = avecLiens ? ancreChemin(a.chemin) : null;
          return (
            <li key={`${a.chemin}-${a.code}-${i}`} className="mp-qe-anomalie">
              <span className="mp-qe-anomalie__message">{a.message}</span>
              <span>
                {ancre ? (
                  <a href={`#${ancre}`}>
                    {lieu}
                    <span className="mp-visuellement-cache"> (aller à l'élément)</span>
                  </a>
                ) : (
                  lieu
                )}
              </span>
              <span className="mp-qe-anomalie__technique">
                {"Code "}
                <code>{a.code}</code>
                {" · chemin "}
                <code>{a.chemin === "" ? "(racine)" : a.chemin}</code>
              </span>
            </li>
          );
        })}
      </ol>
    </Alerte>
  );
}
