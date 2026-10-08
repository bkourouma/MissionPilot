import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import {
  ajouterUtilisateur,
  demarrer,
  MOT_DE_PASSE_TEST,
  proprietaire,
  type Contexte,
} from "./helpers.js";

/*
 * Déblocage de la connexion d'un utilisateur (compromis accepté du limiteur
 * persistant : un tiers qui connaît seulement l'e-mail épuise les essais de
 * connexion de son titulaire). POST /api/cabinet/utilisateurs/:id/debloquer-connexion,
 * routes/limiteur-admin.ts.
 */

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet Déblocage A");
  b = await cabinetTest(ctx, "Cabinet Déblocage B");
});
afterAll(async () => {
  await ctx.fermer();
});

const connexion = (email: string, mot_de_passe: string) =>
  ctx.app.inject({ method: "POST", url: "/api/auth/connexion", payload: { email, mot_de_passe } });

/** Un tiers épuise les 10 essais de connexion de la cible avec un mauvais mot de passe. */
async function bloquer(email: string): Promise<void> {
  for (let i = 0; i < 10; i++) expect((await connexion(email, "mauvais")).statusCode).toBe(401);
  const r = await connexion(email, MOT_DE_PASSE_TEST);
  expect(r.statusCode).toBe(429);
}

const url = (id: string) => `/api/cabinet/utilisateurs/${id}/debloquer-connexion`;

describe("POST /cabinet/utilisateurs/:id/debloquer-connexion", () => {
  it("nominal : un associé débloque, reconfirmation par mot de passe, journalisé", async () => {
    const cible = await ajouterUtilisateur(ctx, a.cabinetId, ["consultant"]);
    await bloquer(cible.email);
    const r = await a.associe.post(url(cible.utilisateurId), { mot_de_passe: MOT_DE_PASSE_TEST });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ ok: true, etait_bloquee: true });
    // Le titulaire se connecte de nouveau.
    expect((await connexion(cible.email, MOT_DE_PASSE_TEST)).statusCode).toBe(200);
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT utilisateur_id, entite, details FROM journal_audit
             WHERE cabinet_id = $1 AND action = 'deblocage_connexion' AND entite_id = $2`,
            [a.cabinetId, cible.utilisateurId],
          )
        ).rows,
    );
    expect(journal).toEqual([
      {
        utilisateur_id: a.associeId,
        entite: "utilisateur",
        details: { etait_bloquee: true, facteur: "mot_de_passe" },
      },
    ]);
    // Rien à débloquer : réponse explicite, toujours journalisée.
    const encore = await a.associe.post(url(cible.utilisateurId), {
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(encore.json()).toEqual({ ok: true, etait_bloquee: false });
  });

  it("401 sans session, 403 sans « cabinet.gerer », reconfirmation exigée", async () => {
    const cible = await ajouterUtilisateur(ctx, a.cabinetId, ["consultant"]);
    expect((await api(ctx).post(url(cible.utilisateurId), {})).statusCode).toBe(401);
    for (const role of ["gestionnaire", "directeur_mission", "consultant"] as const) {
      const u = await a.avecRoles([role]);
      const r = await u.post(url(cible.utilisateurId), { mot_de_passe: MOT_DE_PASSE_TEST });
      expect(r.statusCode, role).toBe(403);
    }
    const sans = await a.associe.post(url(cible.utilisateurId), {});
    expect(sans.statusCode).toBe(403);
    expect(sans.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    const faux = await a.associe.post(url(cible.utilisateurId), { mot_de_passe: "pas-le-bon" });
    expect(faux.statusCode).toBe(401);
    expect(faux.json().erreur.code).toBe("MOT_DE_PASSE_INVALIDE");
    expect((await a.associe.post(url(cible.utilisateurId), { inconnu: 1 })).statusCode).toBe(400);
    expect((await a.associe.post(url("pas-un-uuid"), {})).statusCode).toBe(400);
  });

  it("isolation : un utilisateur d'un autre cabinet ou inexistant répond 404, sans rien débloquer", async () => {
    const cibleB = await ajouterUtilisateur(ctx, b.cabinetId, ["consultant"]);
    await bloquer(cibleB.email);
    const r = await a.associe.post(url(cibleB.utilisateurId), { mot_de_passe: MOT_DE_PASSE_TEST });
    expect(r.statusCode).toBe(404);
    expect((await connexion(cibleB.email, MOT_DE_PASSE_TEST)).statusCode).toBe(429);
    const inexistant = await a.associe.post(url("00000000-0000-4000-8000-000000000000"), {
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(inexistant.statusCode).toBe(404);
    // Son propre cabinet, lui, la débloque.
    const parB = await b.associe.post(url(cibleB.utilisateurId), {
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(parB.json()).toEqual({ ok: true, etait_bloquee: true });
  });
});
