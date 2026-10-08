import { describe, expect, it } from "vitest";
import {
  anneesDansSecteur,
  anneesExperience,
  controlerCv,
  ErreurCv,
  moisExperience,
  normaliserLibelle,
  rangMois,
  type ContenuCvControle,
  type ExperienceCv,
} from "./index";

const exp = (
  debut: string,
  fin: string | null,
  secteurs: string[] = [],
  bailleur: string | null = null,
): ExperienceCv => ({ debut, fin, secteurs, bailleur });

describe("mois et libellés", () => {
  it("rang d'un mois et refus des mois invalides", () => {
    expect(rangMois("2020-01") - rangMois("2019-12")).toBe(1);
    for (const m of ["2020-13", "2020-00", "1949-05", "2101-01", "2020-1", "abc"]) {
      expect(() => rangMois(m)).toThrow(ErreurCv);
    }
  });

  it("normalise sans casse ni accents", () => {
    expect(normaliserLibelle("  Énergie   Électrique ")).toBe("energie electrique");
  });
});

describe("années d'expérience", () => {
  it("compte les mois distincts : les chevauchements ne comptent pas double", () => {
    const e = [exp("2015-01", "2017-12"), exp("2017-01", "2019-12")];
    expect(moisExperience(e, "2026-10")).toBe(60);
    expect(anneesExperience(e, "2026-10")).toBe(5);
  });

  it("deux périodes contiguës se fusionnent ; un trou n'est pas compté", () => {
    expect(moisExperience([exp("2020-01", "2020-06"), exp("2020-07", "2020-12")], "2026-01")).toBe(
      12,
    );
    expect(moisExperience([exp("2020-01", "2020-06"), exp("2021-01", "2021-06")], "2026-01")).toBe(
      12,
    );
  });

  it("une expérience en cours court jusqu'à la référence ; le futur est écarté", () => {
    expect(moisExperience([exp("2026-01", null)], "2026-10")).toBe(10);
    expect(moisExperience([exp("2027-01", "2027-06")], "2026-10")).toBe(0);
    expect(moisExperience([exp("2026-05", "2027-06")], "2026-10")).toBe(6);
  });

  it("années complètes seulement : 59 mois font 4 ans", () => {
    expect(anneesExperience([exp("2020-01", "2024-11")], "2026-10")).toBe(4);
    expect(anneesExperience([], "2026-10")).toBe(0);
  });

  it("refuse une expérience terminée avant son début", () => {
    expect(() => moisExperience([exp("2020-05", "2020-01")], "2026-10")).toThrow(
      expect.objectContaining({ code: "PERIODE_INVALIDE" }),
    );
  });

  it("années par secteur, sans casse ni accents", () => {
    const e = [exp("2010-01", "2014-12", ["Énergie"]), exp("2015-01", "2016-12", ["Santé"])];
    expect(anneesDansSecteur(e, "energie", "2026-10")).toBe(5);
    expect(anneesDansSecteur(e, "SANTE", "2026-10")).toBe(2);
    expect(anneesDansSecteur(e, "Agriculture", "2026-10")).toBe(0);
  });
});

const CV: ContenuCvControle = {
  experiences: [
    exp("2012-01", "2018-12", ["Finances publiques"], "Banque mondiale"),
    exp("2019-01", null, ["Gouvernance"], "BAD"),
    exp("2020-01", "2021-12", ["Gouvernance"], "banque mondiale"),
  ],
  diplomes: [
    { niveau: "bac_3", domaine: "Économie" },
    { niveau: "bac_5", domaine: "Gestion publique" },
  ],
  langues: [
    { langue: "Français", niveau: "maternelle" },
    { langue: "Anglais", niveau: "courant" },
  ],
};

describe("contrôle d'un CV contre les exigences", () => {
  it("conforme quand tous les critères le sont", () => {
    const r = controlerCv(
      CV,
      {
        anneesMin: 10,
        anneesParSecteur: [{ secteur: "gouvernance", annees: 5 }],
        niveauDiplomeMin: "bac_5",
        domainesDiplome: ["gestion publique", "Droit"],
        langues: [{ langue: "anglais", niveauMin: "courant" }],
        experiencesBailleur: [{ bailleur: "Banque Mondiale", nombreMin: 2 }],
      },
      "2026-10",
    );
    expect(r.anneesExperience).toBe(14);
    expect(r.conforme).toBe(true);
    expect(r.criteres.map((c) => c.code)).toEqual([
      "annees_experience",
      "annees_secteur",
      "diplome",
      "langue",
      "experiences_bailleur",
    ]);
    expect(r.criteres[2]).toMatchObject({ constate: "bac_5 (Gestion publique)", conforme: true });
  });

  it("signale chaque critère non tenu avec ce qui est constaté", () => {
    const r = controlerCv(
      CV,
      {
        anneesMin: 15,
        anneesParSecteur: [{ secteur: "Santé", annees: 1 }],
        niveauDiplomeMin: "doctorat",
        langues: [
          { langue: "Anglais", niveauMin: "bilingue" },
          { langue: "Portugais", niveauMin: "notions" },
        ],
        experiencesBailleur: [{ bailleur: "Union européenne", nombreMin: 1 }],
      },
      "2026-10",
    );
    expect(r.conforme).toBe(false);
    expect(r.criteres.every((c) => !c.conforme)).toBe(true);
    expect(r.criteres.find((c) => c.code === "diplome")).toMatchObject({
      constate: "bac_5",
      objet: null,
    });
    expect(r.criteres.find((c) => c.objet === "Portugais")?.constate).toBe("non déclarée");
  });

  it("domaine exigé absent : non conforme même avec un niveau suffisant", () => {
    const r = controlerCv(
      CV,
      { niveauDiplomeMin: "bac_3", domainesDiplome: ["Médecine"] },
      "2026-10",
    );
    expect(r.criteres[0]).toMatchObject({ conforme: false, objet: "Médecine" });
  });

  it("sans diplôme ni exigence : conforme, aucun critère", () => {
    const vide = { experiences: [], diplomes: [], langues: [] };
    expect(controlerCv(vide, {}, "2026-10")).toEqual({
      conforme: true,
      anneesExperience: 0,
      criteres: [],
    });
    expect(controlerCv(vide, { niveauDiplomeMin: "bac" }, "2026-10").criteres[0]?.constate).toBe(
      "aucun diplôme",
    );
  });

  it("refuse un niveau de diplôme exigé inconnu (jamais « tout diplôme conforme »)", () => {
    expect(() => controlerCv(CV, { niveauDiplomeMin: "licence" as never }, "2026-10")).toThrow(
      expect.objectContaining({ code: "EXIGENCE_INVALIDE" }),
    );
  });

  it("refuse une exigence hors bornes", () => {
    expect(() => controlerCv(CV, { anneesMin: -1 }, "2026-10")).toThrow(ErreurCv);
    expect(() => controlerCv(CV, { anneesMin: 2.5 }, "2026-10")).toThrow(ErreurCv);
    expect(() =>
      controlerCv(CV, { anneesParSecteur: [{ secteur: "x", annees: 61 }] }, "2026-10"),
    ).toThrow(ErreurCv);
    expect(() =>
      controlerCv(CV, { experiencesBailleur: [{ bailleur: "x", nombreMin: -2 }] }, "2026-10"),
    ).toThrow(expect.objectContaining({ code: "EXIGENCE_INVALIDE" }));
  });
});
