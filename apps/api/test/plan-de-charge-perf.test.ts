import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { missionPlanifiable } from "./planification-outils.js";

/*
 * Performance légère du plan de charge (PLN-06) : 100 collaborateurs ×
 * 26 semaines, 5 affectations et une absence validée chacun, en moins de 3 s.
 * Jeu de données généré en SQL (propriétaire, hors API) pour aller vite.
 */

let ctx: Contexte;
let c: CabinetMissions;

const COLLABORATEURS = 100;
const SEUIL_MS = 3000;

beforeAll(async () => {
  ctx = await demarrer();
  c = await preparerCabinet(ctx, "Cabinet Performance");
  const m = await missionPlanifiable(c);
  await proprietaire(async (db) => {
    await db.query(
      `INSERT INTO collaborateurs (cabinet_id, nom, grade_id, capacite_pct)
       SELECT $1, 'Perf ' || lpad(i::text, 3, '0'), $2, CASE WHEN i % 4 = 0 THEN 80 ELSE 100 END
       FROM generate_series(1, $3::int) i`,
      [c.cabinetId, c.grades.senior, COLLABORATEURS],
    );
    await db.query(
      `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, jours_alloues,
         date_debut, date_fin)
       SELECT $1, $2, $3, col.id, 10 + k * 2.5, date '2026-10-26' + k * 30, date '2026-10-26' + k * 30 + 75
       FROM collaborateurs col CROSS JOIN generate_series(0, 4) k
       WHERE col.cabinet_id = $1 AND col.nom LIKE 'Perf %'`,
      [c.cabinetId, m.id, m.tacheId],
    );
    await db.query(
      `INSERT INTO absences (cabinet_id, collaborateur_id, demandeur_id, type, date_debut, date_fin,
         statut, decide_par, decide_le)
       SELECT $1, col.id, $2, 'conge_paye', date '2026-12-21', date '2027-01-01', 'validee', $2, now()
       FROM collaborateurs col WHERE col.cabinet_id = $1 AND col.nom LIKE 'Perf %'`,
      [c.cabinetId, c.associeId],
    );
  });
});
afterAll(() => ctx.fermer());

describe("plan de charge : performance", () => {
  it(`${COLLABORATEURS} collaborateurs × 26 semaines en moins de ${SEUIL_MS} ms`, async () => {
    const url = "/api/plan-de-charge?debut=2026-11-02&fin=2027-05-02&type=interne&limite=100";
    await c.associe.get(url); // chauffe (compilation des requêtes, connexions)
    const debut = performance.now();
    const r = await c.associe.get(url);
    const duree = performance.now() - debut;
    expect(r.statusCode, r.body).toBe(200);
    const corps = r.json();
    expect(corps.semaines).toHaveLength(26);
    expect(corps.elements).toHaveLength(100);
    expect(corps.elements.every((l: { cellules: unknown[] }) => l.cellules.length === 26)).toBe(
      true,
    );
    console.info(`plan de charge 100 × 26 : ${Math.round(duree)} ms`);
    expect(duree, `${Math.round(duree)} ms`).toBeLessThan(SEUIL_MS);
  });
});
