import { describe, expect, it } from "vitest";
import {
  type AccordSuivi,
  CATEGORIES_CREANCIER_RED,
  type LignePassif,
  construireEcheancierAccord,
  exigerPaiementAdmissible,
  situationCreancier,
  synthesePassif,
  validerEcheancierAccord,
  verifierAccordContreCreance,
} from "./creanciers";
import { ErreurRedressement } from "./erreurs";

const M = 1_000_000;
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e.code;
    throw e;
  }
  return "AUCUNE";
};

describe("échéancier régulier", () => {
  it("(C1) le reste d'arrondi va à la dernière échéance", () => {
    expect(
      construireEcheancierAccord({
        montantConvenu: 10_000_001,
        nombreEcheances: 3,
        datePremiere: "2026-11-30",
        periodiciteMois: 1,
      }),
    ).toEqual([
      { rang: 1, date: "2026-11-30", montant: 3_333_333 },
      { rang: 2, date: "2026-12-30", montant: 3_333_333 },
      { rang: 3, date: "2027-01-30", montant: 3_333_335 },
    ]);
  });

  it("(C2) dates calculées depuis la date d'origine : 31 janvier, 28 février, 31 mars", () => {
    const e = construireEcheancierAccord({
      montantConvenu: 3000,
      nombreEcheances: 3,
      datePremiere: "2026-01-31",
      periodiciteMois: 1,
    });
    expect(e.map((x) => x.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("un seul versement ; périodicité trimestrielle", () => {
    expect(
      construireEcheancierAccord({
        montantConvenu: 5000,
        nombreEcheances: 1,
        datePremiere: "2026-11-30",
        periodiciteMois: 12,
      }),
    ).toEqual([{ rang: 1, date: "2026-11-30", montant: 5000 }]);
    const t = construireEcheancierAccord({
      montantConvenu: 4000,
      nombreEcheances: 2,
      datePremiere: "2026-11-15",
      periodiciteMois: 3,
    });
    expect(t.map((x) => x.date)).toEqual(["2026-11-15", "2027-02-15"]);
  });

  it("(C2) bornes : 61 échéances, périodicité 0 ou 13, montant 0, date invalide", () => {
    const base = {
      montantConvenu: 100_000,
      nombreEcheances: 3,
      datePremiere: "2026-11-30",
      periodiciteMois: 1,
    };
    expect(code(() => construireEcheancierAccord(base))).toBe("AUCUNE");
    expect(code(() => construireEcheancierAccord({ ...base, nombreEcheances: 60 }))).toBe("AUCUNE");
    expect(code(() => construireEcheancierAccord({ ...base, nombreEcheances: 61 }))).toBe(
      "ECHEANCIER_INVALIDE",
    );
    expect(code(() => construireEcheancierAccord({ ...base, nombreEcheances: 0 }))).toBe(
      "ECHEANCIER_INVALIDE",
    );
    expect(code(() => construireEcheancierAccord({ ...base, periodiciteMois: 0 }))).toBe(
      "ECHEANCIER_INVALIDE",
    );
    expect(code(() => construireEcheancierAccord({ ...base, periodiciteMois: 13 }))).toBe(
      "ECHEANCIER_INVALIDE",
    );
    expect(code(() => construireEcheancierAccord({ ...base, montantConvenu: 0 }))).toBe(
      "ECHEANCIER_INVALIDE",
    );
    expect(code(() => construireEcheancierAccord({ ...base, datePremiere: "2026-02-30" }))).toBe(
      "DATE_INVALIDE",
    );
    expect(code(() => construireEcheancierAccord({ ...base, datePremiere: "1999-12-31" }))).toBe(
      "ECHEANCIER_INVALIDE",
    );
    // Au-delà de 2100 : les bornes de la base.
    expect(
      code(() =>
        construireEcheancierAccord({
          ...base,
          datePremiere: "2100-12-01",
          nombreEcheances: 2,
          periodiciteMois: 2,
        }),
      ),
    ).toBe("ECHEANCIER_INVALIDE");
  });
});

describe("(C3) échéancier explicite", () => {
  it("attribue les rangs 1..n", () => {
    expect(
      validerEcheancierAccord(10 * M, [
        { date: "2026-12-01", montant: 4 * M },
        { date: "2027-01-01", montant: 6 * M },
      ]),
    ).toEqual([
      { rang: 1, date: "2026-12-01", montant: 4 * M },
      { rang: 2, date: "2027-01-01", montant: 6 * M },
    ]);
  });

  it("refuse somme inexacte, dates non croissantes, montant nul, nombre de lignes", () => {
    const l = (date: string, montant: number) => ({ date, montant });
    expect(
      code(() =>
        validerEcheancierAccord(10 * M, [l("2026-12-01", 4 * M), l("2027-01-01", 6 * M - 1)]),
      ),
    ).toBe("ECHEANCIER_INVALIDE");
    expect(
      code(() => validerEcheancierAccord(10 * M, [l("2026-12-01", 4 * M), l("2026-12-01", 6 * M)])),
    ).toBe("ECHEANCIER_INVALIDE");
    expect(
      code(() => validerEcheancierAccord(10 * M, [l("2027-01-01", 4 * M), l("2026-12-01", 6 * M)])),
    ).toBe("ECHEANCIER_INVALIDE");
    expect(
      code(() => validerEcheancierAccord(10 * M, [l("2026-12-01", 0), l("2027-01-01", 10 * M)])),
    ).toBe("ECHEANCIER_INVALIDE");
    expect(code(() => validerEcheancierAccord(10 * M, []))).toBe("ECHEANCIER_INVALIDE");
    expect(code(() => validerEcheancierAccord(0, [l("2026-12-01", 1)]))).toBe(
      "ECHEANCIER_INVALIDE",
    );
    const soixante = Array.from({ length: 60 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      montant: 1,
    }));
    expect(code(() => validerEcheancierAccord(60, soixante))).toBe("AUCUNE");
    expect(code(() => validerEcheancierAccord(61, [...soixante, l("2027-01-01", 1)]))).toBe(
      "ECHEANCIER_INVALIDE",
    );
  });

  it("date inexistante : DATE_INVALIDE", () => {
    expect(code(() => validerEcheancierAccord(1, [{ date: "2026-02-30", montant: 1 }]))).toBe(
      "DATE_INVALIDE",
    );
    expect(code(() => validerEcheancierAccord(1, [{ date: "demain", montant: 1 }]))).toBe(
      "DATE_INVALIDE",
    );
  });
});

describe("(C4) accord contre la créance", () => {
  it("l'accord ne dépasse pas l'encours", () => {
    expect(code(() => verifierAccordContreCreance(100 * M, 100 * M))).toBe("AUCUNE");
    expect(code(() => verifierAccordContreCreance(100 * M + 1, 100 * M))).toBe(
      "ACCORD_SUPERIEUR_CREANCE",
    );
    expect(code(() => verifierAccordContreCreance(0, 100 * M))).toBe("ECHEANCIER_INVALIDE");
    expect(code(() => verifierAccordContreCreance(1, -1))).toBe("ECHEANCIER_INVALIDE");
  });
});

const ECHEANCES_80 = [
  { rang: 1, date: "2026-11-15", montant: 20 * M },
  { rang: 2, date: "2026-12-15", montant: 20 * M },
  { rang: 3, date: "2027-01-15", montant: 20 * M },
  { rang: 4, date: "2027-02-15", montant: 20 * M },
];
const accord = (paiements: AccordSuivi["paiements"], rompu = false): AccordSuivi => ({
  montantConvenu: 80 * M,
  echeances: ECHEANCES_80,
  paiements,
  rompu,
});
const UN_PAIEMENT = [{ date: "2026-11-16", montant: 20 * M }];
const situation = (
  a: AccordSuivi | null,
  dateReference: string,
  echeanceInitiale: string | null = null,
) =>
  situationCreancier({
    principal: 90 * M,
    interets: 10 * M,
    echeanceInitiale,
    accord: a,
    dateReference,
  });

describe("situation d'un créancier", () => {
  it("(C5) accord en retard à la date de référence 2026-12-20", () => {
    const s = situation(accord(UN_PAIEMENT), "2026-12-20");
    expect(s.encoursInitial).toBe(100 * M);
    expect(s.accord).toEqual({
      statut: "en_retard",
      montantConvenu: 80 * M,
      remise: 20 * M,
      totalPaye: 20 * M,
      resteAPayer: 60 * M,
      echeancesEchues: 2,
      montantEchu: 40 * M,
      retard: 20 * M,
      prochaineNonSoldee: { rang: 2, date: "2026-12-15", montantRestant: 20 * M },
      echeancesRestantes: [
        { rang: 2, date: "2026-12-15", montantRestant: 20 * M },
        { rang: 3, date: "2027-01-15", montantRestant: 20 * M },
        { rang: 4, date: "2027-02-15", montantRestant: 20 * M },
      ],
    });
    expect(s.encoursRestant).toBe(60 * M);
    expect(s.echu).toBe(20 * M);
  });

  it("(C6) respecté ; échéance du jour non échue (strict) ; soldé", () => {
    const respecte = situation(accord(UN_PAIEMENT), "2026-11-20");
    expect(respecte.accord).toMatchObject({
      statut: "respecte",
      echeancesEchues: 1,
      montantEchu: 20 * M,
      retard: 0,
    });
    expect(respecte.echu).toBe(0);
    const stricte = situation(accord([]), "2026-11-15");
    expect(stricte.accord).toMatchObject({
      echeancesEchues: 0,
      montantEchu: 0,
      retard: 0,
      statut: "respecte",
    });
    expect(stricte.accord?.echeancesRestantes).toHaveLength(4);
    const quatre = ["2026-11-16", "2026-12-16", "2027-01-16", "2027-02-16"].map((date) => ({
      date,
      montant: 20 * M,
    }));
    const solde = situation(accord(quatre), "2027-03-01");
    expect(solde.accord).toMatchObject({
      statut: "solde",
      resteAPayer: 0,
      prochaineNonSoldee: null,
      echeancesRestantes: [],
      retard: 0,
    });
    expect(solde.echu).toBe(0);
    expect(solde.encoursRestant).toBe(0);
  });

  it("un paiement partiel solde l'échéance en cours à hauteur du payé (FIFO)", () => {
    const s = situation(accord([{ date: "2026-11-16", montant: 30 * M }]), "2026-11-20");
    expect(s.accord?.echeancesRestantes.map((e) => [e.rang, e.montantRestant])).toEqual([
      [2, 10 * M],
      [3, 20 * M],
      [4, 20 * M],
    ]);
    expect(s.accord?.prochaineNonSoldee).toEqual({
      rang: 2,
      date: "2026-12-15",
      montantRestant: 10 * M,
    });
  });

  it("(C7) accord rompu : l'encours restant est dû et échu", () => {
    const s = situation(accord(UN_PAIEMENT, true), "2026-12-20");
    expect(s.accord).toMatchObject({
      statut: "rompu",
      echeancesRestantes: [],
      prochaineNonSoldee: null,
      totalPaye: 20 * M,
    });
    expect(s.encoursRestant).toBe(80 * M);
    expect(s.echu).toBe(80 * M);
  });

  it("(C8) sans accord : l'encours est échu si l'échéance initiale est dépassée", () => {
    const s = situation(null, "2026-11-01", "2026-09-30");
    expect(s).toEqual({
      encoursInitial: 100 * M,
      accord: null,
      encoursRestant: 100 * M,
      echu: 100 * M,
    });
    expect(situation(null, "2026-11-01", null).echu).toBe(0);
    expect(situation(null, "2026-09-30", "2026-09-30").echu).toBe(0);
  });

  it("remise nulle quand l'accord égale l'encours ; échéances dans le désordre", () => {
    const a: AccordSuivi = {
      montantConvenu: 100 * M,
      echeances: [
        { rang: 2, date: "2027-01-15", montant: 50 * M },
        { rang: 1, date: "2026-12-15", montant: 50 * M },
      ],
      paiements: [],
      rompu: false,
    };
    const s = situation(a, "2026-12-20");
    expect(s.accord?.remise).toBe(0);
    expect(s.accord?.echeancesRestantes.map((e) => e.rang)).toEqual([1, 2]);
    expect(s.accord?.retard).toBe(50 * M);
  });

  it("entrées invalides", () => {
    const base = {
      principal: 1,
      interets: 0,
      echeanceInitiale: null,
      accord: null,
      dateReference: "2026-11-01",
    };
    expect(code(() => situationCreancier({ ...base, principal: -1 }))).toBe("MONTANT_INVALIDE");
    expect(code(() => situationCreancier({ ...base, interets: 1.5 }))).toBe("MONTANT_INVALIDE");
    expect(code(() => situationCreancier({ ...base, dateReference: "2026-02-30" }))).toBe(
      "DATE_INVALIDE",
    );
    expect(code(() => situationCreancier({ ...base, echeanceInitiale: "2026-13-01" }))).toBe(
      "DATE_INVALIDE",
    );
    expect(
      code(() => situationCreancier({ ...base, accord: { ...accord([]), montantConvenu: 0 } })),
    ).toBe("MONTANT_INVALIDE");
    expect(
      code(() =>
        situationCreancier({ ...base, accord: accord([{ date: "2026-11-16", montant: -1 }]) }),
      ),
    ).toBe("MONTANT_INVALIDE");
    expect(
      code(() =>
        situationCreancier({
          ...base,
          accord: { ...accord([]), echeances: [{ rang: 1, date: "2026-11-15", montant: 0 }] },
        }),
      ),
    ).toBe("MONTANT_INVALIDE");
  });
});

describe("(C9) paiement admissible", () => {
  it("dans la limite de l'accord", () => {
    const a = accord([{ date: "2026-11-16", montant: 70 * M }]);
    expect(code(() => exigerPaiementAdmissible(a, 10 * M))).toBe("AUCUNE");
    expect(code(() => exigerPaiementAdmissible(a, 10 * M + 1))).toBe("PAIEMENT_EXCESSIF");
    expect(code(() => exigerPaiementAdmissible(a, 0))).toBe("MONTANT_INVALIDE");
  });

  it("accord rompu : ACCORD_ROMPU", () => {
    expect(code(() => exigerPaiementAdmissible(accord([], true), 1))).toBe("ACCORD_ROMPU");
  });
});

describe("(C10) synthèse du passif", () => {
  const lignes: LignePassif[] = [
    { creancierId: "b", categorie: "banque", garanti: true, encours: 100 * M, echu: 0 },
    { creancierId: "fa", categorie: "fournisseur", garanti: false, encours: 60 * M, echu: 30 * M },
    { creancierId: "fb", categorie: "fournisseur", garanti: false, encours: 40 * M, echu: 0 },
    { creancierId: "t", categorie: "fiscal", garanti: false, encours: 20 * M, echu: 0 },
    { creancierId: "s", categorie: "social", garanti: false, encours: 10 * M, echu: 0 },
  ];

  it("totaux, part garantie, concentration, catégories dans l'ordre de la liste", () => {
    expect(synthesePassif(lignes)).toEqual({
      nombre: 5,
      totalEncours: 230 * M,
      totalEchu: 30 * M,
      partGarantiePb: 4348,
      concentrationTop3Pb: 8696,
      parCategorie: [
        { categorie: "fournisseur", nombre: 2, encours: 100 * M, echu: 30 * M, partPb: 4348 },
        { categorie: "banque", nombre: 1, encours: 100 * M, echu: 0, partPb: 4348 },
        { categorie: "fiscal", nombre: 1, encours: 20 * M, echu: 0, partPb: 870 },
        { categorie: "social", nombre: 1, encours: 10 * M, echu: 0, partPb: 435 },
      ],
    });
  });

  it("liste vide : totaux 0, parts nulles", () => {
    expect(synthesePassif([])).toEqual({
      nombre: 0,
      totalEncours: 0,
      totalEchu: 0,
      partGarantiePb: null,
      concentrationTop3Pb: null,
      parCategorie: [],
    });
  });

  it("moins de trois créanciers : concentration de 100 %", () => {
    expect(synthesePassif(lignes.slice(0, 2)).concentrationTop3Pb).toBe(10_000);
  });

  it("entrées invalides", () => {
    expect(code(() => synthesePassif([{ ...lignes[0]!, categorie: "inconnue" as never }]))).toBe(
      "ENTREE_INVALIDE",
    );
    expect(code(() => synthesePassif([{ ...lignes[0]!, encours: -1 }]))).toBe("MONTANT_INVALIDE");
    expect(code(() => synthesePassif([{ ...lignes[0]!, echu: 0.5 }]))).toBe("MONTANT_INVALIDE");
  });

  it("la liste des catégories est celle du dépôt", () => {
    expect([...CATEGORIES_CREANCIER_RED]).toEqual([
      "fournisseur",
      "banque",
      "fiscal",
      "social",
      "bailleur",
      "autre",
    ]);
  });
});
