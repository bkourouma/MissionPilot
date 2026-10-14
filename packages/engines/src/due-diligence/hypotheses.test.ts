import { describe, expect, it } from "vitest";
import type { LectureSolidite } from "../preuves/solidite";
import { ErreurDueDiligence } from "./erreurs";
import {
  controlerArbreHypotheses,
  HYPOTHESES_PROFONDEUR_MAX,
  indicationVerdict,
  MIN_ASSERTIONS_SOUTIEN_PAR_DEFAUT,
  type AssertionDeHypothese,
  type NoeudHypothese,
} from "./hypotheses";

let compteur = 0;
const s = (lecture: LectureSolidite): AssertionDeHypothese => ({
  id: `s${(compteur += 1)}`,
  sens: "soutient",
  lecture,
});
const c = (lecture: LectureSolidite): AssertionDeHypothese => ({
  id: `c${(compteur += 1)}`,
  sens: "contredit",
  lecture,
});

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurDueDiligence);
    return (e as ErreurDueDiligence).code;
  }
  return undefined;
}

describe("indicationVerdict", () => {
  it("constantes", () => {
    expect(MIN_ASSERTIONS_SOUTIEN_PAR_DEFAUT).toBe(2);
    expect(HYPOTHESES_PROFONDEUR_MAX).toBe(4);
  });

  it("(1) aucune assertion : non concluante", () => {
    expect(indicationVerdict([])).toEqual({
      indication: "non_concluante",
      raison: "AUCUNE_ASSERTION",
      conflit: false,
      soutien: { solide: 0, etayee: 0, fragile: 0 },
      contre: { solide: 0, etayee: 0, fragile: 0 },
    });
  });

  it("(2) deux soutiens solides : confirmée", () => {
    const r = indicationVerdict([s("solide"), s("solide")]);
    expect(r.indication).toBe("confirmee");
    expect(r.raison).toBe("SOUTIEN_SUFFISANT_SANS_CONTRE");
    expect(r.soutien.solide).toBe(2);
  });

  it("(3) un soutien solide seul : non concluante", () => {
    const r = indicationVerdict([s("solide")]);
    expect(r).toMatchObject({ indication: "non_concluante", raison: "SOUTIEN_INSUFFISANT" });
  });

  it("(4) un solide et un étayé : confirmée", () => {
    expect(indicationVerdict([s("solide"), s("etayee")]).indication).toBe("confirmee");
  });

  it("(5) un contre solide, aucun soutien solide : infirmée", () => {
    const r = indicationVerdict([c("solide"), s("etayee"), s("etayee")]);
    expect(r).toMatchObject({
      indication: "infirmee",
      raison: "CONTRE_SOLIDE_SANS_SOUTIEN_SOLIDE",
      conflit: false,
    });
  });

  it("(6) soutien solide et contre solide : conflit", () => {
    const r = indicationVerdict([s("solide"), c("solide")]);
    expect(r).toMatchObject({
      indication: "non_concluante",
      raison: "CONFLIT_SOLIDE",
      conflit: true,
    });
  });

  it("(7) deux soutiens solides et un contre étayé : non concluante", () => {
    const r = indicationVerdict([s("solide"), s("solide"), c("etayee")]);
    expect(r).toMatchObject({ indication: "non_concluante", raison: "CONTRE_ETAYE_OU_SOLIDE" });
  });

  it("(8) trois soutiens fragiles : non concluante", () => {
    const r = indicationVerdict([s("fragile"), s("fragile"), s("fragile")]);
    expect(r).toMatchObject({ indication: "non_concluante", raison: "SOUTIEN_INSUFFISANT" });
    expect(r.soutien.fragile).toBe(3);
  });

  it("(9) deux soutiens solides et un contre fragile : confirmée", () => {
    const r = indicationVerdict([s("solide"), s("solide"), c("fragile")]);
    expect(r.indication).toBe("confirmee");
    expect(r.contre.fragile).toBe(1);
  });

  it("(10) trois étayés sans solide : non concluante", () => {
    const r = indicationVerdict([s("etayee"), s("etayee"), s("etayee")]);
    expect(r).toMatchObject({ indication: "non_concluante", raison: "SOUTIEN_INSUFFISANT" });
  });

  it("(11) deux contre solides, aucun soutien : infirmée", () => {
    expect(indicationVerdict([c("solide"), c("solide")]).indication).toBe("infirmee");
  });

  it("(12) minimum de soutien à 1 : un seul soutien solide confirme", () => {
    expect(indicationVerdict([s("solide")], { minAssertionsSoutien: 1 }).indication).toBe(
      "confirmee",
    );
    expect(indicationVerdict([s("solide")], { minAssertionsSoutien: 3 }).indication).toBe(
      "non_concluante",
    );
  });

  it("erreurs", () => {
    expect(code(() => indicationVerdict([], { minAssertionsSoutien: 0 }))).toBe(
      "PARAMETRE_INVALIDE",
    );
    expect(code(() => indicationVerdict([], { minAssertionsSoutien: 21 }))).toBe(
      "PARAMETRE_INVALIDE",
    );
    expect(code(() => indicationVerdict([], { minAssertionsSoutien: 1.5 }))).toBe(
      "PARAMETRE_INVALIDE",
    );
    const a: AssertionDeHypothese = { id: "x", sens: "soutient", lecture: "solide" };
    expect(code(() => indicationVerdict([a, a]))).toBe("ENTREE_INVALIDE");
    expect(code(() => indicationVerdict([{ ...a, sens: "autre" as never }]))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => indicationVerdict([{ ...a, lecture: "forte" as never }]))).toBe(
      "ENTREE_INVALIDE",
    );
  });
});

const n = (
  id: string,
  parentId: string | null,
  extra: Partial<NoeudHypothese> = {},
): NoeudHypothese => ({
  id,
  parentId,
  retiree: false,
  verdict: null,
  enAttente: false,
  ...extra,
});

describe("controlerArbreHypotheses", () => {
  it("racine confirmée avec un enfant infirmé : incohérence ; nœud retiré et en attente", () => {
    const r = controlerArbreHypotheses([
      n("R", null, { verdict: "confirmee" }),
      n("A", "R", { verdict: "confirmee" }),
      n("B", "R", { verdict: "infirmee" }),
      n("C", null, { enAttente: true }),
      n("D", null, { retiree: true, verdict: "confirmee" }),
    ]);
    expect(r).toEqual({
      total: 4,
      racines: 2,
      profondeurMax: 2,
      parEtat: { confirmee: 2, infirmee: 1, non_concluante: 0, ouverte: 0, en_attente: 1 },
      incoherences: [{ noeud: "R", code: "PARENT_CONFIRME_ENFANT_INFIRME" }],
    });
  });

  it("parent infirmé dont tous les enfants sont confirmés", () => {
    const r = controlerArbreHypotheses([
      n("P", null, { verdict: "infirmee" }),
      n("A", "P", { verdict: "confirmee" }),
      n("B", "P", { verdict: "confirmee" }),
    ]);
    expect(r.incoherences).toEqual([{ noeud: "P", code: "PARENT_INFIRME_TOUS_ENFANTS_CONFIRMES" }]);
    // Un enfant non confirmé suffit à lever l'incohérence.
    const ok = controlerArbreHypotheses([
      n("P", null, { verdict: "infirmee" }),
      n("A", "P", { verdict: "confirmee" }),
      n("B", "P"),
    ]);
    expect(ok.incoherences).toEqual([]);
    expect(ok.parEtat.ouverte).toBe(1);
  });

  it("un descendant d'un nœud retiré est retiré ; incohérences triées par id", () => {
    const r = controlerArbreHypotheses([
      n("X", null, { retiree: true }),
      n("Y", "X", { verdict: "infirmee" }),
      n("Z2", null, { verdict: "confirmee" }),
      n("Z2a", "Z2", { verdict: "infirmee" }),
      n("A1", null, { verdict: "confirmee" }),
      n("A1a", "A1", { verdict: "infirmee" }),
    ]);
    expect(r.total).toBe(4);
    expect(r.parEtat.infirmee).toBe(2);
    expect(r.incoherences.map((i) => i.noeud)).toEqual(["A1", "Z2"]);
  });

  it("arbre vide", () => {
    expect(controlerArbreHypotheses([])).toEqual({
      total: 0,
      racines: 0,
      profondeurMax: 0,
      parEtat: { confirmee: 0, infirmee: 0, non_concluante: 0, ouverte: 0, en_attente: 0 },
      incoherences: [],
    });
  });

  it("verdict non concluant compté", () => {
    expect(
      controlerArbreHypotheses([n("A", null, { verdict: "non_concluante" })]).parEtat
        .non_concluante,
    ).toBe(1);
  });

  it("profondeur 4 admise, 5 refusée ; cycle, parent inconnu et doublon refusés", () => {
    const chaine = (longueur: number): NoeudHypothese[] =>
      Array.from({ length: longueur }, (_, i) => n(`h${i}`, i === 0 ? null : `h${i - 1}`));
    expect(controlerArbreHypotheses(chaine(4)).profondeurMax).toBe(4);
    expect(code(() => controlerArbreHypotheses(chaine(5)))).toBe("ARBRE_INVALIDE");
    expect(code(() => controlerArbreHypotheses([n("a", "b"), n("b", "a")]))).toBe("ARBRE_INVALIDE");
    expect(code(() => controlerArbreHypotheses([n("a", "a")]))).toBe("ARBRE_INVALIDE");
    expect(code(() => controlerArbreHypotheses([n("a", "absent")]))).toBe("ARBRE_INVALIDE");
    expect(code(() => controlerArbreHypotheses([n("a", null), n("a", null)]))).toBe(
      "ARBRE_INVALIDE",
    );
  });
});
