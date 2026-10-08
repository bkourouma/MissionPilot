import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import { formaterDate } from "./format";
import {
  cheminLienNotation,
  cheminNotationsProposees,
  libelleNotation,
  libelleScoreNotation,
  listeDimensions,
  mentionLien,
  messageLienNotation,
  optionsNotations,
  peutLierNotationPlan,
  peutLireNotationPlan,
  type NotationPubliee,
} from "./plan-diagnostic";

const notation: NotationPubliee = {
  notation_id: "n1",
  version_id: "v1",
  numero: 2,
  mission_id: "m1",
  mission_intitule: "Notation de compétitivité",
  publiee_le: "2027-03-12T10:15:00Z",
  score: 72.5,
  classe: "B",
  notable: true,
  forces: [{ dimension: "pilotage", libelle: "Pilotage", score: 82 }],
  faiblesses: [],
};

describe("diagnostic : notation publiée liée (chiffres du moteur)", () => {
  it("libellés de la notation et du score", () => {
    expect(libelleNotation(notation)).toBe(
      `Version 2 de « Notation de compétitivité », publiée le ${formaterDate("2027-03-12T10:15:00Z")}`,
    );
    expect(libelleNotation({ ...notation, publiee_le: null })).toBe(
      "Version 2 de « Notation de compétitivité »",
    );
    expect(libelleScoreNotation(notation)).toMatch(/^72,5 sur 100 — Classe B/);
    expect(libelleScoreNotation({ ...notation, notable: false })).toContain("non calculable");
    expect(libelleScoreNotation({ ...notation, score: null })).toContain("non calculable");
  });

  it("dimensions et options", () => {
    expect(listeDimensions(notation.forces)).toBe("Pilotage (82,0)");
    expect(listeDimensions([])).toBe("aucune");
    expect(optionsNotations({ elements: [notation] })).toEqual([
      { valeur: "v1", libelle: `${libelleNotation(notation)} — ${libelleScoreNotation(notation)}` },
    ]);
  });

  it("mention du lien", () => {
    expect(
      mentionLien({
        lie_par: { id: "u", nom: "Awa Koné" },
        lie_le: "2027-03-12T10:15:00Z",
        accessible: true,
        notation,
      }),
    ).toMatch(/^Lié par Awa Koné le /);
  });

  it("droits d'affichage", () => {
    expect(peutLireNotationPlan(["expert_metier"])).toBe(true);
    expect(peutLireNotationPlan(["gestionnaire"])).toBe(false);
    expect(peutLierNotationPlan(["consultant"], false)).toBe(true);
    expect(peutLierNotationPlan(["consultant"], true)).toBe(false);
    expect(peutLierNotationPlan(["expert_metier"], false)).toBe(false);
  });

  it("messages et chemins", () => {
    expect(
      messageLienNotation(
        new ErreurApi("NOTATION_NON_PUBLIEE", "Seule une notation publiée.", 409),
      ),
    ).toBe("Seule une notation publiée.");
    expect(messageLienNotation(new ErreurApi("INTROUVABLE", "x", 404))).toContain("rechargez");
    expect(messageLienNotation(new ErreurApi("CONFLIT", "Déjà liée.", 409))).toBe("Déjà liée.");
    expect(messageLienNotation(new ErreurApi("ACCES_REFUSE", "x", 403))).toContain("rôle");
    expect(cheminLienNotation("p")).toBe("/api/plans/p/diagnostic/notation");
    expect(cheminNotationsProposees("p")).toBe("/api/plans/p/diagnostic/notations-publiees");
  });
});
