import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ajouterUtilisateur,
  connecter,
  creerCabinet,
  demarrer,
  MOT_DE_PASSE_TEST,
  proprietaire,
  type Contexte,
} from "./helpers.js";

let ctx: Contexte;
let a: Awaited<ReturnType<typeof creerCabinet>>;

beforeAll(async () => {
  ctx = await demarrer();
  a = await creerCabinet(ctx, "Cabinet Auth");
});
afterAll(() => ctx.fermer());

const connexion = (email: string, mot_de_passe: string) =>
  ctx.app.inject({ method: "POST", url: "/api/auth/connexion", payload: { email, mot_de_passe } });

describe("authentification", () => {
  it("/api/auth/moi sans session renvoie 401 avec l'enveloppe d'erreur", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/api/auth/moi" });
    expect(r.statusCode).toBe(401);
    expect(r.json().erreur.code).toBe("NON_AUTHENTIFIE");
  });

  it("connexion valide : cookie httpOnly, session lisible, mot de passe jamais renvoyé", async () => {
    const r = await connexion(a.email, MOT_DE_PASSE_TEST);
    expect(r.statusCode).toBe(200);
    expect(r.cookies[0]?.httpOnly).toBe(true);
    const cookie = `${r.cookies[0]!.name}=${r.cookies[0]!.value}`;
    const moi = await ctx.app.inject({ method: "GET", url: "/api/auth/moi", headers: { cookie } });
    expect(moi.statusCode).toBe(200);
    expect(moi.json().utilisateur.roles).toEqual(["associe"]);
    expect(moi.body).not.toMatch(/hash|mot_de_passe/);
  });

  it("le jeton n'est pas stocké en clair", async () => {
    const cookie = await connecter(ctx, a.email);
    const jeton = cookie.split("=")[1]!;
    const trouve = await proprietaire(
      async (c) =>
        (await c.query("SELECT 1 FROM sessions WHERE jeton_hash = $1", [jeton])).rowCount,
    );
    expect(trouve).toBe(0);
  });

  it("mauvais mot de passe et e-mail inconnu donnent la même réponse", async () => {
    const r1 = await connexion(a.email, "mauvais-mot-de-passe");
    const r2 = await connexion("inconnu@exemple.test", "mauvais-mot-de-passe");
    expect(r1.statusCode).toBe(401);
    expect(r2.statusCode).toBe(401);
    expect(r1.json()).toEqual(r2.json());
  });

  it("déconnexion : la session n'est plus valide", async () => {
    const cookie = await connecter(ctx, a.email);
    await ctx.app.inject({ method: "POST", url: "/api/auth/deconnexion", headers: { cookie } });
    const moi = await ctx.app.inject({ method: "GET", url: "/api/auth/moi", headers: { cookie } });
    expect(moi.statusCode).toBe(401);
  });

  it("un utilisateur désactivé ne peut plus se connecter", async () => {
    const u = await ajouterUtilisateur(ctx, a.cabinetId, ["consultant"]);
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [u.utilisateurId]),
    );
    expect((await connexion(u.email, MOT_DE_PASSE_TEST)).statusCode).toBe(401);
  });

  it("limite les tentatives répétées (429)", async () => {
    const u = await ajouterUtilisateur(ctx, a.cabinetId, ["consultant"]);
    for (let i = 0; i < 10; i++) await connexion(u.email, "faux");
    const r = await connexion(u.email, MOT_DE_PASSE_TEST);
    expect(r.statusCode).toBe(429);
  });

  it("un cookie de session inventé est ignoré", async () => {
    const r = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/moi",
      headers: { cookie: "mp_session=jeton-invente" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("la limite ne se contourne pas en changeant d'adresse IP déclarée (X-Forwarded-For)", async () => {
    const u = await ajouterUtilisateur(ctx, a.cabinetId, ["consultant"]);
    let derniere = 0;
    for (let i = 0; i < 12; i++) {
      const r = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/connexion",
        headers: { "x-forwarded-for": `10.0.0.${i}` },
        payload: { email: u.email, mot_de_passe: "faux" },
      });
      derniere = r.statusCode;
    }
    expect(derniere).toBe(429);
  });

  it("la limite tient face à des requêtes simultanées", async () => {
    const u = await ajouterUtilisateur(ctx, a.cabinetId, ["consultant"]);
    const reponses = await Promise.all(
      Array.from({ length: 30 }, () => connexion(u.email, "faux")),
    );
    const refusees = reponses.filter((r) => r.statusCode === 429).length;
    expect(refusees).toBe(20);
  });
});
