import { describe, expect, it } from "vitest";
import { copierTexte } from "./presse-papiers";

describe("copierTexte", () => {
  it("copie et renvoie true", async () => {
    let copie = "";
    const ok = await copierTexte("abc", {
      clipboard: {
        writeText: async (t) => {
          copie = t;
        },
      },
    });
    expect(ok).toBe(true);
    expect(copie).toBe("abc");
  });

  it("renvoie false quand l'API est absente ou refuse", async () => {
    expect(await copierTexte("abc", {})).toBe(false);
    expect(await copierTexte("abc", undefined)).toBe(false);
    expect(
      await copierTexte("abc", {
        clipboard: {
          writeText: async () => {
            throw new Error("NotAllowedError");
          },
        },
      }),
    ).toBe(false);
  });
});
