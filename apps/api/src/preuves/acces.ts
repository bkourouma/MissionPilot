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
 * - auteur désigné d'une preuve : membre actif de la mission ; signer un avis d'expert ou abaisser
 *   la classe de risque d'une assertion : expert métier ou associé.
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

/**
 * Membre ACTIF de la mission : utilisateur actif, directeur ou chef de la mission, ou membre de
 * son équipe (doublé en base par `est_membre_actif_mission`, migration 0243). Sert aussi au lot
 * qualité (auteur désigné d'un livrable).
 */
export async function estMembreActifMission(
  db: Db,
  missionId: string,
  utilisateurId: string,
): Promise<boolean> {
  const r = await db.query("SELECT est_membre_actif_mission($1, $2) AS membre", [
    missionId,
    utilisateurId,
  ]);
  return r.rows[0]?.membre === true;
}

/** 400 si l'auteur désigné n'est pas un membre actif de la mission. */
export async function exigerAuteurMembre(
  db: Db,
  missionId: string,
  utilisateurId: string,
): Promise<void> {
  if (!(await estMembreActifMission(db, missionId, utilisateurId))) {
    throw new AppError(
      400,
      "AUTEUR_NON_MEMBRE",
      "L'auteur désigné doit être un membre actif de la mission.",
    );
  }
}

/**
 * Habilitation d'expert du registre (PRV-03) : signer un avis d'expert, abaisser la classe de
 * risque d'une assertion. Rôle `expert_metier` ou `associe` (doublé en base : MPV04, MPV06). Le
 * rôle expert_metier n'a pas `preuve.ecrire` : seul un utilisateur qui cumule l'écriture et ce
 * rôle (ou un associé) l'exerce par les routes d'écriture.
 */
export function aHabilitationExpert(auth: Auth): boolean {
  return auth.roles.includes("expert_metier") || auth.roles.includes("associe");
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
