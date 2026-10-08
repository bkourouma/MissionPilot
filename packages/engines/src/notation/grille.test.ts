import { describe, expect, it } from "vitest";
import type { DefinitionQuestionnaire } from "../questionnaires/types";
import { GRILLE, QUESTIONNAIRE } from "./fixtures.test-utils";
import {
  exigerCoherence,
  exigerGrilleValide,
  poidsExacts,
  poidsNormalises,
  validerGrille,
  verifierCoherence,
  type GrilleNotation,
  type RegleConversion,
} from "./grille";

function copie<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

function variante(modifier: (g: Mutable<GrilleNotation>) => void): GrilleNotation {
  const g = copie(GRILLE) as Mutable<GrilleNotation>;
  modifier(g);
  return g as GrilleNotation;
}

const codes = (g: GrilleNotation) => validerGrille(g).map((e) => e.code);

function avecConversion(conversion: RegleConversion): GrilleNotation {
  return variante((g) => {
    (g.dimensions[0]!.indicateurs[0] as { conversion: RegleConversion }).conversion = conversion;
  });
}

describe("validerGrille", () => {
  it("accepte la grille d'essai", () => {
    expect(validerGrille(GRILLE)).toEqual([]);
    expect(() => exigerGrilleValide(GRILLE)).not.toThrow();
  });

  it("contrôle l'en-tête", () => {
    expect(codes({ id: "X", version: 0, titre: " ", dimensions: [] })).toEqual([
      "IDENTIFIANT_INVALIDE",
      "VERSION_INVALIDE",
      "LIBELLE_VIDE",
      "DIMENSIONS_VIDES",
      "POIDS_INVALIDE",
    ]);
  });

  it("contrôle dimensions et indicateurs", () => {
    const g = variante((x) => {
      const d = x.dimensions[1]!;
      d.id = "strategie";
      d.libelle = "";
      d.famille = "Compétitivité";
      d.poids = -1;
      const ind = d.indicateurs[0]!;
      ind.id = "i1";
      ind.question = "q1";
      ind.poids = 0;
      d.indicateurs[1]!.id = "Mauvais";
      x.dimensions.push({ id: "_vide", libelle: "Vide", famille: "x", poids: 0, indicateurs: [] });
      x.secteurs = [];
    });
    expect(codes(g)).toEqual([
      "IDENTIFIANT_DOUBLON",
      "LIBELLE_VIDE",
      "IDENTIFIANT_INVALIDE",
      "POIDS_INVALIDE",
      "IDENTIFIANT_DOUBLON",
      "QUESTION_DOUBLON",
      "POIDS_INVALIDE",
      "IDENTIFIANT_INVALIDE",
      "IDENTIFIANT_INVALIDE",
      "INDICATEURS_VIDES",
    ]);
  });

  it("exige au moins une dimension pondérée", () => {
    const g = variante((x) => {
      x.dimensions.forEach((d) => (d.poids = 0));
      x.secteurs = [];
    });
    expect(codes(g)).toEqual(["POIDS_INVALIDE"]);
  });

  it.each<[string, RegleConversion]>([
    ["likert à 1 niveau", { type: "likert", points: 1 }],
    ["likert à 11 niveaux", { type: "likert", points: 11 }],
    ["choix vide", { type: "choix", valeurs: [] }],
    [
      "choix en double",
      {
        type: "choix",
        valeurs: [
          { code: "a", points: 1 },
          { code: "a", points: 2 },
        ],
      },
    ],
    ["choix > 100", { type: "choix_multiple", valeurs: [{ code: "a", points: 101 }] }],
    ["oui/non négatif", { type: "oui_non", oui: 100, non: -1 }],
    ["seuils vides", { type: "seuils", paliers: [] }],
    [
      "seuils non croissants",
      {
        type: "seuils",
        paliers: [
          { min: 10, points: 0 },
          { min: 10, points: 50 },
        ],
      },
    ],
    ["seuils hors échelle", { type: "seuils", paliers: [{ min: 0, points: 150 }] }],
    ["interpolation à 1 point", { type: "interpolation", points: [{ x: 0, y: 0 }] }],
    [
      "interpolation décroissante",
      {
        type: "interpolation",
        points: [
          { x: 5, y: 0 },
          { x: 1, y: 100 },
        ],
      },
    ],
    [
      "interpolation hors échelle",
      {
        type: "interpolation",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 101 },
        ],
      },
    ],
    ["seuil infini", { type: "seuils", paliers: [{ min: Number.NEGATIVE_INFINITY, points: 0 }] }],
  ])("refuse une conversion invalide : %s", (_, conversion) => {
    expect(codes(avecConversion(conversion))).toEqual(["CONVERSION_INVALIDE"]);
  });

  it("contrôle les surcharges sectorielles", () => {
    const g = variante((x) => {
      x.secteurs = [
        { secteur: "Agro", poids: [{ dimension: "inconnue", poids: 1 }] },
        {
          secteur: "industrie",
          poids: [
            { dimension: "couts", poids: Number.NaN },
            { dimension: "couts", poids: 1 },
          ],
        },
        { secteur: "industrie", poids: [] },
        {
          secteur: "vide",
          poids: [
            { dimension: "strategie", poids: 0 },
            { dimension: "couts", poids: 0 },
          ],
        },
      ];
    });
    expect(codes(g)).toEqual([
      "IDENTIFIANT_INVALIDE",
      "DIMENSION_INCONNUE",
      "POIDS_INVALIDE",
      "IDENTIFIANT_DOUBLON",
      "IDENTIFIANT_DOUBLON",
      "POIDS_INVALIDE",
    ]);
  });

  it("exigerGrilleValide lève GRILLE_INVALIDE avec le détail", () => {
    try {
      exigerGrilleValide({ ...GRILLE, version: 0 });
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "GRILLE_INVALIDE", details: [{ code: "VERSION_INVALIDE" }] });
    }
  });
});

describe("pondérations par secteur", () => {
  it("normalise les poids par défaut à 100", () => {
    expect(poidsNormalises(GRILLE)).toEqual({
      secteurApplique: null,
      poids: [
        { dimension: "strategie", poids: 60 },
        { dimension: "couts", poids: 40 },
      ],
    });
  });

  it("applique une surcharge partielle puis renormalise : 60/60 → 50/50", () => {
    expect(poidsNormalises(GRILLE, "industrie")).toEqual({
      secteurApplique: "industrie",
      poids: [
        { dimension: "strategie", poids: 50 },
        { dimension: "couts", poids: 50 },
      ],
    });
  });

  it("répartit les centièmes au plus fort reste : la somme affichée vaut exactement 100", () => {
    const { poids } = poidsNormalises(GRILLE, "numerique");
    expect(poids).toEqual([
      { dimension: "strategie", poids: 33.33 },
      { dimension: "couts", poids: 66.67 },
    ]);
    const exacts = poidsExacts(GRILLE, "numerique").poids.map((p) => p.poids);
    expect(exacts).toEqual([
      { num: 100n, den: 3n },
      { num: 200n, den: 3n },
    ]);
    const trois = variante((x) => {
      x.dimensions.push({ ...copie(x.dimensions[1]!), id: "tiers", indicateurs: [] });
    });
    // Grille invalide (dimension sans indicateur) : refusée avant tout calcul.
    expect(() => poidsNormalises(trois)).toThrow(
      expect.objectContaining({ code: "GRILLE_INVALIDE" }),
    );
  });

  it("départage les restes égaux par l'ordre de la grille", () => {
    const g = variante((x) => {
      const modele = x.dimensions[1]!;
      x.dimensions = [0, 1, 2].map((i) => ({
        ...copie(modele),
        id: `d${i}`,
        poids: 1,
        indicateurs: modele.indicateurs.map((ind) => ({
          ...ind,
          id: `${ind.id}_${i}`,
          question: `${ind.question}_${i}`,
        })),
      }));
      x.secteurs = [];
    });
    expect(poidsNormalises(g).poids.map((p) => p.poids)).toEqual([33.34, 33.33, 33.33]);
  });

  it("un secteur inconnu applique les poids par défaut et le signale", () => {
    expect(poidsNormalises(GRILLE, "spatial").secteurApplique).toBeNull();
    expect(
      poidsNormalises({ ...GRILLE, secteurs: undefined }, "industrie").secteurApplique,
    ).toBeNull();
  });
});

describe("verifierCoherence grille / questionnaire", () => {
  it("accepte la grille et le questionnaire d'essai", () => {
    expect(verifierCoherence(GRILLE, QUESTIONNAIRE)).toEqual([]);
    expect(() => exigerCoherence(GRILLE, QUESTIONNAIRE)).not.toThrow();
  });

  it("signale question inconnue, type incompatible, échelle et options discordantes", () => {
    const def = copie(QUESTIONNAIRE) as Mutable<DefinitionQuestionnaire>;
    const strategie = def.sections[0]!.questions as unknown as Record<string, unknown>[];
    strategie[1]!.points = 4; // q1 : 4 niveaux au lieu de 5
    strategie[1]!.libelles = ["a", "b", "c", "d"];
    (strategie[2]!.options as unknown[]).push({ code: "d", libelle: "Autre" }); // q2 : option non valorisée
    const couts = def.sections[1]!.questions as unknown as Record<string, unknown>[];
    couts[0]!.type = "texte"; // q4 : plus numérique
    couts.splice(1, 1); // q5 : supprimée
    const erreurs = verifierCoherence(GRILLE, def as DefinitionQuestionnaire);
    expect(erreurs.map((e) => [e.chemin, e.code])).toEqual([
      ["dimensions[0].indicateurs[0]", "TYPE_INCOMPATIBLE"],
      ["dimensions[0].indicateurs[1]", "OPTIONS_INCOHERENTES"],
      ["dimensions[1].indicateurs[0]", "TYPE_INCOMPATIBLE"],
      ["dimensions[1].indicateurs[1]", "QUESTION_INCONNUE"],
    ]);
    expect(erreurs[1]?.message).toBe("Options de « q2 » : non valorisées [d], inconnues [].");
    expect(() => exigerCoherence(GRILLE, def as DefinitionQuestionnaire)).toThrow(
      expect.objectContaining({ code: "GRILLE_INVALIDE" }),
    );
  });

  it("vérifie aussi les règles de choix multiple et oui/non", () => {
    const def: DefinitionQuestionnaire = {
      id: "m",
      version: 1,
      titre: "M",
      sections: [
        {
          id: "s",
          titre: "S",
          questions: [
            {
              id: "m",
              type: "choix_multiple",
              libelle: "M",
              obligatoire: false,
              options: [
                { code: "a", libelle: "A" },
                { code: "b", libelle: "B" },
              ],
            },
            { id: "o", type: "oui_non", libelle: "O", obligatoire: false },
          ],
        },
      ],
    };
    const grille: GrilleNotation = {
      id: "m",
      version: 1,
      titre: "M",
      dimensions: [
        {
          id: "d",
          libelle: "D",
          famille: "f",
          poids: 1,
          indicateurs: [
            {
              id: "m",
              question: "m",
              poids: 1,
              conversion: {
                type: "choix_multiple",
                valeurs: [
                  { code: "a", points: 60 },
                  { code: "z", points: 40 },
                ],
              },
            },
            {
              id: "o",
              question: "o",
              poids: 1,
              conversion: { type: "choix", valeurs: [{ code: "a", points: 1 }] },
            },
          ],
        },
      ],
    };
    expect(verifierCoherence(grille, def).map((e) => e.message)).toEqual([
      "Options de « m » : non valorisées [b], inconnues [z].",
      "La règle « choix » ne s'applique pas à la question « o » (oui_non).",
    ]);
  });

  it("préfixe les anomalies du questionnaire", () => {
    const def = { ...QUESTIONNAIRE, version: 0 };
    expect(verifierCoherence(GRILLE, def)).toEqual([
      {
        code: "VERSION_INVALIDE",
        chemin: "questionnaire.version",
        message: "La version doit être un entier positif.",
      },
    ]);
  });
});
