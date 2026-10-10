import { describe, expect, it } from "vitest";
import * as racine from "../index";
import { appliquerAjustement, initialiserAjustements } from "./ajustement";
import { ErreurNotationAugmentee } from "./augmentee-erreurs";
import { mesurerCalibration } from "./calibration";
import { indiceConfiance } from "./confiance";
import { constatsPerception } from "./constats";
import { expliquerNote, palierSuivant, pointsMaximaux, simulerPassage } from "./explication";
import { GRILLE, REPONSES_EXEMPLE } from "./fixtures.test-utils";
import { depuisNombre } from "./fraction";
import { prioriserInitiatives, type InitiativeType } from "./plan-action";
import { scoreGlobal } from "./score";

/*
 * Notation augmentée (NOT-10 à NOT-13, NOT-17). Exemple chiffré à la main sur la grille d'essai
 * (`fixtures.test-utils.ts`) et REPONSES_EXEMPLE : stratégie 62,5 (poids 60), coûts 65 (poids 40),
 * global 63,5 (classe C).
 */

const erreur = (code: string) => expect.objectContaining({ name: "ErreurNotationAugmentee", code });

const resultat = scoreGlobal(GRILLE, REPONSES_EXEMPLE);
const etat = initialiserAjustements(resultat);
const ajuster = (delta: number) =>
  appliquerAjustement(etat, {
    dimension: "strategie",
    delta,
    motif: "Entretien",
    auteur: "u1",
    date: "2026-10-08",
  });

describe("API publique", () => {
  it("expose les moteurs de la notation augmentée depuis la racine du paquet", () => {
    for (const nom of [
      "ErreurNotationAugmentee",
      "selectionnerItems",
      "controlerProposition",
      "constatsPerception",
      "indiceConfiance",
      "expliquerNote",
      "simulerPassage",
      "mesurerCalibration",
      "prioriserInitiatives",
    ]) {
      expect(racine).toHaveProperty(nom);
    }
  });
});

describe("constatsPerception (NOT-10)", () => {
  const ecart = (question: string, min: number, max: number, bas: string[], hauts: string[]) => ({
    question,
    libelle: `Libellé ${question}`,
    min,
    max,
    ecart: max - min,
    repondantsMin: bas,
    repondantsMax: hauts,
    nombreRepondants: bas.length + hauts.length,
  });
  const populations = [
    { repondant: "r1", population: "dirigeants" },
    { repondant: "r2", population: "équipes" },
    { repondant: "r3", population: "équipes" },
    { repondant: "r4", population: "  " },
  ];

  it("rattache les extrêmes aux populations, gradue et trie par écart", () => {
    const constats = constatsPerception(
      [
        ecart("q1", 3, 5, ["r2"], ["r1"]),
        ecart("q2", 1, 5, ["r2"], ["r1", "r3"]),
        ecart("q3", 2, 4, ["r2"], ["r3"]),
        ecart("q4", 1, 4, ["r4", "r9"], ["r1"]),
      ],
      populations,
    );
    expect(constats.map((c) => [c.question, c.type, c.gravite])).toEqual([
      ["q2", "entre_populations", "majeur"],
      ["q4", "entre_populations", "majeur"],
      ["q1", "entre_populations", "notable"],
      ["q3", "interne", "notable"],
    ]);
    expect(constats[0]?.populationsHautes).toEqual(["dirigeants", "équipes"]);
    expect(constats[1]?.populationsBasses).toEqual(["non précisée"]);
    expect(constats[2]?.enonce).toBe(
      "Sur « Libellé q1 », « dirigeants » répond au niveau 5 et « équipes » au niveau 3 (écart de 2 niveaux).",
    );
    expect(constats[3]?.enonce).toContain("est divisée : de 2 à 4");
  });

  it("seuil de constat majeur paramétrable et contrôlé", () => {
    const c = constatsPerception([ecart("q1", 3, 5, ["r2"], ["r1"])], populations, {
      seuilMajeur: 2,
    });
    expect(c[0]?.gravite).toBe("majeur");
    expect(() => constatsPerception([], populations, { seuilMajeur: 0 })).toThrow(
      erreur("OPTIONS_INVALIDES"),
    );
    expect(constatsPerception([], [])).toEqual([]);
  });
});

describe("indiceConfiance (NOT-11)", () => {
  it("combine couverture, répondants et solidité des preuves (exemple chiffré)", () => {
    const c = indiceConfiance({
      resultat,
      repondants: 2,
      solidites: [
        { dimension: "strategie", indice: 0.75 },
        { dimension: "strategie", indice: 0.25 },
        { dimension: "couts", indice: 1 },
        { dimension: "autre", indice: 1 },
      ],
    });
    // (40 × 1 + 30 × 2/3 + 30 × (0,6 × 0,5 + 0,4 × 1)) / 100 = 0,81
    expect(c).toMatchObject({
      indice: 0.81,
      seuil: 0.5,
      publiable: true,
      niveau: "elevee",
      couverture: { valeur: 1, poids: 40 },
      repondants: { valeur: 0.6667, nombre: 2, cible: 3 },
      preuves: { valeur: 0.7, dimensionsEtayees: 2, dimensions: 2, assertions: 3 },
    });
  });

  it("sous le seuil : insuffisante ; au seuil exact : publiable", () => {
    const sans = indiceConfiance({ resultat, repondants: 0, solidites: [] });
    expect(sans).toMatchObject({ indice: 0.4, publiable: false, niveau: "insuffisante" });
    const auSeuil = indiceConfiance({ resultat, repondants: 0, solidites: [] }, { seuil: 0.4 });
    expect(auSeuil).toMatchObject({ publiable: true, niveau: "suffisante" });
    const cible = indiceConfiance(
      { resultat, repondants: 9, solidites: [] },
      { repondantsCible: 1, poids: { couverture: 0, repondants: 100, preuves: 0 } },
    );
    expect(cible.indice).toBe(1);
  });

  it("une grille sans poids donne une couverture nulle", () => {
    const vide = {
      ...resultat,
      dimensions: resultat.dimensions.map((d) => ({ ...d, poidsExact: "0" })),
    };
    expect(
      indiceConfiance({ resultat: vide, repondants: 3, solidites: [] }).couverture.valeur,
    ).toBe(0);
  });

  it("refuse des options ou des entrées invalides", () => {
    const base = { resultat, repondants: 1, solidites: [] };
    for (const options of [
      { seuil: 1.5 },
      { repondantsCible: 0 },
      { poids: { couverture: 50, repondants: 30, preuves: 30 } },
      { poids: { couverture: 50.5, repondants: 49.5, preuves: 0 } },
    ]) {
      expect(() => indiceConfiance(base, options)).toThrow(erreur("OPTIONS_INVALIDES"));
    }
    expect(() => indiceConfiance({ ...base, repondants: -1 })).toThrow(erreur("OPTIONS_INVALIDES"));
    expect(() =>
      indiceConfiance({ ...base, solidites: [{ dimension: "couts", indice: 2 }] }),
    ).toThrow(erreur("OPTIONS_INVALIDES"));
  });
});

describe("expliquerNote (NOT-12)", () => {
  it("contributions des dimensions et des pratiques : leur somme est le score global", () => {
    const e = expliquerNote(etat, GRILLE);
    expect(e).toMatchObject({ score: 63.5, classe: "C", sommeContributions: 63.5 });
    const [strategie, couts] = e.dimensions;
    expect(strategie).toMatchObject({ contribution: 37.5, ajustement: 0, ecartArrondi: 0 });
    expect(strategie?.pratiques.map((p) => p.contribution)).toEqual([15, 7.5, 15]);
    expect(couts?.pratiques.map((p) => p.contribution)).toEqual([5, 6, 15]);
    expect(couts?.contribution).toBe(26);
  });

  it("un ajustement motivé apparaît comme une contribution propre", () => {
    const e = expliquerNote(ajuster(5), GRILLE);
    expect(e.score).toBe(66.5);
    expect(e.dimensions[0]).toMatchObject({ score: 67.5, contribution: 40.5, ajustement: 3 });
  });

  it("stratégie « pénaliser » : une pratique manquante compte au dénominateur", () => {
    const r = scoreGlobal(
      GRILLE,
      { q2: "a", q3: true, q4: 25, q5: 0, q6: 1 },
      { strategie: "penaliser" },
    );
    const e = expliquerNote(initialiserAjustements(r), GRILLE);
    expect(e.score).toBe(70);
    expect(e.dimensions[0]?.pratiques.map((p) => [p.statut, p.contribution])).toEqual([
      ["manquant", 0],
      ["repondu", 15],
      ["repondu", 15],
    ]);
  });

  it("refuse une note non notable et une grille qui ne correspond pas", () => {
    expect(() => expliquerNote(initialiserAjustements(scoreGlobal(GRILLE, {})), GRILLE)).toThrow(
      erreur("NOTE_NON_NOTABLE"),
    );
    const autre = { ...GRILLE, dimensions: [{ ...GRILLE.dimensions[0]!, indicateurs: [] }] };
    expect(() => expliquerNote(etat, autre)).toThrow(erreur("OPTIONS_INVALIDES"));
  });
});

describe("simulerPassage : que faut-il pour passer de C à B (NOT-12)", () => {
  it("relève d'abord la pratique au plus fort gain, jusqu'au seuil de la classe visée", () => {
    const s = simulerPassage(etat, GRILLE, "B");
    expect(s).toMatchObject({
      classeActuelle: "C",
      scoreActuel: 63.5,
      seuil: 65,
      dejaAtteinte: false,
      atteignable: true,
      gainNecessaire: 1.5,
      scoreProjete: 71,
      classeProjetee: "B",
    });
    expect(s.etapes).toEqual([
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
    ]);
  });

  it("vers A : plusieurs paliers, agrégés par pratique", () => {
    const s = simulerPassage(etat, GRILLE, "A");
    expect(s.scoreProjete).toBe(86);
    expect(s.etapes.map((e) => [e.indicateur, e.pointsApres, e.paliers, e.gain])).toEqual([
      ["i1", 100, 2, 15],
      ["i2", 100, 1, 7.5],
    ]);
  });

  it("une dimension ajustée reste plafonnée à 100", () => {
    const s = simulerPassage(ajuster(27), GRILLE, "A");
    expect(s.scoreActuel).toBe(79.7);
    expect(s.etapes).toEqual([expect.objectContaining({ indicateur: "i1", gain: 6.3 })]);
    expect(s.scoreProjete).toBe(86);
  });

  it("suit le total brut non borné d'une dimension ajustée à la baisse (jamais de gain fictif)", () => {
    // Stratégie : 62,5 − 70 = −7,5 brut, affiché 0 ; au mieux (tout à 100) 100 − 70 = 30.
    const a = ajuster(-70);
    expect(a.score).toBe(26);
    const c = simulerPassage(a, GRILLE, "C");
    expect(c).toMatchObject({ atteignable: true, scoreProjete: 50.5, tronquee: false });
    const b = simulerPassage(a, GRILLE, "B");
    // 0,6 × 30 + 0,4 × 100 = 58 : le simulateur ne promet pas les 65 d'un score non borné.
    expect(b).toMatchObject({ atteignable: false, scoreProjete: 58, tronquee: false });
    // Un gain d'une dimension déjà à 100 (brut ≥ 100) est perdu : aucune étape sur elle.
    const haut = simulerPassage(ajuster(50), GRILLE, "A");
    expect(haut.etapes.map((e) => e.dimension)).not.toContain("strategie");
  });

  it("signale le plafond de pas au lieu de conclure en silence", () => {
    const court = simulerPassage(etat, GRILLE, "A", { pasMax: 1 });
    expect(court).toMatchObject({ tronquee: true, atteignable: false });
    expect(court.etapes).toHaveLength(1);
    expect(simulerPassage(etat, GRILLE, "A").tronquee).toBe(false);
    // Plafond atteint pile à la cible : pas de troncature.
    expect(simulerPassage(etat, GRILLE, "B", { pasMax: 1 }).tronquee).toBe(false);
    for (const pasMax of [0, 1.5, 100_000]) {
      expect(() => simulerPassage(etat, GRILLE, "B", { pasMax })).toThrow(
        erreur("OPTIONS_INVALIDES"),
      );
    }
  });

  it("classe déjà atteinte, classe inatteignable, classe inconnue", () => {
    expect(simulerPassage(etat, GRILLE, "C")).toMatchObject({
      dejaAtteinte: true,
      atteignable: true,
      gainNecessaire: 0,
      etapes: [],
    });
    const r = scoreGlobal(
      GRILLE,
      { q2: "a", q3: true, q4: 25, q5: 0, q6: 1 },
      { strategie: "penaliser" },
    );
    expect(simulerPassage(initialiserAjustements(r), GRILLE, "A")).toMatchObject({
      atteignable: false,
      scoreProjete: 70,
      etapes: [],
    });
    expect(() => simulerPassage(etat, GRILLE, "F" as never)).toThrow(erreur("OPTIONS_INVALIDES"));
  });

  it("paliers et maximum de chaque règle de conversion", () => {
    expect(
      pointsMaximaux({
        type: "choix_multiple",
        valeurs: [
          { code: "a", points: 70 },
          { code: "b", points: 60 },
        ],
      }),
    ).toEqual(depuisNombre(100));
    expect(pointsMaximaux({ type: "oui_non", oui: 20, non: 80 })).toEqual(depuisNombre(80));
    expect(pointsMaximaux({ type: "seuils", paliers: [{ min: 0, points: 40 }] })).toEqual(
      depuisNombre(40),
    );
    expect(
      pointsMaximaux({
        type: "interpolation",
        points: [
          { x: 0, y: 10 },
          { x: 1, y: 90 },
        ],
      }),
    ).toEqual(depuisNombre(90));
    const likert3 = { type: "likert" as const, points: 3 };
    expect(palierSuivant(likert3, depuisNombre(0))).toEqual(depuisNombre(50));
    expect(palierSuivant(likert3, depuisNombre(100))).toBeNull();
    expect(palierSuivant({ type: "likert", points: 4 }, depuisNombre(33.3))).toEqual({
      num: 200n,
      den: 3n,
    });
    expect(palierSuivant({ type: "oui_non", oui: 100, non: 0 }, depuisNombre(100))).toBeNull();
  });
});

describe("mesurerCalibration (NOT-13)", () => {
  const cotations = [
    { cas: "c1", evaluateur: "e1", niveau: 3 },
    { cas: "c1", evaluateur: "e2", niveau: 3 },
    { cas: "c2", evaluateur: "e1", niveau: 2 },
    { cas: "c2", evaluateur: "e2", niveau: 4 },
    { cas: "c3", evaluateur: "e1", niveau: 5 },
  ];

  it("écarts par cas, taux d'accord, biais des évaluateurs", () => {
    const m = mesurerCalibration(cotations);
    expect(m).toMatchObject({
      tolerance: 0,
      casDoublementCotes: 2,
      casEnAccord: 1,
      tauxAccord: 0.5,
      ecartMoyen: 1,
      aDiscuter: ["c2"],
    });
    expect(m.cas.map((c) => [c.cas, c.ecart, c.mediane, c.accord])).toEqual([
      ["c1", 0, 3, true],
      ["c2", 2, 3, false],
      ["c3", 0, 5, null],
    ]);
    expect(m.evaluateurs).toEqual([
      { evaluateur: "e1", cotations: 3, casCompares: 2, biais: -0.5, ecartAbsoluMoyen: 0.5 },
      { evaluateur: "e2", cotations: 2, casCompares: 2, biais: 0.5, ecartAbsoluMoyen: 0.5 },
    ]);
  });

  it("tolérance, médiane d'un nombre impair, session vide", () => {
    expect(mesurerCalibration(cotations, { tolerance: 2 }).tauxAccord).toBe(1);
    const impair = mesurerCalibration([
      { cas: "c", evaluateur: "a", niveau: 1 },
      { cas: "c", evaluateur: "b", niveau: 2 },
      { cas: "c", evaluateur: "c", niveau: 5 },
    ]);
    expect(impair.cas[0]?.mediane).toBe(2);
    expect(mesurerCalibration([])).toMatchObject({ tauxAccord: null, ecartMoyen: null });
    expect(
      mesurerCalibration([{ cas: "c", evaluateur: "a", niveau: 1 }]).evaluateurs[0]?.biais,
    ).toBeNull();
  });

  it("refuse cotations et options invalides", () => {
    expect(() => mesurerCalibration([{ cas: "c", evaluateur: "a", niveau: 6 }])).toThrow(
      erreur("COTATIONS_INVALIDES"),
    );
    expect(() =>
      mesurerCalibration([
        { cas: "c", evaluateur: "a", niveau: 1 },
        { cas: "c", evaluateur: "a", niveau: 2 },
      ]),
    ).toThrow(erreur("COTATIONS_INVALIDES"));
    expect(() => mesurerCalibration([], { niveaux: 1 })).toThrow(erreur("COTATIONS_INVALIDES"));
    expect(() => mesurerCalibration([], { tolerance: 5 })).toThrow(erreur("COTATIONS_INVALIDES"));
  });
});

describe("prioriserInitiatives (NOT-17)", () => {
  const initiative = (code: string, s: Partial<InitiativeType>): InitiativeType => ({
    code,
    titre: `Initiative ${code}`,
    dimensions: ["strategie"],
    effort: 1,
    dureeMois: 6,
    impacts: [],
    ...s,
  });
  const bibliotheque = [
    initiative("a", {
      effort: 2,
      impacts: [
        { secteur: "industrie", taille: "pme", gain: 8 },
        { secteur: "industrie", taille: null, gain: 4 },
        { secteur: null, taille: null, gain: 2 },
      ],
    }),
    initiative("b", {
      dimensions: ["couts"],
      impacts: [
        { secteur: "industrie", taille: "grande", gain: 6 },
        { secteur: "commerce", taille: "pme", gain: 3 },
      ],
    }),
    initiative("c", {
      dimensions: ["strategie", "couts"],
      effort: 5,
      impacts: [{ secteur: "commerce", taille: "pme", gain: 10 }],
    }),
    initiative("d", {
      dimensions: ["couts"],
      effort: 3,
      impacts: [{ secteur: "agro", taille: "grande", gain: 5 }],
    }),
    initiative("e", { dimensions: ["inconnue"] }),
  ];
  const contexte = { secteur: "industrie", taille: "pme" };

  it("priorité = besoin × impact observé / effort, retenues dans la capacité du client", () => {
    const p = prioriserInitiatives(etat, bibliotheque, contexte, { capacite: 4 });
    expect(p.capaciteUtilisee).toBe(3);
    expect(p.initiatives.map((i) => [i.code, i.priorite, i.sourceImpact, i.retenue])).toEqual([
      ["a", 0.9, "contexte_semblable", true],
      ["b", 0.84, "secteur", true],
      ["c", 0.73, "taille", false],
      ["d", 0.2333, "general", false],
      ["e", 0, "aucun", false],
    ]);
    expect(p.initiatives[0]).toMatchObject({ besoin: 0.225, impact: 8, observations: 1, rang: 1 });
    expect(p.initiatives[2]?.motif).toContain("dépasse la capacité");
    expect(p.initiatives[4]?.motif).toContain("priorité nulle");
  });

  it("plafond d'initiatives et contexte inconnu", () => {
    const p = prioriserInitiatives(etat, bibliotheque, contexte, {
      capacite: 10,
      maxInitiatives: 1,
    });
    expect(p.initiatives.filter((i) => i.retenue).map((i) => i.code)).toEqual(["a"]);
    expect(p.initiatives[1]?.motif).toContain("plafond");
    const sansContexte = prioriserInitiatives(
      etat,
      bibliotheque,
      { secteur: null, taille: null },
      {
        capacite: 10,
      },
    );
    expect(sansContexte.initiatives.find((i) => i.code === "a")?.sourceImpact).toBe("general");
  });

  it("compare secteurs et tailles sans tenir compte de la casse ni des espaces de bord", () => {
    const p = prioriserInitiatives(
      etat,
      bibliotheque,
      { secteur: " Industrie ", taille: "PME" },
      {
        capacite: 4,
      },
    );
    expect(p.initiatives.find((i) => i.code === "a")).toMatchObject({
      sourceImpact: "contexte_semblable",
      impact: 8,
    });
  });

  it("refuse une note non notable et des entrées invalides", () => {
    const vide = initialiserAjustements(scoreGlobal(GRILLE, {}));
    expect(() => prioriserInitiatives(vide, [], contexte, { capacite: 1 })).toThrow(
      erreur("NOTE_NON_NOTABLE"),
    );
    for (const [liste, options] of [
      [[], { capacite: 0 }],
      [[], { capacite: 1, maxInitiatives: 0 }],
      [[initiative("x", {}), initiative("x", {})], { capacite: 1 }],
      [[initiative("x", { effort: 6 })], { capacite: 1 }],
      [[initiative("x", { titre: "  " })], { capacite: 1 }],
      [[initiative("x", { dureeMois: 0 })], { capacite: 1 }],
      [[initiative("x", { dureeMois: 61 })], { capacite: 1 }],
      [[initiative("x", { dureeMois: 1.5 })], { capacite: 1 }],
      [
        [initiative("x", { impacts: [{ secteur: null, taille: null, gain: 120 }] })],
        { capacite: 1 },
      ],
    ] as const) {
      expect(() => prioriserInitiatives(etat, liste, contexte, options)).toThrow(
        erreur("INITIATIVES_INVALIDES"),
      );
    }
  });

  it("l'erreur porte son code et ses détails", () => {
    const e = new ErreurNotationAugmentee("SELECTION_INVALIDE", "x");
    expect(e.details).toEqual([]);
  });
});
