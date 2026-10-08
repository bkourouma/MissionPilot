import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type RoleCabinet } from "@missionpilot/shared";
import { api } from "./api.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { connecter, MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import {
  attendre,
  inviterClient,
  jetonInvitation,
  preparerPortail,
  viderAlertesInvitation,
  type ScenarioPortail,
} from "./portail-outils.js";

/*
 * Portail client (SOC-09), côté cabinet : invitations (rôles client
 * seulement), acceptation, double rôle impossible, désactivation, partages,
 * politique 2FA du portail, matrice des 8 rôles internes.
 */

let ctx: Contexte;
let s: ScenarioPortail;

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerPortail(ctx);
}, 180_000);
afterAll(async () => {
  // Alertes e-mail des associés mises en file par les invitations de ce fichier.
  await viderAlertesInvitation(s.a.clientId);
  await viderAlertesInvitation(s.b.clientId);
  await ctx.fermer();
});

let n = 0;
const email = () => `gestion${++n}-${Date.now()}@client.test`;

describe("invitations du portail", () => {
  it("401 sans session ; rôles internes, mélange et champs inconnus refusés (400)", async () => {
    const corps = { email: email(), client_id: s.a.clientId, roles: ["client_dirigeant"] };
    expect((await api(ctx).post("/api/portail/invitations", corps)).statusCode).toBe(401);
    for (const roles of [["associe"], ["client_dirigeant", "chef_mission"], [], ["admin"]]) {
      expect(
        (await s.a.associe.post("/api/portail/invitations", { ...corps, roles })).statusCode,
      ).toBe(400);
    }
    expect(
      (await s.a.associe.post("/api/portail/invitations", { ...corps, cabinet_id: s.b.cabinetId }))
        .statusCode,
    ).toBe(400);
  });

  it("matrice des 8 rôles internes : associé, directeur et chef gèrent ; les autres 403", async () => {
    const attendus: Record<RoleCabinet, number> = {
      associe: 200,
      directeur_mission: 200,
      chef_mission: 200,
      consultant: 403,
      ressources: 403,
      gestionnaire: 403,
      expert_metier: 403,
      expert_externe: 403,
    };
    for (const role of ROLES) {
      const u = await s.a.avecRoles([role]);
      expect((await u.get("/api/portail/parametres")).statusCode, role).toBe(attendus[role]);
      const inv = await u.post("/api/portail/invitations", {
        email: email(),
        client_id: s.a.clientId,
        roles: ["client_contributeur"],
      });
      // Un chef de mission qui ne dirige aucune mission de ce client : 403 aussi.
      const attendu = role === "associe" || role === "directeur_mission" ? 201 : 403;
      expect(inv.statusCode, role).toBe(attendu);
    }
  });

  it("client d'un autre cabinet 404 ; client archivé 409 ; e-mail déjà utilisé 409", async () => {
    const corps = { email: email(), client_id: s.b.clientId, roles: ["client_dirigeant"] };
    expect((await s.a.associe.post("/api/portail/invitations", corps)).statusCode).toBe(404);
    const archive = await s.a.associe.post("/api/clients", { raison_sociale: "Client archivé" });
    attendre(201, archive, "client");
    attendre(
      200,
      await s.a.associe.patch(`/api/clients/${archive.json().id}`, { actif: false }),
      "archivage",
    );
    expect(
      (
        await s.a.associe.post("/api/portail/invitations", {
          ...corps,
          client_id: archive.json().id,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await s.a.associe.post("/api/portail/invitations", {
          ...corps,
          client_id: s.a.clientId,
          email: s.dirigeant.email,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("le jeton n'est jamais renvoyé ; il est stocké haché ; expiration 7 jours", async () => {
    const e = email();
    const r = await s.a.associe.post("/api/portail/invitations", {
      email: e,
      client_id: s.a.clientId,
      roles: ["client_dirigeant"],
    });
    expect(r.statusCode).toBe(201);
    const jeton = jetonInvitation(ctx, e);
    expect(r.body).not.toContain(jeton);
    const ligne = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT jeton_hash, client_id, extract(day FROM expire_le - cree_le)::int AS jours
             FROM invitations WHERE id = $1`,
            [r.json().id],
          )
        ).rows[0],
    );
    expect(ligne.jeton_hash).not.toBe(jeton);
    expect(ligne.jours).toBe(7);
    expect(ligne.client_id).toBe(s.a.clientId);
  });

  it("une invitation du portail ne s'accepte pas par la route interne, et réciproquement", async () => {
    const e = email();
    attendre(
      201,
      await s.a.associe.post("/api/portail/invitations", {
        email: e,
        client_id: s.a.clientId,
        roles: ["client_dirigeant"],
      }),
      "invitation",
    );
    const corps = { jeton: jetonInvitation(ctx, e), nom: "X", mot_de_passe: MOT_DE_PASSE_TEST };
    expect((await api(ctx).post("/api/invitations/accepter", corps)).statusCode).toBe(400);
    // Manipulation : impossible d'imposer des rôles ou un client dans le corps.
    expect(
      (
        await api(ctx).post("/api/portail/invitations/accepter", {
          ...corps,
          roles: ["associe"],
        })
      ).statusCode,
    ).toBe(400);
    const ei = email();
    attendre(
      201,
      await s.a.associe.post("/api/invitations", { email: ei, roles: ["consultant"] }),
      "invitation interne",
    );
    expect(
      (
        await api(ctx).post("/api/portail/invitations/accepter", {
          ...corps,
          jeton: jetonInvitation(ctx, ei),
        })
      ).statusCode,
    ).toBe(400);
  });

  it("révocation : l'invitation n'est plus acceptable ; l'auteur qui perd son rôle l'invalide", async () => {
    const e = email();
    const r = await s.a.associe.post("/api/portail/invitations", {
      email: e,
      client_id: s.a.clientId,
      roles: ["client_contributeur"],
    });
    expect((await s.a.associe.delete(`/api/portail/invitations/${r.json().id}`)).statusCode).toBe(
      200,
    );
    const corps = { jeton: jetonInvitation(ctx, e), nom: "X", mot_de_passe: MOT_DE_PASSE_TEST };
    expect((await api(ctx).post("/api/portail/invitations/accepter", corps)).statusCode).toBe(400);

    // Auteur absent ou d'un autre cabinet : refus (même règle que F3 pour l'interne).
    for (const auteur of [null, s.b.associeId]) {
      const e3 = email();
      const inv = await s.a.associe.post("/api/portail/invitations", {
        email: e3,
        client_id: s.a.clientId,
        roles: ["client_contributeur"],
      });
      await proprietaire((c) =>
        c.query("UPDATE invitations SET invite_par = $2 WHERE id = $1", [inv.json().id, auteur]),
      );
      expect(
        (
          await api(ctx).post("/api/portail/invitations/accepter", {
            ...corps,
            jeton: jetonInvitation(ctx, e3),
          })
        ).statusCode,
      ).toBe(400);
    }

    const directeur = await s.a.avecRoles(["directeur_mission"]);
    const e2 = email();
    attendre(
      201,
      await directeur.post("/api/portail/invitations", {
        email: e2,
        client_id: s.a.clientId,
        roles: ["client_contributeur"],
      }),
      "invitation directeur",
    );
    attendre(
      200,
      await s.a.associe.patch(`/api/utilisateurs/${directeur.utilisateurId}`, { actif: false }),
      "désactivation directeur",
    );
    expect(
      (
        await api(ctx).post("/api/portail/invitations/accepter", {
          ...corps,
          jeton: jetonInvitation(ctx, e2),
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe("invitations en attente, alerte des associés, auteur encore habilité", () => {
  const inviter = (par: typeof s.a.associe, e: string, clientId = s.a.clientId) =>
    par.post("/api/portail/invitations", {
      email: e,
      client_id: clientId,
      roles: ["client_contributeur"],
    });
  const accepter = (jeton: string) =>
    api(ctx).post("/api/portail/invitations/accepter", {
      jeton,
      nom: "Personne cliente",
      mot_de_passe: MOT_DE_PASSE_TEST,
    });

  it("une invitation INTERNE en attente n'est jamais annulée par une invitation du portail (409)", async () => {
    const e = email();
    attendre(
      201,
      await s.a.associe.post("/api/invitations", { email: e, roles: ["consultant"] }),
      "interne",
    );
    const jetonInterne = jetonInvitation(ctx, e);
    const r = await inviter(s.a.associe, e);
    expect(r.statusCode).toBe(409);
    // L'invitation interne reste valable.
    const ok = await api(ctx).post("/api/invitations/accepter", {
      jeton: jetonInterne,
      nom: "Consultant invité",
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(ok.statusCode).toBe(201);
  });

  it("même client : la nouvelle invitation remplace l'ancienne ; autre client : 409", async () => {
    const e = email();
    attendre(201, await inviter(s.a.associe, e), "première");
    const premier = jetonInvitation(ctx, e);
    expect((await inviter(s.a.associe, e, s.clientA2)).statusCode).toBe(409);
    attendre(201, await inviter(s.a.associe, e), "seconde");
    const second = jetonInvitation(ctx, e);
    expect(second).not.toBe(premier);
    expect((await accepter(premier)).statusCode).toBe(400);
    expect((await accepter(second)).statusCode).toBe(201);
  });

  it("chaque invitation alerte tous les associés actifs (in-app et e-mail en file)", async () => {
    const associe2 = await s.a.avecRoles(["associe"]);
    const compter = () =>
      proprietaire(async (c) => ({
        associes: (
          await c.query(
            "SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND actif AND 'associe' = ANY (roles)",
            [s.a.cabinetId],
          )
        ).rows.map((x) => x.id as string),
        notes: (
          await c.query(
            `SELECT destinataire_id AS id, count(*)::int AS n FROM notifications
             WHERE cabinet_id = $1 AND type = 'securite_invitation_portail' GROUP BY 1`,
            [s.a.cabinetId],
          )
        ).rows.reduce((m, x) => m.set(x.id, x.n), new Map<string, number>()),
        mails: (
          await c.query(
            "SELECT count(*)::int AS n FROM jobs WHERE cabinet_id = $1 AND type = 'envoyer_email'",
            [s.a.cabinetId],
          )
        ).rows[0].n as number,
      }));
    const avant = await compter();
    const e = email();
    attendre(201, await inviter(s.a.chef, e), "invitation par le chef");
    const apres = await compter();
    expect(apres.associes).toEqual(expect.arrayContaining([s.a.associeId, associe2.utilisateurId]));
    for (const id of apres.associes) {
      expect((apres.notes.get(id) ?? 0) - (avant.notes.get(id) ?? 0), id).toBe(1);
    }
    // Personne d'autre n'est alerté ; un e-mail en file par associé.
    expect([...apres.notes.keys()].every((id) => apres.associes.includes(id))).toBe(true);
    expect(apres.mails - avant.mails).toBe(apres.associes.length);
    const corps = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT corps, lien FROM notifications WHERE destinataire_id = $1
             AND type = 'securite_invitation_portail' ORDER BY cree_le DESC LIMIT 1`,
            [associe2.utilisateurId],
          )
        ).rows[0],
    );
    expect(corps.corps).toContain(e);
    expect(corps.lien).toBe(`/clients/${s.a.clientId}`);
  });

  it("chef qui ne dirige plus aucune mission du client : son invitation en attente ne s'accepte plus", async () => {
    const chef = await s.a.avecRoles(["chef_mission"]);
    const mission = await creerMission(s.a, {
      intitule: "Mission du chef",
      chef_id: chef.utilisateurId,
    });
    const e = email();
    attendre(201, await inviter(chef, e), "invitation par le chef");
    await proprietaire((c) =>
      c.query("UPDATE missions SET chef_id = $2 WHERE id = $1", [
        mission.id,
        s.a.chef.utilisateurId,
      ]),
    );
    expect((await accepter(jetonInvitation(ctx, e))).statusCode).toBe(400);
    // Rétabli dans sa mission : l'invitation redevient acceptable.
    await proprietaire((c) =>
      c.query("UPDATE missions SET chef_id = $2 WHERE id = $1", [mission.id, chef.utilisateurId]),
    );
    expect((await accepter(jetonInvitation(ctx, e))).statusCode).toBe(201);
  });
});

describe("rôles disjoints : un utilisateur du portail n'a jamais de rôle interne", () => {
  it("CHECK et déclencheur en base, routes internes fermées", async () => {
    const id = s.dirigeant.utilisateurId;
    for (const roles of [["client_dirigeant", "associe"], ["associe"]]) {
      await expect(
        ctx.db.withTenant(s.a.cabinetId, (db) =>
          db.query("UPDATE utilisateurs SET roles = $2 WHERE id = $1", [id, roles]),
        ),
      ).rejects.toThrow();
    }
    // L'inverse : un utilisateur interne ne devient pas client.
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE utilisateurs SET roles = '{client_dirigeant}' WHERE id = $1", [
          s.a.chef.utilisateurId,
        ]),
      ),
    ).rejects.toThrow();
    expect(
      (await s.a.associe.patch(`/api/utilisateurs/${id}`, { roles: ["associe"] })).statusCode,
    ).toBe(404);
    expect(
      (await s.a.associe.patch(`/api/utilisateurs/${id}`, { roles: ["client_dirigeant"] }))
        .statusCode,
    ).toBe(400);
    const liste = (await s.a.associe.get("/api/utilisateurs")).json().elements;
    expect(liste.some((u: { id: string }) => u.id === id)).toBe(false);
    // Jamais désigné dans le cabinet : équipe de mission.
    expect(
      (await s.a.chef.post(`/api/missions/${s.missionId}/equipe`, { utilisateur_id: id }))
        .statusCode,
    ).toBe(400);
    // Une invitation interne ne porte pas de rôle client.
    expect(
      (
        await s.a.associe.post("/api/invitations", {
          email: email(),
          roles: ["client_dirigeant"],
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe("utilisateurs du portail d'un client", () => {
  it("liste (gestionnaire du portail), sans hachage ; autre cabinet 404", async () => {
    const r = await s.a.chef.get(`/api/portail/utilisateurs?client_id=${s.a.clientId}`);
    expect(r.statusCode).toBe(200);
    const ids = r.json().utilisateurs.map((u: { id: string }) => u.id);
    expect(ids).toContain(s.dirigeant.utilisateurId);
    expect(ids).not.toContain(s.dirigeantA2.utilisateurId);
    expect(r.body).not.toMatch(/hash|mot_de_passe|jeton/);
    expect(
      (await s.a.associe.get(`/api/portail/utilisateurs?client_id=${s.b.clientId}`)).statusCode,
    ).toBe(404);
    expect((await s.a.associe.get("/api/portail/utilisateurs?client_id=x")).statusCode).toBe(400);
  });

  it("désactivation : sessions fermées, connexion refusée ; réactivation", async () => {
    const u = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]);
    expect((await u.get("/api/portail/moi")).statusCode).toBe(200);
    expect(
      (await s.a.associe.post(`/api/portail/utilisateurs/${u.utilisateurId}/desactiver`))
        .statusCode,
    ).toBe(200);
    expect((await u.get("/api/portail/moi")).statusCode).toBe(401);
    await expect(connecter(ctx, u.email)).rejects.toThrow();
    expect(
      (await s.dirigeantB.post(`/api/portail/utilisateurs/${u.utilisateurId}/reactiver`))
        .statusCode,
    ).toBe(403);
    expect(
      (await s.b.associe.post(`/api/portail/utilisateurs/${u.utilisateurId}/reactiver`)).statusCode,
    ).toBe(404);
    expect(
      (await s.a.associe.post(`/api/portail/utilisateurs/${u.utilisateurId}/reactiver`)).statusCode,
    ).toBe(200);
    expect((await api(ctx, await connecter(ctx, u.email)).get("/api/portail/moi")).statusCode).toBe(
      200,
    );
  });
});

describe("partages", () => {
  it("lecture par client ; consultant 403 ; autre cabinet 404", async () => {
    const r = await s.a.associe.get(`/api/portail/partages?client_id=${s.a.clientId}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().missions).toEqual([
      expect.objectContaining({ mission_id: s.missionId, jalons: true, factures: true }),
    ]);
    expect(r.json().documents.map((d: { document_id: string }) => d.document_id)).toEqual([
      s.documentId,
    ]);
    const consultant = await s.a.avecRoles(["consultant"]);
    expect(
      (await consultant.get(`/api/portail/partages?client_id=${s.a.clientId}`)).statusCode,
    ).toBe(403);
    expect(
      (await s.b.associe.get(`/api/portail/partages?client_id=${s.a.clientId}`)).statusCode,
    ).toBe(404);
  });

  it("refus : mission d'un autre client, document hors mission partagée, brouillon IA", async () => {
    const put = (corps: unknown) =>
      s.a.associe.put(`/api/portail/partages?client_id=${s.clientA2}`, corps);
    expect((await put({ missions: [{ mission_id: s.missionId }], documents: [] })).statusCode).toBe(
      400,
    );
    expect(
      (await put({ missions: [{ mission_id: s.missionA2 }], documents: [s.documentId] }))
        .statusCode,
    ).toBe(400);
    const putA1 = (corps: unknown) =>
      s.a.associe.put(`/api/portail/partages?client_id=${s.a.clientId}`, corps);
    expect(
      (
        await putA1({
          missions: [{ mission_id: s.missionId, jalons: true, factures: true }],
          documents: [s.documentId, s.documentBrouillonIa],
        })
      ).statusCode,
    ).toBe(400);
    // Les refus n'ont rien changé.
    const apres = (await s.dirigeant.get("/api/portail/missions")).json().elements;
    expect(apres.map((m: { id: string }) => m.id)).toEqual([s.missionId]);
  });

  it("un chef ne modifie que les partages des missions qu'il dirige ; les autres restent", async () => {
    const autreChef = await s.a.avecRoles(["chef_mission"]);
    const sienne = await creerMission(s.a, {
      intitule: "Mission de l'autre chef",
      chef_id: autreChef.utilisateurId,
    });
    const put = (corps: unknown) =>
      autreChef.put(`/api/portail/partages?client_id=${s.a.clientId}`, corps);
    expect((await put({ missions: [{ mission_id: s.missionId }], documents: [] })).statusCode).toBe(
      403,
    );
    const r = await put({ missions: [{ mission_id: sienne.id }], documents: [] });
    expect(r.statusCode).toBe(200);
    // Partage existant d'une mission qu'il ne dirige pas : intact.
    const vues = (await s.dirigeant.get("/api/portail/missions")).json().elements;
    expect(vues.map((m: { id: string }) => m.id).sort()).toEqual([s.missionId, sienne.id].sort());
    attendre(
      200,
      await put({ missions: [], documents: [] }),
      "retrait du partage par l'autre chef",
    );
    expect((await s.dirigeant.get("/api/portail/missions")).json().elements).toHaveLength(1);
  });

  it("par défaut rien : un nouveau client sans partage ne voit rien", async () => {
    const c = await s.a.associe.post("/api/clients", { raison_sociale: "Client sans partage" });
    await creerMission(s.a, { client_id: c.json().id });
    const u = await inviterClient(ctx, s.a.associe, c.json().id, ["client_dirigeant"]);
    expect((await u.get("/api/portail/missions")).json().elements).toEqual([]);
    expect((await u.get("/api/portail/factures")).json().elements).toEqual([]);
    expect((await u.get("/api/portail/moi")).json().partages).toEqual({
      missions: 0,
      documents: 0,
      factures: false,
    });
  });
});

describe("politique 2FA du portail", () => {
  it("modification : cabinet.gerer et 2FA active de l'auteur exigées", async () => {
    const corps = { tfa_obligatoire: true, mot_de_passe: MOT_DE_PASSE_TEST };
    expect((await s.a.chef.put("/api/portail/parametres", corps)).statusCode).toBe(403);
    const r = await s.a.associe.put("/api/portail/parametres", corps);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("TFA_INACTIVE");
  });

  it("appliquée : sans 2FA, l'utilisateur du portail ne reçoit que TFA_A_CONFIGURER", async () => {
    await proprietaire((c) =>
      c.query(
        `INSERT INTO portail_parametres (cabinet_id, tfa_obligatoire) VALUES ($1, true)
         ON CONFLICT (cabinet_id) DO UPDATE SET tfa_obligatoire = true`,
        [s.a.cabinetId],
      ),
    );
    try {
      const r = await s.dirigeant.get("/api/portail/missions");
      expect(r.statusCode).toBe(403);
      expect(r.json().erreur.code).toBe("TFA_A_CONFIGURER");
      const moi = (await s.dirigeant.get("/api/auth/moi")).json();
      expect(moi.tfa_a_configurer).toBe(true);
      expect((await s.dirigeant.get("/api/auth/2fa")).json().obligatoire).toBe(true);
      // Les internes ne sont pas concernés par la politique du portail.
      expect((await s.a.chef.get("/api/missions")).statusCode).toBe(200);
      // L'autre cabinet non plus.
      expect((await s.dirigeantB.get("/api/portail/missions")).statusCode).toBe(200);
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE portail_parametres SET tfa_obligatoire = false WHERE cabinet_id = $1", [
          s.a.cabinetId,
        ]),
      );
    }
    expect((await s.dirigeant.get("/api/portail/missions")).statusCode).toBe(200);
  });
});
