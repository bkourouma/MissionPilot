import { describe, expect, it } from "vitest";
import {
  calculerFacture,
  creerAvoir,
  montantRemise,
  repartirRemiseGlobale,
  type DonneesFacture,
  type FactureCalculee,
} from "./facture";
import { montant, type Montant } from "./monnaie";

const xof = (v: number) => montant(v, "XOF");
const eur = (v: number) => montant(v, "EUR");

describe("calculerFacture (FIN-07)", () => {
  it("calcule HT, TVA, retenue et net à payer", () => {
    // 10 j × 450 000 = 4 500 000 HT ; TVA 18 % = 810 000 ; TTC 5 310 000 ;
    // retenue 7,5 % sur HT = 337 500 ; net à payer 4 972 500 FCFA.
    const f = calculerFacture({
      devise: "XOF",
      lignes: [{ libelle: "Conseil", quantite: 10, prixUnitaire: xof(450_000), tauxTva: 18 }],
      retenues: [{ libelle: "Retenue à la source", taux: 7.5, base: "HT" }],
    });
    expect(f.totalHT).toEqual(xof(4_500_000));
    expect(f.tva).toEqual([{ taux: 18, base: xof(4_500_000), montant: xof(810_000) }]);
    expect(f.totalTTC).toEqual(xof(5_310_000));
    expect(f.retenues[0]).toMatchObject({ assiette: xof(4_500_000), montant: xof(337_500) });
    expect(f.netAPayer).toEqual(xof(4_972_500));
    expect(f.nature).toBe("facture");
  });

  /*
   * A : 3 × 100 000 (TVA 18)                → net 300 000
   * B : 1 × 50 000 (TVA 0)                  → net  50 000
   * C : 2 × 25 000 − 10 % (TVA 18)          → net  45 000
   * Remise globale 5 % de 395 000 = 19 750, répartie 15 000 / 2 500 / 2 250.
   * HT : 285 000 + 47 500 + 42 750 = 375 250.
   * TVA 18 % sur 327 750 = 58 995 ; TVA 0 % sur 47 500 = 0. TTC 434 245.
   * Retenue 5 % sur TTC = 21 712,25 → 21 712 ; net 412 533.
   */
  const donnees: DonneesFacture = {
    devise: "XOF",
    lignes: [
      { libelle: "A", quantite: 3, prixUnitaire: xof(100_000), tauxTva: 18 },
      { libelle: "B", quantite: 1, prixUnitaire: xof(50_000), tauxTva: 0 },
      {
        libelle: "C",
        quantite: 2,
        prixUnitaire: xof(25_000),
        tauxTva: 18,
        remise: { type: "pourcentage", pourcentage: 10 },
      },
    ],
    remiseGlobale: { type: "pourcentage", pourcentage: 5 },
    retenues: [{ libelle: "Retenue", taux: 5, base: "TTC" }],
  };

  it("gère remises, plusieurs taux de TVA et retenue sur TTC", () => {
    const f = calculerFacture(donnees);
    expect(f.lignes.map((l) => l.partRemiseGlobale.valeur)).toEqual([15_000, 2_500, 2_250]);
    expect(f.lignes.map((l) => l.montantHT.valeur)).toEqual([285_000, 47_500, 42_750]);
    expect(f.totalBrut).toEqual(xof(400_000));
    expect(f.totalRemises).toEqual(xof(24_750));
    expect(f.totalHT).toEqual(xof(375_250));
    expect(f.tva).toEqual([
      { taux: 0, base: xof(47_500), montant: xof(0) },
      { taux: 18, base: xof(327_750), montant: xof(58_995) },
    ]);
    expect(f.totalTTC).toEqual(xof(434_245));
    expect(f.totalRetenues).toEqual(xof(21_712));
    expect(f.netAPayer).toEqual(xof(412_533));
  });

  it("garantit que la somme des lignes égale le total", () => {
    const f = calculerFacture(donnees);
    const somme = (ms: readonly Montant[]) => ms.reduce((s, m) => s + m.valeur, 0);
    expect(somme(f.lignes.map((l) => l.montantHT))).toBe(f.totalHT.valeur);
    expect(somme(f.tva.map((t) => t.base))).toBe(f.totalHT.valeur);
    expect(f.totalHT.valeur + f.totalTva.valeur).toBe(f.totalTTC.valeur);
  });

  it("arrondit la TVA une fois par taux, pas ligne à ligne", () => {
    // 3 lignes de 0,05 € à 10 % : par ligne 0,5 centime → 1 (soit 3) ;
    // par taux 15 centimes × 10 % = 1,5 → 2 centimes.
    const f = calculerFacture({
      devise: "EUR",
      lignes: ["a", "b", "c"].map((libelle) => ({
        libelle,
        quantite: 1,
        prixUnitaire: eur(5),
        tauxTva: 10,
      })),
    });
    expect(f.totalTva).toEqual(eur(2));
  });

  it("accepte une remise fixe de ligne ou globale", () => {
    const f = calculerFacture({
      devise: "XOF",
      lignes: [
        {
          libelle: "A",
          quantite: 1,
          prixUnitaire: xof(100_000),
          tauxTva: 18,
          remise: { type: "montant", montant: xof(10_000) },
        },
      ],
      remiseGlobale: { type: "montant", montant: xof(20_000) },
    });
    expect(f.totalHT).toEqual(xof(70_000));
    expect(f.totalTva).toEqual(xof(12_600));
  });

  it("accepte une ligne négative (déduction d'acompte) sans remise globale", () => {
    const f = calculerFacture({
      devise: "XOF",
      lignes: [
        { libelle: "Solde", quantite: 1, prixUnitaire: xof(1_000_000), tauxTva: 18 },
        { libelle: "Acompte déjà facturé", quantite: -1, prixUnitaire: xof(300_000), tauxTva: 18 },
      ],
    });
    expect(f.totalHT).toEqual(xof(700_000));
    expect(f.totalTva).toEqual(xof(126_000));
  });

  it("rend une facture vide à zéro", () => {
    const f = calculerFacture({ devise: "XOF", lignes: [] });
    expect(f.netAPayer).toEqual(xof(0));
    expect(f.tva).toEqual([]);
  });

  it("refuse les remises, taux et devises invalides", () => {
    const remiseInvalide = expect.objectContaining({ code: "REMISE_INVALIDE" });
    const ligne = { libelle: "A", quantite: 1, prixUnitaire: xof(100), tauxTva: 18 };
    const avec = (patch: Partial<DonneesFacture>) => () =>
      calculerFacture({ devise: "XOF", lignes: [ligne], ...patch });
    expect(avec({ remiseGlobale: { type: "pourcentage", pourcentage: 120 } })).toThrow(
      remiseInvalide,
    );
    expect(avec({ remiseGlobale: { type: "montant", montant: xof(101) } })).toThrow(remiseInvalide);
    expect(avec({ remiseGlobale: { type: "montant", montant: xof(-1) } })).toThrow(remiseInvalide);
    expect(avec({ lignes: [{ ...ligne, tauxTva: 150 }] })).toThrow(/TVA/);
    expect(avec({ lignes: [{ ...ligne, tauxTva: -1 }] })).toThrow(remiseInvalide);
    expect(avec({ retenues: [{ libelle: "R", taux: 101, base: "HT" }] })).toThrow(/Retenue/);
    const lignesMixtes = [
      { ...ligne, quantite: 2 },
      { ...ligne, quantite: -1 },
    ];
    expect(
      avec({ lignes: lignesMixtes, remiseGlobale: { type: "pourcentage", pourcentage: 5 } }),
    ).toThrow(/lignes négatives/);
    const deviseDifferente = expect.objectContaining({ code: "DEVISE_DIFFERENTE" });
    expect(avec({ lignes: [{ ...ligne, prixUnitaire: eur(100) }] })).toThrow(deviseDifferente);
    expect(avec({ remiseGlobale: { type: "montant", montant: eur(1) } })).toThrow(deviseDifferente);
  });

  it("répartit la remise globale au plus fort reste, sans HT de ligne négatif", () => {
    const ligne = (libelle: string, prix: number) => ({
      libelle,
      quantite: 1,
      prixUnitaire: xof(prix),
      tauxTva: 0,
    });
    // Nets 1000 / 1000 / 1, remise 1000 : 499,75 / 499,75 / 0,4998 → 500 / 500 / 0.
    const f = calculerFacture({
      devise: "XOF",
      lignes: [ligne("A", 1_000), ligne("B", 1_000), ligne("C", 1)],
      remiseGlobale: { type: "montant", montant: xof(1_000) },
    });
    expect(f.lignes.map((l) => l.partRemiseGlobale.valeur)).toEqual([500, 500, 0]);
    expect(f.lignes.map((l) => l.montantHT.valeur)).toEqual([500, 500, 1]);
    expect(f.totalHT).toEqual(xof(1_001));
    // Ligne offerte (net 0) : elle ne reçoit aucune part de remise.
    const offerte = calculerFacture({
      devise: "XOF",
      lignes: [ligne("A", 1_000), ligne("B", 1_000), ligne("Offerte", 0)],
      remiseGlobale: { type: "montant", montant: xof(1_001) },
    });
    expect(offerte.lignes.map((l) => l.partRemiseGlobale.valeur)).toEqual([501, 500, 0]);
    expect(offerte.lignes.map((l) => l.montantHT.valeur)).toEqual([499, 500, 0]);
    expect(offerte.lignes.every((l) => l.montantHT.valeur >= 0)).toBe(true);
  });

  it("répartit la remise globale sur plusieurs taux de TVA sans perte", () => {
    // Nets 333 (18 %), 333 (0 %), 1 (18 %) ; remise 10 % de 667 = 66,7 → 67.
    // Parts exactes 33,45 / 33,45 / 0,10 → 33 / 33 / 0, puis le reste (1) va
    // au plus fort reste : égalité entre A et B, départagée par l'ordre des lignes.
    const f = calculerFacture({
      devise: "XOF",
      lignes: [
        { libelle: "A", quantite: 1, prixUnitaire: xof(333), tauxTva: 18 },
        { libelle: "B", quantite: 1, prixUnitaire: xof(333), tauxTva: 0 },
        { libelle: "C", quantite: 1, prixUnitaire: xof(1), tauxTva: 18 },
      ],
      remiseGlobale: { type: "pourcentage", pourcentage: 10 },
    });
    expect(f.lignes.map((l) => l.partRemiseGlobale.valeur)).toEqual([34, 33, 0]);
    expect(f.lignes.map((l) => l.montantHT.valeur)).toEqual([299, 300, 1]);
    expect(f.tva).toEqual([
      { taux: 0, base: xof(300), montant: xof(0) },
      { taux: 18, base: xof(300), montant: xof(54) },
    ]);
    expect(f.totalRemises).toEqual(xof(67));
  });

  it("répartit directement une remise globale, plafonnée à la somme des nets", () => {
    expect(repartirRemiseGlobale([xof(0), xof(0)], xof(0))).toEqual([xof(0), xof(0)]);
    expect(repartirRemiseGlobale([xof(10), xof(0), xof(5)], xof(15))).toEqual([
      xof(10),
      xof(0),
      xof(5),
    ]);
    const remiseInvalide = expect.objectContaining({ code: "REMISE_INVALIDE" });
    expect(() => repartirRemiseGlobale([xof(10), xof(5)], xof(16))).toThrow(remiseInvalide);
    expect(() => repartirRemiseGlobale([xof(0)], xof(1))).toThrow(remiseInvalide);
    expect(() => repartirRemiseGlobale([xof(10)], xof(-1))).toThrow(remiseInvalide);
    expect(() => repartirRemiseGlobale([xof(10), xof(-1)], xof(1))).toThrow(/lignes négatives/);
    expect(() => repartirRemiseGlobale([xof(10)], eur(1))).toThrow(
      expect.objectContaining({ code: "DEVISE_DIFFERENTE" }),
    );
  });

  it("calcule une remise isolée", () => {
    expect(montantRemise(xof(1_000), undefined)).toEqual(xof(0));
    expect(montantRemise(xof(-1_000), { type: "montant", montant: xof(0) })).toEqual(xof(0));
  });
});

describe("creerAvoir", () => {
  const facture = calculerFacture({
    devise: "XOF",
    lignes: [
      { libelle: "Conseil", quantite: 3, prixUnitaire: xof(333_333), tauxTva: 18 },
      { libelle: "Gratuit", quantite: 0, prixUnitaire: xof(1_000), tauxTva: 0 },
    ],
    retenues: [{ libelle: "Retenue", taux: 7.5, base: "HT" }],
  });
  const avoir = creerAvoir(facture);

  const champs = (f: FactureCalculee) => [
    f.totalBrut,
    f.totalRemises,
    f.totalHT,
    f.totalTva,
    f.totalTTC,
    f.totalRetenues,
    f.netAPayer,
    ...f.tva.flatMap((t) => [t.base, t.montant]),
    ...f.retenues.flatMap((r) => [r.assiette, r.montant]),
    ...f.lignes.flatMap((l) => [l.montantBrut, l.remiseLigne, l.partRemiseGlobale, l.montantHT]),
  ];

  it("refuse de créer l'avoir d'un avoir", () => {
    expect(() => creerAvoir(avoir)).toThrow(expect.objectContaining({ code: "AVOIR_INVALIDE" }));
  });

  it("est l'exact opposé de la facture", () => {
    expect(avoir.nature).toBe("avoir");
    const a = champs(avoir);
    champs(facture).forEach((m, i) => expect((a[i] as Montant).valeur + m.valeur).toBe(0));
    expect(avoir.lignes.map((l) => l.quantite)).toEqual([-3, 0]);
    expect(avoir.netAPayer.valeur).toBeLessThan(0);
  });

  it("équivaut au calcul de lignes négatives (arrondi symétrique)", () => {
    const negative = calculerFacture({
      devise: "XOF",
      lignes: [{ libelle: "Conseil", quantite: -3, prixUnitaire: xof(333_333), tauxTva: 18 }],
      retenues: [{ libelle: "Retenue", taux: 7.5, base: "HT" }],
    });
    expect(negative.totalTva).toEqual(avoir.totalTva);
    expect(negative.netAPayer).toEqual(avoir.netAPayer);
  });
});
