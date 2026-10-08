import { aPermission, type Role } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import {
  exigerMissionModifiable,
  exigerMissionVisible,
  peutModifierMission,
  type MissionAcces,
} from "../missions/acces.js";
import { lireDefinition, type DefinitionKpi } from "./donnees.js";

/*
 * RÈGLES D'ACCÈS DU PILOTAGE PAR KPI (testées dans test/kpi-*.test.ts)
 *
 * Permissions de packages/shared/src/roles.ts, appelées par les routes
 * (routes/kpi.ts, routes/portail-kpi.ts) ; ni le responsable des ressources ni
 * le gestionnaire ne les détiennent (données confidentielles du client).
 *
 * 1. Lire (définitions, tableau de bord, export, historique, paramètres) :
 *    `kpi.lire` ET la mission du KPI VISIBLE (missions/acces.ts) ; sinon 404,
 *    comme un KPI d'un autre cabinet.
 * 2. Gérer (créer, modifier, cibles, contributeurs) : `kpi.gerer` et la
 *    mission MODIFIABLE (directeur, chef ou « mission.modifier_toutes »), non
 *    clôturée.
 * 3. Saisir une mesure côté cabinet : `kpi.saisir`, mission visible et non
 *    clôturée, et être directeur/chef (ou modifier toutes les missions),
 *    membre de l'équipe, ou propriétaire du KPI. Lire toutes les missions ne
 *    suffit pas. Annuler une mesure d'origine « portail » relève de la
 *    gestion : `kpi.gerer` et mission modifiable (403 sinon).
 * 4. Paramètres du cabinet (rappels, délai de grâce, dégradation) :
 *    `cabinet.gerer`.
 * 5. Propriétaire d'un KPI (destinataire des alertes et rappels) : utilisateur
 *    ACTIF du cabinet, détenteur de `kpi.lire`, directeur, chef ou membre de
 *    l'équipe de la mission (400 sinon). Au moment de notifier, le même
 *    contrôle est refait (kpi/suivi.ts).
 * 6. Portail : `portail.kpi.saisir` (dirigeant et contributeur du client,
 *    jamais l'investisseur) ET être contributeur désigné du KPI (partage
 *    explicite) ; tout le reste répond le 404 du portail.
 */

export interface AccesKpi {
  def: DefinitionKpi;
  mission: MissionAcces;
}

/** KPI dont la mission est visible, ou 404. `verrouiller` pose FOR UPDATE sur le KPI. */
export async function exigerKpiVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<AccesKpi> {
  const lu = await lireDefinition(db, id);
  if (!lu) throw introuvable("KPI");
  const mission = await exigerMissionVisible(db, auth, lu.mission_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("KPI") : e;
  });
  const def = verrouiller ? await lireDefinition(db, id, true) : lu;
  if (!def) throw introuvable("KPI");
  return { def, mission };
}

/** KPI dont la mission est modifiable par l'utilisateur (404 / 403 / 409), verrouillé. */
export async function exigerKpiGerable(db: Db, auth: Auth, id: string): Promise<AccesKpi> {
  const { def } = await exigerKpiVisible(db, auth, id);
  const mission = await exigerMissionModifiable(db, auth, def.mission_id);
  const verrouille = await lireDefinition(db, id, true);
  if (!verrouille) throw introuvable("KPI");
  return { def: verrouille, mission };
}

async function estMembreEquipe(db: Db, missionId: string, utilisateurId: string) {
  const r = await db.query(
    "SELECT 1 FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2",
    [missionId, utilisateurId],
  );
  return r.rowCount !== null && r.rowCount > 0;
}

/** Peut saisir les mesures de ce KPI (règle 3), sans contrôle de clôture. */
export async function peutSaisirKpi(db: Db, auth: Auth, acces: AccesKpi): Promise<boolean> {
  return (
    peutModifierMission(auth, acces.mission) ||
    acces.def.proprietaire_id === auth.utilisateurId ||
    (await estMembreEquipe(db, acces.mission.id, auth.utilisateurId))
  );
}

/** KPI dont l'utilisateur peut saisir les mesures (404 / 403 / 409), verrouillé. */
export async function exigerKpiSaisissable(db: Db, auth: Auth, id: string): Promise<AccesKpi> {
  const acces = await exigerKpiVisible(db, auth, id, true);
  if (!(await peutSaisirKpi(db, auth, acces))) throw interdit();
  if (acces.mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  return acces;
}

/** Annuler une mesure d'origine « portail » relève de la gestion du KPI (règle 3), sinon 403. */
export function exigerAnnulationPermise(auth: Auth, acces: AccesKpi, origine: string): void {
  if (origine !== "portail") return;
  if (!aPermission(auth.roles, "kpi.gerer") || !peutModifierMission(auth, acces.mission)) {
    throw interdit();
  }
}

interface Destinataire {
  id: string;
  roles: Role[];
  actif: boolean;
  /** Directeur, chef ou membre de l'équipe de la mission. */
  responsable: boolean;
}

/**
 * Parmi `ids`, les utilisateurs internes autorisés à recevoir les alertes et
 * rappels d'un KPI de la mission (règle 5) : actifs, `kpi.lire`, et
 * directeur, chef, membre de l'équipe ou lecteur de toutes les missions.
 */
export async function destinatairesKpiAutorises(
  db: Db,
  missionId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const r = await db.query(
    `SELECT u.id, u.roles, u.actif,
       (u.id IN (m.directeur_id, m.chef_id) OR EXISTS (SELECT 1 FROM mission_equipe e
          WHERE e.mission_id = m.id AND e.utilisateur_id = u.id)) AS responsable
     FROM utilisateurs u JOIN missions m ON m.id = $1
     WHERE u.id = ANY ($2::uuid[])`,
    [missionId, [...new Set(ids)]],
  );
  const autorises = new Set(
    (r.rows as Destinataire[])
      .filter(
        (u) =>
          u.actif &&
          aPermission(u.roles, "kpi.lire") &&
          (u.responsable || aPermission(u.roles, "mission.lire_toutes")),
      )
      .map((u) => u.id),
  );
  return ids.filter((id) => autorises.has(id));
}

/** Propriétaire admis pour un KPI de la mission (règle 5), sinon 400. */
export async function exigerProprietaireValide(
  db: Db,
  missionId: string,
  proprietaireId: string | null | undefined,
): Promise<void> {
  if (!proprietaireId) return;
  const r = await db.query(
    `SELECT u.roles, u.actif,
       (u.id IN (m.directeur_id, m.chef_id) OR EXISTS (SELECT 1 FROM mission_equipe e
          WHERE e.mission_id = m.id AND e.utilisateur_id = u.id)) AS responsable
     FROM utilisateurs u JOIN missions m ON m.id = $1 WHERE u.id = $2`,
    [missionId, proprietaireId],
  );
  const u = r.rows[0] as Omit<Destinataire, "id"> | undefined;
  if (!u || !u.actif || !u.responsable || !aPermission(u.roles, "kpi.lire")) {
    throw requeteInvalide(
      "Le propriétaire d'un KPI est un directeur, chef ou membre de l'équipe de la mission, actif, qui lit les KPI.",
    );
  }
}
