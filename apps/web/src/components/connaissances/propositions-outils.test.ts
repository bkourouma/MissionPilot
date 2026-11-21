import { describe, expect, it } from "vitest";
import { libelleStatutProposition } from "./propositions-outils";

describe("libelleStatutProposition", () => {
  it("traduit les cinq statuts en français et en anglais", () => {
    expect(libelleStatutProposition("en_revue", "fr")).toBe("en revue");
    expect(libelleStatutProposition("en_revue", "en")).toBe("under review");
    expect(libelleStatutProposition("publiee", "fr")).toBe("publiée");
    expect(libelleStatutProposition("refusee", "en")).toBe("refused");
  });

  it("rend une valeur inconnue sans la masquer", () => {
    expect(libelleStatutProposition("autre", "fr")).toBe("autre");
  });
});
