import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee } from "./missions-outils.js";
import { attendre, preparerQualite, type ScenarioQualite } from "./qualite-outils.js";

/*
 * Satisfaction du client (QUA-08) : note de 0 à 10 par jalon et à la clôture, correction par
 * nouvelle ligne, NPS par mission, agrégat du cabinet réservé à l'associé.
 */

let ctx: Contexte;
let s: ScenarioQualite;
let jalonId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQualite(ctx, "Cabinet Satisfaction");
  const j = await s.c.chef.post(`/api/missions/${s.missionId}/jalons`, {
    libelle: "Diagnostic remis",
  });
  attendre(201, j, "jalon");
  jalonId = j.json().id;
});
afterAll(async () => {
  await ctx.fermer();
});

const url = () => `/api/qualite/missions/${s.missionId}/satisfactions`;

describe("saisie et lecture", () => {
  it("exige une session et qualite.relire", async () => {
    const corps = { moment: "jalon", jalon_id: jalonId, note: 9 };
    expect((await api(ctx).post(url(), corps)).statusCode).toBe(401);
    expect((await s.consultant.post(url(), corps)).statusCode).toBe(403);
    expect((await s.etranger.post(url(), corps)).statusCode).toBe(404);
    expect((await s.consultant.get(url())).statusCode).toBe(403);
  });

  it("enregistre la note d'un jalon et calcule le NPS", async () => {
    const r = await s.c.chef.post(url(), {
      moment: "jalon",
      jalon_id: jalonId,
      note: 9,
      repondant: "DG du client",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().notes).toHaveLength(1);
    expect(r.json().notes[0]).toMatchObject({
      note: 9,
      rang: 1,
      jalon_libelle: "Diagnostic remis",
    });
    expect(r.json().synthese).toMatchObject({ total: 1, promoteurs: 1, nps: "100.0" });
  });

  it("une correction est une nouvelle ligne : la dernière fait foi, l'historique reste", async () => {
    const r = await s.c.chef.post(url(), {
      moment: "jalon",
      jalon_id: jalonId,
      note: 3,
      commentaire: "Délais",
    });
    expect(r.json().notes).toHaveLength(1);
    expect(r.json().notes[0]).toMatchObject({ note: 3, rang: 2 });
    expect(r.json().synthese).toMatchObject({ detracteurs: 1, nps: "-100.0" });
    const lignes = await proprietaire((db) =>
      db.query("SELECT count(*)::int AS n FROM qualite_satisfactions WHERE mission_id = $1", [
        s.missionId,
      ]),
    );
    expect(lignes.rows[0].n).toBe(2);
    await expect(
      proprietaire((db) =>
        db.query("UPDATE qualite_satisfactions SET note = 10 WHERE mission_id = $1", [s.missionId]),
      ),
    ).rejects.toMatchObject({ code: "MPY01" });
  });

  it("refuse une note hors 0-10, un jalon manquant ou d'une autre mission", async () => {
    expect(
      (await s.c.chef.post(url(), { moment: "jalon", jalon_id: jalonId, note: 11 })).statusCode,
    ).toBe(400);
    expect((await s.c.chef.post(url(), { moment: "jalon", note: 5 })).statusCode).toBe(400);
    expect(
      (await s.c.chef.post(url(), { moment: "cloture", jalon_id: jalonId, note: 5 })).statusCode,
    ).toBe(400);
    const autre = await creerMission(s.c);
    const j2 = await s.c.chef.post(`/api/missions/${autre.id}/jalons`, { libelle: "Autre" });
    const r = await s.c.chef.post(url(), { moment: "jalon", jalon_id: j2.json().id, note: 5 });
    expect(r.statusCode).toBe(400);
  });

  it("la satisfaction de clôture attend la clôture de la mission", async () => {
    const tot = await s.c.chef.post(url(), { moment: "cloture", note: 10 });
    expect(tot.statusCode).toBe(409);
    expect(tot.json().erreur.code).toBe("CLOTURE_NON_ATTEINTE");
    const signee = await creerMissionSignee(s.c);
    await proprietaire((db) =>
      db.query("UPDATE missions SET statut = 'a_cloturer' WHERE id = $1", [signee.id]),
    );
    const ok = await s.c.chef.post(`/api/qualite/missions/${signee.id}/satisfactions`, {
      moment: "cloture",
      note: 10,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().notes).toHaveLength(1);
    expect(ok.json().synthese).toMatchObject({ total: 1, promoteurs: 1, nps: "100.0" });
  });
});

describe("agrégat du cabinet (associé seul)", () => {
  it("réserve la synthèse à l'associé", async () => {
    expect((await api(ctx).get("/api/qualite/satisfaction/synthese")).statusCode).toBe(401);
    expect((await s.c.chef.get("/api/qualite/satisfaction/synthese")).statusCode).toBe(403);
    expect((await s.c.directeur.get("/api/qualite/satisfaction/synthese")).statusCode).toBe(403);
    const r = await s.c.associe.get("/api/qualite/satisfaction/synthese");
    expect(r.statusCode).toBe(200);
    expect(r.json().synthese).toMatchObject({
      total: 2,
      promoteurs: 1,
      detracteurs: 1,
      nps: "0.0",
    });
    expect(r.json().missions).toHaveLength(2);
    expect(r.json().tronque).toBe(false);
  });

  it("n'agrège jamais deux cabinets", async () => {
    const autre = await cabinetTest(ctx, "Autre cabinet satisfaction");
    const r = await autre.associe.get("/api/qualite/satisfaction/synthese");
    expect(r.statusCode).toBe(200);
    expect(r.json().synthese.total).toBe(0);
    expect(r.json().synthese.nps).toBeNull();
  });

  it("filtre par date de saisie", async () => {
    const r = await s.c.associe.get("/api/qualite/satisfaction/synthese?depuis=2100-01-01");
    expect(r.json().synthese.total).toBe(0);
    expect(
      (await s.c.associe.get("/api/qualite/satisfaction/synthese?depuis=hier")).statusCode,
    ).toBe(400);
  });
});
