import { libelleStatutKpi, type StatutKpi } from "../../lib/kpi";
import { BadgeStatut } from "../ui/BadgeStatut";

export interface BadgeStatutKpiProps {
  statut: StatutKpi | string | null | undefined;
  /** Préfixe lu par les lecteurs d'écran (ex. « Statut projeté : »). */
  prefixe?: string;
}

/**
 * Statut d'un KPI calculé par le moteur (vert, orange, rouge, non mesuré, sans cible) : icône
 * ET libellé écrit, la couleur ne porte jamais seule le sens.
 */
export function BadgeStatutKpi({ statut, prefixe = "Statut : " }: BadgeStatutKpiProps) {
  const s = libelleStatutKpi(statut);
  return (
    <BadgeStatut tonalite={s.tonalite}>
      <span className="mp-visuellement-cache">{prefixe}</span>
      {s.libelle}
    </BadgeStatut>
  );
}
