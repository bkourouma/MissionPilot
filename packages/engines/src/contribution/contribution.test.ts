import { describe, expect, it } from "vitest";
import * as contribution from "./index";
import {
  agregerTempsRevue,
  contributionIa,
  decouperMots,
  distanceEditionMots,
  ErreurContribution,
  evaluerModificationMajeure,
  syntheseContributionsIa,
} from "./index";

const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurContribution);
    return (e as ErreurContribution).code;
  }
  return undefined;
};

/** Références naïves en O(n·m) pour la vérification croisée. */
function levenshteinNaif(a: string[], b: string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length]![b.length]!;
}

function lcsNaif(a: string[], b: string[]): number {
  const l = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      l[i]![j] =
        a[i - 1] === b[j - 1] ? l[i - 1]![j - 1]! + 1 : Math.max(l[i - 1]![j]!, l[i]![j - 1]!);
    }
  }
  return l[a.length]![b.length]!;
}

/** Générateur pseudo-aléatoire à graine fixe (congruentiel linéaire). */
function generateur(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (Math.imul(etat, 1_664_525) + 1_013_904_223) >>> 0;
    return etat / 2 ** 32;
  };
}

describe("decouperMots", () => {
  it("découpe sur les blancs Unicode, garde la ponctuation, normalise en NFC", () => {
    expect(decouperMots("  La marge,\tbrute\n baisse. ")).toEqual([
      "La",
      "marge,",
      "brute",
      "baisse.",
    ]);
    expect(decouperMots("")).toEqual([]);
    expect(decouperMots("été")).toEqual(decouperMots("été"));
  });

  it("refuse un texte absent ou trop long", () => {
    expect(code(() => decouperMots(null as never))).toBe("TEXTE_INVALIDE");
    expect(code(() => decouperMots("a ".repeat(100_001)))).toBe("TEXTE_TROP_LONG");
  });
});

describe("distanceEditionMots", () => {
  it("compte insertions, suppressions et substitutions de mots", () => {
    expect(distanceEditionMots("a b c", "a b c")).toEqual({
      distance: 0,
      exacte: true,
      motsA: 3,
      motsB: 3,
    });
    expect(distanceEditionMots("a b c", "a x c").distance).toBe(1);
    expect(distanceEditionMots("a b", "a b c d").distance).toBe(2);
    expect(distanceEditionMots("", "a b").distance).toBe(2);
    expect(distanceEditionMots("a b c", "").distance).toBe(3);
    expect(distanceEditionMots("x a b c", "a b c y").distance).toBe(2);
  });

  it("égale la référence naïve sur des textes pseudo-aléatoires", () => {
    const hasard = generateur(42);
    const vocabulaire = ["la", "marge", "baisse", "de", "cinq", "points"];
    const texte = (max: number) =>
      Array.from(
        { length: Math.floor(hasard() * max) },
        () => vocabulaire[Math.floor(hasard() * 6)]!,
      );
    for (let essai = 0; essai < 300; essai += 1) {
      const a = texte(40);
      const b = hasard() < 0.5 ? texte(40) : a.map((m) => (hasard() < 0.15 ? "autre" : m));
      const r = distanceEditionMots(a.join(" "), b.join(" "));
      expect(r.exacte).toBe(true);
      expect(r.distance).toBe(levenshteinNaif(a, b));
      const c = contributionIa({ brouillon: a.join(" "), valide: b.join(" ") });
      expect(c.motsConserves).toBe(lcsNaif(a, b));
    }
  });

  it("élargit la bande sur de longs textes très différents, puis estime au-delà du budget", () => {
    const a = Array.from({ length: 300 }, (_, i) => `m${i}`).join(" ");
    const b = Array.from({ length: 300 }, (_, i) => `n${i}`).join(" ");
    expect(distanceEditionMots(a, b)).toMatchObject({ distance: 300, exacte: true });
    const estimee = distanceEditionMots(`debut ${a} fin`, `debut ${b} fin`, { cellulesMax: 1_000 });
    expect(estimee).toEqual({ distance: 300, exacte: false, motsA: 302, motsB: 302 });
    expect(code(() => distanceEditionMots("a", "b", { cellulesMax: 0 }))).toBe("OPTIONS_INVALIDES");
  });
});

describe("evaluerModificationMajeure", () => {
  it("strictement au-dessus du seuil, comparé sur la valeur exacte", () => {
    expect(
      evaluerModificationMajeure({ distance: 25, motsBrouillon: 100, motsValides: 90 }),
    ).toEqual({
      majeure: false,
      tauxModificationPct: 25,
      seuilPct: 25,
    });
    expect(
      evaluerModificationMajeure({ distance: 26, motsBrouillon: 100, motsValides: 100 }).majeure,
    ).toBe(true);
    // 1 / 3 = 33,3 % : majeure au seuil 33, pas au seuil 34.
    expect(
      evaluerModificationMajeure({ distance: 1, motsBrouillon: 3, motsValides: 3 }, 33),
    ).toEqual({
      majeure: true,
      tauxModificationPct: 33,
      seuilPct: 33,
    });
    expect(
      evaluerModificationMajeure({ distance: 1, motsBrouillon: 3, motsValides: 3 }, 34).majeure,
    ).toBe(false);
    expect(evaluerModificationMajeure({ distance: 0, motsBrouillon: 0, motsValides: 0 })).toEqual({
      majeure: false,
      tauxModificationPct: 0,
      seuilPct: 25,
    });
  });

  it("refuse seuil et mesures invalides", () => {
    const m = { distance: 1, motsBrouillon: 2, motsValides: 2 };
    expect(code(() => evaluerModificationMajeure(m, 101))).toBe("OPTIONS_INVALIDES");
    expect(code(() => evaluerModificationMajeure(m, 2.5))).toBe("OPTIONS_INVALIDES");
    expect(code(() => evaluerModificationMajeure({ ...m, distance: -1 }))).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(code(() => evaluerModificationMajeure({ ...m, distance: 3 }))).toBe("OPTIONS_INVALIDES");
  });
});

describe("agregerTempsRevue", () => {
  it("somme, médiane (demi vers le haut) et maximum", () => {
    expect(agregerTempsRevue([])).toEqual({
      sessions: 0,
      totalSecondes: 0,
      medianeSecondes: 0,
      maxSecondes: 0,
    });
    expect(agregerTempsRevue([30, 10, 20])).toEqual({
      sessions: 3,
      totalSecondes: 60,
      medianeSecondes: 20,
      maxSecondes: 30,
    });
    expect(agregerTempsRevue([21, 10]).medianeSecondes).toBe(16);
  });

  it("refuse une durée négative ou fractionnaire", () => {
    expect(code(() => agregerTempsRevue([-1]))).toBe("DUREE_INVALIDE");
    expect(code(() => agregerTempsRevue([1.5]))).toBe("DUREE_INVALIDE");
  });
});

describe("contributionIa (AGT-05)", () => {
  it("mesure la part conservée, la distance et la modification", () => {
    const c = contributionIa({
      brouillon: "La marge brute baisse de cinq points sur l'exercice",
      valide: "La marge brute recule de cinq points sur l'exercice 2025",
      sessionsRevueSecondes: [120, 60],
    });
    expect(c).toMatchObject({
      motsBrouillon: 9,
      motsValides: 10,
      distance: 2,
      motsConserves: 8,
      partConserveePct: 89,
      exacte: true,
    });
    expect(c.modification).toEqual({ majeure: false, tauxModificationPct: 20, seuilPct: 25 });
    expect(c.tempsRevue.totalSecondes).toBe(180);
  });

  it("brouillon conservé entier mais complété : 100 % conservé, modification majeure", () => {
    const c = contributionIa({ brouillon: "a b", valide: "a b c d" });
    expect(c.partConserveePct).toBe(100);
    expect(c.modification).toMatchObject({ majeure: true, tauxModificationPct: 50 });
  });

  it("brouillon vide : part conservée nulle ; seuil paramétrable et contrôlé", () => {
    expect(
      contributionIa({ brouillon: " ", valide: "texte écrit à la main" }).partConserveePct,
    ).toBeNull();
    const c = contributionIa(
      { brouillon: "a b c d", valide: "a b c e" },
      { seuilModificationMajeurePct: 20 },
    );
    expect(c.modification).toMatchObject({ majeure: true, tauxModificationPct: 25, seuilPct: 20 });
    expect(
      code(() =>
        contributionIa({ brouillon: "a", valide: "a" }, { seuilModificationMajeurePct: -1 }),
      ),
    ).toBe("OPTIONS_INVALIDES");
  });

  it("estimation prudente signalée quand le budget est dépassé", () => {
    const a = Array.from({ length: 50 }, (_, i) => `m${i}`).join(" ");
    const b = Array.from({ length: 50 }, (_, i) => `n${i}`).join(" ");
    const c = contributionIa({ brouillon: `x ${a} y`, valide: `x ${b} y` }, { cellulesMax: 10 });
    expect(c).toMatchObject({ exacte: false, motsConserves: 2, partConserveePct: 4, distance: 50 });
  });
});

describe("syntheseContributionsIa", () => {
  it("pondère par la taille des brouillons", () => {
    const c1 = contributionIa({ brouillon: "a b c d", valide: "a b c d" });
    const c2 = contributionIa({ brouillon: "a b c d e f g h i j k l", valide: "z" });
    const s = syntheseContributionsIa([c1, c2]);
    expect(s).toEqual({
      livrables: 2,
      motsBrouillon: 16,
      motsConserves: 4,
      partConservee: 0.25,
      modificationsMajeures: 1,
      totalRevueSecondes: 0,
      exacte: true,
    });
    expect(syntheseContributionsIa([]).partConservee).toBeNull();
  });
});

describe("API publique du domaine contribution", () => {
  it("expose les moteurs", () => {
    for (const nom of [
      "ErreurContribution",
      "decouperMots",
      "distanceEditionMots",
      "evaluerModificationMajeure",
      "agregerTempsRevue",
      "contributionIa",
      "syntheseContributionsIa",
    ]) {
      expect(contribution).toHaveProperty(nom);
    }
  });
});
