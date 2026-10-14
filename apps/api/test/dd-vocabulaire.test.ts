import { describe, expect, it } from "vitest";
import * as engines from "@missionpilot/engines";
import * as shared from "@missionpilot/shared";

/*
 * Égalité des vocabulaires fermés du service #2 entre `packages/shared` (source de vérité des
 * schémas) et `packages/engines` (qui n'importe pas `shared`) : SPEC-3b §3.4.
 */

describe("vocabulaires de la due diligence : shared = engines", () => {
  const listes: [string, readonly string[], readonly string[]][] = [
    ["types d'opération", shared.TYPES_OPERATION_DD, engines.TYPES_OPERATION_DD],
    ["analyses", shared.ANALYSES_DD, engines.ANALYSES_DD],
    ["familles de risque", shared.FAMILLES_RISQUE_DD, engines.FAMILLES_RISQUE_DD],
    ["niveaux de risque", shared.NIVEAUX_RISQUE_DD, engines.NIVEAUX_RISQUE_DD],
    ["verdicts", shared.VERDICTS_DD, engines.VERDICTS_DD],
    [
      "méthodes de dimensionnement",
      shared.METHODES_DIMENSIONNEMENT,
      engines.METHODES_DIMENSIONNEMENT,
    ],
    ["recommandations", shared.RECOMMANDATIONS_NOTE, engines.RECOMMANDATIONS_NOTE],
    ["variantes de la note", shared.VARIANTES_NOTE, engines.VARIANTES_NOTE],
    ["statuts d'action", shared.STATUTS_ACTION_100J, engines.STATUTS_ACTION_100J],
    ["niveaux E&S", shared.NIVEAUX_ES, engines.NIVEAUX_ES],
    ["thèmes E&S", shared.THEMES_ES, engines.THEMES_ES],
  ];

  for (const [nom, a, b] of listes) {
    it(nom, () => expect([...a]).toEqual([...b]));
  }

  it("catégories de chaque analyse", () => {
    for (const analyse of shared.ANALYSES_DD) {
      expect([...shared.CATEGORIES_ANALYSE_DD[analyse]]).toEqual([
        ...engines.CATEGORIES_ANALYSE_DD[analyse],
      ]);
    }
  });

  it("paramètres de dimensionnement par méthode (codes et unités)", () => {
    expect(shared.PARAMETRES_DIMENSIONNEMENT.descendant.map((p) => [p.code, p.unite])).toEqual(
      engines.PARAMETRES_DESCENDANT.map((p) => [p.code, p.unite]),
    );
    expect(shared.PARAMETRES_DIMENSIONNEMENT.ascendant.map((p) => [p.code, p.unite])).toEqual(
      engines.PARAMETRES_ASCENDANT.map((p) => [p.code, p.unite]),
    );
  });

  it("codes bloquants et avertissements de la note : tous couverts par un libellé français", () => {
    for (const c of shared.CODES_BLOQUANTS_NOTE)
      expect(shared.CODE_BLOQUANT_NOTE_LIBELLES[c]).toBeTruthy();
    for (const c of shared.CODES_AVERTISSEMENTS_NOTE)
      expect(shared.CODE_AVERTISSEMENT_NOTE_LIBELLES[c]).toBeTruthy();
  });

  it("la fonction SQL dd_categorie_valide reprend les catégories (voir dd-base) et les mêmes valeurs ici", () => {
    expect(shared.estCategorieAnalyseDd("pestel", "juridique")).toBe(true);
    expect(engines.estCategorieAnalyseDd("pestel", "forces")).toBe(false);
  });

  it("les mots d'un mot-clé se comptent comme le moteur de filtrage les lit (normaliserTexteDd)", () => {
    for (const t of [
      "Café  d'Abidjan",
      "c++",
      "---",
      "  ",
      "L'État 24h/24",
      "あいう えお",
      "Ça va ?",
    ]) {
      const n = engines.normaliserTexteDd(t);
      expect(shared.motsDeFiltrage(t), t).toEqual(n === "" ? [] : n.split(" "));
    }
  });
});
