import type { Role } from "@missionpilot/shared";
import type { Api } from "./api.js";
import { creerMission, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";

function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

export interface MissionPlanifiable {
  id: string;
  phaseId: string;
  tacheId: string;
}

/**
 * Mission vierge (du lundi 2026-11-02 au vendredi 2027-01-29) avec une phase
 * et une tâche de `duree` jours ouvrés, budgétée en jours par grade.
 * Sans jour férié saisi, la tâche couvre du 2026-11-02 au 2026-11-13 (10 j).
 */
export async function missionPlanifiable(
  c: CabinetMissions,
  options: { duree?: number; budget?: Record<string, number>; par?: Api } = {},
): Promise<MissionPlanifiable> {
  const par = options.par ?? c.chef;
  const m = await creerMission(c, { type_mission_id: null, mode_facturation: "regie" });
  const phase = await par.post(`/api/missions/${m.id}/phases`, { libelle: "Diagnostic" });
  attendre(201, phase, "phase");
  const tache = await par.post(`/api/missions/${m.id}/taches`, {
    parent_id: phase.json().id,
    libelle: "Entretiens",
    duree_jours_ouvres: options.duree ?? 10,
  });
  attendre(201, tache, "tâche");
  const budget = options.budget ?? { senior: 5, junior: 5 };
  const r = await par.put(`/api/missions/${m.id}/taches/${tache.json().id}/budget`, {
    lignes: Object.entries(budget).map(([code, jours]) => ({ grade_id: c.grades[code], jours })),
  });
  attendre(200, r, "budget");
  return { id: m.id, phaseId: phase.json().id, tacheId: tache.json().id };
}

/** Utilisateur connecté rattaché à un collaborateur actif du grade donné. */
export async function utilisateurCollaborateur(
  c: CabinetMissions,
  roles: Role[],
  grade = "senior",
): Promise<ApiUtilisateur & { collaborateurId: string }> {
  const u = await c.avecRoles(roles);
  const r = await c.associe.post("/api/collaborateurs", {
    nom: `Collaborateur ${roles.join("-")} ${u.utilisateurId.slice(0, 8)}`,
    utilisateur_id: u.utilisateurId,
    grade_id: c.grades[grade],
  });
  attendre(201, r, "collaborateur");
  return Object.assign(u, { collaborateurId: r.json().id as string });
}

/** Corps d'affectation nominative par défaut sur la tâche de `missionPlanifiable`. */
export const affectationNominative = (
  m: MissionPlanifiable,
  collaborateurId: string,
  corps: Record<string, unknown> = {},
) => ({
  tache_id: m.tacheId,
  collaborateur_id: collaborateurId,
  jours_alloues: 4,
  date_debut: "2026-11-02",
  date_fin: "2026-11-13",
  ...corps,
});

/** Aucun champ financier (coût, taux, marge, prix) dans une réponse. */
export function sansDonneeFinanciere(corps: string): boolean {
  return !/cout|taux_vente|marge|prix|honoraires|montant/i.test(corps);
}
