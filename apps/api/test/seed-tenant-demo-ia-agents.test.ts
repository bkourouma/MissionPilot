import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { semerTenantDemo } from "../src/db/tenant-demo/index.js";
import { semerIaQualiteStandard } from "../src/db/tenant-demo/phases/ia-qualite-standard.js";
import { semerMissions } from "../src/db/tenant-demo/phases/missions.js";
import { coutMicroUsd } from "../src/ia/modeles.js";
import {
  compter,
  fermerBaseDeTest,
  nombre,
  ouvrirBaseDeTest,
  TABLES_A_LAISSER_VIDES,
  TABLES_IDEMPOTENCE,
  TABLES_PHASE_IA,
  type BaseDeTest,
  type Comptages,
} from "./seed-tenant-demo-iqs-outils.js";

/*
 * Phase « ia-qualite-standard » du Tenant démo, volet IA, agents et automatisation (IA, copilote,
 * agents, autonomie, automatisation, avancement), dans une base jetable. Le déroulé réel : phase
 * « missions » (casting), phase testée jouée deux fois (idempotence), droits FIN-02. Le volet
 * qualité, standard et revues à froid est dans seed-tenant-demo-qualite-standard.test.ts.
 */

let env: BaseDeTest | undefined;
let apresPremier: Comptages;
let apresSecond: Comptages;
let toutesTables: Comptages;
let coutsAssocie = 0;
let coutsConsultant = 0;
const invariants: Record<string, number> = {};
let jobsAvant = 0;
let jobsApres = 0;
let demandesAvant: string[] = [];

describe("seed du Tenant démo (phase ia-qualite-standard, IA et agents)", () => {
  beforeAll(async () => {
    env = await ouvrirBaseDeTest("tdiqs");
    const silence = () => undefined;
    await semerTenantDemo(env.base.db, env.base.config, {
      publique: false,
      journal: silence,
      phases: [
        { nom: "missions", executer: semerMissions },
        {
          nom: "avant-phase",
          executer: async (ctx) => {
            jobsAvant = await nombre(
              ctx,
              "SELECT count(*) AS n FROM jobs WHERE cabinet_id = $1 AND statut = 'en_attente'",
            );
            const r = await ctx.proprietaire.query(
              "SELECT id FROM ia_demandes WHERE cabinet_id = $1",
              [ctx.cabinetId],
            );
            demandesAvant = r.rows.map((x: { id: string }) => x.id);
          },
        },
        { nom: "ia-qualite-standard", executer: semerIaQualiteStandard },
        {
          nom: "mesure-1",
          executer: async (ctx) => {
            apresPremier = await compter(ctx, [...TABLES_PHASE_IA, ...TABLES_IDEMPOTENCE]);
            toutesTables = await compter(ctx, TABLES_A_LAISSER_VIDES);
          },
        },
        { nom: "ia-qualite-standard-bis", executer: semerIaQualiteStandard },
        {
          nom: "mesure-2",
          executer: async (ctx) => {
            apresSecond = await compter(ctx, [...TABLES_PHASE_IA, ...TABLES_IDEMPOTENCE]);
            // Aucun envoi réel : la phase ne crée aucun job en attente et la règle de relance
            // automatique du client (envoi réel) n'est jamais activée ni exécutée.
            jobsApres = await nombre(
              ctx,
              "SELECT count(*) AS n FROM jobs WHERE cabinet_id = $1 AND statut = 'en_attente'",
            );
            invariants["relance_active_ou_executee"] = await nombre(
              ctx,
              `SELECT (SELECT count(*) FROM automatisations
                         WHERE cabinet_id = $1 AND nom ILIKE '%relance automatique%' AND active)
                    + (SELECT count(*) FROM automatisation_executions x
                         JOIN automatisations a ON a.id = x.automatisation_id
                        WHERE x.cabinet_id = $1 AND a.nom ILIKE '%relance automatique%') AS n`,
            );
            invariants["relance_declaree"] = await nombre(
              ctx,
              "SELECT count(*) AS n FROM automatisations WHERE cabinet_id = $1 AND nom ILIKE '%relance automatique%'",
            );
            // Coûts IA SIMULÉS de démonstration : cohérents avec les demandes de la phase.
            const mesDemandes = "d.cabinet_id = $1 AND d.id <> ALL($2::uuid[])";
            const requete = async (sql: string): Promise<number> =>
              Number((await ctx.proprietaire.query(sql, [ctx.cabinetId, demandesAvant])).rows[0].n);
            invariants["demandes_sans_une_consommation"] = await requete(
              `SELECT count(*) AS n FROM ia_demandes d
                WHERE ${mesDemandes} AND d.statut = 'terminee'
                  AND (SELECT count(*) FROM ia_consommations c WHERE c.demande_id = d.id) <> 1`,
            );
            invariants["consommation_autre_mission"] = await requete(
              `SELECT count(*) AS n FROM ia_consommations c JOIN ia_demandes d ON d.id = c.demande_id
                WHERE ${mesDemandes} AND c.mission_id IS DISTINCT FROM d.mission_id`,
            );
            invariants["consommation_succes_sans_demande_terminee"] = await requete(
              `SELECT count(*) AS n FROM ia_consommations c JOIN ia_demandes d ON d.id = c.demande_id
                WHERE ${mesDemandes} AND c.issue = 'succes' AND d.statut <> 'terminee'`,
            );
            invariants["consommation_test_avec_demande"] = await requete(
              `SELECT count(*) AS n FROM ia_consommations d
                WHERE d.cabinet_id = $1 AND $2::uuid[] IS NOT NULL
                  AND ((d.issue = 'test') <> (d.demande_id IS NULL))`,
            );
            const lignes = await ctx.proprietaire.query(
              "SELECT modele, tokens_entree, tokens_sortie, cout_micro_usd, issue FROM ia_consommations WHERE cabinet_id = $1",
              [ctx.cabinetId],
            );
            invariants["consommations_total"] = lignes.rows.length;
            invariants["cout_different_du_tarif"] = lignes.rows.filter(
              (c: {
                modele: string;
                tokens_entree: number;
                tokens_sortie: number;
                cout_micro_usd: string;
                issue: string;
              }) =>
                c.issue !== "cache" &&
                Number(c.cout_micro_usd) !==
                  coutMicroUsd(c.modele, c.tokens_entree, c.tokens_sortie).cout,
            ).length;
            invariants["mois_au_dessus_du_plafond"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM (
                 SELECT date_trunc('month', c.cree_le) AS mois, sum(c.cout_micro_usd) AS total
                   FROM ia_consommations c WHERE c.cabinet_id = $1 GROUP BY 1) t
                WHERE t.total > (SELECT plafond_mensuel_micro_usd FROM ia_parametres_cabinet
                                  WHERE cabinet_id = $1)`,
            );
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
            invariants["autonomie_n3"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM autonomie_evenements
                WHERE cabinet_id = $1 AND type = 'promotion' AND niveau_apres IN ('N3', 'N4')`,
            );
          },
        },
      ],
    });
  }, 3_000_000);

  afterAll(async () => {
    await fermerBaseDeTest(env);
  }, 120_000);

  it("les 26 tables IA, agents et automatisation de la phase ne sont plus vides", () => {
    const vides = TABLES_PHASE_IA.filter((t) => !((apresPremier[t] ?? 0) > 0));
    expect(vides).toEqual([]);
  });

  it("rejouer la phase ne crée aucun doublon", () => {
    expect(apresSecond).toEqual(apresPremier);
  });

  it("les interrupteurs d'urgence, réservations et alertes dérivées restent vides", () => {
    expect(toutesTables).toEqual(Object.fromEntries(TABLES_A_LAISSER_VIDES.map((t) => [t, 0])));
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

  it("aucun envoi réel : pas de job en attente créé, relance automatique jamais active", () => {
    expect(jobsApres).toBe(jobsAvant);
    expect(invariants["relance_declaree"]).toBeGreaterThan(0);
    expect(invariants["relance_active_ou_executee"]).toBe(0);
  });

  it("coûts IA simulés cohérents : une consommation par demande, tarif du modèle, plafond mensuel", () => {
    expect(invariants["consommations_total"]).toBeGreaterThan(0);
    expect(invariants["demandes_sans_une_consommation"]).toBe(0);
    expect(invariants["consommation_autre_mission"]).toBe(0);
    expect(invariants["consommation_succes_sans_demande_terminee"]).toBe(0);
    expect(invariants["consommation_test_avec_demande"]).toBe(0);
    expect(invariants["cout_different_du_tarif"]).toBe(0);
    expect(invariants["mois_au_dessus_du_plafond"]).toBe(0);
  });

  it("les coûts IA ne sont lisibles qu'avec finance.lire (FIN-02)", () => {
    expect(coutsAssocie).toBe(200);
    expect(coutsConsultant).toBe(403);
  });
});
