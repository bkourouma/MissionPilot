import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { loadConfig } from "../config.js";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);
export const APP_ROLE = "missionpilot_app";

/** Applique les migrations manquantes avec le rôle propriétaire, et crée le rôle applicatif. */
export async function migrate(ownerUrl: string, appUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await ensureAppRole(client, appUrl);
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} échouée : ${(error as Error).message}`);
      }
      applied.push(file);
    }
  } finally {
    await client.end();
  }
  return applied;
}

async function ensureAppRole(client: pg.Client, appUrl: string): Promise<void> {
  const url = new URL(appUrl);
  if (decodeURIComponent(url.username) !== APP_ROLE) {
    throw new Error(`DATABASE_URL doit utiliser le rôle ${APP_ROLE}`);
  }
  const password = decodeURIComponent(url.password);
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
  if (exists.rowCount) return;
  const stmt = await client.query(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS sql",
    [APP_ROLE, password],
  );
  await client.query(stmt.rows[0].sql);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = loadConfig();
  migrate(config.DATABASE_OWNER_URL, config.DATABASE_URL)
    .then((applied) =>
      console.log(applied.length ? `Appliquées : ${applied.join(", ")}` : "À jour"),
    )
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
