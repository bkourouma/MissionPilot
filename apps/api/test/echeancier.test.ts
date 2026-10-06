import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee, TOUS_LES_ROLES } from "./missions-outils.js";
import {
  attendre as attendreTemps,
  consultantAffecte,
  lignesSemaine,
  missionTemps,
  saisirEtSoumettre,
} from "./temps-outils.js";
import {
  aFacturer,
  attendre,
  emettreFacture,
  missionAvecEcheancier,
  preparerFacturation,
  type CabinetFacturation,
} from "./facturation-outils.js";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Échéancier A");
  b = await preparerFacturation(ctx, "Cabinet Échéancier B");
});
afterAll(() => ctx.fermer());

describe("échéancier de facturation (FIN-06, MIS-10)", () => {
  it("forfait : génération 30 % / 70 % du budget signé par le moteur, une seule fois", async () => {
    const m = await missionAvecEcheancier(a);
    expect(m.budget).toBe(15_600_000);
    expect(m.echeances.map((e) => [e.type, e.montant, e.statut])).toEqual([
      ["acompte", 4_680_000, "prevue"],
      ["jalon", 10_920_000, "prevue"],
    ]);
    const vue = (await a.chef.get(`/api/missions/${m.id}/echeancier`)).json();
    expect(vue).toMatchObject({ total: 15_600_000, depassement: 0, reste_a_planifier: 0 });
    expect(
      (await a.gestionnaire.post(`/api/missions/${m.id}/echeancier/generer`, {})).statusCode,
    ).toBe(409);
  });

  it("jalons personnalisés : pourcentages qui ne somment pas à 100 refusés par le moteur", async () => {
    const m = await creerMissionSignee(a);
    const r = await a.gestionnaire.post(`/api/missions/${m.id}/echeancier/generer`, {
      jalons: [
        { libelle: "Acompte", pourcentage: 40, date: "2026-10-01", type: "acompte" },
        { libelle: "Rapport", pourcentage: 40, date: "2026-12-01" },
      ],
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("POURCENTAGES_INVALIDES");
    const ok = await a.gestionnaire.post(`/api/missions/${m.id}/echeancier/generer`, {
      jalons: [
        { libelle: "Acompte", pourcentage: 33.33, date: "2026-10-01", type: "acompte" },
        { libelle: "Diagnostic", pourcentage: 33.33, date: "2026-11-15" },
        { libelle: "Rapport final", pourcentage: 33.34, date: "2027-01-29" },
      ],
    });
    expect(ok.statusCode).toBe(201);
    // Répartition sans perte (moteur) : la somme égale le budget signé.
    const total = ok
      .json()
      .elements.reduce((s: number, e: { montant: number }) => s + e.montant, 0);
    expect(total).toBe(15_600_000);
  });

  it("échéance saisie : pourcentage du budget (moteur), plafond du budget signé, modification et suppression", async () => {
    const m = await creerMissionSignee(a);
    const e = await a.chef.post(`/api/missions/${m.id}/echeances`, {
      type: "avancement",
      libelle: "Avancement 25 %",
      pourcentage: 25,
      date_prevue: "2026-12-15",
    });
    expect(e.statusCode).toBe(201);
    expect(e.json()).toMatchObject({ montant: 3_900_000, pourcentage: 25, statut: "prevue" });
    const trop = await a.chef.post(`/api/missions/${m.id}/echeances`, {
      type: "jalon",
      libelle: "Trop",
      montant: 11_700_001,
      date_prevue: "2027-01-15",
    });
    expect(trop.statusCode).toBe(409);
    expect(trop.json().erreur.code).toBe("ECHEANCIER_DEPASSE_BUDGET");
    expect(
      (
        await a.chef.post(`/api/missions/${m.id}/echeances`, {
          type: "jalon",
          libelle: "Deux",
          montant: 1,
          pourcentage: 1,
          date_prevue: "2027-01-15",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.chef.post(`/api/missions/${m.id}/echeances`, {
          type: "regie",
          libelle: "Régie",
          montant: 1,
          date_prevue: "2027-01-15",
        })
      ).statusCode,
    ).toBe(400);
    const maj = await a.chef.patch(`/api/echeances/${e.json().id}`, {
      montant: 5_000_000,
      statut: "a_facturer",
    });
    expect(maj.json()).toMatchObject({
      montant: 5_000_000,
      pourcentage: null,
      statut: "a_facturer",
    });
    expect(
      (await a.chef.patch(`/api/echeances/${e.json().id}`, { montant: 16_000_000 })).statusCode,
    ).toBe(409);
    expect((await a.chef.delete(`/api/echeances/${e.json().id}`)).statusCode).toBe(204);
  });

  it("une mission non signée n'a pas d'échéancier", async () => {
    const m = await creerMission(a);
    expect(
      (await a.gestionnaire.post(`/api/missions/${m.id}/echeancier/generer`, {})).statusCode,
    ).toBe(409);
  });

  it("abonnement et forfait avec part variable", async () => {
    const abo = await creerMissionSignee(a, { mode_facturation: "abonnement" });
    expect(
      (await a.gestionnaire.post(`/api/missions/${abo.id}/echeancier/generer`, {})).statusCode,
    ).toBe(400);
    const r = await a.gestionnaire.post(`/api/missions/${abo.id}/echeancier/generer`, {
      abonnement: {
        libelle: "Assistance mensuelle",
        montant_periodique: 1_000_000,
        date_debut: "2026-11-30",
        nombre_periodes: 12,
        periodicite: "mensuelle",
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().elements).toHaveLength(12);
    expect(r.json().elements[11]).toMatchObject({ type: "abonnement", date_prevue: "2027-10-30" });

    const pv = await creerMissionSignee(a, { mode_facturation: "forfait_variable" });
    const partVariable = {
      libelle: "Prime de résultat",
      montant_maximum: 3_000_000,
      atteinte: 50,
      date: "2027-03-31",
    };
    // Part fixe par défaut = budget signé : avec la part variable, le budget est dépassé.
    expect(
      (
        await a.gestionnaire.post(`/api/missions/${pv.id}/echeancier/generer`, {
          part_variable: partVariable,
        })
      ).statusCode,
    ).toBe(409);
    const ok = await a.gestionnaire.post(`/api/missions/${pv.id}/echeancier/generer`, {
      part_fixe: 12_000_000,
      part_variable: partVariable,
    });
    expect(ok.statusCode).toBe(201);
    expect(
      ok.json().elements.map((e: { type: string; montant: number }) => [e.type, e.montant]),
    ).toEqual([
      ["acompte", 3_600_000],
      ["jalon", 8_400_000],
      ["part_variable", 1_500_000],
    ]);
  });

  it("régie : échéances mensuelles sur les temps VALIDÉS (jours × taux), rattachés une seule fois", async () => {
    const m = await missionTemps(a, { Diagnostic: { senior: 10 } }, { intitule: "Régie test" });
    attendre(
      200,
      await a.directeur.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-10-01" }),
      "signature",
    );
    const senior = await consultantAffecte(a, m, { Diagnostic: 8 });
    const tache = m.taches.Diagnostic as string;
    const f1 = await saisirEtSoumettre(
      senior,
      "2026-11-02",
      lignesSemaine("2026-11-02", [{ tache_id: tache, jours: 3 }]),
    );
    attendreTemps(200, await a.chef.post(`/api/feuilles-temps/${f1}/valider`, {}), "validation");
    // Une feuille soumise non validée n'est pas facturable.
    await saisirEtSoumettre(
      senior,
      "2026-11-30",
      lignesSemaine("2026-11-30", [{ tache_id: tache, jours: 2 }]),
    );
    const budget = (await a.associe.get(`/api/missions/${m.id}/budget`)).json();
    const prix = budget.versions[0].lignes.find(
      (l: { cle: string }) => l.cle === "honoraires:grade:senior",
    ).prix_journalier as number;
    const r = await a.gestionnaire.post(`/api/missions/${m.id}/echeancier/regie`, {
      jusqu_au: "2026-12-31",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().elements).toHaveLength(1);
    expect(r.json().elements[0]).toMatchObject({
      type: "regie",
      statut: "a_facturer",
      date_prevue: "2026-11-30",
      periode_debut: "2026-11-02",
      periode_fin: "2026-11-04",
      montant: 3 * prix,
    });
    // Second passage : rien de nouveau (temps déjà rattachés).
    const encore = await a.gestionnaire.post(`/api/missions/${m.id}/echeancier/regie`, {});
    expect(encore.json().elements).toHaveLength(0);
    const rattaches = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT count(*)::int AS n FROM echeance_temps WHERE echeance_id = $1", [
            r.json().elements[0].id,
          ])
        ).rows[0].n,
    );
    expect(rattaches).toBeGreaterThan(0);
    // Facturée puis émise : les temps restent rattachés (ni détachables ni modifiés).
    const f = await a.gestionnaire.post(`/api/missions/${m.id}/factures`, {
      echeance_ids: [r.json().elements[0].id],
    });
    attendre(201, f, "facture");
    await emettreFacture(a, f.json().id);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("DELETE FROM echeance_temps WHERE echeance_id = $1", [r.json().elements[0].id]),
      ),
    ).rejects.toThrow(/figé/);
    // Une mission au forfait ne se facture pas en régie.
    const forfait = await creerMissionSignee(a);
    expect(
      (await a.gestionnaire.post(`/api/missions/${forfait.id}/echeancier/regie`, {})).statusCode,
    ).toBe(409);
  });

  it("matrice des droits : lecture facture.lire, gestion facture.emettre ou responsable de la mission", async () => {
    const m = await missionAvecEcheancier(a);
    const premiere = m.echeances[0]?.id as string;
    await aFacturer(a.gestionnaire, premiere);
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      const lecture = (await u.get(`/api/missions/${m.id}/echeancier`)).statusCode;
      const lit = ["associe", "directeur_mission", "gestionnaire"].includes(role);
      expect(lecture, role).toBe(lit ? 200 : role === "chef_mission" ? 404 : 403);
      // Montant au-delà du budget : 409 si le droit est accordé.
      const ecriture = (
        await u.post(`/api/missions/${m.id}/echeances`, {
          type: "jalon",
          libelle: "Test",
          montant: 1,
          date_prevue: "2027-01-01",
        })
      ).statusCode;
      const gere = ["associe", "directeur_mission", "gestionnaire"].includes(role);
      const voit = gere || role === "ressources";
      expect(ecriture, role).toBe(gere ? 409 : voit ? 403 : 404);
    }
    // Le chef désigné gère l'échéancier de sa mission.
    expect(
      (await a.chef.patch(`/api/echeances/${premiere}`, { libelle: "Acompte révisé" })).statusCode,
    ).toBe(200);
  });

  it("isolation : échéancier et échéances d'un autre cabinet → 404", async () => {
    const m = await missionAvecEcheancier(a);
    const id = m.echeances[0]?.id as string;
    expect((await b.associe.get(`/api/missions/${m.id}/echeancier`)).statusCode).toBe(404);
    expect((await b.associe.patch(`/api/echeances/${id}`, { libelle: "x" })).statusCode).toBe(404);
    expect((await b.associe.delete(`/api/echeances/${id}`)).statusCode).toBe(404);
    expect((await b.associe.post(`/api/missions/${m.id}/echeancier/generer`, {})).statusCode).toBe(
      404,
    );
  });
});
