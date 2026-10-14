import { describe, expect, it } from "vitest";
import {
  bpVersSaisie,
  codeDepuisLibelle,
  ecartAvecSignal,
  ecartIndication,
  lireConditions,
  lireEntier,
  lirePourcentageBp,
  lireValeurParametre,
  niveauEsExigeJustification,
  saisieActionVide,
  saisieAffirmationVide,
  saisieCadrageVide,
  saisieDepuisDimensionnement,
  saisieEtapeVide,
  saisieHypotheseVide,
  saisieNoteVide,
  saisiePointVide,
  saisieParametresVides,
  saisieRegleVide,
  saisieRisqueVide,
  saisieSignalVide,
  saisieThemesVides,
  validerAction,
  validerAffirmation,
  validerAssertionHypothese,
  validerConstat,
  validerCorrectionHypothese,
  validerCorrectionPoint,
  validerCorrectionRisque,
  validerDecision,
  validerDecisionExclusion,
  validerDimensionnement,
  validerEtape,
  validerFiltrage,
  validerHypothese,
  validerLien,
  validerListe,
  validerNote,
  validerPoint,
  validerRetrait,
  validerRisque,
  validerSignal,
  validerVerdict,
  validerCadrage,
  type SaisieDimensionnement,
} from "./due-diligence-saisie";

const UUID = "33333333-3333-4333-8333-333333333333";
const UUID2 = "44444444-4444-4444-8444-444444444444";

function erreurs<C, K extends string>(r: {
  ok: boolean;
  erreurs?: Partial<Record<K, string>>;
  charge?: C;
}) {
  if (r.ok) throw new Error("une erreur était attendue");
  return r.erreurs!;
}
function charge<C>(r: { ok: boolean; charge?: C; erreurs?: unknown }): C {
  if (!r.ok) throw new Error(`échec inattendu : ${JSON.stringify(r.erreurs)}`);
  return r.charge as C;
}

describe("lectures de saisie (sans flottant dans le résultat)", () => {
  it("lit un pourcentage à la française en points de base", () => {
    expect(lirePourcentageBp("40")).toBe(4000);
    expect(lirePourcentageBp("25,5")).toBe(2550);
    expect(lirePourcentageBp("25.5 %")).toBe(2550);
    expect(lirePourcentageBp("0,05")).toBe(5);
    expect(lirePourcentageBp("100")).toBe(10_000);
    expect(lirePourcentageBp("")).toBeNull();
    expect(lirePourcentageBp("0,005")).toBeNaN();
    expect(lirePourcentageBp("-3")).toBeNaN();
    expect(lirePourcentageBp("abc")).toBeNaN();
  });

  it("écrit des points de base pour préremplir un champ", () => {
    expect(bpVersSaisie(2550)).toBe("25,5");
    expect(bpVersSaisie(4000)).toBe("40");
    expect(bpVersSaisie(5)).toBe("0,05");
    expect(bpVersSaisie(3333)).toBe("33,33");
    expect(bpVersSaisie(null)).toBe("");
    // Aller-retour.
    for (const bp of [0, 1, 5, 99, 100, 2550, 3333, 10_000]) {
      expect(lirePourcentageBp(bpVersSaisie(bp))).toBe(bp);
    }
  });

  it("lit un entier", () => {
    expect(lireEntier("1 500")).toBe(1500);
    expect(lireEntier("")).toBeNull();
    expect(lireEntier("1,5")).toBeNaN();
    expect(lireEntier("-1")).toBeNaN();
  });

  it("tire un code de référentiel d'un libellé, unique dans la liste", () => {
    expect(codeDepuisLibelle("Jeux d'argent et Casinos")).toBe("jeux_d_argent_et_casinos");
    expect(codeDepuisLibelle("Énergie électrique")).toBe("energie_electrique");
    expect(codeDepuisLibelle("Énergie", ["energie"])).toBe("energie_2");
    expect(codeDepuisLibelle("Énergie", ["energie", "energie_2"])).toBe("energie_3");
    expect(codeDepuisLibelle("!!!")).toBe("element");
    expect(codeDepuisLibelle("a".repeat(300)).length).toBeLessThanOrEqual(100);
    expect(codeDepuisLibelle("Règle 1")).toMatch(/^[a-z0-9_.-]{1,120}$/);
  });

  it("lit une condition par ligne", () => {
    expect(lireConditions("  Garantie de passif \n\n Audit complémentaire,\nPlafond ")).toEqual([
      "Garantie de passif",
      "Audit complémentaire,",
      "Plafond",
    ]);
  });
});

describe("cadrage (DD-01)", () => {
  const complet = {
    ...saisieCadrageVide("EUR"),
    titre: "  Acquisition Cacao SA ",
    secteur_code: "citi_a",
    pays_code: "ci",
    type_operation: "acquisition",
    cible_nom: "Cacao SA",
    date_operation: "2027-03-01",
  };

  it("valide un cadrage et nettoie les textes", () => {
    const c = charge(validerCadrage(complet, false));
    expect(c).toMatchObject({
      titre: "Acquisition Cacao SA",
      secteur_code: "citi_a",
      filiere_code: null,
      pays_code: "ci",
      cible_nom: "Cacao SA",
      type_operation: "acquisition",
      devise: "EUR",
      date_operation: "2027-03-01",
      question_investissement: null,
      perimetre: null,
    });
    expect(c.motif).toBeUndefined();
  });

  it("exige la cible d'une acquisition, pas d'un partenariat", () => {
    expect(erreurs(validerCadrage({ ...complet, cible_nom: "" }, false)).cible_nom).toMatch(
      /cible/,
    );
    expect(
      validerCadrage({ ...complet, cible_nom: "", type_operation: "partenariat" }, false).ok,
    ).toBe(true);
  });

  it("exige titre, secteur, pays, type et devise", () => {
    const e = erreurs(validerCadrage(saisieCadrageVide(""), false));
    expect(Object.keys(e).sort()).toEqual(
      ["devise", "pays_code", "secteur_code", "titre", "type_operation"].sort(),
    );
  });

  it("refuse une date hors bornes et exige le motif d'une correction", () => {
    expect(
      erreurs(validerCadrage({ ...complet, date_operation: "1999-01-01" }, false)).date_operation,
    ).toMatch(/invalide/);
    expect(erreurs(validerCadrage(complet, true)).motif).toMatch(/correction/);
    expect(charge(validerCadrage({ ...complet, motif: "Cible précisée" }, true)).motif).toBe(
      "Cible précisée",
    );
  });
});

describe("affirmation (assertion du registre)", () => {
  it("valide une affirmation R2 ou R3", () => {
    const e = {};
    const a = validerAffirmation({ ...saisieAffirmationVide(), enonce: " Le marché croît " }, e);
    expect(a).toEqual({
      enonce: "Le marché croît",
      classe_risque: "R2",
      avis_expert: false,
      avis_expert_motif: null,
      signer_avis: false,
    });
    expect(e).toEqual({});
  });

  it("refuse R0 et R1, qui échapperaient au contrôle des sources", () => {
    const e: Record<string, string> = {};
    expect(
      validerAffirmation({ ...saisieAffirmationVide(), enonce: "x", classe_risque: "R1" }, e),
    ).toBeNull();
    expect(e.classe_risque).toMatch(/R2 ou R3/);
  });

  it("exige un motif pour un avis d'expert, et ne signe que s'il y a un avis", () => {
    const e: Record<string, string> = {};
    expect(
      validerAffirmation({ ...saisieAffirmationVide(), enonce: "x", avis_expert: true }, e),
    ).toBeNull();
    expect(e.avis_expert_motif).toMatch(/justifie/);
    const ok = validerAffirmation(
      {
        ...saisieAffirmationVide(),
        enonce: "x",
        avis_expert: true,
        avis_expert_motif: "Terrain",
        signer_avis: true,
      },
      {},
    );
    expect(ok).toMatchObject({
      avis_expert: true,
      avis_expert_motif: "Terrain",
      signer_avis: true,
    });
    const sans = validerAffirmation(
      { ...saisieAffirmationVide(), enonce: "x", signer_avis: true, avis_expert_motif: "ignoré" },
      {},
    );
    expect(sans).toMatchObject({ avis_expert: false, avis_expert_motif: null, signer_avis: false });
  });

  it("exige l'énoncé", () => {
    const e: Record<string, string> = {};
    validerAffirmation(saisieAffirmationVide(), e);
    expect(e.enonce).toMatch(/Rédigez/);
  });
});

describe("points d'analyse (DD-03)", () => {
  it("valide un point dans une catégorie de l'analyse", () => {
    const c = charge(
      validerPoint(
        { ...saisiePointVide(), enonce: "Inflation maîtrisée", niveau: "modere" },
        "pestel",
        "economique",
      ),
    );
    expect(c).toMatchObject({
      analyse: "pestel",
      categorie: "economique",
      libelle: null,
      niveau: "modere",
    });
  });

  it("refuse une catégorie étrangère à l'analyse", () => {
    expect(
      erreurs(validerPoint({ ...saisiePointVide(), enonce: "x" }, "swot", "economique")).enonce,
    ).toMatch(/Catégorie/);
  });

  it("n'envoie que les champs modifiés d'une correction, et exige un motif", () => {
    const initial = { libelle: null, niveau: "faible", enonce: "Ancien" };
    const base = { libelle: "", niveau: "faible", enonce: "Nouveau", motif: "Précision" };
    expect(charge(validerCorrectionPoint(base, initial))).toEqual({
      motif: "Précision",
      enonce: "Nouveau",
    });
    expect(erreurs(validerCorrectionPoint({ ...base, enonce: "Ancien" }, initial)).enonce).toMatch(
      /Aucune modification/,
    );
    expect(erreurs(validerCorrectionPoint({ ...base, motif: "" }, initial)).motif).toMatch(
      /correction/,
    );
    expect(
      charge(validerCorrectionPoint({ ...base, enonce: "Ancien", niveau: "" }, initial)),
    ).toEqual({
      motif: "Précision",
      niveau: null,
    });
  });

  it("exige un motif pour retirer un élément", () => {
    expect(erreurs(validerRetrait("", true)).motif).toMatch(/pourquoi/);
    expect(charge(validerRetrait(" Doublon ", true))).toEqual({ motif: "Doublon", retire: true });
  });
});

describe("chaîne de valeur (DD-04)", () => {
  it("lit les parts en points de base et les acteurs", () => {
    const c = charge(
      validerEtape(
        {
          ...saisieEtapeVide(2),
          libelle: "Transformation",
          part_cout: "25,5",
          part_marge: "50",
          acteurs: "Usine, Négociant, Usine",
        },
        false,
      ),
    );
    expect(c).toMatchObject({
      libelle: "Transformation",
      ordre: 2,
      part_cout_bp: 2550,
      part_marge_bp: 5000,
      acteurs: ["Usine", "Négociant"],
    });
  });

  it("accepte des parts vides, refuse > 100 % et un rang hors 1 à 200", () => {
    expect(
      charge(validerEtape({ ...saisieEtapeVide(1), libelle: "Collecte" }, false)),
    ).toMatchObject({
      part_cout_bp: null,
      part_marge_bp: null,
    });
    const e = erreurs(
      validerEtape(
        { ...saisieEtapeVide(0), libelle: "x", part_cout: "101", part_marge: "abc" },
        false,
      ),
    );
    expect(e.ordre).toMatch(/rang/);
    expect(e.part_cout).toMatch(/0 et 100/);
    expect(e.part_marge).toMatch(/0 et 100/);
  });

  it("limite les acteurs à douze", () => {
    const douze = Array.from({ length: 13 }, (_, i) => `Acteur ${i}`).join(", ");
    expect(
      erreurs(validerEtape({ ...saisieEtapeVide(1), libelle: "x", acteurs: douze }, false)).acteurs,
    ).toMatch(/12/);
  });
});

describe("risques (DD-06) et signaux (DD-11)", () => {
  const base = {
    ...saisieRisqueVide(),
    famille: "pays",
    niveau: "eleve",
    libelle: "Instabilité politique",
    enonce: "Élections contestées",
  };

  it("valide un risque sans signal d'origine", () => {
    expect(charge(validerRisque(base, null))).toMatchObject({
      famille: "pays",
      niveau: "eleve",
      etape_id: null,
      signal_id: null,
    });
  });

  it("exige le motif de l'écart quand le niveau diffère de la gravité du signal", () => {
    expect(ecartAvecSignal("eleve", "critique")).toBe(true);
    expect(ecartAvecSignal("critique", "critique")).toBe(false);
    expect(ecartAvecSignal("eleve", null)).toBe(false);
    expect(erreurs(validerRisque(base, "critique")).motif_ecart).toMatch(/justifiez/);
    const c = charge(validerRisque({ ...base, motif_ecart: "Mesures de sécurité" }, "critique"));
    expect(c.motif_ecart).toBe("Mesures de sécurité");
    expect(charge(validerRisque(base, "eleve")).motif_ecart).toBeUndefined();
  });

  it("exige famille, niveau et intitulé, et refuse un identifiant invalide", () => {
    const e = erreurs(
      validerRisque({ ...saisieRisqueVide(), etape_id: "x", signal_id: "y" }, null),
    );
    expect(e.famille).toBeDefined();
    expect(e.niveau).toBeDefined();
    expect(e.libelle).toBeDefined();
    expect(e.etape_id).toBeDefined();
    expect(e.signal_id).toBeDefined();
    expect(
      charge(validerRisque({ ...base, etape_id: UUID, signal_id: UUID2 }, "eleve")),
    ).toMatchObject({
      etape_id: UUID,
      signal_id: UUID2,
    });
  });

  it("corrige un risque : champs modifiés seulement, écart motivé si le niveau change", () => {
    const initial = { niveau: "eleve", libelle: "Risque", enonce: "Justification", etape_id: null };
    const s = {
      niveau: "critique",
      libelle: "Risque",
      enonce: "Justification",
      etape_id: "",
      motif_ecart: "",
      motif: "Aggravation",
    };
    expect(erreurs(validerCorrectionRisque(s, initial, "eleve")).motif_ecart).toMatch(/justifiez/);
    expect(
      charge(
        validerCorrectionRisque({ ...s, motif_ecart: "Nouvelles informations" }, initial, "eleve"),
      ),
    ).toEqual({
      motif: "Aggravation",
      niveau: "critique",
      motif_ecart: "Nouvelles informations",
    });
    expect(charge(validerCorrectionRisque(s, initial, null))).toEqual({
      motif: "Aggravation",
      niveau: "critique",
    });
    expect(
      erreurs(validerCorrectionRisque({ ...s, niveau: "eleve" }, initial, null)).libelle,
    ).toMatch(/Aucune modification/);
  });

  it("exige un commentaire pour écarter un signal", () => {
    expect(erreurs(validerConstat("ecarte", "  ", null)).commentaire).toMatch(
      /Un signal écarté se justifie/,
    );
    expect(charge(validerConstat("ecarte", "Hors périmètre", null))).toEqual({
      etat: "ecarte",
      commentaire: "Hors périmètre",
      risque_id: null,
    });
    expect(charge(validerConstat("constate", "", UUID))).toEqual({
      etat: "constate",
      commentaire: null,
      risque_id: UUID,
    });
    expect(erreurs(validerConstat("autre", "", null)).etat).toBeDefined();
  });

  it("valide un signal : code tiré du titre à la création, motif exigé à la correction", () => {
    const s = {
      ...saisieSignalVide(),
      libelle: "Contrôle des changes",
      famille: "change",
      gravite_indicative: "eleve",
    };
    const c = charge(validerSignal(s, false, ["controle_des_changes"]));
    expect(c).toMatchObject({
      code: "controle_des_changes_2",
      famille: "change",
      secteur_code: null,
      pays_code: null,
      actif: true,
    });
    expect(c.motif).toBeUndefined();
    expect(erreurs(validerSignal(s, true)).motif).toMatch(/correction/);
    const v = charge(validerSignal({ ...s, motif: "Mise à jour" }, true));
    expect(v.motif).toBe("Mise à jour");
    expect(v.code).toBeUndefined();
    expect(Object.keys(erreurs(validerSignal(saisieSignalVide(), false))).sort()).toEqual([
      "famille",
      "gravite_indicative",
      "libelle",
    ]);
  });
});

describe("hypothèses et verdicts (DD-09)", () => {
  it("valide une hypothèse, racine ou sous-hypothèse", () => {
    expect(
      charge(validerHypothese({ ...saisieHypotheseVide(), libelle: "Le marché croît" })),
    ).toEqual({
      libelle: "Le marché croît",
      description: null,
      critere: null,
      parent_id: null,
    });
    expect(
      charge(validerHypothese({ ...saisieHypotheseVide(UUID), libelle: "Sous-hypothèse" }))
        .parent_id,
    ).toBe(UUID);
    expect(erreurs(validerHypothese(saisieHypotheseVide())).libelle).toMatch(/Formulez/);
    expect(
      erreurs(validerHypothese({ ...saisieHypotheseVide("x"), libelle: "a" })).parent_id,
    ).toBeDefined();
  });

  it("corrige une hypothèse : motif exigé, champs modifiés seulement", () => {
    const initial = { libelle: "A", description: null, critere: null };
    const s = { libelle: "B", description: "", critere: "", motif: "Reformulation" };
    expect(charge(validerCorrectionHypothese(s, initial))).toEqual({
      motif: "Reformulation",
      libelle: "B",
    });
    expect(erreurs(validerCorrectionHypothese({ ...s, libelle: "A" }, initial)).libelle).toMatch(
      /Aucune modification/,
    );
    expect(erreurs(validerCorrectionHypothese({ ...s, motif: "" }, initial)).motif).toBeDefined();
  });

  it("lie une assertion avec son sens, et crée une assertion rattachée", () => {
    expect(charge(validerLien(UUID, "soutient"))).toEqual({
      assertion_id: UUID,
      action: "lier",
      sens: "soutient",
    });
    const e = erreurs(validerLien("x", ""));
    expect(e.assertion_id).toBeDefined();
    expect(e.sens).toBeDefined();
    expect(
      charge(
        validerAssertionHypothese({
          enonce: "Preuve",
          classe_risque: "R3",
          avis_expert: false,
          avis_expert_motif: "",
          signer_avis: false,
          sens: "contredit",
        }),
      ),
    ).toMatchObject({ sens: "contredit", classe_risque: "R3" });
    expect(
      erreurs(validerAssertionHypothese({ ...saisieAffirmationVide(), enonce: "x", sens: "" }))
        .sens,
    ).toBeDefined();
  });

  it("détecte l'écart avec l'indication du moteur et exige alors un motif détaillé", () => {
    expect(ecartIndication("confirmee", "non_concluante")).toBe(true);
    expect(ecartIndication("confirmee", "confirmee")).toBe(false);
    expect(ecartIndication("", "confirmee")).toBe(false);
    expect(ecartIndication("confirmee", null)).toBe(false);
    const court = { verdict: "confirmee", motif: "Trop court", assertions_citees: [UUID] };
    expect(erreurs(validerVerdict(court, 2, "non_concluante")).motif).toMatch(
      /20 caractères au moins/,
    );
    const ok = charge(
      validerVerdict(
        { ...court, motif: "Écart assumé : la source locale est solide." },
        2,
        "non_concluante",
      ),
    );
    expect(ok).toMatchObject({
      hypothese_version: 2,
      verdict: "confirmee",
      assertions_citees: [UUID],
    });
    // Même verdict que l'indication : un motif court suffit.
    expect(validerVerdict(court, 2, "confirmee").ok).toBe(true);
  });

  it("exige au moins une assertion citée sauf pour « non concluante »", () => {
    const s = {
      verdict: "infirmee",
      motif: "Preuve contraire solide",
      assertions_citees: [] as string[],
    };
    expect(erreurs(validerVerdict(s, 1, "infirmee")).assertions_citees).toMatch(
      /au moins une assertion/,
    );
    expect(validerVerdict({ ...s, verdict: "non_concluante" }, 1, "non_concluante").ok).toBe(true);
    expect(erreurs(validerVerdict({ ...s, verdict: "" }, 1, null)).verdict).toBeDefined();
    expect(
      erreurs(
        validerVerdict(
          { ...s, assertions_citees: Array.from({ length: 51 }, () => UUID) },
          1,
          "infirmee",
        ),
      ).assertions_citees,
    ).toMatch(/50/);
  });

  it("motive un rejet, pas une validation (verdict, note)", () => {
    expect(charge(validerDecision("valide", ""))).toEqual({ decision: "valide" });
    expect(erreurs(validerDecision("rejete", " ")).motif).toMatch(/motive/);
    expect(charge(validerDecision("rejete", "Source insuffisante"))).toEqual({
      decision: "rejete",
      motif: "Source insuffisante",
    });
  });
});

describe("dimensionnement de marché (DD-12)", () => {
  function descendant(): SaisieDimensionnement {
    return {
      methode: "descendant",
      libelle: "Marché du cacao",
      parametres: [
        {
          code: "marche_total",
          bas: "80 000 000 000",
          base: "100 000 000 000",
          haut: "120 000 000 000",
          source_type: "preuve",
          preuve_id: UUID,
          avis_motif: "",
        },
        {
          code: "part_segment",
          bas: "30",
          base: "40",
          haut: "50",
          source_type: "avis_expert",
          preuve_id: "",
          avis_motif: "Entretien avec la filière",
        },
        {
          code: "part_adressable",
          bas: "40",
          base: "50",
          haut: "60",
          source_type: "preuve",
          preuve_id: UUID2,
          avis_motif: "",
        },
        {
          code: "part_capturable",
          bas: "8",
          base: "10",
          haut: "12",
          source_type: "preuve",
          preuve_id: UUID,
          avis_motif: "",
        },
      ],
      ajustements: [],
      motif: "",
    };
  }

  it("lit les valeurs selon leur unité (pourcentage, montant, nombre)", () => {
    expect(lireValeurParametre("part_segment", "25,5", "XOF")).toBe(2550);
    expect(lireValeurParametre("part_segment", "101", "XOF")).toBeUndefined();
    expect(lireValeurParametre("marche_total", "1 500", "XOF")).toBe(1500);
    expect(lireValeurParametre("marche_total", "1 234,50", "EUR")).toBe(123_450);
    expect(lireValeurParametre("marche_total", "1,234", "XOF")).toBeUndefined();
    expect(lireValeurParametre("clients_cibles", "2 000", "XOF")).toBe(2000);
    expect(lireValeurParametre("clients_cibles", "1,5", "XOF")).toBeUndefined();
    expect(lireValeurParametre("clients_cibles", "", "XOF")).toBeNull();
  });

  it("construit la charge du cas D1 de la spécification (valeurs entières, sources citées)", () => {
    const c = charge(validerDimensionnement(descendant(), "XOF", "creation"));
    expect(c.methode).toBe("descendant");
    expect(c.parametres.map((p) => [p.code, p.bas, p.base, p.haut])).toEqual([
      ["marche_total", 80_000_000_000, 100_000_000_000, 120_000_000_000],
      ["part_segment", 3000, 4000, 5000],
      ["part_adressable", 4000, 5000, 6000],
      ["part_capturable", 800, 1000, 1200],
    ]);
    expect(c.parametres[0]!.source).toEqual({ type: "preuve", preuve_id: UUID });
    expect(c.parametres[1]!.source).toEqual({
      type: "avis_expert",
      motif: "Entretien avec la filière",
    });
    expect(c.motif).toBeUndefined();
  });

  it("exige la source de chaque paramètre à l'enregistrement, pas pour l'aperçu", () => {
    const s = descendant();
    s.parametres[3] = { ...s.parametres[3]!, source_type: "", preuve_id: "" };
    expect(erreurs(validerDimensionnement(s, "XOF", "creation")).parametres).toMatch(
      /preuve de la mission ou un avis d'expert/,
    );
    const apercu = charge(validerDimensionnement(s, "XOF", "apercu"));
    expect(apercu.parametres[3]!.source).toBeNull();
  });

  it("exige un avis d'expert motivé (10 caractères au moins) à l'enregistrement", () => {
    const s = descendant();
    s.parametres[1] = { ...s.parametres[1]!, avis_motif: "court" };
    expect(erreurs(validerDimensionnement(s, "XOF", "creation")).parametres).toMatch(
      /10 caractères/,
    );
    expect(validerDimensionnement(s, "XOF", "apercu").ok).toBe(true);
  });

  it("refuse des bornes qui ne se suivent pas, une valeur vide ou illisible", () => {
    const s = descendant();
    s.parametres[0] = { ...s.parametres[0]!, bas: "200 000 000 000" };
    expect(erreurs(validerDimensionnement(s, "XOF", "apercu")).parametres).toMatch(
      /basse ≤ centrale ≤ haute/,
    );
    const vide = descendant();
    vide.parametres[2] = { ...vide.parametres[2]!, haut: "" };
    expect(erreurs(validerDimensionnement(vide, "XOF", "apercu")).parametres).toMatch(
      /trois valeurs/,
    );
    const illisible = descendant();
    illisible.parametres[1] = { ...illisible.parametres[1]!, haut: "150" };
    expect(erreurs(validerDimensionnement(illisible, "XOF", "apercu")).parametres).toMatch(
      /illisible|hors limites/,
    );
  });

  it("valide les ajustements d'expert : facteur de 0,01 % à 200 %, motif de 10 caractères", () => {
    const s = descendant();
    s.ajustements = [{ libelle: "Informel", facteur: "90", motif: "Part du secteur informel" }];
    expect(charge(validerDimensionnement(s, "XOF", "creation")).ajustements).toEqual([
      { libelle: "Informel", facteur_bp: 9000, motif: "Part du secteur informel" },
    ]);
    s.ajustements = [{ libelle: "Informel", facteur: "0", motif: "Part du secteur informel" }];
    expect(erreurs(validerDimensionnement(s, "XOF", "creation")).ajustements).toMatch(
      /0,01 % à 200 %/,
    );
    s.ajustements = [{ libelle: "Informel", facteur: "201", motif: "Part du secteur informel" }];
    expect(erreurs(validerDimensionnement(s, "XOF", "creation")).ajustements).toBeDefined();
    s.ajustements = [{ libelle: "Informel", facteur: "90", motif: "court" }];
    expect(erreurs(validerDimensionnement(s, "XOF", "creation")).ajustements).toMatch(/se motive/);
    s.ajustements = Array.from({ length: 11 }, (_, i) => ({
      libelle: `A${i}`,
      facteur: "90",
      motif: "Motif suffisant",
    }));
    expect(erreurs(validerDimensionnement(s, "XOF", "creation")).ajustements).toMatch(/10/);
  });

  it("exige l'intitulé à l'enregistrement et le motif d'une nouvelle version", () => {
    const s = { ...descendant(), libelle: "" };
    expect(erreurs(validerDimensionnement(s, "XOF", "creation")).libelle).toBeDefined();
    expect(validerDimensionnement(s, "XOF", "apercu").ok).toBe(true);
    expect(erreurs(validerDimensionnement(descendant(), "XOF", "version")).motif).toMatch(
      /correction/,
    );
    expect(
      charge(
        validerDimensionnement({ ...descendant(), motif: "Nouvelle source" }, "XOF", "version"),
      ).motif,
    ).toBe("Nouvelle source");
  });

  it("préremplit une nouvelle version depuis le dimensionnement enregistré", () => {
    const s = saisieDepuisDimensionnement(
      {
        methode: "ascendant",
        libelle: "Clients",
        parametres: [
          {
            code: "clients_cibles",
            bas: 1500,
            base: 2000,
            haut: 2500,
            source: { type: "preuve", preuve_id: UUID },
          },
          {
            code: "taux_conquete",
            bas: 1500,
            base: 2000,
            haut: 2500,
            source: { type: "avis_expert", motif: "Avis du terrain" },
          },
          {
            code: "volume_par_client",
            bas: 10,
            base: 12,
            haut: 14,
            source: { type: "avis_expert", motif: "Estimation du terrain" },
          },
          {
            code: "prix_unitaire",
            bas: 200_000,
            base: 250_000,
            haut: 300_000,
            source: { type: "preuve", preuve_id: UUID2 },
          },
        ],
        ajustements: [{ libelle: "Change", facteur_bp: 9500, motif: "Dépréciation attendue" }],
      },
      "XOF",
    );
    expect(s.parametres[0]).toMatchObject({
      code: "clients_cibles",
      bas: "1500",
      source_type: "preuve",
      preuve_id: UUID,
    });
    expect(s.parametres[1]).toMatchObject({
      bas: "15",
      haut: "25",
      source_type: "avis_expert",
      avis_motif: "Avis du terrain",
    });
    expect(s.parametres[2]).toMatchObject({
      source_type: "avis_expert",
      avis_motif: "Estimation du terrain",
    });
    expect(s.ajustements).toEqual([
      { libelle: "Change", facteur: "95", motif: "Dépréciation attendue" },
    ]);
    // Aller-retour : la saisie préremplie redonne la même charge.
    const c = charge(
      validerDimensionnement({ ...s, motif: "Mise à jour des sources" }, "XOF", "version"),
    );
    expect(c.parametres.map((p) => p.base)).toEqual([2000, 2000, 12, 250_000]);
    expect(saisieParametresVides("ascendant").map((p) => p.code)).toEqual([
      "clients_cibles",
      "taux_conquete",
      "volume_par_client",
      "prix_unitaire",
    ]);
  });
});

describe("revue environnementale et sociale (DD-14)", () => {
  const liste = {
    liste_id: UUID,
    activites: "",
    secteur_codes: [] as string[],
    pays_codes: [] as string[],
    themes: saisieThemesVides(),
  };

  it("propose les huit thèmes", () => {
    expect(saisieThemesVides()).toHaveLength(8);
  });

  it("valide une revue : activités par ligne, thèmes évalués seulement", () => {
    const themes = saisieThemesVides();
    themes[0] = { ...themes[0]!, niveau: "faible" };
    themes[1] = { ...themes[1]!, niveau: "eleve", justification: "Chantiers non déclarés" };
    const c = charge(
      validerFiltrage({
        ...liste,
        activites: "Exploitation d'un casino\n\nPlantation de cacao ",
        secteur_codes: ["citi_a"],
        pays_codes: ["ci"],
        themes,
      }),
    );
    expect(c.declarations).toEqual({
      activites: ["Exploitation d'un casino", "Plantation de cacao"],
      secteur_codes: ["citi_a"],
      pays_codes: ["ci"],
    });
    expect(c.themes).toHaveLength(2);
    expect(c.themes[1]).toEqual({
      code: themes[1]!.code,
      niveau: "eleve",
      justification: "Chantiers non déclarés",
      assertion_id: null,
    });
  });

  it("exige la justification dès le niveau modéré", () => {
    expect(niveauEsExigeJustification("faible")).toBe(false);
    expect(niveauEsExigeJustification("non_concerne")).toBe(false);
    expect(niveauEsExigeJustification("modere")).toBe(true);
    expect(niveauEsExigeJustification("critique")).toBe(true);
    const themes = saisieThemesVides();
    themes[2] = { ...themes[2]!, niveau: "modere" };
    expect(erreurs(validerFiltrage({ ...liste, themes })).themes).toMatch(/se justifie/);
  });

  it("exige la liste d'exclusion et borne les déclarations", () => {
    expect(erreurs(validerFiltrage({ ...liste, liste_id: "" })).liste_id).toBeDefined();
    expect(
      erreurs(
        validerFiltrage({
          ...liste,
          activites: Array.from({ length: 31 }, (_, i) => `a${i}`).join("\n"),
        }),
      ).activites,
    ).toMatch(/30/);
    expect(
      erreurs(
        validerFiltrage({ ...liste, secteur_codes: Array.from({ length: 21 }, (_, i) => `s${i}`) }),
      ).secteur_codes,
    ).toMatch(/20/);
  });

  it("motive la décision sur une exclusion (10 caractères au moins)", () => {
    expect(erreurs(validerDecisionExclusion("casino", "ecartee", "court")).motif).toMatch(
      /10 caractères/,
    );
    expect(
      charge(validerDecisionExclusion("casino", "confirmee", "Activité de jeux avérée")),
    ).toEqual({
      regle_code: "casino",
      decision: "confirmee",
      motif: "Activité de jeux avérée",
    });
  });
});

describe("listes d'exclusion (DD-14)", () => {
  const regle = {
    ...saisieRegleVide(),
    libelle: "Jeux d'argent",
    mots_cles: "casino, jeux d'argent",
  };

  it("crée une liste : code des règles tiré du libellé, client facultatif", () => {
    const c = charge(
      validerListe(
        {
          nom: " Liste générale ",
          client_id: "",
          reference_cadre: "",
          regles: [regle, { ...regle, libelle: "Jeux d'argent" }],
          motif: "",
        },
        false,
      ),
    );
    expect(c.nom).toBe("Liste générale");
    expect(c.client_id).toBeNull();
    expect(c.regles.map((r) => r.code)).toEqual(["jeux_d_argent", "jeux_d_argent_2"]);
    expect(c.regles[0]!.mots_cles).toEqual(["casino", "jeux d'argent"]);
    expect(c.motif).toBeUndefined();
  });

  it("conserve le code des règles existantes à la correction et exige un motif", () => {
    const existante = { ...regle, code: "jeux" };
    const s = {
      nom: "x",
      client_id: "",
      reference_cadre: "Normes de performance de la SFI",
      regles: [existante],
      motif: "",
    };
    expect(erreurs(validerListe(s, true)).motif).toMatch(/correction/);
    const c = charge(validerListe({ ...s, motif: "Ajout d'un mot-clé" }, true));
    expect(c.regles[0]!.code).toBe("jeux");
    expect(c.reference_cadre).toBe("Normes de performance de la SFI");
    expect(c.nom).toBeUndefined();
  });

  it("borne la liste et les règles : 100 règles, 10 mots-clés de 60 caractères, 20 secteurs", () => {
    const liste = (regles: (typeof regle)[]) => ({
      nom: "L",
      client_id: "",
      reference_cadre: "",
      regles,
      motif: "",
    });
    const mots = (n: number, longueur = 5) =>
      Array.from({ length: n }, (_, i) => `${i}`.padEnd(longueur, "m")).join(", ");
    const distinctes = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...regle, libelle: `Règle ${i}` }));
    expect(charge(validerListe(liste(distinctes(100)), false)).regles).toHaveLength(100);
    expect(erreurs(validerListe(liste(distinctes(101)), false)).regles).toMatch(/100 règles/);
    expect(
      charge(validerListe(liste([{ ...regle, mots_cles: mots(10, 60) }]), false)).regles[0]!
        .mots_cles,
    ).toHaveLength(10);
    expect(erreurs(validerListe(liste([{ ...regle, mots_cles: mots(11) }]), false)).regles).toMatch(
      /10 mots-clés/,
    );
    expect(
      erreurs(validerListe(liste([{ ...regle, mots_cles: mots(1, 61) }]), false)).regles,
    ).toMatch(/60 caractères/);
    expect(
      erreurs(
        validerListe(
          liste([{ ...regle, secteur_codes: Array.from({ length: 21 }, (_, i) => `s${i}`) }]),
          false,
        ),
      ).regles,
    ).toMatch(/20 secteurs/);
  });

  it("exige au moins un critère par règle et au moins une règle", () => {
    expect(
      erreurs(
        validerListe(
          { nom: "L", client_id: "", reference_cadre: "", regles: [], motif: "" },
          false,
        ),
      ).regles,
    ).toMatch(/au moins une règle/);
    expect(
      erreurs(
        validerListe(
          {
            nom: "L",
            client_id: "",
            reference_cadre: "",
            regles: [{ ...regle, mots_cles: "" }],
            motif: "",
          },
          false,
        ),
      ).regles,
    ).toMatch(/au moins un critère/);
    expect(
      charge(
        validerListe(
          {
            nom: "L",
            client_id: "",
            reference_cadre: "",
            regles: [{ ...regle, mots_cles: "", secteur_codes: ["citi_b"] }],
            motif: "",
          },
          false,
        ),
      ).regles[0]!.secteur_codes,
    ).toEqual(["citi_b"]);
    expect(
      erreurs(
        validerListe(
          { nom: "", client_id: "x", reference_cadre: "", regles: [regle], motif: "" },
          false,
        ),
      ).nom,
    ).toBeDefined();
  });
});

describe("plan des 100 jours (DD-15)", () => {
  const action = { ...saisieActionVide(), libelle: "Désigner le directeur financier" };

  it("valide une action, jours bornés de 0 à 100", () => {
    expect(
      charge(
        validerAction({ ...action, jour_debut: "5", jour_fin: "30", responsable_id: UUID }, false),
      ),
    ).toMatchObject({
      jour_debut: 5,
      jour_fin: 30,
      statut_action: "a_faire",
      responsable_id: UUID,
      plan_element_id: null,
      kpi_id: null,
    });
    expect(
      erreurs(validerAction({ ...action, jour_debut: "101" }, false)).jour_debut,
    ).toBeDefined();
    expect(erreurs(validerAction({ ...action, jour_fin: "" }, false)).jour_fin).toBeDefined();
    expect(validerAction({ ...action, jour_debut: "0", jour_fin: "100" }, false).ok).toBe(true);
  });

  it("refuse une fin avant le début, un statut inconnu et un lien invalide", () => {
    expect(
      erreurs(validerAction({ ...action, jour_debut: "40", jour_fin: "10" }, false)).jour_fin,
    ).toMatch(/ne précède pas/);
    expect(
      erreurs(validerAction({ ...action, statut_action: "?" }, false)).statut_action,
    ).toBeDefined();
    const e = erreurs(
      validerAction({ ...action, responsable_id: "x", plan_element_id: "y", kpi_id: "z" }, false),
    );
    expect(Object.keys(e).sort()).toEqual(["kpi_id", "plan_element_id", "responsable_id"]);
  });

  it("exige le motif d'une correction", () => {
    expect(erreurs(validerAction(action, true)).motif).toBeDefined();
    expect(charge(validerAction({ ...action, motif: "Retard" }, true)).motif).toBe("Retard");
  });
});

describe("note au comité (DD-13)", () => {
  const note = {
    ...saisieNoteVide(),
    titre: "Note au comité",
    recommandation: "favorable",
    synthese: "L'opération est solide.",
  };

  it("crée une note : titre exigé, pas de motif", () => {
    const c = charge(validerNote(note, "creation"));
    expect(c).toEqual({
      titre: "Note au comité",
      recommandation: "favorable",
      synthese: "L'opération est solide.",
      conditions: [],
    });
    expect(erreurs(validerNote({ ...note, titre: "" }, "creation")).titre).toBeDefined();
  });

  it("une version exige un motif et ne renvoie pas de titre", () => {
    expect(erreurs(validerNote(note, "version")).motif).toBeDefined();
    const c = charge(validerNote({ ...note, motif: "Précision" }, "version"));
    expect(c.titre).toBeUndefined();
    expect(c.motif).toBe("Précision");
  });

  it("exige une condition pour une recommandation sous conditions", () => {
    const sous = { ...note, recommandation: "favorable_sous_conditions" };
    expect(erreurs(validerNote(sous, "creation")).conditions).toMatch(/au moins une condition/);
    expect(
      charge(
        validerNote(
          { ...sous, conditions: "Garantie de passif\nAudit environnemental" },
          "creation",
        ),
      ).conditions,
    ).toEqual(["Garantie de passif", "Audit environnemental"]);
  });

  it("borne la synthèse (4 000), les conditions (20 de 300) et exige la recommandation", () => {
    expect(
      erreurs(validerNote({ ...note, synthese: "a".repeat(4001) }, "creation")).synthese,
    ).toMatch(/4000/);
    expect(
      erreurs(
        validerNote(
          { ...note, conditions: Array.from({ length: 21 }, (_, i) => `c${i}`).join("\n") },
          "creation",
        ),
      ).conditions,
    ).toMatch(/20/);
    expect(
      erreurs(validerNote({ ...note, conditions: "x".repeat(301) }, "creation")).conditions,
    ).toMatch(/300/);
    expect(
      erreurs(validerNote({ ...note, recommandation: "" }, "creation")).recommandation,
    ).toBeDefined();
    expect(erreurs(validerNote({ ...note, synthese: "" }, "creation")).synthese).toMatch(/Rédigez/);
  });
});
