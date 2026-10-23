import { describe, expect, it } from "vitest";
import {
  contientDonneeFinanciere,
  lirePropositionIa,
  normaliserCodeProposition,
} from "./proposition";

const PAGES = [
  { numero: 1, texte: "Proposition commerciale" },
  { numero: 2, texte: "Méthode" },
];

describe("normaliserCodeProposition", () => {
  it("ramène un code à la forme du référentiel", () => {
    expect(normaliserCodeProposition("Étape 1 : Cadrage")).toBe("etape_1_cadrage");
    expect(normaliserCodeProposition("  --Kpi.Marge--  ")).toBe("--kpi.marge--");
    expect(normaliserCodeProposition("a   b///c")).toBe("a_b_c");
    expect(normaliserCodeProposition("   ")).toBe("");
    expect(normaliserCodeProposition("!!!")).toBe("");
    expect(normaliserCodeProposition("x".repeat(300))).toHaveLength(120);
    expect(normaliserCodeProposition("é ".repeat(200))).toMatch(/^[a-z0-9_.-]{1,120}$/);
  });
});

describe("lirePropositionIa", () => {
  it("lit les quatre familles", () => {
    const { contenu, rejets } = lirePropositionIa(
      [
        "etape | Cadrage | Cadrage de la mission | 1",
        "brique | cadrage | Kick off | Réunion de lancement | Aligner les parties | 1",
        "brique | Diagnostic | diag-flash | Diagnostic flash | Poser le constat | 2",
        "element | Livrable | note-cadrage | Note de cadrage | Document de 2 pages | 1",
        "element | kpi type | marge | Marge brute | | 2",
        "rubrique | Écoute | Écoute active | Ne questionne pas | Questionne peu | Questionne | Reformule | Fait émerger les enjeux | 2",
        "",
      ],
      PAGES,
    );
    expect(rejets).toEqual([]);
    expect(contenu.tronque).toBe(false);
    expect(contenu.etapes).toEqual([
      { code: "cadrage", libelle: "Cadrage de la mission", page: 1 },
    ]);
    expect(contenu.briques).toEqual([
      {
        etape_code: "cadrage",
        code: "kick_off",
        libelle: "Réunion de lancement",
        objet: "Aligner les parties",
        page: 1,
      },
      {
        etape_code: "diagnostic",
        code: "diag-flash",
        libelle: "Diagnostic flash",
        objet: "Poser le constat",
        page: 2,
      },
    ]);
    expect(contenu.elements).toEqual([
      {
        type: "livrable",
        code: "note-cadrage",
        libelle: "Note de cadrage",
        description: "Document de 2 pages",
        page: 1,
      },
      { type: "kpi_type", code: "marge", libelle: "Marge brute", description: null, page: 2 },
    ]);
    expect(contenu.rubriques).toEqual([
      {
        code: "ecoute",
        libelle: "Écoute active",
        niveaux: [
          "Ne questionne pas",
          "Questionne peu",
          "Questionne",
          "Reformule",
          "Fait émerger les enjeux",
        ],
        page: 2,
      },
    ]);
  });

  it("garde une brique dont l'étape n'est pas proposée", () => {
    const { contenu, rejets } = lirePropositionIa(
      ["brique | etape_existante | b1 | Brique | Objet | 1"],
      PAGES,
    );
    expect(rejets).toEqual([]);
    expect(contenu.briques[0]?.etape_code).toBe("etape_existante");
    expect(contenu.etapes).toEqual([]);
  });

  it("rejette les doublons dans une même famille seulement", () => {
    const { contenu, rejets } = lirePropositionIa(
      [
        "etape | a | A | 1",
        "etape | A | A bis | 1",
        "brique | a | a | Brique | Objet | 1",
        "brique | a | a | Brique bis | Objet | 1",
        "element | item | a | Item | | 1",
        "element | gabarit | a | Gabarit | | 1",
        "rubrique | a | R | n1 | n2 | n3 | n4 | n5 | 1",
        "rubrique | a | R bis | n1 | n2 | n3 | n4 | n5 | 1",
      ],
      PAGES,
    );
    expect(rejets.map((r) => r.motif)).toEqual([
      "code_en_double",
      "code_en_double",
      "code_en_double",
      "code_en_double",
    ]);
    expect([
      contenu.etapes.length,
      contenu.briques.length,
      contenu.elements.length,
      contenu.rubriques.length,
    ]).toEqual([1, 1, 1, 1]);
  });

  it("rejette formats, pages inconnues, codes vides, types inconnus et rubriques mal formées", () => {
    const { contenu, rejets } = lirePropositionIa(
      [
        "n'importe quoi",
        "etape | a | A",
        "etape | a | A | x",
        "etape | a | A | 9",
        "etape | !!! | A | 1",
        "etape | a | | 1",
        "brique | | b | B | O | 1",
        "brique | e | b | B | | 1",
        "brique | e | b | | O | 1",
        "element | machin | c | C | | 1",
        "element | item | !!! | C | | 1",
        "element | item | c | | | 1",
        "rubrique | r | R | n1 | n2 | n3 | n4 | 1",
        "rubrique | r | R | n1 | n2 | n3 | n4 | | 1",
        "rubrique | r | R | n1 | n2 | n3 | n4 | n5 | n6 | 1",
        "rubrique | !!! | R | n1 | n2 | n3 | n4 | n5 | 1",
        "etape | a | A | 1 | 1",
        "etape | a | " + "x".repeat(8100) + " | 1",
      ],
      PAGES,
    );
    expect(contenu.etapes).toEqual([]);
    expect(rejets.map((r) => r.motif)).toEqual([
      "format",
      "format",
      "format",
      "page_inconnue",
      "code_invalide",
      "format",
      "code_invalide",
      "format",
      "format",
      "format",
      "code_invalide",
      "format",
      "format",
      "format",
      "format",
      "code_invalide",
      "format",
      "ligne_trop_longue",
    ]);
    expect(rejets[3]?.page).toBe(9);
    expect(rejets[0]?.page).toBeNull();
  });

  it("applique les maxima (20, 60, 100, 30) puis rejette trop_de_lignes", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => i);
    // Codes sans chiffre (trois chiffres ou plus seraient refusés : donnée financière) : deux lettres.
    const c = (i: number) => String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));
    const lignes = [
      ...n(22).map((i) => `etape | e${c(i)} | E | 1`),
      ...n(62).map((i) => `brique | eaa | b${c(i)} | B | O | 1`),
      ...n(102).map((i) => `element | item | i${c(i)} | I | | 1`),
      ...n(32).map((i) => `rubrique | r${c(i)} | R | a | b | c | d | e | 1`),
    ];
    const { contenu, rejets } = lirePropositionIa(lignes, PAGES);
    expect([
      contenu.etapes.length,
      contenu.briques.length,
      contenu.elements.length,
      contenu.rubriques.length,
    ]).toEqual([20, 60, 100, 30]);
    expect(rejets).toHaveLength(8);
    expect(rejets.every((r) => r.motif === "trop_de_lignes")).toBe(true);
  });

  it("borne les textes et plafonne les rejets", () => {
    const { contenu } = lirePropositionIa(
      [
        `etape | a | ${"é".repeat(300)} | 1`,
        `brique | a | b | B | ${"o".repeat(2500)} | 1`,
        `element | item | c | C | ${"d".repeat(2500)} | 1`,
        `rubrique | r | R | ${"n".repeat(1500)} | b | c | d | e | 1`,
      ],
      PAGES,
    );
    expect(contenu.etapes[0]?.libelle).toHaveLength(200);
    expect(contenu.briques[0]?.objet).toHaveLength(2000);
    expect(contenu.elements[0]?.description).toHaveLength(2000);
    expect(contenu.rubriques[0]?.niveaux[0]).toHaveLength(1000);
    expect(lirePropositionIa(Array(1200).fill("vrac"), PAGES).rejets).toHaveLength(1000);
  });

  it("accepte une entrée vide et traite de longues lignes rapidement", () => {
    expect(lirePropositionIa([], PAGES).contenu).toEqual({
      etapes: [],
      briques: [],
      elements: [],
      rubriques: [],
      tronque: false,
    });
    const debut = performance.now();
    lirePropositionIa(["|".repeat(100_000), "etape | " + "a".repeat(7000) + " | A | 1"], PAGES);
    expect(performance.now() - debut).toBeLessThan(1000);
  });
});

describe("contientDonneeFinanciere", () => {
  it("refuse les nombres de trois chiffres ou plus, séparateurs de milliers compris", () => {
    for (const t of [
      "450",
      "1 500",
      "1 500",
      "1 500 jours",
      "2.000",
      "2,000",
      "1'500",
      "1 500 000",
      "100 000 F",
      "2025",
      "ISO 9001",
      "A100",
      "tarif ٣٥٠",
      "１２３",
      "0.250",
    ]) {
      expect(contientDonneeFinanciere(t), t).toBe(true);
    }
  });

  it("admet les nombres de un ou deux chiffres et le texte sans chiffre", () => {
    for (const t of [
      "",
      "   ",
      "5 jours",
      "niveau 3",
      "A1/B2",
      "10 %",
      "1,5 jour",
      "10 11 12",
      "version 1.2.3",
      "1 5",
      "Cadrage de la mission",
    ]) {
      expect(contientDonneeFinanciere(t), t).toBe(false);
    }
  });

  it("refuse toute mention de monnaie, sans égard à la casse ni aux accents", () => {
    for (const t of [
      "Facturé en FCFA",
      "paiement fcfa",
      "10 F CFA",
      "CFA",
      "montant XOF",
      "xaf",
      "en EUR",
      "des Euros",
      "un euro",
      "ÉURO",
      "USD",
      "dollar",
      "Dollars US",
      "5€",
      "$ par jour",
      "10k$",
    ]) {
      expect(contientDonneeFinanciere(t), t).toBe(true);
    }
  });

  it("ne confond pas un mot qui contient le sigle d'une monnaie", () => {
    for (const t of ["Valeur ajoutée", "Directeur", "heures", "europe", "Dollarisation", "cfaou"]) {
      expect(contientDonneeFinanciere(t), t).toBe(false);
    }
  });

  it("reste linéaire sur un texte hostile", () => {
    const debut = performance.now();
    const textes = [
      "1 ".repeat(50_000),
      "1.".repeat(50_000),
      "9".repeat(100_000),
      " ".repeat(100_000),
      "é".repeat(100_000),
      "1 000 ".repeat(20_000),
    ];
    for (const t of textes) contientDonneeFinanciere(t);
    expect(performance.now() - debut).toBeLessThan(1000);
  });
});

describe("lirePropositionIa : aucune donnée financière", () => {
  it("rejette donnee_financiere chaque famille dont un texte porte un nombre ou une monnaie", () => {
    const { contenu, rejets } = lirePropositionIa(
      [
        "etape | e1 | Cadrage à 1 500 | 1",
        "brique | e1 | b1 | Kick off | Forfait de 450 jours | 1",
        "brique | e1 | b2 | Kick off bis | Honoraires en FCFA | 1",
        "element | livrable | l1 | Note | Prix 2 000 € | 1",
        "element | kpi_type | k1 | Marge | 10 % de marge | 1",
        "rubrique | r1 | Écoute | Niveau 1 | Niveau 2 | Niveau 3 | Niveau 4 | ISO 9001 | 2",
        "rubrique | r2 | Écoute | Niveau 1 | Niveau 2 | Niveau 3 | Niveau 4 | Niveau 5 | 2",
        "etape | e2 | Diagnostic en 5 jours | 1",
      ],
      PAGES,
    );
    expect(rejets.map((r) => r.motif)).toEqual([
      "donnee_financiere",
      "donnee_financiere",
      "donnee_financiere",
      "donnee_financiere",
      "donnee_financiere",
    ]);
    expect(contenu.etapes.map((e) => e.code)).toEqual(["e2"]);
    expect(contenu.elements.map((e) => e.code)).toEqual(["k1"]);
    expect(contenu.rubriques.map((e) => e.code)).toEqual(["r2"]);
    expect(contenu.briques).toEqual([]);
  });

  it("vérifie le texte avant troncature", () => {
    const long = "x".repeat(250) + " 1 500";
    const { rejets } = lirePropositionIa([`etape | e1 | ${long} | 1`], PAGES);
    expect(rejets[0]?.motif).toBe("donnee_financiere");
  });
});

describe("contientDonneeFinanciere : francs, CHF, livre et mots de nombre", () => {
  it("refuse franc(s), CHF, £ et les mots de nombre, mots entiers, casse et accents indifférents", () => {
    for (const t of [
      "des francs",
      "un FRANC symbolique",
      "CHF",
      "chf par jour",
      "5£",
      "£ par jour",
      "cent jours",
      "Deux CENTS",
      "mille",
      "dix milles",
      "un million",
      "des Millions",
      "un milliard",
      "trois MILLIARDS",
      "trois-cents",
      "ÉQUIVAUT À cent",
    ]) {
      expect(contientDonneeFinanciere(t), t).toBe(true);
    }
  });

  it("ne détecte pas les mots qui ne font que contenir ces racines", () => {
    for (const t of [
      "centre de coûts",
      "centralisé",
      "milieu",
      "millésime",
      "Millénium",
      "français",
      "franchise",
      "francophone",
      "pourcentage",
      "accent",
    ]) {
      expect(contientDonneeFinanciere(t), t).toBe(false);
    }
  });

  it("rejette une ligne de proposition qui épelle un montant", () => {
    const { rejets, contenu } = lirePropositionIa(
      ["etape | e1 | Forfait de cent mille francs | 1", "etape | e2 | Centre de pilotage | 1"],
      PAGES,
    );
    expect(rejets.map((r) => r.motif)).toEqual(["donnee_financiere"]);
    expect(contenu.etapes.map((e) => e.code)).toEqual(["e2"]);
  });
});

describe("lirePropositionIa : codes bruts et normalisés", () => {
  it("rejette donnee_financiere un code qui porte un nombre, avant comme après normalisation", () => {
    expect(normaliserCodeProposition("Taux journalier 500")).toBe("taux_journalier_500");
    const { contenu, rejets } = lirePropositionIa(
      [
        "etape | Taux journalier 500 | Cadrage | 1",
        "etape | taux-journalier-500 | Cadrage bis | 1",
        "brique | e1 | Taux journalier 500 | Kick off | Lancement | 1",
        "brique | Taux journalier 500 | b1 | Kick off | Lancement | 1",
        "element | livrable | taux-journalier-500 | Note | Description | 1",
        "rubrique | Taux journalier 500 | Écoute | N1 | N2 | N3 | N4 | N5 | 2",
        "etape | e2 | Diagnostic | 1",
      ],
      PAGES,
    );
    expect(rejets.map((r) => r.motif)).toEqual(Array(6).fill("donnee_financiere"));
    expect(contenu.etapes.map((e) => e.code)).toEqual(["e2"]);
    expect(contenu.briques).toEqual([]);
    expect(contenu.elements).toEqual([]);
    expect(contenu.rubriques).toEqual([]);
  });
});
