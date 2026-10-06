import { describe, expect, it } from "vitest";
import { ErreurQuestionnaire } from "./erreurs";
import { DEF } from "./fixtures.test-utils";
import { exigerReponsesValides, progression, validerReponses } from "./reponses";
import { estVide, lireReponse, toutesLesQuestions, type Question, type Reponses } from "./types";
import { validerReponse } from "./valeurs";
import { etatQuestionnaire, evaluerCondition, questionsVisibles } from "./visibilite";

const question = (id: string): Question =>
  toutesLesQuestions(DEF).find((q) => q.id === id) as Question;

describe("validerReponse", () => {
  it("rend null pour une réponse vide, quel que soit le type", () => {
    for (const vide of [null, undefined, "", "   ", []]) {
      expect(validerReponse(question("revue"), vide)).toEqual({ valide: true, valeur: null });
    }
  });

  it.each([
    ["revue", 3, 3],
    ["revue", 1, 1],
    ["revue", 5, 5],
    ["horizon", "trois_ans", "trois_ans"],
    ["outils", ["bi", "erp", "bi"], ["erp", "bi"]],
    ["commentaire", "  court  ", "court"],
    ["effectif", 0, 0],
    ["effectif", 1000, 1000],
    ["plan", false, false],
    ["creation", "2026-12-31", "2026-12-31"],
  ] as const)("%s : %j est accepté et normalisé en %j", (id, valeur, attendu) => {
    expect(validerReponse(question(id), valeur)).toEqual({ valide: true, valeur: attendu });
  });

  it.each([
    ["revue", "3", "TYPE_INVALIDE"],
    ["revue", 2.5, "TYPE_INVALIDE"],
    ["revue", 0, "HORS_ECHELLE"],
    ["revue", 6, "HORS_ECHELLE"],
    ["horizon", 3, "TYPE_INVALIDE"],
    ["horizon", "dix_ans", "OPTION_INCONNUE"],
    ["outils", "erp", "TYPE_INVALIDE"],
    ["outils", [1], "TYPE_INVALIDE"],
    ["outils", ["erp", "sap"], "OPTION_INCONNUE"],
    ["outils", ["erp", "crm", "bi"], "SELECTION_EXCESSIVE"],
    ["commentaire", 12, "TYPE_INVALIDE"],
    ["commentaire", "beaucoup trop long", "TROP_LONG"],
    ["effectif", "12", "TYPE_INVALIDE"],
    ["effectif", Number.NaN, "TYPE_INVALIDE"],
    ["effectif", 2.5, "NON_ENTIER"],
    ["effectif", -1, "HORS_BORNES"],
    ["effectif", 1001, "HORS_BORNES"],
    ["plan", "oui", "TYPE_INVALIDE"],
    ["creation", "06/10/2026", "DATE_INVALIDE"],
    ["creation", 20261006, "DATE_INVALIDE"],
    ["creation", "1949-12-31", "HORS_BORNES"],
    ["creation", "2027-01-01", "HORS_BORNES"],
  ] as const)("%s : %j est refusé (%s)", (id, valeur, code) => {
    const r = validerReponse(question(id), valeur);
    expect(r.valide).toBe(false);
    expect(r).toMatchObject({ code });
    expect((r as { message: string }).message.length).toBeGreaterThan(0);
  });

  it("applique le minimum de sélection et les bornes ouvertes", () => {
    const multiple: Question = {
      id: "m",
      type: "choix_multiple",
      libelle: "M",
      obligatoire: false,
      minSelections: 2,
      options: [
        { code: "a", libelle: "A" },
        { code: "b", libelle: "B" },
      ],
    };
    expect(validerReponse(multiple, ["a"])).toMatchObject({ code: "SELECTION_INSUFFISANTE" });
    expect(validerReponse(multiple, ["b", "a"])).toEqual({ valide: true, valeur: ["a", "b"] });
    const libre: Question = {
      id: "n",
      type: "numerique",
      libelle: "N",
      obligatoire: false,
      max: 10,
    };
    expect(validerReponse(libre, -1e9)).toEqual({ valide: true, valeur: -1e9 });
    expect(validerReponse(libre, 11)).toMatchObject({
      message: "La valeur doit être comprise entre −∞ et 10.",
    });
    const plancher: Question = {
      id: "n",
      type: "numerique",
      libelle: "N",
      obligatoire: false,
      min: 0,
    };
    expect(validerReponse(plancher, -1)).toMatchObject({
      message: "La valeur doit être comprise entre 0 et +∞.",
    });
    const date: Question = {
      id: "d",
      type: "date",
      libelle: "D",
      obligatoire: false,
      max: "2026-01-01",
    };
    expect(validerReponse(date, "2026-01-02")).toMatchObject({
      message: "La date doit être comprise entre … et 2026-01-01.",
    });
    const date2: Question = {
      id: "d",
      type: "date",
      libelle: "D",
      obligatoire: false,
      min: "2026-01-01",
    };
    expect(validerReponse(date2, "2025-12-31")).toMatchObject({
      message: "La date doit être comprise entre 2026-01-01 et ….",
    });
    const texte: Question = { id: "t", type: "texte", libelle: "T", obligatoire: false };
    expect(validerReponse(texte, "x".repeat(2_000))).toMatchObject({ valide: true });
    expect(validerReponse(texte, "x".repeat(2_001))).toMatchObject({ code: "TROP_LONG" });
  });
});

describe("outils de réponse", () => {
  it("ne lit jamais une propriété héritée du prototype", () => {
    const reponses = JSON.parse('{"__proto__": 3, "plan": true}') as Reponses;
    expect(lireReponse(reponses, "constructor")).toBeNull();
    expect(lireReponse(reponses, "toString")).toBeNull();
    expect(lireReponse(reponses, "plan")).toBe(true);
    expect(lireReponse({ plan: undefined }, "plan")).toBeNull();
  });

  it("reconnaît les réponses vides", () => {
    expect([null, undefined, "", " ", []].every(estVide)).toBe(true);
    expect([0, false, "a", ["a"]].some(estVide)).toBe(false);
  });
});

describe("questionsVisibles — logique conditionnelle", () => {
  it("sans réponse : seules les questions sans condition de la première section sont visibles", () => {
    expect(questionsVisibles(DEF, {})).toEqual(["plan", "commentaire"]);
  });

  it("dévoile les questions au fil des réponses", () => {
    expect(questionsVisibles(DEF, { plan: true })).toEqual([
      "plan",
      "horizon",
      "commentaire",
      "effectif",
    ]);
    expect(questionsVisibles(DEF, { plan: true, horizon: "cinq_ans", effectif: 20 })).toEqual([
      "plan",
      "horizon",
      "revue",
      "commentaire",
      "effectif",
      "outils",
      "creation",
    ]);
    expect(questionsVisibles(DEF, { plan: true, effectif: 60 })).toEqual([
      "plan",
      "horizon",
      "commentaire",
      "effectif",
      "outils",
    ]);
    expect(questionsVisibles(DEF, { plan: false, effectif: 60 })).toEqual([
      "plan",
      "commentaire",
      "effectif",
      "outils",
      "creation",
    ]);
  });

  it("masque en cascade : une réponse à une question invisible ne compte pas", () => {
    // horizon répondu mais plan = non : horizon invisible, donc revue aussi.
    expect(questionsVisibles(DEF, { plan: false, horizon: "cinq_ans" })).toEqual([
      "plan",
      "commentaire",
      "effectif",
      "creation",
    ]);
  });

  it("une réponse invalide compte comme vide pour les conditions", () => {
    expect(questionsVisibles(DEF, { plan: "oui" })).toEqual(["plan", "commentaire"]);
    expect(questionsVisibles(DEF, { plan: true, effectif: 12.5 })).toEqual([
      "plan",
      "horizon",
      "commentaire",
      "effectif",
    ]);
  });

  it("rend les réponses effectives normalisées des seules questions visibles", () => {
    const etat = etatQuestionnaire(DEF, {
      plan: false,
      horizon: "un_an",
      commentaire: " ok ",
      effectif: 3,
    });
    expect([...etat.valeurs.entries()]).toEqual([
      ["plan", false],
      ["commentaire", "ok"],
      ["effectif", 3],
    ]);
  });

  it("refuse d'évaluer une définition invalide", () => {
    const fautive = { ...DEF, sections: [] };
    expect(() => questionsVisibles(fautive, {})).toThrow(
      expect.objectContaining({ code: "DEFINITION_INVALIDE" }),
    );
  });

  it("evaluerCondition : sémantique des opérateurs", () => {
    const valeurs: Record<string, string | number | boolean | readonly string[] | null> = {
      choix: ["a", "b"],
      nombre: 5,
      date: "2026-10-06",
      vide: null,
      texte: "bonjour",
    };
    const lire = (id: string) => valeurs[id] ?? null;
    const v = (c: Parameters<typeof evaluerCondition>[0]) => evaluerCondition(c, lire);
    expect(v({ op: "egal", question: "choix", valeur: "a" })).toBe(true);
    expect(v({ op: "egal", question: "choix", valeur: "c" })).toBe(false);
    expect(v({ op: "different", question: "choix", valeur: "c" })).toBe(true);
    expect(v({ op: "different", question: "choix", valeur: "a" })).toBe(false);
    expect(v({ op: "dans", question: "choix", valeurs: ["c", "b"] })).toBe(true);
    expect(v({ op: "dans", question: "texte", valeurs: ["salut", "bonjour"] })).toBe(true);
    expect(v({ op: "superieur", question: "nombre", valeur: 5 })).toBe(false);
    expect(v({ op: "superieur", question: "nombre", valeur: 4 })).toBe(true);
    expect(v({ op: "inferieur", question: "nombre", valeur: 6 })).toBe(true);
    expect(v({ op: "superieur", question: "date", valeur: "2026-10-05" })).toBe(true);
    expect(v({ op: "inferieur", question: "date", valeur: "2026-10-06" })).toBe(false);
    expect(v({ op: "superieur", question: "texte", valeur: 1 })).toBe(false);
    // Comparaison sur une réponse vide : toujours fausse, sauf « vide ».
    expect(v({ op: "egal", question: "vide", valeur: 1 })).toBe(false);
    expect(v({ op: "different", question: "vide", valeur: 1 })).toBe(false);
    expect(v({ op: "vide", question: "vide" })).toBe(true);
    expect(v({ op: "non", condition: { op: "vide", question: "nombre" } })).toBe(true);
    expect(v({ op: "et", conditions: [] })).toBe(true);
    expect(v({ op: "ou", conditions: [] })).toBe(false);
  });
});

describe("validerReponses", () => {
  it("n'exige les obligatoires que si elles sont visibles", () => {
    const r = validerReponses(DEF, { plan: false, effectif: 4 });
    expect(r).toEqual({
      valide: true,
      reponses: { plan: false, effectif: 4 },
      erreurs: [],
      ecartees: [],
    });
  });

  it("signale les obligatoires visibles manquantes", () => {
    const r = validerReponses(DEF, { plan: true });
    expect(r.valide).toBe(false);
    expect(r.erreurs).toEqual([
      { code: "OBLIGATOIRE", chemin: "horizon", message: "Cette question est obligatoire." },
      { code: "OBLIGATOIRE", chemin: "effectif", message: "Cette question est obligatoire." },
    ]);
  });

  it("le mode brouillon contrôle les valeurs sans exiger les obligatoires", () => {
    expect(validerReponses(DEF, { plan: true }, "brouillon").valide).toBe(true);
    const r = validerReponses(DEF, { plan: true, effectif: -3 }, "brouillon");
    expect(r.erreurs).toEqual([
      {
        code: "HORS_BORNES",
        chemin: "effectif",
        message: "La valeur doit être comprise entre 0 et 1000.",
      },
    ]);
  });

  it("écarte les réponses aux questions invisibles ou inconnues", () => {
    const r = validerReponses(DEF, {
      plan: false,
      effectif: 5,
      revue: 4,
      horizon: "un_an",
      inconnue: 1,
      outils: [],
      constructor: 2,
    });
    expect(r.valide).toBe(true);
    expect(r.reponses).toEqual({ plan: false, effectif: 5 });
    expect(r.ecartees).toEqual([
      { question: "constructor", raison: "inconnue" },
      { question: "horizon", raison: "invisible" },
      { question: "inconnue", raison: "inconnue" },
      { question: "revue", raison: "invisible" },
    ]);
  });

  it("exigerReponsesValides rend le jeu nettoyé ou lève REPONSES_INVALIDES", () => {
    expect(exigerReponsesValides(DEF, { plan: false, effectif: 1, revue: 2 })).toEqual({
      plan: false,
      effectif: 1,
    });
    try {
      exigerReponsesValides(DEF, { plan: true });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurQuestionnaire);
      expect((e as ErreurQuestionnaire).code).toBe("REPONSES_INVALIDES");
      expect((e as ErreurQuestionnaire).details.map((d) => d.chemin)).toEqual([
        "horizon",
        "effectif",
      ]);
    }
  });
});

describe("progression", () => {
  it("compte les obligatoires visibles répondues, arrondi à l'inférieur", () => {
    expect(progression(DEF, {})).toEqual({
      questionsVisibles: 2,
      questionsRepondues: 0,
      obligatoiresVisibles: 1,
      obligatoiresRepondues: 0,
      pourcentage: 0,
      complet: false,
    });
    // plan, horizon, effectif obligatoires visibles ; 2 répondues sur 3 → 66 %.
    expect(progression(DEF, { plan: true, effectif: 3 })).toMatchObject({
      obligatoiresVisibles: 3,
      obligatoiresRepondues: 2,
      pourcentage: 66,
      complet: false,
    });
    expect(progression(DEF, { plan: false, effectif: 3, commentaire: "vu" })).toMatchObject({
      questionsVisibles: 4,
      questionsRepondues: 3,
      pourcentage: 100,
      complet: true,
    });
  });

  it("une réponse invalide ne fait pas progresser", () => {
    expect(progression(DEF, { plan: false, effectif: -1 }).obligatoiresRepondues).toBe(1);
  });

  it("vaut 100 % sans question obligatoire visible", () => {
    const facultatif = {
      id: "f",
      version: 1,
      titre: "F",
      sections: [
        {
          id: "s",
          titre: "S",
          questions: [{ id: "a", type: "oui_non", libelle: "A", obligatoire: false }],
        },
      ],
    } as const;
    expect(progression(facultatif, {})).toMatchObject({ pourcentage: 100, complet: true });
  });
});
