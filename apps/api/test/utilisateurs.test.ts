import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MailerJournal } from "../src/notifications/mailer.js";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import { viderEmailsEnFile } from "./facturation-outils.js";
import { demarrer, MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet Utilisateurs A");
  b = await cabinetTest(ctx, "Cabinet Utilisateurs B");
});
afterAll(async () => {
  // Alertes e-mail des associés mises en file par les invitations au portail de ce
  // fichier (base de test partagée, voir jobs.test.ts et isolation.test.ts).
  if (a) await viderEmailsEnFile(a.cabinetId);
  await ctx.fermer();
});

const boite = () => ctx.app.mailer as MailerJournal;
const jetonDe = (email: string) => {
  const m = boite().dernierPour(email);
  return m?.texte.match(/#jeton=([\w-]+)/)?.[1];
};

describe("utilisateurs (SOC-02)", () => {
  it("liste les utilisateurs du cabinet, sans hachage de mot de passe", async () => {
    const r = await a.associe.get("/api/utilisateurs");
    expect(r.statusCode).toBe(200);
    expect(r.json().elements.length).toBeGreaterThan(0);
    expect(r.body).not.toMatch(/hash|mot_de_passe/);
  });

  it("refuse sans session (401) et sans droit cabinet.gerer (403)", async () => {
    expect((await api(ctx).get("/api/utilisateurs")).statusCode).toBe(401);
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get("/api/utilisateurs")).statusCode).toBe(403);
    expect(
      (
        await consultant.post("/api/invitations", {
          email: "x@exemple.test",
          roles: ["consultant"],
        })
      ).statusCode,
    ).toBe(403);
  });

  it("modifie les rôles et désactive un utilisateur (sessions coupées)", async () => {
    const u = await a.avecRoles(["consultant"]);
    const r = await a.associe.patch(`/api/utilisateurs/${u.utilisateurId}`, {
      roles: ["consultant", "ressources"],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().roles).toEqual(["consultant", "ressources"]);
    const d = await a.associe.patch(`/api/utilisateurs/${u.utilisateurId}`, { actif: false });
    expect(d.json().actif).toBe(false);
    expect((await u.get("/api/auth/moi")).statusCode).toBe(401);
  });

  it("refuse de retirer le dernier associé actif", async () => {
    const c = await cabinetTest(ctx, "Cabinet Un Associé");
    const r1 = await c.associe.patch(`/api/utilisateurs/${c.associeId}`, { roles: ["consultant"] });
    expect(r1.statusCode).toBe(409);
    expect(r1.json().erreur.code).toBe("DERNIER_ASSOCIE");
    const r2 = await c.associe.patch(`/api/utilisateurs/${c.associeId}`, { actif: false });
    expect(r2.statusCode).toBe(409);
    // Avec un second associé, la modification passe.
    const autre = await c.avecRoles(["associe"]);
    const r3 = await autre.patch(`/api/utilisateurs/${c.associeId}`, { roles: ["consultant"] });
    expect(r3.statusCode).toBe(200);
  });

  it("valide le corps : rôle inconnu, champ inconnu, corps vide", async () => {
    const u = await a.avecRoles(["consultant"]);
    const url = `/api/utilisateurs/${u.utilisateurId}`;
    expect((await a.associe.patch(url, { roles: ["pirate"] })).statusCode).toBe(400);
    expect((await a.associe.patch(url, { cabinet_id: b.cabinetId })).statusCode).toBe(400);
    expect((await a.associe.patch(url, {})).statusCode).toBe(400);
    expect(
      (await a.associe.patch("/api/utilisateurs/pas-un-uuid", { actif: true })).statusCode,
    ).toBe(400);
  });

  it("isolation : un autre cabinet ne modifie pas un utilisateur par identifiant (404)", async () => {
    const u = await a.avecRoles(["consultant"]);
    const r = await b.associe.patch(`/api/utilisateurs/${u.utilisateurId}`, { actif: false });
    expect(r.statusCode).toBe(404);
    const liste = await b.associe.get("/api/utilisateurs");
    expect(liste.json().elements.map((x: { id: string }) => x.id)).not.toContain(u.utilisateurId);
  });

  it("journalise les modifications", async () => {
    const u = await a.avecRoles(["consultant"]);
    await a.associe.patch(`/api/utilisateurs/${u.utilisateurId}`, { nom: "Nouveau Nom" });
    const r = await a.associe.get(`/api/audit?entite=utilisateur&entite_id=${u.utilisateurId}`);
    const entree = r.json().elements[0];
    expect(entree.action).toBe("modification");
    expect(entree.details.apres.nom).toBe("Nouveau Nom");
  });
});

describe("invitations (SOC-02)", () => {
  it("invite, envoie un lien, puis l'invité crée son compte et obtient une session", async () => {
    const email = `invite-${Date.now()}@exemple.test`;
    const r = await a.associe.post("/api/invitations", { email, roles: ["consultant"] });
    expect(r.statusCode).toBe(201);
    expect(r.body).not.toMatch(/jeton/);
    const jeton = jetonDe(email);
    expect(jeton).toBeTruthy();

    // Le jeton n'est stocké que haché.
    const enClair = await proprietaire(
      async (c) =>
        (await c.query("SELECT 1 FROM invitations WHERE jeton_hash = $1", [jeton])).rowCount,
    );
    expect(enClair).toBe(0);

    const acc = await api(ctx).post("/api/invitations/accepter", {
      jeton,
      nom: "Nouvelle Recrue",
      mot_de_passe: "un-mot-de-passe-long",
    });
    expect(acc.statusCode).toBe(201);
    const cookie = `${acc.cookies[0]!.name}=${acc.cookies[0]!.value}`;
    const moi = await api(ctx, cookie).get("/api/auth/moi");
    expect(moi.json().utilisateur.roles).toEqual(["consultant"]);
    expect(moi.json().cabinet_id).toBe(a.cabinetId);

    // Une seconde acceptation du même jeton échoue.
    const encore = await api(ctx).post("/api/invitations/accepter", {
      jeton,
      nom: "Autre",
      mot_de_passe: "un-mot-de-passe-long",
    });
    expect(encore.statusCode).toBe(400);
  });

  it("refuse un mot de passe trop court et un jeton inventé", async () => {
    const court = await api(ctx).post("/api/invitations/accepter", {
      jeton: "x".repeat(43),
      nom: "A",
      mot_de_passe: "court",
    });
    expect(court.statusCode).toBe(400);
    const invente = await api(ctx).post("/api/invitations/accepter", {
      jeton: "x".repeat(43),
      nom: "A",
      mot_de_passe: "un-mot-de-passe-long",
    });
    expect(invente.statusCode).toBe(400);
    expect(invente.json().erreur.code).toBe("INVITATION_INVALIDE");
  });

  it("refuse une invitation expirée", async () => {
    const email = `expire-${Date.now()}@exemple.test`;
    const r = await a.associe.post("/api/invitations", { email, roles: ["consultant"] });
    await proprietaire((c) =>
      c.query("UPDATE invitations SET expire_le = now() - interval '1 minute' WHERE id = $1", [
        r.json().id,
      ]),
    );
    const acc = await api(ctx).post("/api/invitations/accepter", {
      jeton: jetonDe(email),
      nom: "Trop Tard",
      mot_de_passe: "un-mot-de-passe-long",
    });
    expect(acc.statusCode).toBe(400);
  });

  it("une nouvelle invitation remplace la précédente ; expiration à 7 jours", async () => {
    const email = `double-${Date.now()}@exemple.test`;
    const r1 = await a.associe.post("/api/invitations", { email, roles: ["consultant"] });
    const ancien = jetonDe(email);
    const r2 = await a.associe.post("/api/invitations", { email, roles: ["chef_mission"] });
    expect(r1.statusCode).toBe(201);
    const jours = (new Date(r2.json().expire_le).getTime() - Date.now()) / 86_400_000;
    expect(jours).toBeGreaterThan(6.9);
    expect(jours).toBeLessThan(7.1);
    const liste = await a.associe.get("/api/invitations");
    const enAttente = liste.json().elements.filter((i: { email: string }) => i.email === email);
    expect(enAttente).toHaveLength(1);
    const acc = await api(ctx).post("/api/invitations/accepter", {
      jeton: ancien,
      nom: "X",
      mot_de_passe: "un-mot-de-passe-long",
    });
    expect(acc.statusCode).toBe(400);
  });

  describe("invitation au portail client en attente pour le même e-mail", () => {
    let clientId: string;
    beforeAll(async () => {
      const c = await a.associe.post("/api/clients", {
        raison_sociale: "Client Invitations (fictif)",
      });
      expect(c.statusCode).toBe(201);
      clientId = c.json().id;
    });
    const inviterAuPortail = (email: string) =>
      a.associe.post("/api/portail/invitations", {
        email,
        client_id: clientId,
        roles: ["client_dirigeant"],
      });

    it("refuse l'invitation interne (409) sans toucher à l'invitation du portail", async () => {
      const email = `portail-attente-${Date.now()}@client.test`;
      const portail = await inviterAuPortail(email);
      expect(portail.statusCode).toBe(201);
      const jetonPortail = jetonDe(email);

      const r = await a.associe.post("/api/invitations", { email, roles: ["consultant"] });
      expect(r.statusCode).toBe(409);
      expect(r.json().erreur.code).toBe("CONFLIT");
      expect(r.json().erreur.message).toBe(
        "Une invitation au portail client est en attente pour cet e-mail : révoquez-la d'abord.",
      );
      // Aucune invitation interne créée, aucun e-mail d'invitation interne envoyé.
      const liste = await a.associe.get("/api/invitations");
      expect(liste.json().elements.map((i: { email: string }) => i.email)).not.toContain(email);
      expect(jetonDe(email)).toBe(jetonPortail);
      // L'invitation du portail reste en attente, puis s'accepte normalement.
      const etat = await proprietaire(
        async (c) =>
          (
            await c.query(
              "SELECT acceptee_le IS NULL AND expire_le > now() AS en_attente FROM invitations WHERE id = $1",
              [portail.json().id],
            )
          ).rows[0]?.en_attente,
      );
      expect(etat).toBe(true);
      const acc = await api(ctx).post("/api/portail/invitations/accepter", {
        jeton: jetonPortail,
        nom: "Dirigeant client",
        mot_de_passe: MOT_DE_PASSE_TEST,
      });
      expect(acc.statusCode).toBe(201);
    });

    it("après révocation de l'invitation du portail, l'invitation interne passe et se remplace", async () => {
      const email = `portail-revoque-${Date.now()}@client.test`;
      const portail = await inviterAuPortail(email);
      expect(portail.statusCode).toBe(201);
      expect(
        (await a.associe.delete(`/api/portail/invitations/${portail.json().id}`)).statusCode,
      ).toBe(200);

      const r1 = await a.associe.post("/api/invitations", { email, roles: ["consultant"] });
      expect(r1.statusCode).toBe(201);
      const ancien = jetonDe(email);
      const r2 = await a.associe.post("/api/invitations", { email, roles: ["chef_mission"] });
      expect(r2.statusCode).toBe(201);
      const liste = await a.associe.get("/api/invitations");
      const enAttente = liste
        .json()
        .elements.filter((i: { email: string }) => i.email === email)
        .map((i: { id: string }) => i.id);
      expect(enAttente).toEqual([r2.json().id]);
      const acc = await api(ctx).post("/api/invitations/accepter", {
        jeton: ancien,
        nom: "X",
        mot_de_passe: "un-mot-de-passe-long",
      });
      expect(acc.statusCode).toBe(400);
    });
  });

  it("refuse d'inviter un e-mail déjà utilisé dans le cabinet", async () => {
    const u = await a.avecRoles(["consultant"]);
    const liste = await a.associe.get("/api/utilisateurs");
    const email = liste.json().elements.find((x: { id: string }) => x.id === u.utilisateurId).email;
    const r = await a.associe.post("/api/invitations", { email, roles: ["consultant"] });
    expect(r.statusCode).toBe(409);
  });

  it("valide l'e-mail et les rôles", async () => {
    expect(
      (await a.associe.post("/api/invitations", { email: "pas-un-email", roles: ["consultant"] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await a.associe.post("/api/invitations", { email: "ok@exemple.test", roles: [] }))
        .statusCode,
    ).toBe(400);
  });

  it("isolation : les invitations d'un cabinet ne sont pas visibles d'un autre", async () => {
    const email = `iso-${Date.now()}@exemple.test`;
    await a.associe.post("/api/invitations", { email, roles: ["consultant"] });
    const liste = await b.associe.get("/api/invitations");
    expect(liste.json().elements.map((i: { email: string }) => i.email)).not.toContain(email);
  });
});
