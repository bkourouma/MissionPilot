import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { creerLimiteur } from "../src/auth/limiteur.js";
import {
  FENETRE_BRIEF_MINUTES,
  REQUETES_BRIEF_PAR_FENETRE,
  verifierDebitBrief,
} from "../src/brief/debit.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import { configTest, connecter, demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Plafond de débit du brief : compteur en base (limiteur, espace `brief_requetes`, migration 0550),
 * partagé entre instances, une clé par utilisateur.
 */

let ctx: Contexte;
let ctx2: Contexte; // seconde « instance » de l'application, même base
let autreBase: Database;
let a: CabinetTest;
let b: CabinetTest;
const trousseau = trousseauDepuisConfig(configTest());

beforeAll(async () => {
  ctx = await demarrer();
  ctx2 = await demarrer();
  autreBase = createDatabase(configTest());
  a = await cabinetTest(ctx, "Cabinet Débit A");
  b = await cabinetTest(ctx, "Cabinet Débit B");
});
afterAll(async () => {
  await autreBase.close();
  await ctx2.fermer();
  await ctx.fermer();
});

describe("règle du brief en base", () => {
  it("les constantes du code reprennent la règle de la base (60 par 10 minutes)", async () => {
    const r = await proprietaire((c) =>
      c.query(
        `SELECT p_max, extract(epoch FROM p_fenetre)::int AS fenetre_s, p_capacite
         FROM tentatives_auth_regles('brief_requetes')`,
      ),
    );
    expect(r.rows[0]).toEqual({
      p_max: REQUETES_BRIEF_PAR_FENETRE,
      fenetre_s: FENETRE_BRIEF_MINUTES * 60,
      p_capacite: 100_000,
    });
  });
});

describe("verifierDebitBrief", () => {
  it("plafond atteint : 429 TROP_DE_REQUETES_BRIEF, partagé entre deux pools (instances)", async () => {
    const id = randomUUID();
    for (let i = 0; i < REQUETES_BRIEF_PAR_FENETRE; i++) {
      await verifierDebitBrief(i % 2 === 0 ? ctx.db : autreBase, trousseau, id);
    }
    for (const base of [ctx.db, autreBase]) {
      await expect(verifierDebitBrief(base, trousseau, id)).rejects.toMatchObject({
        statut: 429,
        code: "TROP_DE_REQUETES_BRIEF",
        message: expect.stringMatching(/consultations du brief/) as unknown,
      });
    }
  });

  it("isolation : la clé est l'utilisateur, un autre utilisateur n'est pas touché", async () => {
    const x = randomUUID();
    const y = randomUUID();
    for (let i = 0; i < REQUETES_BRIEF_PAR_FENETRE; i++)
      await verifierDebitBrief(ctx.db, trousseau, x);
    await expect(verifierDebitBrief(ctx.db, trousseau, x)).rejects.toMatchObject({
      statut: 429,
    });
    await expect(verifierDebitBrief(ctx.db, trousseau, y)).resolves.toBeUndefined();
  });

  it("aucun identifiant d'utilisateur en clair en base (empreinte HMAC)", async () => {
    const id = randomUUID();
    await verifierDebitBrief(ctx.db, trousseau, id);
    const r = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM tentatives_auth WHERE cle = $1", [id]),
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("fenêtre glissante : un appel sort de la fenêtre après FENETRE_BRIEF_MINUTES minutes", async () => {
    const limiteur = creerLimiteur(ctx.db, "brief_requetes", trousseau);
    const id = randomUUID();
    const t0 = Date.UTC(2026, 9, 12, 8, 0, 0);
    const reserverA = (t: number) =>
      ctx.db.withoutTenant(async (db) => {
        await db.query("SELECT set_config('app.horloge_test', $1, true)", [
          new Date(t).toISOString(),
        ]);
        return limiteur.reserver(id, db);
      });
    for (let i = 0; i < REQUETES_BRIEF_PAR_FENETRE; i++) expect(await reserverA(t0 + i)).toBe(true);
    expect(await reserverA(t0 + 1_000)).toBe(false);
    // Dix minutes plus tard, la fenêtre a glissé au-delà des premiers appels.
    expect(await reserverA(t0 + FENETRE_BRIEF_MINUTES * 60_000 + REQUETES_BRIEF_PAR_FENETRE)).toBe(
      true,
    );
  });
});

describe("GET /api/brief : plafond partagé entre deux instances", () => {
  it("deux applications sur la même base partagent le compteur d'un utilisateur ; l'autre cabinet n'est pas touché", async () => {
    const u = await a.avecRoles(["expert_externe"]);
    // Même utilisateur, deux instances : la moitié des appels sur chacune.
    const sur2 = api(ctx2, await connecter(ctx2, await emailDe(u.utilisateurId)));
    for (let i = 0; i < REQUETES_BRIEF_PAR_FENETRE; i++) {
      const r = await (i % 2 === 0 ? u : sur2).get("/api/brief");
      expect(r.statusCode, `appel ${i + 1} : ${r.body}`).toBe(200);
    }
    for (const client of [u, sur2]) {
      const refuse = await client.get("/api/brief");
      expect(refuse.statusCode).toBe(429);
      expect(refuse.json().erreur.code).toBe("TROP_DE_REQUETES_BRIEF");
    }
    // Un utilisateur d'un autre cabinet n'est pas affecté.
    const v = await b.avecRoles(["expert_externe"]);
    expect((await v.get("/api/brief")).statusCode).toBe(200);
  }, 120_000);
});

async function emailDe(utilisateurId: string): Promise<string> {
  const r = await proprietaire((c) =>
    c.query("SELECT email FROM utilisateurs WHERE id = $1", [utilisateurId]),
  );
  return r.rows[0].email as string;
}
