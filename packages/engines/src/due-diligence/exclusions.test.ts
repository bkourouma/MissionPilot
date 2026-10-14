import { describe, expect, it } from "vitest";
import { ErreurDueDiligence } from "./erreurs";
import {
  filtrerExclusions,
  normaliserTexteDd,
  syntheseSocioEnvironnementale,
  touchesBloquantes,
  type DeclarationsFiltrage,
  type RegleExclusion,
  type ToucheExclusion,
} from "./exclusions";

const decl = (
  activites: string[],
  secteurCodes: string[] = [],
  paysCodes: string[] = [],
): DeclarationsFiltrage => ({ activites, secteurCodes, paysCodes });
const regle = (
  code: string,
  motsCles: string[] = [],
  secteurCodes: string[] = [],
  paysCodes: string[] = [],
): RegleExclusion => ({ code, motsCles, secteurCodes, paysCodes });

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurDueDiligence);
    return (e as ErreurDueDiligence).code;
  }
  return undefined;
}

describe("normaliserTexteDd", () => {
  it("accents, casse, ponctuation et espaces", () => {
    expect(normaliserTexteDd("  Éléphant,  d’Ivoire !! ")).toBe("elephant d ivoire");
    expect(normaliserTexteDd("jeux d'argent")).toBe("jeux d argent");
    expect(normaliserTexteDd("")).toBe("");
    expect(normaliserTexteDd("---")).toBe("");
  });
});

describe("filtrerExclusions", () => {
  it("(a) mot-clé dans une activité, casse et accents indifférents", () => {
    const r = filtrerExclusions(decl(["Exploitation d'un CASINO en zone franche"]), [
      regle("R1", ["casino", "jeux d'argent"]),
    ]);
    expect(r).toEqual({
      touches: [{ regle: "R1", criteres: ["mot_cle"], motsTrouves: ["casino"] }],
      nonTouchees: 0,
    });
  });

  it("(b) apostrophe typographique, mots consécutifs", () => {
    const r = filtrerExclusions(decl(["Organisation de jeux d’argent en ligne"]), [
      regle("R1", ["casino", "jeux d'argent"]),
    ]);
    expect(r.touches).toEqual([
      { regle: "R1", criteres: ["mot_cle"], motsTrouves: ["jeux d'argent"] },
    ]);
  });

  it("(c) préfixe : faux positif assumé ; pas de correspondance au milieu d'un mot", () => {
    const tabac = [regle("R1", ["tabac"])];
    expect(filtrerExclusions(decl(["Tabacologie clinique"]), tabac).touches).toHaveLength(1);
    expect(filtrerExclusions(decl(["Fabrication d'étiquettes"]), tabac).touches).toHaveLength(0);
    // Les mots du mot-clé doivent être consécutifs.
    const jeux = [regle("R1", ["jeux argent"])];
    expect(filtrerExclusions(decl(["jeux d'argent"]), jeux).touches).toHaveLength(0);
    // Plusieurs activités : une seule suffit ; un mot-clé n'enjambe pas deux activités.
    expect(filtrerExclusions(decl(["vente de tabac", "culture"]), tabac).touches).toHaveLength(1);
    expect(
      filtrerExclusions(decl(["jeux", "argent"]), [regle("R1", ["jeux argent"])]).touches,
    ).toHaveLength(0);
  });

  it("(d) secteur par égalité de code", () => {
    const r2 = [regle("R2", [], ["citi_b"])];
    expect(filtrerExclusions(decl([], ["cacao", "citi_a"]), r2)).toEqual({
      touches: [],
      nonTouchees: 1,
    });
    expect(filtrerExclusions(decl([], ["citi_b"]), r2).touches).toEqual([
      { regle: "R2", criteres: ["secteur"], motsTrouves: [] },
    ]);
  });

  it("(e) trois critères, touchée par deux : ordre canonique ; nonTouchees", () => {
    const r = filtrerExclusions(decl(["armes de guerre"], [], ["ml"]), [
      regle("R3", ["armes"], ["citi_x"], ["ml"]),
      regle("R4", ["tabac"]),
      regle("R5", [], [], ["bf"]),
    ]);
    expect(r.touches).toEqual([
      { regle: "R3", criteres: ["mot_cle", "pays"], motsTrouves: ["armes"] },
    ]);
    expect(r.nonTouchees).toBe(2);
    const tous = filtrerExclusions(decl(["armes"], ["citi_x"], ["ml"]), [
      regle("R3", ["armes"], ["citi_x"], ["ml"]),
    ]);
    expect(tous.touches[0]?.criteres).toEqual(["mot_cle", "secteur", "pays"]);
  });

  it("(h) entrées invalides", () => {
    expect(code(() => filtrerExclusions(decl([]), [regle("R1")]))).toBe("ENTREE_INVALIDE");
    expect(code(() => filtrerExclusions(decl([]), [regle("R1", ["  ,, "])]))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => filtrerExclusions(decl([]), [regle("R1", ["a"]), regle("R1", ["b"])]))).toBe(
      "ENTREE_INVALIDE",
    );
  });
});

describe("touchesBloquantes", () => {
  const touche = (r: string): ToucheExclusion => ({
    regle: r,
    criteres: ["mot_cle"],
    motsTrouves: [],
  });
  const touches = [touche("R1"), touche("R2"), touche("R3")];

  it("(f) la dernière décision fait foi", () => {
    expect(
      touchesBloquantes(touches, [
        { regle: "R1", decision: "ecartee", numero: 1 },
        { regle: "R2", decision: "confirmee", numero: 2 },
        { regle: "R2", decision: "ecartee", numero: 3 },
      ]),
    ).toBe(1);
    expect(
      touchesBloquantes(
        [touche("R2")],
        [
          { regle: "R2", decision: "ecartee", numero: 1 },
          { regle: "R2", decision: "confirmee", numero: 2 },
        ],
      ),
    ).toBe(1);
  });

  it("l'ordre des décisions reçues est sans effet ; décision sur une règle non touchée ignorée", () => {
    expect(
      touchesBloquantes(
        [touche("R2")],
        [
          { regle: "R2", decision: "confirmee", numero: 2 },
          { regle: "R2", decision: "ecartee", numero: 3 },
          { regle: "R9", decision: "confirmee", numero: 4 },
        ],
      ),
    ).toBe(0);
    expect(touchesBloquantes([], [])).toBe(0);
    expect(touchesBloquantes(touches, [])).toBe(3);
  });

  it("décisions invalides", () => {
    expect(
      code(() => touchesBloquantes(touches, [{ regle: "R1", decision: "ecartee", numero: 1.5 }])),
    ).toBe("ENTREE_INVALIDE");
    expect(
      code(() => touchesBloquantes(touches, [{ regle: "R1", decision: "x" as never, numero: 1 }])),
    ).toBe("ENTREE_INVALIDE");
  });
});

describe("syntheseSocioEnvironnementale", () => {
  const themes = [
    { code: "t1", niveau: "faible" as const, lecture: "etayee" as const },
    { code: "t2", niveau: "eleve" as const, lecture: "fragile" as const },
    { code: "t3", niveau: "critique" as const, lecture: null },
    { code: "t4", niveau: "non_concerne" as const, lecture: null },
  ];
  const attendus = ["t1", "t2", "t3", "t4", "t5"];

  it("(g) synthèse des thèmes", () => {
    expect(syntheseSocioEnvironnementale(themes, 0, attendus)).toEqual({
      niveauGlobal: "critique",
      parNiveau: { non_concerne: 1, faible: 1, modere: 0, eleve: 1, critique: 1 },
      manquants: ["t5"],
      complet: false,
      aDocumenter: ["t3", "t2"],
      touchesBloquantes: 0,
      bloquant: false,
    });
  });

  it("(g) une exclusion non levée rend la revue bloquante", () => {
    const r = syntheseSocioEnvironnementale(themes, 1, attendus);
    expect(r.bloquant).toBe(true);
    expect(r.touchesBloquantes).toBe(1);
  });

  it("complet quand tous les thèmes attendus sont renseignés ; aucun thème : non concerné et incomplet", () => {
    expect(syntheseSocioEnvironnementale(themes, 0, ["t1", "t2"]).complet).toBe(true);
    const vide = syntheseSocioEnvironnementale([], 0, []);
    expect(vide.niveauGlobal).toBe("non_concerne");
    expect(vide.complet).toBe(false);
    expect(syntheseSocioEnvironnementale([], 0, ["t1"]).manquants).toEqual(["t1"]);
  });

  it("à documenter : niveau décroissant puis code", () => {
    const r = syntheseSocioEnvironnementale(
      [
        { code: "b", niveau: "eleve", lecture: null },
        { code: "a", niveau: "eleve", lecture: "fragile" },
        { code: "c", niveau: "eleve", lecture: "solide" },
      ],
      0,
      [],
    );
    expect(r.aDocumenter).toEqual(["a", "b"]);
  });

  it("(h) entrées invalides", () => {
    expect(code(() => syntheseSocioEnvironnementale(themes, -1, []))).toBe("ENTREE_INVALIDE");
    expect(code(() => syntheseSocioEnvironnementale(themes, 1.5, []))).toBe("ENTREE_INVALIDE");
    expect(code(() => syntheseSocioEnvironnementale([...themes, themes[0] as never], 0, []))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(
      code(() =>
        syntheseSocioEnvironnementale(
          [{ code: "x", niveau: "enorme" as never, lecture: null }],
          0,
          [],
        ),
      ),
    ).toBe("ENTREE_INVALIDE");
  });
});
