import { describe, expect, it } from "vitest";
import { type ExerciceBancabilite, analyserBancabilite } from "../plan-strategique/bancabilite";
import { REFERENCES_SYSCOHADA } from "../plan-strategique/modele";
import { ErreurRedressement } from "./erreurs";
import {
  CLES_RATIO_REDRESSEMENT,
  CORRESPONDANCE_SYSCOHADA_INDICATIVE,
  type CorrespondancePostes,
  type EtatPourRatios,
  POSTES_RATIO_REDRESSEMENT,
  type PosteRatioRedressement,
  agregerPostes,
  calculerRatiosRedressement,
  calculerTendancesRedressement,
  validerCorrespondance,
} from "./ratios";

/** Cas A : codes L1 à L14 pour les 14 postes, XOF, totaux 800 M. */
const VALEURS_A: Record<PosteRatioRedressement, number> = {
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
};

const codeDe = (poste: PosteRatioRedressement): string => `L_${poste}`;

function correspondanceComplete(
  sauf: readonly PosteRatioRedressement[] = [],
): Record<string, { codes: string[]; sansObjet: boolean }> {
  return Object.fromEntries(
    POSTES_RATIO_REDRESSEMENT.filter((p) => !sauf.includes(p)).map((p) => [
      p,
      { codes: [codeDe(p)], sansObjet: false },
    ]),
  );
}

function etat(
  surcharges: Partial<Record<PosteRatioRedressement, number>> = {},
  extra: Partial<EtatPourRatios> = {},
): EtatPourRatios {
  const valeurs = { ...VALEURS_A, ...surcharges };
  return {
    exercice: 2025,
    devise: "XOF",
    lignes: POSTES_RATIO_REDRESSEMENT.map((p) => ({ code: codeDe(p), montant: valeurs[p] })),
    totalActif: 800_000_000,
    totalPassif: 800_000_000,
    resultatNet: 18_000_000,
    ...extra,
  };
}

const CORR = correspondanceComplete() as CorrespondancePostes;
const valeur = (
  e: EtatPourRatios,
  c: CorrespondancePostes,
  cle: (typeof CLES_RATIO_REDRESSEMENT)[number],
) => calculerRatiosRedressement(e, c).ratios[cle];

describe("cas A : tous les postes renseignés", () => {
  const r = calculerRatiosRedressement(etat(), CORR);

  it("rend les dix ratios en points de base (BFR en jours)", () => {
    const attendu = {
      liquidite_generale: 13636,
      liquidite_reduite: 10000,
      liquidite_immediate: 1818,
      autonomie_financiere: 1875,
      solvabilite_generale: 12308,
      endettement: 13333,
      marge_brute: 3500,
      marge_nette: 150,
      couverture_charges_financieres: 20000,
      bfr_jours: 54,
    };
    for (const cle of CLES_RATIO_REDRESSEMENT) {
      expect(r.ratios[cle], cle).toEqual({
        valeur: attendu[cle],
        statut: "calcule",
        raison: null,
        manquants: [],
      });
    }
    expect(r.exercice).toBe(2025);
    expect(r.devise).toBe("XOF");
    expect(r.postes.stocks).toBe(120_000_000);
  });

  it("est déterministe", () => {
    expect(calculerRatiosRedressement(etat(), CORR)).toEqual(r);
  });
});

describe("cas limites", () => {
  it("(B) poste sans objet : vaut 0, jamais manquant", () => {
    const sansDettes = {
      ...correspondanceComplete([
        "dettes_court_terme",
        "charges_financieres",
        "dettes_financieres",
      ]),
      dettes_court_terme: { codes: [], sansObjet: true },
      charges_financieres: { codes: [], sansObjet: true },
      dettes_financieres: { codes: [], sansObjet: true },
    } as CorrespondancePostes;
    const r = calculerRatiosRedressement(etat(), sansDettes);
    for (const cle of ["liquidite_generale", "liquidite_reduite", "liquidite_immediate"] as const) {
      expect(r.ratios[cle]).toMatchObject({
        statut: "sans_objet",
        raison: "sans_dette",
        valeur: null,
      });
    }
    expect(r.ratios.couverture_charges_financieres).toMatchObject({
      statut: "sans_objet",
      raison: "sans_charges_financieres",
    });
    expect(r.ratios.endettement).toMatchObject({ statut: "calcule", valeur: 0 });
  });

  it("(C) correspondance sans stocks : deux ratios non calculables, les huit autres inchangés", () => {
    const sansStocks = correspondanceComplete(["stocks"]) as CorrespondancePostes;
    const r = calculerRatiosRedressement(etat(), sansStocks);
    expect(r.ratios.liquidite_generale).toMatchObject({
      statut: "non_calculable",
      raison: "postes_manquants",
      manquants: ["stocks"],
      valeur: null,
    });
    expect(r.ratios.bfr_jours.manquants).toEqual(["stocks"]);
    const base = calculerRatiosRedressement(etat(), CORR);
    for (const cle of CLES_RATIO_REDRESSEMENT) {
      if (cle === "liquidite_generale" || cle === "bfr_jours") continue;
      expect(r.ratios[cle], cle).toEqual(base.ratios[cle]);
    }
  });

  it("(D) chiffre d'affaires nul : marges et BFR non calculables", () => {
    const r = calculerRatiosRedressement(etat({ chiffre_affaires: 0 }), CORR);
    for (const cle of ["marge_brute", "marge_nette", "bfr_jours"] as const) {
      expect(r.ratios[cle]).toMatchObject({
        statut: "non_calculable",
        raison: "denominateur_non_positif",
      });
    }
  });

  it("(E) capitaux propres négatifs : endettement non significatif", () => {
    const r = calculerRatiosRedressement(etat({ capitaux_propres: -10_000_000 }), CORR);
    expect(r.ratios.endettement).toMatchObject({
      statut: "non_significatif",
      raison: "denominateur_non_positif",
      valeur: null,
    });
    expect(r.ratios.autonomie_financiere.valeur).toBe(-125);
    expect(r.ratios.solvabilite_generale.valeur).toBe(9877);
  });

  it("(F) arrondi demi s'éloignant de zéro, symétrique", () => {
    const e = (net: number) => etat({ chiffre_affaires: 20_000, resultat_net: net });
    expect(valeur(e(1), CORR, "marge_nette").valeur).toBe(1);
    expect(valeur(e(-1), CORR, "marge_nette").valeur).toBe(-1);
  });

  it("(G) code absent des lignes : poste manquant, pas zéro", () => {
    const e = etat();
    const sansLigne = { ...e, lignes: e.lignes.filter((l) => l.code !== codeDe("stocks")) };
    const agreges = agregerPostes(sansLigne, CORR);
    expect(agreges.manquants).toEqual(["stocks"]);
    expect(agreges.valeurs.stocks).toBeUndefined();
  });

  it("(H) résultat net non mappé : repris du total de l'état ; deux nuls : manquant", () => {
    const sansNet = correspondanceComplete(["resultat_net"]) as CorrespondancePostes;
    expect(agregerPostes(etat(), sansNet).valeurs.resultat_net).toBe(18_000_000);
    const deuxNuls = agregerPostes(etat({}, { resultatNet: null }), sansNet);
    expect(deuxNuls.manquants).toEqual(["resultat_net"]);
    // Poste mappé mais code absent : manquant, sans repli sur le total.
    const e = etat();
    const sansLigne = { ...e, lignes: e.lignes.filter((l) => l.code !== codeDe("resultat_net")) };
    expect(agregerPostes(sansLigne, CORR).manquants).toEqual(["resultat_net"]);
  });

  it("(I) totaux absents : autonomie et solvabilité non calculables", () => {
    const r = calculerRatiosRedressement(etat({}, { totalActif: null, totalPassif: null }), CORR);
    for (const cle of ["autonomie_financiere", "solvabilite_generale"] as const) {
      expect(r.ratios[cle]).toMatchObject({ statut: "non_calculable", raison: "totaux_absents" });
    }
    const sansActif = calculerRatiosRedressement(etat({}, { totalActif: null }), CORR);
    expect(sansActif.ratios.solvabilite_generale.raison).toBe("totaux_absents");
    expect(sansActif.ratios.autonomie_financiere.statut).toBe("calcule");
  });

  it("total passif nul ou négatif : autonomie non calculable ; solvabilité sans dette", () => {
    const r = calculerRatiosRedressement(etat({}, { totalPassif: 0 }), CORR);
    expect(r.ratios.autonomie_financiere).toMatchObject({
      statut: "non_calculable",
      raison: "denominateur_non_positif",
    });
    const sansDette = calculerRatiosRedressement(etat({ capitaux_propres: 800_000_000 }), CORR);
    expect(sansDette.ratios.solvabilite_generale).toMatchObject({
      statut: "sans_objet",
      raison: "sans_dette",
    });
  });

  it("dettes à court terme négatives et charges financières négatives : non calculables", () => {
    const r = calculerRatiosRedressement(
      etat({ dettes_court_terme: -1, charges_financieres: -1 }),
      CORR,
    );
    expect(r.ratios.liquidite_immediate).toMatchObject({
      statut: "non_calculable",
      raison: "denominateur_non_positif",
    });
    expect(r.ratios.couverture_charges_financieres).toMatchObject({
      statut: "non_calculable",
      raison: "denominateur_non_positif",
    });
  });

  it("autonomie sans capitaux propres : postes manquants (avant les totaux)", () => {
    const sansCp = correspondanceComplete(["capitaux_propres"]) as CorrespondancePostes;
    const r = calculerRatiosRedressement(etat({}, { totalPassif: null }), sansCp);
    expect(r.ratios.autonomie_financiere).toMatchObject({
      raison: "postes_manquants",
      manquants: ["capitaux_propres"],
    });
  });
});

describe("erreurs de l'état", () => {
  const codeErreur = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      if (e instanceof ErreurRedressement) return e.code;
      throw e;
    }
    return "AUCUNE";
  };

  it("(K) deux lignes de même code : ETAT_INVALIDE", () => {
    const e = etat();
    const double = { ...e, lignes: [...e.lignes, { code: codeDe("stocks"), montant: 1 }] };
    expect(codeErreur(() => agregerPostes(double, CORR))).toBe("ETAT_INVALIDE");
  });

  it("ligne sans code : ETAT_INVALIDE", () => {
    const e = etat();
    expect(
      codeErreur(() => agregerPostes({ ...e, lignes: [{ code: "", montant: 1 }] }, CORR)),
    ).toBe("ETAT_INVALIDE");
  });

  it("(L) exercice hors 1990..2100 : ETAT_INVALIDE", () => {
    expect(codeErreur(() => agregerPostes(etat({}, { exercice: 1989 }), CORR))).toBe(
      "ETAT_INVALIDE",
    );
    expect(codeErreur(() => agregerPostes(etat({}, { exercice: 2101 }), CORR))).toBe(
      "ETAT_INVALIDE",
    );
    expect(codeErreur(() => agregerPostes(etat({}, { exercice: 2025.5 }), CORR))).toBe(
      "ETAT_INVALIDE",
    );
  });

  it("montant non entier ou hors 10^15 : MONTANT_INVALIDE", () => {
    expect(codeErreur(() => agregerPostes(etat({ stocks: 1.5 }), CORR))).toBe("MONTANT_INVALIDE");
    expect(codeErreur(() => agregerPostes(etat({ stocks: 1_000_000_000_000_001 }), CORR))).toBe(
      "MONTANT_INVALIDE",
    );
    expect(codeErreur(() => agregerPostes(etat({}, { totalActif: 0.5 }), CORR))).toBe(
      "MONTANT_INVALIDE",
    );
  });

  it("(M) somme hors de la plage entière sûre : SOMME_HORS_LIMITES", () => {
    const codes = Array.from({ length: 10 }, (_, i) => `G${i}`);
    const e: EtatPourRatios = {
      ...etat(),
      lignes: codes.map((code) => ({ code, montant: 1_000_000_000_000_000 })),
    };
    const c = { stocks: { codes, sansObjet: false } } as CorrespondancePostes;
    expect(codeErreur(() => agregerPostes(e, c))).toBe("SOMME_HORS_LIMITES");
  });
});

describe("(J) validerCorrespondance", () => {
  const code = (c: unknown): string => {
    try {
      validerCorrespondance(c as CorrespondancePostes);
    } catch (e) {
      if (e instanceof ErreurRedressement) return e.code;
      throw e;
    }
    return "AUCUNE";
  };
  const poste = (codes: string[], sansObjet = false) => ({ stocks: { codes, sansObjet } });

  it("accepte une correspondance valide, y compris un même code dans plusieurs postes", () => {
    expect(code(CORRESPONDANCE_SYSCOHADA_INDICATIVE)).toBe("AUCUNE");
    expect(
      code({
        stocks: { codes: ["BB"], sansObjet: false },
        creances_clients: { codes: ["BB"], sansObjet: false },
      }),
    ).toBe("AUCUNE");
    expect(code(poste([], true))).toBe("AUCUNE");
    expect(code({})).toBe("AUCUNE");
  });

  it("refuse une clé hors liste : POSTE_INCONNU", () => {
    expect(code({ inconnu: { codes: ["A"], sansObjet: false } })).toBe("POSTE_INCONNU");
  });

  it("refuse un code mal formé, doublon, trop de codes, sans objet avec codes, poste vide", () => {
    expect(code(poste(["a b"]))).toBe("CORRESPONDANCE_INVALIDE");
    expect(code(poste([""]))).toBe("CORRESPONDANCE_INVALIDE");
    expect(code(poste(["x".repeat(41)]))).toBe("CORRESPONDANCE_INVALIDE");
    expect(code(poste(["A", "A"]))).toBe("CORRESPONDANCE_INVALIDE");
    expect(code(poste(Array.from({ length: 51 }, (_, i) => `C${i}`)))).toBe(
      "CORRESPONDANCE_INVALIDE",
    );
    expect(code(poste(Array.from({ length: 50 }, (_, i) => `C${i}`)))).toBe("AUCUNE");
    expect(code(poste(["A"], true))).toBe("CORRESPONDANCE_INVALIDE");
    expect(code(poste([], false))).toBe("CORRESPONDANCE_INVALIDE");
    expect(code({ stocks: null })).toBe("CORRESPONDANCE_INVALIDE");
    expect(code({ stocks: { codes: "A", sansObjet: false } })).toBe("CORRESPONDANCE_INVALIDE");
    expect(code({ stocks: { codes: [1], sansObjet: false } })).toBe("CORRESPONDANCE_INVALIDE");
    expect(code({ stocks: { codes: [], sansObjet: "oui" } })).toBe("CORRESPONDANCE_INVALIDE");
  });

  it("nomme le poste fautif dans `manquants`", () => {
    try {
      validerCorrespondance({ stocks: { codes: [], sansObjet: false } });
      expect.unreachable();
    } catch (e) {
      expect((e as ErreurRedressement).manquants).toEqual(["stocks"]);
    }
  });
});

describe("(N) alignement avec analyserBancabilite", () => {
  it("endettement et BFR identiques à ceux du modèle prévisionnel", () => {
    const exercice: ExerciceBancabilite = {
      exercice: 2025,
      compteResultat: {
        chiffreAffaires: 1_200_000_000,
        excedentBrutExploitation: 100_000_000,
        fraisFinanciers: 24_000_000,
        impotSurResultat: 0,
      },
      bilan: {
        capitauxPropres: 150_000_000,
        dettesFinancieres: 200_000_000,
        tresorerieNette: 60_000_000,
        besoinFondsRoulement: 180_000_000,
      },
      fluxTresorerie: {
        capaciteAutofinancement: 50_000_000,
        variationBesoinFondsRoulement: 0,
        acquisitionsImmobilisations: 0,
        augmentationsCapital: 0,
        dividendesVerses: 0,
        empruntsNouveaux: 0,
        remboursementsEmprunts: 0,
      },
    };
    const autre = analyserBancabilite([exercice]).exercices[0]?.ratios;
    const r = calculerRatiosRedressement(etat(), CORR);
    expect(r.ratios.endettement.valeur).toBe(autre?.endettement.valeur);
    expect(r.ratios.bfr_jours.valeur).toBe(autre?.bfr_jours.valeur);
    expect(r.ratios.endettement.valeur).toBe(13333);
    expect(r.ratios.bfr_jours.valeur).toBe(54);
  });
});

describe("(O) correspondance SYSCOHADA indicative", () => {
  it("dix postes construits depuis REFERENCES_SYSCOHADA, sans les quatre autres", () => {
    const c = CORRESPONDANCE_SYSCOHADA_INDICATIVE;
    expect(Object.keys(c).sort()).toEqual(
      [
        "stocks",
        "creances_clients",
        "tresorerie_actif",
        "capital",
        "capitaux_propres",
        "dettes_financieres",
        "dettes_fournisseurs",
        "chiffre_affaires",
        "resultat_exploitation",
        "resultat_net",
      ].sort(),
    );
    expect(c.stocks?.codes).toEqual(["BB"]);
    expect(c.creances_clients?.codes).toEqual(["BI"]);
    expect(c.tresorerie_actif?.codes).toEqual(["BT"]);
    expect(c.capital?.codes).toEqual(["CA"]);
    expect(c.capitaux_propres?.codes).toEqual(["CP"]);
    expect(c.dettes_financieres?.codes).toEqual(["DD"]);
    expect(c.dettes_fournisseurs?.codes).toEqual(["DJ"]);
    expect(c.chiffre_affaires?.codes).toEqual([
      REFERENCES_SYSCOHADA.compteResultat.chiffreAffaires,
    ]);
    expect(c.resultat_exploitation?.codes).toEqual(["XE"]);
    expect(c.resultat_net?.codes).toEqual(["XI"]);
    for (const poste of [
      "autres_creances",
      "dettes_court_terme",
      "cout_ventes",
      "charges_financieres",
    ] as const) {
      expect(c[poste]).toBeUndefined();
    }
  });
});

describe("(P) tendances", () => {
  const courant = calculerRatiosRedressement(etat(), CORR);
  const precedent = (
    surcharges: Partial<Record<PosteRatioRedressement, number>>,
    extra: Partial<EtatPourRatios> = {},
  ) => calculerRatiosRedressement(etat(surcharges, { exercice: 2024, ...extra }), CORR);

  it("croissance du chiffre d'affaires et variation de la marge brute", () => {
    const n1 = precedent({ chiffre_affaires: 1_000_000_000, cout_ventes: 620_000_000 });
    expect(calculerTendancesRedressement(courant, n1)).toEqual({
      croissanceCaPb: 2000,
      variationMargeBrutePb: -300,
      raison: null,
    });
  });

  it("exercice précédent absent ou non consécutif", () => {
    expect(calculerTendancesRedressement(courant, null)).toEqual({
      croissanceCaPb: null,
      variationMargeBrutePb: null,
      raison: "exercice_precedent_absent",
    });
    const n2 = calculerRatiosRedressement(etat({}, { exercice: 2023 }), CORR);
    expect(calculerTendancesRedressement(courant, n2).raison).toBe("exercice_precedent_absent");
  });

  it("devises différentes : aucune conversion implicite", () => {
    const eur = precedent({}, { devise: "EUR" });
    expect(calculerTendancesRedressement(courant, eur)).toEqual({
      croissanceCaPb: null,
      variationMargeBrutePb: null,
      raison: "devises_differentes",
    });
  });

  it("chiffre d'affaires précédent nul : croissance nulle, sans raison", () => {
    const t = calculerTendancesRedressement(courant, precedent({ chiffre_affaires: 0 }));
    expect(t.croissanceCaPb).toBeNull();
    expect(t.raison).toBeNull();
    expect(t.variationMargeBrutePb).toBeNull();
  });

  it("chiffre d'affaires manquant : croissance nulle", () => {
    const sansCa = calculerRatiosRedressement(
      etat(),
      correspondanceComplete(["chiffre_affaires"]) as CorrespondancePostes,
    );
    expect(calculerTendancesRedressement(sansCa, precedent({})).croissanceCaPb).toBeNull();
  });
});
