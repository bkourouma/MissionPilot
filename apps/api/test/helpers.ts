import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createDatabase, type Database } from "../src/db/pool.js";
import { hashPassword } from "../src/auth/password.js";
import { urlBaseTest } from "./urls.js";

export const MOT_DE_PASSE_TEST = "Test-motdepasse-1";

export interface Contexte {
  config: Config;
  db: Database;
  app: FastifyInstance;
  fermer(): Promise<void>;
}

export function configTest(): Config {
  const base = loadConfig({ ...process.env, NODE_ENV: "test" });
  return {
    ...base,
    DATABASE_OWNER_URL: urlBaseTest(base.DATABASE_OWNER_URL),
    DATABASE_URL: urlBaseTest(base.DATABASE_URL),
  };
}

export async function demarrer(): Promise<Contexte> {
  const config = configTest();
  const db = createDatabase(config);
  const app = await buildApp(config, db);
  return {
    config,
    db,
    app,
    fermer: async () => {
      await app.close();
      await db.close();
    },
  };
}

/** Connexion propriétaire (hors RLS) pour préparer ou inspecter les données de test. */
export async function proprietaire<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: configTest().DATABASE_OWNER_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

let compteur = 0;

export async function creerCabinet(
  ctx: Contexte,
  nom = "Cabinet",
): Promise<{ cabinetId: string; email: string; utilisateurId: string }> {
  compteur += 1;
  const email = `associe${compteur}-${Date.now()}@exemple.test`;
  const hash = await hashPassword(MOT_DE_PASSE_TEST);
  const cabinetId = await ctx.db.withoutTenant(async (db) => {
    const r = await db.query("SELECT creer_cabinet($1, 'CI', $2, 'Associé Test', $3) AS id", [
      nom,
      email,
      hash,
    ]);
    return r.rows[0].id as string;
  });
  const utilisateurId = await ctx.db.withTenant(cabinetId, async (db) => {
    const r = await db.query("SELECT id FROM utilisateurs WHERE email = $1", [email]);
    return r.rows[0].id as string;
  });
  return { cabinetId, email, utilisateurId };
}

export async function ajouterUtilisateur(
  ctx: Contexte,
  cabinetId: string,
  roles: string[],
): Promise<{ email: string; utilisateurId: string }> {
  compteur += 1;
  const email = `u${compteur}-${Date.now()}@exemple.test`;
  const hash = await hashPassword(MOT_DE_PASSE_TEST);
  const utilisateurId = await ctx.db.withTenant(cabinetId, async (db) => {
    const r = await db.query(
      `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
       VALUES ($1, $2, 'Utilisateur Test', $3, $4) RETURNING id`,
      [cabinetId, email, roles, hash],
    );
    return r.rows[0].id as string;
  });
  return { email, utilisateurId };
}

/** Ouvre une session et renvoie l'en-tête Cookie à joindre aux requêtes suivantes. */
export async function connecter(ctx: Contexte, email: string): Promise<string> {
  const reponse = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/connexion",
    payload: { email, mot_de_passe: MOT_DE_PASSE_TEST },
  });
  if (reponse.statusCode !== 200) throw new Error(`Connexion échouée : ${reponse.body}`);
  const cookie = reponse.cookies[0];
  if (!cookie) throw new Error("Pas de cookie de session");
  return `${cookie.name}=${cookie.value}`;
}
