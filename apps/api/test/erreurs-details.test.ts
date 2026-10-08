import { describe, expect, it } from "vitest";
import { AppError, DETAILS_MAX_ELEMENTS, detailsPublics } from "../src/errors.js";

/*
 * `details` d'une AppError (gestionnaire unique d'app.ts) : liste blanche de
 * champs, tableaux tronqués ; tout autre champ (trace, valeur, requête SQL…)
 * n'atteint jamais le client. Le cas de bout en bout (GARDE_VIOLEE avec
 * `details.violations`) est couvert par `qualite-suivis.test.ts`.
 */
describe("detailsPublics", () => {
  it("ne garde que les champs de la liste blanche", () => {
    const e = new AppError(409, "X", "m", {
      violations: [{ code: "QUATRE_YEUX" }],
      ...({ secret: "cle", sql: "SELECT 1", detail: "Key (x)=(y)" } as Record<string, unknown>),
    });
    expect(detailsPublics(e.details)).toEqual({ violations: [{ code: "QUATRE_YEUX" }] });
  });

  it("rien à transmettre : undefined (pas de champ details vide)", () => {
    expect(detailsPublics(undefined)).toBeUndefined();
    expect(detailsPublics({})).toBeUndefined();
    expect(detailsPublics({ autre: 1 })).toBeUndefined();
    expect(detailsPublics({ erreurs: undefined })).toBeUndefined();
  });

  it("tronque un tableau à DETAILS_MAX_ELEMENTS", () => {
    const erreurs = Array.from({ length: DETAILS_MAX_ELEMENTS + 50 }, (_, i) => ({ ligne: i }));
    const d = detailsPublics({ erreurs, manquants: ["a"] });
    expect((d?.erreurs as unknown[]).length).toBe(DETAILS_MAX_ELEMENTS);
    expect(d?.manquants).toEqual(["a"]);
  });

  it("une propriété héritée n'est pas lue", () => {
    const proto = { violations: ["hérité"] };
    const details = Object.create(proto) as Record<string, unknown>;
    expect(detailsPublics(details)).toBeUndefined();
  });
});
