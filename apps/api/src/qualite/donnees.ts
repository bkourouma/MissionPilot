import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { exigerMissionVisible, type MissionAcces } from "../missions/acces.js";

/*
 * Accès aux suivis qualité (migration 0280). Un suivi n'est lisible que si sa mission l'est
 * (`exigerMissionVisible`) : un suivi invisible répond 404 comme un suivi inexistant ou d'un
 * autre cabinet (RLS).
 */

export interface Suivi {
  id: string;
  mission_id: string;
  type_livrable: string;
  livrable_id: string;
  libelle: string;
  version: number;
  classe_minimale: string;
  classe: string;
  statut: string;
  auteur_id: string | null;
  definition_id: string | null;
  ouvert_par: string;
  ouvert_le: Date;
  modifie_le: Date;
}

export const COLONNES_SUIVI = `s.id, s.mission_id, s.type_livrable, s.livrable_id, s.libelle, s.version,
  s.classe_minimale, s.classe, s.statut, s.auteur_id, s.definition_id, s.ouvert_par, s.ouvert_le, s.modifie_le`;

export const COLONNES_SUIVI_NUES = `id, mission_id, type_livrable, livrable_id, libelle, version,
  classe_minimale, classe, statut, auteur_id, definition_id, ouvert_par, ouvert_le, modifie_le`;

/** Suivi d'une mission visible, ou 404. `verrouiller` pose FOR UPDATE sur le suivi (écritures sérialisées). */
export async function exigerSuivi(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<{ suivi: Suivi; mission: MissionAcces }> {
  const r = await db.query(
    `SELECT ${COLONNES_SUIVI} FROM qualite_suivis s WHERE s.id = $1 ${verrouiller ? "FOR UPDATE OF s" : ""}`,
    [id],
  );
  const suivi = r.rows[0] as Suivi | undefined;
  if (!suivi) throw introuvable("Suivi qualité");
  const mission = await exigerMissionVisible(db, auth, suivi.mission_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Suivi qualité") : e;
  });
  return { suivi, mission };
}

export interface EvenementQualite {
  action: string;
  details?: Record<string, unknown>;
}

/** Ajoute un événement à l'historique du suivi (rang suivant). Sous le verrou du suivi. */
export async function ajouterEvenement(
  db: Db,
  cabinetId: string,
  suiviId: string,
  par: string,
  evenement: EvenementQualite,
): Promise<void> {
  await db.query(
    `INSERT INTO qualite_evenements (cabinet_id, suivi_id, rang, action, details, par)
     SELECT $1, $2, COALESCE(MAX(rang), 0) + 1, $3, $4::jsonb, $5
     FROM qualite_evenements WHERE suivi_id = $2`,
    [cabinetId, suiviId, evenement.action, JSON.stringify(evenement.details ?? {}), par],
  );
}

/** Passe le suivi à un statut plus avancé (le déclencheur refuse tout recul). */
export async function changerStatut(db: Db, suiviId: string, statut: string): Promise<void> {
  await db.query("UPDATE qualite_suivis SET statut = $2, modifie_le = now() WHERE id = $1", [
    suiviId,
    statut,
  ]);
}
