import pg from "pg";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { urlBaseTest } from "./urls.js";

/** Prépare la base de test dédiée (jamais la base de développement) et applique les migrations. */
export default async function setup(): Promise<void> {
  const config = loadConfig({ ...process.env, NODE_ENV: "test" });
  const owner = urlBaseTest(config.DATABASE_OWNER_URL);
  const app = urlBaseTest(config.DATABASE_URL);
  const nom = new URL(owner).pathname.slice(1);
  if (!nom.endsWith("_test")) throw new Error("La base de test doit se terminer par _test");

  const admin = new pg.Client({ connectionString: swapDb(owner, "postgres") });
  await admin.connect();
  const existe = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [nom]);
  if (!existe.rowCount) await admin.query(`CREATE DATABASE "${nom}"`);
  await admin.end();

  const client = new pg.Client({ connectionString: owner });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.end();
  await migrate(owner, app);
}

function swapDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
