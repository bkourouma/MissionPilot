import { describe, expect, it } from "vitest";
import {
  analyserCoherenceMethode,
  type AnomalieCoherence,
  type CodeAnomalieCoherence,
  type EntreeCoherence,
} from "./coherence";
import type { ConditionModulation, RegleModulation } from "./types";

const anc = (n: number, d = `Niveau ${n}`, exemples?: string[]) => ({
  niveau: n,
  description: d,
  ...(exemples ? { exemples } : {}),
});
const ANCRAGES_OK = [1, 2, 3, 4, 5].map((n) => anc(n, `Description ${n}`, n === 1 ? ["ex"] : []));

const egal = (facteur: string, valeur: string): ConditionModulation => ({
  type: "comparaison",
  facteur,
  comparateur: "egal",
  valeur,
});

function regle(p: Partial<RegleModulation> & { code: string }): RegleModulation {
  return {
    priorite: 10,
    condition: egal("a", "x"),
    effets: [{ type: "gabarit", cible: "c", choix: "g1" }],
    ...p,
  };
}

function base(): EntreeCoherence {
  return {
    etapes: [{ code: "e1" }],
    briques: [
      { code: "b1", etape_code: "e1", active_par_defaut: true },
      { code: "b2", etape_code: "e1", active_par_defaut: false },
    ],
    elements: [
      { code: "i1", type: "item", brique_code: "b1", actif_par_defaut: true },
      { code: "i2", type: "item", brique_code: null, actif_par_defaut: false },
      { code: "d1", type: "document", brique_code: "b1", actif_par_defaut: true },
    ],
    rubriques: [{ code: "r1", brique_code: "b1", dimension: null, ancrages: ANCRAGES_OK }],
    regles: [regle({ code: "act_b2", effets: [{ type: "activer_brique", brique: "b2" }] })],
    cas_types: [],
  };
}

function codes(a: AnomalieCoherence[]): CodeAnomalieCoherence[] {
  return a.map((x) => x.code);
}
function avec(partiel: Partial<EntreeCoherence>): AnomalieCoherence[] {
  return analyserCoherenceMethode({ ...base(), ...partiel });
}

describe("analyserCoherenceMethode", () => {
  it("ne signale rien sur une méthode saine et sur des entrées vides", () => {
    expect(analyserCoherenceMethode(base())).toEqual([]);
    expect(
      analyserCoherenceMethode({
        etapes: [],
        briques: [],
        elements: [],
        rubriques: [],
        regles: [],
        cas_types: [],
      }),
    ).toEqual([]);
  });

  describe("REFERENCE_CASSEE", () => {
    it("détecte étape, brique d'élément et de rubrique inconnues", () => {
      const r = avec({
        briques: [{ code: "b1", etape_code: "zz", active_par_defaut: true }],
        elements: [{ code: "i1", type: "item", brique_code: "zz", actif_par_defaut: true }],
        rubriques: [{ code: "r1", brique_code: "zz", dimension: "d", ancrages: ANCRAGES_OK }],
        regles: [],
      });
      expect(r.map((x) => x.chemin)).toEqual([
        "briques.b1",
        "elements.i1.brique",
        "rubriques.r1.brique",
      ]);
      expect(r.every((x) => x.code === "REFERENCE_CASSEE" && x.gravite === "erreur")).toBe(true);
    });

    it("détecte les références cassées d'un cas type", () => {
      const r = avec({
        cas_types: [
          {
            code: "cas",
            briques_de_base: ["b1", "inconnue"],
            attendu: {
              regles_declenchees: ["act_b2", "fantome"],
              presents: [
                { type: "activer_brique", brique: "nope" },
                { type: "retirer_item", item: "d1" },
                { type: "gabarit", cible: "x", choix: "y" },
              ],
              absents: [
                { type: "retirer_brique", brique: "b1" },
                { type: "activer_item", item: "absent" },
              ],
            },
          },
        ],
      });
      expect(r.map((x) => x.chemin)).toEqual([
        "cas_types.cas.attendu.absents",
        "cas_types.cas.attendu.presents",
        "cas_types.cas.attendu.presents",
        "cas_types.cas.attendu.regles_declenchees",
        "cas_types.cas.briques_de_base",
      ]);
      expect(codes(r).every((c) => c === "REFERENCE_CASSEE")).toBe(true);
    });

    it("accepte un cas type sans option ni référence cassée", () => {
      expect(
        avec({
          cas_types: [
            {
              code: "cas",
              attendu: {
                presents: [{ type: "activer_item", item: "i1" }],
                absents: [{ type: "activer_brique", brique: "b2" }],
              },
            },
            { code: "vide", attendu: {} },
          ],
        }),
      ).toEqual([]);
    });
  });

  describe("rubriques", () => {
    const rub = (ancrages: unknown, extra: object = {}) => ({
      rubriques: [{ code: "r1", brique_code: "b1", dimension: null, ancrages, ...extra }],
    });

    it("RUBRIQUE_SANS_ANCRAGE : non-tableau, mauvaise longueur, niveau, description", () => {
      const cas: [unknown, string][] = [
        [null, "ne forment pas une liste"],
        [ANCRAGES_OK.slice(0, 3), "3 ancrage(s) au lieu de 5"],
        [[...ANCRAGES_OK.slice(0, 4), "x"], "le niveau 5 n'est pas un ancrage"],
        [[anc(2), ...ANCRAGES_OK.slice(1)], "position 1 vaut 2 au lieu de 1"],
        [[{ description: "a" }, ...ANCRAGES_OK.slice(1)], "vaut absent au lieu de 1"],
        [
          [...ANCRAGES_OK.slice(0, 4), { niveau: 5, description: "   " }],
          "le niveau 5 n'a pas de description",
        ],
        [[...ANCRAGES_OK.slice(0, 4), { niveau: 5, description: 3 }], "niveau 5 n'a pas"],
      ];
      for (const [valeur, extrait] of cas) {
        const r = avec(rub(valeur));
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
          code: "RUBRIQUE_SANS_ANCRAGE",
          gravite: "erreur",
          chemin: "rubriques.r1.ancrages",
        });
        expect(r[0]!.message).toContain(extrait);
      }
    });

    it("RUBRIQUE_ANCRAGES_IDENTIQUES : insensible à la casse et aux espaces", () => {
      const a = ANCRAGES_OK.map((x) => ({ ...x }));
      a[3] = { ...a[3]!, description: "  DESCRIPTION   2 " };
      const r = avec(rub(a));
      expect(codes(r)).toEqual(["RUBRIQUE_ANCRAGES_IDENTIQUES"]);
      expect(r[0]).toMatchObject({ gravite: "avertissement" });
      expect(r[0]!.message).toContain("2 et 4");
    });

    it("RUBRIQUE_SANS_EXEMPLE : exemples absents ou vides partout", () => {
      expect(codes(avec(rub([1, 2, 3, 4, 5].map((n) => anc(n, `D${n}`)))))).toEqual([
        "RUBRIQUE_SANS_EXEMPLE",
      ]);
      expect(codes(avec(rub([1, 2, 3, 4, 5].map((n) => anc(n, `D${n}`, [])))))).toEqual([
        "RUBRIQUE_SANS_EXEMPLE",
      ]);
      expect(avec(rub(ANCRAGES_OK))).toEqual([]);
    });

    it("RUBRIQUE_NON_RATTACHEE : ni brique ni dimension", () => {
      const r = avec(rub(ANCRAGES_OK, { brique_code: null }));
      expect(codes(r)).toEqual(["RUBRIQUE_NON_RATTACHEE"]);
      expect(r[0]!.gravite).toBe("avertissement");
      expect(avec(rub(ANCRAGES_OK, { brique_code: null, dimension: "d" }))).toEqual([]);
    });
  });

  describe("règles", () => {
    it("REGLES_CONTRADICTOIRES : mêmes condition, priorité, effets opposés", () => {
      const r = avec({
        regles: [
          regle({
            code: "z",
            condition: { type: "tous", conditions: [egal("a", "x"), egal("b", "y")] },
            effets: [{ type: "ponderation", cible: "k", valeur: 1 }],
          }),
          regle({
            code: "a",
            condition: { type: "tous", conditions: [egal("b", "y"), egal("a", "x")] },
            effets: [
              { type: "ponderation", cible: "k", valeur: 2 },
              { type: "gabarit", cible: "g", choix: "u" },
            ],
          }),
        ],
      });
      expect(r.map((x) => x.code)).toContain("REGLES_CONTRADICTOIRES");
      const c = r.filter((x) => x.code === "REGLES_CONTRADICTOIRES");
      expect(c).toHaveLength(1);
      expect(c[0]).toMatchObject({
        code: "REGLES_CONTRADICTOIRES",
        gravite: "erreur",
        regle: "a",
        chemin: "regles.a",
      });
      expect(c[0]!.message).toContain("ponderation:k");
    });

    it("REGLES_CONTRADICTOIRES : listes « dans » égales à l'ordre près", () => {
      const dans = (v: string[]): ConditionModulation => ({
        type: "comparaison",
        facteur: "f",
        comparateur: "dans",
        valeur: v,
      });
      const r = avec({
        regles: [
          regle({
            code: "a",
            condition: dans(["x", "y"]),
            effets: [{ type: "retirer_brique", brique: "b1" }],
          }),
          regle({
            code: "b",
            condition: dans(["y", "x"]),
            effets: [{ type: "activer_brique", brique: "b1" }],
          }),
        ],
      });
      expect(codes(r)).toContain("REGLES_CONTRADICTOIRES");
    });

    it("pas de contradiction : priorités ou conditions différentes, effets cumulables, mêmes valeurs, inactive", () => {
      const eff = (v: number) => [{ type: "ponderation" as const, cible: "k", valeur: v }];
      const non = (c: ConditionModulation): ConditionModulation => ({ type: "non", condition: c });
      const cas: RegleModulation[][] = [
        [regle({ code: "a", effets: eff(1) }), regle({ code: "b", priorite: 11, effets: eff(2) })],
        [
          regle({ code: "a", effets: eff(1) }),
          regle({ code: "b", condition: egal("a", "y"), effets: eff(2) }),
        ],
        [
          regle({ code: "a", condition: non(egal("a", "x")), effets: eff(1) }),
          regle({ code: "b", effets: eff(2) }),
        ],
        [regle({ code: "a", effets: eff(1) }), regle({ code: "b", effets: eff(1) })],
        [
          regle({
            code: "a",
            effets: [
              { type: "recommandation_candidate", recommandation: "r" },
              { type: "relever_classe_risque", cible: "c", classe: "R1" },
            ],
          }),
          regle({
            code: "b",
            effets: [
              { type: "recommandation_candidate", recommandation: "r" },
              { type: "relever_classe_risque", cible: "c", classe: "R2" },
            ],
          }),
        ],
        [regle({ code: "a", effets: eff(1) }), regle({ code: "b", active: false, effets: eff(2) })],
        [
          regle({ code: "a", effets: eff(1) }),
          regle({ code: "b", effets: [{ type: "seuil", cible: "k", valeur: 2 }] }),
        ],
      ];
      for (const regles of cas) {
        expect(codes(avec({ regles }))).not.toContain("REGLES_CONTRADICTOIRES");
      }
    });

    it("REGLE_SANS_EFFET_REEL : effets sans portée par rapport à l'état de départ", () => {
      const r = avec({
        regles: [
          regle({
            code: "r_act",
            effets: [
              { type: "activer_brique", brique: "b1" },
              { type: "activer_item", item: "i1" },
            ],
          }),
          regle({
            code: "r_ret",
            effets: [
              { type: "retirer_brique", brique: "b2" },
              { type: "retirer_item", item: "i2" },
            ],
          }),
          regle({ code: "r_act_b2", effets: [{ type: "activer_brique", brique: "b2" }] }),
        ],
      });
      const sans = r.filter((x) => x.code === "REGLE_SANS_EFFET_REEL");
      // r_ret retire b2, mais r_act_b2 l'active : portée réelle ; r_act est sans portée.
      expect(sans.map((x) => x.regle)).toEqual(["r_act"]);
      expect(sans[0]).toMatchObject({ gravite: "avertissement", chemin: "regles.r_act" });
    });

    it("REGLE_SANS_EFFET_REEL : retrait d'une brique/item inactifs sans activation", () => {
      const r = avec({
        regles: [
          regle({
            code: "r_ret",
            effets: [
              { type: "retirer_brique", brique: "b2" },
              { type: "retirer_item", item: "i2" },
            ],
          }),
        ],
      });
      expect(r.filter((x) => x.code === "REGLE_SANS_EFFET_REEL").map((x) => x.regle)).toEqual([
        "r_ret",
      ]);
    });

    it("pas de REGLE_SANS_EFFET_REEL : retrait d'un actif, effet d'un autre type, inconnu, vide, une seule portée", () => {
      const regles = [
        regle({ code: "a", effets: [{ type: "retirer_brique", brique: "b1" }] }),
        regle({
          code: "b",
          effets: [
            { type: "activer_brique", brique: "b2" },
            { type: "activer_brique", brique: "b1" },
          ],
        }),
        regle({ code: "c", effets: [{ type: "activer_brique", brique: "inconnue" }] }),
        regle({ code: "d", effets: [] }),
        regle({ code: "e", effets: [{ type: "activer_item", item: "d1" }] }),
        regle({ code: "f", effets: [{ type: "retirer_item", item: "i1" }] }),
        regle({ code: "g", effets: [{ type: "activer_item", item: "i2" }] }),
      ];
      expect(codes(avec({ regles }))).not.toContain("REGLE_SANS_EFFET_REEL");
    });

    it("REGLE_INACTIVE", () => {
      const r = avec({
        regles: [regle({ code: "x", active: false }), regle({ code: "y", active: true })],
      });
      const inactives = r.filter((x) => x.code === "REGLE_INACTIVE");
      expect(inactives).toEqual([
        expect.objectContaining({
          gravite: "avertissement",
          regle: "x",
          chemin: "regles.x",
        }),
      ]);
    });

    it("BRIQUE_INATTEIGNABLE : positif et négatif", () => {
      const r = avec({ regles: [] });
      expect(r).toEqual([
        expect.objectContaining({
          code: "BRIQUE_INATTEIGNABLE",
          chemin: "briques.b2",
          regle: null,
        }),
      ]);
      expect(codes(avec({}))).not.toContain("BRIQUE_INATTEIGNABLE");
      // Une règle inactive n'atteint pas la brique.
      const inactive = avec({
        regles: [
          regle({ code: "x", active: false, effets: [{ type: "activer_brique", brique: "b2" }] }),
        ],
      });
      expect(codes(inactive)).toContain("BRIQUE_INATTEIGNABLE");
    });

    it("CONDITION_INSATISFAISABLE : cas détectés", () => {
      const diff = (f: string, v: string): ConditionModulation => ({
        type: "comparaison",
        facteur: f,
        comparateur: "different",
        valeur: v,
      });
      const insat: ConditionModulation[] = [
        { type: "tous", conditions: [egal("a", "x"), egal("a", "y")] },
        { type: "tous", conditions: [egal("a", "x"), diff("a", "x")] },
        {
          type: "tous",
          conditions: [
            egal("b", "z"),
            { type: "tous", conditions: [egal("a", "x"), egal("a", "y")] },
          ],
        },
        {
          type: "au_moins_un",
          conditions: [
            { type: "tous", conditions: [egal("a", "x"), egal("a", "y")] },
            { type: "tous", conditions: [egal("a", "x"), diff("a", "x")] },
          ],
        },
      ];
      for (const condition of insat) {
        const r = avec({
          regles: [
            regle({ code: "r", condition, effets: [{ type: "activer_brique", brique: "b2" }] }),
          ],
        });
        expect(r).toEqual([
          expect.objectContaining({
            code: "CONDITION_INSATISFAISABLE",
            gravite: "avertissement",
            regle: "r",
            chemin: "regles.r.condition",
          }),
        ]);
      }
    });

    it("CONDITION_INSATISFAISABLE : ne conclut rien d'incertain", () => {
      const diff = (f: string, v: string): ConditionModulation => ({
        type: "comparaison",
        facteur: f,
        comparateur: "different",
        valeur: v,
      });
      const sat: ConditionModulation[] = [
        egal("a", "x"),
        { type: "tous", conditions: [egal("a", "x"), egal("a", "x")] },
        { type: "tous", conditions: [egal("a", "x"), egal("b", "y")] },
        { type: "tous", conditions: [egal("a", "x"), diff("a", "y")] },
        { type: "tous", conditions: [diff("a", "x"), diff("a", "y")] },
        { type: "tous", conditions: [egal("a", "x"), { type: "brique_active", brique: "b1" }] },
        { type: "tous", conditions: [] },
        { type: "au_moins_un", conditions: [] },
        {
          type: "au_moins_un",
          conditions: [
            egal("a", "x"),
            { type: "tous", conditions: [egal("a", "x"), egal("a", "y")] },
          ],
        },
        { type: "non", condition: { type: "tous", conditions: [egal("a", "x"), egal("a", "y")] } },
        {
          type: "tous",
          conditions: [
            { type: "comparaison", facteur: "n", comparateur: "superieur", valeur: 1 },
            { type: "comparaison", facteur: "n", comparateur: "inferieur", valeur: 0 },
          ],
        },
      ];
      for (const condition of sat) {
        const r = avec({
          regles: [
            regle({ code: "r", condition, effets: [{ type: "activer_brique", brique: "b2" }] }),
          ],
        });
        expect(codes(r)).not.toContain("CONDITION_INSATISFAISABLE");
      }
    });
  });

  it("trie : erreurs d'abord, puis code, puis chemin ; déterministe et indépendant de l'ordre", () => {
    const e: EntreeCoherence = {
      ...base(),
      etapes: [],
      briques: [
        { code: "b9", etape_code: "e1", active_par_defaut: false },
        { code: "b1", etape_code: "e1", active_par_defaut: true },
      ],
      rubriques: [{ code: "r1", brique_code: null, dimension: null, ancrages: [] }],
      regles: [
        regle({ code: "z", active: false }),
        regle({ code: "a", effets: [{ type: "activer_brique", brique: "b1" }] }),
      ],
    };
    const r1 = analyserCoherenceMethode(e);
    const r2 = analyserCoherenceMethode({
      ...e,
      briques: [...e.briques].reverse(),
      regles: [...e.regles].reverse(),
    });
    expect(r2).toEqual(r1);
    expect(analyserCoherenceMethode(e)).toEqual(r1);
    expect(r1.map((x) => `${x.gravite}:${x.code}:${x.chemin}`)).toEqual([
      "erreur:REFERENCE_CASSEE:briques.b1",
      "erreur:REFERENCE_CASSEE:briques.b9",
      "erreur:RUBRIQUE_SANS_ANCRAGE:rubriques.r1.ancrages",
      "avertissement:BRIQUE_INATTEIGNABLE:briques.b9",
      "avertissement:REGLE_INACTIVE:regles.z",
      "avertissement:REGLE_SANS_EFFET_REEL:regles.a",
      "avertissement:RUBRIQUE_NON_RATTACHEE:rubriques.r1",
    ]);
  });
});
