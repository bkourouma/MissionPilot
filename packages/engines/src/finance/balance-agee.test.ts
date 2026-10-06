import { describe, expect, it } from "vitest";
import { balanceAgee, balanceAgeeParClient, trancheAge, type Creance } from "./balance-agee";
import { montant } from "./monnaie";

const xof = (v: number) => montant(v, "XOF");
const creance = (
  factureId: string,
  clientId: string,
  dateEcheance: string,
  solde: number,
): Creance => ({
  factureId,
  clientId,
  dateEmission: "2026-06-01",
  dateEcheance,
  solde: xof(solde),
});

// Date de référence : 2026-10-06.
const creances = [
  creance("F1", "C1", "2026-10-20", 100_000), // pas encore échue
  creance("F2", "C1", "2026-10-06", 200_000), // âge 0
  creance("F3", "C2", "2026-09-06", 300_000), // âge 30
  creance("F4", "C2", "2026-09-05", 400_000), // âge 31
  creance("F5", "C1", "2026-07-08", 500_000), // âge 90
  creance("F6", "C2", "2026-07-07", 600_000), // âge 91
  creance("F7", "C2", "2026-01-01", 0), // soldée : ignorée
];

describe("trancheAge", () => {
  it.each([
    [-1, "nonEchu"],
    [0, "j0a30"],
    [30, "j0a30"],
    [31, "j31a60"],
    [60, "j31a60"],
    [61, "j61a90"],
    [90, "j61a90"],
    [91, "plus90"],
  ])("âge %d → %s", (age, tranche) => {
    expect(trancheAge(age)).toBe(tranche);
  });
});

describe("balanceAgee (FIN-09)", () => {
  it("classe les soldes par tranche à la date de référence", () => {
    expect(balanceAgee(creances, { dateReference: "2026-10-06", devise: "XOF" })).toEqual({
      nonEchu: xof(100_000),
      j0a30: xof(500_000),
      j31a60: xof(400_000),
      j61a90: xof(500_000),
      plus90: xof(600_000),
      total: xof(2_100_000),
    });
  });

  it("peut vieillir depuis la date d'émission", () => {
    // Émission 2026-06-01 → âge 127 jours au 2026-10-06 : tout en plus de 90 jours.
    const b = balanceAgee(creances, {
      dateReference: "2026-10-06",
      devise: "XOF",
      base: "emission",
    });
    expect(b.plus90).toEqual(xof(2_100_000));
    expect(b.nonEchu).toEqual(xof(0));
  });

  it("refuse une créance dans une autre devise", () => {
    const eur = [{ ...creance("F", "C", "2026-10-01", 1), solde: montant(1, "EUR") }];
    expect(() => balanceAgee(eur, { dateReference: "2026-10-06", devise: "XOF" })).toThrow(
      expect.objectContaining({ code: "DEVISE_DIFFERENTE" }),
    );
  });

  it("détaille par client, trié", () => {
    const parClient = balanceAgeeParClient(creances, {
      dateReference: "2026-10-06",
      devise: "XOF",
    });
    expect(parClient.map((c) => c.clientId)).toEqual(["C1", "C2"]);
    expect(parClient[0]?.balance.total).toEqual(xof(800_000));
    expect(parClient[1]?.balance.total).toEqual(xof(1_300_000));
  });
});
