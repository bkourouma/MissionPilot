import { describe, expect, it } from "vitest";
import {
  CODES_ERREUR_INGESTION,
  CONFUSIONS_OCR,
  CORRECTIONS_OCR_MAX,
  FORMATS_INGESTION,
  LECTURE_ELEMENTS_MAX,
  LECTURE_RESUME_MAX,
  LIBELLES_CONFUSION_OCR,
  LIBELLES_ELEMENT_LECTURE,
  LIBELLES_ERREUR_INGESTION,
  LIBELLES_STATUT_EXTRACTION,
  LIBELLES_USAGE_INGESTION,
  METHODES_EXTRACTION,
  NATURES_EXTRACTION,
  PLAFONDS_INGESTION,
  PLAFONDS_OCR,
  PROPOSITION_MAXIMA,
  RESULTATS_INGESTION,
  STATUTS_DOCUMENT_INGESTION,
  STATUTS_EXTRACTION,
  TYPES_ELEMENT_LECTURE,
  USAGES_INGESTION,
  contenuLectureSchema,
  contenuPropositionSchema,
  correctionOcrSchema,
  elementLectureSchema,
  extractionDecisionSchema,
  extractionModificationSchema,
  ingestionDdQuerySchema,
  ingestionEtatQuerySchema,
  ingestionListeQuerySchema,
  numeroPageParamsSchema,
  propositionRubriqueSchema,
} from "./ingestion";

const element = {
  page: 1,
  type: "fait",
  extrait: "Le chiffre d'affaires s'élève à 1 500 000 FCFA",
  enonce: "Chiffre d'affaires de 1,5 million",
  verifie: true,
} as const;

const lecture = { resume: [{ page: 1, texte: "Résumé" }], elements: [element], tronque: false };

const niveaux = ["n1", "n2", "n3", "n4", "n5"];
const proposition = {
  etapes: [{ code: "cadrage", libelle: "Cadrage", page: 1 }],
  briques: [
    { etape_code: "cadrage", code: "kick-off", libelle: "Lancement", objet: "Aligner", page: 2 },
  ],
  elements: [
    { type: "livrable", code: "note", libelle: "Note", description: null, page: 1 },
    { type: "kpi_type", code: "marge", libelle: "Marge", page: 1 },
  ],
  rubriques: [{ code: "ecoute", libelle: "Écoute", niveaux, page: 3 }],
  tronque: false,
};

describe("plafonds d'ingestion", () => {
  const p = PLAFONDS_INGESTION;

  it("sont des entiers strictement positifs", () => {
    for (const v of Object.values(p)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("sont cohérents entre eux", () => {
    expect(p.caracteresParPage).toBeLessThanOrEqual(p.caracteresParDocument);
    expect(p.caracteresParPage * p.pagesMax).toBeGreaterThanOrEqual(p.caracteresParDocument);
    expect(p.caracteresTransmisAuModele).toBeLessThanOrEqual(p.caracteresParDocument);
    expect(p.tailleOctetsXlsx).toBeLessThanOrEqual(p.tailleOctetsPdf);
    expect(p.documentsEnTraitementParCabinet).toBeLessThanOrEqual(p.documentsParJourEtCabinet);
  });

  it("restent dans les bornes des numéros de page des schémas (200)", () => {
    expect(p.pagesMax).toBeLessThanOrEqual(200);
    expect(numeroPageParamsSchema.safeParse({ numero: String(p.pagesMax) }).success).toBe(true);
  });
});

describe("listes et libellés", () => {
  it("ont un libellé français pour chaque code", () => {
    expect(Object.keys(LIBELLES_ERREUR_INGESTION).sort()).toEqual(
      [...CODES_ERREUR_INGESTION].sort(),
    );
    expect(Object.keys(LIBELLES_USAGE_INGESTION).sort()).toEqual([...USAGES_INGESTION].sort());
    expect(Object.keys(LIBELLES_ELEMENT_LECTURE).sort()).toEqual([...TYPES_ELEMENT_LECTURE].sort());
    expect(Object.keys(LIBELLES_STATUT_EXTRACTION).sort()).toEqual([...STATUTS_EXTRACTION].sort());
    for (const libelle of Object.values(LIBELLES_ERREUR_INGESTION)) {
      expect(libelle.trim().length).toBeGreaterThan(10);
    }
  });

  it("n'ont pas de doublon", () => {
    for (const liste of [
      CODES_ERREUR_INGESTION,
      USAGES_INGESTION,
      FORMATS_INGESTION,
      STATUTS_DOCUMENT_INGESTION,
      RESULTATS_INGESTION,
      METHODES_EXTRACTION,
      NATURES_EXTRACTION,
      STATUTS_EXTRACTION,
      TYPES_ELEMENT_LECTURE,
    ] as readonly (readonly string[])[]) {
      expect(new Set(liste).size).toBe(liste.length);
    }
  });

  it("fixent les valeurs que les moteurs d'ingestion reproduisent", () => {
    expect([...TYPES_ELEMENT_LECTURE]).toEqual([
      "fait",
      "risque",
      "chiffre",
      "engagement",
      "autre",
    ]);
    expect(LECTURE_RESUME_MAX).toBe(10);
    expect(LECTURE_ELEMENTS_MAX).toBe(60);
    expect(PROPOSITION_MAXIMA).toEqual({ etapes: 20, briques: 60, elements: 100, rubriques: 30 });
  });
});

describe("requêtes", () => {
  it("liste : limite 30 par défaut, bornée de 1 à 100, schéma strict", () => {
    expect(ingestionListeQuerySchema.parse({})).toEqual({ limite: 30 });
    expect(ingestionListeQuerySchema.parse({ limite: "100", curseur: "abc" })).toEqual({
      limite: 100,
      curseur: "abc",
    });
    for (const ko of [{ limite: "0" }, { limite: "101" }, { limite: "1.5" }, { autre: 1 }]) {
      expect(ingestionListeQuerySchema.safeParse(ko).success).toBe(false);
    }
    expect(ingestionListeQuerySchema.safeParse({ curseur: "x".repeat(501) }).success).toBe(false);
  });

  it("due diligence : rapport ou salle seulement", () => {
    expect(ingestionDdQuerySchema.parse({ type: "rapport" })).toEqual({ type: "rapport" });
    expect(ingestionDdQuerySchema.parse({ type: "salle" })).toEqual({ type: "salle" });
    expect(ingestionDdQuerySchema.safeParse({ type: "autre" }).success).toBe(false);
    expect(ingestionDdQuerySchema.safeParse({}).success).toBe(false);
    expect(ingestionDdQuerySchema.safeParse({ type: "salle", x: 1 }).success).toBe(false);
  });

  it("état financier : mêmes paramètres que l'import Excel", () => {
    const ok = ingestionEtatQuerySchema.safeParse({
      exercice: "2025",
      date_cloture: "2025-12-31",
      devise: "XOF",
    });
    expect(ok.success).toBe(true);
    expect(
      ingestionEtatQuerySchema.safeParse({
        exercice: "1800",
        date_cloture: "2025-12-31",
        devise: "XOF",
      }).success,
    ).toBe(false);
    expect(
      ingestionEtatQuerySchema.safeParse({
        exercice: "2025",
        date_cloture: "2025-13-31",
        devise: "XOF",
      }).success,
    ).toBe(false);
  });

  it("numéro de page : entier de 1 à 200", () => {
    expect(numeroPageParamsSchema.parse({ numero: "3" })).toEqual({ numero: 3 });
    for (const ko of ["0", "201", "1.5", "x"]) {
      expect(numeroPageParamsSchema.safeParse({ numero: ko }).success).toBe(false);
    }
    // Strict : un paramètre inconnu est refusé.
    expect(numeroPageParamsSchema.safeParse({ numero: "3", autre: "x" }).success).toBe(false);
  });
});

describe("contenu d'une lecture (DD-02, DD-10)", () => {
  it("accepte un contenu valide et rogne les textes", () => {
    const r = contenuLectureSchema.parse({
      ...lecture,
      elements: [{ ...element, extrait: "  extrait  " }],
    });
    expect(r.elements[0]?.extrait).toBe("extrait");
    expect(
      contenuLectureSchema.safeParse({ resume: [], elements: [], tronque: true }).success,
    ).toBe(true);
  });

  it("refuse page, type, textes et champs hors bornes", () => {
    const ko = (e: Record<string, unknown>) =>
      elementLectureSchema.safeParse({ ...element, ...e }).success;
    expect(ko({})).toBe(true);
    expect(ko({ page: 0 })).toBe(false);
    expect(ko({ page: 201 })).toBe(false);
    expect(ko({ page: 1.5 })).toBe(false);
    expect(ko({ type: "opinion" })).toBe(false);
    expect(ko({ extrait: "" })).toBe(false);
    expect(ko({ extrait: "   " })).toBe(false);
    expect(ko({ extrait: "x".repeat(400) })).toBe(true);
    expect(ko({ extrait: "x".repeat(401) })).toBe(false);
    expect(ko({ enonce: "x".repeat(500) })).toBe(true);
    expect(ko({ enonce: "x".repeat(501) })).toBe(false);
    expect(ko({ verifie: "oui" })).toBe(false);
    expect(ko({ extra: 1 })).toBe(false);
    expect(elementLectureSchema.safeParse({ ...element, verifie: undefined }).success).toBe(false);
  });

  it("borne le résumé (10 × 1000 caractères) et les éléments (60)", () => {
    const resume = (n: number, taille = 5) =>
      Array.from({ length: n }, () => ({ page: 1, texte: "r".repeat(taille) }));
    const parse = (c: Record<string, unknown>) =>
      contenuLectureSchema.safeParse({ ...lecture, ...c }).success;
    expect(parse({ resume: resume(10) })).toBe(true);
    expect(parse({ resume: resume(11) })).toBe(false);
    expect(parse({ resume: resume(1, 1000) })).toBe(true);
    expect(parse({ resume: resume(1, 1001) })).toBe(false);
    expect(parse({ elements: Array(60).fill(element) })).toBe(true);
    expect(parse({ elements: Array(61).fill(element) })).toBe(false);
    expect(parse({ tronque: undefined })).toBe(false);
    expect(parse({ autre: 1 })).toBe(false);
  });
});

describe("contenu d'une proposition de standard (STD-13)", () => {
  const parse = (c: Record<string, unknown>) =>
    contenuPropositionSchema.safeParse({ ...proposition, ...c });

  it("accepte une proposition valide (description et brique_code facultatives)", () => {
    expect(parse({}).success).toBe(true);
    expect(
      parse({
        elements: [
          {
            type: "gabarit",
            code: "g",
            libelle: "G",
            description: "",
            brique_code: "kick-off",
            page: 1,
          },
          { type: "automatisation", code: "a", libelle: "A", brique_code: null, page: 1 },
        ],
      }).success,
    ).toBe(true);
    expect(parse({ etapes: [], briques: [], elements: [], rubriques: [] }).success).toBe(true);
  });

  it("exige exactement cinq niveaux non vides par rubrique", () => {
    const rubrique = (n: string[]) =>
      propositionRubriqueSchema.safeParse({ code: "r", libelle: "R", niveaux: n, page: 1 }).success;
    expect(rubrique(niveaux)).toBe(true);
    expect(rubrique(niveaux.slice(0, 4))).toBe(false);
    expect(rubrique([...niveaux, "n6"])).toBe(false);
    expect(rubrique(["n1", "n2", "n3", "n4", ""])).toBe(false);
    expect(rubrique(["n1", "n2", "n3", "n4", "x".repeat(1001)])).toBe(false);
    expect(rubrique(["n1", "n2", "n3", "n4", "x".repeat(1000)])).toBe(true);
  });

  it("impose la forme des codes du référentiel", () => {
    const code = (c: string) => parse({ etapes: [{ code: c, libelle: "E", page: 1 }] }).success;
    expect(code("a_b.c-9")).toBe(true);
    expect(code("A")).toBe(false);
    expect(code("a b")).toBe(false);
    expect(code("é")).toBe(false);
    expect(code("")).toBe(false);
    expect(code("a".repeat(120))).toBe(true);
    expect(code("a".repeat(121))).toBe(false);
  });

  it("refuse type d'élément inconnu, textes trop longs, page hors bornes et champ en trop", () => {
    expect(
      parse({ elements: [{ type: "machin", code: "c", libelle: "C", page: 1 }] }).success,
    ).toBe(false);
    expect(parse({ etapes: [{ code: "e", libelle: "x".repeat(201), page: 1 }] }).success).toBe(
      false,
    );
    expect(
      parse({
        briques: [{ etape_code: "e", code: "b", libelle: "B", objet: "x".repeat(2001), page: 1 }],
      }).success,
    ).toBe(false);
    expect(
      parse({ briques: [{ etape_code: "e", code: "b", libelle: "B", objet: "", page: 1 }] })
        .success,
    ).toBe(false);
    expect(parse({ etapes: [{ code: "e", libelle: "E", page: 0 }] }).success).toBe(false);
    expect(parse({ etapes: [{ code: "e", libelle: "E", page: 1, x: 1 }] }).success).toBe(false);
    expect(parse({ tronque: "non" }).success).toBe(false);
  });

  it("applique les maxima : 20 étapes, 60 briques, 100 éléments, 30 rubriques", () => {
    const n = (k: number, f: (i: number) => unknown) => Array.from({ length: k }, (_, i) => f(i));
    const etape = (i: number) => ({ code: `e${i}`, libelle: "E", page: 1 });
    const brique = (i: number) => ({
      etape_code: "e0",
      code: `b${i}`,
      libelle: "B",
      objet: "O",
      page: 1,
    });
    const elem = (i: number) => ({ type: "item", code: `i${i}`, libelle: "I", page: 1 });
    const rub = (i: number) => ({ code: `r${i}`, libelle: "R", niveaux, page: 1 });
    expect(parse({ etapes: n(20, etape) }).success).toBe(true);
    expect(parse({ etapes: n(21, etape) }).success).toBe(false);
    expect(parse({ briques: n(60, brique) }).success).toBe(true);
    expect(parse({ briques: n(61, brique) }).success).toBe(false);
    expect(parse({ elements: n(100, elem) }).success).toBe(true);
    expect(parse({ elements: n(101, elem) }).success).toBe(false);
    expect(parse({ rubriques: n(30, rub) }).success).toBe(true);
    expect(parse({ rubriques: n(31, rub) }).success).toBe(false);
  });
});

describe("décision et correction d'une extraction", () => {
  it("exige un motif pour rejeter, jamais pour valider", () => {
    expect(extractionDecisionSchema.safeParse({ decision: "validee" }).success).toBe(true);
    expect(extractionDecisionSchema.safeParse({ decision: "rejetee" }).success).toBe(false);
    expect(extractionDecisionSchema.safeParse({ decision: "rejetee", motif: "" }).success).toBe(
      false,
    );
    expect(extractionDecisionSchema.safeParse({ decision: "rejetee", motif: "   " }).success).toBe(
      false,
    );
    expect(extractionDecisionSchema.safeParse({ decision: "rejetee", motif: null }).success).toBe(
      false,
    );
    const ok = extractionDecisionSchema.safeParse({ decision: "rejetee", motif: " Hors sujet " });
    expect(ok.success && ok.data.motif).toBe("Hors sujet");
  });

  it("refuse l'erreur de décision, le motif trop long et les champs en trop", () => {
    expect(extractionDecisionSchema.safeParse({ decision: "peut-etre" }).success).toBe(false);
    expect(
      extractionDecisionSchema.safeParse({ decision: "validee", motif: "x".repeat(1001) }).success,
    ).toBe(false);
    expect(extractionDecisionSchema.safeParse({ decision: "validee", x: 1 }).success).toBe(false);
  });

  it("accepte l'acquittement des chiffres non vérifiés, booléen seulement", () => {
    const r = extractionDecisionSchema.parse({ decision: "validee", acquitte_chiffres: true });
    expect(r.acquitte_chiffres).toBe(true);
    expect(
      extractionDecisionSchema.safeParse({ decision: "validee", acquitte_chiffres: "oui" }).success,
    ).toBe(false);
  });

  it("la correction porte le contenu complet, sans champ en trop", () => {
    expect(extractionModificationSchema.safeParse({ contenu: lecture }).success).toBe(true);
    expect(extractionModificationSchema.safeParse({ contenu: "x" }).success).toBe(false);
    expect(extractionModificationSchema.safeParse({ contenu: {}, x: 1 }).success).toBe(false);
    expect(extractionModificationSchema.safeParse({}).success).toBe(false);
  });
});

describe("OCR local (lot 11)", () => {
  it("plafonds : entiers positifs, cohérents avec ceux de l'ingestion", () => {
    for (const v of Object.values(PLAFONDS_OCR)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(PLAFONDS_OCR.pagesMax).toBeLessThanOrEqual(PLAFONDS_INGESTION.pagesMax);
    expect(PLAFONDS_OCR.dureeMs).toBeGreaterThan(PLAFONDS_INGESTION.dureeExtractionMs);
  });

  it("la méthode ocr est admise, à côté de ocr_simule", () => {
    expect(METHODES_EXTRACTION).toContain("ocr");
    expect(METHODES_EXTRACTION).toContain("ocr_simule");
  });

  it("les nouveaux codes d'erreur ont un libellé français explicite", () => {
    for (const code of ["OCR_INDISPONIBLE", "OCR_ECHEC", "IMAGE_TROP_GRANDE"] as const) {
      expect(CODES_ERREUR_INGESTION).toContain(code);
      expect(LIBELLES_ERREUR_INGESTION[code].trim().length).toBeGreaterThan(20);
    }
    expect(LIBELLES_ERREUR_INGESTION.OCR_INDISPONIBLE).toMatch(/scanné/);
  });

  it("une confusion a un libellé, sans doublon", () => {
    expect(Object.keys(LIBELLES_CONFUSION_OCR).sort()).toEqual([...CONFUSIONS_OCR].sort());
    expect(new Set(CONFUSIONS_OCR).size).toBe(CONFUSIONS_OCR.length);
    expect(CORRECTIONS_OCR_MAX).toBe(100);
  });

  const correction = {
    page: 2,
    code: "L2_5",
    libelle: "Clients",
    texte_lu: "1 234 56O",
    montant_propose: 1_234_560,
    confusions: ["o_zero"],
  };

  it("correctionOcrSchema accepte une correction complète, négative comprise", () => {
    expect(correctionOcrSchema.safeParse(correction).success).toBe(true);
    expect(correctionOcrSchema.safeParse({ ...correction, montant_propose: -5 }).success).toBe(
      true,
    );
    expect(
      correctionOcrSchema.safeParse({ ...correction, confusions: ["o_zero", "l_un", "separateur"] })
        .success,
    ).toBe(true);
  });

  it("correctionOcrSchema est strict et borné", () => {
    expect(correctionOcrSchema.safeParse({ ...correction, x: 1 }).success).toBe(false);
    expect(correctionOcrSchema.safeParse({ ...correction, montant_propose: 1.5 }).success).toBe(
      false,
    );
    expect(correctionOcrSchema.safeParse({ ...correction, confusions: [] }).success).toBe(false);
    expect(correctionOcrSchema.safeParse({ ...correction, confusions: ["autre"] }).success).toBe(
      false,
    );
    expect(
      correctionOcrSchema.safeParse({
        ...correction,
        confusions: ["o_zero", "l_un", "separateur", "o_zero"],
      }).success,
    ).toBe(false);
    expect(correctionOcrSchema.safeParse({ ...correction, page: 0 }).success).toBe(false);
    expect(correctionOcrSchema.safeParse({ ...correction, page: 201 }).success).toBe(false);
    expect(correctionOcrSchema.safeParse({ ...correction, texte_lu: "" }).success).toBe(false);
    expect(correctionOcrSchema.safeParse({ ...correction, texte_lu: "x".repeat(61) }).success).toBe(
      false,
    );
    expect(correctionOcrSchema.safeParse({ ...correction, libelle: "x".repeat(201) }).success).toBe(
      false,
    );
    expect(correctionOcrSchema.safeParse({ ...correction, code: "" }).success).toBe(false);
    const sansMontant: Record<string, unknown> = { ...correction };
    delete sansMontant.montant_propose;
    expect(correctionOcrSchema.safeParse(sansMontant).success).toBe(false);
  });
});
