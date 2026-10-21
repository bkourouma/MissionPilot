import { describe, expect, it } from "vitest";
import { ErreurDossier } from "./erreurs";
import {
  PROFONDEUR_GROUPE_MAX,
  arrondirPoints,
  consoliderGroupe,
  convertirMontantGroupe,
  controlerNouvelleDetention,
  participationsEnVigueur,
  structureDepuisTete,
  structureGroupe,
  type EntiteGroupe,
  type EntreeConsolidation,
  type LienDetention,
} from "./groupe";

let compteur = 0;
function lien(
  detenteur: string,
  filiale: string,
  pointsBase: number,
  dateEffet = "2024-01-01",
  creeLe?: string,
): LienDetention {
  compteur += 1;
  return {
    detenteur,
    filiale,
    pointsBase,
    dateEffet,
    creeLe: creeLe ?? `2024-01-01T00:00:${String(compteur % 60).padStart(2, "0")}Z`,
  };
}

function code(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof ErreurDossier ? e.code : "AUTRE";
  }
  return undefined;
}

function nouveau(detenteur: string, filiale: string, pointsBase: number, dateEffet = "2024-01-01") {
  return { detenteur, filiale, pointsBase, dateEffet };
}

describe("arrondirPoints", () => {
  it("arrondit demi s'éloignant de zéro", () => {
    expect(arrondirPoints(5n, 10n)).toBe(1);
    expect(arrondirPoints(4n, 10n)).toBe(0);
    expect(arrondirPoints(-5n, 10n)).toBe(-1);
    expect(arrondirPoints(-4n, 10n)).toBe(0);
    expect(arrondirPoints(15n, 10n)).toBe(2);
    expect(arrondirPoints(-15n, 10n)).toBe(-2);
    expect(arrondirPoints(10n, 10n)).toBe(1);
  });
  it("refuse un dénominateur nul", () => {
    expect(code(() => arrondirPoints(1n, 0n))).toBe("DETENTION_INVALIDE");
  });
});

describe("participationsEnVigueur", () => {
  it("fin de détention, participation future et départage", () => {
    const liens = [
      lien("A", "B", 6000, "2024-01-01"),
      lien("A", "B", 0, "2025-01-01"),
      lien("A", "C", 3000, "2024-01-01"),
      lien("A", "C", 4000, "2026-01-01"),
      lien("D", "E", 1000, "2024-01-01", "2024-01-01T10:00:00Z"),
      lien("D", "E", 2000, "2024-01-01", "2024-01-01T11:00:00Z"),
      lien("D", "F", 100, "2024-01-01", "2024-01-01T10:00:00Z"),
      lien("D", "F", 200, "2024-01-01", "2024-01-01T10:00:00Z"),
    ];
    const r = (d: string) =>
      participationsEnVigueur(liens, d).map((l) => `${l.detenteur}${l.filiale}${l.pointsBase}`);
    expect(r("2024-06-01")).toEqual(["AB6000", "AC3000", "DE2000", "DF200"]);
    expect(r("2025-06-01")).toEqual(["AC3000", "DE2000", "DF200"]);
    expect(r("2026-06-01")).toEqual(["AC4000", "DE2000", "DF200"]);
    expect(r("2023-01-01")).toEqual([]);
  });
  it("horodatages illisibles : ordre d'entrée", () => {
    const liens = [
      { detenteur: "A", filiale: "B", pointsBase: 100, dateEffet: "2024-01-01", creeLe: "x" },
      { detenteur: "A", filiale: "B", pointsBase: 200, dateEffet: "2024-01-01", creeLe: "x" },
    ];
    expect(participationsEnVigueur(liens, "2024-02-01")[0]?.pointsBase).toBe(200);
  });
  it("date ou lien invalide", () => {
    expect(code(() => participationsEnVigueur([], "2024-02-30"))).toBe("DATE_INVALIDE");
    expect(code(() => participationsEnVigueur([lien("A", "B", 1.5)], "2024-02-01"))).toBe(
      "DETENTION_INVALIDE",
    );
    expect(code(() => participationsEnVigueur([lien("A", "B", 10, "nope")], "2024-02-01"))).toBe(
      "DETENTION_INVALIDE",
    );
    expect(code(() => participationsEnVigueur([lien("", "B", 10)], "2024-02-01"))).toBe(
      "DETENTION_INVALIDE",
    );
  });
});

describe("controlerNouvelleDetention", () => {
  it("accepte un lien valide", () => {
    expect(code(() => controlerNouvelleDetention([], nouveau("A", "B", 10_000)))).toBeUndefined();
  });
  it("auto-détention et entrées invalides", () => {
    expect(code(() => controlerNouvelleDetention([], nouveau("A", "A", 10)))).toBe(
      "DETENTION_SOI_MEME",
    );
    for (const p of [-1, 10_001, 1.5]) {
      expect(code(() => controlerNouvelleDetention([], nouveau("A", "B", p)))).toBe(
        "DETENTION_INVALIDE",
      );
    }
    expect(code(() => controlerNouvelleDetention([], nouveau("A", "B", 10, "2024-13-01")))).toBe(
      "DETENTION_INVALIDE",
    );
    expect(code(() => controlerNouvelleDetention([], nouveau("", "B", 10)))).toBe(
      "DETENTION_INVALIDE",
    );
  });
  it("profondeur : au plus 8 liens en chaîne, amont et aval compris", () => {
    const chaine = (n: number) =>
      Array.from({ length: n }, (_, i) => lien(`N${i}`, `N${i + 1}`, 10_000));
    // 7 liens existants + le 8e en bout de chaîne : accepté ; un 9e : refusé.
    expect(
      code(() => controlerNouvelleDetention(chaine(7), nouveau("N7", "N8", 10_000))),
    ).toBeUndefined();
    expect(code(() => controlerNouvelleDetention(chaine(8), nouveau("N8", "N9", 10_000)))).toBe(
      "DETENTION_TROP_PROFONDE",
    );
    // Lien posé AU MILIEU de deux chaînes (4 en amont, 4 en aval) : 4 + 1 + 4 = 9 > 8.
    const deux = [
      ...Array.from({ length: 4 }, (_, i) => lien(`H${i}`, `H${i + 1}`, 10_000)),
      ...Array.from({ length: 4 }, (_, i) => lien(`B${i}`, `B${i + 1}`, 10_000)),
    ];
    expect(code(() => controlerNouvelleDetention(deux, nouveau("H4", "B0", 10_000)))).toBe(
      "DETENTION_TROP_PROFONDE",
    );
    // 3 en amont + 1 + 4 en aval = 8 : accepté.
    expect(
      code(() => controlerNouvelleDetention(deux, nouveau("H3", "B0", 10_000))),
    ).toBeUndefined();
  });
  it("cycle direct, indirect et futur, avec le chemin dans le message", () => {
    const direct = [lien("A", "B", 100)];
    expect(code(() => controlerNouvelleDetention(direct, nouveau("B", "A", 10)))).toBe(
      "DETENTION_CYCLE",
    );
    const indirect = [lien("A", "B", 100), lien("B", "C", 100)];
    try {
      controlerNouvelleDetention(indirect, nouveau("C", "A", 10));
      expect.unreachable();
    } catch (e) {
      expect((e as ErreurDossier).code).toBe("DETENTION_CYCLE");
      expect((e as Error).message).toContain("C -> A -> B -> C");
    }
    const futur = [lien("A", "B", 100, "2030-01-01")];
    expect(code(() => controlerNouvelleDetention(futur, nouveau("B", "A", 10)))).toBe(
      "DETENTION_CYCLE",
    );
  });
  it("une détention terminée ne crée pas de cycle", () => {
    const liens = [lien("A", "B", 100, "2024-01-01"), lien("A", "B", 0, "2025-01-01")];
    expect(
      code(() => controlerNouvelleDetention(liens, nouveau("B", "A", 10, "2026-01-01"))),
    ).toBeUndefined();
  });
  it("dépassement de 100 %", () => {
    const liens = [lien("A", "C", 6000), lien("B", "C", 3000)];
    expect(code(() => controlerNouvelleDetention(liens, nouveau("D", "C", 1001)))).toBe(
      "DETENTION_SUPERIEURE_100",
    );
    expect(code(() => controlerNouvelleDetention(liens, nouveau("D", "C", 1000)))).toBeUndefined();
    // modifier la paire existante remplace sa participation
    expect(code(() => controlerNouvelleDetention(liens, nouveau("A", "C", 7000)))).toBeUndefined();
    expect(code(() => controlerNouvelleDetention(liens, nouveau("A", "C", 7001)))).toBe(
      "DETENTION_SUPERIEURE_100",
    );
  });
  it("fin de détention : exige une détention antérieure", () => {
    const liens = [lien("A", "B", 100, "2024-06-01")];
    expect(
      code(() => controlerNouvelleDetention(liens, nouveau("A", "B", 0, "2025-01-01"))),
    ).toBeUndefined();
    expect(code(() => controlerNouvelleDetention(liens, nouveau("A", "B", 0, "2024-01-01")))).toBe(
      "DETENTION_INVALIDE",
    );
    expect(code(() => controlerNouvelleDetention([], nouveau("A", "B", 0)))).toBe(
      "DETENTION_INVALIDE",
    );
  });
});

describe("structureGroupe", () => {
  const date = "2025-01-01";
  it("chaîne : détenteurs, filiales, tête, parts directes et cumulées", () => {
    const liens = [lien("T", "A", 8000), lien("A", "B", 5000), lien("B", "C", 2500)];
    const s = structureGroupe(liens, "A", date);
    expect(s.tete).toBe("T");
    expect(s.detenteurs).toEqual([
      { client: "T", niveau: 1, partDirecteBps: 8000, partCumuleeBps: 8000 },
    ]);
    expect(s.filiales).toEqual([
      { client: "B", niveau: 1, partDirecteBps: 5000, partCumuleeBps: 5000 },
      { client: "C", niveau: 2, partDirecteBps: null, partCumuleeBps: 1250 },
    ]);
    const arbre = structureDepuisTete(liens, "T", date);
    expect(arbre.racine).toBe("T");
    expect(arbre.detenteurs).toEqual([]);
    expect(arbre.tete).toBe("T");
    expect(arbre.filiales.map((n) => [n.client, n.partCumuleeBps])).toEqual([
      ["A", 8000],
      ["B", 4000],
      ["C", 1000],
    ]);
  });
  it("racine isolée : elle est sa propre tête", () => {
    expect(structureGroupe([], "X", date)).toEqual({
      racine: "X",
      detenteurs: [],
      filiales: [],
      tete: "X",
    });
  });
  it("losange : somme exacte des chemins", () => {
    // R -> A 60 %, R -> B 40 %, A -> D 50 %, B -> D 25 % : D = 30 % + 10 % = 40 %
    const liens = [
      lien("R", "A", 6000),
      lien("R", "B", 4000),
      lien("A", "D", 5000),
      lien("B", "D", 2500),
    ];
    const d = structureGroupe(liens, "R", date).filiales.find((n) => n.client === "D");
    expect(d).toEqual({ client: "D", niveau: 2, partDirecteBps: null, partCumuleeBps: 4000 });
  });
  it("arrondi final seulement, demi s'éloignant de zéro", () => {
    // 3333 x 3333 = 1110,8889 points -> 1111
    const s = structureGroupe([lien("R", "A", 3333), lien("A", "B", 3333)], "R", date);
    expect(s.filiales[1]?.partCumuleeBps).toBe(1111);
    // 1 x 5000 / 10000 = 0,5 -> 1
    const t = structureGroupe([lien("R", "A", 1), lien("A", "B", 5000)], "R", date);
    expect(t.filiales[1]?.partCumuleeBps).toBe(1);
    // 1 x 4999 / 10000 = 0,4999 -> 0
    const u = structureGroupe([lien("R", "A", 1), lien("A", "B", 4999)], "R", date);
    expect(u.filiales[1]?.partCumuleeBps).toBe(0);
  });
  it("plusieurs têtes possibles : la plus petite par ordre lexical", () => {
    const liens = [lien("Z", "R", 5000), lien("M", "R", 5000)];
    expect(structureGroupe(liens, "R", date).tete).toBe("M");
  });
  it("profondeur maximale acceptée, au-delà refusée", () => {
    const chaine = (n: number) =>
      Array.from({ length: n }, (_, i) => lien(`N${i}`, `N${i + 1}`, 10_000));
    const ok = structureGroupe(chaine(PROFONDEUR_GROUPE_MAX), "N0", date);
    expect(ok.filiales).toHaveLength(PROFONDEUR_GROUPE_MAX);
    expect(ok.filiales.at(-1)?.partCumuleeBps).toBe(10_000);
    expect(code(() => structureGroupe(chaine(PROFONDEUR_GROUPE_MAX + 1), "N0", date))).toBe(
      "DETENTION_TROP_PROFONDE",
    );
    expect(
      code(() =>
        structureGroupe(chaine(PROFONDEUR_GROUPE_MAX + 1), `N${PROFONDEUR_GROUPE_MAX + 1}`, date),
      ),
    ).toBe("DETENTION_TROP_PROFONDE");
  });
  it("un cycle injecté dans l'historique est refusé", () => {
    const liens = [lien("A", "B", 10_000), lien("B", "A", 10_000)];
    expect(code(() => structureGroupe(liens, "A", date))).toBe("DETENTION_TROP_PROFONDE");
  });
  it("tient compte de la date", () => {
    const liens = [lien("A", "B", 5000, "2024-01-01"), lien("A", "B", 0, "2024-06-01")];
    expect(structureGroupe(liens, "A", "2024-03-01").filiales).toHaveLength(1);
    expect(structureGroupe(liens, "A", "2024-07-01").filiales).toHaveLength(0);
  });
  it("déterministe quel que soit l'ordre d'entrée", () => {
    const liens = [
      lien("R", "A", 6000),
      lien("R", "B", 4000),
      lien("A", "D", 5000),
      lien("B", "D", 2500),
      lien("Z", "R", 9000),
    ];
    expect(structureGroupe([...liens].reverse(), "R", date)).toEqual(
      structureGroupe(liens, "R", date),
    );
  });
});

const montants = (o: Partial<EntiteGroupe["montants"]> = {}): EntiteGroupe["montants"] => ({
  actif: 1000,
  passif: 1000,
  charges: 400,
  produits: 600,
  resultat: 200,
  ...o,
});
const entite = (client: string, o: Partial<EntiteGroupe> = {}): EntiteGroupe => ({
  client,
  devise: "XOF",
  exercice: 2025,
  montants: montants(),
  fiabilitePoints: 800,
  visible: true,
  ...o,
});
const entree = (
  noeuds: { client: string; partCumuleeBps: number }[],
  entites: EntiteGroupe[],
): EntreeConsolidation => ({ devise: "XOF", exercice: 2025, noeuds, entites });

describe("consoliderGroupe", () => {
  it("intégrale au-delà de 50 %, proportionnelle sur toutes, marge sur sommes", () => {
    const r = consoliderGroupe(
      entree(
        [
          { client: "R", partCumuleeBps: 10_000 },
          { client: "A", partCumuleeBps: 6000 },
          { client: "B", partCumuleeBps: 5000 },
          { client: "C", partCumuleeBps: 2500 },
        ],
        [
          entite("R", {
            montants: montants({ produits: 1000, resultat: 100 }),
            fiabilitePoints: 1000,
          }),
          entite("A", {
            montants: montants({ produits: 500, resultat: 250 }),
            fiabilitePoints: 500,
          }),
          entite("B"),
          entite("C", {
            montants: montants({ produits: 400, resultat: 40 }),
            fiabilitePoints: null,
          }),
        ],
      ),
    );
    expect(r.partielle).toBe(false);
    expect(r.perimetre.inclus.map((i) => [i.client, i.controlee])).toEqual([
      ["R", true],
      ["A", true],
      ["B", false],
      ["C", false],
    ]);
    // intégrale : R + A (B, à 50 % pile, n'est pas contrôlée)
    expect(r.integrale.produits).toBe(1500);
    expect(r.integrale.resultat).toBe(350);
    expect(r.integrale.margeNetteBps).toBe(2333); // 350 / 1500 sur les sommes
    // proportionnelle : produits 1000 + 300 + 300 + 100 ; résultat 100 + 150 + 100 + 10
    expect(r.proportionnelle.produits).toBe(1700);
    expect(r.proportionnelle.resultat).toBe(360);
    expect(r.proportionnelle.margeNetteBps).toBe(2118);
    // fiabilité : (10000 x 1000 + 6000 x 500 + 5000 x 800) / 21000 = 809,52
    expect(r.fiabilite).toEqual({ moyennePonderee: 810, poids: "part_cumulee" });
  });
  it("exclusions : état absent, non visible, devise, exercice ; données non visibles absentes", () => {
    const r = consoliderGroupe(
      entree(
        [
          { client: "R", partCumuleeBps: 10_000 },
          { client: "A", partCumuleeBps: 6000 },
          { client: "B", partCumuleeBps: 6000 },
          { client: "C", partCumuleeBps: 6000 },
          { client: "D", partCumuleeBps: 6000 },
          { client: "E", partCumuleeBps: 0 },
        ],
        [
          entite("R"),
          entite("A", { visible: false, montants: montants({ actif: 999_999 }) }),
          entite("B", { devise: "USD" }),
          entite("C", { exercice: 2024 }),
        ],
      ),
    );
    expect(r.perimetre.exclus).toEqual([
      { client: "A", motif: "NON_VISIBLE" },
      { client: "B", motif: "DEVISE_DIFFERENTE" },
      { client: "C", motif: "EXERCICE_DIFFERENT" },
      { client: "D", motif: "ETAT_ABSENT" },
    ]);
    expect(r.partielle).toBe(true);
    expect(r.integrale.actif).toBe(1000);
    expect(r.proportionnelle.actif).toBe(1000);
    expect(JSON.stringify(r)).not.toContain("999999");
  });
  it("indicateur sans donnée : null, jamais 0", () => {
    const nul = { actif: null, passif: null, charges: null, produits: null, resultat: null };
    const r = consoliderGroupe(
      entree(
        [
          { client: "R", partCumuleeBps: 10_000 },
          { client: "A", partCumuleeBps: 3000 },
        ],
        [
          entite("R", { montants: nul, fiabilitePoints: null }),
          entite("A", { montants: montants({ actif: 100 }) }),
        ],
      ),
    );
    expect(r.integrale).toEqual({
      actif: null,
      passif: null,
      charges: null,
      produits: null,
      resultat: null,
      margeNetteBps: null,
    });
    expect(r.proportionnelle.actif).toBe(30);
    expect(r.proportionnelle.produits).toBe(180);
    expect(r.fiabilite.moyennePonderee).toBe(800);
    const vide = consoliderGroupe(entree([], []));
    expect(vide.integrale.actif).toBeNull();
    expect(vide.fiabilite.moyennePonderee).toBeNull();
    expect(vide.partielle).toBe(false);
  });
  it("marge nulle si produits nuls", () => {
    const r = consoliderGroupe(
      entree(
        [{ client: "R", partCumuleeBps: 10_000 }],
        [entite("R", { montants: montants({ produits: 0, resultat: -5 }) })],
      ),
    );
    expect(r.integrale.margeNetteBps).toBeNull();
  });
  it("arrondis demi s'éloignant de zéro, y compris négatifs", () => {
    const noeuds = [
      { client: "R", partCumuleeBps: 5000 },
      { client: "A", partCumuleeBps: 5000 },
    ];
    const r = consoliderGroupe(
      entree(noeuds, [
        entite("R", { montants: montants({ actif: 1, resultat: -1, produits: 3 }) }),
        entite("A", { montants: montants({ actif: 2, resultat: -2, produits: 3 }) }),
      ]),
    );
    // (1 x 5000 + 2 x 5000) / 10000 = 1,5 -> 2 ; -1,5 -> -2
    expect(r.proportionnelle.actif).toBe(2);
    expect(r.proportionnelle.resultat).toBe(-2);
    expect(r.proportionnelle.margeNetteBps).toBe(-6667);
    // fiabilité : points 1 et 2, mêmes poids -> 1,5 -> 2
    const f = consoliderGroupe(
      entree(noeuds, [entite("R", { fiabilitePoints: 1 }), entite("A", { fiabilitePoints: 2 })]),
    );
    expect(f.fiabilite.moyennePonderee).toBe(2);
  });
  it("déterministe quel que soit l'ordre d'entrée", () => {
    const noeuds = [
      { client: "R", partCumuleeBps: 10_000 },
      { client: "A", partCumuleeBps: 6000 },
      { client: "B", partCumuleeBps: 2000 },
    ];
    const entites = [entite("R"), entite("A", { fiabilitePoints: 300 }), entite("B")];
    expect(consoliderGroupe(entree([...noeuds].reverse(), [...entites].reverse()))).toEqual(
      consoliderGroupe(entree(noeuds, entites)),
    );
  });
  it("entrées mal formées", () => {
    const ok = [{ client: "R", partCumuleeBps: 10_000 }];
    const e = [entite("R")];
    const cas: EntreeConsolidation[] = [
      { devise: "GBP", exercice: 2025, noeuds: ok, entites: e },
      { devise: "XOF", exercice: 2025.5, noeuds: ok, entites: e },
      entree([{ client: "R", partCumuleeBps: 10_001 }], e),
      entree([{ client: "R", partCumuleeBps: 1.5 }], e),
      entree([...ok, ...ok], e),
      entree([{ client: "", partCumuleeBps: 1 }], e),
      entree(ok, [entite("R"), entite("R")]),
      entree(ok, [entite("")]),
      entree(ok, [entite("R", { montants: montants({ actif: 1.5 }) })]),
      entree(ok, [entite("R", { montants: montants({ actif: 2 ** 60 }) })]),
      entree(ok, [entite("R", { fiabilitePoints: 1001 })]),
      entree(ok, [entite("R", { fiabilitePoints: 1.5 })]),
    ];
    for (const c of cas) expect(code(() => consoliderGroupe(c))).toBe("DETENTION_INVALIDE");
  });
  it("somme hors des entiers sûrs refusée", () => {
    const grand = Number.MAX_SAFE_INTEGER;
    const r = () =>
      consoliderGroupe(
        entree(
          [
            { client: "R", partCumuleeBps: 10_000 },
            { client: "A", partCumuleeBps: 10_000 },
          ],
          [
            entite("R", { montants: montants({ actif: grand }) }),
            entite("A", { montants: montants({ actif: grand }) }),
          ],
        ),
      );
    expect(code(r)).toBe("DETENTION_INVALIDE");
  });
});

describe("conversion de devise (parité fixe XOF/XAF/EUR)", () => {
  it("convertirMontantGroupe : exact, arrondi demi s'éloignant de zéro, USD sans taux", () => {
    expect(convertirMontantGroupe(100_000, "EUR", "XOF")).toBe(655_957);
    expect(convertirMontantGroupe(100_000, "EUR", "XAF")).toBe(655_957);
    expect(convertirMontantGroupe(655_957, "XOF", "EUR")).toBe(100_000);
    expect(convertirMontantGroupe(1, "EUR", "XOF")).toBe(7); // 6,55957
    expect(convertirMontantGroupe(-1, "EUR", "XOF")).toBe(-7);
    expect(convertirMontantGroupe(1000, "XOF", "XAF")).toBe(1000);
    expect(convertirMontantGroupe(1000, "XAF", "XOF")).toBe(1000);
    expect(convertirMontantGroupe(123, "EUR", "EUR")).toBe(123);
    expect(convertirMontantGroupe(100, "USD", "EUR")).toBeNull();
    expect(convertirMontantGroupe(100, "XOF", "USD")).toBeNull();
    expect(convertirMontantGroupe(100, "EUR", "USD")).toBeNull();
  });

  const racineEtFille = (
    deviseRacine: string,
    deviseFille: string,
    montantFille: number,
  ): ReturnType<typeof consoliderGroupe> =>
    consoliderGroupe({
      devise: deviseRacine,
      exercice: 2025,
      noeuds: [
        { client: "R", partCumuleeBps: 10_000 },
        { client: "F", partCumuleeBps: 6000 },
      ],
      entites: [
        entite("R", { devise: deviseRacine }),
        entite("F", {
          devise: deviseFille,
          montants: montants({ actif: montantFille, resultat: montantFille }),
        }),
      ],
    });

  it("EUR → XOF : filiale en euros convertie, listée dans conversions, consolidation non partielle", () => {
    const r = racineEtFille("XOF", "EUR", 100_000);
    expect(r.devise).toBe("XOF");
    expect(r.partielle).toBe(false);
    expect(r.conversions).toEqual([{ client: "F", de: "EUR", vers: "XOF" }]);
    expect(r.integrale.actif).toBe(1000 + 655_957);
    expect(r.proportionnelle.actif).toBe(1000 + Math.round(655_957 * 0.6));
  });

  it("XAF → XOF : parité 1:1", () => {
    const r = racineEtFille("XOF", "XAF", 5000);
    expect(r.integrale.actif).toBe(6000);
    expect(r.conversions).toEqual([{ client: "F", de: "XAF", vers: "XOF" }]);
  });

  it("XOF → EUR quand la racine est en euros", () => {
    const r = racineEtFille("EUR", "XOF", 655_957);
    expect(r.devise).toBe("EUR");
    expect(r.integrale.actif).toBe(1000 + 100_000);
    expect(r.partielle).toBe(false);
  });

  it("USD exclu (aucun taux validé) : consolidation partielle, aucune donnée USD dans les sommes", () => {
    const r = racineEtFille("XOF", "USD", 999_999);
    expect(r.perimetre.exclus).toEqual([{ client: "F", motif: "DEVISE_DIFFERENTE" }]);
    expect(r.partielle).toBe(true);
    expect(r.conversions).toEqual([]);
    expect(r.integrale.actif).toBe(1000);
    const u = racineEtFille("USD", "EUR", 100);
    expect(u.perimetre.exclus).toEqual([{ client: "F", motif: "DEVISE_DIFFERENTE" }]);
  });

  it("montants absents restent null après conversion", () => {
    const r = consoliderGroupe({
      devise: "XOF",
      exercice: 2025,
      noeuds: [{ client: "F", partCumuleeBps: 10_000 }],
      entites: [
        entite("F", {
          devise: "EUR",
          montants: { actif: null, passif: null, charges: null, produits: null, resultat: null },
        }),
      ],
    });
    expect(r.integrale.actif).toBeNull();
  });
});
