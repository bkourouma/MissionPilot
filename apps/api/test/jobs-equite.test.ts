import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerCabinet, demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Réservation ÉQUITABLE de la file `jobs` (migration 0305, `reserver_job_a`) : on choisit d'abord
 * le cabinet (moins de jobs en cours, puis dernier job réservé le plus ancien, puis plus ancien
 * job prêt), puis le plus ancien job prêt du cabinet. Horloge injectée (date de réservation en
 * paramètre), cabinets propres au test.
 */

let ctx: Contexte;
let cabinets: string[];

const T0 = Date.UTC(2031, 0, 1, 8, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

beforeAll(async () => {
  ctx = await demarrer();
  cabinets = [];
  for (const nom of ["Équité A", "Équité B", "Équité C"]) {
    cabinets.push((await creerCabinet(ctx, nom)).cabinetId);
  }
});
afterAll(() => ctx.fermer());

/** Repart d'une file propre : plus aucun job de nos cabinets, jobs d'autres tests neutralisés. */
async function viderFile() {
  await proprietaire(async (c) => {
    await c.query("DELETE FROM jobs WHERE cabinet_id = ANY($1)", [cabinets]);
    await c.query(
      `UPDATE jobs SET statut = 'termine'
       WHERE statut = 'en_attente' AND execute_a <= $1 AND cabinet_id <> ALL($2)`,
      [iso(T0 + 365 * 86_400_000), cabinets],
    );
  });
}

/** `n` jobs prêts pour le cabinet, execute_a = début + i secondes ; identifiants dans l'ordre FIFO. */
async function inserer(cabinetId: string, n: number, debutMs: number): Promise<string[]> {
  return proprietaire(async (c) => {
    const r = await c.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a)
       SELECT $1, 'equite', '{}', $2::timestamptz + (g || ' seconds')::interval
       FROM generate_series(0, $3::int - 1) g
       RETURNING id, execute_a`,
      [cabinetId, iso(debutMs), n],
    );
    return r.rows
      .sort((x, y) => x.execute_a.getTime() - y.execute_a.getTime())
      .map((l) => l.id as string);
  });
}

interface Reserve {
  id: string;
  cabinet_id: string;
}

const reserver = async (maintenantMs: number): Promise<Reserve | undefined> =>
  ctx.db.withoutTenant(async (db) => {
    const r = await db.query("SELECT * FROM reserver_job_a($1)", [iso(maintenantMs)]);
    return r.rows[0] as Reserve | undefined;
  });

const terminer = (id: string) =>
  proprietaire((c) => c.query("UPDATE jobs SET statut = 'termine' WHERE id = $1", [id]));

describe("réservation équitable entre cabinets", () => {
  it("un cabinet avec 50 jobs anciens ne retarde pas le petit cabinet : son job sort dans les 2 premières réservations", async () => {
    await viderFile();
    await inserer(cabinets[0]!, 50, T0 - 3_600_000);
    const [petit] = await inserer(cabinets[1]!, 1, T0 - 1_000);
    const maintenant = T0 + 10_000;
    const premiers = [await reserver(maintenant), await reserver(maintenant)];
    expect(premiers.map((j) => j?.id)).toContain(petit);
    expect(premiers[0]?.cabinet_id).not.toBe(premiers[1]?.cabinet_id);
  });

  it("alterne entre cabinets (jobs laissés en cours) et quand les jobs se terminent", async () => {
    await viderFile();
    for (const c of cabinets) await inserer(c, 5, T0 - 60_000);
    const vus: string[] = [];
    for (let i = 0; i < 6; i++) vus.push((await reserver(T0 + i * 1_000))!.cabinet_id);
    // Chaque cabinet apparaît exactement deux fois sur les six premières réservations.
    for (const c of cabinets) expect(vus.filter((v) => v === c)).toHaveLength(2);
    expect(new Set(vus.slice(0, 3)).size).toBe(3);
    expect(new Set(vus.slice(3, 6)).size).toBe(3);

    // Jobs terminés au fil de l'eau : le tourniquet repose sur la date de dernière réservation.
    await viderFile();
    for (const c of cabinets) await inserer(c, 5, T0 - 60_000);
    const ordre: string[] = [];
    for (let i = 0; i < 9; i++) {
      const j = (await reserver(T0 + i * 1_000))!;
      ordre.push(j.cabinet_id);
      await terminer(j.id);
    }
    for (let i = 3; i < 9; i++) expect(ordre[i]).toBe(ordre[i - 3]);
    expect(new Set(ordre.slice(0, 3)).size).toBe(3);
  });

  it("conserve l'ordre FIFO (execute_a, id) au sein d'un cabinet", async () => {
    await viderFile();
    const ids = await inserer(cabinets[0]!, 6, T0 - 60_000);
    const sortis: string[] = [];
    for (let i = 0; i < 6; i++) {
      const j = (await reserver(T0))!;
      sortis.push(j.id);
      await terminer(j.id);
    }
    expect(sortis).toEqual(ids);
  });

  it("à execute_a égal, départage par identifiant", async () => {
    await viderFile();
    const ids = await proprietaire(async (c) => {
      const r = await c.query(
        `INSERT INTO jobs (cabinet_id, type, charge, execute_a)
         SELECT $1, 'equite', '{}', $2 FROM generate_series(1, 4) RETURNING id`,
        [cabinets[0], iso(T0 - 1_000)],
      );
      return r.rows.map((l) => l.id as string).sort();
    });
    const sortis: string[] = [];
    for (let i = 0; i < 4; i++) {
      const j = (await reserver(T0))!;
      sortis.push(j.id);
      await terminer(j.id);
    }
    expect(sortis).toEqual(ids);
  });

  it("ne réclame pas un job non encore échu, et le réclame une fois l'heure venue", async () => {
    await viderFile();
    const [futur] = await inserer(cabinets[0]!, 1, T0 + 60_000);
    expect(await reserver(T0)).toBeUndefined();
    expect(await reserver(T0 + 59_999)).toBeUndefined();
    expect((await reserver(T0 + 60_000))?.id).toBe(futur);
  });

  it("un cabinet dont le seul job n'est pas échu ne bloque pas les autres", async () => {
    await viderFile();
    await inserer(cabinets[0]!, 1, T0 + 3_600_000);
    const [pret] = await inserer(cabinets[1]!, 1, T0 - 1_000);
    expect((await reserver(T0))?.id).toBe(pret);
    expect(await reserver(T0)).toBeUndefined();
  });

  it("deux réclamations concurrentes ne prennent jamais le même job", async () => {
    await viderFile();
    await inserer(cabinets[0]!, 12, T0 - 60_000);
    await inserer(cabinets[1]!, 12, T0 - 60_000);
    await inserer(cabinets[2]!, 2, T0 - 60_000);
    const resultats = await Promise.all(Array.from({ length: 20 }, () => reserver(T0)));
    const ids = resultats.map((r) => r?.id).filter((id): id is string => id !== undefined);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    const r = await proprietaire((c) =>
      c.query(
        `SELECT count(*)::int AS n, max(tentatives) AS t FROM jobs
         WHERE cabinet_id = ANY($1) AND statut = 'en_cours'`,
        [cabinets],
      ),
    );
    expect(r.rows[0]).toEqual({ n: 20, t: 1 });
  });

  it("une file épuisée renvoie vide, sans erreur", async () => {
    await viderFile();
    expect(await reserver(T0)).toBeUndefined();
  });

  it("aucun cabinet n'est affamé : 30, 10 et 2 jobs, chacun servi dans les 3 premières réservations", async () => {
    await viderFile();
    await inserer(cabinets[0]!, 30, T0 - 3_600_000);
    await inserer(cabinets[1]!, 10, T0 - 1_800_000);
    await inserer(cabinets[2]!, 2, T0 - 10_000);
    const sortis: string[] = [];
    for (let i = 0; i < 12; i++) {
      const j = (await reserver(T0 + i * 1_000))!;
      sortis.push(j.cabinet_id);
      await terminer(j.id);
    }
    expect(new Set(sortis.slice(0, 3)).size).toBe(3);
    // Les deux jobs du petit cabinet sont sortis dans les 6 premières réservations.
    expect(sortis.slice(0, 6).filter((c) => c === cabinets[2])).toHaveLength(2);
  });

  it("les droits de la fonction sont inchangés : SECURITY DEFINER, exécutable par le rôle applicatif seul", async () => {
    const r = await proprietaire((c) =>
      c.query(
        `SELECT prosecdef, proconfig,
                has_function_privilege('missionpilot_app', oid, 'EXECUTE') AS app,
                has_function_privilege('public', oid, 'EXECUTE') AS public
         FROM pg_proc WHERE proname = 'reserver_job_a'`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ prosecdef: true, app: true, public: false });
    expect(r.rows[0].proconfig).toContain("search_path=public, pg_temp");
  });
});
