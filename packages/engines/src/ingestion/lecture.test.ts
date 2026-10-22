import { describe, expect, it } from "vitest";
import {
  contientNonVerifie,
  decouper,
  formeComparable,
  lireLecturesIa,
  tronquerTexte,
} from "./lecture";

const PAGES = [
  {
    numero: 1,
    texte:
      "Le chiffre d’affaires 2025 s’élève à 1 500 000 FCFA.\nLa société  dispose de 120 salariés — dont 4 cadres.",
  },
  { numero: 2, texte: "Risque : litige prud’homal en cours, provision de 250 000 FCFA." },
];

describe("lireLecturesIa", () => {
  it("lit résumé et éléments et vérifie extraits et nombres dans la page citée", () => {
    const { contenu, rejets } = lireLecturesIa(
      [
        "RESUME | 1 | Société en croissance.",
        "résumé | 2 | Un litige est provisionné.",
        "1 | chiffre | Le chiffre d'affaires 2025 s'élève à 1 500 000 FCFA | Le CA 2025 est de 1 600 000 FCFA.",
        "1 | fait | dispose de 120 salariés - dont 4 cadres | Effectif de 120 salariés.",
        "2 | risque | litige prud'homal en cours | Un litige est en cours.",
        "",
      ],
      PAGES,
    );
    expect(rejets).toEqual([]);
    expect(contenu.tronque).toBe(false);
    expect(contenu.resume).toEqual([
      { page: 1, texte: "Société en croissance." },
      { page: 2, texte: "Un litige est provisionné." },
    ]);
    expect(contenu.elements.map((e) => [e.page, e.type, e.verifie])).toEqual([
      [1, "chiffre", false],
      [1, "fait", true],
      [2, "risque", true],
    ]);
    expect(contientNonVerifie(contenu)).toBe(true);
  });

  it("vérifie un chiffre exact et garde l'énoncé tel quel", () => {
    const { contenu } = lireLecturesIa(
      [
        "1 | chiffre | Le chiffre d'affaires 2025 s'élève à 1 500 000 FCFA | CA 2025 : 1.500.000 FCFA | tel quel",
      ],
      PAGES,
    );
    expect(contenu.elements[0]).toMatchObject({
      verifie: true,
      enonce: "CA 2025 : 1.500.000 FCFA | tel quel",
    });
    expect(contientNonVerifie(contenu)).toBe(false);
  });

  it("garde non vérifié un élément dont l'extrait est introuvable, trop court ou dont un nombre est inventé", () => {
    const { contenu, rejets } = lireLecturesIa(
      [
        "1 | fait | phrase inventée par le modèle | Énoncé.",
        "1 | fait | dispose | Énoncé court.",
        "1 | chiffre | dispose de 120 salariés | Effectif de 150 salariés.",
        "autre | 2 | x | y",
      ],
      PAGES,
    );
    expect(contenu.elements.map((e) => e.verifie)).toEqual([false, false, false]);
    expect(rejets.map((r) => r.motif)).toEqual(["format"]);
  });

  it("rejette page inconnue, type inconnu, champs vides et lignes hors format", () => {
    const { contenu, rejets } = lireLecturesIa(
      [
        "9 | fait | dispose de 120 salariés | Effectif.",
        "RESUME | 9 | Résumé d'une page inconnue",
        "1 | opinion | dispose de 120 salariés | Effectif.",
        "1 | fait | | Effectif.",
        "1 | fait | dispose de 120 salariés |",
        "RESUME | 1 |",
        "RESUME | 1",
        "du texte libre",
        "x | fait | e | f",
        "1 | fait | " + "x".repeat(4100) + " | f",
      ],
      PAGES,
    );
    expect(contenu.elements).toEqual([]);
    expect(contenu.resume).toEqual([]);
    expect(rejets.map((r) => r.motif)).toEqual([
      "page_inconnue",
      "page_inconnue",
      "format",
      "format",
      "format",
      "format",
      "format",
      "format",
      "format",
      "ligne_trop_longue",
    ]);
    expect(rejets[0]?.page).toBe(9);
  });

  it("borne les textes par troncature et les nombres d'éléments et de résumés", () => {
    const longue = "dispose de 120 salariés";
    const lignes = [
      `1 | fait | ${longue}${"x".repeat(600)} | ${"é".repeat(600)}`,
      `RESUME | 1 | ${"r".repeat(1500)}`,
      ...Array.from({ length: 12 }, () => "RESUME | 2 | autre"),
      ...Array.from({ length: 62 }, () => "2 | risque | litige prud'homal en cours | Litige."),
    ];
    const { contenu, rejets } = lireLecturesIa(lignes, PAGES);
    expect(contenu.elements[0]?.extrait).toHaveLength(400);
    expect(contenu.elements[0]?.enonce).toHaveLength(500);
    expect(contenu.resume[0]?.texte).toHaveLength(1000);
    expect(contenu.resume).toHaveLength(10);
    expect(contenu.elements).toHaveLength(60);
    expect(rejets.map((r) => r.motif)).toEqual(Array(6).fill("trop_de_lignes"));
  });

  it("n'imite pas de marqueur de page et gère texte vide ou aucune page", () => {
    expect(lireLecturesIa([], PAGES).contenu).toEqual({ resume: [], elements: [], tronque: false });
    const x = lireLecturesIa(["1 | fait | dispose de 120 salariés | Effectif."], []);
    expect(x.rejets[0]?.motif).toBe("page_inconnue");
    const y = lireLecturesIa(
      ["1 | fait | dispose de 120 salariés | Effectif."],
      [{ numero: 1, texte: "" }],
    );
    expect(y.contenu.elements[0]?.verifie).toBe(false);
  });

  it("traite 400 000 caractères et des lignes de 100 000 caractères rapidement", () => {
    const gros = [{ numero: 1, texte: "Chiffre d'affaires 1 500 000 FCFA. ".repeat(11_500) }];
    const debut = performance.now();
    lireLecturesIa(
      [
        "1 | chiffre | Chiffre d'affaires 1 500 000 FCFA | CA 1 500 000",
        "1 | fait | " + "a".repeat(100_000) + " | b",
        "1 | fait | " + "a b ".repeat(90) + " | " + "9 ".repeat(40_000),
      ],
      gros,
    );
    expect(performance.now() - debut).toBeLessThan(1000);
  });
});

describe("outils de lecture", () => {
  it("formeComparable unifie casse, accents, guillemets, tirets et espaces", () => {
    const brut = "  L’ÉTÉ —  « beau »\n\tdu  jour ";
    expect(formeComparable(brut)).toBe("l'ete - beau du jour");
  });

  it("decouper donne tout le reste au dernier champ", () => {
    expect(decouper("a | b | c | d | e", 3)).toEqual(["a", "b", "c | d | e"]);
    expect(decouper("a | b", 4)).toEqual(["a", "b"]);
  });

  it("tronquerTexte coupe à la limite", () => {
    expect(tronquerTexte("abcdef", 3)).toBe("abc");
    expect(tronquerTexte("abc ", 10)).toBe("abc ");
  });

  it("contientNonVerifie est faux sans élément", () => {
    expect(contientNonVerifie({ elements: [] })).toBe(false);
  });
});

describe("lireLecturesIa : vérification du résumé et de l'énoncé", () => {
  it("rejette un résumé qui cite un nombre (3 chiffres ou plus) introuvable dans la page citée", () => {
    const { contenu, rejets } = lireLecturesIa(
      [
        "RESUME | 1 | Chiffre d'affaires de 9 999 000 FCFA.",
        "RESUME | 2 | Le chiffre d'affaires 1 500 000 FCFA est sur la page 1, pas sur la 2.",
        "RESUME | 1 | Chiffre d'affaires de 1 500 000 FCFA, 120 salariés dont 4 cadres.",
        "RESUME | 1 | Société en croissance sur 2 exercices.",
      ],
      PAGES,
    );
    expect(contenu.resume.map((r) => r.texte)).toEqual([
      "Chiffre d'affaires de 1 500 000 FCFA, 120 salariés dont 4 cadres.",
      "Société en croissance sur 2 exercices.",
    ]);
    expect(rejets.map((r) => [r.page, r.motif])).toEqual([
      [1, "montant_absent_de_la_page"],
      [2, "montant_absent_de_la_page"],
    ]);
    expect(rejets[0]?.texte).toContain("9 999 000");
  });

  it("n'accepte pas verifie si l'énoncé contient un nombre absent de la page ou si l'extrait est court", () => {
    const { contenu } = lireLecturesIa(
      [
        "1 | fait | dispose de 120 salariés | Effectif de 120 salariés, soit 4 000 euros chacun.",
        "1 | fait | 120 sal | Effectif.",
        "1 | fait | dispose de 120 salariés | Effectif de 120 salariés.",
      ],
      PAGES,
    );
    expect(contenu.elements.map((e) => e.verifie)).toEqual([false, false, true]);
  });
});
