import { describe, expect, it } from "vitest";
import {
  actionEnRetard,
  calculerRevueFroide,
  etatPlanAmelioration,
  evaluerIndependanceRelecteur,
  SEUILS_REVUE_FROIDE,
  transitionActionValide,
  type ActionPlanAmelioration as ActionPlan,
  type EntreeIndependance,
  type StatutAction,
} from "./index";
import { ErreurQualite } from "./erreurs";

const grille = [
  { code: "A", poids: 1 },
  { code: "B", poids: 1 },
];
const ev = (a: number | null, b: number | null) => [
  { critere: "A", note: a },
  { critere: "B", note: b },
];
const g13 = [
  { code: "A", poids: 1 },
  { code: "B", poids: 3 },
];

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof ErreurQualite ? e.code : "autre";
  }
  return "aucune";
};

describe("calculerRevueFroide", () => {
  it("expose les seuils provisoires", () => {
    expect(SEUILS_REVUE_FROIDE).toEqual({ conforme: 75, reserves: 50 });
  });

  it("calcule le score et conclut conforme à 75 exactement", () => {
    const r = calculerRevueFroide(grille, ev(5, 3), []);
    expect(r.score).toBe(75);
    expect(r.conclusion).toBe("conforme");
    expect(r.complete).toBe(true);
    expect(r.couverture).toBe(1);
    expect(r.motifs.length).toBeGreaterThan(0);
  });

  it("conclut avec réserves à 50 exactement et en dessous de 75", () => {
    expect(calculerRevueFroide(grille, ev(3, 3), []).conclusion).toBe("reserves");
    const r = calculerRevueFroide(grille, ev(4, 3), []);
    expect(r.score).toBe(62.5);
    expect(r.conclusion).toBe("reserves");
  });

  it("conclut non conforme sous 50", () => {
    const r = calculerRevueFroide(grille, ev(2, 3), []);
    expect(r.score).toBe(37.5);
    expect(r.conclusion).toBe("non_conforme");
  });

  it("pondère les critères et arrondit à une décimale", () => {
    const r = calculerRevueFroide(
      [
        { code: "A", poids: 3 },
        { code: "B", poids: 1 },
        { code: "C", poids: 1 },
      ],
      [
        { critere: "A", note: 5 },
        { critere: "B", note: 1 },
        { critere: "C", note: 2 },
      ],
      [],
    );
    expect(r.score).toBe(65);
    const r2 = calculerRevueFroide(
      [
        { code: "A", poids: 1 },
        { code: "B", poids: 1 },
        { code: "C", poids: 1 },
      ],
      [
        { critere: "A", note: 2 },
        { critere: "B", note: 1 },
        { critere: "C", note: 1 },
      ],
      [],
    );
    expect(r2.score).toBe(8.3);
  });

  it("plafonne par les constats", () => {
    const concl = (a: number, b: number, g: "mineur" | "majeur" | "critique") =>
      calculerRevueFroide(grille, ev(a, b), [{ gravite: g }]).conclusion;
    expect(concl(5, 5, "mineur")).toBe("conforme");
    expect(concl(5, 5, "majeur")).toBe("reserves");
    expect(concl(3, 3, "majeur")).toBe("reserves");
    expect(concl(2, 2, "majeur")).toBe("non_conforme");
    const crit = calculerRevueFroide(grille, ev(5, 5), [
      { gravite: "majeur" },
      { gravite: "critique" },
    ]);
    expect(crit.conclusion).toBe("non_conforme");
    expect(crit.motifs.some((m) => m.includes("critique"))).toBe(true);
    const dejaNC = calculerRevueFroide(grille, ev(1, 1), [{ gravite: "critique" }]);
    expect(dejaNC.conclusion).toBe("non_conforme");
    expect(dejaNC.motifs.some((m) => m.includes("critique"))).toBe(false);
  });

  it("ignore les critères sans objet et limite la conclusion si couverture < 0,5", () => {
    const r = calculerRevueFroide(
      g13,
      [
        { critere: "A", note: 5 },
        { critere: "B", note: null },
      ],
      [],
    );
    expect(r.score).toBe(100);
    expect(r.couverture).toBe(0.25);
    expect(r.conclusion).toBe("reserves");
    expect(r.motifs.some((m) => m.includes("Couverture"))).toBe(true);
    const ok = calculerRevueFroide(
      g13,
      [
        { critere: "A", note: null },
        { critere: "B", note: 5 },
      ],
      [],
    );
    expect(ok.couverture).toBe(0.75);
    expect(ok.conclusion).toBe("conforme");
    const demi = calculerRevueFroide(grille, ev(5, null), []);
    expect(demi.couverture).toBe(0.5);
    expect(demi.conclusion).toBe("conforme");
  });

  it("couverture faible : pas de motif si la conclusion n'est pas conforme", () => {
    const r = calculerRevueFroide(
      g13,
      [
        { critere: "A", note: 1 },
        { critere: "B", note: null },
      ],
      [],
    );
    expect(r.conclusion).toBe("non_conforme");
    expect(r.motifs.some((m) => m.includes("Couverture"))).toBe(false);
  });

  it("reste sans conclusion si la revue est incomplète", () => {
    const r = calculerRevueFroide(grille, [{ critere: "A", note: 5 }], [{ gravite: "critique" }]);
    expect(r.complete).toBe(false);
    expect(r.manquants).toEqual(["B"]);
    expect(r.conclusion).toBeNull();
    expect(r.score).toBe(100);
    expect(r.couverture).toBe(0.5);
    const vide = calculerRevueFroide(grille, [], []);
    expect(vide.score).toBeNull();
    expect(vide.manquants).toEqual(["A", "B"]);
  });

  it("ne conclut pas si tout est sans objet", () => {
    const r = calculerRevueFroide(grille, ev(null, null), []);
    expect(r.complete).toBe(true);
    expect(r.score).toBeNull();
    expect(r.couverture).toBe(0);
    expect(r.conclusion).toBeNull();
  });

  it("refuse les entrées incohérentes", () => {
    const O = "OPTIONS_INVALIDES";
    expect(code(() => calculerRevueFroide([], [], []))).toBe(O);
    expect(code(() => calculerRevueFroide([{ code: "A", poids: 0 }], [], []))).toBe(O);
    expect(code(() => calculerRevueFroide([{ code: "A", poids: Number.NaN }], [], []))).toBe(O);
    expect(
      code(() =>
        calculerRevueFroide(
          [
            { code: "A", poids: 1 },
            { code: "A", poids: 1 },
          ],
          [],
          [],
        ),
      ),
    ).toBe(O);
    expect(code(() => calculerRevueFroide(grille, [{ critere: "Z", note: 3 }], []))).toBe(O);
    expect(
      code(() =>
        calculerRevueFroide(
          grille,
          [
            { critere: "A", note: 3 },
            { critere: "A", note: 3 },
          ],
          [],
        ),
      ),
    ).toBe(O);
    for (const note of [6, 0, 2.5]) {
      expect(code(() => calculerRevueFroide(grille, [{ critere: "A", note }], []))).toBe(O);
    }
  });
});

describe("evaluerIndependanceRelecteur", () => {
  const base: EntreeIndependance = {
    relecteur_id: "r",
    mission: { directeur_id: "d", chef_id: "c", cree_par: "x", cloturee_par: "y", signee_par: "z" },
    equipe: ["e1"],
    affectes: ["a1"],
    intervenants_qualite: ["q1"],
  };

  it("reconnaît un relecteur indépendant", () => {
    expect(evaluerIndependanceRelecteur(base)).toEqual({ independant: true, violations: [] });
    const nuls: EntreeIndependance = {
      ...base,
      mission: {
        directeur_id: null,
        chef_id: null,
        cree_par: null,
        cloturee_par: null,
        signee_par: null,
      },
    };
    expect(evaluerIndependanceRelecteur(nuls).independant).toBe(true);
  });

  it.each([
    ["DIRECTEUR", { mission: { ...base.mission, directeur_id: "r" } }],
    ["CHEF", { mission: { ...base.mission, chef_id: "r" } }],
    ["EQUIPE", { equipe: ["e1", "r"] }],
    ["AFFECTE", { affectes: ["r"] }],
    ["CREATEUR", { mission: { ...base.mission, cree_par: "r" } }],
    ["CLOTURE", { mission: { ...base.mission, cloturee_par: "r" } }],
    ["SIGNATAIRE", { mission: { ...base.mission, signee_par: "r" } }],
    ["INTERVENANT_QUALITE", { intervenants_qualite: ["r"] }],
  ] as const)("détecte la violation %s", (violation, patch) => {
    const r = evaluerIndependanceRelecteur({ ...base, ...patch });
    expect(r.independant).toBe(false);
    expect(r.violations.map((v) => v.code)).toEqual([violation]);
    expect(r.violations[0]!.message.length).toBeGreaterThan(10);
  });

  it("cumule et trie les violations par code", () => {
    const r = evaluerIndependanceRelecteur({
      ...base,
      mission: { ...base.mission, directeur_id: "r", signee_par: "r" },
      equipe: ["r"],
    });
    expect(r.violations.map((v) => v.code)).toEqual(["DIRECTEUR", "EQUIPE", "SIGNATAIRE"]);
  });
});

describe("plan d'amélioration", () => {
  const a = (statut: StatutAction, echeance: string): ActionPlan => ({ statut, echeance });

  it("détecte le retard des actions ouvertes seulement", () => {
    expect(actionEnRetard(a("a_faire", "2026-10-19"), "2026-10-20")).toBe(true);
    expect(actionEnRetard(a("en_cours", "2026-10-19"), "2026-10-20")).toBe(true);
    expect(actionEnRetard(a("a_faire", "2026-10-20"), "2026-10-20")).toBe(false);
    expect(actionEnRetard(a("faite", "2026-01-01"), "2026-10-20")).toBe(false);
    expect(actionEnRetard(a("abandonnee", "2026-01-01"), "2026-10-20")).toBe(false);
  });

  it("valide les transitions", () => {
    const tous: StatutAction[] = ["a_faire", "en_cours", "faite", "abandonnee"];
    const attendues = new Set([
      "a_faire>en_cours",
      "a_faire>faite",
      "a_faire>abandonnee",
      "en_cours>a_faire",
      "en_cours>faite",
      "en_cours>abandonnee",
    ]);
    for (const de of tous) {
      for (const vers of tous) {
        expect(transitionActionValide(de, vers)).toBe(attendues.has(`${de}>${vers}`));
      }
    }
  });

  it("résume l'état du plan", () => {
    const e = etatPlanAmelioration(
      [
        a("faite", "2026-09-01"),
        a("faite", "2026-09-02"),
        a("en_cours", "2026-10-10"),
        a("a_faire", "2026-11-30"),
        a("abandonnee", "2026-08-01"),
        a("a_faire", "2026-12-01"),
      ],
      "2026-10-20",
    );
    expect(e).toEqual({
      total: 6,
      a_faire: 2,
      en_cours: 1,
      faites: 2,
      abandonnees: 1,
      en_retard: 1,
      taux_realisation: 40,
      prochaine_echeance: "2026-10-10",
    });
  });

  it("gère les plans vides ou entièrement abandonnés", () => {
    expect(etatPlanAmelioration([], "2026-10-20")).toEqual({
      total: 0,
      a_faire: 0,
      en_cours: 0,
      faites: 0,
      abandonnees: 0,
      en_retard: 0,
      taux_realisation: 0,
      prochaine_echeance: null,
    });
    const e = etatPlanAmelioration([a("abandonnee", "2026-01-01")], "2026-10-20");
    expect(e.taux_realisation).toBe(0);
    expect(e.prochaine_echeance).toBeNull();
    const t = etatPlanAmelioration(
      [a("faite", "2026-01-01"), a("a_faire", "2027-01-01"), a("a_faire", "2027-01-01")],
      "2026-10-20",
    );
    expect(t.taux_realisation).toBe(33.3);
  });
});
