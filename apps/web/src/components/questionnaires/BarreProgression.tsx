import { texteProgression, type ProgressionReponse } from "../../lib/questionnaires";
import { ESPACE_INSECABLE } from "../../lib/questionnaires-definition";
import "./questionnaires.css";

/**
 * Progression d'une réponse (calculée par le moteur côté API) : barre native `<progress>`,
 * pourcentage et décompte en texte (la barre ne porte jamais seule l'information).
 */
export function BarreProgression({
  progression,
  libelle,
}: {
  progression: ProgressionReponse;
  /** Nom accessible de la barre, ex. « Progression de Ama Koné ». */
  libelle: string;
}) {
  return (
    <div className="mp-progression">
      <div className="mp-progression__ligne">
        <progress max={100} value={progression.pourcentage} aria-label={libelle}>
          {`${progression.pourcentage} %`}
        </progress>
        <span className="mp-progression__valeur">{`${progression.pourcentage}${ESPACE_INSECABLE}%`}</span>
      </div>
      <span className="mp-texte-doux mp-texte-petit">{texteProgression(progression)}</span>
    </div>
  );
}
