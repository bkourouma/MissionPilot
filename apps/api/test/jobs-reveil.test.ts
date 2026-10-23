import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerRegistre } from "../src/jobs/registre.js";
import { ecouterJobCree, signalerJobCree } from "../src/jobs/reveil.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Jobs Réveil");
});
afterAll(() => ctx.fermer());

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Écarte les jobs en attente d'autres suites : le registre réduit les marquerait en échec. */
async function viderAutres(): Promise<void> {
  await proprietaire((c) =>
    c.query(
      `UPDATE jobs SET statut = 'termine'
       WHERE statut = 'en_attente' AND cabinet_id <> $1 AND execute_a <= now() + interval '1 day'`,
      [a.cabinetId],
    ),
  );
}

async function creerJob(): Promise<string> {
  return ctx.db.withTenant(a.cabinetId, async (db) => {
    const r = await db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, tentatives_max)
       VALUES ($1, 'reveil_test', '{}', now(), 3) RETURNING id`,
      [a.cabinetId],
    );
    return r.rows[0].id as string;
  });
}

const statut = (id: string) =>
  ctx.db.withTenant(
    a.cabinetId,
    async (db) => (await db.query("SELECT statut FROM jobs WHERE id = $1", [id])).rows[0].statut,
  );

function creerWorker(traites: string[]) {
  const registre = creerRegistre({
    reveil_test: async ({ jobId }) => {
      traites.push(jobId);
    },
  });
  return new WorkerJobs(ctx.db, {
    mailer: new MailerJournal(),
    registre,
    intervalleMs: 60_000,
    delaiReveilMs: 100,
    delaiEnchainementMs: 100,
  });
}

describe("réveil du worker (BUG-2026-10-23-008)", () => {
  it("traite en moins de 5 s un job créé puis signalé, malgré un grand intervalle", async () => {
    await viderAutres();
    const traites: string[] = [];
    const worker = creerWorker(traites);
    worker.demarrer();
    await attendre(500); // premier cycle (vide) terminé, prochain cycle dans 60 s
    const id = await creerJob();
    const debut = Date.now();
    signalerJobCree();
    signalerJobCree(); // signaux rapprochés : un seul cycle
    while ((await statut(id)) !== "termine" && Date.now() - debut < 5_000) await attendre(50);
    await worker.arreter();
    expect(await statut(id)).toBe("termine");
    expect(Date.now() - debut).toBeLessThan(5_000);
    expect(traites).toEqual([id]);
  });

  it("sans signal, rien ne tourne avant l'intervalle", async () => {
    await viderAutres();
    const traites: string[] = [];
    const worker = creerWorker(traites);
    worker.demarrer();
    await attendre(500);
    const id = await creerJob();
    await attendre(800);
    await worker.arreter();
    expect(await statut(id)).toBe("en_attente");
    expect(traites).toEqual([]);
    await proprietaire((c) => c.query("UPDATE jobs SET statut = 'termine' WHERE id = $1", [id]));
  });

  it("arrêt propre : désabonné, plus aucune minuterie, signal sans effet", async () => {
    await viderAutres();
    const traites: string[] = [];
    const worker = creerWorker(traites);
    worker.demarrer();
    await attendre(500);
    signalerJobCree(); // minuterie de réveil en attente
    await worker.arreter();
    const id = await creerJob();
    signalerJobCree();
    await attendre(600);
    expect(await statut(id)).toBe("en_attente");
    expect(traites).toEqual([]);
    await proprietaire((c) => c.query("UPDATE jobs SET statut = 'termine' WHERE id = $1", [id]));
  });

  it("le désabonnement d'un écouteur est effectif et une erreur d'écouteur est isolée", () => {
    let appels = 0;
    const stop = ecouterJobCree(() => {
      appels++;
    });
    const stopErreur = ecouterJobCree(() => {
      throw new Error("écouteur défaillant");
    });
    expect(() => signalerJobCree()).not.toThrow();
    stop();
    stopErreur();
    signalerJobCree();
    expect(appels).toBe(1);
  });
});
