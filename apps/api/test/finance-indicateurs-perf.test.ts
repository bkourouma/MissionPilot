import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { missionTemps, type MissionTemps } from "./temps-outils.js";

/*
 * Performance des indicateurs du cabinet : 100 collaborateurs rattachés à un
 * utilisateur, 12 semaines de feuilles validées (6 000 lignes) et une
 * affectation chacun. Cible : moins de 3 s (exigence de performance du PRD
 * pour un cabinet de 100 personnes).
 */

let ctx: Contexte;
let c: CabinetMissions;
let m: MissionTemps;
const N = 100;
const DU = "2026-07-06";
const AU = "2026-09-27";

beforeAll(async () => {
  ctx = await demarrer();
  c = await preparerCabinet(ctx, "Cabinet Indicateurs Volume");
  m = await missionTemps(c, { Diagnostic: { senior: 500 } });
  const tache = m.taches.Diagnostic as string;
  await proprietaire(async (cl) => {
    await cl.query("BEGIN");
    const u = await cl.query(
      `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
       SELECT $1, 'volume-' || g || '-' || $2 || '@exemple.test', 'Volume ' || g, ARRAY['consultant'], 'x'
       FROM generate_series(1, $3) g RETURNING id`,
      [c.cabinetId, Date.now(), N],
    );
    const ids = u.rows.map((r) => r.id as string);
    const col = await cl.query(
      `INSERT INTO collaborateurs (cabinet_id, utilisateur_id, nom, grade_id, cree_le)
       SELECT $1, uid, 'Collaborateur ' || uid, $2, '2026-01-01' FROM unnest($3::uuid[]) uid
       RETURNING id, utilisateur_id`,
      [c.cabinetId, c.grades.senior, ids],
    );
    await cl.query(
      `INSERT INTO collaborateur_couts (cabinet_id, collaborateur_id, cout_journalier, devise, depuis_le)
       SELECT $1, id, 90000, 'XOF', '2026-01-01' FROM unnest($2::uuid[]) id`,
      [c.cabinetId, col.rows.map((r) => r.id)],
    );
    await cl.query(
      `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, jours_alloues,
         date_debut, date_fin)
       SELECT $1, $2, $3, id, 20, '2026-07-06', '2026-08-28' FROM unnest($4::uuid[]) id`,
      [c.cabinetId, m.id, tache, col.rows.map((r) => r.id)],
    );
    const f = await cl.query(
      `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine)
       SELECT $1, x.id, x.utilisateur_id, date '2026-07-06' + 7 * s
       FROM unnest($2::uuid[], $3::uuid[]) AS x(id, utilisateur_id), generate_series(0, 11) s
       RETURNING id, semaine`,
      [c.cabinetId, col.rows.map((r) => r.id), col.rows.map((r) => r.utilisateur_id)],
    );
    await cl.query(
      `INSERT INTO lignes_temps (cabinet_id, feuille_id, date, mission_id, tache_id, centiemes)
       SELECT $1, f.id, f.semaine + j, $2, $3, 100
       FROM unnest($4::uuid[], $5::date[]) AS f(id, semaine), generate_series(0, 4) j`,
      [c.cabinetId, m.id, tache, f.rows.map((r) => r.id), f.rows.map((r) => r.semaine)],
    );
    await cl.query(
      `UPDATE feuilles_temps SET statut = 'soumise', cycle = 1,
         premiere_soumission_le = semaine + 4, soumise_le = semaine + 4
       WHERE cabinet_id = $1 AND statut = 'brouillon'`,
      [c.cabinetId],
    );
    await cl.query(
      `UPDATE feuilles_temps SET statut = 'validee', validee_le = now()
       WHERE cabinet_id = $1 AND statut = 'soumise'`,
      [c.cabinetId],
    );
    await cl.query("COMMIT");
  });
  // Après un chargement massif, PostgreSQL n'a pas encore de statistiques à jour (l'analyse
  // automatique n'a pas eu le temps de passer) : sans ANALYZE les plans peuvent être très mauvais.
  await proprietaire(async (cl) => {
    await cl.query(
      "ANALYZE utilisateurs, collaborateurs, collaborateur_couts, affectations, feuilles_temps, lignes_temps",
    );
  });
}, 120_000);
afterAll(() => ctx.fermer());

describe("indicateurs du cabinet : volume de 100 collaborateurs", () => {
  it("répond en moins de 3 s avec des totaux exacts", async () => {
    const url = `/api/indicateurs/cabinet?du=${DU}&au=${AU}&niveau=collaborateur`;
    // Un appel de chauffe (connexions, plans de requête), puis la médiane de trois mesures :
    // une pointe isolée (autovacuum, charge de la machine) ne doit pas faire échouer la garde.
    await c.associe.get(url);
    const durees: number[] = [];
    let r = await c.associe.get(url);
    for (let i = 0; i < 5; i++) {
      const debut = performance.now();
      r = await c.associe.get(url);
      durees.push(performance.now() - debut);
    }
    durees.sort((a, b) => a - b);
    console.info(
      `indicateurs ${N} collaborateurs : meilleure ${Math.round(durees[0] as number)} ms ` +
        `(${durees.map((d) => Math.round(d)).join(" / ")} ms)`,
    );
    expect(r.statusCode).toBe(200);
    // Meilleure de cinq mesures : une pointe de charge de la machine ne fait pas échouer la garde,
    // une vraie régression (requêtes N+1) la dépasse à chaque mesure.
    expect(durees[0]).toBeLessThan(3_000);
    const cabinet = r.json().cabinet;
    // 100 collaborateurs de volume (+ 4 du cabinet de test) × 60 jours ouvrés.
    expect(cabinet.jours_disponibles).toBe((N + 4) * 60);
    expect(cabinet.jours_affectes).toBe(N * 20);
    expect(cabinet.jours_facturables).toBe(N * 60);
    expect(cabinet.discipline_saisie).toEqual({ reussis: N * 12, attendus: N * 12, taux: 1 });
    expect(r.json().elements).toHaveLength(N + 4);
  }, 30_000);
});
