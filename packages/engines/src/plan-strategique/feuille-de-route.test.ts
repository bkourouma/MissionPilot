import { describe, expect, it } from "vitest";
import {
  controlerDependances,
  DEPENDANCES_PAR_INITIATIVE_MAX,
  ErreurPlan,
  recalerFeuilleDeRoute,
  type InitiativeFeuilleDeRoute,
} from "./index";

function ini(
  id: string,
  debut: string | null,
  echeance: string,
  dependances: string[] = [],
  statut: InitiativeFeuilleDeRoute["statut"] = "a_lancer",
): InitiativeFeuilleDeRoute {
  return { id, debut, echeance, statut, dependances };
}

function erreurDe(f: () => unknown): ErreurPlan {
  try {
    f();
  } catch (e) {
    return e as ErreurPlan;
  }
  throw new Error("une erreur était attendue");
}

describe("recalerFeuilleDeRoute", () => {
  it("sans dépendance, les dates prévues sont conservées", () => {
    const r = recalerFeuilleDeRoute([
      ini("a", "2027-01-01", "2027-03-31"),
      ini("b", null, "2027-06-30"),
    ]);
    expect(r.initiatives).toEqual([
      {
        id: "a",
        debutPrevu: "2027-01-01",
        echeancePrevue: "2027-03-31",
        debut: "2027-01-01",
        echeance: "2027-03-31",
        decalageJours: 0,
        recalee: false,
        contraintePar: null,
        conflits: [],
        dependancesIgnorees: [],
      },
      {
        id: "b",
        debutPrevu: null,
        echeancePrevue: "2027-06-30",
        debut: null,
        echeance: "2027-06-30",
        decalageJours: 0,
        recalee: false,
        contraintePar: null,
        conflits: [],
        dependancesIgnorees: [],
      },
    ]);
    expect(r.ordre).toEqual(["a", "b"]);
    expect(r.fin).toBe("2027-06-30");
    expect(r.cheminCritique).toEqual(["b"]);
    expect(r.nombreRecalees).toBe(0);
    expect(r.nombreConflits).toBe(0);
  });

  it("décale un successeur au lendemain de l'échéance de son prédécesseur, durée conservée", () => {
    const r = recalerFeuilleDeRoute([
      ini("b", "2027-03-01", "2027-03-31", ["a"]),
      ini("a", "2027-01-01", "2027-04-15"),
    ]);
    const b = r.initiatives[0]!;
    expect(b.debut).toBe("2027-04-16");
    expect(b.echeance).toBe("2027-05-16");
    expect(b.decalageJours).toBe(46);
    expect(b.recalee).toBe(true);
    expect(b.contraintePar).toBe("a");
    expect(r.ordre).toEqual(["a", "b"]);
    expect(r.fin).toBe("2027-05-16");
    expect(r.cheminCritique).toEqual(["a", "b"]);
    expect(r.nombreRecalees).toBe(1);
  });

  it("propage le recalage en chaîne et retient la contrainte la plus tardive", () => {
    const r = recalerFeuilleDeRoute([
      ini("a", "2027-01-01", "2027-02-28"),
      ini("b", "2027-02-01", "2027-03-31", ["a"]),
      ini("c", "2027-01-15", "2027-01-31"),
      ini("d", "2027-03-15", "2027-04-30", ["c", "b"]),
    ]);
    const [, b, c, d] = r.initiatives;
    expect(b!.debut).toBe("2027-03-01");
    expect(b!.echeance).toBe("2027-04-28");
    expect(c!.recalee).toBe(false);
    // d dépend de b (fin recalée le 28 avril) et de c (fin le 31 janvier).
    expect(d!.debut).toBe("2027-04-29");
    expect(d!.echeance).toBe("2027-06-14");
    expect(d!.contraintePar).toBe("b");
    expect(r.cheminCritique).toEqual(["a", "b", "d"]);
    expect(r.fin).toBe("2027-06-14");
  });

  it("une contrainte tenue sans marge est liante (chemin critique), une marge positive ne l'est pas", () => {
    const r = recalerFeuilleDeRoute([
      ini("a", "2027-01-01", "2027-01-31"),
      ini("b", "2027-02-01", "2027-02-28", ["a"]),
      ini("c", "2027-03-15", "2027-03-31", ["b"]),
    ]);
    expect(r.initiatives.map((i) => i.decalageJours)).toEqual([0, 0, 0]);
    expect(r.initiatives[1]!.contraintePar).toBe("a");
    expect(r.initiatives[2]!.contraintePar).toBeNull();
    expect(r.cheminCritique).toEqual(["c"]);
  });

  it("un jalon (sans début) est décalé comme une initiative de durée nulle", () => {
    const r = recalerFeuilleDeRoute([
      ini("a", "2027-01-01", "2027-06-30"),
      ini("j", null, "2027-05-31", ["a"]),
    ]);
    expect(r.initiatives[1]).toMatchObject({
      debut: null,
      echeance: "2027-07-01",
      decalageJours: 31,
    });
  });

  it("une initiative en cours ou terminée garde ses dates et signale le conflit", () => {
    const r = recalerFeuilleDeRoute([
      ini("a", "2027-01-01", "2027-03-31"),
      ini("b", "2027-03-01", "2027-04-30", ["a"], "en_cours"),
      ini("c", "2027-04-01", "2027-04-15", ["a"], "terminee"),
      ini("d", "2027-05-01", "2027-05-31", ["b"], "en_cours"),
    ]);
    const [, b, c, d] = r.initiatives;
    expect(b).toMatchObject({ recalee: false, conflits: ["a"], contraintePar: "a" });
    // c commence le lendemain de la fin de a : contrainte tenue sans marge, donc liante.
    expect(c).toMatchObject({ recalee: false, conflits: [], contraintePar: "a" });
    expect(d).toMatchObject({ conflits: [], contraintePar: "b" });
    expect(r.nombreConflits).toBe(1);
  });

  it("une initiative suspendue est recalée comme une initiative à lancer", () => {
    const r = recalerFeuilleDeRoute([
      ini("a", "2027-01-01", "2027-03-31"),
      ini("b", "2027-02-01", "2027-02-28", ["a"], "suspendue"),
    ]);
    expect(r.initiatives[1]).toMatchObject({ debut: "2027-04-01", echeance: "2027-04-28" });
  });

  it("ignore les dépendances vers une initiative absente ou abandonnée", () => {
    const r = recalerFeuilleDeRoute([
      ini("a", "2027-01-01", "2027-12-31", [], "abandonnee"),
      ini("b", "2027-02-01", "2027-02-28", ["a", "retiree"]),
      ini("c", "2027-01-01", "2027-01-31", ["b"], "abandonnee"),
    ]);
    expect(r.initiatives[1]).toMatchObject({
      recalee: false,
      dependancesIgnorees: ["a", "retiree"],
    });
    // Une initiative abandonnée n'est pas contrainte ; elle ne compte pas dans la fin du plan.
    expect(r.initiatives[2]).toMatchObject({ recalee: false, dependancesIgnorees: ["b"] });
    expect(r.fin).toBe("2027-02-28");
    expect(r.cheminCritique).toEqual(["b"]);
  });

  it("aucune initiative active : pas de fin ni de chemin critique", () => {
    const vide = recalerFeuilleDeRoute([]);
    expect(vide).toMatchObject({ fin: null, cheminCritique: [], ordre: [] });
    const abandon = recalerFeuilleDeRoute([ini("a", null, "2027-01-01", [], "abandonnee")]);
    expect(abandon.fin).toBeNull();
  });

  it("à échéance égale, la première initiative reçue termine le chemin critique", () => {
    const r = recalerFeuilleDeRoute([ini("a", null, "2027-01-31"), ini("b", null, "2027-01-31")]);
    expect(r.cheminCritique).toEqual(["a"]);
  });

  it("gère le passage d'année et les années bissextiles", () => {
    const r = recalerFeuilleDeRoute([
      ini("a", "2027-11-01", "2028-02-28"),
      ini("b", "2027-12-01", "2027-12-31", ["a"]),
    ]);
    expect(r.initiatives[1]).toMatchObject({ debut: "2028-02-29", echeance: "2028-03-30" });
  });

  it("refuse les dates invalides ou incohérentes", () => {
    expect(erreurDe(() => recalerFeuilleDeRoute([ini("a", null, "2027-02-30")]))).toMatchObject({
      code: "DATE_INVALIDE",
      chemin: "initiatives[0].echeance",
    });
    expect(
      erreurDe(() => recalerFeuilleDeRoute([ini("a", "2027-13-01", "2027-12-31")])),
    ).toMatchObject({ code: "DATE_INVALIDE", chemin: "initiatives[0].debut" });
    expect(
      erreurDe(() => recalerFeuilleDeRoute([ini("a", "2027-06-01", "2027-05-31")])),
    ).toMatchObject({ code: "DATE_INVALIDE", chemin: "initiatives[0].debut" });
    const sansDate = {
      id: "a",
      debut: null,
      statut: "a_lancer",
    } as unknown as InitiativeFeuilleDeRoute;
    expect(erreurDe(() => recalerFeuilleDeRoute([sansDate])).code).toBe("DATE_INVALIDE");
  });

  it("refuse identifiants en double, dépendance vers soi, doublons et excès de dépendances", () => {
    expect(
      erreurDe(() =>
        recalerFeuilleDeRoute([ini("a", null, "2027-01-01"), ini("a", null, "2027-01-02")]),
      ),
    ).toMatchObject({ code: "DEPENDANCE_INVALIDE", chemin: "initiatives[1].id" });
    expect(erreurDe(() => recalerFeuilleDeRoute([ini("", null, "2027-01-01")])).code).toBe(
      "DEPENDANCE_INVALIDE",
    );
    expect(
      erreurDe(() => recalerFeuilleDeRoute([ini("a", null, "2027-01-01", ["a"])])),
    ).toMatchObject({ code: "DEPENDANCE_INVALIDE", chemin: "initiatives[0].dependances" });
    expect(
      erreurDe(() =>
        recalerFeuilleDeRoute([
          ini("a", null, "2027-01-01"),
          ini("b", null, "2027-01-01", ["a", "a"]),
        ]),
      ).code,
    ).toBe("DEPENDANCE_INVALIDE");
    const trop = Array.from({ length: DEPENDANCES_PAR_INITIATIVE_MAX + 1 }, (_, i) => `x${i}`);
    expect(erreurDe(() => recalerFeuilleDeRoute([ini("a", null, "2027-01-01", trop)])).code).toBe(
      "DEPENDANCE_INVALIDE",
    );
  });

  it("refuse un cycle, même à travers une initiative abandonnée", () => {
    const e = erreurDe(() =>
      recalerFeuilleDeRoute([
        ini("a", null, "2027-01-01", ["c"]),
        ini("b", null, "2027-01-01", ["a"], "abandonnee"),
        ini("c", null, "2027-01-01", ["b"]),
      ]),
    );
    expect(e).toBeInstanceOf(ErreurPlan);
    expect(e).toMatchObject({ code: "DEPENDANCE_CYCLIQUE", chemin: "initiatives[0].dependances" });
  });

  it("initiative sans liste de dépendances", () => {
    const r = recalerFeuilleDeRoute([
      { id: "a", debut: null, echeance: "2027-01-01", statut: "a_lancer" },
    ]);
    expect(r.initiatives[0]!.dependancesIgnorees).toEqual([]);
  });
});

describe("controlerDependances", () => {
  it("accepte un graphe sans cycle aux dépendances connues", () => {
    expect(() =>
      controlerDependances([ini("a", null, "2027-01-01"), ini("b", null, "2027-02-01", ["a"])]),
    ).not.toThrow();
  });

  it("refuse une dépendance inconnue", () => {
    expect(
      erreurDe(() => controlerDependances([ini("a", null, "2027-01-01", ["fantome"])])),
    ).toMatchObject({ code: "DEPENDANCE_INVALIDE", chemin: "initiatives[0].dependances" });
  });

  it("refuse un cycle direct", () => {
    expect(
      erreurDe(() =>
        controlerDependances([
          ini("a", null, "2027-01-01", ["b"]),
          ini("b", null, "2027-01-01", ["a"]),
        ]),
      ).code,
    ).toBe("DEPENDANCE_CYCLIQUE");
  });
});
