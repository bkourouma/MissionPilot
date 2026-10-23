import { describe, expect, it } from "vitest";
import { PLAFONDS_INGESTION, PLAFONDS_OCR } from "@missionpilot/shared";
import {
  ACCEPT_INGESTION,
  aideLimitesIngestion,
  TEXTE_SCAN_OCR,
  apiIngestionDd,
  apiIngestionDossier,
  apiIngestionStandard,
  auMoinsUnEnCours,
  avecRequete,
  cheminDecisionExtraction,
  cheminDocument,
  cheminExtraction,
  cheminListe,
  cheminRelance,
  cheminTeleversementAmorcage,
  cheminTeleversementDd,
  cheminPageDocument,
  cheminTeleversementEtat,
  controlerFichierIngestion,
  documentEnCours,
  aideErreurIngestion,
  decrireConfusionsOcr,
  erreurDocument,
  erreurDocumentAvecAide,
  libelleConfusionOcr,
  libelleMethode,
  methodeOcr,
  formatDepuisNom,
  formaterConfiancePage,
  formaterTaille,
  hrefAmorcage,
  hrefDocumentAmorcage,
  hrefDocumentDd,
  hrefDocumentEtat,
  hrefDocumentsDd,
  textePurge,
  hrefEditeurVersion,
  hrefPageCitee,
  hrefEtatFinancier,
  libelleErreurIngestion,
  libelleResultat,
  libelleStatutDocument,
  libelleUsage,
  pageCitee,
  tonaliteStatutDocument,
  TEXTE_TOLERANCE,
} from "./ingestion";

const ID = "11111111-1111-4111-8111-111111111111";

describe("statuts et libellés", () => {
  it("détecte les documents en cours", () => {
    for (const s of ["en_file", "extraction", "structuration"] as const) {
      expect(documentEnCours({ statut: s })).toBe(true);
    }
    expect(documentEnCours({ statut: "termine" })).toBe(false);
    expect(documentEnCours({ statut: "echec" })).toBe(false);
    expect(auMoinsUnEnCours([{ statut: "termine" }, { statut: "extraction" }])).toBe(true);
    expect(auMoinsUnEnCours([])).toBe(false);
  });
  it("libelle statuts, résultats et usages", () => {
    expect(libelleStatutDocument("echec")).toBe("Échec");
    expect(tonaliteStatutDocument("termine")).toBe("succes");
    expect(tonaliteStatutDocument("echec")).toBe("danger");
    expect(libelleResultat(null)).toBe("—");
    expect(libelleResultat("etat_cree")).toBe("État financier créé");
    expect(libelleUsage("etat_financier")).toBe("État financier");
  });
  it("résout les erreurs, avec repli", () => {
    expect(libelleErreurIngestion(null)).toBeNull();
    expect(libelleErreurIngestion("PDF_SANS_TEXTE")).toContain("Aucun texte");
    expect(libelleErreurIngestion("INCONNU")).toContain("Erreur interne");
    expect(erreurDocument({ erreur: "Message", erreur_code: "X" })).toBe("Message");
    expect(erreurDocument({ erreur: null, erreur_code: "PLAFOND_PAGES" })).toContain("pages");
    expect(erreurDocument({ erreur: null, erreur_code: null })).toBeNull();
  });
});

describe("mise en forme", () => {
  it("formate la taille", () => {
    expect(formaterTaille(850)).toBe("850 o");
    expect(formaterTaille(1536)).toMatch(/^1,5\sKo$/);
    expect(formaterTaille(2 * 1024 * 1024)).toMatch(/^2\sMo$/);
    expect(formaterTaille(-1)).toBe("—");
  });
  it("formate la confiance", () => {
    expect(formaterConfiancePage(870)).toMatch(/^87\s%$/);
    expect(formaterConfiancePage(null)).toBe("—");
    expect(formaterConfiancePage(5000)).toMatch(/^100\s%$/);
  });
  it("lit la page citée", () => {
    expect(pageCitee("3")).toBe(3);
    expect(pageCitee(["4", "5"])).toBe(4);
    expect(pageCitee("0")).toBeNull();
    expect(pageCitee("201")).toBeNull();
    expect(pageCitee("abc")).toBeNull();
    expect(pageCitee(undefined)).toBeNull();
  });
});

describe("contrôle du fichier", () => {
  it("accepte PDF et xlsx dans les plafonds", () => {
    expect(controlerFichierIngestion({ name: "Bilan.PDF", size: 1000 })).toEqual({
      ok: true,
      format: "pdf",
    });
    expect(controlerFichierIngestion({ name: "liasse.xlsx", size: 1000 })).toEqual({
      ok: true,
      format: "xlsx",
    });
    expect(ACCEPT_INGESTION).toBe(".pdf,.xlsx");
  });
  it("refuse avec un message clair", () => {
    const refus = (f: { name: string; size: number } | null) => {
      const r = controlerFichierIngestion(f);
      return r.ok ? "" : r.message;
    };
    expect(refus(null)).toContain("Choisissez");
    expect(refus({ name: "a.csv", size: 10 })).toContain("PDF");
    expect(refus({ name: "a.pdf", size: 0 })).toContain("vide");
    expect(refus({ name: "a.pdf", size: PLAFONDS_INGESTION.tailleOctetsPdf + 1 })).toContain(
      "10 Mo",
    );
    expect(refus({ name: "a.xlsx", size: PLAFONDS_INGESTION.tailleOctetsXlsx + 1 })).toContain(
      "2 Mo",
    );
    expect(formatDepuisNom("a.docx")).toBeNull();
  });
  it("rappelle les limites et la lecture OCR des PDF scannés", () => {
    const aide = aideLimitesIngestion();
    expect(aide).toContain(TEXTE_SCAN_OCR);
    expect(aide).toContain(`${PLAFONDS_OCR.pagesMax} pages au plus`);
    expect(TEXTE_SCAN_OCR).toContain("OCR");
    expect(TEXTE_SCAN_OCR).toContain("à vérifier dans le document");
    expect(aide).not.toContain("n'est pas lu");
    expect(TEXTE_TOLERANCE).toContain("nulle");
  });
});

describe("chemins par domaine", () => {
  it("DOS-03 : routes /ingestions du client, sans relance ni extraction", () => {
    const a = apiIngestionDossier(ID);
    expect(cheminListe(a)).toBe(`/api/dossiers/${ID}/ingestions`);
    expect(cheminDocument(a, "d1")).toBe(`/api/dossiers/${ID}/ingestions/d1`);
    expect(cheminPageDocument(a, "d1", 3)).toBe(`/api/dossiers/${ID}/ingestions/d1/pages/3`);
    expect(() => cheminRelance(a, "d1")).toThrow();
    expect(() => cheminExtraction(a, "e1")).toThrow();
    expect(() => cheminDecisionExtraction(a, "e1")).toThrow();
  });
  it("DD : documents du dossier, puis documents et extractions /api/dd", () => {
    const a = apiIngestionDd(ID);
    expect(cheminListe(a)).toBe(`/api/dd/dossiers/${ID}/documents`);
    expect(cheminDocument(a, "d1")).toBe("/api/dd/documents/d1");
    expect(cheminPageDocument(a, "d1", 2)).toBe("/api/dd/documents/d1/pages/2");
    expect(cheminRelance(a, "d1")).toBe("/api/dd/documents/d1/lecture");
    expect(cheminExtraction(a, "e1")).toBe("/api/dd/extractions/e1");
    expect(cheminDecisionExtraction(a, "e1")).toBe("/api/dd/extractions/e1/decision");
  });
  it("standard : amorçage d'une version de méthode", () => {
    const a = apiIngestionStandard(ID);
    expect(cheminListe(a)).toBe(`/api/methodes/versions/${ID}/amorcage/documents`);
    expect(cheminDocument(a, "d1")).toBe("/api/amorcage/documents/d1");
    expect(cheminPageDocument(a, "d1", 5)).toBe("/api/amorcage/documents/d1/pages/5");
    expect(cheminRelance(a, "d1")).toBe("/api/amorcage/documents/d1/proposition");
    expect(cheminExtraction(a, "e1")).toBe("/api/amorcage/extractions/e1");
    expect(cheminDecisionExtraction(a, "e1")).toBe("/api/amorcage/extractions/e1/decision");
  });
  it("encode les identifiants et reste de la donnée simple (sérialisable)", () => {
    const a = apiIngestionDd(ID);
    expect(cheminDocument(a, "a/b c")).toBe("/api/dd/documents/a%2Fb%20c");
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
  it("construit les chemins de téléversement et les liens de pages", () => {
    expect(cheminTeleversementDd(ID)).toBe(`/api/dd/dossiers/${ID}/documents`);
    expect(cheminTeleversementAmorcage(ID)).toBe(`/api/methodes/versions/${ID}/amorcage/documents`);
    expect(hrefDocumentsDd("m", "d")).toBe("/missions/m/due-diligence/d/documents");
    expect(hrefDocumentDd("m", "d", "x", 4)).toBe("/missions/m/due-diligence/d/documents/x?page=4");
    expect(hrefAmorcage("v")).toBe("/methodes/versions/v/amorcage");
    expect(hrefDocumentAmorcage("v", "x")).toBe("/methodes/versions/v/amorcage/x");
    expect(hrefEditeurVersion("v")).toBe("/methodes/versions/v");
  });
  it("lie une page citée au document, avec ancre", () => {
    expect(hrefPageCitee("/a/b?page=1", 3)).toBe("/a/b?page=3#page-3");
  });
  it("ajoute la requête sans valeurs vides", () => {
    expect(avecRequete("/a", { x: 1, y: "", z: null })).toBe("/a?x=1");
    expect(avecRequete("/a?b=1", { x: 2 })).toBe("/a?b=1&x=2");
    expect(avecRequete("/a", {})).toBe("/a");
  });
  it("construit le téléversement et les liens DOS-03", () => {
    expect(
      cheminTeleversementEtat(ID, {
        exercice: 2025,
        date_cloture: "2025-12-31",
        devise: "XOF",
        tolerance: 0,
      }),
    ).toBe(
      `/api/dossiers/${ID}/etats-financiers/document?exercice=2025&date_cloture=2025-12-31&devise=XOF&tolerance=0`,
    );
    expect(hrefEtatFinancier(ID, "e")).toBe(`/dossiers/${ID}/finances/e`);
    expect(hrefDocumentEtat(ID, "d", 2)).toBe(`/dossiers/${ID}/finances/documents/d?page=2`);
    expect(hrefDocumentEtat(ID, "d")).toBe(`/dossiers/${ID}/finances/documents/d`);
  });
});

describe("texte purgé", () => {
  it("textePurge : vrai seulement quand la purge est datée", () => {
    expect(textePurge({ texte_purge_le: "2027-01-20T03:45:00Z" })).toBe(true);
    expect(textePurge({ texte_purge_le: null })).toBe(false);
    expect(textePurge({})).toBe(false);
    expect(textePurge(null)).toBe(false);
    expect(textePurge(undefined)).toBe(false);
  });
});

describe("reconnaissance de caractères (OCR)", () => {
  it("libelle la méthode ocr et reconnaît les méthodes qui lisent des images", () => {
    expect(libelleMethode("ocr")).toBe("Reconnaissance de caractères (OCR local)");
    expect(libelleMethode("texte")).toBe("Texte du PDF");
    expect(methodeOcr("ocr")).toBe(true);
    expect(methodeOcr("ocr_simule")).toBe(true);
    expect(methodeOcr("texte")).toBe(false);
    expect(methodeOcr(null)).toBe(false);
  });
  it("couvre les codes d'erreur OCR, avec une aide pour OCR_INDISPONIBLE", () => {
    for (const code of ["OCR_INDISPONIBLE", "OCR_ECHEC", "IMAGE_TROP_GRANDE"]) {
      expect(erreurDocument({ erreur: null, erreur_code: code })).toBeTruthy();
      expect(libelleErreurIngestion(code)).not.toContain("Erreur interne");
    }
    expect(aideErreurIngestion("OCR_ECHEC")).toBeNull();
    expect(aideErreurIngestion("OCR_INDISPONIBLE")).toContain("Contactez l'administrateur");
    expect(erreurDocumentAvecAide({ erreur: null, erreur_code: "OCR_INDISPONIBLE" })).toContain(
      "moteur de lecture des scans n'est pas activé",
    );
    expect(erreurDocumentAvecAide({ erreur: null, erreur_code: "OCR_ECHEC" })).not.toContain(
      "administrateur",
    );
    expect(erreurDocumentAvecAide({ erreur: null, erreur_code: null })).toBeNull();
  });
  it("décrit les confusions en clair", () => {
    expect(libelleConfusionOcr("o_zero")).toBe("lettre O lue pour le chiffre 0");
    expect(decrireConfusionsOcr(["o_zero", "separateur"])).toBe(
      "lettre O lue pour le chiffre 0 ; virgule et point confondus",
    );
    expect(decrireConfusionsOcr([])).toBe("—");
    expect(decrireConfusionsOcr(null)).toBe("—");
  });
});
