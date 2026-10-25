import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContexteTenantDemo } from "../src/db/tenant-demo/contexte.js";
import { semerTenantDemo } from "../src/db/tenant-demo/index.js";
import { semerRevuesFroides } from "../src/db/tenant-demo/ia-qualite-standard/qualite-froide.js";
import { cloturerMissionsTerminees } from "../src/db/tenant-demo/missions/cloture.js";
import { semerAppelsOffresCanaux } from "../src/db/tenant-demo/phases/appels-offres-canaux.js";
import { semerIaQualiteStandard } from "../src/db/tenant-demo/phases/ia-qualite-standard.js";
import { semerMissions } from "../src/db/tenant-demo/phases/missions.js";
import { creerBaseJetable, supprimerBaseJetable, type BaseJetable } from "./outils-base-jetable.js";

/*
 * Phase « ia-qualite-standard » du Tenant démo (IA, agents, automatisation, copilote, qualité,
 * standard), puis étape d'après clôture (revues à froid), dans une base jetable. Le déroulé réel :
 * phase « missions » (casting), phase testée jouée deux fois (idempotence), droits FIN-02,
 * clôture des missions terminées, revues à froid jouées deux fois.
 */

/** Les 47 tables de la phase (hors revues à froid, semées après la clôture). */
const TABLES_PHASE = [
  // IA et copilote
  "ia_modeles_taches",
  "ia_parametres_cabinet",
  "ia_prompt_activations",
  "ia_consommations",
  "copilote_actions",
  // Agents et autonomie
  "agents_restrictions",
  "agents_briques",
  "agents_executions",
  "agents_execution_decisions",
  "agents_contributions",
  "agents_plafonds_mission",
  "agents_jeux_essai",
  "agents_evaluations",
  "agents_evaluations_demandes",
  "autonomie_evenements",
  "autonomie_incidents",
  // Automatisation et avancement
  "automatisations",
  "automatisation_versions",
  "automatisation_executions",
  "automatisation_actions",
  "automatisation_action_resultats",
  "automatisation_annulations",
  "automatisation_brouillons",
  "automatisation_brouillon_decisions",
  "avancement_parametres",
  "avancement_rapports",
  // Qualité (hors revues à froid)
  "qualite_suivis",
  "qualite_evenements",
  "qualite_definitions",
  "qualite_definition_items",
  "qualite_verifications",
  "qualite_revue_elements",
  "qualite_revue_sessions",
  "qualite_revue_vus",
  "qualite_signatures",
  "qualite_validations",
  "qualite_acceptations",
  "qualite_relations_clients",
  "qualite_relations_retraits",
  "qualite_satisfactions",
  // Standard et méthodes
  "derogations",
  "derogation_validations",
  "propositions_standard",
  // Propositions du standard tirées des dérogations fréquentes (CAP-05), semées avec le standard.
  "cap_propositions_derogations",
] as const;

/** Les 6 tables de la revue à froid (QUA-05), semées après la clôture. */
const TABLES_FROIDES = [
  "qualite_froide_campagnes",
  "qualite_froide_echantillon",
  "qualite_froide_constats",
  "qualite_froide_evaluations",
  "qualite_froide_actions",
  "qualite_froide_actions_historique",
] as const;

/** Interrupteurs d'urgence, réservations et dérivés : JAMAIS semés. */
const TABLES_A_LAISSER_VIDES = [
  "ia_reservations",
  "ia_cache_reponses",
  "ia_alertes_plafond",
  "ia_alertes_plafond_mission",
  "automatisation_coupe_circuits",
  "autonomie_coupe_circuit",
] as const;

type Comptages = Record<string, number>;

async function compter(ctx: ContexteTenantDemo, tables: readonly string[]): Promise<Comptages> {
  const r: Comptages = {};
  for (const t of tables) {
    // Nom de table issu des listes ci-dessus (constantes du test), jamais d'une entrée externe.
    const res = await ctx.proprietaire.query(
      `SELECT count(*) AS n FROM ${t} WHERE cabinet_id = $1`,
      [ctx.cabinetId],
    );
    r[t] = Number(res.rows[0].n);
  }
  return r;
}

async function nombre(ctx: ContexteTenantDemo, sql: string): Promise<number> {
  const res = await ctx.proprietaire.query(sql, [ctx.cabinetId]);
  return Number(res.rows[0].n);
}

let dossier: string;
let base: BaseJetable | undefined;
let apresPremier: Comptages;
let apresSecond: Comptages;
let froidesApres: Comptages;
let froidesRejeu: Comptages;
let toutesTables: Comptages;
let coutsAssocie = 0;
let coutsConsultant = 0;
let missionsCloturees = 0;
const invariants: Record<string, number> = {};

describe("seed du Tenant démo (phase ia-qualite-standard)", () => {
  beforeAll(async () => {
    dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-td-iqs-"));
    base = await creerBaseJetable("tdiqs", dossier);
    const silence = () => undefined;
    await semerTenantDemo(base.db, base.config, {
      publique: false,
      journal: silence,
      phases: [
        { nom: "missions", executer: semerMissions },
        // Phase précédente de l'intégration : elle lie déjà des méthodes à 3 missions terminées.
        { nom: "appels-offres-canaux", executer: semerAppelsOffresCanaux },
        { nom: "ia-qualite-standard", executer: semerIaQualiteStandard },
        {
          nom: "mesure-1",
          executer: async (ctx) => {
            apresPremier = await compter(ctx, TABLES_PHASE);
            toutesTables = await compter(ctx, TABLES_A_LAISSER_VIDES);
          },
        },
        { nom: "ia-qualite-standard-bis", executer: semerIaQualiteStandard },
        {
          nom: "mesure-2",
          executer: async (ctx) => {
            apresSecond = await compter(ctx, TABLES_PHASE);
            // Droits FIN-02 : les coûts IA ne sont lisibles qu'avec finance.lire.
            coutsAssocie = (await ctx.session("associe").get("/api/ia/couts")).statusCode;
            coutsConsultant = (await ctx.session("consultant").get("/api/ia/couts")).statusCode;
            invariants["generations_valide"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM ia_generations
                WHERE cabinet_id = $1 AND statut_contenu = 'valide'`,
            );
            invariants["generations_valide_sans_audit"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM ia_generations g
                WHERE g.cabinet_id = $1 AND g.statut_contenu = 'valide' AND NOT EXISTS (
                  SELECT 1 FROM journal_audit j
                   WHERE j.cabinet_id = g.cabinet_id AND j.action = 'validation_contenu_ia'
                     AND j.entite_id = g.demande_id::text)`,
            );
            invariants["generations_brouillon"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM ia_generations
                WHERE cabinet_id = $1 AND statut_contenu = 'brouillon_ia'`,
            );
            invariants["ia_openrouter"] = await nombre(
              ctx,
              `SELECT (SELECT count(*) FROM ia_generations WHERE cabinet_id = $1 AND fournisseur = 'openrouter')
                    + (SELECT count(*) FROM agents_evaluations WHERE cabinet_id = $1 AND fournisseur = 'openrouter') AS n`,
            );
            invariants["evaluations_locales"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM agents_evaluations
                WHERE cabinet_id = $1 AND fournisseur = 'local'`,
            );
            invariants["signature_par_auteur"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM qualite_validations v
                JOIN qualite_suivis s ON s.id = v.suivi_id
               WHERE v.cabinet_id = $1 AND v.etape = 'signature_directeur_mission'
                 AND s.auteur_id = v.acteur_id`,
            );
            invariants["autonomie_n3"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM autonomie_evenements
                WHERE cabinet_id = $1 AND type = 'promotion' AND niveau_apres IN ('N3', 'N4')`,
            );
          },
        },
        {
          nom: "cloture-finale",
          executer: async (ctx) => {
            await cloturerMissionsTerminees(ctx);
            missionsCloturees = await nombre(
              ctx,
              "SELECT count(*) AS n FROM missions WHERE cabinet_id = $1 AND statut = 'cloturee'",
            );
          },
        },
        { nom: "revues-froides", executer: semerRevuesFroides },
        {
          nom: "mesure-3",
          executer: async (ctx) => {
            froidesApres = await compter(ctx, TABLES_FROIDES);
            invariants["froide_relecteur_non_equipe"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM qualite_froide_echantillon e
                JOIN missions m ON m.id = e.mission_id
               WHERE e.cabinet_id = $1 AND e.relecteur_id IS NOT NULL
                 AND (e.relecteur_id IN (SELECT utilisateur_id FROM mission_equipe q WHERE q.mission_id = e.mission_id)
                      OR e.relecteur_id IN (m.directeur_id, m.chef_id))`,
            );
            invariants["froide_mission_ouverte"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM qualite_froide_echantillon e
                JOIN missions m ON m.id = e.mission_id
               WHERE e.cabinet_id = $1 AND m.statut <> 'cloturee'`,
            );
          },
        },
        { nom: "revues-froides-bis", executer: semerRevuesFroides },
        {
          nom: "mesure-4",
          executer: async (ctx) => {
            froidesRejeu = await compter(ctx, TABLES_FROIDES);
          },
        },
      ],
    });
  }, 3_000_000);

  afterAll(async () => {
    await supprimerBaseJetable(base);
    await rm(dossier, { recursive: true, force: true });
  }, 120_000);

  it("les 47 tables de la phase ne sont plus vides", () => {
    const vides = TABLES_PHASE.filter((t) => !((apresPremier[t] ?? 0) > 0));
    expect(vides).toEqual([]);
  });

  it("les 6 tables de la revue à froid sont remplies après la clôture, sans doublon au rejeu", () => {
    expect(TABLES_FROIDES.filter((t) => !((froidesApres[t] ?? 0) > 0))).toEqual([]);
    expect(froidesRejeu).toEqual(froidesApres);
  });

  it("rejouer la phase ne crée aucun doublon", () => {
    expect(apresSecond).toEqual(apresPremier);
  });

  it("les interrupteurs d'urgence, réservations et alertes dérivées restent vides", () => {
    expect(toutesTables).toEqual(Object.fromEntries(TABLES_A_LAISSER_VIDES.map((t) => [t, 0])));
  });

  it("les 5 missions terminées ne sont clôturées qu'après la phase, puis la revue à froid porte sur elles", () => {
    expect(missionsCloturees).toBe(5);
    expect(invariants["froide_mission_ouverte"]).toBe(0);
  });

  it("les contenus IA partent en brouillon ; chaque validation passe par la route (audit)", () => {
    expect(invariants["generations_brouillon"]).toBeGreaterThan(0);
    expect(invariants["generations_valide"]).toBeGreaterThan(0);
    expect(invariants["generations_valide"]).toBeLessThan(invariants["generations_brouillon"] ?? 0);
    expect(invariants["generations_valide_sans_audit"]).toBe(0);
  });

  it("aucune évaluation ni génération 'openrouter' forgée ; évaluations de non-régression locales", () => {
    expect(invariants["ia_openrouter"]).toBe(0);
    expect(invariants["evaluations_locales"]).toBeGreaterThan(0);
    // Sans clé fournisseur, aucune brique ne peut mériter N3 (50 exécutions non dégradées).
    expect(invariants["autonomie_n3"]).toBe(0);
  });

  it("séparation des tâches : un directeur ne signe pas son propre livrable ; relecteurs à froid indépendants", () => {
    expect(invariants["signature_par_auteur"]).toBe(0);
    expect(invariants["froide_relecteur_non_equipe"]).toBe(0);
  });

  it("les coûts IA ne sont lisibles qu'avec finance.lire (FIN-02)", () => {
    expect(coutsAssocie).toBe(200);
    expect(coutsConsultant).toBe(403);
  });
});
