import { describe, expect, it } from "vitest";
import type { ContenuLecture, ContenuProposition } from "@missionpilot/shared";
import {
  compterNonVerifies,
  compterProposition,
  corpsDecision,
  droitsIngestionDd,
  droitsIngestionStandard,
  ENONCE_MAX,
  erreurDecision,
  erreurEnonce,
  extractionCourante,
  extractionOuverte,
  libelleFamilleApplication,
  libelleMotifIgnore,
  libelleTypeElementLecture,
  libelleTypeElementMethode,
  libelleVerification,
  lireResultatApplication,
  modifierEnonceLecture,
  relancePossible,
  retirerDeProposition,
  retirerElementLecture,
  totalCrees,
  totalProposition,
} from "./ingestion-extractions";
import type { ExtractionIngestion } from "./ingestion";

const lecture: ContenuLecture = {
  resume: [{ page: 1, texte: "Résumé." }],
  elements: [
    { page: 1, type: "fait", extrait: "a", enonce: "Fait A", verifie: true },
    { page: 2, type: "chiffre", extrait: "b", enonce: "Chiffre B", verifie: false },
    { page: 3, type: "risque", extrait: "c", enonce: "Risque C", verifie: false },
  ],
  tronque: false,
};

const proposition: ContenuProposition = {
  etapes: [{ code: "E1", libelle: "Étape 1", page: 1 }],
  briques: [
    { etape_code: "E1", code: "B1", libelle: "Brique 1", objet: "Objet", page: 2 },
    { etape_code: "E1", code: "B2", libelle: "Brique 2", objet: "Objet", page: 2 },
  ],
  elements: [{ type: "livrable", code: "L1", libelle: "Livrable", page: 3 }],
  rubriques: [{ code: "R1", libelle: "Rubrique", niveaux: ["1", "2", "3", "4", "5"], page: 4 }],
  tronque: false,
};

describe("statuts d'extraction", () => {
  it("distingue les brouillons ouverts des extractions tranchées", () => {
    expect(extractionOuverte("brouillon_ia")).toBe(true);
    expect(extractionOuverte("modifie")).toBe(true);
    expect(extractionOuverte("valide")).toBe(false);
    expect(extractionOuverte("rejete")).toBe(false);
  });
  it("prend la plus récente", () => {
    expect(extractionCourante([])).toBeNull();
    const x = { id: "1" } as ExtractionIngestion;
    expect(extractionCourante([x, { id: "2" } as ExtractionIngestion])).toBe(x);
  });
});

describe("lecture d'un document", () => {
  it("libelle les types et la vérification en toutes lettres", () => {
    expect(libelleTypeElementLecture("engagement")).toBe("Engagement");
    expect(libelleTypeElementLecture("inconnu")).toBe("inconnu");
    expect(libelleVerification(true)).toBe("Vérifié dans la page");
    expect(libelleVerification(false)).toBe("NON retrouvé dans la page");
  });
  it("compte les éléments non retrouvés", () => {
    expect(compterNonVerifies(lecture)).toBe(2);
    expect(compterNonVerifies({ elements: [] })).toBe(0);
  });
  it("retire un élément sans modifier l'original", () => {
    const r = retirerElementLecture(lecture, 1);
    expect(r.elements.map((e) => e.enonce)).toEqual(["Fait A", "Risque C"]);
    expect(lecture.elements).toHaveLength(3);
    expect(r.resume).toBe(lecture.resume);
    expect(retirerElementLecture(lecture, 9)).toBe(lecture);
    expect(retirerElementLecture(lecture, -1)).toBe(lecture);
  });
  it("modifie un énoncé en le nettoyant, sans toucher aux autres champs", () => {
    const r = modifierEnonceLecture(lecture, 0, "  Nouveau  ");
    expect(r.elements[0]).toEqual({ ...lecture.elements[0], enonce: "Nouveau" });
    expect(r.elements[1]).toBe(lecture.elements[1]);
    expect(modifierEnonceLecture(lecture, 0, "   ")).toBe(lecture);
    expect(modifierEnonceLecture(lecture, 7, "x")).toBe(lecture);
  });
  it("contrôle l'énoncé", () => {
    expect(erreurEnonce("")).toContain("vide");
    expect(erreurEnonce("a".repeat(ENONCE_MAX + 1))).toContain(String(ENONCE_MAX));
    expect(erreurEnonce("ok")).toBeNull();
  });
});

describe("proposition de standard", () => {
  it("compte les éléments par famille", () => {
    expect(compterProposition(proposition)).toEqual({
      etapes: 1,
      briques: 2,
      elements: 1,
      rubriques: 1,
    });
    expect(totalProposition(proposition)).toBe(5);
  });
  it("retire un élément d'une famille sans modifier l'original", () => {
    const r = retirerDeProposition(proposition, "briques", 0);
    expect(r.briques.map((b) => b.code)).toEqual(["B2"]);
    expect(r.etapes).toBe(proposition.etapes);
    expect(proposition.briques).toHaveLength(2);
    expect(retirerDeProposition(proposition, "rubriques", 3)).toBe(proposition);
  });
  it("libelle les types d'élément de méthode", () => {
    expect(libelleTypeElementMethode("livrable")).toBe("Livrable");
    expect(libelleTypeElementMethode("zzz")).toBe("zzz");
  });
});

describe("relance", () => {
  const doc = (resultat: "ia_indisponible" | "rien_trouve" | "brouillon_cree") =>
    ({ statut: "termine", resultat }) as const;
  it("DD : IA indisponible, rien trouvé ou dernier brouillon rejeté", () => {
    expect(relancePossible("dd", doc("ia_indisponible"), [])).toBe(true);
    expect(relancePossible("dd", doc("rien_trouve"), [])).toBe(true);
    expect(relancePossible("dd", doc("brouillon_cree"), [{ statut: "rejete" }])).toBe(true);
    expect(relancePossible("dd", doc("brouillon_cree"), [{ statut: "valide" }])).toBe(false);
    expect(relancePossible("dd", doc("brouillon_cree"), [{ statut: "brouillon_ia" }])).toBe(false);
  });
  it("exige un document terminé", () => {
    expect(relancePossible("dd", { statut: "extraction", resultat: "ia_indisponible" }, [])).toBe(
      false,
    );
  });
  it("standard : le résultat ne compte que sans extraction", () => {
    expect(relancePossible("standard", doc("ia_indisponible"), [])).toBe(true);
    expect(relancePossible("standard", doc("rien_trouve"), [{ statut: "valide" }])).toBe(false);
    expect(relancePossible("standard", doc("brouillon_cree"), [{ statut: "rejete" }])).toBe(true);
  });
});

describe("droits d'affichage", () => {
  it("DD : écriture, validation et mission clôturée", () => {
    const associe = droitsIngestionDd(["associe"], { statut: "en_cours" });
    expect(associe.televerser).toBe(true);
    expect(associe.decider).toBe(true);
    const cloturee = droitsIngestionDd(["associe"], { statut: "cloturee" });
    expect(cloturee.televerser).toBe(false);
    expect(cloturee.decider).toBe(false);
    expect(droitsIngestionDd([], undefined).televerser).toBe(false);
  });
  it("standard : tout est masqué sans le droit, relance et dépôt réservés au brouillon", () => {
    const sans = droitsIngestionStandard([], true);
    expect(sans.televerser).toBe(false);
    expect(sans.decider).toBe(false);
    const publiee = droitsIngestionStandard(["associe"], false);
    expect(publiee.televerser).toBe(false);
    expect(publiee.relancer).toBe(false);
    expect(publiee.validerPossible).toBe(false);
    expect(publiee.decider).toBe(true);
    const brouillon = droitsIngestionStandard(["associe"], true);
    expect(brouillon.televerser).toBe(true);
    expect(brouillon.validerPossible).toBe(true);
  });
});

describe("décision", () => {
  it("exige l'acquittement quand des éléments ne sont pas retrouvés", () => {
    const base = { decision: "validee", motif: "", acquitte: false, nonVerifies: true } as const;
    expect(erreurDecision(base)).toContain("Cochez");
    expect(erreurDecision({ ...base, acquitte: true })).toBeNull();
    expect(erreurDecision({ ...base, nonVerifies: false })).toBeNull();
  });
  it("exige un motif pour rejeter", () => {
    const base = { decision: "rejetee", motif: "  ", acquitte: false, nonVerifies: true } as const;
    expect(erreurDecision(base)).toContain("motif");
    expect(erreurDecision({ ...base, motif: "Hors sujet" })).toBeNull();
    expect(erreurDecision({ ...base, motif: "a".repeat(1001) })).toContain("1000");
  });
  it("construit le corps de la requête", () => {
    expect(
      corpsDecision({ decision: "validee", motif: "x", acquitte: true, nonVerifies: true }),
    ).toEqual({ decision: "validee", acquitte_chiffres: true });
    expect(
      corpsDecision({ decision: "validee", motif: "", acquitte: true, nonVerifies: false }),
    ).toEqual({ decision: "validee" });
    expect(
      corpsDecision({ decision: "rejetee", motif: " Non ", acquitte: true, nonVerifies: true }),
    ).toEqual({ decision: "rejetee", motif: "Non" });
  });
});

describe("résultat appliqué", () => {
  it("relit le résultat de l'API et refuse une forme inattendue", () => {
    expect(lireResultatApplication(null)).toBeNull();
    expect(lireResultatApplication({ crees: 3 })).toBeNull();
    const r = lireResultatApplication({
      crees: { etapes: 1, briques: 2, elements: 0, rubriques: 1 },
      ignores: [
        { famille: "brique", code: "B9", motif: "code_existant" },
        { famille: 3, code: "x" },
        "texte",
      ],
    });
    expect(r).not.toBeNull();
    expect(totalCrees(r!)).toBe(4);
    expect(r!.ignores).toEqual([{ famille: "brique", code: "B9", motif: "code_existant" }]);
  });
  it("libelle les familles et les motifs", () => {
    expect(libelleFamilleApplication("rubrique")).toBe("Rubrique");
    expect(libelleFamilleApplication("autre")).toBe("autre");
    expect(libelleMotifIgnore("code_existant")).toContain("existe déjà");
    expect(libelleMotifIgnore("etape_introuvable")).toContain("étape");
    expect(libelleMotifIgnore("?")).toBe("non appliqué");
  });
});
