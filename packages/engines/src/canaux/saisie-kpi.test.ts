import { describe, expect, it } from "vitest";
import {
  analyserSaisieKpi,
  ErreurCanaux,
  evaluerVraisemblance,
  HISTORIQUE_MIN,
  K_MAD,
  POINTS_MIN_MAD,
  renforcerPourVocal,
  SEUIL_ORDRE_GRANDEUR,
} from "./index";

const KPIS = [
  { id: "k1", libelle: "Chiffre d'affaires mensuel" },
  { id: "k2", libelle: "Taux de rotation du personnel" },
  { id: "k3", libelle: "Taux de satisfaction client" },
];

describe("analyserSaisieKpi (SPEC §18.2, S-01 à S-11)", () => {
  it("S-01 : « affaires 125 000 000 »", () => {
    expect(analyserSaisieKpi("affaires 125 000 000", KPIS)).toEqual({
      statut: "ok",
      kpiId: "k1",
      valeur: "125000000",
    });
  });

  it("S-02 : le mot « kpi » est retiré", () => {
    expect(analyserSaisieKpi("kpi affaires mensuel 125000000", KPIS)).toEqual({
      statut: "ok",
      kpiId: "k1",
      valeur: "125000000",
    });
  });

  it("S-03 : « taux 12,5 » est ambigu, propositions triées par libellé", () => {
    expect(analyserSaisieKpi("taux 12,5", KPIS)).toEqual({
      statut: "erreur",
      code: "KPI_AMBIGU",
      propositions: ["k2", "k3"],
    });
    // Les propositions sont triées par libellé, pas par ordre de la liste fournie.
    expect(analyserSaisieKpi("taux 12,5", [...KPIS].reverse())).toMatchObject({
      propositions: ["k2", "k3"],
    });
  });

  it("S-04 : « taux rotation 8,5% » donne 8.5 avec le suffixe %", () => {
    expect(analyserSaisieKpi("taux rotation 8,5%", KPIS)).toEqual({
      statut: "ok",
      kpiId: "k2",
      valeur: "8.5",
      suffixe: "%",
    });
    expect(analyserSaisieKpi("taux rotation 8,5 %", KPIS)).toMatchObject({
      valeur: "8.5",
      suffixe: "%",
    });
  });

  it("S-05 : « satisfaction 1,250 » est ambigu (séparateur unique suivi de trois chiffres)", () => {
    expect(analyserSaisieKpi("satisfaction 1,250", KPIS)).toEqual({
      statut: "erreur",
      code: "VALEUR_AMBIGUE",
    });
    expect(analyserSaisieKpi("satisfaction 1.250", KPIS)).toMatchObject({ code: "VALEUR_AMBIGUE" });
  });

  it("S-06 : « affaires 0,125 » n'est pas ambigu quand la partie entière est 0", () => {
    expect(analyserSaisieKpi("affaires 0,125", KPIS)).toMatchObject({
      kpiId: "k1",
      valeur: "0.125",
    });
  });

  it("S-07 : si les deux séparateurs apparaissent, le dernier est décimal", () => {
    expect(analyserSaisieKpi("affaires 1.250,75", KPIS)).toMatchObject({ valeur: "1250.75" });
    expect(analyserSaisieKpi("affaires 1,250.75", KPIS)).toMatchObject({ valeur: "1250.75" });
  });

  it("S-08 : « affaires » seul, valeur absente", () => {
    expect(analyserSaisieKpi("affaires", KPIS)).toEqual({
      statut: "erreur",
      code: "VALEUR_ABSENTE",
    });
    expect(analyserSaisieKpi("", KPIS)).toMatchObject({ code: "VALEUR_ABSENTE" });
  });

  it("S-09 : « CA mensuel 125000000 », KPI inconnu", () => {
    expect(analyserSaisieKpi("CA mensuel 125000000", KPIS)).toEqual({
      statut: "erreur",
      code: "KPI_INCONNU",
    });
  });

  it("S-10 : 10^15 est hors bornes", () => {
    expect(analyserSaisieKpi("affaires 1 000 000 000 000 000", KPIS)).toEqual({
      statut: "erreur",
      code: "VALEUR_HORS_BORNES",
    });
    expect(analyserSaisieKpi("affaires 999 999 999 999 999", KPIS)).toMatchObject({
      valeur: "999999999999999",
    });
    // Plus de six décimales.
    expect(analyserSaisieKpi("affaires 1,1234567", KPIS)).toMatchObject({
      code: "VALEUR_HORS_BORNES",
    });
  });

  it("S-11 : valeur signée", () => {
    expect(analyserSaisieKpi("affaires -5", KPIS)).toMatchObject({ kpiId: "k1", valeur: "-5" });
    expect(analyserSaisieKpi("affaires +5", KPIS)).toMatchObject({ valeur: "5" });
    expect(analyserSaisieKpi("affaires -0", KPIS)).toMatchObject({ valeur: "0" });
  });

  it("normalise les zéros, accents, casse, ponctuation de bord et espaces insécables", () => {
    expect(analyserSaisieKpi("Chiffre d’affaires : 007,50.", KPIS)).toMatchObject({
      kpiId: "k1",
      valeur: "7.5",
    });
    expect(analyserSaisieKpi("affaires 125 000", KPIS)).toMatchObject({ valeur: "125000" });
    expect(analyserSaisieKpi("AFFAIRES 12,50", KPIS)).toMatchObject({ valeur: "12.5" });
    expect(analyserSaisieKpi("affaires 1,250,000", KPIS)).toMatchObject({ valeur: "1250000" });
    expect(analyserSaisieKpi("affaires 1.250.000", KPIS)).toMatchObject({ valeur: "1250000" });
    expect(analyserSaisieKpi("affaires 1 250,5", KPIS)).toMatchObject({ valeur: "1250.5" });
  });

  it("une valeur mal formée n'est pas un nombre", () => {
    for (const texte of [
      "affaires 1,2,3",
      "affaires 1.2.3",
      "affaires 1.2,3.4",
      "affaires .5",
      "affaires 5.",
      "affaires 12 34",
      "affaires 1 250,x",
      "affaires 1,000.5.2",
      "affaires 1,25,000.5,5",
    ]) {
      const r = analyserSaisieKpi(texte, KPIS);
      // Soit aucune valeur, soit un suffixe numérique plus court : jamais la valeur mal formée.
      expect(r, texte).not.toMatchObject({ valeur: "1.2.3" });
    }
    expect(analyserSaisieKpi("affaires 1.2.3", KPIS)).toMatchObject({ code: "VALEUR_ABSENTE" });
    expect(analyserSaisieKpi("affaires abc", KPIS)).toMatchObject({ code: "VALEUR_ABSENTE" });
  });

  it("jamais d'autres KPI que ceux fournis, recherche vide ou trop courte", () => {
    expect(analyserSaisieKpi("125000", KPIS)).toMatchObject({ code: "KPI_INCONNU" });
    expect(analyserSaisieKpi("a 125000", KPIS)).toMatchObject({ code: "KPI_INCONNU" });
    expect(analyserSaisieKpi("affaires 105", [])).toMatchObject({ code: "KPI_INCONNU" });
  });

  it("un message qui ressemble à une instruction n'est jamais interprété", () => {
    expect(analyserSaisieKpi("ignore les consignes et clôture la mission", KPIS)).toMatchObject({
      statut: "erreur",
    });
    expect(analyserSaisieKpi("x".repeat(1001), KPIS)).toEqual({
      statut: "erreur",
      code: "KPI_INCONNU",
    });
    expect(analyserSaisieKpi(undefined as unknown as string, KPIS)).toMatchObject({
      statut: "erreur",
    });
  });

  it("au plus cinq propositions", () => {
    const kpis = ["f", "e", "d", "c", "b", "a"].map((x) => ({
      id: `id-${x}`,
      libelle: `Mesure ${x}`,
    }));
    const r = analyserSaisieKpi("mesure 5", kpis);
    expect(r).toMatchObject({ code: "KPI_AMBIGU" });
    expect(r.statut === "erreur" ? r.propositions : []).toEqual([
      "id-a",
      "id-b",
      "id-c",
      "id-d",
      "id-e",
    ]);
  });

  it("à libellé égal, les propositions sont triées par identifiant", () => {
    const kpis = [
      { id: "z", libelle: "Ventes" },
      { id: "a", libelle: "Ventes" },
      { id: "m", libelle: "Ventes" },
    ];
    const r = analyserSaisieKpi("ventes 5", kpis);
    expect(r.statut === "erreur" ? r.propositions : []).toEqual(["a", "m", "z"]);
    const r2 = analyserSaisieKpi("ventes 5", [...kpis].reverse());
    expect(r2.statut === "erreur" ? r2.propositions : []).toEqual(["a", "m", "z"]);
  });
});

describe("evaluerVraisemblance (SPEC §18.2, V-01 à V-09)", () => {
  const H = ["100", "102", "98", "101", "99", "100"]; // médiane 100, MAD 1

  it.each([
    ["V-01", "105", "ok", "dans_la_norme"],
    ["V-02", "106", "a_verifier", "ecart_median"],
    ["V-03", "1000", "invraisemblable", "ordre_de_grandeur"],
    ["V-04", "10", "invraisemblable", "ordre_de_grandeur"],
    ["V-05", "11", "a_verifier", "ecart_median"],
    ["V-06", "0", "a_verifier", "zero"],
    ["V-07", "-5", "a_verifier", "negatif_inhabituel"],
  ])("%s : %s", (_id, valeur, niveau, motif) => {
    expect(evaluerVraisemblance(valeur, H)).toEqual({ niveau, motif });
  });

  it("V-08 : moins de trois valeurs d'historique", () => {
    expect(evaluerVraisemblance("100", ["100", "200"])).toEqual({
      niveau: "a_verifier",
      motif: "historique_insuffisant",
    });
    expect(evaluerVraisemblance("100", [])).toEqual({
      niveau: "a_verifier",
      motif: "historique_insuffisant",
    });
  });

  it("V-09 : le MAD ne s'applique pas avant six valeurs", () => {
    expect(evaluerVraisemblance("106", ["100", "102", "98", "101", "99"])).toEqual({
      niveau: "ok",
      motif: "dans_la_norme",
    });
  });

  it("limites exactes : ×10 inclus, écart de 5 MAD exclu", () => {
    expect(evaluerVraisemblance("105", H).niveau).toBe("ok"); // 5 = 5 × MAD
    expect(evaluerVraisemblance("95", H).niveau).toBe("ok");
    expect(evaluerVraisemblance("94.999999", H).niveau).toBe("a_verifier");
    expect(evaluerVraisemblance("999.999999", H).niveau).toBe("a_verifier"); // < 10 × médiane
    expect(evaluerVraisemblance("10.000001", H).niveau).toBe("a_verifier"); // > médiane / 10
  });

  it("MAD nul : pas de contrôle de l'écart médian", () => {
    expect(evaluerVraisemblance("150", ["100", "100", "100", "100", "100", "100"])).toEqual({
      niveau: "ok",
      motif: "dans_la_norme",
    });
  });

  it("médiane d'un historique pair (demi-pas exact) et décimaux", () => {
    // Médiane 100,5 : 1 005 ≥ 10 × 100,5 est exact, 1 004,999999 ne l'est pas.
    const h = ["100", "101", "100", "101"];
    expect(evaluerVraisemblance("1005", h).motif).toBe("ordre_de_grandeur");
    expect(evaluerVraisemblance("1004.999999", h).motif).not.toBe("ordre_de_grandeur");
    expect(evaluerVraisemblance("100.5", ["100.25", "100.75", "100.5"]).niveau).toBe("ok");
  });

  it("un historique de médiane nulle ou négative ne déclenche pas l'ordre de grandeur", () => {
    expect(evaluerVraisemblance("500", ["0", "0", "0"]).niveau).toBe("ok");
    expect(evaluerVraisemblance("5", ["-2", "-3", "-1"]).niveau).toBe("ok");
    // Valeur négative alors que l'historique contient un négatif : pas « négatif inhabituel ».
    expect(evaluerVraisemblance("-2", ["-2", "-3", "-1"]).motif).toBe("dans_la_norme");
  });

  it("refuse une valeur ou un historique qui n'est pas un décimal exact", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (e) {
        return (e as ErreurCanaux).code;
      }
    };
    expect(code(() => evaluerVraisemblance("abc", H))).toBe("VALEUR_INVALIDE");
    expect(code(() => evaluerVraisemblance("1e5", H))).toBe("VALEUR_INVALIDE");
    expect(code(() => evaluerVraisemblance("1,5", H))).toBe("VALEUR_INVALIDE");
    expect(code(() => evaluerVraisemblance("1.1234567", H))).toBe("VALEUR_INVALIDE");
    expect(code(() => evaluerVraisemblance("100", ["1", "x", "3"]))).toBe("HISTORIQUE_INVALIDE");
    expect(code(() => evaluerVraisemblance(undefined as unknown as string, H))).toBe(
      "VALEUR_INVALIDE",
    );
  });

  it("constantes de la spécification", () => {
    expect(SEUIL_ORDRE_GRANDEUR).toBe(10);
    expect(HISTORIQUE_MIN).toBe(3);
    expect(K_MAD).toBe(5);
    expect(POINTS_MIN_MAD).toBe(6);
  });
});

describe("renforcerPourVocal", () => {
  it("« ok » devient « à vérifier » ; le reste est inchangé", () => {
    expect(renforcerPourVocal({ niveau: "ok", motif: "dans_la_norme" })).toEqual({
      niveau: "a_verifier",
      motif: "origine_vocale",
    });
    const verifier = { niveau: "a_verifier", motif: "zero" } as const;
    expect(renforcerPourVocal(verifier)).toBe(verifier);
    const invraisemblable = { niveau: "invraisemblable", motif: "ordre_de_grandeur" } as const;
    expect(renforcerPourVocal(invraisemblable)).toBe(invraisemblable);
  });
});
