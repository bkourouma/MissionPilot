import { describe, expect, it } from "vitest";
import { PLAFONDS_DD } from "@missionpilot/shared";
import {
  cheminModelesDuDossier,
  deplacerPoint,
  optionsCategories,
  pointsParCategorie,
  saisieDepuisModele,
  saisieModeleVide,
  validerModele,
  type SaisieModele,
} from "./due-diligence-modeles";

const saisie = (extra: Partial<SaisieModele> = {}): SaisieModele => ({
  ...saisieModeleVide(),
  secteur_code: "citi_a",
  analyse: "pestel",
  points: [{ categorie: "politique", libelle: "  Quelle stabilité du cadre ?  " }],
  ...extra,
});

describe("modèles d'analyse sectoriels : saisie", () => {
  it("la saisie vide ne porte aucun contenu", () => {
    const v = saisieModeleVide();
    expect(v.points).toEqual([{ categorie: "", libelle: "" }]);
    expect(validerModele(v, false).ok).toBe(false);
  });

  it("création valide : libellés rognés, secteur et analyse transmis", () => {
    const r = validerModele(saisie(), false);
    expect(r).toEqual({
      ok: true,
      charge: {
        secteur_code: "citi_a",
        analyse: "pestel",
        points: [{ categorie: "politique", libelle: "Quelle stabilité du cadre ?" }],
      },
    });
  });

  it("création : la charge ne porte pas `actif` (schéma strict de l'API)", () => {
    const r = validerModele(saisie(), false);
    expect(r.ok && "actif" in r.charge).toBe(false);
  });

  it("refuse secteur ou analyse manquants, point incomplet, catégorie d'une autre analyse", () => {
    const sansChoix = validerModele(saisie({ secteur_code: "", analyse: "" }), false);
    expect(sansChoix.ok).toBe(false);
    if (!sansChoix.ok) expect(Object.keys(sansChoix.erreurs)).toEqual(["secteur_code", "analyse"]);
    for (const points of [
      [{ categorie: "politique", libelle: "" }],
      [{ categorie: "", libelle: "Quoi ?" }],
      [{ categorie: "forces", libelle: "Hors PESTEL ?" }],
      [{ categorie: "politique", libelle: "x".repeat(301) }],
      [],
      [{ categorie: "", libelle: "  " }],
    ]) {
      const r = validerModele(saisie({ points }), false);
      expect(r.ok, JSON.stringify(points)).toBe(false);
      if (!r.ok) expect(r.erreurs.points).toBeTruthy();
    }
  });

  it("ignore les lignes entièrement vides et respecte le plafond de points", () => {
    const r = validerModele(
      saisie({
        points: [
          { categorie: "", libelle: "" },
          { categorie: "juridique", libelle: "Licences ?" },
        ],
      }),
      false,
    );
    expect(r.ok && r.charge.points).toHaveLength(1);
    const trop = Array.from({ length: PLAFONDS_DD.points_par_modele + 1 }, (_, i) => ({
      categorie: "politique",
      libelle: `Point ${i}`,
    }));
    expect(validerModele(saisie({ points: trop }), false).ok).toBe(false);
  });

  it("nouvelle version : motif obligatoire, secteur et analyse non transmis, retrait par actif", () => {
    const base = saisieDepuisModele({
      id: "m1",
      secteur_code: "citi_a",
      analyse: "swot",
      version: 2,
      points: [{ categorie: "forces", libelle: "Quels atouts ?" }],
      actif: true,
    });
    const sansMotif = validerModele(base, true);
    expect(sansMotif.ok).toBe(false);
    if (!sansMotif.ok) expect(sansMotif.erreurs.motif).toBeTruthy();
    const retrait = validerModele({ ...base, actif: false, motif: " Retiré. " }, true);
    expect(retrait).toEqual({
      ok: true,
      charge: {
        points: [{ categorie: "forces", libelle: "Quels atouts ?" }],
        actif: false,
        motif: "Retiré.",
      },
    });
  });
});

describe("modèles d'analyse sectoriels : aides", () => {
  it("catégories de chaque analyse, en français ; rien sans analyse", () => {
    expect(optionsCategories("")).toEqual([]);
    expect(optionsCategories("swot").map((o) => o.libelle)).toEqual([
      "Forces",
      "Faiblesses",
      "Opportunités",
      "Menaces",
    ]);
  });

  it("déplace un point sans muter l'entrée ni sortir des bornes", () => {
    const l = ["a", "b", "c"];
    expect(deplacerPoint(l, 0, 1)).toEqual(["b", "a", "c"]);
    expect(deplacerPoint(l, 0, -1)).toEqual(l);
    expect(deplacerPoint(l, 2, 1)).toEqual(l);
    expect(l).toEqual(["a", "b", "c"]);
  });

  it("regroupe les points par catégorie dans l'ordre de l'analyse", () => {
    const g = pointsParCategorie("swot", [
      { categorie: "menaces", libelle: "M1" },
      { categorie: "forces", libelle: "F1" },
      { categorie: "menaces", libelle: "M2" },
    ]);
    expect(g.map((x) => [x.libelle, x.points])).toEqual([
      ["Forces", ["F1"]],
      ["Menaces", ["M1", "M2"]],
    ]);
  });

  it("chemin du modèle applicable à un dossier", () => {
    expect(cheminModelesDuDossier("d 1", "pestel")).toBe(
      "/api/dd/dossiers/d%201/modeles-secteur?analyse=pestel",
    );
    expect(cheminModelesDuDossier("d1")).toBe("/api/dd/dossiers/d1/modeles-secteur");
  });
});
