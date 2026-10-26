import {
  classeRisqueMax,
  estClasseRisque,
  rangClasseRisque,
  type ClasseRisque,
} from "@missionpilot/engines";
import type { CasEssai } from "@missionpilot/shared";
import { estimerCoutEvaluation } from "../../../agents/evaluations-openrouter.js";
import { PLAFOND_EVALUATION_MICRO_USD } from "../../../ia/modeles.js";
import { lireParametres, modeleDe } from "../../../ia/parametres.js";
import { chargerPrompt } from "../../../ia/prompts.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { chargerMissions, type ModuleLot } from "./commun.js";
import { BRIQUES, PROMPTS_AGENTS, RESTRICTIONS, type PromptAgent } from "./agents-donnees.js";
import { semerExecutions } from "./agents-flux.js";
import { semerGouvernance } from "./agents-gouvernance.js";
import { exigerSansCle } from "./ia-aide.js";
import { completerConsommations } from "./ia-historique.js";

/*
 * Module « agents » : prompts des agents, briques et niveaux d'autonomie, jeux d'essai et
 * évaluations de non-régression LOCALES (fournisseur local déterministe, aucun appel réseau),
 * restrictions, exécutions décidées par des humains, incidents, plafonds de coût par mission.
 * Tout passe par les routes, sauf l'exécution d'un agent (code des services, aucune route) et
 * les demandes de rejeu payant (voir `demandesRejeu`). Exécuté APRÈS le module « ia » (modèles
 * par tâche, consommations par mission). Le copilote n'est jamais restreint sous N2.
 * Idempotent : chaque objet est retrouvé par sa clé naturelle (nom, code, motif…).
 */

async function idPrompt(
  ctx: ContexteTenantDemo,
  nom: string,
  version: number,
): Promise<string | null> {
  const r = await ctx.proprietaire.query<{ id: string }>(
    "SELECT id FROM ia_prompts WHERE cabinet_id = $1 AND nom = $2 AND version = $3",
    [ctx.cabinetId, nom, version],
  );
  return r.rows[0]?.id ?? null;
}

async function creerPrompt(
  ctx: ContexteTenantDemo,
  p: PromptAgent,
  version: 1 | 2,
): Promise<string> {
  const existant = await idPrompt(ctx, p.nom, version);
  if (existant) return existant;
  const v2 = version === 2 ? p.v2 : undefined;
  const r = await ctx.session("associe").post("/api/ia/prompts", {
    nom: p.nom,
    tache: p.tache,
    description: v2 ? `${p.description} (version 2)` : p.description,
    gabarit_systeme: v2?.systeme ?? p.systeme,
    gabarit_utilisateur: v2?.utilisateur ?? p.utilisateur,
    schema_sortie: p.schema,
  });
  attendre(201, r, `prompt ${p.nom} v${version}`);
  return r.json().id as string;
}

/** Classe de risque déclarée : jamais sous le plancher de la méthode (briques de même code). */
async function classeDeclaree(
  ctx: ContexteTenantDemo,
  code: string,
  souhaitee: ClasseRisque,
): Promise<ClasseRisque> {
  const r = await ctx.proprietaire.query<{ classe_risque: string }>(
    "SELECT classe_risque FROM methode_briques WHERE code = $1",
    [code],
  );
  const plancher = classeRisqueMax(r.rows.map((x) => x.classe_risque).filter(estClasseRisque));
  return plancher && rangClasseRisque(plancher) > rangClasseRisque(souhaitee)
    ? plancher
    : souhaitee;
}

async function briques(ctx: ContexteTenantDemo): Promise<void> {
  for (const b of BRIQUES) {
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM agents_briques WHERE brique_code = $1",
      [b.code],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    attendre(
      201,
      await ctx.session(b.declarant).post("/api/agents/briques", {
        brique_code: b.code,
        agent_code: b.agent,
        classe_risque: await classeDeclaree(ctx, b.code, b.classe),
        niveau_max: b.niveau,
      }),
      `brique ${b.code}`,
    );
  }
}

/** Évaluation locale d'une version de prompt (route) ; `attendue` : réussite attendue. */
async function evaluer(
  ctx: ContexteTenantDemo,
  promptId: string | null,
  attendue: boolean,
): Promise<boolean> {
  if (!promptId) throw new Error("Prompt introuvable pour l'évaluation.");
  const deja = await ctx.proprietaire.query<{ reussie: boolean }>(
    `SELECT reussie FROM agents_evaluations WHERE cabinet_id = $1 AND prompt_id = $2
      ORDER BY cree_le DESC LIMIT 1`,
    [ctx.cabinetId, promptId],
  );
  if (deja.rows[0]) return deja.rows[0].reussie;
  const r = await ctx
    .session("expert.metier")
    .post("/api/agents/evaluations", { prompt_id: promptId });
  attendre(201, r, "évaluation de non-régression");
  const reussie = r.json().reussie === true;
  if (reussie !== attendue) {
    throw new Error(`Évaluation inattendue (réussie = ${String(reussie)}) pour ${promptId}.`);
  }
  return reussie;
}

/** Jeu d'essai (version 1) du prompt, puis évaluation locale de sa version 1. */
async function jeuEtEvaluation(ctx: ContexteTenantDemo, p: PromptAgent): Promise<void> {
  const jeu = await ctx.proprietaire.query(
    "SELECT 1 FROM agents_jeux_essai WHERE cabinet_id = $1 AND prompt_nom = $2",
    [ctx.cabinetId, p.nom],
  );
  if ((jeu.rowCount ?? 0) === 0) {
    const objet = p.schema.type === "objet";
    attendre(
      201,
      await ctx.session("expert.metier").post("/api/agents/jeux-essai", {
        prompt_nom: p.nom,
        brique_code: p.brique,
        description: `Non-régression de « ${p.nom} » : consignes de sécurité présentes, données insérées.`,
        cas: p.cas.map((c) => ({
          code: c.code,
          variables: { texte: c.texte },
          attendu: objet
            ? { champs: { pret_pour_revue: false } }
            : { contient: c.contient, ne_contient_pas: ["mot de passe"] },
        })),
      }),
      `jeu d'essai ${p.nom}`,
    );
  }
  await evaluer(ctx, await idPrompt(ctx, p.nom, 1), true);
}

/** Versions 2 : évaluées sur le jeu d'essai, activées seulement si l'évaluation réussit. */
async function versionsDeux(ctx: ContexteTenantDemo): Promise<void> {
  for (const p of PROMPTS_AGENTS) {
    if (!p.v2) continue;
    const id = await creerPrompt(ctx, p, 2);
    const reussie = await evaluer(ctx, id, p.v2.type === "bonne");
    if (!reussie) continue;
    const active = await ctx.proprietaire.query(
      "SELECT 1 FROM ia_prompt_activations WHERE cabinet_id = $1 AND prompt_id = $2",
      [ctx.cabinetId, id],
    );
    if ((active.rowCount ?? 0) > 0) continue;
    attendre(
      200,
      await ctx.session("associe").post(`/api/ia/prompts/${id}/activer`, {}),
      `activation de ${p.nom} v2`,
    );
  }
}

async function restrictions(ctx: ContexteTenantDemo): Promise<void> {
  for (const r of RESTRICTIONS) {
    if (r.agent === "copilote") throw new Error("Le copilote ne se restreint pas sous N2.");
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM agents_restrictions WHERE cabinet_id = $1 AND agent_code = $2 AND motif = $3",
      [ctx.cabinetId, r.agent, r.motif],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    attendre(
      200,
      await ctx.session(r.auteur).put(`/api/agents/${r.agent}/restriction`, {
        actif: r.actif,
        niveau_max: r.niveau,
        motif: r.motif,
      }),
      `restriction ${r.agent}`,
    );
  }
}

/**
 * Demandes de rejeu PAYANT de l'évaluation (openrouter) : la route les refuse sans clé (409
 * IA_NON_CONFIGUREE) et aucune évaluation « openrouter » n'est forgée. Seules deux demandes
 * IGNORÉES (aucun appel, coût nul, aucune évaluation) sont semées : nées « en_file » (le
 * déclencheur l'impose) puis passées « ignoree » avec la cause qu'écrit le job quand aucune clé
 * n'est disponible. Dates : INSERT daté (identité de la demande figée ensuite).
 */
async function demandesRejeu(ctx: ContexteTenantDemo): Promise<void> {
  const c = ctx.proprietaire;
  const params = await ctx.database.withTenant(ctx.cabinetId, (db) => lireParametres(db));
  const demandes = [
    { prompt: "redacteur_section_rapport", avant: 9 },
    { prompt: "cadrage_lettre_mission", avant: 3 },
  ];
  for (const d of demandes) {
    const jeu = await c.query<{ id: string; cas: CasEssai[] }>(
      `SELECT id, cas FROM agents_jeux_essai WHERE cabinet_id = $1 AND prompt_nom = $2
        ORDER BY version DESC LIMIT 1`,
      [ctx.cabinetId, d.prompt],
    );
    const promptId = await idPrompt(ctx, d.prompt, 1);
    const lu = jeu.rows[0];
    if (!lu || !promptId) continue;
    const cree = new Date(Date.parse(`${ctx.dateAvant(d.avant)}T10:15:00Z`)).toISOString();
    const deja = await c.query(
      "SELECT 1 FROM agents_evaluations_demandes WHERE cabinet_id = $1 AND prompt_id = $2 AND cree_le = $3",
      [ctx.cabinetId, promptId, cree],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    const prompt = await ctx.database.withTenant(ctx.cabinetId, (db) =>
      chargerPrompt(db, promptId),
    );
    const modele = modeleDe(params, prompt.tache);
    const ins = await c.query<{ id: string }>(
      `INSERT INTO agents_evaluations_demandes (cabinet_id, jeu_id, prompt_id, modele, cas_total,
         cout_estime_micro_usd, plafond_evaluation_micro_usd, demande_par, cree_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        ctx.cabinetId,
        lu.id,
        promptId,
        modele,
        lu.cas.length,
        estimerCoutEvaluation(prompt, lu.cas, modele),
        PLAFOND_EVALUATION_MICRO_USD,
        ctx.utilisateurs["expert.metier"],
        cree,
      ],
    );
    await c.query(
      `UPDATE agents_evaluations_demandes SET statut = 'ignoree', cause = 'IA_NON_CONFIGUREE',
         termine_le = $2 WHERE id = $1`,
      [ins.rows[0]!.id, new Date(Date.parse(cree) + 90_000).toISOString()],
    );
  }
}

export const semerAgents: ModuleLot = async (ctx) => {
  exigerSansCle(ctx);
  const missions = await chargerMissions(ctx);
  for (const p of PROMPTS_AGENTS) await creerPrompt(ctx, p, 1);
  await briques(ctx);
  for (const p of PROMPTS_AGENTS) await jeuEtEvaluation(ctx, p);
  await versionsDeux(ctx);
  await restrictions(ctx);
  const { ids, crees } = await semerExecutions(ctx, missions);
  await completerConsommations(ctx);
  await semerGouvernance(ctx, missions, ids);
  await demandesRejeu(ctx);
  ctx.journal(`agents : ${crees} exécution(s) créée(s), ${Object.keys(ids).length} au total.`);
};
