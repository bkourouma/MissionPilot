import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, ROLES_CLIENT, TOUS_LES_ROLES } from "@missionpilot/shared";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import type { Config } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import {
  EMAIL_SUPER_ADMIN_DEMO,
  MOT_DE_PASSE_DEMO_SUPER_ADMIN,
  rolesCouverts,
  semerDefaut,
  semerSuperAdminDemo,
  type ResumeDefaut,
} from "../src/db/seed-defaut.js";
import {
  configDemo,
  emailAbidjan,
  MOT_DE_PASSE_DEMO_ABIDJAN,
  NOM_CABINET_ABIDJAN,
} from "../src/db/seed-demo.js";
import { creerMailer, MailerJournal } from "../src/notifications/mailer.js";
import { configTest } from "./helpers.js";

/*
 * Seed du tenant par défaut (db/seed-defaut.ts). Le déroulé complet (cabinet de démonstration
 * créé par les vraies routes) dure une trentaine de secondes : il tourne dans deux bases
 * JETABLES créées par le test (jamais la base partagée des autres tests, où les comptes aux
 * adresses fixes de la démonstration entreraient en collision avec connexion-demo.test.ts) :
 * l'une en mode par défaut (idempotence, couverture des rôles, drapeaux, refus), l'autre en
 * mode démonstration publique (aucun e-mail réel, aucun job d'envoi conservé).
 */

const ARGV_PUBLIC = ["--confirmer-demo"];

function remplacerBase(url: string, nom: string): string {
  const u = new URL(url);
  u.pathname = `/${nom}`;
  return u.toString();
}

interface BaseJetable {
  nom: string;
  config: Config;
  db: Database;
}

async function creerBaseJetable(suffixe: string, dossier: string): Promise<BaseJetable> {
  const base = configTest();
  const nomPartage = new URL(base.DATABASE_OWNER_URL).pathname.slice(1);
  const nom = `${nomPartage}_${suffixe}`;
  const admin = new pg.Client({
    connectionString: remplacerBase(base.DATABASE_OWNER_URL, "postgres"),
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${nom}"`);
  await admin.end();
  const owner = remplacerBase(base.DATABASE_OWNER_URL, nom);
  const app = remplacerBase(base.DATABASE_URL, nom);
  await migrate(owner, app);
  const config: Config = {
    ...base,
    DATABASE_OWNER_URL: owner,
    DATABASE_URL: app,
    STORAGE_DIR: dossier,
  };
  return { nom, config, db: createDatabase(config) };
}

async function supprimerBaseJetable(b: BaseJetable | undefined): Promise<void> {
  if (!b) return;
  await b.db.close();
  const base = configTest();
  const admin = new pg.Client({
    connectionString: remplacerBase(base.DATABASE_OWNER_URL, "postgres"),
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${b.nom}" WITH (FORCE)`);
  await admin.end();
}

async function proprietaire<T>(b: BaseJetable, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: b.config.DATABASE_OWNER_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const lignes = <T = Record<string, unknown>>(b: BaseJetable, sql: string, p: unknown[] = []) =>
  proprietaire(b, async (c) => (await c.query(sql, p)).rows as T[]);

/** Connexion réelle d'un compte de cabinet ou du portail (POST /api/auth/connexion). */
async function connexionCabinet(b: BaseJetable, email: string): Promise<number> {
  const app = await buildApp({ ...b.config, NODE_ENV: "test", TOTP_REQUIS: "non" }, b.db);
  try {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/connexion",
      payload: { email, mot_de_passe: MOT_DE_PASSE_DEMO_ABIDJAN },
    });
    return r.statusCode;
  } finally {
    await app.close();
  }
}

/* ----- Gardes (rapides, sans base) ----- */

describe("gardes du seed de démonstration (configDemo)", () => {
  const local = {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://u:p@127.0.0.1:55440/missionpilot_demo",
    DATABASE_OWNER_URL: "postgres://u:p@127.0.0.1:55440/missionpilot_demo",
  };
  const PROD = {
    NODE_ENV: "production",
    DATABASE_OWNER_URL: "postgres://o:x@db.exemple.test:5432/mp",
    DATABASE_URL: "postgres://a:x@db.exemple.test:5432/mp",
    SESSION_SECRET: "un-secret-de-production-tres-long-0123",
    TFA_MASTER_KEY: "une-cle-maitre-2fa-de-production-4567",
    SMTP_HOST: "smtp.exemple.test",
    SMTP_USER: "utilisateur",
    SMTP_PASS: "mot-de-passe-smtp",
    MAIL_FROM: "noreply@exemple.test",
    STORAGE_DIR: "/srv/missionpilot/stockage",
  };

  it("par défaut (aucune démonstration publique) : refus hors développement, message clair", () => {
    expect(() => configDemo({ ...PROD }, ARGV_PUBLIC)).toThrow(/interdit hors développement/);
    expect(() => configDemo({ ...PROD }, ARGV_PUBLIC)).toThrow(/DEMO_PUBLIQUE=oui/);
    expect(() => configDemo({ ...PROD, DEMO_PUBLIQUE: "oui" }, [])).toThrow(/--confirmer-demo/);
    expect(() => configDemo({ ...PROD, DEMO_PUBLIQUE: "non" }, ARGV_PUBLIC)).toThrow(/interdit/);
    expect(() => configDemo({ ...PROD })).toThrow(/interdit/);
    expect(() => configDemo({ ...local, DATABASE_URL: "postgres://u:p@db.exemple.com/x" })).toThrow(
      /locale/,
    );
    expect(() => configDemo({ ...local, SMTP_HOST: "smtp.exemple.com" })).toThrow(/SMTP_HOST/);
  });

  it("la démonstration publique n'est jamais examinée sans argv explicite (les autres seeds)", () => {
    expect(() => configDemo({ ...PROD, DEMO_PUBLIQUE: "oui" })).toThrow(/interdit/);
  });

  it("OUI + --confirmer-demo : configuration du serveur validée, tout SMTP retiré", () => {
    const config = configDemo({ ...PROD, DEMO_PUBLIQUE: "oui" }, ARGV_PUBLIC);
    expect(config.NODE_ENV).toBe("production");
    expect(config.SMTP_HOST).toBeUndefined();
    expect(config.SMTP_USER).toBeUndefined();
    expect(config.SMTP_PASS).toBeUndefined();
    // Même en mode public, une configuration de serveur invalide reste refusée.
    expect(() =>
      configDemo({ ...PROD, DEMO_PUBLIQUE: "oui", SESSION_SECRET: "court" }, ARGV_PUBLIC),
    ).toThrow();
  });
});

/* ----- Mode par défaut : base jetable 1 ----- */

let dossier: string;
let b1: BaseJetable | undefined;
let reelCabinetId: string;
let premier: ResumeDefaut;
let second: ResumeDefaut;
let avant: { utilisateurs: number; cabinets: number; superAdmins: number; clients: number };

const compter = async (b: BaseJetable) => ({
  utilisateurs: Number(
    (await lignes<{ n: string }>(b, "SELECT count(*) n FROM utilisateurs"))[0]?.n,
  ),
  cabinets: Number((await lignes<{ n: string }>(b, "SELECT count(*) n FROM cabinets"))[0]?.n),
  superAdmins: Number(
    (await lignes<{ n: string }>(b, "SELECT count(*) n FROM super_admins"))[0]?.n,
  ),
  clients: Number((await lignes<{ n: string }>(b, "SELECT count(*) n FROM clients"))[0]?.n),
});

describe("seed du tenant par défaut (mode par défaut)", () => {
  beforeAll(async () => {
    dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-defaut-"));
    b1 = await creerBaseJetable("defaut1", dossier);
    // Un cabinet RÉEL et un super admin RÉEL préexistent : ils ne doivent jamais être touchés.
    const hash = await hashPassword("Mot-de-passe-reel-1");
    reelCabinetId = (
      await lignes<{ id: string }>(b1, "SELECT creer_cabinet($1, 'CI', $2, $3, $4) AS id", [
        "Cabinet réel",
        "associe@cabinet-reel.test",
        "Associé Réel",
        hash,
      ])
    )[0]?.id as string;
    await lignes(
      b1,
      "INSERT INTO super_admins (email, nom, mot_de_passe_hash) VALUES ('reel@plateforme.test', 'Réel', $1)",
      [hash],
    );
    premier = await semerDefaut(b1.db, b1.config, { publique: false, journal: () => undefined });
    avant = await compter(b1);
    second = await semerDefaut(b1.db, b1.config, { publique: false, journal: () => undefined });
  }, 900_000);

  afterAll(async () => {
    await supprimerBaseJetable(b1);
    await rm(dossier, { recursive: true, force: true });
  }, 120_000);

  it("(1) premier lancement crée tout ; le second ne duplique rien et n'échoue pas", async () => {
    expect(premier.cabinetCree).toBe(true);
    expect(premier.superAdminCree).toBe(true);
    expect(premier.comptesAjoutes).toEqual([]);
    expect(second.cabinetCree).toBe(false);
    expect(second.cabinetId).toBe(premier.cabinetId);
    expect(second.portailRepris).toBe(false);
    expect(second.comptesAjoutes).toEqual([]);
    expect(second.superAdminCree).toBe(false);
    expect(await compter(b1 as BaseJetable)).toEqual(avant);
  });

  it("(2) chaque rôle de TOUS_LES_ROLES a un compte actif sans 2FA qui se connecte", async () => {
    const base = b1 as BaseJetable;
    const comptes = await lignes<{ email: string; role: string }>(
      base,
      `SELECT u.email, r AS role FROM utilisateurs u, unnest(u.roles) r
       WHERE u.cabinet_id = $1 AND u.actif
         AND NOT EXISTS (SELECT 1 FROM utilisateurs_2fa f WHERE f.utilisateur_id = u.id)
         AND (r = ANY($2) OR EXISTS (SELECT 1 FROM utilisateurs_portail p
                                     WHERE p.utilisateur_id = u.id AND p.statut = 'actif'))
       ORDER BY u.email`,
      [premier.cabinetId, [...ROLES]],
    );
    for (const role of TOUS_LES_ROLES) {
      const c = comptes.find((x) => x.role === role);
      expect(c, `aucun compte pour le rôle ${role}`).toBeDefined();
      expect(await connexionCabinet(base, (c as { email: string }).email)).toBe(200);
    }
    const couverts = await rolesCouverts(base.db, premier.cabinetId);
    expect([...couverts].sort()).toEqual([...TOUS_LES_ROLES].sort());
    // Les rôles du portail sont rattachés à un client actif.
    const portail = await lignes<{ n: string }>(
      base,
      "SELECT count(*) n FROM utilisateurs_portail p JOIN clients c ON c.id = p.client_id WHERE p.statut = 'actif'",
    );
    expect(Number(portail[0]?.n)).toBeGreaterThanOrEqual(ROLES_CLIENT.length);
  }, 300_000);

  it("(3) drapeaux de démonstration : le cabinet de démonstration et le super admin de démonstration seulement", async () => {
    const base = b1 as BaseJetable;
    const cabinets = await lignes<{ id: string; nom: string; est_demo: boolean }>(
      base,
      "SELECT id, nom, est_demo FROM cabinets ORDER BY nom",
    );
    expect(cabinets).toHaveLength(2);
    expect(cabinets.find((c) => c.id === premier.cabinetId)).toMatchObject({
      nom: NOM_CABINET_ABIDJAN,
      est_demo: true,
    });
    expect(cabinets.find((c) => c.id === reelCabinetId)?.est_demo).toBe(false);
    const admins = await lignes<{ email: string; est_demo: boolean }>(
      base,
      "SELECT email, est_demo FROM super_admins ORDER BY email",
    );
    expect(admins).toEqual([
      { email: "reel@plateforme.test", est_demo: false },
      { email: EMAIL_SUPER_ADMIN_DEMO, est_demo: true },
    ]);
  });

  it("le super admin de démonstration se connecte par POST /api/plateforme/connexion", async () => {
    const base = b1 as BaseJetable;
    const app = await buildApp({ ...base.config, NODE_ENV: "test" }, base.db);
    try {
      const ok = await app.inject({
        method: "POST",
        url: "/api/plateforme/connexion",
        payload: { email: EMAIL_SUPER_ADMIN_DEMO, motDePasse: MOT_DE_PASSE_DEMO_SUPER_ADMIN },
      });
      expect(ok.statusCode).toBe(200);
      const mauvais = await app.inject({
        method: "POST",
        url: "/api/plateforme/connexion",
        payload: { email: EMAIL_SUPER_ADMIN_DEMO, motDePasse: "pas-le-bon-mot-de-passe" },
      });
      expect(mauvais.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("un rôle sans compte actif est complété (cabinet et portail), sans rien dupliquer d'autre", async () => {
    const base = b1 as BaseJetable;
    await lignes(
      base,
      `UPDATE utilisateurs SET actif = false
       WHERE cabinet_id = $1 AND (roles @> ARRAY['ressources'] OR roles @> ARRAY['client_investisseur'])`,
      [premier.cabinetId],
    );
    const manquants = await rolesCouverts(base.db, premier.cabinetId);
    expect(manquants.has("ressources")).toBe(false);
    expect(manquants.has("client_investisseur")).toBe(false);
    const r = await semerDefaut(base.db, base.config, {
      publique: false,
      journal: () => undefined,
    });
    expect(r.cabinetCree).toBe(false);
    expect(r.comptesAjoutes.sort()).toEqual(
      [
        emailAbidjan("investisseur.client.complement"),
        emailAbidjan("ressources.complement"),
      ].sort(),
    );
    const couverts = await rolesCouverts(base.db, premier.cabinetId);
    expect([...couverts].sort()).toEqual([...TOUS_LES_ROLES].sort());
    for (const email of r.comptesAjoutes) expect(await connexionCabinet(base, email)).toBe(200);
    // Relance : plus rien à ajouter.
    const encore = await semerDefaut(base.db, base.config, {
      publique: false,
      journal: () => undefined,
    });
    expect(encore.comptesAjoutes).toEqual([]);
  }, 300_000);

  it("refus net si l'adresse fondatrice appartient à un autre cabinet : aucun drapeau posé", async () => {
    const base = b1 as BaseJetable;
    await lignes(
      base,
      "UPDATE cabinets SET nom = 'Autre cabinet', est_demo = false WHERE id = $1",
      [premier.cabinetId],
    );
    try {
      await expect(
        semerDefaut(base.db, base.config, { publique: false, journal: () => undefined }),
      ).rejects.toThrow(/n'est pas/);
      const flags = await lignes<{ est_demo: boolean }>(base, "SELECT est_demo FROM cabinets");
      expect(flags.every((f) => !f.est_demo)).toBe(true);
    } finally {
      await lignes(base, "UPDATE cabinets SET nom = $2, est_demo = true WHERE id = $1", [
        premier.cabinetId,
        NOM_CABINET_ABIDJAN,
      ]);
    }
  });

  it("un vrai super admin à l'adresse de démonstration n'est jamais marqué démonstration", async () => {
    const base = b1 as BaseJetable;
    await lignes(base, "UPDATE super_admins SET est_demo = false WHERE email = $1", [
      EMAIL_SUPER_ADMIN_DEMO,
    ]);
    try {
      await proprietaire(base, async (c) => {
        await expect(semerSuperAdminDemo(c)).rejects.toThrow(/super admin réel/);
      });
      const r = await lignes<{ est_demo: boolean }>(
        base,
        "SELECT est_demo FROM super_admins WHERE email = $1",
        [EMAIL_SUPER_ADMIN_DEMO],
      );
      expect(r[0]?.est_demo).toBe(false);
    } finally {
      await lignes(base, "UPDATE super_admins SET est_demo = true WHERE email = $1", [
        EMAIL_SUPER_ADMIN_DEMO,
      ]);
    }
  });
});

/* ----- Démonstration publique : base jetable 2 ----- */

describe("seed du tenant par défaut (démonstration publique)", () => {
  let b2: BaseJetable | undefined;
  let dossier2: string;
  let serveur: net.Server;
  let connexions = 0;
  let config: Config;
  let resume: ResumeDefaut;

  beforeAll(async () => {
    // Faux serveur SMTP : toute connexion reçue serait un envoi réel tenté.
    serveur = net.createServer((socket) => {
      connexions++;
      socket.destroy();
    });
    await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
    const port = (serveur.address() as net.AddressInfo).port;
    dossier2 = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-defaut-pub-"));
    b2 = await creerBaseJetable("defaut2", dossier2);
    config = configDemo(
      {
        ...process.env,
        NODE_ENV: "test",
        DEMO_PUBLIQUE: "oui",
        DATABASE_OWNER_URL: b2.config.DATABASE_OWNER_URL,
        DATABASE_URL: b2.config.DATABASE_URL,
        STORAGE_DIR: dossier2,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(port),
        SMTP_TLS: "aucun",
        MAIL_FROM: "demo@exemple.test",
      },
      ARGV_PUBLIC,
    );
    resume = await semerDefaut(b2.db, config, { publique: true, journal: () => undefined });
  }, 900_000);

  afterAll(async () => {
    await new Promise<void>((ok) => serveur.close(() => ok()));
    await supprimerBaseJetable(b2);
    await rm(dossier2, { recursive: true, force: true });
  }, 120_000);

  it("(4) aucun SMTP dans la configuration, aucune connexion SMTP, transport muet", async () => {
    expect(config.SMTP_HOST).toBeUndefined();
    expect(creerMailer({ ...config, NODE_ENV: "test" })).toBeInstanceOf(MailerJournal);
    expect(connexions).toBe(0);
  });

  it("(4) aucun job d'envoi ne survit au seed : le worker du serveur ne verrait rien à envoyer", async () => {
    const base = b2 as BaseJetable;
    const jobs = await lignes<{
      type: string;
      statut: string;
      erreur: string | null;
      charge: string;
    }>(base, "SELECT type, statut, erreur, charge::text AS charge FROM jobs");
    expect(jobs.filter((j) => j.statut === "en_attente")).toEqual([]);
    const neutralises = jobs.filter((j) => j.type === "envoyer_email");
    expect(neutralises.length).toBeGreaterThan(0);
    for (const j of neutralises) {
      expect(j.statut).toBe("echec");
      expect(j.erreur).toMatch(/Neutralisé/);
      expect(j.charge).toBe("{}");
    }
  });

  it("le tenant et le super admin de démonstration sont créés et marqués", async () => {
    const base = b2 as BaseJetable;
    expect(resume.cabinetCree).toBe(true);
    const c = await lignes<{ nom: string; est_demo: boolean }>(
      base,
      "SELECT nom, est_demo FROM cabinets",
    );
    expect(c).toEqual([{ nom: NOM_CABINET_ABIDJAN, est_demo: true }]);
    const couverts = await rolesCouverts(base.db, resume.cabinetId);
    expect([...couverts].sort()).toEqual([...TOUS_LES_ROLES].sort());
    const a = await lignes<{ est_demo: boolean }>(base, "SELECT est_demo FROM super_admins");
    expect(a).toEqual([{ est_demo: true }]);
  });
});
