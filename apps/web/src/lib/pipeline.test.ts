import { describe, expect, it } from "vitest";
import {
  etapeSuivante,
  hrefPipeline,
  lireFiltresPipeline,
  requeteOpportunites,
  SAISIE_OPPORTUNITE_VIDE,
  saisieDepuisOpportunite,
  validerIssue,
  validerOpportunite,
  type Opportunite,
} from "./pipeline";

const CLIENT = "0b6c2d1e-0000-4000-8000-000000000001";
const TYPE = "0b6c2d1e-0000-4000-8000-000000000002";

const saisie = { ...SAISIE_OPPORTUNITE_VIDE, intitule: " Plan stratégique ", client_id: CLIENT };

describe("filtres du pipeline", () => {
  it("lit les filtres connus et écarte le reste", () => {
    expect(lireFiltresPipeline({})).toEqual({ statut: "ouvertes", etape: "", client_id: "" });
    expect(
      lireFiltresPipeline({ statut: "perdues", etape: "negociation", client_id: CLIENT }),
    ).toEqual({ statut: "perdues", etape: "negociation", client_id: CLIENT });
    expect(lireFiltresPipeline({ statut: "x", etape: "y", client_id: "pas-un-uuid" })).toEqual({
      statut: "ouvertes",
      etape: "",
      client_id: "",
    });
  });

  it("traduit le statut pour l'API et omet « toutes »", () => {
    expect(requeteOpportunites({ statut: "ouvertes", etape: "", client_id: "" })).toBe(
      "statut=ouverte",
    );
    expect(requeteOpportunites({ statut: "toutes", etape: "qualification", client_id: "" })).toBe(
      "etape=qualification",
    );
  });

  it("ne répète pas le statut par défaut dans le lien", () => {
    expect(hrefPipeline({ statut: "ouvertes", etape: "", client_id: "" })).toBe("/pipeline");
    expect(hrefPipeline({ statut: "gagnees", etape: "", client_id: "" })).toBe(
      "/pipeline?statut=gagnees",
    );
  });
});

describe("validerOpportunite", () => {
  it("construit la charge de création avec l'étape et le montant en unités mineures", () => {
    const r = validerOpportunite({ ...saisie, montant_estime: "15 000 000" }, "creation");
    expect(r).toEqual({
      ok: true,
      charge: {
        intitule: "Plan stratégique",
        client_id: CLIENT,
        type_mission_id: null,
        montant_estime: 15_000_000,
        devise: "XOF",
        probabilite: 50,
        responsable_id: null,
        date_cloture_prevue: null,
        etape: "prospection",
      },
    });
  });

  it("convertit un montant en euros en centimes", () => {
    const r = validerOpportunite(
      { ...saisie, devise: "EUR", montant_estime: "1 234,50", type_mission_id: TYPE },
      "creation",
    );
    expect(r.ok && r.charge.montant_estime).toBe(123_450);
    expect(r.ok && r.charge.type_mission_id).toBe(TYPE);
  });

  it("exclut l'étape en modification (l'API la refuse)", () => {
    const r = validerOpportunite(saisie, "modification");
    expect(r.ok).toBe(true);
    if (r.ok) expect("etape" in r.charge).toBe(false);
  });

  it("signale les erreurs en français", () => {
    const r = validerOpportunite(
      {
        ...SAISIE_OPPORTUNITE_VIDE,
        montant_estime: "12,5",
        probabilite: "120",
        date_cloture_prevue: "31/12/2026",
      },
      "creation",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual(
        ["client_id", "date_cloture_prevue", "intitule", "montant_estime", "probabilite"].sort(),
      );
      expect(r.erreurs.montant_estime).toMatch(/sans décimale/);
    }
  });

  it("relit une opportunité existante en saisie modifiable", () => {
    const o = {
      intitule: "A",
      client_id: CLIENT,
      type_mission_id: null,
      montant_estime: 150_050,
      devise: "EUR",
      probabilite: 30,
      etape: "qualification",
      responsable_id: null,
      date_cloture_prevue: "2027-01-15",
    } as unknown as Opportunite;
    expect(saisieDepuisOpportunite(o)).toMatchObject({
      montant_estime: "1500,5",
      probabilite: "30",
      date_cloture_prevue: "2027-01-15",
    });
  });
});

describe("issue d'une opportunité", () => {
  it("accepte une opportunité gagnée sans motif", () => {
    expect(validerIssue("gagnee", "")).toEqual({ ok: true, charge: { statut: "gagnee" } });
  });

  it("exige le motif d'une perte", () => {
    expect(validerIssue("perdue", "   ").ok).toBe(false);
    expect(validerIssue("perdue", "x".repeat(1001)).ok).toBe(false);
    expect(validerIssue("perdue", " Prix trop élevé ")).toEqual({
      ok: true,
      charge: { statut: "perdue", motif_perte: "Prix trop élevé" },
    });
  });

  it("donne l'étape suivante de l'entonnoir", () => {
    expect(etapeSuivante("prospection")).toBe("qualification");
    expect(etapeSuivante("negociation")).toBeNull();
  });
});
