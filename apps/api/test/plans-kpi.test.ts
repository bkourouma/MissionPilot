import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * KPI créés depuis les objectifs du plan (PLA-10) : le KPI naît dans le module
 * de pilotage (mêmes règles que POST /missions/:id/kpi), rattaché à
 * l'objectif (0183, ajout seul) ; droits plan.ecrire ET kpi.gerer ; isolation
 * entre cabinets ; objectif retiré ou élément d'un autre type refusés.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let missionId: string;
let planId: string;
let axeId: string;
let objectifId: string;

const KPI = {
  libelle: "Taux de satisfaction client",
  unite: "%",
  sens: "plus_haut_mieux",
  nature: "stock",
  frequence: "trimestrielle",
  debut_suivi: "2027-02-15",
  cible: 90,
};

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

const url = (id = objectifId) => `/api/plans/${planId}/objectifs/${id}/kpi`;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Plan KPI A");
  b = await preparerCabinet(ctx, "Plan KPI B");
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
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan piloté" }),
  ).id;
  axeId = attendu(
    201,
    await a.chef.post(`/api/plans/${planId}/elements`, {
      type: "axe",
      donnees: { titre: "Clients" },
    }),
  ).id;
  objectifId = attendu(
    201,
    await a.chef.post(`/api/plans/${planId}/elements`, {
      type: "objectif",
      parent_id: axeId,
      donnees: {
        titre: "Fidéliser les clients",
        perspective: "clients",
        indicateur: "Taux de satisfaction",
        cible: "90 %",
      },
    }),
  ).id;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("KPI issus des objectifs : droits", () => {
  it("401 sans session ; 403 sans kpi.gerer (consultant) ou sans plan.* (gestionnaire)", async () => {
    expect((await api(ctx).post(url(), KPI)).statusCode).toBe(401);
    expect((await api(ctx).get(`/api/plans/${planId}/kpi`)).statusCode).toBe(401);
    expect((await consultant.post(url(), KPI)).statusCode).toBe(403);
    expect((await gestionnaire.post(url(), KPI)).statusCode).toBe(403);
    expect((await gestionnaire.get(`/api/plans/${planId}/kpi`)).statusCode).toBe(403);
  });

  it("autre cabinet : 404 en lecture comme en création", async () => {
    expect((await b.associe.get(`/api/plans/${planId}/kpi`)).statusCode).toBe(404);
    expect((await b.associe.post(url(), KPI)).statusCode).toBe(404);
  });
});

describe("KPI issus des objectifs : création", () => {
  it("liste des objectifs sans KPI", async () => {
    const l = attendu(200, await consultant.get(`/api/plans/${planId}/kpi`));
    expect(l.objectifs).toEqual([
      expect.objectContaining({
        id: objectifId,
        titre: "Fidéliser les clients",
        perspective: "clients",
        indicateur: "Taux de satisfaction",
        cible: "90 %",
        kpis: [],
      }),
    ]);
  });

  it("le chef crée le KPI dans le module de pilotage, rattaché à l'objectif", async () => {
    const o = attendu(201, await a.chef.post(url(), KPI));
    expect(o.kpis).toHaveLength(1);
    const kpiId = o.kpis[0].id;
    expect(o.kpis[0]).toMatchObject({
      libelle: KPI.libelle,
      unite: "%",
      perspective: "clients",
      frequence: "trimestrielle",
      actif: true,
      objectif_version: 1,
    });
    // Même KPI que le module #4 : début de suivi ramené au début du trimestre, cible initiale.
    const kpi = attendu(200, await a.chef.get(`/api/kpi/${kpiId}`));
    expect(kpi).toMatchObject({
      mission_id: missionId,
      client_id: a.clientId,
      perspective: "clients",
      debut_suivi: "2027-01-01",
    });
    expect(kpi.cibles).toEqual([
      expect.objectContaining({ valeur: 90, a_partir_de: "2027-01-01" }),
    ]);
    const liste = attendu(200, await consultant.get(`/api/missions/${missionId}/kpi`));
    expect(liste.elements.map((k: { id: string }) => k.id)).toContain(kpiId);
    const journal = await proprietaire((c) =>
      c.query(
        `SELECT action FROM journal_audit WHERE cabinet_id = $1
           AND action IN ('kpi.creer', 'plan.objectif.kpi.creer')`,
        [a.cabinetId],
      ),
    );
    expect(journal.rows.map((l) => l.action).sort()).toEqual([
      "kpi.creer",
      "plan.objectif.kpi.creer",
    ]);
  });

  it("une perspective fournie l'emporte sur celle de l'objectif", async () => {
    const o = attendu(
      201,
      await a.chef.post(url(), { ...KPI, libelle: "Coût du service", perspective: "finances" }),
    );
    expect(o.kpis.map((k: { perspective: string }) => k.perspective)).toEqual([
      "clients",
      "finances",
    ]);
  });

  it("corps invalide : 400 ; élément qui n'est pas un objectif ou inconnu : 404", async () => {
    expect((await a.chef.post(url(), { ...KPI, sens: "autre" })).statusCode).toBe(400);
    expect((await a.chef.post(url(), { ...KPI, inattendu: 1 })).statusCode).toBe(400);
    expect((await a.chef.post(url(axeId), KPI)).statusCode).toBe(404);
    expect((await a.chef.post(url(crypto.randomUUID()), KPI)).statusCode).toBe(404);
  });

  it("objectif retiré : 409, il reste listé avec ses KPI", async () => {
    attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/elements/${objectifId}/versions`, {
        donnees: {
          titre: "Fidéliser les clients",
          perspective: "clients",
          indicateur: "Taux de satisfaction",
          cible: "90 %",
        },
        retire: true,
      }),
    );
    const r = await a.chef.post(url(), KPI);
    expect(r.statusCode).toBe(409);
    const l = attendu(200, await a.chef.get(`/api/plans/${planId}/kpi`));
    expect(l.objectifs[0]).toMatchObject({ id: objectifId, retire: true });
    expect(l.objectifs[0].kpis).toHaveLength(2);
  });
});

describe("garanties en base du rattachement", () => {
  it("ajout seul : ni modification ni suppression", async () => {
    for (const sql of [
      "UPDATE plan_objectif_kpis SET objectif_version = 2",
      "DELETE FROM plan_objectif_kpis",
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/);
    }
    await proprietaire(async (c) => {
      await expect(c.query("DELETE FROM plan_objectif_kpis")).rejects.toMatchObject({
        code: "MPS01",
      });
    });
  });

  it("rattachement incohérent (élément qui n'est pas un objectif) : MPS02", async () => {
    const kpi = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/kpi`, { ...KPI, libelle: "Hors plan" }),
    );
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO plan_objectif_kpis (cabinet_id, plan_id, objectif_id, kpi_id, objectif_version,
             cree_par) VALUES ($1, $2, $3, $4, 1, $5)`,
          [a.cabinetId, planId, axeId, kpi.id, a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPS02" });
  });
});
