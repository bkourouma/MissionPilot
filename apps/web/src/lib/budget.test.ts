import { describe, expect, it } from "vitest";
import {
  actionsBudget,
  budgetVisible,
  comparaisonVisible,
  droitsBudget,
  etatVersion,
  libelleVersion,
  lireComparaison,
  validerRevision,
  versionVisible,
  type Comparaison,
  type VersionBudget,
} from "./budget";

const version: VersionBudget = {
  id: "v1",
  numero: 1,
  type: "initial",
  devise: "XOF",
  figee: true,
  date_figeage: "2026-10-01",
  motif: null,
  role_approbateur: null,
  cree_le: "",
  validee_le: "",
  synthese: {
    devise: "XOF",
    jours_vendus: 20,
    honoraires: 7_000_000,
    debours_refacturables: 0,
    debours_non_refacturables: 100_000,
    couts_internes: 3_000_000,
    sous_traitance: 500_000,
    marge: 3_400_000,
    taux_marge: 0.48,
    jours_production: 20,
  },
  lignes: [
    {
      id: "a",
      cle: "honoraires:grade:senior",
      libelle: "Honoraires",
      nature: "honoraires",
      grade_code: "senior",
      jours: 20,
      refacturable: false,
      prix_journalier: 350_000,
      montant: 7_000_000,
    },
    {
      id: "b",
      cle: "cout_interne:grade:senior",
      libelle: "Coût",
      nature: "cout_interne",
      grade_code: "senior",
      jours: 20,
      refacturable: false,
      prix_journalier: 150_000,
      montant: 3_000_000,
    },
    {
      id: "c",
      cle: "sous_traitance:x",
      libelle: "Expert",
      nature: "sous_traitance",
      grade_code: null,
      jours: null,
      refacturable: false,
      montant_forfait: 500_000,
      montant: 500_000,
    },
  ],
};

describe("masquage financier du budget (FIN-02)", () => {
  it("montre tout à l'associé", () => {
    const v = versionVisible(version, droitsBudget(["associe"]));
    expect(v.lignes).toHaveLength(3);
    expect(v.synthese.marge).toBe(3_400_000);
  });

  it("retire coûts, sous-traitance et marge au directeur de mission, garde les honoraires", () => {
    const v = versionVisible(version, droitsBudget(["directeur_mission"]));
    expect(v.lignes.map((l) => l.nature)).toEqual(["honoraires"]);
    expect(v.lignes[0]?.prix_journalier).toBe(350_000);
    expect(v.synthese).toEqual({
      devise: "XOF",
      jours_vendus: 20,
      honoraires: 7_000_000,
      debours_refacturables: 0,
      debours_non_refacturables: 100_000,
    });
    const texte = JSON.stringify(v);
    expect(texte).not.toContain("3400000");
    expect(texte).not.toContain("150000");
  });

  it("ne garde que les jours pour le consultant", () => {
    const b = budgetVisible(
      {
        devise: "XOF",
        devise_reference: "XOF",
        taux_change: 1,
        reference_id: "v1",
        en_cours_id: null,
        versions: [version],
      },
      droitsBudget(["consultant"]),
    );
    const v = b.versions[0] as VersionBudget;
    expect(v.synthese).toEqual({ devise: "XOF", jours_vendus: 20 });
    expect(v.lignes).toEqual([
      {
        id: "a",
        cle: "honoraires:grade:senior",
        libelle: "Honoraires",
        nature: "honoraires",
        grade_code: "senior",
        jours: 20,
        refacturable: false,
      },
    ]);
  });

  it("filtre aussi la comparaison", () => {
    const c: Comparaison = {
      avant: { id: "v1", numero: 1, type: "initial" },
      apres: { id: "v2", numero: 2, type: "revise" },
      ecart_jours_vendus: 2,
      ecart_honoraires: 700_000,
      ecart_couts_internes: 300_000,
      ecart_marge: 400_000,
      lignes: [
        {
          cle: "h",
          libelle: "H",
          nature: "honoraires",
          statut: "modifiee",
          jours_avant: 20,
          jours_apres: 22,
          ecart_jours: 2,
          montant_avant: 1,
          montant_apres: 2,
          ecart_montant: 1,
        },
        {
          cle: "c",
          libelle: "C",
          nature: "cout_interne",
          statut: "modifiee",
          jours_avant: 20,
          jours_apres: 22,
          ecart_jours: 2,
        },
      ],
    };
    const chef = comparaisonVisible(c, droitsBudget(["chef_mission"]));
    expect(chef.ecart_marge).toBeUndefined();
    expect(chef.ecart_couts_internes).toBeUndefined();
    expect(chef.ecart_honoraires).toBe(700_000);
    expect(chef.lignes.map((l) => l.cle)).toEqual(["h"]);
    const consultant = comparaisonVisible(c, droitsBudget(["consultant"]));
    expect(consultant.ecart_honoraires).toBeUndefined();
    expect(consultant.lignes[0]?.ecart_montant).toBeUndefined();
  });
});

describe("actions sur le budget", () => {
  const signee = { statut: "en_cours" as const, modifiable: true };
  const U = "u-moi";
  const ctx = (directeurId: string | null, auteurEnCours: string | null = null) => ({
    utilisateurId: U,
    directeurId,
    auteurEnCours,
  });
  const enCours = { en_cours_id: "v2", reference_id: "v1" };
  const sansRevision = { en_cours_id: null, reference_id: "v1" };

  it("permet de réviser une mission signée sans révision en cours", () => {
    const a = actionsBudget(["chef_mission"], signee, sansRevision, ctx(null));
    expect(a).toMatchObject({ reviser: true, valider: false, abandonner: false });
  });

  it("réserve la validation au directeur de CETTE mission ou à un associé", () => {
    expect(actionsBudget(["chef_mission"], signee, enCours, ctx(U))).toMatchObject({
      reviser: false,
      valider: false,
      abandonner: true,
    });
    expect(actionsBudget(["directeur_mission"], signee, enCours, ctx(U)).valider).toBe(true);
    const autre = actionsBudget(["directeur_mission"], signee, enCours, ctx("u-autre"));
    expect(autre.valider).toBe(false);
    expect(autre.raisonValidation).toMatch(/directeur de la mission ou d'un associé/);
    expect(actionsBudget(["associe"], signee, enCours, ctx("u-autre")).valider).toBe(true);
  });

  it("interdit à l'auteur d'une révision de la valider, sauf associé", () => {
    const auteur = actionsBudget(["directeur_mission"], signee, enCours, ctx(U, U));
    expect(auteur.valider).toBe(false);
    expect(auteur.raisonValidation).toMatch(/auteur/);
    expect(actionsBudget(["associe"], signee, enCours, ctx(U, U)).valider).toBe(true);
  });

  it("refuse avant signature, après clôture ou sans droits d'écriture", () => {
    const avant = actionsBudget(
      ["associe"],
      { statut: "proposition", modifiable: true },
      { en_cours_id: null, reference_id: null },
      ctx(null),
    );
    expect(avant.reviser).toBe(false);
    expect(avant.raison).toMatch(/signature/);
    const close = actionsBudget(
      ["associe"],
      { statut: "cloturee", modifiable: false },
      sansRevision,
      ctx(null),
    );
    expect(close.reviser).toBe(false);
    expect(actionsBudget(["consultant"], signee, sansRevision, ctx(null))).toMatchObject({
      reviser: false,
      raison: null,
    });
  });

  it("exige le motif d'une révision", () => {
    expect(validerRevision({ motif: "  ", depuis_decoupage: true }).ok).toBe(false);
    expect(validerRevision({ motif: "Avenant n° 1", depuis_decoupage: false })).toEqual({
      ok: true,
      charge: { motif: "Avenant n° 1", depuis_decoupage: false },
    });
  });

  it("lit une comparaison valide seulement", () => {
    const versions = [{ id: "v1" }, { id: "v2" }];
    expect(lireComparaison({ avant: "v1", apres: "v2" }, versions)).toEqual({
      avant: "v1",
      apres: "v2",
    });
    expect(lireComparaison({ avant: "v1", apres: "v1" }, versions)).toBeNull();
    expect(lireComparaison({ avant: "v1", apres: "zz" }, versions)).toBeNull();
  });

  it("nomme les versions et leur état", () => {
    expect(libelleVersion(version)).toBe("V1 — Budget initial (signé)");
    expect(etatVersion(version, "v1", "v1").libelle).toBe("Figée — référence");
    expect(etatVersion(version, "v2", "v1").libelle).toBe("Figée — historique");
    expect(etatVersion({ figee: false, type: "revise" }, "v1", "v2").libelle).toBe(
      "En cours de révision",
    );
  });
});
