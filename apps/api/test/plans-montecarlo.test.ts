import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { simulerMonteCarlo, type HypothesesPlan } from "@missionpilot/engines";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";

/*
 * Simulation de Monte-Carlo (PLA-16) : lancement sur une version du modèle,
 * enregistrement de la graine, des lois et du résultat du moteur (0429),
 * rejeu à l'identique, ajout seul, plafonds (100 par plan, 30 par utilisateur
 * sur 10 minutes), version du modèle immuable, droits, isolation, portail fermé.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
/** Expert métier de l'équipe : lit le plan (plan.lire), ne le rédige pas. */
let lecteur: ApiUtilisateur;
let consultantHors: ApiUtilisateur;
let missionId: string;
let planId: string;
let plan2Id: string;

const hypotheses = {
  premierExercice: 2027,
  chiffreAffairesReference: 100_000_000,
  croissanceChiffreAffaires: 10,
  tauxMargeBrute: 40,
  tauxChargesVariables: 5,
  chargesFixes: 10_000_000,
  effectifs: [
    { libelle: "Consultants", effectifs: 4, salaireAnnuelBrut: 3_000_000, tauxChargesSociales: 20 },
  ],
  investissements: [{ libelle: "Matériel", annee: 1, montant: 12_000_000, dureeAmortissement: 4 }],
  emprunts: [
    { libelle: "Prêt bancaire", anneeDeblocage: 1, montant: 10_000_000, tauxAnnuel: 10, duree: 2 },
  ],
  delaiClientsJours: 36,
  delaiFournisseursJours: 60,
  stocksJours: 30,
  tauxImpotSocietes: 25,
  tauxActualisation: 10,
  bilanOuverture: { tresorerie: 20_000_000, capital: 20_000_000 },
};

const lois = [
  { cible: "croissanceChiffreAffaires", loi: { type: "triangulaire", min: -5, mode: 0, max: 5 } },
  { cible: "tauxMargeBrute", loi: { type: "normale", moyenne: 0, ecartType: 1, min: -3, max: 3 } },
  { cible: "delaiClientsJours", loi: { type: "uniforme", min: 0, max: 30 } },
];

const simulation = { version: 1, graine: 42, tirages: 200, hypotheses: lois };

const url = (id = planId) => `/api/plans/${id}/montecarlo/simulations`;

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

/** Plan neuf de la mission avec une version du modèle (créée par le consultant). */
async function planAvecModele(titre: string, versions = 1): Promise<string> {
  const id = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre, horizon: 3 }),
  ).id as string;
  for (let i = 0; i < versions; i++) {
    attendu(201, await consultant.post(`/api/plans/${id}/modeles`, { hypotheses }));
  }
  return id;
}

/** Ajoute `n` simulations directement en base (copie d'une existante), à l'instant `quand`. */
async function inserer(plan: string, depuis: string, par: string, n: number, quand: string) {
  await proprietaire((c) =>
    c.query(
      `INSERT INTO plan_simulations_montecarlo (cabinet_id, plan_id, modele_version_id, graine,
         tirages, parametres, resultat, empreinte, moteur, cree_par, cree_le)
       SELECT cabinet_id, plan_id, modele_version_id, graine, tirages, parametres, resultat,
         empreinte, moteur, $3::uuid, ${quand}
       FROM plan_simulations_montecarlo s, generate_series(1, $4::int)
       WHERE s.id = $1 AND s.plan_id = $2`,
      [depuis, plan, par, n],
    ),
  );
}

/** Exécute `fn` avec les déclencheurs de la table suspendus (pour atteindre les CHECK seuls). */
async function sansDeclencheurs(fn: () => Promise<void>) {
  const alterer = (action: string) =>
    proprietaire((c) => c.query(`ALTER TABLE plan_simulations_montecarlo ${action} TRIGGER USER`));
  await alterer("DISABLE");
  try {
    await fn();
  } finally {
    await alterer("ENABLE");
  }
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Monte-Carlo A");
  b = await preparerCabinet(ctx, "Monte-Carlo B");
  missionId = (await creerMission(a)).id;
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  lecteur = await a.avecRoles(["expert_metier"]);
  consultantHors = await a.avecRoles(["consultant"]);
  for (const u of [consultant, lecteur]) {
    attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u.utilisateurId }),
    );
  }
  // Plan 1 : deux versions du modèle ; la première est validée (par le chef, autre que l'auteur).
  planId = await planAvecModele("Plan à simuler", 2);
  attendu(200, await a.chef.post(`/api/plans/${planId}/modeles/1/validation`));
  // Plan 2 : trois versions (la version 3 n'existe pas sur le plan 1).
  plan2Id = await planAvecModele("Autre plan", 3);
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("lancement et enregistrement", () => {
  it("enregistre graine, lois, résultat et empreinte du moteur", async () => {
    const s = attendu(201, await consultant.post(url(), simulation));
    const v1 = await proprietaire((c) =>
      c.query("SELECT hypotheses FROM plan_modele_versions WHERE plan_id = $1 AND version = 1", [
        planId,
      ]),
    );
    const attendue = JSON.parse(
      JSON.stringify(
        simulerMonteCarlo(v1.rows[0].hypotheses as HypothesesPlan, {
          graine: 42,
          tirages: 200,
          hypotheses: lois as never,
        }),
      ),
    );
    expect(s).toMatchObject({
      plan_id: planId,
      version: 1,
      graine: 42,
      tirages: 200,
      hypotheses: lois,
      moteur: "engines/plan-strategique/monte-carlo@1",
      cree_par: consultant.utilisateurId,
      empreinte: attendue.empreinte,
    });
    expect(s.resultat).toEqual(attendue);
    expect(s.resultat.tiragesValides + s.resultat.tiragesRejetes).toBe(200);
    const ligne = await proprietaire((c) =>
      c.query(
        "SELECT graine::text AS graine, tirages, empreinte, parametres, resultat FROM plan_simulations_montecarlo WHERE id = $1",
        [s.id],
      ),
    );
    expect(ligne.rows[0]).toMatchObject({ graine: "42", tirages: 200, empreinte: s.empreinte });
    expect(ligne.rows[0].parametres).toEqual({ hypotheses: lois });
    expect(ligne.rows[0].resultat).toEqual(attendue);
  });

  it("deux simulations à graine fixée donnent des résultats égaux", async () => {
    const x = attendu(201, await consultant.post(url(), simulation));
    const y = attendu(201, await consultant.post(url(), simulation));
    expect(x.id).not.toBe(y.id);
    expect(y.resultat).toEqual(x.resultat);
    expect(y.empreinte).toBe(x.empreinte);
    // Une autre graine change la suite des tirages.
    const z = attendu(201, await consultant.post(url(), { ...simulation, graine: 43 }));
    expect(z.empreinte).not.toBe(x.empreinte);
  });

  it("graine absente : tirée par le serveur, enregistrée et rendue ; rejeu identique", async () => {
    const s = attendu(201, await consultant.post(url(), { ...simulation, graine: undefined }));
    expect(Number.isInteger(s.graine)).toBe(true);
    expect(s.graine).toBeGreaterThanOrEqual(0);
    expect(s.graine).toBeLessThanOrEqual(4_294_967_295);
    expect(s.resultat.graine).toBe(s.graine);
    const rejeu = attendu(200, await consultant.post(`${url()}/${s.id}/rejeu`));
    expect(rejeu).toMatchObject({ simulation_id: s.id, identique: true });
    // Rejouée avec la graine rendue, une nouvelle simulation donne le même résultat.
    const t = attendu(201, await consultant.post(url(), { ...simulation, graine: s.graine }));
    expect(t.resultat).toEqual(s.resultat);
  });

  it("tirages par défaut (1000) ; 2000 tirages : durée mesurée", async () => {
    const d = attendu(
      201,
      await consultant.post(url(), { version: 1, graine: 7, hypotheses: lois.slice(0, 1) }),
    );
    expect(d.tirages).toBe(1000);
    const t0 = performance.now();
    const grand = attendu(201, await consultant.post(url(), { ...simulation, tirages: 2000 }));
    const duree = performance.now() - t0;
    console.info(`Monte-Carlo : 2000 tirages via l'API en ${Math.round(duree)} ms`);
    expect(grand.tirages).toBe(2000);
    const t1 = performance.now();
    attendu(200, await consultant.post(`${url()}/${grand.id}/rejeu`));
    console.info(`Monte-Carlo : rejeu de 2000 tirages en ${Math.round(performance.now() - t1)} ms`);
  });

  it("refuse les saisies hors bornes (400) : tirages, hypothèses, graine, champ inconnu", async () => {
    const refus = async (corps: Record<string, unknown>) =>
      (await consultant.post(url(), { ...simulation, ...corps })).statusCode;
    expect(await refus({ tirages: 99 })).toBe(400);
    expect(await refus({ tirages: 2001 })).toBe(400);
    expect(await refus({ graine: -1 })).toBe(400);
    expect(await refus({ graine: 4_294_967_296 })).toBe(400);
    expect(await refus({ hypotheses: [] })).toBe(400);
    const cibles = [
      "croissanceChiffreAffaires",
      "tauxMargeBrute",
      "tauxChargesVariables",
      "chargesFixes",
      "delaiClientsJours",
    ];
    const loi = { type: "uniforme", min: -1, max: 1 };
    expect(await refus({ hypotheses: cibles.map((cible) => ({ cible, loi })) })).toBe(201);
    expect(
      await refus({ hypotheses: [...cibles, "tauxMargeBrute"].map((cible) => ({ cible, loi })) }),
    ).toBe(400);
    expect(await refus({ hypotheses: [{ cible: "autre", loi }] })).toBe(400);
    expect(
      await refus({ hypotheses: [{ cible: "tauxMargeBrute", loi: { ...loi, min: 2 } }] }),
    ).toBe(400);
    expect(await refus({ plan_id: planId })).toBe(400);
  });

  it("lois que le moteur refuse (trop de tirages hors bornes) : 400 MONTE_CARLO_INVALIDE", async () => {
    const r = await consultant.post(url(), {
      ...simulation,
      hypotheses: [{ cible: "tauxMargeBrute", loi: { type: "uniforme", min: 150, max: 200 } }],
    });
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json().erreur.code).toBe("MONTE_CARLO_INVALIDE");
  });

  it("version inconnue ou d'un autre plan : 404 ; MQL11 en base", async () => {
    expect((await consultant.post(url(), { ...simulation, version: 3 })).statusCode).toBe(404);
    expect((await consultant.post(url(plan2Id), { ...simulation, version: 3 })).statusCode).toBe(
      201,
    );
    await proprietaire(async (c) => {
      await expect(
        c.query(
          `INSERT INTO plan_simulations_montecarlo (cabinet_id, plan_id, modele_version_id, graine,
             tirages, parametres, resultat, empreinte, moteur, cree_par)
           SELECT s.cabinet_id, $1, s.modele_version_id, s.graine, s.tirages, s.parametres,
             s.resultat, s.empreinte, s.moteur, s.cree_par
           FROM plan_simulations_montecarlo s WHERE s.plan_id = $2 LIMIT 1`,
          [plan2Id, planId],
        ),
      ).rejects.toMatchObject({ code: "MQL11" });
    });
  });
});

describe("lecture, liste et rejeu", () => {
  it("liste paginée (plus récente d'abord) et détail", async () => {
    const page1 = attendu(200, await lecteur.get(`${url()}?limite=2`));
    expect(page1.elements).toHaveLength(2);
    expect(page1.curseur_suivant).toBeTruthy();
    expect(page1.elements[0]).toMatchObject({
      version: expect.any(Number),
      tirages: expect.any(Number),
    });
    expect(page1.elements[0]).not.toHaveProperty("resultat");
    const page2 = attendu(
      200,
      await lecteur.get(`${url()}?limite=2&curseur=${page1.curseur_suivant}`),
    );
    const ids = [...page1.elements, ...page2.elements].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const detail = attendu(200, await lecteur.get(`${url()}/${ids[0]}`));
    expect(detail.resultat.van.histogramme.effectifs).toHaveLength(20);
    expect((await lecteur.get(`${url()}?limite=0`)).statusCode).toBe(400);
  });

  it("rejeu : identique, sans écriture métier (hors trace de débit) ; différent si le résultat figé diverge", async () => {
    const s = attendu(201, await consultant.post(url(), simulation));
    const compte = () =>
      proprietaire(async (c) => [
        (await c.query("SELECT count(*)::int AS n FROM plan_simulations_montecarlo")).rows[0].n,
        (await c.query("SELECT count(*)::int AS n FROM journal_audit")).rows[0].n,
      ]);
    const avant = await compte();
    const r = attendu(200, await lecteur.post(`${url()}/${s.id}/rejeu`));
    expect(r).toEqual({
      simulation_id: s.id,
      identique: true,
      empreinte_enregistree: s.empreinte,
      empreinte_rejouee: s.empreinte,
    });
    expect(await compte()).toEqual(avant);
    // Un résultat figé altéré en base (par le propriétaire, hors API) est détecté par le rejeu.
    await proprietaire(async (c) => {
      await c.query("ALTER TABLE plan_simulations_montecarlo DISABLE TRIGGER USER");
      await c.query(
        "UPDATE plan_simulations_montecarlo SET resultat = jsonb_set(resultat, '{probabiliteTension}', '0.9999') WHERE id = $1",
        [s.id],
      );
      await c.query("ALTER TABLE plan_simulations_montecarlo ENABLE TRIGGER USER");
    });
    const alteree = attendu(200, await lecteur.post(`${url()}/${s.id}/rejeu`));
    expect(alteree.identique).toBe(false);
    expect(alteree.empreinte_rejouee).toBe(alteree.empreinte_enregistree);
  });

  it("rejeu : 5 par plan et par 10 minutes (provisoire), 6e en 429 TROP_DE_REJEUX ; fenêtre glissante", async () => {
    const s = attendu(201, await consultant.post(url(), simulation));
    const purger = () =>
      proprietaire((c) =>
        c.query("DELETE FROM plan_rejeux_montecarlo WHERE plan_id = $1", [planId]),
      );
    await purger();
    for (let i = 0; i < 5; i++) attendu(200, await lecteur.post(`${url()}/${s.id}/rejeu`));
    const refus = await lecteur.post(`${url()}/${s.id}/rejeu`);
    expect(refus.statusCode).toBe(429);
    expect(refus.json().erreur.code).toBe("TROP_DE_REJEUX");
    expect(refus.json().erreur.message).toContain("5 rejeux par plan");
    // Un rejeu refusé ne compte pas ; la lecture n'est pas limitée.
    attendu(200, await lecteur.get(`${url()}/${s.id}`));
    // Hors fenêtre (plus de 10 minutes) : de nouveau admis.
    await proprietaire((c) =>
      c.query(
        "UPDATE plan_rejeux_montecarlo SET cree_le = now() - interval '11 minutes' WHERE plan_id = $1",
        [planId],
      ),
    );
    attendu(200, await lecteur.post(`${url()}/${s.id}/rejeu`));
    await purger();
  });

  it("rejeu : purge à une heure, seules les lignes de plus d'une heure sont supprimées", async () => {
    const s = attendu(201, await consultant.post(url(), simulation));
    const il_y_a = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const lignes = (): Promise<Date[]> =>
      proprietaire(async (c) =>
        (
          await c.query(
            "SELECT cree_le FROM plan_rejeux_montecarlo WHERE plan_id = $1 ORDER BY cree_le",
            [planId],
          )
        ).rows.map((r) => r.cree_le as Date),
      );
    await proprietaire(async (c) => {
      await c.query("DELETE FROM plan_rejeux_montecarlo WHERE plan_id = $1", [planId]);
      for (const m of [180, 90, 61, 59, 30]) {
        await c.query(
          "INSERT INTO plan_rejeux_montecarlo (cabinet_id, plan_id, cree_par, cree_le) VALUES ($1, $2, $3, $4)",
          [a.cabinetId, planId, lecteur.utilisateurId, il_y_a(m)],
        );
      }
    });
    expect(await lignes()).toHaveLength(5);
    attendu(200, await lecteur.post(`${url()}/${s.id}/rejeu`));
    const restantes = await lignes();
    // 180, 90 et 61 minutes supprimées ; 59 et 30 minutes conservées ; le rejeu ajoute la sienne.
    expect(restantes).toHaveLength(3);
    const limite = il_y_a(60).getTime();
    expect(restantes.every((d) => d.getTime() > limite)).toBe(true);
    await proprietaire((c) =>
      c.query("DELETE FROM plan_rejeux_montecarlo WHERE plan_id = $1", [planId]),
    );
  });

  it("lois de départ : version validée par défaut, provisoires, acceptées par le lancement", async () => {
    const d = attendu(200, await lecteur.get(`/api/plans/${planId}/montecarlo/defauts`));
    expect(d).toMatchObject({ version: 1, validee: true, valeurs_provisoires: true });
    expect(d.hypotheses.map((h: { cible: string }) => h.cible)).toEqual([
      "croissanceChiffreAffaires",
      "tauxMargeBrute",
      "chargesFixes",
      "delaiClientsJours",
    ]);
    const v2 = attendu(200, await lecteur.get(`/api/plans/${planId}/montecarlo/defauts?version=2`));
    expect(v2).toMatchObject({ version: 2, validee: false });
    expect(
      (await lecteur.get(`/api/plans/${planId}/montecarlo/defauts?version=99`)).statusCode,
    ).toBe(404);
    attendu(201, await consultant.post(url(), { version: 2, graine: 1, hypotheses: d.hypotheses }));
  });
});

describe("droits, isolation, mission", () => {
  it("401 sans session ; 403 sans plan.lire (gestionnaire) ; lecteur sans plan.ecrire", async () => {
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    expect((await api(ctx).post(url(), simulation)).statusCode).toBe(401);
    const s = attendu(201, await consultant.post(url(), simulation));
    for (const r of [
      await gestionnaire.post(url(), simulation),
      await gestionnaire.get(url()),
      await gestionnaire.get(`${url()}/${s.id}`),
      await gestionnaire.post(`${url()}/${s.id}/rejeu`),
      await gestionnaire.get(`/api/plans/${planId}/montecarlo/defauts`),
    ]) {
      expect(r.statusCode, r.body).toBe(403);
      // FIN-02 : ni état financier du client, ni coût, taux ou marge du cabinet dans la réponse.
      expect(r.body).not.toMatch(/resultat|cout_journalier|taux_journalier|marge/i);
    }
    expect((await lecteur.post(url(), simulation)).statusCode).toBe(403);
    expect((await lecteur.get(url())).statusCode).toBe(200);
  });

  it("aucun coût, taux ou marge du cabinet dans les réponses d'un lecteur autorisé", async () => {
    const corps = JSON.stringify(
      [await lecteur.get(url()), await lecteur.get(`/api/plans/${planId}/montecarlo/defauts`)].map(
        (r) => r.body,
      ),
    );
    expect(corps).not.toMatch(/cout_journalier|taux_journalier|grille|marge_cabinet/i);
  });

  it("mission invisible et autre cabinet : 404 ; simulation d'un autre plan : 404", async () => {
    const s = attendu(201, await consultant.post(url(), simulation));
    for (const u of [consultantHors, b.associe]) {
      expect((await u.get(url())).statusCode).toBe(404);
      expect((await u.get(`${url()}/${s.id}`)).statusCode).toBe(404);
      expect((await u.post(`${url()}/${s.id}/rejeu`)).statusCode).toBe(404);
      expect((await u.post(url(), simulation)).statusCode).toBe(404);
      expect((await u.get(`/api/plans/${planId}/montecarlo/defauts`)).statusCode).toBe(404);
    }
    expect((await consultant.get(`${url(plan2Id)}/${s.id}`)).statusCode).toBe(404);
    expect((await consultant.post(`${url(plan2Id)}/${s.id}/rejeu`)).statusCode).toBe(404);
    // RLS : le cabinet B ne voit aucune ligne, même par requête directe.
    const lignes = await ctx.db.withTenant(b.cabinetId, (db) =>
      db.query("SELECT count(*)::int AS n FROM plan_simulations_montecarlo"),
    );
    expect(lignes.rows[0].n).toBe(0);
  });

  it("mission clôturée : lancement refusé (409), lecture et rejeu possibles", async () => {
    const m = await creerMission(a);
    const plan = attendu(201, await a.chef.post(`/api/missions/${m.id}/plans`, { titre: "Clos" }))
      .id as string;
    attendu(201, await a.chef.post(`/api/plans/${plan}/modeles`, { hypotheses }));
    const s = attendu(201, await a.chef.post(url(plan), simulation));
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [m.id, a.associeId],
      ),
    );
    expect((await a.chef.post(url(plan), simulation)).statusCode).toBe(409);
    expect((await a.chef.get(url(plan))).statusCode).toBe(200);
    expect((await a.chef.post(`${url(plan)}/${s.id}/rejeu`)).statusCode).toBe(200);
  });

  it("portail client : refusé (403 PORTAIL_ROUTE_INTERDITE)", async () => {
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    for (const r of [
      await client.get(url()),
      await client.post(url(), simulation),
      await client.get(`/api/plans/${planId}/montecarlo/defauts`),
    ]) {
      expect(r.statusCode).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });
});

describe("version du modèle inchangée", () => {
  it("la version validée reste identique après simulation (résultat, validation)", async () => {
    const instantane = () =>
      proprietaire(async (c) => ({
        versions: (
          await c.query(
            "SELECT id, version, hypotheses, ecarts, resultat, moteur, cree_par, calcule_le FROM plan_modele_versions WHERE plan_id = $1 ORDER BY version",
            [planId],
          )
        ).rows,
        validations: (
          await c.query(
            "SELECT modele_version_id, valide_par, valide_le FROM plan_modele_validations WHERE modele_version_id IN (SELECT id FROM plan_modele_versions WHERE plan_id = $1)",
            [planId],
          )
        ).rows,
        partage: (
          await c.query("SELECT partage_client FROM plans_strategiques WHERE id = $1", [planId])
        ).rows,
      }));
    const avant = await instantane();
    const v1 = attendu(200, await consultant.get(`/api/plans/${planId}/modeles/1`));
    attendu(201, await consultant.post(url(), { ...simulation, graine: 99 }));
    expect(await instantane()).toEqual(avant);
    const apres = attendu(200, await consultant.get(`/api/plans/${planId}/modeles/1`));
    expect(apres).toEqual(v1);
    expect(apres.validation).toMatchObject({ valide_par: a.chef.utilisateurId });
  });
});

describe("défense en base et plafonds", () => {
  it("ajout seul : UPDATE et DELETE refusés (MQL10 pour le propriétaire, droit retiré à l'application)", async () => {
    await proprietaire(async (c) => {
      await expect(c.query("DELETE FROM plan_simulations_montecarlo")).rejects.toMatchObject({
        code: "MQL10",
      });
      await expect(
        c.query("UPDATE plan_simulations_montecarlo SET tirages = 100"),
      ).rejects.toMatchObject({ code: "MQL10" });
    });
    for (const sql of [
      "UPDATE plan_simulations_montecarlo SET tirages = 100",
      "DELETE FROM plan_simulations_montecarlo",
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(sql)),
        sql,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("bornes en base : graine, tirages, empreinte, cohérence du résultat (MQL13)", async () => {
    const copie = (colonnes: string) =>
      `INSERT INTO plan_simulations_montecarlo (cabinet_id, plan_id, modele_version_id, graine,
         tirages, parametres, resultat, empreinte, moteur, cree_par)
       SELECT cabinet_id, plan_id, modele_version_id, ${colonnes}
       FROM plan_simulations_montecarlo WHERE plan_id = '${planId}' LIMIT 1`;
    const defaut = "graine, tirages, parametres, resultat, empreinte, moteur, cree_par";
    await sansDeclencheurs(() =>
      proprietaire(async (c) => {
        for (const colonnes of [
          defaut.replace("graine,", "4294967296,"),
          defaut.replace("tirages,", "99,"),
          defaut.replace("tirages,", "2001,"),
          defaut.replace("empreinte,", "'zz',"),
        ]) {
          await expect(c.query(copie(colonnes)), colonnes).rejects.toMatchObject({ code: "23514" });
        }
      }),
    );
    await proprietaire(async (c) => {
      await expect(c.query(copie(defaut.replace("graine,", "graine + 1,")))).rejects.toMatchObject({
        code: "MQL13",
      });
    });
  });

  it("101e simulation d'un plan : 409 SIMULATIONS_PLAFOND (MQL12 en base)", async () => {
    const plan = await planAvecModele("Plafond");
    const premiere = attendu(201, await consultant.post(url(plan), simulation));
    await inserer(plan, premiere.id, consultant.utilisateurId, 99, "now() - interval '1 day'");
    const refus = await consultant.post(url(plan), simulation);
    expect(refus.statusCode, refus.body).toBe(409);
    expect(refus.json().erreur.code).toBe("SIMULATIONS_PLAFOND");
    await expect(
      inserer(plan, premiere.id, consultant.utilisateurId, 1, "now() - interval '1 day'"),
    ).rejects.toMatchObject({ code: "MQL12" });
    const n = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM plan_simulations_montecarlo WHERE plan_id = $1",
            [plan],
          )
        ).rows[0].n,
    );
    expect(n).toBe(100);
  });

  it("31e simulation en 10 minutes : 429 TROP_DE_SIMULATIONS (MQL14 en base), par utilisateur", async () => {
    const plan = await planAvecModele("Débit");
    const lanceur = await a.avecRoles(["associe"]);
    const autre = await a.avecRoles(["associe"]);
    const premiere = attendu(201, await lanceur.post(url(plan), simulation));
    // 29 simulations de plus : la trentième de la fenêtre.
    await inserer(plan, premiere.id, lanceur.utilisateurId, 29, "now()");
    const refus = await lanceur.post(url(plan), simulation);
    expect(refus.statusCode, refus.body).toBe(429);
    expect(refus.json().erreur.code).toBe("TROP_DE_SIMULATIONS");
    await expect(
      inserer(plan, premiere.id, lanceur.utilisateurId, 1, "now()"),
    ).rejects.toMatchObject({ code: "MQL14" });
    // Le plafond est par utilisateur ; les simulations de plus de 10 minutes ne comptent pas.
    attendu(201, await autre.post(url(plan), simulation));
    await proprietaire((c) =>
      c.query("ALTER TABLE plan_simulations_montecarlo DISABLE TRIGGER USER"),
    );
    try {
      await proprietaire((c) =>
        c.query(
          "UPDATE plan_simulations_montecarlo SET cree_le = now() - interval '11 minutes' WHERE cree_par = $1",
          [lanceur.utilisateurId],
        ),
      );
    } finally {
      await proprietaire((c) =>
        c.query("ALTER TABLE plan_simulations_montecarlo ENABLE TRIGGER USER"),
      );
    }
    attendu(201, await lanceur.post(url(plan), simulation));
  });
});
