import { describe, expect, it } from "vitest";
import { GRILLE, QUESTIONNAIRE, REPONSES_EXEMPLE } from "./fixtures.test-utils";
import { noterQuestionnaire, noterRepondants, preparerReponses } from "./repondants";
import { scoreGlobal } from "./score";

const erreur = (code: string) => expect.objectContaining({ code });

describe("noterRepondants : moyenne multi-répondants pondérée par rôle", () => {
  const dg = { repondant: "dg", role: "dirigeant", reponses: { ...REPONSES_EXEMPLE, q1: 5 } };
  const rh = { repondant: "rh", role: "contributeur", reponses: { ...REPONSES_EXEMPLE, q1: 2 } };

  it("à poids égaux, moyenne simple par indicateur", () => {
    // i1 : (100 + 25) / 2 = 62,5 → stratégie (2 × 62,5 + 50 + 100) / 4 = 68,75 → 68,8.
    const r = noterRepondants(GRILLE, [dg, rh]);
    expect(r.dimensions[0]).toMatchObject({ score: 68.8, scoreExact: "275/4" });
    expect(r.dimensions[0]?.indicateurs[0]?.points).toBe(62.5);
  });

  it("pondère par rôle : dirigeant 2, contributeur 1", () => {
    // i1 : (2 × 100 + 1 × 25) / 3 = 75 → stratégie (150 + 50 + 100) / 4 = 75.
    const r = noterRepondants(GRILLE, [dg, rh], { poidsRoles: [{ role: "dirigeant", poids: 2 }] });
    expect(r.dimensions[0]?.score).toBe(75);
    // Global : (60 × 75 + 40 × 65) / 100 = 71.
    expect(r).toMatchObject({ score: 71, classe: "B" });
  });

  it("un rôle de poids nul est écarté ; un répondant sans rôle prend le poids par défaut", () => {
    const sansRole = { repondant: "x", reponses: { ...REPONSES_EXEMPLE, q1: 1 } };
    const r = noterRepondants(GRILLE, [dg, rh, sansRole], {
      poidsRoles: [{ role: "contributeur", poids: 0 }],
      poidsRoleDefaut: 1,
    });
    // i1 : (100 + 0) / 2 = 50.
    expect(r.dimensions[0]?.indicateurs[0]?.points).toBe(50);
  });

  it("ne dépend pas de l'ordre des répondants", () => {
    const options = { poidsRoles: [{ role: "dirigeant", poids: 3 }] };
    expect(noterRepondants(GRILLE, [rh, dg], options)).toEqual(
      noterRepondants(GRILLE, [dg, rh], options),
    );
  });

  it("un seul répondant équivaut au score global", () => {
    expect(noterRepondants(GRILLE, [{ repondant: "seul", reponses: REPONSES_EXEMPLE }])).toEqual(
      scoreGlobal(GRILLE, REPONSES_EXEMPLE),
    );
  });

  it("indicateur sans objet pour tous → sans objet ; pour certains seulement → moyenne des autres", () => {
    const a = { repondant: "a", reponses: { q1: 5, q3: true }, nonApplicables: ["q2"] };
    const b = { repondant: "b", reponses: { q1: 1, q3: true }, nonApplicables: ["q2"] };
    expect(noterRepondants(GRILLE, [a, b]).dimensions[0]?.indicateurs[1]?.statut).toBe(
      "sans_objet",
    );
    const c = { repondant: "c", reponses: { q1: 3, q2: "a", q3: false } };
    const r = noterRepondants(GRILLE, [a, c]);
    expect(r.dimensions[0]?.indicateurs[1]).toMatchObject({ statut: "repondu", points: 100 });
    // Personne n'a répondu à q4 alors qu'elle était applicable : manquant.
    expect(r.dimensions[1]?.indicateurs[0]?.statut).toBe("manquant");
  });

  it("refuse des répondants absents, en double, ou tous de poids nul, et des poids invalides", () => {
    expect(() => noterRepondants(GRILLE, [])).toThrow(erreur("REPONDANT_INVALIDE"));
    expect(() => noterRepondants(GRILLE, [dg, dg])).toThrow(erreur("REPONDANT_INVALIDE"));
    expect(() =>
      noterRepondants(GRILLE, [dg], { poidsRoles: [{ role: "dirigeant", poids: 0 }] }),
    ).toThrow(erreur("REPONDANT_INVALIDE"));
    expect(() => noterRepondants(GRILLE, [dg], { poidsRoleDefaut: -1 })).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
    expect(() =>
      noterRepondants(GRILLE, [dg], { poidsRoles: [{ role: "x", poids: Number.NaN }] }),
    ).toThrow(erreur("OPTIONS_INVALIDES"));
    expect(() => noterRepondants(GRILLE, [dg], { strategie: "x" as never })).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
  });
});

describe("liaison avec le questionnaire", () => {
  it("prépare les réponses : valeurs nettoyées, questions invisibles sans objet", () => {
    // q3 = non : q1 devient invisible, sa réponse est écartée et l'indicateur sans objet.
    const prepare = preparerReponses(GRILLE, QUESTIONNAIRE, {
      q3: false,
      q1: 5,
      q2: "a",
      note: " x ",
    });
    expect(prepare).toEqual({
      reponses: { q3: false, q2: "a", note: "x" },
      nonApplicables: ["q1"],
    });
  });

  it("note un questionnaire brut de bout en bout", () => {
    expect(noterQuestionnaire(GRILLE, QUESTIONNAIRE, REPONSES_EXEMPLE)).toEqual(
      scoreGlobal(GRILLE, REPONSES_EXEMPLE),
    );
    const r = noterQuestionnaire(GRILLE, QUESTIONNAIRE, {
      q3: false,
      q1: 5,
      q2: "a",
      q4: 20,
      q5: 0,
      q6: 1,
    });
    // Stratégie : q1 sans objet → (100 + 0) / 2 = 50 ; coûts 100 → (60 × 50 + 40 × 100) / 100 = 70.
    expect(r.dimensions[0]).toMatchObject({ score: 50, couverture: 1 });
    expect(r).toMatchObject({ score: 70, classe: "B" });
  });

  it("refuse une valeur invalide ou une grille incohérente avec le questionnaire", () => {
    expect(() => noterQuestionnaire(GRILLE, QUESTIONNAIRE, { q4: 150 })).toThrow(
      erreur("REPONSES_INVALIDES"),
    );
    const autre = { ...QUESTIONNAIRE, sections: QUESTIONNAIRE.sections.slice(0, 1) };
    expect(() => noterQuestionnaire(GRILLE, autre, {})).toThrow(erreur("GRILLE_INVALIDE"));
  });
});
