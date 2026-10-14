import { describe, expect, it } from "vitest";
import { ErreurRedressement } from "./erreurs";
import {
  type EcheanceRestante,
  type EntreeTresorerie,
  type FluxRealise,
  type LigneTresorerie,
  type RealiseSemaine,
  SEMAINES_TRESORERIE,
  echeancesVersLignes,
  projeterTresorerie,
  totaliserFluxRealise,
} from "./tresorerie";

const M = 1_000_000;

const LIGNES: LigneTresorerie[] = [
  { semaine: 1, sens: "encaissement", categorie: "clients", montant: 30 * M },
  { semaine: 1, sens: "decaissement", categorie: "fournisseurs", montant: 40 * M },
  { semaine: 1, sens: "decaissement", categorie: "salaires", montant: 25 * M },
  { semaine: 2, sens: "encaissement", categorie: "clients", montant: 20 * M },
  { semaine: 2, sens: "decaissement", categorie: "fournisseurs", montant: 30 * M },
  { semaine: 3, sens: "encaissement", categorie: "clients", montant: 15 * M },
  { semaine: 3, sens: "decaissement", categorie: "fournisseurs", montant: 35 * M },
];

const entree = (surcharges: Partial<EntreeTresorerie> = {}): EntreeTresorerie => ({
  dateDebut: "2026-10-12",
  soldeInitial: 50 * M,
  seuilTension: 10 * M,
  lignes: LIGNES,
  realises: [],
  ...surcharges,
});

const REALISE_S1: FluxRealise = {
  encaissement: { clients: 28 * M },
  decaissement: { fournisseurs: 41 * M, salaires: 25 * M },
};
const realiseS1 = (soldeConstate: number | null = null): RealiseSemaine => ({
  semaine: 1,
  flux: REALISE_S1,
  soldeConstate,
});

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurRedressement) return e.code;
    throw e;
  }
  return "AUCUNE";
};

describe("(T1) prévision seule", () => {
  const r = projeterTresorerie(entree());

  it("soldes de clôture, tension, minimum et besoin de financement", () => {
    expect(r.semaines).toHaveLength(SEMAINES_TRESORERIE);
    expect(r.semaines.slice(0, 4).map((s) => s.soldeClotureRetenu)).toEqual([
      15 * M,
      5 * M,
      -15 * M,
      -15 * M,
    ]);
    expect(r.semaines[12]?.soldeClotureRetenu).toBe(-15 * M);
    expect(r.semaines.slice(0, 3).map((s) => s.fluxNetPrevu)).toEqual([-35 * M, -10 * M, -20 * M]);
    expect(r.semainesTension).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(r.premiereSemaineTension).toBe(2);
    expect(r.soldeMinimum).toEqual({ semaine: 3, montant: -15 * M });
    expect(r.besoinFinancement).toBe(25 * M);
    expect(r.derniereSemaineRealisee).toBeNull();
    expect(r.ecartCumuleFluxNet).toBe(0);
    expect(r.totaux).toEqual({
      encaissementsPrevus: 65 * M,
      decaissementsPrevus: 130 * M,
      fluxNetPrevu: -65 * M,
    });
  });

  it("dates de la fenêtre : lundi à dimanche, 7 jours d'écart", () => {
    expect(r.semaines[0]).toMatchObject({ semaine: 1, debut: "2026-10-12", fin: "2026-10-18" });
    expect(r.semaines[1]).toMatchObject({ debut: "2026-10-19", fin: "2026-10-25" });
    expect(r.semaines[12]).toMatchObject({ debut: "2027-01-04", fin: "2027-01-10" });
  });

  it("soldes d'ouverture, sans réalisé : retenus = prévus ; écarts nuls", () => {
    expect(r.semaines[1]).toMatchObject({
      soldeOuverturePrevu: 15 * M,
      soldeOuvertureRetenu: 15 * M,
      soldeCloturePrevu: 5 * M,
      realise: null,
      ecartEncaissements: null,
      ecartDecaissements: null,
      ecartFluxNet: null,
      ecartRapprochement: null,
    });
  });

  it("détail par catégorie : encaissements puis décaissements, catégories non nulles", () => {
    expect(r.semaines[0]?.parCategorie).toEqual([
      { sens: "encaissement", categorie: "clients", prevu: 30 * M, realise: null, ecart: null },
      {
        sens: "decaissement",
        categorie: "fournisseurs",
        prevu: 40 * M,
        realise: null,
        ecart: null,
      },
      { sens: "decaissement", categorie: "salaires", prevu: 25 * M, realise: null, ecart: null },
    ]);
    expect(r.semaines[5]?.parCategorie).toEqual([]);
  });

  it("est déterministe et ne modifie pas ses entrées", () => {
    const e = entree();
    const avant = JSON.stringify(e);
    expect(projeterTresorerie(e)).toEqual(r);
    expect(JSON.stringify(e)).toBe(avant);
  });
});

describe("(T2) réalisé de la semaine 1 sans solde constaté", () => {
  const r = projeterTresorerie(entree({ realises: [realiseS1()] }));
  const s1 = r.semaines[0]!;

  it("flux net réalisé, solde retenu et écarts (réalisé − prévu)", () => {
    expect(s1.realise).toEqual({
      encaissements: 28 * M,
      decaissements: 66 * M,
      fluxNet: -38 * M,
      soldeConstate: null,
    });
    expect(s1.soldeClotureRetenu).toBe(12 * M);
    expect(s1.soldeClotureRetenu).not.toBe(s1.soldeCloturePrevu);
    expect(s1.soldeCloturePrevu).toBe(15 * M);
    expect(s1.ecartEncaissements).toBe(-2 * M);
    expect(s1.ecartDecaissements).toBe(1 * M);
    expect(s1.ecartFluxNet).toBe(-3 * M);
    expect(s1.ecartRapprochement).toBeNull();
    expect(s1.parCategorie.find((c) => c.categorie === "fournisseurs")).toEqual({
      sens: "decaissement",
      categorie: "fournisseurs",
      prevu: 40 * M,
      realise: 41 * M,
      ecart: 1 * M,
    });
  });

  it("la prévision glisse sur le dernier solde retenu", () => {
    expect(r.semaines[1]?.soldeOuvertureRetenu).toBe(12 * M);
    expect(r.semaines[1]?.soldeOuverturePrevu).toBe(15 * M);
    expect(r.semaines[1]?.soldeClotureRetenu).toBe(2 * M);
    expect(r.semaines[2]?.soldeClotureRetenu).toBe(-18 * M);
    expect(r.soldeMinimum).toEqual({ semaine: 3, montant: -18 * M });
    expect(r.besoinFinancement).toBe(28 * M);
    expect(r.semainesTension).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(r.ecartCumuleFluxNet).toBe(-3 * M);
    expect(r.derniereSemaineRealisee).toBe(1);
  });
});

describe("(T3) réalisé avec solde constaté", () => {
  const r = projeterTresorerie(entree({ realises: [realiseS1(11 * M)] }));

  it("écart de rapprochement et solde ancré", () => {
    expect(r.semaines[0]?.ecartRapprochement).toBe(-1 * M);
    expect(r.semaines[0]?.soldeClotureRetenu).toBe(11 * M);
    expect(r.semaines[0]?.realise?.soldeConstate).toBe(11 * M);
    expect(r.semaines[1]?.soldeClotureRetenu).toBe(1 * M);
    expect(r.semaines[2]?.soldeClotureRetenu).toBe(-19 * M);
    expect(r.besoinFinancement).toBe(29 * M);
  });

  it("ne dépend pas de l'ordre des réalisés", () => {
    const deux: RealiseSemaine[] = [
      { semaine: 2, flux: { encaissement: { clients: 20 * M } }, soldeConstate: null },
      realiseS1(11 * M),
    ];
    const a = projeterTresorerie(entree({ realises: deux }));
    const b = projeterTresorerie(entree({ realises: [...deux].reverse() }));
    expect(a).toEqual(b);
    expect(a.derniereSemaineRealisee).toBe(2);
    // S2 : ouverture 11 M, flux réalisé +20 M → 31 M (le réalisé remplace la prévision).
    expect(a.semaines[1]?.soldeClotureRetenu).toBe(31 * M);
    expect(a.semaines[1]?.parCategorie).toEqual([
      { sens: "encaissement", categorie: "clients", prevu: 20 * M, realise: 20 * M, ecart: 0 },
      {
        sens: "decaissement",
        categorie: "fournisseurs",
        prevu: 30 * M,
        realise: 0,
        ecart: -30 * M,
      },
    ]);
  });
});

describe("(T4) sans tension", () => {
  it("solde initial confortable : aucune semaine de tension, besoin nul", () => {
    const r = projeterTresorerie(entree({ soldeInitial: 100 * M }));
    expect(r.soldeMinimum).toEqual({ semaine: 3, montant: 35 * M });
    expect(r.semainesTension).toEqual([]);
    expect(r.premiereSemaineTension).toBeNull();
    expect(r.besoinFinancement).toBe(0);
  });

  it("un solde égal au seuil n'est pas en tension", () => {
    const r = projeterTresorerie(entree({ soldeInitial: 100 * M, seuilTension: 35 * M }));
    expect(r.semainesTension).toEqual([]);
    expect(r.besoinFinancement).toBe(0);
    const juste = projeterTresorerie(entree({ soldeInitial: 100 * M, seuilTension: 35 * M + 1 }));
    expect(juste.semainesTension).toHaveLength(11);
    expect(juste.besoinFinancement).toBe(1);
  });
});

describe("(T5) entrées invalides", () => {
  it("découvert accepté", () => {
    expect(
      projeterTresorerie(entree({ soldeInitial: -5 * M })).semaines[0]?.soldeClotureRetenu,
    ).toBe(-40 * M);
  });

  it("réalisé non contigu : trou ou doublon", () => {
    const s = (n: number): RealiseSemaine => ({ semaine: n, flux: {}, soldeConstate: null });
    expect(code(() => projeterTresorerie(entree({ realises: [s(1), s(3)] })))).toBe(
      "REALISE_NON_CONTIGU",
    );
    expect(code(() => projeterTresorerie(entree({ realises: [s(1), s(1)] })))).toBe(
      "REALISE_NON_CONTIGU",
    );
    expect(code(() => projeterTresorerie(entree({ realises: [s(2)] })))).toBe(
      "REALISE_NON_CONTIGU",
    );
    expect(code(() => projeterTresorerie(entree({ realises: [s(1), s(2), s(3)] })))).toBe("AUCUNE");
  });

  it("treize semaines réalisées : tout est réalisé", () => {
    const toutes = Array.from({ length: 13 }, (_, i) => ({
      semaine: i + 1,
      flux: { encaissement: { clients: 1 * M } },
      soldeConstate: null,
    }));
    const r = projeterTresorerie(entree({ lignes: [], realises: toutes }));
    expect(r.derniereSemaineRealisee).toBe(13);
    expect(r.semaines[12]?.soldeClotureRetenu).toBe(50 * M + 13 * M);
  });

  it("dates, semaines, catégories, montants, volume", () => {
    expect(code(() => projeterTresorerie(entree({ dateDebut: "2026-10-13" })))).toBe(
      "DATE_INVALIDE",
    );
    expect(code(() => projeterTresorerie(entree({ dateDebut: "2026-02-30" })))).toBe(
      "DATE_INVALIDE",
    );
    expect(code(() => projeterTresorerie(entree({ dateDebut: "pas une date" })))).toBe(
      "DATE_INVALIDE",
    );
    const ligne = (surcharge: Partial<LigneTresorerie>): LigneTresorerie => ({
      semaine: 1,
      sens: "encaissement",
      categorie: "clients",
      montant: 1,
      ...surcharge,
    });
    const avec = (l: LigneTresorerie) => code(() => projeterTresorerie(entree({ lignes: [l] })));
    expect(avec(ligne({ semaine: 14 }))).toBe("SEMAINE_INVALIDE");
    expect(avec(ligne({ semaine: 0 }))).toBe("SEMAINE_INVALIDE");
    expect(avec(ligne({ categorie: "salaires" }))).toBe("TRESORERIE_INVALIDE");
    expect(avec(ligne({ sens: "decaissement", categorie: "clients" }))).toBe("TRESORERIE_INVALIDE");
    expect(avec(ligne({ sens: "autre" as never }))).toBe("TRESORERIE_INVALIDE");
    expect(avec(ligne({ montant: 0 }))).toBe("TRESORERIE_INVALIDE");
    expect(avec(ligne({ montant: 1.5 }))).toBe("TRESORERIE_INVALIDE");
    expect(avec(ligne({ montant: 10_000_000_000_001 }))).toBe("TRESORERIE_INVALIDE");
    expect(avec(ligne({ montant: 10_000_000_000_000 }))).toBe("AUCUNE");
    const six_cents = Array.from({ length: 600 }, () => ligne({}));
    expect(code(() => projeterTresorerie(entree({ lignes: six_cents })))).toBe("AUCUNE");
    expect(code(() => projeterTresorerie(entree({ lignes: [...six_cents, ligne({})] })))).toBe(
      "TRESORERIE_INVALIDE",
    );
    expect(code(() => projeterTresorerie(entree({ seuilTension: -1 })))).toBe(
      "TRESORERIE_INVALIDE",
    );
    expect(code(() => projeterTresorerie(entree({ soldeInitial: 0.5 })))).toBe(
      "TRESORERIE_INVALIDE",
    );
    expect(
      code(() => projeterTresorerie(entree({ realises: [realiseS1(10_000_000_000_001)] }))),
    ).toBe("TRESORERIE_INVALIDE");
    expect(
      code(() => projeterTresorerie(entree({ realises: [{ ...realiseS1(), semaine: 14 }] }))),
    ).toBe("SEMAINE_INVALIDE");
  });

  it("plusieurs lignes de même catégorie et semaine s'additionnent", () => {
    const r = projeterTresorerie(
      entree({
        lignes: [
          { semaine: 1, sens: "encaissement", categorie: "clients", montant: 1 * M },
          { semaine: 1, sens: "encaissement", categorie: "clients", montant: 2 * M },
        ],
      }),
    );
    expect(r.semaines[0]?.encaissementsPrevus).toBe(3 * M);
    expect(r.semaines[0]?.parCategorie).toHaveLength(1);
  });

  it("le plafond de volume garde les sommes exactes (600 lignes de 10^13)", () => {
    const grosses: LigneTresorerie[] = Array.from({ length: 600 }, () => ({
      semaine: 1,
      sens: "encaissement",
      categorie: "clients",
      montant: 10_000_000_000_000,
    }));
    const r = projeterTresorerie(entree({ lignes: grosses }));
    expect(r.totaux.encaissementsPrevus).toBe(6_000_000_000_000_000);
    expect(Number.isSafeInteger(r.semaines[0]?.soldeClotureRetenu)).toBe(true);
  });
});

describe("(T6) totaliserFluxRealise", () => {
  it("additionne par sens", () => {
    expect(totaliserFluxRealise(REALISE_S1)).toEqual({
      encaissements: 28 * M,
      decaissements: 66 * M,
    });
    expect(totaliserFluxRealise({})).toEqual({ encaissements: 0, decaissements: 0 });
  });

  it("refuse une catégorie inconnue ou un montant invalide", () => {
    expect(code(() => totaliserFluxRealise({ encaissement: { salaires: 1 } as never }))).toBe(
      "TRESORERIE_INVALIDE",
    );
    expect(code(() => totaliserFluxRealise({ decaissement: { salaires: -1 } }))).toBe(
      "TRESORERIE_INVALIDE",
    );
    expect(code(() => totaliserFluxRealise({ decaissement: { salaires: 1.5 } }))).toBe(
      "TRESORERIE_INVALIDE",
    );
    expect(code(() => totaliserFluxRealise({ decaissement: { salaires: 0 } }))).toBe("AUCUNE");
  });
});

describe("(T7) echeancesVersLignes", () => {
  const e = (
    id: string,
    date: string,
    categorieCreancier: EcheanceRestante["categorieCreancier"] = "fournisseur",
    montant = 1 * M,
  ): EcheanceRestante => ({
    echeanceId: id,
    creancierId: `c-${id}`,
    categorieCreancier,
    date,
    montant,
  });

  it("place chaque échéance dans sa semaine et compte antérieures et ultérieures", () => {
    const p = echeancesVersLignes(
      [
        e("e", "2027-01-11"),
        e("d", "2027-01-10"),
        e("c", "2026-11-30"),
        e("b", "2026-10-19"),
        e("a", "2026-10-14", "banque"),
        e("z", "2026-10-05"),
      ],
      "2026-10-12",
    );
    expect(p.anterieures).toBe(1);
    expect(p.ulterieures).toBe(1);
    expect(p.lignes.map((l) => [l.echeanceId, l.semaine])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 8],
      ["d", 13],
    ]);
    expect(p.lignes[0]).toEqual({
      semaine: 1,
      sens: "decaissement",
      categorie: "service_dette",
      montant: 1 * M,
      echeanceId: "a",
      creancierId: "c-a",
    });
  });

  it("catégorie de flux selon la catégorie du créancier", () => {
    const attendu = {
      banque: "service_dette",
      fournisseur: "fournisseurs",
      fiscal: "fiscal_social",
      social: "fiscal_social",
      bailleur: "loyers_charges",
      autre: "autres_decaissements",
    } as const;
    for (const [cat, flux] of Object.entries(attendu)) {
      const p = echeancesVersLignes([e("x", "2026-10-14", cat as never)], "2026-10-12");
      expect(p.lignes[0]?.categorie).toBe(flux);
    }
  });

  it("tri : semaine, puis identifiant d'échéance", () => {
    const p = echeancesVersLignes(
      [e("b", "2026-10-14"), e("c", "2026-10-13"), e("a", "2026-10-15")],
      "2026-10-12",
    );
    expect(p.lignes.map((l) => l.echeanceId)).toEqual(["a", "b", "c"]);
  });

  it("entrées invalides", () => {
    expect(code(() => echeancesVersLignes([], "2026-10-13"))).toBe("DATE_INVALIDE");
    expect(code(() => echeancesVersLignes([e("x", "2026-02-30")], "2026-10-12"))).toBe(
      "DATE_INVALIDE",
    );
    expect(
      code(() => echeancesVersLignes([e("x", "2026-10-14", "fournisseur", 0)], "2026-10-12")),
    ).toBe("TRESORERIE_INVALIDE");
    expect(
      code(() => echeancesVersLignes([e("x", "2026-10-14", "inconnue" as never)], "2026-10-12")),
    ).toBe("TRESORERIE_INVALIDE");
    expect(echeancesVersLignes([], "2026-10-12")).toEqual({
      lignes: [],
      anterieures: 0,
      ulterieures: 0,
    });
  });

  it("les lignes proposées alimentent la projection", () => {
    const p = echeancesVersLignes([e("a", "2026-10-14", "banque", 5 * M)], "2026-10-12");
    const r = projeterTresorerie(entree({ lignes: p.lignes }));
    expect(r.semaines[0]?.decaissementsPrevus).toBe(5 * M);
  });
});
