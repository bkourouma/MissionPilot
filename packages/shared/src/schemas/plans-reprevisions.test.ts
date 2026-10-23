import { describe, expect, it } from "vitest";
import {
  planRealiseParamsSchema,
  planRealiseSaisieSchema,
  planReprevisionCreationSchema,
  planReprevisionListeQuerySchema,
} from "./plans-reprevisions";

const id = "11111111-1111-4111-8111-111111111111";

describe("planRealiseSaisieSchema", () => {
  const ok = { chiffre_affaires: 1000, ebe: -50 };

  it("accepte le minimum ; résultat net, trésorerie et commentaire valent null", () => {
    expect(planRealiseSaisieSchema.parse(ok)).toEqual({
      ...ok,
      resultat_net: null,
      tresorerie_fin: null,
      commentaire: null,
    });
  });

  it("refuse flottants, entiers non sûrs, chiffre d'affaires négatif, champ inconnu", () => {
    const mal = (extra: object) => planRealiseSaisieSchema.safeParse({ ...ok, ...extra }).success;
    expect(mal({ chiffre_affaires: 10.5 })).toBe(false);
    expect(mal({ chiffre_affaires: -1 })).toBe(false);
    expect(mal({ ebe: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(mal({ resultat_net: 1.2 })).toBe(false);
    expect(mal({ tresorerie_fin: "12" })).toBe(false);
    expect(mal({ intrus: 1 })).toBe(false);
    expect(mal({ ebe: Number.MAX_SAFE_INTEGER, resultat_net: -5, tresorerie_fin: 0 })).toBe(true);
  });

  it("borne et nettoie le commentaire", () => {
    const c = (commentaire: string) =>
      planRealiseSaisieSchema.safeParse({ chiffre_affaires: 1, ebe: 1, commentaire }).success;
    expect(c("a".repeat(1000))).toBe(true);
    expect(c("a".repeat(1001))).toBe(false);
    expect(c("ligne\u0000nulle")).toBe(false);
  });
});

describe("planRealiseParamsSchema", () => {
  it("convertit exercice et trimestre, borne 2000..2100 et 1..4", () => {
    expect(planRealiseParamsSchema.parse({ id, exercice: "2027", trimestre: "3" })).toEqual({
      id,
      exercice: 2027,
      trimestre: 3,
    });
    for (const [exercice, trimestre] of [
      ["1999", "1"],
      ["2101", "1"],
      ["2027", "0"],
      ["2027", "5"],
      ["2027", "1.5"],
    ]) {
      expect(planRealiseParamsSchema.safeParse({ id, exercice, trimestre }).success).toBe(false);
    }
  });
});

describe("planReprevisionCreationSchema", () => {
  const base = { version: 1, exercice: 2027 };

  it("méthode par défaut : reste du plan ; répartition et seuil facultatifs", () => {
    const r = planReprevisionCreationSchema.parse(base);
    expect(r.methode).toBe("reste_du_plan");
    expect(r.repartition).toBeUndefined();
    expect(r.seuil).toBeUndefined();
  });

  it("refuse une méthode inconnue, un exercice hors bornes, un champ inconnu", () => {
    const ok = (extra: object) => planReprevisionCreationSchema.safeParse({ ...base, ...extra });
    expect(ok({ methode: "tendance" }).success).toBe(true);
    expect(ok({ methode: "magie" }).success).toBe(false);
    expect(ok({ exercice: 1999 }).success).toBe(false);
    expect(ok({ exercice: 2101 }).success).toBe(false);
    expect(ok({ version: 0 }).success).toBe(false);
    expect(ok({ intrus: true }).success).toBe(false);
  });

  it("répartition : quatre entiers de somme 1000 ; seuil de 1 à 1000", () => {
    const ok = (extra: object) => planReprevisionCreationSchema.safeParse({ ...base, ...extra });
    expect(ok({ repartition: [100, 200, 300, 400] }).success).toBe(true);
    expect(ok({ repartition: [250, 250, 250, 249] }).success).toBe(false);
    expect(ok({ repartition: [500, 500, 0] }).success).toBe(false);
    expect(ok({ repartition: [250.5, 249.5, 250, 250] }).success).toBe(false);
    expect(ok({ seuil: 1 }).success).toBe(true);
    expect(ok({ seuil: 1000 }).success).toBe(true);
    expect(ok({ seuil: 0 }).success).toBe(false);
    expect(ok({ seuil: 1001 }).success).toBe(false);
  });
});

describe("planReprevisionListeQuerySchema", () => {
  it("limite par défaut 30, bornée à 100 ; exercice facultatif", () => {
    expect(planReprevisionListeQuerySchema.parse({}).limite).toBe(30);
    expect(planReprevisionListeQuerySchema.safeParse({ limite: "101" }).success).toBe(false);
    expect(planReprevisionListeQuerySchema.parse({ exercice: "2028" }).exercice).toBe(2028);
  });
});
