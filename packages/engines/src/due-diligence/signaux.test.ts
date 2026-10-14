import { describe, expect, it } from "vitest";
import { ErreurDueDiligence } from "./erreurs";
import { signauxApplicables, type SignalBibliotheque } from "./signaux";

const sig = (
  id: string,
  secteurCode: string | null,
  paysCode: string | null,
  gravite: SignalBibliotheque["gravite"],
  actif = true,
): SignalBibliotheque => ({ id, secteurCode, paysCode, famille: "pays", gravite, actif });

describe("signauxApplicables", () => {
  const signaux = [
    sig("s1", null, null, "modere"),
    sig("s2", "citi_a", null, "eleve"),
    sig("s3", "cacao", "ci", "critique"),
    sig("s4", "citi_c", null, "critique"),
    sig("s5", null, "uemoa", "faible"),
    sig("s6", "citi_a", null, "critique", false),
  ];

  it("spécificité, gravité puis id ; exclut les inactifs et hors contexte", () => {
    const r = signauxApplicables(
      { secteurCodes: ["cacao", "citi_a"], paysCodes: ["ci", "uemoa"] },
      signaux,
    );
    expect(r.map((x) => [x.id, x.specificite])).toEqual([
      ["s3", 2],
      ["s2", 1],
      ["s5", 1],
      ["s1", 0],
    ]);
    expect(r[0]).toEqual({ id: "s3", specificite: 2, famille: "pays", gravite: "critique" });
  });

  it("contexte vide : seuls les signaux sans critère", () => {
    const r = signauxApplicables({ secteurCodes: [], paysCodes: [] }, signaux);
    expect(r.map((x) => x.id)).toEqual(["s1"]);
  });

  it("égalité de spécificité et de gravité : tri par id", () => {
    const r = signauxApplicables({ secteurCodes: [], paysCodes: [] }, [
      sig("b", null, null, "eleve"),
      sig("a", null, null, "eleve"),
    ]);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("entrées invalides", () => {
    const ctx = { secteurCodes: [], paysCodes: [] };
    expect(() =>
      signauxApplicables(ctx, [sig("a", null, null, "faible"), sig("a", null, null, "faible")]),
    ).toThrow(ErreurDueDiligence);
    expect(() =>
      signauxApplicables(ctx, [{ ...sig("a", null, null, "faible"), famille: "x" as never }]),
    ).toThrow(ErreurDueDiligence);
    expect(() =>
      signauxApplicables(ctx, [{ ...sig("a", null, null, "faible"), gravite: "x" as never }]),
    ).toThrow(ErreurDueDiligence);
  });
});
