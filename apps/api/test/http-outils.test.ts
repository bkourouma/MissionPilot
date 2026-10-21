import { describe, expect, it } from "vitest";
import { paramsId } from "../src/http/outils.js";

const ID = "00000000-0000-4000-8000-000000000001";

describe("paramsId", () => {
  it("accepte un identifiant UUID seul", () => {
    expect(paramsId.parse({ id: ID })).toEqual({ id: ID });
  });
  it("refuse un identifiant qui n'est pas un UUID", () => {
    expect(paramsId.safeParse({ id: "42" }).success).toBe(false);
  });
  it("refuse toute clé supplémentaire (schéma strict)", () => {
    expect(paramsId.safeParse({ id: ID, autreId: ID }).success).toBe(false);
  });
});
