import { aPermission, type StatutMission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, interdit, introuvable } from "../errors.js";

/*
 * RÈGLE DE VISIBILITÉ DES MISSIONS (écrite ici, testée dans test/missions.test.ts)
 *
 * 1. Toute lecture exige d'abord la permission de la route (mission.lire,
 *    budget.lire_jours…) ; l'isolation entre cabinets est assurée par RLS.
 * 2. Avec « mission.lire_toutes » (associé, directeur de mission, responsable
 *    des ressources, gestionnaire), l'utilisateur voit toutes les missions du
 *    cabinet, dans la limite de ses autres droits.
 * 3. Sans elle (chef de mission, consultant, expert métier), il ne voit que
 *    les missions dont il est directeur ou chef, ou dont il est membre de
 *    l'équipe (mission_equipe). Une mission invisible répond 404, comme une
 *    mission d'un autre cabinet : on ne révèle pas son existence.
 * 4. Modifier une mission (découpage, budget, statut…) exige en plus la
 *    permission de la route et : « mission.lire_toutes », ou d'être directeur
 *    ou chef de cette mission. Un simple membre de l'équipe la lit sans la
 *    modifier (403).
 */

export interface MissionAcces {
  id: string;
  statut: StatutMission;
  devise: string;
  directeur_id: string | null;
  chef_id: string | null;
  client_id: string;
  date_debut: string | null;
  date_signature: string | null;
  taux_change: string | null;
  devise_reference: string | null;
  proposition_id: string | null;
}

export const voitToutesLesMissions = (auth: Auth) => aPermission(auth.roles, "mission.lire_toutes");

/**
 * Fragment SQL de visibilité pour un alias de table `m` : à utiliser avec
 * deux paramètres, (voit_toutes boolean, utilisateur_id uuid).
 */
export function filtreVisibilite(pVoitToutes: number, pUtilisateur: number): string {
  return `($${pVoitToutes}::boolean OR m.directeur_id = $${pUtilisateur} OR m.chef_id = $${pUtilisateur}
    OR EXISTS (SELECT 1 FROM mission_equipe e WHERE e.mission_id = m.id
               AND e.utilisateur_id = $${pUtilisateur}))`;
}

const COLONNES_ACCES = `m.id, m.statut, m.devise, m.directeur_id, m.chef_id, m.client_id,
  m.date_debut::text AS date_debut, m.date_signature::text AS date_signature, m.taux_change::text AS taux_change,
  m.devise_reference, m.proposition_id`;

/** Mission visible par l'utilisateur, ou 404. `verrouiller` pose FOR UPDATE (écritures sérialisées). */
export async function exigerMissionVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<MissionAcces> {
  const r = await db.query(
    `SELECT ${COLONNES_ACCES} FROM missions m
     WHERE m.id = $1 AND ${filtreVisibilite(2, 3)} ${verrouiller ? "FOR UPDATE OF m" : ""}`,
    [id, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  if (!r.rows[0]) throw introuvable("Mission");
  return r.rows[0] as MissionAcces;
}

/** Peut modifier : voit toutes les missions, ou en est directeur ou chef. */
export function peutModifierMission(auth: Auth, mission: MissionAcces): boolean {
  return (
    voitToutesLesMissions(auth) ||
    mission.directeur_id === auth.utilisateurId ||
    mission.chef_id === auth.utilisateurId
  );
}

/**
 * Mission modifiable par l'utilisateur (404 si invisible, 403 si simple
 * membre, 409 si clôturée). Verrouille la ligne pour la transaction.
 */
export async function exigerMissionModifiable(
  db: Db,
  auth: Auth,
  id: string,
): Promise<MissionAcces> {
  const mission = await exigerMissionVisible(db, auth, id, true);
  if (!peutModifierMission(auth, mission)) throw interdit();
  if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  return mission;
}

export const STATUTS_SIGNES: readonly StatutMission[] = [
  "signee",
  "en_cours",
  "a_cloturer",
  "cloturee",
];
