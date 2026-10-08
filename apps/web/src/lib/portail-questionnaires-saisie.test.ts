import { describe, expect, it } from "vitest";
import type { DefinitionQuestionnaireDonnees, QuestionQuestionnaire } from "@missionpilot/shared";
import {
  aideChamp,
  chargeBrouillon,
  compteurCaracteres,
  ecartVisibilite,
  egales,
  erreursAvantEnvoi,
  estVideCharge,
  evaluerCondition,
  idBlocQuestion,
  idsQuestions,
  lireSaisie,
  MESSAGE_CONFLIT,
  possede,
  propre,
  questionsDe,
  questionsVisibles,
  reconcilier,
  saisiesInitiales,
  valeursEffectives,
  versSaisie,
  visiblesDepuisSaisies,
  type Saisies,
} from "./portail-questionnaires-saisie";

const NIVEAUX = ["Inexistant", "Ponctuel", "En place", "Systématique", "Mesuré et amélioré"];

const DEF: DefinitionQuestionnaireDonnees = {
  id: "preliminaire",
  version: 1,
  titre: "Questionnaire préliminaire",
  sections: [
    {
      id: "profil",
      titre: "Votre profil",
      questions: [
        {
          id: "prof.fonction",
          type: "texte",
          libelle: "Votre fonction",
          obligatoire: true,
          longueurMax: 20,
        },
        {
          id: "prof.effectif",
          type: "numerique",
          libelle: "Effectif",
          obligatoire: false,
          min: 0,
          entier: true,
        },
      ],
    },
    {
      id: "strat",
      titre: "Stratégie",
      questions: [
        { id: "strat.plan", type: "oui_non", libelle: "Plan formalisé ?", obligatoire: true },
        {
          id: "strat.horizon",
          type: "choix_unique",
          libelle: "Horizon du plan",
          obligatoire: true,
          options: [
            { code: "un_an", libelle: "Un an" },
            { code: "trois_ans", libelle: "Trois ans" },
          ],
          condition: { op: "egal", question: "strat.plan", valeur: true },
        },
        {
          id: "strat.revue",
          type: "likert",
          libelle: "Revue du plan",
          obligatoire: true,
          points: 5,
          libelles: NIVEAUX,
          condition: { op: "egal", question: "strat.horizon", valeur: "trois_ans" },
        },
      ],
    },
    {
      id: "export",
      titre: "Export",
      condition: { op: "superieur", question: "prof.effectif", valeur: 10 },
      questions: [
        {
          id: "exp.part",
          type: "numerique",
          libelle: "Part du chiffre d'affaires à l'export",
          obligatoire: false,
          min: 0,
          max: 100,
          unite: "%",
        },
        {
          id: "exp.marches",
          type: "choix_multiple",
          libelle: "Marchés visés",
          obligatoire: true,
          options: [
            { code: "uemoa", libelle: "UEMOA" },
            { code: "cemac", libelle: "CEMAC" },
            { code: "europe", libelle: "Europe" },
          ],
          maxSelections: 2,
        },
        {
          id: "exp.debut",
          type: "date",
          libelle: "Début de l'export",
          obligatoire: false,
          min: "2000-01-01",
          max: "2030-12-31",
        },
      ],
    },
  ],
};

const Q = Object.fromEntries(questionsDe(DEF).map((q) => [q.id, q])) as Record<
  string,
  QuestionQuestionnaire
>;
const q = (id: string) => Q[id] as QuestionQuestionnaire;
const visibles = (s: Saisies) => [...visiblesDepuisSaisies(DEF, s)];

describe("lecture des champs", () => {
  it("likert, choix unique et oui/non : valeur choisie, vide sinon", () => {
    expect(lireSaisie(q("strat.revue"), 4)).toEqual({ ok: true, valeur: 4 });
    expect(lireSaisie(q("strat.revue"), 6)).toMatchObject({ ok: false });
    expect(lireSaisie(q("strat.revue"), null)).toEqual({ ok: true, valeur: null });
    expect(lireSaisie(q("strat.horizon"), "trois_ans")).toEqual({ ok: true, valeur: "trois_ans" });
    expect(lireSaisie(q("strat.horizon"), "dix_ans")).toMatchObject({ ok: false });
    expect(lireSaisie(q("strat.horizon"), "")).toEqual({ ok: true, valeur: null });
    expect(lireSaisie(q("strat.plan"), false)).toEqual({ ok: true, valeur: false });
    expect(lireSaisie(q("strat.plan"), undefined)).toEqual({ ok: true, valeur: null });
  });

  it("nombre à la française, entier, bornes et unité dans le message", () => {
    const part = q("exp.part");
    expect(lireSaisie(part, "12,5")).toEqual({ ok: true, valeur: 12.5 });
    expect(lireSaisie(part, " ")).toEqual({ ok: true, valeur: null });
    expect(lireSaisie(part, "abc")).toEqual({
      ok: false,
      message: "Saisissez un nombre, par exemple 12 ou 12,5.",
    });
    expect(lireSaisie(part, "120")).toEqual({
      ok: false,
      message: "La valeur doit être comprise entre 0 et 100\u00a0%.",
    });
    expect(lireSaisie(q("prof.effectif"), "1 250")).toEqual({ ok: true, valeur: 1250 });
    expect(lireSaisie(q("prof.effectif"), "12,5")).toEqual({
      ok: false,
      message: "Saisissez un nombre entier, sans décimale.",
    });
    expect(lireSaisie(q("prof.effectif"), "-1")).toEqual({
      ok: false,
      message: "La valeur doit être d'au moins 0.",
    });
  });

  it("texte nettoyé et borné ; date réelle et bornée", () => {
    expect(lireSaisie(q("prof.fonction"), "  DAF  ")).toEqual({ ok: true, valeur: "DAF" });
    expect(lireSaisie(q("prof.fonction"), "   ")).toEqual({ ok: true, valeur: null });
    expect(lireSaisie(q("prof.fonction"), "x".repeat(21))).toEqual({
      ok: false,
      message: "20 caractères au plus (actuellement 21).",
    });
    expect(lireSaisie(q("exp.debut"), "2027-02-28")).toEqual({ ok: true, valeur: "2027-02-28" });
    expect(lireSaisie(q("exp.debut"), "2027-02-30")).toMatchObject({ ok: false });
    expect(lireSaisie(q("exp.debut"), "1999-12-31")).toEqual({
      ok: false,
      message: "La date doit être comprise entre le 1 janv. 2000 et le 31 déc. 2030.",
    });
  });

  it("choix multiple : ordre des options, dédoublonné, nombre de choix borné", () => {
    const m = q("exp.marches");
    expect(lireSaisie(m, ["europe", "uemoa", "europe"])).toEqual({
      ok: true,
      valeur: ["uemoa", "europe"],
    });
    expect(lireSaisie(m, [])).toEqual({ ok: true, valeur: null });
    expect(lireSaisie(m, ["uemoa", "cemac", "europe"])).toEqual({
      ok: false,
      message: "Cochez au plus 2 choix.",
    });
    expect(lireSaisie(m, ["asie"])).toMatchObject({ ok: false });
  });

  it("aller-retour entre réponses du serveur et champs", () => {
    expect(versSaisie(q("exp.part"), 12.5)).toBe("12,5");
    expect(lireSaisie(q("exp.part"), versSaisie(q("exp.part"), 12.5))).toEqual({
      ok: true,
      valeur: 12.5,
    });
    expect(versSaisie(q("strat.plan"), "oui")).toBeNull();
    expect(versSaisie(q("exp.marches"), "uemoa")).toEqual([]);
    expect(saisiesInitiales(DEF, { "strat.plan": true, inconnue: 3 })).toEqual({
      "strat.plan": true,
    });
  });

  it("égalité des réponses, listes comprises", () => {
    expect(egales(["a", "b"], ["a", "b"])).toBe(true);
    expect(egales(["a"], ["a", "b"])).toBe(false);
    expect(egales(null, undefined)).toBe(true);
    expect(egales(["a"], "a")).toBe(false);
    expect(egales(1, 1)).toBe(true);
  });
});

describe("affichage conditionnel", () => {
  it("cascade : masquer une question masque celles qui en dépendent", () => {
    const base: Saisies = { "strat.plan": true, "strat.horizon": "trois_ans", "strat.revue": 3 };
    expect(visibles(base)).toEqual([
      "prof.fonction",
      "prof.effectif",
      "strat.plan",
      "strat.horizon",
      "strat.revue",
    ]);
    // Plan non formalisé : l'horizon est masqué, donc la revue aussi malgré sa valeur.
    expect(visibles({ ...base, "strat.plan": false })).toEqual([
      "prof.fonction",
      "prof.effectif",
      "strat.plan",
    ]);
  });

  it("condition de section ; une valeur invalide compte comme vide", () => {
    expect(visibles({ "prof.effectif": "12" })).toContain("exp.marches");
    expect(visibles({ "prof.effectif": "8" })).not.toContain("exp.part");
    expect(visibles({ "prof.effectif": "12,5" })).not.toContain("exp.part");
    expect(visibles({ "prof.effectif": "douze" })).not.toContain("exp.part");
  });

  it("opérateurs : vide, non, dans (choix multiple), différent sur réponse vide", () => {
    const lire = (v: Record<string, string | number | boolean | string[]>) => (id: string) =>
      v[id] ?? null;
    expect(evaluerCondition({ op: "vide", question: "a" }, lire({}))).toBe(true);
    expect(
      evaluerCondition({ op: "non", condition: { op: "vide", question: "a" } }, lire({ a: 1 })),
    ).toBe(true);
    expect(
      evaluerCondition({ op: "dans", question: "m", valeurs: ["x", "y"] }, lire({ m: ["z", "y"] })),
    ).toBe(true);
    expect(evaluerCondition({ op: "egal", question: "m", valeur: "z" }, lire({ m: ["z"] }))).toBe(
      true,
    );
    expect(evaluerCondition({ op: "different", question: "a", valeur: 1 }, lire({}))).toBe(false);
    expect(evaluerCondition({ op: "superieur", question: "a", valeur: 3 }, lire({ a: "4" }))).toBe(
      false,
    );
    expect(
      evaluerCondition(
        { op: "inferieur", question: "d", valeur: "2027-01-01" },
        lire({ d: "2026-06-30" }),
      ),
    ).toBe(true);
    expect(
      evaluerCondition(
        {
          op: "ou",
          conditions: [
            { op: "vide", question: "a" },
            { op: "egal", question: "b", valeur: true },
          ],
        },
        lire({ a: 2, b: true }),
      ),
    ).toBe(true);
    expect(
      evaluerCondition(
        {
          op: "et",
          conditions: [
            { op: "vide", question: "a" },
            { op: "egal", question: "b", valeur: true },
          ],
        },
        lire({ a: 2, b: true }),
      ),
    ).toBe(false);
  });

  it("une définition cyclique (refusée par l'API) ne fait pas boucler l'évaluation", () => {
    const cycle: DefinitionQuestionnaireDonnees = {
      id: "cycle",
      version: 1,
      titre: "Cycle",
      sections: [
        {
          id: "s",
          titre: "S",
          questions: [
            {
              id: "a",
              type: "oui_non",
              libelle: "A",
              obligatoire: false,
              condition: { op: "vide", question: "b" },
            },
            {
              id: "b",
              type: "oui_non",
              libelle: "B",
              obligatoire: false,
              condition: { op: "vide", question: "a" },
            },
            { id: "c", type: "oui_non", libelle: "C", obligatoire: false },
          ],
        },
      ],
    };
    expect(questionsVisibles(cycle, new Map()).has("c")).toBe(true);
  });

  it("réponses effectives et écart de visibilité", () => {
    expect([...valeursEffectives(DEF, { "prof.effectif": "abc", "strat.plan": true })]).toEqual([
      ["strat.plan", true],
    ]);
    expect(ecartVisibilite(new Set(["a", "b"]), new Set(["b", "c", "d"]))).toEqual({
      apparues: 2,
      masquees: 1,
    });
  });
});

describe("brouillon à envoyer", () => {
  it("seules les questions visibles modifiées partent ; vide = effacement ; invalides signalées", () => {
    const base = { "strat.plan": true, "prof.fonction": "DAF" };
    const saisies: Saisies = {
      "prof.fonction": "DAF ",
      "prof.effectif": "douze",
      "strat.plan": true,
      "strat.horizon": "un_an",
      "exp.part": "40",
    };
    const c = chargeBrouillon(DEF, saisies, base);
    expect(c.reponses).toEqual({ "strat.horizon": "un_an" });
    expect(c.invalides).toEqual(["prof.effectif"]);
    expect(chargeBrouillon(DEF, { ...saisies, "prof.fonction": "" }, base).reponses).toMatchObject({
      "prof.fonction": null,
    });
  });

  it("questions exclues (refus du serveur, conflit) non envoyées", () => {
    const c = chargeBrouillon(DEF, { "strat.plan": false }, {}, new Set(["strat.plan"]));
    expect(estVideCharge(c)).toBe(true);
  });
});

describe("réconciliation avec le serveur", () => {
  const etat = (saisies: Saisies, base: Record<string, string | number | boolean | string[]>) => ({
    saisies,
    base,
  });

  it("question envoyée inchangée : la valeur normalisée du serveur est reprise", () => {
    const r = reconcilier(
      DEF,
      etat({ "exp.marches": ["europe", "uemoa"] }, {}),
      { "exp.marches": ["uemoa", "europe"] },
      { "exp.marches": ["uemoa", "europe"] },
      false,
    );
    expect(r.saisies["exp.marches"]).toEqual(["europe", "uemoa"]);
    expect(r.base).toEqual({ "exp.marches": ["uemoa", "europe"] });
  });

  it("saisie faite pendant l'échange : gardée", () => {
    const r = reconcilier(
      DEF,
      etat({ "prof.fonction": "Directeur fin" }, {}),
      { "prof.fonction": "Directeur" },
      { "prof.fonction": "Directeur" },
      true,
    );
    expect(r.saisies["prof.fonction"]).toBe("Directeur fin");
    expect(r.misesAJour).toEqual([]);
    expect(r.conflits).toEqual({});
  });

  it("collectif : réponse d'un collègue reprise si non touchée ici, conflit sinon", () => {
    const r = reconcilier(
      DEF,
      etat({ "strat.plan": true, "prof.fonction": "DG" }, { "strat.plan": true }),
      {},
      { "strat.plan": false, "prof.fonction": "DAF", "exp.part": 30 },
      true,
    );
    expect(r.saisies["strat.plan"]).toBe(false);
    expect(r.saisies["exp.part"]).toBe("30");
    expect(r.misesAJour).toEqual(["strat.plan", "exp.part"]);
    expect(r.conflits).toEqual({ "prof.fonction": "DAF" });
  });

  it("individuel : une réponse masquée écartée par le serveur est effacée, sans annonce", () => {
    const r = reconcilier(
      DEF,
      etat({ "strat.plan": false, "strat.horizon": "un_an" }, { "strat.horizon": "un_an" }),
      { "strat.plan": false },
      { "strat.plan": false },
      false,
    );
    expect(r.saisies["strat.horizon"]).toBeNull();
    expect(r.misesAJour).toEqual([]);
  });
});

describe("contrôle avant l'envoi", () => {
  it("obligatoires visibles, valeurs invalides et conflits, dans l'ordre du questionnaire", () => {
    const erreurs = erreursAvantEnvoi(
      DEF,
      { "prof.effectif": "50", "strat.plan": true, "exp.marches": ["uemoa", "cemac", "europe"] },
      { "strat.plan": false },
    );
    expect(erreurs).toEqual([
      { id: "prof.fonction", message: "Cette question est obligatoire : renseignez une réponse." },
      { id: "strat.plan", message: MESSAGE_CONFLIT },
      {
        id: "strat.horizon",
        message: "Cette question est obligatoire : choisissez une réponse.",
      },
      { id: "exp.marches", message: "Cochez au plus 2 choix." },
    ]);
  });

  it("une question masquée n'est pas exigée", () => {
    expect(
      erreursAvantEnvoi(DEF, { "prof.fonction": "DG", "strat.plan": false }).map((e) => e.id),
    ).toEqual([]);
  });
});

describe("aides d'affichage", () => {
  it("aide d'après la question", () => {
    expect(aideChamp(q("exp.marches"))).toBe("Cochez 2 choix au plus.");
    expect(aideChamp(q("exp.part"))).toBe("Entre 0 et 100\u00a0%.");
    expect(aideChamp(q("prof.effectif"))).toBe("Au moins 0.");
    expect(aideChamp(q("exp.debut"))).toBe("Entre le 1 janv. 2000 et le 31 déc. 2030.");
    expect(aideChamp(q("strat.plan"))).toBeNull();
  });

  it("compteur de caractères, identifiants", () => {
    expect(compteurCaracteres(" ab ", 2000)).toBe("2 caractères sur 2\u202f000");
    expect(compteurCaracteres("", 120)).toBe("0 caractère sur 120");
    expect(idBlocQuestion("strat.plan")).toBe("mp-pq-strat.plan");
    expect(idsQuestions(DEF).has("exp.debut")).toBe(true);
  });
});

describe("identifiants de question", () => {
  it("« constructor » est un identifiant valide : jamais de propriété héritée", () => {
    const def: DefinitionQuestionnaireDonnees = {
      id: "proto",
      version: 1,
      titre: "Proto",
      sections: [
        {
          id: "s",
          titre: "S",
          questions: [{ id: "constructor", type: "texte", libelle: "C", obligatoire: true }],
        },
      ],
    };
    expect(propre({}, "constructor")).toBeUndefined();
    expect(possede({}, "constructor")).toBe(false);
    expect(chargeBrouillon(def, {}, {}).reponses).toEqual({});
    expect(saisiesInitiales(def, {})).toEqual({});
    expect(erreursAvantEnvoi(def, {}).map((e) => e.id)).toEqual(["constructor"]);
    expect(reconcilier(def, { saisies: {}, base: {} }, {}, {}, true).conflits).toEqual({});
  });
});
