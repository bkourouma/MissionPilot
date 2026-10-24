import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { Db } from "../src/db/pool.js";
import { configTest, demarrer, MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";

/*
 * Connexion rapide de démonstration généralisée, couche SQL (migration 0580) : porte
 * dérobée potentielle, testée comme telle.
 *
 * - Le rôle applicatif n'atteint les comptes de démonstration que par 4 fonctions
 *   SECURITY DEFINER (`demo_*`) ; les outils internes ne lui sont pas accordés.
 * - Périmètre : cabinets est_demo ET actifs, comptes actifs de famille pure, portail
 *   seulement avec un rattachement actif à un client actif ; super admins est_demo ET
 *   actifs. Liste et recherche lisent le même ensemble (bornes comprises).
 * - L'ouverture d'une session de plateforme est atomique (verrou du super admin) et ne
 *   laisse aucune trace en cas de refus.
 *
 * Cabinets, comptes, clients et super admins sont créés avec le rôle propriétaire ;
 * `est_demo` n'est posé que par ce SQL propriétaire (aucune fonction ne le pose).
 */

let ctx: Contexte;
let hash: string;
const suf = randomBytes(4).toString("hex");
const cabinetsDemoCrees: string[] = [];
const adminsDemoCrees: string[] = [];

/** Les 5 fonctions accordées au rôle applicatif : arguments, sortie et volatilité exacts. */
const FONCTIONS: { nom: string; args: string; resultat: string; volatilite: string }[] = [
  {
    nom: "demo_lister_comptes",
    args: "",
    resultat:
      "TABLE(cabinet_id uuid, cabinet_nom text, email text, nom text, roles text[], portail boolean)",
    volatilite: "s",
  },
  {
    nom: "demo_lister_super_admins",
    args: "",
    resultat: "TABLE(email text, nom text)",
    volatilite: "s",
  },
  {
    nom: "demo_trouver_compte",
    args: "p_cabinet_id uuid, p_email text",
    resultat: "TABLE(utilisateur_id uuid, email text, nom text, roles text[], portail boolean)",
    volatilite: "s",
  },
  {
    nom: "demo_ouvrir_session_plateforme",
    args: "p_email text, p_jeton_hash text",
    resultat: "TABLE(super_admin_id uuid, email text, nom text)",
    volatilite: "v",
  },
  {
    nom: "demo_super_admin_est_demo",
    args: "p_super_admin_id uuid",
    resultat: "boolean",
    volatilite: "s",
  },
];
const INTERNES = ["demo_comptes_ouvrables", "demo_roles_client", "demo_tfa_bloquante"];

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const nouveauJetonHash = () => sha256(randomBytes(32).toString("base64url"));
let compteur = 0;
const email = (prefixe: string) => `${prefixe}-${suf}-${++compteur}@Demo-SQL.test`;

/** Requête avec le rôle applicatif, hors contexte de cabinet. */
function app<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return ctx.db.withoutTenant(async (db: Db) => (await db.query(sql, params)).rows as T[]);
}

/** Requête avec le rôle propriétaire (hors RLS). */
function proprio<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return proprietaire(async (c) => (await c.query(sql, params)).rows as T[]);
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

/** SQLSTATE de l'erreur levée (undefined si la promesse aboutit). */
async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code ?? "sans_code";
  }
}

async function creerCabinet(nom: string, opts: { demo?: boolean; actif?: boolean } = {}) {
  const demo = opts.demo ?? true;
  const [r] = await proprio<{ id: string }>(
    "INSERT INTO cabinets (nom, est_demo, actif) VALUES ($1, $2, $3) RETURNING id",
    [nom, demo, opts.actif ?? true],
  );
  if (demo) cabinetsDemoCrees.push(r!.id);
  return r!.id;
}

interface Compte {
  id: string;
  email: string;
  nom: string;
  roles: string[];
}

async function creerCompte(
  cabinetId: string,
  adresse: string,
  roles: string[],
  actif = true,
): Promise<Compte> {
  const nom = `Compte ${adresse.split("-")[0]}`;
  const [r] = await proprio<{ id: string }>(
    `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash, actif)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [cabinetId, adresse, nom, roles, hash, actif],
  );
  return { id: r!.id, email: adresse, nom, roles };
}

async function creerClient(cabinetId: string, actif = true): Promise<string> {
  const [r] = await proprio<{ id: string }>(
    "INSERT INTO clients (cabinet_id, raison_sociale, actif) VALUES ($1, $2, $3) RETURNING id",
    [cabinetId, `Client ${suf} ${++compteur}`, actif],
  );
  return r!.id;
}

async function rattacher(compte: Compte, cabinetId: string, clientId: string, statut = "actif") {
  await proprio(
    `INSERT INTO utilisateurs_portail (utilisateur_id, cabinet_id, client_id, statut)
     VALUES ($1, $2, $3, $4)`,
    [compte.id, cabinetId, clientId, statut],
  );
}

async function creerSuperAdmin(opts: { demo?: boolean; actif?: boolean; adresse?: string } = {}) {
  const adresse = opts.adresse ?? email("admin");
  const demo = opts.demo ?? true;
  const [r] = await proprio<{ id: string }>(
    `INSERT INTO super_admins (email, nom, mot_de_passe_hash, actif, est_demo)
     VALUES ($1, 'Admin Démo', $2, $3, $4) RETURNING id`,
    [adresse, hash, opts.actif ?? true, demo],
  );
  if (demo) adminsDemoCrees.push(r!.id);
  return { id: r!.id, email: adresse, nom: "Admin Démo" };
}

const listerComptes = () =>
  app<{
    cabinet_id: string;
    cabinet_nom: string;
    email: string;
    nom: string;
    roles: string[];
    portail: boolean;
  }>("SELECT * FROM demo_lister_comptes()");

const trouver = (cabinetId: string | null, adresse: string | null) =>
  app<{ utilisateur_id: string; email: string; nom: string; roles: string[]; portail: boolean }>(
    "SELECT * FROM demo_trouver_compte($1, $2)",
    [cabinetId, adresse],
  );

const ouvrir = (adresse: string | null, jeton: string | null) =>
  app<{ super_admin_id: string; email: string; nom: string }>(
    "SELECT * FROM demo_ouvrir_session_plateforme($1, $2)",
    [adresse, jeton],
  );

async function compter(): Promise<{ sessions: number; journal: number }> {
  const [r] = await proprio<{ sessions: number; journal: number }>(
    `SELECT (SELECT count(*)::int FROM plateforme_sessions) AS sessions,
            (SELECT count(*)::int FROM journal_plateforme) AS journal`,
  );
  return r!;
}

/** Connexion directe avec le rôle applicatif (pour les tests de concurrence). */
async function clientApp(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: configTest().DATABASE_URL });
  await c.connect();
  return c;
}

async function clientProprio(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: configTest().DATABASE_OWNER_URL });
  await c.connect();
  return c;
}

/** Attend que la connexion `pid` soit bloquée sur un verrou (pg_locks, non accordé). */
async function attendreVerrou(pid: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [r] = await proprio<{ bloque: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted) AS bloque",
      [pid],
    );
    if (r!.bloque) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("La connexion n'a jamais attendu de verrou");
}

async function pid(c: pg.Client): Promise<number> {
  const r = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return r.rows[0]!.pid;
}

// Jeu de données principal.
let cabA: string;
let cabB: string;
let cabReel: string;
let cabDesactive: string;
let associeA: Compte;
let consultantA: Compte;
let inactifA: Compte;
let portailA: Compte;
let portailSansRattachement: Compte;
let portailSuspendu: Compte;
let portailClientArchive: Compte;
let associeB: Compte;
let associeReel: Compte;
let associeDesactive: Compte;

beforeAll(async () => {
  ctx = await demarrer();
  hash = await hashPassword(MOT_DE_PASSE_TEST);

  cabA = await creerCabinet(`Démo A ${suf}`);
  cabB = await creerCabinet(`démo B ${suf}`);
  cabReel = await creerCabinet(`Démo A ${suf} réel`, { demo: false });
  cabDesactive = await creerCabinet(`Démo A ${suf} désactivé`, { actif: false });

  // Les comptes du cabinet passent avant ceux du portail, quel que soit l'e-mail.
  associeA = await creerCompte(cabA, email("zz-associe"), ["associe"]);
  consultantA = await creerCompte(cabA, email("mm-consultant"), ["consultant", "chef_mission"]);
  inactifA = await creerCompte(cabA, email("bb-inactif"), ["consultant"], false);
  const clientActif = await creerClient(cabA);
  const clientArchive = await creerClient(cabA, false);
  portailA = await creerCompte(cabA, email("aa-portail"), ["client_dirigeant"]);
  await rattacher(portailA, cabA, clientActif);
  portailSansRattachement = await creerCompte(cabA, email("ab-sans-rattachement"), [
    "client_contributeur",
  ]);
  portailSuspendu = await creerCompte(cabA, email("ac-suspendu"), ["client_contributeur"]);
  await rattacher(portailSuspendu, cabA, clientActif, "desactive");
  portailClientArchive = await creerCompte(cabA, email("ad-archive"), ["client_investisseur"]);
  await rattacher(portailClientArchive, cabA, clientArchive);

  associeB = await creerCompte(cabB, email("associe-b"), ["associe"]);
  associeReel = await creerCompte(cabReel, email("associe-reel"), ["associe"]);
  associeDesactive = await creerCompte(cabDesactive, email("associe-desactive"), ["associe"]);
});

afterAll(async () => {
  // Les fichiers suivants de la même exécution ne voient plus ces données de démonstration.
  await proprio("UPDATE cabinets SET est_demo = false WHERE id = ANY ($1)", [cabinetsDemoCrees]);
  await proprio("UPDATE super_admins SET est_demo = false WHERE id = ANY ($1)", [adminsDemoCrees]);
  await ctx.fermer();
});

describe("démo : droits et contrat des fonctions", () => {
  it("les 4 fonctions : SECURITY DEFINER, search_path verrouillé, signature exacte, EXECUTE au seul rôle applicatif", async () => {
    const lignes = await proprio<{
      nom: string;
      args: string;
      resultat: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      volatilite: string;
      acl_nulle: boolean;
      public_execute: boolean;
      autres: string[];
    }>(
      `SELECT p.proname AS nom, pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS resultat, p.prosecdef, p.proconfig,
              p.provolatile::text AS volatilite, p.proacl IS NULL AS acl_nulle,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute,
              array(SELECT DISTINCT a.grantee::regrole::text FROM aclexplode(p.proacl) a
                    WHERE a.grantee <> 0 AND a.grantee <> p.proowner ORDER BY 1) AS autres
       FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'demo\\_%'
         AND has_function_privilege('missionpilot_app', p.oid, 'EXECUTE')
       ORDER BY p.proname`,
    );
    expect(lignes.map((l) => l.nom)).toEqual(FONCTIONS.map((f) => f.nom).sort());
    for (const l of lignes) {
      const attendu = FONCTIONS.find((f) => f.nom === l.nom)!;
      expect(l.args, l.nom).toBe(attendu.args);
      expect(l.resultat, l.nom).toBe(attendu.resultat);
      expect(l.volatilite, l.nom).toBe(attendu.volatilite);
      expect(l.prosecdef, l.nom).toBe(true);
      expect(l.proconfig, l.nom).toEqual(["search_path=public, pg_temp"]);
      expect(l.acl_nulle, l.nom).toBe(false);
      expect(l.public_execute, l.nom).toBe(false);
      expect(l.autres, l.nom).toEqual(["missionpilot_app"]);
    }
  });

  it("une seule définition par nom (aucune surcharge laissée accessible)", async () => {
    const lignes = await proprio<{ nom: string; n: number }>(
      `SELECT p.proname AS nom, count(*)::int AS n FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY ($1)
       GROUP BY p.proname ORDER BY 1`,
      [[...FONCTIONS.map((f) => f.nom), ...INTERNES]],
    );
    expect(lignes).toEqual(
      [...FONCTIONS.map((f) => f.nom), ...INTERNES].sort().map((nom) => ({ nom, n: 1 })),
    );
  });

  it("les outils internes ne sont exécutables ni par le rôle applicatif ni par PUBLIC", async () => {
    const internes = await proprio<{ nom: string; app: boolean; pub: boolean; def: boolean }>(
      `SELECT p.proname AS nom, has_function_privilege('missionpilot_app', p.oid, 'EXECUTE') AS app,
              p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                                          WHERE a.grantee = 0) AS pub,
              p.prosecdef AS def
       FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'demo\\_%'
         AND NOT (p.proname = ANY ($1))
       ORDER BY 1`,
      [FONCTIONS.map((f) => f.nom)],
    );
    expect(internes).toEqual(INTERNES.map((nom) => ({ nom, app: false, pub: false, def: false })));
    expect(await code(app("SELECT * FROM demo_comptes_ouvrables()"))).toBe("42501");
    expect(await code(app("SELECT demo_roles_client()"))).toBe("42501");
  });

  it("hors des fonctions, le rôle applicatif ne lit rien de ces comptes (RLS et droits)", async () => {
    expect(await app("SELECT id FROM cabinets WHERE id = $1", [cabA])).toEqual([]);
    expect(await app("SELECT id FROM utilisateurs WHERE cabinet_id = $1", [cabA])).toEqual([]);
    expect(await app("SELECT utilisateur_id FROM utilisateurs_portail")).toEqual([]);
    expect(await code(app("SELECT * FROM super_admins"))).toBe("42501");
    expect(await code(app("SELECT * FROM plateforme_sessions"))).toBe("42501");
    // Un autre cabinet (contexte RLS posé) ne voit pas davantage le cabinet de démonstration.
    const vus = await ctx.db.withTenant(
      cabB,
      async (db) =>
        (await db.query("SELECT id FROM utilisateurs WHERE cabinet_id = $1", [cabA])).rows,
    );
    expect(vus).toEqual([]);
  });
});

describe("démo : liste des comptes", () => {
  it("cabinets de démonstration actifs seulement, comptes filtrés, tri cabinet puis portail puis e-mail", async () => {
    const lignes = await listerComptes();
    const miens = lignes.filter((l) => [cabA, cabB, cabReel, cabDesactive].includes(l.cabinet_id));
    expect(miens).toEqual([
      {
        cabinet_id: cabA,
        cabinet_nom: `Démo A ${suf}`,
        email: consultantA.email,
        nom: consultantA.nom,
        roles: ["consultant", "chef_mission"],
        portail: false,
      },
      {
        cabinet_id: cabA,
        cabinet_nom: `Démo A ${suf}`,
        email: associeA.email,
        nom: associeA.nom,
        roles: ["associe"],
        portail: false,
      },
      {
        cabinet_id: cabA,
        cabinet_nom: `Démo A ${suf}`,
        email: portailA.email,
        nom: portailA.nom,
        roles: ["client_dirigeant"],
        portail: true,
      },
      {
        cabinet_id: cabB,
        cabinet_nom: `démo B ${suf}`,
        email: associeB.email,
        nom: associeB.nom,
        roles: ["associe"],
        portail: false,
      },
    ]);
    // Cabinet réel, cabinet désactivé, compte inactif, portail sans rattachement actif à un
    // client actif : absents de toute la liste.
    const emails = new Set(lignes.map((l) => l.email));
    for (const c of [
      associeReel,
      associeDesactive,
      inactifA,
      portailSansRattachement,
      portailSuspendu,
      portailClientArchive,
    ]) {
      expect(emails.has(c.email), c.email).toBe(false);
    }
    const ids = new Set(lignes.map((l) => l.cabinet_id));
    expect(ids.has(cabReel)).toBe(false);
    expect(ids.has(cabDesactive)).toBe(false);
  });

  it("ordre global : lower(nom du cabinet), cabinet, comptes du cabinet avant portail, lower(e-mail)", async () => {
    const lignes = await listerComptes();
    // Dans un même cabinet, aucun compte du cabinet après un compte du portail.
    for (let i = 1; i < lignes.length; i++) {
      const a = lignes[i - 1]!;
      const b = lignes[i]!;
      if (a.cabinet_id === b.cabinet_id) expect(a.portail && !b.portail).toBe(false);
    }
    // Les comptes d'un même cabinet sont contigus.
    const blocs = lignes.map((l) => l.cabinet_id).filter((id, i, t) => i === 0 || t[i - 1] !== id);
    expect(new Set(blocs).size).toBe(blocs.length);
    // L'ordre complet est celui que rend PostgreSQL pour la même clé (même collation).
    const [ordre] = await proprio<{ ok: boolean }>(
      `SELECT array_agg(x.email ORDER BY x.n) =
              array_agg(x.email ORDER BY lower(x.cabinet_nom), x.cabinet_id, x.portail,
                                         lower(x.email)) AS ok
       FROM demo_lister_comptes() WITH ORDINALITY AS x(cabinet_id, cabinet_nom, email, nom,
                                                        roles, portail, n)`,
    );
    expect(ordre!.ok).toBe(true);
  });

  it("aucune fuite : colonnes exactes, ni identifiant de compte, ni haché, ni client", async () => {
    const lignes = await listerComptes();
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) {
      expect(Object.keys(l).sort()).toEqual(
        ["cabinet_id", "cabinet_nom", "email", "nom", "portail", "roles"].sort(),
      );
    }
    const texte = JSON.stringify(lignes);
    for (const interdit of [hash, associeA.id, portailA.id, "scrypt$"]) {
      expect(texte.includes(interdit), interdit).toBe(false);
    }
  });

  it("famille mixte, rôle inconnu ou tableau vide : jamais listé ni trouvé (défense en profondeur)", async () => {
    await proprioAnnule(async (c) => {
      // Le CHECK de 0110 interdit déjà ces lignes : on le lève dans une transaction annulée.
      await c.query("ALTER TABLE utilisateurs DROP CONSTRAINT utilisateurs_roles_check");
      const adresses = [email("mixte"), email("inconnu"), email("vide")];
      const roles = [["associe", "client_dirigeant"], ["associe", "pirate"], []];
      for (let i = 0; i < adresses.length; i++) {
        await c.query(
          `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
           VALUES ($1, $2, 'Hors famille', $3, $4)`,
          [cabA, adresses[i], roles[i], hash],
        );
      }
      const liste = await c.query<{ email: string }>("SELECT email FROM demo_lister_comptes()");
      const vus = new Set(liste.rows.map((r) => r.email));
      for (const a of adresses) {
        expect(vus.has(a), a).toBe(false);
        const t = await c.query("SELECT * FROM demo_trouver_compte($1, $2)", [cabA, a]);
        expect(t.rows, a).toEqual([]);
      }
      // Les comptes légitimes restent listés.
      expect(vus.has(associeA.email)).toBe(true);
    });
  });

  it("bornes : 50 cabinets et 50 comptes par cabinet ; le compte hors borne n'est pas trouvable", async () => {
    await proprioAnnule(async (c) => {
      const prefixe = `0000 borne ${suf}`;
      await c.query(
        `INSERT INTO cabinets (nom, est_demo)
         SELECT format('%s %s', $1::text, lpad(i::text, 2, '0')), true FROM generate_series(0, 50) i`,
        [prefixe],
      );
      const cabinets = await c.query<{ id: string; nom: string }>(
        "SELECT id, nom FROM cabinets WHERE nom LIKE $1 ORDER BY lower(nom), id",
        [`${prefixe}%`],
      );
      expect(cabinets.rows).toHaveLength(51);
      await c.query(
        `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
         SELECT x.id, format('borne-%s-%s@demo-sql.test', $2::text, right(x.nom, 2)),
                'Compte borne', ARRAY['associe'], $3
         FROM cabinets x WHERE x.nom LIKE $1`,
        [`${prefixe}%`, suf, hash],
      );
      const premier = cabinets.rows[0]!.id;
      await c.query(
        `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
         SELECT $1, format('borne-%s-c%s@demo-sql.test', $2::text, lpad(i::text, 2, '0')),
                'Compte borne', ARRAY['consultant'], $3
         FROM generate_series(1, 50) i`,
        [premier, suf, hash],
      );

      const liste = await c.query<{ cabinet_id: string; email: string }>(
        "SELECT cabinet_id, email FROM demo_lister_comptes()",
      );
      const parCabinet = new Map<string, string[]>();
      for (const r of liste.rows) {
        parCabinet.set(r.cabinet_id, [...(parCabinet.get(r.cabinet_id) ?? []), r.email]);
      }
      expect(parCabinet.size).toBe(50);
      for (const emails of parCabinet.values()) expect(emails.length).toBeLessThanOrEqual(50);
      // Les 50 premiers cabinets « borne » sont listés, le 51e (dernier dans l'ordre) non.
      const ids = cabinets.rows.map((r) => r.id);
      expect(ids.slice(0, 50).every((id) => parCabinet.has(id))).toBe(true);
      expect(parCabinet.has(ids[50]!)).toBe(false);

      // Premier cabinet : 51 comptes, 50 listés ; le 51e dans l'ordre n'est ni listé ni trouvé.
      const tous = await c.query<{ email: string }>(
        "SELECT email FROM utilisateurs WHERE cabinet_id = $1 ORDER BY lower(email), id",
        [premier],
      );
      expect(tous.rows).toHaveLength(51);
      const attendus = tous.rows.slice(0, 50).map((r) => r.email);
      expect(parCabinet.get(premier)).toEqual(attendus);
      const horsBorne = tous.rows[50]!.email;
      const t = await c.query("SELECT * FROM demo_trouver_compte($1, $2)", [premier, horsBorne]);
      expect(t.rows).toEqual([]);
      const t2 = await c.query("SELECT * FROM demo_trouver_compte($1, $2)", [
        premier,
        attendus[49],
      ]);
      expect(t2.rows).toHaveLength(1);
      // Le 51e cabinet : son compte n'est pas trouvable non plus.
      const t3 = await c.query("SELECT * FROM demo_trouver_compte($1, $2)", [
        ids[50],
        `borne-${suf}-50@demo-sql.test`,
      ]);
      expect(t3.rows).toEqual([]);
    });
  });
});

describe("démo : recherche d'un compte", () => {
  it("compte du cabinet et compte du portail trouvés, e-mail insensible à la casse", async () => {
    expect(await trouver(cabA, associeA.email.toUpperCase())).toEqual([
      {
        utilisateur_id: associeA.id,
        email: associeA.email,
        nom: associeA.nom,
        roles: ["associe"],
        portail: false,
      },
    ]);
    expect(await trouver(cabA, portailA.email.toLowerCase())).toEqual([
      {
        utilisateur_id: portailA.id,
        email: portailA.email,
        nom: portailA.nom,
        roles: ["client_dirigeant"],
        portail: true,
      },
    ]);
  });

  it("aucune ligne : cabinet inadéquat, e-mail inconnu, cabinet réel ou désactivé, compte exclu, NULL", async () => {
    expect(await trouver(cabB, associeA.email)).toEqual([]);
    expect(await trouver(cabA, associeB.email)).toEqual([]);
    expect(await trouver(cabA, `inconnu-${suf}@demo-sql.test`)).toEqual([]);
    expect(await trouver(cabReel, associeReel.email)).toEqual([]);
    expect(await trouver(cabDesactive, associeDesactive.email)).toEqual([]);
    for (const c of [inactifA, portailSansRattachement, portailSuspendu, portailClientArchive]) {
      expect(await trouver(cabA, c.email), c.email).toEqual([]);
    }
    expect(await trouver(null, associeA.email)).toEqual([]);
    expect(await trouver(cabA, null)).toEqual([]);
    expect(await trouver("00000000-0000-4000-8000-000000000000", associeA.email)).toEqual([]);
  });

  it("listé ⇔ trouvable (hors comptes sous 2FA, trouvables mais non listés), pour chaque compte du jeu de données", async () => {
    const liste = await listerComptes();
    const listes = new Set(liste.map((l) => `${l.cabinet_id}|${l.email}`));
    const comptes: [string, Compte][] = [
      [cabA, associeA],
      [cabA, consultantA],
      [cabA, inactifA],
      [cabA, portailA],
      [cabA, portailSansRattachement],
      [cabA, portailSuspendu],
      [cabA, portailClientArchive],
      [cabB, associeB],
      [cabReel, associeReel],
      [cabDesactive, associeDesactive],
    ];
    for (const [cabinet, compte] of comptes) {
      const t = await trouver(cabinet, compte.email);
      expect(t.length, compte.email).toBe(listes.has(`${cabinet}|${compte.email}`) ? 1 : 0);
    }
    // Et chaque ligne listée (toutes, pas seulement les miennes) est trouvable.
    for (const l of liste) {
      const t = await trouver(l.cabinet_id, l.email);
      expect(t, l.email).toHaveLength(1);
      expect(t[0]).toMatchObject({
        email: l.email,
        nom: l.nom,
        roles: l.roles,
        portail: l.portail,
      });
    }
  });

  it("2FA : un compte à 2FA active ou rendu inconnectable par la politique n'est pas listé, mais reste trouvable", async () => {
    const cab = await creerCabinet(`Démo 2FA ${suf}`);
    const libre = await creerCompte(cab, email("a-libre"), ["consultant"]);
    const avec2fa = await creerCompte(cab, email("b-2fa"), ["chef_mission"]);
    const associePolitique = await creerCompte(cab, email("c-associe"), ["associe"]);
    const client = await creerClient(cab);
    const portailLibre = await creerCompte(cab, email("d-portail"), ["client_dirigeant"]);
    await rattacher(portailLibre, cab, client);
    const portail2fa = await creerCompte(cab, email("e-portail-2fa"), ["client_contributeur"]);
    await rattacher(portail2fa, cab, client);
    for (const c of [avec2fa, portail2fa]) {
      await proprio(
        `INSERT INTO utilisateurs_2fa (utilisateur_id, cabinet_id, secret_chiffre, cle_version, active_le)
         VALUES ($1, $2, $3, 1, now())`,
        [c.id, cab, randomBytes(48)],
      );
    }
    await proprio("UPDATE cabinets SET tfa_obligatoire = '{associe}' WHERE id = $1", [cab]);
    const emails = async () =>
      (await listerComptes()).filter((l) => l.cabinet_id === cab).map((l) => l.email);

    expect(await emails()).toEqual([libre.email, portailLibre.email]);
    for (const c of [avec2fa, associePolitique, portail2fa]) {
      expect(await trouver(cab, c.email), c.email).toHaveLength(1); // refusé en 403 par l'API
    }
    // Portail à 2FA obligatoire : plus aucun compte du portail listé, le cabinet reste trouvable.
    await proprio(
      "INSERT INTO portail_parametres (cabinet_id, tfa_obligatoire) VALUES ($1, true)",
      [cab],
    );
    expect(await emails()).toEqual([libre.email]);
    expect(await trouver(cab, portailLibre.email)).toHaveLength(1);
    // Les colonnes de la liste restent exactes.
    const [ligne] = await listerComptes();
    expect(Object.keys(ligne!).sort()).toEqual(
      ["cabinet_id", "cabinet_nom", "email", "nom", "portail", "roles"].sort(),
    );
  });

  it("aucune fuite : colonnes exactes, aucun haché", async () => {
    const [r] = await trouver(cabA, associeA.email);
    expect(Object.keys(r!).sort()).toEqual(
      ["email", "nom", "portail", "roles", "utilisateur_id"].sort(),
    );
    expect(JSON.stringify(r).includes("scrypt$")).toBe(false);
  });

  it("une désactivation (compte, cabinet, rattachement) retire aussitôt le compte", async () => {
    const cab = await creerCabinet(`Démo C ${suf}`);
    const assoc = await creerCompte(cab, email("assoc-c"), ["associe"]);
    const client = await creerClient(cab);
    const port = await creerCompte(cab, email("portail-c"), ["client_contributeur"]);
    await rattacher(port, cab, client);
    expect(await trouver(cab, assoc.email)).toHaveLength(1);
    expect(await trouver(cab, port.email)).toHaveLength(1);

    await proprio(
      "UPDATE utilisateurs_portail SET statut = 'desactive' WHERE utilisateur_id = $1",
      [port.id],
    );
    expect(await trouver(cab, port.email)).toEqual([]);
    await proprio("UPDATE utilisateurs_portail SET statut = 'actif' WHERE utilisateur_id = $1", [
      port.id,
    ]);
    await proprio("UPDATE clients SET actif = false WHERE id = $1", [client]);
    expect(await trouver(cab, port.email)).toEqual([]);

    await proprio("UPDATE utilisateurs SET actif = false WHERE id = $1", [assoc.id]);
    expect(await trouver(cab, assoc.email)).toEqual([]);
    await proprio("UPDATE utilisateurs SET actif = true WHERE id = $1", [assoc.id]);
    await proprio("UPDATE cabinets SET actif = false WHERE id = $1", [cab]);
    expect(await trouver(cab, assoc.email)).toEqual([]);
    await proprio("UPDATE cabinets SET actif = true, est_demo = false WHERE id = $1", [cab]);
    expect(await trouver(cab, assoc.email)).toEqual([]);
    expect((await listerComptes()).some((l) => l.cabinet_id === cab)).toBe(false);
  });
});

describe("démo : super admins", () => {
  it("liste : est_demo et actif seulement, colonnes exactes, tri insensible à la casse", async () => {
    const b = await creerSuperAdmin({ adresse: `B-admin-${suf}@demo-sql.test` });
    const a = await creerSuperAdmin({ adresse: `a-admin-${suf}@demo-sql.test` });
    const inactif = await creerSuperAdmin({ actif: false });
    const reel = await creerSuperAdmin({ demo: false });
    const lignes = await app<{ email: string; nom: string }>(
      "SELECT * FROM demo_lister_super_admins()",
    );
    for (const l of lignes) expect(Object.keys(l).sort()).toEqual(["email", "nom"]);
    const emails = lignes.map((l) => l.email);
    expect(emails).toContain(a.email);
    expect(emails).toContain(b.email);
    expect(emails.indexOf(a.email)).toBeLessThan(emails.indexOf(b.email));
    expect(emails).not.toContain(inactif.email);
    expect(emails).not.toContain(reel.email);
    expect(JSON.stringify(lignes).includes("scrypt$")).toBe(false);
  });

  it("liste bornée à 20", async () => {
    await proprioAnnule(async (c) => {
      await c.query(
        `INSERT INTO super_admins (email, nom, mot_de_passe_hash, est_demo)
         SELECT format('0000-borne-%s-%s@demo-sql.test', $1::text, lpad(i::text, 2, '0')),
                'Borne', $2, true
         FROM generate_series(1, 21) i`,
        [suf, hash],
      );
      const r = await c.query("SELECT * FROM demo_lister_super_admins()");
      expect(r.rows).toHaveLength(20);
    });
  });
});

describe("démo : ouverture d'une session de plateforme", () => {
  it("super admin de démonstration : session ouverte, journal « connexion » marqué demo", async () => {
    const a = await creerSuperAdmin();
    const jeton = nouveauJetonHash();
    const avant = await compter();
    const r = await ouvrir(a.email.toUpperCase(), jeton);
    expect(r).toEqual([{ super_admin_id: a.id, email: a.email, nom: a.nom }]);
    const apres = await compter();
    expect(apres).toEqual({ sessions: avant.sessions + 1, journal: avant.journal + 2 });

    const [s] = await app("SELECT * FROM plateforme_resoudre_session($1)", [jeton]);
    expect(s).toEqual({ super_admin_id: a.id, email: a.email, nom: a.nom, est_demo: true });
    const [d] = await proprio<{ dans: number }>(
      `SELECT extract(epoch FROM expire_le - now())::float8 AS dans
       FROM plateforme_sessions WHERE jeton_hash = $1`,
      [jeton],
    );
    expect(d!.dans).toBeGreaterThan(8 * 3600 - 60);
    expect(d!.dans).toBeLessThanOrEqual(8 * 3600);

    const journal = await proprio(
      `SELECT action, cible, cible_id, cabinet_id, details FROM journal_plateforme
       WHERE super_admin_id = $1 ORDER BY id`,
      [a.id],
    );
    expect(journal).toEqual([
      { action: "connexion", cible: "super_admin", cible_id: a.id, cabinet_id: null, details: {} },
      {
        action: "connexion",
        cible: "super_admin",
        cible_id: a.id,
        cabinet_id: null,
        details: { demo: true },
      },
    ]);
  });

  it("super admin réel, inactif, inconnu ou e-mail NULL : zéro ligne, ni session ni journal", async () => {
    const reel = await creerSuperAdmin({ demo: false });
    const inactif = await creerSuperAdmin({ actif: false });
    const avant = await compter();
    expect(await ouvrir(reel.email, nouveauJetonHash())).toEqual([]);
    expect(await ouvrir(inactif.email, nouveauJetonHash())).toEqual([]);
    expect(await ouvrir(`inconnu-${suf}@demo-sql.test`, nouveauJetonHash())).toEqual([]);
    expect(await ouvrir(null, nouveauJetonHash())).toEqual([]);
    expect(await compter()).toEqual(avant);
  });

  it("jeton haché invalide : erreur, rien d'écrit (transaction annulée)", async () => {
    const a = await creerSuperAdmin();
    const avant = await compter();
    expect(await code(ouvrir(a.email, "pas-un-sha256"))).toBe("23514");
    expect(await code(ouvrir(a.email, null))).toBe("23502");
    expect(await compter()).toEqual(avant);
  });

  it("deux ouvertures concurrentes : sérialisées par le verrou, plafond de 20 respecté", async () => {
    const a = await creerSuperAdmin();
    const anciens: string[] = [];
    for (let i = 0; i < 19; i++) anciens.push(nouveauJetonHash());
    await proprio(
      `INSERT INTO plateforme_sessions (super_admin_id, jeton_hash, expire_le, cree_le)
       SELECT $1, j, now() + interval '1 hour', now() - (interval '1 minute' * (100 - o))
       FROM unnest($2::text[]) WITH ORDINALITY AS t(j, o)`,
      [a.id, anciens],
    );
    const c1 = await clientApp();
    const c2 = await clientApp();
    try {
      await c1.query("BEGIN");
      const r1 = await c1.query("SELECT * FROM demo_ouvrir_session_plateforme($1, $2)", [
        a.email,
        nouveauJetonHash(),
      ]);
      expect(r1.rows).toHaveLength(1);
      const pid2 = await pid(c2);
      const p2 = c2.query("SELECT * FROM demo_ouvrir_session_plateforme($1, $2)", [
        a.email,
        nouveauJetonHash(),
      ]);
      await attendreVerrou(pid2);
      await c1.query("COMMIT");
      const r2 = await p2;
      expect(r2.rows).toHaveLength(1);
    } finally {
      await c1.end();
      await c2.end();
    }
    const restantes = await proprio<{ jeton_hash: string }>(
      "SELECT jeton_hash FROM plateforme_sessions WHERE super_admin_id = $1",
      [a.id],
    );
    expect(restantes).toHaveLength(20);
    const ensemble = new Set(restantes.map((r) => r.jeton_hash));
    // La plus ancienne est partie, les 18 suivantes restent.
    expect(ensemble.has(anciens[0]!)).toBe(false);
    expect(anciens.slice(1).every((j) => ensemble.has(j))).toBe(true);
    const demo = await proprio(
      `SELECT count(*)::int AS n FROM journal_plateforme
       WHERE super_admin_id = $1 AND details = '{"demo": true}'::jsonb`,
      [a.id],
    );
    expect(demo).toEqual([{ n: 2 }]);
  });

  it("désactivation concurrente : l'ouverture attend le verrou puis ne rend rien, sans écrire", async () => {
    const a = await creerSuperAdmin();
    const proprioC = await clientProprio();
    const appC = await clientApp();
    const avant = await compter();
    try {
      await proprioC.query("BEGIN");
      await proprioC.query("UPDATE super_admins SET actif = false WHERE id = $1", [a.id]);
      const pidApp = await pid(appC);
      const p = appC.query("SELECT * FROM demo_ouvrir_session_plateforme($1, $2)", [
        a.email,
        nouveauJetonHash(),
      ]);
      await attendreVerrou(pidApp);
      await proprioC.query("COMMIT");
      expect((await p).rows).toEqual([]);
    } finally {
      await proprioC.end();
      await appC.end();
    }
    expect(await compter()).toEqual(avant);
  });

  it("retrait concurrent de est_demo : même garantie", async () => {
    const a = await creerSuperAdmin();
    const proprioC = await clientProprio();
    const appC = await clientApp();
    const avant = await compter();
    try {
      await proprioC.query("BEGIN");
      await proprioC.query("UPDATE super_admins SET est_demo = false WHERE id = $1", [a.id]);
      const pidApp = await pid(appC);
      const p = appC.query("SELECT * FROM demo_ouvrir_session_plateforme($1, $2)", [
        a.email,
        nouveauJetonHash(),
      ]);
      await attendreVerrou(pidApp);
      await proprioC.query("COMMIT");
      expect((await p).rows).toEqual([]);
    } finally {
      await proprioC.end();
      await appC.end();
    }
    expect(await compter()).toEqual(avant);
  });

  it("les rôles client restent hors des super admins : aucun compte de cabinet n'ouvre de session plateforme", async () => {
    const avant = await compter();
    expect(await ouvrir(associeA.email, nouveauJetonHash())).toEqual([]);
    expect(await ouvrir(portailA.email, nouveauJetonHash())).toEqual([]);
    expect(await compter()).toEqual(avant);
  });
});
