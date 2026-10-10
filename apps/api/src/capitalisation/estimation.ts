import {
  EFFECTIF_MINIMUM_PAR_DEFAUT,
  EFFECTIF_MINIMUM_PLANCHER,
  estimerBriques,
  formaterCentiemesJours,
  type ObservationTemps,
} from "@missionpilot/engines";
import type { EstimationDemande } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { exigerMissionModifiable, exigerMissionVisible } from "../missions/acces.js";
import { methodeEffectiveMission } from "../standard/index.js";

/*
 * Base d'estimation (CAP-02).
 * - Rattachement d'une tâche du découpage à une brique de la méthode EFFECTIVE de la mission
 *   (`mission.planifier`, mission modifiable : directeur, chef ou « modifier toutes » ; jamais
 *   une mission clôturée, doublé en base MPJ03).
 * - Observations figées à la validation du retour d'expérience (retours.ts).
 * - `estimationParBrique` : SERVICE INTERNE pour l'estimation des propositions (prolonge MIS-06) :
 *   médiane, quartiles et effectif par brique, filtrés par contexte, sous un effectif minimum
 *   (3 par défaut, 3 au minimum : plancher du moteur, revérifié ici) aucune statistique, et
 *   jamais d'effectif sous ce seuil (moteur `estimerBriques`). Quartiles et extrêmes seulement
 *   à partir de cinq observations : sur trois ou quatre ils redonneraient les durées
 *   individuelles de missions identifiables. Agrégats seulement : aucune mission n'est nommée,
 *   d'où une lecture sur tout le cabinet sans filtre de visibilité. Les durées réelles sont des
 *   jours de travail : la route exige `budget.lire_jours` en plus de `connaissance.lire` (un
 *   expert métier lit la base de connaissances mais pas les jours).
 */

/** Briques de la méthode effective de la mission (code → libellé, étape, état). */
async function briquesMission(db: Db, missionId: string) {
  const m = await methodeEffectiveMission(db, missionId);
  if (!m) return null;
  return m.etapes.flatMap((e) =>
    e.briques.map((b) => ({
      code: b.code,
      libelle: b.libelle,
      etape: e.libelle,
      active: b.active,
    })),
  );
}

export async function listerRattachements(db: Db, auth: Auth, missionId: string) {
  await exigerMissionVisible(db, auth, missionId);
  const r = await db.query(
    `SELECT t.id AS tache_id, t.libelle, p.libelle AS phase, cb.brique_code
     FROM mission_taches t JOIN mission_phases p ON p.id = t.phase_id
     LEFT JOIN cap_taches_briques cb ON cb.tache_id = t.id
     WHERE t.mission_id = $1 ORDER BY p.ordre, p.id, t.ordre, t.id`,
    [missionId],
  );
  return { taches: r.rows, briques: (await briquesMission(db, missionId)) ?? [] };
}

export async function rattacherTacheBrique(
  db: Db,
  auth: Auth,
  missionId: string,
  tacheId: string,
  briqueCode: string | null,
) {
  await exigerMissionModifiable(db, auth, missionId);
  const t = await db.query(`SELECT 1 FROM mission_taches WHERE id = $1 AND mission_id = $2`, [
    tacheId,
    missionId,
  ]);
  if (!t.rowCount) throw introuvable("Tâche");
  if (briqueCode === null) {
    await db.query(`DELETE FROM cap_taches_briques WHERE tache_id = $1`, [tacheId]);
  } else {
    const briques = await briquesMission(db, missionId);
    if (!briques) {
      throw new AppError(
        409,
        "METHODE_NON_LIEE",
        "Aucune méthode du référentiel n'est liée à la mission.",
      );
    }
    if (!briques.some((b) => b.code === briqueCode)) {
      throw new AppError(
        400,
        "BRIQUE_INCONNUE",
        "Cette brique n'existe pas dans la méthode de la mission.",
      );
    }
    await db.query(
      `INSERT INTO cap_taches_briques (cabinet_id, mission_id, tache_id, brique_code, modifie_par)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tache_id) DO UPDATE
         SET brique_code = EXCLUDED.brique_code, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
      [auth.cabinetId, missionId, tacheId, briqueCode, auth.utilisateurId],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.tache_brique",
    entite: "mission_tache",
    entiteId: tacheId,
    details: { mission_id: missionId, brique_code: briqueCode },
  });
  return listerRattachements(db, auth, missionId);
}

const OBSERVATIONS_MAX = 20_000;
const BRIQUES_MAX = 1000;

/**
 * SERVICE INTERNE : estimation des temps par brique et par contexte, pour l'estimation des
 * propositions. Lit les observations du cabinet courant (RLS) ; l'appelant a vérifié la
 * permission de son action (`connaissance.lire` pour la route, `pipeline.gerer` pour une
 * proposition). Aucune donnée nominative : codes de brique, effectifs et quantiles en centièmes.
 */
export async function estimationParBrique(db: Db, demande: EstimationDemande) {
  const r = await db.query(
    `SELECT mission_id, brique_code, methode_code, realise_centiemes::text AS realise, contexte
     FROM cap_temps_briques WHERE brique_code = ANY ($1::text[])
     ORDER BY cree_le DESC, id DESC LIMIT $2`,
    [demande.briques, OBSERVATIONS_MAX + 1],
  );
  const tronque = r.rows.length > OBSERVATIONS_MAX;
  const observations: ObservationTemps[] = r.rows.slice(0, OBSERVATIONS_MAX).map((o) => ({
    mission_id: o.mission_id as string,
    brique_code: o.brique_code as string,
    methode_code: (o.methode_code as string | null) ?? null,
    realise_centiemes: Number(o.realise),
    contexte: (o.contexte ?? {}) as ObservationTemps["contexte"],
  }));
  const effectif = demande.effectif_minimum ?? EFFECTIF_MINIMUM_PAR_DEFAUT;
  const estimations = estimerBriques(observations, {
    briques: demande.briques,
    contexte: (demande.contexte ?? {}) as NonNullable<ObservationTemps["contexte"]>,
    methode_code: demande.methode_code ?? null,
    effectifMinimum: effectif,
  });
  return {
    effectif_minimum: effectif,
    tronque,
    elements: estimations.map((e) => ({
      ...e,
      libelles: e.resume
        ? {
            mediane: formaterCentiemesJours(e.resume.mediane),
            q1: e.resume.q1 === null ? null : formaterCentiemesJours(e.resume.q1),
            q3: e.resume.q3 === null ? null : formaterCentiemesJours(e.resume.q3),
          }
        : null,
    })),
  };
}

/**
 * Briques connues de la base d'estimation, pour les listes de choix. L'effectif n'est rendu
 * qu'à partir du plancher du moteur (`null` en dessous : une brique faite une ou deux fois ne
 * révèle pas son nombre de missions).
 */
export async function briquesObservees(db: Db) {
  const r = await db.query(
    `SELECT brique_code, count(DISTINCT mission_id)::int AS missions
     FROM cap_temps_briques GROUP BY brique_code ORDER BY brique_code LIMIT $1`,
    [BRIQUES_MAX + 1],
  );
  const elements = (
    r.rows.slice(0, BRIQUES_MAX) as { brique_code: string; missions: number }[]
  ).map((b) => ({
    brique_code: b.brique_code,
    missions: b.missions >= EFFECTIF_MINIMUM_PLANCHER ? b.missions : null,
  }));
  return { elements, tronque: r.rows.length > BRIQUES_MAX };
}
