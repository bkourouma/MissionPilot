import { describe, expect, it } from "vitest";
import {
  ErreurObservatoire,
  OBSERVATOIRE_CABINETS_MIN,
  OBSERVATOIRE_ENTREPRISES_MIN,
  OBSERVATOIRE_SECTEURS,
  OBSERVATOIRE_TAILLES,
  observatoireAgreger,
  observatoireCasePubliable,
  observatoireEstTaille,
  observatoireNormaliserSecteur,
  observatoirePreparerContributions,
  observatoireQuantileApproche,
  observatoireTranche,
  type ObservatoireCaseBrute,
} from "./observatoire";

/** Case brute construite depuis des valeurs individuelles (ce que ferait la fonction SQL). */
function caseDe(
  secteur: string,
  taille: string,
  valeurs: readonly number[],
  cabinets: number,
  /** Part de l'appelant dans la case (entreprises, cabinets : 0 ou 1) ; défaut : aucune. */
  appelant: { entreprises: number; cabinets: number } = { entreprises: 0, cabinets: 0 },
): ObservatoireCaseBrute {
  const histogramme = Array.from({ length: 10 }, () => 0);
  for (const v of valeurs) {
    const t = observatoireTranche(v);
    histogramme[t] = (histogramme[t] ?? 0) + 1;
  }
  return {
    secteur,
    taille,
    effectif_entreprises: valeurs.length,
    effectif_cabinets: cabinets,
    effectif_entreprises_autres: valeurs.length - appelant.entreprises,
    effectif_cabinets_autres: cabinets - appelant.cabinets,
    somme: (Math.round(valeurs.reduce((a, b) => a + b, 0) * 10) / 10).toFixed(1),
    histogramme,
  };
}

const publiee = (r: ReturnType<typeof observatoireAgreger>, secteur: string, taille: string) =>
  r.cases.find((c) => c.secteur === secteur && c.taille === taille);

describe("seuils d'anonymat (5 entreprises, 3 cabinets)", () => {
  it("constantes de l'exigence CAP-04", () => {
    expect(OBSERVATOIRE_ENTREPRISES_MIN).toBe(5);
    expect(OBSERVATOIRE_CABINETS_MIN).toBe(3);
    expect(observatoireCasePubliable(5, 3)).toBe(true);
    expect(observatoireCasePubliable(4, 3)).toBe(false);
    expect(observatoireCasePubliable(50, 2)).toBe(false);
  });

  it("une case sous 5 entreprises ou sous 3 cabinets est masquée, sans valeur ni effectif", () => {
    const r = observatoireAgreger([
      caseDe("industrie", "pme", [50, 60, 70, 55], 3),
      caseDe("commerce", "pme", [50, 60, 70, 55, 65, 40], 2),
      caseDe("btp", "pme", [50, 60, 70, 55, 65], 3),
    ]);
    for (const [s, t] of [
      ["industrie", "pme"],
      ["commerce", "pme"],
    ] as const) {
      expect(publiee(r, s, t)).toEqual({ secteur: s, taille: t, statut: "effectif_insuffisant" });
    }
    expect(publiee(r, "btp", "pme")).toMatchObject({ statut: "publiee", effectif_minimum: 5 });
  });

  it("grille complète : une case vide et une case sous seuil sont indiscernables", () => {
    const r = observatoireAgreger([caseDe("industrie", "pme", [50], 1)]);
    expect(r.cases).toHaveLength(OBSERVATOIRE_SECTEURS.length * OBSERVATOIRE_TAILLES.length);
    const sousSeuil = publiee(r, "industrie", "pme");
    const vide = publiee(r, "industrie", "tpe");
    expect({ ...sousSeuil, taille: "x" }).toEqual({ ...vide, taille: "x" });
    expect(Object.keys(sousSeuil as object).sort()).toEqual(["secteur", "statut", "taille"]);
    expect(r.marges).toEqual({ par_secteur: [], par_taille: [], ensemble: null });
  });
});

describe("attaque par différence entre cases", () => {
  it("les marges ne portent que sur les cases publiées : marge − cases publiées = rien", () => {
    const masquee = [99, 99, 99, 99]; // 4 entreprises : masquée
    const r = observatoireAgreger([
      caseDe("industrie", "pme", [40, 42, 44, 46, 48], 3),
      caseDe("industrie", "eti", [60, 62, 64, 66, 68], 4),
      caseDe("industrie", "tpe", masquee, 3),
    ]);
    const secteur = r.marges.par_secteur.find((m) => m.secteur === "industrie");
    expect(secteur).toMatchObject({ cases_publiees: 2, effectif_minimum: 10, moyenne: 54 });
    // L'attaquant reconstitue la marge depuis les cases publiées : il retrouve exactement la marge,
    // donc la case masquée (moyenne 99) n'y contribue en rien.
    const pme = publiee(r, "industrie", "pme") as { moyenne: number };
    const eti = publiee(r, "industrie", "eti") as { moyenne: number };
    expect((pme.moyenne * 5 + eti.moyenne * 5) / 10).toBe(secteur?.moyenne);
    expect(r.marges.ensemble).toMatchObject({ cases_publiees: 2, moyenne: 54 });
    expect(r.marges.par_taille.map((m) => m.taille)).toEqual(["pme", "eti"]);
    expect(JSON.stringify(r)).not.toContain("99");
  });

  it("la même marge, avec ou sans la case masquée en entrée", () => {
    const base = [
      caseDe("services", "pme", [10, 20, 30, 40, 50, 60], 3),
      caseDe("services", "tpe", [70, 70, 70, 70, 70], 5),
    ];
    const sans = observatoireAgreger(base);
    const avec = observatoireAgreger([...base, caseDe("services", "eti", [0, 0, 0, 100], 4)]);
    expect(avec.marges).toEqual(sans.marges);
  });
});

describe("arrondis, histogramme et statistiques approchées", () => {
  it("moyenne au point entier (demi vers le haut), effectif à la tranche de 5 inférieure", () => {
    const r = observatoireAgreger([caseDe("finance", "eti", [50, 50, 50, 50, 50.5, 51, 52], 3)]);
    expect(publiee(r, "finance", "eti")).toMatchObject({
      effectif_minimum: 5,
      moyenne: 51, // 353,5 / 7 = 50,5 exactement → 51
      q1: null,
      q3: null,
      repartition: null,
    });
    const dessous = observatoireAgreger([caseDe("finance", "pme", [50, 50, 50, 50, 52.4], 3)]);
    expect(publiee(dessous, "finance", "pme")).toMatchObject({ moyenne: 50 }); // 50,48 → 50
  });

  it("quartiles et répartition à partir de 10 entreprises, pourcentages arrondis à 5", () => {
    const valeurs = [5, 15, 25, 35, 45, 55, 65, 75, 85, 100, 100];
    const r = observatoireAgreger([caseDe("numerique", "pme", valeurs, 4)]);
    const c = publiee(r, "numerique", "pme") as {
      repartition: number[];
      q1: number;
      q3: number;
      mediane: number;
      effectif_minimum: number;
    };
    expect(c.effectif_minimum).toBe(10);
    expect(c.repartition).toHaveLength(10);
    expect(c.repartition.every((p) => p % 5 === 0)).toBe(true);
    expect(c.repartition[9]).toBe(20); // 2/11 = 18,2 % → 20
    expect(c.repartition[0]).toBe(10); // 1/11 = 9,1 % → 10
    expect(c.q1).toBeLessThanOrEqual(c.mediane);
    expect(c.mediane).toBeLessThanOrEqual(c.q3);
    expect(c.mediane).toBe(55);
  });

  it("quantile approché par interpolation linéaire dans la tranche", () => {
    expect(observatoireQuantileApproche([0, 0, 0, 0, 0, 4, 0, 0, 0, 0], 0.5)).toBe(55);
    expect(observatoireQuantileApproche([2, 0, 0, 0, 0, 0, 0, 0, 0, 2], 0.5)).toBe(10);
    expect(observatoireQuantileApproche([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 0.99)).toBe(100);
    expect(observatoireQuantileApproche([1, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.01)).toBe(0);
    expect(() => observatoireQuantileApproche([0, 0], 0.5)).toThrow(ErreurObservatoire);
    expect(() => observatoireQuantileApproche([1], 1)).toThrow(ErreurObservatoire);
  });

  it("tranches de 10 points, 100 dans la dernière", () => {
    expect(observatoireTranche(0)).toBe(0);
    expect(observatoireTranche(9.9)).toBe(0);
    expect(observatoireTranche(10)).toBe(1);
    expect(observatoireTranche(99.9)).toBe(9);
    expect(observatoireTranche(100)).toBe(9);
    for (const v of [-0.1, 100.1, Number.NaN]) {
      expect(() => observatoireTranche(v)).toThrow(ErreurObservatoire);
    }
  });
});

describe("règle de dominance : seuils calculés hors du cabinet appelant", () => {
  const appelant = { entreprises: 2, cabinets: 1 };

  it("3 cabinets dont l'appelant : masquée ; 4 cabinets dont l'appelant : publiée", () => {
    const trois = observatoireAgreger([
      caseDe("commerce", "pme", [50, 60, 70, 55, 65, 40], 3, appelant),
    ]);
    expect(publiee(trois, "commerce", "pme")).toEqual({
      secteur: "commerce",
      taille: "pme",
      statut: "effectif_insuffisant",
    });
    expect(trois.marges.ensemble).toBeNull();
    const quatre = observatoireAgreger([
      caseDe("commerce", "pme", [50, 60, 70, 55, 65, 40, 45], 4, appelant),
    ]);
    expect(publiee(quatre, "commerce", "pme")).toMatchObject({ statut: "publiee" });
  });

  it("5 entreprises au total mais moins de 5 hors appelant : masquée", () => {
    const r = observatoireAgreger([
      caseDe("btp", "tpe", [50, 60, 70, 55, 65, 40], 4, { entreprises: 2, cabinets: 1 }),
    ]);
    expect(publiee(r, "btp", "tpe")).toMatchObject({ statut: "effectif_insuffisant" });
    expect(observatoireCasePubliable(4, 3)).toBe(false);
  });

  it("attaque par différence : les marges ne comptent jamais une case masquée pour l'appelant", () => {
    const r = observatoireAgreger([
      caseDe("commerce", "pme", [50, 60, 70, 55, 65, 40], 3, appelant), // masquée
      caseDe("industrie", "pme", [10, 20, 30, 40, 50, 60, 70], 4, appelant), // publiée
    ]);
    expect(r.marges.par_taille).toHaveLength(1);
    expect(r.marges.ensemble).toMatchObject({ cases_publiees: 1 });
    const seule = observatoireAgreger([
      caseDe("industrie", "pme", [10, 20, 30, 40, 50, 60, 70], 4, appelant),
    ]);
    expect(r.marges).toEqual(seule.marges);
  });

  it.each([
    ["entreprises hors appelant > total", { effectif_entreprises_autres: 99 }],
    ["cabinets hors appelant > total", { effectif_cabinets_autres: 99 }],
    ["cabinets hors appelant > entreprises hors appelant", { effectif_entreprises_autres: 2 }],
    ["effectif hors appelant négatif", { effectif_cabinets_autres: -1 }],
    ["effectif hors appelant non entier", { effectif_entreprises_autres: 4.5 }],
  ])("%s : refusé", (_nom, surcharge) => {
    const ok = caseDe("commerce", "tpe", [50, 50, 50, 50, 50, 50], 3);
    expect(() => observatoireAgreger([{ ...ok, ...surcharge } as ObservatoireCaseBrute])).toThrow(
      expect.objectContaining({ code: "CASE_INVALIDE" }),
    );
  });
});

describe("validation des cases reçues de la fonction SQL", () => {
  const ok = caseDe("commerce", "tpe", [50, 50, 50, 50, 50], 3);
  it.each([
    ["secteur inconnu", { ...ok, secteur: "Banque Atlantique" }, "CASE_INVALIDE"],
    ["taille inconnue", { ...ok, taille: "geante" }, "CASE_INVALIDE"],
    ["effectif non entier", { ...ok, effectif_entreprises: 5.5 }, "CASE_INVALIDE"],
    [
      "effectif nul",
      { ...ok, effectif_entreprises: 0, histogramme: Array(10).fill(0) },
      "CASE_INVALIDE",
    ],
    ["plus de cabinets que d'entreprises", { ...ok, effectif_cabinets: 6 }, "CASE_INVALIDE"],
    ["cabinets négatifs", { ...ok, effectif_cabinets: -1 }, "CASE_INVALIDE"],
    ["histogramme trop court", { ...ok, histogramme: [5] }, "HISTOGRAMME_INVALIDE"],
    [
      "histogramme incohérent",
      { ...ok, histogramme: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      "HISTOGRAMME_INVALIDE",
    ],
    [
      "histogramme négatif",
      { ...ok, histogramme: [6, -1, 0, 0, 0, 0, 0, 0, 0, 0] },
      "HISTOGRAMME_INVALIDE",
    ],
    ["somme non numérique", { ...ok, somme: "abc" }, "SOMME_INVALIDE"],
    ["somme au centième", { ...ok, somme: 250.05 }, "SOMME_INVALIDE"],
    ["somme négative", { ...ok, somme: -1 }, "SOMME_INVALIDE"],
    ["somme > 100 × effectif", { ...ok, somme: 500.1 }, "SOMME_INVALIDE"],
  ])("%s", (_nom, brute, code) => {
    expect(() => observatoireAgreger([brute as ObservatoireCaseBrute])).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it("case en double refusée ; somme numérique acceptée", () => {
    expect(() => observatoireAgreger([ok, ok])).toThrow(
      expect.objectContaining({ code: "CASE_INVALIDE" }),
    );
    expect(publiee(observatoireAgreger([{ ...ok, somme: 250 }]), "commerce", "tpe")).toMatchObject({
      moyenne: 50,
    });
  });
});

describe("préparation des contributions d'un cabinet", () => {
  it("secteur normalisé, taille exigée, score exigé, valeur au dixième, aucun identifiant", () => {
    const p = observatoirePreparerContributions([
      { secteur: "Agro-industrie (cacao)", taille: "pme", valeur: 63.46 },
      { secteur: "BTP", taille: "eti", valeur: 40 },
      { secteur: null, taille: "tpe", valeur: 10 },
      { secteur: "Industrie", taille: null, valeur: 50 },
      { secteur: "Industrie", taille: "pme", valeur: null },
      { secteur: "Industrie", taille: "pme", valeur: Number.NaN },
    ]);
    expect(p).toEqual({
      contributions: [
        { secteur: "agriculture", taille: "pme", valeur: 63.5 },
        { secteur: "btp", taille: "eti", valeur: 40 },
        { secteur: "autres", taille: "tpe", valeur: 10 },
      ],
      sans_taille: 1,
      sans_valeur: 2,
    });
  });

  it("une valeur hors bornes est refusée", () => {
    expect(() =>
      observatoirePreparerContributions([{ secteur: "x", taille: "pme", valeur: 120 }]),
    ).toThrow(ErreurObservatoire);
  });

  it.each([
    ["Services informatiques", "numerique"],
    ["Télécommunications", "numerique"],
    ["Banque et microfinance", "finance"],
    ["Bâtiment et travaux publics", "btp"],
    ["Élevage", "agriculture"],
    ["Énergie", "industrie"],
    ["Négoce", "commerce"],
    ["Santé", "services"],
    ["Hôtellerie", "services"],
    ["commerce", "commerce"],
    ["Œuvres", "autres"],
    ["   ", "autres"],
    [undefined, "autres"],
  ])("« %s » → %s", (texte, code) => {
    expect(observatoireNormaliserSecteur(texte)).toBe(code);
  });

  it("tailles reconnues", () => {
    expect(observatoireEstTaille("grande_entreprise")).toBe(true);
    expect(observatoireEstTaille("GRANDE")).toBe(false);
    expect(observatoireEstTaille(3)).toBe(false);
  });
});
