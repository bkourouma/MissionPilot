import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyserBancabilite, type ExerciceBancabilite } from "@missionpilot/engines";
import { api, type Api } from "./api.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { creerAssertion, creerPreuve, lier } from "./preuves-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";

/*
 * Bancabilité (PLA-17) : ratios bancaires et plan de financement calculés par
 * le moteur depuis le résultat figé d'une version VALIDÉE du modèle financier
 * (409 MODELE_NON_VALIDE sinon) ; dossier bancaire en Word par
 * l'infrastructure des rapports (modèle `dossier_bancaire`, niveau « plan »,
 * version validée doublée en base, MPR03) ; droits et isolation.
 */

let ctx: Contexte & { dossier: string };
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let missionId: string;
let planId: string;

const hypotheses = {
  premierExercice: 2027,
  chiffreAffairesReference: 100_000_000,
  croissanceChiffreAffaires: 10,
  tauxMargeBrute: 40,
  tauxChargesVariables: 5,
  chargesFixes: 10_000_000,
  investissements: [{ libelle: "Matériel", annee: 1, montant: 12_000_000, dureeAmortissement: 4 }],
  emprunts: [
    { libelle: "Prêt bancaire", anneeDeblocage: 1, montant: 10_000_000, tauxAnnuel: 10, duree: 2 },
  ],
  delaiClientsJours: 36,
  delaiFournisseursJours: 60,
  stocksJours: 30,
  tauxImpotSocietes: 25,
  bilanOuverture: { tresorerie: 20_000_000, capital: 20_000_000 },
};

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerCabinet(ctx, "Banque A");
  b = await preparerCabinet(ctx, "Banque B");
  missionId = (await creerMission(a)).id;
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultant.utilisateurId,
    }),
  );
  planId = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan bancable", horizon: 3 }),
  ).id;
  attendu(201, await consultant.post(`/api/plans/${planId}/modeles`, { hypotheses }));
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

const url = (q = "") => `/api/plans/${planId}/bancabilite${q}`;
const dossier = (q = "?format=docx") => `/api/plans/${planId}/dossier-bancaire${q}`;

describe("bancabilité : modèle validé exigé", () => {
  it("409 MODELE_NON_VALIDE tant qu'aucune version n'est validée (lecture et dossier)", async () => {
    expect(attendu(409, await consultant.get(url())).erreur.code).toBe("MODELE_NON_VALIDE");
    expect(attendu(409, await a.chef.post(dossier())).erreur.code).toBe("MODELE_NON_VALIDE");
  });

  it("401, 403 sans plan.lire, 404 pour un autre cabinet", async () => {
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    expect((await gestionnaire.get(url())).statusCode).toBe(403);
    expect((await b.associe.get(url())).statusCode).toBe(404);
    expect((await gestionnaire.post(dossier())).statusCode).toBe(403);
    // Le dossier part vers une banque : plan.valider exigé en plus de plan.lire.
    expect((await consultant.post(dossier())).statusCode).toBe(403);
    expect((await b.associe.post(dossier())).statusCode).toBe(404);
    expect((await api(ctx).post(dossier())).statusCode).toBe(401);
  });

  it("une fois validée : ratios et plan de financement du moteur sur le résultat figé", async () => {
    attendu(200, await a.chef.post(`/api/plans/${planId}/modeles/1/validation`));
    const r = attendu(200, await consultant.get(url()));
    const version = attendu(200, await consultant.get(`/api/plans/${planId}/modeles/1`));
    const attendue = analyserBancabilite(
      version.resultat.base.annees as readonly ExerciceBancabilite[],
    );
    expect(r.modele.version).toBe(1);
    expect(r.modele.validation).not.toBeNull();
    expect(r.exercices).toEqual(attendue.exercices);
    expect(r.verdict).toBe(attendue.verdict);
    expect(r.plan_financement).toHaveLength(3);
    expect(r.plan_financement[0].ressources.emprunts_nouveaux).toBe(10_000_000);
    expect(r.plan_financement[0].emplois.investissements).toBe(12_000_000);
    expect(r.totaux).toEqual(attendue.totaux);
    expect(r.seuils.couverture_service_dette_min_pb).toBe(12_000);
    expect(r.echeanciers).toHaveLength(1);
  });

  it("une version explicitement demandée doit être validée", async () => {
    attendu(
      201,
      await consultant.post(`/api/plans/${planId}/modeles`, {
        hypotheses: { ...hypotheses, chargesFixes: 12_000_000 },
      }),
    );
    expect(attendu(409, await consultant.get(url("?version=2"))).erreur.code).toBe(
      "MODELE_NON_VALIDE",
    );
    expect(attendu(200, await consultant.get(url())).modele.version).toBe(1);
    expect((await consultant.get(url("?version=9"))).statusCode).toBe(404);
  });
});

describe("dossier bancaire (rapport Word)", () => {
  it("généré depuis la version validée, listé avec les rapports du plan", async () => {
    // Une assertion retenue citée par le « plan » alimenterait l'annexe « Sources » du rapport de
    // plan ; le dossier destiné à une banque ne la reprend pas.
    const assertion = await creerAssertion(a.chef, missionId, {
      statut: "retenue",
      livrable: "Plan stratégique",
    });
    await lier(a.chef, assertion.id, (await creerPreuve(a.chef, missionId)).id, "pour");
    const r = attendu(201, await a.chef.post(dossier()));
    expect(r.rapport).toMatchObject({
      modele: "dossier_bancaire",
      niveau: "plan",
      plan_id: planId,
      version_source: 1,
      format: "docx",
    });
    const f = await consultant.get(`/api/fichiers/${r.fichier.id}`);
    expect(f.statusCode).toBe(200);
    const xml = toutLeXml(dezipper(f.rawPayload));
    expect(xml).toContain("Dossier bancaire");
    expect(xml).toContain("Ratios bancaires");
    expect(xml).toContain("Plan de financement");
    expect(xml).toContain("Échéanciers des emprunts");
    expect(xml).toContain("Compte de résultat prévisionnel");
    expect(xml).not.toContain("Annexe — Sources");
    expect(xml).not.toContain("registre des preuves");
    const liste = attendu(200, await consultant.get(`/api/plans/${planId}/rapports`));
    expect(liste.elements.map((e: { id: string }) => e.id)).toContain(r.rapport.id);
    expect(attendu(409, await a.chef.post(dossier("?format=docx&version=2"))).erreur.code).toBe(
      "MODELE_NON_VALIDE",
    );
    expect((await a.chef.post(dossier("?format=pptx"))).statusCode).toBe(400);
  });

  it("défense en base : un dossier sur une version non validée est refusé (MPR03)", async () => {
    await proprietaire(async (c) => {
      await expect(
        c.query(
          `INSERT INTO rapports_mission (cabinet_id, mission_id, fichier_id, modele, format, statut,
             niveau, genere_par, plan_id, version_source)
           SELECT cabinet_id, mission_id, gen_random_uuid(), 'dossier_bancaire', 'docx', 'brouillon',
             'plan', genere_par, plan_id, 2
           FROM rapports_mission WHERE modele = 'dossier_bancaire' LIMIT 1`,
        ),
      ).rejects.toMatchObject({ code: "MPR03" });
      await expect(
        c.query(
          `INSERT INTO rapports_mission (cabinet_id, mission_id, fichier_id, modele, format, statut,
             niveau, genere_par, plan_id, version_source)
           SELECT cabinet_id, mission_id, gen_random_uuid(), 'dossier_bancaire', 'docx', 'brouillon',
             'plan', genere_par, plan_id, NULL
           FROM rapports_mission WHERE modele = 'dossier_bancaire' LIMIT 1`,
        ),
        // Sans version : le déclencheur refuse avant même la contrainte CHECK.
      ).rejects.toMatchObject({ code: "MPR03" });
    });
  });
});
