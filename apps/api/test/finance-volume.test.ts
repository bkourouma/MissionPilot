import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDatabase, type Database, type Db } from "../src/db/pool.js";
import {
  chargerMissions,
  chargerTarification,
  chargerTarifications,
} from "../src/finance/donnees.js";
import { aujourdhui } from "../src/missions/outils.js";
import { configTest, proprietaire, type Contexte } from "./helpers.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { acteur, feuilleValidee } from "./finance-outils.js";
import { missionTemps, type MissionTemps } from "./temps-outils.js";

/*
 * Volume des analyses financières (audit M3) : 300 missions signées (dont 20
 * clôturées le 2026-06-30), budget figé chacune, découpage (phase, tâche,
 * budget par grade), un jour validé chacune et un reste à faire déclaré sur
 * une sur deux. On relève la durée et le NOMBRE DE REQUÊTES SQL de la requête
 * HTTP, compté par un pool de test instrumenté : tarifications (versions,
 * lignes, grilles de vente) et suivis en jours (temps/suivi.ts
 * `calculerSuivisMissions`) sont chargés en lot ; le nombre de requêtes ne
 * dépend pas du nombre de missions pour l'encours, la rentabilité et les
 * indicateurs (au plus MAX_REQUETES).
 */

const N = 300;
const CLOTUREES = 20;
/** Requêtes SQL au plus par appel, quel que soit le nombre de missions. */
const MAX_REQUETES = 40;
let ctx: Contexte;
let c: CabinetFacturation;
let modele: MissionTemps;
let requetes = 0;

/** Compte chaque requête émise par un client de transaction (hors BEGIN/COMMIT du pool). */
function instrumenter(base: Database): Database {
  const compter =
    <T>(fn: (db: Db) => Promise<T>) =>
    async (client: Db): Promise<T> => {
      const origine = client.query;
      client.query = ((...args: Parameters<Db["query"]>) => {
        requetes++;
        return (origine as (...a: unknown[]) => unknown).apply(client, args);
      }) as Db["query"];
      try {
        return await fn(client);
      } finally {
        delete (client as { query?: unknown }).query;
      }
    };
  return {
    withTenant: (cabinetId, fn) => base.withTenant(cabinetId, compter(fn)),
    withoutTenant: (fn) => base.withoutTenant(compter(fn)),
    close: () => base.close(),
  };
}

/** Durée et nombre de requêtes d'un appel. */
async function mesurer<T>(fn: () => Promise<T>): Promise<{ r: T; ms: number; n: number }> {
  requetes = 0;
  const debut = performance.now();
  const r = await fn();
  return { r, ms: Math.round(performance.now() - debut), n: requetes };
}

beforeAll(async () => {
  const config = configTest();
  const db = instrumenter(createDatabase(config));
  const app = await buildApp(config, db);
  ctx = {
    config,
    db,
    app,
    fermer: async () => {
      await app.close();
      await db.close();
    },
  };
  c = await preparerFacturation(ctx, "Cabinet Volume Finance");
  modele = await missionTemps(
    c,
    { Diagnostic: { senior: 10, manager: 5 } },
    { intitule: "Modèle", debut: "2026-09-07", fin: "2026-11-27" },
  );
  attendre(
    200,
    await c.directeur.post(`/api/missions/${modele.id}/signer`, { date_signature: "2026-09-01" }),
    "signature",
  );
  await feuilleValidee({
    cabinetId: c.cabinetId,
    collaborateurId: c.collaborateurs.senior as string,
    semaine: "2026-09-07",
    importePar: c.associeId,
    lignes: ["2026-09-07", "2026-09-08"].map((date) => ({
      date,
      missionId: modele.id,
      tacheId: modele.taches.Diagnostic as string,
      jours: 1,
    })),
  });
  await proprietaire(async (cl) => {
    await cl.query("BEGIN");
    // Taux négocié du client (grille de vente lue en lot).
    await cl.query(
      `INSERT INTO taux_clients (cabinet_id, client_id, grade_id, taux, devise, valide_du)
       VALUES ($1, $2, $3, 180000, 'XOF', '2026-01-01')`,
      [c.cabinetId, c.clientId, c.grades.junior],
    );
    const copie = (statut: string, signature: string, cloture: string | null, nombre: number) =>
      cl.query(
        `INSERT INTO missions (cabinet_id, intitule, client_id, directeur_id, chef_id, date_debut,
           date_fin, devise, mode_facturation, statut, date_signature, signee_par, taux_change,
           devise_reference, cloturee_le, cloturee_par)
         SELECT m.cabinet_id, 'Volume ' || $2 || ' ' || lpad(g::text, 3, '0'), m.client_id,
           m.directeur_id, m.chef_id, m.date_debut, m.date_fin, m.devise, m.mode_facturation, $2,
           $3::date, m.signee_par, m.taux_change, m.devise_reference, $4::timestamptz,
           CASE WHEN $4::timestamptz IS NULL THEN NULL ELSE m.signee_par END
         FROM missions m, generate_series(1, $5::int) g WHERE m.id = $1`,
        [modele.id, statut, signature, cloture, nombre],
      );
    await copie("signee", "2026-09-01", null, N - 1 - CLOTUREES);
    await copie("cloturee", "2026-01-15", "2026-06-30T12:00:00Z", CLOTUREES);
    const clones = (
      await cl.query("SELECT id FROM missions WHERE cabinet_id = $1 AND intitule LIKE 'Volume %'", [
        c.cabinetId,
      ])
    ).rows.map((r) => r.id as string);
    await cl.query(
      `INSERT INTO budget_versions (cabinet_id, mission_id, numero, type, devise, figee)
       SELECT cabinet_id, id, 1, 'initial', devise, false FROM missions WHERE id = ANY ($1::uuid[])`,
      [clones],
    );
    await cl.query(
      `INSERT INTO budget_lignes (cabinet_id, mission_id, version_id, cle, libelle, nature, grade_code,
         jours, prix_journalier, montant_forfait, refacturable, ordre)
       SELECT v.cabinet_id, v.mission_id, v.id, l.cle, l.libelle, l.nature, l.grade_code, l.jours,
         l.prix_journalier, l.montant_forfait, l.refacturable, l.ordre
       FROM budget_versions v
       JOIN budget_lignes l ON l.mission_id = $2
         AND l.version_id = (SELECT id FROM budget_versions WHERE mission_id = $2 AND numero = 1)
       WHERE v.mission_id = ANY ($1::uuid[])`,
      [clones, modele.id],
    );
    await cl.query(
      `UPDATE budget_versions SET figee = true, date_figeage = '2026-09-01', validee_par = $2,
         validee_le = now()
       WHERE mission_id = ANY ($1::uuid[])`,
      [clones, c.associeId],
    );
    // Découpage de chaque clone : une phase, une tâche, budget senior 10 j et manager 5 j.
    await cl.query(
      `INSERT INTO mission_phases (cabinet_id, mission_id, libelle, ordre)
       SELECT cabinet_id, id, 'Diagnostic', 1 FROM missions WHERE id = ANY ($1::uuid[])`,
      [clones],
    );
    await cl.query(
      `INSERT INTO mission_taches (cabinet_id, mission_id, phase_id, libelle, ordre, duree_jours_ouvres)
       SELECT cabinet_id, mission_id, id, 'Diagnostic', 1, 60 FROM mission_phases
       WHERE mission_id = ANY ($1::uuid[])`,
      [clones],
    );
    await cl.query(
      `INSERT INTO tache_budget_lignes (cabinet_id, mission_id, tache_id, grade_id, jours)
       SELECT t.cabinet_id, t.mission_id, t.id, v.grade_id, v.jours
       FROM mission_taches t, (VALUES ($2::uuid, 10), ($3::uuid, 5)) AS v (grade_id, jours)
       WHERE t.mission_id = ANY ($1::uuid[])`,
      [clones, c.grades.senior, c.grades.manager],
    );
    // Un jour validé par clone (feuille importée du senior, semaine du 14/09) et un
    // reste à faire de 7 j déclaré sur les clones de numéro pair (les autres : estimé).
    const feuille = await cl.query(
      `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, semaine, origine, importee_par)
       VALUES ($1, $2, '2026-09-14', 'import', $3) RETURNING id`,
      [c.cabinetId, c.collaborateurs.senior, c.associeId],
    );
    await cl.query(
      `INSERT INTO lignes_temps (cabinet_id, feuille_id, date, mission_id, tache_id, centiemes)
       SELECT cabinet_id, $2, '2026-09-15', mission_id, id, 100 FROM mission_taches
       WHERE mission_id = ANY ($1::uuid[])`,
      [clones, feuille.rows[0].id],
    );
    await cl.query(
      "UPDATE feuilles_temps SET statut = 'validee', validee_le = now() WHERE id = $1",
      [feuille.rows[0].id],
    );
    await cl.query(
      `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id, semaine,
         centiemes, declare_par)
       SELECT t.cabinet_id, t.mission_id, t.id, $2, '2026-09-14', 700, $3
       FROM mission_taches t JOIN missions m ON m.id = t.mission_id
       WHERE t.mission_id = ANY ($1::uuid[]) AND right(m.intitule, 1) IN ('0', '2', '4', '6', '8')`,
      [clones, c.collaborateurs.senior, c.associeId],
    );
    await cl.query("COMMIT");
  });
}, 180_000);
afterAll(() => ctx.fermer());

describe(`analyses financières : volume de ${N} missions (audit M3)`, () => {
  it("tarifications en lot identiques au chargement mission par mission", async () => {
    await ctx.db.withTenant(c.cabinetId, async (db) => {
      const auth = acteur(c.cabinetId, c.associeId, "associe");
      const missions = await chargerMissions(db, auth);
      expect(missions).toHaveLength(N);
      const lot = await chargerTarifications(db, missions);
      const echantillon = [
        ...missions.filter((m) => m.id === modele.id),
        ...missions.slice(0, 5),
        ...missions.slice(-3),
      ];
      for (const m of echantillon) {
        const seule = await chargerTarification(db, m);
        const enLot = lot.get(m.id);
        expect(enLot?.reference?.id, m.intitule).toBe(seule.reference?.id);
        expect(enLot?.reference?.lignes, m.intitule).toEqual(seule.reference?.lignes);
        for (const grade of ["junior", "senior", "manager", "associe", null]) {
          const temps = {
            collaborateur_id: c.collaborateurs.senior as string,
            grade_code: grade,
            date: "2026-09-15",
          };
          expect(enLot?.vente(temps), `${m.intitule} ${grade}`).toEqual(seule.vente(temps));
          expect(enLot?.standard(grade), `${m.intitule} ${grade}`).toEqual(seule.standard(grade));
        }
      }
      // Le taux négocié du client est bien lu dans le lot.
      expect(
        lot
          .get(modele.id)
          ?.vente({ collaborateur_id: "x", grade_code: "junior", date: "2026-09-15" }),
      ).toEqual({ valeur: 180_000, devise: "XOF" });
    });
  });

  it("encours : requêtes en nombre constant, missions clôturées avant la date exclues", async () => {
    const jour = aujourdhui();
    await c.gestionnaire.get(`/api/finance/encours?date=${jour}`); // chauffe
    const { r, ms, n } = await mesurer(() =>
      c.gestionnaire.get(`/api/finance/encours?date=${jour}`),
    );
    console.info(`encours ${N} missions : ${ms} ms, ${n} requêtes`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().missions).toHaveLength(N - CLOTUREES);
    expect(n).toBeLessThanOrEqual(MAX_REQUETES);
    expect(ms).toBeLessThan(5_000);
    // Avant leur clôture (30/06), les missions clôturées sont encore en cours.
    const avant = (await c.gestionnaire.get("/api/finance/encours?date=2026-06-15")).json();
    expect(avant.missions).toHaveLength(CLOTUREES);
    // Clôturée le jour même : encore dans l'encours.
    const ce = (await c.gestionnaire.get("/api/finance/encours?date=2026-06-30")).json();
    expect(ce.missions).toHaveLength(CLOTUREES);
  });

  it("rentabilité : requêtes bornées, période au plus de 366 jours", async () => {
    const url = "/api/finance/rentabilite?niveau=mission&du=2026-01-01&au=2026-12-31";
    await c.gestionnaire.get(url);
    const { r, ms, n } = await mesurer(() => c.gestionnaire.get(url));
    console.info(`rentabilité ${N} missions : ${ms} ms, ${n} requêtes`);
    expect(r.statusCode, r.body).toBe(200);
    // Toutes les missions ont du temps validé : un suivi en jours chacune, lu en lot.
    const elements = r.json().elements as Record<string, unknown>[];
    expect(elements).toHaveLength(N);
    expect(elements.find((e) => e.cle === modele.id)).toMatchObject({
      budget: { jours: 15 },
      realise: { jours: 2 },
      atterrissage: { jours: 15 },
    });
    expect(n).toBeLessThanOrEqual(MAX_REQUETES);
    expect(ms).toBeLessThan(5_000);
    expect(
      (await c.gestionnaire.get("/api/finance/rentabilite?du=2025-01-01&au=2026-12-31")).statusCode,
    ).toBe(400);
  });

  it("indicateurs : requêtes en nombre constant (suivis en jours lus en lot)", async () => {
    const url = "/api/indicateurs/cabinet?du=2026-09-01&au=2026-09-30&niveau=mission";
    await c.gestionnaire.get(url);
    const { r, ms, n } = await mesurer(() => c.gestionnaire.get(url));
    console.info(`indicateurs ${N} missions : ${ms} ms, ${n} requêtes`);
    expect(r.statusCode, r.body).toBe(200);
    const elements = r.json().elements as Record<string, unknown>[];
    expect(elements).toHaveLength(N - CLOTUREES);
    // Reste à faire déclaré (1 + 7 j) et reste estimé (15 − 1 = 14 j, atterrissage 15 j).
    expect(elements.find((e) => e.intitule === "Volume signee 002")).toMatchObject({
      jours_budget: 15,
      jours_realises: 1,
      jours_atterrissage: 8,
    });
    expect(elements.find((e) => e.intitule === "Volume signee 001")).toMatchObject({
      jours_budget: 15,
      jours_realises: 1,
      jours_atterrissage: 15,
    });
    expect(n).toBeLessThanOrEqual(MAX_REQUETES);
    expect(ms).toBeLessThan(5_000);
  }, 60_000);

  it("autres niveaux (associé, client) : requêtes bornées de même", async () => {
    const indicateurs = await mesurer(() =>
      c.gestionnaire.get("/api/indicateurs/cabinet?du=2026-01-01&au=2026-12-31&niveau=associe"),
    );
    const rentabilite = await mesurer(() =>
      c.gestionnaire.get("/api/finance/rentabilite?niveau=client&du=2026-01-01&au=2026-12-31"),
    );
    console.info(
      `indicateurs (associé, ${N} missions) : ${indicateurs.ms} ms, ${indicateurs.n} requêtes ; ` +
        `rentabilité (client) : ${rentabilite.ms} ms, ${rentabilite.n} requêtes`,
    );
    expect(indicateurs.r.statusCode, indicateurs.r.body).toBe(200);
    expect(rentabilite.r.statusCode, rentabilite.r.body).toBe(200);
    expect(indicateurs.n).toBeLessThanOrEqual(MAX_REQUETES);
    expect(rentabilite.n).toBeLessThanOrEqual(MAX_REQUETES);
  }, 60_000);
});
