import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";
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
let consultant: ApiUtilisateur & { collaborateurId: string };
let gestionnaire: ApiUtilisateur;
let feuilleMars: string;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Clôture A");
  b = await preparerCabinet(ctx, "Cabinet Clôture B");
  m = await missionTemps(
    a,
    { Diagnostic: { senior: 10 } },
    { debut: "2025-03-03", fin: "2025-05-30" },
  );
  consultant = await consultantAffecte(a, m, { Diagnostic: 10 });
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  feuilleMars = await saisirEtSoumettre(consultant, "2025-03-03", [
    { date: "2025-03-03", tache_id: m.taches.Diagnostic, jours: 1 },
  ]);
});
afterAll(() => ctx.fermer());

const realise = async () =>
  (await a.directeur.get(`/api/missions/${m.id}/suivi`)).json().arbre.realise as number;

describe("clôture mensuelle (TPS-09)", () => {
  it("refuse la clôture d'un mois non terminé, ou avec des feuilles non validées", async () => {
    expect((await gestionnaire.post("/api/temps/periodes/2099-01/cloturer")).statusCode).toBe(409);
    expect((await consultant.post("/api/temps/periodes/2025-03/cloturer")).statusCode).toBe(403);
    expect((await gestionnaire.post("/api/temps/periodes/2025-13/cloturer")).statusCode).toBe(400);
    const r = await gestionnaire.post("/api/temps/periodes/2025-03/cloturer");
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("FEUILLES_EN_COURS");
  });

  it("clôture : feuilles verrouillées, saisie et validation de ces dates refusées", async () => {
    attendre(
      200,
      await a.chef.post(`/api/feuilles-temps/${feuilleMars}/valider`, {}),
      "validation",
    );
    const r = await gestionnaire.post("/api/temps/periodes/2025-03/cloturer");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      mois: "2025-03",
      statut: "cloturee",
      feuilles_verrouillees: 1,
    });
    expect((await gestionnaire.post("/api/temps/periodes/2025-03/cloturer")).statusCode).toBe(409);
    expect((await consultant.get(`/api/feuilles-temps/${feuilleMars}`)).json().statut).toBe(
      "verrouillee",
    );
    const periodes = (await consultant.get("/api/temps/periodes?annee=2025")).json().elements as {
      mois: string;
      statut: string;
    }[];
    expect(periodes.find((p) => p.mois === "2025-03")?.statut).toBe("cloturee");
    // Saisie sur une date clôturée : refusée par l'API et par la base.
    const f = await consultant.post("/api/feuilles-temps", { semaine: "2025-03-10" });
    expect(f.statusCode, f.body).toBe(201);
    expect(f.json().lignes).toEqual([]);
    const saisie = await consultant.put(`/api/feuilles-temps/${f.json().id}/lignes`, {
      lignes: [{ date: "2025-03-11", tache_id: m.taches.Diagnostic, jours: 1 }],
    });
    expect(saisie.statusCode).toBe(409);
    expect(saisie.json().erreur.code).toBe("PERIODE_CLOTUREE");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO lignes_temps (cabinet_id, feuille_id, date, mission_id, tache_id, centiemes)
           VALUES ($1, $2, '2025-03-11', $3, $4, 100)`,
          [a.cabinetId, f.json().id, m.id, m.taches.Diagnostic],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPT03" });
    // Isolation : la clôture de A ne concerne pas B.
    const pb = (await b.associe.get("/api/temps/periodes?annee=2025")).json().elements as {
      mois: string;
      statut: string;
    }[];
    expect(pb.find((p) => p.mois === "2025-03")?.statut).toBe("ouverte");
  });

  it("correction tracée : demande, valideur distinct, effet sur le réalisé", async () => {
    expect(await realise()).toBe(1);
    const d = await consultant.post("/api/temps/corrections", {
      collaborateur_id: consultant.collaborateurId,
      date: "2025-03-03",
      tache_id: m.taches.Diagnostic,
      jours: 0.5,
      motif: "Demi-journée seulement",
    });
    expect(d.statusCode, d.body).toBe(201);
    expect(d.json()).toMatchObject({
      statut: "demandee",
      ancienne_valeur: 1,
      nouvelle_valeur: 0.5,
    });
    // Une seule demande en attente par case ; motif obligatoire.
    const doublon = await consultant.post("/api/temps/corrections", {
      collaborateur_id: consultant.collaborateurId,
      date: "2025-03-03",
      tache_id: m.taches.Diagnostic,
      jours: 0,
      motif: "Autre",
    });
    expect(doublon.statusCode).toBe(409);
    expect(
      (
        await consultant.post("/api/temps/corrections", {
          collaborateur_id: consultant.collaborateurId,
          date: "2025-03-03",
          tache_id: m.taches.Diagnostic,
          jours: 0,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await consultant.post(`/api/temps/corrections/${d.json().id}/valider`)).statusCode,
    ).toBe(403);
    expect((await b.associe.post(`/api/temps/corrections/${d.json().id}/valider`)).statusCode).toBe(
      404,
    );
    const v = await gestionnaire.post(`/api/temps/corrections/${d.json().id}/valider`);
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json().statut).toBe("validee");
    expect(await realise()).toBe(0.5);
    // Décidée : immuable.
    expect(
      (await gestionnaire.post(`/api/temps/corrections/${d.json().id}/rejeter`, { motif: "x" }))
        .statusCode,
    ).toBe(409);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE corrections_temps SET nouvelle_centiemes = 100 WHERE id = $1", [
          d.json().id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPT04" });
    const liste = (await consultant.get("/api/temps/corrections")).json().elements as {
      id: string;
    }[];
    expect(liste.map((x) => x.id)).toContain(d.json().id);
    expect((await b.associe.get("/api/temps/corrections")).json().elements).toEqual([]);
  });

  it("le demandeur ne décide jamais de sa demande ; correction inutile sur des temps ouverts", async () => {
    const d = await a.associe.post("/api/temps/corrections", {
      collaborateur_id: consultant.collaborateurId,
      date: "2025-03-04",
      tache_id: m.taches.Diagnostic,
      jours: 1,
      motif: "Journée oubliée",
    });
    expect(d.statusCode, d.body).toBe(201);
    expect(d.json().ancienne_valeur).toBe(0);
    const auto = await a.associe.post(`/api/temps/corrections/${d.json().id}/valider`);
    expect(auto.statusCode).toBe(403);
    expect(auto.json().erreur.code).toBe("AUTO_VALIDATION");
    expect(
      (await gestionnaire.post(`/api/temps/corrections/${d.json().id}/rejeter`, {})).statusCode,
    ).toBe(400);
    const rejet = await gestionnaire.post(`/api/temps/corrections/${d.json().id}/rejeter`, {
      motif: "Non justifiée",
    });
    expect(rejet.json()).toMatchObject({ statut: "rejetee", motif_rejet: "Non justifiée" });
    // Avril : ni clôturé ni validé → corriger la feuille directement.
    const inutile = await consultant.post("/api/temps/corrections", {
      collaborateur_id: consultant.collaborateurId,
      date: "2025-04-01",
      tache_id: m.taches.Diagnostic,
      jours: 1,
      motif: "x",
    });
    expect(inutile.statusCode).toBe(409);
    expect(inutile.json().erreur.code).toBe("CORRECTION_INUTILE");
    // Pour autrui, sans droit de valider : refusé.
    expect(
      (
        await gestionnaire.post("/api/temps/corrections", {
          collaborateur_id: consultant.collaborateurId,
          date: "2025-03-03",
          tache_id: m.taches.Diagnostic,
          jours: 1,
          motif: "x",
        })
      ).statusCode,
    ).toBe(403);
  });

  it("réouverture : associé seulement, motif obligatoire, journalisée", async () => {
    expect(
      (await gestionnaire.post("/api/temps/periodes/2025-03/rouvrir", { motif: "x" })).statusCode,
    ).toBe(403);
    expect((await a.associe.post("/api/temps/periodes/2025-03/rouvrir", {})).statusCode).toBe(400);
    const r = await a.associe.post("/api/temps/periodes/2025-03/rouvrir", {
      motif: "Erreur de facturation",
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      statut: "ouverte",
      motif_reouverture: "Erreur de facturation",
    });
    expect(
      (await a.associe.post("/api/temps/periodes/2025-03/rouvrir", { motif: "x" })).statusCode,
    ).toBe(409);
    const audit = (await a.associe.get("/api/audit?entite=periode_temps")).json().elements as {
      action: string;
    }[];
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["cloture", "reouverture"]));
  });
});
