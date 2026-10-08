import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@missionpilot/shared";
import { buildApp } from "../src/app.js";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { verifierFacteur } from "../src/auth/double-authentification.js";
import { base32Decoder, totp } from "../src/auth/totp.js";
import { api, cabinetTest, type Api, type CabinetTest } from "./api.js";
import {
  ajouterUtilisateur,
  connecter,
  demarrer,
  MOT_DE_PASSE_TEST,
  proprietaire,
  type Contexte,
} from "./helpers.js";

/*
 * Non-régression de l'audit de sécurité du commit 6f28b95 (2FA) :
 * M2 politique 2FA purement déclarative, M3 actions à fort impact sans
 * reconfirmation (politique, réinitialisation), M5 limitation des codes
 * uniquement en mémoire. Chaque test rejoue le scénario d'attaque.
 */

let ctx: Contexte;
let a: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet 2FA Durcissement");
});
afterAll(async () => {
  // Alertes de sécurité mises en file (M3, M5) : base de test partagée, rien ne doit rester.
  await proprietaire((cl) => cl.query("DELETE FROM jobs WHERE type = 'envoyer_email'"));
  await ctx.fermer();
});

interface Compte {
  email: string;
  utilisateurId: string;
  client: Api;
  secret: string;
}

const codeA = (secret: string, ms = Date.now()) => totp(base32Decoder(secret), ms);
const codeFaux = (secret: string, ms = Date.now()) =>
  String((Number(codeA(secret, ms)) + 1) % 1_000_000).padStart(6, "0");

const oublierDernierPas = (utilisateurId: string) =>
  proprietaire((cl) =>
    cl.query("UPDATE utilisateurs_2fa SET dernier_pas = NULL WHERE utilisateur_id = $1", [
      utilisateurId,
    ]),
  );

async function compte(c: CabinetTest, roles: Role[]) {
  const u = await ajouterUtilisateur(ctx, c.cabinetId, roles);
  return { ...u, client: api(ctx, await connecter(ctx, u.email)) };
}

async function activer(client: Api, utilisateurId: string): Promise<string> {
  const init = await client.post("/api/auth/2fa/initialiser", { mot_de_passe: MOT_DE_PASSE_TEST });
  expect(init.statusCode).toBe(200);
  const secret = init.json().secret as string;
  expect((await client.post("/api/auth/2fa/activer", { code: codeA(secret) })).statusCode).toBe(
    200,
  );
  await oublierDernierPas(utilisateurId);
  return secret;
}

async function compteAvec2fa(c: CabinetTest, roles: Role[]): Promise<Compte> {
  const u = await compte(c, roles);
  return { ...u, secret: await activer(u.client, u.utilisateurId) };
}

const politique = (c: CabinetTest, roles: string[]) =>
  proprietaire((cl) =>
    cl.query("UPDATE cabinets SET tfa_obligatoire = $2 WHERE id = $1", [c.cabinetId, roles]),
  );

const notifications = (cabinetId: string, type: string) =>
  proprietaire(async (cl) =>
    (
      await cl.query(
        "SELECT destinataire_id FROM notifications WHERE cabinet_id = $1 AND type = $2",
        [cabinetId, type],
      )
    ).rows.map((r) => r.destinataire_id as string),
  );

const emailsEnFile = (cabinetId: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          "SELECT count(*)::int AS n FROM jobs WHERE cabinet_id = $1 AND type = 'envoyer_email'",
          [cabinetId],
        )
      ).rows[0].n as number,
  );

describe("M2 : politique 2FA appliquée par un crochet global", () => {
  it("soumis à la politique sans 2FA : 403 TFA_A_CONFIGURER hors des routes de configuration", async () => {
    const c = await cabinetTest(ctx, "Cabinet Politique Appliquée");
    const gestionnaire = await compte(c, ["gestionnaire"]);
    const consultant = await compte(c, ["consultant"]);
    await politique(c, ["gestionnaire"]);

    for (const url of ["/api/clients", "/api/factures", "/api/missions"]) {
      const r = await gestionnaire.client.get(url);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().erreur.code, url).toBe("TFA_A_CONFIGURER");
    }
    const ecriture = await gestionnaire.client.post("/api/clients", { raison_sociale: "X" });
    expect(ecriture.json().erreur.code).toBe("TFA_A_CONFIGURER");
    // Routes libres : santé, session, configuration de la 2FA.
    expect((await gestionnaire.client.get("/api/sante")).statusCode).toBe(200);
    const moi = await gestionnaire.client.get("/api/auth/moi");
    expect(moi.statusCode).toBe(200);
    expect(moi.json().tfa_a_configurer).toBe(true);
    expect((await gestionnaire.client.get("/api/auth/2fa")).statusCode).toBe(200);
    // Un rôle non soumis n'est pas concerné.
    expect((await consultant.client.get("/api/clients")).statusCode).toBe(200);
    // Une fois la 2FA activée, la même session passe.
    await activer(gestionnaire.client, gestionnaire.utilisateurId);
    expect((await gestionnaire.client.get("/api/clients")).statusCode).toBe(200);
  });

  it("plancher plateforme TOTP_REQUIS=oui : appliqué de même", async () => {
    const app = await buildApp({ ...ctx.config, TOTP_REQUIS: "oui" }, ctx.db);
    try {
      const cookie = await connecter(
        ctx,
        (await ajouterUtilisateur(ctx, a.cabinetId, ["associe"])).email,
      );
      const r = await app.inject({ method: "GET", url: "/api/clients", headers: { cookie } });
      expect(r.statusCode).toBe(403);
      expect(r.json().erreur.code).toBe("TFA_A_CONFIGURER");
      const moi = await app.inject({ method: "GET", url: "/api/auth/moi", headers: { cookie } });
      expect(moi.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("désactivation refusée (409) quand la politique impose la 2FA à son rôle", async () => {
    const c = await cabinetTest(ctx, "Cabinet Désactivation Interdite");
    const g = await compteAvec2fa(c, ["gestionnaire"]);
    await politique(c, ["gestionnaire"]);
    const r = await g.client.post("/api/auth/2fa/desactiver", {
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: codeA(g.secret),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("TFA_OBLIGATOIRE");
    expect((await g.client.get("/api/auth/2fa")).json().active).toBe(true);
  });
});

describe("M3 : politique et réinitialisation reconfirmées, associés alertés", () => {
  it("politique : sans reconfirmation refusée ; mot de passe ET code ; alerte des associés", async () => {
    const c = await cabinetTest(ctx, "Cabinet Politique Reconfirmée");
    // L'associé historique n'a pas de 2FA : il ne change pas la politique.
    const sans = await c.associe.put("/api/auth/2fa/politique", { roles_obligatoires: [] });
    expect(sans.statusCode).toBe(403);
    expect(sans.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    const mdpSeul = await c.associe.put("/api/auth/2fa/politique", {
      roles_obligatoires: [],
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(mdpSeul.statusCode).toBe(409);
    expect(mdpSeul.json().erreur.code).toBe("TFA_INACTIVE");

    const admin = await compteAvec2fa(c, ["associe"]);
    const sansCode = await admin.client.put("/api/auth/2fa/politique", {
      roles_obligatoires: ["gestionnaire"],
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(sansCode.statusCode).toBe(403);
    const faux = await admin.client.put("/api/auth/2fa/politique", {
      roles_obligatoires: ["gestionnaire"],
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: codeFaux(admin.secret),
    });
    expect(faux.statusCode).toBe(401);
    expect((await admin.client.get("/api/auth/2fa/politique")).json().roles_obligatoires).toEqual(
      [],
    );
    const ok = await admin.client.put("/api/auth/2fa/politique", {
      roles_obligatoires: ["gestionnaire"],
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: codeA(admin.secret),
    });
    expect(ok.statusCode).toBe(200);
    expect((await notifications(c.cabinetId, "securite_politique_tfa")).sort()).toEqual(
      [c.associeId, admin.utilisateurId].sort(),
    );
    expect(await emailsEnFile(c.cabinetId)).toBeGreaterThanOrEqual(2);
  });

  it("réinitialisation : reconfirmation de l'associé ; la cible et les associés sont alertés", async () => {
    const c = await cabinetTest(ctx, "Cabinet Réinitialisation Reconfirmée");
    const cible = await compteAvec2fa(c, ["consultant"]);
    const url = `/api/utilisateurs/${cible.utilisateurId}/2fa/reinitialiser`;
    // Session d'associé volée (sans 2FA) : plus de réinitialisation sur simple appel.
    const vole = await c.associe.post(url, {});
    expect(vole.statusCode).toBe(403);
    expect(vole.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    expect(
      (await c.associe.post(url, { mot_de_passe: MOT_DE_PASSE_TEST })).json().erreur.code,
    ).toBe("TFA_INACTIVE");
    const admin = await compteAvec2fa(c, ["associe"]);
    expect((await admin.client.post(url, { mot_de_passe: MOT_DE_PASSE_TEST })).statusCode).toBe(
      403,
    );
    const etat = await proprietaire(
      async (cl) =>
        (
          await cl.query("SELECT 1 FROM utilisateurs_2fa WHERE utilisateur_id = $1", [
            cible.utilisateurId,
          ])
        ).rowCount,
    );
    expect(etat).toBe(1);
    const ok = await admin.client.post(url, {
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: codeA(admin.secret),
    });
    expect(ok.statusCode).toBe(200);
    expect((await notifications(c.cabinetId, "securite_tfa_reinitialisee")).sort()).toEqual(
      [cible.utilisateurId, c.associeId, admin.utilisateurId].sort(),
    );
  });
});

describe("M5 : compteur d'échecs persistant", () => {
  it("blocage progressif sous horloge injectée ; remise à zéro au succès ; alerte à 8 échecs", async () => {
    const u = await compteAvec2fa(a, ["consultant"]);
    const t = trousseauDepuisConfig(ctx.config);
    const essayer = (code: string, ms: number) =>
      ctx.db.withTenant(a.cabinetId, (db) => verifierFacteur(db, t, u.utilisateurId, { code }, ms));
    const ligne = () =>
      proprietaire(
        async (cl) =>
          (
            await cl.query(
              "SELECT echecs, bloque_jusqu_au FROM utilisateurs_2fa WHERE utilisateur_id = $1",
              [u.utilisateurId],
            )
          ).rows[0] as { echecs: number; bloque_jusqu_au: Date | null },
      );
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) expect(await essayer(codeFaux(u.secret, t0), t0)).toBeNull();
    expect((await ligne()).bloque_jusqu_au).toBeNull();
    expect(await essayer(codeFaux(u.secret, t0), t0)).toBeNull(); // 5e échec : 1 min
    expect((await ligne()).bloque_jusqu_au?.getTime()).toBe(t0 + 60_000);
    // Bloqué : même le bon code est refusé, sans vérification.
    await expect(essayer(codeA(u.secret, t0 + 1_000), t0 + 1_000)).rejects.toMatchObject({
      statut: 429,
      code: "TFA_BLOQUEE",
    });
    // 6e, 7e puis 8e échec, chacun après la levée du blocage précédent.
    let ms = t0;
    for (let i = 6; i <= 8; i++) {
      ms += 61_000;
      expect(await essayer(codeFaux(u.secret, ms), ms)).toBeNull();
    }
    const apres8 = await ligne();
    expect(apres8.echecs).toBe(8);
    expect(apres8.bloque_jusqu_au?.getTime()).toBe(ms + 15 * 60_000);
    expect(await notifications(a.cabinetId, "securite_tfa_echecs")).toEqual([u.utilisateurId]);
    expect(await emailsEnFile(a.cabinetId)).toBeGreaterThanOrEqual(1);
    // Après le blocage : un bon code passe et remet le compteur à zéro.
    ms += 15 * 60_000 + 1_000;
    expect(await essayer(codeA(u.secret, ms), ms)).toBe("totp");
    expect(await ligne()).toEqual({ echecs: 0, bloque_jusqu_au: null });
  });

  it("le blocage survit à un redémarrage (nouvelle instance, limiteur mémoire vide)", async () => {
    const u = await compteAvec2fa(a, ["consultant"]);
    const connexion = async (app: Contexte["app"], code: string) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/connexion",
        payload: { email: u.email, mot_de_passe: MOT_DE_PASSE_TEST },
      });
      return app.inject({
        method: "POST",
        url: "/api/auth/connexion/2fa",
        payload: { defi: r.json().defi, code },
      });
    };
    for (let i = 0; i < 5; i++) {
      expect((await connexion(ctx.app, codeFaux(u.secret))).statusCode).toBe(401);
    }
    const redemarre = await demarrer();
    try {
      const r = await connexion(redemarre.app, codeA(u.secret));
      expect(r.statusCode).toBe(429);
      expect(r.json().erreur.code).toBe("TFA_BLOQUEE");
    } finally {
      await redemarre.fermer();
    }
  });
});
