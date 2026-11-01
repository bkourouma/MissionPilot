import { describe, expect, it } from "vitest";
import {
  choisirFactureASolderDemo,
  dateEmissionAdmissibleDemo,
  ordonnerSourcesFactureDemo,
  type FactureOuverteDemo,
  type SourceFactureDemo,
} from "./index";

const JOUR = "2026-11-04";
const LUNDI = "2026-11-02";

function echeance(
  id: string,
  missionId: string,
  statut: "a_facturer" | "prevue",
  datePrevue: string,
): SourceFactureDemo {
  return { type: "echeance", missionId, echeanceId: id, statut, datePrevue };
}

const regie = (missionId: string): SourceFactureDemo => ({ type: "regie", missionId });

const ids = (s: readonly SourceFactureDemo[]): string[] =>
  s.map((x) => (x.type === "echeance" ? x.echeanceId : `regie:${x.missionId}`));

describe("ordre d'essai des sources de facture (DT16)", () => {
  it("rotation : la mission jamais facturée, puis la moins récemment facturée", () => {
    const sources = [
      echeance("e1", "m1", "a_facturer", "2026-10-20"),
      regie("m2"),
      echeance("e3p", "m3", "prevue", "2026-10-01"),
      echeance("e3a", "m3", "a_facturer", "2026-10-15"),
    ];
    const dernieres = { m1: "2026-10-26", m3: "2026-10-05" };
    const attendu = ["regie:m2", "e3a", "e3p", "e1"];
    expect(ids(ordonnerSourcesFactureDemo(sources, dernieres, JOUR))).toEqual(attendu);
    const melangees = [...sources].reverse();
    expect(ids(ordonnerSourcesFactureDemo(melangees, dernieres, JOUR))).toEqual(attendu);
  });

  it("dans une mission : à facturer, prévue, régie, puis date, puis id", () => {
    const sources = [
      regie("m1"),
      echeance("p2", "m1", "prevue", "2026-10-01"),
      echeance("p1", "m1", "prevue", "2026-10-01"),
      echeance("a1", "m1", "a_facturer", "2026-10-30"),
      echeance("p0", "m1", "prevue", "2026-09-15"),
    ];
    expect(ids(ordonnerSourcesFactureDemo(sources, {}, JOUR))).toEqual([
      "a1",
      "p0",
      "p1",
      "p2",
      "regie:m1",
    ]);
  });

  it("écarte une échéance future, garde celle du jour même", () => {
    const sources = [
      echeance("futur", "m1", "prevue", "2026-11-05"),
      echeance("jour", "m1", "prevue", JOUR),
    ];
    expect(ids(ordonnerSourcesFactureDemo(sources, {}, JOUR))).toEqual(["jour"]);
  });

  it("refuse une date invalide", () => {
    expect(() => ordonnerSourcesFactureDemo([], {}, "2026-11-31")).toThrow(RangeError);
    const invalide = [echeance("x", "m1", "prevue", "2026-02-30")];
    expect(() => ordonnerSourcesFactureDemo(invalide, {}, JOUR)).toThrow(RangeError);
  });
});

describe("date d'émission admissible", () => {
  it("le jour, sauf si une émission de l'exercice lui est postérieure", () => {
    expect(dateEmissionAdmissibleDemo(JOUR, null)).toBe(JOUR);
    expect(dateEmissionAdmissibleDemo(JOUR, JOUR)).toBe(JOUR);
    expect(dateEmissionAdmissibleDemo(JOUR, "2026-10-30")).toBe(JOUR);
    expect(dateEmissionAdmissibleDemo(JOUR, "2026-11-05")).toBeNull();
  });

  it("refuse une date invalide", () => {
    expect(() => dateEmissionAdmissibleDemo("2026-13-01", null)).toThrow(RangeError);
    expect(() => dateEmissionAdmissibleDemo(JOUR, "demain")).toThrow(RangeError);
  });
});

function facture(
  id: string,
  dateEmission: string,
  emiseParJob: boolean,
  soldeMineur = 1000,
): FactureOuverteDemo {
  return { id, dateEmission, soldeMineur, emiseParJob };
}

describe("facture à solder (DT8)", () => {
  const jobAncienne = facture("f1", "2026-10-10", true);
  const semee = facture("s1", "2026-09-01", false);
  const jobRecente = facture("f2", "2026-10-26", true);
  const jobTropRecente = facture("f3", "2026-10-30", true);
  const deLaSemaine = facture("s2", LUNDI, false);
  const soldee = facture("f0", "2026-09-01", true, 0);

  it("priorité 1 : facture du job d'au moins 21 jours, la plus ancienne", () => {
    const toutes = [semee, jobRecente, jobAncienne, jobTropRecente, deLaSemaine, soldee];
    expect(choisirFactureASolderDemo(toutes, LUNDI, JOUR)).toBe("f1");
    const plusVieille = facture("f-1", "2026-10-01", true);
    expect(choisirFactureASolderDemo([jobAncienne, plusVieille], LUNDI, JOUR)).toBe("f-1");
    const pile21 = facture("f21", "2026-10-14", true);
    expect(choisirFactureASolderDemo([semee, pile21], LUNDI, JOUR)).toBe("f21");
  });

  it("priorité 2 : facture d'une autre origine émise avant le lundi", () => {
    expect(choisirFactureASolderDemo([jobRecente, semee, deLaSemaine], LUNDI, JOUR)).toBe("s1");
    const memeJour = [facture("b", "2026-09-01", false), facture("a", "2026-09-01", false)];
    expect(choisirFactureASolderDemo(memeJour, LUNDI, JOUR)).toBe("a");
  });

  it("priorité 3 : facture du job d'au moins 7 jours", () => {
    expect(choisirFactureASolderDemo([jobTropRecente, jobRecente], LUNDI, JOUR)).toBe("f2");
    const pile7 = facture("f7", "2026-10-28", true);
    expect(choisirFactureASolderDemo([pile7], LUNDI, JOUR)).toBe("f7");
  });

  it("facture de la semaine, soldée ou trop récente : aucune", () => {
    const aucune = [jobTropRecente, deLaSemaine, soldee];
    expect(choisirFactureASolderDemo(aucune, LUNDI, JOUR)).toBeNull();
    expect(choisirFactureASolderDemo([], LUNDI, JOUR)).toBeNull();
  });

  it("refuse une date invalide", () => {
    expect(() => choisirFactureASolderDemo([], "2026-11-31", JOUR)).toThrow(RangeError);
    expect(() => choisirFactureASolderDemo([], LUNDI, "jeudi")).toThrow(RangeError);
  });
});
