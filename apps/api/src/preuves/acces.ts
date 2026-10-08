import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { exigerMissionVisible, peutModifierMission, type MissionAcces } from "../missions/acces.js";

/*
 * Droits du registre des preuves, en plus de `preuve.lire` / `preuve.ecrire` (vérifiés par la
 * route) :
 * - lire : la mission doit être visible (404 sinon, comme une mission d'un autre cabinet) ;
 * - écrire : mission visible ET non clôturée (409). Un membre de l'équipe écrit (c'est lui qui
 *   recueille les preuves) ; il n'a pas besoin de « modifier » la mission. La ligne de la mission
 *   est verrouillée pour la transaction : les écritures d'une mission se sérialisent (le rôle
 *   applicatif n'a pas UPDATE sur les tables du registre, donc pas de FOR UPDATE dessus).
 * - verbatim nominatif sans accord : visible de son auteur, de qui l'a saisi et de ceux qui
 *   modifient la mission (associé, directeur, chef) ; masqué pour les autres.
 */

export async function exigerMissionLisible(
  db: Db,
  auth: Auth,
  missionId: string,
  quoi = "Mission",
): Promise<MissionAcces> {
  try {
    return await exigerMissionVisible(db, auth, missionId);
  } catch (e) {
    throw e instanceof AppError && e.statut === 404 ? introuvable(quoi) : e;
  }
}

export async function exigerMissionEcrivable(
  db: Db,
  auth: Auth,
  missionId: string,
  quoi = "Mission",
): Promise<MissionAcces> {
  let mission: MissionAcces;
  try {
    mission = await exigerMissionVisible(db, auth, missionId, true);
  } catch (e) {
    throw e instanceof AppError && e.statut === 404 ? introuvable(quoi) : e;
  }
  if (mission.statut === "cloturee") {
    throw new AppError(
      409,
      "MISSION_CLOTUREE",
      "La mission est clôturée : le registre des preuves est figé.",
    );
  }
  return mission;
}

/** Peut voir l'extrait d'un verbatim nominatif sans accord. */
export function peutVoirNominatif(
  auth: Auth,
  mission: MissionAcces,
  preuve: { auteur_id: string; cree_par: string },
): boolean {
  return (
    peutModifierMission(auth, mission) ||
    preuve.auteur_id === auth.utilisateurId ||
    preuve.cree_par === auth.utilisateurId
  );
}
