import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, ROLES_CLIENT } from "@missionpilot/shared";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import { semerDefaut } from "../src/db/seed-defaut.js";
import { NOM_CABINET_ABIDJAN } from "../src/db/seed-demo.js";
import { semerTenantDemo, type ResumeTenantDemo } from "../src/db/tenant-demo/index.js";
import {
  EMAIL_FONDATEUR_TENANT,
  MOT_DE_PASSE_DEMO_TENANT,
  NOM_CABINET_TENANT_DEMO,
} from "../src/db/tenant-demo/constantes.js";
import { CLES_CLIENTS } from "../src/db/tenant-demo/cles.js";
import type { PhaseTenantDemo } from "../src/db/tenant-demo/phases/index.js";
import { configTest } from "./helpers.js";

/*
 * Socle du seed « Tenant démo » (db/tenant-demo/, db/seed-tenant-demo.ts). Le déroulé complet
 * (cabinet créé par les vraies routes) dure une à deux minutes : il tourne dans une base JETABLE
 * créée par le test (jamais la base partagée des autres tests, où les adresses fixes de la
 * démonstration entreraient en collision), qui reçoit d'abord « Lagune Conseil & Associés (démo) »
 * pour prouver que les deux cabinets cohabitent et que Lagune n'est pas touché.
 */

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

async function lignes<T = Record<string, unknown>>(
  b: BaseJetable,
  sql: string,
  p: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: b.config.DATABASE_OWNER_URL });
  await client.connect();
  try {
    return (await client.query(sql, p)).rows as T[];
  } finally {
    await client.end();
  }
}

const TABLES_COMPTEES = [
  "cabinets",
  "utilisateurs",
  "utilisateurs_portail",
  "collaborateurs",
  "collaborateur_couts",
  "absences",
  "clients",
  "contacts_client",
  "taux_clients",
  "grades",
  "cabinet_feries",
  "journal_audit",
] as const;

/** Nombre de lignes par table (tous cabinets), ou d'un seul cabinet si `cabinetId` est donné. */
async function compter(b: BaseJetable, cabinetId?: string): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const t of TABLES_COMPTEES) {
    const colonne = t === "cabinets" ? "id" : "cabinet_id";
    const filtre = cabinetId ? `WHERE ${colonne} = '${cabinetId}'` : "";
    const rows = await lignes<{ n: string }>(b, `SELECT count(*) n FROM ${t} ${filtre}`);
    r[t] = Number(rows[0]?.n);
  }
  return r;
}

/** Comptes sans le journal d'audit (une reprise y ajoute connexions et réglages rejoués). */
const sansJournal = ({ journal_audit: _j, ...reste }: Record<string, number>) => reste;

const creationsAudit = async (b: BaseJetable, cabinetId: string): Promise<number> =>
  Number(
    (
      await lignes<{ n: string }>(
        b,
        "SELECT count(*) n FROM journal_audit WHERE cabinet_id = $1 AND action = 'creation'",
        [cabinetId],
      )
    )[0]?.n,
  );

let dossier: string;
let creationsApresPremier = 0;
let base: BaseJetable | undefined;
let lagune: { cabinetId: string; avant: Record<string, number> };
let premier: ResumeTenantDemo;
let second: ResumeTenantDemo;
let tenantId: string;
let apresPremier: Record<string, number>;
const appels: string[] = [];

const phaseEspion: PhaseTenantDemo = {
  nom: "espion",
  executer: async (ctx) => {
    appels.push(ctx.cabinetId);
    // Le contexte du socle est complet pour les phases.
    expect(Object.keys(ctx.clients)).toHaveLength(CLES_CLIENTS.length);
    expect(ctx.session("associe").utilisateurId).toBe(ctx.utilisateurs.associe);
    expect(ctx.aujourdhui).toBe("2026-10-24");
  },
};

describe("seed du Tenant démo (socle)", () => {
  beforeAll(async () => {
    dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-tenant-demo-"));
    base = await creerBaseJetable("tenantdemo", dossier);
    const silence = () => undefined;
    // Cabinet de démonstration existant : Lagune.
    const d = await semerDefaut(base.db, base.config, { publique: false, journal: silence });
    lagune = { cabinetId: d.cabinetId, avant: await compter(base, d.cabinetId) };
    const options = { publique: false, journal: silence, phases: [phaseEspion] };
    premier = await semerTenantDemo(base.db, base.config, options);
    tenantId = premier.socle.cabinetId;
    apresPremier = await compter(base, tenantId);
    creationsApresPremier = await creationsAudit(base, tenantId);
    second = await semerTenantDemo(base.db, base.config, options);
  }, 900_000);

  afterAll(async () => {
    await supprimerBaseJetable(base);
    await rm(dossier, { recursive: true, force: true });
  }, 120_000);

  it("crée le cabinet « Tenant démo », marqué démonstration, à côté de Lagune", async () => {
    const b = base as BaseJetable;
    expect(premier.socle.cabinetCree).toBe(true);
    const cabinets = await lignes<{ id: string; nom: string; est_demo: boolean; actif: boolean }>(
      b,
      "SELECT id, nom, est_demo, actif FROM cabinets ORDER BY nom",
    );
    expect(cabinets.map((c) => c.nom).sort()).toEqual(
      [NOM_CABINET_ABIDJAN, NOM_CABINET_TENANT_DEMO].sort(),
    );
    expect(cabinets.find((c) => c.id === tenantId)).toMatchObject({
      nom: "Tenant démo",
      est_demo: true,
      actif: true,
    });
    expect(NOM_CABINET_TENANT_DEMO).toBe("Tenant démo");
  });

  it("le cabinet est ancien : activité depuis octobre 2024", async () => {
    const b = base as BaseJetable;
    const r = await lignes<{ cree: string }>(
      b,
      "SELECT cree_le::date::text AS cree FROM cabinets WHERE id = $1",
      [tenantId],
    );
    expect(r[0]?.cree).toBe("2024-10-01");
    const couts = await lignes<{ debut: string }>(
      b,
      "SELECT min(depuis_le)::text AS debut FROM collaborateur_couts WHERE cabinet_id = $1",
      [tenantId],
    );
    expect(couts[0]?.debut).toBe("2024-10-01");
  });

  it("au moins 2 comptes actifs sans 2FA par rôle du cabinet et du portail", async () => {
    const b = base as BaseJetable;
    const comptes = await lignes<{ role: string; n: string }>(
      b,
      `SELECT r AS role, count(*) n FROM utilisateurs u, unnest(u.roles) r
       WHERE u.cabinet_id = $1 AND u.actif
         AND NOT EXISTS (SELECT 1 FROM utilisateurs_2fa f WHERE f.utilisateur_id = u.id)
       GROUP BY r`,
      [tenantId],
    );
    for (const role of [...ROLES, ...ROLES_CLIENT]) {
      const n = Number(comptes.find((c) => c.role === role)?.n ?? 0);
      expect(n, `comptes du rôle ${role}`).toBeGreaterThanOrEqual(2);
    }
    // Les comptes du portail sont rattachés à un client actif.
    const portail = await lignes<{ n: string }>(
      b,
      `SELECT count(*) n FROM utilisateurs_portail p JOIN clients c ON c.id = p.client_id
       WHERE p.cabinet_id = $1 AND p.statut = 'actif' AND c.actif`,
      [tenantId],
    );
    expect(Number(portail[0]?.n)).toBeGreaterThanOrEqual(ROLES_CLIENT.length * 2);
  });

  it("équipe, clients et groupes du socle sont semés", async () => {
    const b = base as BaseJetable;
    const types = await lignes<{ type: string; n: string }>(
      b,
      "SELECT type, count(*) n FROM collaborateurs WHERE cabinet_id = $1 GROUP BY type",
      [tenantId],
    );
    expect(types.map((t) => t.type).sort()).toEqual(["externe", "interne", "sous_traitant"]);
    const grades = await lignes<{ code: string }>(
      b,
      `SELECT DISTINCT g.code FROM collaborateurs c JOIN grades g ON g.id = c.grade_id
       WHERE c.cabinet_id = $1`,
      [tenantId],
    );
    expect(grades).toHaveLength(6);
    const inactifs = await lignes<{ n: string }>(
      b,
      "SELECT count(*) n FROM collaborateurs WHERE cabinet_id = $1 AND NOT actif",
      [tenantId],
    );
    expect(Number(inactifs[0]?.n)).toBeGreaterThanOrEqual(1);
    expect(apresPremier.clients).toBe(CLES_CLIENTS.length);
    expect(apresPremier.absences).toBeGreaterThan(0);
    const devises = await lignes<{ devise: string }>(
      b,
      "SELECT DISTINCT devise FROM taux_clients WHERE cabinet_id = $1 ORDER BY devise",
      [tenantId],
    );
    expect(devises.map((d) => d.devise)).toEqual(["EUR", "USD", "XAF", "XOF"]);
    const groupes = await lignes<{ n: string }>(
      b,
      "SELECT count(*) n FROM dossier_participations WHERE cabinet_id = $1",
      [tenantId],
    );
    expect(Number(groupes[0]?.n)).toBeGreaterThanOrEqual(3);
  });

  it("apparaît dans la liste de la connexion de démonstration (GET /api/auth/demo)", async () => {
    const b = base as BaseJetable;
    const app = await buildApp(
      { ...b.config, NODE_ENV: "test", CONNEXION_RAPIDE_DEMO: "oui" },
      b.db,
    );
    try {
      const r = await app.inject({ method: "GET", url: "/api/auth/demo" });
      expect(r.statusCode).toBe(200);
      const cabinets = r.json().cabinets as {
        id: string;
        nom: string;
        comptes: { email: string; roles: string[]; portail: boolean }[];
      }[];
      expect(cabinets.map((c) => c.nom)).toEqual(
        expect.arrayContaining([NOM_CABINET_TENANT_DEMO, NOM_CABINET_ABIDJAN]),
      );
      const tenant = cabinets.find((c) => c.nom === NOM_CABINET_TENANT_DEMO);
      expect(tenant?.id).toBe(tenantId);
      for (const role of [...ROLES, ...ROLES_CLIENT]) {
        const n = (tenant?.comptes ?? []).filter((c) => c.roles.includes(role)).length;
        expect(n, `comptes proposés pour ${role}`).toBeGreaterThanOrEqual(2);
      }
      // Connexion réelle (mot de passe) du fondateur.
      const c = await app.inject({
        method: "POST",
        url: "/api/auth/connexion",
        payload: { email: EMAIL_FONDATEUR_TENANT, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
      });
      expect(c.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("idempotent : la seconde exécution ne duplique rien et saute les phases faites", async () => {
    const b = base as BaseJetable;
    expect(second.socle.cabinetCree).toBe(false);
    expect(second.socle.cabinetId).toBe(tenantId);
    expect(sansJournal(await compter(b, tenantId))).toEqual(sansJournal(apresPremier));
    expect(await creationsAudit(b, tenantId)).toBe(creationsApresPremier);
    expect(premier.phases).toEqual([{ nom: "espion", statut: "executee" }]);
    expect(second.phases).toEqual([{ nom: "espion", statut: "deja_faite" }]);
    expect(appels).toEqual([tenantId]);
  });

  it("les phases enregistrées sont les cinq stubs, dans l'ordre", async () => {
    const { PHASES } = await import("../src/db/tenant-demo/phases/index.js");
    expect(PHASES.map((p) => p.nom)).toEqual([
      "missions",
      "notation-plans",
      "redressement-dd-ao",
      "ia-canaux-qualite",
      "portail-collab",
    ]);
  });

  it("Lagune n'est pas modifié par le semis du Tenant démo", async () => {
    const b = base as BaseJetable;
    const apres = await compter(b, lagune.cabinetId);
    // Le journal d'audit de Lagune ne bouge pas non plus.
    expect(apres).toEqual(lagune.avant);
    const l = await lignes<{ nom: string; est_demo: boolean }>(
      b,
      "SELECT nom, est_demo FROM cabinets WHERE id = $1",
      [lagune.cabinetId],
    );
    expect(l[0]).toEqual({ nom: NOM_CABINET_ABIDJAN, est_demo: true });
  });

  it("refus net si l'adresse fondatrice appartient à un autre cabinet : aucun drapeau posé", async () => {
    const b = base as BaseJetable;
    await lignes(b, "UPDATE cabinets SET nom = 'Autre cabinet', est_demo = false WHERE id = $1", [
      tenantId,
    ]);
    try {
      await expect(
        semerTenantDemo(b.db, b.config, { publique: false, journal: () => undefined, phases: [] }),
      ).rejects.toThrow(/n'est pas/);
      const t = await lignes<{ est_demo: boolean }>(
        b,
        "SELECT est_demo FROM cabinets WHERE id = $1",
        [tenantId],
      );
      expect(t[0]?.est_demo).toBe(false);
    } finally {
      await lignes(b, "UPDATE cabinets SET nom = $2, est_demo = true WHERE id = $1", [
        tenantId,
        NOM_CABINET_TENANT_DEMO,
      ]);
    }
  });
});
