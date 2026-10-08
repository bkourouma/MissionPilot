import { describe, expect, it } from "vitest";
import {
  groupesParMission,
  hrefPlan,
  lireFiltresPlan,
  peutAnnulerAbsence,
  peutDeciderAbsence,
  peutGererAffectations,
  requetePlan,
  SAISIE_AFFECTATION_VIDE,
  validerAbsence,
  validerAffectation,
  validerModificationAffectation,
  validerReplanification,
  type Affectation,
  type LigneMonPlanning,
} from "./planification";

const U = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const G = "33333333-3333-4333-8333-333333333333";

describe("absences", () => {
  it("valide une demande et refuse une période incohérente", () => {
    expect(
      validerAbsence({
        type: "conge_paye",
        date_debut: "2026-11-02",
        date_fin: "2026-11-06",
        commentaire: " ",
      }),
    ).toEqual({
      ok: true,
      charge: {
        type: "conge_paye",
        date_debut: "2026-11-02",
        date_fin: "2026-11-06",
        commentaire: null,
      },
    });
    const r = validerAbsence({
      type: "x",
      date_debut: "2026-11-06",
      date_fin: "2026-11-02",
      commentaire: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["date_fin", "type"]);
    expect(
      validerAbsence({
        type: "autre",
        date_debut: "2026-01-01",
        date_fin: "2027-06-01",
        commentaire: "",
      }).ok,
    ).toBe(false);
  });

  it("le demandeur annule avant le début ; un valideur décide, jamais de sa demande", () => {
    const a = { statut: "demandee" as const, date_debut: "2026-11-02", demandeur_id: U };
    expect(peutAnnulerAbsence(a, U, "2026-10-06")).toBe(true);
    expect(peutAnnulerAbsence(a, U, "2026-11-02")).toBe(false);
    expect(peutAnnulerAbsence({ ...a, statut: "refusee" }, U, "2026-10-06")).toBe(false);
    expect(peutAnnulerAbsence(a, "autre", "2026-10-06")).toBe(false);
    expect(peutDeciderAbsence(a, ["ressources"], "autre")).toBe(true);
    expect(peutDeciderAbsence(a, ["ressources"], U)).toBe(false);
    expect(peutDeciderAbsence(a, ["consultant"], "autre")).toBe(false);
    expect(peutDeciderAbsence({ ...a, statut: "validee" }, ["associe"], "autre")).toBe(false);
  });
});

describe("affectations", () => {
  const base = {
    ...SAISIE_AFFECTATION_VIDE,
    tache_id: T,
    jours_alloues: "2,5",
    date_debut: "2026-10-05",
    date_fin: "2026-10-16",
  };

  it("crée une affectation nominative ou un profil à pourvoir", () => {
    expect(validerAffectation({ ...base, collaborateur_id: U })).toEqual({
      ok: true,
      charge: {
        tache_id: T,
        collaborateur_id: U,
        jours_alloues: 2.5,
        date_debut: "2026-10-05",
        date_fin: "2026-10-16",
      },
    });
    expect(
      validerAffectation({ ...base, mode: "profil", grade_id: G, competence: " SI " }),
    ).toMatchObject({
      ok: true,
      charge: { profil: { grade_id: G, competence: "SI" } },
    });
  });

  it("signale les champs manquants ou invalides", () => {
    const r = validerAffectation({
      ...base,
      tache_id: "",
      jours_alloues: "0",
      date_fin: "2026-10-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "collaborateur_id",
        "date_fin",
        "jours_alloues",
        "tache_id",
      ]);
    expect(validerAffectation({ ...base, collaborateur_id: U, date_fin: "2027-12-31" }).ok).toBe(
      false,
    );
  });

  it("n'envoie en modification que les champs changés", () => {
    const avant = {
      tache_id: T,
      jours_alloues: 2.5,
      date_debut: "2026-10-05",
      date_fin: "2026-10-16",
    } as Affectation;
    expect(validerModificationAffectation({ ...base, jours_alloues: "3" }, avant)).toEqual({
      ok: true,
      charge: { jours_alloues: 3 },
    });
    expect(validerModificationAffectation(base, avant).ok).toBe(false);
  });

  it("réserve la gestion aux responsables de la mission et aux ressources", () => {
    const m = { statut: "en_cours", directeur_id: "d", chef_id: "c" };
    expect(peutGererAffectations(m, ["chef_mission"], "c")).toBe(true);
    expect(peutGererAffectations(m, ["chef_mission"], "x")).toBe(false);
    expect(peutGererAffectations(m, ["ressources"], "x")).toBe(true);
    expect(peutGererAffectations(m, ["consultant"], "c")).toBe(false);
    expect(peutGererAffectations({ ...m, statut: "cloturee" }, ["associe"], "x")).toBe(false);
  });
});

describe("re-planification", () => {
  it("exige une phase et un décalage entier non nul", () => {
    expect(validerReplanification(G, "-2")).toEqual({
      ok: true,
      charge: { phase_id: G, decalage_jours_ouvres: -2 },
    });
    expect(validerReplanification(G, "0").ok).toBe(false);
    expect(validerReplanification(G, "1,5").ok).toBe(false);
    expect(validerReplanification("", "3").ok).toBe(false);
    expect(validerReplanification(G, "300").ok).toBe(false);
  });
});

describe("plan de charge", () => {
  it("lit et nettoie les filtres de l'URL", () => {
    expect(
      lireFiltresPlan({
        debut: "2026-10-05",
        semaines: "8",
        type: "externe",
        grade_id: G,
        curseur: "abc_-=",
      }),
    ).toEqual({
      debut: "2026-10-05",
      semaines: 8,
      equipe: "",
      grade_id: G,
      type: "externe",
      curseur: "abc_-=",
    });
    expect(
      lireFiltresPlan({ debut: "hier", semaines: "99", type: "x", equipe: "1", curseur: "a b" }),
    ).toEqual({
      debut: "",
      semaines: 12,
      equipe: "",
      grade_id: "",
      type: "",
      curseur: "",
    });
  });

  it("construit la requête de l'API sur la durée choisie", () => {
    const f = lireFiltresPlan({ semaines: "4", grade_id: G });
    expect(requetePlan(f, "2026-10-05")).toBe(
      `debut=2026-10-05&fin=2026-11-01&grade_id=${G}&limite=50`,
    );
  });

  it("garde les filtres dans les liens et repart du début sans curseur", () => {
    const f = lireFiltresPlan({ semaines: "26", type: "interne", curseur: "abc" });
    expect(hrefPlan(f)).toBe("/charge?semaines=26&type=interne");
    expect(hrefPlan(f, { curseur: "xyz" })).toBe("/charge?semaines=26&type=interne&curseur=xyz");
    expect(hrefPlan(lireFiltresPlan({}))).toBe("/charge");
  });
});

describe("Mon planning", () => {
  it("groupe les tâches par mission dans l'ordre reçu", () => {
    const l = (mission: string, tache: string): LigneMonPlanning => ({
      affectation_id: `${mission}-${tache}`,
      mission: {
        id: mission,
        intitule: mission === "m2" ? null : "Audit",
        statut: null,
        accessible: mission !== "m2",
      },
      tache: { id: tache, libelle: tache, phase_libelle: null },
      jours_alloues_semaine: 1,
      affectation: { jours_alloues: 2, date_debut: "2026-10-05", date_fin: "2026-10-09" },
    });
    const g = groupesParMission([l("m1", "a"), l("m2", "b"), l("m1", "c")]);
    expect(g.map((x) => [x.cle, x.lignes.length, x.accessible])).toEqual([
      ["m1", 2, true],
      ["m2", 1, false],
    ]);
    expect(g[1]?.intitule).toBe("Mission non accessible");
  });
});
