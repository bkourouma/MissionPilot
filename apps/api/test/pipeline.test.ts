import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agregerPipeline } from "../src/routes/opportunites.js";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Pipeline A");
  b = await preparerCabinet(ctx, "Cabinet Pipeline B");
});
afterAll(() => ctx.fermer());

const opportunite = (c: CabinetMissions, corps: Record<string, unknown> = {}) =>
  c.chef.post("/api/opportunites", {
    client_id: c.clientId,
    intitule: "Plan stratégique Kora",
    type_mission_id: c.typePlanId,
    montant_estime: 30_000_000,
    probabilite: 40,
    date_cloture_prevue: "2026-12-15",
    ...corps,
  });

describe("opportunités (MIS-04)", () => {
  it("crée, lit, modifie, change d'étape", async () => {
    const r = await opportunite(a);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      statut: "ouverte",
      etape: "prospection",
      devise: "XOF",
      montant_estime: 30_000_000,
      probabilite: 40,
      cree_par: a.chef.utilisateurId,
    });
    const id = r.json().id;
    const m = await a.chef.patch(`/api/opportunites/${id}`, {
      probabilite: 60,
      responsable_id: a.directeur.utilisateurId,
    });
    expect(m.json()).toMatchObject({ probabilite: 60, responsable_id: a.directeur.utilisateurId });
    const e = await a.chef.post(`/api/opportunites/${id}/etape`, { etape: "negociation" });
    expect(e.json().etape).toBe("negociation");
    expect((await a.chef.get(`/api/opportunites/${id}`)).json().etape).toBe("negociation");
    const liste = (await a.chef.get("/api/opportunites?statut=ouverte")).json().elements;
    expect(liste.map((o: { id: string }) => o.id)).toContain(id);
  });

  it("valide : probabilité 0-100, montant entier, étape connue, client du cabinet", async () => {
    expect((await opportunite(a, { probabilite: 150 })).statusCode).toBe(400);
    expect((await opportunite(a, { montant_estime: 10.5 })).statusCode).toBe(400);
    expect((await opportunite(a, { etape: "signature" })).statusCode).toBe(400);
    expect((await opportunite(a, { client_id: b.clientId })).statusCode).toBe(400);
    expect((await opportunite(a, { type_mission_id: b.typePlanId })).statusCode).toBe(400);
    expect((await opportunite(a, { responsable_id: b.chef.utilisateurId })).statusCode).toBe(400);
  });

  it("perdue : motif obligatoire ; close : plus de modification", async () => {
    const id = (await opportunite(a)).json().id;
    const issue = (corps: unknown) => a.chef.post(`/api/opportunites/${id}/issue`, corps);
    expect((await issue({ statut: "perdue" })).statusCode).toBe(400);
    expect((await issue({ statut: "perdue", motif_perte: "  " })).statusCode).toBe(400);
    const p = await issue({ statut: "perdue", motif_perte: "Prix jugé trop élevé" });
    expect(p.json()).toMatchObject({ statut: "perdue", motif_perte: "Prix jugé trop élevé" });
    expect((await issue({ statut: "gagnee" })).statusCode).toBe(409);
    expect((await a.chef.patch(`/api/opportunites/${id}`, { probabilite: 10 })).statusCode).toBe(
      409,
    );
    expect(
      (await a.chef.post(`/api/opportunites/${id}/etape`, { etape: "qualification" })).statusCode,
    ).toBe(409);
  });

  it("gagnée : probabilité 100 ; suppression d'une opportunité sans proposition", async () => {
    const g = (await opportunite(a)).json().id;
    const r = await a.chef.post(`/api/opportunites/${g}/issue`, { statut: "gagnee" });
    expect(r.json()).toMatchObject({ statut: "gagnee", probabilite: 100, motif_perte: null });
    const s = (await opportunite(a)).json().id;
    expect((await a.chef.delete(`/api/opportunites/${s}`)).statusCode).toBe(204);
    expect((await a.chef.get(`/api/opportunites/${s}`)).statusCode).toBe(404);
  });

  it("droits : pipeline.gerer (associé, directeur, chef) ; les autres 403", async () => {
    for (const role of [
      "consultant",
      "ressources",
      "gestionnaire",
      "expert_metier",
      "expert_externe",
    ] as const) {
      const u = await a.avecRoles([role]);
      expect((await u.get("/api/opportunites")).statusCode, role).toBe(403);
      expect((await u.get("/api/opportunites/pipeline")).statusCode, role).toBe(403);
    }
    for (const role of ["associe", "directeur_mission", "chef_mission"] as const) {
      const u = await a.avecRoles([role]);
      expect((await u.get("/api/opportunites/pipeline")).statusCode, role).toBe(200);
    }
  });

  it("isolation : une opportunité d'un autre cabinet répond 404", async () => {
    const id = (await opportunite(b)).json().id;
    for (const r of [
      await a.associe.get(`/api/opportunites/${id}`),
      await a.associe.patch(`/api/opportunites/${id}`, { probabilite: 1 }),
      await a.associe.post(`/api/opportunites/${id}/etape`, { etape: "qualification" }),
      await a.associe.post(`/api/opportunites/${id}/issue`, { statut: "gagnee" }),
      await a.associe.delete(`/api/opportunites/${id}`),
      await a.associe.get(`/api/opportunites/${id}/propositions`),
      await a.associe.post(`/api/opportunites/${id}/propositions`, {}),
    ]) {
      expect(r.statusCode).toBe(404);
    }
    const liste = (await a.associe.get("/api/opportunites")).json().elements;
    expect(liste.map((o: { id: string }) => o.id)).not.toContain(id);
  });
});

describe("agrégat pondéré du pipeline (MIS-04)", () => {
  it("par étape et devise, montant pondéré par la probabilité (moteur finance)", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Pipeline Agrégat");
    await opportunite(c, { montant_estime: 10_000_000, probabilite: 50 });
    await opportunite(c, { montant_estime: 3_000_001, probabilite: 50, etape: "proposition" });
    await opportunite(c, { montant_estime: 20_000, devise: "EUR", probabilite: 25 });
    const perdue = (await opportunite(c)).json().id;
    await c.chef.post(`/api/opportunites/${perdue}/issue`, { statut: "perdue", motif_perte: "X" });
    const p = (await c.chef.get("/api/opportunites/pipeline")).json();
    expect(p.par_etape).toEqual([
      {
        etape: "prospection",
        devise: "EUR",
        nombre: 1,
        montant_estime: 20_000,
        montant_pondere: 5_000,
      },
      {
        etape: "prospection",
        devise: "XOF",
        nombre: 1,
        montant_estime: 10_000_000,
        montant_pondere: 5_000_000,
      },
      {
        etape: "proposition",
        devise: "XOF",
        nombre: 1,
        montant_estime: 3_000_001,
        // 1 500 000,5 arrondi au plus proche, demi loin de zéro.
        montant_pondere: 1_500_001,
      },
    ]);
    expect(p.totaux).toEqual([
      { devise: "EUR", nombre: 1, montant_estime: 20_000, montant_pondere: 5_000 },
      { devise: "XOF", nombre: 2, montant_estime: 13_000_001, montant_pondere: 6_500_001 },
    ]);
    expect(p).toMatchObject({ gagnees: 0, perdues: 1 });
  });

  it("pipeline vide", () => {
    expect(agregerPipeline([])).toEqual({ par_etape: [], totaux: [] });
  });
});
