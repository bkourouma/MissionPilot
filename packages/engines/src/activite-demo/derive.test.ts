import { describe, expect, it } from "vitest";
import {
  ajusterDeriveDemo,
  atterrissageDemo,
  choisirMissionDeriveDemo,
  choisirPorteuseDemo,
  type MissionDeriveDemo,
  type TacheDeriveDemo,
} from "./index";

function tache(sur: Partial<TacheDeriveDemo> = {}): TacheDeriveDemo {
  return {
    tacheId: "t1",
    budgetCentiemes: 1000,
    realiseCentiemes: 0,
    declarations: {},
    affectes: ["c"],
    ...sur,
  };
}

/** Kora (Lagune) : Diagnostic 42 j dont 30 réalisés, sans déclaration ; Orientations 24 j. */
const DIAGNOSTIC = tache({
  tacheId: "diagnostic",
  budgetCentiemes: 4200,
  realiseCentiemes: 3000,
  affectes: ["junior", "consultant"],
});
const ORIENTATIONS = tache({
  tacheId: "orientations",
  budgetCentiemes: 2400,
  affectes: ["consultant"],
});
const KORA: MissionDeriveDemo = {
  missionId: "kora",
  declarable: true,
  taches: [DIAGNOSTIC, ORIENTATIONS],
};

const PORTEUSE = { tacheId: "t1", collaborateurId: "c" };

/** Mission d'une seule tâche dont l'atterrissage vaut `atterrissage` (déclaration de c). */
function mission(id: string, budget: number, atterrissage: number, declarable = true) {
  const t = tache({ budgetCentiemes: budget, declarations: { c: atterrissage } });
  return { missionId: id, declarable, taches: [t] };
}

describe("atterrissage et écart à terminaison", () => {
  it("réalisé + déclarations, sinon max(0, budget − réalisé)", () => {
    expect(atterrissageDemo(KORA)).toEqual({
      budgetCentiemes: 6600,
      atterrissageCentiemes: 6600,
      ecartPourMille: 0,
    });
    const depasse = { ...KORA, taches: [tache({ budgetCentiemes: 500, realiseCentiemes: 900 })] };
    expect(atterrissageDemo(depasse)).toMatchObject({
      atterrissageCentiemes: 900,
      ecartPourMille: 800,
    });
    const declaree = tache({ realiseCentiemes: 200, declarations: { a: 300, b: 100 } });
    expect(atterrissageDemo({ ...KORA, taches: [declaree] }).atterrissageCentiemes).toBe(600);
  });

  it("budget nul : écart null ; tronqué vers zéro des deux côtés", () => {
    expect(atterrissageDemo(mission("m", 0, 0)).ecartPourMille).toBeNull();
    expect(atterrissageDemo(mission("m", 6600, 7400)).ecartPourMille).toBe(121);
    expect(atterrissageDemo(mission("m", 6600, 5800)).ecartPourMille).toBe(-121);
  });

  it("refuse des centièmes négatifs ou non entiers", () => {
    const invalides: Partial<TacheDeriveDemo>[] = [
      { budgetCentiemes: -1 },
      { realiseCentiemes: 0.5 },
      { declarations: { c: -50 } },
    ];
    for (const sur of invalides) {
      expect(() => atterrissageDemo({ ...KORA, taches: [tache(sur)] })).toThrow(RangeError);
    }
  });
});

describe("ajustement de la dérive (DT6)", () => {
  it("cas Kora : 20 jours déclarés sur Diagnostic, environ +121 ‰", () => {
    const porteuse = { tacheId: "diagnostic", collaborateurId: "consultant" };
    expect(choisirPorteuseDemo(KORA, null)).toEqual(porteuse);
    expect(ajusterDeriveDemo(KORA, porteuse)).toEqual({
      ...porteuse,
      centiemes: 2000,
      avantPourMille: 0,
      apresPourMille: 121,
    });
    const diagnostic = { ...DIAGNOSTIC, declarations: { consultant: 2000 } };
    const apres = { ...KORA, taches: [diagnostic, ORIENTATIONS] };
    expect(atterrissageDemo(apres).ecartPourMille).toBe(121);
    expect(ajusterDeriveDemo(apres, porteuse)).toBeNull();
  });

  it("dans la bande (100 ‰) : aucune écriture ; bornes 80 exclue et 160 incluse", () => {
    expect(ajusterDeriveDemo(mission("m", 1000, 1100), PORTEUSE)).toBeNull();
    expect(ajusterDeriveDemo(mission("m", 1000, 1160), PORTEUSE)).toBeNull();
    expect(ajusterDeriveDemo(mission("m", 1000, 1080), PORTEUSE)?.centiemes).toBe(1150);
  });

  it("écart de 200 ‰ sur la paire du job : baisse vers la cible", () => {
    const m = { ...KORA, taches: [tache({ realiseCentiemes: 500, declarations: { c: 700 } })] };
    expect(ajusterDeriveDemo(m, PORTEUSE)).toEqual({
      ...PORTEUSE,
      centiemes: 650,
      avantPourMille: 200,
      apresPourMille: 150,
    });
  });

  it("impossible de descendre davantage : X = 0, puis plus rien à écrire", () => {
    const fige = tache({ budgetCentiemes: 500, realiseCentiemes: 900, declarations: { c: 300 } });
    const autre = tache({ tacheId: "t2", budgetCentiemes: 500 });
    const m = { ...KORA, taches: [fige, autre] };
    expect(ajusterDeriveDemo(m, PORTEUSE)).toMatchObject({
      centiemes: 0,
      avantPourMille: 700,
      apresPourMille: 400,
    });
    const zero = { ...m, taches: [{ ...fige, declarations: { c: 0 } }, autre] };
    expect(ajusterDeriveDemo(zero, PORTEUSE)).toBeNull();
  });

  it("tient compte des déclarations des autres collaborateurs et arrondit au pas supérieur", () => {
    const partagee = tache({
      realiseCentiemes: 200,
      declarations: { autre: 300 },
      affectes: ["c", "autre"],
    });
    const a = ajusterDeriveDemo({ ...KORA, taches: [partagee] }, PORTEUSE);
    expect(a).toMatchObject({ centiemes: 650, avantPourMille: -500, apresPourMille: 150 });
    const impaire = { ...KORA, taches: [tache({ budgetCentiemes: 1010 })] };
    const b = ajusterDeriveDemo(impaire, PORTEUSE);
    expect(b).toMatchObject({ centiemes: 1150, avantPourMille: 0, apresPourMille: 138 });
  });

  it("budget nul : rien ; tâche porteuse absente : RangeError", () => {
    expect(ajusterDeriveDemo(mission("m", 0, 0), PORTEUSE)).toBeNull();
    const absente = { tacheId: "absente", collaborateurId: "c" };
    expect(() => ajusterDeriveDemo(KORA, absente)).toThrow(RangeError);
  });
});

describe("choix de la mission en dérive", () => {
  const neutre = mission("a", 1000, 1000);
  const semee = mission("b", 1000, 1090);

  it("garde la mission marquée encore éligible", () => {
    expect(choisirMissionDeriveDemo([neutre, semee], "a")).toBe("a");
  });

  it("remplace une mission marquée devenue clôturée ou sans déclarant", () => {
    expect(choisirMissionDeriveDemo([neutre, semee], "close")).toBe("b");
    const sansDeclarant = mission("a", 1000, 1000, false);
    expect(choisirMissionDeriveDemo([sansDeclarant, semee], "a")).toBe("b");
  });

  it("reprend une dérive semée (90 ‰) plutôt que d'en créer une", () => {
    expect(choisirMissionDeriveDemo([neutre, semee], null)).toBe("b");
    expect(choisirMissionDeriveDemo([semee, neutre], null)).toBe("b");
  });

  it("au-delà de 50 ‰ : la plus proche de 120 ‰, puis le budget, puis l'id", () => {
    const c = mission("c", 1000, 1100);
    const d = mission("d", 2000, 2280);
    const e = mission("e", 1000, 1140);
    expect(choisirMissionDeriveDemo([c, d], null)).toBe("d");
    expect(choisirMissionDeriveDemo([e, c], null)).toBe("c");
    expect(choisirMissionDeriveDemo([mission("loin", 1000, 1600), c], null)).toBe("c");
  });

  it("sinon le plus fort écart, puis le budget", () => {
    const f = mission("f", 1000, 1010);
    const g = mission("g", 1000, 1040);
    const h = mission("h", 2000, 2080);
    const i = mission("i", 1000, 500);
    expect(choisirMissionDeriveDemo([f, g], null)).toBe("g");
    expect(choisirMissionDeriveDemo([g, h], null)).toBe("h");
    expect(choisirMissionDeriveDemo([i, f], null)).toBe("f");
  });

  it("aucune mission éligible : budget nul, aucun affecté, sans déclarant", () => {
    const sansAffecte = { ...neutre, missionId: "x", taches: [tache({ affectes: [] })] };
    const vides = [mission("z", 0, 0), sansAffecte, mission("y", 1000, 1000, false)];
    expect(choisirMissionDeriveDemo(vides, null)).toBeNull();
    expect(choisirMissionDeriveDemo([], "a")).toBeNull();
  });
});

describe("paire porteuse", () => {
  const attendue = { tacheId: "diagnostic", collaborateurId: "consultant" };

  it("garde la paire marquée si elle est encore valide", () => {
    const marquee = { tacheId: "diagnostic", collaborateurId: "junior" };
    expect(choisirPorteuseDemo(KORA, marquee)).toEqual(marquee);
  });

  it("remplace une paire dont le collaborateur n'est plus affecté ou dont la tâche a disparu", () => {
    const plusAffecte = { tacheId: "orientations", collaborateurId: "junior" };
    expect(choisirPorteuseDemo(KORA, plusAffecte)).toEqual(attendue);
    const disparue = { tacheId: "absente", collaborateurId: "junior" };
    expect(choisirPorteuseDemo(KORA, disparue)).toEqual(attendue);
  });

  it("sinon la plus forte déclaration d'un collaborateur affecté", () => {
    const m: MissionDeriveDemo = {
      missionId: "m",
      declarable: true,
      taches: [
        tache({ declarations: { x: 300, y: 500 }, affectes: ["x", "y"] }),
        tache({ tacheId: "t2", declarations: { z: 800 }, affectes: [] }),
      ],
    };
    expect(choisirPorteuseDemo(m, null)).toEqual({ tacheId: "t1", collaborateurId: "y" });
    const egalite: MissionDeriveDemo = {
      ...m,
      taches: [
        tache({ tacheId: "t2", declarations: { y: 500 }, affectes: ["y"] }),
        tache({ declarations: { x: 500, w: 500 }, affectes: ["x", "w"] }),
      ],
    };
    expect(choisirPorteuseDemo(egalite, null)).toEqual({ tacheId: "t1", collaborateurId: "w" });
  });

  it("sinon la tâche de plus gros budget qui a un affecté, et son premier affecté par id", () => {
    const m: MissionDeriveDemo = {
      missionId: "m",
      declarable: true,
      taches: [
        tache({ budgetCentiemes: 100, affectes: ["b", "a"] }),
        tache({ tacheId: "t2", budgetCentiemes: 300, affectes: [] }),
        tache({ tacheId: "t3", budgetCentiemes: 200, affectes: ["c"] }),
      ],
    };
    expect(choisirPorteuseDemo(m, null)).toEqual({ tacheId: "t3", collaborateurId: "c" });
    const t0 = tache({ tacheId: "t0", budgetCentiemes: 200, affectes: ["z", "y"] });
    expect(choisirPorteuseDemo({ ...m, taches: [...m.taches, t0] }, null)).toEqual({
      tacheId: "t0",
      collaborateurId: "y",
    });
    const sansAffecte = { ...m, taches: [tache({ affectes: [] })] };
    expect(choisirPorteuseDemo(sansAffecte, null)).toBeNull();
  });
});
