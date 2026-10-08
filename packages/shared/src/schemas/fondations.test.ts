import { describe, expect, it } from "vitest";
import {
  CLASSE_RISQUE_LIBELLES,
  CLASSES_RISQUE,
  classeRisqueSchema,
  contexteModulationSchema,
  definitionFacteurContexteSchema,
  effetModulationSchema,
  fiabilitePreuveSchema,
  imbricationAuPlus,
  jeuReglesModulationSchema,
  NIVEAU_AUTONOMIE_LIBELLES,
  NIVEAUX_AUTONOMIE,
  niveauAutonomieSchema,
  PROFONDEUR_CONDITION_MAX,
  regleModulationSchema,
  sensPreuveSchema,
  TYPE_SOURCE_PREUVE_LIBELLES,
  TYPES_SOURCE_PREUVE,
  typeSourcePreuveSchema,
  valeurCompareeAdmise,
  type ConditionModulationApi,
} from "../index";

const regle = {
  code: "petite_entreprise",
  priorite: 10,
  condition: {
    type: "tous",
    conditions: [
      { type: "comparaison", facteur: "effectif", comparateur: "inferieur", valeur: 20 },
      { type: "non", condition: { type: "brique_active", brique: "atelier_unique" } },
      { type: "comparaison", facteur: "filieres", comparateur: "contient", valeur: ["cacao"] },
    ],
  },
  effets: [
    { type: "activer_brique", brique: "atelier_unique" },
    { type: "ponderation", cible: "dim_operations", valeur: 1.5 },
    { type: "relever_classe_risque", cible: "rapport", classe: "R3" },
    { type: "gabarit", cible: "questionnaire", choix: "essentiel" },
  ],
};

describe("énumérations de la vague 1", () => {
  it("classes de risque, niveaux d'autonomie, fiabilités, sources et sens", () => {
    expect(classeRisqueSchema.safeParse("R3").success).toBe(true);
    expect(classeRisqueSchema.safeParse("R4").success).toBe(false);
    expect(niveauAutonomieSchema.safeParse("N4").success).toBe(true);
    expect(niveauAutonomieSchema.safeParse("N5").success).toBe(false);
    expect(fiabilitePreuveSchema.safeParse("D").success).toBe(true);
    expect(fiabilitePreuveSchema.safeParse("E").success).toBe(false);
    expect(typeSourcePreuveSchema.safeParse("donnee_externe").success).toBe(true);
    expect(sensPreuveSchema.safeParse("neutre").success).toBe(false);
    for (const c of CLASSES_RISQUE) expect(CLASSE_RISQUE_LIBELLES[c]).toBeTruthy();
    for (const n of NIVEAUX_AUTONOMIE) expect(NIVEAU_AUTONOMIE_LIBELLES[n]).toBeTruthy();
    for (const t of TYPES_SOURCE_PREUVE) expect(TYPE_SOURCE_PREUVE_LIBELLES[t]).toBeTruthy();
  });
});

describe("facteurs de contexte", () => {
  it("définitions typées et strictes", () => {
    expect(
      definitionFacteurContexteSchema.safeParse({ code: "agricole", type: "booleen" }).success,
    ).toBe(true);
    expect(
      definitionFacteurContexteSchema.safeParse({
        code: "effectif",
        type: "nombre",
        min: 0,
        max: 10,
      }).success,
    ).toBe(true);
    expect(
      definitionFacteurContexteSchema.safeParse({
        code: "effectif",
        type: "nombre",
        min: 10,
        max: 0,
      }).success,
    ).toBe(false);
    expect(
      definitionFacteurContexteSchema.safeParse({
        code: "pays",
        type: "enumeration",
        valeurs: ["ci", "sn"],
      }).success,
    ).toBe(true);
    expect(
      definitionFacteurContexteSchema.safeParse({ code: "pays", type: "enumeration", valeurs: [] })
        .success,
    ).toBe(false);
    expect(
      definitionFacteurContexteSchema.safeParse({ code: "f", type: "liste", valeurs: ["a", "a"] })
        .success,
    ).toBe(false);
    expect(
      definitionFacteurContexteSchema.safeParse({
        code: "agricole",
        type: "booleen",
        valeurs: ["x"],
      }).success,
    ).toBe(false);
    expect(
      definitionFacteurContexteSchema.safeParse({ code: "Pays", type: "booleen" }).success,
    ).toBe(false);
  });

  it("contexte : valeurs typées, null pour non renseigné", () => {
    expect(
      contexteModulationSchema.safeParse({
        effectif: 12,
        agricole: true,
        pays: "ci",
        filieres: ["cacao"],
        secteur: null,
      }).success,
    ).toBe(true);
    expect(contexteModulationSchema.safeParse({ effectif: Number.NaN }).success).toBe(false);
    expect(contexteModulationSchema.safeParse({ "Mauvais Code": 1 }).success).toBe(false);
    const trop = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}`, 1]));
    expect(contexteModulationSchema.safeParse(trop).success).toBe(false);
  });
});

describe("règles de modulation", () => {
  it("accepte une règle bien formée, identique en sortie", () => {
    const r = regleModulationSchema.safeParse(regle);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(regle);
  });

  it("refuse champ inconnu, priorité invalide, effet inconnu ou mal typé", () => {
    expect(regleModulationSchema.safeParse({ ...regle, inconnu: 1 }).success).toBe(false);
    expect(regleModulationSchema.safeParse({ ...regle, priorite: 1.5 }).success).toBe(false);
    expect(regleModulationSchema.safeParse({ ...regle, priorite: 1001 }).success).toBe(false);
    expect(effetModulationSchema.safeParse({ type: "supprimer_tout" }).success).toBe(false);
    expect(
      effetModulationSchema.safeParse({ type: "ponderation", cible: "d", valeur: -1 }).success,
    ).toBe(false);
    expect(
      effetModulationSchema.safeParse({ type: "activer_brique", brique: "b", item: "i" }).success,
    ).toBe(false);
    expect(
      effetModulationSchema.safeParse({ type: "relever_classe_risque", cible: "c", classe: "R5" })
        .success,
    ).toBe(false);
  });

  it("refuse une valeur comparée incompatible avec le comparateur", () => {
    const avec = (comparateur: string, valeur: unknown) =>
      regleModulationSchema.safeParse({
        ...regle,
        condition: { type: "comparaison", facteur: "f", comparateur, valeur },
      }).success;
    expect(avec("superieur", "dix")).toBe(false);
    expect(avec("dans", "a")).toBe(false);
    expect(avec("dans", [])).toBe(false);
    expect(avec("contient", [1])).toBe(false);
    expect(avec("egal", ["a"])).toBe(false);
    expect(avec("egal", true)).toBe(true);
    expect(avec("dans", [1, 2])).toBe(true);
    expect(avec("contient", "a")).toBe(true);
    expect(valeurCompareeAdmise("contient", ["a"])).toBe(true);
  });

  it("borne la profondeur des conditions, y compris face à une entrée très imbriquée", () => {
    let profonde: ConditionModulationApi = { type: "brique_active", brique: "b" };
    for (let i = 0; i < PROFONDEUR_CONDITION_MAX - 1; i += 1) {
      profonde = { type: "non", condition: profonde };
    }
    expect(regleModulationSchema.safeParse({ ...regle, condition: profonde }).success).toBe(true);
    const tropProfonde = { type: "non", condition: profonde };
    expect(regleModulationSchema.safeParse({ ...regle, condition: tropProfonde }).success).toBe(
      false,
    );
    let hostile: unknown = { type: "brique_active", brique: "b" };
    for (let i = 0; i < 50_000; i += 1) hostile = { type: "non", condition: hostile };
    expect(regleModulationSchema.safeParse({ ...regle, condition: hostile }).success).toBe(false);
    expect(imbricationAuPlus({ a: [{ b: 1 }] }, 3)).toBe(true);
    expect(imbricationAuPlus({ a: [{ b: {} }] }, 3)).toBe(false);
  });

  it("borne le nombre de nœuds d'une condition", () => {
    const feuille = { type: "brique_active", brique: "b" };
    const large = { type: "au_moins_un", conditions: Array.from({ length: 100 }, () => feuille) };
    expect(regleModulationSchema.safeParse({ ...regle, condition: large }).success).toBe(false);
    const juste = { type: "au_moins_un", conditions: Array.from({ length: 99 }, () => feuille) };
    expect(regleModulationSchema.safeParse({ ...regle, condition: juste }).success).toBe(true);
  });

  it("jeu de règles : codes uniques", () => {
    expect(jeuReglesModulationSchema.safeParse([regle, { ...regle, code: "autre" }]).success).toBe(
      true,
    );
    const doublon = jeuReglesModulationSchema.safeParse([regle, regle]);
    expect(doublon.success).toBe(false);
    expect(doublon.error?.issues[0]?.path).toEqual([1, "code"]);
  });
});
