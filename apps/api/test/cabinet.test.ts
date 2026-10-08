import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cabinetTest, type CabinetTest } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet Paramètres A");
  b = await cabinetTest(ctx, "Cabinet Paramètres B");
});
afterAll(() => ctx.fermer());

describe("paramètres du cabinet (SOC-04)", () => {
  it("lit les paramètres par défaut", async () => {
    const r = await a.associe.get("/api/cabinet");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      id: a.cabinetId,
      pays: "CI",
      devise_base: "XOF",
      unite_saisie_temps: "demi_journee",
      heures_par_jour: 8,
      jours_travailles: [1, 2, 3, 4, 5],
    });
  });

  it("modifie les paramètres et journalise avant/après", async () => {
    const r = await a.associe.patch("/api/cabinet", {
      unite_saisie_temps: "heure",
      heures_par_jour: 7.5,
      jours_travailles: [6, 1, 2, 3, 4, 5],
      pays: "sn",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      unite_saisie_temps: "heure",
      heures_par_jour: 7.5,
      jours_travailles: [1, 2, 3, 4, 5, 6],
      pays: "SN",
    });
    const audit = await a.associe.get("/api/audit?entite=cabinet");
    expect(audit.json().elements[0].details).toMatchObject({
      avant: { heures_par_jour: 8 },
      apres: { heures_par_jour: 7.5 },
    });
  });

  it("valide les entrées", async () => {
    for (const corps of [
      { unite_saisie_temps: "minute" },
      { heures_par_jour: 30 },
      { jours_travailles: [0, 8] },
      { devise_base: "GNF" },
      { pays: "CIV" },
      {},
      { id: b.cabinetId },
    ]) {
      expect((await a.associe.patch("/api/cabinet", corps)).statusCode).toBe(400);
    }
  });

  it("lecture pour tout utilisateur connecté, écriture réservée à cabinet.gerer", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get("/api/cabinet")).statusCode).toBe(200);
    expect((await consultant.patch("/api/cabinet", { nom: "Piraté" })).statusCode).toBe(403);
    expect(
      (await consultant.post("/api/cabinet/feries", { date: "2026-12-25", libelle: "Noël" }))
        .statusCode,
    ).toBe(403);
  });

  it("chaque cabinet ne lit et ne modifie que sa propre fiche", async () => {
    await b.associe.patch("/api/cabinet", { nom: "Nom B modifié" });
    const vueA = await a.associe.get("/api/cabinet");
    expect(vueA.json().nom).not.toBe("Nom B modifié");
    expect((await b.associe.get("/api/cabinet")).json().id).toBe(b.cabinetId);
  });
});

describe("jours fériés (SOC-04)", () => {
  it("crée, liste par année, refuse un doublon, supprime", async () => {
    const r = await a.associe.post("/api/cabinet/feries", {
      date: "2026-08-07",
      libelle: "Fête de l'Indépendance",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ date: "2026-08-07", nationale: true });
    expect(
      (await a.associe.post("/api/cabinet/feries", { date: "2026-08-07", libelle: "Doublon" }))
        .statusCode,
    ).toBe(409);
    await a.associe.post("/api/cabinet/feries", { date: "2027-01-01", libelle: "Jour de l'An" });
    const liste = await a.associe.get("/api/cabinet/feries?annee=2026");
    expect(liste.json().elements.map((f: { date: string }) => f.date)).toEqual(["2026-08-07"]);
    expect((await a.associe.delete(`/api/cabinet/feries/${r.json().id}`)).statusCode).toBe(204);
    expect((await a.associe.delete(`/api/cabinet/feries/${r.json().id}`)).statusCode).toBe(404);
  });

  it("valide la date", async () => {
    expect(
      (await a.associe.post("/api/cabinet/feries", { date: "2026-02-30", libelle: "X" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await a.associe.post("/api/cabinet/feries", { date: "07/08/2026", libelle: "X" }))
        .statusCode,
    ).toBe(400);
  });

  it("isolation : un autre cabinet ne voit ni ne supprime les fériés (404)", async () => {
    const r = await a.associe.post("/api/cabinet/feries", {
      date: "2026-05-01",
      libelle: "Fête du Travail",
    });
    expect((await b.associe.delete(`/api/cabinet/feries/${r.json().id}`)).statusCode).toBe(404);
    const vueB = await b.associe.get("/api/cabinet/feries");
    expect(vueB.json().elements).toEqual([]);
  });
});
