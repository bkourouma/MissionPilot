import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, MOT_DE_PASSE_TEST, type Contexte } from "./helpers.js";
import { creerMissionSignee, TOUS_LES_ROLES } from "./missions-outils.js";
import {
  attendre,
  preparerFacturation,
  viderEmailsEnFile,
  type CabinetFacturation,
} from "./facturation-outils.js";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Paramètres A", false);
  b = await preparerFacturation(ctx, "Cabinet Paramètres B", false);
});
afterAll(async () => {
  // Alerte IBAN des associés mise en file (M3) : base de test partagée, rien ne doit rester.
  await viderEmailsEnFile(a.cabinetId);
  await ctx.fermer();
});

describe("paramètres de facturation (FIN-07)", () => {
  it("valeurs de départ : TVA 18 % à valider, retenue désactivée, numérotation FA/AV", async () => {
    const r = await a.gestionnaire.get("/api/parametres-facturation");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      personnalises: false,
      valeurs_validees: false,
      taux_tva_defaut: 18,
      taux_tva_autorises: [0, 18],
      retenue_active: false,
      retenue_base: "HT",
      prefixe_facture: "FA",
      prefixe_avoir: "AV",
      chiffres_numero: 5,
      delai_paiement_jours: 30,
    });
  });

  it("droits par champ : identité et IBAN → cabinet.gerer ; TVA, retenue, délai → facture.emettre", async () => {
    expect(
      (
        await a.gestionnaire.patch("/api/parametres-facturation", {
          iban: "CI93CI0000000000000000",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await a.gestionnaire.patch("/api/parametres-facturation", { prefixe_facture: "FAC" }))
        .statusCode,
    ).toBe(403);
    const ops = await a.gestionnaire.patch("/api/parametres-facturation", {
      taux_tva_autorises: [0, 9, 18],
      retenue_active: true,
      retenue_taux: 7.5,
      delai_paiement_jours: 45,
      valeurs_validees: true,
    });
    expect(ops.statusCode).toBe(200);
    expect(ops.json()).toMatchObject({ personnalises: true, taux_tva_autorises: [0, 9, 18] });
    const id = await a.associe.patch("/api/parametres-facturation", {
      raison_sociale: "Cabinet A (fictif)",
      iban: "ci93 ci00 0000 0000 0000",
      // Coordonnées bancaires : reconfirmation (mot de passe seul, la 2FA n'étant pas active).
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(id.statusCode).toBe(200);
    expect(id.json().iban).toBe("CI93CI00000000000000");
    expect(id.json().delai_paiement_jours).toBe(45);
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      const lit = ["associe", "directeur_mission", "chef_mission", "gestionnaire"].includes(role);
      expect((await u.get("/api/parametres-facturation")).statusCode, role).toBe(lit ? 200 : 403);
      const ecrit = ["associe", "gestionnaire"].includes(role);
      expect(
        (await u.patch("/api/parametres-facturation", { delai_paiement_jours: 30 })).statusCode,
        role,
      ).toBe(ecrit ? 200 : 403);
    }
  });

  it("validation : IBAN, TVA par défaut hors des taux autorisés, préfixes identiques, champ inconnu", async () => {
    const p = (corps: unknown) => a.associe.patch("/api/parametres-facturation", corps);
    expect((await p({ iban: "pas un iban" })).statusCode).toBe(400);
    expect((await p({ taux_tva_defaut: 5 })).statusCode).toBe(400);
    expect((await p({ prefixe_avoir: "FA" })).statusCode).toBe(400);
    expect((await p({ prefixe_facture: "fa" })).statusCode).toBe(400);
    expect((await p({ raison_sociale: "A\nB" })).statusCode).toBe(400);
    expect((await p({ inconnu: 1 })).statusCode).toBe(400);
    expect((await p({})).statusCode).toBe(400);
  });

  it("isolation : chaque cabinet a ses paramètres", async () => {
    const vueB = (await b.associe.get("/api/parametres-facturation")).json();
    expect(vueB.personnalises).toBe(false);
    expect(vueB.raison_sociale).toBeNull();
  });
});

describe("taux négociés par client (FIN-02)", () => {
  it("création, doublon, validité, modification ; réservés à taux.gerer + finance.lire", async () => {
    const r = await a.gestionnaire.post(`/api/clients/${a.clientId}/taux`, {
      grade_id: a.grades.senior,
      taux: 150_000,
      valide_du: "2026-01-01",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ grade_code: "senior", taux: 150_000, devise: "XOF" });
    const doublon = await a.gestionnaire.post(`/api/clients/${a.clientId}/taux`, {
      grade_id: a.grades.senior,
      taux: 160_000,
      valide_du: "2026-01-01",
    });
    expect(doublon.statusCode).toBe(409);
    expect(
      (
        await a.gestionnaire.post(`/api/clients/${a.clientId}/taux`, {
          grade_id: a.grades.senior,
          taux: 1,
          valide_du: "2027-01-01",
          valide_au: "2026-01-01",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.gestionnaire.post(`/api/clients/${a.clientId}/taux`, {
          grade_id: a.grades.senior,
          taux: 1,
          valide_du: "1999-01-01",
        })
      ).statusCode,
    ).toBe(400);
    const maj = await a.gestionnaire.patch(`/api/taux-clients/${r.json().id}`, { taux: 155_000 });
    expect(maj.statusCode).toBe(200);
    expect(maj.json().taux).toBe(155_000);
    expect(
      (await a.gestionnaire.patch(`/api/taux-clients/${r.json().id}`, { valide_au: "2025-01-01" }))
        .statusCode,
    ).toBe(400);
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      const droit = ["associe", "gestionnaire"].includes(role);
      expect((await u.get(`/api/clients/${a.clientId}/taux`)).statusCode, role).toBe(
        droit ? 200 : 403,
      );
      expect(
        (await u.patch(`/api/taux-clients/${r.json().id}`, { taux: 155_000 })).statusCode,
        role,
      ).toBe(droit ? 200 : 403);
    }
  });

  it("isolation : client, grade et taux d'un autre cabinet", async () => {
    const t = await a.associe.post(`/api/clients/${a.clientId}/taux`, {
      grade_id: a.grades.manager,
      taux: 250_000,
    });
    expect(t.statusCode).toBe(201);
    expect((await b.associe.get(`/api/clients/${a.clientId}/taux`)).statusCode).toBe(404);
    expect(
      (
        await b.associe.post(`/api/clients/${a.clientId}/taux`, {
          grade_id: b.grades.senior,
          taux: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await b.associe.post(`/api/clients/${b.clientId}/taux`, {
          grade_id: a.grades.senior,
          taux: 1,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await b.associe.patch(`/api/taux-clients/${t.json().id}`, { taux: 1 })).statusCode,
    ).toBe(404);
  });

  it("proposition : le taux négocié valide à la date de référence remplace le standard", async () => {
    const c = await preparerFacturation(ctx, "Cabinet Négocié Proposition", false);
    attendre(
      201,
      await c.associe.post(`/api/clients/${c.clientId}/taux`, {
        grade_id: c.grades.senior,
        taux: 123_000,
        valide_du: "2026-01-01",
        valide_au: "2026-12-31",
      }),
      "taux",
    );
    const opp = await c.chef.post("/api/opportunites", {
      client_id: c.clientId,
      intitule: "Plan stratégique négocié",
      type_mission_id: c.typePlanId,
    });
    attendre(201, opp, "opportunité");
    const p2026 = await c.chef.post(`/api/opportunites/${opp.json().id}/propositions`, {
      date_reference: "2026-06-01",
    });
    attendre(201, p2026, "proposition");
    const vue = (await c.associe.get(`/api/propositions/${p2026.json().id}`)).json();
    expect(vue.taux.senior).toBe(123_000);
    // Hors validité : taux standard du grade.
    const p2027 = await c.chef.post(`/api/opportunites/${opp.json().id}/propositions`, {
      date_reference: "2027-06-01",
    });
    const standard = (await c.associe.get(`/api/propositions/${p2027.json().id}`)).json();
    expect(standard.taux.senior).not.toBe(123_000);
    expect(standard.taux.senior).toBeGreaterThan(0);
  });

  it("budget signé : négocié prioritaire sur le standard, après les taux imposés à la signature", async () => {
    const c = await preparerFacturation(ctx, "Cabinet Négocié Budget", false);
    attendre(
      201,
      await c.associe.post(`/api/clients/${c.clientId}/taux`, {
        grade_id: c.grades.senior,
        taux: 111_000,
      }),
      "taux",
    );
    const prix = async (signature: Record<string, unknown>) => {
      const m = await creerMissionSignee(c, {}, signature);
      const budget = (await c.associe.get(`/api/missions/${m.id}/budget`)).json();
      return budget.versions[0].lignes.find(
        (l: { cle: string }) => l.cle === "honoraires:grade:senior",
      )?.prix_journalier;
    };
    expect(await prix({})).toBe(111_000);
    expect(await prix({ taux_vente: { senior: 222_000 } })).toBe(222_000);
  });
});
