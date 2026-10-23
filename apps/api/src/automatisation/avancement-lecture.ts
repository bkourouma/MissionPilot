import {
  composerAvancementHebdo,
  type AvancementHebdo,
  type FaitsAvancementHebdo,
  type JalonFait,
  type KpiFait,
  type LivrableFait,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import {
  ciblesDe,
  definitionsDeMission,
  lireParametresKpi,
  mesuresActivesDe,
  parKpi,
  type ParametresKpi,
} from "../kpi/donnees.js";
import { evaluerSerieKpi } from "../kpi/evaluation.js";
import { exigerVolumeEvaluable } from "../kpi/tableau.js";
import { calculerSuivisMissions, type SuiviMission } from "../temps/suivi.js";

/*
 * Lectures du rapport d'avancement hebdomadaire (AUT-10) : les FAITS d'une mission, remis tels quels
 * au moteur pur `composerAvancementHebdo` (packages/engines/src/avancement), seule source des chiffres.
 *
 * Réemploi sans duplication :
 * - avancement physique et jalons : `calculerSuivisMissions` (temps/suivi.ts, moteur du suivi). Seuls
 *   l'avancement, le nombre d'éléments et les jalons en sont retenus : jamais le budget en jours, le
 *   réalisé, les grades ni les personnes (FIN-02, le rapport est destiné au client) ;
 * - KPI : `evaluerSerieKpi` (kpi/evaluation.ts) à la date de référence ; valeur, cible et statut de la
 *   dernière période close mesurée ;
 * - livrables : documents de type « livrable » (hors brouillon IA non validé), partagés ou non avec le
 *   client (un livrable non partagé n'est qu'un NOMBRE dans le rapport).
 * Toutes les lectures se font dans la transaction reçue (RLS du cabinet).
 */

export interface MissionAvancement {
  id: string;
  intitule: string;
  statut: string;
  client_id: string;
  chef_id: string | null;
  directeur_id: string | null;
}

export const COLONNES_MISSION_AVANCEMENT = `m.id, m.intitule, m.statut, m.client_id, m.chef_id,
  m.directeur_id`;

/** Plafond de livrables lus par mission (le rapport en détaille moins ; le total est exact en dessous). */
const MAX_LIVRABLES_LUS = 500;

/** Suivi des missions données, calculé en lot (requêtes en nombre constant). */
export function suivisPourAvancement(
  db: Db,
  cabinetId: string,
  missionIds: readonly string[],
): Promise<Map<string, SuiviMission>> {
  return calculerSuivisMissions(db, cabinetId, missionIds);
}

function jalonsDuSuivi(suivi: SuiviMission | undefined): JalonFait[] {
  return (suivi?.decoupage.jalons ?? []).map((j) => ({
    libelle: String(j.libelle),
    datePrevue: (j.date_prevue as string | null) ?? null,
    atteint: j.atteint === true,
  }));
}

/** KPI actifs de la mission, évalués à `date` par le moteur KPI. */
async function kpisDeMission(
  db: Db,
  missionId: string,
  date: string,
  params: ParametresKpi,
): Promise<KpiFait[]> {
  const defs = await definitionsDeMission(db, missionId, true);
  if (defs.length === 0) return [];
  const ids = defs.map((d) => d.id);
  const cibles = parKpi(await ciblesDe(db, ids));
  const mesures = parKpi(await mesuresActivesDe(db, ids));
  return defs.map((def): KpiFait => {
    try {
      exigerVolumeEvaluable([def], date);
    } catch (e) {
      // Série trop longue pour être évaluée ici : le KPI est listé sans valeur ni statut.
      if (!(e instanceof AppError)) throw e;
      return {
        libelle: def.libelle,
        unite: def.unite,
        valeur: null,
        cible: null,
        statut: "non_mesure",
        periode: null,
      };
    }
    const evaluation = evaluerSerieKpi(
      def,
      mesures.get(def.id) ?? [],
      cibles.get(def.id) ?? [],
      date,
      params,
    );
    return {
      libelle: def.libelle,
      unite: def.unite,
      valeur: evaluation.derniere?.valeur ?? null,
      cible: evaluation.derniere?.cible ?? null,
      statut: evaluation.statut,
      periode: evaluation.derniere?.cle ?? null,
    };
  });
}

/** Livrables de la mission (hors brouillon IA non validé) et partage avec le client de la mission. */
async function livrablesDeMission(db: Db, missionId: string): Promise<LivrableFait[]> {
  const r = await db.query(
    `SELECT d.nom, d.type, d.version,
       EXISTS (SELECT 1 FROM portail_partages p
               WHERE p.document_id = d.id AND p.client_id = m.client_id) AS partage
     FROM mission_documents d JOIN missions m ON m.id = d.mission_id
     WHERE d.mission_id = $1 AND d.type = 'livrable'
       AND (d.statut_contenu IS NULL OR d.statut_contenu = 'valide')
     ORDER BY lower(d.nom), d.version, d.id LIMIT $2`,
    [missionId, MAX_LIVRABLES_LUS],
  );
  return r.rows.map((l) => ({
    nom: l.nom as string,
    type: l.type as string,
    version: l.version as number,
    partage: l.partage === true,
  }));
}

/** Faits d'une mission à partir de son suivi (déjà calculé, ou absent pour une mission sans découpage). */
export async function lireFaitsMission(
  db: Db,
  mission: MissionAvancement,
  suivi: SuiviMission | undefined,
  contexte: { semaine: string; dateReference: string; paramsKpi: ParametresKpi },
): Promise<FaitsAvancementHebdo> {
  const performance = suivi?.performance ?? null;
  return {
    semaine: contexte.semaine,
    dateReference: contexte.dateReference,
    mission: { intitule: mission.intitule, statut: mission.statut },
    avancement: performance === null ? null : Number(performance.avancement),
    elementsAvancement: performance === null ? 0 : Number(performance.elements),
    jalons: jalonsDuSuivi(suivi),
    kpis: await kpisDeMission(db, mission.id, contexte.dateReference, contexte.paramsKpi),
    livrables: await livrablesDeMission(db, mission.id),
  };
}

export function parametresKpiDuCabinet(db: Db): Promise<ParametresKpi> {
  return lireParametresKpi(db);
}

/**
 * Contenu du rapport d'UNE mission (génération manuelle, régénération) : suivi, KPI et livrables lus
 * puis composés par le moteur.
 */
export async function composerPourMission(
  db: Db,
  cabinetId: string,
  mission: MissionAvancement,
  semaine: string,
  dateReference: string,
): Promise<AvancementHebdo> {
  const suivis = await suivisPourAvancement(db, cabinetId, [mission.id]);
  const paramsKpi = await parametresKpiDuCabinet(db);
  const faits = await lireFaitsMission(db, mission, suivis.get(mission.id), {
    semaine,
    dateReference,
    paramsKpi,
  });
  return composerAvancementHebdo(faits);
}
