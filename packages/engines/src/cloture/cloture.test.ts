import { describe, expect, it } from "vitest";
import { decisionCloture, ErreurCloture, type EntreeCloture } from "./cloture";

const e = (p: Partial<EntreeCloture> & { controle: string }): EntreeCloture => ({
  actif: true,
  bloquant: true,
  nombre_ecarts: 0,
  derogation: false,
  ...p,
});

describe("decisionCloture", () => {
  it("autorise une check-list vide ou entièrement verte", () => {
    expect(decisionCloture([])).toEqual({ lignes: [], autorisee: true, bloquants: [] });
    const d = decisionCloture([e({ controle: "a" }), e({ controle: "b", bloquant: false })]);
    expect(d.autorisee).toBe(true);
    expect(d.lignes.map((l) => l.etat)).toEqual(["conforme", "conforme"]);
  });

  it("bloque sur un item bloquant non conforme et liste les codes dans l'ordre", () => {
    const d = decisionCloture([
      e({ controle: "a", nombre_ecarts: 2 }),
      e({ controle: "b" }),
      e({ controle: "c", nombre_ecarts: null }),
    ]);
    expect(d.autorisee).toBe(false);
    expect(d.bloquants).toEqual(["a", "c"]);
    expect(d.lignes[0]).toMatchObject({ etat: "bloque", bloque: true, nombre_ecarts: 2 });
  });

  it("un item non bloquant non conforme est un avertissement", () => {
    const d = decisionCloture([e({ controle: "a", bloquant: false, nombre_ecarts: 3 })]);
    expect(d.autorisee).toBe(true);
    expect(d.lignes[0]?.etat).toBe("avertissement");
  });

  it("une dérogation lève le blocage d'un item bloquant seulement", () => {
    const d = decisionCloture([
      e({ controle: "a", nombre_ecarts: 1, derogation: true }),
      e({ controle: "b", nombre_ecarts: 1, bloquant: false, derogation: true }),
    ]);
    expect(d.autorisee).toBe(true);
    expect(d.lignes.map((l) => l.etat)).toEqual(["deroge", "avertissement"]);
  });

  it("ignore un item inactif, même avec des écarts", () => {
    const d = decisionCloture([e({ controle: "a", actif: false, nombre_ecarts: 9 })]);
    expect(d.autorisee).toBe(true);
    expect(d.lignes[0]).toMatchObject({ etat: "inactif", bloque: false });
  });

  it("refuse une entrée invalide", () => {
    for (const entrees of [
      [e({ controle: "" })],
      [e({ controle: "a" }), e({ controle: "a" })],
      [e({ controle: "a", nombre_ecarts: -1 })],
      [e({ controle: "a", nombre_ecarts: 1.5 })],
    ]) {
      expect(() => decisionCloture(entrees)).toThrow(ErreurCloture);
    }
  });
});
