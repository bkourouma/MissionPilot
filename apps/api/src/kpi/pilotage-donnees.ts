import type { Db } from "../db/pool.js";
import {
  ciblesDe,
  COLONNES_KPI,
  lireParametresKpi,
  mesuresActivesDe,
  parKpi,
  versDefinition,
  type DefinitionKpi,
  type ParametresKpi,
} from "./donnees.js";
import { evaluerSerieKpi, type EvaluationSerieKpi } from "./evaluation.js";
import { exigerVolumeEvaluable } from "./tableau.js";

/*
 * Évaluation, par le moteur (kpi/evaluation.ts), d'un ensemble de KPI d'une mission à une date
 * d'arrêté : socle commun des arbres d'indicateurs (KPI-13), de la qualité des données (KPI-15),
 * de l'efficacité des actions (KPI-18) et du dossier de revue (KPI-17). Aucun calcul ici :
 * les entrées sont lues telles quelles et remises au moteur. Le volume est borné AVANT toute
 * lecture de mesure (400 KPI_TROP_DE_PERIODES), comme le tableau de bord.
 */

/** Plafond des lignes servies par une lecture non paginée du pilotage (fiche d'une revue, d'une action). */
export const MAX_LIGNES_PILOTAGE = 500;

/**
 * Plafonne une lecture non paginée : la requête lit `MAX_LIGNES_PILOTAGE + 1` lignes
 * (`LIMIT $n` avec `limiteLecturePilotage()`), la ligne en trop ne sert qu'à signaler
 * que la liste est TRONQUÉE (`tronque: true`), jamais à la servir.
 */
export const limiteLecturePilotage = () => MAX_LIGNES_PILOTAGE + 1;
export function plafonnerLecture<T>(lignes: readonly T[]): { lignes: T[]; tronque: boolean } {
  return {
    lignes: lignes.slice(0, MAX_LIGNES_PILOTAGE),
    tronque: lignes.length > MAX_LIGNES_PILOTAGE,
  };
}

export interface KpiEvaluePilotage {
  def: DefinitionKpi;
  evaluation: EvaluationSerieKpi;
}

/** KPI par identifiants (RLS du cabinet), actifs ou non, dans l'ordre des libellés. */
export async function definitionsParIds(db: Db, ids: readonly string[]): Promise<DefinitionKpi[]> {
  if (ids.length === 0) return [];
  const r = await db.query(
    `SELECT ${COLONNES_KPI} FROM kpi_definitions d WHERE d.id = ANY ($1::uuid[])
     ORDER BY lower(d.libelle), d.id`,
    [[...new Set(ids)]],
  );
  return r.rows.map(versDefinition);
}

export async function evaluerDefinitions(
  db: Db,
  defs: readonly DefinitionKpi[],
  date: string,
  params?: ParametresKpi,
): Promise<Map<string, KpiEvaluePilotage>> {
  exigerVolumeEvaluable(defs, date);
  const parametres = params ?? (await lireParametresKpi(db));
  const ids = defs.map((d) => d.id);
  const cibles = parKpi(await ciblesDe(db, ids));
  const mesures = parKpi(await mesuresActivesDe(db, ids));
  return new Map(
    defs.map((def) => [
      def.id,
      {
        def,
        evaluation: evaluerSerieKpi(
          def,
          mesures.get(def.id) ?? [],
          cibles.get(def.id) ?? [],
          date,
          parametres,
        ),
      },
    ]),
  );
}

/** Évalue les KPI désignés (par identifiants) à la date d'arrêté. */
export async function evaluerKpisParIds(
  db: Db,
  ids: readonly string[],
  date: string,
): Promise<Map<string, KpiEvaluePilotage>> {
  return evaluerDefinitions(db, await definitionsParIds(db, ids), date);
}
