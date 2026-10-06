import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calculerSuiviMission,
  calculerSuivisMissions,
  type SuiviMission,
} from "../src/temps/suivi.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { feuilleValidee } from "./finance-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";
import { suiviMissionReference } from "./suivi-reference.js";
import { missionTemps, type MissionTemps } from "./temps-outils.js";

/*
 * ÉQUIVALENCE du suivi en lot (temps/suivi.ts `calculerSuivisMissions`) avec
 * l'ancienne lecture mission par mission, conservée telle quelle dans
 * test/suivi-reference.ts. Jeu varié : plusieurs grades et un collaborateur
 * sans grade, un externe, budget par grade et nominatif, lots et tâches
 * livrables, jalons, temps validés, corrections validées (positive et
 * négative) et demandée (ignorée), temps soumis (en attente), restes à faire
 * déclarés (dont une redéclaration) et estimés, mission sans temps, mission
 * clôturée, mission sans découpage et identifiant inconnu. Les indicateurs du
 * cabinet et la rentabilité reprennent les jours de la référence.
 */

let ctx: Contexte;
let c: CabinetFacturation;
let alpha: MissionTemps;
let beta: MissionTemps;
let gamma: MissionTemps;
let vide: string;
let ids: string[];
const S1 = "2026-11-02";
const S2 = "2026-11-09";
const S3 = "2026-11-16";

beforeAll(async () => {
  ctx = await demarrer();
  c = await preparerFacturation(ctx, "Cabinet Suivi Lot");
  alpha = await missionTemps(
    c,
    {
      Diagnostic: { senior: 10, manager: 5 },
      Analyse: { senior: 6, junior: 3 },
      Restitution: { manager: 3, associe: 2 },
    },
    { intitule: "Alpha" },
  );
  beta = await missionTemps(c, { Cadrage: { senior: 4, manager: 2 } }, { intitule: "Bêta" });
  gamma = await missionTemps(c, { Revue: { junior: 5, senior: 2 } }, { intitule: "Gamma" });
  vide = (
    await creerMission(c, {
      intitule: "Sans découpage",
      type_mission_id: null,
      mode_facturation: "forfait",
    })
  ).id;
  for (const m of [alpha, beta, gamma]) {
    attendre(
      200,
      await c.directeur.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-09-01" }),
      "signature",
    );
  }
  const saisie = await utilisateurCollaborateur(c, ["consultant"], "manager");
  const col = c.collaborateurs as Record<string, string>;

  const { sansGrade, externe, lotTaches } = await proprietaire(async (cl) => {
    await cl.query("BEGIN");
    const sg = await cl.query(
      `INSERT INTO collaborateurs (cabinet_id, nom, grade_id) VALUES ($1, 'Zoé sans grade', NULL)
       RETURNING id`,
      [c.cabinetId],
    );
    const ex = await cl.query(
      `INSERT INTO collaborateurs (cabinet_id, nom, grade_id, type)
       VALUES ($1, 'Expert externe', $2, 'externe') RETURNING id`,
      [c.cabinetId, c.grades.manager],
    );
    // Lot livrable dans la phase « Analyse », avec deux tâches (une livrable).
    const phase = await cl.query("SELECT phase_id FROM mission_taches WHERE id = $1", [
      alpha.taches.Analyse,
    ]);
    const lot = await cl.query(
      `INSERT INTO mission_lots (cabinet_id, mission_id, phase_id, libelle, ordre, est_livrable)
       VALUES ($1, $2, $3, 'Lot entretiens', 1, true) RETURNING id`,
      [c.cabinetId, alpha.id, phase.rows[0].phase_id],
    );
    const taches: string[] = [];
    for (const [libelle, livrable] of [
      ["Entretiens", true],
      ["Synthèse", false],
    ] as const) {
      const t = await cl.query(
        `INSERT INTO mission_taches (cabinet_id, mission_id, phase_id, lot_id, libelle, ordre,
           est_livrable, duree_jours_ouvres)
         VALUES ($1, $2, $3, $4, $5, 1, $6, 10) RETURNING id`,
        [c.cabinetId, alpha.id, phase.rows[0].phase_id, lot.rows[0].id, libelle, livrable],
      );
      taches.push(t.rows[0].id as string);
    }
    await cl.query("UPDATE mission_taches SET est_livrable = true WHERE id = ANY ($1::uuid[])", [
      [alpha.taches.Diagnostic, alpha.taches.Restitution],
    ]);
    // Budget nominatif (collaborateur) et par grade sur les tâches du lot.
    await cl.query(
      `INSERT INTO tache_budget_lignes (cabinet_id, mission_id, tache_id, grade_id, collaborateur_id, jours)
       VALUES ($1, $2, $3, NULL, $4, 4), ($1, $2, $3, $5, NULL, 1.5),
              ($1, $2, $6, NULL, $7, 2.25), ($1, $2, $6, NULL, $8, 3)`,
      [
        c.cabinetId,
        alpha.id,
        taches[0],
        col.senior,
        c.grades.junior,
        taches[1],
        sg.rows[0].id,
        ex.rows[0].id,
      ],
    );
    // Jalons : un atteint, un non atteint (Alpha) ; un atteint (Gamma).
    await cl.query(
      `INSERT INTO mission_jalons (cabinet_id, mission_id, phase_id, libelle, date_prevue, atteint, ordre)
       VALUES ($1, $2, $3, 'Rapport d''étape', '2026-11-20', true, 1),
              ($1, $2, $3, 'Rapport final', '2027-01-15', false, 2)`,
      [c.cabinetId, alpha.id, phase.rows[0].phase_id],
    );
    const phaseGamma = await cl.query("SELECT phase_id FROM mission_taches WHERE id = $1", [
      gamma.taches.Revue,
    ]);
    await cl.query(
      `INSERT INTO mission_jalons (cabinet_id, mission_id, phase_id, libelle, date_prevue, atteint, ordre)
       VALUES ($1, $2, $3, 'Revue faite', '2026-11-13', true, 1)`,
      [c.cabinetId, gamma.id, phaseGamma.rows[0].phase_id],
    );
    await cl.query("COMMIT");
    return {
      sansGrade: sg.rows[0].id as string,
      externe: ex.rows[0].id as string,
      lotTaches: taches,
    };
  });

  const ligne = (m: MissionTemps | string, tacheId: string, date: string, jours: number) => ({
    date,
    missionId: typeof m === "string" ? m : m.id,
    tacheId,
    jours,
  });
  const valider = (collaborateurId: string, semaine: string, lignes: ReturnType<typeof ligne>[]) =>
    feuilleValidee({
      cabinetId: c.cabinetId,
      collaborateurId,
      semaine,
      importePar: c.associeId,
      lignes,
    });
  const [diag, analyse, restit] = [
    alpha.taches.Diagnostic,
    alpha.taches.Analyse,
    alpha.taches.Restitution,
  ] as [string, string, string];
  const [entretiens, synthese] = lotTaches as [string, string];
  await valider(col.senior as string, S1, [
    ligne(alpha, diag, "2026-11-02", 1),
    ligne(alpha, diag, "2026-11-03", 1),
    ligne(alpha, analyse, "2026-11-04", 0.5),
    ligne(alpha, entretiens, "2026-11-05", 1),
    ligne(gamma, gamma.taches.Revue as string, "2026-11-06", 1),
  ]);
  await valider(col.senior as string, S2, [
    ligne(alpha, diag, "2026-11-09", 1),
    ligne(alpha, entretiens, "2026-11-10", 1),
  ]);
  await valider(col.manager as string, S1, [
    ligne(alpha, diag, "2026-11-02", 0.5),
    ligne(alpha, restit, "2026-11-03", 1),
  ]);
  await valider(col.junior as string, S1, [
    ligne(alpha, analyse, "2026-11-02", 1),
    ligne(gamma, gamma.taches.Revue as string, "2026-11-03", 1),
    ligne(gamma, gamma.taches.Revue as string, "2026-11-04", 1),
  ]);
  await valider(sansGrade, S2, [ligne(alpha, synthese, "2026-11-11", 0.75)]);
  await valider(externe, S2, [ligne(alpha, synthese, "2026-11-12", 2)]);

  await proprietaire(async (cl) => {
    await cl.query("BEGIN");
    // Feuille soumise (en attente de validation).
    const f = await cl.query(
      `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [c.cabinetId, saisie.collaborateurId, saisie.utilisateurId, S3],
    );
    for (const [tache, date, centiemes] of [
      [diag, "2026-11-16", 100],
      [restit, "2026-11-17", 50],
      [entretiens, "2026-11-18", 100],
    ] as const) {
      await cl.query(
        `INSERT INTO lignes_temps (cabinet_id, feuille_id, date, mission_id, tache_id, centiemes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.cabinetId, f.rows[0].id, date, alpha.id, tache, centiemes],
      );
    }
    await cl.query(
      `UPDATE feuilles_temps SET statut = 'soumise', cycle = 1, premiere_soumission_le = now(),
         soumise_le = now() WHERE id = $1`,
      [f.rows[0].id],
    );
    // Corrections : deux validées (+0,5 et −1), une demandée (ignorée).
    const correction = (
      collaborateurId: string,
      date: string,
      missionId: string,
      tache: string,
      ancienne: number,
      nouvelle: number,
      statut: "validee" | "demandee",
    ) =>
      cl.query(
        `INSERT INTO corrections_temps (cabinet_id, collaborateur_id, date, mission_id, tache_id,
           ancienne_centiemes, nouvelle_centiemes, motif, statut, demandee_par, decidee_par, decidee_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Correction de test', $8, $9, $10, $11)`,
        [
          c.cabinetId,
          collaborateurId,
          date,
          missionId,
          tache,
          ancienne,
          nouvelle,
          statut,
          c.chef.utilisateurId,
          statut === "validee" ? c.associeId : null,
          statut === "validee" ? new Date().toISOString() : null,
        ],
      );
    await correction(col.senior as string, "2026-11-04", alpha.id, analyse, 50, 100, "validee");
    await correction(
      col.junior as string,
      "2026-11-03",
      gamma.id,
      gamma.taches.Revue as string,
      100,
      0,
      "validee",
    );
    await correction(col.manager as string, "2026-11-03", alpha.id, restit, 100, 300, "demandee");
    // Restes à faire : redéclaration (la dernière fait foi), zéro sur une tâche
    // livrable réalisée (atteinte), un collaborateur sans grade.
    const reste = (
      missionId: string,
      tache: string,
      collaborateurId: string,
      semaine: string,
      centiemes: number,
    ) =>
      cl.query(
        `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id, semaine,
           centiemes, declare_par) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [c.cabinetId, missionId, tache, collaborateurId, semaine, centiemes, c.chef.utilisateurId],
      );
    await reste(alpha.id, diag, col.senior as string, S1, 600);
    await reste(alpha.id, diag, col.senior as string, S2, 450);
    await reste(alpha.id, diag, col.manager as string, S1, 200);
    await reste(alpha.id, entretiens, col.senior as string, S2, 0);
    await reste(alpha.id, synthese, sansGrade, S2, 125);
    await reste(gamma.id, gamma.taches.Revue as string, col.junior as string, S1, 300);
    // Gamma clôturée.
    await cl.query(
      "UPDATE missions SET statut = 'cloturee', cloturee_le = now(), cloturee_par = $2 WHERE id = $1",
      [gamma.id, c.associeId],
    );
    await cl.query("COMMIT");
  });
  ids = [alpha.id, beta.id, gamma.id, vide, randomUUID()];
}, 120_000);
afterAll(() => ctx.fermer());

/** Ordre d'insertion des ensembles et dictionnaires (toStrictEqual les compare sans ordre). */
const ordres = (s: SuiviMission) => ({
  estimees: [...s.estimees],
  attente: [...s.attente].sort(([a], [b]) => a.localeCompare(b)),
});

describe("suivi en lot : équivalence avec la lecture mission par mission", () => {
  it("résultats identiques (deep equal) pour chaque mission, en lot et à l'unité", async () => {
    await ctx.db.withTenant(c.cabinetId, async (db) => {
      const lot = await calculerSuivisMissions(db, c.cabinetId, ids);
      expect([...lot.keys()]).toEqual(ids);
      for (const id of ids) {
        const reference = await suiviMissionReference(db, c.cabinetId, id);
        const enLot = lot.get(id) as SuiviMission;
        expect(enLot, id).toStrictEqual(reference);
        expect(ordres(enLot), id).toStrictEqual(ordres(reference));
        const seule = await calculerSuiviMission(db, c.cabinetId, id);
        expect(seule, id).toStrictEqual(reference);
      }
      // Le jeu est bien varié : on vérifie ce que la référence a vu.
      const a = lot.get(alpha.id) as SuiviMission;
      expect(a.parGrade.map((g) => g.grade_libelle)).toContain("Sans grade");
      expect(a.parGrade.length).toBeGreaterThanOrEqual(5);
      expect(a.parPersonne.length).toBeGreaterThanOrEqual(5);
      expect(a.estimees.size).toBeGreaterThan(0);
      expect(a.estimees.size).toBeLessThan(a.decoupage.taches.length);
      expect(a.attente.size).toBe(3);
      expect(a.decoupage.lots).toHaveLength(1);
      expect(a.performance).not.toBeNull();
      // Réalisé : 6 (senior, correction +0,5 comprise) + 1,5 + 1 (junior) + 0,75 + 2 (externe).
      expect(a.arbre.suivi.realise).toBe(11.25);
      const g = lot.get(gamma.id) as SuiviMission;
      expect(g.arbre.suivi.realise).toBe(2); // 3 jours validés − 1 jour corrigé
      expect((lot.get(beta.id) as SuiviMission).arbre.suivi.realise).toBe(0);
      expect((lot.get(vide) as SuiviMission).arbre.enfants).toEqual([]);
    });
  });

  it("indicateurs du cabinet et rentabilité : jours identiques à la référence", async () => {
    const indicateurs = await c.associe.get(
      "/api/indicateurs/cabinet?du=2026-01-01&au=2026-12-31&niveau=mission",
    );
    expect(indicateurs.statusCode, indicateurs.body).toBe(200);
    const rentabilite = await c.associe.get(
      "/api/finance/rentabilite?niveau=mission&du=2026-01-01&au=2026-12-31",
    );
    expect(rentabilite.statusCode, rentabilite.body).toBe(200);
    const parMission = new Map(
      (indicateurs.json().elements as Record<string, unknown>[]).map((e) => [e.mission_id, e]),
    );
    const rentables = new Map(
      (rentabilite.json().elements as Record<string, unknown>[]).map((e) => [e.cle, e]),
    );
    await ctx.db.withTenant(c.cabinetId, async (db) => {
      for (const m of [alpha, beta, gamma]) {
        const s = (await suiviMissionReference(db, c.cabinetId, m.id)).arbre.suivi;
        expect(parMission.get(m.id), m.id).toMatchObject({
          jours_budget: s.budget,
          jours_realises: s.realise,
          jours_atterrissage: s.atterrissage,
        });
        if (m !== beta) {
          expect(rentables.get(m.id), m.id).toMatchObject({
            budget: { jours: s.budget },
            realise: { jours: s.realise },
            atterrissage: { jours: s.atterrissage },
          });
        }
      }
    });
    // Bêta n'a aucune activité : absente de la rentabilité.
    expect(rentables.has(beta.id)).toBe(false);
  });
});
