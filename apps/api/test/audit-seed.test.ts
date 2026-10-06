import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailDemo, MOT_DE_PASSE_DEMO, seed } from "../src/db/seed.js";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet Audit A");
  b = await cabinetTest(ctx, "Cabinet Audit B");
});
afterAll(() => ctx.fermer());

describe("journal d'audit (SOC-06)", () => {
  it("toute écriture des référentiels est journalisée avec son auteur", async () => {
    const client = (await a.associe.post("/api/clients", { raison_sociale: "Audité" })).json();
    await a.associe.patch(`/api/clients/${client.id}`, { secteur: "Mines" });
    const r = await a.associe.get(`/api/audit?entite=client&entite_id=${client.id}`);
    expect(r.statusCode).toBe(200);
    const entrees = r.json().elements;
    expect(entrees.map((e: { action: string }) => e.action)).toEqual(["modification", "creation"]);
    expect(entrees[0]).toMatchObject({
      utilisateur_id: a.associeId,
      utilisateur_nom: "Associé Test",
      details: { avant: { secteur: null }, apres: { secteur: "Mines" } },
    });
  });

  it("filtre par action, utilisateur et dates ; pagine du plus récent au plus ancien", async () => {
    for (let i = 0; i < 3; i++)
      await a.associe.post("/api/clients", { raison_sociale: `Page ${i}` });
    const p1 = await a.associe.get("/api/audit?action=creation&entite=client&limite=2");
    expect(p1.json().elements).toHaveLength(2);
    const p2 = await a.associe.get(
      `/api/audit?action=creation&entite=client&limite=2&curseur=${p1.json().curseur_suivant}`,
    );
    expect(Number(p2.json().elements[0].id)).toBeLessThan(Number(p1.json().elements[1].id));
    const parAuteur = await a.associe.get(`/api/audit?utilisateur_id=${a.associeId}&limite=200`);
    expect(
      parAuteur
        .json()
        .elements.every((e: { utilisateur_id: string }) => e.utilisateur_id === a.associeId),
    ).toBe(true);
    const futur = await a.associe.get("/api/audit?du=2999-01-01");
    expect(futur.json().elements).toEqual([]);
    expect((await a.associe.get("/api/audit?du=hier")).statusCode).toBe(400);
  });

  it("réservé à audit.lire", async () => {
    for (const role of ["gestionnaire", "directeur_mission", "consultant"] as const) {
      expect((await (await a.avecRoles([role])).get("/api/audit")).statusCode).toBe(403);
    }
    expect((await api(ctx).get("/api/audit")).statusCode).toBe(401);
  });

  it("isolation : un cabinet ne voit pas le journal d'un autre", async () => {
    await a.associe.post("/api/clients", { raison_sociale: "Confidentiel A" });
    const r = await b.associe.get("/api/audit?limite=200");
    expect(r.body).not.toMatch(/Confidentiel A/);
  });

  it("aucun secret dans le journal (jeton, mot de passe, hachage)", async () => {
    await a.associe.post("/api/invitations", {
      email: `secret-${Date.now()}@exemple.test`,
      roles: ["consultant"],
    });
    const r = await a.associe.get("/api/audit?limite=200");
    expect(r.body).not.toMatch(/jeton|mot_de_passe|scrypt\$/);
  });
});

describe("seed de démonstration", () => {
  const compter = (cabinetId: string) =>
    proprietaire(async (c) => {
      const r = await c.query(
        `SELECT (SELECT count(*) FROM utilisateurs WHERE cabinet_id = $1)::int AS utilisateurs,
                (SELECT count(*) FROM clients WHERE cabinet_id = $1)::int AS clients,
                (SELECT count(*) FROM collaborateurs WHERE cabinet_id = $1)::int AS collaborateurs,
                (SELECT count(*) FROM collaborateur_couts WHERE cabinet_id = $1)::int AS couts,
                (SELECT count(*) FROM types_mission WHERE cabinet_id = $1)::int AS types,
                (SELECT count(*) FROM modele_elements WHERE cabinet_id = $1)::int AS elements,
                (SELECT count(*) FROM grades WHERE cabinet_id = $1)::int AS grades`,
        [cabinetId],
      );
      return r.rows[0];
    });

  it("crée le Cabinet Démo avec un utilisateur par rôle, et reste idempotent", async () => {
    const id1 = await seed(ctx.db, { NODE_ENV: "test" });
    const avant = await compter(id1);
    expect(avant).toMatchObject({
      utilisateurs: 8,
      clients: 4,
      collaborateurs: 6,
      types: 4,
      grades: 6,
    });
    const id2 = await seed(ctx.db, { NODE_ENV: "test" });
    expect(id2).toBe(id1);
    expect(await compter(id1)).toEqual(avant);

    const r = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/connexion",
      payload: { email: emailDemo("gestionnaire"), mot_de_passe: MOT_DE_PASSE_DEMO },
    });
    expect(r.statusCode).toBe(200);
  });

  it("refuse de s'exécuter hors développement et test (production, recette)", async () => {
    await expect(seed(ctx.db, { NODE_ENV: "production" })).rejects.toThrow(
      /développement ou en test/,
    );
    await expect(seed(ctx.db, { NODE_ENV: "staging" })).rejects.toThrow(/développement ou en test/);
  });
});
