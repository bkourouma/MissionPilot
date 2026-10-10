import { describe, expect, it } from "vitest";
import { ErreurNotationAugmentee } from "./augmentee-erreurs";
import {
  controlerProposition,
  definitionDepuisSelection,
  dureeSelection,
  exigerItemValide,
  formulationPour,
  selectionnerItems,
  validerItemBanque,
  AIDE_LONGUEUR_MAX,
  ANCRAGE_LONGUEUR_MAX,
  FORMULATION_LONGUEUR_MAX,
  type ItemBanque,
  type ReglesSelection,
} from "./banque";

const LIBELLES = ["Inexistant", "Ponctuel", "En place", "Systématique", "Exemplaire"];

function item(code: string, surcharge: Partial<ItemBanque> = {}): ItemBanque {
  return {
    code,
    dimension: "pilotage",
    pratique: code,
    intitule: `Pratique ${code}`,
    echelle: { niveaux: 5, libelles: LIBELLES },
    ancrages: LIBELLES.map((_, i) => ({ niveau: i + 1, comportement: `Comportement ${i + 1}` })),
    formulations: [
      { public: "tous", texte: `Comment jugez-vous ${code} ?` },
      { public: "dirigeant", texte: `En tant que dirigeant, ${code} ?` },
    ],
    poids: 1,
    priorite: 1,
    dureeSecondes: 30,
    ...surcharge,
  };
}

const erreur = (code: string) => expect.objectContaining({ name: "ErreurNotationAugmentee", code });

describe("validerItemBanque (NOT-09)", () => {
  it("accepte un item complet : une échelle, un ancrage par niveau, des formulations", () => {
    expect(validerItemBanque(item("a"))).toEqual([]);
    expect(() => exigerItemValide(item("a"))).not.toThrow();
  });

  it("relève chaque anomalie avec son chemin", () => {
    const codes = (i: ItemBanque) => validerItemBanque(i).map((a) => a.code);
    expect(codes(item("A b"))).toContain("IDENTIFIANT_INVALIDE");
    expect(codes(item("a", { intitule: " " }))).toEqual(["INTITULE_VIDE"]);
    expect(codes(item("a", { echelle: { niveaux: 11, libelles: [] } }))).toEqual([
      "ECHELLE_INVALIDE",
    ]);
    expect(codes(item("a", { echelle: { niveaux: 5, libelles: ["x"] } }))).toEqual([
      "ECHELLE_INVALIDE",
    ]);
    expect(codes(item("a", { ancrages: [{ niveau: 1, comportement: "x" }] }))).toEqual([
      "ANCRAGE_MANQUANT",
    ]);
    expect(
      codes(
        item("a", {
          ancrages: [
            ...item("a").ancrages,
            { niveau: 6, comportement: "hors" },
            { niveau: 1, comportement: "double" },
          ],
        }),
      ),
    ).toEqual(["ANCRAGE_INVALIDE", "ANCRAGE_INVALIDE"]);
    expect(codes(item("a", { formulations: [] }))).toEqual(["FORMULATION_MANQUANTE"]);
    expect(
      codes(
        item("a", {
          formulations: [
            { public: "tous", texte: "x" },
            { public: "tous", texte: " " },
          ],
        }),
      ),
    ).toEqual(["FORMULATION_INVALIDE", "FORMULATION_INVALIDE"]);
    expect(codes(item("a", { poids: 0 }))).toEqual(["POIDS_INVALIDE"]);
    // Ancrage vide ou trop long, formulation trop longue : refusés (jamais tronqués en silence).
    expect(
      codes(
        item("a", {
          ancrages: item("a").ancrages.map((x, i) => (i === 0 ? { ...x, comportement: " " } : x)),
        }),
      ),
    ).toEqual(["ANCRAGE_INVALIDE"]);
    expect(
      codes(
        item("a", {
          ancrages: item("a").ancrages.map((x, i) =>
            i === 0 ? { ...x, comportement: "x".repeat(ANCRAGE_LONGUEUR_MAX + 1) } : x,
          ),
        }),
      ),
    ).toContain("ANCRAGE_INVALIDE");
    expect(
      codes(
        item("a", {
          ancrages: item("a").ancrages.map((x) => ({
            ...x,
            comportement: "y".repeat(AIDE_LONGUEUR_MAX / 4),
          })),
        }),
      ),
    ).toEqual(["ANCRAGE_INVALIDE"]);
    expect(
      codes(
        item("a", {
          formulations: [{ public: "tous", texte: "x".repeat(FORMULATION_LONGUEUR_MAX + 1) }],
        }),
      ),
    ).toEqual(["FORMULATION_INVALIDE"]);
    // Étalonnage : facultatif, validé quand il est fourni.
    expect(
      codes(item("a", { etalonnage: { echantillon: 12, moyenne: 3.2, ecartType: 0.8 } })),
    ).toEqual([]);
    expect(codes(item("a", { etalonnage: { echantillon: -1, moyenne: 3, ecartType: 1 } }))).toEqual(
      ["ETALONNAGE_INVALIDE"],
    );
    expect(
      codes(item("a", { etalonnage: { echantillon: 1.5, moyenne: 9, ecartType: Number.NaN } })),
    ).toEqual(["ETALONNAGE_INVALIDE", "ETALONNAGE_INVALIDE"]);
    expect(codes(item("a", { priorite: 10 }))).toEqual(["PRIORITE_INVALIDE"]);
    expect(codes(item("a", { dureeSecondes: 2 }))).toEqual(["DUREE_INVALIDE"]);
    expect(() => exigerItemValide(item("a", { poids: -1 }))).toThrow(erreur("ITEM_INVALIDE"));
  });

  it("formulation du public, sinon « tous », sinon aucune", () => {
    expect(formulationPour(item("a"), "dirigeant")?.public).toBe("dirigeant");
    expect(formulationPour(item("a"), "equipe")?.public).toBe("tous");
    const sansTous = item("a", { formulations: [{ public: "manager", texte: "x" }] });
    expect(formulationPour(sansTous, "equipe")).toBeNull();
  });
});

describe("selectionnerItems : questionnaire adaptatif contrôlé (NOT-09)", () => {
  const banque: ItemBanque[] = [
    item("p1", { priorite: 1 }),
    item("p2", { priorite: 2, poids: 3 }),
    item("p3", { priorite: 2, poids: 1 }),
    item("p4", { pratique: "p1", priorite: 3 }),
    item("c1", { dimension: "couts", priorite: 1 }),
    item("c2", { dimension: "couts", priorite: 2, dureeSecondes: 300 }),
    item("x1", {
      dimension: "couts",
      priorite: 1,
      formulations: [{ public: "externe", texte: "Externe seulement" }],
    }),
  ];

  it("tour par tour entre dimensions, priorité puis poids, une question par pratique", () => {
    const s = selectionnerItems(banque, { public: "dirigeant", maxParDimension: 3 });
    expect(s.items.map((i) => i.code)).toEqual(["c1", "p1", "c2", "p2", "p3"]);
    expect(s.items[1]?.formulation.public).toBe("dirigeant");
    expect(s.ecartes).toEqual([
      { code: "p4", raison: "pratique_deja_couverte" },
      { code: "x1", raison: "sans_formulation" },
    ]);
    expect(s.dureeTotaleSecondes).toBe(30 * 4 + 300);
    expect(dureeSelection(s.items)).toBe(s.dureeTotaleSecondes);
    expect(s.couverture).toEqual([
      { dimension: "couts", items: 2, disponibles: 2 },
      { dimension: "pilotage", items: 3, disponibles: 4 },
    ]);
  });

  it("plafond par dimension, budget de temps, exclusions, pratiques connues, périmètre", () => {
    const s = selectionnerItems(banque, {
      public: "equipe",
      dimensions: ["pilotage", "inconnue"],
      maxParDimension: 1,
      dureeMaxSecondes: 60,
      exclure: ["p2"],
      pratiquesConnues: ["p3"],
    });
    expect(s.items.map((i) => i.code)).toEqual(["p1"]);
    expect(s.items[0]?.formulation.public).toBe("tous");
    expect(s.ecartes).toEqual(
      expect.arrayContaining([
        { code: "c1", raison: "dimension_non_demandee" },
        { code: "p2", raison: "exclu" },
        { code: "p3", raison: "pratique_connue" },
        { code: "p4", raison: "pratique_deja_couverte" },
      ]),
    );
    const budget = selectionnerItems(banque, {
      public: "dirigeant",
      maxParDimension: 5,
      dureeMaxSecondes: 100,
    });
    expect(budget.ecartes).toContainEqual({ code: "c2", raison: "duree_depassee" });
    const plafond = selectionnerItems(banque, { public: "dirigeant", maxParDimension: 1 });
    expect(plafond.ecartes).toContainEqual({ code: "p2", raison: "plafond_dimension" });
  });

  it("mêmes entrées, même sortie, quel que soit l'ordre de la banque", () => {
    const regles = { public: "dirigeant" as const, maxParDimension: 2 };
    expect(selectionnerItems([...banque].reverse(), regles)).toEqual(
      selectionnerItems(banque, regles),
    );
  });

  it("refuse règles et banque invalides", () => {
    expect(() =>
      selectionnerItems(banque, { public: "autre" as never, maxParDimension: 1 }),
    ).toThrow(erreur("OPTIONS_INVALIDES"));
    expect(() => selectionnerItems(banque, { public: "tous", maxParDimension: 0 })).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
    expect(() =>
      selectionnerItems(banque, { public: "tous", maxParDimension: 1, dureeMaxSecondes: 1 }),
    ).toThrow(erreur("OPTIONS_INVALIDES"));
    expect(() =>
      selectionnerItems([item("a"), item("a")], { public: "tous", maxParDimension: 1 }),
    ).toThrow(erreur("ITEM_INVALIDE"));
    expect(() =>
      selectionnerItems([item("a", { poids: 0 })], { public: "tous", maxParDimension: 1 }),
    ).toThrow(ErreurNotationAugmentee);
  });
});

describe("controlerProposition : l'IA choisit et reformule DANS la banque", () => {
  const banque = [item("p1"), item("p2"), item("p3", { pratique: "p1" })];
  const regles: ReglesSelection = { public: "dirigeant", maxParDimension: 2, dureeMaxSecondes: 90 };

  it("accepte une proposition conforme et rend les formulations validées", () => {
    const items = controlerProposition(
      banque,
      [
        { code: "p1", public: "dirigeant" },
        { code: "p2", public: "tous" },
      ],
      regles,
    );
    expect(items.map((i) => [i.code, i.formulation.texte])).toEqual([
      ["p1", "En tant que dirigeant, p1 ?"],
      ["p2", "Comment jugez-vous p2 ?"],
    ]);
  });

  it("refuse item hors banque, doublon, pratique redondante, formulation non validée, plafonds", () => {
    const anomalies = (proposition: { code: string; public: string }[], r = regles) => {
      try {
        controlerProposition(banque, proposition as never, r);
        return [];
      } catch (e) {
        expect(e).toBeInstanceOf(ErreurNotationAugmentee);
        return (e as ErreurNotationAugmentee).details.map((d) => d.code);
      }
    };
    expect(anomalies([])).toEqual(["SELECTION_VIDE"]);
    expect(anomalies([{ code: "invente", public: "dirigeant" }])).toEqual(["ITEM_HORS_BANQUE"]);
    expect(
      anomalies([
        { code: "p1", public: "dirigeant" },
        { code: "p1", public: "dirigeant" },
      ]),
    ).toEqual(["ITEM_EN_DOUBLE"]);
    expect(
      anomalies([
        { code: "p1", public: "dirigeant" },
        { code: "p3", public: "dirigeant" },
      ]),
    ).toEqual(["PRATIQUE_EN_DOUBLE"]);
    expect(anomalies([{ code: "p1", public: "manager" }])).toEqual(["FORMULATION_HORS_BANQUE"]);
    // Les règles d'exclusion et de pratiques connues s'appliquent comme à `selectionnerItems`.
    expect(
      anomalies([{ code: "p1", public: "dirigeant" }], { ...regles, exclure: ["p1"] }),
    ).toEqual(["ITEM_EXCLU"]);
    expect(
      anomalies([{ code: "p2", public: "dirigeant" }], { ...regles, pratiquesConnues: ["p2"] }),
    ).toEqual(["PRATIQUE_CONNUE"]);
    expect(
      anomalies([{ code: "p1", public: "dirigeant" }], { ...regles, dimensions: ["x"] }),
    ).toEqual(["DIMENSION_NON_DEMANDEE"]);
    expect(
      anomalies(
        [
          { code: "p1", public: "dirigeant" },
          { code: "p2", public: "dirigeant" },
        ],
        { ...regles, maxParDimension: 1, dureeMaxSecondes: 30 },
      ),
    ).toEqual(["PLAFOND_DIMENSION", "DUREE_DEPASSEE"]);
  });
});

describe("definitionDepuisSelection", () => {
  const banque = [item("p1"), item("c1", { dimension: "couts" })];

  it("construit une définition valide : une section par dimension, des questions de Likert", () => {
    const selection = selectionnerItems(banque, { public: "dirigeant", maxParDimension: 2 });
    const def = definitionDepuisSelection(banque, selection.items, {
      id: "selection",
      titre: "Questionnaire adaptatif",
      libellesDimensions: { couts: "Coûts" },
    });
    expect(def.sections.map((s) => [s.id, s.titre])).toEqual([
      ["couts", "Coûts"],
      ["pilotage", "pilotage"],
    ]);
    const q = def.sections[0]?.questions[0];
    expect(q).toMatchObject({ id: "c1", type: "likert", points: 5, obligatoire: true });
    expect(q?.aide).toContain("1 : Comportement 1");
  });

  it("ne tronque jamais en silence : formulation ou ancrages trop longs refusés", () => {
    const longue = [item("p1")];
    const texteLong = "x".repeat(FORMULATION_LONGUEUR_MAX + 1);
    expect(() =>
      definitionDepuisSelection(
        longue,
        [
          {
            code: "p1",
            dimension: "pilotage",
            pratique: "p1",
            formulation: { public: "tous", texte: texteLong },
            dureeSecondes: 30,
          },
        ],
        { id: "s", titre: "t" },
      ),
    ).toThrow(erreur("SELECTION_INVALIDE"));
    const ancragesLongs = [
      item("p1", {
        ancrages: item("p1").ancrages.map((a) => ({ ...a, comportement: "y".repeat(300) })),
      }),
    ];
    expect(() =>
      definitionDepuisSelection(
        ancragesLongs,
        [
          {
            code: "p1",
            dimension: "pilotage",
            pratique: "p1",
            formulation: { public: "tous", texte: "Question ?" },
            dureeSecondes: 30,
          },
        ],
        { id: "s", titre: "t" },
      ),
    ).toThrow(erreur("SELECTION_INVALIDE"));
    // À la limite, le texte passe intact.
    const exact = "z".repeat(FORMULATION_LONGUEUR_MAX);
    const def = definitionDepuisSelection(
      longue,
      [
        {
          code: "p1",
          dimension: "pilotage",
          pratique: "p1",
          formulation: { public: "tous", texte: exact },
          dureeSecondes: 30,
        },
      ],
      { id: "s", titre: "t" },
    );
    expect(def.sections[0]?.questions[0]?.libelle).toBe(exact);
  });

  it("refuse un item hors banque et une définition invalide", () => {
    const hors = [
      {
        code: "z",
        dimension: "d",
        pratique: "z",
        formulation: { public: "tous" as const, texte: "x" },
        dureeSecondes: 5,
      },
    ];
    expect(() => definitionDepuisSelection(banque, hors, { id: "s", titre: "t" })).toThrow(
      erreur("SELECTION_INVALIDE"),
    );
    const selection = selectionnerItems(banque, { public: "dirigeant", maxParDimension: 2 });
    expect(() =>
      definitionDepuisSelection(banque, selection.items, { id: "S S", titre: "t" }),
    ).toThrow(erreur("SELECTION_INVALIDE"));
  });
});
