import { describe, expect, it } from "vitest";
import { controlerEtatFinancier, validerLignesEtat } from "../dossier/etat-financier";
import { forcerRevueEtat, lireLignesEtatIa } from "./etat-ia";

const PAGES = [
  {
    numero: 1,
    texte: [
      "BILAN ACTIF",
      "AD Frais de développement 1 200 000 1 000 000",
      "AE Brevets 350 000 300 000",
      "AZ Total immobilisations incorporelles 1 550 000",
      "BZ TOTAL ACTIF 1 550 000",
      "Report à nouveau (500 000)",
    ].join("\n"),
  },
  {
    numero: 2,
    texte: "PASSIF\nCA Capital 1 000 000\nCJ Résultat 550 000\nDZ TOTAL PASSIF 1 550 000",
  },
];

const lire = (lignes: string[], pages = PAGES) => lireLignesEtatIa(lignes, pages, 0);

describe("lireLignesEtatIa : lignes valides", () => {
  const r = lire([
    "1 | actif | BZ | | total | TOTAL ACTIF | 1 550 000",
    "1 | actif | AD | AZ | | Frais de développement | 1 200 000",
    "1 | actif | AE | AZ | | Brevets | 350 000",
    "1 | actif | AZ | | | Immobilisations incorporelles | 1 550 000",
    "",
    "2 | passif | CA | | | Capital | 1 000 000",
    "2 | passif | CJ | | resultat_exercice | Résultat | 550 000",
    "2 | passif | DZ | | total | TOTAL PASSIF | 1 550 000",
  ]);

  it("retient les lignes dont le montant est dans la page et résout les parents déclarés après l'enfant", () => {
    expect(r.rejets).toEqual([]);
    expect(r.lignes.map((l) => [l.code, l.parent, l.role, l.page, l.montant])).toEqual([
      ["BZ", null, "total", 1, 1_550_000],
      ["AD", "AZ", null, 1, 1_200_000],
      ["AE", "AZ", null, 1, 350_000],
      ["AZ", null, null, 1, 1_550_000],
      ["CA", null, null, 2, 1_000_000],
      ["CJ", null, "resultat_exercice", 2, 550_000],
      ["DZ", null, "total", 2, 1_550_000],
    ]);
  });

  it("donne des lignes que le moteur de contrôle accepte", () => {
    const lignes = r.lignes.map((l) => ({
      code: l.code,
      section: l.section,
      montant: l.montant,
      parent: l.parent,
      role: l.role,
    }));
    expect(() => validerLignesEtat(lignes)).not.toThrow();
    expect(controlerEtatFinancier(lignes).constats.length).toBeGreaterThan(0);
  });

  it("accepte un montant négatif cité sans signe ou entre parenthèses (valeur absolue)", () => {
    const x = lire(["1 | actif | RN | | | Report à nouveau | -500 000"]);
    expect(x.lignes[0]?.montant).toBe(-500_000);
    const y = lire(["1 | actif | RN | | | Report à nouveau | (500 000)"]);
    expect(y.lignes[0]?.montant).toBe(-500_000);
  });

  it("lit les montants à décimales", () => {
    const x = lireLignesEtatIa(
      ["1 | produits | V | | | Ventes | 1 234,56"],
      [{ numero: 1, texte: "Ventes 1 234,56 EUR" }],
      2,
    );
    expect(x.lignes[0]?.montant).toBe(123_456);
  });
});

describe("lireLignesEtatIa : rejets", () => {
  const motif = (ligne: string, pages = PAGES) => lire([ligne], pages).rejets[0]?.motif;

  it("rejette tout ce qui n'est pas au format, sans exception", () => {
    expect(motif("n'importe quoi")).toBe("format");
    expect(motif("1 | actif | AD | | | libellé")).toBe("format");
    expect(motif("1 | actif | AD | | | libellé | 1 | 2")).toBe("format");
    expect(motif("x | actif | AD | | | libellé | 1")).toBe("format");
    expect(motif("1 | actif | AD | | | | 1 200 000")).toBe("format");
    expect(motif("1 | actif | AD | | | " + "x".repeat(2100) + " | 1")).toBe("ligne_trop_longue");
  });

  it("rejette page inconnue, section inconnue et code invalide", () => {
    expect(motif("9 | actif | AD | | | Frais de développement | 1 200 000")).toBe("page_inconnue");
    expect(motif("1 | bilan | AD | | | Frais de développement | 1 200 000")).toBe(
      "section_inconnue",
    );
    expect(motif("1 | actif | A D | | | Frais de développement | 1 200 000")).toBe("code_invalide");
    expect(motif("1 | actif | | | | Frais de développement | 1 200 000")).toBe("code_invalide");
    expect(
      motif("1 | actif | " + "A".repeat(41) + " | | | Frais de développement | 1 200 000"),
    ).toBe("code_invalide");
  });

  it("rejette un code en double sans bloquer la ligne suivante", () => {
    const x = lire([
      "1 | actif | AD | | | Frais de développement | 1 200 000",
      "1 | actif | AD | | | Frais bis | 350 000",
      "1 | actif | AE | | | Brevets | 350 000",
    ]);
    expect(x.lignes.map((l) => l.code)).toEqual(["AD", "AE"]);
    expect(x.rejets.map((r) => r.motif)).toEqual(["code_en_double"]);
  });

  it("rejette un montant illisible ou ABSENT de la page citée", () => {
    expect(motif("1 | actif | AD | | | Frais de développement | beaucoup")).toBe(
      "montant_illisible",
    );
    expect(motif("1 | actif | AD | | | Frais de développement | 12,5")).toBe("montant_illisible");
    expect(motif("1 | actif | AD | | | Frais de développement | 1 200 001")).toBe(
      "montant_absent_de_la_page",
    );
    expect(motif("2 | passif | CA | | | Capital | 1 200 000")).toBe("montant_absent_de_la_page");
  });

  it("rejette un rôle invalide ou incohérent avec la section, ou en double", () => {
    expect(motif("1 | actif | AD | | enorme | Frais de développement | 1 200 000")).toBe(
      "role_invalide",
    );
    expect(motif("1 | actif | AD | | resultat_exercice | Frais de développement | 1 200 000")).toBe(
      "role_invalide",
    );
    expect(motif("1 | actif | AD | | resultat_net | Frais de développement | 1 200 000")).toBe(
      "role_invalide",
    );
    expect(motif("1 | resultat | AD | | | Frais de développement | 1 200 000")).toBe(
      "role_invalide",
    );
    expect(motif("1 | resultat | AD | | total | Frais de développement | 1 200 000")).toBe(
      "role_invalide",
    );
    expect(motif("1 | actif | AD | AZ | total | Frais de développement | 1 200 000")).toBe(
      "role_invalide",
    );
    const x = lire([
      "1 | actif | AD | | total | Frais de développement | 1 200 000",
      "1 | actif | AE | | total | Brevets | 350 000",
      "2 | passif | CA | | total | Capital | 1 000 000",
    ]);
    expect(x.lignes.map((l) => l.code)).toEqual(["AD", "CA"]);
    expect(x.rejets.map((r) => r.motif)).toEqual(["role_invalide"]);
    const y = lire([
      "2 | resultat | R1 | | resultat_net | Résultat | 550 000",
      "2 | resultat | R2 | | resultat_net | Résultat bis | 550 000",
    ]);
    expect(y.rejets.map((r) => r.motif)).toEqual(["role_invalide"]);
  });

  it("rejette un parent absent, d'une autre section, total, soi-même ou en cycle, avec propagation", () => {
    const pagesParents = [
      PAGES[0] as { numero: number; texte: string },
      PAGES[1] as { numero: number; texte: string },
    ].map((p) =>
      p.numero === 1
        ? {
            ...p,
            texte: [
              p.texte,
              "Soi 350 000",
              "Sous un total 1 550 000",
              "Immobilisations 1 550 000",
              ...["Cycle un", "Cycle deux", "Cycle trois", "Queue du cycle"].map(
                (l) => l + " 1 200 000",
              ),
            ].join("\n"),
          }
        : p,
    );
    const x = lire(
      [
        "1 | actif | AD | ZZ | | Frais de développement | 1 200 000",
        "1 | actif | AE | AD | | Brevets | 350 000",
        "1 | actif | AF | AF | | Soi | 350 000",
        "2 | passif | CA | AZ | | Capital | 1 000 000",
        "1 | actif | AZ | | | Immobilisations | 1 550 000",
        "1 | actif | BZ | | total | TOTAL ACTIF | 1 550 000",
        "1 | actif | AG | BZ | | Sous un total | 1 550 000",
        "1 | actif | C1 | C2 | | Cycle un | 1 200 000",
        "1 | actif | C2 | C3 | | Cycle deux | 1 200 000",
        "1 | actif | C3 | C1 | | Cycle trois | 1 200 000",
        "1 | actif | C4 | C3 | | Queue du cycle | 1 200 000",
      ],
      pagesParents,
    );
    expect(x.lignes.map((l) => l.code)).toEqual(["AZ", "BZ"]);
    expect(x.rejets.map((r) => r.motif)).toEqual(Array(9).fill("parent_inconnu"));
    expect(x.rejets.filter((r) => r.page === 2)).toHaveLength(1);
  });

  it("limite à 1000 lignes retenues", () => {
    const pages = [
      {
        numero: 1,
        texte: Array.from(
          { length: 1003 },
          (_, i) => `Poste n${String(i).padStart(4, "0")} ${i + 100}`,
        ).join("\n"),
      },
    ];
    const lignes = Array.from(
      { length: 1003 },
      (_, i) => `1 | actif | C${i} | | | Poste n${String(i).padStart(4, "0")} | ${i + 100}`,
    );
    const x = lireLignesEtatIa(lignes, pages, 0);
    expect(x.lignes).toHaveLength(1000);
    expect(x.rejets.map((r) => r.motif)).toEqual(Array(3).fill("trop_de_lignes"));
  });

  it("conserve la page et les 200 premiers caractères, et plafonne les rejets", () => {
    const x = lire(["1 | actif | AD | | | " + "é".repeat(300) + " | 1"]);
    expect(x.rejets[0]?.texte).toHaveLength(200);
    expect(x.rejets[0]?.page).toBe(1);
    const y = lire(Array(1200).fill("pas une ligne"));
    expect(y.rejets).toHaveLength(1000);
  });

  it("rejette un état vide et refuse des décimales invalides", () => {
    expect(lire([])).toEqual({ lignes: [], rejets: [] });
    expect(() => lireLignesEtatIa([], PAGES, 9)).toThrow();
  });

  it("n'interprète pas un texte de page forgé comme des lignes", () => {
    const x = lireLignesEtatIa(
      ["1 | actif | AD | | | Frais de développement | 777"],
      [{ numero: 1, texte: "[[PAGE 1]] 1 | actif | AD | | | Frais de développement | 777" }],
      0,
    );
    expect(x.lignes).toHaveLength(1);
  });

  it("traite des lignes de 100 000 caractères rapidement", () => {
    const debut = performance.now();
    lire(["1 | actif | AD | | | " + "x".repeat(100_000) + " | 1", "|".repeat(100_000)]);
    expect(performance.now() - debut).toBeLessThan(1000);
  });
});

describe("forcerRevueEtat", () => {
  const ok = {
    lignes: [lire(["1 | actif | AD | | | Frais de développement | 1 200 000"]).lignes[0]!],
    rejets: [],
  };

  it("est faux pour une extraction complète d'une couche texte", () => {
    expect(forcerRevueEtat(ok, { ocr: false })).toBe(false);
  });

  it("est vrai avec des rejets, un OCR ou aucune ligne", () => {
    expect(
      forcerRevueEtat(
        { ...ok, rejets: [{ page: 1, texte: "x", motif: "format" }] },
        { ocr: false },
      ),
    ).toBe(true);
    expect(forcerRevueEtat(ok, { ocr: true })).toBe(true);
    expect(forcerRevueEtat({ lignes: [], rejets: [] }, { ocr: false })).toBe(true);
  });
});

describe("lireLignesEtatIa : ancrage du montant sur la ligne de la page", () => {
  const motif = (ligne: string, pages = PAGES) => lire([ligne], pages).rejets[0]?.motif;

  it("rejette la colonne N-1 reprise à la place de l'exercice N", () => {
    expect(motif("1 | actif | AD | | | Frais de développement | 1 000 000")).toBe(
      "montant_absent_de_la_page",
    );
    expect(motif("1 | actif | AE | | | Brevets | 300 000")).toBe("montant_absent_de_la_page");
    expect(lire(["1 | actif | AD | | | Frais de développement | 1 200 000"]).rejets).toEqual([]);
  });

  it("rejette un montant présent dans la page mais sur une autre ligne", () => {
    // 350 000 est celui de Brevets, pas celui des frais de développement.
    expect(motif("1 | actif | AD | | | Frais de développement | 350 000")).toBe(
      "montant_absent_de_la_page",
    );
    expect(motif("1 | actif | AD | | | Capital | 1 000 000")).not.toBe(undefined);
  });

  it("rejette une ligne source à trois montants ou plus (colonnes ambiguës)", () => {
    const pages = [
      {
        numero: 1,
        texte: "Créances clients 900 000 800 000 700 000\nStocks 400 000 300 000",
      },
    ];
    expect(motif("1 | actif | CC | | | Créances clients | 900 000", pages)).toBe(
      "montants_ambigus",
    );
    expect(motif("1 | actif | CC | | | Créances clients | 800 000", pages)).toBe(
      "montants_ambigus",
    );
    expect(motif("1 | actif | ST | | | Stocks | 400 000", pages)).toBeUndefined();
  });

  it("exige le libellé complet ; une troncature n'est admise que longue, unique et couvrante", () => {
    const pages = [{ numero: 1, texte: "Stocks de marchandises 400 000 300 000\nTVA 55 000" }];
    expect(motif("1 | actif | ST | | | Stocks de marchandises | 400 000", pages)).toBeUndefined();
    expect(motif("1 | actif | TV | | | TVA | 55 000", pages)).toBeUndefined();
    // Préfixe trop court (6 caractères) ou couvrant moins de 80 % (17/22) : refusé.
    expect(motif("1 | actif | ST | | | Stocks | 400 000", pages)).toBe("montant_absent_de_la_page");
    expect(motif("1 | actif | ST | | | Stocks de marchan | 400 000", pages)).toBe(
      "montant_absent_de_la_page",
    );
    // Préfixe de 20 caractères sur 22 (91 %), unique : tolérance de troncature.
    expect(motif("1 | actif | ST | | | Stocks de marchandis | 400 000", pages)).toBeUndefined();
    // Libellé du modèle plus long que celui de la ligne, ou autre mot : refusé.
    expect(motif("1 | actif | ST | | | Stocks de marchandises et matières | 400 000", pages)).toBe(
      "montant_absent_de_la_page",
    );
    expect(motif("1 | actif | ST | | | Stockage | 400 000", pages)).toBe(
      "montant_absent_de_la_page",
    );
  });

  it("ignore casse, accents, espaces multiples et apostrophes typographiques du libellé", () => {
    const pages = [{ numero: 1, texte: "FRAIS   D’ÉTABLISSEMENT  120 000 100 000" }];
    expect(motif("1 | actif | FE | | | frais d'etablissement | 120 000", pages)).toBeUndefined();
    expect(motif("1 | actif | FE | | | Frais d’établissement : | 120 000", pages)).toBeUndefined();
    expect(motif("1 | actif | FE | | | Frais d’établissement net | 120 000", pages)).toBe(
      "montant_absent_de_la_page",
    );
    expect(motif("1 | actif | FE | | | Frais d'établissement | 100 000", pages)).toBe(
      "montant_absent_de_la_page",
    );
  });

  it("se rabat sur le code en jeton isolé quand le libellé est introuvable", () => {
    const pages = [{ numero: 1, texte: "AD 1 200 000 1 000 000\nADX 777 000\nXAD 888 000" }];
    expect(motif("1 | actif | AD | | | Libellé du modèle | 1 200 000", pages)).toBeUndefined();
    expect(motif("1 | actif | AD | | | Libellé du modèle | 1 000 000", pages)).toBe(
      "montant_absent_de_la_page",
    );
    // « ADX » et « XAD » ne sont pas le jeton « AD ».
    expect(motif("1 | actif | AD | | | Libellé du modèle | 777 000", pages)).toBe(
      "montant_absent_de_la_page",
    );
    expect(motif("1 | actif | AD | | | Libellé du modèle | 888 000", pages)).toBe(
      "montant_absent_de_la_page",
    );
    // Le code n'est PAS utilisé quand le libellé est retrouvé sur une autre ligne.
    const autres = [{ numero: 1, texte: "Brevets 5 000\nAD 9 000" }];
    expect(motif("1 | actif | AD | | | Brevets | 9 000", autres)).toBe("montant_absent_de_la_page");
  });

  it("ne lit que les montants qui suivent le libellé et accepte un montant négatif entre parenthèses", () => {
    const pages = [{ numero: 1, texte: "PV Provisions 2025 (45 000) 30 000" }];
    expect(motif("1 | passif | PV | | | Provisions 2025 | -45 000", pages)).toBeUndefined();
    expect(motif("1 | passif | PV | | | Provisions | 2 025", pages)).toBe("montants_ambigus");
  });

  it("ne retient pas une colonne N-1 injectée par le modèle sur un état complet", () => {
    const r = lire([
      "1 | actif | AD | AZ | | Frais de développement | 1 000 000",
      "1 | actif | AE | AZ | | Brevets | 300 000",
      "1 | actif | AZ | | | Immobilisations incorporelles | 1 550 000",
    ]);
    expect(r.lignes.map((l) => l.code)).toEqual(["AZ"]);
    expect(r.rejets.map((x) => x.motif)).toEqual([
      "montant_absent_de_la_page",
      "montant_absent_de_la_page",
    ]);
  });
});

describe("lireLignesEtatIa : ancrage strict du libellé (préfixes communs)", () => {
  const pages = [
    {
      numero: 1,
      texte: [
        "Immobilisations corporelles 500 000 450 000",
        "Immobilisations incorporelles 300 000 250 000",
        "Dettes fiscales 70 000",
        "Dettes financières 90 000",
        "Autres produits 10 000",
        "Autres produits 20 000",
        "Dettes fiscales et sociales à long terme 11 000",
        "Dettes fiscales et sociales à court terme 12 000",
      ].join("\n"),
    },
  ];
  const motif = (ligne: string) => lire([ligne], pages).rejets[0]?.motif;

  it("n'attribue pas à un poste le montant de son voisin au préfixe commun (permutation)", () => {
    const r = lire(
      [
        "1 | actif | IC | | | Immobilisations corporelles | 300 000",
        "1 | actif | II | | | Immobilisations incorporelles | 500 000",
      ],
      pages,
    );
    expect(r.lignes).toEqual([]);
    expect(r.rejets.map((x) => x.motif)).toEqual([
      "montant_absent_de_la_page",
      "montant_absent_de_la_page",
    ]);
    expect(forcerRevueEtat(r, { ocr: false })).toBe(true);
  });

  it("retient seulement le bon montant quand le modèle n'en permute qu'un", () => {
    const r = lire(
      [
        "1 | actif | IC | | | Immobilisations corporelles | 500 000",
        "1 | actif | II | | | Immobilisations incorporelles | 500 000",
      ],
      pages,
    );
    expect(r.lignes.map((l) => l.code)).toEqual(["IC"]);
    expect(r.rejets.map((x) => x.motif)).toEqual(["montant_absent_de_la_page"]);
    expect(forcerRevueEtat(r, { ocr: false })).toBe(true);
  });

  it("rejette libelle_ambigu un préfixe partagé par plusieurs lignes, même au bon montant", () => {
    expect(motif("1 | actif | IC | | | Immobilisations | 500 000")).toBe("libelle_ambigu");
    expect(motif("1 | actif | IC | | | Immobilisat | 500 000")).toBe("libelle_ambigu");
    expect(motif("1 | passif | DF | | | Dettes | 70 000")).toBe("libelle_ambigu");
    expect(motif("1 | passif | DF | | | Dettes fiscales et sociales à | 11 000")).toBe(
      "libelle_ambigu",
    );
  });

  it("rejette libelle_ambigu deux lignes de libellé identique, quel que soit le montant", () => {
    expect(motif("1 | produits | AP | | | Autres produits | 10 000")).toBe("libelle_ambigu");
    expect(motif("1 | produits | AP | | | autres  PRODUITS | 20 000")).toBe("libelle_ambigu");
  });

  it("retient la ligne qui porte exactement le libellé malgré des lignes de libellé plus long", () => {
    expect(motif("1 | passif | DF | | | Dettes fiscales | 70 000")).toBeUndefined();
    expect(motif("1 | passif | DF | | | Dettes fiscales | 11 000")).toBe(
      "montant_absent_de_la_page",
    );
    expect(motif("1 | passif | DF | | | Dettes financières | 90 000")).toBeUndefined();
  });

  it("compare sans tenir compte de la casse, des accents et de la ponctuation de bord", () => {
    expect(motif("1 | passif | DF | | | DETTES   FINANCIERES. | 90 000")).toBeUndefined();
    expect(motif("1 | passif | DF | | | - dettes financières : | 90 000")).toBeUndefined();
    expect(motif("1 | passif | DF | | | dettes financieres | 70 000")).toBe(
      "montant_absent_de_la_page",
    );
  });

  it("admet un code en tête de ligne source, celui du modèle ou un code d'allure usuelle", () => {
    const p = [{ numero: 1, texte: "AD Frais de développement 1 200 000\nAE Brevets 350 000" }];
    expect(lire(["1 | actif | ZZ | | | Frais de développement | 1 200 000"], p).rejets).toEqual([]);
    expect(lire(["1 | actif | AD | | | Frais de développement | 1 200 000"], p).rejets).toEqual([]);
    expect(lire(["1 | actif | BR | | | Brevets | 350 000"], p).rejets).toEqual([]);
    // Un libellé qui ne commence pas la ligne n'ancre pas.
    expect(lire(["1 | actif | ZZ | | | développement | 1 200 000"], p).rejets[0]?.motif).toBe(
      "montant_absent_de_la_page",
    );
  });

  it("n'utilise le code en repli que s'il est porté par une seule ligne", () => {
    const p = [{ numero: 1, texte: "AD 1 200 000\nAD 900 000\nAE 350 000" }];
    expect(lire(["1 | actif | AD | | | Inconnu | 1 200 000"], p).rejets[0]?.motif).toBe(
      "libelle_ambigu",
    );
    expect(lire(["1 | actif | AE | | | Inconnu | 350 000"], p).rejets).toEqual([]);
    expect(lire(["1 | actif | AZ | | | Inconnu | 350 000"], p).rejets[0]?.motif).toBe(
      "montant_absent_de_la_page",
    );
  });

  it("traite 1000 lignes aux libellés à préfixe commun rapidement", () => {
    const grande = [
      {
        numero: 1,
        texte: Array.from({ length: 1000 }, (_, i) => `Poste commun ${i} ${i + 100}`).join("\n"),
      },
    ];
    const lignes = Array.from(
      { length: 1000 },
      (_, i) => `1 | actif | C${i} | | | Poste commun ${i} | ${i + 100}`,
    );
    const debut = performance.now();
    const r = lireLignesEtatIa(lignes, grande, 0);
    // Pire cas (préfixes très partagés) ; la mesure inclut la charge de la couverture.
    expect(performance.now() - debut).toBeLessThan(3000);
    expect(r.lignes).toHaveLength(1000);
  });
});

describe("lireLignesEtatIa : lignes de page à blancs", () => {
  it("ignore les blancs de fin de ligne, les lignes vides et les espaces insécables", () => {
    const pages = [{ numero: 1, texte: "Brevets   350 000   \n   \n \nCapital 1 000 000   " }];
    const x = lire(
      ["1 | actif | AE | | | Brevets | 350 000", "1 | passif | CA | | | Capital | 1 000 000"],
      pages,
    );
    expect(x.rejets).toEqual([]);
    expect(x.lignes).toHaveLength(2);
  });
});

describe("lireLignesEtatIa : colonne note", () => {
  it("ignore une colonne note de 1 ou 2 chiffres avant le montant de l'exercice N", () => {
    const pages = [
      { numero: 1, texte: "Frais de développement 3 1 200 000 1 000 000\nTerrains 12 (900 000)" },
    ];
    expect(lire(["1 | actif | AD | | | Frais de développement | 1 200 000"], pages).rejets).toEqual(
      [],
    );
    expect(lire(["1 | actif | TE | | | Terrains | -900 000"], pages).rejets).toEqual([]);
    // La colonne N-1 reste refusée, et la note elle-même n'est pas un montant.
    expect(
      lire(["1 | actif | AD | | | Frais de développement | 1 000 000"], pages).rejets[0]?.motif,
    ).toBe("montant_absent_de_la_page");
    expect(lire(["1 | actif | AD | | | Frais de développement | 3"], pages).rejets[0]?.motif).toBe(
      "montant_absent_de_la_page",
    );
  });
});

describe("lireLignesEtatIa : libellé tronqué sur un caractère accentué", () => {
  const pages = [
    {
      numero: 1,
      texte: "Immobilisations incorporelles é2 500 000 400 000\nTotal 500 000",
    },
  ];
  it("saute la suite du mot même quand la coupure tombe sur une lettre accentuée", () => {
    // Le libellé du modèle s'arrête sur « é » ; la suite du mot (« 2 ») appartient à la ligne source, pas au montant.
    const r = lire(["1 | actif | II | | | Immobilisations incorporelles é | 500 000"], pages);
    expect(r.rejets).toEqual([]);
    expect(r.lignes.map((l) => l.code)).toEqual(["II"]);
  });

  it("rejette toujours le montant fusionné avec la suite du mot", () => {
    const r = lire(["1 | actif | II | | | Immobilisations incorporelles é | 2 500 000"], pages);
    expect(r.rejets.map((x) => x.motif)).toEqual(["montant_absent_de_la_page"]);
  });
});
