import { describe, expect, it } from "vitest";
import { TEXTE_SCAN_OCR } from "./ingestion";
import {
  aideTeleversement,
  avertissementOcrPertinent,
  messageAucunePage,
} from "./ingestion-detail";

describe("messageAucunePage", () => {
  it("lecture en cours pour un document en attente ou en traitement", () => {
    for (const s of ["en_file", "extraction", "structuration"] as const) {
      expect(messageAucunePage(s)).toMatch(/Lecture en cours/);
    }
  });

  it("échec : message adapté, motif ajouté s'il existe", () => {
    expect(messageAucunePage("echec")).toBe(
      "Aucune page n'a pu être lue (document vide ou illisible).",
    );
    expect(messageAucunePage("echec", "  Le PDF est vide.  ")).toBe(
      "Aucune page n'a pu être lue (document vide ou illisible). Le PDF est vide.",
    );
    expect(messageAucunePage("echec", "  ")).not.toMatch(/\s$/);
  });

  it("terminé sans page, ou statut inconnu : message neutre", () => {
    expect(messageAucunePage("termine")).toBe("Ce document ne contient aucune page lue.");
    expect(messageAucunePage(undefined)).toBe("Ce document ne contient aucune page lue.");
    expect(messageAucunePage("termine")).not.toMatch(/pour l'instant/);
  });
});

describe("aide OCR", () => {
  it("la consigne OCR n'accompagne que l'import d'un état financier", () => {
    expect(aideTeleversement("etat_financier")).toContain(TEXTE_SCAN_OCR);
    const autre = aideTeleversement("autre");
    expect(autre).not.toContain("part toujours en revue");
    expect(autre).toContain("classeur Excel");
  });

  it("l'avertissement OCR du détail exige un OCR effectif et pas d'échec", () => {
    expect(avertissementOcrPertinent({ statut: "termine", methode: "ocr" })).toBe(true);
    expect(avertissementOcrPertinent({ statut: "termine", methode: "ocr_simule" })).toBe(true);
    expect(avertissementOcrPertinent({ statut: "termine", methode: "texte" })).toBe(false);
    expect(avertissementOcrPertinent({ statut: "echec", methode: "ocr" })).toBe(false);
    expect(avertissementOcrPertinent({ statut: "echec", methode: null })).toBe(false);
  });
});
