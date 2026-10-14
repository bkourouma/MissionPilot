import type { FaitsSynthese } from "@missionpilot/engines";
import type { Database, Db } from "../db/pool.js";
import {
  ciblesDe,
  COLONNES_KPI,
  lireParametresKpi,
  mesuresActivesDe,
  parKpi,
  versDefinition,
} from "../kpi/donnees.js";
import { evaluerSerieKpi } from "../kpi/evaluation.js";

/*
 * Sources de la synthèse hebdomadaire du dirigeant (CLI-07, SPEC-3c §7.4) : MÊMES lectures et MÊMES
 * moteurs que le portail, lues SOUS LE CONTEXTE DU PORTAIL du dirigeant (`app.portail_client_id` et
 * `app.portail_utilisateur_id` posés dans une transaction dédiée) en plus des filtres explicites :
 * double barrière, rien d'un autre client ni du cabinet ne peut y entrer. Aucune source ne lit un
 * montant interne, un coût ni une marge (FIN-02).
 */

/** Paramètres KPI du cabinet : lus HORS du contexte du portail (`kpi_parametres` lui est fermée). */
async function parametresKpi(database: Database, cabinetId: string) {
  return database.withTenant(cabinetId, (db) => lireParametresKpi(db));
}

async function faitsDansContextePortail(
  db: Db,
  p: { clientId: string; utilisateurId: string; date: string },
  params: Awaited<ReturnType<typeof lireParametresKpi>>,
): Promise<FaitsSynthese> {
  await db.query(
    `SELECT set_config('app.portail_client_id', $1, true),
            set_config('app.portail_utilisateur_id', $2, true)`,
    [p.clientId, p.utilisateurId],
  );
  // KPI dont il est contributeur désigné, de missions non clôturées (fonction étroite 0115 : la
  // mission n'est pas visible du portail tant qu'elle n'est pas partagée).
  const kpis = await db.query(
    `SELECT ${COLONNES_KPI} FROM kpi_definitions d
     WHERE d.client_id = $1 AND d.actif
       AND EXISTS (SELECT 1 FROM kpi_contributeurs k WHERE k.kpi_id = d.id AND k.utilisateur_id = $2)
       AND portail_kpi_mission_cloturee(d.id) IS FALSE
     ORDER BY d.id LIMIT 200`,
    [p.clientId, p.utilisateurId],
  );
  const defs = kpis.rows.map(versDefinition);
  const ids = defs.map((d) => d.id);
  const cibles = parKpi(await ciblesDe(db, ids));
  const mesures = parKpi(await mesuresActivesDe(db, ids));
  let kpiRouges = 0;
  let kpiOranges = 0;
  for (const def of defs) {
    const statut = evaluerSerieKpi(
      def,
      mesures.get(def.id) ?? [],
      cibles.get(def.id) ?? [],
      p.date,
      params,
    ).statut;
    if (statut === "rouge") kpiRouges += 1;
    else if (statut === "orange") kpiOranges += 1;
  }
  // Jalons atteints que le client n'a pas encore validés (missions partagées AVEC leurs jalons).
  const jalons = await db.query(
    `SELECT count(*)::int AS n FROM mission_jalons j
     WHERE j.atteint
       AND EXISTS (SELECT 1 FROM portail_partages s WHERE s.mission_id = j.mission_id
                   AND s.client_id = $1 AND s.document_id IS NULL AND s.jalons)
       AND NOT EXISTS (SELECT 1 FROM portail_validations_jalons v
                       WHERE v.jalon_id = j.id AND v.client_id = $1)`,
    [p.clientId],
  );
  // Questionnaires envoyés dont il est répondant et qu'il n'a pas soumis (collectif : réponse partagée).
  const questionnaires = await db.query(
    `SELECT count(*)::int AS n FROM questionnaire_repondants r
     JOIN questionnaire_envois e ON e.id = r.envoi_id AND e.statut = 'envoye'
     WHERE r.utilisateur_id = $2 AND r.client_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM questionnaire_reponses q
         WHERE q.statut = 'soumise'
           AND (q.repondant_id = r.id OR (e.mode = 'collectif' AND q.envoi_id = e.id
                                          AND q.repondant_id IS NULL)))`,
    [p.clientId, p.utilisateurId],
  );
  // Pièces attendues des demandes envoyées à son entreprise (jamais reçues, ou rejetées).
  const pieces = await db.query(
    `SELECT count(*)::int AS n FROM salle_pieces sp
     JOIN salle_demandes d ON d.id = sp.demande_id AND d.statut = 'envoyee'
     WHERE d.client_id = $1
       AND COALESCE((SELECT ev.statut FROM salle_piece_evenements ev
                     WHERE ev.piece_id = sp.id ORDER BY ev.rang DESC LIMIT 1), 'demandee')
           IN ('demandee', 'rejetee')`,
    [p.clientId],
  );
  // Documents à signer : demandes de signature où il est invité.
  const signatures = await db.query(
    `SELECT count(*)::int AS n FROM signatures_signataires s
     JOIN signatures_demandes d ON d.id = s.demande_id AND d.statut IN ('envoyee', 'partielle')
     WHERE s.utilisateur_id = $2 AND s.statut = 'invite' AND d.client_id = $1`,
    [p.clientId, p.utilisateurId],
  );
  return {
    kpiRouges,
    kpiOranges,
    jalonsAValider: jalons.rows[0].n as number,
    questionnairesACompleter: questionnaires.rows[0].n as number,
    piecesAttendues: pieces.rows[0].n as number,
    documentsASigner: signatures.rows[0].n as number,
  };
}

/**
 * Faits de la synthèse d'un dirigeant : calculés dans une transaction DÉDIÉE posée sous le contexte
 * du portail de ce dirigeant (la transaction de l'appelant garde son accès complet).
 */
export async function lireFaitsSynthese(
  database: Database,
  cabinetId: string,
  p: { clientId: string; utilisateurId: string; date: string },
): Promise<FaitsSynthese> {
  const params = await parametresKpi(database, cabinetId);
  return database.withTenant(cabinetId, (db) => faitsDansContextePortail(db, p, params));
}
