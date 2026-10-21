import { describe, expect, it } from "vitest";
import {
  briqueContradicteurDeclaree,
  chargeBriqueContradicteur,
  messagePreparation,
  NIVEAUX_CONTRADICTEUR,
} from "./contradicteur-agent";

describe("préparation de l'agent contradicteur (AGT-06)", () => {
  it("construit la déclaration de la brique, jamais en N4", () => {
    expect(chargeBriqueContradicteur("N2")).toEqual({
      brique_code: "revue_contradictoire",
      agent_code: "contradicteur",
      classe_risque: "R1",
      niveau_max: "N2",
    });
    expect(chargeBriqueContradicteur("N4")).toBeNull();
    expect(chargeBriqueContradicteur("")).toBeNull();
    expect(NIVEAUX_CONTRADICTEUR).not.toContain("N4");
  });

  it("repère la brique déjà déclarée", () => {
    expect(briqueContradicteurDeclaree([{ code: "autre" }])).toBe(false);
    expect(briqueContradicteurDeclaree([{ code: "autre" }, { code: "revue_contradictoire" }])).toBe(
      true,
    );
  });

  it("annonce la préparation en français", () => {
    expect(messagePreparation({ prompt: { version: 3 }, jeu_essai_cree: true })).toBe(
      "Prompt de la revue contradictoire prêt (version 3), jeu d'essai recommandé enregistré. Lancez maintenant l'évaluation de non-régression.",
    );
    expect(messagePreparation({})).toContain("jeu d'essai déjà enregistré");
  });
});
