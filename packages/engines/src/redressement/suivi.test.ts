import { describe, expect, it } from "vitest";
import { ErreurRedressement } from "./erreurs";
import {
  CLES_RATIO_SUIVI,
  EVENEMENTS_JALON_MAX,
  JALON_PROCHE_JOURS,
  RETARD_ATTENTION_JOURS,
  SEUIL_DEGRADATION_ATTENTION_PB,
  SEUIL_DEGRADATION_INFORMATION_PB,
  calculerEcheancesJalons,
  comparerReleve,
  controlerEvenementJalon,
  evaluerJalon,
  evaluerSuivi,
  formaterPbDecimal,
  libelleJalonParDefaut,
  ratiosSuiviDepuisExercice,
  type JalonSuiviEntree,
} from "./suivi";

const code = (f: () => unknown): string | null => {
  try {
    f();
  } catch (e) {
    return e instanceof ErreurRedressement ? e.code : "AUTRE";
  }
  return null;
};

const jalon = (extra: Partial<JalonSuiviEntree> = {}): JalonSuiviEntree => ({
  id: "j1",
  rang: 1,
  libelle: "Suivi à 6 mois",
  datePrevue: "2027-04-30",
  evenements: [],
  releves: [],
  ...extra,
});

describe("calculerEcheancesJalons", () => {
  it("jalons par défaut à 6 et 12 mois", () => {
    expect(calculerEcheancesJalons("2026-10-31")).toEqual([
      { rang: 1, mois: 6, libelle: "Suivi à 6 mois", datePrevue: "2027-04-30" },
      { rang: 2, mois: 12, libelle: "Suivi à 12 mois", datePrevue: "2027-10-31" },
    ]);
  });

  it("ramène le jour à la fin du mois (année bissextile comprise)", () => {
    expect(calculerEcheancesJalons("2027-08-31", [6])[0]?.datePrevue).toBe("2028-02-29");
    expect(calculerEcheancesJalons("2026-08-31", [6])[0]?.datePrevue).toBe("2027-02-28");
  });

  it("libellés personnalisés", () => {
    const e = calculerEcheancesJalons("2026-01-15", [3, 9], ["Premier point", undefined]);
    expect(e.map((x) => x.libelle)).toEqual(["Premier point", "Suivi à 9 mois"]);
    expect(libelleJalonParDefaut(1)).toBe("Suivi à 1 mois");
  });

  it("refuse les entrées invalides", () => {
    expect(code(() => calculerEcheancesJalons("2026-02-30"))).toBe("DATE_INVALIDE");
    expect(code(() => calculerEcheancesJalons("2026-01-01", []))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerEcheancesJalons("2026-01-01", Array(13).fill(1)))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => calculerEcheancesJalons("2026-01-01", [0]))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerEcheancesJalons("2026-01-01", [61]))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerEcheancesJalons("2026-01-01", [6, 6]))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerEcheancesJalons("2026-01-01", [12, 6]))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerEcheancesJalons("2026-01-01", [1.5]))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerEcheancesJalons("2026-01-01", [6], [""]))).toBe("ENTREE_INVALIDE");
    expect(code(() => calculerEcheancesJalons("2026-01-01", [6], ["x".repeat(121)]))).toBe(
      "ENTREE_INVALIDE",
    );
  });
});

describe("evaluerJalon", () => {
  it("à venir jusqu'au jour prévu inclus, échu le lendemain", () => {
    expect(evaluerJalon(jalon(), "2027-04-30")).toMatchObject({
      statut: "a_venir",
      joursRestants: 0,
      retardJours: 0,
    });
    expect(evaluerJalon(jalon(), "2027-04-29").joursRestants).toBe(1);
    expect(evaluerJalon(jalon(), "2027-05-01")).toMatchObject({ statut: "echu", retardJours: 1 });
  });

  it("un report déplace la date prévue courante", () => {
    const j = jalon({ evenements: [{ type: "reporte", dateEffet: "2027-06-30" }] });
    const e = evaluerJalon(j, "2027-05-15");
    expect(e).toMatchObject({
      statut: "a_venir",
      datePrevueCourante: "2027-06-30",
      nombreReports: 1,
      joursRestants: 46,
    });
  });

  it("un jalon réalisé n'est plus échu", () => {
    const j = jalon({ evenements: [{ type: "realise", dateEffet: "2027-05-10" }] });
    expect(evaluerJalon(j, "2028-01-01")).toMatchObject({
      statut: "realise",
      realiseLe: "2027-05-10",
      retardJours: 0,
    });
  });

  it("refuse une date invalide", () => {
    expect(code(() => evaluerJalon(jalon(), "demain"))).toBe("DATE_INVALIDE");
    expect(code(() => evaluerJalon(jalon({ datePrevue: "2027-13-01" }), "2027-01-01"))).toBe(
      "DATE_INVALIDE",
    );
    expect(
      code(() =>
        evaluerJalon(jalon({ evenements: [{ type: "reporte", dateEffet: "x" }] }), "2027-01-01"),
      ),
    ).toBe("DATE_INVALIDE");
  });
});

describe("controlerEvenementJalon", () => {
  it("accepte un report postérieur et une réalisation après la clôture", () => {
    expect(
      controlerEvenementJalon(jalon(), { type: "reporte", dateEffet: "2027-05-01" }, "2026-10-31"),
    ).toBeNull();
    expect(
      controlerEvenementJalon(jalon(), { type: "realise", dateEffet: "2027-05-01" }, "2026-10-31"),
    ).toBeNull();
  });

  it("refuse un report non postérieur, une réalisation avant la clôture", () => {
    expect(
      controlerEvenementJalon(jalon(), { type: "reporte", dateEffet: "2027-04-30" }, "2026-10-31"),
    ).toBe("report_non_posterieur");
    expect(
      controlerEvenementJalon(jalon(), { type: "realise", dateEffet: "2026-10-30" }, "2026-10-31"),
    ).toBe("realisation_avant_cloture");
  });

  it("refuse tout événement sur un jalon réalisé ou saturé", () => {
    const realise = jalon({ evenements: [{ type: "realise", dateEffet: "2027-05-01" }] });
    expect(
      controlerEvenementJalon(realise, { type: "reporte", dateEffet: "2028-01-01" }, "2026-10-31"),
    ).toBe("jalon_deja_realise");
    const plein = jalon({
      evenements: Array.from({ length: EVENEMENTS_JALON_MAX }, (_, i) => ({
        type: "reporte" as const,
        dateEffet: `2027-0${i + 5 > 9 ? 9 : i + 5}-01`,
      })),
    });
    expect(
      controlerEvenementJalon(plein, { type: "reporte", dateEffet: "2030-01-01" }, "2026-10-31"),
    ).toBe("trop_d_evenements");
  });
});

describe("comparerReleve", () => {
  it("variation signée et sens, selon le sens favorable de chaque ratio", () => {
    const c = comparerReleve(
      { liquidite_generale: 13_636, endettement: 13_333, marge_brute: 3_500 },
      { liquidite_generale: 12_000, endettement: 11_000, marge_brute: 3_500, marge_nette: 10 },
    );
    expect(c.map((x) => [x.cle, x.variationPb, x.sens, x.gravite])).toEqual([
      ["liquidite_generale", -1_636, "degradation", "attention"],
      ["endettement", -2_333, "amelioration", null],
      ["marge_brute", 0, "stable", null],
    ]);
  });

  it("une hausse de l'endettement se dégrade ; seuils information puis attention", () => {
    const base = { endettement: 10_000 };
    const g = (variation: number) =>
      comparerReleve(base, { endettement: 10_000 + variation })[0]?.gravite;
    expect(g(SEUIL_DEGRADATION_INFORMATION_PB - 1)).toBeNull();
    expect(g(SEUIL_DEGRADATION_INFORMATION_PB)).toBe("information");
    expect(g(SEUIL_DEGRADATION_ATTENTION_PB - 1)).toBe("information");
    expect(g(SEUIL_DEGRADATION_ATTENTION_PB)).toBe("attention");
  });

  it("refuse un ratio inconnu ou une valeur hors bornes", () => {
    expect(code(() => comparerReleve({}, { bfr_jours: 5 } as never))).toBe("ENTREE_INVALIDE");
    expect(code(() => comparerReleve({ marge_brute: 1.5 }, {}))).toBe("ENTREE_INVALIDE");
    expect(code(() => comparerReleve({}, { marge_brute: 200_000_000 }))).toBe("ENTREE_INVALIDE");
  });
});

describe("evaluerSuivi", () => {
  const reference = { liquidite_generale: 13_636, endettement: 10_000 };

  it("retard : information puis attention à partir du seuil, libellés français", () => {
    const r = evaluerSuivi({
      dateReference: "2027-05-10",
      jalons: [jalon()],
      referenceRatios: reference,
    });
    expect(r.alertes).toHaveLength(1);
    expect(r.alertes[0]).toMatchObject({ type: "jalon_echu", gravite: "information" });
    expect(r.alertes[0]?.libelle).toBe(
      "Le jalon « Suivi à 6 mois » est échu depuis 10 jours et n'est pas marqué réalisé.",
    );
    const tard = evaluerSuivi({
      dateReference: "2027-05-31",
      jalons: [jalon()],
      referenceRatios: reference,
    });
    expect(tard.alertes[0]).toMatchObject({ gravite: "attention" });
    expect(31 >= RETARD_ATTENTION_JOURS).toBe(true);
    const un = evaluerSuivi({
      dateReference: "2027-05-01",
      jalons: [jalon()],
      referenceRatios: reference,
    });
    expect(un.alertes[0]?.libelle).toContain("depuis 1 jour et");
  });

  it("jalon proche, jalon réalisé sans relevé, rien sinon", () => {
    const proche = evaluerSuivi({
      dateReference: "2027-04-15",
      jalons: [jalon()],
      referenceRatios: {},
    });
    expect(proche.alertes[0]).toMatchObject({ type: "jalon_proche", gravite: "information" });
    expect(proche.alertes[0]?.libelle).toContain("dans 15 jours");
    expect(JALON_PROCHE_JOURS).toBe(15);
    const loin = evaluerSuivi({
      dateReference: "2027-01-01",
      jalons: [jalon()],
      referenceRatios: {},
    });
    expect(loin.alertes).toEqual([]);
    const realise = jalon({ evenements: [{ type: "realise", dateEffet: "2027-04-20" }] });
    const sans = evaluerSuivi({
      dateReference: "2027-05-01",
      jalons: [realise],
      referenceRatios: {},
    });
    expect(sans.alertes[0]).toMatchObject({ type: "jalon_sans_releve" });
    const avec = evaluerSuivi({
      dateReference: "2027-05-01",
      jalons: [
        {
          ...realise,
          releves: [{ id: "r1", dateReleve: "2027-04-25", ratios: { endettement: 10_000 } }],
        },
      ],
      referenceRatios: reference,
    });
    expect(avec.alertes).toEqual([]);
  });

  it("dégradation du dernier relevé, triée par gravité, jalon, type et ratio", () => {
    const j1 = jalon({
      evenements: [{ type: "realise", dateEffet: "2027-04-20" }],
      releves: [
        { id: "r1", dateReleve: "2027-04-01", ratios: { liquidite_generale: 1 } },
        {
          id: "r2",
          dateReleve: "2027-04-25",
          ratios: { liquidite_generale: 13_636 - 600, endettement: 10_000 + 1_500 },
        },
      ],
    });
    const j2 = jalon({
      id: "j2",
      rang: 2,
      libelle: "Suivi à 12 mois",
      datePrevue: "2027-10-31",
      releves: [
        { id: "r3", dateReleve: "2027-04-25", ratios: { liquidite_generale: 13_636 - 2_000 } },
      ],
    });
    const r = evaluerSuivi({
      dateReference: "2027-05-01",
      jalons: [j2, j1],
      referenceRatios: reference,
    });
    expect(r.alertes.map((a) => [a.gravite, a.jalonRang, a.type, a.ratio])).toEqual([
      ["attention", 1, "degradation_ratio", "endettement"],
      ["attention", 2, "degradation_ratio", "liquidite_generale"],
      ["information", 1, "degradation_ratio", "liquidite_generale"],
    ]);
    expect(r.synthese).toEqual({ nombre: 3, attention: 2, information: 1 });
    expect(r.jalons.map((j) => [j.id, j.dernierReleveId])).toEqual([
      ["j1", "r2"],
      ["j2", "r3"],
    ]);
    expect(r.alertes[0]?.libelle).toBe(
      "Endettement : 1,15 au relevé du jalon « Suivi à 6 mois », contre 1,00 à la clôture (écart défavorable de 0,15).",
    );
  });

  it("à date de relevé égale, le plus récemment enregistré l'emporte ; sans référence, pas de comparaison", () => {
    const j = jalon({
      releves: [
        { id: "a", dateReleve: "2027-04-01", ratios: { endettement: 99_999 } },
        { id: "b", dateReleve: "2027-04-01", ratios: { endettement: 10_000 } },
      ],
    });
    const r = evaluerSuivi({
      dateReference: "2027-01-01",
      jalons: [j],
      referenceRatios: reference,
    });
    expect(r.jalons[0]?.dernierReleveId).toBe("b");
    expect(r.alertes).toEqual([]);
    const sansRef = evaluerSuivi({ dateReference: "2027-01-01", jalons: [j], referenceRatios: {} });
    expect(sansRef.jalons[0]?.comparaisons).toEqual([]);
  });

  it("refuse une date de référence invalide ; est déterministe", () => {
    expect(
      code(() => evaluerSuivi({ dateReference: "2027-02-30", jalons: [], referenceRatios: {} })),
    ).toBe("DATE_INVALIDE");
    const entree = { dateReference: "2027-06-01", jalons: [jalon()], referenceRatios: reference };
    expect(evaluerSuivi(entree)).toEqual(evaluerSuivi(entree));
  });
});

describe("formaterPbDecimal et ratiosSuiviDepuisExercice", () => {
  it("formate au centième", () => {
    expect(formaterPbDecimal(13_636)).toBe("1,36");
    expect(formaterPbDecimal(-1_636)).toBe("-0,16");
    expect(formaterPbDecimal(0)).toBe("0,00");
    expect(formaterPbDecimal(-40)).toBe("0,00");
    expect(formaterPbDecimal(50)).toBe("0,01");
  });

  it("ne garde que les ratios calculés, hors BFR", () => {
    const r = ratiosSuiviDepuisExercice({
      liquidite_generale: { valeur: 13_636 },
      liquidite_reduite: { valeur: null },
      bfr_jours: { valeur: 54 },
      marge_brute: { valeur: 3_500 },
    });
    expect(r).toEqual({ liquidite_generale: 13_636, marge_brute: 3_500 });
    expect(CLES_RATIO_SUIVI).toHaveLength(9);
  });
});
