import { expect } from "vitest";
import type { Api } from "./api.js";
import { feuilleValidee } from "./finance-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  creerMissionSignee,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Scénario du lot capitalisation (CAP) : cabinet avec la méthode « notation_entreprise » du
 * standard, missions signées liées à la méthode, découpage (une phase, deux tâches budgétées),
 * temps VALIDÉS saisis par des collaborateurs, clôture par le propriétaire de la base.
 */

export type Reponse = Awaited<ReturnType<Api["get"]>>;

export function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

export interface ScenarioCap extends CabinetMissions {
  versionNotation: string;
  consultant: ApiUtilisateur;
  expert: ApiUtilisateur;
  ressources: ApiUtilisateur;
}

export async function preparerCap(ctx: Contexte, nom: string): Promise<ScenarioCap> {
  const c = await preparerCabinet(ctx, nom);
  const liste = attendu(200, await c.associe.get("/api/methodes?limite=100"));
  const versionNotation = liste.elements.find(
    (m: { code: string }) => m.code === "notation_entreprise",
  ).derniere_publiee.id as string;
  return {
    ...c,
    versionNotation,
    consultant: await c.avecRoles(["consultant"]),
    expert: await c.avecRoles(["expert_metier"]),
    ressources: await c.avecRoles(["ressources"]),
  };
}

export interface MissionCap {
  id: string;
  /** Deux tâches : budget 2 j et 1 j. */
  taches: [string, string];
}

/** Mission signée, consultant dans l'équipe, liée à la notation du standard, découpée. */
export async function missionCap(
  s: ScenarioCap,
  intitule: string,
  contexte: Record<string, unknown> = {},
): Promise<MissionCap> {
  const m = await creerMissionSignee(s, { intitule });
  attendu(
    201,
    await s.chef.post(`/api/missions/${m.id}/equipe`, {
      utilisateur_id: s.consultant.utilisateurId,
    }),
  );
  attendu(
    200,
    await s.chef.put(`/api/missions/${m.id}/methode`, {
      version_id: s.versionNotation,
      contexte,
      motif: "Contexte de la mission de test, confirmé par le chef de mission.",
    }),
  );
  const taches = await proprietaire(async (cl) => {
    const p = await cl.query(
      `INSERT INTO mission_phases (cabinet_id, mission_id, libelle, ordre)
       VALUES ($1, $2, 'Cadrage', 1) RETURNING id`,
      [s.cabinetId, m.id],
    );
    const ids: string[] = [];
    for (const [i, [libelle, jours]] of [
      ["Entretiens avec les dirigeants", "2"],
      ["Collecte des pièces", "1"],
    ].entries()) {
      const t = await cl.query(
        `INSERT INTO mission_taches (cabinet_id, mission_id, phase_id, libelle, ordre)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [s.cabinetId, m.id, p.rows[0].id, libelle, i],
      );
      ids.push(t.rows[0].id as string);
      await cl.query(
        `INSERT INTO tache_budget_lignes (cabinet_id, mission_id, tache_id, grade_id, jours)
         VALUES ($1, $2, $3, $4, $5)`,
        [s.cabinetId, m.id, t.rows[0].id, s.grades.senior, jours],
      );
    }
    return ids as [string, string];
  });
  return { id: m.id, taches };
}

/** Feuille VALIDÉE d'un collaborateur pour une semaine, une ligne par tâche. */
export async function temps(
  s: ScenarioCap,
  missionId: string,
  collaborateurId: string,
  semaine: string,
  lignes: readonly { tacheId: string; jours: number }[],
): Promise<void> {
  await feuilleValidee({
    cabinetId: s.cabinetId,
    collaborateurId,
    semaine,
    importePar: s.associeId,
    lignes: lignes.map((l) => ({ date: semaine, missionId, tacheId: l.tacheId, jours: l.jours })),
  });
}

/** Clôture (ou passage « à clôturer ») par le propriétaire : la clôture elle-même est un autre lot. */
export async function cloturer(
  s: ScenarioCap,
  missionId: string,
  statut: "a_cloturer" | "cloturee" = "cloturee",
): Promise<void> {
  await proprietaire((cl) =>
    cl.query(
      `UPDATE missions SET statut = $2,
         cloturee_le = CASE WHEN $2 = 'cloturee' THEN now() END,
         cloturee_par = CASE WHEN $2 = 'cloturee' THEN $3::uuid END
       WHERE id = $1`,
      [missionId, statut, s.associeId],
    ),
  );
}
