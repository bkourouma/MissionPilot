import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErreurJobDefinitive as ErreurNeutre } from "../src/jobs/erreurs.js";
import { creerRegistre, ErreurJobDefinitive, REGISTRE_JOBS } from "../src/jobs/registre.js";
import { planificationsDeLaSemaine, planifierRecurrents } from "../src/jobs/planificateur.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { TYPE_JOB_SUIVI_KPI } from "../src/kpi/suivi.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import {
  relanceQuestionnaire,
  TYPE_JOB_RELANCE_QUESTIONNAIRE,
} from "../src/questionnaires/relances.js";
import { workerActif } from "../src/config.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerKpi } from "./kpi-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { consultantAffecte, missionTemps, saisirEtSoumettre } from "./temps-outils.js";

let ctx: Contexte;
let a: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Jobs A");
});
afterAll(() => ctx.fermer());

/** Horloge réglable : aucune dépendance à l'heure réelle. */
function horloge(iso: string) {
  let t = new Date(iso);
  return { lire: () => t, regler: (v: string) => (t = new Date(v)) };
}

async function insererJob(type: string, executeA: string, tentativesMax = 3): Promise<string> {
  return ctx.db.withTenant(a.cabinetId, async (db) => {
    const r = await db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, tentatives_max) VALUES ($1, $2, '{}', $3, $4)
       RETURNING id`,
      [a.cabinetId, type, executeA, tentativesMax],
    );
    return r.rows[0].id as string;
  });
}

const lireJob = (id: string) =>
  ctx.db.withTenant(
    a.cabinetId,
    async (db) => (await db.query("SELECT * FROM jobs WHERE id = $1", [id])).rows[0],
  );

describe("worker de la file de tâches (ADR-002)", () => {
  it("désactivé par défaut en test, activable par la configuration", () => {
    expect(workerActif({ NODE_ENV: "test" })).toBe(false);
    expect(workerActif({ NODE_ENV: "production" })).toBe(true);
    expect(workerActif({ NODE_ENV: "production", JOBS_WORKER: "inactif" })).toBe(false);
  });

  it("exécute dans le contexte RLS du cabinet du job, reprend sur échec puis abandonne", async () => {
    // Base partagée entre fichiers : les jobs en attente d'autres cabinets (relances de
    // questionnaires J+3/J+7…) seraient réservés par ce worker à registre réduit.
    await proprietaire((c) =>
      c.query(
        `UPDATE jobs SET statut = 'termine'
         WHERE statut = 'en_attente' AND cabinet_id <> $1 AND execute_a <= '2029-06-01T10:03:00Z'`,
        [a.cabinetId],
      ),
    );
    const h = horloge("2029-06-01T10:00:00Z");
    let appels = 0;
    const vus: unknown[] = [];
    const registre = creerRegistre({
      fragile: async ({ db, cabinetId }) => {
        appels++;
        const r = await db.query(
          "SELECT current_setting('app.cabinet_id') AS c, (SELECT count(*)::int FROM cabinets) AS n",
        );
        vus.push({ ...r.rows[0], attendu: cabinetId });
        if (appels === 1) throw new Error("Panne passagère");
      },
      toujours_ko: async () => {
        throw new Error("Toujours en panne");
      },
      definitif: async () => {
        throw new ErreurJobDefinitive("Charge invalide");
      },
    });
    const worker = new WorkerJobs(ctx.db, {
      mailer: new MailerJournal(),
      registre,
      horloge: h.lire,
      delaiReprise: () => 60_000,
    });
    const id = await insererJob("fragile", "2029-06-01T09:00:00Z");
    expect(await worker.traiterUn()).toMatchObject({
      id,
      statut: "reessai",
      erreur: "Panne passagère",
    });
    // Pas encore l'heure de la nouvelle tentative.
    expect(await worker.traiterUn()).toBeNull();
    h.regler("2029-06-01T10:01:00Z");
    expect(await worker.traiterUn()).toMatchObject({ id, statut: "termine" });
    expect(await lireJob(id)).toMatchObject({ statut: "termine", tentatives: 2, progression: 100 });
    expect(vus).toEqual([
      { c: a.cabinetId, n: 1, attendu: a.cabinetId },
      { c: a.cabinetId, n: 1, attendu: a.cabinetId },
    ]);

    const ko = await insererJob("toujours_ko", "2029-06-01T10:01:00Z", 2);
    expect((await worker.traiterUn())?.statut).toBe("reessai");
    h.regler("2029-06-01T10:03:00Z");
    expect((await worker.traiterUn())?.statut).toBe("echec");
    expect(await lireJob(ko)).toMatchObject({
      statut: "echec",
      tentatives: 2,
      erreur: "Toujours en panne",
    });

    const def = await insererJob("definitif", "2029-06-01T10:03:00Z");
    expect((await worker.traiterUn())?.statut).toBe("echec");
    const inconnu = await insererJob("inconnu", "2029-06-01T10:03:00Z");
    expect(await worker.traiterUn()).toMatchObject({ id: inconnu, statut: "echec" });
    expect((await lireJob(def)).tentatives).toBe(1);
  });

  it("libère un job resté « en_cours » au-delà du délai", async () => {
    const id = await insererJob("bloque", "2029-06-02T08:00:00Z");
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        "UPDATE jobs SET statut = 'en_cours', verrouille_le = '2029-06-02T08:00:00Z', tentatives = 1 WHERE id = $1",
        [id],
      ),
    );
    const n = await ctx.db.withoutTenant(
      async (db) =>
        (await db.query("SELECT liberer_jobs_bloques('2029-06-02T09:00:00Z', '15 minutes') AS n"))
          .rows[0].n,
    );
    expect(n).toBe(1);
    expect((await lireJob(id)).statut).toBe("en_attente");
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE jobs SET statut = 'termine' WHERE id = $1", [id]),
    );
  });
});

describe("registre et planification de production", () => {
  it("le registre inscrit les relances de questionnaires et le suivi des KPI", () => {
    expect(REGISTRE_JOBS.get(TYPE_JOB_RELANCE_QUESTIONNAIRE)).toBe(relanceQuestionnaire);
    expect(TYPE_JOB_SUIVI_KPI).toBe("kpi_suivi");
    expect(REGISTRE_JOBS.get(TYPE_JOB_SUIVI_KPI)).toEqual(expect.any(Function));
    // Une seule classe d'erreur définitive (module neutre, réexportée par le registre).
    expect(ErreurJobDefinitive).toBe(ErreurNeutre);
  });

  it("planifie le suivi quotidien des KPI (7 h UTC) une seule fois par cabinet et par jour", async () => {
    const m = await creerMission(a, { intitule: "Mission suivie par KPI" });
    await creerKpi(a.chef, m.id);
    const quand = new Date("2031-03-04T05:00:00Z");
    try {
      await planifierRecurrents(ctx.db, quand);
      await planifierRecurrents(ctx.db, quand);
      const jobs = await ctx.db.withTenant(
        a.cabinetId,
        async (db) =>
          (
            await db.query(
              "SELECT type, statut, execute_a, charge FROM jobs WHERE cle = 'kpi_suivi:2031-03-04'",
            )
          ).rows,
      );
      expect(jobs).toEqual([
        {
          type: "kpi_suivi",
          statut: "en_attente",
          execute_a: new Date("2031-03-04T07:00:00Z"),
          charge: { date: "2031-03-04" },
        },
      ]);
    } finally {
      // Base partagée entre fichiers : ces tâches de 2031 ne doivent pas s'exécuter ailleurs.
      await proprietaire((c) =>
        c.query(
          `UPDATE jobs SET statut = 'termine'
           WHERE execute_a >= '2031-03-01' AND execute_a < '2031-03-15' AND statut = 'en_attente'`,
        ),
      );
    }
  });

  it("reprise des relances de questionnaire en échec (0148) : propriétaire seul, jobs visés seulement", async () => {
    const inserer = (erreur: string) =>
      ctx.db.withTenant(a.cabinetId, async (db) => {
        const r = await db.query(
          `INSERT INTO jobs (cabinet_id, type, charge, execute_a, statut, tentatives, erreur)
           VALUES ($1, 'relance_questionnaire', '{}', '2029-01-01', 'echec', 1, $2) RETURNING id`,
          [a.cabinetId, erreur],
        );
        return r.rows[0].id as string;
      });
    const vise = await inserer("Type de job inconnu : relance_questionnaire");
    const autre = await inserer("Charge de relance de questionnaire invalide.");
    await expect(
      ctx.db.withoutTenant((db) => db.query("SELECT reprendre_relances_questionnaire()")),
    ).rejects.toMatchObject({ code: "42501" });
    const n = await proprietaire(
      async (c) => (await c.query("SELECT reprendre_relances_questionnaire() AS n")).rows[0].n,
    );
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await lireJob(vise)).toMatchObject({
      statut: "en_attente",
      tentatives: 0,
      erreur: null,
      verrouille_le: null,
    });
    expect(await lireJob(autre)).toMatchObject({ statut: "echec", tentatives: 1 });
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE jobs SET statut = 'termine' WHERE id = ANY($1::uuid[])", [[vise, autre]]),
    );
  });
});

describe("rappels de saisie (TPS-04)", () => {
  it("planifie le vendredi 16 h et le lundi suivant 8 h (UTC)", () => {
    expect(planificationsDeLaSemaine(new Date("2030-01-02T12:00:00Z"))).toEqual([
      expect.objectContaining({
        cle: "rappel_feuilles:2029-12-31",
        executeA: new Date("2030-01-04T16:00:00Z"),
      }),
      expect.objectContaining({
        cle: "relance_feuilles:2029-12-31",
        executeA: new Date("2030-01-07T08:00:00Z"),
      }),
    ]);
  });

  it("rappel du vendredi aux retardataires, relance du lundi au chef, jamais en double", async () => {
    const m = await missionTemps(
      a,
      { Diagnostic: { senior: 20 } },
      { debut: "2029-12-03", fin: "2030-03-29" },
    );
    const retardataire = await consultantAffecte(a, m, { Diagnostic: 5 });
    const ponctuel = await consultantAffecte(a, m, { Diagnostic: 5 });
    await saisirEtSoumettre(ponctuel, "2029-12-31", [
      { date: "2029-12-31", tache_id: m.taches.Diagnostic, jours: 1 },
    ]);
    const mailer = new MailerJournal();
    const h = horloge("2030-01-04T17:00:00Z");
    const worker = new WorkerJobs(ctx.db, { mailer, horloge: h.lire });
    const types = async (api: typeof retardataire | CabinetMissions["chef"]) =>
      ((await api.get("/api/notifications?limite=100")).json().elements as { type: string }[]).map(
        (n) => n.type,
      );

    await worker.cycle();
    expect((await types(retardataire)).filter((t) => t === "rappel_feuille_temps")).toHaveLength(1);
    expect(await types(ponctuel)).not.toContain("rappel_feuille_temps");
    expect(mailer.boite.some((e) => e.sujet.includes("feuille de temps"))).toBe(true);
    // Le lundi n'est pas encore arrivé : pas de relance.
    expect(await types(a.chef)).not.toContain("relance_feuilles_temps");

    // Second passage et job dupliqué à la main : aucun doublon de rappel.
    await worker.cycle();
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        `INSERT INTO jobs (cabinet_id, type, charge, execute_a) VALUES ($1, 'rappel_feuilles', '{"semaine":"2029-12-31"}', '2030-01-04T16:00:00Z')`,
        [a.cabinetId],
      ),
    );
    await worker.cycle();
    expect((await types(retardataire)).filter((t) => t === "rappel_feuille_temps")).toHaveLength(1);

    h.regler("2030-01-07T09:00:00Z");
    await worker.cycle();
    await worker.cycle();
    const relances = (
      (await a.chef.get("/api/notifications?limite=100")).json().elements as {
        type: string;
        corps: string;
      }[]
    ).filter((n) => n.type === "relance_feuilles_temps");
    expect(relances).toHaveLength(1);
    expect(relances[0]?.corps).toMatch(/2029-12-31/);
    const jobs = await ctx.db.withTenant(
      a.cabinetId,
      async (db) =>
        (await db.query("SELECT cle, statut FROM jobs WHERE cle IS NOT NULL ORDER BY cle")).rows,
    );
    expect(jobs).toEqual(
      expect.arrayContaining([
        { cle: "rappel_feuilles:2029-12-31", statut: "termine" },
        { cle: "relance_feuilles:2029-12-31", statut: "termine" },
      ]),
    );
  });
});
