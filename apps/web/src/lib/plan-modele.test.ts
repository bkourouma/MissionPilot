import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import { formaterMontantMineur, formaterPourcentage } from "./format";
import {
  alertesParScenario,
  cheminComparaison,
  cheminListeModeles,
  cheminRoi,
  cheminSimulation,
  cheminValidationModele,
  cheminVersionModele,
  descriptionEcarts,
  etatModeleChange,
  ETATS_FINANCIERS,
  exercicesTresorerieNegative,
  formaterPoints,
  formaterSigne,
  formaterValeur,
  grouperLignes,
  indicateursCles,
  libelleAlerte,
  libelleChemin,
  libelleValidationModele,
  libelleVersionModele,
  LIGNES_BILAN,
  LIGNES_COMPTE_RESULTAT,
  LIGNES_FLUX,
  LIGNES_INDICATEURS,
  lignesScenarios,
  lignesSerieComparee,
  lireComparaison,
  lireNumeroVersionModele,
  MENTION_SYSCOHADA,
  MESSAGE_INTROUVABLE_MODELE,
  MESSAGE_PLAFOND,
  messageModele,
  messageVersionEnregistree,
  noteTauxRoi,
  plafondAtteint,
  resumeAlertes,
  texteAlerte,
  titreAlertesScenario,
  traduireMessageMoteur,
  VERSIONS_MODELE_MAX,
  type AlertePlan,
  type ExercicePlan,
  type ResultatPlan,
  type SyntheseScenario,
} from "./plan-modele";

/** Exercice de test : chaque champ porte une valeur distincte (aucun calcul attendu). */
function exercice(annee: number): ExercicePlan {
  let n = annee * 1000;
  const suivant = () => (n += 1);
  const remplir = <T extends string>(cles: readonly T[]) =>
    Object.fromEntries(cles.map((c) => [c, suivant()])) as Record<T, number>;
  return {
    annee,
    exercice: 2026 + annee,
    compteResultat: remplir([
      "chiffreAffaires",
      "achatsConsommes",
      "margeBrute",
      "chargesExternesVariables",
      "chargesExternesFixes",
      "valeurAjoutee",
      "chargesPersonnel",
      "excedentBrutExploitation",
      "dotationsAmortissements",
      "resultatExploitation",
      "fraisFinanciers",
      "resultatFinancier",
      "resultatActivitesOrdinaires",
      "impotSurResultat",
      "resultatNet",
    ]),
    bilan: remplir([
      "immobilisationsNettes",
      "stocks",
      "creancesClients",
      "tresorerieActif",
      "totalActif",
      "capital",
      "reserves",
      "resultatExercice",
      "capitauxPropres",
      "dettesFinancieres",
      "dettesFournisseurs",
      "tresoreriePassif",
      "totalPassif",
      "tresorerieNette",
      "besoinFondsRoulement",
    ]),
    fluxTresorerie: remplir([
      "tresorerieOuverture",
      "capaciteAutofinancement",
      "variationBesoinFondsRoulement",
      "fluxActivitesOperationnelles",
      "acquisitionsImmobilisations",
      "fluxInvestissement",
      "augmentationsCapital",
      "dividendesVerses",
      "fluxCapitauxPropres",
      "empruntsNouveaux",
      "remboursementsEmprunts",
      "fluxCapitauxEtrangers",
      "fluxFinancement",
      "variationTresorerie",
      "tresorerieCloture",
    ]),
    indicateurs: {
      ...remplir([
        "excedentBrutExploitation",
        "resultatNet",
        "capaciteAutofinancement",
        "tresorerieFinExercice",
        "pointMort",
        "pointMortJours",
        "impotNormatif",
        "fluxLibre",
        "endettementNet",
      ]),
      tauxMargeCoutsVariables: 0.4321,
      ratioEndettement: null,
      capaciteRemboursement: 2.5,
      autonomieFinanciere: 0.25,
      couvertureServiceDette: 1.75,
    },
    controle: { totalActif: 1, totalPassif: 1, ecart: 0, equilibre: true },
  };
}

const alerte = (code: string, exercice: number, gravite: AlertePlan["gravite"] = "critique") => ({
  code,
  gravite,
  annee: exercice - 2026,
  exercice,
  montant: -1_500_000,
  seuil: 0,
});

function resultat(alertes: AlertePlan[] = []): ResultatPlan {
  return {
    devise: "XOF",
    horizon: 3,
    premierExercice: 2027,
    annees: [exercice(1), exercice(2), exercice(3)],
    echeanciers: [],
    synthese: {
      chiffreAffairesFinal: 1,
      resultatNetCumule: 2,
      capaciteAutofinancementCumulee: 3,
      tresorerieFinale: 4,
      fluxLibres: [5, 6, 7],
      tauxActualisation: 12,
      valeurActuelleNette: 8,
      tauxRendementInterne: 0.1,
    },
    equilibre: true,
    alertes,
  };
}

describe("mise en forme des valeurs du moteur", () => {
  it("montants dans la devise du plan (unités mineures), sans recalcul", () => {
    expect(formaterValeur("montant", 1_500_000, "XOF")).toBe(
      formaterMontantMineur(1_500_000, "XOF"),
    );
    expect(formaterValeur("montant", 123_450, "EUR")).toBe(formaterMontantMineur(123_450, "EUR"));
    expect(formaterValeur("montant", 123_450, "EUR")).toContain("1");
    expect(formaterValeur("montant", 123_450, "EUR")).toContain("€");
  });

  it("ratios, multiples, années, jours ; valeur absente « — »", () => {
    expect(formaterValeur("pourcentage", 0.4321, "XOF")).toBe(formaterPourcentage(0.4321, 1));
    expect(formaterValeur("multiple", 1.75, "XOF")).toBe("1,75");
    expect(formaterValeur("annees", 2.5, "XOF")).toBe("2,5 ans");
    expect(formaterValeur("annees", 1, "XOF")).toBe("1 an");
    expect(formaterValeur("jours", 120, "XOF")).toBe("120 jours");
    expect(formaterValeur("jours", 400, "XOF")).toContain("non atteint dans l'exercice");
    expect(formaterValeur("montant", null, "XOF")).toBe("—");
    expect(formaterValeur("multiple", Number.NaN, "XOF")).toBe("—");
  });

  it("taux en points et écarts signés", () => {
    expect(formaterPoints(12)).toBe("12 %");
    expect(formaterPoints(12.5)).toBe("12,5 %");
    expect(formaterPoints(undefined)).toBe("—");
    expect(formaterSigne(5)).toBe("+5");
    expect(formaterSigne(-2)).toBe("-2");
    expect(formaterSigne(0)).toBe("0");
  });
});

describe("lignes des états : champs du résultat, codes SYSCOHADA indicatifs", () => {
  const a = exercice(1);

  it("chaque ligne lit son champ tel quel", () => {
    const par = (lignes: typeof LIGNES_BILAN, cle: string) =>
      lignes.find((l) => l.cle === cle)?.valeur(a);
    expect(par(LIGNES_COMPTE_RESULTAT, "chiffre_affaires")).toBe(a.compteResultat.chiffreAffaires);
    expect(par(LIGNES_COMPTE_RESULTAT, "resultat_net")).toBe(a.compteResultat.resultatNet);
    expect(par(LIGNES_BILAN, "capitaux_propres")).toBe(a.bilan.capitauxPropres);
    expect(par(LIGNES_BILAN, "tresorerie_passif")).toBe(a.bilan.tresoreriePassif);
    expect(par(LIGNES_FLUX, "tresorerie_cloture")).toBe(a.fluxTresorerie.tresorerieCloture);
    expect(par(LIGNES_FLUX, "dividendes_verses")).toBe(a.fluxTresorerie.dividendesVerses);
    expect(par(LIGNES_INDICATEURS, "ratio_endettement")).toBeNull();
    expect(par(LIGNES_INDICATEURS, "autonomie_financiere")).toBe(0.25);
  });

  it("aucune ligne en double ; codes des soldes du compte de résultat et du bilan", () => {
    for (const etat of ETATS_FINANCIERS) {
      const cles = etat.lignes.map((l) => l.cle);
      expect(new Set(cles).size, etat.cle).toBe(cles.length);
    }
    const code = (cle: string) => LIGNES_COMPTE_RESULTAT.find((l) => l.cle === cle)?.code;
    expect(code("chiffre_affaires")).toBe("XB");
    expect(code("excedent_brut_exploitation")).toBe("XD");
    expect(code("resultat_net")).toBe("XI");
    expect(LIGNES_BILAN.find((l) => l.cle === "total_actif")?.code).toBe("BZ");
    expect(LIGNES_FLUX.find((l) => l.cle === "tresorerie_cloture")?.code).toBe("ZH");
    expect(LIGNES_BILAN[0]?.groupe).toBe("Actif");
    expect(MENTION_SYSCOHADA).toContain("indicatifs");
  });
});

describe("scénarios côte à côte", () => {
  const synthese: SyntheseScenario[] = [
    {
      scenario: "base",
      chiffreAffairesFinal: 100,
      resultatNetCumule: 10,
      tresorerieFinale: 5,
      valeurActuelleNette: 7,
      tauxRendementInterne: 0.125,
      nombreAlertes: 0,
    },
    {
      scenario: "pessimiste",
      chiffreAffairesFinal: 80,
      resultatNetCumule: -10,
      tresorerieFinale: -5,
      valeurActuelleNette: -7,
      tauxRendementInterne: null,
      nombreAlertes: 2,
    },
  ];

  it("valeurs du moteur mises en forme, scénario absent « — »", () => {
    const lignes = lignesScenarios(synthese, "XOF");
    expect(lignes.map((l) => l.cle)).toEqual([
      "ca_final",
      "resultat_cumule",
      "tresorerie_finale",
      "van",
      "tri",
      "alertes",
    ]);
    const ca = lignes[0]!;
    expect(ca.valeurs.base).toBe(formaterMontantMineur(100, "XOF"));
    expect(ca.valeurs.optimiste).toBe("—");
    const tri = lignes.find((l) => l.cle === "tri")!;
    expect(tri.valeurs.base).toBe(formaterPourcentage(0.125, 1));
    expect(tri.valeurs.pessimiste).toBe("Non défini");
    const alertes = lignes.find((l) => l.cle === "alertes")!;
    expect(alertes.valeurs.base).toBe("Aucune");
    expect(alertes.valeurs.pessimiste).toBe("2 alertes");
  });

  it("description des écarts", () => {
    expect(
      descriptionEcarts({ croissanceChiffreAffaires: 5, tauxMargeBrute: 2, chargesFixes: -5 }),
    ).toBe("croissance du chiffre d'affaires +5 pts ; marge brute +2 pts ; charges fixes -5 %");
    expect(descriptionEcarts({ delaiClientsJours: 15 })).toBe("délai clients +15 jours");
    expect(descriptionEcarts({})).toContain("Aucun écart");
    expect(descriptionEcarts({ tauxMargeBrute: 0 })).toContain("Aucun écart");
    expect(descriptionEcarts(undefined)).toContain("Aucun écart");
  });
});

describe("alertes du moteur", () => {
  it("texte avec gravité, exercice et montants (pas seulement la couleur)", () => {
    const t = texteAlerte(alerte("TRESORERIE_NEGATIVE", 2028), "XOF");
    expect(t).toContain("Critique — Trésorerie négative en 2028 (année 2)");
    expect(t).toContain(formaterMontantMineur(-1_500_000, "XOF"));
    expect(
      texteAlerte(alerte("CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL", 2029, "attention"), "XOF"),
    ).toMatch(/^Attention — Capitaux propres inférieurs à la moitié/);
    expect(libelleAlerte("INCONNU")).toBe("Alerte du modèle");
  });

  it("par scénario (base d'abord, scénarios sans alerte omis), années de trésorerie négative", () => {
    const r = {
      base: resultat([alerte("TRESORERIE_NEGATIVE", 2028), alerte("TRESORERIE_NEGATIVE", 2029)]),
      optimiste: resultat(),
      pessimiste: resultat([alerte("CAPITAUX_PROPRES_NEGATIFS", 2029)]),
    };
    expect(alertesParScenario(r).map((x) => x.scenario)).toEqual(["base", "pessimiste"]);
    expect(exercicesTresorerieNegative(r.base)).toEqual([2028, 2029]);
    expect(exercicesTresorerieNegative(r.pessimiste)).toEqual([]);
    expect(resumeAlertes(r)).toBe("2 alertes dans le scénario de base, dont 2 critiques.");
    expect(resumeAlertes({ ...r, base: resultat() })).toBe(
      "Aucune alerte dans le scénario de base.",
    );
  });
});

describe("versions du modèle", () => {
  it("libellés de version et de validation", () => {
    expect(
      libelleVersionModele({ version: 3, auteur_nom: "Awa", calcule_le: "2027-01-12T10:00:00Z" }),
    ).toMatch(/^Version 3 · calculée le 12 janv\. 2027 à 10:00 par Awa$/);
    expect(libelleValidationModele({ validation: null })).toBe("Non validée");
    expect(
      libelleValidationModele({
        validation: { valide_par: "u", valideur_nom: "Kofi", valide_le: "2027-01-13T10:00:00Z" },
      }),
    ).toBe("Validée par Kofi le 13 janv. 2027");
  });

  it("plafond de 200 versions", () => {
    expect(VERSIONS_MODELE_MAX).toBe(200);
    expect(plafondAtteint(199)).toBe(false);
    expect(plafondAtteint(200)).toBe(true);
    expect(plafondAtteint(null)).toBe(false);
    expect(MESSAGE_PLAFOND).toContain("200 versions");
  });
});

describe("chemins d'hypothèses en français", () => {
  it("champ, année, élément de liste, bilan d'ouverture, écart de scénario", () => {
    expect(libelleChemin("croissanceChiffreAffaires[2]")).toBe(
      "Croissance du chiffre d'affaires, année 3",
    );
    expect(libelleChemin("effectifs[0].tauxChargesSociales")).toBe(
      "Effectifs, catégorie 1 : taux de charges sociales",
    );
    expect(libelleChemin("effectifs[1].effectifs[0]")).toBe(
      "Effectifs, catégorie 2 : effectifs (équivalents temps plein), année 1",
    );
    expect(libelleChemin("bilanOuverture.tresorerie")).toBe("Bilan d'ouverture : trésorerie");
    expect(libelleChemin("ecarts.optimiste.tauxMargeBrute")).toBe(
      "Scénario optimiste : écart de taux de marge brute",
    );
    expect(libelleChemin("pessimiste.delaiClientsJours")).toBe(
      "Scénario pessimiste : écart de délai clients",
    );
    expect(libelleChemin("tauxImpotSocietes")).toBe("Taux d'impôt sur les sociétés");
    expect(libelleChemin("inconnu.x")).toBe("inconnu.x");
  });

  it("message du moteur : chemins techniques remplacés, texte gardé", () => {
    expect(
      traduireMessageMoteur(
        "croissanceChiffreAffaires[2] : un nombre > -100 et ≤ 1000 attendu (reçu 2000).",
      ),
    ).toBe(
      "« Croissance du chiffre d'affaires, année 3 » : un nombre > -100 et ≤ 1000 attendu (reçu 2000).",
    );
    expect(
      traduireMessageMoteur("Scénario optimiste : tauxMargeBrute[0] : un nombre attendu."),
    ).toBe("Scénario optimiste : « Taux de marge brute, année 1 » : un nombre attendu.");
    expect(traduireMessageMoteur("Bilan d'ouverture déséquilibré : actif net 1 ≠ passif 2.")).toBe(
      "Bilan d'ouverture déséquilibré : actif net 1 ≠ passif 2.",
    );
  });
});

describe("comparaison de deux versions", () => {
  it("valeurs côte à côte, exercices différents signalés", () => {
    const lignes = lignesSerieComparee(
      {
        cle: "chiffre_affaires",
        libelle: "Chiffre d'affaires",
        de: [
          { exercice: 2027, valeur: 100 },
          { exercice: 2028, valeur: 110 },
        ],
        a: [
          { exercice: 2027, valeur: 120 },
          { exercice: 2029, valeur: 130 },
        ],
      },
      "XOF",
    );
    expect(lignes).toEqual([
      {
        exercice: "2027",
        de: formaterMontantMineur(100, "XOF"),
        a: formaterMontantMineur(120, "XOF"),
      },
      {
        exercice: "2028 / 2029",
        de: formaterMontantMineur(110, "XOF"),
        a: formaterMontantMineur(130, "XOF"),
      },
    ]);
  });

  it("paramètres de l'URL", () => {
    expect(lireComparaison(undefined, undefined)).toBeNull();
    expect(lireComparaison("", "")).toBeNull();
    expect(lireComparaison("1", "3")).toEqual({ de: 1, a: 3 });
    expect(lireComparaison(["2", "9"], "1")).toEqual({ de: 2, a: 1 });
    expect(lireComparaison("2", "2")).toEqual({
      erreur: "Choisissez deux versions différentes à comparer.",
    });
    expect(lireComparaison("0", "2")).toHaveProperty("erreur");
    expect(lireComparaison("abc", "2")).toHaveProperty("erreur");
    expect(lireComparaison("1", undefined)).toHaveProperty("erreur");
  });
});

describe("ROI par initiative", () => {
  it("note sur le taux d'actualisation retenu", () => {
    expect(noteTauxRoi({ taux_actualisation: 10, source_taux: "modele", modele_version: 2 })).toBe(
      "VAN au taux d'actualisation de la version 2 du modèle financier (10 %) ; flux de l'année 0 (budget) non actualisé.",
    );
    expect(
      noteTauxRoi({ taux_actualisation: 12, source_taux: "defaut", modele_version: null }),
    ).toContain("taux d'actualisation de départ du moteur (12 %)");
  });
});

describe("messages d'erreur du modèle", () => {
  it("code du moteur traduit, chemin en français", () => {
    const e = new ErreurApi(
      "HYPOTHESE_INVALIDE",
      "tauxMargeBrute[0] : un nombre ≥ 0 et ≤ 100 attendu (reçu 150).",
      400,
    );
    expect(messageModele(e)).toBe(
      "Hypothèse refusée par le moteur de calcul. « Taux de marge brute, année 1 » : un nombre ≥ 0 et ≤ 100 attendu (reçu 150).",
    );
    expect(
      messageModele(
        new ErreurApi("BILAN_OUVERTURE_DESEQUILIBRE", "Bilan d'ouverture déséquilibré.", 400),
      ),
    ).toMatch(/^Bilan d'ouverture déséquilibré\./);
  });

  it("plafond, séparation des tâches, 404, 409, 403", () => {
    expect(messageModele(new ErreurApi("PLAN_PLAFOND_VERSIONS", "x", 409))).toBe(MESSAGE_PLAFOND);
    expect(
      messageModele(new ErreurApi("VALIDATION_REQUISE", "L'auteur ne valide pas lui-même.", 403)),
    ).toBe("Séparation des tâches : L'auteur ne valide pas lui-même.");
    expect(messageModele(new ErreurApi("INTROUVABLE", "x", 404))).toBe(MESSAGE_INTROUVABLE_MODELE);
    expect(messageModele(new ErreurApi("CONFLIT", "La mission est clôturée.", 409))).toBe(
      "La mission est clôturée.",
    );
    expect(messageModele(new ErreurApi("INTERDIT", "x", 403))).toContain(
      "responsable de la mission",
    );
    expect(messageModele(new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400))).toContain(
      "Certaines valeurs ont été refusées",
    );
    expect(etatModeleChange(new ErreurApi("CONFLIT", "x", 409))).toBe(true);
    expect(etatModeleChange(new ErreurApi("INTERDIT", "x", 403))).toBe(false);
  });
});

describe("chemins de l'API", () => {
  it("simulation, versions, validation, comparaison, ROI", () => {
    expect(cheminSimulation("p 1")).toBe("/api/plans/p%201/modeles/simulation");
    expect(cheminListeModeles("p", 10, null)).toBe("/api/plans/p/modeles?limite=10");
    expect(cheminListeModeles("p", 10, "abc=")).toBe(
      "/api/plans/p/modeles?limite=10&curseur=abc%3D",
    );
    expect(cheminVersionModele("p", 3)).toBe("/api/plans/p/modeles/3");
    expect(cheminValidationModele("p", 3)).toBe("/api/plans/p/modeles/3/validation");
    expect(cheminComparaison("p", 1, 2)).toBe("/api/plans/p/modeles/comparaison?de=1&a=2");
    expect(cheminRoi("p")).toBe("/api/plans/p/initiatives/roi");
    expect(cheminRoi("p", 4)).toBe("/api/plans/p/initiatives/roi?version=4");
  });
});

describe("présentation complémentaire", () => {
  it("lignes regroupées sous leurs intertitres", () => {
    const g = grouperLignes(LIGNES_BILAN);
    expect(g.map((x) => x.titre)).toEqual(["Actif", "Passif", "Pour information"]);
    expect(g[0]!.lignes.at(-1)?.cle).toBe("total_actif");
    expect(grouperLignes(LIGNES_COMPTE_RESULTAT)).toHaveLength(1);
    expect(grouperLignes(LIGNES_COMPTE_RESULTAT)[0]!.titre).toBeNull();
    expect(grouperLignes([])).toEqual([]);
  });

  it("indicateurs clés du scénario de base, valeurs du moteur", () => {
    const cles = indicateursCles(resultat().synthese, "XOF");
    expect(cles).toHaveLength(6);
    expect(cles[0]).toEqual([
      "Chiffre d'affaires de la dernière année",
      formaterMontantMineur(1, "XOF"),
    ]);
    expect(cles[4]![0]).toContain("12\u00a0%");
    expect(cles[5]![1]).toBe(formaterPourcentage(0.1, 1));
    const sansTri = indicateursCles({ ...resultat().synthese, tauxRendementInterne: null }, "XOF");
    expect(sansTri[5]![1]).toBe("Non défini");
  });

  it("titre des alertes d'un scénario", () => {
    expect(titreAlertesScenario("base", [alerte("TRESORERIE_NEGATIVE", 2028)])).toBe(
      "Scénario base : 1 alerte, dont des alertes critiques",
    );
    expect(
      titreAlertesScenario("pessimiste", [
        alerte("CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL", 2028, "attention"),
        alerte("CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL", 2029, "attention"),
      ]),
    ).toBe("Scénario pessimiste : 2 alertes");
  });

  it("numéro de version lu dans l'URL et annonce d'enregistrement", () => {
    expect(lireNumeroVersionModele("3")).toBe(3);
    expect(lireNumeroVersionModele(["7", "8"])).toBe(7);
    expect(lireNumeroVersionModele("0")).toBeNull();
    expect(lireNumeroVersionModele("1e3")).toBeNull();
    expect(lireNumeroVersionModele("200000")).toBeNull();
    expect(lireNumeroVersionModele(undefined)).toBeNull();
    expect(messageVersionEnregistree(4, false)).toMatch(/^Version 4 enregistrée/);
    expect(messageVersionEnregistree(4, false)).not.toContain("partage");
    expect(messageVersionEnregistree(4, true)).toContain("Le partage au client a été retiré");
  });
});
