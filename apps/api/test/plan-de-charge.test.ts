import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { periodeDuPlan } from "../src/planification/charge.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import {
  affectationNominative,
  missionPlanifiable,
  sansDonneeFinanciere,
  utilisateurCollaborateur,
} from "./planification-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Charge A");
  b = await preparerCabinet(ctx, "Cabinet Charge B");
});
afterAll(() => ctx.fermer());

interface Cellule {
  semaine: string;
  capacite: number;
  jours_affectes: number;
  taux_occupation: number | null;
  etat: string;
}

type Ligne = { collaborateur: { id: string }; cellules: Cellule[] };

const ligneDe = (corps: { elements: Ligne[] }, collaborateurId: string): Ligne =>
  corps.elements.find((l) => l.collaborateur.id === collaborateurId) as Ligne;

describe("plan de charge (PLN-06)", () => {
  it("capacité (fériés, absences validées, temps partiel), jours affectés, taux et état par le moteur", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Charge Calendrier");
    // Férié le mardi 3 novembre : la tâche de 10 j ouvrés va du 02 au 16/11.
    expect(
      (await c.associe.post("/api/cabinet/feries", { date: "2026-11-03", libelle: "Férié test" }))
        .statusCode,
    ).toBe(201);
    const m = await missionPlanifiable(c, { budget: { senior: 20 } });
    const consultant = await utilisateurCollaborateur(c, ["consultant"]);
    const r = await c.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, consultant.collaborateurId, { jours_alloues: 7.5 }),
    );
    expect(r.statusCode, r.body).toBe(201);
    // Absence validée jeudi 12 et vendredi 13 ; une absence seulement demandée ne compte pas.
    const ressources = await c.avecRoles(["ressources"]);
    const abs = await consultant.post("/api/absences", {
      type: "maladie",
      date_debut: "2026-11-12",
      date_fin: "2026-11-13",
    });
    await ressources.post(`/api/absences/${abs.json().id}/valider`);
    await consultant.post("/api/absences", {
      type: "conge_paye",
      date_debut: "2026-11-19",
      date_fin: "2026-11-20",
    });

    const plan = await c.chef.get(
      `/api/plan-de-charge?debut=2026-11-02&fin=2026-11-22&equipe=${m.id}`,
    );
    expect(plan.statusCode, plan.body).toBe(200);
    const corps = plan.json();
    expect(corps).toMatchObject({
      debut: "2026-11-02",
      fin: "2026-11-22",
      semaines: ["2026-11-02", "2026-11-09", "2026-11-16"],
    });
    expect(corps.elements).toHaveLength(1);
    // 7,5 j répartis sur 9 jours ouvrés (02→13/11 sans le 03) : 4 j puis 5 j.
    expect(ligneDe(corps, consultant.collaborateurId).cellules).toEqual([
      {
        semaine: "2026-11-02",
        capacite: 4,
        jours_affectes: 3.33,
        taux_occupation: 0.8325,
        etat: "normal",
      },
      {
        semaine: "2026-11-09",
        capacite: 3,
        jours_affectes: 4.17,
        taux_occupation: 1.39,
        etat: "surcharge",
      },
      {
        semaine: "2026-11-16",
        capacite: 5,
        jours_affectes: 0,
        taux_occupation: 0,
        etat: "sous_occupation",
      },
    ]);
    // Le type d'absence (donnée personnelle) et toute donnée financière restent hors du plan.
    expect(plan.body).not.toContain("maladie");
    expect(sansDonneeFinanciere(plan.body)).toBe(true);

    // Temps partiel : capacité × 50 %.
    await c.associe.patch(`/api/collaborateurs/${consultant.collaborateurId}`, {
      capacite_pct: 50,
    });
    const partiel = (
      await c.chef.get(`/api/plan-de-charge?debut=2026-11-02&fin=2026-11-08&equipe=${m.id}`)
    ).json();
    expect(ligneDe(partiel, consultant.collaborateurId).cellules[0]).toMatchObject({
      capacite: 2,
      jours_affectes: 3.33,
      etat: "surcharge",
    });

    const surcharges = await c.chef.get(
      `/api/plan-de-charge/surcharges?debut=2026-11-02&fin=2026-11-22&equipe=${m.id}`,
    );
    expect(surcharges.statusCode).toBe(200);
    expect(surcharges.json().elements).toEqual([
      expect.objectContaining({
        collaborateur_id: consultant.collaborateurId,
        semaine: "2026-11-02",
        jours_affectes: 3.33,
        capacite: 2,
      }),
      expect.objectContaining({ semaine: "2026-11-09", capacite: 1.5 }),
    ]);
  });

  it("invariant : la somme des jours répartis par semaine égale les jours alloués", async () => {
    const m = await missionPlanifiable(a, { duree: 30, budget: { senior: 100, junior: 100 } });
    const cas = [
      { jours: 7.5, date_debut: "2026-11-02", date_fin: "2026-11-13" },
      { jours: 3.5, date_debut: "2026-11-05", date_fin: "2026-11-10" },
      { jours: 11, date_debut: "2026-11-04", date_fin: "2026-12-11" },
      { jours: 0.5, date_debut: "2026-11-07", date_fin: "2026-11-08" }, // week-end seul
    ];
    for (const [i, x] of cas.entries()) {
      const collab = await a.associe.post("/api/collaborateurs", {
        nom: `Invariant ${i}`,
        grade_id: a.grades.junior,
      });
      const r = await a.chef.post(`/api/missions/${m.id}/affectations`, {
        tache_id: m.tacheId,
        collaborateur_id: collab.json().id,
        jours_alloues: x.jours,
        date_debut: x.date_debut,
        date_fin: x.date_fin,
      });
      expect(r.statusCode, r.body).toBe(201);
      const plan = (
        await a.chef.get(`/api/plan-de-charge?debut=2026-10-26&fin=2026-12-20&equipe=${m.id}`)
      ).json();
      const cellules = ligneDe(plan, collab.json().id).cellules;
      const somme = Math.round(cellules.reduce((t, c) => t + c.jours_affectes * 100, 0)) / 100;
      expect(somme, `cas ${i}`).toBe(x.jours);
    }
  });

  it("validation, plafond de 26 semaines, pagination par curseur", async () => {
    expect(
      (await a.chef.get("/api/plan-de-charge?debut=2026-01-05&fin=2026-07-06")).statusCode,
    ).toBe(400);
    expect(
      (await a.chef.get("/api/plan-de-charge?debut=2026-01-05&fin=2026-07-05")).statusCode,
    ).toBe(200);
    expect((await a.chef.get("/api/plan-de-charge?debut=2026-02-30")).statusCode).toBe(400);
    expect(
      (await a.chef.get("/api/plan-de-charge?debut=2026-03-01&fin=2026-02-01")).statusCode,
    ).toBe(400);
    expect((await a.chef.get("/api/plan-de-charge?limite=101")).statusCode).toBe(400);
    expect((await a.chef.get("/api/plan-de-charge?inconnu=1")).statusCode).toBe(400);
    const p1 = (await a.chef.get("/api/plan-de-charge?limite=2")).json();
    expect(p1.elements).toHaveLength(2);
    expect(p1.semaines).toHaveLength(12);
    const p2 = (
      await a.chef.get(`/api/plan-de-charge?limite=2&curseur=${p1.curseur_suivant}`)
    ).json();
    expect(p2.elements[0].collaborateur.id).not.toBe(p1.elements[0].collaborateur.id);
  });

  it("droits et isolation : charge.lire, équipe d'une mission visible, cabinet propre", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get("/api/plan-de-charge")).statusCode).toBe(403);
    expect((await consultant.get("/api/plan-de-charge/surcharges")).statusCode).toBe(403);
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect((await gestionnaire.get("/api/plan-de-charge")).statusCode).toBe(200);
    const m = await missionPlanifiable(a);
    // Chef d'une autre mission : l'équipe de celle-ci lui est invisible.
    const autreChef = await a.avecRoles(["chef_mission"]);
    expect((await autreChef.get(`/api/plan-de-charge?equipe=${m.id}`)).statusCode).toBe(404);
    expect((await b.chef.get(`/api/plan-de-charge?equipe=${m.id}`)).statusCode).toBe(404);
    const planB = (await b.associe.get("/api/plan-de-charge?limite=100")).json();
    const idsA = new Set(Object.values(a.collaborateurs));
    expect(planB.elements.some((l: Ligne) => idsA.has(l.collaborateur.id))).toBe(false);
  });
});

describe("« Mon planning » (PLN-10)", () => {
  it("ses affectations de la semaine (lignes pré-remplissant la feuille de temps), absences et fériés", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Mon Planning");
    await c.associe.post("/api/cabinet/feries", { date: "2026-11-11", libelle: "Férié test" });
    const m = await missionPlanifiable(c, { budget: { senior: 20 } });
    const moi = await utilisateurCollaborateur(c, ["consultant"]);
    const collegue = await utilisateurCollaborateur(c, ["consultant"]);
    for (const [qui, jours] of [
      [moi, 4.5],
      [collegue, 2],
    ] as const) {
      const r = await c.chef.post(
        `/api/missions/${m.id}/affectations`,
        affectationNominative(m, qui.collaborateurId, { jours_alloues: jours }),
      );
      expect(r.statusCode, r.body).toBe(201);
    }
    await moi.post("/api/absences", {
      type: "formation",
      date_debut: "2026-11-12",
      date_fin: "2026-11-12",
    });
    const r = await moi.get("/api/mon-planning?semaine=2026-11-11");
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    expect(p.semaine).toEqual({ debut: "2026-11-09", fin: "2026-11-15" });
    expect(p.collaborateur).toMatchObject({ id: moi.collaborateurId });
    expect(p.lignes).toHaveLength(1);
    // 4,5 j sur 9 jours ouvrés (02→13/11 sans le 11) : 2,5 j la première semaine, 2 j la seconde.
    expect(p.lignes[0]).toMatchObject({
      mission: { id: m.id },
      tache: { id: m.tacheId, libelle: "Entretiens", phase_libelle: "Diagnostic" },
      jours_alloues_semaine: 2,
    });
    expect(p.absences).toEqual([
      expect.objectContaining({ type: "formation", statut: "demandee", date_debut: "2026-11-12" }),
    ]);
    expect(p.feries).toEqual([{ date: "2026-11-11", libelle: "Férié test" }]);
    // Absence seulement demandée : la capacité reste celle du calendrier (4 j ouvrés).
    expect(p.capacite).toBe(4);
    expect(p.jours_affectes).toBe(2);
    expect(sansDonneeFinanciere(r.body)).toBe(true);
    const avant = (await moi.get("/api/mon-planning?semaine=2026-11-02")).json();
    expect(avant.lignes[0].jours_alloues_semaine).toBe(2.5);
  });

  it("jamais les affectations d'un autre ; compte sans collaborateur ; validation ; isolation", async () => {
    const sansCollab = await a.avecRoles(["associe"]);
    const vide = (await sansCollab.get("/api/mon-planning?semaine=2026-11-02")).json();
    expect(vide).toMatchObject({ collaborateur: null, lignes: [], absences: [] });
    expect((await sansCollab.get("/api/mon-planning?semaine=2026-13-01")).statusCode).toBe(400);
    expect((await sansCollab.get("/api/mon-planning?collaborateur_id=x")).statusCode).toBe(400);
    const externe = await b.avecRoles(["expert_externe"]);
    const r = await externe.get("/api/mon-planning?semaine=2026-11-02");
    expect(r.statusCode).toBe(200);
    expect(r.json().lignes).toEqual([]);
    expect((await ctx.app.inject({ method: "GET", url: "/api/mon-planning" })).statusCode).toBe(
      401,
    );
  });
});

describe("jours fériés par défaut (SOC-04)", () => {
  it("pré-remplit depuis le moteur, idempotent, marque « à valider », sans écraser la saisie", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Fériés");
    await c.associe.post("/api/cabinet/feries", {
      date: "2027-01-01",
      libelle: "Nouvel an maison",
    });
    const r = await c.associe.post("/api/cabinet/feries/par-defaut", { annee: 2027 });
    expect(r.statusCode, r.body).toBe(200);
    const corps = r.json();
    expect(corps).toMatchObject({ pays: "CI", annee: 2027, ajoutes: 9 });
    const parDate = new Map(corps.elements.map((f: { date: string }) => [f.date, f] as const));
    expect(parDate.get("2027-01-01")).toMatchObject({
      libelle: "Nouvel an maison",
      a_valider: false,
    });
    expect(parDate.get("2027-08-07")).toMatchObject({ a_valider: true });
    expect(parDate.get("2027-03-29")).toMatchObject({ libelle: "Lundi de Pâques" });
    const encore = (await c.associe.post("/api/cabinet/feries/par-defaut", { annee: 2027 })).json();
    expect(encore.ajoutes).toBe(0);
    expect(encore.elements).toHaveLength(corps.elements.length);

    const id = (parDate.get("2027-08-07") as { id: string }).id;
    const v = await c.associe.post(`/api/cabinet/feries/${id}/valider`);
    expect(v.json()).toMatchObject({ a_valider: false });
    const liste = (await c.associe.get("/api/cabinet/feries?annee=2027")).json().elements;
    expect(liste.find((f: { id: string }) => f.id === id).a_valider).toBe(false);

    expect((await c.chef.post("/api/cabinet/feries/par-defaut", { annee: 2027 })).statusCode).toBe(
      403,
    );
    expect((await b.associe.post(`/api/cabinet/feries/${id}/valider`)).statusCode).toBe(404);
    expect(
      (await c.associe.post("/api/cabinet/feries/par-defaut", { annee: "2027" })).statusCode,
    ).toBe(400);
    await c.associe.patch("/api/cabinet", { pays: "FR" });
    expect(
      (await c.associe.post("/api/cabinet/feries/par-defaut", { annee: 2028 })).statusCode,
    ).toBe(400);
  });
});

describe("durcissement de la planification (audit)", () => {
  it("M2 : 0001-01-01 → 9999-12-31 refusé en 400 immédiatement, sans construire les semaines", async () => {
    const debut = performance.now();
    const r = await a.chef.get("/api/plan-de-charge?debut=0001-01-01&fin=9999-12-31");
    const duree = performance.now() - debut;
    expect(r.statusCode, r.body).toBe(400);
    expect(duree, `${Math.round(duree)} ms`).toBeLessThan(500);
    expect(
      (await a.chef.get("/api/plan-de-charge/surcharges?debut=0001-01-01&fin=9999-12-31"))
        .statusCode,
    ).toBe(400);
    // Le plafond est aussi vérifié par l'API avant tout calcul (hors schéma).
    const t0 = performance.now();
    expect(() => periodeDuPlan("0001-01-01", "9999-12-31")).toThrow(/26 semaines/);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(periodeDuPlan("2026-11-04", "2027-04-30")).toEqual({
      debut: "2026-11-02",
      fin: "2027-05-02",
    });
  });

  it("E1 : une affectation sans borne est refusée ; le plan de charge reste rapide", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Charge Bornes");
    const m = await missionPlanifiable(c, { budget: { senior: 20 } });
    const consultant = await utilisateurCollaborateur(c, ["consultant"]);
    const r = await c.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, consultant.collaborateurId, {
        date_debut: "0001-01-01",
        date_fin: "9999-12-31",
      }),
    );
    expect(r.statusCode, r.body).toBe(400);
    // L'affectation la plus longue possible (366 jours) reste rapide à répartir.
    await proprietaire((db) =>
      db.query(
        `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id,
           jours_alloues, date_debut, date_fin)
         VALUES ($1, $2, $3, $4, 100, '2026-06-01', date '2026-06-01' + 365)`,
        [c.cabinetId, m.id, m.tacheId, consultant.collaborateurId],
      ),
    );
    const t0 = performance.now();
    const plan = await c.chef.get("/api/plan-de-charge?debut=2026-11-02&fin=2027-05-02");
    expect(plan.statusCode, plan.body).toBe(200);
    const planning = await consultant.get("/api/mon-planning?semaine=2026-11-02");
    expect(planning.statusCode, planning.body).toBe(200);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect((await consultant.get("/api/mon-planning?semaine=9999-12-31")).statusCode).toBe(400);
  });

  it("F5 : curseur du plan de charge décodable avec des noms de 160 caractères multi-octets", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Charge Curseur");
    const noms = ["A", "B", "C"].map((premier) => premier + "€".repeat(159));
    for (const nom of noms) {
      const r = await c.associe.post("/api/collaborateurs", {
        nom,
        grade_id: c.grades.senior,
        type: "externe",
      });
      expect(r.statusCode, r.body).toBe(201);
    }
    const vus: string[] = [];
    let curseur: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const url: string = `/api/plan-de-charge?type=externe&limite=1${curseur ? `&curseur=${curseur}` : ""}`;
      const r = await c.chef.get(url);
      expect(r.statusCode, r.body).toBe(200);
      const corps = r.json();
      vus.push(
        ...corps.elements.map((l: { collaborateur: { nom: string } }) => l.collaborateur.nom),
      );
      curseur = corps.curseur_suivant;
      if (!curseur) break;
      expect(curseur.length).toBeLessThanOrEqual(500);
    }
    expect(vus).toEqual(noms);
  });

  it("F4 : « Mon planning » montre sa propre affectation sur une mission invisible, sans plus", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Mon Planning Visibilite");
    const m = await missionPlanifiable(c, { budget: { senior: 20 } });
    const consultant = await utilisateurCollaborateur(c, ["consultant"]);
    const ressources = await c.avecRoles(["ressources"]);
    const r = await ressources.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, consultant.collaborateurId),
    );
    expect(r.statusCode, r.body).toBe(201);
    // La mission lui reste invisible (pas d'ajout d'équipe sans droit de modifier la mission)…
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(404);
    // … mais son planning porte ce qu'il faut pour saisir ses temps, et rien d'autre.
    const p = (await consultant.get("/api/mon-planning?semaine=2026-11-02")).json();
    expect(p.lignes).toHaveLength(1);
    expect(p.lignes[0].mission).toEqual({
      id: m.id,
      intitule: "Plan stratégique 2027-2031",
      statut: null,
      accessible: false,
    });
    expect(p.lignes[0].tache).toMatchObject({ libelle: "Entretiens", phase_libelle: null });
    // Mission visible (membre de l'équipe) : ligne complète.
    await c.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    const visible = (await consultant.get("/api/mon-planning?semaine=2026-11-02")).json();
    expect(visible.lignes[0].mission).toMatchObject({
      accessible: true,
      statut: expect.any(String),
    });
    expect(visible.lignes[0].tache.phase_libelle).toBe("Diagnostic");
    await c.chef.delete(`/api/missions/${m.id}/equipe/${consultant.utilisateurId}`);
    // Mission invisible et clôturée : plus rien à saisir, l'intitulé est masqué.
    await ctx.db.withTenant(c.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [m.id, c.associeId],
      ),
    );
    const close = (await consultant.get("/api/mon-planning?semaine=2026-11-02")).json();
    expect(close.lignes[0].mission).toMatchObject({ intitule: null, accessible: false });
    expect(close.lignes[0].tache.libelle).toBeNull();
  });
});
