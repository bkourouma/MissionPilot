import type { DestinataireAutomatisation, ModeExecutionAutomatisation } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { authDe } from "../collaboration/entites.js";
import type { Db } from "../db/pool.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";

/*
 * Identité d'exécution d'une automatisation (AUT-05) : les actions s'exécutent dans les droits
 * ACTUELS d'une personne du cabinet, relus à chaque exécution :
 * - `responsable` : le « compte d'automatisation » restreint, c'est-à-dire le responsable de
 *   l'automatisation (actif), limité aux actions typées du registre, chacune contrôlant SA
 *   permission et la visibilité de la mission ;
 * - `declencheur` : la personne à l'origine de l'événement (aucune pour un événement système
 *   ou de la base : l'action est alors refusée).
 */

export interface ContexteMission {
  id: string;
  chef_id: string | null;
  directeur_id: string | null;
}

export async function executantDe(
  db: Db,
  cabinetId: string,
  mode: ModeExecutionAutomatisation,
  responsableId: string,
  acteurId: string | null,
): Promise<Auth | null> {
  const id = mode === "responsable" ? responsableId : acteurId;
  if (!id) return null;
  const auth = await authDe(db, cabinetId, id);
  // Jamais une personne du portail client (rôles disjoints, contrôle défensif).
  if (!auth || auth.roles.some((r) => r.startsWith("client_"))) return null;
  return auth;
}

export async function missionDe(db: Db, missionId: string | null): Promise<ContexteMission | null> {
  if (!missionId) return null;
  const r = await db.query("SELECT id, chef_id, directeur_id FROM missions WHERE id = $1", [
    missionId,
  ]);
  return (r.rows[0] as ContexteMission | undefined) ?? null;
}

/** L'utilisateur voit-il la mission (mêmes règles que `exigerMissionVisible`) ? */
export async function voitMission(db: Db, auth: Auth, missionId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM missions m WHERE m.id = $1 AND ${filtreVisibilite(2, 3)}`,
    [missionId, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Identifiants des personnes visées (sans doublon, absents écartés), dans l'ordre demandé. */
export function destinataires(
  liste: readonly DestinataireAutomatisation[],
  ctx: { mission: ContexteMission | null; responsableId: string; acteurId: string | null },
): string[] {
  const ids = liste.map((d) => {
    switch (d) {
      case "chef_mission":
        return ctx.mission?.chef_id ?? null;
      case "directeur_mission":
        return ctx.mission?.directeur_id ?? null;
      case "responsable":
        return ctx.responsableId;
      default:
        return ctx.acteurId;
    }
  });
  return [...new Set(ids.filter((x): x is string => x !== null))];
}
