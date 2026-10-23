/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  attendre,
  creerCampagne,
  echantillonDe,
  evaluerTout,
  P,
  preparerFroide,
  revueTerminee,
  type ScenarioFroide,
} from "./qualite-froide-outils.js";
import { inviterClient } from "./portail-outils.js";

/*
 * Revue à froid (QUA-05), plan d'amélioration et clôture : droits du responsable et de l'associé,
 * transitions du moteur, clôture commentée, historique en ajout seul, retard, isolation, portail.
 */

let ctx: Contexte;
let s: ScenarioFroide;
let b: ScenarioFroide;
let campagne: any;
let echA: string; // revue terminée (constat majeur)
let echB: string; // revue en cours (constat posé, non terminée)
let constatTermine: string;
let constatEnCours: string;
let actionId: string;

const FUTUR = "2099-12-31";
const hier = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerFroide(ctx, "Froide Plan", 2);
  b = await preparerFroide(ctx, "Froide Plan B", 1);
  campagne = await creerCampagne(s.c.associe, { taille: 2 });
  echA = echantillonDe(campagne, s.missions[0]).id;
  echB = echantillonDe(campagne, s.missions[1]).id;
  const terminee = await revueTerminee(s.c.associe, s.tiers, echA, 3, {
    gravite: "majeur",
    description: "Écart de méthode.",
  });
  constatTermine = terminee.constats[0].id;
  attendre(
    200,
    await s.c.associe.post(`${P}/echantillons/${echB}/affectation`, {
      relecteur_id: s.tiers2.utilisateurId,
    }),
    "affectation B",
  );
  const c = await s.tiers2.post(`${P}/echantillons/${echB}/constats`, {
    gravite: "mineur",
    description: "Détail.",
  });
  attendre(201, c, "constat B");
  constatEnCours = c.json().constat_id;
});
afterAll(async () => {
  await ctx.fermer();
});

const creer = (corps: Record<string, unknown> = {}, u = s.c.associe) =>
  u.post(`${P}/campagnes/${campagne.id}/actions`, {
    titre: "Renforcer la relecture",
    responsable_id: s.consultant.utilisateurId,
    echeance: FUTUR,
    ...corps,
  });

describe("création d'une action", () => {
  it("réservée à qui gère la revue à froid", async () => {
    expect((await creer({}, api(ctx) as any)).statusCode).toBe(401);
    for (const u of [s.tiers, s.tiers2, s.c.directeur, s.c.chef, s.consultant]) {
      expect((await creer({}, u as any)).statusCode).toBe(403);
    }
    const r = await creer({ constat_id: constatTermine, description: "Détail de l'action." });
    expect(r.statusCode, r.body).toBe(201);
    const a = r.json();
    actionId = a.id;
    expect(a).toMatchObject({
      statut: "a_faire",
      titre: "Renforcer la relecture",
      echeance: FUTUR,
      responsable_id: s.consultant.utilisateurId,
      en_retard: false,
      constat: { id: constatTermine, gravite: "majeur" },
    });
    expect(a.historique).toHaveLength(1);
    expect(a.historique[0]).toMatchObject({ rang: 1, de_statut: null, vers_statut: "a_faire" });
    const n = await proprietaire((cl) =>
      cl.query(
        "SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1 AND type = 'revue_froide_action'",
        [s.consultant.utilisateurId],
      ),
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("refuse une échéance passée, un responsable invalide et un constat inadmissible", async () => {
    const passee = await creer({ echeance: hier() });
    expect(passee.statusCode).toBe(400);
    expect(passee.json().erreur.code).toBe("ECHEANCE_PASSEE");

    const inactif = await s.c.avecRoles(["consultant"]);
    await proprietaire((cl) =>
      cl.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [inactif.utilisateurId]),
    );
    for (const id of [
      inactif.utilisateurId,
      b.consultant.utilisateurId, // utilisateur d'un autre cabinet
      "00000000-0000-4000-8000-000000000000",
    ]) {
      const r = await creer({ responsable_id: id });
      expect(r.statusCode, id).toBe(400);
      expect(r.json().erreur.code).toBe("RESPONSABLE_INVALIDE");
    }
    // Un expert externe ne consulte rien : il ne peut pas être responsable.
    const externe = await s.c.avecRoles(["expert_externe"]);
    expect((await creer({ responsable_id: externe.utilisateurId })).statusCode).toBe(400);

    // Constat d'une revue non terminée : refusé (409) ; d'une autre campagne : 404.
    const enCours = await creer({ constat_id: constatEnCours });
    expect(enCours.statusCode).toBe(409);
    expect(enCours.json().erreur.code).toBe("CONSTAT_INVALIDE");
    const autre = await creerCampagne(s.c.associe, { taille: 1, graine: "autre" });
    const hors = await s.c.associe.post(`${P}/campagnes/${autre.id}/actions`, {
      titre: "Hors campagne",
      responsable_id: s.consultant.utilisateurId,
      echeance: FUTUR,
      constat_id: constatTermine,
    });
    expect(hors.statusCode).toBe(404);
    // Base : même verdict (MQQ12) et responsable inactif (MQQ08).
    await expect(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO qualite_froide_actions (cabinet_id, campagne_id, constat_id, titre, responsable_id,
             echeance, cree_par) VALUES ($1, $2, $3, 'x', $4, '2099-01-01', $4)`,
          [s.c.cabinetId, campagne.id, constatEnCours, s.c.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ12" });
    await expect(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO qualite_froide_actions (cabinet_id, campagne_id, titre, responsable_id, echeance,
             cree_par) VALUES ($1, $2, 'x', $3, '2099-01-01', $4)`,
          [s.c.cabinetId, campagne.id, inactif.utilisateurId, s.c.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ08" });
    expect((await creer({ inconnu: 1 })).statusCode).toBe(400);
  });
});

describe("lecture du plan", () => {
  it("le plan calcule l'état par le moteur, retard compris", async () => {
    const retard = await creer({ titre: "En retard", responsable_id: s.tiers2.utilisateurId });
    expect(retard.statusCode).toBe(201);
    await proprietaire((cl) =>
      cl.query("UPDATE qualite_froide_actions SET echeance = '2020-01-15' WHERE id = $1", [
        retard.json().id,
      ]),
    );
    const r = await s.c.associe.get(`${P}/campagnes/${campagne.id}/plan`);
    expect(r.statusCode, r.body).toBe(200);
    const plan = r.json();
    expect(plan.etat).toMatchObject({
      total: 2,
      a_faire: 2,
      en_retard: 1,
      faites: 0,
      taux_realisation: 0,
      prochaine_echeance: "2020-01-15",
    });
    const l = plan.actions.find((x: any) => x.titre === "En retard");
    expect(l.en_retard).toBe(true);
    expect(plan.actions.find((x: any) => x.id === actionId).en_retard).toBe(false);
    expect((await s.tiers.get(`${P}/campagnes/${campagne.id}/plan`)).statusCode).toBe(403);
  });

  it("chacun ne voit que ses actions ; qui gère la revue voit tout", async () => {
    const toutes = (await s.c.associe.get(`${P}/actions?limite=100`)).json();
    expect(toutes.elements.length).toBeGreaterThanOrEqual(2);
    const miennes = (await s.consultant.get(`${P}/actions`)).json();
    expect(miennes.elements.map((x: any) => x.id)).toEqual([actionId]);
    expect((await s.c.chef.get(`${P}/actions`)).json().elements).toEqual([]);
    const retard = (await s.c.associe.get(`${P}/actions?en_retard=true`)).json();
    expect(retard.elements.map((x: any) => x.titre)).toEqual(["En retard"]);
    const pas = (await s.c.associe.get(`${P}/actions?en_retard=false&statut=a_faire`)).json();
    expect(pas.elements.map((x: any) => x.id)).toContain(actionId);
    const p1 = (await s.c.associe.get(`${P}/actions?limite=1`)).json();
    expect(p1.elements).toHaveLength(1);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = (
      await s.c.associe.get(
        `${P}/actions?limite=1&curseur=${encodeURIComponent(p1.curseur_suivant)}`,
      )
    ).json();
    expect(p2.elements[0].id).not.toBe(p1.elements[0].id);
    // Détail : le responsable et l'associé ; un tiers reçoit 404.
    expect((await s.consultant.get(`${P}/actions/${actionId}`)).statusCode).toBe(200);
    expect((await s.c.associe.get(`${P}/actions/${actionId}`)).statusCode).toBe(200);
    expect((await s.tiers.get(`${P}/actions/${actionId}`)).statusCode).toBe(404);
    // Droit de consulter les missions exigé ; sans action, la liste est vide.
    const externe = await s.c.avecRoles(["expert_externe"]);
    expect((await externe.get(`${P}/actions`)).statusCode).toBe(403);
    expect((await s.ressources.get(`${P}/actions`)).json().elements).toEqual([]);
  });
});

describe("avancement d'une action", () => {
  const patch = (u: any, corps: unknown, id = actionId) => u.patch(`${P}/actions/${id}`, corps);

  it("le responsable change le statut ; seul l'associé change responsable et échéance", async () => {
    // Un tiers n'y voit rien.
    expect((await patch(s.tiers, { statut: "en_cours" })).statusCode).toBe(404);
    // Le responsable ne change ni l'échéance ni le responsable.
    expect((await patch(s.consultant, { echeance: "2099-12-30" })).statusCode).toBe(403);
    expect((await patch(s.consultant, { responsable_id: s.tiers2.utilisateurId })).statusCode).toBe(
      403,
    );
    // Qui gère la revue sans être responsable ne change pas le statut.
    expect((await patch(s.c.associe, { statut: "en_cours" })).statusCode).toBe(403);

    const ok = await patch(s.consultant, { statut: "en_cours", commentaire: "On démarre." });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().statut).toBe("en_cours");
    expect(ok.json().historique.map((h: any) => h.vers_statut)).toEqual(["a_faire", "en_cours"]);
    expect(ok.json().historique[1]).toMatchObject({
      rang: 2,
      de_statut: "a_faire",
      commentaire: "On démarre.",
    });

    // Transition invalide du moteur : même statut.
    const meme = await patch(s.consultant, { statut: "en_cours" });
    expect(meme.statusCode).toBe(409);
    expect(meme.json().erreur.code).toBe("ACTION_TRANSITION_IMPOSSIBLE");
    // Retour à faire permis par le moteur (en_cours → a_faire), puis en cours.
    expect((await patch(s.consultant, { statut: "a_faire" })).statusCode).toBe(200);
    expect((await patch(s.consultant, { statut: "en_cours" })).statusCode).toBe(200);

    // L'associé change l'échéance et le responsable (notification au nouveau responsable).
    const e = await patch(s.c.associe, { echeance: "2099-11-30" });
    expect(e.statusCode, e.body).toBe(200);
    expect(e.json().echeance).toBe("2099-11-30");
    const passee = await patch(s.c.associe, { echeance: hier() });
    expect(passee.statusCode).toBe(400);
    expect(passee.json().erreur.code).toBe("ECHEANCE_PASSEE");
    const rep = await patch(s.c.associe, { responsable_id: s.tiers2.utilisateurId });
    expect(rep.statusCode, rep.body).toBe(200);
    expect(rep.json().responsable_id).toBe(s.tiers2.utilisateurId);
    const n = await proprietaire((cl) =>
      cl.query(
        "SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1 AND type = 'revue_froide_action'",
        [s.tiers2.utilisateurId],
      ),
    );
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    // L'ancien responsable ne voit plus l'action.
    expect((await s.consultant.get(`${P}/actions/${actionId}`)).statusCode).toBe(404);
    expect((await patch(s.consultant, { statut: "faite", commentaire: "x" })).statusCode).toBe(404);
    // Rendre l'action au consultant pour la suite.
    expect(
      (await patch(s.c.associe, { responsable_id: s.consultant.utilisateurId })).statusCode,
    ).toBe(200);
  });

  it("clôturer exige un commentaire ; une action close est figée ; l'historique est en ajout seul", async () => {
    expect((await patch(s.consultant, {})).statusCode).toBe(400);
    expect((await patch(s.consultant, { statut: "faite" })).statusCode).toBe(400);
    expect((await patch(s.consultant, { statut: "abandonnee", commentaire: "" })).statusCode).toBe(
      400,
    );
    const ok = await patch(s.consultant, {
      statut: "faite",
      commentaire: "Relecture à quatre yeux instaurée.",
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ statut: "faite" });
    expect(ok.json().cloturee_le).toBeTruthy();
    const dernier = ok.json().historique[ok.json().historique.length - 1];
    expect(dernier).toMatchObject({
      de_statut: "en_cours",
      vers_statut: "faite",
      commentaire: "Relecture à quatre yeux instaurée.",
    });
    // Figée : plus de statut, d'échéance ni de responsable.
    for (const corps of [{ statut: "en_cours" }, { statut: "abandonnee", commentaire: "non" }]) {
      const r = await patch(s.consultant, corps);
      expect(r.statusCode, JSON.stringify(corps)).toBe(409);
      expect(r.json().erreur.code).toBe("ACTION_CLOSE");
    }
    expect((await patch(s.c.associe, { echeance: "2099-10-01" })).statusCode).toBe(409);

    // Base : transition interdite (MQQ06), historique en ajout seul (MQQ01), clôture sans commentaire.
    const sql = (texte: string, params: unknown[] = []) =>
      proprietaire((cl) => cl.query(texte, params));
    await expect(
      sql(
        "UPDATE qualite_froide_actions SET statut = 'a_faire', cloturee_le = NULL WHERE id = $1",
        [actionId],
      ),
    ).rejects.toMatchObject({ code: "MQQ06" });
    await expect(
      sql("DELETE FROM qualite_froide_actions WHERE id = $1", [actionId]),
    ).rejects.toMatchObject({
      code: "MQQ06",
    });
    await expect(
      sql("UPDATE qualite_froide_actions_historique SET commentaire = 'x' WHERE action_id = $1", [
        actionId,
      ]),
    ).rejects.toMatchObject({ code: "MQQ01" });
    await expect(
      sql("DELETE FROM qualite_froide_actions_historique WHERE action_id = $1", [actionId]),
    ).rejects.toMatchObject({ code: "MQQ01" });
    await expect(
      sql(
        `INSERT INTO qualite_froide_actions_historique
           (cabinet_id, action_id, rang, de_statut, vers_statut, responsable_id, echeance, auteur_id)
         VALUES ($1, $2, 99, 'en_cours', 'faite', $3, '2099-01-01', $3)`,
        [s.c.cabinetId, actionId, s.c.associeId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // Transition valide du moteur refusée par la base si elle saute un état clos : a_faire → a_faire change rien.
    const neuve = await creer({ titre: "Neuve" });
    await expect(
      sql(
        "UPDATE qualite_froide_actions SET statut = 'abandonnee', cloturee_le = now() WHERE id = $1",
        [neuve.json().id],
      ),
    ).resolves.toBeTruthy();
    await expect(
      sql(
        "UPDATE qualite_froide_actions SET statut = 'en_cours', cloturee_le = NULL WHERE id = $1",
        [neuve.json().id],
      ),
    ).rejects.toMatchObject({ code: "MQQ06" });
  });

  it("l'abandon est une clôture commentée", async () => {
    const a = (await creer({ titre: "À abandonner" })).json();
    const r = await patch(
      s.consultant,
      { statut: "abandonnee", commentaire: "Hors périmètre." },
      a.id,
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().statut).toBe("abandonnee");
    const plan = (await s.c.associe.get(`${P}/campagnes/${campagne.id}/plan`)).json();
    expect(plan.etat.abandonnees).toBeGreaterThanOrEqual(1);
    expect(plan.etat.faites).toBe(1);
  });
});

describe("plafond des actions", () => {
  it("500 actions au plus par campagne (API et base)", async () => {
    const autre = await creerCampagne(s.c.associe, { taille: 1, graine: "plafond" });
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO qualite_froide_actions (cabinet_id, campagne_id, titre, responsable_id, echeance, cree_par)
         SELECT $1, $2, 'Action ' || g, $3, '2099-01-01', $3 FROM generate_series(1, 500) g`,
        [s.c.cabinetId, autre.id, s.c.associeId],
      ),
    );
    const r = await s.c.associe.post(`${P}/campagnes/${autre.id}/actions`, {
      titre: "501e",
      responsable_id: s.consultant.utilisateurId,
      echeance: FUTUR,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
    await expect(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO qualite_froide_actions (cabinet_id, campagne_id, titre, responsable_id, echeance, cree_par)
           VALUES ($1, $2, '501e', $3, '2099-01-01', $3)`,
          [s.c.cabinetId, autre.id, s.c.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ09" });
  });
});

describe("clôture de la campagne et suite du plan", () => {
  it("clôt la campagne une fois toutes les revues terminées ; le plan continue ensuite", async () => {
    const avant = await s.c.associe.post(`${P}/campagnes/${campagne.id}/cloture`);
    expect(avant.statusCode).toBe(409);
    expect(avant.json().erreur.code).toBe("REVUES_NON_TERMINEES");
    expect(avant.json().erreur.details.manquants).toEqual([echB]);

    await evaluerTout(s.tiers2, echB, 5);
    attendre(
      200,
      await s.tiers2.post(`${P}/echantillons/${echB}/terminer`, { synthese: "Revue B achevée." }),
      "terminer B",
    );
    const ok = await s.c.associe.post(`${P}/campagnes/${campagne.id}/cloture`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ statut: "close", progression: { total: 2, terminees: 2 } });
    expect(ok.json().cloturee_le).toBeTruthy();
    const deux = await s.c.associe.post(`${P}/campagnes/${campagne.id}/cloture`);
    expect(deux.statusCode).toBe(409);
    expect(deux.json().erreur.code).toBe("CAMPAGNE_CLOSE");
    await expect(
      proprietaire((cl) =>
        cl.query(
          "UPDATE qualite_froide_campagnes SET statut = 'ouverte', cloturee_le = NULL WHERE id = $1",
          [campagne.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ02" });
    // Le plan d'amélioration continue après la clôture, sur un constat de revue terminée (B a un constat mineur).
    const suite = await creer({ titre: "Après clôture", constat_id: constatEnCours });
    expect(suite.statusCode, suite.body).toBe(201);
  });
});

describe("isolation entre cabinets et portail", () => {
  it("le cabinet B reçoit 404 sur le plan de A et ne voit pas ses actions", async () => {
    expect((await b.c.associe.get(`${P}/campagnes/${campagne.id}/plan`)).statusCode).toBe(404);
    expect((await b.c.associe.get(`${P}/actions/${actionId}`)).statusCode).toBe(404);
    expect(
      (await b.c.associe.patch(`${P}/actions/${actionId}`, { statut: "en_cours" })).statusCode,
    ).toBe(404);
    expect((await b.c.associe.get(`${P}/actions?limite=100`)).json().elements).toEqual([]);
  });

  it("aucune route n'est ouverte au portail : 403 avec le jeton d'un client", async () => {
    const client = await inviterClient(ctx, s.c.associe, s.c.clientId, ["client_dirigeant"]);
    const id = "00000000-0000-4000-8000-000000000000";
    const routes: [string, string, unknown?][] = [
      ["POST", `${P}/campagnes`, {}],
      ["GET", `${P}/campagnes`],
      ["GET", `${P}/campagnes/${id}`],
      ["GET", `${P}/campagnes/${id}/verification`],
      ["POST", `${P}/campagnes/${id}/cloture`, {}],
      ["POST", `${P}/campagnes/${id}/actions`, {}],
      ["GET", `${P}/campagnes/${id}/plan`],
      ["GET", `${P}/mes-revues`],
      ["GET", `${P}/echantillons/${id}`],
      ["GET", `${P}/echantillons/${id}/dossier`],
      ["GET", `${P}/echantillons/${id}/relecteurs-eligibles`],
      ["POST", `${P}/echantillons/${id}/affectation`, {}],
      ["PUT", `${P}/echantillons/${id}/evaluations`, {}],
      ["POST", `${P}/echantillons/${id}/constats`, {}],
      ["DELETE", `${P}/echantillons/${id}/constats/${id}`],
      ["POST", `${P}/echantillons/${id}/terminer`, {}],
      ["GET", `${P}/actions`],
      ["GET", `${P}/actions/${id}`],
      ["PATCH", `${P}/actions/${id}`, {}],
    ];
    for (const [methode, url, corps] of routes) {
      const r = await client.brut({
        method: methode as "GET",
        url,
        ...(corps === undefined
          ? {}
          : { payload: JSON.stringify(corps), headers: { "content-type": "application/json" } }),
      });
      expect(r.statusCode, `${methode} ${url}`).toBe(403);
    }
  });
});
