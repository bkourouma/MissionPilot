import { describe, expect, it } from "vitest";
import {
  CRITERES_ALERTE,
  type CritereAlerte,
  type EntreesAlerte,
  type IncidentsPaiement,
  type NiveauxAlerte,
  SENS_CRITERE_ALERTE,
  SEUILS_ALERTE_DEFAUT,
  type SeuilsAlerte,
  VERSION_MOTEUR_ALERTE,
  calculerScoreAlerte,
  niveauDepuisScore,
  validerSeuilsAlerte,
} from "./alerte";
import { ErreurRedressement } from "./erreurs";
import {
  type CorrespondancePostes,
  POSTES_RATIO_REDRESSEMENT,
  type RatioRedressement,
  type RatiosExercice,
  type TendancesRedressement,
  calculerRatiosRedressement,
} from "./ratios";

const VALEURS_A = {
  stocks: 120_000_000,
  creances_clients: 240_000_000,
  autres_creances: 30_000_000,
  tresorerie_actif: 60_000_000,
  capital: 100_000_000,
  capitaux_propres: 150_000_000,
  dettes_financieres: 200_000_000,
  dettes_fournisseurs: 180_000_000,
  dettes_court_terme: 330_000_000,
  chiffre_affaires: 1_200_000_000,
  cout_ventes: 780_000_000,
  resultat_exploitation: 48_000_000,
  charges_financieres: 24_000_000,
  resultat_net: 18_000_000,
} as const;

const CORR = Object.fromEntries(
  POSTES_RATIO_REDRESSEMENT.map((p) => [p, { codes: [p], sansObjet: false }]),
) as CorrespondancePostes;

function ratiosA(surcharges: Partial<Record<keyof typeof VALEURS_A, number>> = {}): RatiosExercice {
  const v = { ...VALEURS_A, ...surcharges };
  return calculerRatiosRedressement(
    {
      exercice: 2025,
      devise: "XOF",
      lignes: POSTES_RATIO_REDRESSEMENT.map((p) => ({ code: p, montant: v[p] })),
      totalActif: 800_000_000,
      totalPassif: 800_000_000,
      resultatNet: null,
    },
    CORR,
  );
}

const TENDANCES: TendancesRedressement = {
  croissanceCaPb: 2000,
  variationMargeBrutePb: -300,
  raison: null,
};
const INCIDENTS_ZERO: IncidentsPaiement = {
  rejetsBancaires12m: 0,
  retardsFournisseurs90j: 0,
  arrieresFiscauxSociaux: false,
};
const INCIDENTS_NULS: IncidentsPaiement = {
  rejetsBancaires12m: null,
  retardsFournisseurs90j: null,
  arrieresFiscauxSociaux: null,
};
const entreesS1: EntreesAlerte = {
  ratios: ratiosA(),
  tendances: TENDANCES,
  incidents: INCIDENTS_ZERO,
};

const critere = (s: ReturnType<typeof calculerScoreAlerte>, c: CritereAlerte) =>
  s.criteres.find((x) => x.critere === c)!;

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e.code;
    throw e;
  }
  return "AUCUNE";
};

describe("score d'alerte", () => {
  it("(S1) cas A avec tendances et incidents nuls : 55 points sur 200, score 28, modéré", () => {
    const s = calculerScoreAlerte(entreesS1);
    const attendu: Record<CritereAlerte, [number | null, string]> = {
      liquidite_generale: [13636, "vert"],
      liquidite_immediate: [1818, "orange"],
      autonomie_financiere: [1875, "orange"],
      endettement: [13333, "orange"],
      couverture_charges_financieres: [20000, "orange"],
      marge_nette: [150, "orange"],
      bfr_jours: [54, "vert"],
      croissance_ca: [2000, "vert"],
      variation_marge_brute: [-300, "orange"],
      rejets_bancaires_12m: [0, "vert"],
      retards_fournisseurs_90j: [0, "vert"],
      arrieres_fiscaux_sociaux: [0, "vert"],
    };
    for (const c of CRITERES_ALERTE) {
      expect([critere(s, c).valeur, critere(s, c).statut], c).toEqual(attendu[c]);
    }
    expect(s).toMatchObject({
      version: VERSION_MOTEUR_ALERTE,
      pointsPonderes: 55,
      poidsEvalue: 100,
      poidsTotal: 100,
      score: 28,
      niveau: "modere",
    });
    expect(s.criteresRouges).toEqual([]);
    expect(s.criteresOranges).toEqual([
      "liquidite_immediate",
      "autonomie_financiere",
      "endettement",
      "couverture_charges_financieres",
      "marge_nette",
      "variation_marge_brute",
    ]);
    expect(critere(s, "liquidite_immediate")).toMatchObject({ points: 1, poids: 10, motif: null });
    expect(critere(s, "bfr_jours").points).toBe(0);
    expect(s.criteres.map((c) => c.critere)).toEqual([...CRITERES_ALERTE]);
  });

  it("(S2) tendances et incidents non renseignés : 70 de poids évalué, score 36", () => {
    const s = calculerScoreAlerte({
      ratios: ratiosA(),
      tendances: null,
      incidents: INCIDENTS_NULS,
    });
    expect(s).toMatchObject({ poidsEvalue: 70, pointsPonderes: 50, score: 36, niveau: "modere" });
    expect(critere(s, "croissance_ca")).toMatchObject({
      statut: "non_evalue",
      points: null,
      motif: "non_calculable",
      valeur: null,
    });
    expect(critere(s, "rejets_bancaires_12m")).toMatchObject({
      statut: "non_evalue",
      motif: "non_renseigne",
    });
    expect(critere(s, "retards_fournisseurs_90j").motif).toBe("non_renseigne");
    expect(critere(s, "arrieres_fiscaux_sociaux").motif).toBe("non_renseigne");
  });

  it("(S3) données insuffisantes : score nul, niveau insuffisant", () => {
    const s = calculerScoreAlerte({ ratios: null, tendances: null, incidents: INCIDENTS_ZERO });
    expect(s).toMatchObject({ score: null, niveau: "insuffisant", poidsEvalue: 15 });
    expect(critere(s, "liquidite_generale")).toMatchObject({ statut: "non_evalue", points: null });
  });

  it("tendances à composantes nulles : critères non évalués", () => {
    const s = calculerScoreAlerte({
      ratios: ratiosA(),
      tendances: {
        croissanceCaPb: null,
        variationMargeBrutePb: null,
        raison: "exercice_precedent_absent",
      },
      incidents: INCIDENTS_ZERO,
    });
    expect(critere(s, "croissance_ca").statut).toBe("non_evalue");
    expect(critere(s, "variation_marge_brute").statut).toBe("non_evalue");
    expect(s.poidsEvalue).toBe(85);
  });

  it("(S4) capitaux propres négatifs : endettement non significatif → rouge (signal critique)", () => {
    const s = calculerScoreAlerte({
      ...entreesS1,
      ratios: ratiosA({ capitaux_propres: -10_000_000 }),
    });
    expect(critere(s, "endettement")).toMatchObject({
      statut: "rouge",
      motif: "signal_critique",
      valeur: null,
      points: 2,
    });
    expect(critere(s, "autonomie_financiere")).toMatchObject({ valeur: -125, statut: "rouge" });
    expect(s).toMatchObject({ pointsPonderes: 75, score: 38, niveau: "modere" });
    expect(s.criteresRouges).toEqual(["autonomie_financiere", "endettement"]);
  });

  it("(S5) incidents de paiement : rouge, orange, rouge → 80 points, score 40", () => {
    const s = calculerScoreAlerte({
      ...entreesS1,
      incidents: { rejetsBancaires12m: 3, retardsFournisseurs90j: 1, arrieresFiscauxSociaux: true },
    });
    expect(critere(s, "rejets_bancaires_12m").statut).toBe("rouge");
    expect(critere(s, "retards_fournisseurs_90j").statut).toBe("orange");
    expect(critere(s, "arrieres_fiscaux_sociaux")).toMatchObject({ statut: "rouge", valeur: 1 });
    expect(s).toMatchObject({ pointsPonderes: 80, score: 40, niveau: "modere" });
  });

  it("(S6) inégalités strictes aux bornes", () => {
    const statut = (cle: CritereAlerte, valeur: number) => {
      const ratios = ratiosA();
      const faux = {
        ...ratios,
        ratios: {
          ...ratios.ratios,
          [cle]: {
            valeur,
            statut: "calcule",
            raison: null,
            manquants: [],
          } satisfies RatioRedressement,
        },
      } as RatiosExercice;
      return critere(calculerScoreAlerte({ ...entreesS1, ratios: faux }), cle).statut;
    };
    expect(statut("endettement", 10_000)).toBe("vert");
    expect(statut("endettement", 10_001)).toBe("orange");
    expect(statut("endettement", 20_000)).toBe("orange");
    expect(statut("endettement", 20_001)).toBe("rouge");
    expect(statut("marge_nette", 200)).toBe("vert");
    expect(statut("marge_nette", 199)).toBe("orange");
    expect(statut("marge_nette", 0)).toBe("orange");
    expect(statut("marge_nette", -1)).toBe("rouge");
    expect(statut("liquidite_generale", 12_000)).toBe("vert");
    expect(statut("liquidite_generale", 10_000)).toBe("orange");
    expect(statut("liquidite_generale", 9_999)).toBe("rouge");
  });

  it("(S7) ratio sans objet → vert, motif sans_objet, valeur nulle", () => {
    const r = ratiosA({ charges_financieres: 0 });
    const s = calculerScoreAlerte({ ...entreesS1, ratios: r });
    expect(critere(s, "couverture_charges_financieres")).toMatchObject({
      statut: "vert",
      motif: "sans_objet",
      valeur: null,
      points: 0,
    });
  });

  it("ratio non calculable → non évalué", () => {
    const s = calculerScoreAlerte({ ...entreesS1, ratios: ratiosA({ chiffre_affaires: 0 }) });
    for (const c of ["marge_nette", "bfr_jours"] as const) {
      expect(critere(s, c)).toMatchObject({ statut: "non_evalue", motif: "non_calculable" });
    }
  });

  it("(S10) déterminisme", () => {
    expect(calculerScoreAlerte(entreesS1)).toEqual(calculerScoreAlerte(entreesS1));
  });

  it("des seuils sur mesure changent le résultat", () => {
    const stricts: SeuilsAlerte = {
      ...SEUILS_ALERTE_DEFAUT,
      criteres: {
        ...SEUILS_ALERTE_DEFAUT.criteres,
        bfr_jours: { orange: 30, rouge: 50, poids: 5 },
      },
    };
    expect(critere(calculerScoreAlerte(entreesS1, stricts), "bfr_jours").statut).toBe("rouge");
  });

  it("la sortie ne qualifie rien : aucun terme juridique", () => {
    const sortie = JSON.stringify(calculerScoreAlerte(entreesS1)).toLowerCase();
    for (const interdit of ["cessation", "faillite", "défaillance", "procédure"]) {
      expect(sortie).not.toContain(interdit);
    }
  });

  it("incidents invalides : ENTREE_INVALIDE", () => {
    expect(
      code(() =>
        calculerScoreAlerte({
          ...entreesS1,
          incidents: { ...INCIDENTS_ZERO, rejetsBancaires12m: 1000 },
        }),
      ),
    ).toBe("ENTREE_INVALIDE");
    expect(
      code(() =>
        calculerScoreAlerte({
          ...entreesS1,
          incidents: { ...INCIDENTS_ZERO, retardsFournisseurs90j: -1 },
        }),
      ),
    ).toBe("ENTREE_INVALIDE");
    expect(
      code(() =>
        calculerScoreAlerte({
          ...entreesS1,
          incidents: { ...INCIDENTS_ZERO, rejetsBancaires12m: 1.5 },
        }),
      ),
    ).toBe("ENTREE_INVALIDE");
    expect(
      code(() =>
        calculerScoreAlerte({
          ...entreesS1,
          incidents: { ...INCIDENTS_ZERO, arrieresFiscauxSociaux: 1 as never },
        }),
      ),
    ).toBe("ENTREE_INVALIDE");
  });

  it("valide ses seuils avant tout calcul", () => {
    const invalides = {
      ...SEUILS_ALERTE_DEFAUT,
      partMinimaleEvalueePct: 5,
    };
    expect(code(() => calculerScoreAlerte(entreesS1, invalides))).toBe("SEUILS_INVALIDES");
  });
});

describe("(S8) niveaux", () => {
  const niveaux = SEUILS_ALERTE_DEFAUT.niveaux;
  it("bornes : 24 faible, 25 modéré, 49 modéré, 50 élevé, 74 élevé, 75 critique", () => {
    expect(niveauDepuisScore(0, niveaux)).toBe("faible");
    expect(niveauDepuisScore(24, niveaux)).toBe("faible");
    expect(niveauDepuisScore(25, niveaux)).toBe("modere");
    expect(niveauDepuisScore(49, niveaux)).toBe("modere");
    expect(niveauDepuisScore(50, niveaux)).toBe("eleve");
    expect(niveauDepuisScore(74, niveaux)).toBe("eleve");
    expect(niveauDepuisScore(75, niveaux)).toBe("critique");
    expect(niveauDepuisScore(100, niveaux)).toBe("critique");
  });

  it("des niveaux sur mesure s'appliquent au score calculé", () => {
    const sur: NiveauxAlerte = { modere: 10, eleve: 20, critique: 28 };
    const s = calculerScoreAlerte(entreesS1, { ...SEUILS_ALERTE_DEFAUT, niveaux: sur });
    expect(s.score).toBe(28);
    expect(s.niveau).toBe("critique");
  });
});

describe("(S9) validerSeuilsAlerte", () => {
  const defaut = SEUILS_ALERTE_DEFAUT;
  const avec = (
    modif: (c: Record<CritereAlerte, { orange: number; rouge: number; poids: number }>) => void,
    reste: Partial<SeuilsAlerte> = {},
  ): SeuilsAlerte => {
    const criteres = JSON.parse(JSON.stringify(defaut.criteres)) as Record<
      CritereAlerte,
      { orange: number; rouge: number; poids: number }
    >;
    modif(criteres);
    return { ...defaut, criteres, ...reste };
  };

  it("passe pour les seuils par défaut (somme des poids 100)", () => {
    expect(code(() => validerSeuilsAlerte(defaut))).toBe("AUCUNE");
    expect(Object.values(defaut.criteres).reduce((s, c) => s + c.poids, 0)).toBe(100);
  });

  it("refuse chaque règle violée", () => {
    const refus = (s: SeuilsAlerte) => code(() => validerSeuilsAlerte(s));
    expect(
      refus(
        avec((c) => {
          delete (c as Partial<typeof c>).bfr_jours;
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    expect(
      refus(
        avec((c) => {
          (c as Record<string, unknown>).en_trop = { orange: 0, rouge: 0, poids: 0 };
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    // bas_pire : rouge > orange.
    expect(
      refus(
        avec((c) => {
          c.liquidite_generale = { orange: 10_000, rouge: 12_000, poids: 15 };
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    // haut_pire : rouge < orange.
    expect(
      refus(
        avec((c) => {
          c.endettement = { orange: 20_000, rouge: 10_000, poids: 10 };
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    // Somme 99.
    expect(
      refus(
        avec((c) => {
          c.bfr_jours.poids = 4;
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    // Valeur non entière, hors bornes, poids hors bornes.
    expect(
      refus(
        avec((c) => {
          c.bfr_jours.orange = 60.5;
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    expect(
      refus(
        avec((c) => {
          c.bfr_jours.rouge = 1_000_001;
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    expect(
      refus(
        avec((c) => {
          c.bfr_jours.poids = 5.5;
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    expect(
      refus(
        avec((c) => {
          c.bfr_jours.poids = 101;
          c.arrieres_fiscaux_sociaux.poids = -1;
        }),
      ),
    ).toBe("SEUILS_INVALIDES");
    // Niveaux non croissants, hors bornes, non entiers.
    expect(refus({ ...defaut, niveaux: { modere: 50, eleve: 50, critique: 75 } })).toBe(
      "SEUILS_INVALIDES",
    );
    expect(refus({ ...defaut, niveaux: { modere: 0, eleve: 50, critique: 75 } })).toBe(
      "SEUILS_INVALIDES",
    );
    expect(refus({ ...defaut, niveaux: { modere: 25, eleve: 50, critique: 101 } })).toBe(
      "SEUILS_INVALIDES",
    );
    expect(refus({ ...defaut, niveaux: { modere: 25.5, eleve: 50, critique: 75 } })).toBe(
      "SEUILS_INVALIDES",
    );
    // Part minimale évaluée.
    expect(refus({ ...defaut, partMinimaleEvalueePct: 9 })).toBe("SEUILS_INVALIDES");
    expect(refus({ ...defaut, partMinimaleEvalueePct: 101 })).toBe("SEUILS_INVALIDES");
    expect(refus({ ...defaut, partMinimaleEvalueePct: 50.5 })).toBe("SEUILS_INVALIDES");
    expect(refus({ ...defaut, criteres: null } as never)).toBe("SEUILS_INVALIDES");
    expect(refus({ ...defaut, niveaux: null } as never)).toBe("SEUILS_INVALIDES");
  });

  it("nomme le critère fautif", () => {
    try {
      validerSeuilsAlerte(
        avec((c) => {
          c.bfr_jours.orange = 0.5;
        }),
      );
      expect.unreachable();
    } catch (e) {
      expect((e as ErreurRedressement).manquants).toEqual(["bfr_jours"]);
    }
  });

  it("des seuils sur mesure conformes sont acceptés (poids répartis autrement)", () => {
    const sur = avec((c) => {
      c.liquidite_generale.poids = 25;
      c.bfr_jours.poids = 0;
      c.croissance_ca.poids = 5;
    });
    expect(code(() => validerSeuilsAlerte(sur))).toBe("AUCUNE");
  });
});

describe("(S11) non-régression des seuils par défaut (SPEC-3a §13.1)", () => {
  it("poids, orange, rouge, niveaux et part minimale", () => {
    const attendu: Record<CritereAlerte, [number, number, number]> = {
      liquidite_generale: [12_000, 10_000, 15],
      liquidite_immediate: [2_000, 1_000, 10],
      autonomie_financiere: [2_500, 1_000, 10],
      endettement: [10_000, 20_000, 10],
      couverture_charges_financieres: [30_000, 15_000, 10],
      marge_nette: [200, 0, 10],
      bfr_jours: [60, 90, 5],
      croissance_ca: [0, -1_000, 10],
      variation_marge_brute: [0, -500, 5],
      rejets_bancaires_12m: [0, 2, 5],
      retards_fournisseurs_90j: [0, 4, 5],
      arrieres_fiscaux_sociaux: [0, 0, 5],
    };
    for (const c of CRITERES_ALERTE) {
      const s = SEUILS_ALERTE_DEFAUT.criteres[c];
      expect([s.orange, s.rouge, s.poids], c).toEqual(attendu[c]);
    }
    expect(SEUILS_ALERTE_DEFAUT.niveaux).toEqual({ modere: 25, eleve: 50, critique: 75 });
    expect(SEUILS_ALERTE_DEFAUT.partMinimaleEvalueePct).toBe(50);
  });

  it("sens des critères : intrinsèques", () => {
    expect(SENS_CRITERE_ALERTE.endettement).toBe("haut_pire");
    expect(SENS_CRITERE_ALERTE.bfr_jours).toBe("haut_pire");
    expect(SENS_CRITERE_ALERTE.liquidite_generale).toBe("bas_pire");
    expect(Object.keys(SENS_CRITERE_ALERTE)).toHaveLength(12);
  });
});
