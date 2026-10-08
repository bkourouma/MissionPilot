import { describe, expect, it } from "vitest";
import {
  QUESTIONNAIRE_NOTATION_GENERIQUE,
  QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS,
} from "@missionpilot/shared";
import {
  ajouterQuestion,
  ajouterSection,
  ajusterNiveaux,
  ancreChemin,
  avecChamp,
  changerModele,
  changerOperateur,
  changerQuestionCible,
  cheminDepuisSegments,
  combinaisonPossible,
  decrireCondition,
  definitionVierge,
  deplacer,
  ESPACE_INSECABLE,
  deplacerQuestion,
  formaterReponse,
  identifiantLibre,
  libelleOperateur,
  localiserChemin,
  modeleDeQuestion,
  nouvelleOption,
  nouvelleQuestion,
  operateursPour,
  profondeurCondition,
  questionsParId,
  questionsReferencables,
  renommerQuestion,
  suggererIdentifiant,
  supprimerQuestion,
  supprimerSection,
  texteFacultatif,
  verifierForme,
  type Condition,
  type Definition,
  type Question,
} from "./questionnaires-definition";

const likert = nouvelleQuestion("likert", "engagement", "Les équipes sont engagées");
const choix: Question = {
  id: "secteur",
  type: "choix_unique",
  libelle: "Secteur",
  obligatoire: true,
  options: [
    { code: "industrie", libelle: "Industrie" },
    { code: "services", libelle: "Services" },
  ],
};
const multiple: Question = { ...choix, id: "canaux", type: "choix_multiple", libelle: "Canaux" };
const effectif: Question = {
  id: "effectif",
  type: "numerique",
  libelle: "Effectif",
  obligatoire: false,
  unite: "personnes",
  entier: true,
};
const ouiNon = nouvelleQuestion("oui_non", "plan", "Un plan est-il formalisé ?");

const def: Definition = {
  id: "diagnostic",
  version: 1,
  titre: "Diagnostic",
  sections: [
    { id: "s1", titre: "Profil", questions: [choix, effectif] },
    { id: "s2", titre: "Pratiques", questions: [likert, ouiNon, multiple] },
  ],
};
const index = questionsParId(def);

describe("gabarits fournis", () => {
  it("passent le contrôle de forme local", () => {
    expect(verifierForme(QUESTIONNAIRE_NOTATION_GENERIQUE)).toEqual([]);
    expect(verifierForme(QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS)).toEqual([]);
    expect(verifierForme(def)).toEqual([]);
  });

  it("la définition de départ d'un modèle vierge est conforme", () => {
    const v = definitionVierge("express", "Diagnostic express");
    expect(v).toMatchObject({ id: "express", version: 1, titre: "Diagnostic express" });
    expect(verifierForme(v)).toEqual([]);
  });
});

describe("identifiants", () => {
  it("suggère un identifiant sans accent ni espace", () => {
    expect(suggererIdentifiant("Plan d'action RH — été")).toBe("plan_d_action_rh_ete");
    expect(suggererIdentifiant("  !!  ")).toBe("");
    expect(suggererIdentifiant("a".repeat(60), 10)).toBe("aaaaaaaaaa");
  });

  it("trouve un identifiant libre", () => {
    expect(identifiantLibre("q1", new Set())).toBe("q1");
    expect(identifiantLibre("q1", new Set(["q1", "q1_2"]))).toBe("q1_3");
    expect(identifiantLibre("", new Set())).toBe("element");
  });
});

describe("questions", () => {
  it("crée chaque type avec des valeurs conformes au schéma", () => {
    for (const m of [
      "likert",
      "choix_unique",
      "choix_multiple",
      "oui_non",
      "pourcentage",
      "numerique",
      "texte",
      "date",
    ] as const) {
      const q = nouvelleQuestion(m, `q_${m}`, "Libellé");
      const d: Definition = { ...def, sections: [{ id: "s", titre: "S", questions: [q] }] };
      expect(verifierForme(d), m).toEqual([]);
      expect(modeleDeQuestion(q)).toBe(m);
    }
  });

  it("le pourcentage est une question numérique de 0 à 100 %", () => {
    expect(nouvelleQuestion("pourcentage", "p")).toMatchObject({
      type: "numerique",
      min: 0,
      max: 100,
      unite: "%",
    });
    expect(modeleDeQuestion({ ...effectif, unite: "%", min: 0, max: 100 })).toBe("pourcentage");
    expect(modeleDeQuestion({ ...effectif, unite: "%", min: 0 })).toBe("numerique");
  });

  it("change de type en gardant les champs communs et les options", () => {
    const avecCondition: Question = {
      ...choix,
      aide: "Aide",
      obligatoire: false,
      condition: { op: "vide", question: "effectif" },
    };
    const m = changerModele(avecCondition, "choix_multiple");
    expect(m).toMatchObject({
      id: "secteur",
      type: "choix_multiple",
      libelle: "Secteur",
      aide: "Aide",
      obligatoire: false,
      condition: { op: "vide", question: "effectif" },
      options: choix.type === "choix_unique" ? choix.options : [],
    });
    const t = changerModele(avecCondition, "texte");
    expect(t).not.toHaveProperty("options");
    expect(t).toMatchObject({ type: "texte", aide: "Aide" });
    expect(changerModele(choix, "choix_unique")).toBe(choix);
  });

  it("ajuste les niveaux d'une échelle", () => {
    expect(ajusterNiveaux(["A", "B", "C"], 2)).toEqual(["A", "B"]);
    expect(ajusterNiveaux(["A"], 3)).toEqual(["A", "Niveau 2", "Niveau 3"]);
    expect(ajusterNiveaux([], 20)).toHaveLength(10);
    expect(ajusterNiveaux([], 0)).toHaveLength(2);
  });

  it("ajoute une option au code libre", () => {
    if (choix.type !== "choix_unique") throw new Error("type");
    expect(nouvelleOption(choix.options)).toEqual({ code: "option_3", libelle: "Option 3" });
    expect(nouvelleOption([{ code: "option_2", libelle: "x" }])).toEqual({
      code: "option_2_2",
      libelle: "Option 2",
    });
  });

  it("retire un champ facultatif vidé", () => {
    expect(texteFacultatif("  ")).toBeUndefined();
    expect(texteFacultatif(" a ")).toBe(" a ");
    expect(avecChamp(likert, "aide", undefined)).not.toHaveProperty("aide");
    expect(avecChamp(likert, "aide", "x")).toMatchObject({ aide: "x" });
  });
});

describe("sections et listes", () => {
  it("ajoute une section avec une question aux identifiants libres", () => {
    const d = ajouterSection(def);
    expect(d.sections).toHaveLength(3);
    expect(d.sections[2]).toMatchObject({ id: "section_3", titre: "Section 3" });
    expect(d.sections[2]?.questions[0]?.id).toBe("q6");
    const q = ajouterQuestion(d, 0, "likert");
    expect(q.sections[0]?.questions.at(-1)).toMatchObject({ id: "q7", type: "likert" });
  });

  it("garde au moins une section et une question par section", () => {
    const une = definitionVierge("x", "X");
    expect(supprimerSection(une, 0)).toBe(une);
    expect(supprimerQuestion(une, 0, 0).sections[0]?.questions).toHaveLength(1);
    expect(supprimerSection(def, 0).sections.map((s) => s.id)).toEqual(["s2"]);
    expect(supprimerQuestion(def, 1, 0).sections[1]?.questions.map((q) => q.id)).toEqual([
      "plan",
      "canaux",
    ]);
  });

  it("renomme une question et les conditions qui la citent (sauf identifiant déjà pris)", () => {
    const avecConditions: Definition = {
      ...def,
      sections: [
        {
          ...def.sections[0]!,
          condition: { op: "non", condition: { op: "vide", question: "plan" } },
        },
        {
          ...def.sections[1]!,
          questions: [
            likert,
            ouiNon,
            {
              ...multiple,
              condition: { op: "et", conditions: [{ op: "egal", question: "plan", valeur: true }] },
            },
          ],
        },
      ],
    };
    const r = renommerQuestion(avecConditions, 1, 1, "plan_formalise");
    expect(r.sections[1]?.questions[1]?.id).toBe("plan_formalise");
    expect(r.sections[0]?.condition).toEqual({
      op: "non",
      condition: { op: "vide", question: "plan_formalise" },
    });
    expect(r.sections[1]?.questions[2]?.condition).toEqual({
      op: "et",
      conditions: [{ op: "egal", question: "plan_formalise", valeur: true }],
    });
    expect(r.sections[1]?.questions[0]).not.toHaveProperty("condition");
    const doublon = renommerQuestion(avecConditions, 1, 1, "secteur");
    expect(doublon.sections[1]?.questions[1]?.id).toBe("secteur");
    expect(doublon.sections[0]?.condition).toEqual(avecConditions.sections[0]?.condition);
    expect(renommerQuestion(avecConditions, 1, 1, "plan")).toBe(avecConditions);
    expect(renommerQuestion(avecConditions, 5, 0, "x")).toBe(avecConditions);
  });

  it("déplace sans effet aux extrémités", () => {
    expect(deplacer([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(deplacer([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    expect(deplacer([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(deplacerQuestion(def, 1, 0, 1).sections[1]?.questions.map((q) => q.id)).toEqual([
      "plan",
      "engagement",
      "canaux",
    ]);
  });
});

describe("conditions d'affichage", () => {
  it("propose les questions citables (jamais la question elle-même ni sa section)", () => {
    expect(
      questionsReferencables(def, { section: 1, question: 0 }).map((x) => x.question.id),
    ).toEqual(["secteur", "effectif", "plan", "canaux"]);
    expect(questionsReferencables(def, { section: 0 }).map((x) => x.repere)).toEqual([
      "S2 · Q1",
      "S2 · Q2",
      "S2 · Q3",
    ]);
  });

  it("n'offre que les opérateurs admis par le moteur selon le type", () => {
    expect(operateursPour(ouiNon)).toEqual(["egal", "different", "vide"]);
    expect(operateursPour(choix)).toEqual(["egal", "different", "dans", "vide"]);
    expect(operateursPour(likert)).toEqual([
      "egal",
      "different",
      "dans",
      "superieur",
      "inferieur",
      "vide",
    ]);
    expect(operateursPour(effectif)).toEqual([
      "egal",
      "different",
      "superieur",
      "inferieur",
      "vide",
    ]);
    expect(libelleOperateur("egal", multiple)).toBe("contient");
    expect(libelleOperateur("superieur", nouvelleQuestion("date", "d"))).toBe("est postérieure au");
  });

  it("change d'opérateur en gardant la condition courante", () => {
    const base: Condition = { op: "egal", question: "secteur", valeur: "services" };
    const et = changerOperateur(base, "et", index, choix);
    expect(et).toEqual({ op: "et", conditions: [base] });
    expect(changerOperateur(et, "ou", index, choix)).toEqual({ op: "ou", conditions: [base] });
    expect(changerOperateur(base, "non", index, choix)).toEqual({ op: "non", condition: base });
    expect(changerOperateur({ op: "non", condition: base }, "et", index, choix)).toEqual({
      op: "et",
      conditions: [base],
    });
    expect(changerOperateur(et, "dans", index, choix)).toEqual({
      op: "dans",
      question: "secteur",
      valeurs: ["services"],
    });
    expect(changerOperateur(base, "vide", index, choix)).toEqual({
      op: "vide",
      question: "secteur",
    });
    expect(
      changerOperateur(
        { op: "dans", question: "engagement", valeurs: [4] },
        "superieur",
        index,
        choix,
      ),
    ).toEqual({
      op: "superieur",
      question: "engagement",
      valeur: 4,
    });
    expect(
      changerOperateur({ op: "egal", question: "plan", valeur: true }, "superieur", index, choix),
    ).toEqual({
      op: "superieur",
      question: "plan",
      valeur: 0,
    });
    expect(changerOperateur({ op: "et", conditions: [] }, "egal", index, choix)).toEqual({
      op: "egal",
      question: "secteur",
      valeur: "industrie",
    });
    expect(changerOperateur(base, "egal", index, choix)).toBe(base);
  });

  it("change la question citée avec une valeur compatible", () => {
    const c: Condition = { op: "superieur", question: "effectif", valeur: 50 };
    expect(changerQuestionCible(c, ouiNon)).toEqual({ op: "egal", question: "plan", valeur: true });
    expect(changerQuestionCible(c, likert)).toEqual({
      op: "superieur",
      question: "engagement",
      valeur: 1,
    });
    expect(
      changerQuestionCible({ op: "dans", question: "secteur", valeurs: ["services"] }, multiple),
    ).toEqual({
      op: "dans",
      question: "canaux",
      valeurs: ["industrie"],
    });
    expect(changerQuestionCible({ op: "vide", question: "secteur" }, effectif)).toEqual({
      op: "vide",
      question: "effectif",
    });
  });

  it("mesure la profondeur comme le moteur et borne les combinaisons à 5 niveaux", () => {
    const feuille: Condition = { op: "vide", question: "secteur" };
    let c: Condition = feuille;
    expect(profondeurCondition(c)).toBe(1);
    for (let i = 0; i < 4; i++) c = { op: "non", condition: c };
    expect(profondeurCondition(c)).toBe(5);
    expect(
      profondeurCondition({ op: "et", conditions: [feuille, { op: "ou", conditions: [feuille] }] }),
    ).toBe(3);
    expect(combinaisonPossible(4)).toBe(true);
    expect(combinaisonPossible(5)).toBe(false);
  });

  it("décrit une condition en clair", () => {
    const c: Condition = {
      op: "et",
      conditions: [
        { op: "superieur", question: "effectif", valeur: 50 },
        {
          op: "ou",
          conditions: [
            { op: "dans", question: "secteur", valeurs: ["industrie", "services"] },
            { op: "vide", question: "plan" },
          ],
        },
        { op: "non", condition: { op: "egal", question: "engagement", valeur: 5 } },
        { op: "egal", question: "canaux", valeur: "services" },
        { op: "egal", question: "disparue", valeur: true },
      ],
    };
    expect(decrireCondition(c, index)).toBe(
      `« Effectif » est supérieure à 50${ESPACE_INSECABLE}personnes et ` +
        "(« Secteur » est l'une des valeurs : Industrie, Services ou « Un plan est-il formalisé ? » est sans réponse) et (non (« Les équipes sont engagées » est égale à Tout à fait d'accord (5))) et « Canaux » contient Services et « disparue » (question inconnue) est égale à Oui",
    );
  });
});

describe("contrôle de forme et localisation", () => {
  it("signale en français, au chemin du moteur, les champs vides et les identifiants invalides", () => {
    const fautive: Definition = {
      ...def,
      titre: " ",
      sections: [
        {
          id: "S 1",
          titre: "Profil",
          questions: [{ ...choix, libelle: "", options: [{ code: "seul", libelle: "Seul" }] }],
        },
      ],
    };
    const a = verifierForme(fautive);
    expect(a).toEqual(
      expect.arrayContaining([
        { code: "LIBELLE_VIDE", chemin: "titre", message: "Ce texte est obligatoire." },
        expect.objectContaining({ code: "IDENTIFIANT_INVALIDE", chemin: "sections[0].id" }),
        {
          code: "LIBELLE_VIDE",
          chemin: "sections[0].questions[0].libelle",
          message: "Ce texte est obligatoire.",
        },
        {
          code: "OPTIONS_INSUFFISANTES",
          chemin: "sections[0].questions[0].options",
          message: "Au moins deux options sont attendues.",
        },
      ]),
    );
    expect(a.every((x) => !/String|must|Expected/.test(x.message))).toBe(true);
  });

  it("signale une échelle hors bornes et une date mal formée", () => {
    const d: Definition = {
      ...def,
      sections: [
        {
          id: "s",
          titre: "S",
          questions: [
            { ...likert, points: 11 } as Question,
            { id: "d", type: "date", libelle: "Date", obligatoire: true, min: "2026-13-01" },
          ],
        },
      ],
    };
    const codes = verifierForme(d).map((x) => `${x.code}@${x.chemin}`);
    expect(codes).toContain("VALEUR_HORS_BORNES@sections[0].questions[0].points");
    expect(codes.some((c) => c.endsWith("@sections[0].questions[1].min"))).toBe(true);
  });

  it("convertit un chemin de segments et localise un chemin du moteur", () => {
    expect(
      cheminDepuisSegments(["sections", 0, "questions", 2, "condition", "conditions", 1]),
    ).toBe("sections[0].questions[2].condition.conditions[1]");
    expect(cheminDepuisSegments([])).toBe("");
    expect(localiserChemin("sections[1].questions[0].condition.conditions[2]", def)).toBe(
      "Section 2 « Pratiques » › Question 1 « Les équipes sont engagées » › condition d'affichage › élément 3",
    );
    expect(localiserChemin("sections[0].questions[0].options[1].code", def)).toBe(
      "Section 1 « Profil » › Question 1 « Secteur » › option 2 › code",
    );
    expect(localiserChemin("", def)).toBe("Questionnaire");
    expect(localiserChemin("titre", null)).toBe("titre");
    expect(localiserChemin("sections[9].questions[3]", def)).toBe("Section 10 › Question 4");
    expect(localiserChemin("sections[1].questions[0].libelles[4]", def)).toContain(
      "libellé du niveau 5",
    );
  });

  it("donne l'ancre de la section ou de la question en cause", () => {
    expect(ancreChemin("sections[1].questions[3].condition")).toBe("qe-s1-q3");
    expect(ancreChemin("sections[2].condition")).toBe("qe-s2");
    expect(ancreChemin("titre")).toBeNull();
  });
});

describe("réponses soumises", () => {
  it("met en forme chaque type de réponse", () => {
    expect(formaterReponse(likert, 4)).toBe("Plutôt d'accord (4)");
    expect(formaterReponse(choix, "services")).toBe("Services");
    expect(formaterReponse(multiple, ["industrie", "inconnu"])).toBe("Industrie, inconnu");
    expect(formaterReponse(ouiNon, false)).toBe("Non");
    expect(formaterReponse(effectif, 1500)).toBe(
      `1${String.fromCharCode(0x202f)}500${ESPACE_INSECABLE}personnes`,
    );
    expect(formaterReponse(nouvelleQuestion("date", "d"), "2027-01-12")).toBe("12 janv. 2027");
    expect(formaterReponse(nouvelleQuestion("texte", "t"), "Ligne 1\nLigne 2")).toBe(
      "Ligne 1\nLigne 2",
    );
  });

  it("rend « sans réponse » (null) pour une valeur vide, et une valeur inattendue telle quelle", () => {
    for (const v of [null, undefined, "", "  ", []]) expect(formaterReponse(choix, v)).toBeNull();
    expect(formaterReponse(ouiNon, "peut-être")).toBe("peut-être");
    expect(formaterReponse(likert, "3")).toBe("3");
  });
});
