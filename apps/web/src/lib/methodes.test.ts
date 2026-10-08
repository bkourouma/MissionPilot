import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  briquesParEtape,
  codeDepuisLibelle,
  construireContexte,
  construireFacteur,
  construireRegle,
  decrireCondition,
  decrireEffet,
  lireCurseur,
  messageMethodes,
  niveauxAdmis,
  ongletsMethodes,
  resumeDifferences,
  saisieBriqueVide,
  saisieDepuisContexte,
  saisieFacteurVide,
  saisieRegleVide,
  texteSourcesDossier,
  validerBrique,
  type Differences,
  type Facteur,
} from "./methodes";

const facteur = (f: Partial<Facteur> & Pick<Facteur, "code" | "type">): Facteur => ({
  id: f.code,
  libelle: f.code,
  description: null,
  valeurs: null,
  min: null,
  max: null,
  porte_par: "mission",
  origine: "standard",
  ...f,
});

const FACTEURS: Facteur[] = [
  facteur({ code: "effectif", libelle: "Effectif", type: "nombre", min: 0 }),
  facteur({
    code: "actionnariat",
    libelle: "Propriété",
    type: "enumeration",
    valeurs: [
      { code: "familial", libelle: "Familiale" },
      { code: "etat", libelle: "État actionnaire" },
    ],
  }),
  facteur({
    code: "filieres",
    type: "liste",
    valeurs: [
      { code: "cacao", libelle: "Cacao" },
      { code: "anacarde", libelle: "Anacarde" },
    ],
  }),
  facteur({ code: "agricole", type: "booleen" }),
];

describe("contexte saisi", () => {
  it("convertit les saisies, omet les facteurs vides", () => {
    const r = construireContexte(
      {
        effectif: "1 200,5",
        actionnariat: "familial",
        filieres: ["cacao"],
        agricole: "oui",
        autre: "",
      },
      FACTEURS,
    );
    expect(r).toEqual({
      ok: true,
      charge: { effectif: 1200.5, actionnariat: "familial", filieres: ["cacao"], agricole: true },
    });
    expect(construireContexte({}, FACTEURS)).toEqual({ ok: true, charge: {} });
  });

  it("signale nombre illisible, borne, valeur inconnue et booléen invalide", () => {
    const r = construireContexte(
      { effectif: "douze", actionnariat: "inconnu", agricole: "peut-être" },
      FACTEURS,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.erreurs).sort()).toEqual(["actionnariat", "agricole", "effectif"]);
    const borne = construireContexte({ effectif: "-1" }, FACTEURS);
    expect(borne.ok).toBe(false);
  });

  it("aller-retour depuis le contexte d'une mission", () => {
    const s = saisieDepuisContexte({
      effectif: 12,
      agricole: false,
      filieres: ["cacao"],
      actionnariat: null,
    });
    expect(s).toEqual({ effectif: "12", agricole: "non", filieres: ["cacao"] });
    expect(saisieDepuisContexte(null)).toEqual({});
  });
});

describe("éditeur de règle sans code", () => {
  it("construit une règle à une condition", () => {
    const r = construireRegle(
      {
        ...saisieRegleVide(),
        code: "petite_structure",
        libelle: "Effectif inférieur à 20",
        comparaisons: [{ facteur: "effectif", comparateur: "inferieur", valeur: "20" }],
        effets: [
          { type: "activer_brique", code: "atelier_unique", valeur: "" },
          { type: "gabarit", code: "questionnaire", valeur: "essentiel" },
        ],
      },
      FACTEURS,
    );
    expect(r).toEqual({
      ok: true,
      charge: {
        code: "petite_structure",
        libelle: "Effectif inférieur à 20",
        priorite: 10,
        condition: {
          type: "comparaison",
          facteur: "effectif",
          comparateur: "inferieur",
          valeur: 20,
        },
        effets: [
          { type: "activer_brique", brique: "atelier_unique" },
          { type: "gabarit", cible: "questionnaire", choix: "essentiel" },
        ],
      },
    });
  });

  it("combine plusieurs conditions ; listes, booléens, classes et pondérations", () => {
    const r = construireRegle(
      {
        ...saisieRegleVide(),
        code: "agricole",
        priorite: "5",
        combinaison: "au_moins_un",
        comparaisons: [
          { facteur: "filieres", comparateur: "dans", valeur: "cacao, anacarde" },
          { facteur: "filieres", comparateur: "contient", valeur: "cacao" },
          { facteur: "agricole", comparateur: "egal", valeur: "oui" },
        ],
        effets: [
          { type: "relever_classe_risque", code: "rapport", valeur: "R3" },
          { type: "ponderation", code: "dim_operations", valeur: "1,5" },
          { type: "recommandation_candidate", code: "kpi_pertes", valeur: "" },
          { type: "retirer_item", code: "item_x", valeur: "" },
        ],
      },
      FACTEURS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge.condition).toEqual({
        type: "au_moins_un",
        conditions: [
          {
            type: "comparaison",
            facteur: "filieres",
            comparateur: "dans",
            valeur: ["cacao", "anacarde"],
          },
          { type: "comparaison", facteur: "filieres", comparateur: "contient", valeur: "cacao" },
          { type: "comparaison", facteur: "agricole", comparateur: "egal", valeur: true },
        ],
      });
      expect(r.charge.effets[1]).toEqual({
        type: "ponderation",
        cible: "dim_operations",
        valeur: 1.5,
      });
    }
  });

  it("refuse code, priorité, condition incomplète ou incompatible, effet incomplet", () => {
    const r = construireRegle(
      {
        ...saisieRegleVide(),
        code: "Code Invalide",
        priorite: "2000",
        comparaisons: [
          { facteur: "effectif", comparateur: "contient", valeur: "3" },
          { facteur: "inconnu", comparateur: "egal", valeur: "x" },
        ],
        effets: [
          { type: "relever_classe_risque", code: "x", valeur: "R9" },
          { type: "seuil", code: "x", valeur: "abc" },
          { type: "formulation", code: "x", valeur: "" },
          { type: "activer_brique", code: "", valeur: "" },
        ],
      },
      FACTEURS,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.erreurs).sort()).toEqual(["code", "comparaisons", "effets", "priorite"]);
    const sansCondition = construireRegle(
      {
        ...saisieRegleVide(),
        code: "x",
        comparaisons: [],
        effets: [{ type: "benchmark", code: "c", valeur: "b" }],
      },
      FACTEURS,
    );
    expect(sansCondition.ok).toBe(false);
    const nombreIllisible = construireRegle(
      {
        ...saisieRegleVide(),
        code: "x",
        comparaisons: [{ facteur: "effectif", comparateur: "egal", valeur: "beaucoup" }],
        effets: [{ type: "activer_item", code: "i", valeur: "" }],
      },
      FACTEURS,
    );
    expect(nombreIllisible.ok).toBe(false);
    const vide = construireRegle(
      {
        ...saisieRegleVide(),
        code: "x",
        comparaisons: [{ facteur: "agricole", comparateur: "egal", valeur: "" }],
        effets: [{ type: "activer_item", code: "i", valeur: "" }],
      },
      FACTEURS,
    );
    expect(vide.ok).toBe(false);
  });

  it("décrit conditions et effets en français", () => {
    expect(
      decrireCondition(
        {
          type: "tous",
          conditions: [
            { type: "comparaison", facteur: "actionnariat", comparateur: "egal", valeur: "etat" },
            {
              type: "au_moins_un",
              conditions: [
                { type: "comparaison", facteur: "agricole", comparateur: "egal", valeur: true },
                { type: "non", condition: { type: "brique_active", brique: "b" } },
              ],
            },
            { type: "comparaison", facteur: "inconnu", comparateur: "dans", valeur: [1, 2] },
          ],
        },
        FACTEURS,
      ),
    ).toBe(
      "Propriété est État actionnaire et (agricole est oui ou non (la brique « b » est active)) et inconnu est parmi 1, 2",
    );
    expect(decrireEffet({ type: "activer_brique", brique: "a" })).toBe("Activer la brique « a »");
    expect(decrireEffet({ type: "retirer_item", item: "i" })).toBe("Retirer l'item « i »");
    expect(decrireEffet({ type: "seuil", cible: "s", valeur: 0.5 })).toBe(
      "Fixer le seuil de « s » : 0,5",
    );
    expect(decrireEffet({ type: "gabarit", cible: "q", choix: "essentiel" })).toBe(
      "Choisir le gabarit de « q » : essentiel",
    );
    expect(decrireEffet({ type: "relever_classe_risque", cible: "r", classe: "R3" })).toBe(
      "Relever la classe de risque de « r » à R3",
    );
    expect(decrireEffet({ type: "recommandation_candidate", recommandation: "k" })).toBe(
      "Proposer la recommandation « k »",
    );
  });
});

describe("éditeur de brique", () => {
  it("valide et convertit (vides → null, temps par quart de jour)", () => {
    const r = validerBrique({
      ...saisieBriqueVide("a0000000-0000-4000-8000-000000000001"),
      code: "atelier",
      libelle: "Atelier",
      objet: "Animer un atelier.",
      temps_type_jours: "0,75",
      classe_risque: "R2",
      niveau_autonomie_max: "N2",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge).toMatchObject({
        temps_type_jours: 0.75,
        moteur: null,
        agent: null,
        entrees: null,
      });
    }
  });

  it("refuse étape, code, objet, temps et autonomie incompatibles", () => {
    const r = validerBrique({
      ...saisieBriqueVide(),
      code: "x y",
      libelle: "",
      temps_type_jours: "0,3",
      classe_risque: "R3",
      niveau_autonomie_max: "N3",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "code",
        "etape_id",
        "libelle",
        "niveau_autonomie_max",
        "objet",
        "temps_type_jours",
      ]);
    }
    expect(niveauxAdmis("R0")).toEqual(["N0", "N1", "N2", "N3", "N4"]);
    expect(niveauxAdmis("R2")).toEqual(["N0", "N1", "N2"]);
  });
});

describe("dictionnaire", () => {
  it("facteur du cabinet : valeurs « code : libellé », bornes numériques", () => {
    const r = construireFacteur({
      ...saisieFacteurVide(),
      code: "certification",
      libelle: "Certification",
      valeurs: ["bio : Certifiée bio", "", "equitable", ""].join(String.fromCharCode(10)),
    });
    expect(r).toEqual({
      ok: true,
      charge: {
        code: "certification",
        libelle: "Certification",
        type: "enumeration",
        porte_par: "mission",
        valeurs: [
          { code: "bio", libelle: "Certifiée bio" },
          { code: "equitable", libelle: "equitable" },
        ],
      },
    });
    const n = construireFacteur({
      ...saisieFacteurVide(),
      code: "ca",
      libelle: "CA",
      type: "nombre",
      min: "0",
      max: "10",
    });
    expect(n.ok && n.charge).toMatchObject({ min: 0, max: 10 });
    const ko = construireFacteur({
      ...saisieFacteurVide(),
      code: "X",
      libelle: "",
      valeurs: "Mauvais Code",
    });
    expect(ko.ok).toBe(false);
    if (!ko.ok) expect(Object.keys(ko.erreurs).sort()).toEqual(["code", "libelle", "valeurs"]);
    const bornes = construireFacteur({
      ...saisieFacteurVide(),
      code: "n",
      libelle: "N",
      type: "nombre",
      min: "a",
      max: "5",
    });
    expect(bornes.ok).toBe(false);
    const inverse = construireFacteur({
      ...saisieFacteurVide(),
      code: "n",
      libelle: "N",
      type: "nombre",
      min: "9",
      max: "5",
    });
    expect(inverse.ok).toBe(false);
  });
});

describe("divers", () => {
  it("code depuis un libellé, curseur, onglets selon les droits", () => {
    expect(codeDepuisLibelle("Écarts de perception (équipes)")).toBe(
      "ecarts_de_perception_equipes",
    );
    expect(lireCurseur("abc")).toBe("abc");
    expect(lireCurseur(["a"])).toBeNull();
    expect(lireCurseur("x".repeat(501))).toBeNull();
    expect(ongletsMethodes(["consultant"]).map((o) => o.id)).toEqual([
      "catalogue",
      "missions",
      "derogations",
      "dictionnaire",
      "comite",
    ]);
  });

  it("briques regroupées par étape dans l'ordre", () => {
    const g = briquesParEtape({
      etapes: [
        { id: "e2", code: "b", libelle: "B", description: null, ordre: 2 },
        { id: "e1", code: "a", libelle: "A", description: null, ordre: 1 },
      ],
      briques: [
        { id: "x", etape_id: "e1", ordre: 2, code: "x" },
        { id: "y", etape_id: "e1", ordre: 1, code: "y" },
      ] as never,
    });
    expect(g.map((x) => [x.etape.code, x.briques.map((b) => b.code)])).toEqual([
      ["a", ["y", "x"]],
      ["b", []],
    ]);
  });

  it("résumé des différences et messages d'erreur", () => {
    const vide = { ajoutes: [], retires: [], modifies: [] };
    const d: Differences = {
      identique: false,
      etapes: vide,
      briques: { ajoutes: ["n"], retires: ["r"], modifies: [{ code: "m", champs: ["libelle"] }] },
      elements: vide,
      rubriques: vide,
      regles: { ajoutes: ["bio"], retires: [], modifies: [] },
      cas_types: vide,
    };
    expect(resumeDifferences(d)).toEqual([
      "Briques — ajoutés : n ; retirés : r ; modifiés : m",
      "Règles — ajoutés : bio",
    ]);
    expect(resumeDifferences({ ...d, identique: true })).toEqual([]);
    expect(messageMethodes(new ErreurApi("VERSION_PUBLIEE", "x", 409))).toMatch(/nouvelle version/);
    expect(messageMethodes(new ErreurApi("ETAPE_INATTENDUE", "Pas la prochaine.", 409))).toBe(
      "Pas la prochaine.",
    );
    expect(messageMethodes(new ErreurApi("AUTRE", "x", 409))).toBeNull();
    expect(messageMethodes(new Error("x"))).toBeNull();
    for (const code of ["STANDARD_LECTURE_SEULE", "VARIANTE_EXISTANTE", "METHODE_DEJA_LIEE"]) {
      expect(messageMethodes(new ErreurApi(code, "x", 409))).toBeTruthy();
    }
  });
});

describe("contexte proposé depuis le dossier du client", () => {
  it("décrit la provenance des valeurs pré-remplies (date JJ/MM/AAAA, fiabilité)", () => {
    expect(
      texteSourcesDossier({
        sources: [
          { facteur: "effectif", libelle: "Effectif", date_effet: "2026-06-01", fiabilite: "B" },
          { facteur: "x", libelle: "Autre", date_effet: "inconnue", fiabilite: "" },
        ],
      }),
    ).toBe("Effectif au 01/06/2026, fiabilité B ; Autre au inconnue");
    expect(texteSourcesDossier({ sources: [] })).toBe("");
  });
});
