import { describe, expect, it } from "vitest";
import {
  atelierCreationSchema,
  atelierMethodeParamsSchema,
  atelierModificationSchema,
  atelierParticipantSchema,
  ateliersListeQuerySchema,
  contributionMatriceSchema,
  contributionPriorisationSchema,
  contributionVoteSchema,
  OPTIONS_ATELIER_MAX,
  SCHEMAS_CONTRIBUTION,
} from "./plans-ateliers";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const base = {
  titre: "Atelier",
  methodes: ["vote"],
  options: [{ libelle: "Un" }, { libelle: "Deux", description: "Détail" }],
};

describe("atelierCreationSchema", () => {
  it("applique les valeurs par défaut (10 points, axes impact/effort, pas de plafond)", () => {
    const r = atelierCreationSchema.parse(base);
    expect(r).toMatchObject({
      consigne: "",
      budget_points: 10,
      plafond_par_option: null,
      axes: { x: { inverse: false }, y: { libelle: "Effort", inverse: true } },
    });
  });

  it("refuse moins de 2 options, plus de 50, une méthode inconnue ou en double, aucun champ inconnu", () => {
    const mal = [
      { ...base, options: [{ libelle: "Seule" }] },
      {
        ...base,
        options: Array.from({ length: OPTIONS_ATELIER_MAX + 1 }, (_, i) => ({ libelle: `O${i}` })),
      },
      { ...base, methodes: [] },
      { ...base, methodes: ["vote", "vote"] },
      { ...base, methodes: ["loterie"] },
      { ...base, budget_points: 101 },
      { ...base, budget_points: 5, plafond_par_option: 6 },
      { ...base, titre: "Titre\u0000" },
      { ...base, options: [{ libelle: " " }, { libelle: "Deux" }] },
      { ...base, intrus: 1 },
    ];
    for (const corps of mal) expect(atelierCreationSchema.safeParse(corps).success).toBe(false);
  });

  it("accepte 50 options et les trois méthodes", () => {
    const r = atelierCreationSchema.safeParse({
      ...base,
      methodes: ["vote", "priorisation", "matrice"],
      options: Array.from({ length: 50 }, (_, i) => ({ libelle: `O${i}` })),
    });
    expect(r.success).toBe(true);
  });
});

describe("modification, invitation, requêtes", () => {
  it("la modification exige au moins un champ et reste stricte", () => {
    expect(atelierModificationSchema.safeParse({}).success).toBe(false);
    expect(atelierModificationSchema.safeParse({ titre: "Nouveau" }).success).toBe(true);
    expect(atelierModificationSchema.safeParse({ plafond_par_option: null }).success).toBe(true);
    expect(atelierModificationSchema.safeParse({ options: [{ libelle: "Un" }] }).success).toBe(
      false,
    );
    expect(atelierModificationSchema.safeParse({ statut: "clos" }).success).toBe(false);
  });

  it("invitation, liste et paramètres", () => {
    expect(atelierParticipantSchema.safeParse({ utilisateur_id: A }).success).toBe(true);
    expect(atelierParticipantSchema.safeParse({ utilisateur_id: "x" }).success).toBe(false);
    expect(ateliersListeQuerySchema.parse({}).limite).toBe(30);
    expect(ateliersListeQuerySchema.safeParse({ limite: "101" }).success).toBe(false);
    expect(
      atelierMethodeParamsSchema.safeParse({ id: A, atelierId: B, methode: "vote" }).success,
    ).toBe(true);
    expect(
      atelierMethodeParamsSchema.safeParse({ id: A, atelierId: B, methode: "tirage" }).success,
    ).toBe(false);
  });
});

describe("contributions", () => {
  it("vote : points entiers de 0 à 100, option non répétée", () => {
    expect(
      contributionVoteSchema.safeParse({ points: [{ option_id: A, points: 5 }] }).success,
    ).toBe(true);
    expect(contributionVoteSchema.safeParse({ points: [] }).success).toBe(false);
    expect(
      contributionVoteSchema.safeParse({ points: [{ option_id: A, points: 101 }] }).success,
    ).toBe(false);
    expect(
      contributionVoteSchema.safeParse({ points: [{ option_id: A, points: 1.5 }] }).success,
    ).toBe(false);
    expect(
      contributionVoteSchema.safeParse({
        points: [
          { option_id: A, points: 1 },
          { option_id: A, points: 2 },
        ],
      }).success,
    ).toBe(false);
  });

  it("classement : identifiants distincts ; matrice : notes de 1 à 5, option non répétée", () => {
    expect(contributionPriorisationSchema.safeParse({ classement: [A, B] }).success).toBe(true);
    expect(contributionPriorisationSchema.safeParse({ classement: [A, A] }).success).toBe(false);
    expect(contributionPriorisationSchema.safeParse({ classement: [] }).success).toBe(false);
    expect(
      contributionMatriceSchema.safeParse({ positions: [{ option_id: A, x: 5, y: 1 }] }).success,
    ).toBe(true);
    expect(
      contributionMatriceSchema.safeParse({ positions: [{ option_id: A, x: 0, y: 1 }] }).success,
    ).toBe(false);
    expect(
      contributionMatriceSchema.safeParse({ positions: [{ option_id: A, x: 6, y: 1 }] }).success,
    ).toBe(false);
    expect(
      contributionMatriceSchema.safeParse({
        positions: [
          { option_id: A, x: 1, y: 1 },
          { option_id: A, x: 2, y: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(Object.keys(SCHEMAS_CONTRIBUTION)).toEqual(["vote", "priorisation", "matrice"]);
  });
});
