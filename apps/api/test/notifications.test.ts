import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifier, titreUneLigne } from "../src/notifications/notifier.js";
import { cabinetTest, type CabinetTest } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet Notifications A");
  b = await cabinetTest(ctx, "Cabinet Notifications B");
});
afterAll(() => ctx.fermer());

const creer = (cabinetId: string, destinataireId: string, titre: string, corps = "") =>
  ctx.db.withTenant(cabinetId, (db) =>
    notifier(db, { cabinetId, destinataireId, type: "test", titre, corps, lien: "/notifications" }),
  );

describe("notifications in-app (SOC-08)", () => {
  it("liste : non lues d'abord puis les plus récentes, pagination par curseur, compteur", async () => {
    const u = await a.avecRoles(["consultant"]);
    for (const titre of ["N1", "N2", "N3", "N4"]) await creer(a.cabinetId, u.utilisateurId, titre);
    const premiere = (await u.get("/api/notifications")).json();
    expect(premiere.elements.map((n: { titre: string }) => n.titre)).toEqual([
      "N4",
      "N3",
      "N2",
      "N1",
    ]);
    expect(premiere.non_lues).toBe(4);
    const n3 = premiere.elements[1].id as string;
    const lue = await u.post(`/api/notifications/${n3}/lue`);
    expect(lue.statusCode).toBe(200);
    expect(lue.json().lue_le).toBeTruthy();

    const p1 = (await u.get("/api/notifications?limite=2")).json();
    expect(p1.elements.map((n: { titre: string }) => n.titre)).toEqual(["N4", "N2"]);
    expect(p1.non_lues).toBe(3);
    const p2 = (await u.get(`/api/notifications?limite=2&curseur=${p1.curseur_suivant}`)).json();
    expect(p2.elements.map((n: { titre: string }) => n.titre)).toEqual(["N1", "N3"]);
    expect(p2.curseur_suivant).toBeNull();
    const nonLues = (await u.get("/api/notifications?non_lues=true")).json();
    expect(nonLues.elements).toHaveLength(3);

    const tout = await u.post("/api/notifications/tout-lire");
    expect(tout.json()).toEqual({ marquees: 3 });
    expect((await u.get("/api/notifications")).json().non_lues).toBe(0);
  });

  it("un utilisateur ne lit ni ne marque que ses notifications ; isolation entre cabinets", async () => {
    const u = await a.avecRoles(["consultant"]);
    const autre = await a.avecRoles(["consultant"]);
    const n = await creer(a.cabinetId, u.utilisateurId, "Privée");
    const id = n?.id as string;
    expect((await autre.get("/api/notifications")).json().elements).toEqual([]);
    expect((await autre.post(`/api/notifications/${id}/lue`)).statusCode).toBe(404);
    expect((await a.associe.post(`/api/notifications/${id}/lue`)).statusCode).toBe(404);
    expect((await b.associe.post(`/api/notifications/${id}/lue`)).statusCode).toBe(404);
    expect((await autre.post("/api/notifications/tout-lire")).json()).toEqual({ marquees: 0 });
    expect((await u.get("/api/notifications")).json().non_lues).toBe(1);
    // Destinataire d'un autre cabinet : rien n'est créé.
    expect(await creer(b.cabinetId, u.utilisateurId, "Fuite")).toBeNull();
    expect((await ctx.app.inject({ method: "GET", url: "/api/notifications" })).statusCode).toBe(
      401,
    );
  });

  it("texte brut sans HTML, lien interne uniquement, destinataire actif, historique intact", async () => {
    const u = await a.avecRoles(["consultant"]);
    await creer(
      a.cabinetId,
      u.utilisateurId,
      "<script>alert(1)</script>Titre",
      "Corps <b>gras</b>",
    );
    const n = (await u.get("/api/notifications")).json().elements[0];
    expect(n.titre).toBe("scriptalert(1)/scriptTitre");
    expect(n.corps).toBe("Corps bgras/b");
    for (const lien of [
      "https://exemple.test",
      "//exemple.test",
      "/\\exemple.test",
      "javascript:x",
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) =>
          notifier(db, {
            cabinetId: a.cabinetId,
            destinataireId: u.utilisateurId,
            type: "test",
            titre: "x",
            lien,
          }),
        ),
      ).rejects.toThrow(/Lien/);
    }
    await a.associe.patch(`/api/utilisateurs/${u.utilisateurId}`, { actif: false });
    expect(await creer(a.cabinetId, u.utilisateurId, "Inactif")).toBeNull();
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM notifications")),
    ).rejects.toThrow(/permission/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("UPDATE notifications SET titre = 'x'")),
    ).rejects.toThrow(/permission/);
    // Compte désactivé : sa session ne vaut plus.
    expect((await u.get("/api/notifications")).statusCode).toBe(401);
  });

  it("validation des paramètres", async () => {
    expect((await a.associe.get("/api/notifications?limite=101")).statusCode).toBe(400);
    expect((await a.associe.get("/api/notifications?curseur=abc")).statusCode).toBe(400);
    expect((await a.associe.post("/api/notifications/pas-un-uuid/lue")).statusCode).toBe(400);
  });

  it("F1 : titre (sujet de l'e-mail) sur une ligne, sans contrôle bidirectionnel ; CHECK en base", async () => {
    const u = await a.avecRoles(["consultant"]);
    const n = await ctx.db.withTenant(a.cabinetId, (db) =>
      notifier(db, {
        cabinetId: a.cabinetId,
        destinataireId: u.utilisateurId,
        type: "test",
        titre: "X\r\nBcc: tiers@exemple\u2028Y\u0085Z\u202Eevil\u2066W",
        email: true,
      }),
    );
    expect(n?.email?.sujet).toBe("MissionPilot — X Bcc: tiers@exemple Y Z evil W");
    const lue = (await u.get("/api/notifications")).json().elements[0];
    expect(lue.titre).toBe("X Bcc: tiers@exemple Y Z evil W");
    expect(titreUneLigne("a\n\n\nb")).toBe("a b");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO notifications (cabinet_id, destinataire_id, type, titre)
           VALUES ($1, $2, 'test', E'X\\nBcc: tiers@exemple')`,
          [a.cabinetId, u.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
