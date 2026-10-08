import { describe, expect, it } from "vitest";
import {
  NOEUDS_CONDITION_MAX,
  PROFONDEUR_CONDITION_MAX,
  REGLES_MODULATION_MAX,
  validerContexteModulation,
  validerFacteursContexte,
  validerReglesModulation,
  type ConditionModulation,
  type RegleModulation,
} from "./index";
import { FACTEURS, PME_FAMILIALE_CACAO, REFERENTIEL, REGLES } from "./jeu-exemple.test-utils";

const codes = (regles: readonly RegleModulation[], referentiel = REFERENTIEL) =>
  validerReglesModulation(regles, referentiel).anomalies.map((a) => [a.code, a.chemin]);

const vrai: ConditionModulation = {
  type: "comparaison",
  facteur: "effectif",
  comparateur: "superieur",
  valeur: 0,
};

const regle = (code: string, extra: Partial<RegleModulation> = {}): RegleModulation => ({
  code,
  priorite: 1,
  condition: vrai,
  effets: [{ type: "activer_item", item: "item_succession" }],
  ...extra,
});

describe("validerReglesModulation", () => {
  it("accepte le jeu d'exemple", () => {
    expect(validerReglesModulation(REGLES, REFERENTIEL)).toEqual({ valide: true, anomalies: [] });
  });

  it("signale facteur inconnu, comparateur incompatible et valeur hors des valeurs permises", () => {
    const anomalies = codes([
      regle("a", {
        condition: {
          type: "tous",
          conditions: [
            { type: "comparaison", facteur: "inconnu", comparateur: "egal", valeur: 1 },
            { type: "comparaison", facteur: "agricole", comparateur: "superieur", valeur: 1 },
            {
              type: "comparaison",
              facteur: "actionnariat",
              comparateur: "egal",
              valeur: "cooperative",
            },
            {
              type: "comparaison",
              facteur: "filieres",
              comparateur: "contient",
              valeur: ["cacao", "mil"],
            },
            { type: "comparaison", facteur: "effectif", comparateur: "dans", valeur: ["dix"] },
            { type: "comparaison", facteur: "agricole", comparateur: "egal", valeur: "oui" },
            { type: "comparaison", facteur: "effectif", comparateur: "egal", valeur: true },
            { type: "comparaison", facteur: "filieres", comparateur: "egal", valeur: "cacao" },
          ],
        },
      }),
    ]);
    expect(anomalies).toEqual([
      ["FACTEUR_INCONNU", "regles[0].condition.conditions[0].facteur"],
      ["COMPARATEUR_INCOMPATIBLE", "regles[0].condition.conditions[1].comparateur"],
      ["VALEUR_INVALIDE", "regles[0].condition.conditions[2].valeur"],
      ["VALEUR_INVALIDE", "regles[0].condition.conditions[3].valeur"],
      ["VALEUR_INVALIDE", "regles[0].condition.conditions[4].valeur"],
      ["VALEUR_INVALIDE", "regles[0].condition.conditions[5].valeur"],
      ["VALEUR_INVALIDE", "regles[0].condition.conditions[6].valeur"],
      ["COMPARATEUR_INCOMPATIBLE", "regles[0].condition.conditions[7].comparateur"],
    ]);
  });

  it("signale les références inconnues quand le référentiel les fournit", () => {
    const r = regle("a", {
      condition: { type: "brique_active", brique: "fantome" },
      effets: [
        { type: "activer_brique", brique: "b_inconnue" },
        { type: "retirer_item", item: "i_inconnu" },
        { type: "benchmark", cible: "c_inconnue", choix: "ch_inconnu" },
        { type: "recommandation_candidate", recommandation: "r_inconnue" },
        { type: "seuil", cible: "c2", valeur: 1 },
      ],
    });
    expect(codes([r])).toEqual([
      ["REFERENCE_INCONNUE", "regles[0].condition.brique"],
      ["REFERENCE_INCONNUE", "regles[0].effets[0].brique"],
      ["REFERENCE_INCONNUE", "regles[0].effets[1].item"],
      ["REFERENCE_INCONNUE", "regles[0].effets[2].cible"],
      ["REFERENCE_INCONNUE", "regles[0].effets[2].choix"],
      ["REFERENCE_INCONNUE", "regles[0].effets[3].recommandation"],
      ["REFERENCE_INCONNUE", "regles[0].effets[4].cible"],
    ]);
    // Sans ensemble dans le référentiel, pas de contrôle.
    expect(codes([r], { facteurs: FACTEURS })).toEqual([]);
  });

  it("signale conflit interne (erreur), conflit de même priorité et règle sans effet (avertissements)", () => {
    const v = validerReglesModulation(
      [
        regle("a", {
          effets: [
            { type: "activer_brique", brique: "atelier_unique" },
            { type: "retirer_brique", brique: "atelier_unique" },
            { type: "relever_classe_risque", cible: "rapport_financier", classe: "R1" },
            { type: "relever_classe_risque", cible: "rapport_financier", classe: "R3" },
          ],
        }),
        regle("b", { effets: [{ type: "ponderation", cible: "dim_operations", valeur: 2 }] }),
        regle("c", { effets: [{ type: "ponderation", cible: "dim_operations", valeur: 3 }] }),
        regle("d", {
          priorite: 2,
          effets: [{ type: "ponderation", cible: "dim_operations", valeur: 4 }],
        }),
        regle("e", { effets: [] }),
      ],
      REFERENTIEL,
    );
    expect(v.valide).toBe(false);
    expect(v.anomalies.map((a) => [a.code, a.gravite, a.regle])).toEqual([
      ["CONFLIT_INTERNE", "erreur", "a"],
      ["REGLE_SANS_EFFET", "avertissement", "e"],
      ["CONFLIT_MEME_PRIORITE", "avertissement", "b"],
    ]);
    expect(v.anomalies[2]!.message).toContain("b, c");
    // Seuls des avertissements : le jeu reste activable.
    expect(
      validerReglesModulation(
        [
          regle("b", { effets: [{ type: "ponderation", cible: "dim_operations", valeur: 2 }] }),
          regle("c", { effets: [{ type: "ponderation", cible: "dim_operations", valeur: 3 }] }),
        ],
        REFERENTIEL,
      ).valide,
    ).toBe(true);
  });

  it("signale les cycles de dépendances", () => {
    const v = validerReglesModulation(
      [
        regle("a", {
          condition: { type: "brique_active", brique: "atelier_unique" },
          effets: [{ type: "activer_brique", brique: "reconstitution_ca" }],
        }),
        regle("b", {
          condition: { type: "brique_active", brique: "reconstitution_ca" },
          effets: [{ type: "retirer_brique", brique: "atelier_unique" }],
          active: false,
        }),
      ],
      REFERENTIEL,
    );
    expect(v.anomalies.map((a) => [a.code, a.regle, a.message])).toEqual([
      ["CYCLE", "a", "Dépendance circulaire entre règles : a → b."],
    ]);
  });

  it("signale les erreurs de forme sans aller plus loin pour la règle fautive", () => {
    const anomalies = codes([
      regle("a", { priorite: 1.5, active: "oui" as never, libelle: 3 as never }),
      regle("a"),
      regle(" b"),
      null as never,
      regle("c", { condition: { type: "tous", conditions: [] } }),
      regle("d", { condition: { type: "inconnu" } as never }),
      regle("e", { condition: { type: "non", condition: null as never } }),
      regle("f", {
        condition: { type: "comparaison", facteur: "", comparateur: "environ" as never, valeur: 1 },
      }),
      regle("g", {
        condition: {
          type: "comparaison",
          facteur: "effectif",
          comparateur: "superieur",
          valeur: "10",
        },
      }),
      regle("h", { condition: { type: "brique_active", brique: "" } }),
      regle("i", { effets: "x" as never }),
      regle("j", {
        effets: [
          { type: "inconnu" } as never,
          { type: "activer_brique", brique: "" },
          { type: "activer_item", item: "" },
          { type: "ponderation", cible: "dim_operations", valeur: -1 },
          { type: "seuil", cible: "dim_operations", valeur: Number.NaN },
          { type: "seuil", cible: "", valeur: 1 },
          { type: "gabarit", cible: "questionnaire", choix: "" },
          { type: "recommandation_candidate", recommandation: "" },
          { type: "relever_classe_risque", cible: "rapport_financier", classe: "R9" as never },
        ],
      }),
    ]);
    expect(anomalies).toEqual([
      ["PRIORITE_INVALIDE", "regles[0].priorite"],
      ["REGLE_INVALIDE", "regles[0].active"],
      ["REGLE_INVALIDE", "regles[0].libelle"],
      ["CODE_EN_DOUBLE", "regles[1].code"],
      ["CODE_INVALIDE", "regles[2].code"],
      ["REGLE_INVALIDE", "regles[3]"],
      ["CONDITION_INVALIDE", "regles[4].condition.conditions"],
      ["CONDITION_INVALIDE", "regles[5].condition.type"],
      ["CONDITION_INVALIDE", "regles[6].condition.condition"],
      ["CONDITION_INVALIDE", "regles[7].condition.facteur"],
      ["CONDITION_INVALIDE", "regles[7].condition.comparateur"],
      ["VALEUR_INVALIDE", "regles[8].condition.valeur"],
      ["CONDITION_INVALIDE", "regles[9].condition.brique"],
      ["EFFET_INVALIDE", "regles[10].effets"],
      ["EFFET_INVALIDE", "regles[11].effets[0]"],
      ["EFFET_INVALIDE", "regles[11].effets[1]"],
      ["EFFET_INVALIDE", "regles[11].effets[2]"],
      ["EFFET_INVALIDE", "regles[11].effets[3]"],
      ["EFFET_INVALIDE", "regles[11].effets[4]"],
      ["EFFET_INVALIDE", "regles[11].effets[5]"],
      ["EFFET_INVALIDE", "regles[11].effets[6]"],
      ["EFFET_INVALIDE", "regles[11].effets[7]"],
      ["EFFET_INVALIDE", "regles[11].effets[8]"],
    ]);
  });

  it("contrôle la forme des valeurs comparées selon le comparateur", () => {
    const comparaison = (comparateur: string, valeur: unknown) =>
      regle("a", {
        condition: { type: "comparaison", facteur: "filieres", comparateur, valeur } as never,
      });
    expect(codes([comparaison("dans", [])])[0]![0]).toBe("VALEUR_INVALIDE");
    expect(codes([comparaison("dans", ["a", 1])])[0]![0]).toBe("VALEUR_INVALIDE");
    expect(codes([comparaison("contient", [1])])[0]![0]).toBe("VALEUR_INVALIDE");
    expect(codes([comparaison("egal", ["cacao"])])[0]![0]).toBe("VALEUR_INVALIDE");
    expect(codes([comparaison("contient", ["cacao", "btp"])])).toEqual([]);
    expect(codes([comparaison("dans", ["cacao"])])).toEqual([]);
  });

  it("borne la complexité des conditions et le nombre de règles", () => {
    let profonde: ConditionModulation = vrai;
    for (let i = 0; i < PROFONDEUR_CONDITION_MAX; i += 1)
      profonde = { type: "non", condition: profonde };
    expect(codes([regle("a", { condition: profonde })])).toEqual([
      [
        "CONDITION_TROP_COMPLEXE",
        `regles[0].condition${".condition".repeat(PROFONDEUR_CONDITION_MAX)}`,
      ],
    ]);
    const large: ConditionModulation = {
      type: "au_moins_un",
      conditions: Array.from({ length: NOEUDS_CONDITION_MAX + 1 }, () => vrai),
    };
    expect(codes([regle("a", { condition: large })])).toEqual([
      ["CONDITION_TROP_COMPLEXE", `regles[0].condition.conditions[${NOEUDS_CONDITION_MAX - 1}]`],
    ]);
    const trop = Array.from({ length: REGLES_MODULATION_MAX + 1 }, (_, i) => regle(`r${i}`));
    expect(codes(trop)).toEqual([["REGLES_TROP_NOMBREUSES", "regles"]]);
    expect(codes("x" as never)).toEqual([["REGLE_INVALIDE", "regles"]]);
    expect(
      codes([
        regle("a", {
          effets: Array.from({ length: 51 }, () => ({
            type: "activer_item",
            item: "item_succession",
          })),
        }),
      ]),
    ).toEqual([["EFFET_INVALIDE", "regles[0].effets"]]);
  });
});

describe("validerFacteursContexte (STD-04)", () => {
  it("accepte les facteurs d'exemple et refuse les définitions mal formées", () => {
    expect(validerFacteursContexte(FACTEURS).valide).toBe(true);
    const v = validerFacteursContexte([
      { code: "", type: "booleen" },
      { code: "a", type: "texte" as never },
      { code: "b", type: "enumeration" },
      { code: "c", type: "booleen", valeurs: ["x"] },
      { code: "d", type: "liste", valeurs: ["x", "x"] },
      { code: "e", type: "booleen", min: 0 },
      { code: "f", type: "nombre", min: Number.POSITIVE_INFINITY },
      { code: "g", type: "nombre", min: 5, max: 1 },
      { code: "h", type: "nombre", min: 1, max: 5 },
      { code: "h", type: "booleen" },
    ]);
    expect(v.anomalies.map((a) => a.chemin)).toEqual([
      "facteurs[0]",
      "facteurs[1]",
      "facteurs[2]",
      "facteurs[3]",
      "facteurs[4]",
      "facteurs[5]",
      "facteurs[6]",
      "facteurs[7]",
      "facteurs[9]",
    ]);
    expect(v.anomalies.every((a) => a.code === "FACTEUR_DEFINITION_INVALIDE")).toBe(true);
    expect(validerFacteursContexte("x" as never).anomalies[0]!.chemin).toBe("facteurs");
  });
});

describe("validerContexteModulation (STD-04)", () => {
  it("accepte un contexte conforme, y compris des facteurs non renseignés", () => {
    expect(validerContexteModulation(FACTEURS, PME_FAMILIALE_CACAO).valide).toBe(true);
    expect(
      validerContexteModulation(FACTEURS, { effectif: null, agricole: undefined }).valide,
    ).toBe(true);
  });

  it("signale facteurs inconnus et valeurs hors type, hors bornes ou hors valeurs permises", () => {
    const facteurs = [...FACTEURS, { code: "age", type: "nombre" as const, min: 0, max: 200 }];
    const v = validerContexteModulation(facteurs, {
      zzz: 1,
      effectif: -1,
      age: 201,
      agricole: "oui",
      actionnariat: "cooperative",
      filieres: ["cacao", "cacao"],
      fiabilite_comptes: 3,
      part_especes: "forte",
    });
    expect(v.anomalies.map((a) => [a.code, a.chemin])).toEqual([
      ["VALEUR_INVALIDE", "contexte.actionnariat"],
      ["VALEUR_INVALIDE", "contexte.age"],
      ["VALEUR_INVALIDE", "contexte.agricole"],
      ["VALEUR_INVALIDE", "contexte.effectif"],
      ["VALEUR_INVALIDE", "contexte.fiabilite_comptes"],
      ["VALEUR_INVALIDE", "contexte.filieres"],
      ["FACTEUR_INCONNU", "contexte.zzz"],
    ]);
    expect(validerContexteModulation(FACTEURS, null as never).anomalies[0]!.chemin).toBe(
      "contexte",
    );
    expect(
      validerContexteModulation(facteurs, { age: 150, filieres: ["btp", "banque"] }).valide,
    ).toBe(true);
  });
});
