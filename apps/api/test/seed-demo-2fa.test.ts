import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { activer2faDemo, codeDemo2fa, SECRET_2FA_DEMO_BASE32 } from "../src/db/seed-demo-2fa.js";
import { base32Decoder, TAILLE_SECRET } from "../src/auth/totp.js";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import { ajouterUtilisateur, demarrer, MOT_DE_PASSE_TEST, type Contexte } from "./helpers.js";

/*
 * Comptes de démonstration avec 2FA (db/seed-demo-2fa.ts) : le secret constant donne un compte
 * qui exige le code à la connexion, accepte le code du jour et refuse un mauvais code.
 */

let ctx: Contexte;
let cabinet: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  cabinet = await cabinetTest(ctx, "Cabinet 2FA démonstration");
});
afterAll(() => ctx.fermer());

const connexion = (email: string) =>
  ctx.app.inject({
    method: "POST",
    url: "/api/auth/connexion",
    payload: { email, mot_de_passe: MOT_DE_PASSE_TEST },
  });

describe("comptes de démonstration avec 2FA", () => {
  it("le secret constant est un secret TOTP de 20 octets", () => {
    expect(base32Decoder(SECRET_2FA_DEMO_BASE32)).toHaveLength(TAILLE_SECRET);
    // 1 699 999 980 s = début d'un pas de 30 s.
    const debutPas = 1_699_999_980_000;
    expect(codeDemo2fa(debutPas)).toMatch(/^\d{6}$/);
    // Le code ne change pas à l'intérieur d'un pas de 30 s, et change au pas suivant.
    expect(codeDemo2fa(debutPas)).toBe(codeDemo2fa(debutPas + 29_000));
    expect(codeDemo2fa(debutPas)).not.toBe(codeDemo2fa(debutPas + 30_000));
  });

  it("2FA active : la connexion exige le code, que le code du jour ouvre", async () => {
    const u = await ajouterUtilisateur(ctx, cabinet.cabinetId, ["associe"]);
    const trousseau = trousseauDepuisConfig(ctx.config);
    const active = await ctx.db.withTenant(cabinet.cabinetId, (db) =>
      activer2faDemo(db, trousseau, cabinet.cabinetId, u.utilisateurId),
    );
    expect(active).toBe(true);

    const etape1 = await connexion(u.email);
    expect(etape1.json()).toEqual({ ok: false, etape: "2fa_requise", defi: expect.any(String) });
    const defi = etape1.json().defi as string;

    const faux = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/connexion/2fa",
      payload: { defi, code: codeDemo2fa() === "000000" ? "111111" : "000000" },
    });
    expect(faux.statusCode).toBe(401);

    const ok = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/connexion/2fa",
      payload: { defi, code: codeDemo2fa() },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const cookie = ok.cookies[0] ? `${ok.cookies[0].name}=${ok.cookies[0].value}` : undefined;
    expect((await api(ctx, cookie).get("/api/auth/moi")).statusCode).toBe(200);
  });

  it("une 2FA déjà active n'est pas écrasée", async () => {
    const u = await ajouterUtilisateur(ctx, cabinet.cabinetId, ["associe"]);
    const trousseau = trousseauDepuisConfig(ctx.config);
    const premiere = await ctx.db.withTenant(cabinet.cabinetId, (db) =>
      activer2faDemo(db, trousseau, cabinet.cabinetId, u.utilisateurId),
    );
    const seconde = await ctx.db.withTenant(cabinet.cabinetId, (db) =>
      activer2faDemo(db, trousseau, cabinet.cabinetId, u.utilisateurId),
    );
    expect([premiere, seconde]).toEqual([true, false]);
  });
});
