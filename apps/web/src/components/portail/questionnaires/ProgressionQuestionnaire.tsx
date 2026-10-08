import {
  pourcentageAffiche,
  texteProgression,
  type ProgressionPortail,
} from "../../../lib/portail-questionnaires";
import "./questionnaires.css";

export interface ProgressionQuestionnaireProps {
  progression: ProgressionPortail;
  /** Identifiant unique dans la page (base des identifiants du libellé et du texte). */
  id: string;
  libelle?: string;
}

/**
 * Progression d'un questionnaire telle que calculée par l'API (moteur) : barre native
 * `<progress>` (valeur lue par les lecteurs d'écran) et phrase explicite.
 */
export function ProgressionQuestionnaire({
  progression,
  id,
  libelle = "Progression",
}: ProgressionQuestionnaireProps) {
  const p = pourcentageAffiche(progression);
  const idLibelle = `${id}-libelle`;
  const idTexte = `${id}-texte`;
  return (
    <div className="mp-pq-progression">
      <div className="mp-pq-progression__entete">
        <span id={idLibelle} className="mp-pq-progression__libelle">
          {libelle}
        </span>
        <span className="mp-pq-progression__valeur" aria-hidden="true">
          {`${p}\u00a0%`}
        </span>
      </div>
      <progress
        id={id}
        className="mp-pq-progression__barre"
        max={100}
        value={p}
        aria-labelledby={idLibelle}
        aria-describedby={idTexte}
      >
        {`${p}\u00a0%`}
      </progress>
      <p id={idTexte} className="mp-pq-progression__texte">
        {texteProgression(progression)}
      </p>
    </div>
  );
}
