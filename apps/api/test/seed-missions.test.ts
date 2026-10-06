import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/db/seed.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;

beforeAll(async () => {
  ctx = await demarrer();
});
afterAll(() => ctx.fermer());

describe("seed : cycle commercial et missions de démonstration", () => {
  it("crée des opportunités et une mission signée au budget figé, sans doublon au second passage", async () => {
    const compter = (cabinetId: string) =>
      ctx.db.withTenant(cabinetId, async (db) => {
        const n = async (sql: string) => (await db.query(sql)).rows[0].n as number;
        return {
          opportunites: await n("SELECT count(*)::int AS n FROM opportunites"),
          perdues: await n("SELECT count(*)::int AS n FROM opportunites WHERE statut = 'perdue'"),
          missions: await n("SELECT count(*)::int AS n FROM missions WHERE statut = 'signee'"),
          versions: await n("SELECT count(*)::int AS n FROM budget_versions WHERE figee"),
          lignes: await n("SELECT count(*)::int AS n FROM budget_lignes"),
          taches: await n("SELECT count(*)::int AS n FROM mission_taches"),
        };
      });
    const cabinetId = await seed(ctx.db, { NODE_ENV: "test" });
    const premier = await compter(cabinetId);
    expect(premier).toMatchObject({ opportunites: 3, perdues: 1, missions: 1, versions: 1 });
    expect(premier.lignes).toBeGreaterThan(0);
    expect(premier.taches).toBeGreaterThan(0);
    await seed(ctx.db, { NODE_ENV: "test" });
    expect(await compter(cabinetId)).toEqual(premier);
  });
});
