import { describe, expect, it } from "vitest";
import {
  agregerMatrice,
  agregerPriorisation,
  agregerVote,
  BUDGET_POINTS_MAX,
  OPTIONS_ATELIER_MAX,
  PARTICIPANTS_ATELIER_MAX,
  synthetiserAtelier,
  type OptionAtelier,
  type PositionMatrice,
} from "./atelier";
import { ErreurPlan } from "./erreurs";

const opts = (...ids: string[]): OptionAtelier[] =>
  ids.map((id) => ({ id, libelle: `Option ${id}` }));
const lever = (f: () => unknown): ErreurPlan => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurPlan);
    expect((e as ErreurPlan).code).toBe("ATELIER_INVALIDE");
    return e as ErreurPlan;
  }
  throw new Error("Aucune erreur levée");
};
const pts = (...paires: [string, number][]) =>
  paires.map(([optionId, points]) => ({ optionId, points }));

describe("bornes", () => {
  it("expose les bornes demandées", () => {
    expect(OPTIONS_ATELIER_MAX).toBe(50);
    expect(PARTICIPANTS_ATELIER_MAX).toBe(100);
    expect(BUDGET_POINTS_MAX).toBe(100);
  });
});

describe("agregerVote", () => {
  const options = opts("a", "b", "c", "d");
  const contributions = [
    { participant: "p1", points: pts(["a", 5], ["b", 3], ["c", 2]) },
    { participant: "p2", points: pts(["a", 5], ["b", 5]) },
    { participant: "p3", points: pts(["b", 4], ["c", 3], ["d", 3]) },
    { participant: "p4", points: [] },
  ];

  it("agrège points, votants, parts et rangs (cas chiffré à la main)", () => {
    // a : 5 + 5 = 10 (2 votants) ; b : 3 + 5 + 4 = 12 (3) ; c : 2 + 3 = 5 (2) ; d : 3 (1).
    // Total 30. Parts : 10/30 = 33,33 % ; 12/30 = 40,00 % ; 5/30 = 16,666 → 16,67 % ; 10,00 %.
    const r = agregerVote(options, contributions);
    expect(r.budgetPoints).toBe(10);
    expect(r.totalPoints).toBe(30);
    expect(
      r.options.map((o) => [o.optionId, o.points, o.votants, o.partCentiemesPourcent, o.rang]),
    ).toEqual([
      ["a", 10, 2, 3333, 2],
      ["b", 12, 3, 4000, 1],
      ["c", 5, 2, 1667, 3],
      ["d", 3, 1, 1000, 4],
    ]);
  });

  it("calcule la participation (p4 n'a donné aucun point)", () => {
    expect(agregerVote(options, contributions).participation).toEqual({
      participants: 3,
      invites: 3,
      tauxCentiemesPourcent: 10000,
    });
    // 3 votants sur 4 invités = 75,00 %.
    expect(agregerVote(options, contributions, { invites: 4 }).participation).toEqual({
      participants: 3,
      invites: 4,
      tauxCentiemesPourcent: 7500,
    });
    // 1 sur 3 = 33,333 → 33,33 %.
    const un = agregerVote(options, contributions.slice(0, 1), { invites: 3 });
    expect(un.participation.tauxCentiemesPourcent).toBe(3333);
  });

  it("sans contribution : zéro partout, taux nul sans invité", () => {
    const r = agregerVote(options, []);
    expect(r.totalPoints).toBe(0);
    expect(r.options.every((o) => o.partCentiemesPourcent === 0)).toBe(true);
    expect(r.options.map((o) => o.rang)).toEqual([1, 2, 3, 4]);
    expect(r.participation).toEqual({ participants: 0, invites: 0, tauxCentiemesPourcent: null });
  });

  it("départage les égalités : plus de votants, puis ordre de saisie", () => {
    // x et y : 4 points ; x en 2 votants, y en 1. z : 4 points en 1 votant, saisi après y.
    const o = opts("y", "x", "z");
    const r = agregerVote(o, [
      { participant: "p1", points: pts(["y", 4]) },
      { participant: "p2", points: pts(["x", 2], ["z", 4]) },
      { participant: "p3", points: pts(["x", 2]) },
    ]);
    expect(r.options.map((l) => [l.optionId, l.points, l.votants, l.rang])).toEqual([
      ["y", 4, 1, 2],
      ["x", 4, 2, 1],
      ["z", 4, 1, 3],
    ]);
  });

  it("arrondit au demi vers le haut (1/8 = 12,5 → 12,50 %, 3/8 = 37,5 %)", () => {
    // 1/16 = 6,25 % ; 1/3 de 1 point... : 1 point sur 8 → 12,50 % ; 5/16 = 31,25 %.
    const r = agregerVote(opts("a", "b"), [{ participant: "p", points: pts(["a", 1], ["b", 7]) }]);
    expect(r.options.map((l) => l.partCentiemesPourcent)).toEqual([1250, 8750]);
    // 1 point sur 3 = 33,333 ; 2 sur 3 = 66,667 → 66,67.
    const t = agregerVote(opts("a", "b"), [{ participant: "p", points: pts(["a", 1], ["b", 2]) }]);
    expect(t.options.map((l) => l.partCentiemesPourcent)).toEqual([3333, 6667]);
  });

  it("applique budget personnalisé et plafond par option", () => {
    const r = agregerVote(
      opts("a", "b"),
      [{ participant: "p", points: pts(["a", 20], ["b", 30]) }],
      { budgetPoints: 50, plafondParOption: 30 },
    );
    expect(r.budgetPoints).toBe(50);
    expect(r.totalPoints).toBe(50);
  });

  it("refuse toute entrée invalide avec ATELIER_INVALIDE et un chemin", () => {
    const o = opts("a", "b");
    const ok = [{ participant: "p", points: pts(["a", 1]) }];
    expect(lever(() => agregerVote([], ok)).chemin).toBe("options");
    expect(
      lever(() => agregerVote(opts(...Array.from({ length: 51 }, (_, i) => `o${i}`)), ok)).message,
    ).toMatch(/1 à 50/);
    expect(
      lever(() =>
        agregerVote(
          [
            { id: "a", libelle: "A" },
            { id: "a", libelle: "B" },
          ],
          ok,
        ),
      ).message,
    ).toMatch(/en double/);
    expect(lever(() => agregerVote([{ id: " ", libelle: "A" }], ok)).message).toMatch(
      /identifiant/,
    );
    expect(lever(() => agregerVote([{ id: "a", libelle: "" }], ok)).chemin).toBe(
      "options[0].libelle",
    );
    expect(lever(() => agregerVote(o, ok, { budgetPoints: 0 })).chemin).toBe("budgetPoints");
    expect(lever(() => agregerVote(o, ok, { budgetPoints: 101 })).chemin).toBe("budgetPoints");
    expect(lever(() => agregerVote(o, ok, { budgetPoints: 2.5 })).chemin).toBe("budgetPoints");
    expect(lever(() => agregerVote(o, ok, { budgetPoints: 10, plafondParOption: 11 })).chemin).toBe(
      "plafondParOption",
    );
    expect(lever(() => agregerVote(o, ok, { plafondParOption: 0 })).chemin).toBe(
      "plafondParOption",
    );
    expect(
      lever(() => agregerVote(o, [{ participant: "p", points: pts(["z", 1]) }])).message,
    ).toMatch(/inconnue/);
    expect(
      lever(() => agregerVote(o, [{ participant: "p", points: pts(["a", 1], ["a", 1]) }])).message,
    ).toMatch(/répétée/);
    expect(lever(() => agregerVote(o, [...ok, ...ok])).message).toMatch(/Participant en double/);
    expect(lever(() => agregerVote(o, [{ participant: "", points: [] }])).chemin).toBe(
      "contributions[0].participant",
    );
    expect(lever(() => agregerVote(o, [{ participant: "p", points: pts(["a", -1]) }])).chemin).toBe(
      "contributions[0].points[0].points",
    );
    expect(
      lever(() => agregerVote(o, [{ participant: "p", points: pts(["a", 1.5]) }])).message,
    ).toMatch(/entier/);
    expect(
      lever(() => agregerVote(o, [{ participant: "p", points: pts(["a", 6], ["b", 5]) }])).message,
    ).toMatch(/11/);
    expect(
      lever(() =>
        agregerVote(o, [{ participant: "p", points: pts(["a", 5]) }], { plafondParOption: 4 }),
      ).message,
    ).toMatch(/Plus de 4 points/);
    expect(lever(() => agregerVote(o, ok, { invites: 0 })).message).toMatch(/inférieurs/);
    expect(lever(() => agregerVote(o, ok, { invites: 101 })).chemin).toBe("parametres.invites");
    const trop = Array.from({ length: 101 }, (_, i) => ({ participant: `p${i}`, points: [] }));
    expect(lever(() => agregerVote(o, trop)).message).toMatch(/100 participants/);
  });
});

describe("agregerPriorisation", () => {
  const options = opts("A", "B", "C");
  const classements = [
    { participant: "p1", classement: ["A", "B", "C"] },
    { participant: "p2", classement: ["B", "A"] },
    { participant: "p3", classement: ["C"] },
  ];

  it("calcule Borda sur un cas connu (n = options classées par le participant)", () => {
    // p1 : A3 B2 C1 ; p2 (n = 2) : B2 A1 ; p3 (n = 1) : C1.
    // Borda : A 4, B 4, C 2. Rang moyen : A (1+2)/2 = 1,50 ; B (2+1)/2 = 1,50 ; C (3+1)/2 = 2,00.
    // Fois première : A 1, B 1, C 1 → A et B à égalité parfaite : ordre de saisie.
    const r = agregerPriorisation(options, classements);
    expect(
      r.options.map((l) => [
        l.optionId,
        l.pointsBorda,
        l.rangMoyenCentiemes,
        l.foisPremiere,
        l.nombreClassements,
        l.rang,
      ]),
    ).toEqual([
      ["A", 4, 150, 1, 2, 1],
      ["B", 4, 150, 1, 2, 2],
      ["C", 2, 200, 1, 2, 3],
    ]);
    expect(r.participation).toEqual({ participants: 3, invites: 3, tauxCentiemesPourcent: 10000 });
  });

  it("départage à Borda égal par le nombre de fois première, puis l'ordre de saisie", () => {
    // p1, p2 : [Y, X] ; p3, p4 : [Z, X]. Borda : X 4 (2 × 1 + 2 × 1), Y 4, Z 4 ; fois première : Y 2, Z 2, X 0.
    const r = agregerPriorisation(opts("X", "Y", "Z"), [
      { participant: "p1", classement: ["Y", "X"] },
      { participant: "p2", classement: ["Y", "X"] },
      { participant: "p3", classement: ["Z", "X"] },
      { participant: "p4", classement: ["Z", "X"] },
    ]);
    expect(r.options.map((l) => [l.optionId, l.pointsBorda, l.foisPremiere, l.rang])).toEqual([
      ["X", 4, 0, 3],
      ["Y", 4, 2, 1],
      ["Z", 4, 2, 2],
    ]);
  });

  it("rang moyen nul pour une option jamais classée ; participation avec invités", () => {
    const r = agregerPriorisation(opts("A", "B"), [{ participant: "p", classement: ["A"] }], {
      invites: 4,
    });
    expect(r.options[1]).toMatchObject({
      optionId: "B",
      rangMoyenCentiemes: null,
      pointsBorda: 0,
      rang: 2,
    });
    expect(r.participation).toEqual({ participants: 1, invites: 4, tauxCentiemesPourcent: 2500 });
  });

  it("arrondit le rang moyen au demi vers le haut (1+1+2 sur 3 = 1,33 ; 1+2+2 = 1,67)", () => {
    const r = agregerPriorisation(opts("A", "B"), [
      { participant: "1", classement: ["A", "B"] },
      { participant: "2", classement: ["A", "B"] },
      { participant: "3", classement: ["B", "A"] },
    ]);
    expect(r.options.map((l) => l.rangMoyenCentiemes)).toEqual([133, 167]);
  });

  it("refuse les classements invalides", () => {
    const o = opts("A", "B");
    expect(
      lever(() => agregerPriorisation(o, [{ participant: "p", classement: [] }])).message,
    ).toMatch(/vide/);
    expect(
      lever(() => agregerPriorisation(o, [{ participant: "p", classement: ["Z"] }])).message,
    ).toMatch(/inconnue/);
    expect(
      lever(() => agregerPriorisation(o, [{ participant: "p", classement: ["A", "A"] }])).message,
    ).toMatch(/deux fois/);
    expect(
      lever(() =>
        agregerPriorisation(o, [
          { participant: "p", classement: ["A"] },
          { participant: "p", classement: ["B"] },
        ]),
      ).message,
    ).toMatch(/en double/);
    expect(
      lever(() => agregerPriorisation(o, [{ participant: " ", classement: ["A"] }])).chemin,
    ).toBe("classements[0].participant");
    expect(
      lever(() => agregerPriorisation(o, [{ participant: "p", classement: ["A"] }], { invites: 0 }))
        .message,
    ).toMatch(/inférieurs/);
    const trop = Array.from({ length: 101 }, (_, i) => ({
      participant: `p${i}`,
      classement: ["A"],
    }));
    expect(lever(() => agregerPriorisation(o, trop)).chemin).toBe("classements");
    expect(lever(() => agregerPriorisation([], [])).chemin).toBe("options");
  });
});

describe("agregerMatrice", () => {
  const options = opts("o1", "o2", "o3", "o4");
  const pos = (participant: string, optionId: string, x: number, y: number): PositionMatrice => ({
    participant,
    optionId,
    x,
    y,
  });
  const positions = [
    pos("u1", "o1", 5, 1),
    pos("u2", "o1", 4, 2),
    pos("u1", "o2", 5, 5),
    pos("u2", "o2", 5, 4),
    pos("u1", "o3", 1, 1),
    pos("u2", "o3", 2, 2),
    pos("u1", "o4", 1, 5),
    pos("u2", "o4", 3, 5),
  ];

  it("calcule moyennes, dispersions, quadrants, consensus et rangs (cas à la main)", () => {
    // o1 : x (5+4)/2 = 4,50 ; y (1+2)/2 = 1,50 ; valeur haute, effort bas : gains rapides.
    // o2 : x 5,00 ; y 4,50 : projets majeurs. o3 : x 1,50 ; y 1,50 : compléments.
    // o4 : x 2,00 ; y 5,00 ; dispersion x = 2 : à écarter, pas de consensus.
    const r = agregerMatrice(options, positions);
    expect(
      r.options.map((l) => [
        l.optionId,
        l.moyenneXCentiemes,
        l.moyenneYCentiemes,
        l.dispersionX,
        l.dispersionY,
        l.contributeurs,
        l.quadrant,
        l.consensus,
        l.rang,
      ]),
    ).toEqual([
      ["o1", 450, 150, 1, 1, 2, "gains_rapides", true, 1],
      ["o2", 500, 450, 0, 1, 2, "projets_majeurs", true, 2],
      ["o3", 150, 150, 1, 1, 2, "complements", true, 3],
      ["o4", 200, 500, 2, 0, 2, "a_ecarter", false, 4],
    ]);
    expect(r.axes.x.libelle).toBe("Valeur / impact");
    expect(r.participation).toEqual({ participants: 2, invites: 2, tauxCentiemesPourcent: 10000 });
  });

  it("applique le seuil de 300 centièmes inclus du côté haut", () => {
    // x : (2 + 4) / 2 = 3,00 → haut. y : 3,00 → côté « haut » donc effort NON bas : projet majeur.
    const a = agregerMatrice(opts("a"), [pos("1", "a", 2, 3), pos("2", "a", 4, 3)]);
    expect(a.options[0]).toMatchObject({
      moyenneXCentiemes: 300,
      moyenneYCentiemes: 300,
      quadrant: "projets_majeurs",
    });
    // y juste sous le seuil (2,67) : effort bas → gains rapides ; x juste sous (2,67) → bas.
    const b = agregerMatrice(opts("a"), [
      pos("1", "a", 3, 2),
      pos("2", "a", 3, 3),
      pos("3", "a", 2, 3),
    ]);
    expect(b.options[0]).toMatchObject({
      moyenneXCentiemes: 267,
      moyenneYCentiemes: 267,
      quadrant: "complements",
    });
    // x = 3,00 pile avec y = 2,00 : gains rapides.
    const c = agregerMatrice(opts("a"), [pos("1", "a", 3, 2)]);
    expect(c.options[0]?.quadrant).toBe("gains_rapides");
  });

  it("arrondit les moyennes au demi vers le haut (9/8 = 1,125 → 1,13)", () => {
    const p = Array.from({ length: 8 }, (_, i) => pos(`u${i}`, "a", i === 0 ? 2 : 1, 1));
    const r = agregerMatrice(opts("a"), p);
    expect(r.options[0]?.moyenneXCentiemes).toBe(113);
    expect(r.options[0]?.dispersionX).toBe(1);
  });

  it("départage dans un quadrant : valeur décroissante, effort croissant, ordre de saisie", () => {
    const o = opts("a", "b", "c", "d");
    const r = agregerMatrice(o, [
      pos("u", "a", 4, 2),
      pos("u", "b", 5, 2),
      pos("u", "c", 4, 1),
      pos("u", "d", 4, 1),
    ]);
    // b (x 5) ; puis c et d (x 4, effort 1) avant a (x 4, effort 2) ; c avant d (saisie).
    expect(r.options.map((l) => [l.optionId, l.rang])).toEqual([
      ["a", 4],
      ["b", 1],
      ["c", 2],
      ["d", 3],
    ]);
  });

  it("classe les options sans position en dernier, sans quadrant", () => {
    const r = agregerMatrice(opts("a", "b", "c"), [pos("u", "c", 1, 5)]);
    expect(r.options[0]).toMatchObject({
      optionId: "a",
      moyenneXCentiemes: null,
      moyenneYCentiemes: null,
      dispersionX: 0,
      contributeurs: 0,
      quadrant: null,
      consensus: false,
      rang: 2,
    });
    expect(r.options[1]?.rang).toBe(3);
    expect(r.options[2]?.rang).toBe(1);
  });

  it("gère des axes personnalisés et inversés", () => {
    const axes = { x: { libelle: "Coût", inverse: true }, y: { libelle: "Gain" } };
    const r = agregerMatrice(opts("a", "b"), [pos("u", "a", 1, 5), pos("u", "b", 5, 1)], { axes });
    // a : coût bas (bon), gain haut (bon) → gains rapides ; b : coût haut, gain bas → à écarter.
    expect(r.options.map((l) => l.quadrant)).toEqual(["gains_rapides", "a_ecarter"]);
    expect(r.axes).toBe(axes);
    // Tri : x inversé → coût bas d'abord ; y non inversé → gain haut d'abord.
    const t = agregerMatrice(
      opts("a", "b", "c"),
      [pos("u", "a", 2, 4), pos("u", "b", 1, 4), pos("u", "c", 1, 5)],
      { axes },
    );
    expect(t.options.map((l) => l.rang)).toEqual([3, 2, 1]);
    // Deux axes inversés : effort inversé aussi pour x.
    const d = agregerMatrice(opts("a"), [pos("u", "a", 1, 1)], {
      axes: { x: { libelle: "X", inverse: true }, y: { libelle: "Y", inverse: true } },
    });
    expect(d.options[0]?.quadrant).toBe("gains_rapides");
  });

  it("refuse les entrées invalides", () => {
    const o = opts("a");
    expect(lever(() => agregerMatrice(o, [pos("u", "z", 3, 3)])).message).toMatch(/inconnue/);
    expect(lever(() => agregerMatrice(o, [pos("u", "a", 0, 3)])).chemin).toBe("positions[0].x");
    expect(lever(() => agregerMatrice(o, [pos("u", "a", 3, 6)])).chemin).toBe("positions[0].y");
    expect(lever(() => agregerMatrice(o, [pos("u", "a", 2.5, 3)])).message).toMatch(/entier/);
    expect(
      lever(() => agregerMatrice(o, [pos("u", "a", 3, 3), pos("u", "a", 2, 2)])).message,
    ).toMatch(/deux fois/);
    expect(lever(() => agregerMatrice(o, [pos("", "a", 3, 3)])).chemin).toBe(
      "positions[0].participant",
    );
    expect(lever(() => agregerMatrice(o, [], { invites: 101 })).chemin).toBe("parametres.invites");
    expect(
      lever(() =>
        agregerMatrice(o, [pos("u", "a", 3, 3)], {
          axes: { x: { libelle: "" }, y: { libelle: "Y" } },
        }),
      ).chemin,
    ).toBe("axes.x.libelle");
    expect(
      lever(() =>
        agregerMatrice(o, [], {
          axes: { x: { libelle: "X" }, y: { libelle: "Y", inverse: "oui" as unknown as boolean } },
        }),
      ).chemin,
    ).toBe("axes.y.inverse");
    const trop = Array.from({ length: 101 }, (_, i) => pos(`u${i}`, "a", 3, 3));
    expect(lever(() => agregerMatrice(o, trop)).chemin).toBe("positions");
  });
});

describe("synthetiserAtelier", () => {
  const options = opts("a", "b");

  it("ne rend que les méthodes fournies", () => {
    const s = synthetiserAtelier({ options });
    expect(s).toEqual({ moteur: "engines/plan-strategique/atelier@1" });
    expect(Object.keys(s)).toEqual(["moteur"]);
  });

  it("produit agrégats et faits chiffrés structurés, sans texte libre", () => {
    const s = synthetiserAtelier({
      options,
      vote: { contributions: [{ participant: "p", points: pts(["a", 6], ["b", 4]) }], invites: 2 },
      priorisation: { classements: [{ participant: "p", classement: ["b"] }] },
      matrice: { positions: [{ participant: "p", optionId: "a", x: 4, y: 2 }] },
    });
    const voteFaits = s.vote?.faits ?? [];
    expect(voteFaits[0]).toEqual({ code: "VOTE_TOTAL_POINTS", option: null, valeur: 10 });
    expect(voteFaits).toContainEqual({
      code: "VOTE_TAUX_CENTIEMES_POURCENT",
      option: null,
      valeur: 5000,
    });
    expect(voteFaits).toContainEqual({
      code: "VOTE_PART_CENTIEMES_POURCENT",
      option: "a",
      valeur: 6000,
    });
    expect(voteFaits).toContainEqual({ code: "VOTE_RANG", option: "b", valeur: 2 });
    const prioFaits = s.priorisation?.faits ?? [];
    expect(prioFaits).toContainEqual({ code: "PRIORISATION_POINTS_BORDA", option: "b", valeur: 1 });
    expect(prioFaits).toContainEqual({
      code: "PRIORISATION_RANG_MOYEN_CENTIEMES",
      option: "a",
      valeur: null,
    });
    const matFaits = s.matrice?.faits ?? [];
    expect(matFaits).toContainEqual({
      code: "MATRICE_MOYENNE_X_CENTIEMES",
      option: "a",
      valeur: 400,
    });
    expect(matFaits).toContainEqual({
      code: "MATRICE_QUADRANT_GAINS_RAPIDES",
      option: "a",
      valeur: 1,
    });
    expect(matFaits).toContainEqual({ code: "MATRICE_CONSENSUS", option: "a", valeur: 1 });
    // Option b sans position : aucun fait de quadrant.
    expect(matFaits.some((f) => f.option === "b" && f.code.startsWith("MATRICE_QUADRANT"))).toBe(
      false,
    );
    for (const f of [...voteFaits, ...prioFaits, ...matFaits]) {
      expect(f.valeur === null || Number.isInteger(f.valeur)).toBe(true);
    }
  });

  it("propage les erreurs de validation", () => {
    lever(() => synthetiserAtelier({ options, vote: { contributions: [], budgetPoints: 0 } }));
  });

  it("ne rend jamais de contribution individuelle et est déterministe", () => {
    const entree = {
      options,
      vote: { contributions: [{ participant: "secret-42", points: pts(["a", 3]) }] },
    };
    const s = synthetiserAtelier(entree);
    expect(JSON.stringify(s)).not.toContain("secret-42");
    expect(JSON.stringify(synthetiserAtelier(entree))).toBe(JSON.stringify(s));
  });
});
