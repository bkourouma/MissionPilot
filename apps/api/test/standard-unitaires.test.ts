import { describe, expect, it } from "vitest";
import { validerVersion } from "../src/standard/coherence.js";
import { comparerContenus, fusionnerVariante, jsonCanonique } from "../src/standard/differences.js";
import { resultatApi, type FacteurLigne } from "../src/standard/modulation.js";
import { resoudreMethode } from "../src/standard/resolution.js";
import { appliquerModulation } from "@missionpilot/engines";
import type { BriqueContenu, ContenuMethode } from "../src/standard/types.js";

/*
 * Fonctions pures du référentiel (sans base) : JSON canonique, différences
 * par code, fusion à trois voies d'une variante, cohérence d'une version et
 * résolution de la méthode effective.
 */

const brique = (code: string, extra: Partial<BriqueContenu> = {}): BriqueContenu => ({
  etape_code: "e1",
  code,
  libelle: code,
  objet: "Objet",
  entrees: null,
  moteur: null,
  agent: null,
  classe_risque: "R1",
  garde: null,
  sortie: null,
  definition_termine: null,
  temps_type_jours: null,
  profil_temps: null,
  niveau_autonomie_max: "N1",
  active_par_defaut: true,
  ordre: 1,
  ...extra,
});

const contenu = (
  briques: BriqueContenu[],
  extra: Partial<ContenuMethode> = {},
): ContenuMethode => ({
  etapes: [{ code: "e1", libelle: "Étape", description: null, ordre: 1 }],
  briques,
  elements: [],
  rubriques: [],
  regles: [],
  cas_types: [],
  ...extra,
});

const FACTEURS: FacteurLigne[] = [
  {
    id: "f",
    cabinet_id: null,
    code: "effectif",
    libelle: "Effectif",
    description: null,
    type: "nombre",
    valeurs: null,
    min: "0",
    max: null,
    porte_par: "dossier",
    ordre: 1,
  },
];

describe("différences et fusion", () => {
  it("le JSON canonique ignore l'ordre des clés et les valeurs absentes", () => {
    expect(jsonCanonique({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(
      jsonCanonique({ a: [1, { d: 2 }], b: 1 }),
    );
  });

  it("différences par code : ajouts, retraits, champs modifiés", () => {
    const d = comparerContenus(
      contenu([brique("a"), brique("b")]),
      contenu([brique("a", { libelle: "A2" }), brique("c")]),
    );
    expect(d.identique).toBe(false);
    expect(d.briques).toEqual({
      ajoutes: ["c"],
      retires: ["b"],
      modifies: [{ code: "a", champs: ["libelle"] }],
    });
    expect(comparerContenus(contenu([brique("a")]), contenu([brique("a")])).identique).toBe(true);
  });

  it("fusion à trois voies : le cabinet l'emporte, le standard s'applique ailleurs, conflits signalés", () => {
    const base = contenu([brique("a"), brique("b"), brique("c")]);
    const variante = contenu([brique("a", { libelle: "cabinet" }), brique("c"), brique("x")]);
    const standard = contenu([
      brique("a", { libelle: "standard" }),
      brique("b"),
      brique("c", { temps_type_jours: 2 }),
      brique("n"),
    ]);
    const f = fusionnerVariante(base, variante, standard);
    expect(f.contenu.briques.map((b) => [b.code, b.libelle, b.temps_type_jours])).toEqual([
      ["a", "cabinet", null],
      ["c", "c", 2],
      ["n", "n", null],
      ["x", "x", null],
    ]);
    expect(f.conflits).toEqual([{ collection: "briques", code: "a" }]);
    expect(f.repris).toEqual([
      { collection: "briques", code: "c" },
      { collection: "briques", code: "n" },
    ]);
  });

  it("fusion : une brique garde son étape disparue du standard ; un élément perd sa brique disparue", () => {
    const etape2 = { code: "e2", libelle: "Deux", description: null, ordre: 2 };
    const base = contenu([brique("a"), brique("b", { etape_code: "e2" })], {
      etapes: [{ code: "e1", libelle: "Étape", description: null, ordre: 1 }, etape2],
    });
    const variante = contenu(
      [brique("a"), brique("b", { etape_code: "e2", libelle: "B cabinet" })],
      {
        etapes: base.etapes,
        elements: [
          {
            brique_code: "a",
            type: "livrable",
            code: "l",
            libelle: "L",
            description: null,
            essentiel: false,
            actif_par_defaut: true,
          },
        ],
      },
    );
    const standard = contenu([brique("z")]);
    const f = fusionnerVariante(base, variante, standard);
    expect(f.contenu.briques.map((b) => b.code)).toEqual(["b", "z"]);
    expect(f.contenu.etapes.map((e) => e.code).sort()).toEqual(["e1", "e2"]);
    expect(f.contenu.elements[0]!.brique_code).toBeNull();
  });
});

describe("cohérence et méthode effective", () => {
  it("version sans brique, moteur inconnu, autonomie incompatible : erreurs ; étape vide : avertissement", () => {
    expect(validerVersion(contenu([]), FACTEURS).anomalies.map((a) => a.code)).toEqual([
      "VERSION_SANS_BRIQUE",
      "ETAPE_SANS_BRIQUE",
    ]);
    const v = validerVersion(
      contenu([
        brique("a", { moteur: "inconnu" }),
        brique("b", { classe_risque: "R3", niveau_autonomie_max: "N3" }),
        brique("c", { classe_risque: "R1", niveau_autonomie_max: "N4" }),
      ]),
      FACTEURS,
    );
    expect(v.valide).toBe(false);
    expect(v.anomalies.map((a) => a.code)).toEqual([
      "MOTEUR_INCONNU",
      "AUTONOMIE_INCOMPATIBLE",
      "AUTONOMIE_INCOMPATIBLE",
    ]);
  });

  it("cas type échoué : erreur ; règles sans cas type : avertissement", () => {
    const regle = {
      code: "grand",
      priorite: 1,
      condition: {
        type: "comparaison" as const,
        facteur: "effectif",
        comparateur: "superieur" as const,
        valeur: 10,
      },
      effets: [{ type: "retirer_brique" as const, brique: "a" }],
    };
    const sansCas = validerVersion(
      contenu([brique("a")], { regles: [{ code: "grand", regle }] }),
      FACTEURS,
    );
    expect(sansCas.valide).toBe(true);
    expect(sansCas.anomalies.map((a) => a.code)).toEqual(["AUCUN_CAS_TYPE"]);
    const echec = validerVersion(
      contenu([brique("a")], {
        regles: [{ code: "grand", regle }],
        cas_types: [
          {
            code: "petit",
            libelle: null,
            cas: {
              contexte: { effectif: 3 },
              attendu: { presents: [{ type: "retirer_brique", brique: "a" }] },
            },
          },
        ],
      }),
      FACTEURS,
    );
    expect(echec.valide).toBe(false);
    expect(echec.cas_types?.echoues).toBe(1);
  });

  it("méthode effective : modulation, dérogations et classe relevée jamais abaissée", () => {
    const c = contenu([
      brique("a"),
      brique("b", { active_par_defaut: false, classe_risque: "R2" }),
      brique("c"),
    ]);
    const modulation = resultatApi(
      appliquerModulation(
        [
          {
            code: "r",
            priorite: 1,
            condition: {
              type: "comparaison",
              facteur: "effectif",
              comparateur: "superieur",
              valeur: 5,
            },
            effets: [
              { type: "activer_brique", brique: "b" },
              { type: "relever_classe_risque", cible: "a", classe: "R3" },
              { type: "seuil", cible: "c", valeur: 0.3 },
            ],
          },
        ],
        { effectif: 10 },
        { briquesDeBase: ["a", "c"] },
      ),
    );
    const m = resoudreMethode(c, modulation, [
      { id: "d1", brique_code: "c", nature: "retirer_brique", description: null },
      { id: "d2", brique_code: "a", nature: "adapter_brique", description: "Plus court." },
    ]);
    const [a, b, cc] = m.etapes[0]!.briques;
    expect(a).toMatchObject({
      active: true,
      origine: "methode",
      classe_risque: "R3",
      classe_risque_base: "R1",
      adaptations: ["Plus court."],
      garde_requise: { quatre_yeux: true, signature: true },
    });
    expect(b).toMatchObject({ active: true, origine: "modulation", classe_risque: "R2" });
    expect(cc).toMatchObject({ active: false, origine: "derogation", ajustements: { seuil: 0.3 } });
  });
});
