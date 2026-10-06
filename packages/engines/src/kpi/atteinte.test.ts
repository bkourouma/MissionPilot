import { describe, expect, it } from "vitest";
import {
  SEUILS_STATUT_KPI_DEFAUT,
  ecartCibleKpi,
  evaluerKpi,
  rangStatutKpi,
  statutKpiDepuisTaux,
  tauxAtteinteKpi,
  type SensLectureKpi,
  type StatutKpiMesure,
} from "./atteinte";
import { ErreurKpi } from "./erreurs";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

function statut(valeur: number, cible: number, sens: SensLectureKpi): string {
  return evaluerKpi({ valeur, cible, sens }).statut;
}

describe("taux d'atteinte et statut aux bornes exactes (KPI-03)", () => {
  const cas: ReadonlyArray<[SensLectureKpi, number, number, number, StatutKpiMesure]> = [
    // sens, cible, valeur, taux attendu, statut attendu
    ["plus_haut_mieux", 100, 100, 1, "vert"],
    ["plus_haut_mieux", 100, 120, 1.2, "vert"],
    ["plus_haut_mieux", 100, 95, 0.95, "vert"],
    ["plus_haut_mieux", 100, 94.99, 0.9499, "orange"],
    ["plus_haut_mieux", 100, 80, 0.8, "orange"],
    ["plus_haut_mieux", 100, 79.99, 0.7999, "rouge"],
    ["plus_haut_mieux", 100, 0, 0, "rouge"],
    ["plus_haut_mieux", 100, -20, -0.2, "rouge"],
    ["plus_bas_mieux", 100, 100, 1, "vert"],
    ["plus_bas_mieux", 100, 50, 1.5, "vert"],
    ["plus_bas_mieux", 100, 0, 2, "vert"],
    ["plus_bas_mieux", 100, 105, 0.95, "vert"],
    ["plus_bas_mieux", 100, 105.01, 0.9499, "orange"],
    ["plus_bas_mieux", 100, 120, 0.8, "orange"],
    ["plus_bas_mieux", 100, 120.01, 0.7999, "rouge"],
    ["plus_bas_mieux", 100, 200, 0, "rouge"],
    ["plus_bas_mieux", 100, 250, -0.5, "rouge"],
    // Cible négative (perte maximale tolérée) : même lecture « à 5 % près ».
    ["plus_haut_mieux", -100, -105, 0.95, "vert"],
    ["plus_haut_mieux", -100, -120, 0.8, "orange"],
    ["plus_haut_mieux", -100, -120.01, 0.7999, "rouge"],
    ["plus_haut_mieux", -100, -50, 1.5, "vert"],
    ["plus_haut_mieux", -100, 0, 2, "vert"],
    ["plus_bas_mieux", -100, -95, 0.95, "vert"],
    ["plus_bas_mieux", -100, -80, 0.8, "orange"],
    // Pas de bruit flottant : 0,285 / 0,3 vaut exactement 0,95.
    ["plus_haut_mieux", 0.3, 0.285, 0.95, "vert"],
    ["plus_bas_mieux", 0.3, 0.315, 0.95, "vert"],
    ["plus_haut_mieux", 0.3, 0.24, 0.8, "orange"],
  ];

  it.each(cas)("%s, cible %d, valeur %d → %d (%s)", (sens, cible, valeur, taux, attendu) => {
    expect(tauxAtteinteKpi(valeur, cible, sens).taux).toBe(taux);
    expect(statut(valeur, cible, sens)).toBe(attendu);
  });

  it("trace le taux exact et le mode relatif", () => {
    expect(tauxAtteinteKpi(1, 3, "plus_haut_mieux")).toEqual({
      taux: 0.3333,
      tauxExact: "1/3",
      tauxBrutExact: "1/3",
      mode: "relatif",
      borne: null,
    });
  });

  it("cible nulle : atteinte binaire, vert ou rouge, jamais orange", () => {
    expect(tauxAtteinteKpi(0, 0, "plus_haut_mieux")).toMatchObject({ taux: 1, mode: "binaire" });
    expect(tauxAtteinteKpi(5, 0, "plus_haut_mieux").taux).toBe(1);
    expect(tauxAtteinteKpi(-0.01, 0, "plus_haut_mieux").taux).toBe(0);
    expect(tauxAtteinteKpi(0, 0, "plus_bas_mieux").taux).toBe(1);
    expect(tauxAtteinteKpi(-2, 0, "plus_bas_mieux").taux).toBe(1);
    expect(tauxAtteinteKpi(3, 0, "plus_bas_mieux").taux).toBe(0);
    expect(statut(0, 0, "plus_bas_mieux")).toBe("vert");
    expect(statut(1, 0, "plus_bas_mieux")).toBe("rouge");
  });

  it("plafonne ou non le dépassement, sans changer le statut", () => {
    expect(tauxAtteinteKpi(150, 100, "plus_haut_mieux").taux).toBe(1.5);
    expect(tauxAtteinteKpi(150, 100, "plus_haut_mieux", { plafond: null }).taux).toBe(1.5);
    const plafonne = tauxAtteinteKpi(150, 100, "plus_haut_mieux", { plafond: 1.2 });
    expect(plafonne).toMatchObject({ taux: 1.2, tauxExact: "6/5", tauxBrutExact: "3/2" });
    expect(plafonne.borne).toBe("plafond");
    expect(tauxAtteinteKpi(110, 100, "plus_haut_mieux", { plafond: 1.2 }).borne).toBeNull();
    const plancher = evaluerKpi(
      { valeur: -20, cible: 100, sens: "plus_haut_mieux" },
      { plancher: 0, seuils: { vert: 0.95, orange: 0 } },
    );
    // Le plancher borne le taux affiché, mais le statut se lit sur le taux brut (−0,2).
    expect(plancher.atteinte).toMatchObject({ taux: 0, borne: "plancher", tauxBrutExact: "-1/5" });
    expect(plancher.statut).toBe("rouge");
  });

  it("refuse des bornes incohérentes", () => {
    expect(codeErreur(() => tauxAtteinteKpi(1, 1, "plus_haut_mieux", { plafond: 0.9 }))).toBe(
      "BORNES_INVALIDES",
    );
    expect(codeErreur(() => tauxAtteinteKpi(1, 1, "plus_haut_mieux", { plancher: 0.1 }))).toBe(
      "BORNES_INVALIDES",
    );
    expect(codeErreur(() => tauxAtteinteKpi(1, 1, "plus_haut_mieux", { plafond: 1 }))).toBe(
      undefined,
    );
  });

  it("refuse une valeur ou une cible non finie", () => {
    expect(codeErreur(() => tauxAtteinteKpi(Number.NaN, 1, "plus_haut_mieux"))).toBe(
      "NOMBRE_INVALIDE",
    );
    expect(codeErreur(() => tauxAtteinteKpi(1, Infinity, "plus_haut_mieux"))).toBe(
      "NOMBRE_INVALIDE",
    );
  });
});

describe("seuils paramétrables", () => {
  it("expose les seuils par défaut 95 % / 80 %", () => {
    expect(SEUILS_STATUT_KPI_DEFAUT).toEqual({ vert: 0.95, orange: 0.8 });
  });

  it("applique des seuils propres au cabinet, bornes incluses", () => {
    const seuils = { vert: 0.9, orange: 0.7 };
    expect(statutKpiDepuisTaux(0.9, seuils)).toBe("vert");
    expect(statutKpiDepuisTaux(0.8999, seuils)).toBe("orange");
    expect(statutKpiDepuisTaux(0.7, seuils)).toBe("orange");
    expect(statutKpiDepuisTaux(0.6999, seuils)).toBe("rouge");
    expect(statutKpiDepuisTaux(0.95)).toBe("vert");
    expect(statutKpiDepuisTaux(0.9499)).toBe("orange");
    expect(statutKpiDepuisTaux(0.8)).toBe("orange");
    expect(statutKpiDepuisTaux(0.7999)).toBe("rouge");
    expect(evaluerKpi({ valeur: 90, cible: 100, sens: "plus_haut_mieux" }, { seuils }).statut).toBe(
      "vert",
    );
  });

  it.each([
    [{ vert: 0.8, orange: 0.95 }],
    [{ vert: 0.9, orange: 0.9 }],
    [{ vert: 1.1, orange: 0.8 }],
    [{ vert: 0.95, orange: -0.1 }],
  ])("refuse des seuils incohérents %j", (seuils) => {
    expect(codeErreur(() => statutKpiDepuisTaux(0.5, seuils))).toBe("SEUILS_INVALIDES");
    expect(
      codeErreur(() => evaluerKpi({ valeur: null, cible: 1, sens: "plus_haut_mieux" }, { seuils })),
    ).toBe("SEUILS_INVALIDES");
  });

  it("admet orange = 0 et vert = 1", () => {
    expect(statutKpiDepuisTaux(0, { vert: 1, orange: 0 })).toBe("orange");
    expect(statutKpiDepuisTaux(1, { vert: 1, orange: 0 })).toBe("vert");
    expect(statutKpiDepuisTaux(-0.0001, { vert: 1, orange: 0 })).toBe("rouge");
  });

  it("ordonne les statuts", () => {
    expect(rangStatutKpi("rouge")).toBeLessThan(rangStatutKpi("orange"));
    expect(rangStatutKpi("orange")).toBeLessThan(rangStatutKpi("vert"));
  });
});

describe("statut non mesuré et sans cible", () => {
  it("sans valeur : non mesuré, même sans cible", () => {
    for (const valeur of [null, undefined]) {
      expect(evaluerKpi({ valeur, cible: 100, sens: "plus_haut_mieux" })).toEqual({
        statut: "non_mesure",
        atteinte: null,
        ecart: null,
      });
    }
    expect(evaluerKpi({ valeur: null, cible: null, sens: "plus_bas_mieux" }).statut).toBe(
      "non_mesure",
    );
  });

  it("une valeur nulle (0) est une mesure", () => {
    expect(evaluerKpi({ valeur: 0, cible: 100, sens: "plus_haut_mieux" }).statut).toBe("rouge");
  });

  it("valeur sans cible : sans cible", () => {
    expect(evaluerKpi({ valeur: 12, cible: undefined, sens: "plus_haut_mieux" }).statut).toBe(
      "sans_cible",
    );
  });

  it("évaluation complète : statut, atteinte et écart", () => {
    expect(evaluerKpi({ valeur: 90, cible: 100, sens: "plus_haut_mieux" })).toEqual({
      statut: "orange",
      atteinte: {
        taux: 0.9,
        tauxExact: "9/10",
        tauxBrutExact: "9/10",
        mode: "relatif",
        borne: null,
      },
      ecart: {
        ecart: -10,
        ecartExact: "-10",
        ecartRelatif: -0.1,
        ecartOriente: -10,
        cibleAtteinte: false,
      },
    });
  });
});

describe("écart à la cible", () => {
  it("brut, relatif et orienté selon le sens", () => {
    expect(ecartCibleKpi(90, 100, "plus_bas_mieux")).toEqual({
      ecart: -10,
      ecartExact: "-10",
      ecartRelatif: -0.1,
      ecartOriente: 10,
      cibleAtteinte: true,
    });
    expect(ecartCibleKpi(1, 3, "plus_haut_mieux")).toMatchObject({
      ecart: -2,
      ecartRelatif: -0.6667,
      cibleAtteinte: false,
    });
    expect(ecartCibleKpi(-120, -100, "plus_haut_mieux")).toMatchObject({
      ecart: -20,
      ecartRelatif: -0.2,
      ecartOriente: -20,
    });
  });

  it("cible atteinte pile : écart nul, atteinte vraie dans les deux sens", () => {
    expect(ecartCibleKpi(100, 100, "plus_haut_mieux")).toMatchObject({
      ecart: 0,
      cibleAtteinte: true,
    });
    expect(ecartCibleKpi(100, 100, "plus_bas_mieux")).toMatchObject({
      ecartOriente: 0,
      cibleAtteinte: true,
    });
  });

  it("cible nulle : pas d'écart relatif", () => {
    expect(ecartCibleKpi(3, 0, "plus_bas_mieux")).toMatchObject({
      ecart: 3,
      ecartRelatif: null,
      cibleAtteinte: false,
    });
  });

  it("arrondit l'écart à 4 décimales et garde l'exact", () => {
    expect(ecartCibleKpi(0.1, 0.2 / 3, "plus_haut_mieux").ecart).toBe(0.0333);
    expect(ecartCibleKpi(0.3, 0.1, "plus_haut_mieux")).toMatchObject({
      ecart: 0.2,
      ecartExact: "1/5",
    });
  });
});

describe("propriétés", () => {
  const cibles = [100, -100, 0, 0.3, 7, -0.5];
  const valeurs = Array.from({ length: 1201 }, (_, i) => -300 + i * 0.5);

  it("le statut est monotone : croissant en « plus haut », décroissant en « plus bas »", () => {
    for (const cible of cibles) {
      for (const sens of ["plus_haut_mieux", "plus_bas_mieux"] as const) {
        const rangs = valeurs.map((v) =>
          rangStatutKpi(evaluerKpi({ valeur: v, cible, sens }).statut as StatutKpiMesure),
        );
        for (let i = 1; i < rangs.length; i++) {
          const d = (rangs[i] as number) - (rangs[i - 1] as number);
          expect(sens === "plus_haut_mieux" ? d >= 0 : d <= 0).toBe(true);
        }
      }
    }
  });

  it("le taux est monotone et vaut 1 à la cible", () => {
    for (const cible of cibles) {
      expect(tauxAtteinteKpi(cible, cible, "plus_haut_mieux").taux).toBe(1);
      expect(tauxAtteinteKpi(cible, cible, "plus_bas_mieux").taux).toBe(1);
      const taux = valeurs.map((v) => tauxAtteinteKpi(v, cible, "plus_haut_mieux").taux);
      for (let i = 1; i < taux.length; i++) {
        expect(taux[i] as number).toBeGreaterThanOrEqual(taux[i - 1] as number);
      }
    }
  });

  it("les deux sens sont symétriques autour de la cible (cible non nulle)", () => {
    for (const cible of cibles.filter((c) => c !== 0)) {
      for (const v of valeurs) {
        const haut = tauxAtteinteKpi(v, cible, "plus_haut_mieux").taux;
        const bas = tauxAtteinteKpi(v, cible, "plus_bas_mieux").taux;
        expect(Math.round((haut + bas) * 10_000)).toBe(20_000);
      }
    }
  });

  it("est déterministe", () => {
    const a = evaluerKpi({ valeur: 87.35, cible: 91.2, sens: "plus_haut_mieux" });
    const b = evaluerKpi({ valeur: 87.35, cible: 91.2, sens: "plus_haut_mieux" });
    expect(a).toEqual(b);
  });
});
