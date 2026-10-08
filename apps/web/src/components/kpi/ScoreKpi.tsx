import { formaterTauxKpi, type ScoreKpiVue } from "../../lib/kpi";
import { BadgeStatutKpi } from "./BadgeStatutKpi";

export interface ScoreKpiProps {
  score: ScoreKpiVue | null;
  /** Grand format (score global). */
  grand?: boolean;
}

/**
 * Score composite pondéré calculé par le moteur (moyenne des atteintes bornées à 0–100 %,
 * pondérée) : valeur, statut écrit et couverture (part du poids réellement mesurée).
 */
export function ScoreKpi({ score, grand = false }: ScoreKpiProps) {
  if (!score) {
    return (
      <p className="mp-texte-doux">
        Score non calculable : aucun KPI de cette sélection n&apos;a de pondération.
      </p>
    );
  }
  const exclus = score.exclus.length;
  return (
    <div className={grand ? "mp-kpi-score mp-kpi-score--grand" : "mp-kpi-score"}>
      <p className="mp-kpi-score__valeur">
        <span className="mp-visuellement-cache">Score composite : </span>
        {score.score === null ? "—" : formaterTauxKpi(score.score)}
      </p>
      <BadgeStatutKpi statut={score.statut} prefixe="Statut du score : " />
      <p className="mp-texte-doux mp-texte-petit mp-kpi-score__note">
        {score.score === null
          ? "Aucun KPI mesuré avec une cible : le score n'est pas encore calculable."
          : `Repose sur ${formaterTauxKpi(score.couverture)} du poids total.`}
        {exclus > 0
          ? ` ${exclus} KPI exclu${exclus > 1 ? "s" : ""} (non mesuré${exclus > 1 ? "s" : ""} ou sans cible).`
          : ""}
      </p>
    </div>
  );
}
