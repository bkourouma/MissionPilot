import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { sansDonneeFinanciere } from "./planification-outils.js";
import {
  attendre,
  consultantAffecte,
  missionTemps,
  saisirEtSoumettre,
  type MissionTemps,
} from "./temps-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let m: MissionTemps;
let formation: string;

const LUNDI = "2026-11-02";

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Temps A");
  b = await preparerCabinet(ctx, "Cabinet Temps B");
  m = await missionTemps(a, { Diagnostic: { senior: 10 }, Analyse: { senior: 5 } });
  const activites = (await a.associe.get("/api/activites-internes")).json().elements as {
    code: string;
    id: string;
  }[];
  formation = (activites.find((x) => x.code === "formation") as { id: string }).id;
});
afterAll(() => ctx.fermer());

describe("activités internes et paramètres (TPS-02)", () => {
  it("chaque cabinet reçoit les activités par défaut ; création réservée à cabinet.gerer", async () => {
    const codes = (await b.associe.get("/api/activites-internes"))
      .json()
      .elements.map((x: { code: string }) => x.code)
      .sort();
    expect(codes).toEqual(["administration", "conges", "formation", "prospection"]);
    const c = await a.associe.post("/api/activites-internes", {
      code: "veille",
      libelle: "Veille",
    });
    expect(c.statusCode, c.body).toBe(201);
    expect(
      (await a.associe.post("/api/activites-internes", { code: "veille", libelle: "X" }))
        .statusCode,
    ).toBe(409);
    expect(
      (await a.chef.post("/api/activites-internes", { code: "autre", libelle: "X" })).statusCode,
    ).toBe(403);
    expect(
      (await a.associe.post("/api/activites-internes", { code: "A B", libelle: "X" })).statusCode,
    ).toBe(400);
    // Isolation : l'activité de A est inconnue de B.
    expect(
      (await b.associe.patch(`/api/activites-internes/${c.json().id}`, { actif: false }))
        .statusCode,
    ).toBe(404);
  });

  it("paramètres : lecture par tous, modification par cabinet.gerer, validation", async () => {
    const p = await a.chef.get("/api/temps/parametres");
    expect(p.json()).toMatchObject({
      unite_saisie_temps: "demi_journee",
      controle_capacite: "signaler",
      seuil_consommation_pct: 80,
    });
    expect(
      (await a.chef.patch("/api/temps/parametres", { seuil_consommation_pct: 90 })).statusCode,
    ).toBe(403);
    expect(
      (await a.associe.patch("/api/temps/parametres", { seuil_consommation_pct: 0 })).statusCode,
    ).toBe(400);
    expect((await a.associe.patch("/api/temps/parametres", {})).statusCode).toBe(400);
  });
});

describe("feuilles de temps (TPS-01, TPS-03)", () => {
  it("pré-remplissage depuis les affectations, sans donnée financière", async () => {
    const consultant = await consultantAffecte(a, m, { Diagnostic: 10 });
    const semaine = await consultant.get(`/api/feuilles-temps/semaine?semaine=2026-11-04`);
    expect(semaine.statusCode, semaine.body).toBe(200);
    expect(semaine.json().feuille).toBeNull();
    const pre = semaine.json().pre_remplissage as { jours: number }[];
    // 10 jours sur 60 jours ouvrés : 0,83 j par semaine, arrondi au pas : 1 j.
    expect(pre.reduce((t, l) => t + l.jours, 0)).toBe(1);
    const f = await consultant.post("/api/feuilles-temps", { semaine: "2026-11-04" });
    expect(f.statusCode, f.body).toBe(201);
    expect(f.json()).toMatchObject({ semaine: LUNDI, statut: "brouillon" });
    expect(f.json().totaux.semaine).toBe(1);
    expect(sansDonneeFinanciere(f.body)).toBe(true);
    expect((await consultant.post("/api/feuilles-temps", { semaine: LUNDI })).statusCode).toBe(409);
  });

  it("refuse une tâche non affectée, un pas invalide, une date hors semaine, un corps invalide", async () => {
    const consultant = await consultantAffecte(a, m, { Diagnostic: 5 });
    const f = await consultant.post("/api/feuilles-temps", { semaine: LUNDI, pre_remplir: false });
    const url = `/api/feuilles-temps/${f.json().id}/lignes`;
    const nonAffectee = await consultant.put(url, {
      lignes: [{ date: LUNDI, tache_id: m.taches.Analyse, jours: 1 }],
    });
    expect(nonAffectee.statusCode).toBe(400);
    expect(nonAffectee.json().erreur.code).toBe("TACHE_NON_AFFECTEE");
    expect(nonAffectee.json().erreur.message).toMatch(/ne vous est pas affectée/);
    const pas = await consultant.put(url, {
      lignes: [{ date: LUNDI, tache_id: m.taches.Diagnostic, jours: 0.3 }],
    });
    expect(pas.statusCode).toBe(400);
    const horsSemaine = await consultant.put(url, {
      lignes: [{ date: "2026-11-09", tache_id: m.taches.Diagnostic, jours: 1 }],
    });
    expect(horsSemaine.statusCode).toBe(400);
    const heures = await consultant.put(url, {
      lignes: [{ date: LUNDI, tache_id: m.taches.Diagnostic, heures: 4 }],
    });
    expect(heures.statusCode).toBe(400);
    const deux = await consultant.put(url, {
      lignes: [{ date: LUNDI, tache_id: m.taches.Diagnostic, activite_id: formation, jours: 1 }],
    });
    expect(deux.statusCode).toBe(400);
    expect((await consultant.put(url, { lignes: [], extra: 1 })).statusCode).toBe(400);
    // Une feuille d'autrui ne se modifie pas.
    const autre = await consultantAffecte(a, m, { Diagnostic: 1 });
    expect((await autre.put(url, { lignes: [] })).statusCode).toBe(404);
    expect((await consultant.post(`/api/feuilles-temps/${f.json().id}/soumettre`)).statusCode).toBe(
      400,
    );
  });

  it("capacité du jour : signalée par défaut, refusée selon le paramètre", async () => {
    const consultant = await consultantAffecte(a, m, { Diagnostic: 5 });
    const f = await consultant.post("/api/feuilles-temps", { semaine: LUNDI, pre_remplir: false });
    const url = `/api/feuilles-temps/${f.json().id}/lignes`;
    const lignes = [
      { date: LUNDI, tache_id: m.taches.Diagnostic, jours: 1 },
      { date: LUNDI, activite_id: formation, jours: 0.5 },
      // Samedi : jour non travaillé, capacité nulle.
      { date: "2026-11-07", tache_id: m.taches.Diagnostic, jours: 0.5 },
    ];
    const r = await consultant.put(url, { lignes });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().avertissements).toHaveLength(1);
    expect(r.json().avertissements[0].message).toMatch(/2026-11-02 : 1,5 j/);
    expect(r.json().avertissements[0].message).toMatch(/2026-11-07/);
    attendre(
      200,
      await a.associe.patch("/api/temps/parametres", { controle_capacite: "refuser" }),
      "paramètre",
    );
    try {
      const refus = await consultant.put(url, { lignes });
      expect(refus.statusCode).toBe(400);
      expect(refus.json().erreur.code).toBe("CAPACITE_DEPASSEE");
    } finally {
      await a.associe.patch("/api/temps/parametres", { controle_capacite: "signaler" });
    }
  });

  it("circuit : soumission, rejet motivé, resoumission, validation par parties, immuabilité", async () => {
    const consultant = await consultantAffecte(a, m, { Diagnostic: 5 });
    const id = await saisirEtSoumettre(consultant, LUNDI, [
      { date: LUNDI, tache_id: m.taches.Diagnostic, jours: 1 },
      { date: "2026-11-03", activite_id: formation, jours: 0.5 },
    ]);
    // Le chef est prévenu.
    const notifs = (await a.chef.get("/api/notifications")).json().elements as { type: string }[];
    expect(notifs.some((n) => n.type === "feuille_temps_soumise")).toBe(true);
    // Le consultant ne valide pas ; une feuille soumise ne se modifie plus.
    expect((await consultant.post(`/api/feuilles-temps/${id}/valider`)).statusCode).toBe(403);
    expect(
      (await consultant.put(`/api/feuilles-temps/${id}/lignes`, { lignes: [] })).statusCode,
    ).toBe(409);
    // Le chef ne voit que la partie de sa mission (pas les activités internes).
    const vue = await a.chef.get(`/api/feuilles-temps/${id}`);
    expect(vue.json().vue_partielle).toBe(true);
    expect(vue.json().lignes).toHaveLength(1);
    // Rejet : motif obligatoire.
    expect((await a.chef.post(`/api/feuilles-temps/${id}/rejeter`, {})).statusCode).toBe(400);
    const rejet = await a.chef.post(`/api/feuilles-temps/${id}/rejeter`, {
      motif: "Préciser le lundi.",
    });
    expect(rejet.statusCode, rejet.body).toBe(200);
    expect(rejet.json().statut).toBe("rejetee");
    const mienne = await consultant.get(`/api/feuilles-temps/${id}`);
    expect(mienne.json().motif_rejet).toBe("Préciser le lundi.");
    // Correction puis resoumission.
    attendre(
      200,
      await consultant.put(`/api/feuilles-temps/${id}/lignes`, {
        lignes: [
          { date: LUNDI, tache_id: m.taches.Diagnostic, jours: 0.5, commentaire: "Entretiens" },
          { date: "2026-11-03", activite_id: formation, jours: 0.5 },
        ],
      }),
      "correction",
    );
    attendre(200, await consultant.post(`/api/feuilles-temps/${id}/soumettre`), "resoumission");
    // Le chef valide sa partie ; la partie interne attend le directeur.
    const v1 = await a.chef.post(`/api/feuilles-temps/${id}/valider`, {});
    expect(v1.statusCode, v1.body).toBe(200);
    expect(v1.json().statut).toBe("soumise");
    expect(
      (await a.chef.post(`/api/feuilles-temps/${id}/valider`, { interne: true })).statusCode,
    ).toBe(403);
    const aValider = (await a.directeur.get("/api/feuilles-temps?vue=a_valider")).json()
      .elements as { id: string }[];
    expect(aValider.map((x) => x.id)).toContain(id);
    const v2 = await a.directeur.post(`/api/feuilles-temps/${id}/valider`, { interne: true });
    expect(v2.statusCode, v2.body).toBe(200);
    expect(v2.json().statut).toBe("validee");
    expect((await a.directeur.post(`/api/feuilles-temps/${id}/valider`, {})).statusCode).toBe(409);
    // Immuable, y compris en base pour le rôle applicatif.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE lignes_temps SET centiemes = 100 WHERE feuille_id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPT01" });
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE feuilles_temps SET statut = 'brouillon' WHERE id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPT01" });
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("DELETE FROM feuilles_temps WHERE id = $1", [id]),
      ),
    ).rejects.toThrow(/permission/);
    // Historique des décisions : ajout seul.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("DELETE FROM feuille_validations WHERE feuille_id = $1", [id]),
      ),
    ).rejects.toThrow(/permission/);
    const liste = (await consultant.get("/api/feuilles-temps")).json().elements as {
      id: string;
      statut: string;
    }[];
    expect(liste.find((x) => x.id === id)?.statut).toBe("validee");
  });

  it("jamais de validation par l'auteur, sauf associé", async () => {
    // Un chef de mission qui saisit sur sa propre mission.
    const chefCollab = await consultantAffecte(
      a,
      m,
      { Diagnostic: 2 },
      { roles: ["chef_mission"], grade: "manager" },
    );
    const m2 = await missionTemps(a, { Cadrage: { manager: 3 } }, { intitule: "Mission du chef" });
    await proprietaire((c) =>
      c.query("UPDATE missions SET chef_id = $1 WHERE id = $2", [chefCollab.utilisateurId, m2.id]),
    );
    attendre(
      201,
      await a.associe.post(`/api/missions/${m2.id}/affectations`, {
        tache_id: m2.taches.Cadrage,
        collaborateur_id: chefCollab.collaborateurId,
        jours_alloues: 2,
        date_debut: m2.debut,
        date_fin: "2026-11-20",
      }),
      "affectation",
    );
    const id = await saisirEtSoumettre(chefCollab, LUNDI, [
      { date: LUNDI, tache_id: m2.taches.Cadrage, jours: 1 },
    ]);
    const auto = await chefCollab.post(`/api/feuilles-temps/${id}/valider`, {});
    expect(auto.statusCode).toBe(403);
    expect(auto.json().erreur.code).toBe("AUTO_VALIDATION");
    const r = await a.associe.post(`/api/feuilles-temps/${id}/valider`, {});
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().statut).toBe("validee");
  });

  it("isolation : une feuille d'un autre cabinet ou d'une autre mission est introuvable", async () => {
    const consultant = await consultantAffecte(a, m, { Diagnostic: 2 });
    const id = await saisirEtSoumettre(consultant, LUNDI, [
      { date: LUNDI, tache_id: m.taches.Diagnostic, jours: 1 },
    ]);
    expect((await b.associe.get(`/api/feuilles-temps/${id}`)).statusCode).toBe(404);
    expect((await b.associe.post(`/api/feuilles-temps/${id}/valider`, {})).statusCode).toBe(404);
    const toutesB = await b.associe.get("/api/feuilles-temps?vue=toutes");
    expect(toutesB.statusCode, toutesB.body).toBe(200);
    expect(toutesB.json().elements).toEqual([]);
    // Un chef d'une autre mission ne voit pas la feuille.
    const autreChef = await a.avecRoles(["chef_mission"]);
    expect((await autreChef.get(`/api/feuilles-temps/${id}`)).statusCode).toBe(404);
    expect((await autreChef.post(`/api/feuilles-temps/${id}/valider`, {})).statusCode).toBe(404);
    // Un consultant ne liste pas les feuilles des autres.
    expect((await consultant.get("/api/feuilles-temps?vue=toutes")).statusCode).toBe(403);
    expect((await consultant.get("/api/feuilles-temps?vue=nimporte")).statusCode).toBe(400);
  });

  it("discipline de saisie : feuille soumise avant la date limite", async () => {
    const consultant = await consultantAffecte(a, m, { Diagnostic: 2 });
    await saisirEtSoumettre(consultant, LUNDI, [
      { date: LUNDI, tache_id: m.taches.Diagnostic, jours: 1 },
    ]);
    const r = await consultant.get(
      `/api/temps/discipline?debut=${LUNDI}&fin=2026-11-15&date_reference=2026-11-20`,
    );
    expect(r.statusCode, r.body).toBe(200);
    const moi = r.json().elements as {
      collaborateur: { id: string };
      reussis: number;
      attendus: number;
    }[];
    expect(moi).toHaveLength(1);
    // Semaine du 2 : soumise à temps ; semaine du 9 : non soumise, échéance passée.
    expect(moi[0]).toMatchObject({ reussis: 1, attendus: 2 });
    const tous = await a.associe.get(
      `/api/temps/discipline?debut=${LUNDI}&fin=2026-11-08&date_reference=2026-11-20`,
    );
    expect(tous.json().elements.length).toBeGreaterThan(1);
    expect(
      (await a.associe.get("/api/temps/discipline?debut=2026-01-05&fin=2026-12-31")).statusCode,
    ).toBe(400);
  });
});

describe("saisie en heures (cabinet à l'heure)", () => {
  it("les heures d'une même case sont additionnées avant conversion", async () => {
    attendre(
      200,
      await b.associe.patch("/api/cabinet", { unite_saisie_temps: "heure", heures_par_jour: 8 }),
      "cabinet",
    );
    const mb = await missionTemps(b, { Diagnostic: { senior: 10 } });
    const consultant = await consultantAffecte(b, mb, { Diagnostic: 5 });
    const f = await consultant.post("/api/feuilles-temps", { semaine: LUNDI, pre_remplir: false });
    const url = `/api/feuilles-temps/${f.json().id}/lignes`;
    expect(
      (
        await consultant.put(url, {
          lignes: [{ date: LUNDI, tache_id: mb.taches.Diagnostic, jours: 1 }],
        })
      ).statusCode,
    ).toBe(400);
    const r = await consultant.put(url, {
      lignes: [
        { date: LUNDI, tache_id: mb.taches.Diagnostic, heures: 2.5 },
        { date: LUNDI, tache_id: mb.taches.Diagnostic, heures: 1.5 },
        { date: "2026-11-03", tache_id: mb.taches.Diagnostic, heures: 1 },
      ],
    });
    expect(r.statusCode, r.body).toBe(200);
    const lignes = r.json().lignes as { date: string; jours: number; heures: number }[];
    expect(lignes).toEqual([
      expect.objectContaining({ date: LUNDI, jours: 0.5, heures: 4 }),
      expect.objectContaining({ date: "2026-11-03", jours: 0.13, heures: 1 }),
    ]);
  });
});
