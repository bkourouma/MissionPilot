import { describe, expect, it } from "vitest";
import {
  analyserDerogations,
  centiemesDepuisJours,
  centiemesEnJours,
  cleGroupeDerogations,
  ecartPourMille,
  ecartsRetour,
  EFFECTIF_MINIMUM_PLANCHER,
  EFFECTIF_STATISTIQUES_DETAILLEES,
  ErreurCapitalisation,
  estimerBriques,
  estNiveauCompetence,
  formaterCentiemesJours,
  formaterPourMille,
  pourCentDepuisPourMille,
  matriceCompetences,
  motifsSemblables,
  motsDuMotif,
  quartileEntier,
  resumeRobuste,
  sommeCentiemes,
  tempsParBrique,
  verifieContexteEstimation,
  type DerogationObservee,
  type ObservationTemps,
} from "./index";

function code(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurCapitalisation);
    return (e as ErreurCapitalisation).code;
  }
  throw new Error("aucune erreur levée");
}

describe("temps (centièmes de jour)", () => {
  it("lit un numeric PostgreSQL en centièmes exacts", () => {
    expect(centiemesDepuisJours("3")).toBe(300);
    expect(centiemesDepuisJours("1.5")).toBe(150);
    expect(centiemesDepuisJours(" 12.25 ")).toBe(1225);
    expect(centiemesDepuisJours("0.05")).toBe(5);
    expect(code(() => centiemesDepuisJours("1.234"))).toBe("JOURS_INVALIDES");
    expect(code(() => centiemesDepuisJours("-1"))).toBe("JOURS_INVALIDES");
    expect(code(() => centiemesDepuisJours("abc"))).toBe("JOURS_INVALIDES");
  });

  it("somme exacte, refuse négatif ou non entier", () => {
    expect(sommeCentiemes([])).toBe(0);
    expect(sommeCentiemes([10, 25, 5])).toBe(40);
    expect(code(() => sommeCentiemes([-1]))).toBe("CENTIEMES_INVALIDES");
    expect(code(() => sommeCentiemes([1.5]))).toBe("CENTIEMES_INVALIDES");
  });

  it("formate et convertit", () => {
    expect(formaterCentiemesJours(0)).toBe("0 j");
    expect(formaterCentiemesJours(1250)).toBe("12,5 j");
    expect(formaterCentiemesJours(325)).toBe("3,25 j");
    expect(formaterCentiemesJours(205)).toBe("2,05 j");
    expect(centiemesEnJours(1250)).toBe(12.5);
    expect(centiemesEnJours(7)).toBe(0.07);
  });

  it("temps réel et budget par brique, tâches non rattachées ignorées", () => {
    const r = tempsParBrique(
      [
        { tache_id: "t1", brique_code: "collecte" },
        { tache_id: "t2", brique_code: "collecte" },
        { tache_id: "t3", brique_code: "analyse" },
      ],
      [
        { tache_id: "t1", centiemes: 100 },
        { tache_id: "t2", centiemes: 50 },
        { tache_id: "t9", centiemes: 999 },
      ],
      [
        { tache_id: "t1", jours: "2" },
        { tache_id: "t3", jours: "1.5" },
        { tache_id: "t9", jours: "4" },
      ],
    );
    expect(r).toEqual([
      { brique_code: "analyse", realise_centiemes: 0, budget_centiemes: 150, taches: 1 },
      { brique_code: "collecte", realise_centiemes: 150, budget_centiemes: 200, taches: 2 },
    ]);
  });
});

describe("statistiques robustes", () => {
  it("quartiles type 7 arrondis à l'entier, moitié vers le haut", () => {
    expect(quartileEntier([10], 2)).toBe(10);
    expect(quartileEntier([1, 2], 2)).toBe(2); // 1,5 → 2
    expect(quartileEntier([1, 2, 3, 4], 1)).toBe(2); // 1,75 → 2
    expect(quartileEntier([1, 2, 3, 4], 3)).toBe(3); // 3,25 → 3
    expect(quartileEntier([100, 200, 300, 400, 500], 2)).toBe(300);
  });

  it("résumé et valeurs atypiques (Tukey)", () => {
    expect(resumeRobuste([])).toBeNull();
    const r = resumeRobuste([500, 100, 300, 200, 400, 5000]);
    expect(r).toEqual({
      effectif: 6,
      min: 100,
      q1: 225,
      mediane: 350,
      q3: 475,
      max: 5000,
      atypiques: 1,
    });
    expect(code(() => resumeRobuste([-5]))).toBe("CENTIEMES_INVALIDES");
  });
});

describe("estimation par brique et par contexte (CAP-02)", () => {
  const obs = (
    mission: string,
    brique: string,
    c: number,
    contexte: ObservationTemps["contexte"] = {},
    methode: string | null = "notation",
  ): ObservationTemps => ({
    mission_id: mission,
    brique_code: brique,
    methode_code: methode,
    realise_centiemes: c,
    contexte,
  });
  const base = [
    obs("m1", "collecte", 200, { taille: "pme", filieres: ["cacao", "anacarde"] }),
    obs("m2", "collecte", 300, { taille: "pme", filieres: ["cacao"] }),
    obs("m3", "collecte", 400, { taille: "pme", familiale: true }),
    obs("m4", "collecte", 1000, { taille: "grande" }),
    obs("m5", "analyse", 100, {}, "plan"),
  ];

  it("niveau contexte quand l'effectif minimum est atteint", () => {
    const [e] = estimerBriques(base, { briques: ["collecte"], contexte: { taille: "pme" } });
    expect(e).toMatchObject({
      brique_code: "collecte",
      niveau: "contexte",
      effectif_contexte: 3,
      effectif_brique: 4,
      facteurs_appliques: ["taille"],
    });
    expect(e?.resume?.mediane).toBe(300);
    // Trois missions : ni quartiles ni extrêmes (ils redonneraient les durées individuelles).
    expect(e?.resume).toEqual({
      effectif: 3,
      mediane: 300,
      q1: null,
      q3: null,
      min: null,
      max: null,
      atypiques: null,
    });
  });

  it("repli sur la brique, puis insuffisant sans statistique", () => {
    const [b] = estimerBriques(base, {
      briques: ["collecte"],
      contexte: { taille: "pme", filieres: ["cacao"], absent: null },
    });
    expect(b).toMatchObject({ niveau: "brique", effectif_contexte: null, facteurs_appliques: [] });
    expect(b?.resume?.effectif).toBe(4);
    const [i] = estimerBriques(base, { briques: ["analyse"] });
    expect(i).toMatchObject({
      niveau: "insuffisant",
      effectif_contexte: null,
      effectif_brique: null,
      resume: null,
    });
    const [sans] = estimerBriques(base, { briques: ["collecte"] });
    expect(sans?.niveau).toBe("brique");
  });

  it("filtre par méthode, dédoublonne, borne l'effectif minimum", () => {
    const r = estimerBriques(base, {
      briques: ["collecte", "collecte"],
      methode_code: "plan",
      effectifMinimum: 3,
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.niveau).toBe("insuffisant");
    // Plancher de 3 : un effectif minimum de 1 ou 2 est refusé par le moteur.
    for (const n of [0, 1, 2, 101]) {
      expect(code(() => estimerBriques(base, { briques: [], effectifMinimum: n }))).toBe(
        "EFFECTIF_MINIMUM_INVALIDE",
      );
    }
    expect(code(() => estimerBriques(base, { briques: [], effectifMinimum: 2.5 }))).toBe(
      "EFFECTIF_MINIMUM_INVALIDE",
    );
  });

  it("quartiles, extrêmes et atypiques seulement à partir de cinq observations", () => {
    const quatre = [100, 200, 300, 400].map((c, i) => obs(`q${i}`, "x", c));
    const [q4] = estimerBriques(quatre, { briques: ["x"] });
    expect(q4).toMatchObject({ niveau: "brique", effectif_brique: 4 });
    expect(q4?.resume).toMatchObject({ effectif: 4, q1: null, q3: null, min: null, max: null });
    const cinq = [100, 200, 300, 400, 500].map((c, i) => obs(`c${i}`, "x", c));
    const [q5] = estimerBriques(cinq, { briques: ["x"] });
    expect(q5?.resume).toEqual({
      effectif: 5,
      mediane: 300,
      q1: 200,
      q3: 400,
      min: 100,
      max: 500,
      atypiques: 0,
    });
    expect(EFFECTIF_MINIMUM_PLANCHER).toBe(3);
    expect(EFFECTIF_STATISTIQUES_DETAILLEES).toBe(5);
  });

  it("comparaison des facteurs : listes, scalaires, booléens", () => {
    const c = { taille: "pme", filieres: ["cacao", "anacarde"], familiale: true, effectif: 12 };
    expect(verifieContexteEstimation(c, { filieres: ["cacao"] })).toBe(true);
    expect(verifieContexteEstimation(c, { filieres: "anacarde" })).toBe(true);
    expect(verifieContexteEstimation(c, { filieres: ["riz"] })).toBe(false);
    expect(verifieContexteEstimation(c, { taille: ["pme"] })).toBe(true);
    expect(verifieContexteEstimation(c, { familiale: true, effectif: 12 })).toBe(true);
    expect(verifieContexteEstimation(c, { familiale: false })).toBe(false);
    expect(verifieContexteEstimation(c, { inconnu: "x" })).toBe(false);
    expect(verifieContexteEstimation({ inconnu: null }, { inconnu: "x" })).toBe(false);
  });
});

describe("écarts du retour d'expérience (CAP-01)", () => {
  it("écart relatif en pour mille, moitié au plus loin de zéro", () => {
    expect(ecartPourMille(120, 100)).toBe(200);
    expect(ecartPourMille(80, 100)).toBe(-200);
    expect(ecartPourMille(100, 100)).toBe(0);
    expect(ecartPourMille(1, 3)).toBe(-667);
    expect(ecartPourMille(100, 0)).toBeNull();
    expect(ecartPourMille(2001, 2000)).toBe(1); // 0,5 ‰ → 1
  });

  it("référence : budget, à défaut temps type ; signale dépassements et sous-consommations", () => {
    const r = ecartsRetour({
      budget_centiemes: 1000,
      realise_centiemes: 1300,
      briques: [
        {
          brique_code: "a",
          budget_centiemes: 400,
          realise_centiemes: 600,
          temps_type_centiemes: 50,
        },
        { brique_code: "b", budget_centiemes: 0, realise_centiemes: 30, temps_type_centiemes: 100 },
        {
          brique_code: "c",
          budget_centiemes: 0,
          realise_centiemes: 70,
          temps_type_centiemes: null,
        },
        {
          brique_code: "d",
          budget_centiemes: 600,
          realise_centiemes: 600,
          temps_type_centiemes: 0,
        },
      ],
    });
    expect(r.total).toEqual({
      budget_centiemes: 1000,
      realise_centiemes: 1300,
      ecart_centiemes: 300,
      ecart_pour_mille: 300,
    });
    expect(r.briques.map((b) => [b.reference, b.ecart_pour_mille])).toEqual([
      ["budget", 500],
      ["temps_type", -700],
      [null, null],
      ["budget", 0],
    ]);
    expect(r.depassements).toEqual(["a"]);
    expect(r.sous_consommations).toEqual(["b"]);
    expect(r.briques[2]?.ecart_centiemes).toBeNull();
  });

  it("seuil réglable et borné", () => {
    const r = ecartsRetour(
      {
        budget_centiemes: 0,
        realise_centiemes: 0,
        briques: [
          {
            brique_code: "a",
            budget_centiemes: 100,
            realise_centiemes: 105,
            temps_type_centiemes: null,
          },
        ],
      },
      40,
    );
    expect(r.depassements).toEqual(["a"]);
    expect(r.total.ecart_pour_mille).toBeNull();
    expect(
      code(() => ecartsRetour({ budget_centiemes: 0, realise_centiemes: 0, briques: [] }, -1)),
    ).toBe("SEUIL_INVALIDE");
  });

  it("formate un écart en pour cent", () => {
    expect(formaterPourMille(125)).toBe("+12,5 %");
    expect(formaterPourMille(-30)).toBe("−3 %");
    expect(formaterPourMille(0)).toBe("0 %");
    expect(code(() => formaterPourMille(1.5))).toBe("SEUIL_INVALIDE");
    expect(pourCentDepuisPourMille(125)).toBe(12.5);
    expect(pourCentDepuisPourMille(-30)).toBe(-3);
    expect(pourCentDepuisPourMille(0)).toBe(0);
    expect(code(() => pourCentDepuisPourMille(0.5))).toBe("SEUIL_INVALIDE");
  });
});

describe("analyse des dérogations (CAP-05)", () => {
  let n = 0;
  const d = (
    mission: string,
    motif: string | null,
    statut: DerogationObservee["statut"] = "approuvee",
    brique = "entretiens",
    nature = "retirer_brique",
  ): DerogationObservee => {
    n += 1;
    return {
      id: `d${String(n).padStart(3, "0")}`,
      mission_id: mission,
      methode_id: "met1",
      methode_code: "notation",
      brique_code: brique,
      nature,
      statut,
      motif,
      cree_le: `2026-01-${String(n).padStart(2, "0")}T00:00:00Z`,
    };
  };

  it("mots significatifs sans accents ni mots vides, pluriels réduits", () => {
    expect(motsDuMotif("Les entretiens sont remplacés par un atelier unique")).toEqual([
      "atelier",
      "entretien",
      "remplace",
      "unique",
    ]);
    expect(motifsSemblables([], [], 50)).toBe(true);
    expect(motifsSemblables(["a", "b"], ["a", "c"], 50)).toBe(false);
    expect(motifsSemblables(["a", "b"], ["a", "b", "c"], 50)).toBe(true);
  });

  it("regroupe par brique et nature, compte les missions, applique le seuil", () => {
    const groupes = analyserDerogations([
      d("m1", "Petite entreprise : atelier unique au lieu des entretiens"),
      d("m2", "Atelier unique au lieu des entretiens, petite entreprise"),
      d("m2", "Client indisponible pour les entretiens individuels", "refusee"),
      d("m3", null, "demandee"),
      d("m1", "Données comptables absentes", "approuvee", "analyse_financiere", "adapter_brique"),
    ]);
    expect(groupes).toHaveLength(2);
    const g = groupes[0];
    expect(g).toMatchObject({
      cle: "met1|entretiens|retirer_brique",
      missions: 3,
      derogations: 4,
      approuvees: 2,
      refusees: 1,
      demandees: 1,
      motifs_visibles: 3,
      au_dessus_du_seuil: true,
    });
    expect(g?.motifs.map((m) => m.effectif)).toEqual([2, 1]);
    expect(g?.mots_cles.map((m) => m.mot)).toContain("atelier");
    expect(groupes[1]?.au_dessus_du_seuil).toBe(false);
  });

  it("seuils bornés, clé sans méthode", () => {
    expect(code(() => analyserDerogations([], { seuilMissions: 1 }))).toBe("SEUIL_INVALIDE");
    expect(code(() => analyserDerogations([], { similarite: 0 }))).toBe("SEUIL_INVALIDE");
    expect(
      cleGroupeDerogations({ methode_id: null, brique_code: "b", nature: "activer_brique" }),
    ).toBe("sans_methode|b|activer_brique");
    const r = analyserDerogations([d("m1", "a"), d("m2", "b", "approuvee", "x")], {
      seuilMissions: 2,
      similarite: 100,
    });
    expect(r.map((g) => g.brique_code)).toEqual(["entretiens", "x"]);
  });
});

describe("matrice de compétences (CAP-06)", () => {
  it("niveau validé, déclaration en attente, preuves d'usage, à revoir", () => {
    const lignes = matriceCompetences({
      collaborateurs: ["c1", "c2"],
      competences: ["k1", "k2"],
      declarations: [
        { id: "d1", collaborateur_id: "c1", competence_id: "k1", niveau: 2, cree_le: "2026-01-01" },
        { id: "d2", collaborateur_id: "c1", competence_id: "k1", niveau: 3, cree_le: "2026-02-01" },
        { id: "d3", collaborateur_id: "c2", competence_id: "k1", niveau: 4, cree_le: "2026-01-05" },
      ],
      decisions: [
        { declaration_id: "d1", decision: "validee" },
        { declaration_id: "d3", decision: "refusee" },
      ],
      preuves: [
        { collaborateur_id: "c1", competence_id: "k1", centiemes: 150, date: "2026-03-01" },
        { collaborateur_id: "c2", competence_id: "k2", centiemes: null, date: "2026-02-01" },
        { collaborateur_id: "c2", competence_id: "k2", centiemes: 50, date: "2026-04-01" },
      ],
    });
    const c1k1 = lignes[0]?.cellules[0];
    expect(c1k1).toMatchObject({
      niveau_valide: 2,
      niveau_valide_le: "2026-01-01",
      niveau_en_attente: 3,
      declaration_en_attente_id: "d2",
      preuves: 1,
      centiemes: 150,
      a_revoir: true,
    });
    const c2k1 = lignes[1]?.cellules[0];
    expect(c2k1).toMatchObject({ niveau_valide: null, niveau_en_attente: null, a_revoir: false });
    const c2k2 = lignes[1]?.cellules[1];
    expect(c2k2).toMatchObject({
      niveau_valide: null,
      preuves: 2,
      centiemes: 50,
      derniere_preuve: "2026-04-01",
      a_revoir: true,
    });
    expect(lignes[0]?.cellules[1]).toMatchObject({
      preuves: 0,
      derniere_preuve: null,
      a_revoir: false,
    });
  });

  it("une déclaration validée récente n'est pas en attente ; niveau hors bornes refusé", () => {
    const [l] = matriceCompetences({
      collaborateurs: ["c1"],
      competences: ["k1"],
      declarations: [
        { id: "d1", collaborateur_id: "c1", competence_id: "k1", niveau: 1, cree_le: "2026-01-01" },
        { id: "d2", collaborateur_id: "c1", competence_id: "k1", niveau: 3, cree_le: "2026-02-01" },
      ],
      decisions: [{ declaration_id: "d2", decision: "validee" }],
      preuves: [],
    });
    expect(l?.cellules[0]).toMatchObject({ niveau_valide: 3, niveau_en_attente: null });
    expect(estNiveauCompetence(4)).toBe(true);
    expect(estNiveauCompetence(5)).toBe(false);
    expect(
      code(() =>
        matriceCompetences({
          collaborateurs: ["c1"],
          competences: ["k1"],
          declarations: [
            { id: "d", collaborateur_id: "c1", competence_id: "k1", niveau: 7, cree_le: "x" },
          ],
          decisions: [],
          preuves: [],
        }),
      ),
    ).toBe("NIVEAU_INVALIDE");
  });
});
