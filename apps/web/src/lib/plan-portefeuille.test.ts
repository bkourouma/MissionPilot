import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminArbitrages,
  cheminArbitrer,
  cheminEvaluation,
  cheminPortefeuille,
  cheminProposition,
  ecartsArbitrage,
  hrefPortefeuille,
  libelleMotifMoteur,
  messagePortefeuille,
  saisieContraintes,
  saisieEvaluation,
  validerArbitrage,
  validerContraintes,
  validerEvaluation,
  type Proposition,
} from "./plan-portefeuille";

const proposition: Pick<Proposition, "decisions" | "retenues"> = {
  decisions: [
    { id: "a", score: 88, retenue: false, motif: "contraintes" },
    { id: "b", score: 75, retenue: true, motif: "optimisation" },
    { id: "c", score: 75, retenue: true, motif: "optimisation" },
  ],
  retenues: ["b", "c"],
};

describe("évaluation", () => {
  it("préremplit et valide les notes et la charge", () => {
    expect(saisieEvaluation(null)).toEqual({
      valeur: "",
      effort: "",
      risque: "",
      charge_jours: "",
      commentaire: "",
    });
    const s = saisieEvaluation({
      version: 1,
      valeur: 4,
      effort: 2,
      risque: 3,
      charge_jours: 20,
      commentaire: null,
      auteur_id: "u",
      cree_le: "",
      score: 70,
    });
    expect(validerEvaluation(s).corps).toEqual({
      valeur: 4,
      effort: 2,
      risque: 3,
      charge_jours: 20,
      commentaire: null,
    });
    const refus = validerEvaluation({
      valeur: "6",
      effort: "",
      risque: "0",
      charge_jours: "1,5",
      commentaire: "x".repeat(1001),
    });
    expect(Object.keys(refus.erreurs).sort()).toEqual([
      "charge_jours",
      "commentaire",
      "effort",
      "risque",
      "valeur",
    ]);
  });
});

describe("contraintes", () => {
  it("lit budget et capacité (vides : sans limite), poids et listes", () => {
    const s = {
      ...saisieContraintes({ valeur: 5, effort: 3, risque: 2 }),
      budget_max: "10 000 000",
    };
    expect(validerContraintes(s, "XOF").corps).toEqual({
      budget_max: 10_000_000,
      capacite_max: null,
      poids: { valeur: 5, effort: 3, risque: 2 },
      obligatoires: [],
      exclues: [],
    });
    expect(
      validerContraintes({ ...s, budget_max: "", capacite_max: "40" }, "XOF").corps,
    ).toMatchObject({
      budget_max: null,
      capacite_max: 40,
    });
  });

  it("refuse montant, capacité, poids invalides ou nuls, obligatoire exclue", () => {
    const base = saisieContraintes({ valeur: 5, effort: 3, risque: 2 });
    const r = validerContraintes(
      { ...base, budget_max: "abc", capacite_max: "-1", obligatoires: ["a"], exclues: ["a"] },
      "XOF",
    );
    expect(Object.keys(r.erreurs).sort()).toEqual(["budget_max", "capacite_max", "exclues"]);
    expect(
      validerContraintes(
        { ...base, poids_valeur: "0", poids_effort: "0", poids_risque: "0" },
        "XOF",
      ).erreurs.poids_valeur,
    ).toBe("Au moins un poids non nul.");
    expect(validerContraintes({ ...base, poids_valeur: "11" }, "XOF").erreurs.poids_valeur).toBe(
      "Poids entiers de 0 à 10.",
    );
  });
});

describe("arbitrage", () => {
  it("relève les écarts à la proposition et exige leur motif", () => {
    expect(ecartsArbitrage(proposition, ["b", "c"])).toEqual([]);
    expect(ecartsArbitrage(proposition, ["a", "b"])).toEqual(["a", "c"]);
    const sansMotif = validerArbitrage({}, proposition, ["a", "b"], { a: "Exigence" }, "");
    expect(sansMotif.manquants).toEqual(["c"]);
    expect(sansMotif.corps).toBeNull();
    const ok = validerArbitrage(
      { budget_max: 1 },
      proposition,
      ["a", "b"],
      { a: " Exigence ", c: "Reporté" },
      " Comité ",
    );
    expect(ok.corps).toEqual({
      contraintes: { budget_max: 1 },
      retenues: ["a", "b"],
      motifs: [
        { initiative_id: "a", motif: "Exigence" },
        { initiative_id: "c", motif: "Reporté" },
      ],
      commentaire: "Comité",
    });
    expect(validerArbitrage({}, proposition, ["b", "c"], {}, "").corps).not.toHaveProperty(
      "commentaire",
    );
  });

  it("libelle les décisions du moteur et traduit les refus", () => {
    expect(libelleMotifMoteur("contraintes")).toContain("budget ou capacité");
    expect(libelleMotifMoteur("x")).toBe("Décision du moteur");
    expect(messagePortefeuille(new ErreurApi("MOTIF_REQUIS", "x", 400))).toContain("motif");
    expect(messagePortefeuille(new ErreurApi("TROP_DE_PROPOSITIONS", "x", 429))).toContain(
      "Trop de propositions",
    );
    expect(messagePortefeuille(new ErreurApi("INTERDIT", "x", 403))).toContain("responsables");
    expect(messagePortefeuille(new ErreurApi("INTROUVABLE", "x", 404))).toContain("introuvable");
    expect(messagePortefeuille(new ErreurApi("CONFLIT", "Identique.", 409))).toBe("Identique.");
    expect(messagePortefeuille(new ErreurApi("REQUETE_INVALIDE", "Hors plan.", 400))).toBe(
      "Hors plan.",
    );
  });

  it("construit les chemins", () => {
    expect(hrefPortefeuille("m", "p")).toBe("/missions/m/plan/p/portefeuille");
    expect(cheminPortefeuille("p")).toBe("/api/plans/p/portefeuille");
    expect(cheminEvaluation("p", "i")).toBe("/api/plans/p/portefeuille/initiatives/i");
    expect(cheminProposition("p")).toBe("/api/plans/p/portefeuille/proposition");
    expect(cheminArbitrages("p")).toBe("/api/plans/p/portefeuille/arbitrages?limite=10");
    expect(cheminArbitrer("p")).toBe("/api/plans/p/portefeuille/arbitrages");
  });
});
