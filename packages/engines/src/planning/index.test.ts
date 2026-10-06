import { describe, expect, it } from "vitest";
import * as planning from "./index";

describe("point d'entrée planning", () => {
  it("ré-exporte les moteurs de chaque module", () => {
    for (const nom of [
      "versJourUTC",
      "heuresVersJours",
      "joursOuvresEntre",
      "feriesParDefaut",
      "calculerSuivi",
      "agregerArborescence",
      "capacite",
      "planDeCharge",
      "decalerPhase",
      "estDateSaisieModifiable",
    ]) {
      expect(typeof (planning as Record<string, unknown>)[nom]).toBe("function");
    }
  });
});
