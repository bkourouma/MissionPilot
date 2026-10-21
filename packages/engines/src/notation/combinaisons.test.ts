import { describe, expect, it } from "vitest";
import { appliquerAjustement, initialiserAjustements } from "./ajustement";
import { ErreurNotationAugmentee } from "./augmentee-erreurs";
import { BAREME_CLASSES, type Classe } from "./classes";
import {
  COMBINAISONS_MAX,
  NOEUDS_MAX_COMBINAISONS,
  PRATIQUES_MAX_COMBINAISON,
  paliersAuDessus,
  rechercherCombinaisons,
  type RechercheCombinaisons,
} from "./combinaisons";
import { simulerPassage } from "./explication";
import { GRILLE, REPONSES_EXEMPLE, generateur, reponsesAleatoires } from "./fixtures.test-utils";
import { arrondir, depuisNombre, fraction } from "./fraction";
import type { GrilleNotation, RegleConversion } from "./grille";
import { scoreGlobal, type OptionsNotation } from "./score";

/*
 * Combinaisons minimales d'améliorations (NOT-12). Exemple chiffré à la main : REPONSES_EXEMPLE sur
 * la grille d'essai (stratégie 62,5 poids 60, coûts 65 poids 40, global 63,5, classe C). Les cas
 * aléatoires sont comparés à une énumération exhaustive INDÉPENDANTE : chaque affectation est
 * re-notée par `scoreGlobal` sur de vraies réponses.
 */

const erreur = (code: string) => expect.objectContaining({ name: "ErreurNotationAugmentee", code });

const etat = initialiserAjustements(scoreGlobal(GRILLE, REPONSES_EXEMPLE));
const ajuster = (delta: number) =>
  appliquerAjustement(etat, {
    dimension: "strategie",
    delta,
    motif: "Entretien",
    auteur: "u1",
    date: "2026-10-08",
  });

type Reponses = Record<string, number | string | boolean | null>;
const f = (n: number) => depuisNombre(n);
const nombres = (v: readonly ReturnType<typeof f>[]) => v.map((x) => arrondir(x, 4));

describe("constantes et paliersAuDessus", () => {
  it("expose les bornes", () => {
    expect([PRATIQUES_MAX_COMBINAISON, NOEUDS_MAX_COMBINAISONS, COMBINAISONS_MAX]).toEqual([
      8, 200_000, 10,
    ]);
  });

  it("Likert : chaque niveau au-dessus, avec tolérance d'arrondi au dixième", () => {
    const l3: RegleConversion = { type: "likert", points: 3 };
    expect(nombres(paliersAuDessus(l3, f(0)))).toEqual([50, 100]);
    expect(nombres(paliersAuDessus(l3, f(50)))).toEqual([100]);
    expect(paliersAuDessus(l3, f(100))).toEqual([]);
    const l7: RegleConversion = { type: "likert", points: 7 };
    // 16,7 est l'affichage au dixième du niveau 2 (100/6) : le palier suivant est le niveau 3.
    expect(paliersAuDessus(l7, f(16.7))).toEqual([
      fraction(100n, 3n),
      fraction(50n),
      fraction(200n, 3n),
      fraction(250n, 3n),
      fraction(100n),
    ]);
    expect(nombres(paliersAuDessus({ type: "likert", points: 5, inverse: true }, f(25)))).toEqual([
      50, 75, 100,
    ]);
  });

  it("autres règles : valeurs distinctes strictement supérieures, croissantes", () => {
    const choix: RegleConversion = {
      type: "choix",
      valeurs: [
        { code: "a", points: 100 },
        { code: "b", points: 50 },
        { code: "c", points: 50 },
        { code: "d", points: 0 },
      ],
    };
    expect(nombres(paliersAuDessus(choix, f(0)))).toEqual([50, 100]);
    expect(nombres(paliersAuDessus(choix, f(50)))).toEqual([100]);
    expect(paliersAuDessus(choix, f(100))).toEqual([]);
    expect(nombres(paliersAuDessus({ type: "oui_non", oui: 100, non: 20 }, f(20)))).toEqual([100]);
    expect(
      nombres(
        paliersAuDessus(
          {
            type: "seuils",
            paliers: [
              { min: 0, points: 0 },
              { min: 10, points: 30 },
              { min: 20, points: 60 },
              { min: 30, points: 100 },
            ],
          },
          f(30),
        ),
      ),
    ).toEqual([60, 100]);
    expect(
      nombres(
        paliersAuDessus(
          {
            type: "interpolation",
            points: [
              { x: 0, y: 100 },
              { x: 50, y: 0 },
            ],
          },
          f(60),
        ),
      ),
    ).toEqual([100]);
    // Choix multiple : les points maximaux seulement.
    const multiple: RegleConversion = {
      type: "choix_multiple",
      valeurs: [
        { code: "a", points: 30 },
        { code: "b", points: 40 },
      ],
    };
    expect(nombres(paliersAuDessus(multiple, f(30)))).toEqual([70]);
    expect(paliersAuDessus(multiple, f(70))).toEqual([]);
  });
});

describe("rechercherCombinaisons : cas chiffrés à la main", () => {
  it("C vers B : une seule pratique suffit (k* = 1), cinq options à un palier, ordre de la grille", () => {
    const r = rechercherCombinaisons(etat, GRILLE, "B");
    expect(r).toMatchObject({
      classeActuelle: "C",
      scoreActuel: 63.5,
      cible: "B",
      seuil: 65,
      dejaAtteinte: false,
      atteignable: true,
      gainNecessaire: 1.5,
      nombreMinimalPratiques: 1,
      exhaustive: true,
      tronquee: false,
    });
    expect(r.combinaisons.map((c) => [c.etapes[0]!.indicateur, c.nombrePaliers])).toEqual([
      ["i1", 1],
      ["i2", 1],
      ["i4", 1],
      ["i5", 1],
      ["i6", 1],
    ]);
    // i1 : 3 → 4 sur 5 niveaux (50 → 75) : + 25 × 2/4 × 0,6 = 7,5 point de score global.
    expect(r.combinaisons[0]).toEqual({
      etapes: [
        {
          dimension: "strategie",
          libelle: "Stratégie",
          indicateur: "i1",
          question: "q1",
          pointsAvant: 50,
          pointsApres: 75,
          paliers: 1,
          gain: 7.5,
        },
      ],
      scoreProjete: 71,
      classeProjetee: "B",
      nombrePaliers: 1,
    });
    // i3 est déjà au maximum : il n'est pas un levier.
    expect(r.leviers.map((l) => l.indicateur)).toEqual(["i1", "i2", "i4", "i5", "i6"]);
    expect(r.leviers[0]).toMatchObject({ pointsActuels: 50, paliers: [75, 100] });
    expect(r.combinaisons[3]!.etapes[0]).toMatchObject({ pointsAvant: 60, pointsApres: 100 });
  });

  it("respecte maxCombinaisons", () => {
    expect(
      rechercherCombinaisons(etat, GRILLE, "B", { maxCombinaisons: 2 }).combinaisons,
    ).toHaveLength(2);
    expect(
      rechercherCombinaisons(etat, GRILLE, "B", { maxCombinaisons: 1 }).combinaisons,
    ).toHaveLength(1);
  });

  it("C vers A : k* = 2, le minimum de paliers d'abord", () => {
    const r = rechercherCombinaisons(etat, GRILLE, "A");
    expect(r).toMatchObject({ nombreMinimalPratiques: 2, exhaustive: true, atteignable: true });
    // Il faut 16,5 points : i1 ne donne que 15 au mieux (2 paliers), il faut donc un second levier.
    const couts = r.combinaisons.map((c) => c.nombrePaliers);
    expect(couts).toEqual([...couts].sort((a, b) => a - b));
    expect(r.combinaisons[0]!.nombrePaliers).toBe(3);
    for (const c of r.combinaisons) {
      expect(c.etapes).toHaveLength(2);
      expect(c.classeProjetee).toBe("A");
      expect(c.scoreProjete).toBeGreaterThanOrEqual(80);
    }
  });

  it("déjà atteinte : aucune amélioration à chercher", () => {
    for (const cible of ["C", "D", "E"] as const) {
      const r = rechercherCombinaisons(etat, GRILLE, cible);
      expect(r).toMatchObject({
        dejaAtteinte: true,
        atteignable: true,
        gainNecessaire: 0,
        nombreMinimalPratiques: 0,
        combinaisons: [],
        exhaustive: true,
        tronquee: false,
      });
    }
  });

  it("inatteignable : borne de la dimension ajustée à la baisse, établi (non tronqué)", () => {
    // Stratégie : brut −7,5 ; au mieux 30 → global 0,6 × 30 + 0,4 × 100 = 58 < 65.
    const a = ajuster(-70);
    const r = rechercherCombinaisons(a, GRILLE, "B");
    expect(r).toMatchObject({
      atteignable: false,
      nombreMinimalPratiques: null,
      combinaisons: [],
      exhaustive: true,
      tronquee: false,
    });
    // Vers C en revanche, c'est possible, en cohérence avec le simulateur glouton.
    const c = rechercherCombinaisons(a, GRILLE, "C");
    expect(c.atteignable).toBe(true);
    const glouton = simulerPassage(a, GRILLE, "C");
    expect(c.nombreMinimalPratiques).toBeLessThanOrEqual(glouton.etapes.length);
  });

  it("une dimension saturée (brut ≥ 100) n'offre aucun levier", () => {
    const r = rechercherCombinaisons(ajuster(50), GRILLE, "A");
    expect(r.leviers.map((l) => l.dimension)).not.toContain("strategie");
    expect(r.combinaisons.flatMap((c) => c.etapes.map((e) => e.dimension))).not.toContain(
      "strategie",
    );
  });

  it("ajustement motivé : score = calculé + ajustement, borné à 100", () => {
    const a = ajuster(27);
    const r = rechercherCombinaisons(a, GRILLE, "A");
    expect(r).toMatchObject({ scoreActuel: 79.7, gainNecessaire: 0.3, nombreMinimalPratiques: 1 });
    // Stratégie : 62,5 + 27 = 89,5 ; i1 → 75 ajoute 12,5 : plafonné à 100, soit 0,6 × 10,5 = 6,3.
    expect(r.combinaisons[0]!.etapes[0]).toMatchObject({ indicateur: "i1", gain: 6.3 });
    expect(r.combinaisons[0]!.scoreProjete).toBe(86);
  });

  it("brut négatif : aucun gain tant que la dimension n'est pas revenue à zéro", () => {
    // Stratégie : 62,5 − 70 = −7,5. i1 seul (+12,5 → 5) rapporterait 0,6 × 5 = 3 ; i3 est au
    // maximum. Aucun gain fictif : le gain d'une étape est celui du score borné.
    const r = rechercherCombinaisons(ajuster(-70), GRILLE, "C");
    for (const c of r.combinaisons) {
      for (const e of c.etapes.filter((x) => x.dimension === "strategie")) {
        expect(e.gain).toBeLessThanOrEqual(0.6 * 30);
      }
    }
    expect(r.combinaisons.length).toBeGreaterThan(0);
  });

  it("plafond de nœuds : tronquée, on ne conclut jamais à l'impossibilité", () => {
    const r = rechercherCombinaisons(etat, GRILLE, "A", { noeudsMax: 1 });
    expect(r).toMatchObject({
      tronquee: true,
      exhaustive: false,
      atteignable: true,
      nombreMinimalPratiques: 2,
      combinaisons: [],
    });
    const partiel = rechercherCombinaisons(etat, GRILLE, "A", { noeudsMax: 5 });
    expect(partiel.tronquee).toBe(true);
    expect(partiel.exhaustive).toBe(false);
    const complet = rechercherCombinaisons(etat, GRILLE, "A");
    expect(complet.tronquee).toBe(false);
    // Les combinaisons déjà trouvées sont réelles (même si la liste peut être incomplète).
    for (const c of partiel.combinaisons) expect(c.scoreProjete).toBeGreaterThanOrEqual(80);
  });

  it("plafond de taille : k* au-dessus de pratiquesMax est signalé, pas conclu", () => {
    const r = rechercherCombinaisons(etat, GRILLE, "A", { pratiquesMax: 1 });
    expect(r).toMatchObject({
      atteignable: false,
      nombreMinimalPratiques: null,
      combinaisons: [],
      tronquee: true,
      exhaustive: false,
    });
    expect(rechercherCombinaisons(etat, GRILLE, "A", { pratiquesMax: 2 }).tronquee).toBe(false);
  });

  it("options invalides et note non notable", () => {
    for (const options of [
      { pratiquesMax: 0 },
      { pratiquesMax: 9 },
      { pratiquesMax: 1.5 },
      { noeudsMax: 0 },
      { noeudsMax: 200_001 },
      { maxCombinaisons: 0 },
      { maxCombinaisons: 11 },
      { maxCombinaisons: Number.NaN },
    ]) {
      expect(() => rechercherCombinaisons(etat, GRILLE, "B", options)).toThrow(
        erreur("OPTIONS_INVALIDES"),
      );
    }
    expect(() => rechercherCombinaisons(etat, GRILLE, "Z" as Classe)).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
    expect(() =>
      rechercherCombinaisons(initialiserAjustements(scoreGlobal(GRILLE, {})), GRILLE, "B"),
    ).toThrow(erreur("NOTE_NON_NOTABLE"));
    expect(() => rechercherCombinaisons(etat, GRILLE, "B", { maxCombinaisons: 3 })).not.toThrow(
      ErreurNotationAugmentee,
    );
  });

  it("est déterministe : deux appels donnent des résultats identiques", () => {
    for (const cible of ["B", "A"] as const) {
      const a = rechercherCombinaisons(etat, GRILLE, cible, { maxCombinaisons: 10 });
      const b = rechercherCombinaisons(etat, GRILLE, cible, { maxCombinaisons: 10 });
      expect(b).toEqual(a);
    }
  });
});

describe("rechercherCombinaisons : petite grille (Likert à 3 niveaux, seuils)", () => {
  const PETITE: GrilleNotation = {
    id: "petite",
    version: 1,
    titre: "Petite grille",
    dimensions: [
      {
        id: "d1",
        libelle: "D1",
        famille: "excellence",
        poids: 1,
        indicateurs: [
          { id: "a", question: "qa", poids: 1, conversion: { type: "likert", points: 3 } },
          {
            id: "b",
            question: "qb",
            poids: 1,
            conversion: {
              type: "seuils",
              paliers: [
                { min: 0, points: 0 },
                { min: 10, points: 30 },
                { min: 20, points: 60 },
                { min: 30, points: 100 },
              ],
            },
          },
        ],
      },
    ],
  };
  const depart = initialiserAjustements(scoreGlobal(PETITE, { qa: 1, qb: 0 }));

  it("score 0 vers C (50) : minimal, irréductible, paliers croissants", () => {
    expect(depart.score).toBe(0);
    const r = rechercherCombinaisons(depart, PETITE, "C", { maxCombinaisons: 10 });
    // a : 0 / 50 / 100 ; b : 0 / 30 / 60 / 100 ; score = moyenne. a@100 ou b@100 donnent 50.
    expect(r.nombreMinimalPratiques).toBe(1);
    expect(
      r.combinaisons.map((c) => c.etapes.map((e) => [e.indicateur, e.pointsApres, e.paliers])),
    ).toEqual([[["a", 100, 2]], [["b", 100, 3]]]);
    expect(r.leviers[0]!.paliers).toEqual([50, 100]);
    expect(r.leviers[1]!.paliers).toEqual([30, 60, 100]);
  });

  it("score 0 vers B (65) : deux pratiques, coût minimal 3", () => {
    const r = rechercherCombinaisons(depart, PETITE, "B", { maxCombinaisons: 10 });
    expect(r.nombreMinimalPratiques).toBe(2);
    // a + b ≥ 129,9 : (100, 30) = 130 (coût 2 + 1) ; (50, 100) = 150 (1 + 3) ; (100, 60) est
    // réductible (b peut redescendre à 30) et (50, 60) = 110 ne suffit pas.
    expect(r.combinaisons.map((c) => c.nombrePaliers)).toEqual([3, 4]);
    expect(r.combinaisons[0]!.etapes.map((e) => [e.indicateur, e.pointsApres])).toEqual([
      ["a", 100],
      ["b", 30],
    ]);
  });
});

/* ---------- Comparaison à une énumération exhaustive indépendante ---------- */

const QUESTION_DE: Record<string, string> = {
  i1: "q1",
  i2: "q2",
  i3: "q3",
  i4: "q4",
  i5: "q5",
  i6: "q6",
};

/** Réponse donnant exactement `points` sur l'indicateur (grille d'essai). */
function reponseVers(indicateur: string, points: number): number | string | boolean {
  switch (indicateur) {
    case "i1":
      return points / 25 + 1;
    case "i2":
      return points === 100 ? "a" : points === 50 ? "b" : "c";
    case "i3":
      return points === 100;
    case "i4":
      return points === 0 ? 0 : points === 50 ? 10 : 20;
    case "i5":
      return points === 100 ? 0 : 50;
    default:
      return 5 - points / 25; // i6 : Likert inversé
  }
}

interface Affectation {
  /** Indice du levier dans `leviers` et indice du palier (0 = premier palier). */
  readonly levier: number;
  readonly palier: number;
}

function atteint(
  reponses: Reponses,
  options: OptionsNotation,
  seuil: number,
  leviers: RechercheCombinaisons["leviers"],
  affectations: readonly Affectation[],
): boolean {
  const modifiees: Record<string, number | string | boolean | null> = { ...reponses };
  for (const a of affectations) {
    const l = leviers[a.levier]!;
    modifiees[QUESTION_DE[l.indicateur]!] = reponseVers(l.indicateur, l.paliers[a.palier]!);
  }
  const r = scoreGlobal(GRILLE, modifiees, options);
  return r.score !== null && r.score >= seuil;
}

/** Toutes les affectations de taille `taille` (ordre : leviers de la grille, puis paliers). */
function affectationsDeTaille(
  leviers: RechercheCombinaisons["leviers"],
  taille: number,
  debut = 0,
): Affectation[][] {
  if (taille === 0) return [[]];
  const sortie: Affectation[][] = [];
  for (let i = debut; i < leviers.length; i++) {
    for (let p = 0; p < leviers[i]!.paliers.length; p++) {
      for (const reste of affectationsDeTaille(leviers, taille - 1, i + 1)) {
        sortie.push([{ levier: i, palier: p }, ...reste]);
      }
    }
  }
  return sortie;
}

const cout = (c: readonly Affectation[]) => c.reduce((s, a) => s + a.palier + 1, 0);

function comparerAffectations(a: readonly Affectation[], b: readonly Affectation[]): number {
  if (cout(a) !== cout(b)) return cout(a) - cout(b);
  for (let i = 0; i < a.length; i++)
    if (a[i]!.levier !== b[i]!.levier) return a[i]!.levier - b[i]!.levier;
  for (let i = 0; i < a.length; i++)
    if (a[i]!.palier !== b[i]!.palier) return a[i]!.palier - b[i]!.palier;
  return 0;
}

describe("rechercherCombinaisons : propriétés (graine fixe)", () => {
  const OPTIONS: OptionsNotation[] = [{}, { strategie: "penaliser" }];
  const cibles: Classe[] = ["B", "A"];

  it("coïncide avec l'énumération exhaustive, est irréductible et au plus aussi petit que le glouton", () => {
    const alea = generateur(2026);
    let comparees = 0;
    let atteignables = 0;
    let inatteignables = 0;
    for (let i = 0; i < 40; i++) {
      const reponses = reponsesAleatoires(alea);
      const options = OPTIONS[i % OPTIONS.length]!;
      const note = scoreGlobal(GRILLE, reponses, options);
      const courant = initialiserAjustements(note);
      if (!courant.notable) continue;
      const cible = cibles[i % cibles.length]!;
      if (courant.classe === "A" || (cible === "B" && courant.classe === "B")) continue;
      const seuil = BAREME_CLASSES.find((b) => b.classe === cible)!.min;
      const r = rechercherCombinaisons(courant, GRILLE, cible, {
        maxCombinaisons: COMBINAISONS_MAX,
      });
      expect(r.exhaustive).toBe(true);
      expect(r.tronquee).toBe(false);
      comparees++;

      // Énumération exhaustive indépendante, par taille croissante.
      let attendu: Affectation[][] = [];
      let kAttendu: number | null = null;
      for (let k = 1; k <= r.leviers.length && kAttendu === null; k++) {
        const bonnes = affectationsDeTaille(r.leviers, k).filter((a) =>
          atteint(reponses, options, seuil, r.leviers, a),
        );
        if (bonnes.length > 0) {
          kAttendu = k;
          // Irréductibles : réduire d'un cran (ou retirer) une amélioration fait manquer la cible.
          attendu = bonnes.filter((a) =>
            a.every((_, j) => {
              const reduit =
                a[j]!.palier === 0
                  ? a.filter((__, m) => m !== j)
                  : a.map((x, m) => (m === j ? { ...x, palier: x.palier - 1 } : x));
              return !atteint(reponses, options, seuil, r.leviers, reduit);
            }),
          );
        }
      }
      expect(r.nombreMinimalPratiques).toBe(kAttendu);
      expect(r.atteignable).toBe(kAttendu !== null);
      if (kAttendu === null) {
        inatteignables++;
        expect(r.combinaisons).toEqual([]);
        continue;
      }
      atteignables++;
      attendu.sort(comparerAffectations);
      const obtenu = r.combinaisons.map((c) =>
        c.etapes.map((e) => {
          const levier = r.leviers.findIndex((l) => l.indicateur === e.indicateur);
          return { levier, palier: r.leviers[levier]!.paliers.indexOf(e.pointsApres) };
        }),
      );
      expect(obtenu).toEqual(attendu.slice(0, COMBINAISONS_MAX));
      expect(r.combinaisons.map((c) => c.nombrePaliers)).toEqual(
        attendu.slice(0, COMBINAISONS_MAX).map(cout),
      );
      for (const c of r.combinaisons) {
        expect(c.scoreProjete).toBeGreaterThanOrEqual(seuil);
        expect(c.etapes.map((e) => e.paliers).reduce((s, n) => s + n, 0)).toBe(c.nombrePaliers);
      }

      // Jamais plus de pratiques que le simulateur glouton.
      const glouton = simulerPassage(courant, GRILLE, cible);
      if (glouton.atteignable)
        expect(r.nombreMinimalPratiques).toBeLessThanOrEqual(glouton.etapes.length);
      else expect(glouton.etapes.length).toBeGreaterThanOrEqual(0);
    }
    // La propriété a réellement été exercée sur les deux issues.
    expect(comparees).toBeGreaterThan(10);
    expect(atteignables).toBeGreaterThan(5);
    expect(inatteignables + atteignables).toBe(comparees);
  });

  it("répétable et indépendant de maxCombinaisons pour la tête de liste", () => {
    const alea = generateur(99);
    for (let i = 0; i < 12; i++) {
      const courant = initialiserAjustements(scoreGlobal(GRILLE, reponsesAleatoires(alea)));
      if (!courant.notable || courant.classe === "A") continue;
      const complet = rechercherCombinaisons(courant, GRILLE, "A", { maxCombinaisons: 10 });
      expect(rechercherCombinaisons(courant, GRILLE, "A", { maxCombinaisons: 10 })).toEqual(
        complet,
      );
      const court = rechercherCombinaisons(courant, GRILLE, "A", { maxCombinaisons: 1 });
      expect(court.combinaisons).toEqual(complet.combinaisons.slice(0, 1));
    }
  });
});

describe("rechercherCombinaisons : élagage par coût", () => {
  it("une liste pleine n'explore plus les préfixes plus coûteux, sans changer la tête de liste", () => {
    const reponses = { q1: 1, q2: "c", q3: false, q4: 0, q5: 50, q6: 5 };
    const courant = initialiserAjustements(scoreGlobal(GRILLE, reponses));
    for (const cible of ["C", "B", "A"] as const) {
      const complet = rechercherCombinaisons(courant, GRILLE, cible, { maxCombinaisons: 10 });
      for (let n = 1; n <= 3; n++) {
        const court = rechercherCombinaisons(courant, GRILLE, cible, { maxCombinaisons: n });
        expect(court.combinaisons).toEqual(complet.combinaisons.slice(0, n));
        expect(court.exhaustive).toBe(true);
      }
    }
  });
});
