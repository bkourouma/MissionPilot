import { describe, expect, it } from "vitest";
import { montant } from "../finance/monnaie";
import type { Affectation } from "../planning/capacite";
import {
  besoinMembreDemo,
  choisirAvenantsDemo,
  decoupageCoherentDemo,
  fenetreDuMoisDemo,
  joursOuvresDemo,
  LIBELLE_PHASE_PROLONGATION_DEMO,
  libelleTacheProlongationDemo,
  motifAvenantDemo,
  repartirEcheancesDemo,
  type BesoinMembreDemo,
  type CandidatSocleDemo,
  type EntreeBesoinDemo,
} from "./index";

const FENETRE = fenetreDuMoisDemo("2026-11");

function affectation(debut: string, fin: string, jours: number, personneId = "k"): Affectation {
  return {
    id: `${personneId}-${debut}`,
    personneId,
    tacheId: "t",
    joursAlloues: jours,
    debut,
    fin,
  };
}

function entree(sur: Partial<EntreeBesoinDemo> = {}): EntreeBesoinDemo {
  return {
    collaborateurId: "k",
    capacitePct: 100,
    absences: [],
    affectations: [],
    encadrant: false,
    ...sur,
  };
}

function besoin(sur: Partial<EntreeBesoinDemo> = {}, fenetre = FENETRE, clotures: string[] = []) {
  return besoinMembreDemo(entree(sur), fenetre, {}, clotures);
}

describe("libellés de l'avenant", () => {
  it("phase, tâche et motif de la révision", () => {
    expect(LIBELLE_PHASE_PROLONGATION_DEMO).toBe("Prolongations (démonstration)");
    expect(libelleTacheProlongationDemo("2026-11")).toBe("Prolongation — novembre 2026");
    expect(motifAvenantDemo("2026-11")).toBe(
      "Avenant de prolongation novembre 2026 (démonstration)",
    );
    expect(() => motifAvenantDemo("2026-13")).toThrow(RangeError);
  });
});

describe("besoin d'un membre sur la fenêtre du mois", () => {
  it("sans affectation : 85 % de la capacité, au pas inférieur, sur les six semaines", () => {
    expect(FENETRE).toEqual({ debut: "2026-10-26", fin: "2026-12-06" });
    expect(besoin()).toEqual({
      collaborateurId: "k",
      centiemes: 2400,
      debut: "2026-10-26",
      fin: "2026-12-06",
    });
  });

  it("net des affectations : une semaine couverte vaut 0 et décale le début", () => {
    const couverte = affectation("2026-10-26", "2026-10-30", 5);
    expect(besoin({ affectations: [couverte] })).toMatchObject({
      centiemes: 2000,
      debut: "2026-11-02",
    });
    const partielle = affectation("2026-11-02", "2026-11-03", 2);
    expect(besoin({ affectations: [couverte, partielle] })?.centiemes).toBe(1800);
  });

  it("affectation proratisée sur deux semaines : chaque semaine reste au pas de 0,5 jour", () => {
    // Vendredi, lundi, mardi : 1/3 de jour la première semaine, 2/3 la seconde.
    const aCheval = affectation("2026-11-06", "2026-11-10", 1);
    const b = besoin({ affectations: [aCheval] });
    expect(b?.centiemes).toBe(2250);
    expect((b?.centiemes ?? 0) % 50).toBe(0);
  });

  it("ignore les affectations d'un autre collaborateur", () => {
    const autre = affectation("2026-10-26", "2026-12-04", 30, "j");
    expect(besoin({ affectations: [autre] })?.centiemes).toBe(2400);
  });

  it("encadrant sans affectation : 50 % de la capacité", () => {
    expect(besoin({ encadrant: true })?.centiemes).toBe(1500);
  });

  it("capacité réduite et mois clôturé", () => {
    expect(besoin({ capacitePct: 50 })?.centiemes).toBe(1200);
    const octobreClos = besoin({}, FENETRE, ["2026-10"]);
    expect(octobreClos).toMatchObject({ centiemes: 2000, debut: "2026-11-02" });
  });

  it("moins d'un jour, ou tout déjà affecté : null", () => {
    const semaine = { debut: "2026-11-02", fin: "2026-11-08" };
    const deuxJours = affectation("2026-11-02", "2026-11-03", 2);
    expect(besoin({ encadrant: true, affectations: [deuxJours] }, semaine)).toBeNull();
    const tout = affectation("2026-10-26", "2026-12-04", 30);
    expect(besoin({ affectations: [tout] })).toBeNull();
  });

  it("la fin est bornée par la fenêtre", () => {
    const courte = { debut: "2026-11-02", fin: "2026-11-11" };
    expect(besoin({}, courte)).toEqual({
      collaborateurId: "k",
      centiemes: 650,
      debut: "2026-11-02",
      fin: "2026-11-11",
    });
  });

  it("refuse une fenêtre inversée ou qui ne commence pas un lundi", () => {
    expect(() => besoin({}, { debut: "2026-11-03", fin: "2026-11-30" })).toThrow(RangeError);
    expect(() => besoin({}, { debut: "2026-11-30", fin: "2026-11-02" })).toThrow(RangeError);
  });
});

function candidat(sur: Partial<CandidatSocleDemo> & { missionId: string }): CandidatSocleDemo {
  return {
    dateDebut: "2026-09-01",
    dateFin: "2026-12-31",
    budgetCentiemes: 1000,
    affectes: [],
    encadrants: [],
    clesBudget: ["grade:CONS"],
    eligible: true,
    ...sur,
  };
}

function membre(id: string, centiemes: number, debut = "2026-10-26"): BesoinMembreDemo {
  return { collaborateurId: id, centiemes, debut, fin: "2026-12-06" };
}

describe("choix des avenants", () => {
  const kora = candidat({
    missionId: "kora",
    budgetCentiemes: 6600,
    affectes: ["k", "j"],
    encadrants: ["chef"],
    clesBudget: ["grade:CONS", "collaborateur:j"],
  });
  const akwaba = candidat({
    missionId: "akwaba",
    dateFin: "2027-06-30",
    budgetCentiemes: 3000,
    affectes: ["x"],
    encadrants: ["k", "chef"],
    clesBudget: ["grade:CONS", "grade:DIR"],
  });
  const grades = { k: "CONS", j: "JUN", chef: "DIR", x: "CONS" };
  const socleDe = (c: CandidatSocleDemo[]) =>
    choisirAvenantsDemo([membre("k", 500)], grades, c)[0]?.missionId;

  it("affecté d'abord, clé nominative puis de grade, encadrant à défaut", () => {
    const besoins = [
      membre("k", 2400),
      membre("j", 2400, "2026-11-02"),
      membre("chef", 1500),
      membre("x", 2000),
    ];
    const avenants = choisirAvenantsDemo(besoins, grades, [akwaba, kora]);
    expect(avenants).toEqual([
      {
        missionId: "kora",
        debut: "2026-10-26",
        fin: "2026-12-06",
        membres: [
          { ...membre("j", 2400, "2026-11-02"), cleBudget: "collaborateur:j" },
          { ...membre("k", 2400), cleBudget: "grade:CONS" },
        ],
        lignes: [
          { cle: "collaborateur:j", centiemes: 2400 },
          { cle: "grade:CONS", centiemes: 2400 },
        ],
        totalCentiemes: 4800,
      },
      {
        missionId: "akwaba",
        debut: "2026-10-26",
        fin: "2026-12-06",
        membres: [
          { ...membre("chef", 1500), cleBudget: "grade:DIR" },
          { ...membre("x", 2000), cleBudget: "grade:CONS" },
        ],
        lignes: [
          { cle: "grade:CONS", centiemes: 2000 },
          { cle: "grade:DIR", centiemes: 1500 },
        ],
        totalCentiemes: 3500,
      },
    ]);
    const melanges = choisirAvenantsDemo([...besoins].reverse(), grades, [kora, akwaba]);
    expect(melanges).toEqual(avenants);
  });

  it("entre deux missions où il est affecté : date de fin la plus tardive, sans date en dernier", () => {
    const a = candidat({ missionId: "a", affectes: ["k"] });
    const b = candidat({ missionId: "b", affectes: ["k"], dateFin: "2027-03-31" });
    const sansFin = candidat({ missionId: "c", affectes: ["k"], dateFin: null });
    const autreSansFin = candidat({ missionId: "d", affectes: ["k"], dateFin: null });
    expect(socleDe([a, b])).toBe("b");
    expect(socleDe([sansFin, a])).toBe("a");
    expect(socleDe([a, sansFin])).toBe("a");
    expect(socleDe([autreSansFin, sansFin])).toBe("c");
  });

  it("puis le budget le plus élevé, puis l'id", () => {
    const petite = candidat({ missionId: "a", affectes: ["k"] });
    const grande = candidat({ missionId: "z", affectes: ["k"], budgetCentiemes: 2000 });
    const jumelle = candidat({ missionId: "b", affectes: ["k"] });
    expect(socleDe([petite, grande])).toBe("z");
    expect(socleDe([jumelle, petite])).toBe("a");
  });

  it("clé absente, mission non éligible ou étrangère : membre exclu", () => {
    const sansCle = candidat({ missionId: "a", affectes: ["y"], clesBudget: ["grade:DIR"] });
    expect(choisirAvenantsDemo([membre("y", 500)], { y: null }, [sansCle])).toEqual([]);
    expect(choisirAvenantsDemo([membre("y", 500)], { y: "CONS" }, [sansCle])).toEqual([]);
    expect(choisirAvenantsDemo([membre("y", 500)], {}, [sansCle])).toEqual([]);
    const fermee = candidat({ missionId: "b", affectes: ["k"], eligible: false });
    expect(socleDe([fermee])).toBeUndefined();
    const etrangere = candidat({ missionId: "c", affectes: ["autre"] });
    expect(socleDe([etrangere])).toBeUndefined();
  });

  it("plafond de 60 jours par mission, membres par id, le dernier tronqué", () => {
    const socle = candidat({ missionId: "a", affectes: ["m1", "m2", "m3", "m4"] });
    const tous = { m1: "CONS", m2: "CONS", m3: "CONS", m4: "CONS" };
    const besoins = ["m4", "m3", "m2", "m1"].map((id) => membre(id, 2400));
    const [avenant] = choisirAvenantsDemo(besoins, tous, [socle]);
    expect(avenant?.totalCentiemes).toBe(6000);
    expect(avenant?.membres.map((m) => [m.collaborateurId, m.centiemes])).toEqual([
      ["m1", 2400],
      ["m2", 2400],
      ["m3", 1200],
    ]);
    expect(avenant?.lignes).toEqual([{ cle: "grade:CONS", centiemes: 6000 }]);
  });

  it("au plus 10 avenants par mois : les plus gros, puis l'id", () => {
    const candidats: CandidatSocleDemo[] = [];
    const besoins: BesoinMembreDemo[] = [];
    const codes: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      const id = `c${String(i).padStart(2, "0")}`;
      candidats.push(candidat({ missionId: `m${id}`, affectes: [id] }));
      besoins.push(membre(id, i < 3 ? 1000 : 1000 + i * 100));
      codes[id] = "CONS";
    }
    const avenants = choisirAvenantsDemo(besoins, codes, candidats);
    expect(avenants.map((a) => a.missionId)).toEqual([
      "mc11",
      "mc10",
      "mc09",
      "mc08",
      "mc07",
      "mc06",
      "mc05",
      "mc04",
      "mc03",
      "mc00",
    ]);
  });

  it("un membre sous un jour n'ouvre pas d'avenant ; un besoin invalide est refusé", () => {
    const socle = candidat({ missionId: "a", affectes: ["k"] });
    expect(choisirAvenantsDemo([membre("k", 50)], grades, [socle])).toEqual([]);
    expect(() => choisirAvenantsDemo([membre("k", -100)], grades, [socle])).toThrow(RangeError);
  });
});

describe("cohérence du découpage avec la référence (DT12)", () => {
  const nominative = { cle: "collaborateur:j", centiemes: 2400 };
  const parGrade = { cle: "grade:CONS", centiemes: 2400 };
  const reference = [nominative, parGrade];

  it("égal : lignes de même clé additionnées, ordre indifférent, zéros ignorés", () => {
    const decoupage = [
      parGrade,
      { cle: "collaborateur:j", centiemes: 1200 },
      { cle: "grade:DIR", centiemes: 0 },
      { cle: "collaborateur:j", centiemes: 1200 },
    ];
    expect(decoupageCoherentDemo(decoupage, reference)).toBe(true);
  });

  it("écart, clé manquante, clé en trop, clé différente : incohérent", () => {
    const ecart = [nominative, { cle: "grade:CONS", centiemes: 2350 }];
    expect(decoupageCoherentDemo(ecart, reference)).toBe(false);
    expect(decoupageCoherentDemo([nominative], reference)).toBe(false);
    const enTrop = [...reference, { cle: "grade:DIR", centiemes: 100 }];
    expect(decoupageCoherentDemo(enTrop, reference)).toBe(false);
    const autre = [nominative, { cle: "grade:DIR", centiemes: 2400 }];
    expect(decoupageCoherentDemo(autre, reference)).toBe(false);
  });

  it("refuse des centièmes non entiers", () => {
    const demi = [{ cle: "grade:CONS", centiemes: 0.5 }];
    expect(() => decoupageCoherentDemo(demi, [])).toThrow(RangeError);
  });
});

describe("jours ouvrés d'une tâche d'avenant", () => {
  it("compte les jours ouvrés, borné à [1 ; 1000]", () => {
    const novembre = { debut: "2026-11-02", fin: "2026-11-27" };
    expect(joursOuvresDemo(novembre, {})).toBe(20);
    expect(joursOuvresDemo(novembre, { feries: ["2026-11-11"] })).toBe(19);
    expect(joursOuvresDemo({ debut: "2026-11-07", fin: "2026-11-08" }, {})).toBe(1);
    expect(joursOuvresDemo({ debut: "2026-01-01", fin: "2031-12-31" }, {})).toBe(1000);
    const inversee = { debut: "2026-11-27", fin: "2026-11-02" };
    expect(() => joursOuvresDemo(inversee, {})).toThrow(RangeError);
  });
});

describe("échéances de la prolongation", () => {
  it("parts égales sur les lundis croissants, somme exacte", () => {
    const parts = repartirEcheancesDemo(montant(1000, "XOF"), [
      "2026-11-16",
      "2026-11-02",
      "2026-11-09",
      "2026-11-02",
    ]);
    expect(parts).toEqual([
      { date: "2026-11-02", montant: montant(333, "XOF") },
      { date: "2026-11-09", montant: montant(333, "XOF") },
      { date: "2026-11-16", montant: montant(334, "XOF") },
    ]);
    const euros = repartirEcheancesDemo(montant(100001, "EUR"), ["2026-11-02", "2026-11-09"]);
    expect(euros.map((p) => p.montant.valeur)).toEqual([50000, 50001]);
  });

  it("delta nul ou négatif, ou aucun lundi : aucune échéance", () => {
    expect(repartirEcheancesDemo(montant(0, "XOF"), ["2026-11-02"])).toEqual([]);
    expect(repartirEcheancesDemo(montant(-500, "XOF"), ["2026-11-02"])).toEqual([]);
    expect(repartirEcheancesDemo(montant(500, "XOF"), [])).toEqual([]);
  });

  it("refuse une date qui n'est pas un lundi", () => {
    expect(() => repartirEcheancesDemo(montant(500, "XOF"), ["2026-11-03"])).toThrow(RangeError);
  });
});
