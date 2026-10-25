import { enregistrerConsommation } from "../../../ia/couts.js";
import { lireParametres, modeleDe } from "../../../ia/parametres.js";
import { variablesDuPrompt } from "../../../ia/prompts.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { chargerMissions, type ModuleLot } from "./commun.js";
import { exigerSansCle, instant } from "./ia-aide.js";
import { CONSIGNES, PROMPTS_CABINET, TEXTES_ESSAI, TEXTES_RELECTURE } from "./ia-donnees.js";
import { completerConsommations, semerHistorique } from "./ia-historique.js";
import { etatContenu, relectures } from "./ia-relectures.js";

/*
 * COÛTS SIMULÉS DE DÉMONSTRATION, AUCUN APPEL RÉEL : sans clé fournisseur, les consommations IA sont
 * inscrites à titre de démonstration (voir ia-historique.ts), une par demande terminée.
 *
 * Module « ia » : paramètres IA du cabinet, prompts, historique de générations, relectures
 * récentes et coûts. Aucune clé fournisseur, aucun appel réseau : l'orchestrateur retombe sur le
 * gabarit déterministe (`fournisseur = 'gabarit'`).
 *
 * - paramètres : `PUT /api/ia/parametres` par l'associé (IA activée sans clé, plafond mensuel de
 *   3 USD, modèle par tâche parmi les tarifs connus) ; les dates de modification sont ramenées
 *   au démarrage du cabinet par UPDATE littéral (tables sans déclencheur d'ajout seul) ;
 * - prompts : version 1 des prompts du cabinet insérée avec sa date (INSERT daté : la table est en
 *   ajout seul), version 2 de « synthese_comite » par `POST /api/ia/prompts` ;
 * - historique : ia-historique.ts (orchestrateur à horloge fictive, brouillons IA) ;
 * - relectures récentes (trois dernières semaines) : demande par l'orchestrateur à horloge fictive
 *   puis TOUT le circuit humain par les routes : modification par le demandeur, validation par le
 *   chef, le directeur ou un associé qui n'est ni demandeur ni auteur (séparation des tâches) ;
 * - essais des consultants avec les prompts « exemple » par `POST /api/ia/generations`.
 * Idempotent : demande retrouvée par (prompt, demandeur, date, mission), prompt par son nom.
 */

const SYNTHESE_V2 =
  "Rédige une synthèse d'avancement de la mission à destination du comité de pilotage, en " +
  "quatre phrases au plus, puis liste les décisions attendues du comité.\n\nCHIFFRES :\n" +
  "{{chiffres}}\n\nCONTEXTE :\n{{texte}}";

async function parametres(ctx: ContexteTenantDemo): Promise<void> {
  const c = ctx.proprietaire;
  const deja = await c.query("SELECT 1 FROM ia_parametres_cabinet WHERE cabinet_id = $1", [
    ctx.cabinetId,
  ]);
  if ((deja.rowCount ?? 0) > 0) return;
  attendre(
    200,
    await ctx.session("associe").put("/api/ia/parametres", {
      ia_activee: true,
      plafond_mensuel_micro_usd: 3_000_000,
      modeles: {
        redaction: "anthropic/claude-sonnet-4.5",
        analyse: "anthropic/claude-sonnet-4.5",
        extraction: "google/gemini-2.5-flash",
        classification: "openai/gpt-4o-mini",
      },
    }),
    "paramètres IA du cabinet",
  );
  const dates: [string, string][] = [
    ["redaction", "2024-10-14"],
    ["analyse", "2024-10-14"],
    ["extraction", "2025-03-03"],
    ["classification", "2025-09-15"],
  ];
  await c.query("UPDATE ia_parametres_cabinet SET modifie_le = $1 WHERE cabinet_id = $2", [
    instant("2025-09-15", 9),
    ctx.cabinetId,
  ]);
  for (const [tache, jour] of dates) {
    await c.query("UPDATE ia_modeles_taches SET modifie_le = $1 WHERE tache = $2", [
      instant(jour, 9),
      tache,
    ]);
  }
}

/** Version 1 des prompts du cabinet, datée, et leur activation. */
async function prompts(ctx: ContexteTenantDemo): Promise<void> {
  const c = ctx.proprietaire;
  const associe = ctx.utilisateurs.associe;
  for (const p of PROMPTS_CABINET) {
    const quand = instant(p.jour, 10);
    const existe = await c.query<{ id: string }>(
      "SELECT id FROM ia_prompts WHERE cabinet_id = $1 AND nom = $2 AND version = 1",
      [ctx.cabinetId, p.nom],
    );
    let id = existe.rows[0]?.id;
    if (!id) {
      const ins = await c.query<{ id: string }>(
        `INSERT INTO ia_prompts (cabinet_id, nom, version, tache, gabarit_systeme, gabarit_utilisateur,
           variables, schema_sortie, exemple, description, auteur_id, cree_le)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7::jsonb, false, $8, $9, $10) RETURNING id`,
        [
          ctx.cabinetId,
          p.nom,
          p.tache,
          p.gabaritSysteme,
          p.gabaritUtilisateur,
          variablesDuPrompt(p.gabaritSysteme, p.gabaritUtilisateur),
          JSON.stringify(p.schema),
          p.description,
          associe,
          quand,
        ],
      );
      id = ins.rows[0]!.id;
    }
    await c.query(
      `INSERT INTO ia_prompt_activations (cabinet_id, nom, prompt_id, active_par, cree_le)
       SELECT $1, $2, $3, $4, $5
        WHERE NOT EXISTS (SELECT 1 FROM ia_prompt_activations WHERE prompt_id = $3)`,
      [ctx.cabinetId, p.nom, id, associe, quand],
    );
  }
}

/** Appels de test de connexion (issue « test ») faits par l'associé aux changements de modèle. */
async function testsConnexion(ctx: ContexteTenantDemo): Promise<void> {
  const deja = await ctx.proprietaire.query<{ n: string }>(
    "SELECT count(*) AS n FROM ia_consommations WHERE cabinet_id = $1 AND issue = 'test'",
    [ctx.cabinetId],
  );
  const existants = Number(deja.rows[0]!.n);
  const params = await ctx.database.withTenant(ctx.cabinetId, (db) => lireParametres(db));
  const essais = [
    ["2024-10-14", "classification"],
    ["2025-03-03", "extraction"],
    ["2025-09-15", "classification"],
  ] as const;
  for (const [jour, tache] of essais.slice(existants)) {
    await ctx.database.withTenant(ctx.cabinetId, (db) =>
      enregistrerConsommation(
        db,
        {
          cabinetId: ctx.cabinetId,
          demandeId: null,
          missionId: null,
          tache,
          modele: modeleDe(params, tache),
          issue: "test",
          sourceCle: "cabinet",
          tokensEntree: 32,
          tokensSortie: 2,
          dureeMs: 640,
        },
        params.plafond_mensuel_micro_usd,
        new Date(instant(jour, 9, 20)),
      ),
    );
  }
}

/** Essais des consultants (prompts « exemple ») par la route de génération manuelle. */
async function essaisRoute(ctx: ContexteTenantDemo): Promise<void> {
  const essais = [
    { cle: "consultant", prompt: "reformulation", texte: TEXTES_ESSAI[3]!, relu: true },
    { cle: "consultant.junior", prompt: "resume_neutre", texte: TEXTES_ESSAI[1]!, relu: false },
    {
      cle: "expert.metier",
      prompt: "classification_tonalite",
      texte: TEXTES_ESSAI[2]!,
      relu: false,
    },
  ] as const;
  for (const e of essais) {
    const deja = await ctx.proprietaire.query<{ id: string }>(
      `SELECT id FROM ia_demandes WHERE cabinet_id = $1 AND prompt_nom = $2 AND demandeur_id = $3
         AND mission_id IS NULL AND cree_le >= $4`,
      [ctx.cabinetId, e.prompt, ctx.utilisateurs[e.cle], instant(ctx.aujourdhui, 0)],
    );
    let id = deja.rows[0]?.id;
    if (!id) {
      const r = await ctx.session(e.cle).post("/api/ia/generations", {
        prompt_nom: e.prompt,
        variables: { texte: e.texte },
        mode: "immediat",
      });
      attendre(201, r, `essai ${e.prompt}`);
      id = r.json().id as string;
    }
    if (!e.relu) continue;
    let etat = await etatContenu(ctx, id);
    if (etat === "brouillon_ia") {
      attendre(
        200,
        await ctx.session(e.cle).post(`/api/ia/generations/${id}/modifier`, {
          texte: TEXTES_RELECTURE["essai-reformulation"],
        }),
        "modification d'un essai",
      );
      etat = "modifie";
    }
    // Un essai sans mission n'est visible que de son demandeur et d'un associé (ia.configurer).
    if (etat === "modifie") {
      attendre(
        200,
        await ctx.session("associe").post(`/api/ia/generations/${id}/valider`, {}),
        "validation d'un essai",
      );
    }
  }
}

/** Version 2 de « synthese_comite » par la route (active : aucun jeu d'essai sur ce prompt). */
async function versionDeux(ctx: ContexteTenantDemo): Promise<void> {
  const deja = await ctx.proprietaire.query(
    "SELECT 1 FROM ia_prompts WHERE cabinet_id = $1 AND nom = 'synthese_comite' AND version = 2",
    [ctx.cabinetId],
  );
  if ((deja.rowCount ?? 0) > 0) return;
  attendre(
    201,
    await ctx.session("associe").post("/api/ia/prompts", {
      nom: "synthese_comite",
      tache: "redaction",
      description:
        "Synthèse d'avancement pour le comité, avec les décisions attendues (version 2).",
      gabarit_systeme: CONSIGNES,
      gabarit_utilisateur: SYNTHESE_V2,
      schema_sortie: { type: "texte", longueur_max: 6000 },
    }),
    "version 2 de synthese_comite",
  );
}

export const semerIa: ModuleLot = async (ctx) => {
  exigerSansCle(ctx);
  const missions = await chargerMissions(ctx);
  await parametres(ctx);
  await prompts(ctx);
  await testsConnexion(ctx);
  const h = await semerHistorique(ctx, missions);
  const r = await relectures(ctx, missions);
  await essaisRoute(ctx);
  await versionDeux(ctx);
  const c = await completerConsommations(ctx);
  ctx.journal(
    `ia : ${h.demandes} demande(s) historique(s), ${h.consommations + c} consommation(s) simulée(s), ${r} relecture(s) récente(s).`,
  );
};
