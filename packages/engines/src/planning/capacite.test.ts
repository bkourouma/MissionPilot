import { describe, expect, it } from "vitest";
import {
  type Affectation,
  capacite,
  etatCharge,
  joursAffectesSurPeriode,
  tauxOccupation,
} from "./capacite";
import { planDeCharge, semainesCouvrant, surcharges } from "./plan-de-charge";
import { sommerJours } from "./unites";

const SEMAINE = { debut: "2024-01-01", fin: "2024-01-07" };

function aff(
  partiel: Partial<Affectation> & Pick<Affectation, "debut" | "fin" | "joursAlloues">,
): Affectation {
  return { id: "a", personneId: "p", tacheId: "t", ...partiel };
}

describe("capacité (PLN-06, PLN-07)", () => {
  it("compte les jours ouvrés hors week-end et fériés", () => {
    expect(capacite(SEMAINE)).toBe(5);
    expect(capacite(SEMAINE, { feries: ["2024-01-01"] })).toBe(4);
  });

  it("déduit les congés, y compris les demi-journées", () => {
    expect(capacite(SEMAINE, {}, [{ debut: "2024-01-03", fin: "2024-01-03" }])).toBe(4);
    expect(
      capacite(SEMAINE, {}, [{ debut: "2024-01-04", fin: "2024-01-05", fractionJour: 0.5 }]),
    ).toBe(4);
  });

  it("ignore un congé posé un jour non ouvré et plafonne les chevauchements", () => {
    expect(capacite(SEMAINE, {}, [{ debut: "2024-01-06", fin: "2024-01-07" }])).toBe(5);
    const doublons = [
      { debut: "2024-01-02", fin: "2024-01-02" },
      { debut: "2024-01-02", fin: "2024-01-02", fractionJour: 0.5 },
    ];
    expect(capacite(SEMAINE, {}, doublons)).toBe(4);
    // Congé un jour férié : le jour n'est retiré qu'une fois.
    expect(
      capacite(SEMAINE, { feries: ["2024-01-01"] }, [{ debut: "2024-01-01", fin: "2024-01-01" }]),
    ).toBe(4);
  });

  it("applique le temps partiel", () => {
    expect(capacite(SEMAINE, {}, [], 80)).toBe(4);
    expect(capacite(SEMAINE, {}, [{ debut: "2024-01-01", fin: "2024-01-01" }], 50)).toBe(2);
    expect(capacite(SEMAINE, {}, [], 0)).toBe(0);
  });

  it("refuse les paramètres invalides", () => {
    expect(() => capacite({ debut: "2024-01-07", fin: "2024-01-01" })).toThrow(/inversée/);
    expect(() => capacite(SEMAINE, {}, [], 120)).toThrow(/Temps de travail/);
    expect(() => capacite(SEMAINE, {}, [], Number.NaN)).toThrow(RangeError);
    expect(() =>
      capacite(SEMAINE, {}, [{ debut: "2024-01-02", fin: "2024-01-02", fractionJour: 0 }]),
    ).toThrow(/Fraction/);
    expect(() => capacite(SEMAINE, {}, [{ debut: "2024-01-03", fin: "2024-01-02" }])).toThrow(
      /inversée/,
    );
  });
});

describe("jours affectés au prorata", () => {
  const dixJours = aff({ joursAlloues: 10, debut: "2024-01-01", fin: "2024-01-12" });

  it("répartit selon les jours ouvrés de la période", () => {
    expect(joursAffectesSurPeriode(dixJours, SEMAINE)).toBe(5);
    expect(joursAffectesSurPeriode(dixJours, { debut: "2024-01-08", fin: "2024-01-14" })).toBe(5);
    expect(joursAffectesSurPeriode(dixJours, { debut: "2024-01-03", fin: "2024-01-05" })).toBe(3);
    expect(joursAffectesSurPeriode(dixJours, { debut: "2024-02-01", fin: "2024-02-07" })).toBe(0);
  });

  it("tient compte des fériés du calendrier", () => {
    const cal = { feries: ["2024-01-01"] };
    // 9 jours ouvrés : 4 la première semaine.
    expect(joursAffectesSurPeriode(dixJours, SEMAINE, cal)).toBe(4.44);
  });

  it("conserve exactement le total sur des périodes contiguës", () => {
    const a = aff({ joursAlloues: 10, debut: "2024-01-01", fin: "2024-01-03" });
    const parJour = ["2024-01-01", "2024-01-02", "2024-01-03"].map((d) =>
      joursAffectesSurPeriode(a, { debut: d, fin: d }),
    );
    expect(parJour).toEqual([3.33, 3.34, 3.33]);
    expect(sommerJours(parJour)).toBe(10);
  });

  it("rattache une affectation sans jour ouvré à sa date de début", () => {
    const weekEnd = aff({ joursAlloues: 2, debut: "2024-01-06", fin: "2024-01-07" });
    expect(joursAffectesSurPeriode(weekEnd, SEMAINE)).toBe(2);
    expect(joursAffectesSurPeriode(weekEnd, { debut: "2024-01-07", fin: "2024-01-07" })).toBe(0);
  });

  it("refuse des jours alloués invalides", () => {
    expect(() =>
      joursAffectesSurPeriode(
        aff({ joursAlloues: -1, debut: "2024-01-01", fin: "2024-01-02" }),
        SEMAINE,
      ),
    ).toThrow(/Jours alloués/);
  });
});

describe("occupation et état de charge", () => {
  it("calcule le taux d'occupation sans division par zéro", () => {
    expect(tauxOccupation(4, 5)).toBe(0.8);
    expect(tauxOccupation(5, 6)).toBe(0.8333);
    expect(tauxOccupation(2, 3)).toBe(0.6667);
    expect(tauxOccupation(1, 0)).toBeNull();
  });

  it("classe la charge", () => {
    expect(etatCharge(5, 5)).toBe("normal");
    expect(etatCharge(5.5, 5)).toBe("surcharge");
    expect(etatCharge(2, 5)).toBe("sous_occupation");
    expect(etatCharge(2.5, 5)).toBe("normal");
    expect(etatCharge(0, 0)).toBe("indisponible");
    expect(etatCharge(1, 0)).toBe("surcharge");
    expect(etatCharge(5.5, 5, { surchargePct: 110, sousOccupationPct: 20 })).toBe("normal");
  });
});

describe("plan de charge collaborateurs × semaines", () => {
  it("découpe en semaines ISO", () => {
    expect(semainesCouvrant({ debut: "2024-01-03", fin: "2024-01-10" })).toEqual([
      { debut: "2024-01-01", fin: "2024-01-07" },
      { debut: "2024-01-08", fin: "2024-01-14" },
    ]);
    expect(semainesCouvrant({ debut: "2024-01-07", fin: "2024-01-07" })).toHaveLength(1);
  });

  it("construit la grille et signale les surcharges", () => {
    const grille = planDeCharge({
      periode: { debut: "2024-01-03", fin: "2024-01-10" },
      calendrier: {},
      collaborateurs: [
        { id: "awa" },
        {
          id: "koffi",
          tempsTravailPct: 50,
          calendrier: { feries: ["2024-01-01"] },
          absences: [{ debut: "2024-01-02", fin: "2024-01-02" }],
        },
        { id: "moussa" },
      ],
      affectations: [
        aff({
          id: "a1",
          personneId: "awa",
          joursAlloues: 10,
          debut: "2024-01-01",
          fin: "2024-01-12",
        }),
        aff({
          id: "a2",
          personneId: "koffi",
          joursAlloues: 3,
          debut: "2024-01-02",
          fin: "2024-01-05",
        }),
      ],
    });
    const [awa, koffi, moussa] = grille;
    expect(
      awa?.cellules.map((c) => [c.capacite, c.joursAffectes, c.tauxOccupation, c.etat]),
    ).toEqual([
      [5, 5, 1, "normal"],
      [5, 5, 1, "normal"],
    ]);
    // Koffi : 4 ouvrés − 1 congé = 3, à 50 % → 1,5 j ; 3 j affectés.
    expect(koffi?.cellules[0]).toMatchObject({
      capacite: 1.5,
      joursAffectes: 3,
      tauxOccupation: 2,
      etat: "surcharge",
    });
    expect(moussa?.cellules[0]?.etat).toBe("sous_occupation");
    expect(surcharges(grille)).toEqual([
      { collaborateurId: "koffi", semaine: "2024-01-01", joursAffectes: 3, capacite: 1.5 },
    ]);
  });

  it("utilise des seuils et un calendrier par défaut", () => {
    const grille = planDeCharge({
      periode: SEMAINE,
      collaborateurs: [{ id: "x" }],
      affectations: [],
      seuils: { surchargePct: 100, sousOccupationPct: 0 },
    });
    expect(grille[0]?.cellules[0]?.etat).toBe("normal");
  });
});
