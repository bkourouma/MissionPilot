import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@missionpilot/shared";
import { base32Decoder, totp } from "../src/auth/totp.js";
import { api, cabinetTest, type Api, type CabinetTest } from "./api.js";
import {
  ajouterUtilisateur,
  demarrer,
  MOT_DE_PASSE_TEST,
  proprietaire,
  type Contexte,
} from "./helpers.js";

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet 2FA A");
  b = await cabinetTest(ctx, "Cabinet 2FA B");
});
afterAll(() => ctx.fermer());

interface Compte {
  email: string;
  utilisateurId: string;
  client: Api;
  secret?: string;
  codes?: string[];
}

const connexion = (email: string, mot_de_passe = MOT_DE_PASSE_TEST) =>
  ctx.app.inject({ method: "POST", url: "/api/auth/connexion", payload: { email, mot_de_passe } });

const connexion2fa = (payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: "/api/auth/connexion/2fa", payload });

const cookieDe = (r: { cookies: { name: string; value: string }[] }) =>
  r.cookies[0] ? `${r.cookies[0].name}=${r.cookies[0].value}` : undefined;

const codeActuel = (secret: string) => totp(base32Decoder(secret), Date.now());

/** Remet à zéro l'anti-rejeu : plusieurs codes du même pas de temps dans un test. */
const oublierDernierPas = (utilisateurId: string) =>
  proprietaire((c) =>
    c.query("UPDATE utilisateurs_2fa SET dernier_pas = NULL WHERE utilisateur_id = $1", [
      utilisateurId,
    ]),
  );

/** Nouvel utilisateur connecté (sans 2FA). */
async function compte(cabinet: CabinetTest, roles: Role[] = ["consultant"]): Promise<Compte> {
  const u = await ajouterUtilisateur(ctx, cabinet.cabinetId, roles);
  const r = await connexion(u.email);
  return { ...u, client: api(ctx, cookieDe(r)) };
}

/** Nouvel utilisateur avec 2FA active (secret et codes de secours connus du test). */
async function compteAvec2fa(cabinet: CabinetTest, roles: Role[] = ["consultant"]) {
  const c = await compte(cabinet, roles);
  const init = await c.client.post("/api/auth/2fa/initialiser", {
    mot_de_passe: MOT_DE_PASSE_TEST,
  });
  expect(init.statusCode).toBe(200);
  const secret = init.json().secret as string;
  const act = await c.client.post("/api/auth/2fa/activer", { code: codeActuel(secret) });
  expect(act.statusCode).toBe(200);
  await oublierDernierPas(c.utilisateurId);
  return { ...c, secret, codes: act.json().codes_secours as string[] };
}

async function defiPour(email: string): Promise<string> {
  const r = await connexion(email);
  expect(r.statusCode).toBe(200);
  expect(r.json().etape).toBe("2fa_requise");
  return r.json().defi as string;
}

describe("double authentification : activation (SOC-02)", () => {
  it("initialiser exige une session et le mot de passe", async () => {
    expect(
      (await api(ctx).post("/api/auth/2fa/initialiser", { mot_de_passe: "x" })).statusCode,
    ).toBe(401);
    const c = await compte(a);
    const r = await c.client.post("/api/auth/2fa/initialiser", { mot_de_passe: "mauvais" });
    expect(r.statusCode).toBe(401);
    expect(r.json().erreur.code).toBe("MOT_DE_PASSE_INVALIDE");
  });

  it("initialiser renvoie l'URI et le secret une fois ; le secret est chiffré en base", async () => {
    const c = await compte(a);
    const r = await c.client.post("/api/auth/2fa/initialiser", { mot_de_passe: MOT_DE_PASSE_TEST });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const { secret, uri } = r.json();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(uri).toMatch(/^otpauth:\/\/totp\/MissionPilot:/);
    expect(uri).toContain(`secret=${secret}`);
    const ligne = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT secret_chiffre, cle_version, active_le FROM utilisateurs_2fa WHERE utilisateur_id = $1",
            [c.utilisateurId],
          )
        ).rows[0],
    );
    expect(ligne.cle_version).toBe(1);
    expect(ligne.active_le).toBeNull();
    expect((ligne.secret_chiffre as Buffer).includes(base32Decoder(secret))).toBe(false);
    // Pas encore active : la connexion reste en un temps.
    expect((await connexion(c.email)).json().etape).toBe("connecte");
  });

  it("activer : code faux refusé, code valide → 10 codes de secours stockés hachés", async () => {
    const c = await compte(a);
    const init = await c.client.post("/api/auth/2fa/initialiser", {
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    const secret = init.json().secret as string;
    const faux = String((Number(codeActuel(secret)) + 1) % 1_000_000).padStart(6, "0");
    const r1 = await c.client.post("/api/auth/2fa/activer", { code: faux });
    expect(r1.statusCode).toBe(401);
    expect(r1.json().erreur.code).toBe("CODE_2FA_INVALIDE");
    const r2 = await c.client.post("/api/auth/2fa/activer", { code: codeActuel(secret) });
    expect(r2.statusCode).toBe(200);
    const codes = r2.json().codes_secours as string[];
    expect(codes).toHaveLength(10);
    const stockes = await proprietaire(async (cl) =>
      (
        await cl.query("SELECT code_hash FROM codes_secours_2fa WHERE utilisateur_id = $1", [
          c.utilisateurId,
        ])
      ).rows.map((x) => x.code_hash as string),
    );
    expect(stockes).toHaveLength(10);
    for (const code of codes) {
      expect(stockes).not.toContain(code);
      expect(stockes).not.toContain(code.replace("-", ""));
    }
    const etat = await c.client.get("/api/auth/2fa");
    expect(etat.json()).toMatchObject({ active: true, codes_secours_restants: 10 });
    expect(etat.body).not.toContain(secret);
    // Déjà active : pas de nouvelle initialisation.
    const re = await c.client.post("/api/auth/2fa/initialiser", {
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(re.statusCode).toBe(409);
  });

  it("activer sans initialisation en attente : 400", async () => {
    const c = await compte(a);
    const r = await c.client.post("/api/auth/2fa/activer", { code: "123456" });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("TFA_NON_INITIALISEE");
  });
});

describe("double authentification : connexion en deux temps", () => {
  it("mot de passe correct → défi, sans session ; code valide → session", async () => {
    const c = await compteAvec2fa(a);
    const r = await connexion(c.email);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: false, etape: "2fa_requise", defi: expect.any(String) });
    expect(r.cookies).toHaveLength(0);
    const defi = r.json().defi as string;
    const stocke = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT 1 FROM defis_2fa WHERE defi_hash = $1", [defi])).rowCount,
    );
    expect(stocke).toBe(0);

    const ok = await connexion2fa({ defi, code: codeActuel(c.secret) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, etape: "connecte" });
    const moi = await api(ctx, cookieDe(ok)).get("/api/auth/moi");
    expect(moi.statusCode).toBe(200);
    expect(moi.json()).toMatchObject({ tfa_active: true, tfa_a_configurer: false });
    expect(moi.body).not.toContain(c.secret);
    expect(moi.body).not.toMatch(/secret|code_hash|defi/);
  });

  it("anti-rejeu : le même code (même pas de temps) n'ouvre pas une seconde session", async () => {
    const c = await compteAvec2fa(a);
    const code = codeActuel(c.secret);
    const premier = await connexion2fa({ defi: await defiPour(c.email), code });
    expect(premier.statusCode).toBe(200);
    const second = await connexion2fa({ defi: await defiPour(c.email), code });
    expect(second.statusCode).toBe(401);
    expect(second.json().erreur.code).toBe("CODE_2FA_INVALIDE");
  });

  it("défi à usage unique et défi expiré", async () => {
    const c = await compteAvec2fa(a);
    const defi = await defiPour(c.email);
    expect((await connexion2fa({ defi, code: codeActuel(c.secret) })).statusCode).toBe(200);
    await oublierDernierPas(c.utilisateurId);
    const reutilise = await connexion2fa({ defi, code: codeActuel(c.secret) });
    expect(reutilise.statusCode).toBe(401);
    expect(reutilise.json().erreur.code).toBe("DEFI_2FA_INVALIDE");

    const expire = await defiPour(c.email);
    await proprietaire((cl) =>
      cl.query(
        "UPDATE defis_2fa SET expire_le = now() - interval '1 second' WHERE utilisateur_id = $1 AND consomme_le IS NULL",
        [c.utilisateurId],
      ),
    );
    const r = await connexion2fa({ defi: expire, code: codeActuel(c.secret) });
    expect(r.statusCode).toBe(401);
    expect(r.json().erreur.code).toBe("DEFI_2FA_INVALIDE");
    expect((await connexion2fa({ defi: "x".repeat(43), code: "123456" })).statusCode).toBe(401);
  });

  it("limitation par défi : 5 codes faux épuisent le défi, même un code juste ensuite", async () => {
    const c = await compteAvec2fa(a);
    const defi = await defiPour(c.email);
    for (let i = 0; i < 5; i++) {
      const r = await connexion2fa({ defi, code: "000000" });
      expect(r.json().erreur.code).toBe("CODE_2FA_INVALIDE");
    }
    const r = await connexion2fa({ defi, code: codeActuel(c.secret) });
    expect(r.statusCode).toBe(401);
    expect(r.json().erreur.code).toBe("DEFI_2FA_INVALIDE");
  });

  it("limitation par e-mail : de nouveaux défis ne permettent pas d'essayer sans fin (429)", async () => {
    const c = await compteAvec2fa(a);
    let derniere = 0;
    for (let i = 0; i < 4; i++) {
      const defi = await defiPour(c.email);
      for (let j = 0; j < 3; j++)
        derniere = (await connexion2fa({ defi, code: "000000" })).statusCode;
    }
    expect(derniere).toBe(429);
    const r = await connexion2fa({ defi: await defiPour(c.email), code: codeActuel(c.secret) });
    expect(r.statusCode).toBe(429);
  });

  it("la limite par e-mail tient face à des requêtes simultanées", async () => {
    const c = await compteAvec2fa(a);
    const defis = await Promise.all(Array.from({ length: 6 }, () => defiPour(c.email)));
    const reponses = await Promise.all(
      defis.flatMap((defi) => [1, 2, 3].map(() => connexion2fa({ defi, code: "000000" }))),
    );
    expect(reponses.filter((r) => r.statusCode === 429)).toHaveLength(8);
  });

  it("code de secours : ouvre la session une fois, puis est consommé", async () => {
    const c = await compteAvec2fa(a);
    const code = c.codes[0]!.toUpperCase();
    const r1 = await connexion2fa({ defi: await defiPour(c.email), code_secours: code });
    expect(r1.statusCode).toBe(200);
    const r2 = await connexion2fa({ defi: await defiPour(c.email), code_secours: code });
    expect(r2.statusCode).toBe(401);
    const etat = await api(ctx, cookieDe(r1)).get("/api/auth/2fa");
    expect(etat.json().codes_secours_restants).toBe(9);
    // Un code de secours d'un autre utilisateur ne vaut rien.
    const autre = await compteAvec2fa(a);
    const r3 = await connexion2fa({ defi: await defiPour(c.email), code_secours: autre.codes[0] });
    expect(r3.statusCode).toBe(401);
  });

  it("réponses identiques pour un e-mail inconnu et un mauvais mot de passe (2FA active)", async () => {
    const c = await compteAvec2fa(a);
    const r1 = await connexion(c.email, "mauvais-mot-de-passe");
    const r2 = await connexion("inconnu-2fa@exemple.test", "mauvais-mot-de-passe");
    expect(r1.statusCode).toBe(401);
    expect(r1.json()).toEqual(r2.json());
  });
});

describe("double authentification : désactivation et codes de secours", () => {
  it("désactiver exige le mot de passe ET un code valide", async () => {
    const c = await compteAvec2fa(a);
    const sansFacteur = await c.client.post("/api/auth/2fa/desactiver", {
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(sansFacteur.statusCode).toBe(400);
    const mauvaisMdp = await c.client.post("/api/auth/2fa/desactiver", {
      mot_de_passe: "mauvais",
      code: codeActuel(c.secret),
    });
    expect(mauvaisMdp.statusCode).toBe(401);
    const mauvaisCode = await c.client.post("/api/auth/2fa/desactiver", {
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: "000000",
    });
    expect(mauvaisCode.statusCode).toBe(401);
    expect(mauvaisCode.json().erreur.code).toBe("CODE_2FA_INVALIDE");
    const ok = await c.client.post("/api/auth/2fa/desactiver", {
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: codeActuel(c.secret),
    });
    expect(ok.statusCode).toBe(200);
    expect((await c.client.get("/api/auth/2fa")).json().active).toBe(false);
    expect((await connexion(c.email)).json().etape).toBe("connecte");
    const restes = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT (SELECT count(*) FROM utilisateurs_2fa WHERE utilisateur_id = $1)
                  + (SELECT count(*) FROM codes_secours_2fa WHERE utilisateur_id = $1) AS n`,
            [c.utilisateurId],
          )
        ).rows[0].n,
    );
    expect(Number(restes)).toBe(0);
  });

  it("régénérer les codes de secours : les anciens ne valent plus rien", async () => {
    const c = await compteAvec2fa(a);
    const r = await c.client.post("/api/auth/2fa/codes-secours", {
      mot_de_passe: MOT_DE_PASSE_TEST,
      code_secours: c.codes[1],
    });
    expect(r.statusCode).toBe(200);
    const nouveaux = r.json().codes_secours as string[];
    expect(nouveaux).toHaveLength(10);
    const ancien = await connexion2fa({ defi: await defiPour(c.email), code_secours: c.codes[2] });
    expect(ancien.statusCode).toBe(401);
    const neuf = await connexion2fa({ defi: await defiPour(c.email), code_secours: nouveaux[0] });
    expect(neuf.statusCode).toBe(200);
  });

  it("désactiver sans 2FA active : 409", async () => {
    const c = await compte(a);
    const r = await c.client.post("/api/auth/2fa/desactiver", {
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: "123456",
    });
    expect(r.statusCode).toBe(409);
  });
});

describe("double authentification : politique du cabinet", () => {
  it("seul cabinet.gerer modifie la politique ; tfa_a_configurer selon le rôle", async () => {
    const c = await cabinetTest(ctx, "Cabinet 2FA Politique");
    const consultant = await c.avecRoles(["consultant"]);
    expect(
      (await consultant.put("/api/auth/2fa/politique", { roles_obligatoires: [] })).statusCode,
    ).toBe(403);
    expect(
      (await c.associe.put("/api/auth/2fa/politique", { roles_obligatoires: ["consultant"] }))
        .statusCode,
    ).toBe(400);
    const r = await c.associe.put("/api/auth/2fa/politique", {
      roles_obligatoires: ["associe", "gestionnaire"],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().roles_obligatoires).toEqual(["associe", "gestionnaire"]);
    expect((await c.associe.get("/api/auth/moi")).json().tfa_a_configurer).toBe(true);
    expect((await consultant.get("/api/auth/moi")).json().tfa_a_configurer).toBe(false);
    // Routes sensibles non bloquées dans cette version.
    expect((await c.associe.get("/api/utilisateurs")).statusCode).toBe(200);
    // La politique d'un cabinet ne touche pas l'autre.
    expect((await b.associe.get("/api/auth/moi")).json().tfa_a_configurer).toBe(false);
    const journal = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT details FROM journal_audit WHERE cabinet_id = $1 AND entite = 'politique_2fa'",
            [c.cabinetId],
          )
        ).rows,
    );
    expect(journal).toHaveLength(1);
  });
});

describe("double authentification : réinitialisation par un associé", () => {
  it("un consultant ne réinitialise pas la 2FA d'un autre (403)", async () => {
    const cible = await compteAvec2fa(a);
    const consultant = await compte(a);
    const r = await consultant.client.post(
      `/api/utilisateurs/${cible.utilisateurId}/2fa/reinitialiser`,
    );
    expect(r.statusCode).toBe(403);
  });

  it("un associé d'un autre cabinet ne voit pas l'utilisateur (404)", async () => {
    const cible = await compteAvec2fa(a);
    const r = await b.associe.post(`/api/utilisateurs/${cible.utilisateurId}/2fa/reinitialiser`);
    expect(r.statusCode).toBe(404);
    expect((await connexion(cible.email)).json().etape).toBe("2fa_requise");
  });

  it("l'associé réinitialise : sessions fermées, 2FA supprimée, action journalisée", async () => {
    const cible = await compteAvec2fa(a);
    const session = await connexion2fa({
      defi: await defiPour(cible.email),
      code: codeActuel(cible.secret),
    });
    const clientCible = api(ctx, cookieDe(session));
    expect((await clientCible.get("/api/auth/moi")).statusCode).toBe(200);
    const liste = await a.associe.get("/api/utilisateurs");
    expect(
      liste.json().elements.find((u: { id: string }) => u.id === cible.utilisateurId).tfa_active,
    ).toBe(true);

    const r = await a.associe.post(`/api/utilisateurs/${cible.utilisateurId}/2fa/reinitialiser`);
    expect(r.statusCode).toBe(200);
    expect((await clientCible.get("/api/auth/moi")).statusCode).toBe(401);
    expect((await connexion(cible.email)).json().etape).toBe("connecte");
    const journal = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT utilisateur_id FROM journal_audit WHERE action = '2fa_reinitialisation' AND entite_id = $1",
            [cible.utilisateurId],
          )
        ).rows,
    );
    expect(journal).toEqual([{ utilisateur_id: a.associeId }]);
  });

  it("un associé ne réinitialise pas sa propre 2FA par cette route", async () => {
    const r = await a.associe.post(`/api/utilisateurs/${a.associeId}/2fa/reinitialiser`);
    expect(r.statusCode).toBe(400);
  });
});

describe("double authentification : isolation et absence de secret", () => {
  it("RLS : un cabinet ne lit ni les secrets, ni les codes, ni les défis d'un autre", async () => {
    const c = await compteAvec2fa(a);
    await defiPour(c.email);
    const vus = await ctx.db.withTenant(b.cabinetId, async (db) => {
      const n = async (table: string) =>
        (await db.query(`SELECT 1 FROM ${table} WHERE utilisateur_id = $1`, [c.utilisateurId]))
          .rowCount;
      return [await n("utilisateurs_2fa"), await n("codes_secours_2fa"), await n("defis_2fa")];
    });
    expect(vus).toEqual([0, 0, 0]);
    // Insertion pour un utilisateur d'un autre cabinet : refusée (RLS / clé composite).
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO utilisateurs_2fa (utilisateur_id, cabinet_id, secret_chiffre, cle_version)
           VALUES ($1, $2, $3, 1)`,
          [c.utilisateurId, b.cabinetId, Buffer.alloc(48)],
        ),
      ),
    ).rejects.toThrow();
  });

  it("le journal d'audit ne contient ni secret, ni code, ni défi", async () => {
    const c = await compteAvec2fa(a);
    const defi = await defiPour(c.email);
    await connexion2fa({ defi, code: "000000" });
    await connexion2fa({ defi, code_secours: c.codes[0] });
    await c.client.post("/api/auth/2fa/codes-secours", {
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: "000000",
    });
    const lignes = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT action, details::text AS details FROM journal_audit WHERE entite_id = $1",
            [c.utilisateurId],
          )
        ).rows as { action: string; details: string }[],
    );
    const actions = lignes.map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining(["2fa_initialisation", "2fa_activation", "2fa_echec", "connexion"]),
    );
    const tout = JSON.stringify(lignes);
    expect(tout).not.toContain(c.secret);
    expect(tout).not.toContain(defi);
    for (const code of c.codes) {
      expect(tout).not.toContain(code);
      expect(tout).not.toContain(code.replace("-", ""));
    }
    expect(tout).not.toMatch(/mot_de_passe|secret_chiffre|code_hash/);
  });
});
