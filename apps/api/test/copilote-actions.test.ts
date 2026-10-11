import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actionProposeeSchema,
  EXPIRATION_ACTION_COPILOTE_MINUTES,
  reponseCopiloteSchema,
  resultatActionCopiloteSchema,
  type ActionProposeeCopilote,
} from "@missionpilot/shared";
import { AppError } from "../src/errors.js";
import { annulerAction, confirmerAction, empreinteParametres } from "../src/copilote/actions.js";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { authDe } from "./ia-outils.js";
import { inviterClient } from "./portail-outils.js";
import {
  creerMissionSignee,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Copilote (AGT-08) : une action modifiante n'est JAMAIS exécutée par le copilote. Il PROPOSE
 * (carte avec résumé exact, expiration à 5 minutes) ; l'utilisateur confirme (même utilisateur,
 * usage unique, droits revérifiés) ou annule. Sur vrai PostgreSQL, mode sans IA.
 */

vi.setConfig({ testTimeout: 60_000 });

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let chef: ApiUtilisateur;
let directeur: ApiUtilisateur;
let consultant: ApiUtilisateur;
let awa: ApiUtilisateur;
let awaTraore: ApiUtilisateur;
let missionId: string;

const renommer = (id: string, nom: string) =>
  proprietaire((cl) => cl.query("UPDATE utilisateurs SET nom = $2 WHERE id = $1", [id, nom]));

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Copilote Actions A");
  b = await preparerCabinet(ctx, "Cabinet Copilote Actions B");
  chef = await a.avecRoles(["chef_mission"]);
  directeur = await a.avecRoles(["directeur_mission"]);
  consultant = await a.avecRoles(["consultant"]);
  awa = await a.avecRoles(["consultant"]);
  awaTraore = await a.avecRoles(["consultant"]);
  await renommer(awa.utilisateurId, "Awa Koné");
  await renommer(awaTraore.utilisateurId, "Awa Traoré");
  await renommer(consultant.utilisateurId, "Basile Yao");
  missionId = (await creerMissionSignee(a, { intitule: "Plan stratégique Delta" })).id;
}, 120_000);
afterAll(() => ctx.fermer());

const poser = (u: Api, message: string, contexte?: { mission_id: string }) =>
  u.post("/api/copilote/messages", { message, ...(contexte ? { contexte } : {}) });

async function proposer(u: Api, message: string): Promise<ActionProposeeCopilote> {
  const r = await poser(u, message);
  expect(r.statusCode, r.body).toBe(200);
  const rep = reponseCopiloteSchema.parse(r.json());
  expect(rep.statut, rep.texte).toBe("action_proposee");
  expect(rep.outil).toBe("creer_tache");
  expect(rep.mode).toBe("deterministe");
  return actionProposeeSchema.parse(rep.action);
}

const taches = (titre?: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT id, titre, assignee_id, cree_par, echeance::text AS echeance, entite_type, mission_id
           FROM taches_collaboration WHERE cabinet_id = $1 AND ($2::text IS NULL OR titre = $2)
           ORDER BY cree_le`,
          [a.cabinetId, titre ?? null],
        )
      ).rows,
  );

const ligne = (id: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT statut, outil, parametres, empreinte, resume, resultat_id, decide_le, cree_le, expire_le, utilisateur_id
           FROM copilote_actions WHERE id = $1`,
          [id],
        )
      ).rows[0],
  );

const journal = (action: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          "SELECT utilisateur_id, entite_id, details FROM journal_audit WHERE cabinet_id = $1 AND action = $2 ORDER BY id",
          [a.cabinetId, action],
        )
      ).rows,
  );

describe("proposition", () => {
  it("le copilote PROPOSE : rien n'est créé, la carte porte le résumé exact et l'expiration", async () => {
    const avant = (await taches()).length;
    const action = await proposer(chef, "Crée une tâche : préparer le comité avant le 15/11/2030");
    expect(action).toMatchObject({
      outil: "creer_tache",
      libelle: "Créer une tâche",
      resume:
        "Créer la tâche « Préparer le comité », pour vous, échéance le 15/11/2030, sans mission liée.",
    });
    expect((await taches()).length).toBe(avant);
    const l = await ligne(action.action_id);
    expect(l).toMatchObject({
      statut: "proposee",
      outil: "creer_tache",
      resume: action.resume,
      resultat_id: null,
      decide_le: null,
      utilisateur_id: chef.utilisateurId,
    });
    // Paramètres RÉSOLUS (identifiants), empreinte SHA-256 de ces paramètres.
    expect(l.parametres).toEqual({
      titre: "Préparer le comité",
      echeance: "2030-11-15",
      assignee_id: chef.utilisateurId,
      mission_id: null,
    });
    expect(l.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(l.empreinte).toBe(empreinteParametres(l.parametres));
    const duree = new Date(l.expire_le).getTime() - new Date(l.cree_le).getTime();
    expect(duree).toBe(EXPIRATION_ACTION_COPILOTE_MINUTES * 60_000);
    expect(new Date(action.expire_le).getTime()).toBe(new Date(l.expire_le).getTime());
    expect((await journal("copilote.action_proposee")).at(-1)).toMatchObject({
      utilisateur_id: chef.utilisateurId,
      entite_id: action.action_id,
      details: { outil: "creer_tache" },
    });
  });

  it("titre manquant, date invalide, outil non permis : aucune proposition inscrite", async () => {
    const avant = await proprietaire(
      async (cl) =>
        (
          await cl.query("SELECT count(*)::int AS n FROM copilote_actions WHERE cabinet_id = $1", [
            a.cabinetId,
          ])
        ).rows[0].n,
    );
    const sansTitre = reponseCopiloteSchema.parse((await poser(chef, "crée une tâche")).json());
    expect(sansTitre).toMatchObject({ statut: "precision_requise", outil: "creer_tache" });
    expect(sansTitre.action).toBeUndefined();
    const invalide = reponseCopiloteSchema.parse(
      (await poser(chef, "crée une tâche : x avant le 31/02/2030")).json(),
    );
    expect(invalide.statut).toBe("precision_requise");
    const refus = reponseCopiloteSchema.parse(
      (await poser(consultant, "crée une tâche : lire le rapport")).json(),
    );
    expect(refus).toMatchObject({
      statut: "refuse",
      texte: "Vous n'avez pas le droit d'effectuer cette action.",
    });
    const apres = await proprietaire(
      async (cl) =>
        (
          await cl.query("SELECT count(*)::int AS n FROM copilote_actions WHERE cabinet_id = $1", [
            a.cabinetId,
          ])
        ).rows[0].n,
    );
    expect(apres).toBe(avant);
  });
});

describe("confirmation", () => {
  it("le même utilisateur confirme : la tâche est créée par le service, tout est journalisé, usage unique", async () => {
    const action = await proposer(chef, "Crée une tâche : appeler le directeur financier");
    const r = await chef.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    const resultat = resultatActionCopiloteSchema.parse(r.json());
    expect(resultat.statut).toBe("confirmee");
    expect(resultat.texte).toBe("La tâche « Appeler le directeur financier » a été créée.");
    const [tache] = await taches("Appeler le directeur financier");
    expect(tache).toMatchObject({
      assignee_id: chef.utilisateurId,
      cree_par: chef.utilisateurId,
      echeance: null,
      entite_type: null,
    });
    expect(resultat.elements[0]?.lien).toBe(`/mes-taches/${tache.id}`);
    // L'action est « confirmee », rattachée à son résultat.
    const l = await ligne(action.action_id);
    expect(l).toMatchObject({ statut: "confirmee", resultat_id: tache.id });
    expect(l.decide_le).not.toBeNull();
    // Journal : action confirmée par l'utilisateur ET création de la tâche (via le copilote).
    expect((await journal("copilote.action_confirmee")).at(-1)).toMatchObject({
      utilisateur_id: chef.utilisateurId,
      entite_id: action.action_id,
      details: { outil: "creer_tache", resultat_id: tache.id },
    });
    const creation = (await journal("creation")).filter((j) => j.entite_id === tache.id);
    expect(creation[0]?.details).toMatchObject({ via: "copilote" });
    // La tâche se retrouve dans la route habituelle de l'utilisateur.
    const liste = (await chef.get("/api/taches-collaboration")).json().elements as {
      titre: string;
    }[];
    expect(liste.map((t) => t.titre)).toContain("Appeler le directeur financier");
    // Usage UNIQUE : une seconde confirmation est refusée, une seule tâche existe.
    const encore = await chef.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(encore.statusCode).toBe(409);
    expect(encore.json().erreur.message).toContain("déjà été confirmée");
    expect(await taches("Appeler le directeur financier")).toHaveLength(1);
    // Ni l'annulation d'une action confirmée.
    expect((await chef.post(`/api/copilote/actions/${action.action_id}/annuler`)).statusCode).toBe(
      409,
    );
  });

  it("deux confirmations SIMULTANÉES : une seule réussit (verrou de ligne)", async () => {
    const action = await proposer(chef, "Crée une tâche : envoyer la facture de solde");
    const url = `/api/copilote/actions/${action.action_id}/confirmer`;
    const reponses = await Promise.all([chef.post(url), chef.post(url), chef.post(url)]);
    expect(reponses.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect(await taches("Envoyer la facture de solde")).toHaveLength(1);
  });

  it("un AUTRE utilisateur (même cabinet) ou un autre cabinet ne peut ni confirmer ni annuler : 404", async () => {
    const action = await proposer(chef, "Crée une tâche : tâche d'un autre");
    const intrus = [directeur, a.associe, b.associe] as Api[];
    for (const u of intrus) {
      expect((await u.post(`/api/copilote/actions/${action.action_id}/confirmer`)).statusCode).toBe(
        404,
      );
      expect((await u.post(`/api/copilote/actions/${action.action_id}/annuler`)).statusCode).toBe(
        404,
      );
    }
    // Même réponse qu'une proposition inexistante.
    const inconnue = await directeur.post(
      "/api/copilote/actions/00000000-0000-4000-8000-000000000000/confirmer",
    );
    expect(inconnue.statusCode).toBe(404);
    expect((await taches("Tâche d'un autre")).length).toBe(0);
    expect((await ligne(action.action_id)).statut).toBe("proposee");
    // L'auteur, lui, la confirme toujours.
    expect(
      (await chef.post(`/api/copilote/actions/${action.action_id}/confirmer`)).statusCode,
    ).toBe(200);
    // Identifiant mal formé : 400.
    expect((await chef.post("/api/copilote/actions/pas-un-uuid/confirmer")).statusCode).toBe(400);
  });

  it("une proposition EXPIRÉE est refusée et ne s'exécute pas (horloge injectée, borne comprise)", async () => {
    const action = await proposer(chef, "Crée une tâche : tâche expirée");
    const auth = await authDe(ctx, a.cabinetId, chef.utilisateurId);
    const l = await ligne(action.action_id);
    const expire = new Date(l.expire_le);
    const erreur = await confirmerAction(ctx.db, auth, action.action_id, expire).catch(
      (e: unknown) => e,
    );
    expect(erreur).toBeInstanceOf(AppError);
    expect(erreur).toMatchObject({ statut: 410, code: "ACTION_EXPIREE" });
    expect(await taches("Tâche expirée")).toHaveLength(0);
    expect((await ligne(action.action_id)).statut).toBe("expiree");
    // État terminal : plus de confirmation ni d'annulation.
    expect(
      (await chef.post(`/api/copilote/actions/${action.action_id}/confirmer`)).statusCode,
    ).toBe(409);
    expect((await chef.post(`/api/copilote/actions/${action.action_id}/annuler`)).statusCode).toBe(
      409,
    );
    expect((await journal("copilote.action_refusee")).at(-1)?.details).toMatchObject({
      motif: "expiree",
    });
    // Une seconde avant l'expiration, elle aurait réussi.
    const autre = await proposer(chef, "Crée une tâche : tâche juste à temps");
    const lAutre = await ligne(autre.action_id);
    const juste = new Date(new Date(lAutre.expire_le).getTime() - 1000);
    const ok = await confirmerAction(ctx.db, auth, autre.action_id, juste);
    expect(ok.resultat.statut).toBe("confirmee");
  });

  it("permission RETIRÉE entre la proposition et la confirmation : refus 403, proposition « refusee »", async () => {
    const u = await a.avecRoles(["chef_mission"]);
    const action = await proposer(u, "Crée une tâche : tâche sans droit");
    await proprietaire((cl) =>
      cl.query("UPDATE utilisateurs SET roles = '{consultant}' WHERE id = $1", [u.utilisateurId]),
    );
    const r = await u.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(r.statusCode, r.body).toBe(403);
    expect(await taches("Tâche sans droit")).toHaveLength(0);
    expect((await ligne(action.action_id)).statut).toBe("refusee");
    expect((await journal("copilote.action_refusee")).at(-1)?.details).toMatchObject({
      motif: "permission_retiree",
    });
    expect((await u.post(`/api/copilote/actions/${action.action_id}/confirmer`)).statusCode).toBe(
      409,
    );
  });

  it("l'empreinte est relue : des paramètres altérés hors du copilote sont refusés", async () => {
    const action = await proposer(chef, "Crée une tâche : tâche altérée");
    // Altération par le propriétaire de la base en contournant le déclencheur (hors du périmètre applicatif).
    await proprietaire(async (cl) => {
      await cl.query("ALTER TABLE copilote_actions DISABLE TRIGGER copilote_actions_controle");
      try {
        await cl.query(
          `UPDATE copilote_actions SET parametres = jsonb_set(parametres, '{titre}', '"Autre titre"') WHERE id = $1`,
          [action.action_id],
        );
      } finally {
        await cl.query("ALTER TABLE copilote_actions ENABLE TRIGGER copilote_actions_controle");
      }
    });
    const r = await chef.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(r.statusCode).toBe(409);
    expect(await taches("Autre titre")).toHaveLength(0);
    expect((await ligne(action.action_id)).statut).toBe("refusee");
  });
});

describe("annulation", () => {
  it("annule la proposition : rien n'est créé, elle ne se confirme plus", async () => {
    const action = await proposer(chef, "Crée une tâche : tâche annulée");
    const r = await chef.post(`/api/copilote/actions/${action.action_id}/annuler`);
    expect(r.statusCode).toBe(200);
    expect(resultatActionCopiloteSchema.parse(r.json())).toMatchObject({
      statut: "annulee",
      elements: [],
    });
    expect(await taches("Tâche annulée")).toHaveLength(0);
    expect((await ligne(action.action_id)).statut).toBe("annulee");
    expect((await journal("copilote.action_annulee")).at(-1)).toMatchObject({
      utilisateur_id: chef.utilisateurId,
      entite_id: action.action_id,
    });
    const encore = await chef.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(encore.statusCode).toBe(409);
    expect(encore.json().erreur.message).toContain("annulée");
    expect((await chef.post(`/api/copilote/actions/${action.action_id}/annuler`)).statusCode).toBe(
      409,
    );
  });

  it("le service refuse aussi l'annulation d'autrui (404)", async () => {
    const action = await proposer(chef, "Crée une tâche : tâche d'autrui annulée");
    const auth = await authDe(ctx, a.cabinetId, directeur.utilisateurId);
    await expect(annulerAction(ctx.db, auth, action.action_id, new Date())).rejects.toMatchObject({
      statut: 404,
    });
  });
});

describe("tâche pour un collaborateur, liée à une mission", () => {
  it("résout le nom (accents ignorés) et notifie l'assigné", async () => {
    const action = await proposer(
      directeur,
      "Crée une tâche pour awa kone : relire l'offre avant le 20/11/2030",
    );
    expect(action.resume).toBe(
      "Créer la tâche « Relire l'offre », pour Awa Koné, échéance le 20/11/2030, sans mission liée.",
    );
    const r = await directeur.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(r.statusCode, r.body).toBe(200);
    const [t] = await taches("Relire l'offre");
    expect(t).toMatchObject({ assignee_id: awa.utilisateurId, cree_par: directeur.utilisateurId });
    const notifs = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT titre FROM notifications WHERE destinataire_id = $1 AND type = 'tache_assignee'",
            [awa.utilisateurId],
          )
        ).rows,
    );
    expect(notifs).toHaveLength(1);
    // L'assigné la voit dans « mes tâches ».
    const vue = reponseCopiloteSchema.parse((await poser(awa, "mes tâches")).json());
    expect(vue.texte).toContain("Vous avez 1 tâche ouverte");
  });

  it("nom inconnu ou ambigu : on demande de préciser, rien n'est proposé", async () => {
    const inconnu = reponseCopiloteSchema.parse(
      (await poser(directeur, "Crée une tâche pour Zorglub Inconnu : x")).json(),
    );
    expect(inconnu.statut).toBe("precision_requise");
    expect(inconnu.texte).toContain("aucun collaborateur");
    const ambigu = reponseCopiloteSchema.parse(
      (await poser(directeur, "Crée une tâche pour Awa : x")).json(),
    );
    expect(ambigu.statut).toBe("precision_requise");
    expect(ambigu.texte).toContain("Awa Koné");
    expect(ambigu.texte).toContain("Awa Traoré");
    expect(ambigu.action).toBeUndefined();
    // Le nom complet lève l'ambiguïté.
    const ok = await proposer(directeur, "Crée une tâche pour Awa Traoré : x");
    expect(ok.resume).toContain("pour Awa Traoré");
  });

  it("mission liée : visible du créateur ET de l'assigné, sinon on précise ; vérifié à nouveau à la confirmation", async () => {
    // Le directeur voit la mission ; Awa Koné (consultante hors équipe) non.
    const horsEquipe = reponseCopiloteSchema.parse(
      (
        await poser(
          directeur,
          "Crée une tâche pour Awa Koné : cadrer sur la mission Plan stratégique Delta",
        )
      ).json(),
    );
    expect(horsEquipe.statut).toBe("precision_requise");
    expect(horsEquipe.texte).toBe("Awa Koné n'a pas accès à cette mission.");
    // Mission inexistante ou invisible du créateur : la même phrase.
    const invisible = reponseCopiloteSchema.parse(
      (await poser(consultant, "Crée une tâche : x sur la mission Plan stratégique Delta")).json(),
    );
    expect(invisible.statut).toBe("refuse");
    // Awa Traoré rejoint l'équipe : la proposition est possible.
    attendre201(
      await a.chef.post(`/api/missions/${missionId}/equipe`, {
        utilisateur_id: awaTraore.utilisateurId,
      }),
    );
    const action = await proposer(
      directeur,
      "Crée une tâche pour Awa Traoré : cadrer le périmètre sur la mission Plan stratégique Delta",
    );
    expect(action.resume).toBe(
      "Créer la tâche « Cadrer le périmètre », pour Awa Traoré, sans échéance, liée à la mission « Plan stratégique Delta ».",
    );
    // Elle quitte l'équipe avant la confirmation : le service existant refuse, la proposition reste ouverte.
    await proprietaire((cl) =>
      cl.query("DELETE FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2", [
        missionId,
        awaTraore.utilisateurId,
      ]),
    );
    const r = await directeur.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.message).toContain("n'a pas accès à l'élément lié");
    expect(await taches("Cadrer le périmètre")).toHaveLength(0);
    expect((await ligne(action.action_id)).statut).toBe("proposee");
    // Elle revient : la même proposition aboutit, avec la mission liée.
    attendre201(
      await a.chef.post(`/api/missions/${missionId}/equipe`, {
        utilisateur_id: awaTraore.utilisateurId,
      }),
    );
    expect(
      (await directeur.post(`/api/copilote/actions/${action.action_id}/confirmer`)).statusCode,
    ).toBe(200);
    expect((await taches("Cadrer le périmètre"))[0]).toMatchObject({
      entite_type: "mission",
      mission_id: missionId,
      assignee_id: awaTraore.utilisateurId,
    });
  });
});

describe("table copilote_actions (migration 0271)", () => {
  it("transitions en ajout seul : un état terminal est figé (MPG10), l'identité aussi (MPG11)", async () => {
    const action = await proposer(chef, "Crée une tâche : tâche pour les déclencheurs");
    const id = action.action_id;
    const modifier = (sql: string, params: unknown[] = []) =>
      ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, [id, ...params]));
    // Identité : jamais modifiable (le droit de colonne l'interdit déjà pour le rôle applicatif).
    await expect(
      modifier("UPDATE copilote_actions SET resume = 'autre' WHERE id = $1"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      modifier("UPDATE copilote_actions SET parametres = '{}' WHERE id = $1"),
    ).rejects.toThrow(/permission denied/);
    // Le propriétaire passe le droit de colonne, pas le déclencheur.
    await expect(
      proprietaire((cl) =>
        cl.query("UPDATE copilote_actions SET resume = 'autre' WHERE id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPG11" });
    // Une proposition ne « change » que par sa décision ; confirmée sans résultat : refusé.
    await expect(
      modifier("UPDATE copilote_actions SET decide_le = now() WHERE id = $1"),
    ).rejects.toThrow();
    await expect(
      modifier("UPDATE copilote_actions SET statut = 'confirmee', decide_le = now() WHERE id = $1"),
    ).rejects.toThrow();
    // Annulée : terminale, figée.
    await chef.post(`/api/copilote/actions/${id}/annuler`);
    await expect(
      modifier("UPDATE copilote_actions SET statut = 'proposee', decide_le = NULL WHERE id = $1"),
    ).rejects.toMatchObject({ code: "MPG10" });
    await expect(
      modifier("UPDATE copilote_actions SET statut = 'refusee' WHERE id = $1"),
    ).rejects.toMatchObject({ code: "MPG10" });
    // Jamais de suppression.
    await expect(modifier("DELETE FROM copilote_actions WHERE id = $1")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("une action naît « proposee » (MPG10) ; la confirmation exige un résultat", async () => {
    const insere = (statut: string, decide: string | null, resultat: string | null) =>
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume,
             statut, cree_le, expire_le, decide_le, resultat_id)
           VALUES ($1, $2, 'creer_tache', '{}', $3, 'r', $4, now(), now() + interval '5 minutes', $5, $6)`,
          [a.cabinetId, chef.utilisateurId, "a".repeat(64), statut, decide, resultat],
        ),
      );
    await expect(
      insere("confirmee", "2030-01-01", "11111111-1111-4111-8111-111111111111"),
    ).rejects.toMatchObject({ code: "MPG10" });
    await expect(insere("proposee", null, null)).resolves.toBeDefined();
    await expect(insere("confirmee", "2030-01-01", null)).rejects.toThrow();
  });

  it("isolée par cabinet (RLS) : l'autre cabinet n'en voit aucune", async () => {
    const vues = await ctx.db.withTenant(
      b.cabinetId,
      async (db) =>
        (await db.query("SELECT count(*)::int AS n FROM copilote_actions")).rows[0].n as number,
    );
    expect(vues).toBe(0);
    const miennes = await ctx.db.withTenant(
      a.cabinetId,
      async (db) =>
        (await db.query("SELECT count(*)::int AS n FROM copilote_actions")).rows[0].n as number,
    );
    expect(miennes).toBeGreaterThan(5);
    // Écrire dans l'autre cabinet : refusé par RLS.
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume, expire_le)
           VALUES ($1, $2, 'creer_tache', '{}', $3, 'r', now() + interval '5 minutes')`,
          [a.cabinetId, chef.utilisateurId, "a".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("journal sans texte", () => {
  it("ni le titre d'une tâche ni le message ne figurent dans le journal d'audit", async () => {
    const titre = "SecretTitreTache4242";
    const action = await proposer(chef, `Crée une tâche : ${titre}`);
    await chef.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    const tout = await proprietaire(async (cl) =>
      (
        await cl.query("SELECT details::text AS d FROM journal_audit WHERE cabinet_id = $1", [
          a.cabinetId,
        ])
      ).rows
        .map((x) => x.d as string)
        .join("\n"),
    );
    expect(tout).not.toContain(titre);
    expect(api(ctx)).toBeDefined();
  });
});

function attendre201(r: { statusCode: number; body: string }) {
  if (r.statusCode !== 201) throw new Error(`${r.statusCode} ${r.body}`);
}

describe("personnes du portail client : jamais assignées, jamais proposées, jamais prévenues", () => {
  const notifsEtTaches = (id: string) =>
    proprietaire(async (cl) => ({
      notifications: (
        await cl.query("SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1", [
          id,
        ])
      ).rows[0].n as number,
      taches: (
        await cl.query(
          "SELECT count(*)::int AS n FROM taches_collaboration WHERE assignee_id = $1",
          [id],
        )
      ).rows[0].n as number,
      emails: (
        await cl.query(
          "SELECT count(*)::int AS n FROM jobs WHERE cabinet_id = $1 AND type = 'envoyer_email' AND charge::text LIKE '%' || $2 || '%'",
          [a.cabinetId, id],
        )
      ).rows[0].n as number,
    }));

  it("une personne du portail n'est ni résolue ni listée en cas d'ambiguïté : « aucun collaborateur »", async () => {
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_contributeur"]);
    await renommer(client.utilisateurId, "Zoé Cliente Externe");
    const compte = async () =>
      proprietaire(
        async (cl) =>
          (
            await cl.query(
              "SELECT count(*)::int AS n FROM copilote_actions WHERE cabinet_id = $1",
              [a.cabinetId],
            )
          ).rows[0].n as number,
      );
    const avant = await compte();
    const r = reponseCopiloteSchema.parse(
      (await poser(directeur, "Crée une tâche pour Zoé Cliente Externe : envoyer le bilan")).json(),
    );
    expect(r.statut).toBe("precision_requise");
    expect(r.texte).toContain("aucun collaborateur");
    expect(r.action).toBeUndefined();
    expect(await compte()).toBe(avant);
    // Nom partiel : aucune énumération du contact client.
    const partiel = reponseCopiloteSchema.parse(
      (await poser(directeur, "Crée une tâche pour Zoé : x")).json(),
    );
    expect(partiel.statut).toBe("precision_requise");
    expect(partiel.texte).not.toContain("Cliente");
    // Ambiguïté entre collaborateurs : seuls les collaborateurs internes sont listés.
    await renommer(client.utilisateurId, "Awa Cliente Externe");
    const ambigu = reponseCopiloteSchema.parse(
      (await poser(directeur, "Crée une tâche pour Awa : x")).json(),
    );
    expect(ambigu.statut).toBe("precision_requise");
    expect(ambigu.texte).toContain("Awa Koné");
    expect(ambigu.texte).toContain("Awa Traoré");
    expect(ambigu.texte).not.toContain("Cliente");
    // Le nom EXACT d'une personne du portail ne la fait pas apparaître non plus.
    const exact = reponseCopiloteSchema.parse(
      (await poser(directeur, "Crée une tâche pour Awa Cliente Externe : x")).json(),
    );
    expect(exact.statut).toBe("precision_requise");
    expect(exact.texte).toContain("aucun collaborateur");
    expect(await notifsEtTaches(client.utilisateurId)).toEqual({
      notifications: 0,
      taches: 0,
      emails: 0,
    });
  });

  it("une proposition FORGÉE vers une personne du portail est refusée à la confirmation (400), sans tâche ni courriel", async () => {
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    const parametres = {
      titre: "Tâche forgée vers le portail",
      echeance: null,
      assignee_id: client.utilisateurId,
      mission_id: null,
    };
    const id = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume,
               expire_le)
             VALUES ($1, $2, 'creer_tache', $3::jsonb, $4, 'Créer la tâche forgée.',
               now() + interval '5 minutes') RETURNING id`,
            [
              a.cabinetId,
              directeur.utilisateurId,
              JSON.stringify(parametres),
              empreinteParametres(parametres),
            ],
          )
        ).rows[0].id as string,
    );
    const r = await directeur.post(`/api/copilote/actions/${id}/confirmer`);
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json().erreur.message).toContain("Assigné inconnu ou inactif");
    expect(await taches("Tâche forgée vers le portail")).toHaveLength(0);
    expect((await ligne(id)).statut).toBe("proposee");
    expect(await notifsEtTaches(client.utilisateurId)).toEqual({
      notifications: 0,
      taches: 0,
      emails: 0,
    });
  });
});
