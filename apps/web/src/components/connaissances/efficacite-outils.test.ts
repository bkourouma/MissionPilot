import { describe, expect, it } from "vitest";
import { ErreurApi } from "../../lib/api";
import {
  libelleContexte,
  libelleMiseEnOeuvre,
  libelleScore,
  libelleScoreRecommandation,
  libelleStatutEfficacite,
  lireAbandon,
  lireMiseEnOeuvre,
  lireRecommandation,
  messageEfficacite,
  tonaliteStatutEfficacite,
} from "./efficacite-outils";

const M = "11111111-1111-4111-8111-111111111111";
const K = "22222222-2222-4222-8222-222222222222";

describe("efficacité : libellés", () => {
  it("contexte dans l'ordre des dimensions, taille en clair", () => {
    expect(
      libelleContexte({
        valeurs: { type_initiative: "Formation", secteur: "Agro-industrie", taille: "pme" },
      }),
    ).toBe("Formation · Agro-industrie · PME");
    expect(libelleContexte({ valeurs: { taille: "grande_entreprise" } })).toBe("Grande entreprise");
    expect(libelleContexte({ valeurs: { taille: "inconnue" } })).toBe("inconnue");
  });

  it("score masqué sous le seuil : jamais un zéro, ni l'effectif", () => {
    expect(
      libelleScore({ score_moyen: null, effectif: null, raison: "effectif insuffisant" }, 5),
    ).toBe("Effectif insuffisant (5 observations requises)");
    expect(libelleScore({ score_moyen: 0, effectif: 6, raison: null }, 5)).toBe("0 / 100");
  });

  it("score d'une recommandation : non mesuré, non évaluable, évalué", () => {
    const base = { statut: "mise_en_oeuvre" as const, raison: null };
    expect(
      libelleScoreRecommandation({ ...base, statut: "recommandee", score: null, evaluable: null }),
    ).toBe("—");
    expect(libelleScoreRecommandation({ ...base, score: null, evaluable: null })).toBe(
      "Effet non mesuré",
    );
    expect(
      libelleScoreRecommandation({
        ...base,
        score: null,
        evaluable: false,
        raison: "Pas de base.",
      }),
    ).toBe("Pas de base.");
    expect(libelleScoreRecommandation({ ...base, score: null, evaluable: false })).toBe(
      "Non évaluable",
    );
    expect(libelleScoreRecommandation({ ...base, score: 75, evaluable: true })).toBe("75 / 100");
  });

  it("statuts", () => {
    expect(libelleStatutEfficacite("mise_en_oeuvre")).toBe("Mise en oeuvre");
    expect(tonaliteStatutEfficacite("recommandee")).toBe("attention");
    expect(tonaliteStatutEfficacite("mise_en_oeuvre")).toBe("succes");
    expect(tonaliteStatutEfficacite("abandonnee")).toBe("neutre");
  });
});

describe("efficacité : lecture des saisies", () => {
  const ok = {
    kpi_id: K,
    plan_initiative_id: "",
    libelle: " Former les équipes ",
    type_initiative: " Formation ",
    valeur_cible: "4,5",
  };

  it("normalise : espaces, virgule décimale, initiative facultative", () => {
    expect(lireRecommandation(M, ok)).toEqual({
      ok: true,
      charge: {
        mission_id: M,
        kpi_id: K,
        plan_initiative_id: null,
        libelle: "Former les équipes",
        type_initiative: "Formation",
        valeur_cible: "4.5",
      },
    });
  });

  it("refuse KPI manquant, textes vides ou trop longs, valeur non décimale", () => {
    const r = lireRecommandation(M, {
      ...ok,
      kpi_id: "",
      libelle: "",
      type_initiative: "x".repeat(81),
      valeur_cible: "1e5",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "kpi_id",
        "libelle",
        "type_initiative",
        "valeur_cible",
      ]);
    }
    expect(lireRecommandation(M, { ...ok, valeur_cible: "1.1234567" }).ok).toBe(false);
  });

  it("mise en oeuvre et abandon", () => {
    expect(lireMiseEnOeuvre("2026-05-01")).toEqual({
      ok: true,
      charge: { mise_en_oeuvre_le: "2026-05-01" },
    });
    expect(lireMiseEnOeuvre("1er mai").ok).toBe(false);
    expect(lireAbandon(" Hors budget ")).toEqual({ ok: true, charge: { motif: "Hors budget" } });
    expect(lireAbandon("  ").ok).toBe(false);
    expect(lireAbandon("x".repeat(501)).ok).toBe(false);
  });

  it("messages d'erreur de l'API traduits", () => {
    expect(messageEfficacite(new ErreurApi("RECOMMANDATION_EXISTANTE", "x", 409))).toContain(
      "existe déjà",
    );
    expect(messageEfficacite(new Error("boum"))).not.toBe("");
  });
});

describe("date de mise en œuvre affichée", () => {
  it("formatée en français, jamais en ISO brut", () => {
    const l = libelleMiseEnOeuvre("2026-10-15");
    expect(l).toBe(" · mise en œuvre le 15 oct. 2026");
    expect(l).not.toContain("2026-10-15");
    expect(libelleMiseEnOeuvre(null)).toBe("");
  });
});
