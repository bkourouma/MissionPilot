import { ajouterJours } from "@missionpilot/engines";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { lireDecoupage, type MissionBatie } from "./construction.js";
import { affecterTache } from "./equipe.js";

/*
 * Révision du budget signé (FIN-03) : le chef de mission ajoute une tâche au découpage (demande
 * du client), crée la révision depuis le découpage avec son motif, le directeur de la mission la
 * valide (un associé si les seuils d'approbation l'exigent) et l'équipe est étoffée dans le
 * nouveau budget figé. Renvoie l'identifiant de la version révisée, pour l'antidatage.
 */
export async function reviserBudget(
  ctx: ContexteTenantDemo,
  m: MissionBatie,
): Promise<string | null> {
  const rev = m.def.revision;
  if (!rev) return null;
  const chef = ctx.session(m.def.chef);
  const directeur = ctx.session(m.def.directeur);
  const phase = m.phases.find((p) => p.libelle === rev.phase);
  if (!phase) throw new Error(`Phase « ${rev.phase} » introuvable dans ${m.def.nom}.`);

  const tache = await chef.post(`/api/missions/${m.id}/taches`, {
    parent_id: phase.id,
    libelle: rev.tache.libelle,
    duree_jours_ouvres: 10,
    date_debut: ajouterJours(rev.date, 3),
  });
  attendre(201, tache, "tâche de la révision");
  attendre(
    200,
    await chef.put(`/api/missions/${m.id}/taches/${tache.json().id}/budget`, {
      lignes: Object.entries(rev.tache.jours).map(([code, jours]) => ({
        grade_id: ctx.grades[code],
        jours,
      })),
    }),
    "budget de la tâche ajoutée",
  );
  const creee = await chef.post(`/api/missions/${m.id}/budget/revisions`, {
    motif: rev.motif,
    depuis_decoupage: true,
  });
  attendre(201, creee, "révision du budget");
  const versionId = creee.json().id as string;
  const url = `/api/missions/${m.id}/budget/versions/${versionId}/valider`;
  let validee = await directeur.post(url);
  if (validee.statusCode === 403) validee = await ctx.session("associe").post(url);
  attendre(200, validee, "validation de la révision");

  // Le nouveau découpage, ses fenêtres, puis l'équipe sur la tâche ajoutée.
  Object.assign(m, await lireDecoupage(chef, m.id));
  const planning = await chef.get(`/api/missions/${m.id}/planning`);
  attendre(200, planning, "planning");
  for (const t of planning.json().taches as { id: string; debut?: string; fin?: string }[]) {
    if (t.debut && t.fin) m.fenetres.set(t.id, { debut: t.debut, fin: t.fin });
  }
  const ajoutee = m.taches.find((t) => t.id === tache.json().id);
  if (ajoutee) await affecterTache(ctx, chef, m, ajoutee, 0);
  return versionId;
}
