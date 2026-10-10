import { evaluerQualiteDonneesKpi, type QualiteKpi } from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import {
  definitionsDeMission,
  lireParametresKpi,
  mesuresActivesDe,
  parKpi,
  type DefinitionKpi,
  type ParametresKpi,
} from "./donnees.js";
import { exigerVolumeEvaluable } from "./tableau.js";

/*
 * Qualité des données par KPI (KPI-15) : fraîcheur, complétude et cohérence, calculées par le
 * moteur (packages/engines/src/kpi/qualite-donnees.ts). Ce module lit les mesures ACTIVES et
 * compte les lignes saisies (corrections et annulations comprises) ; il ne calcule aucun score.
 * Poids, seuils et fenêtres sont des valeurs de départ à calibrer (DECISIONS.md).
 */

export interface QualiteDeKpi {
  def: DefinitionKpi;
  qualite: QualiteKpi;
}

/** Nombre de lignes saisies et de lignes corrigeant une autre ligne, par KPI, jusqu'à la date. */
async function compterLignes(db: Db, ids: readonly string[], date: string) {
  if (ids.length === 0) return new Map<string, { lignes: number; corrections: number }>();
  const r = await db.query(
    `SELECT m.kpi_id, count(*)::int AS lignes,
       (count(*) FILTER (WHERE m.remplace_id IS NOT NULL))::int AS corrections
     FROM kpi_mesures m WHERE m.kpi_id = ANY ($1::uuid[]) AND m.date_mesure <= $2::date
     GROUP BY m.kpi_id`,
    [ids, date],
  );
  return new Map(
    r.rows.map((l) => [
      l.kpi_id as string,
      { lignes: l.lignes as number, corrections: l.corrections as number },
    ]),
  );
}

/** Qualité des données des KPI donnés à la date d'arrêté. */
export async function qualiteDesKpi(
  db: Db,
  defs: readonly DefinitionKpi[],
  date: string,
  params?: ParametresKpi,
): Promise<QualiteDeKpi[]> {
  exigerVolumeEvaluable(defs, date);
  const parametres = params ?? (await lireParametresKpi(db));
  const ids = defs.map((d) => d.id);
  const mesures = parKpi(await mesuresActivesDe(db, ids));
  const lignes = await compterLignes(db, ids, date);
  return defs.map((def) => {
    const c = lignes.get(def.id) ?? { lignes: 0, corrections: 0 };
    return {
      def,
      qualite: evaluerQualiteDonneesKpi({
        frequence: def.frequence,
        debutSuivi: def.debut_suivi,
        finSuivi: def.fin_suivi,
        dateReference: date,
        delaiGraceJours: parametres.delai_grace_jours,
        mesures: (mesures.get(def.id) ?? []).map((m) => ({ date: m.date, valeur: m.valeur })),
        nombreCorrections: c.corrections,
        nombreLignes: c.lignes,
      }),
    };
  });
}

export function vueQualite(q: QualiteKpi) {
  return {
    score: q.score,
    niveau: q.niveau,
    fraicheur: q.fraicheur,
    completude: q.completude,
    coherence: q.coherence,
    motifs: q.motifs,
    details: {
      periodes_exigibles: q.details.periodesExigibles,
      periodes_mesurees: q.details.periodesMesurees,
      periodes_fenetre: q.details.periodesFenetre,
      periodes_mesurees_fenetre: q.details.periodesMesureesFenetre,
      retard_periodes: q.details.retardPeriodes,
      nombre_corrections: q.details.nombreCorrections,
      nombre_lignes: q.details.nombreLignes,
      valeurs_aberrantes: q.details.valeursAberrantes,
    },
  };
}

/** Qualité des données des KPI actifs d'une mission (carte du tableau de bord). */
export async function qualiteMission(db: Db, missionId: string, date: string) {
  const defs = await definitionsDeMission(db, missionId, true);
  const resultats = await qualiteDesKpi(db, defs, date);
  const niveaux = resultats.map((r) => r.qualite.niveau);
  return {
    mission_id: missionId,
    date_reference: date,
    repartition: {
      bon: niveaux.filter((n) => n === "bon").length,
      moyen: niveaux.filter((n) => n === "moyen").length,
      faible: niveaux.filter((n) => n === "faible").length,
      non_evaluable: niveaux.filter((n) => n === null).length,
    },
    kpis: resultats.map((r) => ({
      kpi_id: r.def.id,
      libelle: r.def.libelle,
      perspective: r.def.perspective,
      frequence: r.def.frequence,
      qualite: vueQualite(r.qualite),
    })),
  };
}
