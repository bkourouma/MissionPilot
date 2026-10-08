import { describe, expect, it } from "vitest";
import {
  budgetsParNoeud,
  deplacementChangementParent,
  deplacementsEchange,
  geometrieGantt,
  ordreSuivant,
  parentsDeTache,
  tachesChronologiques,
  tachesDansLOrdre,
  tachesDuParent,
  validerBudgetTache,
  validerDependance,
  validerJalon,
  validerTache,
  type Phase,
  type Tache,
} from "./decoupage";

const P1 = "0b6c2d1e-0000-4000-8000-000000000001";
const P2 = "0b6c2d1e-0000-4000-8000-000000000002";

const tache = (id: string, extra: Partial<Tache> = {}): Tache => ({
  id,
  phase_id: P1,
  lot_id: null,
  libelle: id,
  ordre: 10,
  est_livrable: false,
  date_debut: null,
  duree_jours_ouvres: 1,
  ...extra,
});

const phases: Phase[] = [
  {
    id: P1,
    libelle: "Diagnostic",
    ordre: 10,
    lots: [
      {
        id: "l1",
        phase_id: P1,
        libelle: "Entretiens",
        ordre: 10,
        est_livrable: false,
        taches: [tache("t1")],
      },
    ],
    taches: [tache("t2")],
  },
  { id: P2, libelle: "Plan", ordre: 20, lots: [], taches: [] },
];

describe("réorganisation au clavier", () => {
  it("échange avec le voisin et renumérote les frères", () => {
    const freres = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(deplacementsEchange(freres, "b", -1, "lot", P1)).toEqual([
      { type: "lot", id: "b", parent_id: P1, ordre: 10 },
      { type: "lot", id: "a", parent_id: P1, ordre: 20 },
      { type: "lot", id: "c", parent_id: P1, ordre: 30 },
    ]);
  });

  it("n'envoie pas de parent pour une phase", () => {
    const d = deplacementsEchange([{ id: "a" }, { id: "b" }], "a", 1, "phase");
    expect(d).toEqual([
      { type: "phase", id: "b", ordre: 10 },
      { type: "phase", id: "a", ordre: 20 },
    ]);
  });

  it("refuse de sortir de la liste", () => {
    expect(deplacementsEchange([{ id: "a" }], "a", -1, "tache", P1)).toBeNull();
    expect(deplacementsEchange([{ id: "a" }, { id: "b" }], "b", 1, "tache", P1)).toBeNull();
    expect(deplacementsEchange([{ id: "a" }], "z", 1, "tache", P1)).toBeNull();
  });

  it("place un élément déplacé en fin de son nouveau parent", () => {
    expect(deplacementChangementParent("tache", "t2", "l1", [{ id: "t1", ordre: 30 }])).toEqual({
      type: "tache",
      id: "t2",
      parent_id: "l1",
      ordre: 40,
    });
    expect(deplacementChangementParent("lot", "l1", P2, [])).toMatchObject({ ordre: 10 });
    expect(ordreSuivant([{ ordre: 100_000 }])).toBe(100_000);
  });

  it("liste les parents possibles d'une tâche et ses frères", () => {
    expect(parentsDeTache({ phases }).map((o) => o.libelle)).toEqual([
      "Phase : Diagnostic",
      "Lot : Diagnostic › Entretiens",
      "Phase : Plan",
    ]);
    expect(tachesDuParent({ phases }, "l1").map((t) => t.id)).toEqual(["t1"]);
    expect(tachesDuParent({ phases }, P1).map((t) => t.id)).toEqual(["t2"]);
    expect(tachesDuParent({ phases }, "inconnu")).toEqual([]);
  });

  it("donne le chemin lisible de chaque tâche dans l'ordre de lecture", () => {
    expect(tachesDansLOrdre({ phases }).map((t) => t.chemin)).toEqual([
      "Diagnostic › Entretiens › t1",
      "Diagnostic › t2",
    ]);
  });
});

describe("saisies du découpage", () => {
  it("valide une tâche", () => {
    expect(
      validerTache({
        libelle: " Cadrage ",
        est_livrable: true,
        date_debut: "",
        duree_jours_ouvres: "3",
      }),
    ).toEqual({
      ok: true,
      charge: { libelle: "Cadrage", est_livrable: true, date_debut: null, duree_jours_ouvres: 3 },
    });
    const r = validerTache({
      libelle: "",
      est_livrable: false,
      date_debut: "x",
      duree_jours_ouvres: "0,5",
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "date_debut",
        "duree_jours_ouvres",
        "libelle",
      ]);
  });

  it("valide un jalon rattaché ou non à une phase", () => {
    expect(
      validerJalon({ libelle: "Copil", phase_id: "", date_prevue: "", atteint: false }),
    ).toEqual({
      ok: true,
      charge: { libelle: "Copil", phase_id: null, date_prevue: null, atteint: false },
    });
    expect(
      validerJalon({ libelle: "Copil", phase_id: "x", date_prevue: "", atteint: false }).ok,
    ).toBe(false);
  });

  it("budgète une tâche par grade en conservant les lignes nominatives", () => {
    const r = validerBudgetTache({ g1: "2,5", g2: "", g3: "0" }, [
      {
        id: "x",
        grade_id: null,
        grade_code: null,
        collaborateur_id: "c1",
        collaborateur_nom: "Awa",
        jours: 1,
      },
      {
        id: "y",
        grade_id: "g1",
        grade_code: "senior",
        collaborateur_id: null,
        collaborateur_nom: null,
        jours: 4,
      },
    ]);
    expect(r).toEqual({
      ok: true,
      charge: {
        lignes: [
          { grade_id: "g1", jours: 2.5 },
          { collaborateur_id: "c1", jours: 1 },
        ],
      },
    });
    expect(validerBudgetTache({ g1: "1,001" }, []).ok).toBe(false);
  });

  it("valide une dépendance", () => {
    expect(validerDependance({ predecesseur_id: P1, successeur_id: P2, decalage: "" })).toEqual({
      ok: true,
      charge: { predecesseur_id: P1, successeur_id: P2, decalage: 0 },
    });
    const r = validerDependance({ predecesseur_id: P1, successeur_id: P1, decalage: "400" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["decalage", "successeur_id"]);
  });
});

describe("planning", () => {
  const t = (id: string, debut: string, fin: string) => ({
    id,
    libelle: id,
    phase_id: P1,
    lot_id: null,
    duree_jours_ouvres: 1,
    debut,
    fin,
  });

  it("trie les tâches par date", () => {
    expect(
      tachesChronologiques([
        t("b", "2027-01-10", "2027-01-12"),
        t("a", "2027-01-05", "2027-01-06"),
      ]).map((x) => x.id),
    ).toEqual(["a", "b"]);
  });

  it("calcule la géométrie du Gantt en pourcentage (fin incluse)", () => {
    const g = geometrieGantt(
      [t("a", "2027-01-01", "2027-01-05"), t("b", "2027-01-06", "2027-01-10")],
      [{ id: "j", date_prevue: "2027-01-10" }],
    );
    expect(g?.jours).toBe(10);
    expect(g?.barres.get("a")).toEqual({ id: "a", gauche: 0, largeur: 50 });
    expect(g?.barres.get("b")).toEqual({ id: "b", gauche: 50, largeur: 50 });
    expect(g?.jalons.get("j")).toBe(95);
    expect(geometrieGantt([])).toBeNull();
  });

  it("indexe les budgets agrégés de la synthèse", () => {
    const suivi = (budget: number) => ({
      budget,
      realise: 0,
      resteAFaire: budget,
      atterrissage: budget,
      ecart: 0,
      ecartRelatif: 0,
      consommation: 0,
    });
    const racine = {
      id: "m",
      niveau: "mission" as const,
      suivi: suivi(5),
      couleur: "vert" as const,
      enfants: [
        {
          id: P1,
          niveau: "phase" as const,
          suivi: suivi(5),
          couleur: "vert" as const,
          enfants: [],
        },
      ],
    };
    expect(budgetsParNoeud(racine)).toEqual({ m: 5, [P1]: 5 });
    expect(budgetsParNoeud(null)).toEqual({});
  });
});
