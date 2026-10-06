import { describe, expect, it } from "vitest";
// Même règle de profondeur que le moteur (import par chemin relatif, comme generique.test.ts).
import { profondeurCondition, type Condition } from "../../../engines/src/index";
import {
  conditionAffichageSchema,
  conditionTropProfonde,
  PROFONDEUR_MAX_CONDITION,
  type ConditionAffichage,
} from "./schemas";

/*
 * Borne de profondeur des conditions d'affichage, AVANT la récursion de Zod :
 * une condition très imbriquée est refusée sans débordement de pile.
 */

const feuille: ConditionAffichage = { op: "vide", question: "q1" };

/** n niveaux : (n - 1) « non » autour d'une comparaison, construits sans récursion. */
function nonImbriques(n: number): ConditionAffichage {
  let c: ConditionAffichage = feuille;
  for (let i = 1; i < n; i++) c = { op: "non", condition: c };
  return c;
}

describe("profondeur des conditions d'affichage", () => {
  it("même limite que le moteur : 5 niveaux acceptés, 6 refusés", () => {
    expect(PROFONDEUR_MAX_CONDITION).toBe(5);
    const formes: ConditionAffichage[] = [
      feuille,
      nonImbriques(5),
      nonImbriques(6),
      { op: "et", conditions: [feuille, nonImbriques(4)] },
      { op: "ou", conditions: [feuille, { op: "et", conditions: [nonImbriques(4)] }] },
      { op: "et", conditions: [] },
    ];
    for (const c of formes) {
      const attendu = profondeurCondition(c as Condition) > PROFONDEUR_MAX_CONDITION;
      expect(conditionTropProfonde(c)).toBe(attendu);
    }
    expect(conditionAffichageSchema.safeParse(nonImbriques(5)).success).toBe(true);
    const six = conditionAffichageSchema.safeParse(nonImbriques(6));
    expect(six.success).toBe(false);
    expect(six.error?.issues[0]?.message).toMatch(/trop imbriquée/);
  });

  it("200 000 « non » imbriqués : refus sans RangeError ; valeurs quelconques tolérées", () => {
    const profonde = nonImbriques(200_000);
    expect(() => conditionAffichageSchema.safeParse(profonde)).not.toThrow();
    expect(conditionAffichageSchema.safeParse(profonde).success).toBe(false);
    for (const v of [null, 42, "x", [], { op: "non" }, { op: "et", conditions: "x" }]) {
      expect(conditionTropProfonde(v)).toBe(false);
      expect(conditionAffichageSchema.safeParse(v).success).toBe(false);
    }
  });

  it("une structure cyclique (appel programmatique) s'arrête à la borne", () => {
    const cycle: { op: string; condition?: unknown } = { op: "non" };
    cycle.condition = cycle;
    expect(conditionTropProfonde(cycle)).toBe(true);
  });
});
