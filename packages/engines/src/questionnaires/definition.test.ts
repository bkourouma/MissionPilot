import { describe, expect, it } from "vitest";
import {
  exigerDefinitionValide,
  profondeurCondition,
  referencesCondition,
  validerDefinition,
} from "./definition";
import { ErreurQuestionnaire } from "./erreurs";
import { DEF, LIKERT5, copie } from "./fixtures.test-utils";
import type { Condition, DefinitionQuestionnaire, Question } from "./types";

type Modifiable = { -readonly [K in keyof DefinitionQuestionnaire]: unknown } & {
  sections: {
    id: string;
    titre: string;
    condition?: unknown;
    questions: Record<string, unknown>[];
  }[];
};

function variante(modifier: (d: Modifiable) => void): DefinitionQuestionnaire {
  const d = copie(DEF) as unknown as Modifiable;
  modifier(d);
  return d as unknown as DefinitionQuestionnaire;
}

function codes(def: DefinitionQuestionnaire): string[] {
  return validerDefinition(def).erreurs.map((e) => e.code);
}

function avecQuestions(...questions: Question[]): DefinitionQuestionnaire {
  return { id: "q", version: 1, titre: "Q", sections: [{ id: "s", titre: "S", questions }] };
}

const oui = (id: string, condition?: Condition): Question => ({
  id,
  type: "oui_non",
  libelle: id,
  obligatoire: false,
  ...(condition ? { condition } : {}),
});

describe("validerDefinition", () => {
  it("accepte le questionnaire d'essai", () => {
    expect(validerDefinition(DEF)).toEqual({ valide: true, erreurs: [] });
    expect(() => exigerDefinitionValide(DEF)).not.toThrow();
  });

  it("contrôle l'en-tête du questionnaire", () => {
    expect(codes({ id: "Mauvais Id", version: 0, titre: " ", sections: [] })).toEqual([
      "IDENTIFIANT_INVALIDE",
      "VERSION_INVALIDE",
      "LIBELLE_VIDE",
      "SECTIONS_VIDES",
    ]);
    expect(codes({ ...DEF, version: 1.5 })).toEqual(["VERSION_INVALIDE"]);
  });

  it("contrôle les sections et l'unicité des identifiants", () => {
    const d = variante((x) => {
      x.sections.push({ id: "general", titre: "", questions: [] });
      x.sections.push({
        id: "_x",
        titre: "X",
        questions: [{ ...(x.sections[0]!.questions[0] as object) }],
      });
    });
    expect(codes(d)).toEqual([
      "IDENTIFIANT_DOUBLON",
      "LIBELLE_VIDE",
      "QUESTIONS_VIDES",
      "IDENTIFIANT_INVALIDE",
      "IDENTIFIANT_DOUBLON",
    ]);
  });

  it("refuse un identifiant de question invalide et un libellé vide", () => {
    expect(
      codes(avecQuestions({ ...oui("ok"), id: "A-majuscule" }, { ...oui("b"), libelle: "" })),
    ).toEqual(["IDENTIFIANT_INVALIDE", "LIBELLE_VIDE"]);
  });

  it("contrôle les échelles de Likert", () => {
    const likert = (points: number, libelles: readonly string[]): Question => ({
      id: "l",
      type: "likert",
      libelle: "L",
      obligatoire: true,
      points,
      libelles,
    });
    expect(codes(avecQuestions(likert(1, ["a"])))).toEqual(["ECHELLE_INVALIDE"]);
    expect(codes(avecQuestions(likert(11, [])))).toEqual(["ECHELLE_INVALIDE"]);
    expect(codes(avecQuestions(likert(2.5, [])))).toEqual(["ECHELLE_INVALIDE"]);
    expect(codes(avecQuestions(likert(5, LIKERT5.slice(0, 4))))).toEqual(["ECHELLE_INVALIDE"]);
    expect(codes(avecQuestions(likert(2, ["a", " "])))).toEqual(["ECHELLE_INVALIDE"]);
    expect(
      codes(
        avecQuestions(
          likert(
            10,
            Array.from({ length: 10 }, (_, i) => `n${i}`),
          ),
        ),
      ),
    ).toEqual([]);
  });

  it("contrôle les options de choix", () => {
    const choix = (options: { code: string; libelle: string }[]): Question => ({
      id: "c",
      type: "choix_unique",
      libelle: "C",
      obligatoire: true,
      options,
    });
    expect(codes(avecQuestions(choix([{ code: "a", libelle: "A" }])))).toEqual([
      "OPTIONS_INSUFFISANTES",
    ]);
    expect(
      codes(
        avecQuestions(
          choix([
            { code: "a", libelle: "A" },
            { code: "a", libelle: "" },
            { code: "B", libelle: "B" },
          ]),
        ),
      ),
    ).toEqual(["IDENTIFIANT_DOUBLON", "LIBELLE_VIDE", "IDENTIFIANT_INVALIDE"]);
  });

  it("contrôle les bornes de sélection d'un choix multiple", () => {
    const multiple = (minSelections?: number, maxSelections?: number): Question => ({
      id: "m",
      type: "choix_multiple",
      libelle: "M",
      obligatoire: false,
      options: [
        { code: "a", libelle: "A" },
        { code: "b", libelle: "B" },
      ],
      ...(minSelections === undefined ? {} : { minSelections }),
      ...(maxSelections === undefined ? {} : { maxSelections }),
    });
    expect(codes(avecQuestions(multiple()))).toEqual([]);
    expect(codes(avecQuestions(multiple(2, 2)))).toEqual([]);
    for (const [min, max] of [
      [0, 2],
      [2, 1],
      [1, 3],
      [1.5, 2],
      [1, 1.5],
    ] as const) {
      expect(codes(avecQuestions(multiple(min, max)))).toEqual(["SELECTION_INVALIDE"]);
    }
  });

  it("contrôle texte, nombre et date", () => {
    const texte = (longueurMax: number): Question => ({
      id: "t",
      type: "texte",
      libelle: "T",
      obligatoire: false,
      longueurMax,
    });
    expect(codes(avecQuestions(texte(0)))).toEqual(["LONGUEUR_INVALIDE"]);
    expect(codes(avecQuestions(texte(20_001)))).toEqual(["LONGUEUR_INVALIDE"]);
    expect(codes(avecQuestions(texte(1.5)))).toEqual(["LONGUEUR_INVALIDE"]);
    expect(
      codes(avecQuestions({ id: "t", type: "texte", libelle: "T", obligatoire: false })),
    ).toEqual([]);

    const nombre = (min?: number, max?: number): Question => ({
      id: "n",
      type: "numerique",
      libelle: "N",
      obligatoire: false,
      min,
      max,
    });
    expect(codes(avecQuestions(nombre(5, 1)))).toEqual(["BORNES_INVALIDES"]);
    expect(codes(avecQuestions(nombre(Number.NaN)))).toEqual(["BORNES_INVALIDES"]);
    expect(codes(avecQuestions(nombre(1, 1)))).toEqual([]);
    expect(codes(avecQuestions(nombre()))).toEqual([]);

    const date = (min?: string, max?: string): Question => ({
      id: "d",
      type: "date",
      libelle: "D",
      obligatoire: false,
      min,
      max,
    });
    expect(codes(avecQuestions(date("2026-02-30")))).toEqual(["BORNES_INVALIDES"]);
    expect(codes(avecQuestions(date("2026-12-31", "2026-01-01")))).toEqual(["BORNES_INVALIDES"]);
    expect(codes(avecQuestions(date("2026-01-01", "2026-01-01")))).toEqual([]);
  });
});

describe("validerDefinition — logique conditionnelle", () => {
  it("signale une référence inconnue", () => {
    const r = validerDefinition(
      avecQuestions(oui("a", { op: "egal", question: "fantome", valeur: true })),
    );
    expect(r.valide).toBe(false);
    expect(r.erreurs).toEqual([
      {
        code: "REFERENCE_INCONNUE",
        chemin: "sections[0].questions[0].condition",
        message: "La condition cite une question inconnue : « fantome ».",
      },
    ]);
  });

  it("détecte un cycle entre deux questions et l'affiche lisiblement", () => {
    const r = validerDefinition(
      avecQuestions(
        oui("a", { op: "egal", question: "b", valeur: true }),
        oui("b", { op: "egal", question: "a", valeur: true }),
      ),
    );
    expect(r.erreurs).toEqual([
      {
        code: "CYCLE",
        chemin: "sections[0].questions[1]",
        message: "Cycle de conditions : a → b → a.",
      },
    ]);
  });

  it("détecte un cycle long et une question qui dépend d'elle-même", () => {
    const long = avecQuestions(
      oui("a", { op: "vide", question: "c" }),
      oui("b", { op: "vide", question: "a" }),
      oui("c", { op: "non", condition: { op: "vide", question: "b" } }),
      oui("d", { op: "vide", question: "a" }),
    );
    expect(validerDefinition(long).erreurs.map((e) => e.message)).toEqual([
      "Cycle de conditions : a → c → b → a.",
    ]);
    expect(
      validerDefinition(avecQuestions(oui("a", { op: "vide", question: "a" }))).erreurs[0]?.message,
    ).toBe("Cycle de conditions : a → a.");
  });

  it("détecte le cycle créé par une condition de section qui lit sa propre section", () => {
    const d: DefinitionQuestionnaire = {
      id: "q",
      version: 1,
      titre: "Q",
      sections: [
        {
          id: "s",
          titre: "S",
          condition: { op: "egal", question: "a", valeur: true },
          questions: [oui("a")],
        },
      ],
    };
    expect(codes(d)).toEqual(["CYCLE"]);
  });

  it("accepte une chaîne de dépendances sans cycle, quel que soit l'ordre", () => {
    const d = avecQuestions(
      oui("c", { op: "egal", question: "b", valeur: true }),
      oui("b", { op: "egal", question: "a", valeur: true }),
      oui("a"),
    );
    expect(codes(d)).toEqual([]);
  });

  it("borne la profondeur des conditions", () => {
    const feuille: Condition = { op: "egal", question: "a", valeur: true };
    const imbriquer = (n: number): Condition =>
      n <= 1 ? feuille : { op: "non", condition: imbriquer(n - 1) };
    expect(profondeurCondition(imbriquer(5))).toBe(5);
    expect(codes(avecQuestions(oui("a"), oui("b", imbriquer(5))))).toEqual([]);
    expect(validerDefinition(avecQuestions(oui("a"), oui("b", imbriquer(6)))).erreurs).toEqual([
      {
        code: "PROFONDEUR_DEPASSEE",
        chemin: "sections[0].questions[1].condition",
        message: "Condition trop imbriquée : 5 niveaux au plus.",
      },
    ]);
    // Une condition très profonde ne fait pas déborder la pile : le parcours est plafonné.
    expect(profondeurCondition(imbriquer(5_000))).toBe(6);
    expect(profondeurCondition({ op: "et", conditions: [] })).toBe(1);
  });

  it("refuse une combinaison vide", () => {
    expect(codes(avecQuestions(oui("a"), oui("b", { op: "ou", conditions: [] })))).toEqual([
      "CONDITION_VIDE",
    ]);
  });

  it("liste les références d'une condition composée", () => {
    expect(
      referencesCondition({
        op: "et",
        conditions: [
          { op: "egal", question: "a", valeur: 1 },
          { op: "non", condition: { op: "vide", question: "b" } },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  it("contrôle la compatibilité des valeurs avec le type de la question visée", () => {
    const cibles: Question[] = [
      { id: "l", type: "likert", libelle: "L", obligatoire: false, points: 5, libelles: LIKERT5 },
      {
        id: "c",
        type: "choix_unique",
        libelle: "C",
        obligatoire: false,
        options: [
          { code: "x", libelle: "X" },
          { code: "y", libelle: "Y" },
        ],
      },
      { id: "o", type: "oui_non", libelle: "O", obligatoire: false },
      { id: "n", type: "numerique", libelle: "N", obligatoire: false },
      { id: "t", type: "texte", libelle: "T", obligatoire: false },
      { id: "d", type: "date", libelle: "D", obligatoire: false },
    ];
    const verifier = (condition: Condition) => codes(avecQuestions(...cibles, oui("z", condition)));
    const valides: Condition[] = [
      { op: "egal", question: "l", valeur: 3 },
      { op: "different", question: "c", valeur: "x" },
      { op: "egal", question: "o", valeur: false },
      { op: "egal", question: "n", valeur: 2.5 },
      { op: "egal", question: "t", valeur: "oui" },
      { op: "egal", question: "d", valeur: "2026-10-06" },
      { op: "dans", question: "c", valeurs: ["x", "y"] },
      { op: "superieur", question: "l", valeur: 2 },
      { op: "inferieur", question: "n", valeur: -1 },
      { op: "superieur", question: "d", valeur: "2026-01-01" },
      { op: "vide", question: "t" },
    ];
    valides.forEach((c) => expect(verifier(c)).toEqual([]));
    const invalides: Condition[] = [
      { op: "egal", question: "l", valeur: 6 },
      { op: "egal", question: "l", valeur: 2.5 },
      { op: "egal", question: "c", valeur: "w" },
      { op: "egal", question: "o", valeur: "oui" },
      { op: "egal", question: "n", valeur: Number.POSITIVE_INFINITY },
      { op: "egal", question: "t", valeur: 3 },
      { op: "egal", question: "d", valeur: "2026-13-01" },
      { op: "dans", question: "c", valeurs: [] },
      { op: "dans", question: "c", valeurs: ["x", "w"] },
      { op: "superieur", question: "c", valeur: 1 },
      { op: "inferieur", question: "o", valeur: 1 },
      { op: "superieur", question: "n", valeur: "10" },
      { op: "superieur", question: "d", valeur: "hier" },
    ];
    invalides.forEach((c) => expect(verifier(c)).toEqual(["VALEUR_INCOMPATIBLE"]));
  });

  it("valide aussi les conditions de section", () => {
    const d = variante((x) => {
      x.sections[1]!.condition = { op: "egal", question: "inconnue", valeur: 1 };
    });
    expect(validerDefinition(d).erreurs[0]?.chemin).toBe("sections[1].condition");
  });

  it("exigerDefinitionValide lève DEFINITION_INVALIDE avec le détail", () => {
    const fautive = avecQuestions(oui("a", { op: "vide", question: "a" }));
    try {
      exigerDefinitionValide(fautive);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurQuestionnaire);
      expect((e as ErreurQuestionnaire).code).toBe("DEFINITION_INVALIDE");
      expect((e as ErreurQuestionnaire).details).toHaveLength(1);
    }
  });
});
