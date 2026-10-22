import { describe, expect, it } from "vitest";
import { doitSauterTick } from "./ActualisationAuto";

describe("doitSauterTick", () => {
  it("saute le tick tant que la transition précédente est en cours", () => {
    expect(doitSauterTick(true)).toBe(true);
  });
  it("laisse passer le tick quand aucune transition n'est en cours", () => {
    expect(doitSauterTick(false)).toBe(false);
  });
});
