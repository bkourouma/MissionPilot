import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/db/seed.js";
import { situationFacture } from "../src/finance/paiements.js";
import { aujourdhui } from "../src/missions/outils.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;

beforeAll(async () => {
  ctx = await demarrer();
});
afterAll(() => ctx.fermer());

describe("seed : finance de démonstration", () => {
  it("encaissements partiels et une facture en retard, sans doublon au second passage", async () => {
    const cabinetId = await seed(ctx.db, { NODE_ENV: "test" });
    const etat = () =>
      ctx.db.withTenant(cabinetId, async (db) => {
        const e = await db.query("SELECT mode, reference FROM encaissements ORDER BY reference");
        const f = await db.query(
          "SELECT id FROM factures WHERE statut = 'emise' AND nature = 'facture' ORDER BY date_emission",
        );
        const situations = [];
        for (const r of f.rows) {
          situations.push(
            (await situationFacture(db, r.id, aujourdhui()))?.situation.statut_paiement,
          );
        }
        return { encaissements: e.rows, situations };
      });
    const premier = await etat();
    expect(premier.encaissements).toEqual([
      { mode: "mobile_money", reference: "DEMO-OM-0001" },
      { mode: "virement", reference: "DEMO-VIR-0001" },
    ]);
    expect(premier.situations).toEqual(["en_retard", "partiellement_payee"]);
    await seed(ctx.db, { NODE_ENV: "test" });
    expect(await etat()).toEqual(premier);
  });
});
