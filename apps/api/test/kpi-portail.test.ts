import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerKpi,
  INCONNU,
  mesurer,
  preparerKpi,
  preparerPortailKpi,
  type ScenarioKpi,
} from "./kpi-outils.js";
import { creerMission } from "./missions-outils.js";
import { attendre, CLE_INTERDITE, clesDe, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Saisie des KPI par les contributeurs du client (portail, SOC-09) : seuls
 * les KPI désignés existent pour eux ; même 404 pour un KPI non désigné, d'un
 * autre client, d'un autre cabinet ou inexistant ; projection minimale ;
 * défense en profondeur par RLS (migration 0160).
 */

let ctx: Contexte;
let s: ScenarioKpi;
let p: Awaited<ReturnType<typeof preparerPortailKpi>>;
let k1: string;
let k2: string;
let kA2: string;
let kB: string;

const designer = async (kpiId: string, ...u: UtilisateurPortail[]) =>
  attendre(
    200,
    await s.a.chef.put(`/api/kpi/${kpiId}/contributeurs`, {
      utilisateurs: u.map((x) => x.utilisateurId),
    }),
    "contributeurs",
  );

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerKpi(ctx, "KPI portail");
  p = await preparerPortailKpi(ctx, s);
  k1 = (await creerKpi(s.a.chef, s.missionId, { alerte_bas: 100 })).id;
  k2 = (await creerKpi(s.a.chef, s.missionId, { libelle: "KPI confidentiel" })).id;
  kA2 = (await creerKpi(s.a.associe, s.missionA2, { libelle: "KPI du client A2" })).id;
  kB = (await creerKpi(s.b.chef, s.missionB, { libelle: "KPI du cabinet B" })).id;
  await designer(k1, p.contributeur);
  await designer(kA2, p.contributeurA2);
}, 180_000);
afterAll(() => ctx.fermer());

describe("accès au portail des KPI", () => {
  it("401 sans session ; 403 pour un utilisateur interne et pour l'investisseur", async () => {
    expect((await api(ctx).get("/api/portail/kpi")).statusCode).toBe(401);
    for (const u of [s.a.associe, s.a.chef]) {
      expect((await u.get("/api/portail/kpi")).statusCode).toBe(403);
      expect((await u.post(`/api/portail/kpi/${k1}/mesures`, {})).statusCode).toBe(403);
    }
    expect((await p.investisseur.get("/api/portail/kpi")).statusCode).toBe(403);
  });

  it("routes internes des KPI interdites au portail (liste blanche)", async () => {
    for (const url of [`/api/kpi/${k1}`, `/api/missions/${s.missionId}/kpi/tableau-de-bord`]) {
      const r = await p.contributeur.get(url);
      expect(r.statusCode).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("liste : seuls les KPI désignés, projection sans donnée interne", async () => {
    const r = await p.contributeur.get("/api/portail/kpi");
    expect(r.statusCode).toBe(200);
    expect(r.json().elements.map((k: { id: string }) => k.id)).toEqual([k1]);
    const k = r.json().elements[0];
    expect(k).toMatchObject({ libelle: "Chiffre d'affaires mensuel", cible_actuelle: 1000 });
    expect(Object.keys(k).sort()).toEqual(
      [
        "actif",
        "cible_actuelle",
        "debut_suivi",
        "description",
        "fin_suivi",
        "frequence",
        "id",
        "libelle",
        "nature",
        "periode_en_cours",
        "sens",
        "unite",
      ].sort(),
    );
    expect(clesDe(r.json()).filter((c) => CLE_INTERDITE.test(c))).toEqual([]);
    expect((await p.dirigeant.get("/api/portail/kpi")).json().elements).toEqual([]);
  });

  it("IDOR : même 404 pour un KPI non désigné, d'un autre client, d'un autre cabinet ou inexistant", async () => {
    const corps = { date_mesure: "2026-02-10", valeur: 5 };
    const reponses = [];
    for (const id of [k2, kA2, kB, INCONNU]) {
      reponses.push(await p.contributeur.get(`/api/portail/kpi/${id}`));
      reponses.push(await p.contributeur.get(`/api/portail/kpi/${id}/mesures`));
      reponses.push(await p.contributeur.post(`/api/portail/kpi/${id}/mesures`, corps));
    }
    for (const r of reponses) {
      expect(r.statusCode).toBe(404);
      expect(r.json().erreur).toEqual({ code: "INTROUVABLE", message: "Ressource introuvable." });
    }
    expect((await p.contributeurA2.get(`/api/portail/kpi/${k1}`)).statusCode).toBe(404);
    expect((await p.contributeurA2.get(`/api/portail/kpi/${kA2}`)).statusCode).toBe(200);
  });
});

describe("saisie et correction par le contributeur", () => {
  it("saisie tracée : origine portail, « saisie par moi », journal ; visible du cabinet", async () => {
    const r = await p.contributeur.post(`/api/portail/kpi/${k1}/mesures`, {
      date_mesure: "2026-02-28",
      valeur: 50,
      commentaire: "Chiffre provisoire",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      periode: "2026-02",
      valeur: 50,
      origine: "portail",
      saisie_par_moi: true,
      active: true,
    });
    expect(clesDe(r.json()).filter((c) => CLE_INTERDITE.test(c) || c === "saisie_par")).toEqual([]);
    const interne = (await s.a.chef.get(`/api/kpi/${k1}/mesures`)).json().elements[0];
    expect(interne).toMatchObject({
      id: r.json().id,
      origine: "portail",
      saisie_par: { id: p.contributeur.utilisateurId },
    });
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT action, details FROM journal_audit WHERE entite_id = $1", [
            r.json().id,
          ])
        ).rows,
    );
    expect(journal[0]).toMatchObject({
      action: "portail.kpi.mesure.saisir",
      details: { portail: true, client_id: s.a.clientId },
    });
    // Seuil bas (100) franchi : alerte enregistrée et responsables notifiés hors portail.
    const alertes = await proprietaire(
      async (c) =>
        (await c.query("SELECT code, periode_cle FROM kpi_alertes WHERE kpi_id = $1", [k1])).rows,
    );
    expect(alertes).toEqual([{ code: "SEUIL_BAS", periode_cle: "2026-02" }]);
  });

  it("contrôles de saisie identiques au cabinet : même date 409, hors période 400", async () => {
    const url = `/api/portail/kpi/${k1}/mesures`;
    expect(
      (await p.contributeur.post(url, { date_mesure: "2026-02-28", valeur: 1 })).statusCode,
    ).toBe(409);
    expect(
      (await p.contributeur.post(url, { date_mesure: "2025-06-30", valeur: 1 })).statusCode,
    ).toBe(400);
    expect(
      (await p.contributeur.post(url, { date_mesure: "2026-03-01", valeur: 1, x: 1 })).statusCode,
    ).toBe(400);
  });

  it("correction de ses propres mesures seulement ; historique du portail", async () => {
    const mienne = (await p.contributeur.get(`/api/portail/kpi/${k1}/mesures`)).json().elements[0];
    const corr = await p.contributeur.post(`/api/portail/kpi/mesures/${mienne.id}/corrections`, {
      date_mesure: "2026-02-28",
      valeur: 120,
      motif: "Chiffre définitif",
    });
    expect(corr.statusCode).toBe(201);
    expect(corr.json()).toMatchObject({
      remplace_id: mienne.id,
      valeur: 120,
      saisie_par_moi: true,
    });
    const duCabinet = await mesurer(s.a.chef, k1, "2026-03-31", 900);
    const r = await p.contributeur.post(`/api/portail/kpi/mesures/${duCabinet.id}/corrections`, {
      date_mesure: "2026-03-31",
      valeur: 1,
      motif: "Non",
    });
    expect(r.statusCode).toBe(403);
    const hist = (await p.contributeur.get(`/api/portail/kpi/${k1}/mesures`)).json().elements;
    expect(hist.map((m: { saisie_par_moi: boolean }) => m.saisie_par_moi)).toEqual([
      false,
      true,
      true,
    ]);
    expect(hist.map((m: { active: boolean }) => m.active)).toEqual([true, true, false]);
    // Mesure d'un KPI non désigné : même 404.
    const autre = await mesurer(s.a.chef, k2, "2026-03-31", 1);
    expect(
      (
        await p.contributeur.post(`/api/portail/kpi/mesures/${autre.id}/corrections`, {
          date_mesure: "2026-03-31",
          valeur: 1,
          motif: "x",
        })
      ).statusCode,
    ).toBe(404);
  });

  it("non-régression : motif, commentaire et justificatif du cabinet jamais servis au portail", async () => {
    const interne = (
      await s.a.chef.post(`/api/kpi/${k1}/mesures`, {
        date_mesure: "2026-04-30",
        valeur: 700,
        commentaire: "Note interne du cabinet",
        justificatif: "Balance interne",
      })
    ).json();
    const corr = await s.a.chef.post(`/api/kpi/mesures/${interne.id}/corrections`, {
      date_mesure: "2026-04-30",
      valeur: 710,
      motif: "Motif interne",
      commentaire: "Autre note interne",
    });
    expect(corr.statusCode).toBe(201);
    const duPortail = (
      await p.contributeur.post(`/api/portail/kpi/${k1}/mesures`, {
        date_mesure: "2026-05-01",
        valeur: 20,
        commentaire: "Note du client",
        justificatif: "Relevé client",
      })
    ).json();
    const hist = (await p.contributeur.get(`/api/portail/kpi/${k1}/mesures?limite=100`)).json()
      .elements as Record<string, unknown>[];
    for (const id of [interne.id, corr.json().id]) {
      expect(hist.find((x) => x.id === id)).toMatchObject({
        origine: "cabinet",
        motif: null,
        commentaire: null,
        justificatif: null,
      });
    }
    expect(hist.find((x) => x.id === duPortail.id)).toMatchObject({
      origine: "portail",
      commentaire: "Note du client",
      justificatif: "Relevé client",
    });
    expect(JSON.stringify(hist)).not.toMatch(/interne/i);
  });

  it("annuler une mesure du portail relève de kpi.gerer (chef, directeur), pas de kpi.saisir", async () => {
    const m = (
      await p.contributeur.post(`/api/portail/kpi/${k1}/mesures`, {
        date_mesure: "2026-05-02",
        valeur: 30,
      })
    ).json();
    const consultant = await s.a.avecRoles(["consultant"]);
    attendre(
      201,
      await s.a.chef.post(`/api/missions/${s.missionId}/equipe`, {
        utilisateur_id: consultant.utilisateurId,
      }),
      "équipe",
    );
    expect(
      (await consultant.post(`/api/kpi/mesures/${m.id}/annulation`, { motif: "x" })).statusCode,
    ).toBe(403);
    // Le consultant de l'équipe annule une mesure du cabinet : kpi.saisir suffit.
    const duCabinet = await mesurer(consultant, k1, "2026-05-03", 1);
    expect(
      (await consultant.post(`/api/kpi/mesures/${duCabinet.id}/annulation`, { motif: "x" }))
        .statusCode,
    ).toBe(201);
    const r = await s.a.chef.post(`/api/kpi/mesures/${m.id}/annulation`, { motif: "Doublon" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ annulation: true, remplace_id: m.id, origine: "cabinet" });
  });

  it("mission clôturée : 409 ; contributeur retiré : 404", async () => {
    const m = await creerMission(s.a, { intitule: "Mission close portail" });
    const k = (await creerKpi(s.a.chef, m.id)).id;
    await designer(k, p.contributeur);
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [m.id, s.a.associeId],
      ),
    );
    const r = await p.contributeur.post(`/api/portail/kpi/${k}/mesures`, {
      date_mesure: "2026-02-10",
      valeur: 1,
    });
    expect(r.statusCode).toBe(409);
    await designer(k1);
    expect((await p.contributeur.get(`/api/portail/kpi/${k1}`)).statusCode).toBe(404);
  });
});

describe("défense en profondeur : RLS du portail", () => {
  it("dans une transaction du portail, seuls les KPI du client ; alertes, rappels et paramètres vides", async () => {
    await mesurer(s.a.associe, kA2, "2026-02-10", 3);
    attendre(
      200,
      await s.a.associe.patch("/api/kpi/parametres", { delai_grace_jours: 6 }),
      "param",
    );
    const vu = (clientId: string) =>
      ctx.db.withTenant(s.a.cabinetId, async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [clientId]);
        const n = async (t: string) =>
          (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
        const kpis = (await db.query("SELECT DISTINCT client_id FROM kpi_definitions")).rows;
        return {
          clients: kpis.map((x) => x.client_id),
          alertes: await n("kpi_alertes"),
          rappels: await n("kpi_rappels"),
          parametres: await n("kpi_parametres"),
          mesuresAutres: (
            await db.query("SELECT count(*)::int AS n FROM kpi_mesures WHERE kpi_id = $1", [kA2])
          ).rows[0].n,
        };
      });
    expect(await vu(s.a.clientId)).toEqual({
      clients: [s.a.clientId],
      alertes: 0,
      rappels: 0,
      parametres: 0,
      mesuresAutres: 0,
    });
    expect((await vu(s.clientA2)).clients).toEqual([s.clientA2]);
    const sansPortail = await proprietaire(
      async (c) =>
        (await c.query("SELECT count(*)::int AS n FROM kpi_alertes WHERE kpi_id = $1", [k1]))
          .rows[0].n,
    );
    expect(sansPortail).toBeGreaterThan(0);
  });

  it("non-régression : écritures du portail refusées par commande, sauf la saisie d'un contributeur", async () => {
    const k = (await creerKpi(s.a.chef, s.missionId, { libelle: "RLS par commande" })).id;
    await designer(k, p.contributeur);
    // Mission partagée : ses KPI passent les contrôles des déclencheurs, seule la RLS refuse.
    attendre(
      200,
      await s.a.associe.put(`/api/portail/partages?client_id=${s.a.clientId}`, {
        missions: [{ mission_id: s.missionId }],
        documents: [],
      }),
      "partage",
    );
    const ANNULER = "annuler la transaction de test";
    /** Contexte posé par db/pool.ts pour une session du contributeur du client A. */
    const portail = (db: Db) =>
      db.query(
        `SELECT set_config('app.portail_client_id', $1, true),
           set_config('app.portail_utilisateur_id', $2, true)`,
        [s.a.clientId, p.contributeur.utilisateurId],
      );
    /** Exécute `fn` dans une transaction du portail, toujours annulée. */
    const dansPortail = async (fn: (db: Db) => Promise<unknown>) => {
      let resultat: unknown;
      await expect(
        ctx.db.withTenant(s.a.cabinetId, async (db) => {
          await portail(db);
          resultat = await fn(db);
          throw new Error(ANNULER);
        }),
      ).rejects.toThrow(ANNULER);
      return resultat;
    };
    /** Refus par une politique RLS (42501), pas par un déclencheur. */
    const refuse = (sql: string, params: unknown[]) =>
      expect(
        ctx.db.withTenant(s.a.cabinetId, async (db) => {
          await portail(db);
          await db.query(sql, params);
        }),
        sql,
      ).rejects.toMatchObject({ code: "42501" });
    // Définitions : le verrou FOR UPDATE de la saisie reste possible, la modification non.
    expect(
      await dansPortail(
        async (db) =>
          (await db.query("SELECT id FROM kpi_definitions WHERE id = $1 FOR UPDATE", [k])).rowCount,
      ),
    ).toBe(1);
    await refuse("UPDATE kpi_definitions SET libelle = 'Piraté' WHERE id = $1", [k]);
    await refuse(
      `INSERT INTO kpi_definitions (cabinet_id, mission_id, client_id, libelle, unite, sens, nature,
         frequence, debut_suivi, cree_par)
       VALUES ($1, $2, $3, 'Faux', 'u', 'plus_haut_mieux', 'flux', 'mensuelle', '2026-01-01', $4)`,
      [s.a.cabinetId, s.missionId, s.a.clientId, p.contributeur.utilisateurId],
    );
    // Cibles et contributeurs : ni ajout, ni modification, ni suppression.
    await refuse(
      `INSERT INTO kpi_cibles (cabinet_id, kpi_id, version, valeur, a_partir_de, cree_par)
       VALUES ($1, $2, 1, 1, '2026-02-01', $3)`,
      [s.a.cabinetId, k, p.contributeur.utilisateurId],
    );
    // Le contributeur ne se désigne pas lui-même sur un autre KPI de son entreprise.
    await refuse(
      `INSERT INTO kpi_contributeurs (cabinet_id, kpi_id, utilisateur_id, ajoute_par)
       VALUES ($1, $2, $3, $3)`,
      [s.a.cabinetId, k2, p.contributeur.utilisateurId],
    );
    expect(
      await dansPortail(async (db) => {
        const supprimes = (await db.query("DELETE FROM kpi_contributeurs WHERE kpi_id = $1", [k]))
          .rowCount;
        const modifies = (
          await db.query("UPDATE kpi_contributeurs SET ajoute_le = now() WHERE kpi_id = $1", [k])
        ).rowCount;
        return { supprimes, modifies };
      }),
    ).toEqual({ supprimes: 0, modifies: 0 });
    // Mesures : origine « portail » ET saisie par un contributeur désigné du KPI.
    const mesure = (origine: string, saisiePar: string, date: string): [string, unknown[]] => [
      `INSERT INTO kpi_mesures (cabinet_id, kpi_id, date_mesure, valeur, origine, saisie_par)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [s.a.cabinetId, k, date, origine, saisiePar],
    ];
    await refuse(...mesure("cabinet", p.contributeur.utilisateurId, "2026-02-01"));
    await refuse(...mesure("portail", p.dirigeant.utilisateurId, "2026-02-02"));
    await refuse(...mesure("portail", s.a.chef.utilisateurId, "2026-02-03"));
    expect(
      await dansPortail(
        async (db) =>
          (await db.query(...mesure("portail", p.contributeur.utilisateurId, "2026-02-04")))
            .rowCount,
      ),
    ).toBe(1);
    // Hors portail, une mesure ne se prétend pas saisie depuis le portail.
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(...mesure("portail", p.contributeur.utilisateurId, "2026-02-05")),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Rien n'a été écrit.
    const bilan = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT (SELECT count(*) FROM kpi_mesures WHERE kpi_id = $1)::int AS mesures,
               (SELECT count(*) FROM kpi_contributeurs WHERE kpi_id = $1)::int AS contributeurs,
               (SELECT libelle FROM kpi_definitions WHERE id = $1) AS libelle`,
            [k],
          )
        ).rows[0],
    );
    expect(bilan).toEqual({ mesures: 0, contributeurs: 1, libelle: "RLS par commande" });
  });
});
