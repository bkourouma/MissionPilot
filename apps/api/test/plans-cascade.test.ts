import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Cascade stratégique en graphe (PLA-12) : vision → axes → objectifs →
 * initiatives → projets → jalons → KPI ; porteurs (vision, axe, objectif :
 * 0420 ; initiative : responsable ; KPI : propriétaire) ; trous calculés par
 * le moteur ; projets et jalons versionnés en ajout seul ; droits, isolation.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let horsEquipe: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let planId: string;
let visionId: string;
let axeId: string;
let objectifId: string;
let initiativeId: string;

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

async function element(donnees: Record<string, unknown>): Promise<string> {
  return attendu(201, await a.chef.post(`/api/plans/${planId}/elements`, donnees)).id;
}

const cascade = async (par: Api = a.chef) =>
  attendu(200, await par.get(`/api/plans/${planId}/cascade`));

const codes = (c: { trous: { code: string; noeud_id: string | null }[] }, id: string | null) =>
  c.trous.filter((t) => t.noeud_id === id).map((t) => t.code);

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cascade A");
  b = await preparerCabinet(ctx, "Cascade B");
  const missionId = (await creerMission(a)).id;
  consultant = await a.avecRoles(["consultant"]);
  horsEquipe = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultant.utilisateurId,
    }),
  );
  planId = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan en cascade" }),
  ).id;
  visionId = await element({
    type: "vision_mission",
    donnees: { vision: "Leader régional", mission: "Servir les PME" },
  });
  axeId = await element({ type: "axe", donnees: { titre: "Croissance" } });
  objectifId = await element({
    type: "objectif",
    parent_id: axeId,
    donnees: { titre: "Doubler le CA", perspective: "finances" },
  });
  initiativeId = await element({
    type: "initiative",
    parent_id: objectifId,
    donnees: { titre: "Filiale", echeance: "2027-12-31", budget: 1_000_000 },
  });
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("lecture de la cascade : droits et isolation", () => {
  it("401 sans session, 403 sans plan.lire, 404 pour un autre cabinet ou hors équipe", async () => {
    const anonyme = (await import("./api.js")).api(ctx);
    expect((await anonyme.get(`/api/plans/${planId}/cascade`)).statusCode).toBe(401);
    expect((await gestionnaire.get(`/api/plans/${planId}/cascade`)).statusCode).toBe(403);
    expect((await b.associe.get(`/api/plans/${planId}/cascade`)).statusCode).toBe(404);
    expect((await horsEquipe.get(`/api/plans/${planId}/cascade`)).statusCode).toBe(404);
  });

  it("rend l'arbre et les trous du moteur (porteurs, KPI, projets)", async () => {
    const c = await cascade(consultant);
    expect(c.racines).toEqual([visionId]);
    expect(c.noeuds.map((n: { id: string; profondeur: number }) => [n.id, n.profondeur])).toEqual([
      [visionId, 0],
      [axeId, 1],
      [objectifId, 2],
      [initiativeId, 3],
    ]);
    expect(codes(c, visionId)).toEqual(["SANS_PORTEUR"]);
    expect(codes(c, objectifId)).toEqual(["SANS_PORTEUR", "OBJECTIF_SANS_KPI"]);
    expect(codes(c, initiativeId)).toEqual(["SANS_PORTEUR", "INITIATIVE_SANS_PROJET"]);
    expect(c.couverture).toMatchObject({ noeuds_actifs: 4, taux_porteurs: 0, taux_kpi: 0 });
    expect(c.synthese.bloquant).toBe(2);
  });
});

describe("porteurs de la vision, des axes et des objectifs", () => {
  it("désigne un porteur interne, versionné ; 409 s'il est déjà désigné", async () => {
    const url = (id: string) => `/api/plans/${planId}/elements/${id}/porteur`;
    for (const id of [visionId, axeId, objectifId]) {
      const r = attendu(200, await consultant.put(url(id), { porteur_id: a.chef.utilisateurId }));
      expect(r).toMatchObject({ version: 1, porteur_id: a.chef.utilisateurId });
    }
    expect(
      (await consultant.put(url(axeId), { porteur_id: a.chef.utilisateurId })).statusCode,
    ).toBe(409);
    const retrait = attendu(200, await consultant.put(url(axeId), { porteur_id: null }));
    expect(retrait.version).toBe(2);
    attendu(200, await consultant.put(url(axeId), { porteur_id: a.directeur.utilisateurId }));
    const c = await cascade();
    expect(codes(c, visionId)).toEqual([]);
    expect(c.porteurs[a.chef.utilisateurId]).toBeTruthy();
  });

  it("refuse une initiative, un porteur inconnu ou d'un autre cabinet, sans droit d'écriture", async () => {
    const url = (id: string) => `/api/plans/${planId}/elements/${id}/porteur`;
    expect(
      (await consultant.put(url(initiativeId), { porteur_id: a.chef.utilisateurId })).statusCode,
    ).toBe(400);
    expect(
      (await consultant.put(url(axeId), { porteur_id: b.chef.utilisateurId })).statusCode,
    ).toBe(400);
    expect((await gestionnaire.put(url(axeId), { porteur_id: null })).statusCode).toBe(403);
    expect((await b.associe.put(url(axeId), { porteur_id: null })).statusCode).toBe(404);
    expect((await consultant.put(url(axeId), { porteur_id: null, x: 1 })).statusCode).toBe(400);
  });
});

describe("projets et jalons", () => {
  let projetId: string;
  let jalonId: string;

  it("crée un projet sous une initiative et un jalon sous le projet", async () => {
    const p = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/cascade/noeuds`, {
        type: "projet",
        parent_id: initiativeId,
        donnees: { titre: "Étude de marché", echeance: "2027-06-30" },
      }),
    );
    projetId = p.id;
    expect(p).toMatchObject({
      type: "projet",
      parent_id: initiativeId,
      version: 1,
      statut: "a_lancer",
    });
    const j = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/cascade/noeuds`, {
        type: "jalon",
        parent_id: projetId,
        donnees: {
          titre: "Rapport d'étude",
          echeance: "2020-01-31",
          porteur_id: consultant.utilisateurId,
        },
      }),
    );
    jalonId = j.id;
    const c = await cascade();
    expect(codes(c, initiativeId)).toEqual(["SANS_PORTEUR"]);
    expect(codes(c, projetId)).toEqual(["SANS_PORTEUR"]);
    expect(codes(c, jalonId)).toEqual(["JALON_EN_RETARD"]);
    expect(c.noeuds.find((n: { id: string }) => n.id === jalonId)).toMatchObject({
      profondeur: 5,
      modifiable: true,
      echeance: "2020-01-31",
    });
  });

  it("refuse un parent incompatible, un jalon avec début, un statut d'un autre type", async () => {
    const url = `/api/plans/${planId}/cascade/noeuds`;
    expect(
      (
        await consultant.post(url, {
          type: "jalon",
          parent_id: initiativeId,
          donnees: { titre: "X", echeance: "2027-01-01" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await consultant.post(url, {
          type: "projet",
          parent_id: objectifId,
          donnees: { titre: "X", echeance: "2027-01-01" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await consultant.post(url, {
          type: "jalon",
          parent_id: projetId,
          donnees: { titre: "X", echeance: "2027-01-01", debut: "2026-01-01" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await consultant.post(url, {
          type: "projet",
          parent_id: initiativeId,
          donnees: { titre: "X", echeance: "2027-01-01", statut: "atteint" },
        })
      ).statusCode,
    ).toBe(400);
    expect((await gestionnaire.post(url, {})).statusCode).toBe(403);
    expect(
      (
        await b.associe.post(url, {
          type: "projet",
          parent_id: initiativeId,
          donnees: { titre: "X", echeance: "2027-01-01" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("refuse une date hors de 2000 à 2100 et un contenu de version démesuré (400, jamais 500)", async () => {
    const url = `/api/plans/${planId}/cascade/noeuds`;
    for (const echeance of ["1999-12-31", "2101-01-01"]) {
      const r = await consultant.post(url, {
        type: "projet",
        parent_id: initiativeId,
        donnees: { titre: "Hors bornes", echeance },
      });
      expect(r.statusCode, r.body).toBe(400);
    }
    expect(
      (
        await consultant.post(url, {
          type: "projet",
          parent_id: initiativeId,
          donnees: { titre: "Début hors bornes", debut: "2150-01-01", echeance: "2027-06-30" },
        })
      ).statusCode,
    ).toBe(400);
    const version = `${url}/${projetId}/versions`;
    const demesure = await consultant.post(version, {
      donnees: { titre: "Étude", echeance: "2027-06-30", description: "x".repeat(30_000) },
    });
    expect(demesure.statusCode, demesure.body).toBe(400);
    const nombreux = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, 1]));
    expect((await consultant.post(version, { donnees: nombreux })).statusCode).toBe(400);
  });

  it("versionne un jalon (atteint), refuse une version identique, retire un projet", async () => {
    const url = (id: string) => `/api/plans/${planId}/cascade/noeuds/${id}/versions`;
    const donnees = {
      titre: "Rapport d'étude",
      echeance: "2020-01-31",
      porteur_id: consultant.utilisateurId,
      statut: "atteint",
    };
    expect(attendu(201, await consultant.post(url(jalonId), { donnees })).version).toBe(2);
    expect((await consultant.post(url(jalonId), { donnees })).statusCode).toBe(409);
    expect(
      (await consultant.post(url(jalonId), { donnees: { ...donnees, statut: "en_cours" } }))
        .statusCode,
    ).toBe(400);
    expect(codes(await cascade(), jalonId)).toEqual([]);
    const retrait = attendu(
      201,
      await consultant.post(url(projetId), {
        donnees: { titre: "Étude de marché", echeance: "2027-06-30" },
        retire: true,
      }),
    );
    expect(retrait.retire).toBe(true);
    const c = await cascade();
    // Projet retiré : le jalon est orphelin, l'initiative de nouveau sans projet.
    expect(codes(c, jalonId)).toEqual(["NOEUD_ORPHELIN"]);
    expect(codes(c, initiativeId)).toContain("INITIATIVE_SANS_PROJET");
    expect((await b.associe.post(url(jalonId), { donnees })).statusCode).toBe(404);
  });

  it("un KPI créé depuis l'objectif ferme le trou « objectif sans KPI »", async () => {
    attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/objectifs/${objectifId}/kpi`, {
        libelle: "Chiffre d'affaires",
        unite: "FCFA",
        sens: "plus_haut_mieux",
        nature: "flux",
        frequence: "trimestrielle",
        debut_suivi: "2027-01-01",
        proprietaire_id: a.chef.utilisateurId,
      }),
    );
    const c = await cascade();
    expect(codes(c, objectifId)).toEqual([]);
    expect(c.couverture.taux_kpi).toBe(100);
  });
});

describe("défense en base", () => {
  it("porteurs et versions de nœuds en ajout seul (MPS01), numéro de version contrôlé (MPS02)", async () => {
    await proprietaire(async (c) => {
      await expect(c.query("UPDATE plan_porteurs SET porteur_id = NULL")).rejects.toMatchObject({
        code: "MPS01",
      });
      await expect(c.query("DELETE FROM plan_cascade_versions")).rejects.toMatchObject({
        code: "MPS01",
      });
      await expect(
        c.query(
          `INSERT INTO plan_porteurs (cabinet_id, plan_id, element_id, version, auteur_id)
           SELECT cabinet_id, plan_id, element_id, 9, auteur_id FROM plan_porteurs LIMIT 1`,
        ),
      ).rejects.toMatchObject({ code: "MPS02" });
      await expect(
        c.query(
          `INSERT INTO plan_porteurs (cabinet_id, plan_id, element_id, version, auteur_id)
           SELECT p.cabinet_id, p.plan_id, $1, 1, p.auteur_id FROM plan_porteurs p LIMIT 1`,
          [initiativeId],
        ),
      ).rejects.toMatchObject({ code: "MPS02" });
    });
  });
});
