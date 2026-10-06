import { ajouterJours } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { sansDonneeFinanciere } from "./planification-outils.js";
import {
  attendre,
  consultantAffecte,
  lignesSemaine,
  missionTemps,
  saisirEtSoumettre,
  type MissionTemps,
} from "./temps-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let m: MissionTemps;
let senior: Awaited<ReturnType<typeof consultantAffecte>>;
let manager: Awaited<ReturnType<typeof consultantAffecte>>;

const S1 = "2026-11-02";
const semaine = (n: number) => ajouterJours(S1, 7 * (n - 1));

/** Exemple chiffré du PRD (« Volumes journaliers budgétés et réalisés »). */
const PHASES = {
  Diagnostic: { senior: 8, manager: 4 },
  "Analyse des processus": { senior: 6, manager: 2 },
  Recommandations: { senior: 10, manager: 5 },
  "Plan de transformation": { senior: 6, manager: 4 },
  "Validation et restitution": { manager: 3, associe: 2 },
};
const REALISE: Record<"senior" | "manager", [number, string, number][]> = {
  senior: [
    [1, "Diagnostic", 3],
    [2, "Diagnostic", 3],
    [3, "Diagnostic", 2.5],
    [3, "Analyse des processus", 2],
    [4, "Analyse des processus", 3],
    [5, "Recommandations", 3],
    [6, "Recommandations", 3],
  ],
  manager: [
    [1, "Diagnostic", 2],
    [2, "Diagnostic", 2],
    [3, "Diagnostic", 1],
    [4, "Analyse des processus", 2],
  ],
};

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Suivi A");
  b = await preparerCabinet(ctx, "Cabinet Suivi B");
  m = await missionTemps(a, PHASES);
  senior = await consultantAffecte(a, m, {
    Diagnostic: 8.5,
    "Analyse des processus": 5,
    Recommandations: 16,
  });
  manager = await consultantAffecte(
    a,
    m,
    { Diagnostic: 5, "Analyse des processus": 2 },
    { grade: "manager" },
  );
  for (const [qui, api] of [
    ["senior", senior],
    ["manager", manager],
  ] as const) {
    for (let n = 1; n <= 6; n++) {
      const travaux = REALISE[qui]
        .filter(([s]) => s === n)
        .map(([, phase, jours]) => ({ tache_id: m.taches[phase] as string, jours }));
      if (travaux.length === 0) continue;
      const id = await saisirEtSoumettre(api, semaine(n), lignesSemaine(semaine(n), travaux));
      attendre(200, await a.chef.post(`/api/feuilles-temps/${id}/valider`, {}), "validation");
    }
  }
  const declarer = async (api: typeof senior, tache: string, jours: number) =>
    attendre(
      201,
      await api.post(`/api/missions/${m.id}/reste-a-faire`, {
        semaine: semaine(6),
        lignes: [{ tache_id: m.taches[tache], jours }],
      }),
      "reste à faire",
    );
  await declarer(senior, "Diagnostic", 0);
  await declarer(manager, "Diagnostic", 0);
  await declarer(senior, "Analyse des processus", 1);
  await declarer(manager, "Analyse des processus", 0);
  await declarer(senior, "Recommandations", 10);
});
afterAll(() => ctx.fermer());

type Noeud = Record<string, unknown> & { libelle: string; enfants: Noeud[] };

describe("suivi budgété / réalisé / reste à faire / atterrissage (TPS-05, TPS-06)", () => {
  it("reproduit l'exemple chiffré du PRD : 50 / 26,5 / 26 / 52,5 / +2,5 (+5 %)", async () => {
    const r = await a.directeur.get(`/api/missions/${m.id}/suivi`);
    expect(r.statusCode, r.body).toBe(200);
    expect(sansDonneeFinanciere(r.body)).toBe(true);
    const arbre = r.json().arbre as Noeud;
    expect(arbre).toMatchObject({
      niveau: "mission",
      budget: 50,
      realise: 26.5,
      reste_a_faire: 26,
      atterrissage: 52.5,
      ecart: 2.5,
      ecart_relatif: 0.05,
      couleur: "orange",
    });
    const phases = Object.fromEntries(arbre.enfants.map((p) => [p.libelle, p]));
    expect(phases.Diagnostic).toMatchObject({
      budget: 12,
      realise: 13.5,
      reste_a_faire: 0,
      atterrissage: 13.5,
      ecart: 1.5,
      couleur: "rouge",
    });
    expect(phases["Analyse des processus"]).toMatchObject({
      budget: 8,
      realise: 7,
      reste_a_faire: 1,
      atterrissage: 8,
      ecart: 0,
    });
    expect(phases.Recommandations).toMatchObject({
      budget: 15,
      realise: 6,
      reste_a_faire: 10,
      atterrissage: 16,
      ecart: 1,
    });
    expect(phases["Plan de transformation"]).toMatchObject({
      budget: 10,
      realise: 0,
      reste_a_faire: 10,
      atterrissage: 10,
      ecart: 0,
      couleur: "vert",
    });
    expect(phases["Validation et restitution"]).toMatchObject({
      budget: 5,
      reste_a_faire: 5,
      ecart: 0,
    });
    const tachePlan = (phases["Plan de transformation"] as Noeud).enfants[0] as Noeud;
    expect(tachePlan.reste_a_faire_estime).toBe(true);
    // Par grade et par personne.
    const grades = Object.fromEntries(
      (r.json().par_grade as { grade_code: string; realise: number; budget: number }[]).map((g) => [
        g.grade_code,
        g,
      ]),
    );
    expect(grades.senior).toMatchObject({ budget: 30, realise: 19.5 });
    expect(grades.manager).toMatchObject({ budget: 18, realise: 7 });
    const personnes = r.json().par_personne as {
      collaborateur_id: string;
      realise: number;
      reste_a_faire: number;
    }[];
    expect(personnes.find((p) => p.collaborateur_id === senior.collaborateurId)).toMatchObject({
      realise: 19.5,
      reste_a_faire: 11,
    });
    expect(r.json().en_attente).toBe(0);
  });

  it("seuls les temps validés comptent ; les soumis sont « en attente »", async () => {
    const id = await saisirEtSoumettre(senior, semaine(7), [
      { date: semaine(7), tache_id: m.taches.Recommandations, jours: 1 },
    ]);
    const r = (await a.directeur.get(`/api/missions/${m.id}/suivi`)).json();
    expect(r.arbre.realise).toBe(26.5);
    expect(r.en_attente).toBe(1);
    attendre(
      200,
      await a.chef.post(`/api/feuilles-temps/${id}/rejeter`, { motif: "Erreur" }),
      "rejet",
    );
    expect((await a.directeur.get(`/api/missions/${m.id}/suivi`)).json().en_attente).toBe(0);
  });

  it("alertes au chef et au directeur, sans doublon tant que l'état ne change pas (TPS-07)", async () => {
    const alertes = async () =>
      (
        (await a.directeur.get("/api/notifications?limite=100")).json().elements as {
          type: string;
          corps: string;
        }[]
      ).filter((n) => n.type === "alerte_suivi_budget");
    const avant = await alertes();
    expect(avant.length).toBeGreaterThan(0);
    expect(avant.some((n) => /^Mission : Atterrissage supérieur au budget/m.test(n.corps))).toBe(
      true,
    );
    expect(avant.every((n) => sansDonneeFinanciere(n.corps))).toBe(true);
    expect(
      (
        (await a.chef.get("/api/notifications?limite=100")).json().elements as { type: string }[]
      ).some((n) => n.type === "alerte_suivi_budget"),
    ).toBe(true);
    // Même déclaration : état inchangé, aucune nouvelle notification.
    attendre(
      201,
      await senior.post(`/api/missions/${m.id}/reste-a-faire`, {
        lignes: [{ tache_id: m.taches.Recommandations, jours: 10 }],
      }),
      "redéclaration",
    );
    expect((await alertes()).length).toBe(avant.length);
    const suivi = (await a.directeur.get(`/api/missions/${m.id}/suivi`)).json();
    expect(
      suivi.alertes.some(
        (x: { niveau: string; type: string }) =>
          x.niveau === "mission" && x.type === "atterrissage_superieur_budget",
      ),
    ).toBe(true);
  });

  it("reste à faire : historique en ajout seul, droits et validation", async () => {
    const h = await a.chef.get(
      `/api/missions/${m.id}/reste-a-faire?tache_id=${m.taches.Recommandations}&limite=1`,
    );
    expect(h.statusCode, h.body).toBe(200);
    expect(h.json().elements).toHaveLength(1);
    expect(h.json().curseur_suivant).not.toBeNull();
    const suite = await a.chef.get(
      `/api/missions/${m.id}/reste-a-faire?tache_id=${m.taches.Recommandations}&limite=1&curseur=${h.json().curseur_suivant}`,
    );
    expect(suite.json().elements[0].id).not.toBe(h.json().elements[0].id);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("UPDATE reste_a_faire SET centiemes = 0")),
    ).rejects.toThrow(/permission/);
    // Tâche non affectée au manager.
    const r = await manager.post(`/api/missions/${m.id}/reste-a-faire`, {
      lignes: [{ tache_id: m.taches.Recommandations, jours: 1 }],
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("TACHE_NON_AFFECTEE");
    // Pour autrui : seulement si l'on modifie la mission.
    expect(
      (
        await manager.post(`/api/missions/${m.id}/reste-a-faire`, {
          lignes: [
            { tache_id: m.taches.Diagnostic, collaborateur_id: senior.collaborateurId, jours: 1 },
          ],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await senior.post(`/api/missions/${m.id}/reste-a-faire`, { lignes: [] })).statusCode,
    ).toBe(400);
    expect(
      (
        await senior.post(`/api/missions/${m.id}/reste-a-faire`, {
          lignes: [{ tache_id: m.taches.Diagnostic, jours: 0.3 }],
        })
      ).statusCode,
    ).toBe(400);
  });

  it("droits et isolation du suivi", async () => {
    expect((await b.associe.get(`/api/missions/${m.id}/suivi`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/missions/${m.id}/reste-a-faire`)).statusCode).toBe(404);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.get(`/api/missions/${m.id}/suivi`)).statusCode).toBe(403);
    const horsEquipe = await a.avecRoles(["consultant"]);
    expect((await horsEquipe.get(`/api/missions/${m.id}/suivi`)).statusCode).toBe(404);
    expect(
      (
        await b.associe.post(`/api/missions/${m.id}/reste-a-faire`, {
          lignes: [{ tache_id: m.taches.Diagnostic, jours: 1 }],
        })
      ).statusCode,
    ).toBe(404);
  });
});
