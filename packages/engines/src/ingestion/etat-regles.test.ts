import { describe, expect, it } from "vitest";
import { controlerEtatFinancier } from "../dossier/etat-financier";
import { extraireEtatDepuisTableau, extraireEtatParRegles } from "./etat-regles";
import { forcerRevueEtat } from "./etat-ia";
import type { LigneRejetee } from "./types";

/** Liasse SYSCOHADA simplifiée, équilibrée : actif = passif = 16 550 000, résultat 1 050 000. */
const LIASSE = [
  "ENTREPRISE EXEMPLE SA - Exercice clos le 31 décembre 2025",
  "BILAN - ACTIF",
  "REF LIBELLÉS NOTE 2025 2024",
  "AD Frais de développement et de prospection 3 1 200 000 1 000 000",
  "AE Brevets, licences et logiciels 350 000 300 000",
  "BK Terrains ........ 15 000 000 15 000 000",
  "BZ TOTAL ACTIF 16 550 000 16 300 000",
  "BILAN - PASSIF (suite)",
  "CA Capital 10 000 000 10 000 000",
  "CF Report à nouveau (500 000) (300 000)",
  "CJ RÉSULTAT NET DE L'EXERCICE 1 050 000 800 000",
  "DA Emprunts et dettes financières 6 000 000 5 800 000",
  "DZ TOTAL PASSIF 16 550 000 16 300 000",
].join("\n");

const RESULTAT = [
  "COMPTE DE RÉSULTAT",
  "CHARGES",
  "RC Achats de marchandises 2 000 000 1 800 000",
  "RE Charges de personnel 1 950 000 1 700 000",
  "TOTAL CHARGES 3 950 000 3 500 000",
  "PRODUITS",
  "TA Ventes de marchandises 5 000 000 4 300 000",
  "TOTAL PRODUITS 5 000 000 4 300 000",
  "RÉSULTAT NET 1 050 000 800 000",
].join("\n");

const lignesPar = (r: { lignes: readonly { code: string }[] }) => r.lignes.map((l) => l.code);
const motifs = (rejets: readonly LigneRejetee[]) => rejets.map((r) => r.motif);

describe("extraireEtatParRegles : liasse simplifiée", () => {
  const r = extraireEtatParRegles(
    [
      { numero: 1, texte: LIASSE },
      { numero: 2, texte: RESULTAT },
    ],
    0,
  );

  it("lit sections, codes, premiers montants, totaux et résultats", () => {
    expect(r.rejets).toEqual([]);
    expect(r.lignes.map((l) => [l.code, l.section, l.montant, l.role, l.page])).toEqual([
      ["AD", "actif", 1_200_000, null, 1],
      ["AE", "actif", 350_000, null, 1],
      ["BK", "actif", 15_000_000, null, 1],
      ["BZ", "actif", 16_550_000, "total", 1],
      ["CA", "passif", 10_000_000, null, 1],
      ["CF", "passif", -500_000, null, 1],
      ["CJ", "passif", 1_050_000, "resultat_exercice", 1],
      ["DA", "passif", 6_000_000, null, 1],
      ["DZ", "passif", 16_550_000, "total", 1],
      ["RC", "charges", 2_000_000, null, 2],
      ["RE", "charges", 1_950_000, null, 2],
      ["L2_5", "charges", 3_950_000, "total", 2],
      ["TA", "produits", 5_000_000, null, 2],
      ["L2_8", "produits", 5_000_000, "total", 2],
      ["L2_9", "resultat", 1_050_000, "resultat_net", 2],
    ]);
    expect(r.lignes.every((l) => l.parent === null)).toBe(true);
  });

  it("ignore l'en-tête de colonnes et retire les points de conduite du libellé", () => {
    expect(r.lignes.find((l) => l.code === "BK")?.libelle).toBe("Terrains");
    expect(r.lignes.find((l) => l.code === "AD")?.libelle).toBe(
      "Frais de développement et de prospection",
    );
  });

  it("donne un état que le moteur de contrôle accepte automatiquement", () => {
    const controle = controlerEtatFinancier(
      r.lignes.map((l) => ({
        code: l.code,
        section: l.section,
        montant: l.montant,
        parent: l.parent,
        role: l.role,
      })),
    );
    expect(controle.conforme).toBe(true);
    expect(controle.acceptationAutomatique).toBe(true);
    expect(forcerRevueEtat(r, { ocr: false })).toBe(false);
    expect(forcerRevueEtat(r, { ocr: true })).toBe(true);
  });

  it("est déterministe", () => {
    const pages = [{ numero: 1, texte: LIASSE }];
    expect(extraireEtatParRegles(pages, 0)).toEqual(extraireEtatParRegles(pages, 0));
  });
});

describe("extraireEtatParRegles : sections et lignes", () => {
  it("tolère « (suite) », « exercice 2025 », préfixes et casse/accents", () => {
    const r = extraireEtatParRegles(
      [
        {
          numero: 1,
          texte: [
            "bilan actif exercice 2025",
            "21 Terrains 100",
            "ACTIF (suite)",
            "22 Bâtiments 200",
            "Compte de résultat - Produits",
            "70 Ventes 300",
            "COMPTE DE RÉSULTAT",
            "BILAN",
            "71 Autres produits 400",
            "PASSIF 2025 2024",
            "10 Capital 500",
            "Charges",
            "60 Achats 600",
            "RÉSULTAT",
            "RÉSULTAT NET 700",
          ].join("\n"),
        },
      ],
      0,
    );
    expect(r.rejets).toEqual([]);
    expect(r.lignes.map((l) => [l.code, l.section])).toEqual([
      ["21", "actif"],
      ["22", "actif"],
      ["70", "produits"],
      ["71", "produits"],
      ["10", "passif"],
      ["60", "charges"],
      ["L1_15", "resultat"],
    ]);
  });

  it("garde la section d'une page à l'autre et rejette les lignes avant toute section", () => {
    const r = extraireEtatParRegles(
      [
        { numero: 1, texte: "Autres créances 100\nACTIF\nBK Terrains 500" },
        { numero: 2, texte: "BL Bâtiments 700" },
      ],
      0,
    );
    expect(lignesPar(r)).toEqual(["BK", "BL"]);
    expect(r.lignes[1]?.section).toBe("actif");
    expect(r.rejets).toEqual([
      { page: 1, texte: "Autres créances 100", motif: "section_inconnue" },
    ]);
  });

  it("applique les règles de colonnes : un montant, deux montants, trois montants", () => {
    const r = extraireEtatParRegles(
      [
        {
          numero: 1,
          texte: [
            "ACTIF",
            "BK Terrains 900",
            "BL Bâtiments 8 000 7 000",
            "BM Matériel 6 000 5 000 4 000",
            "BN Mobilier 7 3 000 2 000",
            "BO Stocks 12 1 000 8 000",
            "Immobilisations 1 050 000 800 000",
            "Dépôts 1 200 300 400",
            "Cautions 350 000 300 000 120 000",
            "Créances clients 40 000 F CFA",
            "Banque (1 500) *",
            "Caisse -250",
          ].join("\n"),
        },
      ],
      0,
    );
    expect(r.lignes.map((l) => [l.code, l.montant])).toEqual([
      ["BK", 900],
      ["BL", 8000],
      ["BN", 3000],
      ["BO", 1000],
      ["L1_7", 1_050_000],
      ["L1_10", 40_000],
      ["L1_11", -1500],
      ["L1_12", -250],
    ]);
    expect(r.rejets.map((x) => [x.motif, x.texte])).toEqual([
      ["montants_ambigus", "BM Matériel 6 000 5 000 4 000"],
      ["montants_ambigus", "Dépôts 1 200 300 400"],
      ["montants_ambigus", "Cautions 350 000 300 000 120 000"],
    ]);
  });

  it("gère les codes : lettres, comptes, absence, doublon, libellé commençant par un mot court", () => {
    const r = extraireEtatParRegles(
      [
        {
          numero: 3,
          texte: [
            "ACTIF",
            "AD Frais 10",
            "AD Frais bis 11",
            "601000 Achats 12",
            "Sans code 13",
            "1 Isolé 14",
            "TVA due 15",
            "BORDEL Matériel 16",
          ].join("\n"),
        },
      ],
      0,
    );
    expect(r.lignes.map((l) => [l.code, l.libelle])).toEqual([
      ["AD", "Frais"],
      ["601000", "Achats"],
      ["L3_5", "Sans code"],
      ["L3_6", "1 Isolé"],
      ["TVA", "due"],
      ["L3_8", "BORDEL Matériel"],
    ]);
    expect(motifs(r.rejets)).toEqual(["code_en_double"]);
  });

  it("rejette sous-totaux, totaux en double, montants illisibles et lignes sans libellé", () => {
    const r = extraireEtatParRegles(
      [
        {
          numero: 1,
          texte: [
            "ACTIF",
            "Total actif immobilisé 500",
            "Sous-total créances 300",
            "Total du bilan actif 800",
            "TOTAL ACTIF 810",
            "Impôt 12,345,6",
            "Provision 12,34",
            "1 500 000",
            "31/12/2025",
            "Page 3/12",
            "---",
            "Note explicative sans chiffre",
            "Ventes en 2025 puis stock",
            "Marge ... (a)",
          ].join("\n"),
        },
      ],
      0,
    );
    expect(r.lignes.map((l) => [l.libelle, l.role])).toEqual([["Total du bilan actif", "total"]]);
    expect(motifs(r.rejets)).toEqual([
      "sous_total_non_rattache",
      "sous_total_non_rattache",
      "role_invalide",
      "montant_illisible",
      "montant_illisible",
      "format",
    ]);
  });

  it("traite les résultats : passif, compte de résultat, doubles, section résultat", () => {
    const r = extraireEtatParRegles(
      [
        {
          numero: 1,
          texte: [
            "PASSIF",
            "Résultat net 100",
            "Résultat de l'exercice 110",
            "ACTIF",
            "Résultat net 120",
            "PRODUITS",
            "Résultat d'exploitation 130",
            "Résultat net 140",
            "Résultat net 150",
            "RÉSULTAT",
            "Divers 160",
          ].join("\n"),
        },
      ],
      0,
    );
    expect(r.lignes.map((l) => [l.section, l.role, l.montant])).toEqual([
      ["passif", "resultat_exercice", 100],
      ["actif", null, 120],
      ["produits", null, 130],
      ["resultat", "resultat_net", 140],
    ]);
    expect(motifs(r.rejets)).toEqual(["role_invalide", "role_invalide", "role_invalide"]);
  });

  it("ignore les lignes d'en-tête de colonnes et les lignes d'années", () => {
    const r = extraireEtatParRegles(
      [
        {
          numero: 1,
          texte:
            "ACTIF\nExercice clos le 31 décembre 2025\n2025 2024\nNET 2025 2024\nBK Terrains 5",
        },
      ],
      0,
    );
    expect(lignesPar(r)).toEqual(["BK"]);
    expect(r.rejets).toEqual([]);
  });

  it("gère les décimales en EUR", () => {
    const r = extraireEtatParRegles(
      [{ numero: 1, texte: "PRODUITS\nVentes 1 234,56 987,65\nAutres 10" }],
      2,
    );
    expect(r.lignes.map((l) => l.montant)).toEqual([123_456, 1000]);
  });

  it("rejette une ligne de plus de 500 caractères sans exception", () => {
    const longue = `Libellé ${"x".repeat(600)} 12`;
    const r = extraireEtatParRegles([{ numero: 1, texte: `ACTIF\n${longue}\nBK Terrains 5` }], 0);
    expect(lignesPar(r)).toEqual(["BK"]);
    expect(r.rejets).toHaveLength(1);
    expect(r.rejets[0]?.motif).toBe("ligne_trop_longue");
    expect(r.rejets[0]?.texte).toHaveLength(200);
    expect(r.rejets[0]?.page).toBe(1);
  });

  it("limite à 1000 lignes retenues puis rejette trop_de_lignes", () => {
    const corps = Array.from({ length: 1005 }, (_, i) => `Poste ${i} ${i + 1}`).join("\n");
    const r = extraireEtatParRegles([{ numero: 1, texte: `ACTIF\n${corps}` }], 0);
    expect(r.lignes).toHaveLength(1000);
    expect(r.rejets).toHaveLength(5);
    expect(r.rejets.every((x) => x.motif === "trop_de_lignes")).toBe(true);
  });

  it("plafonne les rejets conservés", () => {
    const corps = Array.from({ length: 1500 }, (_, i) => `Poste ${i} ${i + 1} 2 3 4`).join("\n");
    const r = extraireEtatParRegles([{ numero: 1, texte: `ACTIF\n${corps}` }], 0);
    expect(r.rejets).toHaveLength(1000);
    expect(forcerRevueEtat(r, { ocr: false })).toBe(true);
  });

  it("retient un texte vide ou sans ligne lisible comme une extraction vide à revoir", () => {
    const vide = extraireEtatParRegles([{ numero: 1, texte: "" }], 0);
    expect(vide).toEqual({ lignes: [], rejets: [] });
    expect(forcerRevueEtat(vide, { ocr: false })).toBe(true);
    expect(extraireEtatParRegles([], 0).lignes).toEqual([]);
  });

  it("refuse un nombre de décimales invalide", () => {
    expect(() => extraireEtatParRegles([], 7)).toThrow();
    expect(() => extraireEtatDepuisTableau([], -1)).toThrow();
  });

  it("traite une ligne de 100 000 caractères et un texte de 400 000 caractères en moins d'une seconde", () => {
    const debut = performance.now();
    extraireEtatParRegles(
      [
        { numero: 1, texte: `ACTIF\n${"1 ".repeat(50_000)}\n${"a".repeat(100_000)}` },
        { numero: 2, texte: "BK Terrains 1 500 000 1 200 000\n".repeat(12_500) },
        { numero: 3, texte: `ACTIF ${"(".repeat(100_000)}` },
        { numero: 4, texte: `${" ".repeat(100_000)}12` },
      ],
      0,
    );
    expect(performance.now() - debut).toBeLessThan(1000);
  });
});

describe("extraireEtatDepuisTableau", () => {
  const feuille = [
    { numero: 1, valeurs: ["Code", "Libellé", "Note", "2025", "2024"] },
    { numero: 2, valeurs: ["", "ACTIF", "", "", ""] },
    { numero: 3, valeurs: ["AD", "Frais de développement", "3", "1 200 000", "1 000 000"] },
    { numero: 4, valeurs: ["", "Terrains", "", "15 000 000", ""] },
    { numero: 5, valeurs: ["21", "Bâtiments", "", "500 000", ""] },
    { numero: 6, valeurs: ["", "TOTAL ACTIF", "", "16 700 000", ""] },
    { numero: 7, valeurs: ["", "", "", "", ""] },
    { numero: 8, valeurs: ["", "PASSIF"] },
    { numero: 9, valeurs: ["Capital social", "", "(100)"] },
    { numero: 10, valeurs: ["Dette", "12,34"] },
    { numero: 11, valeurs: ["Prose", "sans montant"] },
    { numero: 12, valeurs: ["", "Résultat net de l'exercice", "250 FCFA"] },
  ];

  it("lit code, libellé et colonne du montant retenu", () => {
    const r = extraireEtatDepuisTableau(feuille, 0);
    expect(
      r.lignes.map((l) => [l.code, l.section, l.montant, l.role, l.page, l.ligne, l.colonne]),
    ).toEqual([
      ["AD", "actif", 1_200_000, null, 1, 3, 4],
      ["L1_4", "actif", 15_000_000, null, 1, 4, 4],
      ["21", "actif", 500_000, null, 1, 5, 4],
      ["L1_6", "actif", 16_700_000, "total", 1, 6, 4],
      ["L1_9", "passif", -100, null, 1, 9, 3],
      ["L1_12", "passif", 250, "resultat_exercice", 1, 12, 3],
    ]);
    expect(r.rejets).toEqual([{ page: 1, texte: "Dette | 12,34", motif: "montant_illisible" }]);
  });

  it("rejette une ligne trop longue et un libellé absent", () => {
    const r = extraireEtatDepuisTableau(
      [
        { numero: 1, valeurs: ["ACTIF"] },
        { numero: 2, valeurs: ["x".repeat(600), "5"] },
        { numero: 3, valeurs: ["", "", "1 500"] },
        { numero: 4, valeurs: ["2025", "2024"] },
        { numero: 5, valeurs: ["BL", "Bâtiments", "9"] },
        { numero: 6, valeurs: ["BM", "Matériel", "800", "700", "600"] },
      ],
      0,
    );
    expect(motifs(r.rejets)).toEqual(["ligne_trop_longue", "format", "montants_ambigus"]);
    expect(r.lignes.map((l) => [l.code, l.montant])).toEqual([["BL", 9]]);
  });

  it("lit un code de lettres suivi du libellé dans des cellules séparées", () => {
    const r = extraireEtatDepuisTableau(
      [
        { numero: 1, valeurs: ["Produits"] },
        { numero: 2, valeurs: ["TA", "Ventes", "TA texte annexe", "5 000"] },
        { numero: 3, valeurs: ["Ventes", "commentaire", "7 000", "note"] },
      ],
      0,
    );
    expect(r.lignes.map((l) => [l.code, l.libelle, l.montant])).toEqual([
      ["TA", "Ventes TA texte annexe", 5000],
      ["L1_3", "Ventes commentaire", 7000],
    ]);
  });
});
