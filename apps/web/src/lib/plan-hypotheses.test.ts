import { describe, expect, it } from "vitest";
import {
  apportVide,
  ECARTS_DEFAUT,
  effectifVide,
  empruntVide,
  exercicesSaisis,
  fusionnerResultats,
  investissementVide,
  lireMontantSigne,
  MESSAGE_REQUIS,
  nombreErreurs,
  nombreVersSaisie,
  optionsAnnees,
  parAnneeVide,
  saisieDepuisHypotheses,
  saisieHypothesesInitiale,
  TAUX_ACTUALISATION_DEFAUT,
  TAUX_IS_DEFAUT,
  validerCommentaire,
  validerHypotheses,
  type SaisieHypotheses,
} from "./plan-hypotheses";
import type { HypothesesEnregistrees } from "./plan-modele";

const CTX = { horizon: 3, devise: "XOF" as const };

/** Saisie minimale valide : activité seule. */
function minimale(): SaisieHypotheses {
  const s = saisieHypothesesInitiale(3, 2027);
  s.caReference = "100 000 000";
  s.croissance.unique = "10";
  s.marge.unique = "40";
  return s;
}

describe("formulaire vierge", () => {
  it("valeurs de départ : IS 25 %, actualisation 12 %, écarts du moteur, rien d'autre", () => {
    const s = saisieHypothesesInitiale(5, 2027);
    expect(TAUX_IS_DEFAUT).toBe(25);
    expect(TAUX_ACTUALISATION_DEFAUT).toBe(12);
    expect(s.tauxIS).toBe("25");
    expect(s.tauxActualisation).toBe("12");
    expect(s.premierExercice).toBe("2027");
    expect(s.croissance).toEqual({ mode: "unique", unique: "", annees: ["", "", "", "", ""] });
    expect(s.effectifs).toEqual([]);
    expect(s.optimiste).toEqual({
      croissance: "5",
      marge: "2",
      variables: "",
      fixes: "-5",
      delaiClients: "",
    });
    expect(s.pessimiste.delaiClients).toBe("15");
    expect(ECARTS_DEFAUT.pessimiste.chargesFixes).toBe(5);
  });
});

describe("validation et corps envoyé à l'API", () => {
  it("saisie minimale : hypothèses sans horizon ni devise, écarts explicites", () => {
    const r = validerHypotheses(minimale(), CTX);
    expect(r).toEqual({
      ok: true,
      charge: {
        hypotheses: {
          premierExercice: 2027,
          chiffreAffairesReference: 100_000_000,
          croissanceChiffreAffaires: 10,
          tauxMargeBrute: 40,
          tauxImpotSocietes: 25,
          tauxActualisation: 12,
        },
        ecarts: ECARTS_DEFAUT,
      },
    });
  });

  it("valeur par année : exactement « horizon » valeurs ; case vide signalée", () => {
    const s = minimale();
    s.croissance = { mode: "annuel", unique: "", annees: ["10", "8,5", "6"] };
    const r = validerHypotheses(s, CTX);
    expect(r.ok && r.charge.hypotheses.croissanceChiffreAffaires).toEqual([10, 8.5, 6]);
    s.croissance.annees = ["10", "", "6"];
    const e = validerHypotheses(s, CTX);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.erreurs["croissance.1"]).toContain("Renseignez chaque année");
  });

  it("champs obligatoires et formats en français", () => {
    const s = saisieHypothesesInitiale(3, 2027);
    s.tauxIS = "";
    s.premierExercice = "2027,5";
    const r = validerHypotheses(s, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreurs.caReference).toBe(MESSAGE_REQUIS);
    expect(r.erreurs.croissance).toBe(MESSAGE_REQUIS);
    expect(r.erreurs.marge).toBe(MESSAGE_REQUIS);
    expect(r.erreurs.tauxIS).toBe(MESSAGE_REQUIS);
    expect(r.erreurs.premierExercice).toBe("Nombre entier attendu.");
    expect(nombreErreurs(r.erreurs)).toBe(5);
  });

  it("bornes de forme reprises du moteur (qui reste juge)", () => {
    const s = minimale();
    s.marge.unique = "150";
    s.croissance.unique = "-100";
    s.caReference = "-5";
    const r = validerHypotheses(s, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreurs.marge).toBe("Nombre attendu entre 0 et 100.");
    expect(r.erreurs.croissance).toMatch(/^Nombre attendu supérieur à -100 et d'au plus 1\s000\.$/);
    expect(r.erreurs.caReference).toContain("Montant invalide");
  });

  it("effectifs : le taux de charges sociales est obligatoire", () => {
    const s = minimale();
    s.effectifs = [{ ...effectifVide(3), libelle: "Consultants", salaire: "3 000 000" }];
    s.effectifs[0]!.effectifs.unique = "4";
    const r = validerHypotheses(s, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs["effectifs.0.chargesSociales"]).toBe(MESSAGE_REQUIS);
    s.effectifs[0]!.chargesSociales = "20";
    s.effectifs[0]!.revalorisation = "3,5";
    const ok = validerHypotheses(s, CTX);
    expect(ok.ok && ok.charge.hypotheses.effectifs).toEqual([
      {
        libelle: "Consultants",
        effectifs: 4,
        salaireAnnuelBrut: 3_000_000,
        tauxChargesSociales: 20,
        revalorisationAnnuelle: 3.5,
      },
    ]);
  });

  it("investissements, emprunts et apports bornés par l'horizon", () => {
    const s = minimale();
    s.investissements = [
      {
        ...investissementVide(),
        libelle: "Matériel",
        annee: "4",
        montant: "12 000 000",
        duree: "4",
      },
    ];
    s.emprunts = [
      {
        ...empruntVide(),
        libelle: "Prêt",
        annee: "0",
        montant: "10 000 000",
        taux: "10",
        duree: "2",
        differe: "2",
      },
    ];
    s.apports = [{ ...apportVide(), montant: "0" }];
    const r = validerHypotheses(s, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreurs["investissements.0.annee"]).toBe("Nombre entier de 1 à 3 attendu.");
    expect(r.erreurs["emprunts.0.differe"]).toContain("inférieur à la durée");
    expect(r.erreurs["apports.0.montant"]).toBe("Montant strictement positif attendu.");
    expect(r.erreurs["emprunts.0.annee"]).toBeUndefined();
  });

  it("emprunt et investissement valides : forme du moteur", () => {
    const s = minimale();
    s.investissements = [{ libelle: "Matériel", annee: "1", montant: "12 000 000", duree: "4" }];
    s.emprunts = [
      {
        libelle: "Prêt bancaire",
        annee: "1",
        montant: "10 000 000",
        taux: "10",
        duree: "2",
        differe: "",
        mode: "annuites_constantes",
      },
    ];
    s.apports = [{ annee: "2", montant: "5 000 000" }];
    const r = validerHypotheses(s, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charge.hypotheses.investissements).toEqual([
      { libelle: "Matériel", annee: 1, montant: 12_000_000, dureeAmortissement: 4 },
    ]);
    expect(r.charge.hypotheses.emprunts).toEqual([
      {
        libelle: "Prêt bancaire",
        anneeDeblocage: 1,
        montant: 10_000_000,
        tauxAnnuel: 10,
        duree: 2,
        mode: "annuites_constantes",
      },
    ]);
    expect(r.charge.hypotheses.augmentationsCapital).toEqual([{ annee: 2, montant: 5_000_000 }]);
  });

  it("montants en EUR : centimes (unités mineures)", () => {
    const s = minimale();
    s.caReference = "1 500,50";
    s.fixes.unique = "200";
    const r = validerHypotheses(s, { horizon: 3, devise: "EUR" });
    expect(r.ok && r.charge.hypotheses.chiffreAffairesReference).toBe(150_050);
    expect(r.ok && r.charge.hypotheses.chargesFixes).toBe(20_000);
    s.caReference = "1,555";
    const e = validerHypotheses(s, { horizon: 3, devise: "EUR" });
    expect(e.ok).toBe(false);
  });

  it("bilan d'ouverture : trésorerie et réserves signées, capital positif", () => {
    const s = minimale();
    s.ouverture.tresorerie = "-2 000 000";
    s.ouverture.capital = "1 000 000";
    s.ouverture.reserves = "-3 000 000";
    const r = validerHypotheses(s, CTX);
    expect(r.ok && r.charge.hypotheses.bilanOuverture).toEqual({
      tresorerie: -2_000_000,
      capital: 1_000_000,
      reserves: -3_000_000,
    });
    s.ouverture.capital = "-1";
    const e = validerHypotheses(s, CTX);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.erreurs["ouverture.capital"]).toContain("Montant invalide");
  });

  it("écarts de scénario : vides omis, charges fixes > −100 %", () => {
    const s = minimale();
    s.optimiste = { croissance: "", marge: "", variables: "", fixes: "", delaiClients: "" };
    s.pessimiste = { croissance: "-3", marge: "", variables: "", fixes: "-100", delaiClients: "" };
    const e = validerHypotheses(s, CTX);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.erreurs["pessimiste.fixes"]).toBeDefined();
    s.pessimiste.fixes = "";
    const r = validerHypotheses(s, CTX);
    expect(r.ok && r.charge.ecarts).toEqual({
      optimiste: {},
      pessimiste: { croissanceChiffreAffaires: -3 },
    });
  });
});

describe("formulaire prérempli depuis une version enregistrée", () => {
  const h: HypothesesEnregistrees = {
    premierExercice: 2027,
    chiffreAffairesReference: 100_000_000,
    croissanceChiffreAffaires: [10, 8, 6],
    tauxMargeBrute: 40,
    tauxChargesVariables: 5,
    chargesFixes: 10_000_000,
    effectifs: [
      {
        libelle: "Consultants",
        effectifs: 4,
        salaireAnnuelBrut: 3_000_000,
        tauxChargesSociales: 20,
      },
    ],
    investissements: [
      { libelle: "Matériel", annee: 1, montant: 12_000_000, dureeAmortissement: 4 },
    ],
    emprunts: [
      { libelle: "Prêt", anneeDeblocage: 1, montant: 10_000_000, tauxAnnuel: 10, duree: 2 },
    ],
    delaiClientsJours: 36,
    delaiFournisseursJours: 60,
    stocksJours: 30,
    tauxImpotSocietes: 25,
    tauxActualisation: 10,
    bilanOuverture: { tresorerie: 20_000_000, capital: 20_000_000 },
    horizon: 3,
    devise: "XOF",
  };

  it("aller-retour sans perte ; horizon et devise jamais renvoyés", () => {
    const s = saisieDepuisHypotheses(h, ECARTS_DEFAUT, "XOF", 3);
    expect(s.croissance).toEqual({ mode: "annuel", unique: "", annees: ["10", "8", "6"] });
    expect(s.caReference).toBe("100000000");
    const r = validerHypotheses(s, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const attendu: Record<string, unknown> = { ...h };
    delete attendu.horizon;
    delete attendu.devise;
    expect(r.charge.hypotheses).toEqual({
      ...attendu,
      emprunts: [{ ...h.emprunts![0], mode: "annuites_constantes" }],
    });
    expect(r.charge.ecarts).toEqual(ECARTS_DEFAUT);
    expect("horizon" in r.charge.hypotheses).toBe(false);
  });

  it("montants EUR remis en unités usuelles", () => {
    const s = saisieDepuisHypotheses(
      { ...h, chiffreAffairesReference: 150_050 },
      undefined,
      "EUR",
      3,
    );
    expect(s.caReference).toBe("1500,5");
    expect(s.optimiste.croissance).toBe("");
  });
});

describe("lectures", () => {
  it("montant signé", () => {
    expect(lireMontantSigne("-1 500", "XOF")).toBe(-1500);
    expect(lireMontantSigne("−1 500", "XOF")).toBe(-1500);
    expect(lireMontantSigne("1 500", "XOF")).toBe(1500);
    expect(lireMontantSigne("-0", "XOF")).toBe(0);
    expect(lireMontantSigne("", "XOF")).toBeNull();
    expect(lireMontantSigne("-", "XOF")).toBeNaN();
    expect(lireMontantSigne("-12,345", "EUR")).toBeNaN();
  });

  it("nombres et cases vides", () => {
    expect(nombreVersSaisie(12.5)).toBe("12,5");
    expect(nombreVersSaisie(undefined)).toBe("");
    expect(parAnneeVide(4).annees).toHaveLength(4);
  });

  it("commentaire de version", () => {
    expect(validerCommentaire("  ")).toEqual({ ok: true, charge: {} });
    expect(validerCommentaire(" Hypothèses du dirigeant ")).toEqual({
      ok: true,
      charge: { commentaire: "Hypothèses du dirigeant" },
    });
    expect(validerCommentaire("x".repeat(1001)).ok).toBe(false);
  });
});

describe("libellés d'années et fusion des validations", () => {
  it("millésimes d'après le premier exercice saisi", () => {
    expect(exercicesSaisis("2027", 3)).toEqual([2027, 2028, 2029]);
    expect(exercicesSaisis("20", 3)).toEqual([null, null, null]);
    expect(exercicesSaisis("", 2)).toEqual([null, null]);
    expect(optionsAnnees(2, [2027, 2028])).toEqual([
      { valeur: "1", libelle: "Année 1 (2027)" },
      { valeur: "2", libelle: "Année 2 (2028)" },
    ]);
    expect(optionsAnnees(2, [null, null], true)[0]).toEqual({
      valeur: "0",
      libelle: "Année 0 : déjà en cours à l'ouverture",
    });
  });

  it("fusion de deux validations", () => {
    expect(
      fusionnerResultats({ ok: true, charge: { a: 1 } }, { ok: true, charge: { b: 2 } }),
    ).toEqual({ ok: true, charge: { a: 1, b: 2 } });
    expect(
      fusionnerResultats({ ok: false, erreurs: { x: "1" } }, { ok: false, erreurs: { y: "2" } }),
    ).toEqual({ ok: false, erreurs: { x: "1", y: "2" } });
    expect(
      fusionnerResultats({ ok: true, charge: {} }, { ok: false, erreurs: { y: "2" } }),
    ).toEqual({ ok: false, erreurs: { y: "2" } });
  });
});
