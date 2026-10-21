import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminExplication,
  cheminListeReprevisions,
  cheminRealise,
  cheminRealises,
  compterSignificatifs,
  exercicesHorizon,
  formaterEcart,
  formaterEcartRelatif,
  formaterSeuil,
  hrefPlanVivant,
  lireExercice,
  lireIdReprevision,
  lireMontantSigne,
  lignesAnnuelles,
  lignesTrimestre,
  messagePlanVivant,
  phraseEcartEbe,
  realiseVersSaisie,
  trimestresSaisissables,
  validerRealise,
  validerReprevision,
  versionParDefaut,
  type EcartMesure,
  type EcartsAnnuels,
  type EcartsTrimestre,
  type ExplicationEcartEbe,
  type SaisieRealise,
} from "./plan-vivant";

const NBSP = " ";
const mesure = (
  prevu: number,
  reel: number | null,
  over: Partial<EcartMesure> = {},
): EcartMesure => ({
  prevu,
  reel,
  ecart: reel === null ? null : reel - prevu,
  ecartRelatifPointsDeBase:
    reel === null || prevu === 0 ? null : Math.round(((reel - prevu) * 10000) / prevu),
  significatif: false,
  ...over,
});

const saisie = (over: Partial<SaisieRealise> = {}): SaisieRealise => ({
  chiffre_affaires: "24 000 000",
  ebe: "-3 000 000",
  resultat_net: "",
  tresorerie_fin: "",
  commentaire: "",
  ...over,
});

describe("lireMontantSigne", () => {
  it("XOF : entier signé ; refuse les décimales", () => {
    expect(lireMontantSigne("1 500 000", "XOF")).toBe(1_500_000);
    expect(lireMontantSigne("-2 000", "XOF")).toBe(-2000);
    expect(lireMontantSigne("", "XOF")).toBeNull();
    expect(lireMontantSigne("12,5", "XOF")).toBeNaN();
    expect(lireMontantSigne("abc", "XOF")).toBeNaN();
  });

  it("EUR : centimes ; zéro négatif ramené à 0 ; entier non sûr refusé", () => {
    expect(lireMontantSigne("1 500,50", "EUR")).toBe(150_050);
    expect(lireMontantSigne("-0,10", "EUR")).toBe(-10);
    expect(Object.is(lireMontantSigne("-0", "XOF"), 0)).toBe(true);
    expect(lireMontantSigne("1,005", "EUR")).toBeNaN();
    expect(lireMontantSigne("90071992547409920", "XOF")).toBeNaN();
  });

  it("realiseVersSaisie est la réciproque", () => {
    expect(realiseVersSaisie(150_050, "EUR")).toBe("1500,5");
    expect(realiseVersSaisie(-2000, "XOF")).toBe("-2000");
    expect(realiseVersSaisie(null, "XOF")).toBe("");
  });
});

describe("validerRealise", () => {
  it("accepte un EBE négatif, convertit les unités mineures, null pour les facultatifs", () => {
    const v = validerRealise(saisie({ commentaire: "  Retard de livraison.  " }), "XOF");
    expect(v.erreurs).toEqual({});
    expect(v.corps).toEqual({
      chiffre_affaires: 24_000_000,
      ebe: -3_000_000,
      resultat_net: null,
      tresorerie_fin: null,
      commentaire: "Retard de livraison.",
    });
    expect(
      validerRealise(
        saisie({ chiffre_affaires: "10,5", ebe: "2", resultat_net: "-1", tresorerie_fin: "0" }),
        "EUR",
      ).corps,
    ).toMatchObject({ chiffre_affaires: 1050, ebe: 200, resultat_net: -100, tresorerie_fin: 0 });
  });

  it("signale chaque champ fautif", () => {
    const v = validerRealise(
      saisie({
        chiffre_affaires: "-5",
        ebe: "",
        resultat_net: "x",
        tresorerie_fin: "1,2",
        commentaire: "a".repeat(1001),
      }),
      "XOF",
    );
    expect(v.corps).toBeNull();
    expect(Object.keys(v.erreurs).sort()).toEqual([
      "chiffre_affaires",
      "commentaire",
      "ebe",
      "resultat_net",
      "tresorerie_fin",
    ]);
    expect(
      validerRealise(saisie({ chiffre_affaires: "" }), "XOF").erreurs.chiffre_affaires,
    ).toMatch(/obligatoire/);
    expect(validerRealise(saisie({ commentaire: "a\u0000b" }), "XOF").erreurs.commentaire).toMatch(
      /contrôle/,
    );
  });
});

describe("validerReprevision", () => {
  const base = { version: "2", methode: "tendance", seuil: "10" };

  it("convertit le seuil en pour mille", () => {
    expect(validerReprevision(base, 2027).corps).toEqual({
      version: 2,
      exercice: 2027,
      methode: "tendance",
      seuil: 100,
    });
    expect(validerReprevision({ ...base, seuil: "7,5" }, 2027).corps?.seuil).toBe(75);
    expect(validerReprevision({ ...base, seuil: "100" }, 2027).corps?.seuil).toBe(1000);
  });

  it("refuse version vide, méthode inconnue, seuil hors bornes ou trop précis", () => {
    expect(validerReprevision({ ...base, version: "" }, 2027).erreurs.version).toBeTruthy();
    expect(validerReprevision({ ...base, methode: "magie" }, 2027).erreurs.methode).toBeTruthy();
    for (const seuil of ["0", "100,1", "10,05", "abc", ""]) {
      expect(validerReprevision({ ...base, seuil }, 2027).corps, seuil).toBeNull();
    }
  });
});

describe("formatage des écarts", () => {
  it("écart signé en toutes lettres, relatif en points de base", () => {
    expect(formaterEcart(1_500, "XOF")).toBe(`+1${" "}500${NBSP}FCFA`);
    expect(formaterEcart(-2_000, "XOF")).toBe(`−2${" "}000${NBSP}FCFA`);
    expect(formaterEcart(0, "XOF")).toBe(`0${NBSP}FCFA`);
    expect(formaterEcart(null, "XOF")).toBe("—");
    expect(formaterEcartRelatif(-1273)).toMatch(/^−12,73\s?%$/);
    expect(formaterEcartRelatif(500)).toMatch(/^\+5\s?%$/);
    expect(formaterEcartRelatif(null)).toBe("—");
    expect(formaterSeuil(100)).toMatch(/^10\s?%$/);
  });
});

describe("lignes des tableaux d'écarts", () => {
  const trimestre: EcartsTrimestre = {
    trimestre: 1,
    chiffreAffaires: mesure(27_500_000, 24_000_000, { significatif: true }),
    excedentBrutExploitation: mesure(5_000_000, 5_100_000),
    resultatNet: mesure(2_000_000, null),
    tresorerieFin: mesure(10_000_000, 11_000_000),
  };

  it("quatre lignes par trimestre ; marqueur textuel ; non saisi", () => {
    const l = lignesTrimestre(trimestre, "XOF");
    expect(l.map((x) => x.cle)).toEqual(["t1-ca", "t1-ebe", "t1-rn", "t1-tr"]);
    expect(l[0]).toMatchObject({ marqueur: "Significatif", significatif: true });
    expect(l[0]?.ecart).toMatch(/^−3/);
    expect(l[1]?.marqueur).toBe("Dans le seuil");
    expect(l[2]).toMatchObject({
      reel: "Non saisi",
      ecart: "—",
      ecartRelatif: "—",
      marqueur: "Non saisi",
    });
    expect(compterSignificatifs(l)).toBe(1);
  });

  it("tableau annuel : trésorerie de clôture en projection simplifiée", () => {
    const annuels: EcartsAnnuels = {
      chiffreAffaires: mesure(110, 100),
      excedentBrutExploitation: mesure(40, 41),
      resultatNet: mesure(10, null),
      tresorerieCloture: mesure(30, null),
    };
    const l = lignesAnnuelles(annuels, "XOF");
    expect(l).toHaveLength(4);
    expect(l[3]?.mesure).toContain("projection simplifiée");
  });
});

describe("phraseEcartEbe", () => {
  const e: ExplicationEcartEbe = {
    chiffreAffairesPrevu: 55_000_000,
    chiffreAffairesReel: 54_000_000,
    ebePrevu: 10_000_000,
    ebeReel: 8_000_000,
    ecartEbe: -2_000_000,
    effetVolume: -181_818,
    effetMarge: -1_818_182,
    tauxMargePrevuPointsDeBase: 1818,
    tauxMargeReelPointsDeBase: 1481,
  };

  it("nomme les montants signés du moteur sans rien recalculer", () => {
    const p = phraseEcartEbe(e, 2, "XOF");
    expect(p).toContain("les 2 premiers trimestres");
    expect(p).toContain("inférieur");
    expect(p).toContain("effet volume est défavorable");
    expect(p).toContain("effet de marge est défavorable");
    expect(p).toContain("181");
    expect(p).toMatch(/18,18\s?%/);
    expect(p).toMatch(/14,81\s?%/);
  });

  it("premier trimestre, écart favorable, nul, ou décomposition indisponible", () => {
    expect(
      phraseEcartEbe(
        { ...e, ecartEbe: 5, effetVolume: 5, effetMarge: 0, chiffreAffairesReel: 56_000_000 },
        1,
        "XOF",
      ),
    ).toMatch(
      /le premier trimestre.*supérieur.*effet volume est favorable.*effet de marge est nul/,
    );
    expect(
      phraseEcartEbe({ ...e, ecartEbe: 0, effetVolume: 0, effetMarge: 0 }, 1, "XOF"),
    ).toContain("égal à l'EBE prévu");
    expect(phraseEcartEbe(null, 1, "XOF")).toContain("n'est pas disponible");
  });
});

describe("versions, exercices et trimestres", () => {
  it("seules les versions validées servent ; la plus récente d'abord", () => {
    expect(
      versionParDefaut([
        { version: 5, validee: false },
        { version: 4, validee: true },
        { version: 2, validee: true },
      ]),
    ).toBe(4);
    expect(versionParDefaut([{ version: 1, validee: false }])).toBeNull();
    expect(versionParDefaut([])).toBeNull();
  });

  it("exercices de l'horizon", () => {
    expect(exercicesHorizon(2027, 3)).toEqual([2027, 2028, 2029]);
    expect(exercicesHorizon(2027, 0)).toEqual([]);
  });

  it("trimestres saisissables : dans l'ordre, sans trou, 4 au plus", () => {
    expect(trimestresSaisissables([])).toEqual([1]);
    expect(trimestresSaisissables([1, 2])).toEqual([1, 2, 3]);
    expect(trimestresSaisissables([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });
});

describe("chemins et lecture de l'URL", () => {
  it("chemins de l'API", () => {
    expect(cheminRealises("p1")).toBe("/api/plans/p1/realises");
    expect(cheminRealises("p1", 2027)).toBe("/api/plans/p1/realises?exercice=2027");
    expect(cheminRealise("p1", 2027, 3)).toBe("/api/plans/p1/realises/2027/3");
    expect(cheminListeReprevisions("p1", 10, "c", 2028)).toBe(
      "/api/plans/p1/reprevisions?limite=10&curseur=c&exercice=2028",
    );
    expect(cheminExplication("p1", "r 1")).toBe("/api/plans/p1/reprevisions/r%201/explication");
  });

  it("href de la page", () => {
    expect(hrefPlanVivant("m", "p")).toBe("/missions/m/plan/p/plan-vivant");
    expect(hrefPlanVivant("m", "p", { exercice: 2028, reprevision: "r" })).toBe(
      "/missions/m/plan/p/plan-vivant?exercice=2028&reprevision=r",
    );
  });

  it("identifiant et exercice de l'URL", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(lireIdReprevision(id)).toBe(id);
    expect(lireIdReprevision("x")).toBeNull();
    expect(lireIdReprevision(undefined)).toBeNull();
    expect(lireExercice("2028")).toBe(2028);
    for (const v of ["1999", "2101", "20x8", "", undefined]) expect(lireExercice(v)).toBeNull();
  });
});

describe("messagePlanVivant", () => {
  const erreur = (statut: number, code: string, message = "m") =>
    new ErreurApi(code, message, statut);

  it("traduit les codes de l'API sans montant", () => {
    expect(messagePlanVivant(erreur(400, "REALISE_TRIMESTRE_NON_CONSECUTIF"))).toMatch(
      /dans l'ordre/,
    );
    expect(messagePlanVivant(erreur(409, "MODELE_NON_VALIDE"))).toMatch(/validée/);
    expect(messagePlanVivant(erreur(409, "REPREVISIONS_PLAFOND"))).toMatch(/maximal/);
    expect(
      messagePlanVivant(
        erreur(400, "REPREVISION_INVALIDE", "Réalisés : de 1 à 4 trimestres attendus."),
      ),
    ).toBe("Réalisés : de 1 à 4 trimestres attendus.");
    expect(messagePlanVivant(erreur(403, "INTERDIT"))).toMatch(/rédacteurs/);
    expect(messagePlanVivant(erreur(404, "INTROUVABLE"))).toMatch(/introuvable/);
    expect(messagePlanVivant(erreur(409, "CONFLIT"))).toMatch(/clôturée/);
    expect(messagePlanVivant(new Error("x"))).toBeTruthy();
  });
});
