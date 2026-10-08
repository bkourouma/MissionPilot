import { describe, expect, it } from "vitest";
import {
  analyserBancabilite,
  SEUILS_BANCABILITE_DEFAUT,
  type ExerciceBancabilite,
} from "./bancabilite";
import { ErreurPlan } from "./erreurs";
import { calculerPlanFinancier } from "./modele";

function exercice(
  exercice: number,
  e: {
    ca?: number;
    ebe?: number;
    ff?: number;
    impot?: number;
    cp?: number;
    df?: number;
    tn?: number;
    bfr?: number;
    caf?: number;
    vbfr?: number;
    inv?: number;
    apports?: number;
    div?: number;
    emp?: number;
    remb?: number;
  } = {},
): ExerciceBancabilite {
  return {
    exercice,
    compteResultat: {
      chiffreAffaires: e.ca ?? 100_000,
      excedentBrutExploitation: e.ebe ?? 30_000,
      fraisFinanciers: e.ff ?? 1_000,
      impotSurResultat: e.impot ?? 5_000,
    },
    bilan: {
      capitauxPropres: e.cp ?? 50_000,
      dettesFinancieres: e.df ?? 20_000,
      tresorerieNette: e.tn ?? 5_000,
      besoinFondsRoulement: e.bfr ?? 10_000,
    },
    fluxTresorerie: {
      capaciteAutofinancement: e.caf ?? 20_000,
      variationBesoinFondsRoulement: e.vbfr ?? 2_000,
      acquisitionsImmobilisations: e.inv ?? 8_000,
      augmentationsCapital: e.apports ?? 0,
      dividendesVerses: e.div ?? 1_000,
      empruntsNouveaux: e.emp ?? 0,
      remboursementsEmprunts: e.remb ?? 9_000,
    },
  };
}

describe("analyserBancabilite : ratios", () => {
  it("calcule les ratios en entiers et un verdict favorable", () => {
    const r = analyserBancabilite([exercice(2027)]);
    expect(r.exercices[0]?.ratios).toEqual({
      // (30 000 − 5 000) / (1 000 + 9 000) = 2,5
      couverture_service_dette: { valeur: 25_000, statut: "conforme" },
      // 20 000 / 50 000 = 0,4
      endettement: { valeur: 4_000, statut: "conforme" },
      // (20 000 − 5 000) / 30 000 = 0,5
      dette_nette_sur_ebe: { valeur: 5_000, statut: "conforme" },
      // 20 000 / 20 000 = 1 an
      capacite_remboursement: { valeur: 10_000, statut: "conforme" },
      // 10 000 × 360 / 100 000 = 36 jours
      bfr_jours: { valeur: 36, statut: "conforme" },
    });
    expect(r.verdict).toBe("favorable");
    expect(r.seuils).toEqual(SEUILS_BANCABILITE_DEFAUT);
  });

  it("signale les dépassements de seuil et rend un verdict à renforcer", () => {
    const r = analyserBancabilite([exercice(2027, { df: 80_000, bfr: 30_000, caf: 15_000 })]);
    const ratios = r.exercices[0]?.ratios;
    expect(ratios?.endettement).toEqual({ valeur: 16_000, statut: "hors_seuil" });
    expect(ratios?.bfr_jours).toEqual({ valeur: 108, statut: "hors_seuil" });
    // 80 000 / 15 000 = 5,3333 ans
    expect(ratios?.capacite_remboursement).toEqual({ valeur: 53_333, statut: "hors_seuil" });
    expect(r.horsSeuil.endettement).toEqual([2027]);
    expect(r.verdict).toBe("a_renforcer");
  });

  it("DSCR insuffisant ou capitaux propres négatifs : défavorable", () => {
    const dscr = analyserBancabilite([exercice(2027, { ebe: 11_000 })]);
    expect(dscr.exercices[0]?.ratios.couverture_service_dette).toEqual({
      valeur: 6_000,
      statut: "hors_seuil",
    });
    expect(dscr.verdict).toBe("defavorable");
    const cp = analyserBancabilite([exercice(2027, { cp: -1 })]);
    expect(cp.exercices[0]?.ratios.endettement).toEqual({ valeur: null, statut: "hors_seuil" });
    expect(cp.verdict).toBe("defavorable");
  });

  it("ratios sans objet ou non calculables : jamais remplacés par zéro", () => {
    const sansDette = analyserBancabilite([
      exercice(2027, { ff: 0, remb: 0, df: 0, tn: 5_000, ca: 0, ebe: -1, caf: -1 }),
    ]);
    expect(sansDette.exercices[0]?.ratios).toEqual({
      couverture_service_dette: { valeur: null, statut: "sans_objet" },
      endettement: { valeur: 0, statut: "conforme" },
      dette_nette_sur_ebe: { valeur: null, statut: "sans_objet" },
      capacite_remboursement: { valeur: null, statut: "sans_objet" },
      bfr_jours: { valeur: null, statut: "non_calculable" },
    });
    const ebeNegatif = analyserBancabilite([exercice(2027, { ebe: -10, caf: 0 })]);
    expect(ebeNegatif.exercices[0]?.ratios.dette_nette_sur_ebe.statut).toBe("hors_seuil");
    expect(ebeNegatif.exercices[0]?.ratios.capacite_remboursement).toEqual({
      valeur: null,
      statut: "hors_seuil",
    });
  });
});

describe("analyserBancabilite : plan de financement", () => {
  it("équilibre ressources et emplois par exercice, avec cumul", () => {
    const r = analyserBancabilite([
      exercice(2027, { apports: 5_000, emp: 10_000 }),
      exercice(2028, { vbfr: -3_000 }),
    ]);
    expect(r.planFinancement[0]).toEqual({
      exercice: 2027,
      ressources: {
        capaciteAutofinancement: 20_000,
        augmentationsCapital: 5_000,
        empruntsNouveaux: 10_000,
        diminutionBfr: 0,
        total: 35_000,
      },
      emplois: {
        investissements: 8_000,
        augmentationBfr: 2_000,
        remboursementsEmprunts: 9_000,
        dividendes: 1_000,
        total: 20_000,
      },
      solde: 15_000,
      soldeCumule: 15_000,
    });
    expect(r.planFinancement[1]?.ressources.diminutionBfr).toBe(3_000);
    expect(r.planFinancement[1]?.emplois.augmentationBfr).toBe(0);
    expect(r.planFinancement[1]?.solde).toBe(5_000);
    expect(r.planFinancement[1]?.soldeCumule).toBe(20_000);
    expect(r.totaux).toEqual({ ressources: 58_000, emplois: 38_000, solde: 20_000 });
  });

  it("le solde du plan de financement suit la variation de trésorerie du modèle", () => {
    const modele = calculerPlanFinancier({
      horizon: 3,
      premierExercice: 2027,
      chiffreAffairesReference: 100_000_000,
      croissanceChiffreAffaires: 10,
      tauxMargeBrute: 40,
      chargesFixes: 10_000_000,
      investissements: [
        { libelle: "Matériel", annee: 1, montant: 12_000_000, dureeAmortissement: 4 },
      ],
      emprunts: [
        { libelle: "Prêt", anneeDeblocage: 1, montant: 10_000_000, tauxAnnuel: 10, duree: 2 },
      ],
      delaiClientsJours: 36,
      bilanOuverture: { tresorerie: 20_000_000, capital: 20_000_000 },
    });
    const r = analyserBancabilite(modele.annees);
    r.planFinancement.forEach((p, i) => {
      const variation = modele.annees[i]?.fluxTresorerie.variationTresorerie as number;
      expect(Math.abs(p.solde - variation)).toBeLessThanOrEqual(2);
    });
    expect(r.exercices.map((e) => e.exercice)).toEqual([2027, 2028, 2029]);
  });
});

describe("analyserBancabilite : contrôles", () => {
  it("refuse un modèle vide ou trop long, un montant non entier, un seuil hors bornes", () => {
    expect(() => analyserBancabilite([])).toThrow(ErreurPlan);
    expect(() =>
      analyserBancabilite(Array.from({ length: 11 }, (_, i) => exercice(2027 + i))),
    ).toThrow(/exercices/);
    expect(() => analyserBancabilite([exercice(2027, { ca: 1.5 })])).toThrow(/entiers/);
    expect(() =>
      analyserBancabilite([exercice(2027)], { ...SEUILS_BANCABILITE_DEFAUT, bfrJoursMax: -1 }),
    ).toThrow(/Seuil/);
  });
});
