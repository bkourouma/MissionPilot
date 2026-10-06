import { describe, expect, it } from "vitest";
import {
  creerReponseCollective,
  fusionnerReponses,
  soumettreReponses,
  validerRepondants,
} from "./collectif";
import { ErreurQuestionnaire } from "./erreurs";
import { DEF } from "./fixtures.test-utils";
import { SEUIL_ECART_DEFAUT, detecterEcarts } from "./incoherences";

const erreur = (code: string) => expect.objectContaining({ code });

describe("validerRepondants (modes de réponse)", () => {
  it("exige une fonction par répondant en mode par fonction", () => {
    expect(() =>
      validerRepondants("par_fonction", [
        { id: "u1", fonction: "DAF" },
        { id: "u2", fonction: "  " },
      ]),
    ).toThrow(erreur("FONCTION_OBLIGATOIRE"));
    expect(() => validerRepondants("par_fonction", [{ id: "u1" }])).toThrow(
      erreur("FONCTION_OBLIGATOIRE"),
    );
    expect(
      validerRepondants("par_fonction", [
        { id: "u1", fonction: " Directeur financier ", role: "dirigeant" },
        { id: "u2", fonction: "RH" },
      ]),
    ).toEqual([
      { id: "u1", fonction: "Directeur financier", role: "dirigeant" },
      { id: "u2", fonction: "RH" },
    ]);
  });

  it("n'exige pas de fonction en mode individuel ou collectif", () => {
    expect(
      validerRepondants("individuel", [
        { id: "u1", role: "contributeur" },
        { id: "u2", fonction: "" },
      ]),
    ).toEqual([{ id: "u1", role: "contributeur" }, { id: "u2" }]);
    expect(validerRepondants("collectif", [{ id: "u1", fonction: "DG" }])).toEqual([
      { id: "u1", fonction: "DG" },
    ]);
  });

  it("refuse une liste vide, un identifiant vide ou en double", () => {
    expect(() => validerRepondants("individuel", [])).toThrow(erreur("REPONDANT_INVALIDE"));
    expect(() => validerRepondants("individuel", [{ id: " " }])).toThrow(
      erreur("REPONDANT_INVALIDE"),
    );
    expect(() => validerRepondants("individuel", [{ id: "a" }, { id: "a" }])).toThrow(
      erreur("REPONDANT_INVALIDE"),
    );
  });
});

describe("réponse collective verrouillée à la première soumission", () => {
  const brouillon = () =>
    fusionnerReponses(DEF, creerReponseCollective(), {
      auteur: "u1",
      date: "2026-10-06",
      reponses: { plan: true, horizon: "trois_ans" },
    });

  it("fusionne les contributions : la dernière saisie l'emporte, une valeur vide efface", () => {
    const e1 = brouillon();
    const e2 = fusionnerReponses(DEF, e1, {
      auteur: "u2",
      date: "2026-10-07",
      reponses: { horizon: "cinq_ans", commentaire: "  vu  ", effectif: 12 },
    });
    const e3 = fusionnerReponses(DEF, e2, {
      auteur: "u1",
      date: "2026-10-08",
      reponses: { commentaire: null },
    });
    expect(e3.statut).toBe("brouillon");
    expect(e3.reponses).toEqual({ plan: true, horizon: "cinq_ans", effectif: 12 });
    expect(e3.saisies).toEqual({
      plan: { auteur: "u1", date: "2026-10-06" },
      horizon: { auteur: "u2", date: "2026-10-07" },
      effectif: { auteur: "u2", date: "2026-10-07" },
    });
    // Les états précédents restent intacts et figés.
    expect(e1.reponses).toEqual({ plan: true, horizon: "trois_ans" });
    expect(e2.reponses).toMatchObject({ commentaire: "vu" });
    expect(Object.isFrozen(e3)).toBe(true);
    expect(Object.isFrozen(e3.reponses)).toBe(true);
    expect(Object.isFrozen(e3.saisies)).toBe(true);
  });

  it("refuse toute la contribution si une valeur est invalide ou une question inconnue", () => {
    try {
      fusionnerReponses(DEF, brouillon(), {
        auteur: "u2",
        date: "2026-10-07",
        reponses: { effectif: -5, fantome: 1, plan: false },
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurQuestionnaire);
      expect((e as ErreurQuestionnaire).code).toBe("REPONSES_INVALIDES");
      expect((e as ErreurQuestionnaire).details.map((d) => [d.chemin, d.code])).toEqual([
        ["effectif", "HORS_BORNES"],
        ["fantome", "QUESTION_INCONNUE"],
      ]);
    }
  });

  it("exige un auteur et une date valide", () => {
    const vierge = creerReponseCollective();
    expect(() =>
      fusionnerReponses(DEF, vierge, { auteur: " ", date: "2026-10-06", reponses: {} }),
    ).toThrow(erreur("REPONDANT_INVALIDE"));
    expect(() =>
      fusionnerReponses(DEF, vierge, { auteur: "u1", date: "2026-02-30", reponses: {} }),
    ).toThrow(erreur("OPTIONS_INVALIDES"));
  });

  it("soumet un jeu complet, écarte les réponses devenues invisibles et verrouille", () => {
    const e = fusionnerReponses(DEF, brouillon(), {
      auteur: "u2",
      date: "2026-10-07",
      reponses: { plan: false, effectif: 4 },
    });
    // plan = non : horizon devient invisible et sort de la réponse soumise.
    const soumise = soumettreReponses(DEF, e, { auteur: "u2", date: "2026-10-07" });
    expect(soumise.statut).toBe("soumise");
    expect(soumise.reponses).toEqual({ plan: false, effectif: 4 });
    expect(soumise.saisies).toEqual({
      plan: { auteur: "u2", date: "2026-10-07" },
      effectif: { auteur: "u2", date: "2026-10-07" },
    });
    expect(soumise.soumission).toEqual({ auteur: "u2", date: "2026-10-07" });
    expect(Object.isFrozen(soumise.soumission)).toBe(true);

    // Seconde soumission et toute modification ultérieure : refusées.
    expect(() => soumettreReponses(DEF, soumise, { auteur: "u1", date: "2026-10-08" })).toThrow(
      erreur("DEJA_SOUMISE"),
    );
    expect(() =>
      fusionnerReponses(DEF, soumise, {
        auteur: "u1",
        date: "2026-10-08",
        reponses: { plan: true },
      }),
    ).toThrow(erreur("DEJA_SOUMISE"));
  });

  it("refuse de soumettre un jeu incomplet sans verrouiller", () => {
    const e = brouillon();
    expect(() => soumettreReponses(DEF, e, { auteur: "u1", date: "2026-10-06" })).toThrow(
      erreur("REPONSES_INVALIDES"),
    );
    expect(e.statut).toBe("brouillon");
    expect(() => soumettreReponses(DEF, e, { auteur: "", date: "2026-10-06" })).toThrow(
      erreur("REPONDANT_INVALIDE"),
    );
  });
});

describe("detecterEcarts (NOT-05, partie déterministe)", () => {
  const base = { plan: true, horizon: "cinq_ans" };
  const jeux = [
    { repondant: "dg", reponses: { ...base, revue: 5 } },
    { repondant: "daf", reponses: { ...base, revue: 2 } },
    { repondant: "rh", reponses: { ...base, revue: 5 } },
    { repondant: "dsi", reponses: { plan: false, revue: 1 } }, // revue invisible pour lui
  ];

  it("signale un écart supérieur ou égal au seuil (2 par défaut)", () => {
    expect(SEUIL_ECART_DEFAUT).toBe(2);
    expect(detecterEcarts(DEF, jeux)).toEqual([
      {
        question: "revue",
        libelle: "Le plan est-il revu ?",
        min: 2,
        max: 5,
        ecart: 3,
        repondantsMin: ["daf"],
        repondantsMax: ["dg", "rh"],
        nombreRepondants: 3,
      },
    ]);
    expect(detecterEcarts(DEF, jeux, { seuil: 3 })).toHaveLength(1);
    expect(detecterEcarts(DEF, jeux, { seuil: 4 })).toEqual([]);
  });

  it("ne dépend pas de l'ordre des répondants", () => {
    expect(detecterEcarts(DEF, [...jeux].reverse())).toEqual(detecterEcarts(DEF, jeux));
  });

  it("ignore une question avec moins de deux réponses", () => {
    expect(detecterEcarts(DEF, [jeux[0]!, jeux[3]!])).toEqual([]);
  });

  it("refuse un seuil invalide ou un répondant en double", () => {
    expect(() => detecterEcarts(DEF, jeux, { seuil: 0 })).toThrow(erreur("OPTIONS_INVALIDES"));
    expect(() => detecterEcarts(DEF, jeux, { seuil: 1.5 })).toThrow(erreur("OPTIONS_INVALIDES"));
    expect(() => detecterEcarts(DEF, [jeux[0]!, jeux[0]!])).toThrow(erreur("REPONDANT_INVALIDE"));
  });
});
