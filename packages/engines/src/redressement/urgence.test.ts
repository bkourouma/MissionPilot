import { describe, expect, it } from "vitest";
import { ErreurRedressement } from "./erreurs";
import {
  DOMAINES_URGENCE,
  GRILLE_URGENCE,
  PARAMETRES_URGENCE_DEFAUT,
  type ReponseUrgence,
  VERSION_GRILLE_URGENCE,
  evaluerUrgence,
  validerParametresUrgence,
} from "./urgence";

const toutesNon = (): Record<string, ReponseUrgence> =>
  Object.fromEntries(GRILLE_URGENCE.map((q) => [q.code, "non" as const]));

const domaine = (r: ReturnType<typeof evaluerUrgence>, nom: (typeof DOMAINES_URGENCE)[number]) =>
  r.domaines.find((d) => d.domaine === nom)!;

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e.code;
    throw e;
  }
  return "AUCUNE";
};

describe("évaluation de l'urgence", () => {
  it("(U1) tout « non » : cinq domaines verts, 0 %, voyant global vert, complet", () => {
    const r = evaluerUrgence(toutesNon());
    expect(r.version).toBe(VERSION_GRILLE_URGENCE);
    expect(r.domaines.map((d) => d.domaine)).toEqual([...DOMAINES_URGENCE]);
    for (const d of r.domaines) {
      expect(d.voyant).toBe("vert");
      expect(d.pourcentage).toBe(0);
    }
    expect(r.voyant).toBe("vert");
    expect(r.complet).toBe(true);
    expect(r.questionsRepondues).toBe(15);
    expect(r.questionsTotal).toBe(15);
    expect(r.domainesRouges).toEqual([]);
    expect(r.domainesNonEvalues).toEqual([]);
  });

  it("(U2) T1 « oui », T2 « partiellement », T3 « non » : 5/8 = 62,5 % → 63, rouge", () => {
    const r = evaluerUrgence({ ...toutesNon(), T1: "oui", T2: "partiellement" });
    const d = domaine(r, "tresorerie");
    expect(d).toMatchObject({
      pointsPonderes: 5,
      pointsMaximum: 8,
      pourcentage: 63,
      voyant: "rouge",
      poidsRepondu: 4,
      poidsTotal: 4,
    });
    expect(r.voyant).toBe("rouge");
    expect(r.domainesRouges).toEqual(["tresorerie"]);
  });

  it("(U3) borne orange atteinte à 25 % (≥)", () => {
    const r = evaluerUrgence({ ...toutesNon(), T2: "oui" });
    const d = domaine(r, "tresorerie");
    expect(d).toMatchObject({
      pointsPonderes: 2,
      pointsMaximum: 8,
      pourcentage: 25,
      voyant: "orange",
    });
    expect(r.domainesOranges).toEqual(["tresorerie"]);
    expect(r.voyant).toBe("orange");
  });

  it("(U4) T1 « partiellement » (poids 2 × 1) : 2/8 = 25 %, orange", () => {
    const d = domaine(evaluerUrgence({ ...toutesNon(), T1: "partiellement" }), "tresorerie");
    expect(d).toMatchObject({ pourcentage: 25, voyant: "orange" });
  });

  it("(U5) T2 « partiellement » : 1/8 = 12,5 % → 13, vert (voyant sur valeurs exactes)", () => {
    const d = domaine(evaluerUrgence({ ...toutesNon(), T2: "partiellement" }), "tresorerie");
    expect(d).toMatchObject({ pointsPonderes: 1, pourcentage: 13, voyant: "vert" });
  });

  it("le voyant se décide sur les valeurs exactes, pas sur le pourcentage arrondi", () => {
    // 4/8 → 50 % : rouge à la borne.
    const d = domaine(evaluerUrgence({ ...toutesNon(), T1: "oui" }), "tresorerie");
    expect(d).toMatchObject({ pourcentage: 50, voyant: "rouge" });
    // Paramètre rouge à 51 %, 4/8 = 50 % → orange.
    const p = { ...PARAMETRES_URGENCE_DEFAUT, seuilRougePct: 51 };
    const d2 = domaine(evaluerUrgence({ ...toutesNon(), T1: "oui" }, p), "tresorerie");
    expect(d2.voyant).toBe("orange");
  });

  it("(U6) « inconnu » sort du dénominateur : domaine évalué à la borne de 50 %", () => {
    const r = evaluerUrgence({ ...toutesNon(), T1: "inconnu", T2: "oui" });
    const d = domaine(r, "tresorerie");
    expect(d).toMatchObject({
      poidsRepondu: 2,
      poidsTotal: 4,
      pointsPonderes: 2,
      pointsMaximum: 4,
      pourcentage: 50,
      voyant: "rouge",
      inconnues: ["T1"],
    });
    expect(r.questionsRepondues).toBe(14);
  });

  it("(U7) moins de la moitié du poids répondu : domaine non évalué", () => {
    const r = evaluerUrgence({ ...toutesNon(), T1: "inconnu", T2: "inconnu", T3: "oui" });
    const d = domaine(r, "tresorerie");
    expect(d).toMatchObject({ voyant: "non_evalue", pourcentage: null, poidsRepondu: 1 });
    expect(r.complet).toBe(false);
    expect(r.domainesNonEvalues).toEqual(["tresorerie"]);
    expect(r.voyant).toBe("vert");
  });

  it("(U8) aucune réponse : voyant global non évalué, 15 questions absentes", () => {
    const r = evaluerUrgence({});
    expect(r.voyant).toBe("non_evalue");
    expect(r.questionsRepondues).toBe(0);
    expect(r.domaines.flatMap((d) => d.absentes)).toHaveLength(15);
    expect(r.complet).toBe(false);
    expect(r.domainesNonEvalues).toHaveLength(5);
  });

  it("une réponse absente n'est jamais comptée comme « non »", () => {
    const r = evaluerUrgence({ T1: "oui" });
    const d = domaine(r, "tresorerie");
    expect(d.absentes).toEqual(["T2", "T3"]);
    expect(d).toMatchObject({ poidsRepondu: 2, pourcentage: 100, voyant: "rouge" });
  });

  it("le voyant global est le pire des domaines évalués", () => {
    const r = evaluerUrgence({
      ...toutesNon(),
      A2: "oui",
      S1: "oui",
    });
    expect(domaine(r, "activite").voyant).toBe("orange");
    expect(domaine(r, "social").voyant).toBe("rouge");
    expect(r.voyant).toBe("rouge");
    expect(r.domainesOranges).toEqual(["activite"]);
    expect(r.domainesRouges).toEqual(["social"]);
  });

  it("est déterministe et ne modifie pas ses entrées", () => {
    const entree = { ...toutesNon(), T1: "oui" as const };
    const copie = { ...entree };
    expect(evaluerUrgence(entree)).toEqual(evaluerUrgence(entree));
    expect(entree).toEqual(copie);
  });
});

describe("(U9) entrées invalides", () => {
  it("question inconnue, réponse invalide", () => {
    expect(code(() => evaluerUrgence({ Z9: "oui" }))).toBe("QUESTION_INCONNUE");
    expect(code(() => evaluerUrgence({ __proto__x: "oui" } as never))).toBe("QUESTION_INCONNUE");
    expect(code(() => evaluerUrgence({ T1: "peut-être" as ReponseUrgence }))).toBe(
      "REPONSE_INVALIDE",
    );
  });

  it("paramètres invalides", () => {
    const p = PARAMETRES_URGENCE_DEFAUT;
    expect(code(() => validerParametresUrgence(p))).toBe("AUCUNE");
    expect(
      code(() => validerParametresUrgence({ ...p, seuilOrangePct: 60, seuilRougePct: 50 })),
    ).toBe("ENTREE_INVALIDE");
    expect(code(() => validerParametresUrgence({ ...p, seuilRougePct: 101 }))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => validerParametresUrgence({ ...p, seuilOrangePct: -1 }))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => validerParametresUrgence({ ...p, seuilOrangePct: 12.5 }))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => validerParametresUrgence({ ...p, poidsCritique: 0 }))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => validerParametresUrgence({ ...p, poidsCritique: 11 }))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => validerParametresUrgence({ ...p, partMinimaleReponduePct: 0 }))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => evaluerUrgence({}, { ...p, seuilOrangePct: 60 }))).toBe("ENTREE_INVALIDE");
  });

  it("le poids critique pèse dans le calcul", () => {
    const d = domaine(
      evaluerUrgence(
        { ...toutesNon(), T1: "oui" },
        { ...PARAMETRES_URGENCE_DEFAUT, poidsCritique: 1 },
      ),
      "tresorerie",
    );
    expect(d).toMatchObject({
      poidsTotal: 3,
      pointsPonderes: 2,
      pointsMaximum: 6,
      pourcentage: 33,
    });
  });
});

describe("(U10) garde sur la grille", () => {
  it("15 questions, 3 par domaine, une critique par domaine, codes uniques", () => {
    expect(GRILLE_URGENCE).toHaveLength(15);
    expect(new Set(GRILLE_URGENCE.map((q) => q.code)).size).toBe(15);
    for (const d of DOMAINES_URGENCE) {
      const qs = GRILLE_URGENCE.filter((q) => q.domaine === d);
      expect(qs).toHaveLength(3);
      expect(qs.filter((q) => q.critique)).toHaveLength(1);
      expect(qs[0]?.code.startsWith(d === "tresorerie" ? "T" : d[0]!.toUpperCase())).toBe(true);
    }
    expect(VERSION_GRILLE_URGENCE).toBe(1);
    expect(PARAMETRES_URGENCE_DEFAUT).toEqual({
      seuilOrangePct: 25,
      seuilRougePct: 50,
      poidsCritique: 2,
      partMinimaleReponduePct: 50,
    });
  });

  it("aucun libellé de la grille ne qualifie la situation en termes juridiques", () => {
    const texte = GRILLE_URGENCE.map((q) => q.libelle)
      .join(" ")
      .toLowerCase();
    for (const interdit of ["cessation", "faillite", "défaillance", "procédure d'alerte"]) {
      expect(texte).not.toContain(interdit);
    }
  });
});
