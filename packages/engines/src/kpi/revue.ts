/**
 * Ordre du jour d'une revue de performance (KPI-17), composé de façon
 * déterministe : chaque point reçoit une priorité en points entiers, les
 * points sont triés par priorité décroissante puis par code et ordre d'entrée
 * (aucun aléa, aucun LLM). Un point d'ouverture et un point de clôture
 * encadrent la liste.
 *
 * Priorités de départ (à calibrer avec les cabinets pilotes) :
 * - décision ouverte d'une revue précédente : 85, 95 si l'échéance est passée ;
 * - action en retard : 90 + jours de retard (au plus 30) ;
 * - action terminée jugée inefficace : 80 ;
 * - KPI rouge : 100 + 10 par alerte ; KPI en dégradation (hors rouge) : 70 ;
 *   KPI orange : 60 ; KPI non mesuré : 40 ;
 * - qualité des données faible : 50 (en plus du statut du KPI).
 * Durées suggérées (minutes) : 10 pour un KPI rouge, 5 sinon ; ouverture 5 ;
 * décisions 10. Le nombre de points est borné (`MAX_POINTS_REVUE_KPI`).
 */
import type { DateISO } from "../commun/dates";
import type { StatutKpi } from "./atteinte";
import type { VerdictEfficaciteKpi } from "./efficacite";
import { ErreurKpi } from "./erreurs";
import { jourKpi } from "./periodes";
import type { NiveauQualiteKpi } from "./qualite-donnees";
import type { EvolutionKpi } from "./tendance";

export const MAX_POINTS_REVUE_KPI = 40;

export type CodePointRevueKpi =
  | "OUVERTURE"
  | "DECISION_OUVERTE"
  | "ACTION_EN_RETARD"
  | "ACTION_INEFFICACE"
  | "KPI_ROUGE"
  | "KPI_DEGRADATION"
  | "KPI_ORANGE"
  | "QUALITE_DONNEES"
  | "KPI_NON_MESURE"
  | "DECISIONS_A_PRENDRE";

export interface KpiRevueKpi {
  readonly id: string;
  readonly libelle: string;
  readonly statut: StatutKpi;
  readonly evolution: EvolutionKpi;
  readonly nombreAlertes: number;
  readonly qualite: NiveauQualiteKpi | null;
}

export interface ActionRevueKpi {
  readonly id: string;
  readonly libelle: string;
  readonly kpiId: string;
  readonly echeance: DateISO;
  readonly statut: "a_faire" | "en_cours" | "terminee" | "abandonnee";
  readonly efficacite: VerdictEfficaciteKpi | null;
}

export interface DecisionRevueKpi {
  readonly id: string;
  readonly libelle: string;
  readonly echeance: DateISO | null;
}

export interface PointRevueKpi {
  readonly code: CodePointRevueKpi;
  readonly libelle: string;
  readonly kpiId: string | null;
  readonly actionId: string | null;
  readonly decisionId: string | null;
  /** Points de priorité (plus grand = plus urgent) ; 0 pour ouverture et clôture. */
  readonly priorite: number;
  /** Position dans l'ordre du jour, à partir de 1. */
  readonly rang: number;
  readonly dureeMinutes: number;
}

export interface OrdreDuJourKpi {
  readonly points: readonly PointRevueKpi[];
  readonly dureeTotaleMinutes: number;
  /** Candidats écartés faute de place (au-delà de MAX_POINTS_REVUE_KPI). */
  readonly ecartes: number;
}

type Brouillon = Omit<PointRevueKpi, "rang">;

function point(
  code: CodePointRevueKpi,
  libelle: string,
  priorite: number,
  dureeMinutes: number,
  ids: Partial<Pick<PointRevueKpi, "kpiId" | "actionId" | "decisionId">> = {},
): Brouillon {
  return {
    code,
    libelle,
    kpiId: ids.kpiId ?? null,
    actionId: ids.actionId ?? null,
    decisionId: ids.decisionId ?? null,
    priorite,
    dureeMinutes,
  };
}

const JOURS_RETARD_MAX = 30;

export function composerOrdreDuJourKpi(entree: {
  readonly dateReference: DateISO;
  readonly kpis: readonly KpiRevueKpi[];
  readonly actions: readonly ActionRevueKpi[];
  readonly decisionsOuvertes: readonly DecisionRevueKpi[];
}): OrdreDuJourKpi {
  const jour = jourKpi(entree.dateReference, "La date de référence");
  for (const k of entree.kpis) {
    if (!Number.isSafeInteger(k.nombreAlertes) || k.nombreAlertes < 0) {
      throw new ErreurKpi(
        "OPTIONS_INVALIDES",
        "Le nombre d'alertes d'un KPI est un entier positif ou nul.",
      );
    }
  }
  const candidats: Brouillon[] = [];

  for (const d of entree.decisionsOuvertes) {
    const retard = d.echeance !== null && jourKpi(d.echeance, "L'échéance") < jour;
    candidats.push(
      point("DECISION_OUVERTE", `Décision à suivre : ${d.libelle}`, retard ? 95 : 85, 5, {
        decisionId: d.id,
      }),
    );
  }
  for (const a of entree.actions) {
    const ouverte = a.statut === "a_faire" || a.statut === "en_cours";
    const joursRetard = jour - jourKpi(a.echeance, "L'échéance");
    if (ouverte && joursRetard > 0) {
      candidats.push(
        point(
          "ACTION_EN_RETARD",
          `Action en retard : ${a.libelle}`,
          90 + Math.min(joursRetard, JOURS_RETARD_MAX),
          5,
          { actionId: a.id, kpiId: a.kpiId },
        ),
      );
    } else if (a.statut === "terminee" && a.efficacite === "inefficace") {
      candidats.push(
        point("ACTION_INEFFICACE", `Action sans effet mesuré : ${a.libelle}`, 80, 5, {
          actionId: a.id,
          kpiId: a.kpiId,
        }),
      );
    }
  }
  for (const k of entree.kpis) {
    if (k.statut === "rouge") {
      candidats.push(
        point("KPI_ROUGE", `KPI en rouge : ${k.libelle}`, 100 + 10 * k.nombreAlertes, 10, {
          kpiId: k.id,
        }),
      );
    } else if (k.evolution === "degradation") {
      candidats.push(
        point("KPI_DEGRADATION", `KPI en dégradation : ${k.libelle}`, 70, 5, { kpiId: k.id }),
      );
    } else if (k.statut === "orange") {
      candidats.push(point("KPI_ORANGE", `KPI en orange : ${k.libelle}`, 60, 5, { kpiId: k.id }));
    } else if (k.statut === "non_mesure") {
      candidats.push(
        point("KPI_NON_MESURE", `KPI non mesuré : ${k.libelle}`, 40, 5, { kpiId: k.id }),
      );
    }
    if (k.qualite === "faible") {
      candidats.push(
        point("QUALITE_DONNEES", `Qualité des données à fiabiliser : ${k.libelle}`, 50, 5, {
          kpiId: k.id,
        }),
      );
    }
  }

  const tries = candidats
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      if (b.c.priorite !== a.c.priorite) return b.c.priorite - a.c.priorite;
      if (a.c.code !== b.c.code) return a.c.code < b.c.code ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ c }) => c);
  const retenus = tries.slice(0, MAX_POINTS_REVUE_KPI - 2);
  const liste: Brouillon[] = [
    point(
      "OUVERTURE",
      "Ouverture : objectifs de la revue et rappel des décisions précédentes",
      0,
      5,
    ),
    ...retenus,
    point("DECISIONS_A_PRENDRE", "Décisions, responsables et échéances", 0, 10),
  ];
  const points = liste.map((p, i): PointRevueKpi => ({ ...p, rang: i + 1 }));
  return {
    points,
    dureeTotaleMinutes: points.reduce((s, p) => s + p.dureeMinutes, 0),
    ecartes: tries.length - retenus.length,
  };
}
