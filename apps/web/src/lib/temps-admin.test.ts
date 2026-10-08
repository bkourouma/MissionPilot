import { describe, expect, it } from "vitest";
import {
  actionsPeriode,
  executionPossible,
  finDuMois,
  libelleMois,
  peutDeciderCorrection,
  validerActivite,
  validerCorrection,
  validerCsv,
  validerParametresTemps,
  type RapportImport,
} from "./temps-admin";

const C = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

describe("paramètres et activités", () => {
  it("valide le contrôle de capacité et le seuil (1 à 100)", () => {
    expect(
      validerParametresTemps({ controle_capacite: "refuser", seuil_consommation_pct: "80" }),
    ).toEqual({
      ok: true,
      charge: { controle_capacite: "refuser", seuil_consommation_pct: 80 },
    });
    expect(validerParametresTemps({ controle_capacite: "x", seuil_consommation_pct: "0" }).ok).toBe(
      false,
    );
    expect(
      validerParametresTemps({ controle_capacite: "signaler", seuil_consommation_pct: "80,5" }).ok,
    ).toBe(false);
  });

  it("valide une activité interne", () => {
    expect(
      validerActivite({ code: " formation ", libelle: " Formation ", est_absence: false }),
    ).toEqual({
      ok: true,
      charge: { code: "formation", libelle: "Formation", est_absence: false },
    });
    expect(validerActivite({ code: "Formation!", libelle: "", est_absence: true }).ok).toBe(false);
  });
});

describe("clôture mensuelle", () => {
  it("nomme les mois et leur dernier jour", () => {
    expect(libelleMois("2026-09")).toBe("Septembre 2026");
    expect(finDuMois("2026-02")).toBe("2026-02-28");
    expect(finDuMois("2028-02")).toBe("2028-02-29");
  });

  it("clôture un mois terminé ; seul un associé rouvre", () => {
    const aujourdhui = "2026-10-06";
    expect(
      actionsPeriode({ mois: "2026-09", statut: "ouverte" }, ["gestionnaire"], aujourdhui),
    ).toEqual({
      cloturer: true,
      rouvrir: false,
    });
    expect(
      actionsPeriode({ mois: "2026-10", statut: "ouverte" }, ["gestionnaire"], aujourdhui).cloturer,
    ).toBe(false);
    expect(
      actionsPeriode({ mois: "2026-09", statut: "cloturee" }, ["gestionnaire"], aujourdhui).rouvrir,
    ).toBe(false);
    expect(
      actionsPeriode({ mois: "2026-09", statut: "cloturee" }, ["associe"], aujourdhui).rouvrir,
    ).toBe(true);
    expect(
      actionsPeriode({ mois: "2026-09", statut: "ouverte" }, ["consultant"], aujourdhui).cloturer,
    ).toBe(false);
  });
});

describe("corrections", () => {
  it("construit une demande dans l'unité du cabinet", () => {
    expect(
      validerCorrection(
        { cible: `t:${T}`, date: "2026-09-10", valeur: "0,5", motif: " Oubli " },
        C,
        "demi_journee",
      ),
    ).toEqual({
      ok: true,
      charge: { collaborateur_id: C, date: "2026-09-10", tache_id: T, jours: 0.5, motif: "Oubli" },
    });
    expect(
      validerCorrection(
        { cible: `a:${T}`, date: "2026-09-10", valeur: "0", motif: "Retrait" },
        C,
        "heure",
      ),
    ).toMatchObject({ ok: true, charge: { activite_id: T, heures: 0 } });
  });

  it("refuse une demande incomplète ou hors du pas", () => {
    const r = validerCorrection(
      { cible: "", date: "", valeur: "0,3", motif: "" },
      C,
      "demi_journee",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["cible", "date", "motif", "valeur"]);
  });

  it("ne laisse décider ni le demandeur ni l'auteur des temps", () => {
    const k = { statut: "demandee" as const, demandee_par: "u1" };
    expect(peutDeciderCorrection(k, ["gestionnaire"], "u2", "c2", "c1")).toBe(true);
    expect(peutDeciderCorrection(k, ["gestionnaire"], "u1", "c2", "c1")).toBe(false);
    expect(peutDeciderCorrection(k, ["gestionnaire"], "u2", "c1", "c1")).toBe(false);
    expect(peutDeciderCorrection(k, ["consultant"], "u2", "c2", "c1")).toBe(false);
    expect(peutDeciderCorrection({ ...k, statut: "validee" }, ["associe"], "u2", null, "c1")).toBe(
      false,
    );
  });
});

describe("import CSV", () => {
  it("vérifie la présence du contenu et des colonnes attendues", () => {
    expect(validerCsv("").ok).toBe(false);
    expect(validerCsv("\uFEFFCollaborateur;Mission;Tâche;Date;Jours\nA;B;C;01/09/2026;1").ok).toBe(
      true,
    );
    const r = validerCsv("nom;mission;date\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.csv).toContain("collaborateur, tache, jours");
    expect(validerCsv("x".repeat(500_001)).ok).toBe(false);
  });

  it("n'autorise l'exécution qu'après une simulation sans erreur du même contenu", () => {
    const rapport: RapportImport = {
      simulation: true,
      executee: false,
      lignes_lues: 2,
      lignes_valides: 2,
      feuilles: 1,
      jours_total: 2,
      erreurs: [],
      avertissements: [],
    };
    expect(executionPossible(rapport, true)).toBe(true);
    expect(executionPossible(rapport, false)).toBe(false);
    expect(executionPossible({ ...rapport, erreurs: [{ ligne: 2, message: "x" }] }, true)).toBe(
      false,
    );
    expect(executionPossible({ ...rapport, lignes_valides: 0 }, true)).toBe(false);
    expect(executionPossible(null, true)).toBe(false);
  });
});
