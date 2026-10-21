import { describe, expect, it } from "vitest";
import { synthetiserApercu, type BriqueApercuEntree } from "./apercu";

const b = (p: Partial<BriqueApercuEntree> & { code: string }): BriqueApercuEntree => ({
  etape_code: "e1",
  active: true,
  classe_risque: "R1",
  temps_type_jours: null,
  ...p,
});

describe("synthetiserApercu", () => {
  it("renvoie une synthèse vide pour des entrées vides", () => {
    expect(synthetiserApercu([], [])).toEqual({
      briques_actives: 0,
      briques_inactives: 0,
      briques_par_classe: { R0: 0, R1: 0, R2: 0, R3: 0 },
      classe_max: null,
      briques_quatre_yeux: 0,
      briques_signature: 0,
      temps_type_total_jours: 0,
      temps_par_etape: [],
      briques_sans_temps: [],
      elements_actifs_par_type: {},
    });
  });

  it("synthétise les briques actives seulement", () => {
    const s = synthetiserApercu(
      [
        b({ code: "z", etape_code: "e2", classe_risque: "R3", temps_type_jours: 0.1 }),
        b({ code: "a", etape_code: "e1", classe_risque: "R0", temps_type_jours: 0.2 }),
        b({ code: "m", etape_code: "e1", classe_risque: "R2", temps_type_jours: 1.25 }),
        b({ code: "k", etape_code: "e3", classe_risque: "R1" }),
        b({ code: "c", etape_code: "e1", classe_risque: "R3" }),
        b({ code: "off", active: false, classe_risque: "R3", temps_type_jours: 50 }),
      ],
      [],
    );
    expect(s.briques_actives).toBe(5);
    expect(s.briques_inactives).toBe(1);
    expect(s.briques_par_classe).toEqual({ R0: 1, R1: 1, R2: 1, R3: 2 });
    expect(s.classe_max).toBe("R3");
    expect(s.briques_quatre_yeux).toBe(2);
    expect(s.briques_signature).toBe(2);
    expect(s.temps_type_total_jours).toBe(1.55);
    expect(s.temps_par_etape).toEqual([
      { etape_code: "e1", jours: 1.45 },
      { etape_code: "e2", jours: 0.1 },
      { etape_code: "e3", jours: 0 },
    ]);
    expect(s.briques_sans_temps).toEqual(["c", "k"]);
  });

  it("additionne sans erreur flottante", () => {
    const s = synthetiserApercu(
      [0.1, 0.2, 0.7, 0.07].map((t, i) => b({ code: `b${i}`, temps_type_jours: t })),
      [],
    );
    expect(s.temps_type_total_jours).toBe(1.07);
    expect(s.temps_par_etape).toEqual([{ etape_code: "e1", jours: 1.07 }]);
  });

  it("classe_max est null sans brique active, et R1/R2 n'exigent ni quatre yeux ni signature", () => {
    expect(synthetiserApercu([b({ code: "x", active: false })], []).classe_max).toBeNull();
    const s = synthetiserApercu([b({ code: "x", classe_risque: "R2" })], []);
    expect(s.classe_max).toBe("R2");
    expect(s.briques_quatre_yeux).toBe(0);
    expect(s.briques_signature).toBe(0);
  });

  it("compte les éléments actifs par type, clés triées", () => {
    const s = synthetiserApercu(
      [],
      [
        { type: "livrable", actif: true },
        { type: "item", actif: true },
        { type: "item", actif: true },
        { type: "item", actif: false },
        { type: "document", actif: false },
      ],
    );
    expect(Object.keys(s.elements_actifs_par_type)).toEqual(["item", "livrable"]);
    expect(s.elements_actifs_par_type).toEqual({ item: 2, livrable: 1 });
  });

  it("est déterministe et indépendant de l'ordre des entrées", () => {
    const briques = [
      b({ code: "b", etape_code: "e2", temps_type_jours: 2 }),
      b({ code: "a", etape_code: "e1", temps_type_jours: 1, classe_risque: "R3" }),
    ];
    const s1 = synthetiserApercu(briques, [{ type: "item", actif: true }]);
    expect(synthetiserApercu([...briques].reverse(), [{ type: "item", actif: true }])).toEqual(s1);
  });
});
