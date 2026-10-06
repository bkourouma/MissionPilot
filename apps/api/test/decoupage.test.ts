import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Découpage A");
  b = await preparerCabinet(ctx, "Cabinet Découpage B");
});
afterAll(() => ctx.fermer());

/** Mission vierge démarrant le lundi 2 novembre 2026. */
async function missionVierge(c: CabinetMissions = a): Promise<string> {
  return (await creerMission(c, { type_mission_id: null, mode_facturation: "regie" })).id;
}

async function creer(missionId: string, chemin: string, corps: Record<string, unknown>) {
  const r = await a.chef.post(`/api/missions/${missionId}/${chemin}`, corps);
  expect(r.statusCode, `${chemin} ${r.body}`).toBe(201);
  return r.json();
}

describe("découpage hiérarchique (PLN-01)", () => {
  it("phases > lots > tâches, tâche directement sous une phase, jalons ; modification et suppression", async () => {
    const id = await missionVierge();
    const p1 = await creer(id, "phases", { libelle: "Diagnostic", ordre: 1 });
    const lot = await creer(id, "lots", {
      phase_id: p1.id,
      libelle: "Entretiens",
      est_livrable: true,
    });
    const t1 = await creer(id, "taches", { parent_id: lot.id, libelle: "Direction" });
    expect(t1).toMatchObject({ phase_id: p1.id, lot_id: lot.id, duree_jours_ouvres: 1 });
    const t2 = await creer(id, "taches", { parent_id: p1.id, libelle: "Synthèse", ordre: 5 });
    expect(t2).toMatchObject({ phase_id: p1.id, lot_id: null });
    const j = await creer(id, "jalons", {
      phase_id: p1.id,
      libelle: "Copil",
      date_prevue: "2026-11-20",
    });
    expect(j.atteint).toBe(false);

    const d = (await a.chef.get(`/api/missions/${id}/decoupage`)).json();
    expect(d.phases).toHaveLength(1);
    expect(d.phases[0].lots[0].taches.map((t: { id: string }) => t.id)).toEqual([t1.id]);
    expect(d.phases[0].taches.map((t: { id: string }) => t.id)).toEqual([t2.id]);
    expect(d.jalons.map((x: { id: string }) => x.id)).toEqual([j.id]);

    const m = await a.chef.patch(`/api/missions/${id}/taches/${t1.id}`, {
      duree_jours_ouvres: 3,
      date_debut: "2026-11-03",
    });
    expect(m.json()).toMatchObject({ duree_jours_ouvres: 3, date_debut: "2026-11-03" });
    expect(
      (await a.chef.patch(`/api/missions/${id}/jalons/${j.id}`, { atteint: true })).json().atteint,
    ).toBe(true);
    expect(
      (await a.chef.patch(`/api/missions/${id}/taches/${t1.id}`, { duree_jours_ouvres: 0 }))
        .statusCode,
    ).toBe(400);

    // Supprimer la phase supprime lots, tâches et jalons.
    expect((await a.chef.delete(`/api/missions/${id}/phases/${p1.id}`)).statusCode).toBe(204);
    const vide = (await a.chef.get(`/api/missions/${id}/decoupage`)).json();
    expect(vide).toMatchObject({ phases: [], jalons: [] });
  });

  it("refuse un parent d'une autre mission ou d'un autre cabinet", async () => {
    const id = await missionVierge();
    const autre = await missionVierge();
    const phaseAutre = await creer(autre, "phases", { libelle: "Autre" });
    const idB = await missionVierge(b);
    const phaseB = (await b.chef.post(`/api/missions/${idB}/phases`, { libelle: "B" })).json();
    for (const parent of [phaseAutre.id, phaseB.id]) {
      expect(
        (await a.chef.post(`/api/missions/${id}/lots`, { phase_id: parent, libelle: "X" }))
          .statusCode,
      ).toBe(400);
      expect(
        (await a.chef.post(`/api/missions/${id}/taches`, { parent_id: parent, libelle: "X" }))
          .statusCode,
      ).toBe(400);
      expect(
        (await a.chef.post(`/api/missions/${id}/jalons`, { phase_id: parent, libelle: "X" }))
          .statusCode,
      ).toBe(400);
    }
    // Élément d'une autre mission adressé par cette mission : 404.
    expect(
      (await a.chef.patch(`/api/missions/${id}/phases/${phaseAutre.id}`, { libelle: "X" }))
        .statusCode,
    ).toBe(404);
    expect((await a.chef.delete(`/api/missions/${id}/phases/${phaseAutre.id}`)).statusCode).toBe(
      404,
    );
  });

  it("droits : mission.planifier ; un consultant de l'équipe lit sans écrire", async () => {
    const id = await missionVierge();
    const consultant = await a.avecRoles(["consultant"]);
    await a.chef.post(`/api/missions/${id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    expect((await consultant.get(`/api/missions/${id}/decoupage`)).statusCode).toBe(200);
    expect((await consultant.post(`/api/missions/${id}/phases`, { libelle: "X" })).statusCode).toBe(
      403,
    );
  });
});

describe("réorganisation transactionnelle (glisser-déposer)", () => {
  it("déplace un lot (ses tâches suivent), une tâche vers un lot d'une autre phase, et l'ordre", async () => {
    const id = await missionVierge();
    const p1 = await creer(id, "phases", { libelle: "P1", ordre: 1 });
    const p2 = await creer(id, "phases", { libelle: "P2", ordre: 2 });
    const lot = await creer(id, "lots", { phase_id: p1.id, libelle: "L1" });
    const lot2 = await creer(id, "lots", { phase_id: p2.id, libelle: "L2" });
    const t1 = await creer(id, "taches", { parent_id: lot.id, libelle: "T1" });
    const t2 = await creer(id, "taches", { parent_id: p1.id, libelle: "T2" });

    const r = await a.chef.post(`/api/missions/${id}/reorganiser`, {
      deplacements: [
        { type: "phase", id: p2.id, ordre: 0 },
        { type: "lot", id: lot.id, parent_id: p2.id, ordre: 3 },
        { type: "tache", id: t2.id, parent_id: lot2.id, ordre: 1 },
      ],
    });
    expect(r.statusCode).toBe(200);
    const d = (await a.chef.get(`/api/missions/${id}/decoupage`)).json();
    expect(d.phases.map((p: { id: string }) => p.id)).toEqual([p2.id, p1.id]);
    const phase2 = d.phases[0];
    expect(phase2.lots.map((l: { id: string }) => l.id)).toEqual([lot2.id, lot.id]);
    expect(phase2.lots[1].taches[0]).toMatchObject({ id: t1.id, phase_id: p2.id });
    expect(phase2.lots[0].taches[0]).toMatchObject({ id: t2.id, phase_id: p2.id, lot_id: lot2.id });
  });

  it("tout ou rien : un déplacement invalide annule les précédents", async () => {
    const id = await missionVierge();
    const p1 = await creer(id, "phases", { libelle: "P1", ordre: 1 });
    const p2 = await creer(id, "phases", { libelle: "P2", ordre: 2 });
    const t = await creer(id, "taches", { parent_id: p1.id, libelle: "T" });
    const autre = await creer(await missionVierge(), "phases", { libelle: "Ailleurs" });
    const r = await a.chef.post(`/api/missions/${id}/reorganiser`, {
      deplacements: [
        { type: "tache", id: t.id, parent_id: p2.id, ordre: 0 },
        { type: "tache", id: t.id, parent_id: autre.id, ordre: 0 },
      ],
    });
    expect(r.statusCode).toBe(400);
    const d = (await a.chef.get(`/api/missions/${id}/decoupage`)).json();
    expect(d.phases[0].taches.map((x: { id: string }) => x.id)).toEqual([t.id]);
    // Élément inconnu de la mission : 404, rien n'est appliqué.
    const r2 = await a.chef.post(`/api/missions/${id}/reorganiser`, {
      deplacements: [
        { type: "phase", id: p2.id, ordre: 0 },
        { type: "phase", id: autre.id, ordre: 1 },
      ],
    });
    expect(r2.statusCode).toBe(404);
    expect((await a.chef.get(`/api/missions/${id}/decoupage`)).json().phases[0].id).toBe(p1.id);
  });
});

describe("budget en jours par tâche et agrégation (PLN-02)", () => {
  it("par grade ou par personne, agrégé tâche → lot → phase → mission par le moteur", async () => {
    const id = await missionVierge();
    const p1 = await creer(id, "phases", { libelle: "P1", ordre: 1 });
    const p2 = await creer(id, "phases", { libelle: "P2", ordre: 2 });
    const lot = await creer(id, "lots", { phase_id: p1.id, libelle: "L" });
    const t1 = await creer(id, "taches", { parent_id: lot.id, libelle: "T1" });
    const t2 = await creer(id, "taches", { parent_id: p1.id, libelle: "T2" });
    const t3 = await creer(id, "taches", { parent_id: p2.id, libelle: "T3" });
    const budget = (t: string, lignes: unknown[]) =>
      a.chef.put(`/api/missions/${id}/taches/${t}/budget`, { lignes });
    expect(
      (
        await budget(t1.id, [
          { grade_id: a.grades.senior, jours: 2.5 },
          { collaborateur_id: a.collaborateurs.junior, jours: 1.25 },
        ])
      ).json().lignes,
    ).toHaveLength(2);
    await budget(t2.id, [{ grade_id: a.grades.manager, jours: 0.75 }]);
    await budget(t3.id, [{ grade_id: a.grades.junior, jours: 4 }]);

    const s = (await a.chef.get(`/api/missions/${id}/synthese`)).json();
    expect(s.arborescence).toMatchObject({ id, niveau: "mission", couleur: "vert" });
    expect(s.arborescence.suivi).toMatchObject({ budget: 8.5, realise: 0, atterrissage: 8.5 });
    const [s1, s2] = s.arborescence.enfants;
    expect(s1).toMatchObject({ id: p1.id, suivi: { budget: 4.5 } });
    expect(s1.enfants[0]).toMatchObject({ id: lot.id, niveau: "lot", suivi: { budget: 3.75 } });
    expect(s2).toMatchObject({ id: p2.id, suivi: { budget: 4 } });
  });

  it("valide les lignes : grade xor personne, pas de doublon, centième, cabinet", async () => {
    const id = await missionVierge();
    const p = await creer(id, "phases", { libelle: "P" });
    const t = await creer(id, "taches", { parent_id: p.id, libelle: "T" });
    const url = `/api/missions/${id}/taches/${t.id}/budget`;
    const put = (lignes: unknown[]) => a.chef.put(url, { lignes });
    expect(
      (
        await put([
          { grade_id: a.grades.senior, collaborateur_id: a.collaborateurs.senior, jours: 1 },
        ])
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put([
          { grade_id: a.grades.senior, jours: 1 },
          { grade_id: a.grades.senior, jours: 2 },
        ])
      ).statusCode,
    ).toBe(400);
    expect((await put([{ grade_id: a.grades.senior, jours: 1.001 }])).statusCode).toBe(400);
    expect((await put([{ grade_id: b.grades.senior, jours: 1 }])).statusCode).toBe(400);
    expect((await put([{ collaborateur_id: b.collaborateurs.senior, jours: 1 }])).statusCode).toBe(
      400,
    );
    // Lecture du budget en jours : budget.lire_jours ; écriture : budget.ecrire.
    const ressources = await a.avecRoles(["ressources"]);
    expect((await ressources.put(url, { lignes: [] })).statusCode).toBe(403);
  });
});

describe("dépendances et planning en jours ouvrés (PLN-03)", () => {
  it("dates au plus tôt avec le calendrier du cabinet ; cycle refusé (409)", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Planning");
    expect(
      (await c.associe.post("/api/cabinet/feries", { date: "2026-11-05", libelle: "Férié test" }))
        .statusCode,
    ).toBe(201);
    const id = (await creerMission(c, { type_mission_id: null, mode_facturation: "regie" })).id;
    const post = async (chemin: string, corps: unknown) => {
      const r = await c.chef.post(`/api/missions/${id}/${chemin}`, corps);
      expect(r.statusCode, r.body).toBe(201);
      return r.json();
    };
    const p = await post("phases", { libelle: "P" });
    const t1 = await post("taches", { parent_id: p.id, libelle: "T1", duree_jours_ouvres: 3 });
    const t2 = await post("taches", { parent_id: p.id, libelle: "T2", duree_jours_ouvres: 2 });
    const t3 = await post("taches", { parent_id: p.id, libelle: "T3", duree_jours_ouvres: 1 });
    await post("dependances", { predecesseur_id: t1.id, successeur_id: t2.id });
    await post("dependances", { predecesseur_id: t2.id, successeur_id: t3.id, decalage: 1 });

    const planning = (await c.chef.get(`/api/missions/${id}/planning`)).json();
    const dates = Object.fromEntries(
      planning.taches.map((t: { id: string; debut: string; fin: string }) => [
        t.id,
        [t.debut, t.fin],
      ]),
    );
    // Lundi 2 → mercredi 4 ; jeudi 5 férié : T2 vendredi 6 → lundi 9 ; T3 un jour ouvré d'écart.
    expect(dates[t1.id]).toEqual(["2026-11-02", "2026-11-04"]);
    expect(dates[t2.id]).toEqual(["2026-11-06", "2026-11-09"]);
    expect(dates[t3.id]).toEqual(["2026-11-11", "2026-11-11"]);

    const cycle = await c.chef.post(`/api/missions/${id}/dependances`, {
      predecesseur_id: t3.id,
      successeur_id: t1.id,
    });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().erreur.code).toBe("CYCLE_DEPENDANCES");
    expect(
      (
        await c.chef.post(`/api/missions/${id}/dependances`, {
          predecesseur_id: t1.id,
          successeur_id: t2.id,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await c.chef.post(`/api/missions/${id}/dependances`, {
          predecesseur_id: t1.id,
          successeur_id: t1.id,
        })
      ).statusCode,
    ).toBe(400);

    // Supprimer une dépendance libère le planning.
    const dep = planning.dependances.find(
      (d: { successeur_id: string }) => d.successeur_id === t2.id,
    );
    expect((await c.chef.delete(`/api/missions/${id}/dependances/${dep.id}`)).statusCode).toBe(204);
    const apres = (await c.chef.get(`/api/missions/${id}/planning`)).json();
    expect(apres.taches.find((t: { id: string }) => t.id === t2.id).debut).toBe("2026-11-02");
  });

  it("refuse une dépendance vers une tâche d'une autre mission", async () => {
    const id = await missionVierge();
    const p = await creer(id, "phases", { libelle: "P" });
    const t = await creer(id, "taches", { parent_id: p.id, libelle: "T" });
    const autre = await missionVierge();
    const pa = await creer(autre, "phases", { libelle: "P" });
    const ta = await creer(autre, "taches", { parent_id: pa.id, libelle: "T" });
    expect(
      (
        await a.chef.post(`/api/missions/${id}/dependances`, {
          predecesseur_id: t.id,
          successeur_id: ta.id,
        })
      ).statusCode,
    ).toBe(400);
  });
});
