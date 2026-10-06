import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, interdit, introuvable } from "../errors.js";
import {
  estAssocie,
  filtreVisibilite,
  modifieToutesLesMissions,
  voitToutesLesMissions,
} from "../missions/acces.js";

/*
 * RÈGLES D'ACCÈS AU PLAN STRATÉGIQUE (testées dans test/plans-*.test.ts)
 *
 * Un plan appartient à une mission : il en suit la visibilité
 * (missions/acces.ts). Un plan invisible, ou d'un autre cabinet, répond 404
 * comme un plan inexistant (on ne révèle pas son existence).
 *
 * Permissions de packages/shared/src/roles.ts, appelées par routes/plans.ts ;
 * ni le responsable des ressources ni le gestionnaire ne les détiennent
 * (masse salariale et états financiers du client confidentiels).
 *
 * - Lire : « plan.lire » et mission visible.
 * - Rédiger (éléments, versions, modèle financier, simulation) :
 *   « plan.ecrire », mission visible (membre de l'équipe compris) et non
 *   clôturée (409).
 * - Créer un plan : « plan.ecrire » ET responsable de la mission (directeur,
 *   chef, ou « mission.modifier_toutes ») ; sinon 403.
 * - Valider un contenu ou une version du modèle : « plan.valider » ET
 *   responsable de la mission ; sinon 403.
 * - Séparation des tâches : le valideur n'a écrit aucune version du contenu
 *   depuis sa dernière validation (pour le modèle : n'est pas l'auteur de la
 *   version), sauf associé ou directeur de CETTE mission. Doublée en base
 *   (migrations 0180 et 0181).
 * - Partager au client : « portail.gerer » et responsable de la mission ;
 *   tout le contenu doit être validé (déclencheur 0181). Toute écriture
 *   ultérieure qui produit un contenu non validé (élément créé, version
 *   brouillon ou modifiée, version du modèle) RETIRE le partage dans la même
 *   transaction (plans/partage.ts) : rien de non validé n'est exposé.
 */

/** Nombre maximal d'éléments par plan : la lecture complète du plan reste bornée. */
export const ELEMENTS_PAR_PLAN_MAX = 300;

export interface PlanAcces {
  id: string;
  mission_id: string;
  titre: string;
  horizon: number;
  devise: string;
  partage_client: boolean;
  partage_par: string | null;
  partage_le: string | null;
  cree_par: string;
  cree_le: string;
  mission_statut: string;
  directeur_id: string | null;
  chef_id: string | null;
  client_id: string;
}

export const COLONNES_PLAN = `p.id, p.mission_id, p.titre, p.horizon, p.devise, p.partage_client,
  p.partage_par, p.partage_le, p.cree_par, p.cree_le`;

/** Plan visible par l'utilisateur (visibilité de sa mission), ou 404. */
export async function exigerPlanVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<PlanAcces> {
  const r = await db.query(
    `SELECT ${COLONNES_PLAN}, m.statut AS mission_statut, m.directeur_id, m.chef_id, m.client_id
     FROM plans_strategiques p JOIN missions m ON m.id = p.mission_id
     WHERE p.id = $1 AND ${filtreVisibilite(2, 3)} ${verrouiller ? "FOR UPDATE OF p" : ""}`,
    [id, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  if (!r.rows[0]) throw introuvable("Plan stratégique");
  return r.rows[0] as PlanAcces;
}

/** Plan rédigeable : visible, verrouillé pour la transaction, mission non clôturée. */
export async function exigerPlanRedigeable(db: Db, auth: Auth, id: string): Promise<PlanAcces> {
  const plan = await exigerPlanVisible(db, auth, id, true);
  if (plan.mission_statut === "cloturee") throw conflit("La mission est clôturée.");
  return plan;
}

/** Responsable de la mission du plan : directeur, chef, ou modifie toutes les missions. */
export function estResponsablePlan(
  auth: Auth,
  mission: { directeur_id: string | null; chef_id: string | null },
): boolean {
  return (
    modifieToutesLesMissions(auth) ||
    mission.directeur_id === auth.utilisateurId ||
    mission.chef_id === auth.utilisateurId
  );
}

/** Plan pilotable (validation, partage) : rédigeable et responsable de la mission (403 sinon). */
export async function exigerPlanPilotable(db: Db, auth: Auth, id: string): Promise<PlanAcces> {
  const plan = await exigerPlanRedigeable(db, auth, id);
  if (!estResponsablePlan(auth, plan)) throw interdit();
  return plan;
}

/** Dispense de la séparation des tâches : associé ou directeur de la mission du plan. */
export function valideurDispense(auth: Auth, plan: PlanAcces): boolean {
  return estAssocie(auth) || plan.directeur_id === auth.utilisateurId;
}
