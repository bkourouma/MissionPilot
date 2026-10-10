import { describe, expect, it } from "vitest";
import { montant } from "../finance/monnaie";
import type { Affectation } from "../planning/capacite";
import {
  ErreurPrevision,
  genererMois,
  moisApres,
  moisDeDate,
  prevoirCabinet,
  PROBABILITE_ETAPE_DEFAUT,
  probabiliteRetenue,
  repartirEntier,
  type EntreePrevision,
  type OpportunitePrevision,
} from "./previsions";

const xof = (v: number) => montant(v, "XOF");

function base(surcharge: Partial<EntreePrevision> = {}): EntreePrevision {
  return {
    devise: "XOF",
    dateReference: "2026-10-15",
    echeances: [],
    opportunites: [],
    collaborateurs: [{ id: "c1" }],
    affectations: [],
    affectationsAPourvoir: [],
    ...surcharge,
  };
}

const opp = (surcharge: Partial<OpportunitePrevision> = {}): OpportunitePrevision => ({
  id: "o1",
  etape: "proposition",
  probabilitePct: 50,
  montant: xof(1_000_000),
  dateCloturePrevue: "2026-11-20",
  joursCentiemes: null,
  ...surcharge,
});

const erreur = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof ErreurPrevision ? e.code : `autre:${String(e)}`;
  }
  return undefined;
};

describe("mois", () => {
  it("génère 12 mois consécutifs à partir du mois de référence", () => {
    const m = genererMois("2026-10-15");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2026-10");
    expect(m[3]).toBe("2027-01");
    expect(m[11]).toBe("2027-09");
  });

  it("refuse un nombre de mois hors bornes", () => {
    expect(erreur(() => genererMois("2026-10-15", 0))).toBe("NOMBRE_MOIS_INVALIDE");
    expect(erreur(() => genererMois("2026-10-15", 37))).toBe("NOMBRE_MOIS_INVALIDE");
    expect(erreur(() => genererMois("2026-10-15", 1.5))).toBe("NOMBRE_MOIS_INVALIDE");
  });

  it("refuse une date ou un mois invalide", () => {
    expect(erreur(() => moisDeDate("26-10-15"))).toBe("MOIS_INVALIDE");
    expect(erreur(() => moisApres("2026-13", 1))).toBe("MOIS_INVALIDE");
  });

  it("valide la date entière : jour inexistant refusé, pas seulement le mois", () => {
    expect(erreur(() => moisDeDate("2026-05-99"))).toBe("MOIS_INVALIDE");
    expect(erreur(() => moisDeDate("2026-02-30"))).toBe("MOIS_INVALIDE");
    expect(erreur(() => genererMois("2026-05-99"))).toBe("MOIS_INVALIDE");
    expect(moisDeDate("2024-02-29")).toBe("2024-02");
    const echue = base({ echeances: [{ missionId: "m1", date: "2026-05-99", montant: xof(1) }] });
    expect(erreur(() => prevoirCabinet(echue))).toBe("MOIS_INVALIDE");
    const cloture = base({ opportunites: [opp({ dateCloturePrevue: "2026-13-01" })] });
    expect(erreur(() => prevoirCabinet(cloture))).toBe("MOIS_INVALIDE");
  });

  it("date de référence aux bornes (années 0001 et 9999) : erreur typée, jamais interne", () => {
    // 9999-12 + 12 mois dépasse l'année 9999 : MOIS_INVALIDE (400 côté API), pas une erreur interne.
    expect(erreur(() => prevoirCabinet(base({ dateReference: "9999-12-31" })))).toBe(
      "MOIS_INVALIDE",
    );
    expect(erreur(() => genererMois("9999-12-31", 1))).toBeUndefined();
    expect(genererMois("9999-12-31", 1)).toEqual(["9999-12"]);
    // Année 0001 : valide en avant, refusée en arrière.
    expect(genererMois("0001-01-15", 2)).toEqual(["0001-01", "0001-02"]);
    expect(erreur(() => moisApres("0001-01", -1))).toBe("MOIS_INVALIDE");
    expect(erreur(() => moisApres("2026-10", 1.5))).toBe("MOIS_INVALIDE");
    expect(erreur(() => prevoirCabinet(base({ dateReference: "0000-01-01" })))).toBe(
      "MOIS_INVALIDE",
    );
  });

  it("avance et recule d'un nombre de mois", () => {
    expect(moisApres("2026-12", 1)).toBe("2027-01");
    expect(moisApres("2026-01", -1)).toBe("2025-12");
  });
});

describe("répartition", () => {
  it("garde la somme et donne le reste aux premières parts", () => {
    expect(repartirEntier(100, 3)).toEqual([34, 33, 33]);
    expect(repartirEntier(0, 2)).toEqual([0, 0]);
  });

  it("refuse un total ou un nombre de parts invalide", () => {
    expect(erreur(() => repartirEntier(-1, 2))).toBe("PARAMETRE_INVALIDE");
    expect(erreur(() => repartirEntier(10, 0))).toBe("PARAMETRE_INVALIDE");
    expect(erreur(() => repartirEntier(1.5, 2))).toBe("PARAMETRE_INVALIDE");
  });
});

describe("probabilité", () => {
  it("prend celle de l'opportunité, sinon celle de l'étape", () => {
    expect(probabiliteRetenue({ etape: "negociation", probabilitePct: 90 })).toBe(90);
    expect(probabiliteRetenue({ etape: "negociation", probabilitePct: null })).toBe(
      PROBABILITE_ETAPE_DEFAUT.negociation,
    );
  });

  it("refuse une probabilité non entière ou hors de 0 à 100", () => {
    expect(erreur(() => probabiliteRetenue({ etape: "proposition", probabilitePct: 101 }))).toBe(
      "PROBABILITE_INVALIDE",
    );
    expect(erreur(() => probabiliteRetenue({ etape: "proposition", probabilitePct: 12.5 }))).toBe(
      "PROBABILITE_INVALIDE",
    );
    expect(erreur(() => probabiliteRetenue({ etape: "proposition", probabilitePct: -1 }))).toBe(
      "PROBABILITE_INVALIDE",
    );
  });
});

describe("carnet signé", () => {
  it("place chaque échéance dans le mois de sa date prévue", () => {
    const p = prevoirCabinet(
      base({
        echeances: [
          { missionId: "m1", date: "2026-10-31", montant: xof(300_000) },
          { missionId: "m1", date: "2026-12-01", montant: xof(700_000) },
          { missionId: "m2", date: "2026-12-15", montant: xof(50_000) },
        ],
      }),
    );
    expect(p.mois.map((m) => m.caCarnet).slice(0, 4)).toEqual([300_000, 0, 750_000, 0]);
    expect(p.totaux.caCarnet).toBe(1_050_000);
    expect(p.totaux.caTotal).toBe(1_050_000);
    expect(p.nombreEcheances).toBe(3);
    expect(p.enRetard).toEqual({ nombre: 0, montant: 0 });
  });

  it("ramène une échéance en retard au premier mois et la signale", () => {
    const p = prevoirCabinet(
      base({ echeances: [{ missionId: "m1", date: "2026-08-10", montant: xof(200_000) }] }),
    );
    expect(p.mois[0]?.caCarnet).toBe(200_000);
    expect(p.enRetard).toEqual({ nombre: 1, montant: 200_000 });
  });

  it("met hors horizon une échéance après le dernier mois", () => {
    const p = prevoirCabinet(
      base({ echeances: [{ missionId: "m1", date: "2027-10-01", montant: xof(90_000) }] }),
    );
    expect(p.totaux.caCarnet).toBe(0);
    expect(p.auDela.caCarnet).toBe(90_000);
  });

  it("refuse un montant dans une autre devise", () => {
    expect(
      erreur(() =>
        prevoirCabinet(
          base({
            echeances: [{ missionId: "m1", date: "2026-11-01", montant: montant(10, "EUR") }],
          }),
        ),
      ),
    ).toBe("DEVISE_DIFFERENTE");
    expect(
      erreur(() => prevoirCabinet(base({ opportunites: [opp({ montant: montant(10, "USD") })] }))),
    ).toBe("DEVISE_DIFFERENTE");
  });
});

describe("pipeline pondéré", () => {
  it("pondère par la probabilité et répartit sur trois mois après la clôture", () => {
    const p = prevoirCabinet(base({ opportunites: [opp()] }));
    // Clôture en novembre (indice 1) + 1 mois de délai : décembre, janvier, février.
    expect(p.mois.map((m) => m.caPipeline).slice(0, 6)).toEqual([
      0, 0, 166_667, 166_667, 166_666, 0,
    ]);
    expect(p.totaux.caPipeline).toBe(500_000);
    expect(p.parEtape.find((e) => e.etape === "proposition")).toEqual({
      etape: "proposition",
      nombre: 1,
      montant: 1_000_000,
      montantPondere: 500_000,
    });
    expect(p.parEtape.find((e) => e.etape === "prospection")?.nombre).toBe(0);
  });

  it("utilise la probabilité de l'étape sans probabilité propre", () => {
    const p = prevoirCabinet(
      base({ opportunites: [opp({ probabilitePct: null, etape: "prospection" })] }),
    );
    expect(p.totaux.caPipeline).toBe(100_000);
  });

  it("suppose une date sans clôture prévue et la signale", () => {
    const p = prevoirCabinet(
      base({ opportunites: [opp({ dateCloturePrevue: null, montant: xof(300) })] }),
    );
    expect(p.opportunitesSansDate).toBe(1);
    // 150 en 3 parts de 50 à partir du 4e mois.
    expect(p.mois.map((m) => m.caPipeline).slice(0, 7)).toEqual([0, 0, 0, 50, 50, 50, 0]);
  });

  it("démarre au premier mois une clôture dépassée et la signale", () => {
    const p = prevoirCabinet(base({ opportunites: [opp({ dateCloturePrevue: "2026-03-01" })] }));
    expect(p.opportunitesEnRetard).toBe(1);
    expect(p.mois[0]?.caPipeline).toBe(166_667);
  });

  it("met hors horizon la part au-delà du dernier mois", () => {
    const p = prevoirCabinet(base({ opportunites: [opp({ dateCloturePrevue: "2027-08-10" })] }));
    // Clôture en août 2027 (indice 10), départ au 12e mois (indice 11) : 1 part dans l'horizon.
    expect(p.mois[11]?.caPipeline).toBe(166_667);
    expect(p.auDela.caPipeline).toBe(333_333);
    expect(p.totaux.caPipeline + p.auDela.caPipeline).toBe(500_000);
  });

  it("ne garde rien dans l'horizon d'une clôture très lointaine", () => {
    const p = prevoirCabinet(base({ opportunites: [opp({ dateCloturePrevue: "2030-01-01" })] }));
    expect(p.totaux.caPipeline).toBe(0);
    expect(p.auDela.caPipeline).toBe(500_000);
  });

  it("répartit la charge du pipeline (jours de la proposition × probabilité)", () => {
    const p = prevoirCabinet(base({ opportunites: [opp({ joursCentiemes: 1_000 })] }));
    // 10 jours × 50 % = 5 jours, répartis en 3 : 1,67 ; 1,67 ; 1,66.
    expect(p.mois.map((m) => m.chargePipelineJours).slice(2, 5)).toEqual([1.67, 1.67, 1.66]);
    expect(p.totaux.chargePipelineJours).toBe(5);
    expect(p.opportunitesSansCharge).toBe(0);
  });

  it("compte les opportunités sans jours chiffrés", () => {
    const p = prevoirCabinet(base({ opportunites: [opp()] }));
    expect(p.opportunitesSansCharge).toBe(1);
    expect(p.totaux.chargePipelineJours).toBe(0);
  });

  it("refuse des jours invalides", () => {
    expect(
      erreur(() => prevoirCabinet(base({ opportunites: [opp({ joursCentiemes: -5 })] }))),
    ).toBe("JOURS_INVALIDES");
    expect(
      erreur(() => prevoirCabinet(base({ opportunites: [opp({ joursCentiemes: 1.5 })] }))),
    ).toBe("JOURS_INVALIDES");
  });

  it("refuse une étape inconnue", () => {
    const inconnue = opp({ etape: "inconnue" as never });
    expect(erreur(() => prevoirCabinet(base({ opportunites: [inconnue] })))).toBe(
      "PARAMETRE_INVALIDE",
    );
  });

  it("signale l'étape inconnue AVANT la probabilité invalide qui en découle", () => {
    // Sans probabilité propre, la probabilité vient de l'étape : l'étape inconnue doit être
    // nommée, pas masquée par PROBABILITE_INVALIDE.
    const inconnue = opp({ etape: "inconnue" as never, probabilitePct: null });
    let message = "";
    try {
      prevoirCabinet(base({ opportunites: [inconnue] }));
    } catch (e) {
      message = e instanceof ErreurPrevision ? `${e.code}:${e.message}` : String(e);
    }
    expect(message).toBe("PARAMETRE_INVALIDE:Étape inconnue : « inconnue ».");
  });
});

describe("charge et capacité", () => {
  const affectation = (surcharge: Partial<Affectation> = {}): Affectation => ({
    id: "a1",
    personneId: "c1",
    tacheId: "t1",
    joursAlloues: 10,
    debut: "2026-10-05",
    fin: "2026-10-16",
    ...surcharge,
  });

  it("compare la charge des affectations à la capacité du mois", () => {
    const p = prevoirCabinet(base({ affectations: [affectation()] }));
    const octobre = p.mois[0];
    expect(octobre?.capaciteJours).toBe(22);
    expect(octobre?.chargeCarnetJours).toBe(10);
    expect(octobre?.chargeTotaleJours).toBe(10);
    expect(octobre?.ecartJours).toBe(12);
    expect(octobre?.tauxOccupation).toBe(0.4545);
    expect(octobre?.etat).toBe("sous_occupation");
    expect(p.totaux.capaciteJours).toBeGreaterThan(200);
  });

  it("signale une surcharge et distingue les profils à pourvoir et le pipeline", () => {
    const p = prevoirCabinet(
      base({
        affectations: [affectation({ joursAlloues: 15 })],
        affectationsAPourvoir: [affectation({ id: "a2", personneId: "profil", joursAlloues: 5 })],
        opportunites: [
          opp({ dateCloturePrevue: "2026-09-01", joursCentiemes: 3_000, probabilitePct: 100 }),
        ],
      }),
    );
    const octobre = p.mois[0];
    expect(octobre?.chargeCarnetJours).toBe(15);
    expect(octobre?.chargeAPourvoirJours).toBe(5);
    expect(octobre?.chargePipelineJours).toBe(10);
    expect(octobre?.chargeTotaleJours).toBe(30);
    expect(octobre?.ecartJours).toBe(-8);
    expect(octobre?.etat).toBe("surcharge");
  });

  it("répartit une affectation à cheval sur deux mois au prorata des jours ouvrés", () => {
    const p = prevoirCabinet(
      base({
        affectations: [affectation({ debut: "2026-10-26", fin: "2026-11-06", joursAlloues: 10 })],
      }),
    );
    expect(p.mois[0]?.chargeCarnetJours).toBe(5);
    expect(p.mois[1]?.chargeCarnetJours).toBe(5);
    expect(p.totaux.chargeCarnetJours).toBe(10);
  });

  it("retire les absences de la capacité et applique le temps de travail", () => {
    const p = prevoirCabinet(
      base({
        collaborateurs: [
          { id: "c1", tempsTravailPct: 50, absences: [{ debut: "2026-10-05", fin: "2026-10-09" }] },
        ],
      }),
    );
    // (22 − 5) × 50 % = 8,5.
    expect(p.mois[0]?.capaciteJours).toBe(8.5);
  });

  it("donne un taux nul sans capacité", () => {
    const p = prevoirCabinet(base({ collaborateurs: [], affectations: [] }));
    expect(p.mois[0]?.tauxOccupation).toBeNull();
    expect(p.mois[0]?.etat).toBe("indisponible");
  });
});

describe("paramètres", () => {
  it("accepte un horizon et une durée personnalisés", () => {
    const p = prevoirCabinet(
      base({
        opportunites: [opp({ dateCloturePrevue: null, montant: xof(1_000), probabilitePct: 100 })],
        parametres: { nbMois: 6, dureeMois: 2, delaiSansDateMois: 1 },
      }),
    );
    expect(p.mois).toHaveLength(6);
    expect(p.mois.map((m) => m.caPipeline)).toEqual([0, 500, 500, 0, 0, 0]);
  });

  it("refuse des paramètres hors bornes", () => {
    expect(erreur(() => prevoirCabinet(base({ parametres: { dureeMois: 0 } })))).toBe(
      "PARAMETRE_INVALIDE",
    );
    expect(erreur(() => prevoirCabinet(base({ parametres: { delaiSignatureMois: -1 } })))).toBe(
      "PARAMETRE_INVALIDE",
    );
    expect(erreur(() => prevoirCabinet(base({ parametres: { nbMois: 99 } })))).toBe(
      "PARAMETRE_INVALIDE",
    );
  });

  it("applique le délai de signature à partir de la clôture", () => {
    const p = prevoirCabinet(
      base({
        opportunites: [opp({ montant: xof(300), probabilitePct: 100 })],
        parametres: { delaiSignatureMois: 0, dureeMois: 1 },
      }),
    );
    expect(p.mois[1]?.caPipeline).toBe(300);
  });
});
