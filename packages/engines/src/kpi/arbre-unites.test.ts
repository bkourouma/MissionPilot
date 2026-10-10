import { describe, expect, it } from "vitest";
import {
  cleIncoherenceUniteKpi,
  exigerUnitesCoherentesKpi,
  messageUniteIncoherenteKpi,
  normaliserUniteKpi,
  unitesIncoherentesArbreKpi,
  type NoeudUniteKpi,
} from "./arbre-unites";
import { ErreurKpi } from "./erreurs";

const n = (
  id: string,
  parentId: string | null,
  unite: string | null,
  relation: "somme" | "produit" = "somme",
  libelle = id,
): NoeudUniteKpi => ({ id, parentId, relation, unite, libelle });

describe("cohérence des unités d'un arbre", () => {
  it("normalise : espaces superflus et casse sans effet, vide sans unité", () => {
    expect(normaliserUniteKpi("  M  FCFA ")).toBe("m fcfa");
    expect(normaliserUniteKpi(null)).toBe("");
    expect(normaliserUniteKpi(undefined)).toBe("");
    expect(normaliserUniteKpi("   ")).toBe("");
  });

  it("une somme d'unités identiques est cohérente (casse et espaces ignorés)", () => {
    const noeuds = [
      n("marge", null, "M FCFA"),
      n("ca", "marge", "m  fcfa"),
      n("couts", "marge", " M FCFA "),
    ];
    expect(unitesIncoherentesArbreKpi(noeuds)).toEqual([]);
    expect(() => exigerUnitesCoherentesKpi(noeuds)).not.toThrow();
  });

  it("une somme de jours et de pourcentages est signalée, levier par levier", () => {
    const noeuds = [
      n("racine", null, "M FCFA", "somme", "Trésorerie"),
      n("delai", "racine", "jours", "somme", "Délai"),
      n("taux", "racine", "%", "somme", "Taux"),
      n("ok", "racine", "M FCFA", "somme", "Encaissements"),
    ];
    const r = unitesIncoherentesArbreKpi(noeuds);
    expect(r).toEqual([
      { parentId: "racine", noeudId: "delai", uniteReference: "M FCFA", unite: "jours" },
      { parentId: "racine", noeudId: "taux", uniteReference: "M FCFA", unite: "%" },
    ]);
    expect(cleIncoherenceUniteKpi(r[0] as (typeof r)[number])).toBe("racine|delai");
    expect(messageUniteIncoherenteKpi(r[0] as (typeof r)[number], noeuds)).toBe(
      "Unités différentes : la somme n'a pas de sens. « Délai » est en « jours » alors que « Trésorerie » additionne des « M FCFA ». Liez un KPI de même unité, ou combinez les leviers par un produit.",
    );
  });

  it("sous un produit, des unités différentes sont légitimes", () => {
    const noeuds = [
      n("ca", null, "kFCFA", "produit"),
      n("volume", "ca", "unités"),
      n("panier", "ca", "kFCFA"),
    ];
    expect(unitesIncoherentesArbreKpi(noeuds)).toEqual([]);
  });

  it("sans unité connue : un levier libre ou sans unité n'est jamais signalé", () => {
    const noeuds = [
      n("racine", null, "jours"),
      n("libre", "racine", null),
      n("vide", "racine", "  "),
      n("jours", "racine", "jours"),
    ];
    expect(unitesIncoherentesArbreKpi(noeuds)).toEqual([]);
  });

  it("un parent sans unité prend celle du premier levier qui en a une", () => {
    const noeuds = [
      n("racine", null, null),
      n("a", "racine", null),
      n("b", "racine", "jours"),
      n("c", "racine", "%"),
    ];
    expect(unitesIncoherentesArbreKpi(noeuds)).toEqual([
      { parentId: "racine", noeudId: "c", uniteReference: "jours", unite: "%" },
    ]);
    // Aucune unité connue nulle part : rien à signaler.
    expect(unitesIncoherentesArbreKpi([n("r", null, null), n("x", "r", null)])).toEqual([]);
  });

  it("vérifie chaque niveau, pas seulement la racine ; un parent inconnu est ignoré", () => {
    const noeuds = [
      n("racine", null, "jours", "produit"),
      n("mid", "racine", "jours", "somme"),
      n("feuille", "mid", "%", "somme"),
      n("orphelin", "inconnu", "%", "somme"),
    ];
    expect(unitesIncoherentesArbreKpi(noeuds)).toEqual([
      { parentId: "mid", noeudId: "feuille", uniteReference: "jours", unite: "%" },
    ]);
  });

  it("exiger : lève ARBRE_UNITES avec le message français ; les incohérences déjà présentes sont tolérées", () => {
    const noeuds = [
      n("r", null, "jours", "somme", "Délai global"),
      n("x", "r", "%", "somme", "Taux"),
    ];
    let erreur: unknown;
    try {
      exigerUnitesCoherentesKpi(noeuds);
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toBeInstanceOf(ErreurKpi);
    expect((erreur as ErreurKpi).code).toBe("ARBRE_UNITES");
    expect((erreur as ErreurKpi).message).toContain("la somme n'a pas de sens");
    expect(() => exigerUnitesCoherentesKpi(noeuds, new Set(["r|x"]))).not.toThrow();
    // Sans libellé, l'identifiant sert de nom.
    const sansLibelle: NoeudUniteKpi[] = [
      { id: "r", parentId: null, relation: "somme", unite: "jours" },
      { id: "x", parentId: "r", relation: "somme", unite: "%" },
    ];
    expect(() => exigerUnitesCoherentesKpi(sansLibelle)).toThrow(/« x » est en « % »/);
  });
});
