import { describe, expect, it } from "vitest";
import { montant } from "./monnaie";
import {
  agregerRentabilite,
  calculerMarge,
  carnetCommandes,
  consommationBudgetaire,
  delaiMoyenEncaissement,
  ecartTerminaison,
  encoursMission,
  encoursPortefeuille,
  tauxFacturabilite,
  tauxRealisation,
  valeurTemps,
  verifierJours,
  type RentabiliteMission,
} from "./rentabilite";

const xof = (v: number) => montant(v, "XOF");

describe("calculerMarge", () => {
  it("applique la formule du PRD", () => {
    // (10 000 000 − 6 000 000 − 500 000 − 1 000 000) / 10 000 000 = 25 %
    expect(
      calculerMarge({
        honoraires: xof(10_000_000),
        coutsInternes: xof(6_000_000),
        deboursNonRefactures: xof(500_000),
        sousTraitance: xof(1_000_000),
      }),
    ).toEqual({ marge: xof(2_500_000), taux: 0.25 });
  });

  it("rend une marge négative et protège la division par zéro", () => {
    const perte = calculerMarge({
      honoraires: xof(3_000_000),
      coutsInternes: xof(4_000_000),
      deboursNonRefactures: xof(0),
      sousTraitance: xof(0),
    });
    expect(perte).toEqual({ marge: xof(-1_000_000), taux: -0.3333 });
    const sansHonoraires = calculerMarge({
      honoraires: xof(0),
      coutsInternes: xof(100),
      deboursNonRefactures: xof(0),
      sousTraitance: xof(0),
    });
    expect(sansHonoraires.taux).toBeNull();
  });

  it("refuse des composantes en devises différentes", () => {
    expect(() =>
      calculerMarge({
        honoraires: xof(1),
        coutsInternes: montant(1, "EUR"),
        deboursNonRefactures: xof(0),
        sousTraitance: xof(0),
      }),
    ).toThrow(expect.objectContaining({ code: "DEVISE_DIFFERENTE" }));
  });
});

describe("indicateurs", () => {
  it("valorise les temps ligne à ligne", () => {
    const temps = [
      { jours: 2.5, tauxJournalier: xof(400_000) },
      { jours: 0.5, tauxJournalier: xof(333_333) }, // 166 666,5 → 166 667
    ];
    expect(valeurTemps(temps, "XOF")).toEqual(xof(1_166_667));
    expect(valeurTemps([], "XOF")).toEqual(xof(0));
  });

  it("calcule le taux de réalisation", () => {
    expect(tauxRealisation(xof(9_000_000), xof(10_000_000))).toBe(0.9);
    expect(tauxRealisation(xof(9_000_000), xof(0))).toBeNull();
    expect(() => tauxRealisation(xof(1), montant(1, "EUR"))).toThrow(
      expect.objectContaining({ code: "DEVISE_DIFFERENTE" }),
    );
  });

  it("sépare encours de production et facturé d'avance", () => {
    const encours = encoursMission(xof(6_000_000), xof(4_000_000));
    expect(encours).toEqual({ encoursProduction: xof(2_000_000), factureDAvance: xof(0) });
    const avance = encoursMission(xof(3_000_000), xof(5_000_000));
    expect(avance).toEqual({ encoursProduction: xof(0), factureDAvance: xof(2_000_000) });
    // Pas de compensation entre missions au niveau du cabinet.
    expect(encoursPortefeuille([encours, avance], "XOF")).toEqual({
      encoursProduction: xof(2_000_000),
      factureDAvance: xof(2_000_000),
    });
  });

  it("calcule facturabilité et consommation budgétaire", () => {
    expect(tauxFacturabilite(15, 20)).toBe(0.75);
    expect(tauxFacturabilite(0, 0)).toBeNull();
    expect(consommationBudgetaire(26.5, 50)).toBe(0.53);
    expect(consommationBudgetaire(1, 0)).toBeNull();
  });

  it("calcule le délai moyen d'encaissement, simple ou pondéré", () => {
    const factures = [
      { dateEmission: "2026-01-01", dateEncaissement: "2026-01-31", montant: xof(1_000_000) }, // 30 j
      { dateEmission: "2026-01-01", dateEncaissement: "2026-03-02", montant: xof(3_000_000) }, // 60 j
    ];
    expect(delaiMoyenEncaissement(factures)).toBe(45);
    expect(delaiMoyenEncaissement(factures, "montant")).toBe(52.5); // (30×1 + 60×3) / 4
    expect(delaiMoyenEncaissement([])).toBeNull();
    expect(delaiMoyenEncaissement([], "montant")).toBeNull();
    const troisFactures = [10, 10, 11].map((j) => ({
      dateEmission: "2026-01-01",
      dateEncaissement: `2026-01-${String(1 + j).padStart(2, "0")}`,
      montant: xof(1),
    }));
    expect(delaiMoyenEncaissement(troisFactures)).toBe(10.33);
    const melange = [
      factures[0],
      { ...factures[1], montant: montant(1, "EUR") },
    ] as typeof factures;
    expect(() => delaiMoyenEncaissement(melange, "montant")).toThrow(
      expect.objectContaining({ code: "DEVISE_DIFFERENTE" }),
    );
  });

  it("calcule le carnet de commandes", () => {
    const missions = [
      { honorairesSignes: xof(10_000_000), honorairesProduits: xof(4_000_000) },
      { honorairesSignes: xof(5_000_000), honorairesProduits: xof(6_000_000) }, // dépassée : 0
    ];
    expect(carnetCommandes(missions, "XOF")).toEqual(xof(6_000_000));
  });

  it("calcule l'écart à terminaison (exemple du PRD : +2,5 j, +5 %)", () => {
    expect(
      ecartTerminaison(
        { jours: 50, montant: xof(20_000_000) },
        { jours: 52.5, montant: xof(21_000_000) },
      ),
    ).toEqual({ ecartJours: 2.5, ecartMontant: xof(1_000_000), ecartRelatifJours: 0.05 });
    expect(
      ecartTerminaison({ jours: 0, montant: xof(0) }, { jours: 0.3, montant: xof(0) }),
    ).toEqual({
      ecartJours: 0.3,
      ecartMontant: xof(0),
      ecartRelatifJours: null,
    });
  });

  it("refuse un nombre de jours invalide", () => {
    expect(() => verifierJours(Number.NaN, "Test")).toThrow(/Test/);
    expect(() => verifierJours(-0.5, "Test")).toThrow(
      expect.objectContaining({ code: "NOMBRE_INVALIDE" }),
    );
    expect(() => verifierJours(0, "Test")).not.toThrow();
  });
});

describe("agregerRentabilite (FIN-12)", () => {
  const mission = (
    missionId: string,
    clientId: string,
    honoraires: number,
    couts: number,
  ): RentabiliteMission => ({
    missionId,
    clientId,
    type: "audit",
    associeId: "A1",
    honoraires: xof(honoraires),
    coutsInternes: xof(couts),
    deboursNonRefactures: xof(0),
    sousTraitance: xof(0),
  });
  const missions = [
    mission("M2", "C2", 4_000_000, 3_000_000),
    mission("M1", "C1", 10_000_000, 6_000_000),
    mission("M3", "C1", 2_000_000, 2_000_000),
  ];

  it("agrège par client, trie par clé et recalcule le taux sur les sommes", () => {
    const parClient = agregerRentabilite(missions, "client");
    expect(parClient.map((g) => g.cle)).toEqual(["C1", "C2"]);
    expect(parClient[0]).toMatchObject({
      nombreMissions: 2,
      honoraires: xof(12_000_000),
      coutsInternes: xof(8_000_000),
      marge: xof(4_000_000),
      taux: 0.3333, // et non la moyenne de 40 % et 0 %
    });
  });

  it("agrège par mission, type et associé", () => {
    expect(agregerRentabilite(missions, "mission").map((g) => g.cle)).toEqual(["M1", "M2", "M3"]);
    const parType = agregerRentabilite(missions, "type");
    expect(parType).toHaveLength(1);
    expect(parType[0]?.marge).toEqual(xof(5_000_000));
    expect(agregerRentabilite(missions, "associe")[0]?.nombreMissions).toBe(3);
    expect(agregerRentabilite([], "client")).toEqual([]);
  });
});
