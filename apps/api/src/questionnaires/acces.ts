import type { FastifyRequest } from "fastify";
import { aPermission, type Permission } from "@missionpilot/shared";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import { exigerMissionVisible, type MissionAcces } from "../missions/acces.js";

/*
 * RÈGLES D'ACCÈS DES QUESTIONNAIRES ET DE LA NOTATION (côté cabinet)
 *
 * 1. Chaque route exige sa permission (questionnaire.lire / .gerer,
 *    notation.gerer / .publier) ; l'isolation entre cabinets est assurée par
 *    RLS et par les clés composites.
 * 2. Tout envoi, toute réponse et toute notation se rattachent à une mission :
 *    ils ne sont lus ou modifiés que si la mission est VISIBLE pour
 *    l'utilisateur (missions/acces.ts) ; sinon 404, comme un identifiant
 *    inexistant ou d'un autre cabinet. Les modèles et grilles sont des
 *    référentiels du cabinet.
 * 3. Écrire (envoyer, relancer, calculer, ajuster) exige en plus une mission
 *    non clôturée (409). Un membre de l'équipe (consultant) peut écrire :
 *    « le consultant et le chef de mission rédigent, valident et envoient »
 *    (DECISIONS.md, V2).
 */

/** Utilisateur connecté détenant AU MOINS UNE des permissions (sinon 401/403). */
export function exigerUnDe(request: FastifyRequest, permissions: readonly Permission[]): Auth {
  const auth = exiger(request);
  if (!permissions.some((p) => aPermission(auth.roles, p))) throw interdit();
  return auth;
}

/**
 * Rôle `expert_metier` exigé (NOT-07, DECISIONS.md : un expert valide
 * obligatoirement), sinon 403 : publier ou renvoyer une notation, valider une
 * version de grille. La permission « notation.publier » ne suffit pas (un
 * associé la détient sans être expert).
 */
export function exigerExpertMetier(auth: Auth, action: string): void {
  if (!auth.roles.includes("expert_metier")) {
    throw new AppError(
      403,
      "EXPERT_METIER_REQUIS",
      `Seul un expert métier ${action} (NOT-07) : faites relire par un expert du cabinet.`,
    );
  }
}

/** Mission visible et non clôturée, sinon 404 / 409. */
export async function exigerMissionOuverte(
  db: Db,
  auth: Auth,
  missionId: string,
  verrouiller = false,
): Promise<MissionAcces> {
  const mission = await exigerMissionVisible(db, auth, missionId, verrouiller);
  if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  return mission;
}

/** Mission visible (sinon le 404 de la ressource rattachée, `quoi`) ; `verrouiller` pose FOR UPDATE. */
export async function missionVisibleOu404(
  db: Db,
  auth: Auth,
  missionId: string,
  quoi: string,
  verrouiller = false,
): Promise<MissionAcces> {
  try {
    return await exigerMissionVisible(db, auth, missionId, verrouiller);
  } catch (error) {
    if (error instanceof AppError && error.statut === 404) throw introuvable(quoi);
    throw error;
  }
}

export interface Envoi {
  id: string;
  mission_id: string;
  client_id: string;
  version_id: string;
  definition: unknown;
  titre: string;
  mode: "individuel" | "collectif" | "par_fonction";
  statut: "brouillon" | "envoye" | "clos";
  relances_auto: boolean;
  date_limite: string | null;
  cree_par: string;
  cree_le: Date;
  envoye_par: string | null;
  envoye_le: Date | null;
  clos_le: Date | null;
}

export const COLONNES_ENVOI = `e.id, e.mission_id, e.client_id, e.version_id, e.definition, e.titre,
  e.mode, e.statut, e.relances_auto, e.date_limite::text AS date_limite, e.cree_par, e.cree_le,
  e.envoye_par, e.envoye_le, e.clos_le`;

/** Envoi dont la mission est visible, sinon 404. `verrouiller` pose FOR UPDATE. */
export async function exigerEnvoiVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<Envoi> {
  const r = await db.query(
    `SELECT ${COLONNES_ENVOI} FROM questionnaire_envois e WHERE e.id = $1
     ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  const envoi = r.rows[0] as Envoi | undefined;
  if (!envoi) throw introuvable("Questionnaire");
  await missionVisibleOu404(db, auth, envoi.mission_id, "Questionnaire");
  return envoi;
}
