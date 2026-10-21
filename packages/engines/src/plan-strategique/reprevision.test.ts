import { describe, expect, it } from "vitest";
import { ErreurPlan } from "./erreurs";
import type { ExercicePrevisionnel } from "./modele";
import {
  FACTEUR_TENDANCE_MAX,
  FACTEUR_TENDANCE_MIN,
  METHODES_REPREVISION,
  reprevoirExercice,
  TRIMESTRES_PAR_AN,
  type RealiseTrimestre,
  type RepartitionTrimestres,
} from "./reprevision";

function profond<T>(valeur: T): T {
  if (valeur !== null && typeof valeur === "object" && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) profond(v);
  }
  return valeur;
}

/** Exercice minimal : seuls les champs lus par le moteur sont renseignés. */
function exercice(
  ca: number,
  ebe: number,
  rn: number,
  ouverture: number,
  cloture: number,
): ExercicePrevisionnel {
  return profond({
    annee: 1,
    exercice: 2027,
    compteResultat: { chiffreAffaires: ca, excedentBrutExploitation: ebe, resultatNet: rn },
    fluxTresorerie: { tresorerieOuverture: ouverture, tresorerieCloture: cloture },
  } as unknown as ExercicePrevisionnel);
}

/** CA 1 000 000 ; EBE 200 000 ; résultat net 100 000 ; trésorerie 50 000 → 130 000. */
const PLAN = exercice(1_000_000, 200_000, 100_000, 50_000, 130_000);

const r = (
  trimestre: number,
  ca: number,
  ebe: number,
  rn: number | null = null,
  treso: number | null = null,
): RealiseTrimestre => ({
  trimestre,
  chiffreAffaires: ca,
  excedentBrutExploitation: ebe,
  resultatNet: rn,
  tresorerieFin: treso,
});

function lever(f: () => unknown): ErreurPlan {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurPlan);
    expect((e as ErreurPlan).code).toBe("REPREVISION_INVALIDE");
    return e as ErreurPlan;
  }
  throw new Error("Aucune erreur levée");
}

describe("constantes", () => {
  it("expose les constantes", () => {
    expect(TRIMESTRES_PAR_AN).toBe(4);
    expect(METHODES_REPREVISION).toEqual(["reste_du_plan", "tendance"]);
    expect(FACTEUR_TENDANCE_MIN).toBe(500);
    expect(FACTEUR_TENDANCE_MAX).toBe(1500);
  });
});

describe("prévu par trimestre", () => {
  it("répartit à parts égales et interpole la trésorerie (cas à la main)", () => {
    // Parts de 250 ‰ : CA 250 000, EBE 50 000, résultat net 25 000 par trimestre.
    // Trésorerie : 50 000 + 80 000 × (250, 500, 750, 1000)/1000 = 70 000, 90 000, 110 000, 130 000.
    const res = reprevoirExercice({ exercice: PLAN, realises: [r(1, 250_000, 50_000)] });
    expect(res.moteur).toBe("engines/plan-strategique/reprevision@1");
    expect(res.prevuTrimestres).toEqual([
      {
        trimestre: 1,
        chiffreAffaires: 250_000,
        excedentBrutExploitation: 50_000,
        resultatNet: 25_000,
        tresorerieFin: 70_000,
      },
      {
        trimestre: 2,
        chiffreAffaires: 250_000,
        excedentBrutExploitation: 50_000,
        resultatNet: 25_000,
        tresorerieFin: 90_000,
      },
      {
        trimestre: 3,
        chiffreAffaires: 250_000,
        excedentBrutExploitation: 50_000,
        resultatNet: 25_000,
        tresorerieFin: 110_000,
      },
      {
        trimestre: 4,
        chiffreAffaires: 250_000,
        excedentBrutExploitation: 50_000,
        resultatNet: 25_000,
        tresorerieFin: 130_000,
      },
    ]);
    expect(res.repartition).toEqual([250, 250, 250, 250]);
    expect(res.methode).toBe("reste_du_plan");
    expect(res.seuilEcartPourMille).toBe(100);
  });

  it("arrondit vers zéro les trois premières parts, le reste sur le 4e (1001 ; −1001)", () => {
    // 1001 × 333 / 1000 = 333,333 → 333 (×3 = 999) ; Q4 = 1001 − 999 = 2. Négatif : −333 ×3, Q4 = −2.
    const res = reprevoirExercice({
      exercice: exercice(1001, -1001, 7, 0, 1),
      realises: [r(1, 0, 0)],
      repartition: [333, 333, 333, 1],
    });
    expect(res.prevuTrimestres.map((t) => t.chiffreAffaires)).toEqual([333, 333, 333, 2]);
    expect(res.prevuTrimestres.map((t) => t.excedentBrutExploitation)).toEqual([
      -333, -333, -333, -2,
    ]);
    // 7 × 333 / 1000 = 2,331 → 2 ; Q4 = 7 − 6 = 1.
    expect(res.prevuTrimestres.map((t) => t.resultatNet)).toEqual([2, 2, 2, 1]);
    // Trésorerie 0 → 1 : 1 × 333/1000 = 0,333 → 0 ; 666/1000 → 1 (0,666 arrondi) ; 999/1000 → 1 ; 1.
    expect(res.prevuTrimestres.map((t) => t.tresorerieFin)).toEqual([0, 1, 1, 1]);
  });

  it("la somme des trimestres prévus vaut l'annuel pour toute répartition", () => {
    const repartitions: RepartitionTrimestres[] = [
      [250, 250, 250, 250],
      [100, 200, 300, 400],
      [1000, 0, 0, 0],
      [0, 0, 0, 1000],
      [333, 333, 333, 1],
      [17, 483, 1, 499],
    ];
    for (const repartition of repartitions) {
      for (const annuel of [0, 1, 999_999, 1_234_567, -777_777]) {
        const res = reprevoirExercice({
          exercice: exercice(annuel, 0 - annuel, annuel + 1, 10, 20),
          realises: [r(1, 0, 0)],
          repartition,
        });
        const s = (cle: "chiffreAffaires" | "excedentBrutExploitation" | "resultatNet") =>
          res.prevuTrimestres.reduce((a, t) => a + t[cle], 0);
        expect(s("chiffreAffaires")).toBe(annuel);
        expect(s("excedentBrutExploitation")).toBe(0 - annuel);
        expect(s("resultatNet")).toBe(annuel + 1);
        expect(res.prevuTrimestres[3]?.tresorerieFin).toBe(20);
      }
    }
  });
});

describe("écarts", () => {
  it("calcule écarts, écarts relatifs en points de base et drapeaux (cas à la main)", () => {
    const res = reprevoirExercice({
      exercice: PLAN,
      realises: [r(1, 200_000, 30_000, 10_000, 60_000)],
    });
    const q1 = res.ecartsTrimestres[0];
    // CA : −50 000 / 250 000 = −20,00 % = −2000 pb (significatif, seuil 10 % = 1000 pb).
    expect(q1?.chiffreAffaires).toEqual({
      prevu: 250_000,
      reel: 200_000,
      ecart: -50_000,
      ecartRelatifPointsDeBase: -2000,
      significatif: true,
    });
    // EBE : −20 000 / 50 000 = −40,00 % ; résultat net : −15 000 / 25 000 = −60,00 %.
    expect(q1?.excedentBrutExploitation.ecartRelatifPointsDeBase).toBe(-4000);
    expect(q1?.resultatNet.ecartRelatifPointsDeBase).toBe(-6000);
    // Trésorerie : −10 000 / 70 000 = −14,2857 % → −1429 pb (demi s'éloignant de zéro).
    expect(q1?.tresorerieFin.ecart).toBe(-10_000);
    expect(q1?.tresorerieFin.ecartRelatifPointsDeBase).toBe(-1429);
    expect(res.ecartsCumules[0]).toMatchObject({
      trimestre: 1,
      chiffreAffaires: { ecart: -50_000, ecartRelatifPointsDeBase: -2000 },
    });
  });

  it("cumule sur plusieurs trimestres ; le cumul du résultat net est nul dès qu'une valeur manque", () => {
    const res = reprevoirExercice({
      exercice: PLAN,
      realises: [r(1, 200_000, 30_000, 10_000, 60_000), r(2, 300_000, 70_000, null, 95_000)],
    });
    // Cumul Q2 : CA 500 000 réel contre 500 000 prévu ; EBE 100 000 contre 100 000.
    expect(res.ecartsCumules[1]?.chiffreAffaires).toMatchObject({
      prevu: 500_000,
      reel: 500_000,
      ecart: 0,
    });
    expect(res.ecartsCumules[1]?.excedentBrutExploitation.ecart).toBe(0);
    expect(res.ecartsCumules[1]?.resultatNet).toEqual({
      prevu: 50_000,
      reel: null,
      ecart: null,
      ecartRelatifPointsDeBase: null,
      significatif: false,
    });
    expect(res.ecartsCumules[0]?.resultatNet.reel).toBe(10_000);
    expect(res.ecartsTrimestres[1]?.resultatNet.ecart).toBeNull();
  });

  it("seuil : égal au seuil = significatif ; juste en dessous non ; prévu nul : pas d'écart relatif", () => {
    // Seuil 100 ‰ = 1000 pb. Q1 prévu 250 000 : −25 000 = −1000 pb.
    const egal = reprevoirExercice({ exercice: PLAN, realises: [r(1, 225_000, 0)] });
    expect(egal.ecartsTrimestres[0]?.chiffreAffaires).toMatchObject({
      ecartRelatifPointsDeBase: -1000,
      significatif: true,
    });
    const dessous = reprevoirExercice({ exercice: PLAN, realises: [r(1, 226_000, 0)] });
    expect(dessous.ecartsTrimestres[0]?.chiffreAffaires).toMatchObject({
      ecartRelatifPointsDeBase: -960,
      significatif: false,
    });
    // Seuil 5 ‰ = 50 pb : −960 pb significatif ; seuil 1000 ‰ : jamais en dessous de 100 %.
    const serre = reprevoirExercice({
      exercice: PLAN,
      realises: [r(1, 226_000, 0)],
      seuilEcartPourMille: 5,
    });
    expect(serre.ecartsTrimestres[0]?.chiffreAffaires.significatif).toBe(true);
    const large = reprevoirExercice({
      exercice: PLAN,
      realises: [r(1, 226_000, 0)],
      seuilEcartPourMille: 1000,
    });
    expect(large.ecartsTrimestres[0]?.chiffreAffaires.significatif).toBe(false);
    // Prévu nul : écart relatif indéfini.
    const nul = reprevoirExercice({ exercice: exercice(0, 0, 0, 0, 0), realises: [r(1, 500, 0)] });
    expect(nul.ecartsTrimestres[0]?.chiffreAffaires).toEqual({
      prevu: 0,
      reel: 500,
      ecart: 500,
      ecartRelatifPointsDeBase: null,
      significatif: false,
    });
  });
});

describe("re-prévision annuelle", () => {
  const q1 = [r(1, 200_000, 30_000, 10_000, 60_000)];

  it("reste_du_plan : réalisé + reste prévu (cas à la main)", () => {
    // CA 200 000 + 750 000 = 950 000 ; EBE 30 000 + 150 000 = 180 000 ; RN 10 000 + 75 000 = 85 000.
    // Trésorerie : 130 000 + (60 000 − 70 000) + (EBE reste re-prévu − prévu = 0) = 120 000.
    const res = reprevoirExercice({ exercice: PLAN, realises: q1 });
    expect(res.facteurPourMille).toBe(1000);
    expect(res.reprevision).toEqual({
      chiffreAffaires: 950_000,
      excedentBrutExploitation: 180_000,
      resultatNet: 85_000,
      tresorerieCloture: 120_000,
    });
    expect(res.ecartsAnnuels.chiffreAffaires).toMatchObject({
      prevu: 1_000_000,
      reel: 950_000,
      ecart: -50_000,
      ecartRelatifPointsDeBase: -500,
      significatif: false,
    });
    expect(res.ecartsAnnuels.tresorerieCloture).toMatchObject({
      prevu: 130_000,
      reel: 120_000,
      ecart: -10_000,
    });
    expect(res.prevuAnnuel).toEqual({
      chiffreAffaires: 1_000_000,
      excedentBrutExploitation: 200_000,
      resultatNet: 100_000,
      tresorerieCloture: 130_000,
    });
  });

  it("tendance : facteur = cumul réalisé / cumul prévu du CA (cas à la main)", () => {
    // Facteur 200 000 × 1000 / 250 000 = 800. Reste ×0,8 : CA 600 000, EBE 120 000, RN 60 000.
    // CA 800 000 ; EBE 150 000 ; RN 70 000.
    // Trésorerie : 130 000 + (−10 000) + (120 000 − 150 000) = 90 000.
    const res = reprevoirExercice({ exercice: PLAN, realises: q1, methode: "tendance" });
    expect(res.facteurPourMille).toBe(800);
    expect(res.reprevision).toEqual({
      chiffreAffaires: 800_000,
      excedentBrutExploitation: 150_000,
      resultatNet: 70_000,
      tresorerieCloture: 90_000,
    });
  });

  it("tendance : facteur borné à [500 ; 1500], 1000 si le cumul prévu est nul", () => {
    const bas = reprevoirExercice({ exercice: PLAN, realises: [r(1, 10, 0)], methode: "tendance" });
    expect(bas.facteurPourMille).toBe(500);
    const haut = reprevoirExercice({
      exercice: PLAN,
      realises: [r(1, 1_000_000, 0)],
      methode: "tendance",
    });
    expect(haut.facteurPourMille).toBe(1500);
    const nul = reprevoirExercice({
      exercice: exercice(0, 0, 0, 0, 0),
      realises: [r(1, 100, 0)],
      methode: "tendance",
    });
    expect(nul.facteurPourMille).toBe(1000);
    // Cumul prévu nul : pas d'explication de l'écart d'EBE, mais la re-prévision existe.
    expect(nul.explicationEbe).toBeNull();
    expect(nul.reprevision.chiffreAffaires).toBe(100);
  });

  it("quatre trimestres : la re-prévision est le réalisé cumulé", () => {
    const res = reprevoirExercice({
      exercice: PLAN,
      methode: "tendance",
      realises: [
        r(1, 100, 10, 1, 5),
        r(2, 200, 20, 2, 6),
        r(3, 300, 30, 3, 7),
        r(4, 400, 40, 4, 8),
      ],
    });
    expect(res.reprevision).toEqual({
      chiffreAffaires: 1000,
      excedentBrutExploitation: 100,
      resultatNet: 10,
      tresorerieCloture: 130_000 + (8 - 130_000),
    });
    expect(res.trimestresRealises).toBe(4);
  });

  it("valeurs absentes : null, jamais 0", () => {
    // Résultat net manquant au trimestre 2 ; trésorerie manquante au trimestre 1.
    const res = reprevoirExercice({
      exercice: PLAN,
      realises: [r(1, 250_000, 50_000, 25_000, null), r(2, 250_000, 50_000, null, 90_000)],
    });
    expect(res.reprevision.resultatNet).toBeNull();
    expect(res.reprevision.tresorerieCloture).toBeNull();
    expect(res.ecartsAnnuels.resultatNet).toMatchObject({
      prevu: 100_000,
      reel: null,
      ecart: null,
    });
    expect(res.ecartsAnnuels.tresorerieCloture.reel).toBeNull();
    expect(res.reprevision.chiffreAffaires).toBe(1_000_000);
    const codes = res.faits.map((f) => f.code);
    expect(codes).not.toContain("ECART_ANNUEL_RESULTAT_NET");
    expect(codes).not.toContain("ECART_ANNUEL_TRESORERIE_CLOTURE");
    expect(codes).not.toContain("ECART_RESULTAT_NET_CUMULE");
  });
});

describe("explication de l'écart d'EBE", () => {
  it("décompose volume et marge (cas à la main)", () => {
    // Q1 : CA prévu 250 000, EBE prévu 50 000 (marge 20,00 %). Réel : CA 200 000, EBE 30 000 (15,00 %).
    // Écart EBE −20 000. Effet volume = (200 000 − 250 000) × 0,20 = −10 000.
    // Effet de marge = 200 000 × (0,15 − 0,20) = −10 000. Somme = −20 000.
    const res = reprevoirExercice({ exercice: PLAN, realises: [r(1, 200_000, 30_000)] });
    expect(res.explicationEbe).toEqual({
      chiffreAffairesPrevu: 250_000,
      chiffreAffairesReel: 200_000,
      ebePrevu: 50_000,
      ebeReel: 30_000,
      ecartEbe: -20_000,
      effetVolume: -10_000,
      effetMarge: -10_000,
      tauxMargePrevuPointsDeBase: 2000,
      tauxMargeReelPointsDeBase: 1500,
    });
  });

  it("le reste d'arrondi va à l'effet de marge ; CA réel nul : marge réelle indéfinie", () => {
    // CA prévu 3, EBE prévu 1 ; réel CA 0, EBE 5. Écart +4. Volume = (0 − 3) × 1/3 = −1 ; marge = 4 − (−1) = 5.
    const plan = exercice(12, 4, 0, 0, 0);
    const res = reprevoirExercice({
      exercice: plan,
      realises: [r(1, 0, 5)],
      repartition: [250, 250, 250, 250],
    });
    expect(res.explicationEbe).toMatchObject({
      effetVolume: -1,
      effetMarge: 5,
      ecartEbe: 4,
      tauxMargeReelPointsDeBase: null,
    });
  });

  it("la somme des deux effets vaut exactement l'écart d'EBE (propriété)", () => {
    let graine = 12345;
    const alea = (max: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine % max;
    };
    for (let i = 0; i < 200; i += 1) {
      const plan = exercice(1 + alea(5_000_000), alea(2_000_000) - 500_000, alea(900_000), 0, 0);
      const realises = Array.from({ length: 1 + alea(4) }, (_, t) =>
        r(t + 1, alea(2_000_000), alea(900_000) - 300_000),
      );
      const res = reprevoirExercice({
        exercice: plan,
        realises,
        repartition: [137, 263, 311, 289],
      });
      const e = res.explicationEbe;
      if (e === null) continue;
      expect(e.effetVolume + e.effetMarge).toBe(e.ecartEbe);
      expect(e.ecartEbe).toBe(e.ebeReel - e.ebePrevu);
    }
  });

  it("dresse une liste ordonnée de faits chiffrés, sans prose", () => {
    const res = reprevoirExercice({
      exercice: PLAN,
      realises: [r(1, 200_000, 30_000, 10_000, 60_000)],
    });
    expect(res.faits.map((f) => f.code)).toEqual([
      "ECART_CA_CUMULE",
      "ECART_EBE_CUMULE",
      "EFFET_VOLUME_EBE",
      "EFFET_MARGE_EBE",
      "ECART_RESULTAT_NET_CUMULE",
      "ECART_TRESORERIE_FIN_TRIMESTRE",
      "ECART_ANNUEL_CA",
      "ECART_ANNUEL_EBE",
      "ECART_ANNUEL_RESULTAT_NET",
      "ECART_ANNUEL_TRESORERIE_CLOTURE",
    ]);
    expect(res.faits.find((f) => f.code === "EFFET_VOLUME_EBE")?.montant).toBe(-10_000);
    expect(res.faits.find((f) => f.code === "ECART_ANNUEL_EBE")?.montant).toBe(-20_000);
    for (const f of res.faits) {
      expect(Number.isInteger(f.montant)).toBe(true);
      expect(f.libelle.length).toBeGreaterThan(0);
    }
  });
});

describe("propriétés", () => {
  it("réalisés = prévu : écarts nuls et re-prévision = plan (toutes méthodes)", () => {
    const plan = exercice(1_000_001, 200_003, 99_999, 12_345, 98_765);
    const repartition: RepartitionTrimestres = [100, 200, 300, 400];
    const base = reprevoirExercice({ exercice: plan, realises: [r(1, 0, 0)], repartition });
    for (const methode of METHODES_REPREVISION) {
      for (let k = 1; k <= 4; k += 1) {
        const realises = base.prevuTrimestres
          .slice(0, k)
          .map((p) =>
            r(
              p.trimestre,
              p.chiffreAffaires,
              p.excedentBrutExploitation,
              p.resultatNet,
              p.tresorerieFin,
            ),
          );
        const res = reprevoirExercice({ exercice: plan, realises, repartition, methode });
        expect(res.facteurPourMille).toBe(1000);
        expect(res.reprevision).toEqual({
          chiffreAffaires: 1_000_001,
          excedentBrutExploitation: 200_003,
          resultatNet: 99_999,
          tresorerieCloture: 98_765,
        });
        for (const e of res.ecartsAnnuels ? Object.values(res.ecartsAnnuels) : []) {
          expect(e.ecart).toBe(0);
          expect(e.significatif).toBe(false);
        }
        for (const t of res.ecartsTrimestres) {
          expect(t.chiffreAffaires.ecart).toBe(0);
          expect(t.tresorerieFin.ecart).toBe(0);
        }
        expect(res.explicationEbe).toMatchObject({ ecartEbe: 0, effetVolume: 0, effetMarge: 0 });
      }
    }
  });

  it("est déterministe et ne modifie jamais le plan (entrée gelée en profondeur)", () => {
    const plan = exercice(1_000_000, 200_000, 100_000, 50_000, 130_000);
    const realises = profond([
      r(1, 210_000, 41_000, 20_000, 71_000),
      r(2, 230_000, 52_000, 24_000, 88_000),
    ]);
    const repartition = profond([300, 200, 250, 250] as RepartitionTrimestres);
    const a = reprevoirExercice({ exercice: plan, realises, repartition, methode: "tendance" });
    const b = reprevoirExercice({ exercice: plan, realises, repartition, methode: "tendance" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(plan.compteResultat.chiffreAffaires).toBe(1_000_000);
    expect(Object.isFrozen(plan)).toBe(true);
    // Le résultat ne partage pas la référence de la répartition d'entrée.
    expect(a.repartition).not.toBe(repartition);
  });
});

describe("validation", () => {
  const ok = [r(1, 1, 1)];

  it("refuse les réalisés invalides", () => {
    expect(lever(() => reprevoirExercice({ exercice: PLAN, realises: [] })).chemin).toBe(
      "realises",
    );
    expect(
      lever(() =>
        reprevoirExercice({
          exercice: PLAN,
          realises: Array.from({ length: 5 }, (_, i) => r(i + 1, 1, 1)),
        }),
      ).chemin,
    ).toBe("realises");
    expect(lever(() => reprevoirExercice({ exercice: PLAN, realises: [r(2, 1, 1)] })).chemin).toBe(
      "realises[0].trimestre",
    );
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: [r(1, 1, 1), r(3, 1, 1)] })).chemin,
    ).toBe("realises[1].trimestre");
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: [r(1, 1, 1), r(1, 1, 1)] }))
        .message,
    ).toMatch(/consécutifs/);
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: [r(1, 1.5, 1)] })).chemin,
    ).toBe("realises[0].chiffreAffaires");
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: [r(1, 1, Number.NaN)] })).chemin,
    ).toBe("realises[0].excedentBrutExploitation");
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: [r(1, 1, 1, 0.5)] })).chemin,
    ).toBe("realises[0].resultatNet");
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: [r(1, 1, 1, 1, Infinity)] }))
        .chemin,
    ).toBe("realises[0].tresorerieFin");
  });

  it("refuse une méthode, un seuil ou une répartition invalides", () => {
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: ok, methode: "autre" as never }))
        .chemin,
    ).toBe("methode");
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: ok, seuilEcartPourMille: 0 }))
        .chemin,
    ).toBe("seuilEcartPourMille");
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: ok, seuilEcartPourMille: 1001 }))
        .chemin,
    ).toBe("seuilEcartPourMille");
    expect(
      lever(() => reprevoirExercice({ exercice: PLAN, realises: ok, seuilEcartPourMille: 1.5 }))
        .chemin,
    ).toBe("seuilEcartPourMille");
    expect(
      lever(() =>
        reprevoirExercice({ exercice: PLAN, realises: ok, repartition: [250, 250, 250, 251] }),
      ).message,
    ).toMatch(/1000/);
    expect(
      lever(() =>
        reprevoirExercice({ exercice: PLAN, realises: ok, repartition: [500, 500, 0] as never }),
      ).chemin,
    ).toBe("repartition");
    expect(
      lever(() =>
        reprevoirExercice({ exercice: PLAN, realises: ok, repartition: [1100, -100, 0, 0] }),
      ).chemin,
    ).toBe("repartition");
    expect(
      lever(() =>
        reprevoirExercice({ exercice: PLAN, realises: ok, repartition: [250.5, 249.5, 250, 250] }),
      ).chemin,
    ).toBe("repartition");
  });

  it("refuse un exercice absent ou non entier", () => {
    expect(
      lever(() => reprevoirExercice({ exercice: undefined as never, realises: ok })).chemin,
    ).toBe("exercice");
    expect(
      lever(() => reprevoirExercice({ exercice: exercice(1.5, 0, 0, 0, 0), realises: ok })).chemin,
    ).toBe("exercice");
  });
});
