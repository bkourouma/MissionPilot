import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminDefauts,
  cheminListeSimulations,
  cheminRejeu,
  cleErreurLoi,
  descriptionHistogramme,
  geometrieHistogramme,
  hrefSimulation,
  libelleLoi,
  lignesHistogramme,
  lignesTensionParAnnee,
  lireIdSimulation,
  messageMonteCarlo,
  messageRejeu,
  saisieInitiale,
  validerSimulation,
  versionParDefaut,
  type HistogrammeVan,
  type HypotheseIncertaine,
  type ResultatMonteCarlo,
} from "./plan-montecarlo";

const DEFAUTS: HypotheseIncertaine[] = [
  { cible: "croissanceChiffreAffaires", loi: { type: "triangulaire", min: -5, mode: 0, max: 5 } },
  { cible: "delaiClientsJours", loi: { type: "triangulaire", min: 0, mode: 0, max: 30 } },
];

const ID = "11111111-1111-4111-8111-111111111111";

describe("versionParDefaut", () => {
  it("retient la dernière validée, sinon la dernière", () => {
    expect(
      versionParDefaut([
        { version: 3, validee: false },
        { version: 2, validee: true },
        { version: 1, validee: true },
      ]),
    ).toBe(2);
    expect(versionParDefaut([{ version: 2, validee: false }])).toBe(2);
    expect(versionParDefaut([])).toBeNull();
  });
});

describe("saisie et validation des lois", () => {
  it("la saisie initiale active les lois de départ, 1000 tirages, graine vide", () => {
    const s = saisieInitiale(2, DEFAUTS);
    expect(s).toMatchObject({ version: "2", graine: "", tirages: "1000" });
    expect(s.lois.croissanceChiffreAffaires).toMatchObject({ actif: true, min: "-5", max: "5" });
    expect(s.lois.tauxMargeBrute.actif).toBe(false);
  });

  it("produit le corps de l'API ; la graine absente n'est pas envoyée", () => {
    const v = validerSimulation(saisieInitiale(2, DEFAUTS));
    expect(v.erreurs).toEqual({});
    expect(v.corps).toEqual({ version: 2, tirages: 1000, hypotheses: DEFAUTS });
    const avecGraine = validerSimulation({ ...saisieInitiale(2, DEFAUTS), graine: "42" });
    expect(avecGraine.corps?.graine).toBe(42);
  });

  it("lit les nombres à la française (virgule)", () => {
    const s = saisieInitiale(1, DEFAUTS);
    s.lois.croissanceChiffreAffaires = { ...s.lois.croissanceChiffreAffaires, min: "-2,5" };
    const hyp = validerSimulation(s).corps?.hypotheses[0];
    expect(hyp?.loi).toMatchObject({ min: -2.5 });
  });

  it("borne la graine et les tirages comme l'API", () => {
    const base = saisieInitiale(1, DEFAUTS);
    expect(validerSimulation({ ...base, tirages: "99" }).erreurs.tirages).toBeTruthy();
    expect(validerSimulation({ ...base, tirages: "2001" }).erreurs.tirages).toBeTruthy();
    expect(validerSimulation({ ...base, tirages: "2000" }).erreurs.tirages).toBeUndefined();
    expect(validerSimulation({ ...base, graine: "-1" }).erreurs.graine).toBeTruthy();
    expect(validerSimulation({ ...base, graine: "4294967296" }).erreurs.graine).toBeTruthy();
    expect(validerSimulation({ ...base, graine: "1,5" }).erreurs.graine).toBeTruthy();
    expect(validerSimulation({ ...base, graine: "4294967295" }).erreurs.graine).toBeUndefined();
    expect(validerSimulation({ ...base, version: "" }).erreurs.version).toBeTruthy();
  });

  it("exige au moins une hypothèse et contrôle chaque loi active", () => {
    const aucune = saisieInitiale(1, []);
    expect(validerSimulation(aucune).erreurs.hypotheses).toBeTruthy();
    const s = saisieInitiale(1, DEFAUTS);
    s.lois.croissanceChiffreAffaires = { ...s.lois.croissanceChiffreAffaires, max: "-6" };
    s.lois.delaiClientsJours = { ...s.lois.delaiClientsJours, mode: "40" };
    const v = validerSimulation(s);
    expect(v.corps).toBeNull();
    expect(v.erreurs[cleErreurLoi("croissanceChiffreAffaires", "max")]).toBeTruthy();
    expect(v.erreurs[cleErreurLoi("delaiClientsJours", "mode")]).toBeTruthy();
  });

  it("loi normale : écart-type positif, moyenne dans l'intervalle", () => {
    const s = saisieInitiale(1, []);
    s.lois.tauxMargeBrute = {
      actif: true,
      type: "normale",
      min: "-3",
      mode: "",
      max: "3",
      moyenne: "5",
      ecartType: "0",
    };
    const v = validerSimulation(s);
    expect(v.erreurs[cleErreurLoi("tauxMargeBrute", "ecartType")]).toBeTruthy();
    expect(v.erreurs[cleErreurLoi("tauxMargeBrute", "moyenne")]).toBeTruthy();
    s.lois.tauxMargeBrute = { ...s.lois.tauxMargeBrute, moyenne: "0", ecartType: "1" };
    expect(validerSimulation(s).corps?.hypotheses[0]).toEqual({
      cible: "tauxMargeBrute",
      loi: { type: "normale", moyenne: 0, ecartType: 1, min: -3, max: 3 },
    });
  });

  it("refuse un nombre illisible ou trop grand", () => {
    const s = saisieInitiale(1, DEFAUTS);
    s.lois.croissanceChiffreAffaires = { ...s.lois.croissanceChiffreAffaires, min: "abc" };
    s.lois.delaiClientsJours = { ...s.lois.delaiClientsJours, max: "1001" };
    const v = validerSimulation(s);
    expect(v.erreurs[cleErreurLoi("croissanceChiffreAffaires", "min")]).toBeTruthy();
    expect(v.erreurs[cleErreurLoi("delaiClientsJours", "max")]).toBeTruthy();
  });
});

const histo: HistogrammeVan = {
  bornes: [-100, -50, 0, 50, 100],
  effectifs: [10, 30, 40, 20],
};

describe("histogramme", () => {
  it("une barre par classe, à l'échelle, signe par rapport à zéro", () => {
    const g = geometrieHistogramme(histo);
    expect(g).not.toBeNull();
    const barres = g!.barres;
    expect(barres).toHaveLength(4);
    expect(barres.map((b) => b.signe)).toEqual(["negative", "negative", "positive", "positive"]);
    // La classe la plus peuplée (40) touche le haut ; les autres lui sont proportionnelles.
    expect(barres[2]!.hauteur).toBeCloseTo(g!.bas - g!.haut);
    expect(barres[0]!.hauteur).toBeCloseTo((g!.bas - g!.haut) / 4);
    // Barres jointives, de gauche à droite, dans le cadre.
    expect(barres[0]!.x).toBeCloseTo(g!.gauche);
    expect(barres[3]!.x + barres[3]!.largeur).toBeCloseTo(g!.droite);
    expect(barres[1]!.x + barres[1]!.largeur).toBeCloseTo(barres[2]!.x);
    expect(g!.xZero).toBeCloseTo((g!.gauche + g!.droite) / 2);
  });

  it("classe à cheval sur zéro ; zéro hors intervalle ; étendue nulle", () => {
    const mixte = geometrieHistogramme({ bornes: [-10, 10, 30], effectifs: [5, 5] });
    expect(mixte!.barres[0]!.signe).toBe("mixte");
    const positif = geometrieHistogramme({ bornes: [10, 20, 30], effectifs: [5, 5] });
    expect(positif!.xZero).toBeNull();
    const nul = geometrieHistogramme({ bornes: [7, 7, 7], effectifs: [0, 12] });
    expect(nul!.xZero).toBeNull();
    expect(nul!.barres[1]!.largeur).toBeGreaterThan(0);
  });

  it("refuse une forme incohérente", () => {
    expect(geometrieHistogramme({ bornes: [0, 1], effectifs: [] })).toBeNull();
    expect(geometrieHistogramme({ bornes: [0, 1, 2], effectifs: [1, 2, 3] })).toBeNull();
  });

  it("tableau équivalent : une ligne par classe, effectifs du moteur", () => {
    const lignes = lignesHistogramme(histo, "XOF");
    expect(lignes.map((l) => l.effectif)).toEqual([10, 30, 40, 20]);
    expect(lignes[0]!.classe).toContain("FCFA");
  });
});

const resultat = {
  tiragesValides: 980,
  van: {
    minimum: -100,
    maximum: 100,
    percentiles: { p50: 10 },
    histogramme: histo,
  },
  probabiliteVanNegative: 0.1234,
  probabiliteTensionParAnnee: [0, 0.05, 0.2],
} as unknown as ResultatMonteCarlo;

describe("textes", () => {
  it("description du graphique : valeurs du moteur, probabilité en pourcentage", () => {
    const d = descriptionHistogramme(resultat, "XOF");
    expect(d).toContain("980");
    expect(d).toMatch(/12,34\s?%/);
  });

  it("tension par année", () => {
    expect(lignesTensionParAnnee(resultat)).toEqual([
      { cle: "1", annee: "Année 1", probabilite: 0 },
      { cle: "2", annee: "Année 2", probabilite: 0.05 },
      { cle: "3", annee: "Année 3", probabilite: 0.2 },
    ]);
  });

  it("libellé d'une loi avec son unité", () => {
    expect(
      libelleLoi({ type: "triangulaire", min: -5, mode: 0, max: 5 }, "chargesFixes"),
    ).toContain("%");
    expect(libelleLoi({ type: "uniforme", min: 0, max: 30 }, "delaiClientsJours")).toContain(
      "jours",
    );
  });

  it("rejeu : identique ou écart", () => {
    expect(
      messageRejeu({
        simulation_id: ID,
        identique: true,
        empreinte_enregistree: "abcd1234",
        empreinte_rejouee: "abcd1234",
      }),
    ).toMatch(/^Rejeu identique/);
    expect(
      messageRejeu({
        simulation_id: ID,
        identique: false,
        empreinte_enregistree: "abcd1234",
        empreinte_rejouee: "ffff0000",
      }),
    ).toMatch(/Écart constaté.*abcd1234.*ffff0000/);
    expect(
      messageRejeu({
        simulation_id: ID,
        identique: false,
        empreinte_enregistree: "abcd1234",
        empreinte_rejouee: "abcd1234",
      }),
    ).toMatch(/concordent/);
  });

  it("messages d'erreur de l'API", () => {
    const e = (statut: number, code: string, message = "msg") =>
      new ErreurApi(code, message, statut);
    expect(messageMonteCarlo(e(429, "TROP_DE_SIMULATIONS"))).toMatch(/patientez/);
    expect(messageMonteCarlo(e(409, "SIMULATIONS_PLAFOND"))).toMatch(/maximal/);
    expect(messageMonteCarlo(e(400, "MONTE_CARLO_INVALIDE", "réduire l'amplitude"))).toBe(
      "réduire l'amplitude",
    );
    expect(messageMonteCarlo(e(403, "INTERDIT"))).toMatch(/rédacteurs/);
    expect(messageMonteCarlo(e(404, "INTROUVABLE"))).toMatch(/introuvable/);
  });
});

describe("chemins et liens", () => {
  it("chemins de l'API", () => {
    expect(cheminListeSimulations(ID, 10, null)).toBe(
      `/api/plans/${ID}/montecarlo/simulations?limite=10`,
    );
    expect(cheminListeSimulations(ID, 10, "abc")).toContain("curseur=abc");
    expect(cheminRejeu(ID, ID)).toBe(`/api/plans/${ID}/montecarlo/simulations/${ID}/rejeu`);
    expect(cheminDefauts(ID)).toBe(`/api/plans/${ID}/montecarlo/defauts`);
    expect(cheminDefauts(ID, 3)).toBe(`/api/plans/${ID}/montecarlo/defauts?version=3`);
  });

  it("lien de la page et lecture de l'identifiant", () => {
    expect(hrefSimulation("m1", "p1")).toBe("/missions/m1/plan/p1/simulation");
    expect(hrefSimulation("m1", "p1", { simulation: ID, curseur: "c" })).toBe(
      `/missions/m1/plan/p1/simulation?simulation=${ID}&curseur=c`,
    );
    expect(lireIdSimulation(ID)).toBe(ID);
    expect(lireIdSimulation([ID, "x"])).toBe(ID);
    expect(lireIdSimulation("pas-un-uuid")).toBeNull();
    expect(lireIdSimulation(undefined)).toBeNull();
  });
});
