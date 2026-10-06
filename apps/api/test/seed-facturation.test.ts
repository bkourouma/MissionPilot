import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/db/seed.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;

beforeAll(async () => {
  ctx = await demarrer();
});
afterAll(() => ctx.fermer());

describe("seed : facturation de démonstration", () => {
  it("échéancier, débours validé et facture émise, sans doublon au second passage", async () => {
    const cabinetId = await seed(ctx.db, { NODE_ENV: "test" });
    const compter = () =>
      ctx.db.withTenant(cabinetId, async (db) => ({
        echeances: (await db.query("SELECT count(*)::int AS n FROM echeances_facturation")).rows[0]
          .n,
        debours: (await db.query("SELECT count(*)::int AS n FROM debours WHERE statut = 'valide'"))
          .rows[0].n,
        emises: (
          await db.query(
            "SELECT count(*)::int AS n FROM factures WHERE statut = 'emise' AND numero IS NOT NULL",
          )
        ).rows[0].n,
        facturees: (
          await db.query(
            "SELECT count(*)::int AS n FROM echeances_facturation WHERE statut = 'facturee'",
          )
        ).rows[0].n,
      }));
    const premier = await compter();
    expect(premier).toMatchObject({ echeances: 2, debours: 1, emises: 1, facturees: 1 });
    await seed(ctx.db, { NODE_ENV: "test" });
    expect(await compter()).toEqual(premier);
  });
});
