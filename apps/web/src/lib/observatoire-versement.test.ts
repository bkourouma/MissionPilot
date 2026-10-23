import { describe, expect, it } from "vitest";
import {
  MESSAGE_ATTENTE_VERSEMENT_ASSOCIE,
  MESSAGE_RIEN_A_VERSER,
  messageAgregatsIndisponibles,
  messageVersement,
  nombreVerse,
} from "./observatoire-versement";

describe("messageVersement", () => {
  it("dit la vérité quand rien n'est versé", () => {
    expect(messageVersement(0)).toBe(MESSAGE_RIEN_A_VERSER);
    expect(messageVersement(-1)).toBe(MESSAGE_RIEN_A_VERSER);
    expect(messageVersement(Number.NaN)).toBe(MESSAGE_RIEN_A_VERSER);
  });
  it("accorde au singulier et au pluriel", () => {
    expect(messageVersement(1)).toBe("1 élément versé ; il sera retenu le mois suivant.");
    expect(messageVersement(3)).toBe("3 éléments versés ; ils seront retenus le mois suivant.");
  });
});

describe("nombreVerse", () => {
  it("lit versees, 0 sinon", () => {
    expect(nombreVerse({ versees: 4 })).toBe(4);
    expect(nombreVerse({})).toBe(0);
    expect(nombreVerse(null)).toBe(0);
    expect(nombreVerse({ versees: "4" })).toBe(0);
  });
});

describe("messageAgregatsIndisponibles", () => {
  const code = "OBSERVATOIRE_CONTRIBUTION_REQUISE";
  it("ne donne pas la consigne à qui ne peut pas verser", () => {
    expect(messageAgregatsIndisponibles(code, "Versez d'abord…", false)).toBe(
      MESSAGE_ATTENTE_VERSEMENT_ASSOCIE,
    );
  });
  it("garde le message de l'API pour l'associé et les autres codes", () => {
    expect(messageAgregatsIndisponibles(code, "Versez d'abord…", true)).toBe("Versez d'abord…");
    expect(messageAgregatsIndisponibles("AUTRE", "x", false)).toBe("x");
    expect(messageAgregatsIndisponibles(undefined, "x", false)).toBe("x");
  });
});
