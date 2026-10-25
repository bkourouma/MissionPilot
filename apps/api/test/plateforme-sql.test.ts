import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import type { Db } from "../src/db/pool.js";
import {
  ajouterUtilisateur,
  creerCabinet,
  demarrer,
  MOT_DE_PASSE_TEST,
  proprietaire,
  type Contexte,
} from "./helpers.js";

/*
 * Super admin de plateforme, couche SQL (migrations 0570-0573, codes MQP01-06).
 *
 * - Le rôle applicatif n'a aucun droit direct sur super_admins, plateforme_sessions,
 *   journal_plateforme ni sur leurs séquences : il passe par les 11 fonctions
 *   SECURITY DEFINER `plateforme_*`, qui revérifient la session (MQP01).
 * - Un cabinet désactivé coupe connexion (trouver_connexion) et sessions
 *   (resoudre_session) de tous ses comptes.
 * - Le journal est en ajout seul, même pour le propriétaire (MQP06), et sans secret.
 * - Aucune fonction de 0570-0573 ne pose est_demo (seule exception : la création d'un cabinet
 *   par un super admin de démonstration, migration 0582, testée à part) ; aucune ne renvoie de
 *   donnée métier.
 *
 * Les super admins de test sont créés avec le rôle propriétaire (aucune fonction n'en crée).
 */

let ctx: Contexte;
let hash: string;
let compteur = 0;
const adminsCrees: string[] = [];

const ROLES_CABINET = [
  "associe",
  "directeur_mission",
  "chef_mission",
  "consultant",
  "ressources",
  "gestionnaire",
  "expert_metier",
  "expert_externe",
];
const TABLES_PLATEFORME = ["super_admins", "plateforme_sessions", "journal_plateforme"];

/** Les 11 fonctions accordées au rôle applicatif : arguments et sortie exacts (contrat). */
const FONCTIONS: { nom: string; args: string; resultat: string }[] = [
  {
    nom: "plateforme_trouver_connexion",
    args: "p_email text",
    resultat: "TABLE(super_admin_id uuid, mot_de_passe_hash text, actif boolean)",
  },
  {
    nom: "plateforme_ouvrir_session",
    args: "p_super_admin_id uuid, p_jeton_hash text",
    resultat: "timestamp with time zone",
  },
  { nom: "plateforme_echec_connexion", args: "p_super_admin_id uuid", resultat: "void" },
  {
    nom: "plateforme_resoudre_session",
    args: "p_jeton_hash text",
    resultat: "TABLE(super_admin_id uuid, email text, nom text, est_demo boolean)",
  },
  { nom: "plateforme_fermer_session", args: "p_jeton_hash text", resultat: "void" },
  {
    nom: "plateforme_lister_cabinets",
    args: "p_jeton_hash text",
    resultat:
      "TABLE(id uuid, nom text, pays text, actif boolean, est_demo boolean, " +
      "cree_le timestamp with time zone, nb_utilisateurs integer, nb_utilisateurs_actifs integer)",
  },
  {
    nom: "plateforme_creer_cabinet",
    args: "p_jeton_hash text, p_nom text, p_pays text, p_email text, p_nom_associe text, p_hash text",
    resultat: "TABLE(cabinet_id uuid, utilisateur_id uuid)",
  },
  {
    nom: "plateforme_modifier_cabinet",
    args: "p_jeton_hash text, p_cabinet_id uuid, p_nom text, p_actif boolean",
    resultat:
      "TABLE(id uuid, nom text, pays text, actif boolean, est_demo boolean, " +
      "cree_le timestamp with time zone)",
  },
  {
    nom: "plateforme_lister_utilisateurs",
    args: "p_jeton_hash text, p_cabinet_id uuid",
    resultat:
      "TABLE(id uuid, email text, nom text, roles text[], actif boolean, " +
      "cree_le timestamp with time zone)",
  },
  {
    nom: "plateforme_creer_utilisateur",
    args: "p_jeton_hash text, p_cabinet_id uuid, p_email text, p_nom text, p_roles text[], p_hash text",
    resultat:
      "TABLE(id uuid, email text, nom text, roles text[], actif boolean, " +
      "cree_le timestamp with time zone)",
  },
  {
    nom: "plateforme_modifier_utilisateur",
    args: "p_jeton_hash text, p_cabinet_id uuid, p_utilisateur_id uuid, p_actif boolean, p_roles text[]",
    resultat:
      "TABLE(id uuid, email text, nom text, roles text[], actif boolean, " +
      "cree_le timestamp with time zone)",
  },
];

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const nouveauJetonHash = () => sha256(randomBytes(32).toString("base64url"));
const unique = () => `${++compteur}-${Date.now()}`;

/** Requête avec le rôle applicatif, hors contexte de cabinet. */
function app<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return ctx.db.withoutTenant(async (db: Db) => (await db.query(sql, params)).rows as T[]);
}

/** Requête avec le rôle propriétaire (hors RLS). */
function proprio<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return proprietaire(async (c) => (await c.query(sql, params)).rows as T[]);
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

async function creerSuperAdmin(actif = true): Promise<{ id: string; email: string }> {
  const email = `Admin-${unique()}@Plateforme.Test`;
  const [r] = await proprio<{ id: string }>(
    `INSERT INTO super_admins (email, nom, mot_de_passe_hash, actif)
     VALUES ($1, 'Super Admin', $2, $3) RETURNING id`,
    [email, hash, actif],
  );
  adminsCrees.push(r!.id);
  return { id: r!.id, email };
}

async function ouvrirSession(superAdminId: string): Promise<string> {
  const jeton = nouveauJetonHash();
  await app("SELECT plateforme_ouvrir_session($1, $2)", [superAdminId, jeton]);
  return jeton;
}

/** Session de cabinet posée directement (comme ouvrir-session.ts) ; renvoie le haché du jeton. */
async function sessionCabinet(cabinetId: string, utilisateurId: string): Promise<string> {
  const jeton = nouveauJetonHash();
  await proprio(
    `INSERT INTO sessions (cabinet_id, utilisateur_id, jeton_hash, expire_le)
     VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [cabinetId, utilisateurId, jeton],
  );
  return jeton;
}

async function nbJournal(): Promise<number> {
  const [r] = await proprio<{ n: number }>("SELECT count(*)::int AS n FROM journal_plateforme");
  return r!.n;
}

async function creerCabinetPlateforme(jeton: string, nom = `Cabinet plateforme ${unique()}`) {
  const email = `associe-${unique()}@exemple.test`;
  const [r] = await app<{ cabinet_id: string; utilisateur_id: string }>(
    "SELECT * FROM plateforme_creer_cabinet($1, $2, 'SN', $3, 'Associé Plateforme', $4)",
    [jeton, nom, email, hash],
  );
  return { cabinetId: r!.cabinet_id, associeId: r!.utilisateur_id, email, nom };
}

function creerUtilisateur(jeton: string, cabinetId: string, roles: unknown, email?: string) {
  return app<{ id: string; email: string; nom: string; roles: string[]; actif: boolean }>(
    "SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, 'Compte Plateforme', $4, $5)",
    [jeton, cabinetId, email ?? `compte-${unique()}@exemple.test`, roles, hash],
  );
}

function modifierUtilisateur(
  jeton: string,
  cabinetId: string,
  utilisateurId: string,
  actif: boolean | null,
  roles: string[] | null,
) {
  return app<{ id: string; roles: string[]; actif: boolean }>(
    "SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, $4, $5)",
    [jeton, cabinetId, utilisateurId, actif, roles],
  );
}

let admin: { id: string; email: string };
let jeton: string;

beforeAll(async () => {
  ctx = await demarrer();
  hash = await hashPassword(MOT_DE_PASSE_TEST);
  admin = await creerSuperAdmin();
  jeton = await ouvrirSession(admin.id);
});
afterAll(() => ctx.fermer());

describe("plateforme : aucun accès direct du rôle applicatif", () => {
  it("lecture, écriture, suppression et vidage des 3 tables refusés (permission denied)", async () => {
    for (const t of TABLES_PLATEFORME) {
      expect(await code(app(`SELECT * FROM ${t}`)), t).toBe("42501");
      expect(await code(app(`UPDATE ${t} SET cree_le = cree_le`)), t).toBe("42501");
      expect(await code(app(`DELETE FROM ${t}`)), t).toBe("42501");
      expect(await code(app(`TRUNCATE ${t}`)), t).toBe("42501");
    }
    expect(
      await code(
        app(`INSERT INTO super_admins (email, nom, mot_de_passe_hash) VALUES ('x@y.z', 'X', $1)`, [
          hash,
        ]),
      ),
    ).toBe("42501");
    expect(
      await code(
        app(
          `INSERT INTO plateforme_sessions (super_admin_id, jeton_hash, expire_le)
           VALUES ($1, $2, now() + interval '1 day')`,
          [admin.id, nouveauJetonHash()],
        ),
      ),
    ).toBe("42501");
    expect(
      await code(
        app(`INSERT INTO journal_plateforme (action, cible) VALUES ('connexion', 'super_admin')`),
      ),
    ).toBe("42501");
    expect(await code(app("SELECT nextval('journal_plateforme_id_seq')"))).toBe("42501");
    expect(await code(app("SELECT * FROM journal_plateforme_id_seq"))).toBe("42501");
  });

  it("aucun privilège de table, de colonne ni de séquence (catalogue)", async () => {
    const privileges = [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ];
    for (const t of TABLES_PLATEFORME) {
      for (const p of privileges) {
        const [r] = await app<{ ok: boolean }>(
          "SELECT has_table_privilege(current_user, $1::text, $2::text) AS ok",
          [`public.${t}`, p],
        );
        expect(r!.ok, `${t} ${p}`).toBe(false);
      }
      for (const p of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
        const [r] = await app<{ ok: boolean }>(
          "SELECT has_any_column_privilege(current_user, $1::text, $2::text) AS ok",
          [`public.${t}`, p],
        );
        expect(r!.ok, `${t} colonnes ${p}`).toBe(false);
      }
    }
    for (const p of ["USAGE", "SELECT", "UPDATE"]) {
      const [r] = await app<{ ok: boolean }>(
        "SELECT has_sequence_privilege(current_user, 'public.journal_plateforme_id_seq', $1::text) AS ok",
        [p],
      );
      expect(r!.ok, `séquence ${p}`).toBe(false);
    }
  });

  it("RLS activée, aucune politique permissive, politique RESTRICTIVE portail_interdit", async () => {
    const lignes = await proprio<{ relname: string; rls: boolean; pol: string[] }>(
      `SELECT c.relname, c.relrowsecurity AS rls,
              array(SELECT (p.polname || ':' || p.polpermissive::text) FROM pg_policy p
                    WHERE p.polrelid = c.oid ORDER BY 1) AS pol
       FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1)
       ORDER BY c.relname`,
      [TABLES_PLATEFORME],
    );
    expect(lignes).toEqual(
      [...TABLES_PLATEFORME].sort().map((relname) => ({
        relname,
        rls: true,
        pol: ["portail_interdit:false"],
      })),
    );
  });

  it("les 11 fonctions : SECURITY DEFINER, search_path verrouillé, EXECUTE au rôle applicatif seul", async () => {
    const lignes = await proprio<{
      nom: string;
      args: string;
      resultat: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      acl_nulle: boolean;
      public_execute: boolean;
      app_execute: boolean;
    }>(
      `SELECT p.proname AS nom, pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS resultat, p.prosecdef, p.proconfig,
              p.proacl IS NULL AS acl_nulle,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute,
              has_function_privilege('missionpilot_app', p.oid, 'EXECUTE') AS app_execute
       FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'plateforme\\_%'
         AND has_function_privilege('missionpilot_app', p.oid, 'EXECUTE')
       ORDER BY p.proname`,
    );
    // Exactement les 11 fonctions du contrat sont exécutables par le rôle applicatif.
    expect(lignes.map((l) => l.nom).sort()).toEqual(FONCTIONS.map((f) => f.nom).sort());
    for (const l of lignes) {
      const attendu = FONCTIONS.find((f) => f.nom === l.nom)!;
      expect(l.args, l.nom).toBe(attendu.args);
      expect(l.resultat, l.nom).toBe(attendu.resultat);
      expect(l.prosecdef, l.nom).toBe(true);
      expect(l.proconfig, l.nom).toEqual(["search_path=public, pg_temp"]);
      expect(l.acl_nulle, l.nom).toBe(false);
      expect(l.public_execute, l.nom).toBe(false);
    }
  });

  it("les outils internes et déclencheurs ne sont pas exécutables par le rôle applicatif", async () => {
    const internes = await proprio<{ nom: string; app: boolean; pub: boolean }>(
      `SELECT p.proname AS nom, has_function_privilege('missionpilot_app', p.oid, 'EXECUTE') AS app,
              p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                                          WHERE a.grantee = 0) AS pub
       FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND (p.proname LIKE 'plateforme\\_%' OR p.proname IN
              ('journal_plateforme_ajout_seul', 'cabinets_garder_etat_plateforme'))
         AND NOT (p.proname = ANY ($1))
       ORDER BY 1`,
      [FONCTIONS.map((f) => f.nom)],
    );
    expect(internes.map((i) => i.nom).sort()).toEqual([
      "cabinets_garder_etat_plateforme",
      "journal_plateforme_ajout_seul",
      "plateforme_admin_demo", // 0582 (bac à sable de démonstration)
      "plateforme_cabinet_visible", // 0582
      "plateforme_exiger_email",
      "plateforme_exiger_hash",
      "plateforme_exiger_nom",
      "plateforme_exiger_pays",
      "plateforme_exiger_roles",
      "plateforme_journal_cabinet",
      "plateforme_journaliser",
      "plateforme_retirer_consentements",
      "plateforme_roles_cabinet",
      "plateforme_session_verifiee",
    ]);
    expect(internes.filter((i) => i.app || i.pub)).toEqual([]);
    expect(await code(app("SELECT plateforme_session_verifiee($1)", [jeton]))).toBe("42501");
    expect(
      await code(
        app("SELECT plateforme_journaliser(NULL, 'connexion', 'super_admin', NULL, NULL, '{}')"),
      ),
    ).toBe("42501");
  });

  it("trouver_connexion et resoudre_session gardent leur signature et leurs colonnes (0001)", async () => {
    const lignes = await proprio<{ nom: string; args: string; resultat: string; def: boolean }>(
      `SELECT p.proname AS nom, pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS resultat, p.prosecdef AS def
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('trouver_connexion', 'resoudre_session') ORDER BY 1`,
    );
    expect(lignes).toEqual([
      {
        nom: "resoudre_session",
        args: "p_jeton_hash text",
        resultat: "TABLE(utilisateur_id uuid, cabinet_id uuid, email text, nom text, roles text[])",
        def: true,
      },
      {
        nom: "trouver_connexion",
        args: "p_email text",
        resultat:
          "TABLE(utilisateur_id uuid, cabinet_id uuid, mot_de_passe_hash text, actif boolean)",
        def: true,
      },
    ]);
  });
});

describe("plateforme : connexion et sessions", () => {
  it("trouver_connexion : e-mail insensible à la casse et aux espaces ; inconnu : aucune ligne", async () => {
    const [r] = await app<{ super_admin_id: string; mot_de_passe_hash: string; actif: boolean }>(
      "SELECT * FROM plateforme_trouver_connexion($1)",
      [`  ${admin.email.toUpperCase()} `],
    );
    expect(r).toEqual({ super_admin_id: admin.id, mot_de_passe_hash: hash, actif: true });
    expect(await verifyPassword(MOT_DE_PASSE_TEST, r!.mot_de_passe_hash)).toBe(true);
    expect(await app("SELECT * FROM plateforme_trouver_connexion('inconnu@exemple.test')")).toEqual(
      [],
    );
    const inactif = await creerSuperAdmin(false);
    const [i] = await app<{ actif: boolean }>("SELECT * FROM plateforme_trouver_connexion($1)", [
      inactif.email,
    ]);
    expect(i!.actif).toBe(false);
  });

  it("ouvrir_session : 8 h fixes, journal « connexion » ; admin inconnu ou inactif : MQP01", async () => {
    const a = await creerSuperAdmin();
    const avant = await nbJournal();
    const j = nouveauJetonHash();
    const [r] = await app<{ expire_le: Date; dans: number }>(
      `SELECT e AS expire_le, extract(epoch FROM e - now())::float8 AS dans
       FROM plateforme_ouvrir_session($1, $2) e`,
      [a.id, j],
    );
    expect(r!.dans).toBeGreaterThan(8 * 3600 - 60);
    expect(r!.dans).toBeLessThanOrEqual(8 * 3600);
    expect(await nbJournal()).toBe(avant + 1);
    const [l] = await proprio(
      "SELECT action, cible, cible_id, details FROM journal_plateforme ORDER BY id DESC LIMIT 1",
    );
    expect(l).toEqual({ action: "connexion", cible: "super_admin", cible_id: a.id, details: {} });
    const [s] = await app("SELECT * FROM plateforme_resoudre_session($1)", [j]);
    expect(s).toEqual({
      super_admin_id: a.id,
      email: a.email,
      nom: "Super Admin",
      est_demo: false,
    });

    const inactif = await creerSuperAdmin(false);
    expect(
      await code(app("SELECT plateforme_ouvrir_session($1, $2)", [inactif.id, nouveauJetonHash()])),
    ).toBe("MQP01");
    expect(
      await code(
        app("SELECT plateforme_ouvrir_session(gen_random_uuid(), $1)", [nouveauJetonHash()]),
      ),
    ).toBe("MQP01");
    expect(await nbJournal()).toBe(avant + 1);
  });

  it("ouvrir_session : purge des sessions expirées du même admin, plafond de 20 (la plus ancienne part)", async () => {
    const a = await creerSuperAdmin();
    const autre = await creerSuperAdmin();
    const expiree = nouveauJetonHash();
    const expireeAutre = nouveauJetonHash();
    await proprio(
      `INSERT INTO plateforme_sessions (super_admin_id, jeton_hash, expire_le, cree_le)
       VALUES ($1, $2, now() - interval '1 minute', now() - interval '9 hours'),
              ($3, $4, now() - interval '1 minute', now() - interval '9 hours')`,
      [a.id, expiree, autre.id, expireeAutre],
    );
    const jetons: string[] = [];
    for (let i = 0; i < 21; i++) jetons.push(await ouvrirSession(a.id));
    const restantes = await proprio<{ jeton_hash: string }>(
      "SELECT jeton_hash FROM plateforme_sessions WHERE super_admin_id = $1",
      [a.id],
    );
    expect(restantes).toHaveLength(20);
    const ensemble = new Set(restantes.map((r) => r.jeton_hash));
    expect(ensemble.has(expiree)).toBe(false);
    expect(ensemble.has(jetons[0]!)).toBe(false);
    expect(jetons.slice(1).every((j) => ensemble.has(j))).toBe(true);
    // Les sessions d'un autre admin ne sont pas touchées.
    const [x] = await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM plateforme_sessions WHERE jeton_hash = $1",
      [expireeAutre],
    );
    expect(x!.n).toBe(1);
  });

  it("resoudre_session : rien pour un jeton inconnu, expiré ou un admin désactivé (ne lève pas)", async () => {
    const a = await creerSuperAdmin();
    const j = await ouvrirSession(a.id);
    expect(await app("SELECT * FROM plateforme_resoudre_session($1)", [j])).toHaveLength(1);
    expect(
      await app("SELECT * FROM plateforme_resoudre_session($1)", [nouveauJetonHash()]),
    ).toEqual([]);
    expect(await app("SELECT * FROM plateforme_resoudre_session(NULL)")).toEqual([]);
    await proprio(
      "UPDATE plateforme_sessions SET expire_le = now() - interval '1 second' WHERE jeton_hash = $1",
      [j],
    );
    expect(await app("SELECT * FROM plateforme_resoudre_session($1)", [j])).toEqual([]);
    const j2 = await ouvrirSession(a.id);
    await proprio("UPDATE super_admins SET actif = false WHERE id = $1", [a.id]);
    expect(await app("SELECT * FROM plateforme_resoudre_session($1)", [j2])).toEqual([]);
  });

  it("echec_connexion : journalisé pour un admin connu seulement, sans donnée", async () => {
    const avant = await nbJournal();
    await app("SELECT plateforme_echec_connexion(gen_random_uuid())");
    await app("SELECT plateforme_echec_connexion(NULL)");
    expect(await nbJournal()).toBe(avant);
    await app("SELECT plateforme_echec_connexion($1)", [admin.id]);
    expect(await nbJournal()).toBe(avant + 1);
    const [l] = await proprio(
      `SELECT super_admin_id, action, cible, cible_id, cabinet_id, details
       FROM journal_plateforme ORDER BY id DESC LIMIT 1`,
    );
    expect(l).toEqual({
      super_admin_id: admin.id,
      action: "connexion_echec",
      cible: "super_admin",
      cible_id: admin.id,
      cabinet_id: null,
      details: {},
    });
  });

  it("fermer_session : supprime la session, journal « deconnexion » une seule fois, idempotente", async () => {
    const a = await creerSuperAdmin();
    const j = await ouvrirSession(a.id);
    const avant = await nbJournal();
    await app("SELECT plateforme_fermer_session($1)", [j]);
    await app("SELECT plateforme_fermer_session($1)", [j]);
    await app("SELECT plateforme_fermer_session($1)", [nouveauJetonHash()]);
    expect(await nbJournal()).toBe(avant + 1);
    expect(await app("SELECT * FROM plateforme_resoudre_session($1)", [j])).toEqual([]);
    expect(await code(app("SELECT * FROM plateforme_lister_cabinets($1)", [j]))).toBe("MQP01");
  });
});

describe("plateforme : session revérifiée par chaque opération (MQP01)", () => {
  it("jeton inconnu, expiré ou admin désactivé : MQP01, rien n'est écrit", async () => {
    const c = await creerCabinet(ctx, "Cabinet MQP01");
    const a = await creerSuperAdmin();
    const expire = await ouvrirSession(a.id);
    await proprio(
      "UPDATE plateforme_sessions SET expire_le = now() - interval '1 second' WHERE jeton_hash = $1",
      [expire],
    );
    const b = await creerSuperAdmin();
    const desactive = await ouvrirSession(b.id);
    await proprio("UPDATE super_admins SET actif = false WHERE id = $1", [b.id]);

    const appels: [string, (j: string | null) => unknown[]][] = [
      ["SELECT * FROM plateforme_lister_cabinets($1)", (j) => [j]],
      [
        "SELECT * FROM plateforme_creer_cabinet($1, 'Intrus', 'CI', $2, 'Intrus', $3)",
        (j) => [j, `intrus-${unique()}@exemple.test`, hash],
      ],
      ["SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, false)", (j) => [j, c.cabinetId]],
      ["SELECT * FROM plateforme_lister_utilisateurs($1, $2)", (j) => [j, c.cabinetId]],
      [
        "SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, 'Intrus', '{consultant}', $4)",
        (j) => [j, c.cabinetId, `intrus-${unique()}@exemple.test`, hash],
      ],
      [
        "SELECT * FROM plateforme_modifier_utilisateur($1, $2, $3, false, NULL)",
        (j) => [j, c.cabinetId, c.utilisateurId],
      ],
    ];
    const avant = await nbJournal();
    for (const [sql, params] of appels) {
      for (const j of [nouveauJetonHash(), expire, desactive, null, ""]) {
        expect(await code(app(sql, params(j))), sql).toBe("MQP01");
      }
    }
    expect(await nbJournal()).toBe(avant);
    const [etat] = await proprio<{ actif: boolean; u: boolean; n: number }>(
      `SELECT c.actif, u.actif AS u,
              (SELECT count(*)::int FROM utilisateurs x WHERE x.cabinet_id = c.id) AS n
       FROM cabinets c JOIN utilisateurs u ON u.id = $2 WHERE c.id = $1`,
      [c.cabinetId, c.utilisateurId],
    );
    expect(etat).toEqual({ actif: true, u: true, n: 1 });
  });
});

describe("plateforme : cabinets", () => {
  it("création : cabinet + associé connectable, activités internes semées, une ligne de journal", async () => {
    const avant = await nbJournal();
    const cree = await creerCabinetPlateforme(jeton);
    expect(await nbJournal()).toBe(avant + 1);

    const [cab] = await proprio(
      "SELECT nom, pays::text AS pays, actif, est_demo FROM cabinets WHERE id = $1",
      [cree.cabinetId],
    );
    expect(cab).toEqual({ nom: cree.nom, pays: "SN", actif: true, est_demo: false });
    const [act] = await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM activites_internes WHERE cabinet_id = $1",
      [cree.cabinetId],
    );
    expect(act!.n).toBe(4);

    // Connexion de l'associé par les fonctions de l'application.
    const [t] = await app<{
      utilisateur_id: string;
      cabinet_id: string;
      mot_de_passe_hash: string;
      actif: boolean;
    }>("SELECT * FROM trouver_connexion($1)", [cree.email.toUpperCase()]);
    expect(t).toMatchObject({
      utilisateur_id: cree.associeId,
      cabinet_id: cree.cabinetId,
      actif: true,
    });
    expect(await verifyPassword(MOT_DE_PASSE_TEST, t!.mot_de_passe_hash)).toBe(true);
    const s = await sessionCabinet(cree.cabinetId, cree.associeId);
    const [r] = await app("SELECT * FROM resoudre_session($1)", [s]);
    expect(r).toMatchObject({
      utilisateur_id: cree.associeId,
      cabinet_id: cree.cabinetId,
      roles: ["associe"],
    });

    const [l] = await proprio(
      `SELECT super_admin_id, action, cible, cible_id, cabinet_id, details
       FROM journal_plateforme ORDER BY id DESC LIMIT 1`,
    );
    expect(l).toEqual({
      super_admin_id: admin.id,
      action: "cabinet_creation",
      cible: "cabinet",
      cible_id: cree.cabinetId,
      cabinet_id: cree.cabinetId,
      details: { nom: cree.nom, pays: "SN", associe_id: cree.associeId },
    });
  });

  it("création : paramètres invalides (MQP04) et e-mail déjà pris (23505), sans rien créer", async () => {
    const existant = await creerCabinet(ctx, "Cabinet existant");
    const [{ n: cabinetsAvant }] = (await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM cabinets",
    )) as [{ n: number }];
    const avant = await nbJournal();
    const cas: [string, string, string, string, string][] = [
      ["  ", "CI", `a-${unique()}@exemple.test`, "Associé", hash],
      ["Cabinet", "ci", `a-${unique()}@exemple.test`, "Associé", hash],
      ["Cabinet", "CIV", `a-${unique()}@exemple.test`, "Associé", hash],
      ["Cabinet", "CI", "   ", "Associé", hash],
      ["Cabinet", "CI", "pas-un-email", "Associé", hash],
      ["Cabinet", "CI", `a-${unique()}@exemple.test`, "", hash],
      ["Cabinet", "CI", `a-${unique()}@exemple.test`, "Associé", MOT_DE_PASSE_TEST],
      ["x".repeat(201), "CI", `a-${unique()}@exemple.test`, "Associé", hash],
    ];
    for (const [nom, pays, email, associe, h] of cas) {
      expect(
        await code(
          app("SELECT * FROM plateforme_creer_cabinet($1, $2, $3, $4, $5, $6)", [
            jeton,
            nom,
            pays,
            email,
            associe,
            h,
          ]),
        ),
        `${nom.slice(0, 10)} ${pays} ${email}`,
      ).toBe("MQP04");
    }
    expect(
      await code(
        app("SELECT * FROM plateforme_creer_cabinet($1, 'Doublon', 'CI', $2, 'Associé', $3)", [
          jeton,
          `  ${existant.email.toUpperCase()}  `,
          hash,
        ]),
      ),
    ).toBe("23505");
    const [{ n: cabinetsApres }] = (await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM cabinets",
    )) as [{ n: number }];
    expect(cabinetsApres).toBe(cabinetsAvant);
    expect(await nbJournal()).toBe(avant);
  });

  it("liste : comptes du cabinet seulement (portail exclu), actifs comptés à part, tri par nom", async () => {
    const z = await creerCabinetPlateforme(jeton, `Tri Z ${unique()}`);
    const a = await creerCabinetPlateforme(jeton, `Tri A ${unique()}`);
    const inactif = await creerUtilisateur(jeton, z.cabinetId, ["consultant"]);
    await modifierUtilisateur(jeton, z.cabinetId, inactif[0]!.id, false, null);
    await ajouterUtilisateur(ctx, z.cabinetId, ["client_dirigeant"]);
    const avant = await nbJournal();
    const liste = await app<{
      id: string;
      nom: string;
      pays: string;
      actif: boolean;
      est_demo: boolean;
      nb_utilisateurs: number;
      nb_utilisateurs_actifs: number;
    }>("SELECT * FROM plateforme_lister_cabinets($1)", [jeton]);
    expect(await nbJournal()).toBe(avant);
    const lz = liste.find((c) => c.id === z.cabinetId);
    expect(lz).toMatchObject({
      nom: z.nom,
      pays: "SN",
      actif: true,
      est_demo: false,
      nb_utilisateurs: 2,
      nb_utilisateurs_actifs: 1,
    });
    expect(liste.findIndex((c) => c.id === a.cabinetId)).toBeLessThan(
      liste.findIndex((c) => c.id === z.cabinetId),
    );
    expect(Object.keys(liste[0]!).sort()).toEqual(
      [
        "actif",
        "cree_le",
        "est_demo",
        "id",
        "nb_utilisateurs",
        "nb_utilisateurs_actifs",
        "nom",
        "pays",
      ].sort(),
    );
  });

  it("modification : nom et état, NULL = inchangé, MQP02 si inconnu, MQP04 si rien ou nom vide", async () => {
    const c = await creerCabinetPlateforme(jeton);
    const avant = await nbJournal();
    const [r] = await app("SELECT * FROM plateforme_modifier_cabinet($1, $2, $3, NULL)", [
      jeton,
      c.cabinetId,
      "  Nouveau nom  ",
    ]);
    expect(r).toMatchObject({ id: c.cabinetId, nom: "Nouveau nom", pays: "SN", actif: true });
    expect(await nbJournal()).toBe(avant + 1);
    const [l] = await proprio(
      "SELECT action, cible, cible_id, cabinet_id, details FROM journal_plateforme ORDER BY id DESC LIMIT 1",
    );
    expect(l).toEqual({
      action: "cabinet_modification",
      cible: "cabinet",
      cible_id: c.cabinetId,
      cabinet_id: c.cabinetId,
      details: { nom: "Nouveau nom" },
    });
    expect(
      await code(
        app("SELECT * FROM plateforme_modifier_cabinet($1, gen_random_uuid(), 'X', NULL)", [jeton]),
      ),
    ).toBe("MQP02");
    expect(
      await code(app("SELECT * FROM plateforme_modifier_cabinet($1, NULL, 'X', NULL)", [jeton])),
    ).toBe("MQP02");
    expect(
      await code(
        app("SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, NULL)", [jeton, c.cabinetId]),
      ),
    ).toBe("MQP04");
    expect(
      await code(
        app("SELECT * FROM plateforme_modifier_cabinet($1, $2, ' ', true)", [jeton, c.cabinetId]),
      ),
    ).toBe("MQP04");
    expect(await nbJournal()).toBe(avant + 1);
  });

  it("désactivation : connexion et sessions coupées pour tous les comptes (portail compris), réactivation", async () => {
    const c = await creerCabinetPlateforme(jeton);
    const [consultant] = await creerUtilisateur(jeton, c.cabinetId, ["consultant"]);
    const portail = await ajouterUtilisateur(ctx, c.cabinetId, ["client_dirigeant"]);
    const temoin = await creerCabinet(ctx, "Cabinet témoin");
    const sessionTemoin = await sessionCabinet(temoin.cabinetId, temoin.utilisateurId);

    // 1. Coupure par resoudre_session et trouver_connexion seules (sessions conservées).
    const sAssocie = await sessionCabinet(c.cabinetId, c.associeId);
    const sPortail = await sessionCabinet(c.cabinetId, portail.utilisateurId);
    await proprio("UPDATE cabinets SET actif = false WHERE id = $1", [c.cabinetId]);
    for (const s of [sAssocie, sPortail]) {
      expect(await app("SELECT * FROM resoudre_session($1)", [s])).toEqual([]);
    }
    for (const email of [c.email, consultant!.email, portail.email]) {
      const [t] = await app<{ actif: boolean }>("SELECT * FROM trouver_connexion($1)", [email]);
      expect(t!.actif, email).toBe(false);
    }
    expect(await app("SELECT * FROM resoudre_session($1)", [sessionTemoin])).toHaveLength(1);
    await proprio("UPDATE cabinets SET actif = true WHERE id = $1", [c.cabinetId]);
    for (const s of [sAssocie, sPortail]) {
      expect(await app("SELECT * FROM resoudre_session($1)", [s])).toHaveLength(1);
    }
    const [t1] = await app<{ actif: boolean }>("SELECT * FROM trouver_connexion($1)", [c.email]);
    expect(t1!.actif).toBe(true);

    // 2. Par la plateforme : sessions et défis de double authentification supprimés.
    await proprio(
      `INSERT INTO defis_2fa (cabinet_id, utilisateur_id, defi_hash, expire_le)
       VALUES ($1, $2, $3, now() + interval '5 minutes')`,
      [c.cabinetId, c.associeId, nouveauJetonHash()],
    );
    const [r] = await app("SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, false)", [
      jeton,
      c.cabinetId,
    ]);
    expect(r).toMatchObject({ id: c.cabinetId, actif: false, est_demo: false });
    const [restes] = await proprio<{ s: number; d: number }>(
      `SELECT (SELECT count(*)::int FROM sessions WHERE cabinet_id = $1) AS s,
              (SELECT count(*)::int FROM defis_2fa WHERE cabinet_id = $1) AS d`,
      [c.cabinetId],
    );
    expect(restes).toEqual({ s: 0, d: 0 });
    expect(await app("SELECT * FROM resoudre_session($1)", [sessionTemoin])).toHaveLength(1);
    const [t2] = await app<{ actif: boolean }>("SELECT * FROM trouver_connexion($1)", [c.email]);
    expect(t2!.actif).toBe(false);
    const [l] = await proprio("SELECT details FROM journal_plateforme ORDER BY id DESC LIMIT 1");
    expect(l).toEqual({ details: { actif: false } });

    await app("SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, true)", [
      jeton,
      c.cabinetId,
    ]);
    const [t3] = await app<{ actif: boolean }>("SELECT * FROM trouver_connexion($1)", [c.email]);
    expect(t3!.actif).toBe(true);
    const nouvelle = await sessionCabinet(c.cabinetId, c.associeId);
    expect(await app("SELECT * FROM resoudre_session($1)", [nouvelle])).toHaveLength(1);
  });

  it("le rôle applicatif ne modifie ni actif ni est_demo d'un cabinet, même le sien (42501)", async () => {
    const c = await creerCabinet(ctx, "Cabinet garde");
    const enCabinet = (sql: string) =>
      ctx.db.withTenant(c.cabinetId, (db) => db.query(sql, [c.cabinetId]));
    expect(await code(enCabinet("UPDATE cabinets SET actif = false WHERE id = $1"))).toBe("42501");
    expect(await code(enCabinet("UPDATE cabinets SET est_demo = true WHERE id = $1"))).toBe(
      "42501",
    );
    const maj = await enCabinet("UPDATE cabinets SET nom = nom, actif = actif WHERE id = $1");
    expect(maj.rowCount).toBe(1);
  });
});

describe("plateforme : comptes du cabinet", () => {
  it("création d'un compte de chaque rôle du cabinet, liste sans le portail", async () => {
    const c = await creerCabinetPlateforme(jeton);
    const portail = await ajouterUtilisateur(ctx, c.cabinetId, ["client_contributeur"]);
    const avant = await nbJournal();
    const crees: string[] = [];
    for (const role of ROLES_CABINET) {
      const [u] = await creerUtilisateur(jeton, c.cabinetId, [role]);
      expect(u).toMatchObject({ roles: [role], actif: true, nom: "Compte Plateforme" });
      crees.push(u!.id);
    }
    const [multi] = await creerUtilisateur(jeton, c.cabinetId, ROLES_CABINET);
    expect(multi!.roles).toEqual(ROLES_CABINET);
    expect(await nbJournal()).toBe(avant + ROLES_CABINET.length + 1);
    const [l] = await proprio(
      "SELECT action, cible, cible_id, cabinet_id, details FROM journal_plateforme ORDER BY id DESC LIMIT 1",
    );
    expect(l).toEqual({
      action: "utilisateur_creation",
      cible: "utilisateur",
      cible_id: multi!.id,
      cabinet_id: c.cabinetId,
      details: { roles: ROLES_CABINET },
    });

    const liste = await app<{ id: string }>(
      "SELECT * FROM plateforme_lister_utilisateurs($1, $2)",
      [jeton, c.cabinetId],
    );
    const ids = liste.map((u) => u.id);
    expect(ids.sort()).toEqual([c.associeId, multi!.id, ...crees].sort());
    expect(ids).not.toContain(portail.utilisateurId);
    expect(Object.keys(liste[0]!).sort()).toEqual(
      ["actif", "cree_le", "email", "id", "nom", "roles"].sort(),
    );
    expect(await nbJournal()).toBe(avant + ROLES_CABINET.length + 1);
    expect(
      await code(
        app("SELECT * FROM plateforme_lister_utilisateurs($1, gen_random_uuid())", [jeton]),
      ),
    ).toBe("MQP02");
  });

  it("création refusée : rôles (client, vide, doublon, inconnu), nom, e-mail, haché, cabinet inconnu", async () => {
    const c = await creerCabinetPlateforme(jeton);
    const avant = await nbJournal();
    for (const roles of [
      ["client_dirigeant"],
      ["consultant", "client_contributeur"],
      [],
      null,
      ["consultant", "consultant"],
      ["inconnu"],
      ["consultant", null],
      [["consultant"]],
    ]) {
      expect(await code(creerUtilisateur(jeton, c.cabinetId, roles)), JSON.stringify(roles)).toBe(
        "MQP04",
      );
    }
    const params = (email: string, nom: string, h: string) => [
      jeton,
      c.cabinetId,
      email,
      nom,
      ["consultant"],
      h,
    ];
    const sql = "SELECT * FROM plateforme_creer_utilisateur($1, $2, $3, $4, $5, $6)";
    expect(await code(app(sql, params(" ", "Nom", hash)))).toBe("MQP04");
    expect(await code(app(sql, params(`v-${unique()}@exemple.test`, "  ", hash)))).toBe("MQP04");
    expect(
      await code(app(sql, params(`v-${unique()}@exemple.test`, "Nom", MOT_DE_PASSE_TEST))),
    ).toBe("MQP04");
    expect(
      await code(
        app("SELECT * FROM plateforme_creer_utilisateur($1, gen_random_uuid(), $2, 'N', $3, $4)", [
          jeton,
          `v-${unique()}@exemple.test`,
          ["consultant"],
          hash,
        ]),
      ),
    ).toBe("MQP02");
    expect(await nbJournal()).toBe(avant);
  });

  it("e-mail déjà pris (toute la plateforme, insensible à la casse) : 23505", async () => {
    const c = await creerCabinetPlateforme(jeton);
    const autre = await creerCabinet(ctx, "Autre cabinet");
    const email = `Doublon-${unique()}@Exemple.test`;
    await creerUtilisateur(jeton, c.cabinetId, ["consultant"], email);
    const avant = await nbJournal();
    expect(
      await code(creerUtilisateur(jeton, c.cabinetId, ["consultant"], email.toLowerCase())),
    ).toBe("23505");
    expect(
      await code(creerUtilisateur(jeton, autre.cabinetId, ["consultant"], email.toUpperCase())),
    ).toBe("23505");
    expect(await code(creerUtilisateur(jeton, c.cabinetId, ["consultant"], autre.email))).toBe(
      "23505",
    );
    expect(await nbJournal()).toBe(avant);
  });

  it("modification : rôles et état, sessions supprimées à la désactivation, journal des champs", async () => {
    const c = await creerCabinetPlateforme(jeton);
    const [u] = await creerUtilisateur(jeton, c.cabinetId, ["consultant"]);
    const s = await sessionCabinet(c.cabinetId, u!.id);
    const avant = await nbJournal();

    const [r1] = await modifierUtilisateur(jeton, c.cabinetId, u!.id, null, [
      "chef_mission",
      "consultant",
    ]);
    expect(r1).toMatchObject({ id: u!.id, roles: ["chef_mission", "consultant"], actif: true });
    expect(await app("SELECT * FROM resoudre_session($1)", [s])).toHaveLength(1);

    const [r2] = await modifierUtilisateur(jeton, c.cabinetId, u!.id, false, null);
    expect(r2).toMatchObject({ roles: ["chef_mission", "consultant"], actif: false });
    const [n] = await proprio<{ n: number }>(
      "SELECT count(*)::int AS n FROM sessions WHERE utilisateur_id = $1",
      [u!.id],
    );
    expect(n!.n).toBe(0);

    const [r3] = await modifierUtilisateur(jeton, c.cabinetId, u!.id, true, ["consultant"]);
    expect(r3).toMatchObject({ roles: ["consultant"], actif: true });

    expect(await nbJournal()).toBe(avant + 3);
    const journal = await proprio<{ details: unknown }>(
      `SELECT details FROM journal_plateforme
       WHERE action = 'utilisateur_modification' AND cible_id = $1 ORDER BY id`,
      [u!.id],
    );
    expect(journal.map((j) => j.details)).toEqual([
      { roles: ["chef_mission", "consultant"] },
      { actif: false },
      { actif: true, roles: ["consultant"] },
    ]);
    expect(await code(modifierUtilisateur(jeton, c.cabinetId, u!.id, null, null))).toBe("MQP04");
    expect(
      await code(modifierUtilisateur(jeton, c.cabinetId, u!.id, null, ["client_dirigeant"])),
    ).toBe("MQP04");
    expect(await code(modifierUtilisateur(jeton, c.cabinetId, u!.id, null, []))).toBe("MQP04");
  });

  it("MQP03 : compte inconnu, d'un autre cabinet ou du portail ; MQP02 : cabinet inconnu", async () => {
    const c = await creerCabinetPlateforme(jeton);
    const autre = await creerCabinet(ctx, "Autre cabinet");
    const portail = await ajouterUtilisateur(ctx, c.cabinetId, ["client_dirigeant"]);
    const avant = await nbJournal();
    const [{ id: inconnu }] = (await proprio<{ id: string }>("SELECT gen_random_uuid() AS id")) as [
      { id: string },
    ];
    for (const uid of [inconnu, autre.utilisateurId, portail.utilisateurId]) {
      expect(await code(modifierUtilisateur(jeton, c.cabinetId, uid, false, null)), uid).toBe(
        "MQP03",
      );
    }
    expect(await code(modifierUtilisateur(jeton, inconnu, c.associeId, false, null))).toBe("MQP02");
    expect(await nbJournal()).toBe(avant);
    const [p] = await proprio<{ actif: boolean }>("SELECT actif FROM utilisateurs WHERE id = $1", [
      portail.utilisateurId,
    ]);
    expect(p!.actif).toBe(true);
  });

  it("MQP05 : le cabinet garde au moins un associé actif", async () => {
    const c = await creerCabinetPlateforme(jeton);
    expect(await code(modifierUtilisateur(jeton, c.cabinetId, c.associeId, false, null))).toBe(
      "MQP05",
    );
    expect(
      await code(modifierUtilisateur(jeton, c.cabinetId, c.associeId, null, ["consultant"])),
    ).toBe("MQP05");
    // Second associé : le premier peut alors être retiré, puis le second ne le peut plus.
    const [second] = await creerUtilisateur(jeton, c.cabinetId, ["associe"]);
    await modifierUtilisateur(jeton, c.cabinetId, c.associeId, null, ["consultant"]);
    expect(await code(modifierUtilisateur(jeton, c.cabinetId, second!.id, false, null))).toBe(
      "MQP05",
    );
    // Un associé inactif ne compte pas.
    const [inactif] = await creerUtilisateur(jeton, c.cabinetId, ["associe"]);
    await modifierUtilisateur(jeton, c.cabinetId, inactif!.id, false, null);
    expect(
      await code(modifierUtilisateur(jeton, c.cabinetId, second!.id, null, ["gestionnaire"])),
    ).toBe("MQP05");
    // Réactiver l'associé inactif rétablit la possibilité.
    await modifierUtilisateur(jeton, c.cabinetId, inactif!.id, true, null);
    const [r] = await modifierUtilisateur(jeton, c.cabinetId, second!.id, false, null);
    expect(r!.actif).toBe(false);
  });
});

describe("plateforme : journal en ajout seul et sans secret", () => {
  it("UPDATE, DELETE et TRUNCATE refusés au propriétaire (MQP06)", async () => {
    await app("SELECT plateforme_echec_connexion($1)", [admin.id]);
    const avant = await nbJournal();
    expect(await code(proprio("UPDATE journal_plateforme SET action = 'connexion'"))).toBe("MQP06");
    expect(await code(proprio("UPDATE journal_plateforme SET super_admin_id = NULL"))).toBe(
      "MQP06",
    );
    expect(await code(proprio("UPDATE journal_plateforme SET details = '{}'"))).toBe("MQP06");
    expect(await code(proprio("DELETE FROM journal_plateforme"))).toBe("MQP06");
    expect(await code(proprio("TRUNCATE journal_plateforme"))).toBe("MQP06");
    expect(await nbJournal()).toBe(avant);
  });

  it("suppression d'un super admin : seule l'anonymisation par clé étrangère est admise", async () => {
    const a = await creerSuperAdmin();
    const j = await ouvrirSession(a.id);
    await app("SELECT plateforme_fermer_session($1)", [j]);
    const avant = await nbJournal();
    await proprio("DELETE FROM super_admins WHERE id = $1", [a.id]);
    expect(await nbJournal()).toBe(avant);
    const lignes = await proprio<{ super_admin_id: string | null; action: string }>(
      "SELECT super_admin_id, action FROM journal_plateforme WHERE cible_id = $1 ORDER BY id",
      [a.id],
    );
    expect(lignes).toEqual([
      { super_admin_id: null, action: "connexion" },
      { super_admin_id: null, action: "deconnexion" },
    ]);
  });

  it("aucun secret ni e-mail dans le journal ; est_demo jamais posé", async () => {
    const c = await creerCabinetPlateforme(jeton);
    const [u] = await creerUtilisateur(jeton, c.cabinetId, ["consultant"]);
    await modifierUtilisateur(jeton, c.cabinetId, u!.id, false, ["gestionnaire"]);
    await app("SELECT * FROM plateforme_modifier_cabinet($1, $2, 'Renommé', false)", [
      jeton,
      c.cabinetId,
    ]);
    await app("SELECT * FROM plateforme_modifier_cabinet($1, $2, NULL, true)", [
      jeton,
      c.cabinetId,
    ]);
    await app("SELECT plateforme_echec_connexion($1)", [admin.id]);

    const [tout] = await proprio<{ texte: string }>(
      `SELECT string_agg(concat_ws(' ', action, cible, cible_id, cabinet_id, details::text), E'\\n')
              AS texte
       FROM journal_plateforme`,
    );
    const texte = tout!.texte.toLowerCase();
    for (const secret of [hash, hash.split("$")[3]!, MOT_DE_PASSE_TEST, jeton]) {
      expect(texte.includes(secret.toLowerCase()), "secret dans le journal").toBe(false);
    }
    expect(texte.includes("mot_de_passe")).toBe(false);
    expect(texte.includes("@")).toBe(false);
    expect(texte.includes(c.email.toLowerCase())).toBe(false);
    expect(texte.includes(u!.email.toLowerCase())).toBe(false);

    // Cabinets créés ou modifiés par la plateforme dans ce fichier, et ses super admins.
    const [demo] = await proprio<{ cabinets: number; demo: number; admins: number }>(
      `SELECT (SELECT count(*)::int FROM cabinets WHERE id::text IN
                (SELECT j.cible_id FROM journal_plateforme j WHERE j.cible = 'cabinet')) AS cabinets,
              (SELECT count(*)::int FROM cabinets WHERE est_demo AND id::text IN
                (SELECT j.cible_id FROM journal_plateforme j WHERE j.cible = 'cabinet')) AS demo,
              (SELECT count(*)::int FROM super_admins WHERE est_demo AND id = ANY ($1)) AS admins`,
      [adminsCrees],
    );
    expect(demo!.cabinets).toBeGreaterThan(5);
    expect(demo).toMatchObject({ demo: 0, admins: 0 });
  });
});

describe("plateforme : aucune donnée métier", () => {
  it("les fonctions ne renvoient que des colonnes de cabinets, comptes ou sessions de la plateforme", async () => {
    const autorisees = new Set([
      "super_admin_id",
      "mot_de_passe_hash",
      "actif",
      "email",
      "nom",
      "est_demo",
      "id",
      "pays",
      "cree_le",
      "nb_utilisateurs",
      "nb_utilisateurs_actifs",
      "cabinet_id",
      "utilisateur_id",
      "roles",
    ]);
    const lignes = await proprio<{ nom: string; resultat: string }>(
      `SELECT p.proname AS nom, pg_get_function_result(p.oid) AS resultat
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY ($1)`,
      [FONCTIONS.map((f) => f.nom)],
    );
    expect(lignes).toHaveLength(FONCTIONS.length);
    for (const l of lignes) {
      const m = /^TABLE\((.*)\)$/.exec(l.resultat);
      if (!m) {
        expect(["void", "timestamp with time zone"], l.nom).toContain(l.resultat);
        continue;
      }
      const colonnes = m[1]!.split(", ").map((c) => c.split(" ")[0]!);
      expect(
        colonnes.filter((c) => !autorisees.has(c)),
        l.nom,
      ).toEqual([]);
    }
  });

  it("les fonctions ne lisent ni n'écrivent aucune table métier", async () => {
    const permises = new Set([
      "cabinets",
      "utilisateurs",
      "sessions",
      "defis_2fa",
      "super_admins",
      "plateforme_sessions",
      "journal_plateforme",
      // Traçabilité côté cabinet et retrait des consentements à la désactivation d'un compte :
      // écritures sans lecture de contenu métier (statut du dernier consentement seulement).
      "journal_audit",
      "canaux_destinataires",
      "canaux_consentements",
      "unnest",
      "strict",
      "loop", // « FOR UPDATE LOOP » (faux positif de l'expression)
    ]);
    const corps = await proprio<{ nom: string; src: string }>(
      `SELECT p.proname AS nom, p.prosrc AS src FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'plateforme\\_%'`,
    );
    expect(corps.length).toBeGreaterThanOrEqual(FONCTIONS.length);
    for (const { nom, src } of corps) {
      const tables = [...src.matchAll(/\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi)]
        .map((m) => m[1]!.toLowerCase())
        .filter((t) => !t.startsWith("v_"));
      expect(
        tables.filter((t) => !permises.has(t)),
        nom,
      ).toEqual([]);
    }
  });
});
