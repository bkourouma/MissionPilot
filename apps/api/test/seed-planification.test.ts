import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/db/seed.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;

beforeAll(async () => {
  ctx = await demarrer();
});
afterAll(() => ctx.fermer());

describe("seed : planification de démonstration", () => {
  it("crée affectations (dont un profil à pourvoir) et absences, sans doublon au second passage", async () => {
    const compter = (cabinetId: string) =>
      ctx.db.withTenant(cabinetId, async (db) => {
        const n = async (sql: string) => (await db.query(sql)).rows[0].n as number;
        return {
          nominatives: await n(
            "SELECT count(*)::int AS n FROM affectations WHERE collaborateur_id IS NOT NULL",
          ),
          aPourvoir: await n(
            "SELECT count(*)::int AS n FROM affectations WHERE collaborateur_id IS NULL",
          ),
          validees: await n("SELECT count(*)::int AS n FROM absences WHERE statut = 'validee'"),
          demandees: await n("SELECT count(*)::int AS n FROM absences WHERE statut = 'demandee'"),
        };
      });
    const cabinetId = await seed(ctx.db, { NODE_ENV: "test" });
    const premier = await compter(cabinetId);
    expect(premier).toMatchObject({ validees: 1, demandees: 1 });
    expect(premier.nominatives).toBeGreaterThanOrEqual(2);
    expect(premier.aPourvoir).toBe(1);
    await seed(ctx.db, { NODE_ENV: "test" });
    expect(await compter(cabinetId)).toEqual(premier);
  });
});
