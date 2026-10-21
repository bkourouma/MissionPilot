import { describe, expect, it } from "vitest";
import {
  RED_CAUSE_DESCRIPTION_MAX,
  RED_CAUSE_LIBELLE_MAX,
  RED_CAUSES_CONTEXTE_MAX,
  RED_CAUSES_MAX,
  RED_NIVEAU_CONFIANCE_CAUSE_LIBELLES,
  RED_NIVEAUX_CONFIANCE_CAUSE,
  RED_STATUT_CONTENU_CAUSES_LIBELLES,
  RED_STATUTS_CONTENU_CAUSES,
  redCauseSchema,
  redCausesGenerationSchema,
  redCausesModificationSchema,
  redCausesValidationSchema,
} from "./redressement-causes";

const cause = (extra: Record<string, unknown> = {}) => ({
  domaine: "tresorerie",
  libelle: "Encaissements tardifs",
  description: "Hypothèse à confirmer.",
  ...extra,
});

describe("libellés", () => {
  it("couvrent chaque niveau de confiance et chaque statut de contenu", () => {
    for (const n of RED_NIVEAUX_CONFIANCE_CAUSE) {
      expect(RED_NIVEAU_CONFIANCE_CAUSE_LIBELLES[n]).toMatch(/^Confiance /);
    }
    for (const s of RED_STATUTS_CONTENU_CAUSES) {
      expect(RED_STATUT_CONTENU_CAUSES_LIBELLES[s].length).toBeGreaterThan(0);
    }
  });
});

describe("redCauseSchema", () => {
  it("accepte une cause valide, avec ou sans identifiant et confiance", () => {
    expect(redCauseSchema.safeParse(cause()).success).toBe(true);
    expect(redCauseSchema.safeParse(cause({ id: "c07", confiance: "eleve" })).success).toBe(true);
    expect(redCauseSchema.safeParse(cause({ confiance: null })).success).toBe(true);
  });

  it("refuse les champs inconnus, domaines inconnus, confiance numérique et textes hors bornes", () => {
    for (const mauvaise of [
      cause({ inconnu: 1 }),
      cause({ domaine: "juridique" }),
      cause({ confiance: 80 }),
      cause({ confiance: "certain" }),
      cause({ id: "x1" }),
      cause({ libelle: "" }),
      cause({ libelle: "x".repeat(RED_CAUSE_LIBELLE_MAX + 1) }),
      cause({ description: "x".repeat(RED_CAUSE_DESCRIPTION_MAX + 1) }),
    ]) {
      expect(redCauseSchema.safeParse(mauvaise).success).toBe(false);
    }
  });
});

describe("redCausesModificationSchema", () => {
  it("exige de 1 à RED_CAUSES_MAX causes", () => {
    expect(redCausesModificationSchema.safeParse({ causes: [] }).success).toBe(false);
    expect(redCausesModificationSchema.safeParse({ causes: [cause()] }).success).toBe(true);
    const trop = Array.from({ length: RED_CAUSES_MAX + 1 }, () => cause());
    expect(redCausesModificationSchema.safeParse({ causes: trop }).success).toBe(false);
    expect(redCausesModificationSchema.safeParse({ causes: [cause()], x: 1 }).success).toBe(false);
  });
});

describe("redCausesGenerationSchema", () => {
  it("accepte un corps vide (termes par défaut) et un contexte borné", () => {
    expect(redCausesGenerationSchema.parse({}).termes_sensibles).toEqual([]);
    expect(
      redCausesGenerationSchema.safeParse({
        contexte: "Le client a perdu son principal débouché.",
        termes_sensibles: ["Kora Industrie", { valeur: "Abidjan", categorie: "lieu" }],
      }).success,
    ).toBe(true);
  });

  it("refuse un contexte trop long, vide ou un champ inconnu", () => {
    expect(
      redCausesGenerationSchema.safeParse({ contexte: "x".repeat(RED_CAUSES_CONTEXTE_MAX + 1) })
        .success,
    ).toBe(false);
    expect(redCausesGenerationSchema.safeParse({ contexte: "" }).success).toBe(false);
    expect(redCausesGenerationSchema.safeParse({ chiffres: [] }).success).toBe(false);
  });
});

describe("redCausesValidationSchema", () => {
  it("n'accepte que acquitte_chiffres booléen", () => {
    expect(redCausesValidationSchema.safeParse({}).success).toBe(true);
    expect(redCausesValidationSchema.safeParse({ acquitte_chiffres: true }).success).toBe(true);
    expect(redCausesValidationSchema.safeParse({ acquitte_chiffres: "oui" }).success).toBe(false);
    expect(redCausesValidationSchema.safeParse({ autre: 1 }).success).toBe(false);
  });
});
