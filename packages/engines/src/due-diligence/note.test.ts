import { describe, expect, it } from "vitest";
import { ErreurDueDiligence } from "./erreurs";
import {
  controlerNoteComite,
  sectionsDeLaNote,
  type EntreeControleNote,
  type HypotheseNote,
} from "./note";

const h = (
  id: string,
  verdict: HypotheseNote["verdict"],
  extra: Partial<HypotheseNote> = {},
): HypotheseNote => ({ id, parentId: null, retiree: false, verdict, ...extra });

const conforme = (): EntreeControleNote => ({
  recommandation: "favorable",
  nbConditions: 0,
  hypotheses: [h("h1", "confirmee")],
  anomaliesSources: 0,
  exclusionsBloquantes: 0,
  risquesCritiquesFragiles: 0,
  marche: { present: true, recoupementAlerte: false },
  incoherencesArbre: 0,
});

describe("controlerNoteComite", () => {
  it("(1) tout conforme : soumissible", () => {
    expect(controlerNoteComite(conforme())).toEqual({
      bloquants: [],
      avertissements: [],
      soumissible: true,
    });
  });

  it("(2) aucune hypothèse : SANS_HYPOTHESE seul", () => {
    const r = controlerNoteComite({ ...conforme(), hypotheses: [] });
    expect(r.bloquants).toEqual(["SANS_HYPOTHESE"]);
    expect(r.soumissible).toBe(false);
  });

  it("(3) hypothèses sans verdict : une seule fois ; hypothèse retirée ignorée", () => {
    expect(
      controlerNoteComite({ ...conforme(), hypotheses: [h("a", null), h("b", null)] }).bloquants,
    ).toEqual(["HYPOTHESE_SANS_VERDICT_VALIDE"]);
    expect(
      controlerNoteComite({
        ...conforme(),
        hypotheses: [h("a", "confirmee"), h("b", null, { retiree: true })],
      }).bloquants,
    ).toEqual([]);
    // Une hypothèse dont le parent est retiré est retirée aussi.
    expect(
      controlerNoteComite({
        ...conforme(),
        hypotheses: [
          h("a", "confirmee"),
          h("p", null, { retiree: true }),
          h("e", null, { parentId: "p" }),
        ],
      }).bloquants,
    ).toEqual([]);
    // Toutes retirées : SANS_HYPOTHESE.
    expect(
      controlerNoteComite({ ...conforme(), hypotheses: [h("a", "confirmee", { retiree: true })] })
        .bloquants,
    ).toEqual(["SANS_HYPOTHESE"]);
  });

  it("(4) racine infirmée avec recommandation favorable ; sous conditions admis", () => {
    const infirmee = [h("a", "infirmee")];
    expect(controlerNoteComite({ ...conforme(), hypotheses: infirmee }).bloquants).toEqual([
      "HYPOTHESE_INFIRMEE_FAVORABLE",
    ]);
    expect(
      controlerNoteComite({
        ...conforme(),
        recommandation: "favorable_sous_conditions",
        nbConditions: 1,
        hypotheses: infirmee,
      }).bloquants,
    ).toEqual([]);
    // Un enfant infirmé n'est pas une racine infirmée.
    expect(
      controlerNoteComite({
        ...conforme(),
        hypotheses: [h("r", "confirmee"), h("e", "infirmee", { parentId: "r" })],
      }).bloquants,
    ).toEqual([]);
  });

  it("(5) favorable sous conditions sans condition", () => {
    expect(
      controlerNoteComite({ ...conforme(), recommandation: "favorable_sous_conditions" }).bloquants,
    ).toEqual(["CONDITIONS_MANQUANTES"]);
  });

  it("(6) défavorable avec exclusions : aucun bloquant ; réservée aussi", () => {
    expect(
      controlerNoteComite({ ...conforme(), recommandation: "defavorable", exclusionsBloquantes: 2 })
        .bloquants,
    ).toEqual([]);
    expect(
      controlerNoteComite({ ...conforme(), recommandation: "reservee", exclusionsBloquantes: 2 })
        .bloquants,
    ).toEqual([]);
  });

  it("(7) favorable avec une exclusion non levée", () => {
    expect(controlerNoteComite({ ...conforme(), exclusionsBloquantes: 1 }).bloquants).toEqual([
      "EXCLUSION_NON_LEVEE_FAVORABLE",
    ]);
    expect(
      controlerNoteComite({
        ...conforme(),
        recommandation: "favorable_sous_conditions",
        nbConditions: 2,
        exclusionsBloquantes: 1,
      }).bloquants,
    ).toEqual(["EXCLUSION_NON_LEVEE_FAVORABLE"]);
  });

  it("(8) anomalies de sources", () => {
    expect(controlerNoteComite({ ...conforme(), anomaliesSources: 3 }).bloquants).toEqual([
      "SOURCES_MANQUANTES",
    ]);
  });

  it("(9) avertissements dans l'ordre ; ils ne bloquent pas", () => {
    const r = controlerNoteComite({
      ...conforme(),
      risquesCritiquesFragiles: 2,
      marche: { present: false, recoupementAlerte: false },
      incoherencesArbre: 1,
    });
    expect(r.avertissements).toEqual([
      "RISQUES_CRITIQUES_FRAGILES",
      "AUCUN_DIMENSIONNEMENT",
      "ARBRE_INCOHERENT",
    ]);
    expect(r.soumissible).toBe(true);
    expect(
      controlerNoteComite({
        ...conforme(),
        risquesCritiquesFragiles: 2,
        marche: { present: true, recoupementAlerte: true },
        incoherencesArbre: 1,
      }).avertissements,
    ).toEqual(["RISQUES_CRITIQUES_FRAGILES", "RECOUPEMENT_MARCHE_DIVERGENT", "ARBRE_INCOHERENT"]);
    // L'alerte de recoupement sans marché présent n'a pas de sens : seul l'avertissement d'absence.
    expect(
      controlerNoteComite({
        ...conforme(),
        marche: { present: false, recoupementAlerte: true },
      }).avertissements,
    ).toEqual(["AUCUN_DIMENSIONNEMENT"]);
  });

  it("plusieurs bloquants à la fois, dans l'ordre déclaré", () => {
    const r = controlerNoteComite({
      ...conforme(),
      recommandation: "favorable_sous_conditions",
      nbConditions: 0,
      hypotheses: [h("a", null)],
      anomaliesSources: 1,
      exclusionsBloquantes: 1,
    });
    expect(r.bloquants).toEqual([
      "HYPOTHESE_SANS_VERDICT_VALIDE",
      "SOURCES_MANQUANTES",
      "EXCLUSION_NON_LEVEE_FAVORABLE",
      "CONDITIONS_MANQUANTES",
    ]);
    const tout = controlerNoteComite({
      ...conforme(),
      hypotheses: [],
      anomaliesSources: 1,
      exclusionsBloquantes: 1,
    });
    expect(tout.bloquants).toEqual([
      "SANS_HYPOTHESE",
      "SOURCES_MANQUANTES",
      "EXCLUSION_NON_LEVEE_FAVORABLE",
    ]);
  });

  it("entrées invalides", () => {
    const refuse = (e: unknown) =>
      expect(() => controlerNoteComite(e as EntreeControleNote)).toThrow(ErreurDueDiligence);
    refuse({ ...conforme(), recommandation: "peut-etre" });
    refuse({ ...conforme(), nbConditions: -1 });
    refuse({ ...conforme(), anomaliesSources: 1.5 });
    refuse({ ...conforme(), exclusionsBloquantes: -2 });
    refuse({ ...conforme(), risquesCritiquesFragiles: -1 });
    refuse({ ...conforme(), incoherencesArbre: 0.5 });
    refuse({ ...conforme(), hypotheses: [h("a", null), h("a", null)] });
    refuse({ ...conforme(), hypotheses: [h("a", null, { parentId: "absent" })] });
    refuse({
      ...conforme(),
      hypotheses: [h("a", null, { parentId: "b" }), h("b", null, { parentId: "a" })],
    });
  });
});

describe("sectionsDeLaNote", () => {
  it("variante exécutive et détaillée ; l'exécutive est incluse dans la détaillée", () => {
    const executive = sectionsDeLaNote("executive");
    const detaillee = sectionsDeLaNote("detaillee");
    expect(executive).toEqual([
      "recommandation",
      "synthese",
      "verdicts",
      "risques",
      "marche",
      "filtrage_es",
      "plan_100_jours",
      "ajustements",
    ]);
    expect(detaillee).toEqual([
      "recommandation",
      "synthese",
      "cadrage",
      "verdicts",
      "analyses",
      "chaine_valeur",
      "risques",
      "signaux",
      "marche",
      "sensibilite",
      "filtrage_es",
      "plan_100_jours",
      "ajustements",
      "sources",
    ]);
    for (const s of executive) expect(detaillee).toContain(s);
    // Même ordre relatif.
    expect(detaillee.filter((s) => executive.includes(s))).toEqual(executive);
  });

  it("variante inconnue", () => {
    expect(() => sectionsDeLaNote("courte" as never)).toThrow(ErreurDueDiligence);
  });
});
