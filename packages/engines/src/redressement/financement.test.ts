import { describe, expect, it } from "vitest";
import { ErreurRedressement } from "./erreurs";
import {
  type EntreeFinancement,
  type LigneFinancement,
  LIGNES_FINANCEMENT_MAX,
  calculerPlanFinancement,
  periodesFinancement,
  proposerLignesFinancement,
  validerLignesFinancement,
} from "./financement";

const M = 1_000_000;
const ligne = (
  periode: number,
  sens: "emploi" | "ressource",
  nature: string,
  montant: number,
): LigneFinancement => ({ periode, sens, nature, montant });

const entree = (surcharges: Partial<EntreeFinancement> = {}): EntreeFinancement => ({
  dateDebut: "2026-07-01",
  typePeriode: "annee",
  nombrePeriodes: 3,
  lignes: [
    ligne(1, "emploi", "remboursement_dettes_accords", 100 * M),
    ligne(1, "emploi", "besoin_fonds_roulement", 50 * M),
    ligne(1, "ressource", "apport_associes", 120 * M),
    ligne(2, "emploi", "investissements", 80 * M),
    ligne(2, "ressource", "nouveaux_concours_bancaires", 30 * M),
    ligne(2, "ressource", "autofinancement", 10 * M),
    ligne(3, "ressource", "cessions_actifs", 60 * M),
  ],
  ...surcharges,
});

describe("periodesFinancement", () => {
  it("années : du 1er juillet au 30 juin", () => {
    expect(periodesFinancement(entree())).toEqual([
      { periode: 1, debut: "2026-07-01", fin: "2027-06-30" },
      { periode: 2, debut: "2027-07-01", fin: "2028-06-30" },
      { periode: 3, debut: "2028-07-01", fin: "2029-06-30" },
    ]);
  });
  it("semestres, février bissextile", () => {
    const p = periodesFinancement({
      dateDebut: "2027-09-01",
      typePeriode: "semestre",
      nombrePeriodes: 2,
    });
    expect(p).toEqual([
      { periode: 1, debut: "2027-09-01", fin: "2028-02-29" },
      { periode: 2, debut: "2028-03-01", fin: "2028-08-31" },
    ]);
  });
  it("refuse : jour autre que le 1er, date impossible, hors 2000-2100, 0 ou 9 périodes, type inconnu", () => {
    const base = { dateDebut: "2026-07-01", typePeriode: "annee", nombrePeriodes: 1 } as const;
    for (const c of [
      { ...base, dateDebut: "2026-07-02" },
      { ...base, dateDebut: "2026-02-30" },
      { ...base, dateDebut: "1999-12-01" },
      { ...base, dateDebut: "2101-01-01" },
      { ...base, nombrePeriodes: 0 },
      { ...base, nombrePeriodes: 9 },
      { ...base, typePeriode: "trimestre" as never },
    ]) {
      expect(() => periodesFinancement(c)).toThrowError(ErreurRedressement);
    }
  });
});

describe("calculerPlanFinancement", () => {
  const r = calculerPlanFinancement(entree());

  it("totaux, solde, statut et couverture par période", () => {
    expect(r.periodes.map((p) => [p.emplois, p.ressources, p.solde, p.statut])).toEqual([
      [150 * M, 120 * M, -30 * M, "insuffisance"],
      [80 * M, 40 * M, -40 * M, "insuffisance"],
      [0, 60 * M, 60 * M, "equilibre"],
    ]);
    expect(r.periodes.map((p) => p.couverturePb)).toEqual([8_000, 5_000, null]);
  });

  it("cumuls, couverture totale, insuffisance maximale cumulée", () => {
    expect(r.periodes.map((p) => p.soldeCumule)).toEqual([-30 * M, -70 * M, -10 * M]);
    expect(r.periodes.map((p) => p.cumulEmplois)).toEqual([150 * M, 230 * M, 230 * M]);
    expect(r.periodes[2]?.couvertureCumuleePb).toBe(9_565);
    expect(r.periodes[2]?.statutCumule).toBe("insuffisance");
    expect(r.totaux).toEqual({ emplois: 230 * M, ressources: 220 * M, solde: -10 * M });
    expect(r.couvertureTotalePb).toBe(9_565);
    expect(r.periodesInsuffisance).toEqual([1, 2]);
    expect(r.premierePeriodeInsuffisance).toBe(1);
    expect(r.insuffisanceMaximaleCumulee).toBe(70 * M);
    expect(r.equilibre).toBe(false);
  });

  it("détail par nature dans l'ordre des listes, lignes de même nature additionnées", () => {
    const p = calculerPlanFinancement(
      entree({
        lignes: [
          ligne(1, "ressource", "autofinancement", 5 * M),
          ligne(1, "emploi", "investissements", 3 * M),
          ligne(1, "emploi", "investissements", 4 * M),
          ligne(1, "emploi", "remboursement_dettes_accords", 1 * M),
        ],
      }),
    );
    expect(p.periodes[0]?.parNature).toEqual([
      { sens: "emploi", nature: "remboursement_dettes_accords", montant: 1 * M },
      { sens: "emploi", nature: "investissements", montant: 7 * M },
      { sens: "ressource", nature: "autofinancement", montant: 5 * M },
    ]);
  });

  it("solde nul = equilibre ; plan sans ligne = équilibré, couverture nulle", () => {
    const e = calculerPlanFinancement(
      entree({
        lignes: [
          ligne(1, "emploi", "investissements", M),
          ligne(1, "ressource", "autofinancement", M),
        ],
      }),
    );
    expect(e.periodes[0]).toMatchObject({ solde: 0, statut: "equilibre", couverturePb: 10_000 });
    expect(e.equilibre).toBe(true);
    expect(e.insuffisanceMaximaleCumulee).toBe(0);
    const vide = calculerPlanFinancement(entree({ lignes: [] }));
    expect(vide.couvertureTotalePb).toBeNull();
    expect(vide.equilibre).toBe(true);
  });

  it("exact avec 200 lignes au plafond de 10^13", () => {
    const gros = 10_000_000_000_000;
    const p = calculerPlanFinancement(
      entree({
        nombrePeriodes: 1,
        lignes: Array.from({ length: LIGNES_FINANCEMENT_MAX }, () =>
          ligne(1, "emploi", "investissements", gros),
        ),
      }),
    );
    expect(p.totaux.emplois).toBe(2_000_000_000_000_000);
    expect(p.totaux.solde).toBe(-2_000_000_000_000_000);
    expect(p.insuffisanceMaximaleCumulee).toBe(2_000_000_000_000_000);
  });

  it("valide les lignes : période hors plan, sens, nature du sens, montant, nombre", () => {
    const mauvaises: unknown[] = [
      ligne(4, "emploi", "investissements", M),
      ligne(0, "emploi", "investissements", M),
      ligne(1, "emploi", "apport_associes", M),
      ligne(1, "ressource", "investissements", M),
      ligne(1, "emploi", "investissements", 0),
      ligne(1, "emploi", "investissements", 1.5),
      ligne(1, "emploi", "investissements", 10_000_000_000_001),
      { periode: 1, sens: "autre", nature: "investissements", montant: M },
    ];
    for (const l of mauvaises) {
      expect(() => validerLignesFinancement([l as LigneFinancement], 3)).toThrowError(
        ErreurRedressement,
      );
    }
    expect(() =>
      validerLignesFinancement(
        Array.from({ length: LIGNES_FINANCEMENT_MAX + 1 }, () =>
          ligne(1, "emploi", "investissements", 1),
        ),
        3,
      ),
    ).toThrowError(ErreurRedressement);
  });
});

describe("proposerLignesFinancement", () => {
  const cadre = { dateDebut: "2026-10-01", typePeriode: "semestre", nombrePeriodes: 2 } as const;
  const ech = (id: string, date: string, montant: number) => ({
    echeanceId: id,
    creancierId: "c1",
    date,
    montant,
  });

  it("regroupe les échéances par période et propose le besoin de trésorerie en emploi", () => {
    const p = proposerLignesFinancement({
      ...cadre,
      besoin: { montant: 28 * M, date: "2026-10-26" },
      echeances: [
        ech("e3", "2027-03-31", 3 * M),
        ech("e1", "2026-11-15", 10 * M),
        ech("e2", "2027-02-01", 5 * M),
        ech("e4", "2027-04-01", 7 * M),
        ech("avant", "2026-09-30", 1 * M),
        ech("apres", "2027-10-01", 2 * M),
      ],
    });
    expect(p.lignes).toEqual([
      {
        periode: 1,
        sens: "emploi",
        nature: "besoin_fonds_roulement",
        montant: 28 * M,
        origine: "tresorerie",
        nombreEcheances: 0,
      },
      {
        periode: 1,
        sens: "emploi",
        nature: "remboursement_dettes_accords",
        montant: 18 * M,
        origine: "accords",
        nombreEcheances: 3,
      },
      {
        periode: 2,
        sens: "emploi",
        nature: "remboursement_dettes_accords",
        montant: 7 * M,
        origine: "accords",
        nombreEcheances: 1,
      },
    ]);
    expect(p.anterieures).toBe(1);
    expect(p.ulterieures).toBe(1);
    expect(p.besoinHorsPlan).toBe(false);
  });

  it("sans besoin ni échéance : aucune ligne ; besoin nul ignoré ; besoin hors plan signalé", () => {
    expect(proposerLignesFinancement({ ...cadre, besoin: null, echeances: [] }).lignes).toEqual([]);
    expect(
      proposerLignesFinancement({
        ...cadre,
        besoin: { montant: 0, date: "2026-10-26" },
        echeances: [],
      }).lignes,
    ).toEqual([]);
    const h = proposerLignesFinancement({
      ...cadre,
      besoin: { montant: M, date: "2025-01-06" },
      echeances: [],
    });
    expect(h.besoinHorsPlan).toBe(true);
    expect(h.lignes).toEqual([]);
    const apres = proposerLignesFinancement({
      ...cadre,
      besoin: { montant: M, date: "2028-01-03" },
      echeances: [],
    });
    expect(apres.besoinHorsPlan).toBe(true);
  });

  it("refuse un cadre invalide, un montant ou une date invalides", () => {
    expect(() =>
      proposerLignesFinancement({ ...cadre, dateDebut: "2026-10-15", besoin: null, echeances: [] }),
    ).toThrowError(ErreurRedressement);
    expect(() =>
      proposerLignesFinancement({ ...cadre, besoin: null, echeances: [ech("x", "2026-11-01", 0)] }),
    ).toThrowError(ErreurRedressement);
    expect(() =>
      proposerLignesFinancement({
        ...cadre,
        besoin: null,
        echeances: [ech("x", "pas-une-date", 1)],
      }),
    ).toThrowError(ErreurRedressement);
    expect(() =>
      proposerLignesFinancement({
        ...cadre,
        besoin: { montant: 1.5, date: "2026-10-26" },
        echeances: [],
      }),
    ).toThrowError(ErreurRedressement);
  });
});
