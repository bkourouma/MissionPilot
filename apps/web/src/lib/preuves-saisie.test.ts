import { describe, expect, it } from "vitest";
import {
  codeDepuisLibelle,
  saisieAssertionVide,
  saisiePreuveVide,
  validerArbitrage,
  validerAssertion,
  validerDimension,
  validerLien,
  validerPreuve,
  type SaisieAssertion,
  type SaisiePreuve,
} from "./preuves-saisie";

const ID = "11111111-1111-4111-8111-111111111111";

const preuve = (surcharge: Partial<SaisiePreuve> = {}): SaisiePreuve => ({
  ...saisiePreuveVide("2026-10-08"),
  type_source: "entretien",
  source_precise: "  Entretien avec la DAF  ",
  fiabilite: "B",
  ...surcharge,
});

const assertion = (surcharge: Partial<SaisieAssertion> = {}): SaisieAssertion => ({
  ...saisieAssertionVide(),
  enonce: " La trésorerie est mal pilotée. ",
  classe_risque: "R2",
  ...surcharge,
});

describe("validerPreuve", () => {
  it("accepte une saisie minimale et nettoie les textes", () => {
    const r = validerPreuve(preuve(), false);
    expect(r).toEqual({
      ok: true,
      charge: {
        type_source: "entretien",
        source_precise: "Entretien avec la DAF",
        date_preuve: "2026-10-08",
        fiabilite: "B",
        extrait: null,
        fichier_id: null,
        reponse_id: null,
        document_id: null,
        dimensions: [],
        nominatif: false,
        accord_nominatif: false,
      },
    });
  });

  it("refuse les champs manquants ou hors liste, avec des messages en français", () => {
    const r = validerPreuve(
      preuve({ type_source: "", source_precise: " ", date_preuve: "2026-02-30", fiabilite: "E" }),
      false,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "date_preuve",
        "fiabilite",
        "source_precise",
        "type_source",
      ]);
      expect(r.erreurs.fiabilite).toContain("A à D");
    }
  });

  it("un lien exige un identifiant valide ; un seul lien est envoyé", () => {
    expect(validerPreuve(preuve({ lien_type: "document", lien_id: "" }), false).ok).toBe(false);
    expect(validerPreuve(preuve({ lien_type: "fichier", lien_id: "abc" }), false).ok).toBe(false);
    const ok = validerPreuve(preuve({ lien_type: "reponse", lien_id: ID }), false);
    expect(ok.ok && ok.charge).toMatchObject({
      reponse_id: ID,
      fichier_id: null,
      document_id: null,
    });
  });

  it("l'accord nominatif suppose un extrait nominatif", () => {
    expect(validerPreuve(preuve({ accord_nominatif: true }), false).ok).toBe(false);
    const ok = validerPreuve(preuve({ nominatif: true, accord_nominatif: true }), false);
    expect(ok.ok && ok.charge).toMatchObject({ nominatif: true, accord_nominatif: true });
  });

  it("une correction exige un motif ; la création n'en envoie pas", () => {
    expect(validerPreuve(preuve(), true).ok).toBe(false);
    const ok = validerPreuve(preuve({ motif: " Source recoupée " }), true);
    expect(ok.ok && ok.charge.motif).toBe("Source recoupée");
    const creation = validerPreuve(preuve({ motif: "ignoré" }), false);
    expect(creation.ok && "motif" in creation.charge).toBe(false);
  });

  it("dédoublonne les dimensions et plafonne leur nombre", () => {
    const ok = validerPreuve(preuve({ dimensions: ["a", "a", "b"] }), false);
    expect(ok.ok && ok.charge.dimensions).toEqual(["a", "b"]);
    const trop = validerPreuve(
      preuve({ dimensions: Array.from({ length: 21 }, (_, i) => `d${i}`) }),
      false,
    );
    expect(trop.ok).toBe(false);
  });
});

describe("validerAssertion", () => {
  it("accepte une assertion simple", () => {
    expect(validerAssertion(assertion(), false)).toEqual({
      ok: true,
      charge: {
        enonce: "La trésorerie est mal pilotée.",
        rattachement_type: null,
        rattachement_code: null,
        livrable: null,
        classe_risque: "R2",
        statut: "brouillon",
        avis_expert: false,
        avis_expert_motif: null,
        signer_avis: false,
      },
    });
  });

  it("le rattachement va par paire", () => {
    expect(validerAssertion(assertion({ rattachement_type: "risque" }), false).ok).toBe(false);
    expect(validerAssertion(assertion({ rattachement_code: "R-12" }), false).ok).toBe(false);
    const ok = validerAssertion(
      assertion({ rattachement_type: "risque", rattachement_code: " R-12 " }),
      false,
    );
    expect(ok.ok && ok.charge).toMatchObject({
      rattachement_type: "risque",
      rattachement_code: "R-12",
    });
  });

  it("l'avis d'expert se justifie ; la signature n'existe qu'avec l'avis", () => {
    expect(validerAssertion(assertion({ avis_expert: true }), false).ok).toBe(false);
    const signe = validerAssertion(
      assertion({ avis_expert: true, avis_expert_motif: "Terrain", signer_avis: true }),
      false,
    );
    expect(signe.ok && signe.charge).toMatchObject({
      avis_expert: true,
      avis_expert_motif: "Terrain",
      signer_avis: true,
    });
    const orphelin = validerAssertion(
      assertion({ signer_avis: true, avis_expert_motif: "x" }),
      false,
    );
    expect(orphelin.ok && orphelin.charge).toMatchObject({
      signer_avis: false,
      avis_expert_motif: null,
    });
  });

  it("classe de risque obligatoire, motif exigé en correction", () => {
    expect(validerAssertion(assertion({ classe_risque: "" }), false).ok).toBe(false);
    expect(validerAssertion(assertion({ classe_risque: "R9" }), false).ok).toBe(false);
    expect(validerAssertion(assertion(), true).ok).toBe(false);
    const ok = validerAssertion(assertion({ motif: "Reformulation" }), true);
    expect(ok.ok && ok.charge.motif).toBe("Reformulation");
  });
});

describe("lien, arbitrage et dimension", () => {
  it("validerLien", () => {
    expect(validerLien({ preuve_id: "", sens: "pour" }).ok).toBe(false);
    expect(validerLien({ preuve_id: ID, sens: "peut-être" }).ok).toBe(false);
    expect(validerLien({ preuve_id: ID, sens: "contre" })).toEqual({
      ok: true,
      charge: { preuve_id: ID, sens: "contre" },
    });
  });

  it("validerArbitrage exige une décision et un motif", () => {
    expect(validerArbitrage({ decision: "", motif: "" }, ID).ok).toBe(false);
    expect(validerArbitrage({ decision: "contradiction_levee", motif: "  " }, ID).ok).toBe(false);
    expect(validerArbitrage({ decision: "contradiction_levee", motif: " Confirmé " }, ID)).toEqual({
      ok: true,
      charge: { preuve_id: ID, decision: "contradiction_levee", motif: "Confirmé" },
    });
  });

  it("le code d'une dimension se déduit du libellé", () => {
    expect(codeDepuisLibelle("Ressources humaines")).toBe("ressources_humaines");
    expect(codeDepuisLibelle("  Marché & Concurrence (Afrique) ")).toBe(
      "marche_concurrence_afrique",
    );
    expect(codeDepuisLibelle("Éthique")).toBe("ethique");
    expect(validerDimension({ libelle: "Gouvernance", code: "" })).toEqual({
      ok: true,
      charge: { code: "gouvernance", libelle: "Gouvernance" },
    });
    expect(validerDimension({ libelle: "", code: "" }).ok).toBe(false);
    expect(validerDimension({ libelle: "Finance", code: "Fin ance" }).ok).toBe(false);
    expect(validerDimension({ libelle: "???", code: "" }).ok).toBe(false);
  });
});
