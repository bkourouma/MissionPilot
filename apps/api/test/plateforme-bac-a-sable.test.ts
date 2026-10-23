import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createDatabase } from "../src/db/pool.js";
import type { Db } from "../src/db/pool.js";
import { api, type Api } from "./api.js";
import {
  configTest,
  creerCabinet,
  MOT_DE_PASSE_TEST,
  proprietaire,
  type Contexte,
} from "./helpers.js";
import {
  connecterPlateforme,
  creerCabinetParPlateforme,
  creerSuperAdmin,
  emailUnique,
  UUID_INCONNU,
  type SuperAdminTest,
} from "./plateforme-outils.js";

/*
 * Super admin de démonstration = bac à sable (migration 0582).
 *
 * - Un super admin `est_demo` ne voit et n'atteint QUE les cabinets `est_demo` : les autres
 *   sont absents de la liste (compteurs compris) et répondent comme un cabinet inconnu
 *   (MQP02 côté SQL, 404 côté route), sans être verrouillés.
 * - Un cabinet qu'il crée naît `est_demo = true` (connexion « un clic ») ; un super admin
 *   réel crée toujours `est_demo = false` et garde exactement ses droits.
 * - Le rôle applicatif ne pose toujours pas `est_demo` en direct (42501).
 *
 * Cabinets, comptes et super admins sont créés par SQL propriétaire (est_demo posé par ce
 * SQL) ; en afterAll, est_demo est remis à faux sur tout ce que ce fichier a créé (y compris
 * les cabinets créés par le super admin de démonstration) et les super admins sont désactivés.
 * L'instance active la démonstration (DEMO_PUBLIQUE=oui) : sans elle, un super admin de
 * démonstration ne se connecte pas par mot de passe (0581).
 */

let ctx: Contexte;
let hash: string;
const cabinetsMarques: string[] = [];
const admins: string[] = [];

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const nouveauJetonHash = () => sha256(randomBytes(32).toString("base64url"));

/** Requête avec le rôle applicatif, hors contexte de cabinet. */
function app<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return ctx.db.withoutTenant(async (db: Db) => (await db.query(sql, params)).rows as T[]);
}

/** Requête avec le rôle propriétaire (hors RLS). */
function proprio<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return proprietaire(async (c) => (await c.query(sql, params)).rows as T[]);
}

/** SQLSTATE et message de l'erreur levée (undefined si la promesse aboutit). */
async function erreur(p: Promise<unknown>): Promise<{ code: string; message: string } | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    const x = e as { code?: string; message?: string };
    return { code: x.code ?? "sans_code", message: x.message ?? "" };
  }
}
const code = async (p: Promise<unknown>) => (await erreur(p))?.code;

/** Comme `erreur`, avec l'indice SQL (HINT) des refus de la démonstration. */
async function erreurComplete(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    const x = e as { code?: string; message?: string; hint?: string };
    return { code: x.code ?? "sans_code", message: x.message ?? "", hint: x.hint };
  }
}

/** Adresse au format réel (hors .test), jamais attribuée. */
const emailLibreReel = () => `libre-${randomBytes(5).toString("hex")}@entreprise-reelle.com`;

/** Volumes qui ne doivent pas bouger quand une création est refusée. */
async function compteurs() {
  const [r] = await proprio(
    `SELECT (SELECT count(*)::int FROM cabinets) AS cabinets,
            (SELECT count(*)::int FROM utilisateurs) AS utilisateurs,
            (SELECT count(*)::int FROM journal_plateforme) AS journal,
            (SELECT count(*)::int FROM journal_audit) AS audit`,
  );
  return r;
}

/** Travail du propriétaire dans une transaction ANNULÉE à la fin (rien ne reste en base). */
function proprioAnnule<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  return proprietaire(async (c) => {
    await c.query("BEGIN");
    try {
      return await fn(c);
    } finally {
      await c.query("ROLLBACK");
    }
  });
}

/** Ajoute `n` comptes consultants au cabinet (SQL propriétaire, adresses .test uniques). */
async function remplirComptes(c: pg.Client, cabinetId: string, n: number): Promise<void> {
  await c.query(
    `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
     SELECT $1, format('remplissage-%s-%s@bac.test', $2::text, i), 'Remplissage',
            ARRAY['consultant'], $3
     FROM generate_series(1, $4::int) i`,
    [cabinetId, randomBytes(5).toString("hex"), hash, n],
  );
}

/** Connexion directe avec le rôle applicatif (tests de concurrence). */
async function clientApp(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: configTest().DATABASE_URL });
  await c.connect();
  return c;
}

async function pid(c: pg.Client): Promise<number> {
  const r = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return r.rows[0]!.pid;
}

/** Attend que la connexion `pid` soit bloquée sur un verrou (pg_locks, non accordé). */
async function attendreVerrou(p: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [r] = await proprio<{ bloque: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted) AS bloque",
      [p],
    );
    if (r!.bloque) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("La connexion n'a jamais attendu de verrou");
}

async function marquerDemo(cabinetId: string): Promise<void> {
  await proprio("UPDATE cabinets SET est_demo = true WHERE id = $1", [cabinetId]);
  cabinetsMarques.push(cabinetId);
}

async function superAdmin(demo: boolean): Promise<SuperAdminTest> {
  const a = await creerSuperAdmin();
  admins.push(a.id);
  if (demo) await proprio("UPDATE super_admins SET est_demo = true WHERE id = $1", [a.id]);
  return a;
}

async function ouvrirSession(superAdminId: string): Promise<string> {
  const jeton = nouveauJetonHash();
  await app("SELECT plateforme_ouvrir_session($1, $2)", [superAdminId, jeton]);
  return jeton;
}

interface LigneCabinet {
  id: string;
  nom: string;
  actif: boolean;
  est_demo: boolean;
  nb_utilisateurs: number;
  nb_utilisateurs_actifs: number;
}
const listerCabinets = (jeton: string) =>
  app<LigneCabinet>("SELECT * FROM plateforme_lister_cabinets($1)", [jeton]);

const creerCabinetSql = (jeton: string) =>
  app<{ cabinet_id: string; utilisateur_id: string }>(
    "SELECT * FROM plateforme_creer_cabinet($1, $2, 'SN', $3, 'Associé Bac', $4)",
    [jeton, `Bac à sable ${randomBytes(4).toString("hex")}`, emailUnique("bac-assoc"), hash],
  );

/**
 * Les appels par identifiant de cabinet (fonctions de 0573), pour un cabinet et un compte
 * donnés, exécutés l'un après l'autre ; renvoie l'erreur de chacun.
 */
async function appelsParIdentifiant(jeton: string, cabinetId: string, utilisateurId: string) {
  const appels: [string, unknown[]][] = [
    ["SELECT * FROM plateforme_modifier_cabinet($1, $2, 'Renommé', NULL)", [jeton, cabinetId]],
    ["SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, false)", [jeton, cabinetId]],
    ["SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, NULL)", [jeton, cabinetId]],
    ["SELECT * FROM plateforme_lister_utilisateurs($1, $2)", [jeton, cabinetId]],
    [
      "SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, 'Intrus', '{consultant}', $4)",
      [jeton, cabinetId, emailUnique("intrus"), hash],
    ],
    [
      "SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, false, NULL)",
      [jeton, cabinetId, utilisateurId],
    ],
    [
      "SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, NULL, '{consultant}')",
      [jeton, cabinetId, UUID_INCONNU],
    ],
  ];
  const erreurs = [];
  for (const [sql, params] of appels) erreurs.push(await erreur(app(sql, params)));
  return erreurs;
}

/** État observable d'un cabinet (et de ses comptes, journaux, sessions) pour « rien n'a changé ». */
async function etat(cabinetId: string) {
  const [r] = await proprio(
    `SELECT c.nom, c.actif, c.est_demo,
            (SELECT array_agg(u.id::text || ':' || u.actif || ':' || array_to_string(u.roles, ',')
                              ORDER BY u.id) FROM utilisateurs u WHERE u.cabinet_id = c.id) AS comptes,
            (SELECT count(*)::int FROM journal_audit j WHERE j.cabinet_id = c.id) AS audit,
            (SELECT count(*)::int FROM journal_plateforme j WHERE j.cabinet_id = c.id) AS plateforme,
            (SELECT count(*)::int FROM sessions s WHERE s.cabinet_id = c.id) AS sessions
     FROM cabinets c WHERE c.id = $1`,
    [cabinetId],
  );
  return r;
}

// Jeu de données.
let reel: { cabinetId: string; email: string; utilisateurId: string };
let demo: { cabinetId: string; email: string; utilisateurId: string };
let adminDemo: SuperAdminTest;
let adminReel: SuperAdminTest;
let jetonDemo: string;
let jetonReel: string;
/** Compte d'un cabinet réel avec une adresse réelle (hors .test), créé par SQL propriétaire. */
let externe: { email: string; cabinetId: string };

beforeAll(async () => {
  const config = { ...configTest(), DEMO_PUBLIQUE: "oui" as const };
  const db = createDatabase(config);
  const instance = await buildApp(config, db);
  ctx = {
    config,
    db,
    app: instance,
    fermer: async () => {
      await instance.close();
      await db.close();
    },
  };
  hash = await hashPassword(MOT_DE_PASSE_TEST);
  reel = await creerCabinet(ctx, "Cabinet réel bac à sable");
  demo = await creerCabinet(ctx, "Cabinet démo bac à sable");
  await marquerDemo(demo.cabinetId);
  adminDemo = await superAdmin(true);
  adminReel = await superAdmin(false);
  jetonDemo = await ouvrirSession(adminDemo.id);
  jetonReel = await ouvrirSession(adminReel.id);
  const [cabExterne] = await proprio<{ id: string }>(
    "INSERT INTO cabinets (nom) VALUES ('Cabinet réel externe') RETURNING id",
  );
  externe = {
    email: `Externe-${randomBytes(5).toString("hex")}@Entreprise-Reelle.com`,
    cabinetId: cabExterne!.id,
  };
  await proprio(
    `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
     VALUES ($1, $2, 'Compte Externe', '{associe}', $3)`,
    [externe.cabinetId, externe.email, hash],
  );
}, 120_000);

afterAll(async () => {
  // Les fichiers suivants de la même exécution ne voient plus ces données de démonstration :
  // cabinets marqués ici, et tout cabinet créé par un super admin de ce fichier.
  await proprio(
    `UPDATE cabinets SET est_demo = false
     WHERE est_demo AND (id = ANY ($1::uuid[]) OR id::text IN (
       SELECT j.cible_id FROM journal_plateforme j
       WHERE j.action = 'cabinet_creation' AND j.super_admin_id = ANY ($2::uuid[])))`,
    [cabinetsMarques, admins],
  );
  await proprio("UPDATE super_admins SET est_demo = false, actif = false WHERE id = ANY ($1)", [
    admins,
  ]);
  await ctx.fermer();
});

describe("bac à sable SQL : liste des cabinets", () => {
  it("super admin démo : cabinets démo seulement, compteurs identiques à ceux du super admin réel", async () => {
    const vusDemo = await listerCabinets(jetonDemo);
    const vusReel = await listerCabinets(jetonReel);
    const tousDemo = await proprio<{ id: string }>(
      "SELECT id FROM cabinets WHERE est_demo ORDER BY id",
    );
    const tous = await proprio<{ id: string }>("SELECT id FROM cabinets ORDER BY id");

    expect(vusDemo.map((c) => c.id).sort()).toEqual(tousDemo.map((c) => c.id));
    expect(vusDemo.every((c) => c.est_demo)).toBe(true);
    expect(vusDemo.map((c) => c.id)).toContain(demo.cabinetId);
    expect(vusDemo.map((c) => c.id)).not.toContain(reel.cabinetId);

    // Super admin réel : tous les cabinets, démo compris, comme en 0573.
    expect(vusReel.map((c) => c.id).sort()).toEqual(tous.map((c) => c.id));
    expect(vusReel.map((c) => c.id)).toContain(reel.cabinetId);
    const pourReel = vusReel.find((c) => c.id === demo.cabinetId);
    const pourDemo = vusDemo.find((c) => c.id === demo.cabinetId);
    expect(pourDemo).toEqual(pourReel);
    expect(pourDemo).toMatchObject({
      est_demo: true,
      nb_utilisateurs: 1,
      nb_utilisateurs_actifs: 1,
    });
  });
});

describe("bac à sable SQL : cabinet réel inatteignable pour le super admin démo", () => {
  it("toute opération par identifiant : MQP02, même message qu'un cabinet inconnu, rien d'écrit", async () => {
    const avant = await etat(reel.cabinetId);
    const inconnus = await appelsParIdentifiant(jetonDemo, UUID_INCONNU, reel.utilisateurId);
    const refus = await appelsParIdentifiant(jetonDemo, reel.cabinetId, reel.utilisateurId);
    expect(refus).toHaveLength(7);
    for (let i = 0; i < refus.length; i++) {
      expect(refus[i], `appel ${i}`).toEqual({ code: "MQP02", message: "Cabinet introuvable." });
      expect(refus[i], `appel ${i}`).toEqual(inconnus[i]);
    }
    expect(await etat(reel.cabinetId)).toEqual(avant);
    // Aucune ligne du journal de la plateforme pour ce super admin hors connexion.
    const [j] = await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM journal_plateforme WHERE super_admin_id = $1 AND action <> 'connexion'",
      [adminDemo.id],
    );
    expect(j!.n).toBe(0);
  });

  it("le super admin réel garde ses MQP d'origine sur ce même cabinet (MQP04, MQP03)", async () => {
    expect(
      await code(
        app("SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, NULL)", [
          jetonReel,
          reel.cabinetId,
        ]),
      ),
    ).toBe("MQP04");
    expect(
      await code(
        app("SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, false, NULL)", [
          jetonReel,
          reel.cabinetId,
          UUID_INCONNU,
        ]),
      ),
    ).toBe("MQP03");
    const liste = await app<{ id: string }>(
      "SELECT * FROM plateforme_lister_utilisateurs($1, $2)",
      [jetonReel, reel.cabinetId],
    );
    expect(liste.map((u) => u.id)).toEqual([reel.utilisateurId]);
  });

  it("verrous : le cabinet réel n'est pas attendu par le super admin démo ; réel et cabinet démo l'attendent", async () => {
    const verrou = new pg.Client({ connectionString: configTest().DATABASE_OWNER_URL });
    await verrou.connect();
    /** Appel du rôle applicatif dans une transaction qui n'attend pas un verrou plus de 300 ms. */
    const sousVerrou = async (sql: string, params: unknown[]) => {
      const c = new pg.Client({ connectionString: configTest().DATABASE_URL });
      await c.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL lock_timeout = '300ms'");
        return await code(c.query(sql, params));
      } finally {
        await c.query("ROLLBACK");
        await c.end();
      }
    };
    try {
      await verrou.query("BEGIN");
      await verrou.query("SELECT 1 FROM cabinets WHERE id = ANY ($1) FOR UPDATE", [
        [reel.cabinetId, demo.cabinetId],
      ]);
      const modifier = "SELECT * FROM plateforme_modifier_cabinet($1, $2, 'Verrou', NULL)";
      const creer =
        "SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, 'Verrou', '{consultant}', $4)";
      // Démo sur cabinet réel : refus immédiat (pas d'attente du verrou).
      expect(await sousVerrou(modifier, [jetonDemo, reel.cabinetId])).toBe("MQP02");
      expect(
        await sousVerrou(creer, [jetonDemo, reel.cabinetId, emailUnique("verrou"), hash]),
      ).toBe("MQP02");
      // Réel sur cabinet réel, démo sur cabinet démo : verrou pris comme en 0573 (attente).
      expect(await sousVerrou(modifier, [jetonReel, reel.cabinetId])).toBe("55P03");
      expect(await sousVerrou(modifier, [jetonDemo, demo.cabinetId])).toBe("55P03");
      expect(
        await sousVerrou(creer, [jetonReel, reel.cabinetId, emailUnique("verrou"), hash]),
      ).toBe("55P03");
    } finally {
      await verrou.query("ROLLBACK");
      await verrou.end();
    }
  });
});

describe("bac à sable SQL : le super admin démo gère les cabinets démo", () => {
  it("modification du cabinet, comptes (création, rôles, état), MQP05 et MQP03 inchangés", async () => {
    const [c] = await app<{ nom: string; est_demo: boolean }>(
      "SELECT * FROM plateforme_modifier_cabinet($1, $2, '  Démo renommé  ', NULL)",
      [jetonDemo, demo.cabinetId],
    );
    expect(c).toMatchObject({ nom: "Démo renommé", est_demo: true });
    const [off] = await app<{ actif: boolean }>(
      "SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, false)",
      [jetonDemo, demo.cabinetId],
    );
    expect(off!.actif).toBe(false);
    await app("SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, true)", [
      jetonDemo,
      demo.cabinetId,
    ]);

    const [u] = await app<{ id: string; roles: string[] }>(
      "SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, 'Compte Démo', '{consultant}', $4)",
      [jetonDemo, demo.cabinetId, emailUnique("bac-compte"), hash],
    );
    expect(u!.roles).toEqual(["consultant"]);
    const [m] = await app<{ roles: string[]; actif: boolean }>(
      "SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, false, '{chef_mission}')",
      [jetonDemo, demo.cabinetId, u!.id],
    );
    expect(m).toMatchObject({ roles: ["chef_mission"], actif: false });
    const liste = await app<{ id: string }>(
      "SELECT * FROM plateforme_lister_utilisateurs($1, $2)",
      [jetonDemo, demo.cabinetId],
    );
    expect(liste.map((x) => x.id).sort()).toEqual([demo.utilisateurId, u!.id].sort());

    // Règles de 0573 inchangées : dernier associé (MQP05), compte d'un autre cabinet (MQP03).
    expect(
      await code(
        app("SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, false, NULL)", [
          jetonDemo,
          demo.cabinetId,
          demo.utilisateurId,
        ]),
      ),
    ).toBe("MQP05");
    expect(
      await code(
        app("SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, false, NULL)", [
          jetonDemo,
          demo.cabinetId,
          reel.utilisateurId,
        ]),
      ),
    ).toBe("MQP03");

    // Journal de la plateforme : mêmes actions et détails qu'en 0573, au nom du super admin démo.
    const journal = await proprio<{ action: string; details: unknown }>(
      `SELECT action, details FROM journal_plateforme
       WHERE super_admin_id = $1 AND cabinet_id = $2 ORDER BY id`,
      [adminDemo.id, demo.cabinetId],
    );
    expect(journal).toEqual([
      { action: "cabinet_modification", details: { nom: "Démo renommé" } },
      { action: "cabinet_modification", details: { actif: false } },
      { action: "cabinet_modification", details: { actif: true } },
      { action: "utilisateur_creation", details: { roles: ["consultant"] } },
      { action: "utilisateur_modification", details: { actif: false, roles: ["chef_mission"] } },
    ]);
  });
});

describe("bac à sable SQL : création d'un cabinet", () => {
  it("super admin démo : est_demo vrai, journal identique à 0573, visible et ouvrable en démo", async () => {
    const [cree] = await creerCabinetSql(jetonDemo);
    const [cab] = await proprio<{ est_demo: boolean; actif: boolean; nom: string }>(
      "SELECT est_demo, actif, nom FROM cabinets WHERE id = $1",
      [cree!.cabinet_id],
    );
    expect(cab).toMatchObject({ est_demo: true, actif: true });
    const [l] = await proprio(
      `SELECT action, cible, cible_id, cabinet_id, details FROM journal_plateforme
       WHERE super_admin_id = $1 ORDER BY id DESC LIMIT 1`,
      [adminDemo.id],
    );
    expect(l).toEqual({
      action: "cabinet_creation",
      cible: "cabinet",
      cible_id: cree!.cabinet_id,
      cabinet_id: cree!.cabinet_id,
      details: { nom: cab!.nom, pays: "SN", associe_id: cree!.utilisateur_id },
    });
    expect((await listerCabinets(jetonDemo)).map((c) => c.id)).toContain(cree!.cabinet_id);
    expect((await listerCabinets(jetonReel)).map((c) => c.id)).toContain(cree!.cabinet_id);
    const ouvrables = await app<{ cabinet_id: string; roles: string[] }>(
      "SELECT * FROM demo_lister_comptes() WHERE cabinet_id = $1",
      [cree!.cabinet_id],
    );
    expect(ouvrables).toHaveLength(1);
    expect(ouvrables[0]!.roles).toEqual(["associe"]);
  });

  it("super admin réel : est_demo faux, absent de la démo", async () => {
    const [cree] = await creerCabinetSql(jetonReel);
    const [cab] = await proprio<{ est_demo: boolean }>(
      "SELECT est_demo FROM cabinets WHERE id = $1",
      [cree!.cabinet_id],
    );
    expect(cab!.est_demo).toBe(false);
    expect((await listerCabinets(jetonDemo)).map((c) => c.id)).not.toContain(cree!.cabinet_id);
    expect(
      await app("SELECT * FROM demo_lister_comptes() WHERE cabinet_id = $1", [cree!.cabinet_id]),
    ).toEqual([]);
  });

  it("super admin démo : paramètres invalides (MQP04) et collision entre adresses .test (23505) sans rien créer", async () => {
    const [{ n: avant }] = (await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM cabinets",
    )) as [{ n: number }];
    expect(reel.email.endsWith(".test")).toBe(true);
    expect(
      await code(
        app("SELECT * FROM plateforme_creer_cabinet($1, ' ', 'CI', $2, 'Associé', $3)", [
          jetonDemo,
          emailUnique("bac"),
          hash,
        ]),
      ),
    ).toBe("MQP04");
    expect(
      await code(
        app("SELECT * FROM plateforme_creer_cabinet($1, 'Doublon', 'CI', $2, 'Associé', $3)", [
          jetonDemo,
          reel.email,
          hash,
        ]),
      ),
    ).toBe("23505");
    const [{ n: apres }] = (await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM cabinets",
    )) as [{ n: number }];
    expect(apres).toBe(avant);
  });
});

describe("bac à sable SQL : adresse .test exigée (aucun oracle d'existence d'e-mail)", () => {
  const creerCabinetAvec = (jeton: string, email: string) =>
    app("SELECT * FROM plateforme_creer_cabinet($1, 'Oracle', 'CI', $2, 'Associé', $3)", [
      jeton,
      email,
      hash,
    ]);
  const creerCompteAvec = (jeton: string, cabinetId: string, email: string) =>
    app("SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, 'Oracle', '{consultant}', $4)", [
      jeton,
      cabinetId,
      email,
      hash,
    ]);

  it("super admin démo : adresse réelle existante ou libre, même MQP04, même message, rien d'écrit", async () => {
    const avant = await compteurs();
    const refus = [
      await erreurComplete(creerCabinetAvec(jetonDemo, externe.email)),
      await erreurComplete(creerCabinetAvec(jetonDemo, externe.email.toUpperCase())),
      await erreurComplete(creerCabinetAvec(jetonDemo, emailLibreReel())),
      await erreurComplete(creerCompteAvec(jetonDemo, demo.cabinetId, externe.email)),
      await erreurComplete(creerCompteAvec(jetonDemo, demo.cabinetId, emailLibreReel())),
      await erreurComplete(creerCompteAvec(jetonDemo, demo.cabinetId, "x@exemple.test.com")),
    ];
    for (const r of refus)
      expect(r).toEqual({
        code: "MQP04",
        message: "Une adresse en .test est exigée en mode démonstration.",
        hint: "demo_email_test",
      });
    expect(await compteurs()).toEqual(avant);
  });

  it("super admin démo : adresse .test acceptée (casse et espaces normalisés) ; super admin réel non concerné", async () => {
    const [u] = await creerCompteAvec(
      jetonDemo,
      demo.cabinetId,
      `  ${emailUnique("casse").toUpperCase().replace(".TEST", ".TeSt")}  `,
    );
    expect(u).toBeDefined();
    const [r] = await creerCompteAvec(jetonReel, externe.cabinetId, emailLibreReel());
    expect(r).toBeDefined();
    // Une adresse réelle déjà prise reste un 23505 pour le super admin réel (0573).
    expect(await code(creerCompteAvec(jetonReel, externe.cabinetId, externe.email))).toBe("23505");
  });
});

describe("bac à sable SQL : plafonds de la démonstration", () => {
  it("30 cabinets de démonstration au plus (transaction annulée) ; le super admin réel n'est pas plafonné", async () => {
    await proprioAnnule(async (c) => {
      const [{ n }] = (
        await c.query<{ n: number }>("SELECT count(*)::int AS n FROM cabinets WHERE est_demo")
      ).rows as [{ n: number }];
      expect(n).toBeLessThan(29);
      await c.query(
        `INSERT INTO cabinets (nom, est_demo)
         SELECT format('Plafond %s', i), true FROM generate_series(1, $1::int) i`,
        [29 - n],
      );
      const creer = (jeton: string) =>
        c.query("SELECT * FROM plateforme_creer_cabinet($1, 'Plafond', 'CI', $2, 'Associé', $3)", [
          jeton,
          emailUnique("plafond"),
          hash,
        ]);
      expect((await creer(jetonDemo)).rows).toHaveLength(1); // le 30e
      await c.query("SAVEPOINT plafond");
      expect(await erreurComplete(creer(jetonDemo))).toEqual({
        code: "MQP04",
        message: "Plafond de la démonstration atteint : 30 cabinets au plus.",
        hint: "demo_plafond_cabinets",
      });
      await c.query("ROLLBACK TO SAVEPOINT plafond");
      const [{ n: total }] = (
        await c.query<{ n: number }>("SELECT count(*)::int AS n FROM cabinets WHERE est_demo")
      ).rows as [{ n: number }];
      expect(total).toBe(30);
      expect((await creer(jetonReel)).rows).toHaveLength(1);
    });
  });

  it("40 comptes au plus par cabinet de démonstration (transaction annulée) ; le super admin réel n'est pas plafonné", async () => {
    await proprioAnnule(async (c) => {
      const [{ n }] = (
        await c.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM utilisateurs WHERE cabinet_id = $1",
          [demo.cabinetId],
        )
      ).rows as [{ n: number }];
      expect(n).toBeLessThan(39);
      await remplirComptes(c, demo.cabinetId, 39 - n);
      const creer = (jeton: string) =>
        c.query(
          "SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, 'Plafond', '{consultant}', $4)",
          [jeton, demo.cabinetId, emailUnique("plafond-compte"), hash],
        );
      expect((await creer(jetonDemo)).rows).toHaveLength(1); // le 40e
      await c.query("SAVEPOINT plafond");
      expect(await erreurComplete(creer(jetonDemo))).toEqual({
        code: "MQP04",
        message: "Plafond de la démonstration atteint : 40 comptes au plus par cabinet.",
        hint: "demo_plafond_utilisateurs",
      });
      await c.query("ROLLBACK TO SAVEPOINT plafond");
      expect((await creer(jetonReel)).rows).toHaveLength(1);
    });
  });

  it("deux créations de cabinet simultanées ne dépassent pas 30 (verrou consultatif)", async () => {
    const [{ n }] = (await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM cabinets WHERE est_demo",
    )) as [{ n: number }];
    expect(n).toBeLessThan(29);
    const remplissage = await proprio<{ id: string }>(
      `INSERT INTO cabinets (nom, est_demo)
       SELECT format('Plafond concurrent %s', i), true FROM generate_series(1, $1::int) i
       RETURNING id`,
      [29 - n],
    );
    cabinetsMarques.push(...remplissage.map((r) => r.id));
    const c1 = await clientApp();
    const c2 = await clientApp();
    const creer = (c: pg.Client) =>
      c.query("SELECT * FROM plateforme_creer_cabinet($1, 'Concurrent', 'CI', $2, 'A', $3)", [
        jetonDemo,
        emailUnique("concurrent"),
        hash,
      ]);
    try {
      await c1.query("BEGIN");
      expect((await creer(c1)).rows).toHaveLength(1);
      const pid2 = await pid(c2);
      const p2 = erreurComplete(creer(c2));
      await attendreVerrou(pid2);
      await c1.query("COMMIT");
      expect(await p2).toMatchObject({ code: "MQP04", hint: "demo_plafond_cabinets" });
      const [{ n: total }] = (await proprio<{ n: number }>(
        "SELECT count(*)::int AS n FROM cabinets WHERE est_demo",
      )) as [{ n: number }];
      expect(total).toBe(30);
    } finally {
      await c1.end();
      await c2.end();
      // Retour sous le plafond pour la suite du fichier (le cabinet créé est aussi rendu réel).
      await proprio(
        `UPDATE cabinets SET est_demo = false
         WHERE id = ANY ($1::uuid[]) OR (est_demo AND nom = 'Concurrent')`,
        [remplissage.map((r) => r.id)],
      );
    }
  });

  it("deux créations de compte simultanées dans un cabinet de démonstration ne dépassent pas 40", async () => {
    const cab = await creerCabinet(ctx, "Cabinet démo plafond comptes");
    await marquerDemo(cab.cabinetId);
    await proprietaire((c) => remplirComptes(c, cab.cabinetId, 38)); // 1 associé + 38 = 39
    const c1 = await clientApp();
    const c2 = await clientApp();
    const creer = (c: pg.Client) =>
      c.query(
        "SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, 'Concurrent', '{consultant}', $4)",
        [jetonDemo, cab.cabinetId, emailUnique("concurrent-compte"), hash],
      );
    try {
      await c1.query("BEGIN");
      expect((await creer(c1)).rows).toHaveLength(1);
      const pid2 = await pid(c2);
      const p2 = erreurComplete(creer(c2));
      await attendreVerrou(pid2);
      await c1.query("COMMIT");
      expect(await p2).toMatchObject({ code: "MQP04", hint: "demo_plafond_utilisateurs" });
    } finally {
      await c1.end();
      await c2.end();
    }
    const [{ n }] = (await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM utilisateurs WHERE cabinet_id = $1",
      [cab.cabinetId],
    )) as [{ n: number }];
    expect(n).toBe(40);
    await proprio("UPDATE cabinets SET est_demo = false WHERE id = $1", [cab.cabinetId]);
  });
});

describe("bac à sable SQL : garde d'est_demo et contrat des fonctions", () => {
  it("le rôle applicatif ne pose toujours pas est_demo en direct (42501), ni par UPDATE ni par INSERT", async () => {
    const enCabinet = (cabinetId: string, sql: string) =>
      ctx.db.withTenant(cabinetId, (db) => db.query(sql, [cabinetId]));
    const maj = await erreur(
      enCabinet(reel.cabinetId, "UPDATE cabinets SET est_demo = true WHERE id = $1"),
    );
    expect(maj?.code).toBe("42501");
    expect(maj?.message).toMatch(/ne se modifie que par la plateforme/);
    const [{ id: nouveau }] = (await proprio<{ id: string }>("SELECT gen_random_uuid() AS id")) as [
      { id: string },
    ];
    const ins = await erreur(
      enCabinet(nouveau, "INSERT INTO cabinets (id, nom, est_demo) VALUES ($1, 'Intrus', true)"),
    );
    expect(ins?.code).toBe("42501");
    expect(ins?.message).toMatch(/ne se modifie que par la plateforme/);
    const [r] = await proprio<{ est_demo: boolean }>(
      "SELECT est_demo FROM cabinets WHERE id = $1",
      [reel.cabinetId],
    );
    expect(r!.est_demo).toBe(false);
    expect(await proprio("SELECT id FROM cabinets WHERE id = $1", [nouveau])).toEqual([]);
  });

  it("outils internes non accordés : plateforme_admin_demo, plateforme_cabinet_visible", async () => {
    const lignes = await proprio<{ nom: string; app: boolean; pub: boolean; def: boolean }>(
      `SELECT p.proname AS nom, has_function_privilege('missionpilot_app', p.oid, 'EXECUTE') AS app,
              p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                                          WHERE a.grantee = 0) AS pub,
              p.prosecdef AS def
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('plateforme_admin_demo', 'plateforme_cabinet_visible')
       ORDER BY 1`,
    );
    expect(lignes).toEqual([
      { nom: "plateforme_admin_demo", app: false, pub: false, def: false },
      { nom: "plateforme_cabinet_visible", app: false, pub: false, def: false },
    ]);
    expect(await code(app("SELECT plateforme_admin_demo($1)", [adminDemo.id]))).toBe("42501");
    expect(
      await code(
        app("SELECT plateforme_cabinet_visible($1, $2, 'aucun')", [adminReel.id, reel.cabinetId]),
      ),
    ).toBe("42501");
  });

  it("fonctions accordées : mêmes signatures, SECURITY DEFINER, EXECUTE au seul rôle applicatif, sans surcharge", async () => {
    const lignes = await proprio<{
      nom: string;
      args: string;
      resultat: string;
      def: boolean;
      config: string[] | null;
      autres: string[];
      pub: boolean;
      n: number;
    }>(
      `SELECT p.proname AS nom, pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS resultat, p.prosecdef AS def, p.proconfig AS config,
              array(SELECT DISTINCT a.grantee::regrole::text FROM aclexplode(p.proacl) a
                    WHERE a.grantee <> 0 AND a.grantee <> p.proowner ORDER BY 1) AS autres,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub,
              (SELECT count(*)::int FROM pg_proc q
               WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname) AS n
       FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND (p.proname LIKE 'plateforme\\_%' OR p.proname LIKE 'demo\\_%')
         AND has_function_privilege('missionpilot_app', p.oid, 'EXECUTE')
       ORDER BY p.proname`,
    );
    const table = (cols: string) => `TABLE(${cols})`;
    const cabinet =
      "id uuid, nom text, pays text, actif boolean, est_demo boolean, cree_le timestamp with time zone";
    const compte =
      "id uuid, email text, nom text, roles text[], actif boolean, cree_le timestamp with time zone";
    expect(lignes.map((l) => [l.nom, l.args, l.resultat])).toEqual([
      [
        "demo_lister_comptes",
        "",
        table(
          "cabinet_id uuid, cabinet_nom text, email text, nom text, roles text[], portail boolean",
        ),
      ],
      ["demo_lister_super_admins", "", table("email text, nom text")],
      [
        "demo_ouvrir_session_plateforme",
        "p_email text, p_jeton_hash text",
        table("super_admin_id uuid, email text, nom text"),
      ],
      ["demo_super_admin_est_demo", "p_super_admin_id uuid", "boolean"],
      [
        "demo_trouver_compte",
        "p_cabinet_id uuid, p_email text",
        table("utilisateur_id uuid, email text, nom text, roles text[], portail boolean"),
      ],
      [
        "plateforme_creer_cabinet",
        "p_jeton_hash text, p_nom text, p_pays text, p_email text, p_nom_associe text, p_hash text",
        table("cabinet_id uuid, utilisateur_id uuid"),
      ],
      [
        "plateforme_creer_utilisateur",
        "p_jeton_hash text, p_cabinet_id uuid, p_email text, p_nom text, p_roles text[], p_hash text",
        table(compte),
      ],
      ["plateforme_echec_connexion", "p_super_admin_id uuid", "void"],
      ["plateforme_fermer_session", "p_jeton_hash text", "void"],
      [
        "plateforme_lister_cabinets",
        "p_jeton_hash text",
        table(`${cabinet}, nb_utilisateurs integer, nb_utilisateurs_actifs integer`),
      ],
      ["plateforme_lister_utilisateurs", "p_jeton_hash text, p_cabinet_id uuid", table(compte)],
      [
        "plateforme_modifier_cabinet",
        "p_jeton_hash text, p_cabinet_id uuid, p_nom text, p_actif boolean",
        table(cabinet),
      ],
      [
        "plateforme_modifier_utilisateur",
        "p_jeton_hash text, p_cabinet_id uuid, p_utilisateur_id uuid, p_actif boolean, p_roles text[]",
        table(compte),
      ],
      [
        "plateforme_ouvrir_session",
        "p_super_admin_id uuid, p_jeton_hash text",
        "timestamp with time zone",
      ],
      [
        "plateforme_resoudre_session",
        "p_jeton_hash text",
        table("super_admin_id uuid, email text, nom text, est_demo boolean"),
      ],
      [
        "plateforme_trouver_connexion",
        "p_email text",
        table("super_admin_id uuid, mot_de_passe_hash text, actif boolean"),
      ],
    ]);
    for (const l of lignes) {
      expect(l.def, l.nom).toBe(true);
      expect(l.config, l.nom).toEqual(["search_path=public, pg_temp"]);
      expect(l.autres, l.nom).toEqual(["missionpilot_app"]);
      expect(l.pub, l.nom).toBe(false);
      expect(l.n, l.nom).toBe(1);
    }
  });
});

describe("bac à sable : routes /api/plateforme/*", () => {
  const BASE = "/api/plateforme";
  let pDemo: Api;
  let pReel: Api;

  beforeAll(async () => {
    pDemo = api(ctx, await connecterPlateforme(ctx, adminDemo));
    pReel = api(ctx, await connecterPlateforme(ctx, adminReel));
  });

  it("super admin démo : liste sans cabinet réel ; 404 sur le cabinet réel pour toute opération", async () => {
    const moi = await pDemo.get(`${BASE}/moi`);
    expect(moi.json().superAdmin.estDemo).toBe(true);
    const liste = await pDemo.get(`${BASE}/cabinets`);
    expect(liste.statusCode).toBe(200);
    const ids = (liste.json().elements as { id: string; estDemo: boolean }[]).map((c) => c.id);
    expect(ids).toContain(demo.cabinetId);
    expect(ids).not.toContain(reel.cabinetId);
    expect((liste.json().elements as { estDemo: boolean }[]).every((c) => c.estDemo)).toBe(true);

    const avant = await etat(reel.cabinetId);
    /** Les 6 opérations par identifiant, exécutées l'une après l'autre. */
    const operations = async (cabinetId: string) => {
      const utilisateur = `${BASE}/cabinets/${cabinetId}/utilisateurs/${reel.utilisateurId}`;
      return [
        await pDemo.patch(`${BASE}/cabinets/${cabinetId}`, { nom: "Renommé" }),
        await pDemo.patch(`${BASE}/cabinets/${cabinetId}`, { actif: false }),
        await pDemo.get(`${BASE}/cabinets/${cabinetId}/utilisateurs`),
        await pDemo.post(`${BASE}/cabinets/${cabinetId}/utilisateurs`, {
          nom: "Intrus",
          email: emailUnique("intrus-route"),
          roles: ["consultant"],
        }),
        await pDemo.patch(utilisateur, { actif: false }),
        await pDemo.patch(utilisateur, { roles: ["consultant"] }),
      ];
    };
    const refus = await operations(reel.cabinetId);
    const inconnus = await operations(UUID_INCONNU);
    expect(refus).toHaveLength(6);
    for (let i = 0; i < refus.length; i++) {
      expect(refus[i]!.statusCode, `opération ${i}`).toBe(404);
      expect(refus[i]!.json().erreur.code).toBe("INTROUVABLE");
      expect(refus[i]!.body, `opération ${i}`).toBe(inconnus[i]!.body);
    }
    expect(await etat(reel.cabinetId)).toEqual(avant);
  });

  it("super admin démo : adresse hors .test refusée en 400, réponse identique que l'adresse existe ou non, rien d'écrit", async () => {
    const avant = await compteurs();
    const cabinetAvec = (email: string) =>
      pDemo.post(`${BASE}/cabinets`, {
        nom: "Oracle",
        pays: "CI",
        associe: { nom: "Associé", email, motDePasse: "Mot-de-passe-oracle-1" },
      });
    const compteAvec = (email: string) =>
      pDemo.post(`${BASE}/cabinets/${demo.cabinetId}/utilisateurs`, {
        nom: "Oracle",
        email,
        roles: ["consultant"],
        motDePasse: "Mot-de-passe-oracle-1",
      });
    const reponses = [
      await cabinetAvec(externe.email),
      await cabinetAvec(emailLibreReel()),
      await compteAvec(externe.email),
      await compteAvec(emailLibreReel()),
    ];
    for (const r of reponses) {
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({
        erreur: {
          code: "REQUETE_INVALIDE",
          message: "Une adresse en .test est exigée en mode démonstration.",
        },
      });
    }
    expect(reponses[1]!.body).toBe(reponses[0]!.body);
    expect(reponses[3]!.body).toBe(reponses[2]!.body);
    expect(await compteurs()).toEqual(avant);
  });

  it("super admin démo : cabinet créé en démo, géré, listé et ouvrable par GET /api/auth/demo", async () => {
    const cree = await creerCabinetParPlateforme(pDemo);
    const [cab] = await proprio<{ est_demo: boolean }>(
      "SELECT est_demo FROM cabinets WHERE id = $1",
      [cree.cabinetId],
    );
    expect(cab!.est_demo).toBe(true);

    const renomme = await pDemo.patch(`${BASE}/cabinets/${cree.cabinetId}`, { nom: "Démo route" });
    expect(renomme.statusCode).toBe(200);
    expect(renomme.json().cabinet).toMatchObject({ nom: "Démo route", estDemo: true });
    const compte = await pDemo.post(`${BASE}/cabinets/${cree.cabinetId}/utilisateurs`, {
      nom: "Consultant Démo",
      email: emailUnique("bac-route"),
      roles: ["consultant"],
    });
    expect(compte.statusCode).toBe(201);
    const uid = compte.json().utilisateur.id as string;
    const modifie = await pDemo.patch(`${BASE}/cabinets/${cree.cabinetId}/utilisateurs/${uid}`, {
      roles: ["chef_mission"],
    });
    expect(modifie.statusCode).toBe(200);
    const comptes = await pDemo.get(`${BASE}/cabinets/${cree.cabinetId}/utilisateurs`);
    expect((comptes.json().elements as { id: string }[]).map((u) => u.id).sort()).toEqual(
      [cree.associeId, uid].sort(),
    );

    const publique = await api(ctx).get("/api/auth/demo");
    expect(publique.statusCode).toBe(200);
    const entree = (
      publique.json().cabinets as {
        id: string;
        nom: string;
        comptes: { email: string; roles: string[]; portail: boolean }[];
      }[]
    ).find((c) => c.id === cree.cabinetId);
    expect(entree).toBeDefined();
    expect(entree!.nom).toBe("Démo route");
    expect(entree!.comptes).toContainEqual({
      email: cree.associeEmail,
      nom: "Associé Fondateur",
      roles: ["associe"],
      portail: false,
    });
    const un = await api(ctx).post("/api/auth/demo/connexion", {
      cabinetId: cree.cabinetId,
      email: cree.associeEmail,
    });
    expect(un.statusCode).toBe(200);

    // Le super admin réel voit et gère aussi ce cabinet de démonstration.
    const vus = await pReel.get(`${BASE}/cabinets`);
    expect((vus.json().elements as { id: string }[]).map((c) => c.id)).toContain(cree.cabinetId);
  });

  it("super admin réel : inchangé (voit démo et réels, crée en est_demo faux, gère un cabinet réel)", async () => {
    const liste = await pReel.get(`${BASE}/cabinets`);
    const ids = (liste.json().elements as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(reel.cabinetId);
    expect(ids).toContain(demo.cabinetId);
    const [{ n }] = (await proprio<{ n: number }>("SELECT count(*)::int AS n FROM cabinets")) as [
      { n: number },
    ];
    expect(ids).toHaveLength(n);

    const cree = await creerCabinetParPlateforme(pReel);
    const [cab] = await proprio<{ est_demo: boolean }>(
      "SELECT est_demo FROM cabinets WHERE id = $1",
      [cree.cabinetId],
    );
    expect(cab!.est_demo).toBe(false);
    const publique = await api(ctx).get("/api/auth/demo");
    expect(publique.body).not.toContain(cree.cabinetId);
    expect(publique.body).not.toContain(reel.cabinetId);
    const demoListe = await pDemo.get(`${BASE}/cabinets`);
    expect(demoListe.body).not.toContain(cree.cabinetId);

    const r = await pReel.patch(`${BASE}/cabinets/${reel.cabinetId}`, { nom: "Réel renommé" });
    expect(r.statusCode).toBe(200);
    expect(r.json().cabinet).toMatchObject({ nom: "Réel renommé", estDemo: false });
    const u = await pReel.get(`${BASE}/cabinets/${reel.cabinetId}/utilisateurs`);
    expect(u.statusCode).toBe(200);
    expect((u.json().elements as { id: string }[]).map((x) => x.id)).toEqual([reel.utilisateurId]);
    const corps = await pReel.patch(`${BASE}/cabinets/${UUID_INCONNU}`, { nom: "X" });
    expect(corps.statusCode).toBe(404);
  });
});
