import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@missionpilot/shared";
import { api, type Api } from "./api.js";
import {
  attendre,
  factureEmise,
  preparerFacturation,
  type CabinetFacturation,
} from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, TOUS_LES_ROLES, type ApiUtilisateur } from "./missions-outils.js";
import { missionPlanifiable, utilisateurCollaborateur } from "./planification-outils.js";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let missionId: string;
let membre: ApiUtilisateur;
let horsEquipe: ApiUtilisateur;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Commentaires A");
  b = await preparerFacturation(ctx, "Cabinet Commentaires B");
  missionId = (await creerMission(a)).id;
  membre = await a.avecRoles(["consultant"]);
  horsEquipe = await a.avecRoles(["consultant"]);
  attendre(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: membre.utilisateurId,
    }),
    "équipe",
  );
});
afterAll(() => ctx.fermer());

const sur = (entite_id: string, entite_type = "mission") => ({ entite_type, entite_id });
const commenter = (par: Api, corps: Record<string, unknown>) =>
  par.post("/api/commentaires", corps);
const lister = (par: Api, entite_id: string, entite_type = "mission", extra = "") =>
  par.get(`/api/commentaires?entite_type=${entite_type}&entite_id=${entite_id}${extra}`);

async function commentaire(par: Api, corps: Record<string, unknown>): Promise<string> {
  const r = await commenter(par, corps);
  attendre(201, r, "commentaire");
  return r.json().id;
}

describe("commentaires contextuels (SOC-08)", () => {
  it("nominal : texte brut restitué tel quel (jamais interprété), fil chronologique paginé", async () => {
    const m = (await creerMission(a)).id;
    const piege = `<script>alert("x")</script> & <img src=x onerror=alert(1)>`;
    const r = await commenter(a.chef, { ...sur(m), texte: piege });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      texte: piege,
      auteur_id: a.chef.utilisateurId,
      supprime: false,
      mentions: [],
    });
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    await commentaire(a.directeur, { ...sur(m), texte: "Deuxième" });
    await commentaire(a.chef, { ...sur(m), texte: "Troisième" });
    const p1 = (await lister(a.associe, m, "mission", "&limite=2")).json();
    expect(p1.elements.map((c: { texte: string }) => c.texte)).toEqual([piege, "Deuxième"]);
    const p2 = (
      await lister(a.associe, m, "mission", `&limite=2&curseur=${p1.curseur_suivant}`)
    ).json();
    expect(p2.elements.map((c: { texte: string }) => c.texte)).toEqual(["Troisième"]);
    expect(p2.curseur_suivant).toBeNull();
  });

  it("validation : type d'entité hors liste blanche, texte vide ou trop long, champ inconnu → 400 ; 401", async () => {
    for (const corps of [
      { entite_type: "client", entite_id: missionId, texte: "x" },
      { ...sur(missionId), texte: "   " },
      { ...sur(missionId), texte: "x".repeat(5001) },
      { ...sur(missionId), texte: "x", auteur_id: a.chef.utilisateurId },
    ]) {
      expect((await commenter(a.chef, corps)).statusCode).toBe(400);
    }
    expect((await commenter(api(ctx), { ...sur(missionId), texte: "x" })).statusCode).toBe(401);
    expect((await lister(api(ctx), missionId)).statusCode).toBe(401);
  });

  it("visibilité de l'entité à chaque lecture et écriture : hors équipe → 404", async () => {
    const id = await commentaire(membre, { ...sur(missionId), texte: "Point d'étape" });
    expect((await lister(membre, missionId)).statusCode).toBe(200);
    expect((await lister(horsEquipe, missionId)).statusCode).toBe(404);
    expect((await commenter(horsEquipe, { ...sur(missionId), texte: "x" })).statusCode).toBe(404);
    expect((await horsEquipe.patch(`/api/commentaires/${id}`, { texte: "y" })).statusCode).toBe(
      404,
    );
    expect((await horsEquipe.delete(`/api/commentaires/${id}`)).statusCode).toBe(404);
    expect((await horsEquipe.get(`/api/commentaires/${id}/historique`)).statusCode).toBe(404);
    // Retiré de l'équipe : il perd l'accès à ses propres commentaires.
    const passager = await a.avecRoles(["consultant"]);
    const m = (await creerMission(a)).id;
    await a.chef.post(`/api/missions/${m}/equipe`, { utilisateur_id: passager.utilisateurId });
    const sien = await commentaire(passager, { ...sur(m), texte: "Le mien" });
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("DELETE FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2", [
        m,
        passager.utilisateurId,
      ]),
    );
    expect((await passager.patch(`/api/commentaires/${sien}`, { texte: "z" })).statusCode).toBe(
      404,
    );
  });

  it("isolation : commentaire et entité d'un autre cabinet → 404, par identifiant connu", async () => {
    const mb = (await creerMission(b)).id;
    const id = await commentaire(b.chef, { ...sur(mb), texte: "Interne B" });
    expect((await lister(a.associe, mb)).statusCode).toBe(404);
    expect((await commenter(a.associe, { ...sur(mb), texte: "intrus" })).statusCode).toBe(404);
    expect((await a.associe.patch(`/api/commentaires/${id}`, { texte: "x" })).statusCode).toBe(404);
    expect((await a.associe.delete(`/api/commentaires/${id}`)).statusCode).toBe(404);
    expect((await a.associe.get(`/api/commentaires/${id}/historique`)).statusCode).toBe(404);
  });

  it("matrice des 8 rôles : chacun commente une mission qu'il voit ; l'expert externe, ses seules missions", async () => {
    const m = (await creerMission(a)).id;
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role as Role]);
      const voitTout = ["associe", "directeur_mission", "ressources", "gestionnaire"].includes(
        role,
      );
      const avant = await commenter(u, { ...sur(m), texte: `Avant ${role}` });
      expect(avant.statusCode, role).toBe(voitTout ? 201 : 404);
      await a.chef.post(`/api/missions/${m}/equipe`, { utilisateur_id: u.utilisateurId });
      expect((await commenter(u, { ...sur(m), texte: `Membre ${role}` })).statusCode, role).toBe(
        201,
      );
    }
  });

  it("mentions : même cabinet, actif, voyant l'entité → notifiés (sans le texte) ; sinon 400", async () => {
    const m = (await creerMission(a)).id;
    await a.chef.post(`/api/missions/${m}/equipe`, { utilisateur_id: membre.utilisateurId });
    const r = await commenter(a.chef, {
      ...sur(m),
      texte: "@Consultant peux-tu relire le chiffrage confidentiel ?",
      mentions: [membre.utilisateurId, a.chef.utilisateurId],
    });
    expect(r.statusCode).toBe(201);
    // Se mentionner soi-même est ignoré.
    expect(r.json().mentions).toEqual([{ id: membre.utilisateurId, nom: "Utilisateur Test" }]);
    const notes = (await membre.get("/api/notifications?limite=100")).json().elements as {
      type: string;
      titre: string;
      corps: string;
      lien: string;
    }[];
    const note = notes.find((n) => n.type === "mention_commentaire" && n.lien === `/missions/${m}`);
    expect(note?.titre).toMatch(/vous a mentionné/);
    expect(JSON.stringify(note)).not.toMatch(/chiffrage/);
    // Utilisateur d'un autre cabinet : inconnu.
    const autreCabinet = await b.avecRoles(["consultant"]);
    expect(
      (await commenter(a.chef, { ...sur(m), texte: "x", mentions: [autreCabinet.utilisateurId] }))
        .statusCode,
    ).toBe(400);
    // Utilisateur qui ne voit pas la mission.
    expect(
      (await commenter(a.chef, { ...sur(m), texte: "x", mentions: [horsEquipe.utilisateurId] }))
        .statusCode,
    ).toBe(400);
    // Utilisateur inactif.
    const parti = await a.avecRoles(["directeur_mission"]);
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [parti.utilisateurId]),
    );
    expect(
      (await commenter(a.chef, { ...sur(m), texte: "x", mentions: [parti.utilisateurId] }))
        .statusCode,
    ).toBe(400);
    // Personnes mentionnables : celles qui voient l'entité, sans courriel.
    const mentionnables = (
      await a.chef.get(`/api/commentaires/mentionnables?entite_type=mission&entite_id=${m}`)
    ).json().elements as { id: string }[];
    const ids = mentionnables.map((u) => u.id);
    expect(ids).toContain(membre.utilisateurId);
    expect(ids).not.toContain(horsEquipe.utilisateurId);
    expect(ids).not.toContain(parti.utilisateurId);
    expect(ids).not.toContain(a.chef.utilisateurId);
    expect(JSON.stringify(mentionnables)).not.toMatch(/@/);
    expect(
      (await horsEquipe.get(`/api/commentaires/mentionnables?entite_type=mission&entite_id=${m}`))
        .statusCode,
    ).toBe(404);
  });

  it("modification : l'auteur, dans les 15 minutes, avec historique ; ensuite 409", async () => {
    const id = await commentaire(a.chef, { ...sur(missionId), texte: "Version 1" });
    expect((await a.directeur.patch(`/api/commentaires/${id}`, { texte: "x" })).statusCode).toBe(
      403,
    );
    const m = await a.chef.patch(`/api/commentaires/${id}`, { texte: "Version 2" });
    expect(m.statusCode).toBe(200);
    expect(m.json().texte).toBe("Version 2");
    expect(m.json().modifie_le).not.toBeNull();
    const h = (await membre.get(`/api/commentaires/${id}/historique`)).json().elements;
    expect(h.map((x: { texte: string }) => x.texte)).toEqual(["Version 1", "Version 2"]);
    // 16 minutes plus tard : fenêtre fermée (contrôle applicatif ET déclencheur).
    await proprietaire((cl) =>
      cl.query("UPDATE commentaires SET cree_le = now() - interval '16 minutes' WHERE id = $1", [
        id,
      ]),
    );
    const tard = await a.chef.patch(`/api/commentaires/${id}`, { texte: "Version 3" });
    expect(tard.statusCode).toBe(409);
    expect(tard.json().erreur.code).toBe("DELAI_MODIFICATION_DEPASSE");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          "INSERT INTO commentaire_revisions (cabinet_id, commentaire_id, texte) VALUES ($1, $2, 'x')",
          [a.cabinetId, id],
        ),
      ),
    ).rejects.toThrow(/Délai de modification dépassé/);
  });

  it("suppression logique : auteur ou associé ; le fil garde la trace sans le texte", async () => {
    const id = await commentaire(membre, { ...sur(missionId), texte: "À retirer" });
    expect((await a.chef.delete(`/api/commentaires/${id}`)).statusCode).toBe(403);
    expect((await membre.delete(`/api/commentaires/${id}`)).statusCode).toBe(204);
    expect((await membre.delete(`/api/commentaires/${id}`)).statusCode).toBe(409);
    expect((await membre.patch(`/api/commentaires/${id}`, { texte: "x" })).statusCode).toBe(409);
    expect((await membre.get(`/api/commentaires/${id}/historique`)).statusCode).toBe(409);
    const fil = (await lister(a.chef, missionId, "mission", "&limite=100")).json().elements;
    expect(fil.find((c: { id: string }) => c.id === id)).toMatchObject({
      supprime: true,
      texte: null,
      supprime_par: membre.utilisateurId,
    });
    const autre = await commentaire(membre, { ...sur(missionId), texte: "Modéré" });
    expect((await a.associe.delete(`/api/commentaires/${autre}`)).statusCode).toBe(204);
  });

  it("en base : ni UPDATE ni DELETE des commentaires, révisions et suppressions", async () => {
    const id = await commentaire(a.chef, { ...sur(missionId), texte: "Immuable" });
    for (const sql of [
      "UPDATE commentaires SET texte = 'x' WHERE id = $1",
      "DELETE FROM commentaires WHERE id = $1",
      "UPDATE commentaire_revisions SET texte = 'x' WHERE commentaire_id = $1",
      "DELETE FROM commentaire_revisions WHERE commentaire_id = $1",
      "DELETE FROM commentaire_suppressions WHERE commentaire_id = $1",
    ]) {
      await expect(ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, [id]))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("entités commentables : tâche, facture, débours, opportunité, proposition", () => {
  it("tâche de mission : visible de l'équipe de la mission", async () => {
    const m = await missionPlanifiable(a);
    expect(
      (await commenter(a.chef, { ...sur(m.tacheId, "mission_tache"), texte: "Tâche" })).statusCode,
    ).toBe(201);
    expect((await lister(horsEquipe, m.tacheId, "mission_tache")).statusCode).toBe(404);
    // Une tâche d'une autre mission ne s'utilise pas comme identifiant de mission.
    expect((await commenter(a.chef, { ...sur(m.tacheId), texte: "x" })).statusCode).toBe(404);
  });

  it("facture : « facture.lire » et mission visible ; sans droit de facture → 404", async () => {
    const { facture } = await factureEmise(a);
    const id = facture.id as string;
    expect(
      (await commenter(a.gestionnaire, { ...sur(id, "facture"), texte: "Relancer" })).statusCode,
    ).toBe(201);
    expect((await lister(a.associe, id, "facture")).statusCode).toBe(200);
    const consultant = await a.avecRoles(["consultant"]);
    expect((await lister(consultant, id, "facture")).statusCode).toBe(404);
    const fb = await factureEmise(b);
    expect((await lister(a.gestionnaire, fb.facture.id as string, "facture")).statusCode).toBe(404);
  });

  it("débours : son auteur et ses valideurs ; un collègue → 404 ; suppression du brouillon emporte ses commentaires", async () => {
    const auteur = await utilisateurCollaborateur(a, ["consultant"]);
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: auteur.utilisateurId,
    });
    const d = await auteur.post(`/api/missions/${missionId}/debours`, {
      date: "2026-10-05",
      categorie: "transport",
      libelle: "Taxi",
      montant: 5000,
    });
    attendre(201, d, "débours");
    const id = d.json().id as string;
    await commentaire(auteur, { ...sur(id, "debours"), texte: "Reçu égaré" });
    expect((await lister(a.chef, id, "debours")).json().elements).toHaveLength(1);
    expect((await lister(membre, id, "debours")).statusCode).toBe(404);
    expect((await auteur.delete(`/api/debours/${id}`)).statusCode).toBe(204);
    const restants = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT count(*)::int AS n FROM commentaires WHERE debours_id = $1", [id]))
          .rows[0].n,
    );
    expect(restants).toBe(0);
  });

  it("opportunité et proposition : « pipeline.gerer » ; sans ce droit → 404", async () => {
    const o = await a.chef.post("/api/opportunites", {
      client_id: a.clientId,
      intitule: "Plan stratégique Lagune",
      type_mission_id: a.typePlanId,
      montant_estime: 25_000_000,
    });
    attendre(201, o, "opportunité");
    const p = await a.chef.post(`/api/opportunites/${o.json().id}/propositions`, {});
    attendre(201, p, "proposition");
    for (const [type, id] of [
      ["opportunite", o.json().id],
      ["proposition", p.json().id],
    ] as const) {
      expect((await commenter(a.chef, { ...sur(id, type), texte: "Go" })).statusCode).toBe(201);
      expect((await lister(membre, id, type)).statusCode).toBe(404);
      expect((await lister(b.associe, id, type)).statusCode).toBe(404);
    }
  });
});
