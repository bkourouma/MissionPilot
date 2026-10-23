import { describe, expect, it } from "vitest";
import {
  COMBINAISONS_MAX_BORNE,
  PRATIQUES_MAX_COMBINAISONS_BORNE,
  commentaireExplicationCorpsSchema,
  explicationNotationQuerySchema,
} from "./notation-augmentee";

describe("requête d'explication (NOT-12)", () => {
  it("lit la version, la cible et les bornes des combinaisons (chaînes d'URL)", () => {
    expect(
      explicationNotationQuerySchema.parse({
        version: "2",
        cible: "B",
        pratiques_max: "4",
        combinaisons_max: "3",
      }),
    ).toEqual({ version: 2, cible: "B", pratiques_max: 4, combinaisons_max: 3 });
    expect(explicationNotationQuerySchema.parse({})).toEqual({});
  });

  it("refuse les bornes hors du moteur et les paramètres inconnus", () => {
    for (const q of [
      { pratiques_max: "0" },
      { pratiques_max: String(PRATIQUES_MAX_COMBINAISONS_BORNE + 1) },
      { pratiques_max: "1.5" },
      { combinaisons_max: "0" },
      { combinaisons_max: String(COMBINAISONS_MAX_BORNE + 1) },
      { cible: "E" },
      { inconnu: "1" },
    ]) {
      expect(explicationNotationQuerySchema.safeParse(q).success, JSON.stringify(q)).toBe(false);
    }
  });
});

describe("corps du commentaire d'explication (NOT-12)", () => {
  it("accepte un corps vide, une version, une cible ; refuse le reste", () => {
    expect(commentaireExplicationCorpsSchema.parse({})).toEqual({});
    expect(commentaireExplicationCorpsSchema.parse({ version: 2, cible: "A" })).toEqual({
      version: 2,
      cible: "A",
    });
    for (const c of [{ version: 0 }, { version: "2" }, { cible: "F" }, { x: 1 }]) {
      expect(commentaireExplicationCorpsSchema.safeParse(c).success, JSON.stringify(c)).toBe(false);
    }
  });
});
