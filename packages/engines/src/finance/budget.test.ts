import { describe, expect, it } from "vitest";
import {
  calculerBudget,
  comparerVersions,
  creerRevision,
  figerVersion,
  joursLigne,
  modifierLignesBudget,
  montantLigne,
  type LigneBudget,
  type VersionBudget,
} from "./budget";
import { montant } from "./monnaie";

const xof = (v: number) => montant(v, "XOF");
const auTemps = (jours: number, prix: number) => ({
  type: "jours" as const,
  jours,
  prixJournalier: xof(prix),
});
const forfait = (v: number) => ({ type: "forfait" as const, montant: xof(v) });

/*
 * Budget de référence (FCFA) :
 *   honoraires : 5 j × 600 000 + 12,5 j × 400 000          = 8 000 000 (17,5 j vendus)
 *   coûts      : 5 j × 300 000 + 12,5 j × 280 000          = 5 000 000
 *   débours    : 300 000 non refacturés, 450 000 refacturés
 *   sous-traitance                                        =   700 000
 *   marge = 8 000 000 − 5 000 000 − 300 000 − 700 000      = 2 000 000 (25 %)
 */
const lignes: LigneBudget[] = [
  {
    id: "h1",
    libelle: "Associé",
    nature: "honoraires",
    grade: "associe",
    valeur: auTemps(5, 600_000),
  },
  {
    id: "h2",
    libelle: "Consultant",
    nature: "honoraires",
    grade: "consultant",
    valeur: auTemps(12.5, 400_000),
  },
  { id: "c1", libelle: "Coût associé", nature: "cout_interne", valeur: auTemps(5, 300_000) },
  { id: "c2", libelle: "Coût consultant", nature: "cout_interne", valeur: auTemps(12.5, 280_000) },
  { id: "d1", libelle: "Billets d'avion", nature: "debours", valeur: forfait(300_000) },
  {
    id: "d2",
    libelle: "Hôtel refacturé",
    nature: "debours",
    refacturable: true,
    valeur: forfait(450_000),
  },
  { id: "s1", libelle: "Enquête terrain", nature: "sous_traitance", valeur: forfait(700_000) },
];

const initial: VersionBudget = {
  id: "v1",
  numero: 1,
  type: "initial",
  devise: "XOF",
  figee: false,
  lignes,
};

describe("calculerBudget (FIN-01)", () => {
  it("calcule honoraires, coûts, débours, sous-traitance et marge", () => {
    expect(calculerBudget(initial)).toEqual({
      devise: "XOF",
      honoraires: xof(8_000_000),
      coutsInternes: xof(5_000_000),
      deboursRefacturables: xof(450_000),
      deboursNonRefacturables: xof(300_000),
      sousTraitance: xof(700_000),
      marge: xof(2_000_000),
      tauxMarge: 0.25,
      joursVendus: 17.5,
      joursProduction: 17.5,
    });
  });

  it("accepte des honoraires au forfait", () => {
    const v: VersionBudget = {
      ...initial,
      lignes: [{ id: "f", libelle: "Forfait", nature: "honoraires", valeur: forfait(10_000_000) }],
    };
    const s = calculerBudget(v);
    expect(s.honoraires).toEqual(xof(10_000_000));
    expect(s.joursVendus).toBe(0);
    expect(s.tauxMarge).toBe(1);
  });

  it("protège la division par zéro quand il n'y a pas d'honoraires", () => {
    expect(calculerBudget({ ...initial, lignes: [] }).tauxMarge).toBeNull();
  });

  it("refuse une ligne dans une autre devise ou des jours invalides", () => {
    const ligneEur: LigneBudget = {
      id: "x",
      libelle: "x",
      nature: "honoraires",
      valeur: { type: "jours", jours: 1, prixJournalier: montant(100, "EUR") },
    };
    expect(() => montantLigne(ligneEur, "XOF")).toThrow(
      expect.objectContaining({ code: "DEVISE_DIFFERENTE" }),
    );
    const negative: LigneBudget = { ...ligneEur, valeur: auTemps(-1, 100) };
    expect(() => montantLigne(negative, "XOF")).toThrow(
      expect.objectContaining({ code: "NOMBRE_INVALIDE" }),
    );
    expect(joursLigne(lignes[4] as LigneBudget)).toBe(0);
  });
});

describe("versions de budget (FIN-03) : le budget signé ne change jamais en silence", () => {
  const signe = figerVersion(initial, "2026-10-06");

  it("fige la version à la signature sans modifier l'original", () => {
    expect(signe.figee).toBe(true);
    expect(signe.dateFigeage).toBe("2026-10-06");
    expect(initial.figee).toBe(false);
  });

  it("refuse toute modification d'une version figée", () => {
    const attendu = expect.objectContaining({ code: "BUDGET_FIGE" });
    expect(() => modifierLignesBudget(signe, [])).toThrow(attendu);
    expect(() => figerVersion(signe, "2026-10-07")).toThrow(attendu);
    expect(() => modifierLignesBudget(signe, [])).toThrow(/créer une révision motivée/);
    expect(signe.lignes).toBe(lignes);
  });

  it("modifie une version non figée en validant les lignes", () => {
    const modifiee = modifierLignesBudget(initial, lignes.slice(0, 2));
    expect(modifiee.lignes).toHaveLength(2);
    expect(() => figerVersion(initial, "2026-02-30")).toThrow(
      expect.objectContaining({ code: "DATE_INVALIDE" }),
    );
  });

  it("crée une révision motivée sans toucher la version signée", () => {
    expect(() => creerRevision(signe, { id: "v2", type: "revise", motif: "  " })).toThrow(
      expect.objectContaining({ code: "VERSION_INVALIDE" }),
    );
    const copie = creerRevision(signe, { id: "v2", type: "revise", motif: "Avenant n° 1" });
    expect(copie).toMatchObject({
      id: "v2",
      numero: 2,
      type: "revise",
      figee: false,
      motif: "Avenant n° 1",
    });
    expect(copie.lignes).toEqual(lignes);
    const atterrissage = creerRevision(copie, {
      id: "v3",
      type: "atterrissage",
      motif: "Atterrissage S6",
      lignes: lignes.slice(0, 1),
    });
    expect(atterrissage.numero).toBe(3);
    expect(atterrissage.lignes).toHaveLength(1);
    expect(signe.figee).toBe(true);
  });
});

describe("comparerVersions", () => {
  /*
   * Révision : consultant 12,5 j → 15 j (+2,5 j, +1 000 000) ; coût consultant
   * 12,5 j × 280 000 → 14 j × 250 000 (même montant 3 500 000, +1,5 j) ;
   * sous-traitance supprimée ; forfait de 500 000 ajouté.
   * Nouvelle marge : 9 500 000 − 5 000 000 − 300 000 = 4 200 000 (+2 200 000).
   */
  const revise: VersionBudget = {
    ...initial,
    id: "v2",
    numero: 2,
    type: "revise",
    lignes: [
      ...lignes.filter((l) => !["h2", "c2", "s1"].includes(l.id)),
      { id: "h2", libelle: "Consultant", nature: "honoraires", valeur: auTemps(15, 400_000) },
      {
        id: "c2",
        libelle: "Coût consultant",
        nature: "cout_interne",
        valeur: auTemps(14, 250_000),
      },
      {
        id: "h3",
        libelle: "Atelier supplémentaire",
        nature: "honoraires",
        valeur: forfait(500_000),
      },
    ],
  };

  it("donne les écarts par ligne et en synthèse", () => {
    const c = comparerVersions(initial, revise);
    const parId = new Map(c.lignes.map((l) => [l.id, l]));
    expect(c.lignes.map((l) => l.id)).toEqual(["h1", "h2", "c1", "c2", "d1", "d2", "s1", "h3"]);
    expect(parId.get("h1")?.statut).toBe("inchangee");
    expect(parId.get("h2")).toMatchObject({
      statut: "modifiee",
      ecartJours: 2.5,
      ecartMontant: xof(1_000_000),
    });
    expect(parId.get("c2")).toMatchObject({
      statut: "modifiee",
      ecartJours: 1.5,
      ecartMontant: xof(0),
    });
    expect(parId.get("s1")).toMatchObject({
      statut: "supprimee",
      montantApres: xof(0),
      ecartMontant: xof(-700_000),
    });
    expect(parId.get("h3")).toMatchObject({
      statut: "ajoutee",
      montantAvant: xof(0),
      ecartMontant: xof(500_000),
    });
    expect(c.ecartHonoraires).toEqual(xof(1_500_000));
    expect(c.ecartCoutsInternes).toEqual(xof(0));
    expect(c.ecartMarge).toEqual(xof(2_200_000));
    expect(c.ecartJoursVendus).toBe(2.5);
  });

  it("refuse de comparer deux devises", () => {
    expect(() => comparerVersions(initial, { ...initial, devise: "EUR", lignes: [] })).toThrow(
      expect.objectContaining({ code: "DEVISE_DIFFERENTE" }),
    );
  });
});
