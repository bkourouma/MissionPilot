import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  creerHandlerPurgeRapports,
  planificationPurgeRapports,
  planifierPurgeRapports,
  TYPE_JOB_PURGE_RAPPORTS,
} from "../src/rapports/purge.js";
import { stockageDe } from "../src/stockage/index.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Conservation des rapports générés (migration 0132) : purge des fichiers au
 * delà de la durée du cabinet (job « purge_rapports », horloge injectée),
 * ligne de rapport conservée (ajout seul), planification quotidienne par
 * cabinet concerné seulement.
 */

const JOUR = 24 * 3600_000;
let ctx: Contexte & { dossier: string };
let a: CabinetMissions;
let b: CabinetMissions;
let missionA: string;

interface RapportCree {
  rapport: { id: string };
  fichier: { id: string };
}

async function generer(c: CabinetMissions, missionId: string): Promise<RapportCree> {
  const r = await c.chef.post(`/api/missions/${missionId}/rapports?format=docx`);
  attendre(201, r, "rapport");
  return r.json();
}

const purger = (cabinetId: string, maintenant: Date) =>
  ctx.db.withTenant(cabinetId, (db) =>
    creerHandlerPurgeRapports(() => stockageDe(ctx.config))({
      db,
      cabinetId,
      jobId: "test",
      charge: {},
      maintenant,
    }),
  );

const cle = (fichierId: string) =>
  proprietaire(
    async (c) =>
      (await c.query("SELECT cle_stockage FROM fichiers WHERE id = $1", [fichierId])).rows[0]
        .cle_stockage as string,
  );

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerCabinet(ctx, "Cabinet Purge Rapports A");
  b = await preparerCabinet(ctx, "Cabinet Purge Rapports B");
  missionA = (await creerMission(a)).id;
}, 120_000);
afterAll(() => ctx.fermer());

describe("purge des rapports au-delà de la durée de conservation", () => {
  it("durée par défaut (1 095 jours) : rien avant, fichier purgé après ; la ligne reste", async () => {
    const r = await generer(a, missionA);
    const cleStockage = await cle(r.fichier.id);
    await purger(a.cabinetId, new Date(Date.now() + 1094 * JOUR));
    expect((await a.chef.get(`/api/fichiers/${r.fichier.id}`)).statusCode).toBe(200);

    await purger(a.cabinetId, new Date(Date.now() + 1096 * JOUR));
    expect((await a.chef.get(`/api/fichiers/${r.fichier.id}`)).statusCode).toBe(404);
    const liste = (await a.chef.get(`/api/missions/${missionA}/rapports`)).json();
    expect(liste.elements.map((e: { id: string }) => e.id)).not.toContain(r.rapport.id);
    const etat = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT s.motif, (SELECT count(*)::int FROM rapports_mission WHERE id = $2) AS lignes
             FROM fichiers_suppressions s WHERE s.fichier_id = $1`,
            [r.fichier.id, r.rapport.id],
          )
        ).rows[0],
    );
    expect(etat).toEqual({ motif: "conservation", lignes: 1 });
    await expect(stockageDe(ctx.config).lire(a.cabinetId, cleStockage)).rejects.toThrow();
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT details FROM journal_audit WHERE cabinet_id = $1 AND action = 'purge_rapports'`,
            [a.cabinetId],
          )
        ).rows,
    );
    expect(journal).toHaveLength(1);
    expect(journal[0].details).toMatchObject({ nombre: 1, conservation_jours: 1095 });
    // Une seconde purge ne trouve plus rien (aucune nouvelle ligne de journal).
    await purger(a.cabinetId, new Date(Date.now() + 1200 * JOUR));
    const n = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM journal_audit
             WHERE cabinet_id = $1 AND action = 'purge_rapports'`,
            [a.cabinetId],
          )
        ).rows[0].n,
    );
    expect(n).toBe(1);
  });

  it("durée du cabinet (90 jours) ; un autre cabinet n'est pas touché", async () => {
    attendre(
      200,
      await a.associe.put("/api/rapports/parametres", {
        conservation_jours: 90,
        mention_ia_active: true,
        mention_ia: null,
        // Raccourcir la durée de conservation (défaut : 1 095 jours) exige la reconfirmation.
        confirmation: { mot_de_passe: MOT_DE_PASSE_TEST },
      }),
      "paramètres",
    );
    const ra = await generer(a, missionA);
    const missionB = (await creerMission(b)).id;
    const rb = await generer(b, missionB);
    const plus91 = new Date(Date.now() + 91 * JOUR);
    await purger(a.cabinetId, new Date(Date.now() + 89 * JOUR));
    expect((await a.chef.get(`/api/fichiers/${ra.fichier.id}`)).statusCode).toBe(200);
    await purger(a.cabinetId, plus91);
    expect((await a.chef.get(`/api/fichiers/${ra.fichier.id}`)).statusCode).toBe(404);
    // Cabinet B : durée par défaut, et le job de A ne voit pas ses rapports (RLS).
    expect((await b.chef.get(`/api/fichiers/${rb.fichier.id}`)).statusCode).toBe(200);
    await purger(b.cabinetId, plus91);
    expect((await b.chef.get(`/api/fichiers/${rb.fichier.id}`)).statusCode).toBe(200);
  });

  it("la ligne de rapport reste en ajout seul pour le rôle applicatif", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM rapports_mission")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM rapports_parametres")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("planification quotidienne", () => {
  it("une clé par jour et par cabinet concerné ; idempotente ; clé invalide refusée", async () => {
    const maintenant = new Date(Date.now() + 2000 * JOUR);
    const p = planificationPurgeRapports(maintenant);
    expect(p.cle).toBe(`purge_rapports:${maintenant.toISOString().slice(0, 10)}`);
    expect(p.executeA.toISOString()).toBe(`${maintenant.toISOString().slice(0, 10)}T02:00:00.000Z`);
    const nb = await ctx.db.withoutTenant((db) => planifierPurgeRapports(db, maintenant));
    expect(nb).toBeGreaterThanOrEqual(1);
    expect(await ctx.db.withoutTenant((db) => planifierPurgeRapports(db, maintenant))).toBe(0);
    const jobs = await proprietaire(
      async (c) =>
        (await c.query("SELECT cabinet_id, type FROM jobs WHERE cle = $1", [p.cle])).rows as {
          cabinet_id: string;
          type: string;
        }[],
    );
    // B garde un rapport non purgé (durée par défaut dépassée à +2 000 jours) ; tous ceux de A
    // sont déjà purgés : aucun job pour A.
    expect(jobs.every((j) => j.type === TYPE_JOB_PURGE_RAPPORTS)).toBe(true);
    expect(jobs.filter((j) => j.cabinet_id === b.cabinetId)).toHaveLength(1);
    expect(jobs.some((j) => j.cabinet_id === a.cabinetId)).toBe(false);
    // Aujourd'hui : aucun rapport assez ancien, aucun job pour ces cabinets.
    const auj = planificationPurgeRapports(new Date());
    await ctx.db.withoutTenant((db) => planifierPurgeRapports(db, new Date()));
    const aujourdhui = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM jobs WHERE cle = $1 AND cabinet_id = ANY ($2)",
            [auj.cle, [a.cabinetId, b.cabinetId]],
          )
        ).rows[0].n,
    );
    expect(aujourdhui).toBe(0);
    await expect(
      ctx.db.withoutTenant((db) =>
        db.query("SELECT planifier_purge_rapports('autre', now(), now())"),
      ),
    ).rejects.toThrow(/Clé de purge invalide/);
    await proprietaire((c) => c.query("DELETE FROM jobs WHERE cle = $1", [p.cle]));
  });
});
