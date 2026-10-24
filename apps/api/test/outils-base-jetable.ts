import pg from "pg";
import type { Config } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import { configTest } from "./helpers.js";

/* Base PostgreSQL jetable pour les tests de semis longs (créée, migrée puis supprimée par le test). */

const remplacerBase = (url: string, nom: string): string => {
  const u = new URL(url);
  u.pathname = `/${nom}`;
  return u.toString();
};

export interface BaseJetable {
  nom: string;
  config: Config;
  db: Database;
}

async function sqlAdmin(base: Config, ...requetes: string[]): Promise<void> {
  const admin = new pg.Client({
    connectionString: remplacerBase(base.DATABASE_OWNER_URL, "postgres"),
  });
  await admin.connect();
  for (const r of requetes) await admin.query(r);
  await admin.end();
}

export async function creerBaseJetable(suffixe: string, dossier: string): Promise<BaseJetable> {
  const base = configTest();
  const nom = `${new URL(base.DATABASE_OWNER_URL).pathname.slice(1)}_${suffixe}`;
  await sqlAdmin(base, `DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`, `CREATE DATABASE "${nom}"`);
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

export async function supprimerBaseJetable(b: BaseJetable | undefined): Promise<void> {
  if (!b) return;
  await b.db.close();
  await sqlAdmin(configTest(), `DROP DATABASE IF EXISTS "${b.nom}" WITH (FORCE)`);
}
