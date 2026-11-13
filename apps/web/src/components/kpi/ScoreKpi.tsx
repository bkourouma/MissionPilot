import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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
export async function ScoreKpi({ score, grand = false }: ScoreKpiProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!score) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Score non calculable : aucun KPI de cette sélection n'a de pondération.",
          "Score cannot be computed: no KPI in this selection has a weighting.",
        )}
      </p>
    );
  }
  const exclus = score.exclus.length;
  return (
    <div className={grand ? "mp-kpi-score mp-kpi-score--grand" : "mp-kpi-score"}>
      <p className="mp-kpi-score__valeur">
        <span className="mp-visuellement-cache">
          {t("Score composite : ", "Composite score: ")}
        </span>
        {score.score === null ? "—" : formaterTauxKpi(score.score, langue)}
      </p>
      <BadgeStatutKpi
        statut={score.statut}
        prefixe={t("Statut du score : ", "Score status: ")}
        langue={langue}
      />
      <p className="mp-texte-doux mp-texte-petit mp-kpi-score__note">
        {score.score === null
          ? t(
              "Aucun KPI mesuré avec une cible : le score n'est pas encore calculable.",
              "No KPI measured with a target: the score cannot be computed yet.",
            )
          : t(
              `Repose sur ${formaterTauxKpi(score.couverture, langue)} du poids total.`,
              `Based on ${formaterTauxKpi(score.couverture, langue)} of the total weight.`,
            )}
        {exclus > 0
          ? t(
              ` ${exclus} KPI exclu${exclus > 1 ? "s" : ""} (non mesuré${exclus > 1 ? "s" : ""} ou sans cible).`,
              ` ${exclus} KPI${exclus > 1 ? "s" : ""} excluded (not measured or without target).`,
            )
          : ""}
      </p>
    </div>
  );
}
