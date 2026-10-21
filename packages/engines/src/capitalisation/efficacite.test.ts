import { describe, expect, it } from "vitest";
import {
  calculerEfficaciteInitiative,
  EFFICACITE_DELAI_EFFET_JOURS,
  EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT,
  ErreurEfficacite,
  medianeEntiere,
  mesuresEffectivesEfficacite,
  scoresParContexte,
  type MesureBruteEfficacite,
} from "./efficacite";

let n = 0;
const m = (
  date_mesure: string,
  valeur: string | null,
  extra: Partial<MesureBruteEfficacite> = {},
): MesureBruteEfficacite => ({
  id: `m${++n}`,
  date_mesure,
  valeur,
  annulation: valeur === null,
  remplace_id: null,
  ...extra,
});

describe("mesures effectives", () => {
  it("écarte les mesures remplacées et les annulations, trie par date", () => {
    const a = m("2026-01-10", "10", { id: "a" });
    const a2 = m("2026-01-10", "12", { id: "a2", remplace_id: "a" });
    const b = m("2026-02-10", "20", { id: "b" });
    const bx = m("2026-02-10", null, { id: "bx", remplace_id: "b" });
    const c = m("2025-12-01", "5", { id: "c" });
    expect(mesuresEffectivesEfficacite([a, a2, b, bx, c]).map((x) => x.id)).toEqual(["c", "a2"]);
  });
  it("trie par identifiant à date égale", () => {
    const r = mesuresEffectivesEfficacite([
      m("2026-01-01", "1", { id: "z" }),
      m("2026-01-01", "2", { id: "b" }),
    ]);
    expect(r.map((x) => x.id)).toEqual(["b", "z"]);
  });
});

const base = {
  sens: "plus_haut_mieux" as const,
  mise_en_oeuvre_le: "2026-03-01",
  valeur_cible: "200",
};

describe("efficacité d'une initiative", () => {
  it("score = part de l'écart comblé, base à la date et effet après le délai", () => {
    const r = calculerEfficaciteInitiative({
      ...base,
      mesures: [
        m("2026-02-01", "90"),
        m("2026-03-01", "100"),
        m("2026-03-15", "150"),
        m("2026-03-31", "130"),
        m("2026-05-01", "150"),
      ],
    });
    expect(r.evaluable).toBe(true);
    expect(r.base?.valeur).toBe("100");
    expect(r.effet?.date_mesure).toBe("2026-05-01");
    expect(r.ecart_attendu).toBe("100");
    expect(r.ecart_realise).toBe("50");
    expect(r.part_comblee_pour_mille).toBe(500);
    expect(r.score).toBe(50);
    expect(EFFICACITE_DELAI_EFFET_JOURS).toBe(30);
  });
  it("la mesure à exactement 30 jours compte, à 29 non", () => {
    const ok = calculerEfficaciteInitiative({
      ...base,
      mesures: [m("2026-03-01", "100"), m("2026-03-31", "200")],
    });
    expect(ok.score).toBe(100);
    const non = calculerEfficaciteInitiative({
      ...base,
      mesures: [m("2026-03-01", "100"), m("2026-03-30", "200")],
    });
    expect(non.raison_code).toBe("AUCUNE_MESURE_D_EFFET");
    expect(non.score).toBeNull();
  });
  it("score borné à 100 et à 0, part bornée", () => {
    const haut = calculerEfficaciteInitiative({
      ...base,
      mesures: [m("2026-03-01", "100"), m("2026-05-01", "400")],
    });
    expect(haut.score).toBe(100);
    expect(haut.part_comblee_pour_mille).toBe(3000);
    const bas = calculerEfficaciteInitiative({
      ...base,
      mesures: [m("2026-03-01", "100"), m("2026-05-01", "50")],
    });
    expect(bas.score).toBe(0);
    expect(bas.part_comblee_pour_mille).toBe(-500);
    const enorme = calculerEfficaciteInitiative({
      ...base,
      mesures: [m("2026-03-01", "100"), m("2026-05-01", "999999999")],
    });
    expect(enorme.part_comblee_pour_mille).toBe(100_000);
    const abysse = calculerEfficaciteInitiative({
      ...base,
      mesures: [m("2026-03-01", "100"), m("2026-05-01", "-999999999")],
    });
    expect(abysse.part_comblee_pour_mille).toBe(-100_000);
  });
  it("sens inversé : plus bas = mieux", () => {
    const r = calculerEfficaciteInitiative({
      sens: "plus_bas_mieux",
      mise_en_oeuvre_le: "2026-03-01",
      valeur_cible: "40",
      mesures: [m("2026-03-01", "60"), m("2026-05-01", "45")],
    });
    expect(r.ecart_attendu).toBe("-20");
    expect(r.ecart_realise).toBe("-15");
    expect(r.score).toBe(75);
    const recul = calculerEfficaciteInitiative({
      sens: "plus_bas_mieux",
      mise_en_oeuvre_le: "2026-03-01",
      valeur_cible: "40",
      mesures: [m("2026-03-01", "60"), m("2026-05-01", "70")],
    });
    expect(recul.score).toBe(0);
  });
  it("écart attendu nul ou contraire : non évaluable avec raison", () => {
    const nul = calculerEfficaciteInitiative({
      ...base,
      valeur_cible: "100",
      mesures: [m("2026-03-01", "100"), m("2026-05-01", "150")],
    });
    expect(nul.raison_code).toBe("ECART_ATTENDU_NUL");
    expect(nul.score).toBeNull();
    expect(nul.raison).toContain("nul");
    const contraire = calculerEfficaciteInitiative({
      ...base,
      valeur_cible: "50",
      mesures: [m("2026-03-01", "100"), m("2026-05-01", "150")],
    });
    expect(contraire.raison_code).toBe("CIBLE_CONTRAIRE_AU_SENS");
    expect(contraire.evaluable).toBe(false);
  });
  it("sans mesure de base : non évaluable ; une mesure annulée ne sert pas", () => {
    const a = m("2026-02-01", "100", { id: "ann" });
    const r = calculerEfficaciteInitiative({
      ...base,
      mesures: [a, m("2026-02-01", null, { remplace_id: "ann" }), m("2026-05-01", "150")],
    });
    expect(r.raison_code).toBe("AUCUNE_MESURE_DE_BASE");
    expect(r.effet?.valeur).toBe("150");
  });
  it("décimaux exacts, sans flottant", () => {
    const r = calculerEfficaciteInitiative({
      ...base,
      valeur_cible: "0.3",
      mesures: [m("2026-03-01", "0.1"), m("2026-05-01", "0.2")],
    });
    expect(r.ecart_attendu).toBe("0.2");
    expect(r.ecart_realise).toBe("0.1");
    expect(r.score).toBe(50);
  });
  it("arrondit à la moitié supérieure, y compris pour une part négative", () => {
    const r = calculerEfficaciteInitiative({
      ...base,
      valeur_cible: "300",
      mesures: [m("2026-03-01", "0"), m("2026-05-01", "1")],
    });
    expect(r.part_comblee_pour_mille).toBe(3);
    expect(r.score).toBe(0);
    const neg = calculerEfficaciteInitiative({
      ...base,
      valeur_cible: "400",
      mesures: [m("2026-03-01", "0"), m("2026-05-01", "-1")],
    });
    expect(neg.part_comblee_pour_mille).toBe(-2);
    const demi = calculerEfficaciteInitiative({
      ...base,
      valeur_cible: "200",
      mesures: [m("2026-03-01", "0"), m("2026-05-01", "1")],
    });
    expect(demi.part_comblee_pour_mille).toBe(5);
    expect(demi.score).toBe(1);
  });
  it("délai personnalisé et entrées invalides", () => {
    const r = calculerEfficaciteInitiative({
      ...base,
      delai_effet_jours: 0,
      mesures: [m("2026-03-01", "100"), m("2026-03-02", "200")],
    });
    expect(r.score).toBe(100);
    expect(() =>
      calculerEfficaciteInitiative({ ...base, delai_effet_jours: -1, mesures: [] }),
    ).toThrow(ErreurEfficacite);
    expect(() =>
      calculerEfficaciteInitiative({ ...base, valeur_cible: "abc", mesures: [] }),
    ).toThrow(ErreurEfficacite);
    expect(() =>
      calculerEfficaciteInitiative({ ...base, mise_en_oeuvre_le: "2026-02-30", mesures: [] }),
    ).toThrow(ErreurEfficacite);
    expect(() =>
      calculerEfficaciteInitiative({ ...base, mise_en_oeuvre_le: "demain", mesures: [] }),
    ).toThrow(ErreurEfficacite);
  });
});

const obs = (
  score: number | null,
  type: string | null,
  secteur: string | null,
  taille: string | null,
) => ({ score, type_initiative: type, secteur, taille });

describe("scores par contexte", () => {
  it("médiane entière", () => {
    expect(medianeEntiere([10, 30, 20])).toBe(20);
    expect(medianeEntiere([10, 21])).toBe(16);
    expect(() => medianeEntiere([])).toThrow(ErreurEfficacite);
  });
  it("combinaisons non vides, seuil, effectif visible, non évaluables ignorés", () => {
    const o = [
      ...[80, 60, 70, 90, 50].map((s) => obs(s, "formation", "agro", "pme")),
      obs(20, "formation", "agro", "tpe"),
      obs(null, "formation", "agro", "pme"),
      obs(40, "formation", null, null),
    ];
    const r = scoresParContexte(o);
    const par = Object.fromEntries(r.map((x) => [x.cle, x]));
    expect(par["type_initiative=formation"]?.effectif).toBe(7);
    expect(par["type_initiative=formation"]?.score_moyen).toBe(59);
    expect(par["type_initiative=formation|secteur=agro|taille=pme"]?.score_moyen).toBe(70);
    expect(par["type_initiative=formation|secteur=agro|taille=pme"]?.mediane).toBe(70);
    const tpe = par["taille=tpe"];
    expect(tpe?.effectif).toBeNull();
    expect(tpe?.score_moyen).toBeNull();
    expect(tpe?.raison).toBe("effectif insuffisant");
    expect(par["secteur=agro"]?.effectif).toBe(6);
    expect(r[0]?.effectif).toBe(7);
    expect(EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT).toBe(5);
  });
  it("seuil relevé, moyenne arrondie, validations (jamais sous 5)", () => {
    const huit = [1, 2, 2, 2, 2, 2, 2, 2].map((s) => obs(s, "a", null, null));
    expect(
      scoresParContexte(huit, { seuilMin: 7 }).find((x) => x.cle === "type_initiative=a"),
    ).toMatchObject({ effectif: 8, score_moyen: 2 });
    expect(
      scoresParContexte(huit, { seuilMin: 9 }).find((x) => x.cle === "type_initiative=a"),
    ).toMatchObject({ effectif: null, score_moyen: null, mediane: null });
    expect(() => scoresParContexte(huit, { seuilMin: 4 })).toThrow(ErreurEfficacite);
    expect(() => scoresParContexte(huit, { seuilMin: 2 })).toThrow(ErreurEfficacite);
    expect(scoresParContexte([obs(10, "", null, null)])).toEqual([]);
    expect(() => scoresParContexte([], { seuilMin: 0 })).toThrow(ErreurEfficacite);
    expect(() => scoresParContexte([obs(101, "a", null, null)])).toThrow(ErreurEfficacite);
    expect(() => scoresParContexte([obs(1.5, "a", null, null)])).toThrow(ErreurEfficacite);
  });
});
