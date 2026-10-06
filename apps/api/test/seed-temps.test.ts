import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailDemo, MOT_DE_PASSE_DEMO, seed } from "../src/db/seed.js";
import { api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;

beforeAll(async () => {
  ctx = await demarrer();
});
afterAll(() => ctx.fermer());

describe("seed : temps de démonstration", () => {
  it("reproduit l'exemple chiffré du PRD sur des feuilles validées, sans doublon au second passage", async () => {
    const cabinetId = await seed(ctx.db, { NODE_ENV: "test" });
    const compter = () =>
      ctx.db.withTenant(cabinetId, async (db) => ({
        feuilles: (
          await db.query("SELECT count(*)::int AS n FROM feuilles_temps WHERE statut = 'validee'")
        ).rows[0].n,
        restes: (await db.query("SELECT count(*)::int AS n FROM reste_a_faire")).rows[0].n,
      }));
    const premier = await compter();
    expect(premier.feuilles).toBeGreaterThanOrEqual(10);
    await seed(ctx.db, { NODE_ENV: "test" });
    expect(await compter()).toEqual(premier);

    const connexion = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/connexion",
      payload: { email: emailDemo("directeur_mission"), mot_de_passe: MOT_DE_PASSE_DEMO },
    });
    const cookie = connexion.cookies[0] as { name: string; value: string };
    const directeur = api(ctx, `${cookie.name}=${cookie.value}`);
    const missions = (await directeur.get("/api/missions?q=Audit")).json().elements as {
      id: string;
      intitule: string;
    }[];
    const audit = missions.find((x) => x.intitule.startsWith("Audit organisationnel")) as {
      id: string;
    };
    const suivi = (await directeur.get(`/api/missions/${audit.id}/suivi`)).json();
    expect(suivi.arbre).toMatchObject({
      budget: 50,
      realise: 26.5,
      reste_a_faire: 26,
      atterrissage: 52.5,
      ecart: 2.5,
    });
    expect(suivi.alertes.length).toBeGreaterThan(0);
  });
});
