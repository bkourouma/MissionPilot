import { describe, expect, it } from "vitest";
import {
  BROUILLON_REVUE_MAX,
  CAUSES_EVALUATION_OPENROUTER,
  evaluationOpenRouterCreationSchema,
  evaluationsOpenRouterQuerySchema,
  paramsPromptEvaluationSchema,
  revueContradictoireCreationSchema,
  revuesContradictoiresQuerySchema,
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

describe("revue contradictoire (AGT-06)", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("le corps ne porte que l'identifiant du brouillon relu (schéma strict)", () => {
    expect(revueContradictoireCreationSchema.parse({ generation_id: id })).toEqual({
      generation_id: id,
    });
    for (const ko of [
      {},
      { generation_id: "x" },
      { generation_id: id, texte: "autre" },
      { generation_id: id, mission_id: id },
      { generation_id: id, niveau: "N4" },
    ]) {
      expect(revueContradictoireCreationSchema.safeParse(ko).success).toBe(false);
    }
  });

  it("la liste vise un brouillon ; 20 revues par défaut, 50 au plus", () => {
    expect(revuesContradictoiresQuerySchema.parse({ generation_id: id }).limite).toBe(20);
    expect(revuesContradictoiresQuerySchema.safeParse({}).success).toBe(false);
    expect(
      revuesContradictoiresQuerySchema.safeParse({ generation_id: id, limite: 51 }).success,
    ).toBe(false);
    expect(BROUILLON_REVUE_MAX).toBe(40_000);
  });
});
