import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@missionpilot/shared";
import {
  droitsReferentiel,
  fusionnerTaux,
  lireTypeFiltre,
  SAISIE_COLLABORATEUR_VIDE,
  validerCollaborateur,
  validerCouts,
  validerGrade,
  validerTauxGrade,
  type Grade,
} from "./collaborateurs";

describe("droitsReferentiel (FIN-02)", () => {
  const voient = (r: Role) => droitsReferentiel([r]).voirFinances;

  it("réserve coûts et taux aux associés et gestionnaires", () => {
    expect(ROLES.filter(voient)).toEqual(["associe", "gestionnaire"]);
  });

  it("ne permet la saisie des coûts qu'avec taux.gerer et finance.lire", () => {
    expect(ROLES.filter((r) => droitsReferentiel([r]).gererTaux)).toEqual([
      "associe",
      "gestionnaire",
    ]);
  });

  it("laisse le responsable des ressources gérer le référentiel sans voir les finances", () => {
    expect(droitsReferentiel(["ressources"])).toEqual({
      ecrireCollaborateurs: true,
      voirFinances: false,
      gererTaux: false,
      gererGrades: false,
    });
  });

  it("cumule les droits de plusieurs rôles", () => {
    expect(droitsReferentiel(["ressources", "gestionnaire"]).voirFinances).toBe(true);
    expect(droitsReferentiel([]).voirFinances).toBe(false);
  });
});

describe("fusionnerTaux", () => {
  const grade: Grade = {
    id: "g1",
    code: "senior",
    libelle: "Senior",
    ordre: 2,
    actif: true,
    a_valider: false,
  };

  it("associe le taux au grade par identifiant", () => {
    expect(
      fusionnerTaux([grade], [{ id: "g1", taux_vente_standard: 250_000, devise: "XOF" }]),
    ).toEqual([{ ...grade, taux_vente_standard: 250_000, devise: "XOF" }]);
  });

  it("laisse un grade sans taux à null", () => {
    expect(fusionnerTaux([grade], [])[0]).toMatchObject({ taux_vente_standard: null });
  });
});

describe("validerCollaborateur", () => {
  it("construit les listes et la capacité", () => {
    const r = validerCollaborateur({
      ...SAISIE_COLLABORATEUR_VIDE,
      nom: " Koffi ",
      capacite_pct: "80",
      competences: "stratégie, finance",
      langues: "français; anglais",
    });
    expect(r).toEqual({
      ok: true,
      charge: {
        nom: "Koffi",
        grade_id: null,
        type: "interne",
        capacite_pct: 80,
        competences: ["stratégie", "finance"],
        secteurs: [],
        langues: ["français", "anglais"],
      },
    });
  });

  it("ne produit aucun champ financier", () => {
    const r = validerCollaborateur({ ...SAISIE_COLLABORATEUR_VIDE, nom: "A" });
    expect(r.ok && Object.keys(r.charge).some((k) => /cout|taux/.test(k))).toBe(false);
  });

  it("borne la capacité entre 0 et 100", () => {
    for (const v of ["101", "-1", "50,5", "x", ""]) {
      const r = validerCollaborateur({ ...SAISIE_COLLABORATEUR_VIDE, nom: "A", capacite_pct: v });
      expect(r.ok).toBe(false);
    }
  });

  it("lit le filtre de type de l'URL", () => {
    expect(lireTypeFiltre("externe")).toBe("externe");
    expect(lireTypeFiltre("autre")).toBeUndefined();
    expect(lireTypeFiltre(undefined)).toBeUndefined();
  });
});

describe("validerCouts", () => {
  const base = {
    cout_journalier: "",
    taux_vente_specifique: "",
    cout_achat: "",
    devise: "XOF",
    depuis_le: "2026-01-01",
  };

  it("convertit en unités mineures selon la devise", () => {
    expect(validerCouts({ ...base, cout_journalier: "150 000" })).toEqual({
      ok: true,
      charge: {
        cout_journalier: 150_000,
        taux_vente_specifique: null,
        cout_achat: null,
        devise: "XOF",
        depuis_le: "2026-01-01",
      },
    });
    const eur = validerCouts({ ...base, devise: "EUR", taux_vente_specifique: "1 234,50" });
    expect(eur.ok && eur.charge.taux_vente_specifique).toBe(123_450);
  });

  it("exige au moins un montant et une date d'effet", () => {
    const r = validerCouts(base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.global).toBe("Renseignez au moins un montant.");
    const d = validerCouts({ ...base, cout_journalier: "1", depuis_le: "" });
    expect(!d.ok && d.erreurs.depuis_le).toBeTruthy();
  });

  it("refuse des décimales en franc CFA", () => {
    const r = validerCouts({ ...base, cout_journalier: "100,5" });
    expect(!r.ok && r.erreurs.cout_journalier).toMatch(/entier/);
  });
});

describe("grades", () => {
  it("valide la création et la modification", () => {
    expect(validerGrade({ code: "senior", libelle: "Senior", ordre: "2" }, true)).toEqual({
      ok: true,
      charge: { code: "senior", libelle: "Senior", ordre: 2 },
    });
    expect(validerGrade({ code: "X Y", libelle: "Senior", ordre: "2" }, false)).toEqual({
      ok: true,
      charge: { libelle: "Senior", ordre: 2 },
    });
    expect(validerGrade({ code: "X Y", libelle: "", ordre: "-1" }, true).ok).toBe(false);
  });

  it("valide un taux de grade, vide pour le retirer", () => {
    expect(validerTauxGrade("250 000", "XOF")).toEqual({
      ok: true,
      charge: { taux_vente_standard: 250_000, devise: "XOF" },
    });
    expect(validerTauxGrade("", "EUR")).toEqual({
      ok: true,
      charge: { taux_vente_standard: null, devise: "EUR" },
    });
    expect(validerTauxGrade("1,5", "XOF").ok).toBe(false);
  });
});
