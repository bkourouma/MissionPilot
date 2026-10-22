/**
 * Indicateurs de pilotage du cabinet (PRD, table « Indicateurs de pilotage du cabinet ») :
 * logique d'affichage pure, testée dans `indicateurs.test.ts`.
 *
 * AUCUN indicateur n'est calculé ici : chaque valeur vient de `GET /api/indicateurs/cabinet`
 * (moteurs de `@missionpilot/engines`). Ce module choisit le libellé, la mise en forme et le
 * statut d'affichage (comparaison de la valeur servie à des seuils de lecture). Les champs
 * financiers sont ABSENTS de la réponse sans le droit requis : ils restent absents ici.
 *
 * Sous-modules ré-exportés ici : `indicateurs-types` (contrat de l'API), `-definitions`,
 * `-statuts` (seuils et statuts) et `-affichage` (valeurs affichées).
 */
import {
  INDICATEURS_MAX_JOURS,
  NIVEAUX_INDICATEURS,
  type NiveauIndicateurs,
} from "@missionpilot/shared";
import { aujourdhui, debutDuMois, lirePeriode, type Periode } from "./periode";
import { statutEcart, type StatutAffiche } from "./indicateurs-statuts";
import type { ElementMission } from "./indicateurs-types";

export * from "./indicateurs-types";
export * from "./indicateurs-definitions";
export * from "./indicateurs-statuts";
export * from "./indicateurs-affichage";

// --- Alertes de dérive (parcours C) --------------------------------------------------------

export interface AlerteDerive {
  mission_id: string;
  intitule: string;
  ecart_jours: number;
  ecart_relatif: number | null;
  jours_budget: number;
  jours_atterrissage: number;
  statut: StatutAffiche;
}

/**
 * Missions dont l'atterrissage (servi par l'API) dépasse le budget, les plus fortes dérives
 * d'abord. Lecture d'une réponse de niveau « mission ».
 */
export function alertesDerive(elements: readonly ElementMission[]): AlerteDerive[] {
  return elements
    .filter((m) => m.ecart_terminaison.jours > 0)
    .map((m) => ({
      mission_id: m.mission_id,
      intitule: m.intitule,
      ecart_jours: m.ecart_terminaison.jours,
      ecart_relatif: m.ecart_terminaison.relatif_jours,
      jours_budget: m.jours_budget,
      jours_atterrissage: m.jours_atterrissage,
      statut: statutEcart(m.ecart_terminaison.relatif_jours, m.ecart_terminaison.jours),
    }))
    .sort(
      (a, b) =>
        (b.ecart_relatif ?? Number.POSITIVE_INFINITY) -
          (a.ecart_relatif ?? Number.POSITIVE_INFINITY) || b.ecart_jours - a.ecart_jours,
    );
}

// --- Filtres -------------------------------------------------------------------------------

/** Niveaux de lecture proposés à l'écran (PRD : cabinet, associé/directeur, grade, collaborateur). */
export const NIVEAU_LIBELLES: Record<NiveauIndicateurs, string> = {
  cabinet: "Cabinet",
  associe: "Associé ou directeur de mission",
  grade: "Grade",
  collaborateur: "Collaborateur",
  mission: "Mission",
  client: "Client",
};

export const OPTIONS_NIVEAUX = NIVEAUX_INDICATEURS.map((n) => ({
  valeur: n,
  libelle: NIVEAU_LIBELLES[n],
}));

export interface FiltresIndicateurs extends Periode {
  niveau: NiveauIndicateurs;
  corrigee: boolean;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Période par défaut : du début du mois à aujourd'hui (revue de fin de mois du parcours C). */
export function periodeParDefaut(jour: string = aujourdhui()): Periode {
  return { du: debutDuMois(jour), au: jour };
}

export function lireFiltresIndicateurs(
  p: Record<string, string | string[] | undefined>,
  jour: string = aujourdhui(),
): FiltresIndicateurs {
  const n = un(p.niveau);
  const periode = lirePeriode(p, periodeParDefaut(jour), INDICATEURS_MAX_JOURS);
  return {
    ...periode,
    niveau: (NIVEAUX_INDICATEURS as readonly string[]).includes(n)
      ? (n as NiveauIndicateurs)
      : "cabinet",
  };
}

export function requeteIndicateurs(f: Periode & { niveau: NiveauIndicateurs }): string {
  return new URLSearchParams({ du: f.du, au: f.au, niveau: f.niveau }).toString();
}
