import { describe, expect, it } from "vitest";
import type { DefinitionKpi } from "./kpi";
import {
  dateMesureMax,
  fractionVersPourcentage,
  ilYaDixAns,
  lireEntier,
  lirePonderation,
  lirePourcentage,
  lireValeurKpi,
  SAISIE_KPI_VIDE,
  saisieDepuisKpi,
  saisieDepuisParametres,
  validerAnnulation,
  validerCible,
  validerContributeurs,
  validerCorrection,
  validerCreationKpi,
  validerMesure,
  validerModificationKpi,
  validerParametres,
  valeurVersSaisie,
  type SaisieKpi,
} from "./kpi-saisie";

describe("valeur d'un KPI : jamais arrondie en silence", () => {
  it("nombres à la française, négatifs, zéros", () => {
    expect(lireValeurKpi("1 250,5")).toEqual({ valeur: 1250.5, erreur: null });
    expect(lireValeurKpi("-0,75").valeur).toBe(-0.75);
    expect(lireValeurKpi("0").valeur).toBe(0);
    expect(Object.is(lireValeurKpi("-0").valeur, 0)).toBe(true);
    expect(lireValeurKpi("007,500").valeur).toBe(7.5);
    expect(lireValeurKpi("")).toEqual({ valeur: null, erreur: null });
  });

  it("15 chiffres significatifs au plus, 15 entiers, 6 décimales", () => {
    expect(lireValeurKpi("123456789012345").valeur).toBe(123456789012345);
    expect(lireValeurKpi("12345678901234,5").valeur).toBe(12345678901234.5);
    expect(lireValeurKpi("0,000123").valeur).toBe(0.000123);
    expect(lireValeurKpi("1234567890123456").erreur).toMatch(/15 chiffres avant/);
    expect(lireValeurKpi("1,1234567").erreur).toMatch(/6 décimales/);
    // 123456789012345.123456 arriverait en 123456789012345.12 : refusé.
    expect(lireValeurKpi("123456789012345,123456").erreur).toMatch(/significatifs/);
    expect(lireValeurKpi("1,0000000000000001").erreur).toMatch(/6 décimales/);
  });

  it("textes illisibles refusés", () => {
    for (const v of ["abc", "1,2,3", "1e5", "--1", "12 a"]) {
      expect(lireValeurKpi(v).erreur, v).toMatch(/Nombre attendu/);
    }
  });

  it("aller-retour vers le champ de saisie", () => {
    expect(valeurVersSaisie(1250.5)).toBe("1250,5");
    expect(valeurVersSaisie(null)).toBe("");
  });
});

describe("pourcentages ↔ fractions exactes (décalage de la virgule)", () => {
  it.each([
    ["95", 0.95],
    ["87,5", 0.875],
    ["80", 0.8],
    ["100", 1],
    ["5", 0.05],
    ["0", 0],
    ["0,01", 0.0001],
    ["57,1", 0.571],
    ["2500", 25],
  ])("%s %% → %s", (texte, fraction) => {
    expect(lirePourcentage(texte, 10000)).toEqual({ valeur: fraction, erreur: null });
  });

  it("bornes et précision", () => {
    expect(lirePourcentage("101", 100).erreur).toMatch(/100 % au plus/);
    expect(lirePourcentage("95,125", 100).erreur).toMatch(/2 décimales/);
    expect(lirePourcentage("-5", 100).erreur).toMatch(/positif/);
    expect(lirePourcentage("95 %", 100).valeur).toBe(0.95);
    expect(lirePourcentage("", 100)).toEqual({ valeur: null, erreur: null });
  });

  it.each([
    [0.955, "95,5"],
    [1, "100"],
    [0.8, "80"],
    [0.05, "5"],
    [0.0001, "0,01"],
    [100, "10000"],
    [null, ""],
  ])("fraction %s → « %s »", (f, texte) => {
    expect(fractionVersPourcentage(f)).toBe(texte);
  });
});

describe("pondération et entiers", () => {
  it("pondération 0 à 1000, quatre décimales", () => {
    expect(lirePonderation("2,5").valeur).toBe(2.5);
    expect(lirePonderation("0").valeur).toBe(0);
    expect(lirePonderation("1000").valeur).toBe(1000);
    expect(lirePonderation("1000,5").erreur).toMatch(/1 000 au plus/);
    expect(lirePonderation("1,12345").erreur).toMatch(/4 décimales/);
    expect(lirePonderation("-1").erreur).toMatch(/positif/);
    expect(lirePonderation("").erreur).toMatch(/obligatoire/);
  });

  it("entiers bornés", () => {
    expect(lireEntier("7", 0, 60).valeur).toBe(7);
    expect(lireEntier("61", 0, 60).erreur).toMatch(/0 à 60/);
    expect(lireEntier("2,5", 0, 60).erreur).toMatch(/entier/);
    expect(lireEntier("", 0, 60).valeur).toBeNull();
  });
});

const AUJ = "2026-10-06";
const CTX = { aujourdhui: AUJ, proprietaires: ["chef", "membre"] };
const saisie = (s: Partial<SaisieKpi> = {}): SaisieKpi => ({
  ...SAISIE_KPI_VIDE,
  libelle: "Chiffre d'affaires mensuel",
  unite: "kFCFA",
  debut_suivi: "2026-01-01",
  ...s,
});

describe("création d'un KPI", () => {
  it("charge minimale : champs facultatifs vides omis, pondération 1", () => {
    const r = validerCreationKpi(saisie(), CTX);
    expect(r).toEqual({
      ok: true,
      charge: {
        libelle: "Chiffre d'affaires mensuel",
        unite: "kFCFA",
        sens: "plus_haut_mieux",
        nature: "flux",
        frequence: "mensuelle",
        debut_suivi: "2026-01-01",
        ponderation: 1,
        rappels_actifs: true,
      },
    });
  });

  it("charge complète : cible, seuils en fractions, alertes, propriétaire", () => {
    const r = validerCreationKpi(
      saisie({
        description: "  CA facturé  ",
        perspective: "finances",
        sens: "plus_bas_mieux",
        nature: "stock",
        frequence: "trimestrielle",
        fin_suivi: "2027-12-31",
        cible: "1 000",
        ponderation: "2",
        seuil_vert: "90",
        seuil_orange: "70",
        alerte_haut: "60",
        alerte_bas: "10",
        alerte_variation: "20",
        proprietaire_id: "chef",
        rappels_actifs: false,
      }),
      CTX,
    );
    expect(r.ok && r.charge).toMatchObject({
      description: "CA facturé",
      perspective: "finances",
      sens: "plus_bas_mieux",
      nature: "stock",
      frequence: "trimestrielle",
      fin_suivi: "2027-12-31",
      cible: 1000,
      ponderation: 2,
      seuil_vert: 0.9,
      seuil_orange: 0.7,
      alerte_haut: 60,
      alerte_bas: 10,
      alerte_variation: 0.2,
      proprietaire_id: "chef",
      rappels_actifs: false,
    });
  });

  it("refus : libellé, unité, début, seuils incohérents, alertes inversées, propriétaire", () => {
    const r = validerCreationKpi(
      saisie({
        libelle: " ",
        unite: "",
        debut_suivi: "",
        seuil_vert: "80",
        seuil_orange: "90",
        alerte_haut: "10",
        alerte_bas: "20",
        proprietaire_id: "intrus",
        sens: "au_hasard",
      }),
      CTX,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erreurs).sort()).toEqual([
      "alerte_bas",
      "debut_suivi",
      "libelle",
      "proprietaire_id",
      "sens",
      "seuil_orange",
      "unite",
    ]);
  });

  it("un seul seuil : les deux ou aucun", () => {
    const r = validerCreationKpi(saisie({ seuil_vert: "90" }), CTX);
    expect(!r.ok && r.erreurs.seuil_orange).toMatch(/les deux seuils/);
  });

  it("début de suivi au plus 10 ans avant aujourd'hui ; fin après le début", () => {
    expect(ilYaDixAns(AUJ)).toBe("2016-10-06");
    expect(ilYaDixAns("2028-02-29")).toBe("2018-02-28");
    const ancien = validerCreationKpi(saisie({ debut_suivi: "2010-06-30" }), CTX);
    expect(!ancien.ok && ancien.erreurs.debut_suivi).toMatch(/10 ans/);
    const fin = validerCreationKpi(saisie({ fin_suivi: "2025-12-31" }), CTX);
    expect(!fin.ok && fin.erreurs.fin_suivi).toMatch(/précéder/);
  });

  it("cible trop précise refusée, jamais arrondie", () => {
    const r = validerCreationKpi(saisie({ cible: "1,1234567" }), CTX);
    expect(!r.ok && r.erreurs.cible).toMatch(/6 décimales/);
  });
});

const DEF: DefinitionKpi = {
  id: "k1",
  mission_id: "m1",
  client_id: "c1",
  libelle: "Délai de paiement",
  description: null,
  unite: "jours",
  perspective: "clients",
  sens: "plus_bas_mieux",
  nature: "stock",
  frequence: "mensuelle",
  ponderation: 2,
  seuil_vert: null,
  seuil_orange: null,
  alerte_haut: 60,
  alerte_bas: null,
  alerte_variation: null,
  proprietaire_id: "chef",
  debut_suivi: "2026-01-01",
  fin_suivi: null,
  rappels_actifs: true,
  actif: true,
  cible_actuelle: 45,
  cree_le: "2026-01-02T00:00:00Z",
  modifie_le: "2026-01-02T00:00:00Z",
};

describe("modification d'un KPI : seuls les champs changés partent", () => {
  it("aucun changement : rien à envoyer", () => {
    expect(validerModificationKpi(saisieDepuisKpi(DEF), DEF, CTX)).toEqual({
      ok: false,
      erreurs: {},
      inchange: true,
    });
  });

  it("libellé changé seul ; sens, nature, fréquence et début jamais envoyés", () => {
    const s = { ...saisieDepuisKpi(DEF), libelle: "Délai moyen", sens: "plus_haut_mieux" };
    expect(validerModificationKpi(s, DEF, CTX)).toEqual({
      ok: true,
      charge: { libelle: "Délai moyen" },
    });
  });

  it("seuils et alertes envoyés par paires (cohérence contrôlée par l'API)", () => {
    const s = { ...saisieDepuisKpi(DEF), seuil_vert: "90", seuil_orange: "70", alerte_bas: "5" };
    const r = validerModificationKpi(s, DEF, CTX);
    expect(r.ok && r.charge).toEqual({
      seuil_vert: 0.9,
      seuil_orange: 0.7,
      alerte_haut: 60,
      alerte_bas: 5,
    });
  });

  it("effacements : null envoyé (propriétaire, description, perspective)", () => {
    const d = { ...DEF, description: "Texte" };
    const s = { ...saisieDepuisKpi(d), proprietaire_id: "", description: "", perspective: "" };
    const r = validerModificationKpi(s, d, CTX);
    expect(r.ok && r.charge).toEqual({
      proprietaire_id: null,
      description: null,
      perspective: null,
    });
  });

  it("propriétaire sorti de l'équipe : gardé sans erreur, jamais remplacé en silence", () => {
    const d = { ...DEF, proprietaire_id: "ancien" };
    expect(validerModificationKpi(saisieDepuisKpi(d), d, CTX)).toMatchObject({ inchange: true });
    const autre = validerModificationKpi(
      { ...saisieDepuisKpi(DEF), proprietaire_id: "ancien" },
      DEF,
      CTX,
    );
    expect(!autre.ok && autre.erreurs.proprietaire_id).toMatch(/responsables et l'équipe/);
  });

  it("fin de suivi bornée par le début figé", () => {
    const r = validerModificationKpi(
      { ...saisieDepuisKpi(DEF), fin_suivi: "2025-06-30" },
      DEF,
      CTX,
    );
    expect(!r.ok && r.erreurs.fin_suivi).toMatch(/précéder/);
  });
});

describe("cible versionnée", () => {
  it("valeur, date d'application, motif facultatif ; « sans cible » = null", () => {
    expect(
      validerCible(
        { valeur: "1 200", sans_cible: false, a_partir_de: "2026-04-10", motif: " Budget " },
        DEF,
      ),
    ).toEqual({ ok: true, charge: { valeur: 1200, a_partir_de: "2026-04-10", motif: "Budget" } });
    expect(
      validerCible({ valeur: "abc", sans_cible: true, a_partir_de: "2026-04-01", motif: "" }, DEF),
    ).toEqual({ ok: true, charge: { valeur: null, a_partir_de: "2026-04-01" } });
  });

  it("refus : valeur manquante, date avant le début du suivi", () => {
    const r = validerCible(
      { valeur: "", sans_cible: false, a_partir_de: "2025-12-01", motif: "" },
      DEF,
    );
    expect(!r.ok && Object.keys(r.erreurs).sort()).toEqual(["a_partir_de", "valeur"]);
  });
});

describe("mesures : saisie, correction, annulation", () => {
  const base = {
    date_mesure: "2026-03-31",
    valeur: "62",
    commentaire: "",
    justificatif: "",
    motif: "",
  };

  it("date dans la période de suivi, au plus tard aujourd'hui (ou la fin du suivi)", () => {
    expect(dateMesureMax(DEF, AUJ)).toBe(AUJ);
    expect(dateMesureMax({ fin_suivi: "2026-06-30" }, AUJ)).toBe("2026-06-30");
    expect(dateMesureMax({ fin_suivi: "2027-06-30" }, AUJ)).toBe(AUJ);
    expect(validerMesure(base, DEF, AUJ)).toEqual({
      ok: true,
      charge: { date_mesure: "2026-03-31", valeur: 62 },
    });
    for (const date_mesure of ["2025-12-31", "2026-10-07", "", "2026-02-30"]) {
      const r = validerMesure({ ...base, date_mesure }, DEF, AUJ);
      expect(!r.ok && r.erreurs.date_mesure, date_mesure).toBeTruthy();
    }
  });

  it("valeur obligatoire et exacte ; commentaire et justificatif bornés", () => {
    expect(validerMesure({ ...base, valeur: "" }, DEF, AUJ).ok).toBe(false);
    const r = validerMesure(
      { ...base, commentaire: " Clôture ", justificatif: "x".repeat(501) },
      DEF,
      AUJ,
    );
    expect(!r.ok && r.erreurs.justificatif).toMatch(/500 caractères/);
    expect(
      validerMesure({ ...base, commentaire: " Clôture ", justificatif: "Balance" }, DEF, AUJ),
    ).toEqual({
      ok: true,
      charge: {
        date_mesure: "2026-03-31",
        valeur: 62,
        commentaire: "Clôture",
        justificatif: "Balance",
      },
    });
  });

  it("correction et annulation : motif obligatoire", () => {
    expect(validerCorrection(base, DEF, AUJ).ok).toBe(false);
    expect(validerCorrection({ ...base, motif: "Facture oubliée" }, DEF, AUJ)).toEqual({
      ok: true,
      charge: { date_mesure: "2026-03-31", valeur: 62, motif: "Facture oubliée" },
    });
    expect(validerAnnulation("  ")).toEqual({
      ok: false,
      erreurs: { motif: "Le motif est obligatoire : il reste dans l'historique." },
    });
    expect(validerAnnulation(" Saisie en double ")).toEqual({
      ok: true,
      charge: { motif: "Saisie en double" },
    });
    expect(validerAnnulation("x".repeat(501)).ok).toBe(false);
  });
});

describe("contributeurs et réglages du cabinet", () => {
  it("contributeurs : éligibles seulement, sans doublon, 50 au plus", () => {
    expect(validerContributeurs(["a", "a", "b"], ["a", "b"])).toEqual({
      ok: true,
      charge: { utilisateurs: ["a", "b"] },
    });
    expect(validerContributeurs(["z"], ["a"]).ok).toBe(false);
    const beaucoup = Array.from({ length: 51 }, (_, i) => `u${i}`);
    expect(validerContributeurs(beaucoup, beaucoup).ok).toBe(false);
    expect(validerContributeurs([], [])).toEqual({ ok: true, charge: { utilisateurs: [] } });
  });

  it("réglages : bornes et seuls les changements", () => {
    const actuel = {
      rappels_actifs: true,
      delai_grace_jours: 5,
      periodes_degradation: 3,
      valeurs_validees: false,
    };
    const s = saisieDepuisParametres(actuel);
    expect(validerParametres(s, actuel)).toEqual({ ok: false, erreurs: {}, inchange: true });
    expect(validerParametres({ ...s, delai_grace_jours: "7" }, actuel)).toEqual({
      ok: true,
      charge: { delai_grace_jours: 7 },
    });
    const r = validerParametres(
      { ...s, delai_grace_jours: "90", periodes_degradation: "0" },
      actuel,
    );
    expect(!r.ok && Object.keys(r.erreurs).sort()).toEqual([
      "delai_grace_jours",
      "periodes_degradation",
    ]);
    expect(validerParametres({ ...s, delai_grace_jours: "" }, actuel).ok).toBe(false);
  });
});
