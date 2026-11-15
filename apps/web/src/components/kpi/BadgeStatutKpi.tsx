import type { Langue } from "@missionpilot/shared";
import { libelleStatutKpi, type StatutKpi } from "../../lib/kpi";
import { BadgeStatut } from "../ui/BadgeStatut";

export interface BadgeStatutKpiProps {
  statut: StatutKpi | string | null | undefined;
  /** Préfixe lu par les lecteurs d'écran (ex. « Statut projeté : »). */
  prefixe?: string;
  /** Langue de l'affichage (français si absente), passée par l'appelant. */
  langue?: Langue;
}

/**
 * Statut d'un KPI calculé par le moteur (vert, orange, rouge, non mesuré, sans cible) : icône
 * ET libellé écrit, la couleur ne porte jamais seule le sens.
 */
export function BadgeStatutKpi({ statut, prefixe, langue = "fr" }: BadgeStatutKpiProps) {
  const s = libelleStatutKpi(statut, langue);
  return (
    <BadgeStatut tonalite={s.tonalite}>
      <span className="mp-visuellement-cache">
        {prefixe ?? (langue === "en" ? "Status: " : "Statut : ")}
      </span>
      {s.libelle}
    </BadgeStatut>
  );
}
