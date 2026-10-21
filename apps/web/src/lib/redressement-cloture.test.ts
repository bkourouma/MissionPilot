import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RedClotureResume } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { MOTS_INTERDITS } from "./redressement";
import {
  cheminGenerationRapportCloture,
  cheminValidationCloture,
  clotureEstPerimee,
  formaterEcartDixiemes,
  formaterScoreDixiemes,
  formaterVariationEntier,
  formaterVariationMontant,
  formaterVariationPoints,
  formaterVariationRatio,
  libelleControle,
  manquantsDe,
  messageCloture,
  messageClotureIncomplete,
  TEXTE_CLOTURE_AUCUN,
  TEXTE_CLOTURE_EVOLUTION,
  TEXTE_CLOTURE_INTRO,
  TEXTE_CLOTURE_LECTURE_SEULE,
  TEXTE_CLOTURE_PERIMEE,
  TEXTE_CLOTURE_RAPPORT_CLOTUREE,
  TEXTE_CLOTURE_RAPPORT_NON_VALIDE,
  TEXTE_CLOTURE_VALIDE,
  TEXTE_RENOTATION_NON_COMPARABLE,
  tonaliteEvolution,
} from "./redressement-cloture";
import { choisirVersion, corpsValidationCloture } from "./redressement-cloture-saisie";

const norm = (t: string) => t.replace(/\s/g, " ");

describe("mise en forme du bilan de clôture", () => {
  it("exprime la variation d'une part en points de pourcentage", () => {
    expect(formaterVariationRatio("marge_nette", 250)).toBe("+2,5 points");
    expect(formaterVariationRatio("autonomie_financiere", -1875)).toBe("-18,75 points");
    expect(formaterVariationRatio("marge_brute", 0)).toBe("0 points");
  });

  it("exprime la variation d'un rapport en écart de rapport et celle du BFR en jours", () => {
    expect(formaterVariationRatio("liquidite_generale", 2500)).toBe("+0,25");
    expect(formaterVariationRatio("endettement", -13_600)).toBe("-1,36");
    expect(formaterVariationRatio("bfr_jours", 12)).toBe("+12 jours");
    expect(formaterVariationRatio("bfr_jours", -1)).toBe("-1 jour");
    expect(formaterVariationRatio("bfr_jours", null)).toBe("—");
  });

  it("met en forme les variations signées sans rien calculer", () => {
    expect(formaterVariationEntier(3)).toBe("+3");
    expect(formaterVariationEntier(-2)).toBe("-2");
    expect(formaterVariationEntier(null)).toBe("—");
    expect(formaterVariationPoints(1)).toBe("+1 point");
    expect(formaterVariationPoints(-5)).toBe("-5 points");
    expect(norm(formaterVariationMontant(150_000, "XOF"))).toBe("+150 000 FCFA");
    expect(norm(formaterVariationMontant(-12_345, "EUR"))).toBe("-123,45 €");
    expect(formaterVariationMontant(null, "XOF")).toBe("—");
  });

  it("met en forme les dixièmes de point de la notation", () => {
    expect(formaterScoreDixiemes(75)).toBe("7,5");
    expect(formaterScoreDixiemes(null)).toBe("—");
    expect(formaterEcartDixiemes(12)).toBe("+1,2");
    expect(formaterEcartDixiemes(-8)).toBe("-0,8");
  });

  it("signale une dégradation en attention : c'est un constat", () => {
    expect(tonaliteEvolution("amelioration")).toBe("succes");
    expect(tonaliteEvolution("degradation")).toBe("attention");
    expect(tonaliteEvolution("stable")).toBe("neutre");
    expect(tonaliteEvolution("non_comparable")).toBe("neutre");
  });
});

describe("chemins et messages", () => {
  it("construit les chemins d'API", () => {
    expect(cheminValidationCloture("a b")).toBe("/api/redressement/clotures/a%20b/validation");
    expect(cheminGenerationRapportCloture("x", "docx")).toBe(
      "/api/redressement/clotures/x/rapports?format=docx",
    );
  });

  it("nomme les contrôles bloquants manquants", () => {
    expect(libelleControle("plan_present")).toBe("Un plan avec au moins une action");
    expect(libelleControle("inconnu")).toBe("inconnu");
    const e = new ErreurApi("RED_CLOTURE_INCOMPLETE", "Bilan incomplet.", 409, {
      manquants: ["plan_present", "causes_validees"],
    });
    expect(manquantsDe(e.details)).toEqual(["plan_present", "causes_validees"]);
    const m = messageCloture(e);
    expect(m).toContain("Un plan avec au moins une action");
    expect(m).toContain("cartographie des causes racines validée");
    expect(messageClotureIncomplete([])).toContain("incomplet");
    expect(manquantsDe(undefined)).toEqual([]);
    expect(manquantsDe({ manquants: "x" })).toEqual([]);
  });

  it("affiche le message de l'API pour les refus de validation", () => {
    for (const code of ["VALIDATION_RESERVEE_DIRECTEUR", "SEPARATION_DES_TACHES"]) {
      const m = messageCloture(new ErreurApi(code, "Réservé au directeur de la mission.", 403));
      expect(m).toBe("Réservé au directeur de la mission.");
    }
  });

  it("reconnaît un bilan périmé et le dit", () => {
    const e = new ErreurApi("RED_CLOTURE_PERIMEE", "L'état du dossier a changé.", 409);
    expect(clotureEstPerimee(e)).toBe(true);
    expect(clotureEstPerimee(new Error("x"))).toBe(false);
    expect(messageCloture(e)).toContain(TEXTE_CLOTURE_PERIMEE);
    expect(messageCloture(e)).toContain("L'état du dossier a changé.");
  });
});

describe("choix de la version et corps de validation", () => {
  const v = (version: number): RedClotureResume =>
    ({ id: `id-${version}`, version }) as unknown as RedClotureResume;
  const versions = [v(3), v(2), v(1)];

  it("prend la version demandée, sinon la plus récente", () => {
    expect(choisirVersion(versions, "2")?.version).toBe(2);
    expect(choisirVersion(versions, ["1"])?.version).toBe(1);
    expect(choisirVersion(versions, "9")?.version).toBe(3);
    expect(choisirVersion(versions, "abc")?.version).toBe(3);
    expect(choisirVersion(versions, undefined)?.version).toBe(3);
    expect(choisirVersion([], "1")).toBeNull();
  });

  it("valide sans motif ou avec un motif borné", () => {
    expect(corpsValidationCloture("  ")).toEqual({ ok: true, charge: {} });
    expect(corpsValidationCloture(" Revue faite ")).toEqual({
      ok: true,
      charge: { motif: "Revue faite" },
    });
    expect(corpsValidationCloture("x".repeat(2001)).ok).toBe(false);
  });
});

describe("textes de l'écran de clôture", () => {
  it("ne qualifie jamais juridiquement la situation du client", () => {
    const textes = [
      TEXTE_CLOTURE_AUCUN,
      TEXTE_CLOTURE_EVOLUTION,
      TEXTE_CLOTURE_INTRO,
      TEXTE_CLOTURE_LECTURE_SEULE,
      TEXTE_CLOTURE_PERIMEE,
      TEXTE_CLOTURE_RAPPORT_CLOTUREE,
      TEXTE_CLOTURE_RAPPORT_NON_VALIDE,
      TEXTE_CLOTURE_VALIDE,
      TEXTE_RENOTATION_NON_COMPARABLE,
    ];
    for (const t of textes) {
      for (const mot of MOTS_INTERDITS) expect(t.toLowerCase()).not.toContain(mot);
    }
  });

  it("garde chaque fichier du module sous 400 lignes", () => {
    const racine = join(__dirname, "..");
    const fichiers = [
      "lib/redressement-cloture.ts",
      "lib/redressement-cloture-saisie.ts",
      "lib/redressement-cloture-serveur.ts",
      "lib/redressement-suivi.ts",
      "lib/redressement-suivi-saisie.ts",
      "lib/redressement-suivi-serveur.ts",
      "app/(app)/missions/[id]/redressement/cloture/page.tsx",
      "app/(app)/missions/[id]/redressement/suivi/page.tsx",
    ];
    for (const f of fichiers) {
      expect(readFileSync(join(racine, f), "utf8").split("\n").length, f).toBeLessThan(400);
    }
  });
});
