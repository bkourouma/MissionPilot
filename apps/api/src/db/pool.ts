import pg from "pg";
import type { Config } from "../config.js";

export type Db = pg.PoolClient;

export interface Database {
  /** Exécute `fn` dans une transaction dont les lignes sont filtrées par RLS sur ce cabinet. */
  withTenant<T>(cabinetId: string, fn: (db: Db) => Promise<T>): Promise<T>;
  /** Appels sans cabinet connu (connexion, session) : uniquement via fonctions SECURITY DEFINER. */
  withoutTenant<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDatabase(config: Pick<Config, "DATABASE_URL">): Database {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

  async function run<T>(cabinetId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
    if (cabinetId !== null && !UUID.test(cabinetId))
      throw new Error("Identifiant de cabinet invalide");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (cabinetId !== null) {
        await client.query("SELECT set_config('app.cabinet_id', $1, true)", [cabinetId]);
      }
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    withTenant: (cabinetId, fn) => run(cabinetId, fn),
    withoutTenant: (fn) => run(null, fn),
    close: () => pool.end(),
  };
}
