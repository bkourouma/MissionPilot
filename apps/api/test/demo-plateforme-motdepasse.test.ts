import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import { configTest, proprietaire } from "./helpers.js";
import { creerSuperAdmin, MOT_DE_PASSE_PLATEFORME } from "./plateforme-outils.js";

/*
 * Un super admin de démonstration a un mot de passe PUBLIC : POST /api/plateforme/connexion le
 * refuse (401 IDENTIFIANTS_INVALIDES uniforme) tant que la démonstration n'est pas active
 * (connexion rapide locale ou DEMO_PUBLIQUE=oui), et l'accepte quand elle l'est. Un super
 * admin réel n'est jamais concerné.
 */

interface Instance {
  app: FastifyInstance;
  db: Database;
}
async function instance(surcharge: Partial<Config>): Promise<Instance> {
  const config = { ...configTest(), ...surcharge };
  const db = createDatabase(config);
  return { app: await buildApp(config, db), db };
}

let ferme: Instance;
let ouvert: Instance;
const crees: string[] = [];
const suf = randomBytes(3).toString("hex");

async function superAdmin(prefixe: string, demo: boolean) {
  const sa = await creerSuperAdmin({ email: `${prefixe}-${suf}@demo-mdp.test` });
  if (demo)
    await proprietaire((c) =>
      c.query("UPDATE super_admins SET est_demo = true WHERE id = $1", [sa.id]),
    );
  crees.push(sa.id);
  return sa;
}

const connexion = (i: Instance, email: string, motDePasse: string) =>
  i.app.inject({
    method: "POST",
    url: "/api/plateforme/connexion",
    payload: { email, motDePasse },
  });

beforeAll(async () => {
  ferme = await instance({ CONNEXION_RAPIDE_DEMO: "non", DEMO_PUBLIQUE: "non" });
  ouvert = await instance({ CONNEXION_RAPIDE_DEMO: "non", DEMO_PUBLIQUE: "oui" });
});

afterAll(async () => {
  await proprietaire((c) =>
    c.query("UPDATE super_admins SET est_demo = false, actif = false WHERE id = ANY ($1)", [crees]),
  );
  for (const i of [ferme, ouvert]) {
    await i.app.close();
    await i.db.close();
  }
});

describe("mot de passe d'un super admin de démonstration", () => {
  it("démo inactive : refusé, 401 IDENTIFIANTS_INVALIDES identique à un mauvais mot de passe", async () => {
    const demo = await superAdmin("demo-ferme", true);
    const refus = await connexion(ferme, demo.email, MOT_DE_PASSE_PLATEFORME);
    expect(refus.statusCode).toBe(401);
    expect(refus.json().erreur.code).toBe("IDENTIFIANTS_INVALIDES");
    expect(refus.headers["set-cookie"]).toBeUndefined();
    const faux = await connexion(ferme, demo.email, "Mauvais-motdepasse-1");
    expect(faux.statusCode).toBe(401);
    expect(faux.json()).toEqual(refus.json());
  });

  it("démo active (DEMO_PUBLIQUE=oui) : accepté", async () => {
    const demo = await superAdmin("demo-ouvert", true);
    const r = await connexion(ouvert, demo.email, MOT_DE_PASSE_PLATEFORME);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, superAdmin: { email: demo.email } });
    expect(String(r.headers["set-cookie"])).toContain("mp_plateforme=");
  });

  it("super admin réel : accepté démo inactive comme active", async () => {
    const reel = await superAdmin("reel", false);
    expect((await connexion(ferme, reel.email, MOT_DE_PASSE_PLATEFORME)).statusCode).toBe(200);
    expect((await connexion(ouvert, reel.email, MOT_DE_PASSE_PLATEFORME)).statusCode).toBe(200);
  });
});
