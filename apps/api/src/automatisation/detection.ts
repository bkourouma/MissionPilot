import {
  ErreurKpi,
  joursEcoules,
  palierAtteint,
  PALIERS_SANS_REPONSE_JOURS,
  serieRougeFinale,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import {
  ciblesDe,
  COLONNES_KPI,
  lireParametresKpi,
  mesuresActivesDe,
  parKpi,
  versDefinition,
} from "../kpi/donnees.js";
import { evaluerSerieKpi } from "../kpi/evaluation.js";
import type { Envoi } from "../questionnaires/acces.js";
import { repondantsEnAttente } from "../questionnaires/relances.js";
import { publierEvenement } from "./evenements.js";

/*
 * DÉTECTION DES ÉVÉNEMENTS NÉS DU TEMPS (AUT-01) — tâche quotidienne
 * `automatisation_detection` (clé `automatisation_detection:AAAA-MM-JJ`, 7 h 30 UTC, après le
 * suivi des KPI), pour chaque cabinet qui a une automatisation (active ou non) sur l'un de ces
 * événements et une mission non clôturée (0302) :
 * - questionnaire envoyé dont des répondants n'ont pas répondu : un événement par palier
 *   (J+3, J+7, J+10, J+14 ; le plus haut atteint seulement, clé `envoi:jN`) ;
 * - KPI dont les dernières périodes mesurées sont rouges au moins deux fois de suite : un
 *   événement par période (clé `kpi:période`), statuts calculés par le moteur KPI.
 * Lecture seule des modules ; publication idempotente (`publierEvenement`, origine système).
 */

export const TYPE_JOB_DETECTION_AUTOMATISATION = "automatisation_detection";
/** Heure de la détection (UTC), après le suivi quotidien des KPI (7 h) ; à valider. */
export const HEURE_DETECTION_AUTOMATISATION_UTC = "07:30:00";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function planificationDetectionAutomatisation(maintenant: Date): {
  cle: string;
  executeA: Date;
} {
  const jour = maintenant.toISOString().slice(0, 10);
  return {
    cle: `${TYPE_JOB_DETECTION_AUTOMATISATION}:${jour}`,
    executeA: new Date(`${jour}T${HEURE_DETECTION_AUTOMATISATION_UTC}Z`),
  };
}

/**
 * Planifie la détection du jour (fonction SECURITY DEFINER étroite, 0302), dans la connexion
 * hors contexte de cabinet du planificateur récurrent (`jobs/planificateur.ts`).
 */
export async function planifierDetectionAutomatisation(db: Db, maintenant: Date): Promise<number> {
  const p = planificationDetectionAutomatisation(maintenant);
  const r = await db.query("SELECT planifier_detection_automatisation($1, $2) AS n", [
    p.cle,
    p.executeA,
  ]);
  return r.rows[0].n as number;
}

async function detecterQuestionnaires(db: Db, maintenant: Date): Promise<number> {
  const r = await db.query(
    `SELECT e.id, e.mission_id, e.titre, e.mode, e.envoye_le FROM questionnaire_envois e
     JOIN missions m ON m.id = e.mission_id
     WHERE e.statut = 'envoye' AND m.statut <> 'cloturee' ORDER BY e.id`,
  );
  let publies = 0;
  for (const e of r.rows as (Pick<Envoi, "id" | "mission_id" | "titre" | "mode"> & {
    envoye_le: Date;
  })[]) {
    const jours = joursEcoules(e.envoye_le.toISOString(), maintenant.toISOString());
    const palier = palierAtteint(jours, PALIERS_SANS_REPONSE_JOURS);
    if (palier === null) continue;
    const enAttente = (await repondantsEnAttente(db, e)).length;
    if (enAttente === 0) continue;
    const p = await publierEvenement(db, "systeme", {
      code: "questionnaire.sans_reponse",
      payload: {
        mission_id: e.mission_id,
        envoi_id: e.id,
        titre: e.titre,
        jours_sans_reponse: palier,
        repondants_en_attente: enAttente,
      },
      cle: `${e.id}:j${palier}`,
    });
    if (p.nouveau) publies += 1;
  }
  return publies;
}

async function detecterKpi(db: Db, jour: string): Promise<number> {
  const r = await db.query(
    `SELECT ${COLONNES_KPI} FROM kpi_definitions d JOIN missions m ON m.id = d.mission_id
     WHERE d.actif AND m.statut <> 'cloturee' ORDER BY d.id`,
  );
  const defs = r.rows.map(versDefinition);
  if (defs.length === 0) return 0;
  const ids = defs.map((d) => d.id);
  const params = await lireParametresKpi(db);
  const cibles = parKpi(await ciblesDe(db, ids));
  const mesures = parKpi(await mesuresActivesDe(db, ids));
  let publies = 0;
  for (const def of defs) {
    let periodes;
    try {
      periodes = evaluerSerieKpi(
        def,
        mesures.get(def.id) ?? [],
        cibles.get(def.id) ?? [],
        jour,
        params,
      ).periodes;
    } catch (error) {
      if (error instanceof ErreurKpi) continue;
      throw error;
    }
    const serie = serieRougeFinale(
      periodes
        .filter((p) => p.close)
        .map((p) => ({
          cle: p.cle,
          statut: p.valeur === null ? "non_mesure" : p.evaluation.statut,
        })),
    );
    if (!serie) continue;
    const p = await publierEvenement(db, "systeme", {
      code: "kpi.rouge_deux_periodes",
      payload: {
        mission_id: def.mission_id,
        kpi_id: def.id,
        libelle: def.libelle.slice(0, 500),
        periode: serie.periode,
        periodes_rouges: serie.periodes,
      },
      cle: `${def.id}:${serie.periode}`,
    });
    if (p.nouveau) publies += 1;
  }
  return publies;
}

/** Détecte et publie les événements dus à cette date ; renvoie le nombre de nouveaux. */
export async function detecterEvenements(
  db: Db,
  maintenant: Date,
): Promise<{ questionnaires: number; kpi: number }> {
  const jour = maintenant.toISOString().slice(0, 10);
  return {
    questionnaires: await detecterQuestionnaires(db, maintenant),
    kpi: await detecterKpi(db, jour),
  };
}

export function creerHandlerDetectionAutomatisation(): HandlerJob {
  return async (ctx) => {
    const jour = ctx.charge.jour;
    if (jour !== undefined && (typeof jour !== "string" || !DATE.test(jour))) {
      throw new ErreurJobDefinitive("Charge de la détection invalide.");
    }
    await detecterEvenements(ctx.db, ctx.maintenant);
    return [];
  };
}
