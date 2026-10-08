import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Auth } from "../src/auth/contexte.js";
import { COOKIE_SESSION, hacherJeton } from "../src/auth/session.js";
import type { Db } from "../src/db/pool.js";
import { notifier } from "../src/notifications/notifier.js";
import { horsContextePortail, SENTINELLE_CLIENT_PORTAIL } from "../src/portail/contexte.js";
import { installerGardePortail } from "../src/portail/garde.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { ajouterUtilisateur, connecter, proprietaire, type Contexte } from "./helpers.js";
import { creerKpi } from "./kpi-outils.js";
import { attendre, preparerPortail, type ScenarioPortail } from "./portail-outils.js";
import {
  ajouterEquipe,
  envoyer,
  repondre,
  reponsesAuNiveau,
  versionValidee,
} from "./questionnaires-outils.js";

/*
 * Contexte RLS du portail indépendant de la liste blanche (constat d'audit
 * n° 1) et couverture des tables (n° 2, n° 3) : pour une session du portail,
 * db/pool.ts pose app.portail_client_id et app.portail_utilisateur_id à
 * CHAQUE transaction ; un `withTenant` brut, écrit hors de `avecPortail`, ne
 * voit donc rien d'interne. Vérifié ici avec la VRAIE garde (portail/garde.ts)
 * sur une petite application dont les routes de test font des lectures brutes.
 */

let ctx: Contexte;
let s: ScenarioPortail;
let brute: FastifyInstance;

const LECTURE_BRUTE_PORTAIL = "/api/portail/moi";
const ECRITURE_BRUTE_PORTAIL = "/api/portail/missions/:id/jalons/:jalonId/valider";

/** Tables internes : toujours vides dans le contexte du portail. */
const INTERNES = [
  "collaborateur_couts",
  "grades",
  "budget_lignes",
  "mission_equipe",
  "sessions",
  "utilisateurs_2fa",
  "codes_secours_2fa",
  "defis_2fa",
  "jobs",
  "invitations",
  "journal_audit",
  "portail_parametres",
  "cabinet_feries",
  "parametres_facturation",
];

async function tablesIa(): Promise<string[]> {
  return proprietaire(async (c) =>
    (
      await c.query(
        `SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace
         AND relkind = 'r' AND relname LIKE 'ia\\_%' ORDER BY 1`,
      )
    ).rows.map((x) => x.relname as string),
  );
}

let IA: string[] = [];

/** Lecture BRUTE (sans avecPortail) de ce que voit la transaction courante. */
async function lire(db: Db) {
  const ids = async (sql: string) => (await db.query(sql)).rows.map((x) => x.id as string).sort();
  const n = async (t: string) =>
    (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
  const p = (
    await db.query("SELECT app_portail_client_id() AS client, app_portail_utilisateur() AS u")
  ).rows[0];
  const internes: Record<string, number> = {};
  for (const t of [...INTERNES, ...IA]) internes[t] = await n(t);
  return {
    client: p.client as string | null,
    utilisateur: p.u as string | null,
    missions: await ids("SELECT id FROM missions"),
    clients: await ids("SELECT id FROM clients"),
    utilisateurs: await ids("SELECT id FROM utilisateurs"),
    destinataires: await ids("SELECT DISTINCT destinataire_id AS id FROM notifications"),
    cabinets: await n("cabinets"),
    internes,
  };
}

/**
 * Application minimale : VRAIE session (cookie résolu par resoudre_session,
 * comme app.ts), VRAIE garde, routes de test en lecture brute aux motifs de
 * la liste blanche.
 */
async function appBrute(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate("db", ctx.db);
  app.decorateRequest("auth", null);
  app.decorateRequest("tfaAConfigurer", false);
  await app.register(cookie);
  app.addHook("onRequest", async (request) => {
    const jeton = request.cookies[COOKIE_SESSION];
    if (!jeton) return;
    const session = await ctx.db.withoutTenant(
      async (db) =>
        (await db.query("SELECT * FROM resoudre_session($1)", [hacherJeton(jeton)])).rows[0],
    );
    if (session) {
      request.auth = {
        utilisateurId: session.utilisateur_id,
        cabinetId: session.cabinet_id,
        email: session.email,
        nom: session.nom,
        roles: session.roles,
      };
    }
  });
  installerGardePortail(app);
  const cabinet = (request: { auth: Auth | null }) => request.auth?.cabinetId as string;
  app.get(LECTURE_BRUTE_PORTAIL, async (request) =>
    ctx.db.withTenant(cabinet(request), (db) => lire(db)),
  );
  app.post(ECRITURE_BRUTE_PORTAIL, async (request) => ({
    corps: request.body,
    vu: await ctx.db.withTenant(cabinet(request), (db) => lire(db)),
    sansCabinet: await ctx.db.withoutTenant(
      async (db) => (await db.query("SELECT app_portail_client_id() AS c")).rows[0].c,
    ),
    hors: await horsContextePortail(() => ctx.db.withTenant(cabinet(request), (db) => lire(db))),
  }));
  // Route d'authentification (sans contexte du portail, liste blanche).
  app.get("/api/auth/moi", async (request) =>
    ctx.db.withTenant(cabinet(request), async (db) => {
      return (await db.query("SELECT app_portail_client_id() AS c")).rows[0];
    }),
  );
  return app;
}

/** Session d'un associé (utilisateur interne) du cabinet A. */
let associe: { utilisateurId: string; cookie: string };

const enTete = (u: { cookie: string }) => ({ cookie: u.cookie });

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerPortail(ctx);
  IA = await tablesIa();
  brute = await appBrute();
  const u = await ajouterUtilisateur(ctx, s.a.cabinetId, ["associe"]);
  associe = { utilisateurId: u.utilisateurId, cookie: await connecter(ctx, u.email) };
  // Données internes à cacher : politique du portail, notifications d'autrui.
  await proprietaire(async (c) => {
    await c.query(
      `INSERT INTO portail_parametres (cabinet_id, tfa_obligatoire) VALUES ($1, false)
       ON CONFLICT (cabinet_id) DO NOTHING`,
      [s.a.cabinetId],
    );
    for (const id of [s.a.chef.utilisateurId, s.a.associeId, s.dirigeant.utilisateurId]) {
      await c.query(
        `INSERT INTO notifications (cabinet_id, destinataire_id, type, titre)
         VALUES ($1, $2, 'test_portail', 'Notification de test')`,
        [s.a.cabinetId, id],
      );
    }
  });
}, 240_000);
afterAll(async () => {
  await brute?.close();
  await ctx.fermer();
});

/** Utilisateurs que le dirigeant de A1 peut voir : lui-même, contact principal, responsables des missions partagées. */
async function interlocuteursAttendus(): Promise<string[]> {
  return proprietaire(async (c) => {
    const r = await c.query(
      `SELECT $1::uuid AS id
       UNION SELECT contact_principal_id FROM portail_clients WHERE client_id = $2
       UNION SELECT m.directeur_id FROM missions m JOIN portail_partages p
         ON p.mission_id = m.id AND p.document_id IS NULL WHERE m.client_id = $2
       UNION SELECT m.chef_id FROM missions m JOIN portail_partages p
         ON p.mission_id = m.id AND p.document_id IS NULL WHERE m.client_id = $2`,
      [s.dirigeant.utilisateurId, s.a.clientId],
    );
    return r.rows
      .map((x) => x.id as string)
      .filter(Boolean)
      .sort();
  });
}

describe("contexte RLS du portail posé à chaque transaction (constat n° 1)", () => {
  it("un withTenant BRUT dans une route du portail ne voit rien d'interne", async () => {
    const r = await brute.inject({
      method: "GET",
      url: LECTURE_BRUTE_PORTAIL,
      headers: enTete(s.dirigeant),
    });
    expect(r.statusCode, r.body).toBe(200);
    const vu = r.json();
    expect(vu.client).toBe(s.a.clientId);
    expect(vu.utilisateur).toBe(s.dirigeant.utilisateurId);
    expect(vu.missions).toEqual([s.missionId]);
    expect(vu.clients).toEqual([s.a.clientId]);
    expect(vu.utilisateurs).toEqual(await interlocuteursAttendus());
    expect(vu.utilisateurs).not.toContain(s.a.associeId);
    expect(vu.utilisateurs).not.toContain(s.contributeur.utilisateurId);
    expect(vu.destinataires).toEqual([s.dirigeant.utilisateurId]);
    expect(vu.cabinets).toBe(1);
    expect(Object.values(vu.internes).every((x) => x === 0)).toBe(true);
    expect(Object.keys(vu.internes)).toEqual(expect.arrayContaining(["ia_generations", "jobs"]));
  });

  it("les mêmes lectures, pour un utilisateur interne, voient tout (pas de contexte)", async () => {
    const r = await brute.inject({
      method: "GET",
      url: LECTURE_BRUTE_PORTAIL,
      headers: enTete(associe),
    });
    // Route de la liste blanche du portail : la garde ne concerne pas l'interne.
    expect(r.statusCode, r.body).toBe(200);
    const vu = r.json();
    expect(vu.client).toBeNull();
    expect(vu.missions.length).toBeGreaterThanOrEqual(3);
    expect(vu.utilisateurs).toContain(s.a.associeId);
    for (const t of ["collaborateur_couts", "sessions", "journal_audit", "portail_parametres"]) {
      expect(vu.internes[t], t).toBeGreaterThan(0);
    }
  });

  it("corps de requête lu (POST) : contexte intact ; withoutTenant aussi ; seule sortie explicite", async () => {
    const r = await brute.inject({
      method: "POST",
      url: `/api/portail/missions/${s.missionId}/jalons/${s.jalonAtteint}/valider`,
      headers: enTete(s.contributeur),
      payload: { commentaire: "x".repeat(2000) },
    });
    expect(r.statusCode, r.body).toBe(200);
    const corps = r.json();
    expect(corps.corps.commentaire).toHaveLength(2000);
    expect(corps.vu.client).toBe(s.a.clientId);
    expect(corps.vu.utilisateur).toBe(s.contributeur.utilisateurId);
    expect(corps.vu.internes.collaborateur_couts).toBe(0);
    expect(corps.sansCabinet).toBe(s.a.clientId);
    // horsContextePortail : traitement interne explicite, sans contexte.
    expect(corps.hors.client).toBeNull();
    expect(corps.hors.internes.collaborateur_couts).toBeGreaterThan(0);
  });

  it("rattachement inactif : client SENTINELLE, rien de l'entreprise n'est visible (échec sûr)", async () => {
    const u = s.investisseur.utilisateurId;
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs_portail SET statut = 'desactive' WHERE utilisateur_id = $1", [
        u,
      ]),
    );
    try {
      const r = await brute.inject({
        method: "GET",
        url: LECTURE_BRUTE_PORTAIL,
        headers: enTete(s.investisseur),
      });
      expect(r.statusCode, r.body).toBe(200);
      const vu = r.json();
      expect(vu.client).toBe(SENTINELLE_CLIENT_PORTAIL);
      expect(vu.missions).toEqual([]);
      expect(vu.clients).toEqual([]);
      expect(vu.utilisateurs).toEqual([u]);
      expect(Object.values(vu.internes).every((x) => x === 0)).toBe(true);
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE utilisateurs_portail SET statut = 'actif' WHERE utilisateur_id = $1", [u]),
      );
    }
  });

  it("routes d'authentification de la liste blanche : sans contexte ; aucune fuite d'une requête à l'autre", async () => {
    const portail = await brute.inject({
      method: "GET",
      url: "/api/auth/moi",
      headers: enTete(s.dirigeant),
    });
    expect(portail.json()).toEqual({ c: null });
    await brute.inject({
      method: "GET",
      url: LECTURE_BRUTE_PORTAIL,
      headers: enTete(s.dirigeant),
    });
    const interne = await brute.inject({
      method: "GET",
      url: LECTURE_BRUTE_PORTAIL,
      headers: enTete(associe),
    });
    expect(interne.json().client).toBeNull();
    // Hors requête (tests, tâches de fond) : pas de contexte.
    const direct = await ctx.db.withTenant(s.a.cabinetId, (db) => lire(db));
    expect(direct.client).toBeNull();
  });

  it("la sortie horsContextePortail n'est employée que par les alertes KPI et l'accusé de réception", async () => {
    const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    const usages: string[] = [];
    const parcourir = async (dossier: string): Promise<void> => {
      for (const e of await readdir(dossier, { withFileTypes: true })) {
        const chemin = path.join(dossier, e.name);
        const relatif = path.relative(racine, chemin).replaceAll("\\", "/");
        if (e.isDirectory()) await parcourir(chemin);
        else if (
          e.name.endsWith(".ts") &&
          relatif !== "portail/contexte.ts" &&
          (await readFile(chemin, "utf8")).includes("horsContextePortail")
        )
          usages.push(relatif);
      }
    };
    await parcourir(racine);
    // Toute nouvelle sortie du contexte du portail se justifie ici. Salle de mission : accusé de
    // réception R0 après un dépôt (lit le coupe-circuit N4, informe l'équipe ; rien n'est
    // renvoyé au client dans la réponse).
    expect(usages.sort()).toEqual(["routes/portail-kpi.ts", "salle-mission/accuses.ts"]);
  });
});

describe("tables couvertes dans le contexte du portail (constat n° 2)", () => {
  /** Transaction « du portail » (paramètres posés comme db/pool.ts). */
  const commePortail = <T>(utilisateurId: string, fn: (db: Db) => Promise<T>) =>
    ctx.db.withTenant(s.a.cabinetId, async (db) => {
      await db.query(
        `SELECT set_config('app.portail_client_id', $1, true),
           set_config('app.portail_utilisateur_id', $2, true)`,
        [s.a.clientId, utilisateurId],
      );
      return fn(db);
    });

  it("notifications : les siennes seulement ; l'insertion pour un responsable reste permise", async () => {
    const d = s.dirigeant.utilisateurId;
    const creee = await commePortail(d, async (db) => {
      const n = await notifier(db, {
        cabinetId: s.a.cabinetId,
        destinataireId: s.a.chef.utilisateurId,
        type: "test_portail",
        titre: "Pour le chef de mission",
      });
      // Insérée par cette transaction, elle n'est pas pour autant relisible.
      const relue = await db.query("SELECT 1 FROM notifications WHERE id = $1", [n?.id]);
      return { id: n?.id, relue: relue.rowCount };
    });
    expect(creee.id).toEqual(expect.any(String));
    expect(creee.relue).toBe(0);
    // DELETE est en outre révoqué au rôle applicatif (0020).
    const effets = await commePortail(d, async (db) => ({
      autres: (
        await db.query("UPDATE notifications SET lue_le = now() WHERE destinataire_id <> $1", [d])
      ).rowCount,
      miennes: (
        await db.query("UPDATE notifications SET lue_le = now() WHERE destinataire_id = $1", [d])
      ).rowCount,
    }));
    expect(effets).toEqual({ autres: 0, miennes: 1 });
    // L'annuaire du cabinet n'est pas lisible : pas de notification vers un associé hors missions partagées.
    const versAssocie = await commePortail(d, (db) =>
      notifier(db, {
        cabinetId: s.a.cabinetId,
        destinataireId: s.a.associeId,
        type: "test_portail",
        titre: "Pour l'associé",
      }),
    );
    expect(versAssocie).toBeNull();
    const chez = await proprietaire(
      async (c) =>
        (await c.query("SELECT count(*)::int AS n FROM notifications WHERE id = $1", [creee.id]))
          .rows[0].n,
    );
    expect(chez).toBe(1);
  });

  it("utilisateurs : le haché du mot de passe d'un membre du cabinet n'est pas lisible", async () => {
    const vus = await commePortail(
      s.dirigeant.utilisateurId,
      async (db) => (await db.query("SELECT id, mot_de_passe_hash FROM utilisateurs")).rows,
    );
    expect(vus.map((u) => u.id).sort()).toEqual(await interlocuteursAttendus());
    expect(vus.some((u) => u.id === s.a.associeId)).toBe(false);
  });

  it("auteur d'un questionnaire adressé : visible, donc notifié à la soumission (mission non partagée)", async () => {
    const consultant = await s.a.avecRoles(["consultant"]);
    await ajouterEquipe(s.a, s.missionNonPartagee, consultant.utilisateurId);
    const { versionId, definition } = await versionValidee(consultant, "portail_contexte");
    const envoiId = await envoyer(consultant, s.missionNonPartagee, versionId, [
      { utilisateur_id: s.dirigeant.utilisateurId },
    ]);
    await repondre(s.dirigeant, envoiId, reponsesAuNiveau(definition, 3));
    const notes = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT type FROM notifications WHERE destinataire_id = $1 AND type = 'questionnaire_soumis'",
            [consultant.utilisateurId],
          )
        ).rows,
    );
    expect(notes).toHaveLength(1);
    // Il reste invisible d'un autre utilisateur du client, à qui rien n'a été adressé.
    const vusParContributeur = await commePortail(
      s.contributeur.utilisateurId,
      async (db) =>
        (await db.query("SELECT id FROM utilisateurs WHERE id = $1", [consultant.utilisateurId]))
          .rows,
    );
    expect(vusParContributeur).toEqual([]);
  });

  it("suppressions de fichiers : seulement celles des fichiers visibles", async () => {
    const fichiers = await proprietaire(async (c) => {
      const r = await c.query(
        "SELECT id, fichier_id FROM mission_documents WHERE id = ANY ($1::uuid[])",
        [[s.documentId, s.documentNonPartage]],
      );
      return new Map(r.rows.map((x) => [x.id as string, x.fichier_id as string]));
    });
    await proprietaire((c) =>
      c.query(
        `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif) VALUES ($1, $2, 'retire')`,
        [s.a.cabinetId, fichiers.get(s.documentNonPartage)],
      ),
    );
    const n = () =>
      commePortail(s.dirigeant.utilisateurId, async (db) =>
        (await db.query("SELECT fichier_id FROM fichiers_suppressions")).rows.map(
          (x) => x.fichier_id as string,
        ),
      );
    expect(await n()).toEqual([]);
    await proprietaire((c) =>
      c.query(
        `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif) VALUES ($1, $2, 'retire')`,
        [s.a.cabinetId, fichiers.get(s.documentId)],
      ),
    );
    expect(await n()).toEqual([fichiers.get(s.documentId)]);
    // Le livrable retiré n'est plus téléchargeable (le NOT EXISTS du portail voit la suppression).
    const l = (await s.contributeur.get(`/api/portail/missions/${s.missionId}/livrables`)).json();
    expect(l.elements[0]).toMatchObject({ id: s.documentId, telechargeable: false });
    expect(
      (await s.contributeur.get(`/api/portail/livrables/${s.documentId}/fichier`)).statusCode,
    ).toBe(404);
  });
});

describe("tables lues par le portail : lecture seule (constat n° 3)", () => {
  const LECTURE_SEULE = [
    "clients",
    "utilisateurs_portail",
    "portail_clients",
    "portail_partages",
    "missions",
    "mission_jalons",
    "mission_documents",
    "fichiers",
    "factures",
    "facture_lignes",
    "imputations",
    "cabinets",
    "fichiers_suppressions",
    "utilisateurs",
  ];

  it("catalogue : politique portail FOR SELECT et refus d'INSERT, UPDATE et DELETE", async () => {
    const r = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT tablename, policyname, cmd, permissive FROM pg_policies
             WHERE schemaname = 'public' AND tablename = ANY ($1) AND policyname LIKE 'portail%'`,
            [LECTURE_SEULE],
          )
        ).rows as { tablename: string; policyname: string; cmd: string; permissive: string }[],
    );
    for (const t of LECTURE_SEULE) {
      const p = r.filter((x) => x.tablename === t);
      expect(
        p.every((x) => x.permissive === "RESTRICTIVE"),
        t,
      ).toBe(true);
      // fichiers : le portail insère SES seuls fichiers, déposés dans la salle de mission
      // (`portail_depot`, 0331 : envoye_par = utilisateur du portail de la transaction).
      expect(p.map((x) => `${x.policyname}:${x.cmd}`).sort(), t).toEqual([
        "portail:SELECT",
        ...(t === "fichiers" ? ["portail_depot:INSERT"] : []),
        "portail_sans_delete:DELETE",
        ...(t === "fichiers" ? [] : ["portail_sans_insert:INSERT"]),
        "portail_sans_update:UPDATE",
      ]);
    }
  });

  it("dans une transaction du portail, aucune écriture ne passe sur une table lue", async () => {
    const tenter = (sql: string, valeurs: unknown[] = []) =>
      ctx.db
        .withTenant(s.a.cabinetId, async (db) => {
          await db.query("SELECT set_config('app.portail_client_id', $1, true)", [s.a.clientId]);
          return (await db.query(sql, valeurs)).rowCount;
        })
        .catch((e: Error) => e.message);
    const refus = /row-level security|permission denied/;
    for (const sql of [
      "UPDATE missions SET intitule = intitule",
      "UPDATE mission_jalons SET libelle = libelle",
      "UPDATE factures SET objet = objet",
      "UPDATE clients SET raison_sociale = raison_sociale",
      "UPDATE portail_partages SET jalons = jalons",
      "UPDATE utilisateurs SET nom = nom",
      "UPDATE cabinets SET nom = nom",
      "DELETE FROM portail_partages",
      "DELETE FROM mission_jalons",
    ]) {
      const r = await tenter(sql);
      expect(r === 0 || refus.test(String(r)), `${sql} : ${r}`).toBe(true);
    }
    for (const [sql, valeurs] of [
      [
        `INSERT INTO portail_partages (cabinet_id, client_id, mission_id, partage_par)
         VALUES ($1, $2, $3, $4)`,
        [s.a.cabinetId, s.a.clientId, s.missionId, s.a.associeId],
      ],
      ["INSERT INTO clients (cabinet_id, raison_sociale) VALUES ($1, 'Intrus')", [s.a.cabinetId]],
      [
        `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
         VALUES ($1, 'intrus@client.test', 'Intrus', '{associe}', 'x')`,
        [s.a.cabinetId],
      ],
    ] as const) {
      expect(await tenter(sql, [...valeurs]), sql).toMatch(/row-level security/);
    }
    // Rien n'a changé.
    expect((await s.dirigeant.get("/api/portail/missions")).json().elements).toHaveLength(1);
  });
});

describe("KPI : contrôle de la mission DANS le contexte du portail", () => {
  it("mission non partagée invisible ; seule la fonction étroite dit si elle est close", async () => {
    const k = await creerKpi(s.a.chef, s.missionNonPartagee, { libelle: "KPI hors partage" });
    attendre(
      200,
      await s.a.chef.put(`/api/kpi/${k.id}/contributeurs`, {
        utilisateurs: [s.contributeur.utilisateurId],
      }),
      "contributeurs",
    );
    const voir = (utilisateurId: string) =>
      ctx.db.withTenant(s.a.cabinetId, async (db) => {
        await db.query(
          `SELECT set_config('app.portail_client_id', $1, true),
             set_config('app.portail_utilisateur_id', $2, true)`,
          [s.a.clientId, utilisateurId],
        );
        return {
          cloturee: (await db.query("SELECT portail_kpi_mission_cloturee($1) AS c", [k.id])).rows[0]
            .c,
          mission: (
            await db.query("SELECT statut FROM missions WHERE id = $1", [s.missionNonPartagee])
          ).rows,
        };
      });
    expect(await voir(s.contributeur.utilisateurId)).toEqual({ cloturee: false, mission: [] });
    // Non contributeur, ou hors contexte du portail : rien.
    expect((await voir(s.dirigeant.utilisateurId)).cloturee).toBeNull();
    const interne = await ctx.db.withTenant(
      s.a.cabinetId,
      async (db) =>
        (await db.query("SELECT portail_kpi_mission_cloturee($1) AS c", [k.id])).rows[0].c,
    );
    expect(interne).toBeNull();
    const r = await s.contributeur.post(`/api/portail/kpi/${k.id}/mesures`, {
      date_mesure: "2026-03-15",
      valeur: 10,
    });
    expect(r.statusCode, r.body).toBe(201);
  });
});
