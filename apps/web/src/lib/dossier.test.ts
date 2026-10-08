import { describe, expect, it } from "vitest";
import {
  cheminExport,
  cheminImportExcel,
  erreursImport,
  etatsCourants,
  formatFichierEtat,
  formaterConstat,
  formaterReference,
  formaterSource,
  formaterValeurFacteur,
  formaterValeurFait,
  grouperFriseParAnnee,
  grouperParCategorie,
  hrefDossiers,
  lireParametresDossiers,
  ongletsDossier,
  SAISIE_FAIT_VIDE,
  saisieRemplacement,
  validerDecisionEtat,
  validerDecisionFait,
  validerFacteur,
  validerFait,
  validerImportEtat,
  versCle,
  type EtatFinancier,
  type EvenementFrise,
  type Fait,
  type SaisieFacteur,
} from "./dossier";

const NNBSP = "\u202f";
const NBSP = "\u00a0";

describe("mise en forme", () => {
  it("formate les valeurs de faits et de facteurs", () => {
    expect(formaterValeurFait({ type: "montant", montant: 1_500_000, devise: "XOF" })).toBe(
      `1${NNBSP}500${NNBSP}000${NBSP}FCFA`,
    );
    expect(formaterValeurFait({ type: "date", date: "2026-01-31" })).toBe("31 janv. 2026");
    expect(formaterValeurFait({ type: "booleen", booleen: false })).toBe("Non");
    expect(formaterValeurFait({ type: "nombre", nombre: 12.5 })).toBe("12,5");
    expect(formaterValeurFait({ type: "texte", texte: "Abidjan" })).toBe("Abidjan");
    expect(formaterValeurFait(null)).toBe("—");
    expect(formaterValeurFacteur(true)).toBe("Oui");
    expect(formaterValeurFacteur(42)).toBe("42");
    expect(formaterValeurFacteur(["cacao", "anacarde"])).toBe("cacao, anacarde");
    expect(formaterValeurFacteur([])).toBe("—");
    expect(formaterValeurFacteur("forte")).toBe("forte");
    expect(formaterValeurFacteur(undefined)).toBe("—");
  });

  it("formate sources, références et constats", () => {
    expect(
      formaterSource({
        type: "document",
        libelle: "Liasse 2025",
        document_id: null,
        page: 4,
        reference: "note 3",
      }),
    ).toBe("Document — Liasse 2025 (p. 4, note 3)");
    expect(
      formaterSource({
        type: "entretien",
        libelle: "DAF",
        document_id: null,
        page: null,
        reference: null,
      }),
    ).toBe("Entretien — DAF");
    expect(formaterReference({ fichier: "liasse.xlsx", cellule: "D12", ligne: 12 })).toBe(
      "liasse.xlsx, cellule D12",
    );
    expect(formaterReference({ fichier: null, ligne: 7 })).toBe("ligne 7");
    expect(formaterReference({ page: 3, feuille: "Bilan" })).toBe("feuille Bilan, p. 3");
    expect(formaterReference({})).toBe("—");
    expect(formaterReference(null)).toBe("—");
    const ecart = {
      code: "EQUILIBRE_BILAN" as const,
      statut: "ecart" as const,
      cible: null,
      attendu: 1000,
      constate: 990,
      ecart: -10,
      lignes: [],
      message: "",
    };
    expect(formaterConstat(ecart, "XOF")).toContain("Équilibre du bilan : écart de");
    expect(
      formaterConstat({ ...ecart, statut: "ok", cible: "AZ", code: "SOUS_TOTAL" }, "XOF"),
    ).toBe("Sous-total (AZ) : conforme.");
    expect(
      formaterConstat({ ...ecart, statut: "non_verifiable", message: "Actif absent." }, "XOF"),
    ).toBe("Équilibre du bilan : non vérifiable. Actif absent.");
  });

  it("groupe les faits par catégorie et la frise par année", () => {
    const g = grouperParCategorie([
      { categorie: "finances" as const, id: "1" },
      { categorie: "profil" as const, id: "2" },
      { categorie: "finances" as const, id: "3" },
    ]);
    expect(g.map((x) => [x.categorie, x.faits.length])).toEqual([
      ["profil", 1],
      ["finances", 2],
    ]);
    const ev = (date: string): EvenementFrise => ({
      type: "fait",
      id: date,
      date,
      libelle: "",
      mission_id: null,
    });
    expect(
      grouperFriseParAnnee([
        ev("2026-03-01T10:00:00.000Z"),
        ev("2026-01-01"),
        ev("2025-12-31"),
      ]).map((x) => [x.annee, x.evenements.length]),
    ).toEqual([
      ["2026", 2],
      ["2025", 1],
    ]);
  });

  it("garde les états courants, un par exercice, du plus récent au plus ancien", () => {
    const e = (exercice: number, statut: EtatFinancier["statut"]) =>
      ({ exercice, statut }) as EtatFinancier;
    expect(
      etatsCourants([
        e(2023, "accepte"),
        e(2025, "en_revue"),
        e(2025, "remplace"),
        e(2024, "rejete"),
      ]).map((x) => x.exercice),
    ).toEqual([2025, 2023]);
  });
});

describe("liste et chemins", () => {
  it("lit et reconstruit les paramètres de la liste", () => {
    expect(lireParametresDossiers({ q: "  sotra ", curseur: "abc_-1" })).toEqual({
      q: "sotra",
      curseur: "abc_-1",
    });
    expect(lireParametresDossiers({ q: ["a", "b"], curseur: "pas valide!" })).toEqual({
      q: "a",
      curseur: undefined,
    });
    expect(hrefDossiers({ q: "" })).toBe("/dossiers");
    expect(hrefDossiers({ q: "a b", curseur: "x" })).toBe("/dossiers?q=a+b&curseur=x");
  });

  it("construit les chemins d'export, d'import et les onglets", () => {
    expect(cheminExport("id", "zip")).toBe("/api/dossiers/id/export?format=zip");
    expect(
      cheminImportExcel("id", {
        exercice: 2025,
        date_cloture: "2025-12-31",
        devise: "XOF",
        tolerance: 0,
      }),
    ).toBe(
      "/api/dossiers/id/etats-financiers/excel?exercice=2025&date_cloture=2025-12-31&devise=XOF&tolerance=0",
    );
    expect(ongletsDossier("id").map((o) => o.href)).toEqual([
      "/dossiers/id",
      "/dossiers/id/faits",
      "/dossiers/id/finances",
      "/dossiers/id/frise",
    ]);
  });
});

describe("saisie d'un fait", () => {
  const saisie = {
    ...SAISIE_FAIT_VIDE,
    cle: "Effectif total",
    type_valeur: "nombre" as const,
    valeur: "42",
    date_effet: "2026-01-01",
    source_libelle: "Entretien DAF",
  };

  it("produit le corps attendu par l'API", () => {
    const r = validerFait(saisie);
    expect(r).toEqual({
      ok: true,
      charge: {
        categorie: "profil",
        cle: "effectif_total",
        valeur: { type: "nombre", nombre: 42 },
        date_effet: "2026-01-01",
        source: { type: "entretien", libelle: "Entretien DAF" },
        fiabilite: "B",
        statut: "propose",
      },
    });
    const montant = validerFait({
      ...saisie,
      type_valeur: "montant",
      valeur: "1 500,50",
      devise: "EUR",
      confirmer: true,
      commentaire: " ok ",
      remplace_id: "x",
    });
    expect(montant.ok && montant.charge).toMatchObject({
      valeur: { type: "montant", montant: 150050, devise: "EUR" },
      statut: "confirme",
      commentaire: "ok",
      remplace_id: "x",
    });
    const doc = validerFait({ ...saisie, source_type: "document", source_page: "4" });
    expect(doc.ok && doc.charge.source).toEqual({
      type: "document",
      libelle: "Entretien DAF",
      page: 4,
    });
    expect(validerFait({ ...saisie, type_valeur: "booleen", valeur: "oui" })).toMatchObject({
      ok: true,
      charge: { valeur: { type: "booleen", booleen: true } },
    });
    expect(validerFait({ ...saisie, type_valeur: "date", valeur: "2025-12-31" })).toMatchObject({
      ok: true,
    });
    expect(validerFait({ ...saisie, type_valeur: "texte", valeur: "Abidjan" })).toMatchObject({
      ok: true,
    });
  });

  it("signale chaque champ en erreur", () => {
    const r = validerFait({ ...SAISIE_FAIT_VIDE, cle: "!!!", source_page: "2" });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.erreurs).sort()).toEqual([
      "cle",
      "date_effet",
      "source_libelle",
      "source_page",
      "valeur",
    ]);
    for (const [type, valeur] of [
      ["nombre", "douze"],
      ["montant", "-5"],
      ["date", "31/12/2025"],
      ["booleen", "peut-être"],
      ["texte", "x".repeat(2001)],
    ] as const) {
      expect(validerFait({ ...saisie, type_valeur: type, valeur }).ok).toBe(false);
    }
    expect(validerFait({ ...saisie, source_libelle: "x".repeat(301) }).ok).toBe(false);
  });

  it("prépare un remplacement et normalise une clé", () => {
    const f = {
      id: "f1",
      categorie: "finances",
      cle: "ca",
      valeur: { type: "montant", montant: 1, devise: "EUR" },
    } as Fait;
    expect(saisieRemplacement(f)).toMatchObject({
      categorie: "finances",
      cle: "ca",
      type_valeur: "montant",
      devise: "EUR",
      remplace_id: "f1",
    });
    expect(saisieRemplacement({ ...f, valeur: { type: "texte", texte: "x" } }).devise).toBe("XOF");
    expect(versCle("  Chiffre d'affaires 2025 ")).toBe("chiffre_d_affaires_2025");
  });
});

describe("saisie d'un facteur", () => {
  const base: SaisieFacteur = {
    code: "fiabilite_comptes",
    type: "booleen",
    valeur: "non_certifies",
    date_effet: "2026-01-01",
    source_type: "document",
    source_libelle: "Rapport du CAC",
    fiabilite: "A",
  };

  it("impose les valeurs des facteurs de convention", () => {
    expect(validerFacteur(base)).toMatchObject({
      ok: true,
      charge: { type: "enumeration", valeur: "non_certifies" },
    });
    const r = validerFacteur({ ...base, valeur: "inconnu" });
    expect(!r.ok && r.erreurs.valeur).toContain("Certifiés");
  });

  it("type chaque valeur et signale les erreurs", () => {
    const f = (type: SaisieFacteur["type"], valeur: string) =>
      validerFacteur({ ...base, code: "filiere", type, valeur });
    expect(f("booleen", "oui")).toMatchObject({ ok: true, charge: { valeur: true } });
    expect(f("nombre", "1 500")).toMatchObject({ ok: true, charge: { valeur: 1500 } });
    expect(f("enumeration", "cacao")).toMatchObject({ ok: true, charge: { valeur: "cacao" } });
    expect(f("liste", "cacao, anacarde, cacao")).toMatchObject({
      ok: true,
      charge: { valeur: ["cacao", "anacarde"] },
    });
    for (const [type, valeur] of [
      ["booleen", "x"],
      ["nombre", "x"],
      ["enumeration", "Cacao !"],
      ["liste", ""],
    ] as const) {
      expect(f(type, valeur).ok).toBe(false);
    }
    const r = validerFacteur({
      ...base,
      code: "",
      valeur: "oui",
      date_effet: "",
      source_libelle: "",
    });
    expect(!r.ok && Object.keys(r.erreurs).sort()).toEqual([
      "code",
      "date_effet",
      "source_libelle",
    ]);
  });
});

describe("décisions", () => {
  it("exige un motif pour rejeter ou accepter un état en écart", () => {
    expect(validerDecisionEtat("accepte", "", true)).toEqual({
      ok: true,
      charge: { decision: "accepte" },
    });
    expect(validerDecisionEtat("accepte", "", false).ok).toBe(false);
    expect(validerDecisionEtat("rejete", " ", true).ok).toBe(false);
    expect(validerDecisionEtat("accepte", "Arrondis", false)).toEqual({
      ok: true,
      charge: { decision: "accepte", motif: "Arrondis" },
    });
    expect(validerDecisionEtat("rejete", "x".repeat(2001), true).ok).toBe(false);
    expect(validerDecisionFait("rejete", "").ok).toBe(false);
    expect(validerDecisionFait("confirme", "")).toEqual({
      ok: true,
      charge: { decision: "confirme" },
    });
    expect(validerDecisionFait("rejete", "Doublon")).toEqual({
      ok: true,
      charge: { decision: "rejete", motif: "Doublon" },
    });
  });
});

describe("import d'un état financier", () => {
  const s = { exercice: "2025", date_cloture: "2025-12-31", devise: "XOF" as const, tolerance: "" };

  it("valide l'en-tête et le fichier", () => {
    expect(validerImportEtat(s, { name: "Liasse.XLSX", size: 10 })).toEqual({
      ok: true,
      charge: {
        exercice: 2025,
        date_cloture: "2025-12-31",
        devise: "XOF",
        tolerance: 0,
        format: "excel",
      },
    });
    expect(validerImportEtat({ ...s, tolerance: "5" }, { name: "l.csv", size: 10 })).toMatchObject({
      ok: true,
      charge: { format: "csv", tolerance: 5 },
    });
    const r = validerImportEtat({ ...s, exercice: "25", date_cloture: "", tolerance: "-1" }, null);
    expect(!r.ok && Object.keys(r.erreurs).sort()).toEqual([
      "date_cloture",
      "exercice",
      "fichier",
      "tolerance",
    ]);
    expect(validerImportEtat(s, { name: "l.pdf", size: 10 }).ok).toBe(false);
    expect(validerImportEtat(s, { name: "l.csv", size: 0 }).ok).toBe(false);
    expect(validerImportEtat(s, { name: "l.xlsx", size: 3 * 1024 * 1024 }).ok).toBe(false);
    expect(validerImportEtat(s, { name: "l.csv", size: 300_000 }).ok).toBe(false);
    expect(formatFichierEtat("x.xls")).toBeNull();
  });

  it("lit le rapport d'un import refusé", () => {
    expect(erreursImport({ erreurs: [{ ligne: 2, message: "x" }, { ligne: "3" }, null] })).toEqual([
      { ligne: 2, message: "x" },
    ]);
    expect(erreursImport(null)).toEqual([]);
    expect(erreursImport({ erreurs: "x" })).toEqual([]);
  });
});
