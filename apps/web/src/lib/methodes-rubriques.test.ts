import { describe, expect, it } from "vitest";
import {
  NIVEAUX_ANCRAGE,
  saisieDepuisRubrique,
  saisieRubriqueVide,
  validerRubriqueCreation,
  validerRubriqueModification,
  type SaisieRubrique,
} from "./methodes-rubriques";

const complete = (): SaisieRubrique => ({
  ...saisieRubriqueVide(),
  code: "gouvernance",
  libelle: "Gouvernance",
  ancrages: NIVEAUX_ANCRAGE.map((n) => ({ description: `Niveau ${n} observable`, exemples: [] })),
});

describe("rubrique à ancrages", () => {
  it("part de cinq niveaux vides", () => {
    const s = saisieRubriqueVide();
    expect(s.ancrages).toHaveLength(5);
    expect(s.ancrages.every((a) => a.description === "" && a.exemples.length === 0)).toBe(true);
  });

  it("construit le corps de création avec dimension et brique facultatives", () => {
    const r = validerRubriqueCreation(complete());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge.dimension).toBeNull();
      expect(r.charge.brique_id).toBeNull();
      expect(r.charge.ancrages.map((a) => a.niveau)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("ignore un exemple entièrement vide et garde les exemples complets", () => {
    const s = complete();
    s.ancrages[2] = {
      description: "Niveau 3 observable",
      exemples: [
        { contexte: "", texte: "" },
        { contexte: "PME agricole", texte: "Le conseil se réunit chaque trimestre" },
      ],
    };
    const ok = validerRubriqueCreation({
      ...s,
      dimension: "gouvernance",
      brique_id: "0b1c2d3e-0000-4000-8000-000000000001",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.charge.ancrages[2]?.exemples).toEqual([
        { contexte: "PME agricole", texte: "Le conseil se réunit chaque trimestre" },
      ]);
      expect(ok.charge.dimension).toBe("gouvernance");
    }
  });

  it("signale le niveau qui n'est pas décrit, avec son numéro", () => {
    const s = complete();
    s.ancrages[3] = { description: "  ", exemples: [] };
    const r = validerRubriqueCreation(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.niveau4).toContain("Décrire");
  });

  it("refuse un exemple à moitié rempli", () => {
    const s = complete();
    s.ancrages[0] = { description: "Niveau 1", exemples: [{ contexte: "PME", texte: "" }] };
    const r = validerRubriqueCreation(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.niveau1).toContain("contexte ET");
  });

  it("refuse un libellé vide, un code invalide et une dimension invalide", () => {
    const r = validerRubriqueCreation({
      ...complete(),
      libelle: "",
      code: "Mauvais Code",
      dimension: "Dim Invalide",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["code", "dimension", "libelle"]);
  });

  it("modifie en place sans envoyer le code", () => {
    const id = "0b1c2d3e-0000-4000-8000-000000000001";
    const s = saisieDepuisRubrique({
      id: "r1",
      brique_id: id,
      brique_code: "atelier",
      code: "gouvernance",
      libelle: "Gouvernance",
      dimension: "gouvernance",
      ancrages: NIVEAUX_ANCRAGE.map((n) => ({
        niveau: n,
        description: `Niveau ${n}`,
        exemples: n === 5 ? [{ contexte: "Groupe", texte: "Comité d'audit" }] : [],
      })),
    });
    expect(s.brique_id).toBe(id);
    expect(s.ancrages[4]?.exemples).toEqual([{ contexte: "Groupe", texte: "Comité d'audit" }]);
    const r = validerRubriqueModification({ ...s, libelle: "Gouvernance du conseil" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge).not.toHaveProperty("code");
      expect(r.charge.libelle).toBe("Gouvernance du conseil");
      expect(r.charge.brique_id).toBe(id);
    }
  });

  it("rouvre une rubrique sans ancrage connu avec cinq niveaux vides", () => {
    const s = saisieDepuisRubrique({
      id: "r2",
      brique_code: null,
      code: "x",
      libelle: "X",
      dimension: null,
      ancrages: [],
    });
    expect(s.ancrages).toHaveLength(5);
    expect(s.brique_id).toBe("");
  });
});
