import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  besoinGeneration,
  echeanceModifiable,
  echeancesFacturables,
  messageEcheancier,
  peutGererEcheancier,
  SAISIE_ECHEANCE_VIDE,
  SAISIE_GENERATION_VIDE,
  saisieDepuisEcheance,
  validerEcheance,
  validerGeneration,
  validerModificationEcheance,
  validerRegie,
  type Echeance,
} from "./echeancier";

const MOI = "moi";
const e: Echeance = {
  id: "e1",
  mission_id: "m1",
  ordre: 1,
  type: "acompte",
  libelle: "Acompte",
  montant: 300000,
  pourcentage: 30,
  devise: "XOF",
  date_prevue: "2026-10-01",
  jalon_id: null,
  statut: "a_facturer",
  periode_debut: null,
  periode_fin: null,
  facture_id: null,
};

describe("peutGererEcheancier", () => {
  const signee = { statut: "signee" as const, chef_id: MOI, directeur_id: null };
  it("ouvre au gestionnaire et au chef responsable, après signature", () => {
    expect(peutGererEcheancier(signee, ["gestionnaire"], "x")).toBe(true);
    expect(peutGererEcheancier(signee, ["chef_mission"], MOI)).toBe(true);
    expect(peutGererEcheancier(signee, ["chef_mission"], "x")).toBe(false);
    expect(peutGererEcheancier(signee, ["consultant"], MOI)).toBe(false);
    expect(peutGererEcheancier({ ...signee, statut: "proposition" }, ["associe"], MOI)).toBe(false);
  });
});

describe("état des échéances", () => {
  it("distingue les échéances modifiables et facturables", () => {
    expect(echeanceModifiable(e)).toBe(true);
    expect(echeanceModifiable({ ...e, facture_id: "f" })).toBe(false);
    expect(echeanceModifiable({ ...e, statut: "facturee" })).toBe(false);
    expect(
      echeancesFacturables([
        e,
        { ...e, id: "e2", statut: "prevue" },
        { ...e, id: "e3", facture_id: "f" },
      ]).map((x) => x.id),
    ).toEqual(["e1"]);
  });
});

describe("validerEcheance", () => {
  const s = { ...SAISIE_ECHEANCE_VIDE, libelle: "Solde", valeur: "70", date_prevue: "2026-12-31" };

  it("accepte un pourcentage du budget signé", () => {
    expect(validerEcheance(s, "XOF")).toEqual({
      ok: true,
      charge: {
        type: "jalon",
        libelle: "Solde",
        pourcentage: 70,
        date_prevue: "2026-12-31",
        jalon_id: null,
      },
    });
  });

  it("accepte un montant", () => {
    const r = validerEcheance(
      { ...s, mode: "montant", valeur: "1 500 000", jalon_id: "j1" },
      "XOF",
    );
    expect(r.ok && r.charge).toMatchObject({ montant: 1500000, jalon_id: "j1" });
  });

  it("refuse la régie, un pourcentage nul ou au-delà de 100, une date absente", () => {
    const r = validerEcheance({ ...s, type: "regie", valeur: "0", date_prevue: "" }, "XOF");
    expect(r.ok ? [] : Object.keys(r.erreurs).sort()).toEqual(["date_prevue", "type", "valeur"]);
    expect(validerEcheance({ ...s, valeur: "101" }, "XOF").ok).toBe(false);
    expect(validerEcheance({ ...s, mode: "montant", valeur: "10,5" }, "XOF").ok).toBe(false);
  });

  it("modifie une échéance de régie sans toucher son montant", () => {
    const r = validerModificationEcheance(
      { ...saisieDepuisEcheance({ ...e, type: "regie", pourcentage: null }), valeur: "n'importe" },
      "XOF",
      "regie",
    );
    expect(r.ok && r.charge).toEqual({
      libelle: "Acompte",
      date_prevue: "2026-10-01",
      jalon_id: null,
      statut: "a_facturer",
    });
    expect(
      validerModificationEcheance(
        { ...saisieDepuisEcheance(e), statut: "facturee" },
        "XOF",
        "acompte",
      ).ok,
    ).toBe(false);
  });

  it("reprend une échéance en pourcentage ou en montant", () => {
    expect(saisieDepuisEcheance(e)).toMatchObject({ mode: "pourcentage", valeur: "30" });
    expect(
      saisieDepuisEcheance({ ...e, pourcentage: null, devise: "EUR", montant: 150050 }),
    ).toMatchObject({
      mode: "montant",
      valeur: "1500,5",
    });
  });
});

describe("génération et régie", () => {
  it("indique ce que demande chaque mode", () => {
    expect(besoinGeneration("forfait")).toBe("aucun");
    expect(besoinGeneration("forfait_variable")).toBe("part_variable");
    expect(besoinGeneration("abonnement")).toBe("abonnement");
    expect(besoinGeneration("regie")).toBe("regie");
  });

  it("envoie un corps vide pour un forfait", () => {
    expect(validerGeneration("forfait", SAISIE_GENERATION_VIDE, "XOF")).toEqual({
      ok: true,
      charge: {},
    });
  });

  it("valide la part variable et l'abonnement", () => {
    expect(validerGeneration("forfait_variable", SAISIE_GENERATION_VIDE, "XOF").ok).toBe(false);
    const pv = validerGeneration(
      "forfait_variable",
      {
        ...SAISIE_GENERATION_VIDE,
        pv_montant_maximum: "500 000",
        pv_atteinte: "80",
        pv_date: "2027-01-15",
      },
      "XOF",
    );
    expect(pv).toEqual({
      ok: true,
      charge: {
        part_variable: {
          libelle: "Part variable",
          montant_maximum: 500000,
          atteinte: 80,
          date: "2027-01-15",
        },
      },
    });
    const ab = validerGeneration(
      "abonnement",
      {
        ...SAISIE_GENERATION_VIDE,
        ab_montant: "100 000",
        ab_date_debut: "2026-11-01",
        ab_nombre: "12",
      },
      "XOF",
    );
    expect(ab.ok && ab.charge).toEqual({
      abonnement: {
        libelle: "Abonnement",
        montant_periodique: 100000,
        date_debut: "2026-11-01",
        nombre_periodes: 12,
        periodicite: "mensuelle",
      },
    });
    expect(
      validerGeneration("abonnement", { ...SAISIE_GENERATION_VIDE, ab_nombre: "200" }, "XOF").ok,
    ).toBe(false);
  });

  it("valide la date de régie", () => {
    expect(validerRegie("")).toEqual({ ok: true, charge: {} });
    expect(validerRegie("2026-10-31")).toEqual({ ok: true, charge: { jusqu_au: "2026-10-31" } });
    expect(validerRegie("31/10/2026").ok).toBe(false);
  });
});

describe("messageEcheancier", () => {
  it("explique le plafond du budget signé", () => {
    const m = messageEcheancier(
      new ErreurApi("ECHEANCIER_DEPASSE_BUDGET", "x", 409),
      1_000_000,
      "XOF",
    );
    expect(m).toContain("budget signé (1 000 000 FCFA d'honoraires)");
    expect(m).toMatch(/révision du budget/);
    expect(
      messageEcheancier(new ErreurApi("ECHEANCIER_DEPASSE_BUDGET", "x", 409), null, "XOF"),
    ).toMatch(/budget signé\./);
    expect(messageEcheancier(new ErreurApi("CONFLIT", "Existe déjà.", 409), null, "XOF")).toBe(
      "Existe déjà.",
    );
    expect(messageEcheancier(new ErreurApi("AUTRE", "x", 500), null, "XOF")).toBeNull();
  });
});
