import { describe, expect, it } from "vitest";
import type { AnomalieVersion } from "./methodes";
import {
  categorieAnomalie,
  CATEGORIES_COHERENCE,
  grouperAnomalies,
  libelleAnomalie,
  LIBELLE_ANOMALIE_INCONNUE,
  LIBELLES_ANOMALIE,
  nombreErreursBloquantes,
  raisonPublicationBloquee,
  texteBlocage,
  textePastille,
  tonalitePastille,
} from "./methodes-coherence";

/** Tous les codes que l'API peut rendre (moteurs de modulation, cohérence, héritage, structure). */
const CODES_API = [
  // structure
  "VERSION_SANS_BRIQUE",
  "ETAPE_SANS_BRIQUE",
  "MOTEUR_INCONNU",
  "AUTONOMIE_INCOMPATIBLE",
  "CLASSE_ABAISSEE",
  "AUTONOMIE_RELEVEE",
  // règles (validation du jeu de règles)
  "REGLES_TROP_NOMBREUSES",
  "REGLE_INVALIDE",
  "CODE_INVALIDE",
  "CODE_EN_DOUBLE",
  "PRIORITE_INVALIDE",
  "CONDITION_INVALIDE",
  "CONDITION_TROP_COMPLEXE",
  "EFFET_INVALIDE",
  "FACTEUR_DEFINITION_INVALIDE",
  "FACTEUR_INCONNU",
  "COMPARATEUR_INCOMPATIBLE",
  "VALEUR_INVALIDE",
  "REFERENCE_INCONNUE",
  "CONFLIT_INTERNE",
  "CYCLE",
  "CONFLIT_MEME_PRIORITE",
  "REGLE_SANS_EFFET",
  // erreurs du moteur remontées par les cas types
  "REGLES_INVALIDES",
  "CYCLE_REGLES",
  "CAS_TYPE_INVALIDE",
  "OPTIONS_INVALIDES",
  // cohérence interne (STD-11)
  "REFERENCE_CASSEE",
  "RUBRIQUE_SANS_ANCRAGE",
  "RUBRIQUE_ANCRAGES_IDENTIQUES",
  "RUBRIQUE_SANS_EXEMPLE",
  "RUBRIQUE_NON_RATTACHEE",
  "REGLES_CONTRADICTOIRES",
  "REGLE_SANS_EFFET_REEL",
  "REGLE_INACTIVE",
  "CONDITION_INSATISFAISABLE",
  "BRIQUE_INATTEIGNABLE",
  "CYCLE_HERITAGE",
  "HERITAGE_INCOHERENT",
  // cas types
  "AUCUN_CAS_TYPE",
  "CAS_TYPE_ECHOUE",
];

const anomalie = (
  code: string,
  gravite: AnomalieVersion["gravite"] = "erreur",
  chemin = "x",
): AnomalieVersion => ({ code, gravite, regle: null, chemin, message: `message ${code}` });

describe("libellés des anomalies", () => {
  it("couvre tous les codes de l'API avec un libellé français propre", () => {
    for (const code of CODES_API) {
      expect(LIBELLES_ANOMALIE[code], code).toBeTruthy();
      expect(libelleAnomalie(code)).not.toBe(LIBELLE_ANOMALIE_INCONNUE);
      expect(libelleAnomalie(code)).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("n'a pas de libellé orphelin : chaque entrée vient de la liste des codes", () => {
    expect(Object.keys(LIBELLES_ANOMALIE).sort()).toEqual([...CODES_API].sort());
  });

  it("retombe sur un libellé générique pour un code inconnu", () => {
    expect(libelleAnomalie("CODE_FUTUR")).toBe(LIBELLE_ANOMALIE_INCONNUE);
  });

  it("classe chaque code dans l'une des six catégories", () => {
    const categories = new Set(CATEGORIES_COHERENCE.map((c) => c.categorie));
    expect(categories.size).toBe(6);
    for (const code of CODES_API) {
      expect(categories.has(categorieAnomalie({ code, chemin: "x" })), code).toBe(true);
    }
  });
});

describe("catégories", () => {
  it("reprend la répartition de l'API", () => {
    expect(categorieAnomalie({ code: "VERSION_SANS_BRIQUE", chemin: "briques" })).toBe("structure");
    expect(categorieAnomalie({ code: "RUBRIQUE_SANS_EXEMPLE", chemin: "r" })).toBe("rubriques");
    expect(categorieAnomalie({ code: "REFERENCE_CASSEE", chemin: "briques.b.etape" })).toBe(
      "references",
    );
    expect(categorieAnomalie({ code: "CAS_TYPE_ECHOUE", chemin: "cas_types.c" })).toBe("cas_types");
    expect(categorieAnomalie({ code: "CAS_TYPE_INVALIDE", chemin: "cas_types" })).toBe("cas_types");
    expect(categorieAnomalie({ code: "REGLE_INACTIVE", chemin: "regles.r" })).toBe("regles");
    expect(categorieAnomalie({ code: "CYCLE_HERITAGE", chemin: "methodes.m" })).toBe("heritage");
  });

  it("range une référence cassée de l'héritage dans « Héritage »", () => {
    expect(categorieAnomalie({ code: "REFERENCE_CASSEE", chemin: "methodes.m1.parent" })).toBe(
      "heritage",
    );
    expect(categorieAnomalie({ code: "REFERENCE_CASSEE", chemin: "versions.v1.base" })).toBe(
      "heritage",
    );
  });
});

describe("regroupement et pastilles", () => {
  const v = {
    anomalies: [
      anomalie("REGLE_INACTIVE", "avertissement", "regles.a"),
      anomalie("REFERENCE_CASSEE", "erreur", "elements.x.brique"),
      anomalie("CONDITION_INSATISFAISABLE", "erreur", "regles.b"),
      anomalie("AUCUN_CAS_TYPE", "avertissement", "cas_types"),
    ],
  };

  it("garde les six catégories dans l'ordre, y compris les conformes", () => {
    const g = grouperAnomalies(v);
    expect(g.map((x) => x.categorie)).toEqual([
      "structure",
      "references",
      "regles",
      "rubriques",
      "heritage",
      "cas_types",
    ]);
    expect(g.map((x) => x.anomalies.length)).toEqual([0, 1, 2, 0, 0, 1]);
  });

  it("place les erreurs avant les avertissements dans une catégorie", () => {
    const regles = grouperAnomalies(v).find((x) => x.categorie === "regles")!;
    expect(regles.anomalies.map((a) => a.gravite)).toEqual(["erreur", "avertissement"]);
    expect(regles.erreurs).toBe(1);
    expect(regles.avertissements).toBe(1);
  });

  it("formule les pastilles", () => {
    expect(textePastille({ erreurs: 0, avertissements: 0 })).toBe("conforme");
    expect(textePastille({ erreurs: 1, avertissements: 0 })).toBe("1 erreur");
    expect(textePastille({ erreurs: 2, avertissements: 1 })).toBe("2 erreurs · 1 avertissement");
    expect(textePastille({ erreurs: 0, avertissements: 3 })).toBe("3 avertissements");
  });

  it("choisit la tonalité de la pastille", () => {
    expect(tonalitePastille({ erreurs: 1, avertissements: 2 })).toBe("danger");
    expect(tonalitePastille({ erreurs: 0, avertissements: 2 })).toBe("attention");
    expect(tonalitePastille({ erreurs: 0, avertissements: 0 })).toBe("succes");
  });

  it("dit si l'anomalie bloque la publication", () => {
    expect(texteBlocage({ gravite: "erreur" })).toBe("Bloque la publication");
    expect(texteBlocage({ gravite: "avertissement" })).toBe("N'empêche pas la publication");
  });
});

describe("publication", () => {
  it("compte les erreurs bloquantes, pas les avertissements", () => {
    expect(
      nombreErreursBloquantes({
        anomalies: [anomalie("A"), anomalie("B", "avertissement"), anomalie("C")],
      }),
    ).toBe(2);
  });

  it("donne la raison du blocage au singulier et au pluriel", () => {
    expect(raisonPublicationBloquee({ anomalies: [anomalie("A")] })).toBe(
      "Publication impossible : une erreur de cohérence reste à corriger.",
    );
    expect(raisonPublicationBloquee({ anomalies: [anomalie("A"), anomalie("B")] })).toBe(
      "Publication impossible : 2 erreurs de cohérence restent à corriger.",
    );
  });

  it("ne bloque pas sans erreur, ni quand le contrôle est indisponible", () => {
    expect(raisonPublicationBloquee({ anomalies: [anomalie("A", "avertissement")] })).toBeNull();
    expect(raisonPublicationBloquee({ anomalies: [] })).toBeNull();
    expect(raisonPublicationBloquee(null)).toBeNull();
  });
});
