import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { configTest } from "./helpers.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/*
 * Horloge du limiteur (migration 0120, HANDOFF n° 8) : le réglage de transaction
 * `app.horloge_test` ne remplace l'horloge de la base QUE dans une base dont le nom
 * finit par « _test ». Le rôle applicatif peut poser ce réglage ; hors base de test il
 * doit être ignoré, sinon il permettrait de rejouer le passé et de contourner la fenêtre.
 * Preuve : la même fonction, dans la base de test (témoin) puis dans une base
 * temporaire dont le nom ne finit pas par « _test » (migrations rejouées).
 */

const PASSE = "2000-01-01T00:00:00.000Z";
const configuration = configTest();
const nomTemporaire = `missionpilot_horloge_${randomBytes(4).toString("hex")}`;

function versBase(url: string, nom: string): string {
  const u = new URL(url);
  u.pathname = `/${nom}`;
  return u.toString();
}

const urlAdmin = versBase(configuration.DATABASE_OWNER_URL, "postgres");
const urlProprioTemporaire = versBase(configuration.DATABASE_OWNER_URL, nomTemporaire);
const urlAppTemporaire = versBase(configuration.DATABASE_URL, nomTemporaire);

const cle = () => createHash("sha256").update(randomBytes(8)).digest("hex");

/** Réserve une tentative (rôle applicatif) avec l'horloge de test réglée dans le passé. */
async function reserverDansLePasse(urlApp: string, urlProprio: string) {
  const c = cle();
  const app = new pg.Client({ connectionString: urlApp });
  await app.connect();
  try {
    await app.query("BEGIN");
    const nom = (await app.query("SELECT current_database() AS nom")).rows[0].nom as string;
    await app.query("SELECT set_config('app.horloge_test', $1, true)", [PASSE]);
    const ok = (await app.query("SELECT reserver_tentative_auth('connexion', $1) AS ok", [c]))
      .rows[0].ok;
    await app.query("COMMIT");
    expect(ok).toBe(true);
    const proprio = new pg.Client({ connectionString: urlProprio });
    await proprio.connect();
    try {
      const ligne = (
        await proprio.query(
          "SELECT instants[1] AS premier, expire_le FROM tentatives_auth WHERE espace = 'connexion' AND cle = $1",
          [c],
        )
      ).rows[0] as { premier: Date; expire_le: Date };
      return { nom, ...ligne };
    } finally {
      await proprio.end();
    }
  } finally {
    await app.end();
  }
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${nomTemporaire}"`);
  } finally {
    await admin.end();
  }
  await migrate(urlProprioTemporaire, configuration.DATABASE_URL);
});

afterAll(async () => {
  const admin = new pg.Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${nomTemporaire}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

describe("horloge du limiteur : app.horloge_test", () => {
  it("témoin : dans la base « _test », le réglage est honoré", async () => {
    const r = await reserverDansLePasse(
      configuration.DATABASE_URL,
      configuration.DATABASE_OWNER_URL,
    );
    expect(r.nom.endsWith("_test")).toBe(true);
    expect(r.premier.toISOString()).toBe(PASSE);
  });

  it("hors base « _test », le réglage posé par le rôle applicatif est ignoré (horloge de la base)", async () => {
    const avant = Date.now();
    const r = await reserverDansLePasse(urlAppTemporaire, urlProprioTemporaire);
    expect(r.nom.endsWith("_test")).toBe(false);
    expect(r.premier.getTime()).toBeGreaterThanOrEqual(avant - 5_000);
    expect(r.premier.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    // La fenêtre court depuis maintenant : la ligne n'expire pas en l'an 2000.
    expect(r.expire_le.getTime()).toBeGreaterThan(Date.now());
  });
});
