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

/**
 * `execute_a` est daté dans le passé : l'horloge de la base (conteneur) peut avancer de quelques
 * centaines de ms sur celle de Node, ce qui rendrait le job « futur » pour le worker.
 */
async function creerJob(): Promise<string> {
  return ctx.db.withTenant(a.cabinetId, async (db) => {
    const r = await db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, tentatives_max)
       VALUES ($1, 'reveil_test', '{}', now() - interval '10 seconds', 3) RETURNING id`,
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

/** Suit la fin réelle des cycles de la boucle (option `apresCycle` du worker). */
function suiviCycles() {
  const etat = { cycles: 0 };
  const apresCycle = () => {
    etat.cycles++;
  };
  const attendreCycles = async (n: number, delaiMax = 5_000) => {
    const debut = Date.now();
    while (etat.cycles < n && Date.now() - debut < delaiMax) await attendre(20);
    expect(etat.cycles).toBeGreaterThanOrEqual(n);
  };
  return { etat, apresCycle, attendreCycles };
}

function creerWorker(
  traites: string[],
  extra: { apresCycle?: () => void; delaiRattrapageMs?: number } = {},
) {
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
    ...extra,
  });
}

describe("réveil du worker (BUG-2026-10-23-008)", () => {
  it("traite en moins de 5 s un job créé puis signalé, malgré un grand intervalle", async () => {
    await viderAutres();
    const traites: string[] = [];
    const suivi = suiviCycles();
    const worker = creerWorker(traites, { apresCycle: suivi.apresCycle });
    worker.demarrer();
    await suivi.attendreCycles(1); // premier cycle (vide) terminé, prochain cycle dans 60 s
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

  it("rattrapage : un job validé 600 ms après le signal est quand même traité en moins de 5 s", async () => {
    await viderAutres();
    const traites: string[] = [];
    const suivi = suiviCycles();
    const worker = creerWorker(traites, { apresCycle: suivi.apresCycle, delaiRattrapageMs: 1_000 });
    worker.demarrer();
    await suivi.attendreCycles(1);
    const debut = Date.now();
    signalerJobCree(); // cycle de réveil à ~100 ms : vide, car le job n'est pas encore validé
    await attendre(600);
    const id = await creerJob(); // COMMIT tardif
    while ((await statut(id)) !== "termine" && Date.now() - debut < 5_000) await attendre(50);
    await worker.arreter();
    expect(await statut(id)).toBe("termine");
    expect(Date.now() - debut).toBeLessThan(5_000);
    expect(traites).toEqual([id]);
  });

  it("rattrapage unique : le cycle de rattrapage vide ne programme aucun autre cycle", async () => {
    await viderAutres();
    const suivi = suiviCycles();
    const worker = creerWorker([], { apresCycle: suivi.apresCycle, delaiRattrapageMs: 300 });
    worker.demarrer();
    await suivi.attendreCycles(1);
    signalerJobCree();
    await suivi.attendreCycles(3); // initial + réveil vide + rattrapage vide
    await attendre(1_200); // quatre fois le délai de rattrapage : aucune boucle
    await worker.arreter();
    expect(suivi.etat.cycles).toBe(3);
  });

  it("sans signal, rien ne tourne avant l'intervalle", async () => {
    await viderAutres();
    const traites: string[] = [];
    const suivi = suiviCycles();
    const worker = creerWorker(traites, { apresCycle: suivi.apresCycle });
    worker.demarrer();
    await suivi.attendreCycles(1);
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
    const suivi = suiviCycles();
    const worker = creerWorker(traites, { apresCycle: suivi.apresCycle });
    worker.demarrer();
    await suivi.attendreCycles(1);
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
