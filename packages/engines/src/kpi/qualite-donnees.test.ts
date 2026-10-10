import { describe, expect, it } from "vitest";
import { ErreurKpi } from "./erreurs";
import {
  DELAI_GRACE_MAX_JOURS_QUALITE_KPI,
  evaluerQualiteDonneesKpi,
  SEUIL_CORRECTIONS_FREQUENTES_KPI,
  type EntreeQualiteKpi,
  type MotifQualiteKpi,
} from "./qualite-donnees";

function codeErreur(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErreurKpi ? e.code : "AUTRE";
  }
  return undefined;
}

const base: EntreeQualiteKpi = {
  frequence: "mensuelle",
  debutSuivi: "2026-01-01",
  dateReference: "2026-06-15",
  delaiGraceJours: 5,
  mesures: [],
  nombreCorrections: 0,
  nombreLignes: 0,
};

const mois = (valeurs: Record<string, number>) =>
  Object.entries(valeurs).map(([date, valeur]) => ({ date, valeur }));

describe("qualité des données d'un KPI", () => {
  it("données saines : score 100, niveau bon, aucun motif", () => {
    const mesures = mois({
      "2026-01-31": 10,
      "2026-02-28": 11,
      "2026-03-31": 12,
      "2026-04-30": 13,
      "2026-05-31": 14,
    });
    const q = evaluerQualiteDonneesKpi({ ...base, mesures, nombreLignes: 5 });
    expect(q).toMatchObject({
      score: 100,
      niveau: "bon",
      fraicheur: 1,
      completude: 1,
      coherence: 1,
      motifs: [],
    });
    expect(q.details).toMatchObject({
      periodesExigibles: 5,
      periodesMesurees: 5,
      periodesFenetre: 5,
      periodesMesureesFenetre: 5,
      retardPeriodes: 0,
    });
  });

  it("fraîcheur : chaque période exigible sans mesure retire un tiers", () => {
    const mesures = mois({ "2026-01-31": 10, "2026-02-28": 11, "2026-03-31": 12 });
    const q = evaluerQualiteDonneesKpi({ ...base, mesures, nombreLignes: 3 });
    // Périodes exigibles : janvier à mai (juin n'est pas échu) ; dernière mesure en mars : 2 de retard.
    expect(q.details.retardPeriodes).toBe(2);
    expect(q.fraicheur).toBe(0.3333);
    expect(q.completude).toBe(0.6);
    expect(q.coherence).toBe(1);
    expect(q.motifs).toEqual(["MESURE_EN_RETARD", "PERIODES_MANQUANTES"]);
    // (4 × 1/3 + 3 × 3/5 + 3 × 1) / 10 = 0,6133… → 61.
    expect(q.score).toBe(61);
    expect(q.niveau).toBe("moyen");
  });

  it("le délai de grâce retarde l'échéance d'une période", () => {
    const mesures = mois({ "2026-04-30": 10 });
    const sansGrace = evaluerQualiteDonneesKpi({
      ...base,
      dateReference: "2026-05-03",
      delaiGraceJours: 0,
      debutSuivi: "2026-04-01",
      mesures,
      nombreLignes: 1,
    });
    const avecGrace = evaluerQualiteDonneesKpi({
      ...base,
      dateReference: "2026-05-03",
      delaiGraceJours: 5,
      debutSuivi: "2026-04-01",
      mesures,
      nombreLignes: 1,
    });
    expect(sansGrace.details.periodesExigibles).toBe(1);
    expect(avecGrace.details.periodesExigibles).toBe(0);
  });

  it("aucune mesure alors que des périodes sont exigibles : fraîcheur et complétude nulles", () => {
    const q = evaluerQualiteDonneesKpi(base);
    expect(q).toMatchObject({ fraicheur: 0, completude: 0, coherence: null, score: 0 });
    expect(q.niveau).toBe("faible");
    expect(q.motifs).toEqual(["AUCUNE_MESURE", "PERIODES_MANQUANTES"]);
  });

  it("rien d'exigible et aucune mesure : non évaluable", () => {
    const q = evaluerQualiteDonneesKpi({ ...base, dateReference: "2026-01-10" });
    expect(q).toMatchObject({
      score: null,
      niveau: null,
      fraicheur: null,
      completude: null,
      coherence: null,
    });
    expect(q.motifs).toEqual([]);
  });

  it("rien d'exigible mais une mesure déjà saisie : fraîcheur pleine", () => {
    const q = evaluerQualiteDonneesKpi({
      ...base,
      dateReference: "2026-01-20",
      mesures: mois({ "2026-01-10": 5 }),
      nombreLignes: 1,
    });
    expect(q.fraicheur).toBe(1);
    expect(q.completude).toBeNull();
    expect(q.score).toBe(100);
  });

  it("suivi non commencé à la date d'arrêté : non évaluable", () => {
    const q = evaluerQualiteDonneesKpi({ ...base, debutSuivi: "2026-09-01" });
    expect(q.score).toBeNull();
  });

  it("suivi terminé : toutes les périodes jusqu'à la fin sont exigibles", () => {
    const q = evaluerQualiteDonneesKpi({
      ...base,
      finSuivi: "2026-03-15",
      mesures: mois({ "2026-01-31": 1, "2026-02-28": 2, "2026-03-10": 3 }),
      nombreLignes: 3,
    });
    expect(q.details.periodesExigibles).toBe(3);
    expect(q.completude).toBe(1);
    expect(q.fraicheur).toBe(1);
  });

  it("la complétude ne regarde que les douze dernières périodes exigibles", () => {
    const q = evaluerQualiteDonneesKpi({
      ...base,
      debutSuivi: "2024-01-01",
      dateReference: "2026-06-15",
      mesures: mois({ "2026-05-31": 1 }),
      nombreLignes: 1,
    });
    expect(q.details.periodesExigibles).toBe(29);
    expect(q.completude).toBe(0.0833);
    // Tout le suivi d'un côté, la fenêtre de complétude de l'autre : deux noms, deux sens.
    expect(q.details).toMatchObject({
      periodesMesurees: 1,
      periodesFenetre: 12,
      periodesMesureesFenetre: 1,
    });
  });

  it("compte les périodes mesurées hors fenêtre dans le suivi entier", () => {
    const q = evaluerQualiteDonneesKpi({
      ...base,
      debutSuivi: "2024-01-01",
      dateReference: "2026-06-15",
      mesures: mois({ "2024-01-31": 1, "2024-02-29": 2, "2026-05-31": 3 }),
      nombreLignes: 3,
    });
    expect(q.details).toMatchObject({
      periodesExigibles: 29,
      periodesMesurees: 3,
      periodesFenetre: 12,
      periodesMesureesFenetre: 1,
    });
  });

  it("ignore les mesures hors de la période de suivi", () => {
    const q = evaluerQualiteDonneesKpi({
      ...base,
      mesures: mois({ "2025-12-31": 1, "2026-12-31": 2 }),
      nombreLignes: 2,
    });
    expect(q.details.periodesMesurees).toBe(0);
  });

  it("cohérence : valeurs aberrantes et corrections", () => {
    const mesures = mois({
      "2026-01-31": 100,
      "2026-02-28": 102,
      "2026-03-31": 98,
      "2026-04-30": 101,
      "2026-05-31": 99,
      "2026-06-10": 5000,
    });
    const q = evaluerQualiteDonneesKpi({
      ...base,
      mesures,
      nombreLignes: 10,
      nombreCorrections: 2,
    });
    expect(q.details.valeursAberrantes).toEqual([{ date: "2026-06-10", valeur: 5000 }]);
    // 1 aberrante + 2 corrections sur 10 lignes.
    expect(q.coherence).toBe(0.7);
    const motifs: MotifQualiteKpi[] = ["VALEURS_ABERRANTES", "CORRECTIONS_FREQUENTES"];
    expect(q.motifs).toEqual(expect.arrayContaining(motifs));
  });

  it("pas assez de mesures, ou écart absolu médian nul : aucune valeur aberrante", () => {
    const peu = evaluerQualiteDonneesKpi({
      ...base,
      mesures: mois({ "2026-01-31": 1, "2026-02-28": 1000, "2026-03-31": 1 }),
      nombreLignes: 3,
    });
    expect(peu.details.valeursAberrantes).toEqual([]);
    const identiques = evaluerQualiteDonneesKpi({
      ...base,
      mesures: mois({
        "2026-01-31": 5,
        "2026-02-28": 5,
        "2026-03-31": 5,
        "2026-04-30": 5,
        "2026-05-31": 5,
        "2026-06-10": 50,
      }),
      nombreLignes: 6,
    });
    expect(identiques.details.valeursAberrantes).toEqual([]);
  });

  it("médiane d'un nombre pair de mesures", () => {
    const q = evaluerQualiteDonneesKpi({
      ...base,
      dateReference: "2026-08-15",
      mesures: mois({
        "2026-01-31": 100,
        "2026-02-28": 101,
        "2026-03-31": 99,
        "2026-04-30": 100,
        "2026-05-31": 98,
        "2026-06-30": 102,
        "2026-07-10": 9000,
        "2026-07-15": 100,
      }),
      nombreLignes: 8,
    });
    expect(q.details.valeursAberrantes).toEqual([{ date: "2026-07-10", valeur: 9000 }]);
  });

  it("la cohérence ne descend pas sous zéro", () => {
    const q = evaluerQualiteDonneesKpi({
      ...base,
      mesures: mois({ "2026-05-31": 1 }),
      nombreLignes: 3,
      nombreCorrections: 3,
    });
    expect(q.coherence).toBe(0);
  });

  it("refuse des entrées incohérentes", () => {
    expect(codeErreur(() => evaluerQualiteDonneesKpi({ ...base, delaiGraceJours: -1 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(
      codeErreur(() =>
        evaluerQualiteDonneesKpi({ ...base, nombreLignes: 1, nombreCorrections: 2 }),
      ),
    ).toBe("OPTIONS_INVALIDES");
    expect(
      codeErreur(() => evaluerQualiteDonneesKpi({ ...base, dateReference: "2026-13-40" })),
    ).toBe("DATE_INVALIDE");
  });

  it("borne le délai de grâce à 3650 jours", () => {
    const delaiGraceJours = DELAI_GRACE_MAX_JOURS_QUALITE_KPI;
    expect(DELAI_GRACE_MAX_JOURS_QUALITE_KPI).toBe(3650);
    expect(() => evaluerQualiteDonneesKpi({ ...base, delaiGraceJours })).not.toThrow();
    for (const trop of [delaiGraceJours + 1, 1e15, Number.POSITIVE_INFINITY, 1.5]) {
      expect(codeErreur(() => evaluerQualiteDonneesKpi({ ...base, delaiGraceJours: trop }))).toBe(
        "OPTIONS_INVALIDES",
      );
    }
  });

  it("corrections fréquentes : au moins une ligne sur SEUIL_CORRECTIONS_FREQUENTES_KPI", () => {
    const lignes = SEUIL_CORRECTIONS_FREQUENTES_KPI * 2;
    const avec = (nombreCorrections: number) =>
      evaluerQualiteDonneesKpi({
        ...base,
        mesures: mois({ "2026-05-31": 1 }),
        nombreLignes: lignes,
        nombreCorrections,
      }).motifs;
    expect(avec(1)).not.toContain("CORRECTIONS_FREQUENTES");
    expect(avec(2)).toContain("CORRECTIONS_FREQUENTES");
  });

  it("fonctionne pour une fréquence hebdomadaire", () => {
    const q = evaluerQualiteDonneesKpi({
      ...base,
      frequence: "hebdomadaire",
      debutSuivi: "2026-06-01",
      dateReference: "2026-06-30",
      mesures: [
        { date: "2026-06-03", valeur: 1 },
        { date: "2026-06-10", valeur: 2 },
      ],
      nombreLignes: 2,
    });
    expect(q.details.periodesExigibles).toBe(3);
    expect(q.details.retardPeriodes).toBe(1);
  });
});
