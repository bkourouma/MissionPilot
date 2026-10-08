import { describe, expect, it } from "vitest";
import {
  calculerPlanFinancier,
  ErreurPlan,
  REFERENCES_SYSCOHADA,
  type HypothesesPlan,
} from "./index";

/**
 * Cas A — création avec investissement financé par emprunt, calculé à la main.
 * CA 100 M → +10 %/an ; marge brute 40 % ; charges variables 5 % ; fixes 10 M ;
 * 4 ETP à 3 M + 20 % de charges ; investissement 12 M sur 4 ans ; emprunt 10 M
 * à 10 % sur 2 ans ; clients 36 j, fournisseurs 60 j, stocks 30 j ; IS 25 %.
 */
const casA: HypothesesPlan = {
  premierExercice: 2027,
  horizon: 3,
  chiffreAffairesReference: 100_000_000,
  croissanceChiffreAffaires: 10,
  tauxMargeBrute: 40,
  tauxChargesVariables: 5,
  chargesFixes: 10_000_000,
  effectifs: [
    { libelle: "Consultants", effectifs: 4, salaireAnnuelBrut: 3_000_000, tauxChargesSociales: 20 },
  ],
  investissements: [{ libelle: "Matériel", annee: 1, montant: 12_000_000, dureeAmortissement: 4 }],
  emprunts: [
    { libelle: "Prêt bancaire", anneeDeblocage: 1, montant: 10_000_000, tauxAnnuel: 10, duree: 2 },
  ],
  delaiClientsJours: 36,
  delaiFournisseursJours: 60,
  stocksJours: 30,
  tauxImpotSocietes: 25,
  tauxActualisation: 10,
  bilanOuverture: { tresorerie: 20_000_000, capital: 20_000_000 },
};

describe("calculerPlanFinancier — cas A calculé à la main", () => {
  const r = calculerPlanFinancier(casA);
  const [a1, a2, a3] = r.annees;

  it("pose la devise XOF, l'horizon et les millésimes", () => {
    expect(r.devise).toBe("XOF");
    expect(r.horizon).toBe(3);
    expect(r.annees.map((a) => a.exercice)).toEqual([2027, 2028, 2029]);
  });

  it("compte de résultat de l'année 1", () => {
    expect(a1?.compteResultat).toEqual({
      chiffreAffaires: 110_000_000,
      achatsConsommes: 66_000_000,
      margeBrute: 44_000_000,
      chargesExternesVariables: 5_500_000,
      chargesExternesFixes: 10_000_000,
      valeurAjoutee: 28_500_000,
      chargesPersonnel: 14_400_000,
      excedentBrutExploitation: 14_100_000,
      dotationsAmortissements: 3_000_000,
      resultatExploitation: 11_100_000,
      fraisFinanciers: 1_000_000,
      resultatFinancier: -1_000_000,
      resultatActivitesOrdinaires: 10_100_000,
      impotSurResultat: 2_525_000,
      resultatNet: 7_575_000,
    });
  });

  it("intérêts de l'année 2 et IS arrondi demi loin de zéro", () => {
    // Intérêts : 5 238 095 × 10 % = 523 809,5 → 523 810 ; IS : 14 426 190 × 25 % = 3 606 547,5 → 3 606 548.
    expect(a2?.compteResultat.chiffreAffaires).toBe(121_000_000);
    expect(a2?.compteResultat.fraisFinanciers).toBe(523_810);
    expect(a2?.compteResultat.resultatActivitesOrdinaires).toBe(14_426_190);
    expect(a2?.compteResultat.impotSurResultat).toBe(3_606_548);
    expect(a2?.compteResultat.resultatNet).toBe(10_819_642);
    expect(a3?.compteResultat.chiffreAffaires).toBe(133_100_000);
    expect(a3?.compteResultat.fraisFinanciers).toBe(0);
    expect(a3?.compteResultat.resultatNet).toBe(14_388_750);
  });

  it("tableau des flux de l'année 1", () => {
    // BFR = 5 500 000 + 11 000 000 − 81 500 000 / 6 (13 583 333) = 2 916 667.
    expect(a1?.fluxTresorerie).toEqual({
      tresorerieOuverture: 20_000_000,
      capaciteAutofinancement: 10_575_000,
      variationBesoinFondsRoulement: 2_916_667,
      fluxActivitesOperationnelles: 7_658_333,
      acquisitionsImmobilisations: 12_000_000,
      fluxInvestissement: -12_000_000,
      augmentationsCapital: 0,
      dividendesVerses: 0,
      fluxCapitauxPropres: 0,
      empruntsNouveaux: 10_000_000,
      remboursementsEmprunts: 4_761_905,
      fluxCapitauxEtrangers: 5_238_095,
      fluxFinancement: 5_238_095,
      variationTresorerie: 896_428,
      tresorerieCloture: 20_896_428,
    });
  });

  it("bilans équilibrés, poste par poste", () => {
    expect(a1?.bilan).toEqual({
      immobilisationsNettes: 9_000_000,
      stocks: 5_500_000,
      creancesClients: 11_000_000,
      tresorerieActif: 20_896_428,
      totalActif: 46_396_428,
      capital: 20_000_000,
      reserves: 0,
      resultatExercice: 7_575_000,
      capitauxPropres: 27_575_000,
      dettesFinancieres: 5_238_095,
      dettesFournisseurs: 13_583_333,
      tresoreriePassif: 0,
      totalPassif: 46_396_428,
      tresorerieNette: 20_896_428,
      besoinFondsRoulement: 2_916_667,
    });
    expect(a2?.bilan.totalActif).toBe(53_169_642);
    expect(a2?.bilan.capitauxPropres).toBe(38_394_642);
    expect(a2?.bilan.reserves).toBe(7_575_000);
    expect(a2?.bilan.dettesFinancieres).toBe(0);
    expect(a3?.bilan.totalActif).toBe(68_869_225);
    expect(a3?.bilan.tresorerieNette).toBe(45_904_225);
    expect(a3?.bilan.capitauxPropres).toBe(52_783_392);
    expect(r.annees.every((a) => a.controle.equilibre && a.controle.ecart === 0)).toBe(true);
    expect(r.equilibre).toBe(true);
  });

  it("indicateurs de l'année 1 : point mort et ratios d'endettement", () => {
    // Charges fixes 28 400 000 ; marge sur coûts variables 38 500 000 (35 %).
    expect(a1?.indicateurs).toEqual({
      excedentBrutExploitation: 14_100_000,
      resultatNet: 7_575_000,
      capaciteAutofinancement: 10_575_000,
      tresorerieFinExercice: 20_896_428,
      pointMort: 81_142_857,
      pointMortJours: 266,
      tauxMargeCoutsVariables: 0.35,
      impotNormatif: 2_775_000,
      fluxLibre: -3_591_667,
      endettementNet: 5_238_095 - 20_896_428,
      ratioEndettement: 0.19,
      capaciteRemboursement: 0.4953,
      autonomieFinanciere: 0.5943,
      couvertureServiceDette: 2.0089,
    });
    expect(a2?.indicateurs.pointMort).toBe(79_782_314);
    expect(a2?.indicateurs.pointMortJours).toBe(237);
    expect(a2?.indicateurs.couvertureServiceDette).toBe(2.4894);
    expect(a3?.indicateurs.couvertureServiceDette).toBeNull();
  });

  it("synthèse : VAN à 10 % et TRI des flux libres", () => {
    expect(r.synthese.fluxLibres).toEqual([-3_591_667, 13_754_167, 16_884_583]);
    expect(r.synthese.valeurActuelleNette).toBe(20_787_565);
    expect(r.synthese.tauxRendementInterne).toBe(3.8074);
    expect(r.synthese.resultatNetCumule).toBe(7_575_000 + 10_819_642 + 14_388_750);
    expect(r.synthese.capaciteAutofinancementCumulee).toBe(10_575_000 + 13_819_642 + 17_388_750);
    expect(r.synthese.tresorerieFinale).toBe(45_904_225);
    expect(r.synthese.chiffreAffairesFinal).toBe(133_100_000);
    expect(r.alertes).toEqual([]);
  });

  it("rend l'échéancier de l'emprunt", () => {
    expect(r.echeanciers).toHaveLength(1);
    expect(r.echeanciers[0]?.echeances.map((e) => e.annuite)).toEqual([5_761_905, 5_761_905]);
  });

  it("est déterministe", () => {
    expect(calculerPlanFinancier(casA)).toEqual(r);
  });
});

describe("calculerPlanFinancier — cas B : pertes, déficits reportables, dividendes, alertes", () => {
  const r = calculerPlanFinancier({
    premierExercice: 2030,
    horizon: 3,
    chiffreAffairesReference: 10_000_000,
    croissanceChiffreAffaires: [0, 100, 0],
    tauxMargeBrute: 50,
    chargesFixes: 8_000_000,
    tauxDistributionDividendes: 50,
    bilanOuverture: { tresorerie: 1_000_000, capital: 1_000_000 },
  });
  const [a1, a2, a3] = r.annees;

  it("reporte le déficit et l'impute sur les bénéfices suivants", () => {
    expect(a1?.compteResultat.resultatNet).toBe(-3_000_000);
    expect(a1?.compteResultat.impotSurResultat).toBe(0);
    // Année 2 : 2 M de bénéfice entièrement imputé sur 3 M de déficit.
    expect(a2?.compteResultat.impotSurResultat).toBe(0);
    expect(a2?.compteResultat.resultatNet).toBe(2_000_000);
    // Année 3 : 1 M de déficit restant, IS 25 % sur 1 M.
    expect(a3?.compteResultat.impotSurResultat).toBe(250_000);
    expect(a3?.compteResultat.resultatNet).toBe(1_750_000);
  });

  it("verse en N+1 la moitié du résultat positif de N", () => {
    expect(a2?.fluxTresorerie.dividendesVerses).toBe(0);
    expect(a3?.fluxTresorerie.dividendesVerses).toBe(1_000_000);
    expect(a3?.bilan.reserves).toBe(-2_000_000);
    expect(a3?.bilan.capitauxPropres).toBe(750_000);
    expect(a3?.bilan.tresorerieNette).toBe(750_000);
  });

  it("porte une trésorerie négative au passif et reste équilibré", () => {
    expect(a1?.bilan.tresorerieNette).toBe(-2_000_000);
    expect(a1?.bilan.tresorerieActif).toBe(0);
    expect(a1?.bilan.tresoreriePassif).toBe(2_000_000);
    expect(a1?.bilan.totalActif).toBe(0);
    expect(a1?.bilan.totalPassif).toBe(0);
    expect(r.equilibre).toBe(true);
    expect(a1?.indicateurs.ratioEndettement).toBeNull();
    expect(a1?.indicateurs.capaciteRemboursement).toBeNull();
    expect(a1?.indicateurs.autonomieFinanciere).toBeNull();
  });

  it("point mort non atteint dans l'année 1 (plus de 360 jours)", () => {
    expect(a1?.indicateurs.pointMort).toBe(16_000_000);
    expect(a1?.indicateurs.pointMortJours).toBe(576);
  });

  it("détecte trésorerie négative, capitaux propres négatifs puis sous la moitié du capital", () => {
    expect(r.alertes).toEqual([
      {
        code: "TRESORERIE_NEGATIVE",
        gravite: "critique",
        annee: 1,
        exercice: 2030,
        montant: -2_000_000,
        seuil: 0,
      },
      {
        code: "CAPITAUX_PROPRES_NEGATIFS",
        gravite: "critique",
        annee: 1,
        exercice: 2030,
        montant: -2_000_000,
        seuil: 0,
      },
      {
        code: "CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL",
        gravite: "attention",
        annee: 2,
        exercice: 2031,
        montant: 0,
        seuil: 500_000,
      },
    ]);
  });

  it("VAN au taux par défaut (12 %) et TRI nul", () => {
    expect(r.synthese.tauxActualisation).toBe(12);
    expect(r.synthese.fluxLibres).toEqual([-3_000_000, 1_500_000, 1_500_000]);
    expect(r.synthese.valeurActuelleNette).toBe(-415_110);
    expect(r.synthese.tauxRendementInterne).toBe(0);
  });
});

describe("calculerPlanFinancier — cas C : reprise d'un bilan existant", () => {
  const r = calculerPlanFinancier({
    premierExercice: 2027,
    horizon: 3,
    chiffreAffairesReference: 0,
    croissanceChiffreAffaires: 0,
    tauxMargeBrute: 0,
    augmentationsCapital: [{ annee: 1, montant: 400_000 }],
    emprunts: [
      {
        libelle: "Prêt en cours",
        anneeDeblocage: 0,
        montant: 1_000_000,
        tauxAnnuel: 0,
        duree: 2,
        mode: "amortissement_constant",
      },
      {
        libelle: "Prêt d'équipement",
        anneeDeblocage: 2,
        montant: 300_000,
        tauxAnnuel: 10,
        duree: 3,
        differe: 1,
        mode: "amortissement_constant",
      },
    ],
    bilanOuverture: {
      immobilisationsNettes: 900_000,
      dureeResiduelleImmobilisations: 2,
      tresorerie: 600_000,
      capital: 500_000,
    },
  });
  const [a1, a2, a3] = r.annees;

  it("amortit les immobilisations d'ouverture sur leur durée résiduelle", () => {
    expect(r.annees.map((a) => a.compteResultat.dotationsAmortissements)).toEqual([
      450_000, 450_000, 0,
    ]);
    expect(a2?.bilan.immobilisationsNettes).toBe(0);
  });

  it("rembourse l'emprunt d'ouverture sans nouvel encaissement", () => {
    expect(a1?.fluxTresorerie.empruntsNouveaux).toBe(0);
    expect(a1?.fluxTresorerie.remboursementsEmprunts).toBe(500_000);
    expect(a1?.fluxTresorerie.augmentationsCapital).toBe(400_000);
    expect(a1?.bilan.capital).toBe(900_000);
    expect(a1?.bilan.dettesFinancieres).toBe(500_000);
    expect(a1?.bilan.tresorerieNette).toBe(500_000);
  });

  it("applique le différé : intérêts seuls la première année", () => {
    expect(a2?.fluxTresorerie.empruntsNouveaux).toBe(300_000);
    expect(a2?.compteResultat.fraisFinanciers).toBe(30_000);
    expect(a2?.fluxTresorerie.remboursementsEmprunts).toBe(500_000);
    expect(a3?.fluxTresorerie.remboursementsEmprunts).toBe(150_000);
    expect(a3?.bilan.dettesFinancieres).toBe(150_000);
    expect(a3?.bilan.tresorerieNette).toBe(90_000);
    expect(a3?.bilan.capitauxPropres).toBe(-60_000);
    expect(r.equilibre).toBe(true);
  });

  it("indicateurs sans chiffre d'affaires", () => {
    expect(a1?.indicateurs.pointMort).toBeNull();
    expect(a1?.indicateurs.pointMortJours).toBeNull();
    expect(a1?.indicateurs.tauxMargeCoutsVariables).toBeNull();
    expect(a1?.indicateurs.couvertureServiceDette).toBe(0);
    expect(a3?.indicateurs.ratioEndettement).toBeNull();
    expect(a3?.indicateurs.capaciteRemboursement).toBeNull();
    expect(r.synthese.tauxRendementInterne).toBeNull();
    expect(r.synthese.valeurActuelleNette).toBe(0);
  });

  it("capitaux propres égaux à la moitié du capital : pas d'alerte ; négatifs ensuite", () => {
    expect(a1?.bilan.capitauxPropres).toBe(450_000);
    expect(r.alertes.map((a) => [a.annee, a.code])).toEqual([
      [2, "CAPITAUX_PROPRES_NEGATIFS"],
      [3, "CAPITAUX_PROPRES_NEGATIFS"],
    ]);
  });

  it("l'échéancier de l'emprunt d'équipement dépasse l'horizon", () => {
    expect(r.echeanciers[1]?.echeances.map((e) => [e.annee, e.interets, e.amortissement])).toEqual([
      [2, 30_000, 0],
      [3, 30_000, 150_000],
      [4, 15_000, 150_000],
    ]);
  });
});

describe("calculerPlanFinancier — horizon et revalorisation", () => {
  it("horizon de 5 ans par défaut", () => {
    const r = calculerPlanFinancier({
      premierExercice: 2027,
      chiffreAffairesReference: 1_000_000,
      croissanceChiffreAffaires: 0,
      tauxMargeBrute: 100,
    });
    expect(r.horizon).toBe(5);
    expect(r.annees).toHaveLength(5);
    expect(r.hypotheses.tauxImpotSocietes).toBe(25);
  });

  it("revalorise les salaires et compte des ETP décimaux", () => {
    const r = calculerPlanFinancier({
      premierExercice: 2027,
      horizon: 3,
      chiffreAffairesReference: 0,
      croissanceChiffreAffaires: 0,
      tauxMargeBrute: 0,
      effectifs: [
        {
          libelle: "Assistante",
          effectifs: [0.5, 1, 1],
          salaireAnnuelBrut: 1_000_000,
          tauxChargesSociales: 18,
          revalorisationAnnuelle: 3,
        },
      ],
      bilanOuverture: { tresorerie: 10_000_000, capital: 10_000_000 },
    });
    // 0,5 × 1 000 000 × 1,18 ; 1 × 1 030 000 × 1,18 ; 1 × 1 060 900 × 1,18 = 1 251 862.
    expect(r.annees.map((a) => a.compteResultat.chargesPersonnel)).toEqual([
      590_000, 1_215_400, 1_251_862,
    ]);
  });

  it("refuse un résultat hors des entiers sûrs plutôt que de perdre en précision", () => {
    let code: string | null = null;
    try {
      calculerPlanFinancier({
        premierExercice: 2027,
        horizon: 3,
        chiffreAffairesReference: 1_000_000_000_000_000,
        croissanceChiffreAffaires: 1000,
        tauxMargeBrute: 50,
      });
    } catch (e) {
      code = (e as ErreurPlan).code;
    }
    expect(code).toBe("MONTANT_INVALIDE");
  });

  it("expose les références SYSCOHADA indicatives", () => {
    expect(REFERENCES_SYSCOHADA.compteResultat.excedentBrutExploitation).toBe("XD");
    expect(REFERENCES_SYSCOHADA.fluxTresorerie.tresorerieCloture).toBe("ZH");
  });
});
