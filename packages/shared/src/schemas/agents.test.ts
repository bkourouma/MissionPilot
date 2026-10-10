import { describe, expect, it } from "vitest";
import {
  CAUSES_EVALUATION_OPENROUTER,
  evaluationOpenRouterCreationSchema,
  evaluationsOpenRouterQuerySchema,
  paramsPromptEvaluationSchema,
  STATUTS_EVALUATION_OPENROUTER,
} from "../index";

describe("rejeu réel des évaluations sur OpenRouter (AGT-04)", () => {
  it("le corps n'admet que le modèle candidat, au format « fournisseur/modèle » (schéma strict)", () => {
    expect(evaluationOpenRouterCreationSchema.parse({})).toEqual({});
    expect(
      evaluationOpenRouterCreationSchema.parse({ modele: " anthropic/claude-haiku-4.5 " }),
    ).toEqual({ modele: "anthropic/claude-haiku-4.5" });
    for (const ko of [
      { modele: "claude" },
      { modele: "A/B" },
      { plafond: 1 },
      { prompt_id: "x" },
    ]) {
      expect(evaluationOpenRouterCreationSchema.safeParse(ko).success).toBe(false);
    }
  });

  it("le prompt est un identifiant ; la liste est paginée (30 par défaut, 100 au plus)", () => {
    expect(
      paramsPromptEvaluationSchema.safeParse({ promptId: "11111111-1111-4111-8111-111111111111" })
        .success,
    ).toBe(true);
    expect(paramsPromptEvaluationSchema.safeParse({ promptId: "abc" }).success).toBe(false);
    expect(evaluationsOpenRouterQuerySchema.parse({}).limite).toBe(30);
    expect(evaluationsOpenRouterQuerySchema.safeParse({ limite: 101 }).success).toBe(false);
    expect(evaluationsOpenRouterQuerySchema.safeParse({ autre: 1 }).success).toBe(false);
  });

  it("causes d'arrêt : codes stables, sans doublon, avec les deux causes de l'audit de sécurité", () => {
    const causes = [...CAUSES_EVALUATION_OPENROUTER];
    expect(new Set(causes).size).toBe(causes.length);
    expect(causes).toEqual(
      expect.arrayContaining([
        "CAS_ECHOUES",
        "PLAFOND_EVALUATION",
        "DUREE_MAX_ATTEINTE",
        "INTERROMPUE",
        "MODELE_SERVI_DIFFERENT",
        "JEU_ESSAI_INVALIDE",
        "FOURNISSEUR_INDISPONIBLE",
      ]),
    );
    // Forme imposée par la base (CHECK de la colonne `cause`, migration 0270).
    for (const c of causes) expect(c).toMatch(/^[A-Z][A-Z0-9_]{2,59}$/);
  });

  it("six états, dont seule « reussie » autorise une activation", () => {
    expect([...STATUTS_EVALUATION_OPENROUTER]).toEqual([
      "en_file",
      "en_cours",
      "reussie",
      "echouee",
      "incomplete",
      "ignoree",
    ]);
  });
});
