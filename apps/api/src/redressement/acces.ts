import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable } from "../errors.js";
import {
  exigerMissionModifiable,
  exigerMissionVisible,
  peutModifierMission,
  type MissionAcces,
} from "../missions/acces.js";

/*
 * RÈGLES D'ACCÈS DU REDRESSEMENT (testées dans test/redressement-*.test.ts)
 *
 * Permissions `redressement.*` de packages/shared/src/roles.ts, appelées par les routes ; ni le
 * responsable des ressources, ni le gestionnaire, ni l'expert externe ne les détiennent (données
 * du client). La visibilité de la MISSION est toujours exigée en plus.
 *
 * 1. Lire (`redressement.lire`) : le dossier est visible si sa mission l'est
 *    (`exigerMissionVisible`). Un dossier inconnu, d'un autre cabinet ou d'une mission invisible
 *    répond 404, comme un créancier, une action ou une version de plan dont le dossier est invisible.
 * 2. Écrire (`redressement.ecrire`) : dossier visible ET (peut modifier la mission, ou membre de
 *    son équipe) sinon 403 ; dossier non clos (409 RED_DOSSIER_CLOS) ; mission non clôturée (409
 *    RED_MISSION_CLOTUREE). Lire toutes les missions ne suffit pas à écrire. Le verrou consultatif
 *    du dossier est pris EN TOUT PREMIER (numérotation, plafonds, chaînes de remplacement).
 * 3. Ouvrir un dossier : `redressement.ecrire` et mission modifiable (directeur, chef ou
 *    `mission.modifier_toutes`) ; un simple membre d'équipe n'ouvre pas.
 * 4. Valider (`redressement.valider`) : dossier visible ; la séparation des tâches est contrôlée
 *    par les services (plan.ts) ET par la base (MPZ07).
 * 5. Seuils (`redressement.parametrer`) : pas de mission ; la lecture est ouverte à
 *    `redressement.lire`.
 * 6. Une personne du portail n'est jamais désignée (responsable d'action, assignée d'une tâche) ;
 *    toutes les routes sont fermées au portail (liste blanche vide, tables en `portail_interdit`).
 * 7. FIN-02 : ce module ne porte aucune donnée du CABINET (honoraires, budget, coûts, taux, marge
 *    de mission) ; les montants sont ceux du client et relèvent de `redressement.lire`.
 */

export interface DossierRed {
  id: string;
  mission_id: string;
  client_id: string;
  intitule: string;
  secteur: string;
  devise: string;
  statut: string;
  motif_cloture: string | null;
  clos_le: Date | null;
  clos_par: string | null;
  cree_par: string;
  cree_le: Date;
  modifie_le: Date;
}

export const COLONNES_DOSSIER = `d.id, d.mission_id, d.client_id, d.intitule, d.secteur, d.devise, d.statut,
  d.motif_cloture, d.clos_le, d.clos_par, d.cree_par, d.cree_le, d.modifie_le`;

export async function lireDossier(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<DossierRed | null> {
  const r = await db.query(
    `SELECT ${COLONNES_DOSSIER} FROM red_dossiers d WHERE d.id = $1 ${verrouiller ? "FOR UPDATE OF d" : ""}`,
    [id],
  );
  return (r.rows[0] as DossierRed | undefined) ?? null;
}

/** Verrou consultatif du dossier (modèle dossier/acces.ts) : à prendre avant toute lecture dont une règle dépend. */
export async function verrouillerDossierRed(db: Db, cle: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`redressement:${cle}`]);
}

export interface AccesDossierRed {
  dossier: DossierRed;
  mission: MissionAcces;
}

/** Dossier dont la mission est visible, ou 404 (le même pour un dossier inconnu ou d'autrui). */
export async function exigerDossierRedVisible(
  db: Db,
  auth: Auth,
  id: string,
): Promise<AccesDossierRed> {
  const dossier = await lireDossier(db, id);
  if (!dossier) throw introuvable("Dossier de redressement");
  const mission = await exigerMissionVisible(db, auth, dossier.mission_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Dossier de redressement") : e;
  });
  return { dossier, mission };
}

async function estMembreEquipe(db: Db, missionId: string, utilisateurId: string): Promise<boolean> {
  const r = await db.query(
    "SELECT 1 FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2",
    [missionId, utilisateurId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Peut écrire dans le dossier de cette mission (règle 2), sans contrôle de clôture. */
export async function peutEcrireDansDossier(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
): Promise<boolean> {
  return (
    peutModifierMission(auth, mission) ||
    (await estMembreEquipe(db, mission.id, auth.utilisateurId))
  );
}

function exigerOuvert({ dossier, mission }: AccesDossierRed): void {
  if (dossier.statut === "clos") {
    throw new AppError(409, "RED_DOSSIER_CLOS", "Le dossier de redressement est clos.");
  }
  if (mission.statut === "cloturee") {
    throw new AppError(409, "RED_MISSION_CLOTUREE", "La mission est clôturée.");
  }
}

/**
 * Dossier ouvert à l'écriture de l'utilisateur (404 / 403 / 409), VERROUILLÉ : le verrou
 * consultatif est pris avant toute lecture.
 */
export async function exigerDossierRedEcriture(
  db: Db,
  auth: Auth,
  id: string,
): Promise<AccesDossierRed> {
  await verrouillerDossierRed(db, id);
  const acces = await exigerDossierRedVisible(db, auth, id);
  if (!(await peutEcrireDansDossier(db, auth, acces.mission))) throw interdit();
  exigerOuvert(acces);
  return acces;
}

/** Ouverture d'un dossier : mission modifiable (404 / 403 / 409), sans dossier existant (409 RED_EXISTE). */
export async function exigerOuverturePossible(
  db: Db,
  auth: Auth,
  missionId: string,
): Promise<MissionAcces> {
  await verrouillerDossierRed(db, `mission:${missionId}`);
  const mission = await exigerMissionModifiable(db, auth, missionId).catch((e: unknown) => {
    if (e instanceof AppError && e.statut === 409) {
      throw new AppError(409, "RED_MISSION_CLOTUREE", "La mission est clôturée.");
    }
    throw e;
  });
  const existe = await db.query("SELECT 1 FROM red_dossiers WHERE mission_id = $1", [missionId]);
  if ((existe.rowCount ?? 0) > 0) {
    throw new AppError(409, "RED_EXISTE", "Cette mission a déjà un dossier de redressement.");
  }
  return mission;
}

/** Dossier valable pour valider : visible, non clos ; verrouillé (la séparation des tâches est dans plan.ts). */
export async function exigerDossierRedValidation(
  db: Db,
  auth: Auth,
  id: string,
): Promise<AccesDossierRed> {
  await verrouillerDossierRed(db, id);
  const acces = await exigerDossierRedVisible(db, auth, id);
  exigerOuvert(acces);
  return acces;
}

/** Le premier diagnostic (urgence ou score) fait passer un dossier « ouvert » à « diagnostic ». */
export async function passerEnDiagnostic(db: Db, auth: Auth, dossier: DossierRed): Promise<void> {
  if (dossier.statut !== "ouvert") return;
  await db.query("UPDATE red_dossiers SET statut = 'diagnostic', modifie_par = $2 WHERE id = $1", [
    dossier.id,
    auth.utilisateurId,
  ]);
}
