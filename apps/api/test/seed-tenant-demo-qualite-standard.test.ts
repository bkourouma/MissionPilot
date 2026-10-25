import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { semerTenantDemo } from "../src/db/tenant-demo/index.js";
import { semerRevuesFroides } from "../src/db/tenant-demo/ia-qualite-standard/qualite-froide.js";
import { cloturerMissionsTerminees } from "../src/db/tenant-demo/missions/cloture.js";
import { semerIaQualiteStandard } from "../src/db/tenant-demo/phases/ia-qualite-standard.js";
import { semerMissions } from "../src/db/tenant-demo/phases/missions.js";
import {
  compter,
  fermerBaseDeTest,
  nombre,
  ouvrirBaseDeTest,
  REQUETES_CHRONOLOGIE,
  TABLES_FROIDES,
  TABLES_PHASE_QUALITE,
  type BaseDeTest,
  type Comptages,
} from "./seed-tenant-demo-iqs-outils.js";

/*
 * Phase « ia-qualite-standard » du Tenant démo, volet qualité, standard et revues à froid, dans une
 * base jetable. Le déroulé réel : phase « missions » (casting), phase testée jouée deux fois
 * (idempotence), clôture des missions terminées, revues à froid jouées deux fois. Le volet IA,
 * agents et automatisation est dans seed-tenant-demo-ia-agents.test.ts.
 */

let env: BaseDeTest | undefined;
let apresPremier: Comptages;
let apresSecond: Comptages;
let froidesApres: Comptages;
let froidesRejeu: Comptages;
let missionsCloturees = 0;
const invariants: Record<string, number> = {};
let liaisonsTermineesAvant = 0;
let liaisonsTermineesApres = 0;

describe("seed du Tenant démo (phase ia-qualite-standard, qualité et standard)", () => {
  beforeAll(async () => {
    env = await ouvrirBaseDeTest("tdqs");
    const silence = () => undefined;
    await semerTenantDemo(env.base.db, env.base.config, {
      publique: false,
      journal: silence,
      phases: [
        { nom: "missions", executer: semerMissions },
        // Seule la phase « missions » précède ici (les lignes des autres lots, datées à l'horloge
        // réelle, fausseraient l'invariant de chronologie) ; la tolérance aux liaisons de méthode
        // posées par d'autres lots est vérifiée sur la chaîne réelle des phases (seed complet).
        {
          nom: "avant-phase",
          executer: async (ctx) => {
            liaisonsTermineesAvant = await nombre(
              ctx,
              "SELECT count(*) AS n FROM mission_methodes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut IN ('a_cloturer', 'cloturee')",
            );
          },
        },
        { nom: "ia-qualite-standard", executer: semerIaQualiteStandard },
        {
          nom: "mesure-1",
          executer: async (ctx) => {
            apresPremier = await compter(ctx, TABLES_PHASE_QUALITE);
          },
        },
        { nom: "ia-qualite-standard-bis", executer: semerIaQualiteStandard },
        {
          nom: "mesure-2",
          executer: async (ctx) => {
            apresSecond = await compter(ctx, TABLES_PHASE_QUALITE);
            // mission_methodes (ajout seul, horloge réelle de la route) : la phase ne lie aucune
            // méthode à une mission terminée (elle serait postérieure à la clôture antidatée).
            liaisonsTermineesApres = await nombre(
              ctx,
              "SELECT count(*) AS n FROM mission_methodes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut IN ('a_cloturer', 'cloturee')",
            );
            invariants["signature_par_auteur"] = await nombre(
              ctx,
              `SELECT count(*) AS n FROM qualite_validations v
                JOIN qualite_suivis s ON s.id = v.suivi_id
               WHERE v.cabinet_id = $1 AND v.etape = 'signature_directeur_mission'
                 AND s.auteur_id = v.acteur_id`,
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
    await fermerBaseDeTest(env);
  }, 120_000);

  it("les 18 tables de qualité et de standard de la phase ne sont plus vides", () => {
    const vides = TABLES_PHASE_QUALITE.filter((t) => !((apresPremier[t] ?? 0) > 0));
    expect(vides).toEqual([]);
  });

  it("les 6 tables de la revue à froid sont remplies après la clôture, sans doublon au rejeu", () => {
    expect(TABLES_FROIDES.filter((t) => !((froidesApres[t] ?? 0) > 0))).toEqual([]);
    expect(froidesRejeu).toEqual(froidesApres);
  });

  it("rejouer la phase ne crée aucun doublon", () => {
    expect(apresSecond).toEqual(apresPremier);
  });

  it("les 5 missions terminées ne sont clôturées qu'après la phase, puis la revue à froid porte sur elles", () => {
    expect(missionsCloturees).toBe(5);
    expect(invariants["froide_mission_ouverte"]).toBe(0);
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
});
