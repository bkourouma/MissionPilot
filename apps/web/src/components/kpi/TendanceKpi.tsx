import { descriptionTendance, type TendanceKpiVue } from "../../lib/kpi";

/**
 * Tendance calculée par le moteur : flèche décorative (masquée aux lecteurs d'écran) ET texte
 * (« En hausse : amélioration »), qui suit le sens de lecture du KPI.
 */
export function TendanceKpi({ tendance }: { tendance: TendanceKpiVue | null | undefined }) {
  const t = descriptionTendance(tendance);
  return (
    <span className={`mp-kpi-tendance mp-kpi-tendance--${t.tonalite}`}>
      <span className="mp-kpi-tendance__fleche" aria-hidden="true">
        {t.fleche}
      </span>
      <span>{t.texte}</span>
    </span>
  );
}
