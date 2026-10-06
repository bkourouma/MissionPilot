import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { MAX_CORRECTIONS_PAR_MESURE } from "../src/kpi/mesures.js";
import { creerKpi, INCONNU, mesurer, preparerKpi, type ScenarioKpi } from "./kpi-outils.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Saisie des mesures (KPI-02) côté cabinet : droits, contrôle de période,
 * unicité de la mesure active d'une date, corrections et annulations en
 * AJOUT SEUL (jamais d'UPDATE), traçabilité, isolation et IDOR.
 */

let ctx: Contexte;
let s: ScenarioKpi;
let kpiId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerKpi(ctx, "KPI mesures");
  kpiId = (await creerKpi(s.a.chef, s.missionId)).id;
}, 180_000);
afterAll(() => ctx.fermer());

const lignes = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);

describe("saisie d'une mesure", () => {
  it("nominal : période (moteur), origine, auteur, journal", async () => {
    const r = await s.a.chef.post(`/api/kpi/${kpiId}/mesures`, {
      date_mesure: "2026-01-31",
      valeur: 950.5,
      commentaire: "Clôture comptable de janvier",
      justificatif: "Balance générale au 31/01",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      kpi_id: kpiId,
      date_mesure: "2026-01-31",
      periode: "2026-01",
      valeur: 950.5,
      annulation: false,
      active: true,
      origine: "cabinet",
      saisie_par: { id: s.a.chef.utilisateurId },
      commentaire: "Clôture comptable de janvier",
    });
    const journal = await lignes(
      "SELECT action, utilisateur_id FROM journal_audit WHERE entite_id = $1",
      [r.json().id],
    );
    expect(journal).toEqual([
      { action: "kpi.mesure.saisir", utilisateur_id: s.a.chef.utilisateurId },
    ]);
  });

  it("contrôle de période : avant le suivi, dans le futur, valeur invalide, même date", async () => {
    const url = `/api/kpi/${kpiId}/mesures`;
    const avant = await s.a.chef.post(url, { date_mesure: "2025-12-31", valeur: 1 });
    expect(avant.statusCode).toBe(400);
    expect(avant.json().erreur.code).toBe("KPI_HORS_PERIODE");
    const futur = await s.a.chef.post(url, { date_mesure: "2099-01-01", valeur: 1 });
    expect(futur.json().erreur.code).toBe("KPI_HORS_PERIODE");
    for (const corps of [
      { date_mesure: "2026-02-30", valeur: 1 },
      { date_mesure: "2026-02-10", valeur: 1e21 },
      { date_mesure: "2026-02-10", valeur: "12" },
      { date_mesure: "2026-02-10" },
    ]) {
      expect((await s.a.chef.post(url, corps)).statusCode).toBe(400);
    }
    const double = await s.a.chef.post(url, { date_mesure: "2026-01-31", valeur: 3 });
    expect(double.statusCode).toBe(409);
    expect(double.json().erreur.code).toBe("KPI_MESURE_EN_DOUBLE");
  });

  it("droits : équipe et propriétaire saisissent ; lire toutes les missions ne suffit pas", async () => {
    expect((await api(ctx).post(`/api/kpi/${kpiId}/mesures`, {})).statusCode).toBe(401);
    await mesurer(s.consultantEquipe, kpiId, "2026-02-05", 10);
    expect(
      (
        await s.consultantHors.post(`/api/kpi/${kpiId}/mesures`, {
          date_mesure: "2026-02-06",
          valeur: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await s.gestionnaire.post(`/api/kpi/${kpiId}/mesures`, {
          date_mesure: "2026-02-06",
          valeur: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.expertExterne.post(`/api/kpi/${kpiId}/mesures`, {
          date_mesure: "2026-02-06",
          valeur: 1,
        })
      ).statusCode,
    ).toBe(403);
    // Le gestionnaire (sans kpi.*) ne devient pas propriétaire pour autant (400).
    expect(
      (await s.a.chef.patch(`/api/kpi/${kpiId}`, { proprietaire_id: s.gestionnaire.utilisateurId }))
        .statusCode,
    ).toBe(400);
    // Propriétaire membre de l'équipe : il saisit.
    attendre(
      200,
      await s.a.chef.patch(`/api/kpi/${kpiId}`, {
        proprietaire_id: s.consultantEquipe.utilisateurId,
      }),
      "propriétaire",
    );
    await mesurer(s.consultantEquipe, kpiId, "2026-02-06", 11);
    await s.a.chef.patch(`/api/kpi/${kpiId}`, { proprietaire_id: null });
  });

  it("autre cabinet et identifiants inconnus : 404 (saisie, correction, historique)", async () => {
    const m = await mesurer(s.a.chef, kpiId, "2026-02-07", 12);
    for (const r of [
      await s.b.associe.post(`/api/kpi/${kpiId}/mesures`, { date_mesure: "2026-02-08", valeur: 1 }),
      await s.b.associe.post(`/api/kpi/mesures/${m.id}/corrections`, {
        date_mesure: "2026-02-07",
        valeur: 1,
        motif: "x",
      }),
      await s.b.associe.post(`/api/kpi/mesures/${m.id}/annulation`, { motif: "x" }),
      await s.b.associe.get(`/api/kpi/${kpiId}/mesures`),
      await s.consultantHors.post(`/api/kpi/mesures/${m.id}/annulation`, { motif: "x" }),
      await s.a.chef.post(`/api/kpi/mesures/${INCONNU}/annulation`, { motif: "x" }),
    ]) {
      expect(r.statusCode).toBe(404);
    }
  });
});

describe("corrections et annulations : historique en ajout seul", () => {
  it("correction : nouvelle ligne qui remplace, motif obligatoire, une seule fois", async () => {
    const m1 = await mesurer(s.a.chef, kpiId, "2026-03-31", 800);
    const url = `/api/kpi/mesures/${m1.id}/corrections`;
    expect((await s.a.chef.post(url, { date_mesure: "2026-03-31", valeur: 820 })).statusCode).toBe(
      400,
    );
    const r = await s.a.chef.post(url, {
      date_mesure: "2026-03-31",
      valeur: 820,
      motif: "Facture oubliée",
    });
    expect(r.statusCode).toBe(201);
    const m2 = r.json();
    expect(m2).toMatchObject({
      remplace_id: m1.id,
      valeur: 820,
      motif: "Facture oubliée",
      active: true,
    });
    const encore = await s.a.chef.post(url, {
      date_mesure: "2026-03-31",
      valeur: 830,
      motif: "Bis",
    });
    expect(encore.statusCode).toBe(409);
    // L'ancienne ligne existe toujours, inchangée, et n'est plus active.
    const brute = await lignes("SELECT valeur::text FROM kpi_mesures WHERE id = $1", [m1.id]);
    expect(brute).toEqual([{ valeur: "800" }]);
    const hist = (await s.a.chef.get(`/api/kpi/${kpiId}/mesures?limite=100`)).json().elements;
    const parId = new Map(hist.map((x: { id: string }) => [x.id, x]));
    expect(parId.get(m1.id)).toMatchObject({ active: false, valeur: 800 });
    expect(parId.get(m2.id)).toMatchObject({ active: true, valeur: 820 });
    const journal = await lignes("SELECT action, details FROM journal_audit WHERE entite_id = $1", [
      m2.id,
    ]);
    expect(journal[0]).toMatchObject({
      action: "kpi.mesure.corriger",
      details: { remplace_id: m1.id, motif: "Facture oubliée" },
    });
  });

  it("annulation : ligne sans valeur ; la date peut ensuite être ressaisie", async () => {
    const m = await mesurer(s.a.chef, kpiId, "2026-04-15", 5);
    const r = await s.a.chef.post(`/api/kpi/mesures/${m.id}/annulation`, {
      motif: "Saisie en double",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ annulation: true, valeur: null, remplace_id: m.id });
    expect(
      (
        await s.a.chef.post(`/api/kpi/mesures/${r.json().id}/corrections`, {
          date_mesure: "2026-04-15",
          valeur: 1,
          motif: "x",
        })
      ).statusCode,
    ).toBe(409);
    await mesurer(s.a.chef, kpiId, "2026-04-15", 6);
  });

  it("non-régression : une chaîne de corrections est bornée (API et base)", async () => {
    let m = await mesurer(s.a.chef, kpiId, "2026-05-31", 1);
    for (let i = 1; i <= MAX_CORRECTIONS_PAR_MESURE; i++) {
      const r = await s.a.chef.post(`/api/kpi/mesures/${m.id}/corrections`, {
        date_mesure: "2026-05-31",
        valeur: i + 1,
        motif: `Correction ${i}`,
      });
      expect(r.statusCode, `correction ${i}`).toBe(201);
      m = r.json();
    }
    const refus = await s.a.chef.post(`/api/kpi/mesures/${m.id}/corrections`, {
      date_mesure: "2026-05-31",
      valeur: 99,
      motif: "Une de trop",
    });
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("KPI_TROP_DE_CORRECTIONS");
    // Le rang est calculé par la base : un rang fourni est ignoré, la borne tient hors API.
    const rangs = await lignes(
      "SELECT max(rang_correction)::int AS max FROM kpi_mesures WHERE kpi_id = $1",
      [kpiId],
    );
    expect(rangs).toEqual([{ max: MAX_CORRECTIONS_PAR_MESURE }]);
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO kpi_mesures (cabinet_id, kpi_id, date_mesure, valeur, remplace_id, motif,
             origine, saisie_par, rang_correction)
           VALUES ($1, $2, '2026-05-31', 5, $3, 'Direct', 'cabinet', $4, 0)`,
          [s.a.cabinetId, kpiId, m.id, s.a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPK07" });
    // Issue : annuler la dernière correction, puis ressaisir la date (nouvelle chaîne).
    const annulation = await s.a.chef.post(`/api/kpi/mesures/${m.id}/annulation`, { motif: "Bis" });
    expect(annulation.statusCode).toBe(201);
    await mesurer(s.a.chef, kpiId, "2026-05-31", 7);
  });

  it("aucune modification ni suppression, même par le propriétaire de la base", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE kpi_mesures SET valeur = 0 WHERE kpi_id = $1", [kpiId]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("DELETE FROM kpi_mesures WHERE kpi_id = $1", [kpiId]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      proprietaire((c) => c.query("UPDATE kpi_mesures SET valeur = 0 WHERE kpi_id = $1", [kpiId])),
    ).rejects.toMatchObject({ code: "MPK05" });
    await expect(
      proprietaire((c) => c.query("DELETE FROM kpi_mesures WHERE kpi_id = $1", [kpiId])),
    ).rejects.toMatchObject({ code: "MPK05" });
  });

  it("historique paginé par curseur, du plus récent au plus ancien", async () => {
    const p1 = (await s.a.chef.get(`/api/kpi/${kpiId}/mesures?limite=2`)).json();
    expect(p1.elements).toHaveLength(2);
    expect(p1.curseur_suivant).not.toBeNull();
    const p2 = (
      await s.a.chef.get(`/api/kpi/${kpiId}/mesures?limite=2&curseur=${p1.curseur_suivant}`)
    ).json();
    const ids = new Set([...p1.elements, ...p2.elements].map((x: { id: string }) => x.id));
    expect(ids.size).toBe(4);
    expect((await s.a.chef.get(`/api/kpi/${kpiId}/mesures?curseur=abc`)).statusCode).toBe(400);
  });
});

describe("KPI inactif et mission clôturée", () => {
  it("KPI désactivé : saisie refusée (409)", async () => {
    const k = await creerKpi(s.a.chef, s.missionId, { libelle: "Ancien indicateur" });
    await s.a.chef.patch(`/api/kpi/${k.id}`, { actif: false });
    const r = await s.a.chef.post(`/api/kpi/${k.id}/mesures`, {
      date_mesure: "2026-02-01",
      valeur: 1,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("KPI_INACTIF");
  });

  it("mission clôturée : ni saisie ni gestion (409)", async () => {
    const m = await creerMission(s.a, { intitule: "Mission close" });
    const k = await creerKpi(s.a.chef, m.id);
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [m.id, s.a.associeId],
      ),
    );
    expect(
      (await s.a.chef.post(`/api/kpi/${k.id}/mesures`, { date_mesure: "2026-02-01", valeur: 1 }))
        .statusCode,
    ).toBe(409);
    expect((await s.a.chef.patch(`/api/kpi/${k.id}`, { libelle: "Nouveau" })).statusCode).toBe(409);
    expect((await s.a.chef.get(`/api/kpi/${k.id}`)).statusCode).toBe(200);
  });
});
