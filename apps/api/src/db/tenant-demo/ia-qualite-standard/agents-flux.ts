import { executerAgent } from "../../../agents/executions.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { CleMission, MissionLot } from "./commun.js";
import { acteursMission, authDe, depsIa, nomClient } from "./ia-aide.js";
import { PROMPTS_AGENTS } from "./agents-donnees.js";
import {
  AJOUTS_LEGERS,
  SCENARIOS_EXECUTION,
  TEXTES_AGENT,
  TEXTES_FINAUX,
  type ScenarioExecution,
} from "./agents-scenarios.js";

/*
 * Exécutions d'agents du module « agents » : chaque exécution est déclenchée par le code des
 * services (`executerAgent`, sans route HTTP), puis tout le circuit humain passe par les ROUTES :
 * modification du brouillon par le déclencheur, validation du contenu par un autre
 * intervenant autorisé de la mission (chef ou directeur), décision sur l'exécution
 * (validée ou rejetée avec motif). Sans clé fournisseur, l'exécution se fait en mode dégradé
 * (gabarit déterministe) : elle ne compte donc pas pour l'éligibilité à N3 (agents/autonomie.ts).
 * Reprise sans doublon : une exécution est retrouvée par (prompt, mission), chaque étape humaine
 * par l'état déjà atteint.
 */

interface ExecutionTrouvee {
  id: string;
  demandeId: string;
  decision: string | null;
}

async function trouver(
  ctx: ContexteTenantDemo,
  prompt: string,
  missionId: string,
): Promise<ExecutionTrouvee | null> {
  const r = await ctx.proprietaire.query<{
    id: string;
    demande_id: string;
    decision: string | null;
  }>(
    `SELECT e.id, e.demande_id, x.decision FROM agents_executions e
       LEFT JOIN agents_execution_decisions x ON x.execution_id = e.id
      WHERE e.cabinet_id = $1 AND e.prompt_nom = $2 AND e.mission_id = $3 ORDER BY e.cree_le LIMIT 1`,
    [ctx.cabinetId, prompt, missionId],
  );
  const l = r.rows[0];
  return l ? { id: l.id, demandeId: l.demande_id, decision: l.decision } : null;
}

async function etatContenu(ctx: ContexteTenantDemo, demandeId: string): Promise<string> {
  const r = await ctx.proprietaire.query<{ statut_contenu: string }>(
    "SELECT statut_contenu FROM ia_generations WHERE demande_id = $1 ORDER BY version DESC LIMIT 1",
    [demandeId],
  );
  return r.rows[0]?.statut_contenu ?? "";
}

/** Joue un scénario : exécution, puis étapes humaines selon l'issue. Renvoie vrai si créée. */
async function jouer(
  ctx: ContexteTenantDemo,
  s: ScenarioExecution,
  mission: MissionLot,
): Promise<{ cree: boolean; id: string } | null> {
  const acteurs = await acteursMission(ctx, mission);
  const def = PROMPTS_AGENTS.find((p) => p.nom === s.prompt);
  if (!acteurs || !def) return null;
  const declencheur = s.declencheur === "chef" ? acteurs.chef : acteurs.directeur;
  const relecteur = s.declencheur === "chef" ? acteurs.directeur : acteurs.chef;
  let exec = await trouver(ctx, s.prompt, mission.id);
  let cree = false;
  if (!exec) {
    const textes = TEXTES_AGENT[s.prompt]!;
    const client = await nomClient(ctx, mission.clientId);
    const r = await executerAgent(ctx.database, depsIa(ctx), {
      utilisateur: authDe(ctx, declencheur),
      agentCode: def.agent,
      briqueCode: def.brique,
      promptNom: s.prompt,
      variables: { texte: textes[s.entree % textes.length]!.replaceAll("{client}", client) },
      entite: { missionId: mission.id },
      repliSiPlafond: true,
    });
    if (r.statut !== "terminee") throw new Error(`Exécution « ${s.id} » : ${r.statut}.`);
    exec = {
      id: String(r.execution.id),
      demandeId: String(r.execution.demande_id),
      decision: null,
    };
    cree = true;
  }
  if (exec.decision !== null || s.issue === "attente") return { cree, id: exec.id };

  if (s.issue === "rejetee") {
    attendre(
      200,
      await ctx.session(relecteur).post(`/api/agents/executions/${exec.id}/decision`, {
        decision: "rejetee",
        motif: s.motif ?? "Brouillon écarté par le relecteur.",
      }),
      `rejet ${s.id}`,
    );
    return { cree, id: exec.id };
  }

  let etat = await etatContenu(ctx, exec.demandeId);
  if (etat === "brouillon_ia" && (s.issue === "complete" || s.issue === "legere")) {
    let texte = TEXTES_FINAUX[s.id];
    if (s.issue === "legere" || !texte) {
      const v = await ctx.session(declencheur).get(`/api/ia/generations/${exec.demandeId}`);
      attendre(200, v, `lecture ${s.id}`);
      texte = `${String(v.json().texte)}\n\n${AJOUTS_LEGERS[s.entree % AJOUTS_LEGERS.length]}`;
    }
    attendre(
      200,
      await ctx
        .session(declencheur)
        .post(`/api/ia/generations/${exec.demandeId}/modifier`, { texte }),
      `modification ${s.id}`,
    );
    etat = "modifie";
  }
  if (etat !== "valide") {
    attendre(
      200,
      await ctx.session(relecteur).post(`/api/ia/generations/${exec.demandeId}/valider`, {}),
      `validation ${s.id}`,
    );
  }
  attendre(
    200,
    await ctx
      .session(relecteur)
      .post(`/api/agents/executions/${exec.id}/decision`, { decision: "validee" }),
    `décision ${s.id}`,
  );
  return { cree, id: exec.id };
}

/** Joue tous les scénarios ; renvoie les identifiants d'exécution par scénario et le nombre créé. */
export async function semerExecutions(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
): Promise<{ ids: Record<string, string>; crees: number }> {
  const ids: Record<string, string> = {};
  let crees = 0;
  for (const s of SCENARIOS_EXECUTION) {
    const m = missions[s.mission];
    if (!m) continue;
    const r = await jouer(ctx, s, m);
    if (!r) continue;
    ids[s.id] = r.id;
    if (r.cree) crees += 1;
  }
  return { ids, crees };
}
