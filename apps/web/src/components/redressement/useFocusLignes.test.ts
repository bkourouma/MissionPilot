import { describe, expect, it } from "vitest";
import { indexFocusApresRetrait } from "./useFocusLignes";

describe("indexFocusApresRetrait", () => {
  it("donne le focus à la ligne qui a pris la place de la ligne retirée", () => {
    expect(indexFocusApresRetrait(1, 3)).toBe(1);
  });
  it("revient à la précédente quand la dernière est retirée", () => {
    expect(indexFocusApresRetrait(3, 3)).toBe(2);
  });
  it("ne cible rien quand la liste est vide", () => {
    expect(indexFocusApresRetrait(0, 0)).toBeNull();
  });
});
