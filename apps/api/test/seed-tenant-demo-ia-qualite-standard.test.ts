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
import { coutMicroUsd } from "../src/ia/modeles.js";
import { creerBaseJetable, supprimerBaseJetable, type BaseJetable } from "./outils-base-jetable.js";

/*
 * Phase « ia-qualite-standard » du Tenant démo (IA, agents, automatisation, copilote, qualité,
 * standard), puis étape d'après clôture (revues à froid), dans une base jetable. Le déroulé réel :
 * phase « missions » (casting), phase testée jouée deux fois (idempotence), droits FIN-02,
 * clôture des missions terminées, revues à froid jouées deux fois.
 */

/** Les 44 tables de la phase (hors revues à froid, semées après la clôture). */
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

/** Tables non vides avant : leur nombre de lignes ne doit pas bouger au rejeu de la phase. */
const TABLES_IDEMPOTENCE = ["ia_demandes", "taches_collaboration", "commentaires"] as const;

type Comptages = Record<string, number>;

/**
 * Chronologie : aucune ligne de la phase n'est datée APRÈS la clôture d'une mission clôturée (la
 * clôture finale antidate cloturee_le à fin de mission + 6 jours). Chaque requête compte les
 * lignes fautives. NB : les écritures passées par les routes portent l'horloge RÉELLE du serveur
 * (environ une journée après « aujourd'hui » fictif) ; elles ne doivent donc concerner que des
 * missions ouvertes, ce que cet invariant garantit. mission_methodes en est exclue : les 3 liaisons
 * de missions terminées viennent du lot 5 (route, horloge réelle) ; la phase n'en ajoute aucune (test dédié).
 */
const REQUETES_CHRONOLOGIE: Record<string, string> = {
  ia_demandes:
    "SELECT count(*) AS n FROM ia_demandes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  ia_consommations:
    "SELECT count(*) AS n FROM ia_consommations x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  agents_executions:
    "SELECT count(*) AS n FROM agents_executions x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  agents_contributions:
    "SELECT count(*) AS n FROM agents_contributions x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  agents_plafonds_mission:
    "SELECT count(*) AS n FROM agents_plafonds_mission x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.modifie_le > m.cloturee_le",
  derogations:
    "SELECT count(*) AS n FROM derogations x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  derogation_validations:
    "SELECT count(*) AS n FROM derogation_validations v JOIN derogations x ON x.id = v.derogation_id JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND v.cree_le > m.cloturee_le",
  automatisation_brouillons:
    "SELECT count(*) AS n FROM automatisation_brouillons x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  qualite_suivis:
    "SELECT count(*) AS n FROM qualite_suivis x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.ouvert_le > m.cloturee_le",
  qualite_evenements:
    "SELECT count(*) AS n FROM qualite_evenements v JOIN qualite_suivis x ON x.id = v.suivi_id JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND v.le > m.cloturee_le",
  qualite_validations:
    "SELECT count(*) AS n FROM qualite_validations v JOIN qualite_suivis x ON x.id = v.suivi_id JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND v.valide_le > m.cloturee_le",
  qualite_signatures:
    "SELECT count(*) AS n FROM qualite_signatures v JOIN qualite_suivis x ON x.id = v.suivi_id JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND v.signe_le > m.cloturee_le",
  qualite_acceptations:
    "SELECT count(*) AS n FROM qualite_acceptations x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.evalue_le > m.cloturee_le",
  qualite_satisfactions:
    "SELECT count(*) AS n FROM qualite_satisfactions x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.saisi_le > m.cloturee_le",
};

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
let jobsAvant = 0;
let liaisonsTermineesAvant = 0;
let liaisonsTermineesApres = 0;
let jobsApres = 0;
let demandesAvant: string[] = [];

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
        {
          nom: "avant-phase",
          executer: async (ctx) => {
            jobsAvant = await nombre(
              ctx,
              "SELECT count(*) AS n FROM jobs WHERE cabinet_id = $1 AND statut = 'en_attente'",
            );
            liaisonsTermineesAvant = await nombre(
              ctx,
              "SELECT count(*) AS n FROM mission_methodes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut IN ('a_cloturer', 'cloturee')",
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
            apresPremier = await compter(ctx, [...TABLES_PHASE, ...TABLES_IDEMPOTENCE]);
            toutesTables = await compter(ctx, TABLES_A_LAISSER_VIDES);
          },
        },
        { nom: "ia-qualite-standard-bis", executer: semerIaQualiteStandard },
        {
          nom: "mesure-2",
          executer: async (ctx) => {
            apresSecond = await compter(ctx, [...TABLES_PHASE, ...TABLES_IDEMPOTENCE]);
            // Aucun envoi réel : la phase ne crée aucun job en attente et la règle de relance
            // automatique du client (envoi réel) n'est jamais activée ni exécutée.
            jobsApres = await nombre(
              ctx,
              "SELECT count(*) AS n FROM jobs WHERE cabinet_id = $1 AND statut = 'en_attente'",
            );
            // mission_methodes (ajout seul, horloge réelle de la route) : la phase ne lie aucune
            // méthode à une mission terminée (elle serait postérieure à la clôture antidatée).
            liaisonsTermineesApres = await nombre(
              ctx,
              "SELECT count(*) AS n FROM mission_methodes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut IN ('a_cloturer', 'cloturee')",
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
            for (const [table, sql] of Object.entries(REQUETES_CHRONOLOGIE)) {
              invariants[`apres_cloture_${table}`] = await nombre(ctx, sql);
            }
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

  it("les 44 tables de la phase ne sont plus vides", () => {
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

  it("chronologie : aucune ligne de la phase n'est datée après la clôture de sa mission", () => {
    const fautes = Object.fromEntries(
      Object.keys(REQUETES_CHRONOLOGIE).map((t) => [t, invariants[`apres_cloture_${t}`]]),
    );
    expect(fautes).toEqual(
      Object.fromEntries(Object.keys(REQUETES_CHRONOLOGIE).map((t) => [t, 0])),
    );
  });

  it("la phase ne lie aucune méthode à une mission terminée (liaison postérieure à la clôture)", () => {
    expect(liaisonsTermineesApres).toBe(liaisonsTermineesAvant);
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
