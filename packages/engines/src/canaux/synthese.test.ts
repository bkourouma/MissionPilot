import { describe, expect, it } from "vitest";
import {
  compteMessage,
  composerSyntheseDirigeant,
  ErreurCanaux,
  type FaitsSynthese,
} from "./index";

const faits = (ecart: Partial<FaitsSynthese> = {}): FaitsSynthese => ({
  kpiRouges: 0,
  kpiOranges: 0,
  jalonsAValider: 0,
  questionnairesACompleter: 0,
  piecesAttendues: 0,
  documentsASigner: 0,
  ...ecart,
});

describe("composerSyntheseDirigeant (SPEC §18.2)", () => {
  it("2 KPI rouges, 1 orange, 1 jalon, 2 questionnaires, 1 document : 3 points, 4 décisions", () => {
    const s = composerSyntheseDirigeant(
      faits({
        kpiRouges: 2,
        kpiOranges: 1,
        jalonsAValider: 1,
        questionnairesACompleter: 2,
        piecesAttendues: 0,
        documentsASigner: 1,
      }),
    );
    expect(s.pointsAttention).toBe(3);
    expect(s.decisionsAttendues).toBe(4);
    expect(s.vide).toBe(false);
    // Lignes d'affichage dans l'ordre, seulement celles qui ont un nombre positif.
    expect(s.sections.map((x) => [x.code, x.nombre])).toEqual([
      ["kpi_rouges", 2],
      ["kpi_oranges", 1],
      ["jalons_a_valider", 1],
      ["questionnaires_a_completer", 2],
      ["documents_a_signer", 1],
    ]);
    expect(s.sections.map((x) => x.groupe)).toEqual([
      "point_attention",
      "point_attention",
      "decision",
      "decision",
      "decision",
    ]);
    for (const section of s.sections) expect(section.lien).toMatch(/^\/portail\//);
  });

  it("tout à zéro : vide, aucune ligne", () => {
    expect(composerSyntheseDirigeant(faits())).toEqual({
      pointsAttention: 0,
      decisionsAttendues: 0,
      vide: true,
      sections: [],
    });
  });

  it("vide seulement si les deux nombres sont nuls", () => {
    expect(composerSyntheseDirigeant(faits({ piecesAttendues: 1 })).vide).toBe(false);
    expect(composerSyntheseDirigeant(faits({ kpiOranges: 1 })).vide).toBe(false);
  });

  it("kpiRouges = 1 200 : 1 200 en calcul, 999 dans le message", () => {
    const s = composerSyntheseDirigeant(faits({ kpiRouges: 1200 }));
    expect(s.pointsAttention).toBe(1200);
    expect(compteMessage(s.pointsAttention)).toBe(999);
    expect(compteMessage(998)).toBe(998);
  });

  it("libellés au singulier et au pluriel", () => {
    const un = composerSyntheseDirigeant(faits({ kpiRouges: 1, piecesAttendues: 1 }));
    expect(un.sections.map((x) => x.libelle)).toEqual(["Indicateur en rouge", "Pièce attendue"]);
    const deux = composerSyntheseDirigeant(
      faits({ kpiRouges: 2, kpiOranges: 2, piecesAttendues: 2, jalonsAValider: 2 }),
    );
    expect(deux.sections.map((x) => x.libelle)).toEqual([
      "Indicateurs en rouge",
      "Indicateurs en orange",
      "Jalons à valider",
      "Pièces attendues",
    ]);
  });

  it("refuse un compteur hors de 0 à 99 999 ou non entier", () => {
    for (const mauvais of [-1, 100_000, 1.5, Number.NaN]) {
      expect(() => composerSyntheseDirigeant(faits({ kpiRouges: mauvais }))).toThrowError(
        ErreurCanaux,
      );
    }
    expect(composerSyntheseDirigeant(faits({ kpiRouges: 99_999 })).pointsAttention).toBe(99_999);
    expect(() => compteMessage(-1)).toThrowError(ErreurCanaux);
    expect(() => compteMessage(1.2)).toThrowError(ErreurCanaux);
  });
});
