import { describe, expect, it } from "vitest";
import { ErreurDossier } from "../dossier/erreurs";
import { extraireEtatParRegles, extraireEtatParReglesAvecRangs } from "./etat-regles";
import { lireLignesEtatIa } from "./etat-ia";
import {
  CORRECTIONS_OCR_PROPOSEES_MAX,
  normaliserConfusionsOcr,
  proposerCorrectionsOcr,
} from "./ocr-confusions";
import type { ExtractionEtat, PageTexte } from "./types";

const norm = (texte: string, decimales = 0) => normaliserConfusionsOcr(texte, decimales);
const page = (...lignes: string[]): PageTexte[] => [{ numero: 1, texte: lignes.join("\n") }];
const vide: ExtractionEtat = { lignes: [], rejets: [] };
const proposer = (pages: PageTexte[], decimales = 0, extraction?: ExtractionEtat) =>
  proposerCorrectionsOcr(pages, extraction ?? extraireEtatParRegles(pages, decimales), decimales);

describe("normaliserConfusionsOcr", () => {
  it("lit O pour 0 dans le dernier groupe (o_zero)", () => {
    const r = norm("Clients 1 234 56O");
    expect(r.texte).toBe("Clients 1 234 560");
    expect(r.changements).toEqual([
      { ligne: 0, debut: 14, fin: 17, lu: "56O", corrige: "560", confusions: ["o_zero"] },
    ]);
  });

  it("lit l, I et | pour 1 (l_un), y compris un l isolé devant un groupe de trois chiffres", () => {
    expect(norm("Clients l 234 567").texte).toBe("Clients 1 234 567");
    expect(norm("Clients I 234 567").texte).toBe("Clients 1 234 567");
    expect(norm("Clients 1 234 5l7").texte).toBe("Clients 1 234 517");
    expect(norm("Clients 1 234 5|7").texte).toBe("Clients 1 234 517");
    expect(norm("Clients l234").texte).toBe("Clients 1234");
    expect(norm("Clients l 234 567").changements[0]?.confusions).toEqual(["l_un"]);
  });

  it("conserve la longueur et le nombre de lignes", () => {
    const t = "ACTIF\nClients l 234 567\n\nStocks 2 5O0 000\tFCFA";
    const r = norm(t);
    expect(r.texte.length).toBe(t.length - 0);
    expect(r.texte.split("\n").length).toBe(4);
  });

  it("combine plusieurs confusions dans une même zone, dans l'ordre de CONFUSIONS_OCR", () => {
    const r = norm("Total l 2O4 5l7");
    expect(r.texte).toBe("Total 1 204 517");
    expect(r.changements.map((c) => c.confusions)).toEqual([["l_un"], ["o_zero"], ["l_un"]]);
  });

  it("gère la monnaie finale, le négatif entre parenthèses et le signe moins", () => {
    expect(norm("Clients 1 234 56O FCFA").texte).toBe("Clients 1 234 560 FCFA");
    expect(norm("Clients 1 234 56O F CFA").texte).toBe("Clients 1 234 560 F CFA");
    expect(norm("Dettes (1 234 56O)").texte).toBe("Dettes (1 234 560)");
    expect(norm("Dettes -1 234 56O").texte).toBe("Dettes -1 234 560");
    expect(norm("Clients 1 234 56O 1 100 000").texte).toBe("Clients 1 234 560 1 100 000");
  });

  it("ne réécrit jamais un libellé ou un mot ordinaire", () => {
    for (const t of [
      "Olivier SARL 1 234 567",
      "Illimité 1 234 567",
      "Total l'actif 1 234 567",
      "Olivier SARL",
      "Il y a 12 O",
      "Clients O",
      "Ollo | 1 234 567",
      "| 1 234 567 |",
    ]) {
      expect(norm(t)).toEqual({ texte: t, changements: [] });
    }
  });

  it("laisse intact un jeton ambigu (plusieurs lettres confondables) et s'arrête à lui", () => {
    expect(norm("Clients 12O4O")).toEqual({ texte: "Clients 12O4O", changements: [] });
    expect(norm("Clients 12O4O 1 234 56O").texte).toBe("Clients 12O4O 1 234 560");
    expect(norm("Clients 1 234 12O4O").changements).toEqual([]);
  });

  it("n'examine pas les mots courts à lettre isolés (notes, numéros) ni les années", () => {
    for (const t of [
      "Immobilisations note l2",
      "Clients 5OO",
      "Clients 5O",
      "Clients 12 5O",
      "Exercice 2O24",
      "Exercice 2O24 1 234 567",
      "Clients 2O12",
    ]) {
      expect(norm(t).changements).toEqual([]);
    }
  });

  it("n'écrit qu'un l ou I isolé à un blanc d'un groupe de trois, pas une lettre isolée quelconque", () => {
    expect(norm("Clients O 234 567").changements).toEqual([]);
    expect(norm("Clients l  234 567").changements).toEqual([]);
    expect(norm("Clients l 2345").changements).toEqual([]);
    expect(norm("Clients ll 234").changements).toEqual([]);
  });

  it("corrige les séparateurs mêlés et le point décimal répété (separateur)", () => {
    expect(norm("Clients 1,234.567")).toMatchObject({
      texte: "Clients 1 234 567",
      changements: [{ lu: "1,234.567", confusions: ["separateur"] }],
    });
    expect(norm("Clients 1.234,567").texte).toBe("Clients 1 234 567");
    expect(norm("Clients 1.234.56", 2).texte).toBe("Clients 1 234.56");
    expect(norm("Clients 1,234,56", 2).texte).toBe("Clients 1 234,56");
    expect(norm("Clients 1.234.5O", 2).texte).toBe("Clients 1 234.50");
    expect(norm("Clients 1.234.56O", 2).texte).toBe("Clients 1.234.560");
  });

  it("ne touche pas les séparateurs déjà lisibles", () => {
    for (const t of [
      "Clients 1.234.567",
      "Clients 1,234,567",
      "Clients 1 234 567",
      "Clients 1.234,56",
      "Clients 1,234.56",
      "Clients 12,50",
      "Clients 1.234.567,89",
    ]) {
      expect(norm(t, 2).changements).toEqual([]);
    }
    expect(norm("Clients 1.234.56", 0).changements).toEqual([]);
    expect(norm("Clients 1,234.567", 3).changements).toEqual([]);
    expect(norm("Clients 1.234.5", 2).texte).toBe("Clients 1 234.5");
    expect(norm("Clients 1.2345.56", 2).changements).toEqual([]);
    expect(norm("Clients 1.234.567", 2).changements).toEqual([]);
  });

  it("ignore les lignes trop longues, vides ou sans zone numérique", () => {
    const longue = `Clients ${"x".repeat(600)} 1 234 56O`;
    expect(norm(longue)).toEqual({ texte: longue, changements: [] });
    expect(norm("")).toEqual({ texte: "", changements: [] });
    expect(norm("\n\n   \n")).toEqual({ texte: "\n\n   \n", changements: [] });
    expect(norm("Clients FCFA")).toEqual({ texte: "Clients FCFA", changements: [] });
    expect(norm("1 234 56O").texte).toBe("1 234 560");
  });

  it("refuse des décimales hors bornes", () => {
    expect(() => norm("x", 5)).toThrow(ErreurDossier);
    expect(() => proposerCorrectionsOcr([], vide, -1)).toThrow(ErreurDossier);
  });

  it("est déterministe et idempotente", () => {
    const t = "ACTIF\nClients l 234 567\nStocks 1 234 56O\nAutres 1,234.567";
    const a = norm(t, 0);
    expect(norm(t, 0)).toEqual(a);
    expect(norm(a.texte, 0).changements).toEqual([]);
  });

  it("traite une page énorme en temps borné", () => {
    const ligne = "Clients divers et variés 12 345 67O 98 765 4l3";
    const t = Array.from({ length: 20_000 }, () => ligne).join("\n");
    const debut = Date.now();
    const r = norm(t);
    expect(Date.now() - debut).toBeLessThan(5000);
    expect(r.changements).toHaveLength(40_000);
    const une = `${"1".repeat(2_000_000)} O`;
    const d2 = Date.now();
    expect(norm(une).changements).toEqual([]);
    expect(Date.now() - d2).toBeLessThan(5000);
  });
});

describe("extraireEtatParReglesAvecRangs", () => {
  it("rend la même extraction et la position des lignes retenues", () => {
    const pages = page("ACTIF", "", "Clients 1 234 567", "Stocks", "Autres 10 000");
    const r = extraireEtatParReglesAvecRangs(pages, 0);
    expect(r.extraction).toEqual(extraireEtatParRegles(pages, 0));
    expect([...r.positions.keys()]).toEqual(["1:3", "1:5"]);
    expect(r.positions.get("1:3")?.montant).toBe(1234567);
  });
});

describe("proposerCorrectionsOcr", () => {
  const sectionActif = ["ACTIF", "Immobilisations 5 000 000"];

  it("propose le montant d'une ligne qu'on ne lit qu'après correction (o_zero)", () => {
    const pages = page(...sectionActif, "Clients 1 234 56O", "Stocks 800 000");
    const brute = extraireEtatParRegles(pages, 0);
    expect(brute.lignes.map((l) => l.libelle)).toEqual(["Immobilisations", "Stocks"]);
    expect(proposer(pages, 0, brute)).toEqual([
      {
        page: 1,
        code: "L1_3",
        libelle: "Clients",
        texte_lu: "1 234 56O",
        montant_propose: 1234560,
        confusions: ["o_zero"],
      },
    ]);
  });

  it("propose le montant quand il diffère après correction (l isolé)", () => {
    const pages = page(...sectionActif, "Clients l 234 567");
    const brute = extraireEtatParRegles(pages, 0);
    expect(brute.lignes.find((l) => l.code === "L1_3")?.montant).toBe(234567);
    expect(proposer(pages, 0, brute)).toEqual([
      {
        page: 1,
        code: "L1_3",
        libelle: "Clients",
        texte_lu: "l 234 567",
        montant_propose: 1234567,
        confusions: ["l_un"],
      },
    ]);
  });

  it("propose la lecture après correction de 1 234 5l7 et des séparateurs mêlés", () => {
    const pages = page(...sectionActif, "Clients 1 234 5l7", "Stocks 1,234.567");
    const r = proposer(pages, 0);
    expect(r.map((c) => [c.libelle, c.texte_lu, c.montant_propose, c.confusions])).toEqual([
      ["Clients", "1 234 5l7", 1234517, ["l_un"]],
      ["Stocks", "1,234.567", 1234567, ["separateur"]],
    ]);
  });

  it("garde les décimales de la devise et la parenthèse du négatif", () => {
    const pages = page("ACTIF", "Clients 1.234.5O", "Dettes (1 234 56O)");
    expect(proposer(pages, 2).map((c) => [c.texte_lu, c.montant_propose, c.confusions])).toEqual([
      ["1.234.5O", 123450, ["o_zero", "separateur"]],
      ["(1 234 56O)", -123456000, ["o_zero"]],
    ]);
  });

  it("n'a rien à proposer pour un texte sans confusion, vide ou 1.234.567 / 1,234,567", () => {
    expect(proposer(page(...sectionActif, "Clients 1 234 567"))).toEqual([]);
    expect(proposer(page("ACTIF", "Clients 1.234.567", "Stocks 1,234,567"))).toEqual([]);
    expect(proposer([])).toEqual([]);
    expect(proposer(page(""))).toEqual([]);
    expect(proposer(page("Olivier SARL", "Illimité 12 000"))).toEqual([]);
  });

  it("ne propose rien pour un jeton ambigu, un titre garbé ou une ligne déjà lue à l'identique", () => {
    expect(proposer(page("ACTIF", "Clients 12O4O"))).toEqual([]);
    // l'année du titre garbée n'ouvre pas de proposition : le titre n'est pas une ligne d'état
    expect(proposer(page("ACTIF 2O24", "Clients 1 234 567"))).toEqual([]);
    // confusion dans la colonne N-1 seulement, montant N identique avant et après
    expect(proposer(page("ACTIF", "Clients 1 234 567 1 100 000"))).toEqual([]);
  });

  it("propose le montant N quand la confusion est dans la colonne N-1", () => {
    const pages = page("ACTIF", "Clients 1 234 567 1 100 00O");
    expect(extraireEtatParRegles(pages, 0).lignes).toEqual([]);
    const r = proposer(pages);
    expect(r).toEqual([
      {
        page: 1,
        code: "L1_2",
        libelle: "Clients",
        texte_lu: "1 234 567 1 100 00O",
        montant_propose: 1234567,
        confusions: ["o_zero"],
      },
    ]);
  });

  it("raccourcit le jeton lu quand l'ensemble dépasse 60 caractères", () => {
    const pages = page("ACTIF", `Clients 1 234 567 ${"1 000 ".repeat(1)}00O`);
    expect(proposer(pages)[0]?.texte_lu.length).toBeLessThanOrEqual(60);
  });

  it("ne change jamais l'extraction retenue", () => {
    const pages = page(...sectionActif, "Clients l 234 567", "Stocks 1 234 56O");
    const avant = JSON.stringify(extraireEtatParRegles(pages, 0));
    const extraction = extraireEtatParRegles(pages, 0);
    proposerCorrectionsOcr(pages, extraction, 0);
    expect(JSON.stringify(extraction)).toBe(avant);
    expect(JSON.stringify(extraireEtatParRegles(pages, 0))).toBe(avant);
  });

  it("n'ajoute pas ce que l'extraction retenue contient déjà (lignes du modèle comprises)", () => {
    const pages = page("ACTIF", "Clients 1 234 56O", "Stocks 1 234 567");
    const modele: ExtractionEtat = {
      lignes: [
        {
          code: "CL",
          libelle: "Clients",
          section: "actif",
          montant: 1234560,
          parent: null,
          role: null,
          page: 1,
        },
      ],
      rejets: [],
    };
    expect(proposer(pages, 0, modele)).toEqual([]);
  });

  it("second essai d'ancrage des lignes du modèle rejetées montant_absent_de_la_page", () => {
    const texte = ["ACTIF", "AD Frais de recherche 1 234 56O", "Stocks 800 000"];
    const pages = page(...texte);
    const lignes = [
      "1 | actif | AD | | | Frais de recherche | 1234560",
      "1 | actif | ST | | | Stocks | 800000",
    ];
    const extraction = lireLignesEtatIa(lignes, pages, 0);
    expect(extraction.rejets.map((r) => r.motif)).toEqual(["montant_absent_de_la_page"]);
    expect(extraction.lignes.map((l) => l.code)).toEqual(["ST"]);
    // la règle sur le texte normalisé lit aussi la ligne : la proposition vient d'un seul chemin
    const r = proposerCorrectionsOcr(pages, extraction, 0);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ libelle: "Frais de recherche", montant_propose: 1234560 });
    expect(r[0]?.texte_lu).toBe("1 234 56O");
  });

  it("ancre le montant du modèle même quand les règles ne lisent pas la ligne", () => {
    // la ligne n'a pas de section pour les règles (aucun titre) mais le modèle la cite
    const pages = page("Frais de recherche 1 234 56O");
    const extraction = lireLignesEtatIa(
      ["1 | actif | AD | | | Frais de recherche | 1234560"],
      pages,
      0,
    );
    expect(extraction.rejets[0]?.motif).toBe("montant_absent_de_la_page");
    expect(proposerCorrectionsOcr(pages, extraction, 0)).toEqual([
      {
        page: 1,
        code: "AD",
        libelle: "Frais de recherche",
        texte_lu: "1 234 56O",
        montant_propose: 1234560,
        confusions: ["o_zero"],
      },
    ]);
  });

  it("ne propose pas pour une ligne du modèle dont le montant ne correspond pas même corrigé", () => {
    const pages = page("Frais de recherche 1 234 56O");
    const extraction = lireLignesEtatIa(
      [
        "1 | actif | AD | | | Frais de recherche | 999999",
        "2 | actif | X | | | Y | 1",
        "not | a | line",
      ],
      pages,
      0,
    );
    expect(proposerCorrectionsOcr(pages, extraction, 0)).toEqual([]);
    const sansPage: ExtractionEtat = {
      lignes: [],
      rejets: [
        { page: null, texte: "x", motif: "montant_absent_de_la_page" },
        { page: 1, texte: "1 | a | b", motif: "montant_absent_de_la_page" },
        { page: 1, texte: "1 | actif | AD | | | | 1234560", motif: "montant_absent_de_la_page" },
        {
          page: 1,
          texte: "1 | actif | AD | | | Frais de recherche | abc",
          motif: "montant_absent_de_la_page",
        },
        {
          page: 7,
          texte: "7 | actif | AD | | | Frais de recherche | 1234560",
          motif: "montant_absent_de_la_page",
        },
      ],
    };
    expect(proposerCorrectionsOcr(pages, sansPage, 0)).toEqual([]);
  });

  it("borne le nombre de propositions et les lignes du modèle examinées", () => {
    const lignes = ["ACTIF"];
    for (let i = 0; i < 150; i++) lignes.push("Poste Alpha 1 234 56O");
    const pages = page(...lignes);
    const r = proposer(pages);
    expect(r).toHaveLength(CORRECTIONS_OCR_PROPOSEES_MAX);
    expect(r[0]?.code).toBe("L1_2");
    const rejets: ExtractionEtat = {
      lignes: [],
      rejets: Array.from({ length: 300 }, (_, i) => ({
        page: 1,
        texte: `1 | actif | Z${i} | | | Poste inconnu ${i} | 5`,
        motif: "montant_absent_de_la_page" as const,
      })),
    };
    expect(proposerCorrectionsOcr(pages, rejets, 0).length).toBeLessThanOrEqual(100);
  });

  it("classe les propositions par page puis par ligne, quel que soit l'ordre des pages", () => {
    const pages: PageTexte[] = [
      { numero: 2, texte: "ACTIF\nStocks 1 234 56O" },
      { numero: 1, texte: "ACTIF\nClients 1 234 56O" },
    ];
    expect(proposer(pages).map((c) => c.page)).toEqual([1, 2]);
  });

  it("est déterministe", () => {
    const pages = page(...sectionActif, "Clients l 234 567", "Stocks 1 234 5l7");
    expect(proposer(pages)).toEqual(proposer(pages));
  });

  it("traite de gros documents sans dépasser le temps imparti", () => {
    const lignes = ["ACTIF"];
    for (let i = 0; i < 8000; i++) lignes.push(`Poste ${i} 1 234 56O 1 100 000`);
    const debut = Date.now();
    const r = proposer(page(...lignes));
    expect(Date.now() - debut).toBeLessThan(15_000);
    expect(r).toHaveLength(100);
  });
});
