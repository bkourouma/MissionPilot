import { describe, expect, it } from "vitest";
import * as modulation from "./index";
import {
  appliquerModulation,
  cleEffet,
  comparerModulations,
  comparerValeur,
  dependancesRegles,
  ErreurModulation,
  executerCasTypes,
  signatureEffet,
  simulerModulation,
  type RegleModulation,
} from "./index";
import { GRANDE_BANQUE, PME_FAMILIALE_CACAO, REGLES } from "./jeu-exemple.test-utils";

const erreurDe = (f: () => unknown): ErreurModulation => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurModulation);
    return e as ErreurModulation;
  }
  throw new Error("aucune erreur levée");
};

const BASE = ["entretiens_individuels", "diagnostic"];

describe("appliquerModulation (STD-05)", () => {
  const r = appliquerModulation(REGLES, PME_FAMILIALE_CACAO, { briquesDeBase: BASE });

  it("applique les effets des règles déclenchées, triés par clé", () => {
    expect(r.effets.map((e) => signatureEffet(e.effet))).toEqual([
      "brique:atelier_unique=active",
      "brique:entretiens_individuels=retiree",
      "brique:gouvernance_familiale=active",
      "brique:reconstitution_ca=active",
      "classe_risque:rapport_financier=R3",
      "formulation:analyse_financiere=indicative",
      "gabarit:questionnaire=essentiel",
      "item:item_succession=active",
      "ponderation:dim_operations=1.5",
      "recommandation:kpi_pertes_post_recolte=proposee",
    ]);
    expect(r.conflits).toEqual([]);
  });

  it("construit l'état : briques actives, ajustements, classe relevée au maximum", () => {
    expect(r.etat).toEqual({
      briquesActives: [
        "atelier_unique",
        "diagnostic",
        "gouvernance_familiale",
        "reconstitution_ca",
      ],
      briquesActivees: ["atelier_unique", "gouvernance_familiale", "reconstitution_ca"],
      briquesRetirees: ["entretiens_individuels"],
      itemsActives: ["item_succession"],
      itemsRetires: [],
      ponderations: { dim_operations: 1.5 },
      seuils: {},
      benchmarks: {},
      gabarits: { questionnaire: "essentiel" },
      formulations: { analyse_financiere: "indicative" },
      recommandationsCandidates: ["kpi_pertes_post_recolte"],
      classesRisqueRelevees: { rapport_financier: "R3" },
    });
  });

  it("évalue dans l'ordre des dépendances puis des priorités, et journalise les valeurs lues", () => {
    expect(r.journal.map((j) => j.regle)).toEqual([
      "comptes_fragiles",
      "filiere_agricole",
      "gouvernance_familiale",
      "petite_entreprise",
      "succession",
    ]);
    expect(r.reglesDeclenchees).toHaveLength(5);
    const filiere = r.journal.find((j) => j.regle === "filiere_agricole")!;
    expect(filiere).toMatchObject({ declenchee: true, effetsRetenus: 2, effetsEcartes: 1 });
    expect(filiere.verifications.map((v) => [v.chemin, v.lu, v.resultat])).toEqual([
      ["condition.conditions[0]", ["cacao"], true],
      ["condition.conditions[1]", ["cacao"], false],
      ["condition.conditions[2]", true, true],
    ]);
    const succession = r.journal.find((j) => j.regle === "succession")!;
    expect(succession.verifications[0]).toMatchObject({
      type: "brique_active",
      brique: "gouvernance_familiale",
      lu: true,
      resultat: true,
      facteur: null,
    });
  });

  it("donne le même résultat quel que soit l'ordre des règles", () => {
    const inverse = appliquerModulation([...REGLES].reverse(), PME_FAMILIALE_CACAO, {
      briquesDeBase: BASE,
    });
    expect(inverse).toEqual(r);
  });

  it("ne déclenche rien sur un contexte qui ne s'y prête pas", () => {
    const g = appliquerModulation(REGLES, GRANDE_BANQUE);
    expect(g.effets).toEqual([]);
    expect(g.reglesDeclenchees).toEqual([]);
    expect(g.etat.briquesActives).toEqual([]);
    // La brique de base suffit à déclencher une règle qui la lit.
    const base = appliquerModulation(REGLES, GRANDE_BANQUE, {
      briquesDeBase: ["gouvernance_familiale"],
    });
    expect(base.reglesDeclenchees).toEqual(["succession"]);
  });

  it("un facteur non renseigné rend toute comparaison fausse, « différent » compris", () => {
    const regles: RegleModulation[] = [
      {
        code: "different",
        priorite: 1,
        condition: {
          type: "comparaison",
          facteur: "secteur",
          comparateur: "different",
          valeur: "btp",
        },
        effets: [{ type: "activer_item", item: "i1" }],
      },
      {
        code: "non_renseigne",
        priorite: 1,
        condition: {
          type: "non",
          condition: {
            type: "comparaison",
            facteur: "secteur",
            comparateur: "egal",
            valeur: "btp",
          },
        },
        effets: [{ type: "activer_item", item: "i2" }],
      },
    ];
    for (const contexte of [{}, { secteur: null }]) {
      const res = appliquerModulation(regles, contexte);
      expect(res.reglesDeclenchees).toEqual(["non_renseigne"]);
      expect(res.journal[0]!.verifications[0]!.lu).toBeNull();
    }
    // Une propriété héritée du prototype n'est jamais lue comme un facteur.
    const proto = appliquerModulation(
      [
        {
          code: "proto",
          priorite: 1,
          condition: {
            type: "comparaison",
            facteur: "toString",
            comparateur: "different",
            valeur: "x",
          },
          effets: [],
        },
      ],
      {},
    );
    expect(proto.reglesDeclenchees).toEqual([]);
  });

  it("journalise les règles inactives sans les évaluer", () => {
    const regles = REGLES.map((x) =>
      x.code === "petite_entreprise" ? { ...x, active: false } : x,
    );
    const res = appliquerModulation(regles, PME_FAMILIALE_CACAO);
    expect(res.journal.at(-1)).toEqual({
      regle: "petite_entreprise",
      priorite: 10,
      active: false,
      declenchee: false,
      verifications: [],
      effetsRetenus: 0,
      effetsEcartes: 0,
    });
    expect(res.effets.some((e) => e.cle === "brique:atelier_unique")).toBe(false);
  });
});

describe("conflits et priorités", () => {
  const vrai = { type: "comparaison", facteur: "x", comparateur: "egal", valeur: 1 } as const;
  const regle = (
    code: string,
    priorite: number,
    effets: RegleModulation["effets"],
  ): RegleModulation => ({
    code,
    priorite,
    condition: vrai,
    effets,
  });

  it("la priorité la plus haute l'emporte ; le conflit est résolu et journalisé", () => {
    const res = appliquerModulation(
      [
        regle("a", 10, [{ type: "activer_brique", brique: "b1" }]),
        regle("b", 30, [{ type: "retirer_brique", brique: "b1" }]),
        regle("c", 10, [{ type: "activer_brique", brique: "b1" }]),
        regle("d", 30, [{ type: "retirer_brique", brique: "b1" }]),
      ],
      { x: 1 },
      { briquesDeBase: ["b1"] },
    );
    expect(res.effets).toEqual([
      {
        cle: "brique:b1",
        effet: { type: "retirer_brique", brique: "b1" },
        priorite: 30,
        regles: ["b", "d"],
      },
    ]);
    expect(res.conflits).toHaveLength(1);
    expect(res.conflits[0]).toMatchObject({ cle: "brique:b1", resolu: true, regleRetenue: "b" });
    expect(res.conflits[0]!.candidats.map((c) => c.regle)).toEqual(["b", "d", "a", "c"]);
    expect(res.etat.briquesActives).toEqual([]);
    expect(res.journal.map((j) => [j.regle, j.effetsRetenus, j.effetsEcartes])).toEqual([
      ["b", 1, 0],
      ["d", 1, 0],
      ["a", 0, 1],
      ["c", 0, 1],
    ]);
  });

  it("à priorité égale, le conflit n'est pas résolu : l'état de référence est conservé", () => {
    const res = appliquerModulation(
      [
        regle("a", 10, [
          { type: "ponderation", cible: "d1", valeur: 2 },
          { type: "activer_brique", brique: "b1" },
        ]),
        regle("b", 10, [
          { type: "ponderation", cible: "d1", valeur: 3 },
          { type: "retirer_brique", brique: "b1" },
        ]),
        regle("c", 10, [{ type: "seuil", cible: "s1", valeur: 0.5 }]),
        regle("d", 5, [{ type: "seuil", cible: "s1", valeur: 0.5 }]),
      ],
      { x: 1 },
      { briquesDeBase: ["b1"] },
    );
    expect(res.effets.map((e) => e.cle)).toEqual(["seuil:s1"]);
    expect(res.effets[0]!.regles).toEqual(["c", "d"]);
    expect(res.conflits.map((c) => [c.cle, c.resolu, c.regleRetenue])).toEqual([
      ["brique:b1", false, null],
      ["ponderation:d1", false, null],
    ]);
    expect(res.etat.briquesActives).toEqual(["b1"]);
    expect(res.etat.ponderations).toEqual({});
    expect(res.etat.seuils).toEqual({ s1: 0.5 });
  });

  it("une brique en conflit non résolu garde son état de base pour les règles qui la lisent", () => {
    const res = appliquerModulation(
      [
        regle("a", 10, [{ type: "activer_brique", brique: "b1" }]),
        regle("b", 10, [{ type: "retirer_brique", brique: "b1" }]),
        {
          code: "lecteur",
          priorite: 1,
          condition: { type: "brique_active", brique: "b1" },
          effets: [{ type: "benchmark", cible: "marge", choix: "uemoa" }],
        },
      ],
      { x: 1 },
    );
    expect(res.reglesDeclenchees).toEqual(["a", "b"]);
    expect(res.etat.benchmarks).toEqual({});
  });

  it("additionne les recommandations, prend la classe la plus haute, cumule les autres effets", () => {
    const res = appliquerModulation(
      [
        regle("a", 1, [
          { type: "recommandation_candidate", recommandation: "r1" },
          { type: "relever_classe_risque", cible: "l1", classe: "R1" },
          { type: "retirer_item", item: "i9" },
          { type: "gabarit", cible: "rapport", choix: "bailleur" },
          { type: "benchmark", cible: "marge", choix: "uemoa" },
        ]),
        regle("b", 2, [
          { type: "recommandation_candidate", recommandation: "r1" },
          { type: "recommandation_candidate", recommandation: "r0" },
          { type: "relever_classe_risque", cible: "l1", classe: "R2" },
        ]),
      ],
      { x: 1 },
    );
    expect(res.conflits).toEqual([]);
    expect(res.etat.recommandationsCandidates).toEqual(["r0", "r1"]);
    expect(res.effets.find((e) => e.cle === "recommandation:r1")!.regles).toEqual(["b", "a"]);
    expect(res.etat.classesRisqueRelevees).toEqual({ l1: "R2" });
    expect(res.etat.itemsRetires).toEqual(["i9"]);
    expect(res.etat.gabarits).toEqual({ rapport: "bailleur" });
    expect(res.etat.benchmarks).toEqual({ marge: "uemoa" });
    expect(res.journal.map((j) => [j.regle, j.effetsRetenus, j.effetsEcartes])).toEqual([
      ["b", 3, 0],
      ["a", 4, 1],
    ]);
  });
});

describe("dépendances et cycles", () => {
  it("calcule les dépendances lecteur → écrivains", () => {
    const deps = dependancesRegles(REGLES);
    expect([...deps.get("succession")!]).toEqual(["gouvernance_familiale"]);
    expect(deps.get("petite_entreprise")!.size).toBe(0);
  });

  it("refuse un cycle entre règles ou une règle qui lit la brique qu'elle écrit", () => {
    const cycle: RegleModulation[] = [
      {
        code: "a",
        priorite: 1,
        condition: { type: "brique_active", brique: "b2" },
        effets: [{ type: "activer_brique", brique: "b1" }],
      },
      {
        code: "b",
        priorite: 1,
        condition: { type: "non", condition: { type: "brique_active", brique: "b1" } },
        effets: [{ type: "activer_brique", brique: "b2" }],
      },
    ];
    const e = erreurDe(() => appliquerModulation(cycle, {}));
    expect(e.code).toBe("CYCLE_REGLES");
    expect(e.message).toContain("a → b");
    const boucle: RegleModulation = {
      code: "boucle",
      priorite: 1,
      condition: { type: "brique_active", brique: "b1" },
      effets: [{ type: "retirer_brique", brique: "b1" }],
    };
    expect(erreurDe(() => appliquerModulation([boucle], {})).code).toBe("CYCLE_REGLES");
    // Une règle inactive ne participe pas au graphe.
    expect(appliquerModulation([{ ...boucle, active: false }], {}).effets).toEqual([]);
  });
});

describe("contrôles de forme à l'application", () => {
  const ok: RegleModulation = {
    code: "ok",
    priorite: 1,
    condition: { type: "comparaison", facteur: "x", comparateur: "egal", valeur: 1 },
    effets: [],
  };

  it("refuse un jeu mal formé avec le chemin fautif", () => {
    const e = erreurDe(() => appliquerModulation([ok, { ...ok, code: "b", priorite: -1 }], {}));
    expect(e).toMatchObject({ code: "REGLES_INVALIDES", chemin: "regles[1].priorite" });
    expect(erreurDe(() => appliquerModulation([ok, ok], {})).chemin).toBe("regles[1].code");
  });

  it("refuse un contexte ou des briques de base invalides", () => {
    expect(erreurDe(() => appliquerModulation([ok], null as never)).code).toBe("OPTIONS_INVALIDES");
    expect(erreurDe(() => appliquerModulation([ok], [] as never)).code).toBe("OPTIONS_INVALIDES");
    expect(erreurDe(() => appliquerModulation([ok], {}, { briquesDeBase: [""] })).code).toBe(
      "OPTIONS_INVALIDES",
    );
    expect(
      erreurDe(() => appliquerModulation([ok], {}, { briquesDeBase: "b" as never })).code,
    ).toBe("OPTIONS_INVALIDES");
  });
});

describe("comparerValeur", () => {
  it("compare scalaires, nombres, appartenance et contenu", () => {
    expect(comparerValeur("a", "egal", "a")).toBe(true);
    expect(comparerValeur(["a"], "egal", "a")).toBe(false);
    expect(comparerValeur("a", "egal", ["a"])).toBe(false);
    expect(comparerValeur("a", "different", "b")).toBe(true);
    expect(comparerValeur(["a"], "different", "b")).toBe(false);
    expect(comparerValeur(false, "different", true)).toBe(true);
    expect(comparerValeur(3, "inferieur", 4)).toBe(true);
    expect(comparerValeur(4, "inferieur", 4)).toBe(false);
    expect(comparerValeur(4, "inferieur_ou_egal", 4)).toBe(true);
    expect(comparerValeur(5, "superieur", 4)).toBe(true);
    expect(comparerValeur(4, "superieur_ou_egal", 4)).toBe(true);
    expect(comparerValeur(3, "superieur_ou_egal", 4)).toBe(false);
    expect(comparerValeur("4", "superieur", 3)).toBe(false);
    expect(comparerValeur(2, "dans", [1, 2])).toBe(true);
    expect(comparerValeur("b", "dans", ["a"])).toBe(false);
    expect(comparerValeur(["x", "a"], "dans", ["a"])).toBe(true);
    expect(comparerValeur("a", "dans", "a")).toBe(false);
    expect(comparerValeur(["a", "b"], "contient", "b")).toBe(true);
    expect(comparerValeur(["a", "b"], "contient", ["a", "b"])).toBe(true);
    expect(comparerValeur(["a"], "contient", ["a", "b"])).toBe(false);
    expect(comparerValeur("ab", "contient", "a")).toBe(false);
    expect(comparerValeur(null, "egal", "a")).toBe(false);
  });
});

describe("simulation et différentiel", () => {
  it("donne les effets ajoutés et les règles déclenchées entre deux contextes", () => {
    const s = simulerModulation(REGLES, GRANDE_BANQUE, PME_FAMILIALE_CACAO);
    expect(s.differentiel.identique).toBe(false);
    expect(s.differentiel.ajoutes).toHaveLength(10);
    expect(s.differentiel.retires).toEqual([]);
    expect(s.differentiel.reglesDeclenchees).toEqual([
      "comptes_fragiles",
      "filiere_agricole",
      "gouvernance_familiale",
      "petite_entreprise",
      "succession",
    ]);
    const retour = comparerModulations(s.apres, s.avant);
    expect(retour.retires).toHaveLength(10);
    expect(retour.reglesEteintes).toHaveLength(5);
  });

  it("repère un effet modifié et une variation des conflits ; identique sinon", () => {
    const pme = { ...PME_FAMILIALE_CACAO, part_especes: "moyenne" };
    const s = simulerModulation(REGLES, PME_FAMILIALE_CACAO, pme);
    expect(s.differentiel.modifies).toEqual([
      {
        cle: "classe_risque:rapport_financier",
        avant: expect.objectContaining({ effet: expect.objectContaining({ classe: "R3" }) }),
        apres: expect.objectContaining({ effet: expect.objectContaining({ classe: "R2" }) }),
      },
    ]);
    expect(s.differentiel.reglesEteintes).toEqual(["comptes_fragiles"]);
    expect(simulerModulation(REGLES, pme, pme).differentiel.identique).toBe(true);
    // Deux jeux de règles sur un même contexte : conflit non résolu introduit.
    const conflit: RegleModulation = {
      code: "zz_conflit",
      priorite: 10,
      condition: { type: "comparaison", facteur: "effectif", comparateur: "inferieur", valeur: 20 },
      effets: [{ type: "retirer_brique", brique: "atelier_unique" }],
    };
    const d = comparerModulations(
      appliquerModulation(REGLES, pme),
      appliquerModulation([...REGLES, conflit], pme),
    );
    expect(d.variationConflitsNonResolus).toBe(1);
    expect(d.retires.map((e) => e.cle)).toEqual(["brique:atelier_unique"]);
  });
});

describe("cas types", () => {
  it("vérifie les attendus et liste les écarts", () => {
    const res = executerCasTypes(REGLES, [
      {
        code: "pme",
        contexte: PME_FAMILIALE_CACAO,
        briquesDeBase: BASE,
        attendu: {
          presents: [
            { type: "activer_brique", brique: "atelier_unique" },
            { type: "relever_classe_risque", cible: "rapport_financier", classe: "R3" },
          ],
          absents: [{ type: "relever_classe_risque", cible: "rapport_financier", classe: "R2" }],
          reglesDeclenchees: [
            "succession",
            "petite_entreprise",
            "gouvernance_familiale",
            "filiere_agricole",
            "comptes_fragiles",
          ],
          conflitsNonResolus: 0,
        },
      },
      {
        code: "banque",
        contexte: GRANDE_BANQUE,
        attendu: {
          presents: [{ type: "activer_brique", brique: "atelier_unique" }],
          absents: [{ type: "gabarit", cible: "questionnaire", choix: "essentiel" }],
          reglesDeclenchees: ["petite_entreprise"],
          conflitsNonResolus: 1,
        },
      },
      {
        code: "banque_inattendu",
        contexte: { ...GRANDE_BANQUE, effectif: 5 },
        attendu: { absents: [{ type: "gabarit", cible: "questionnaire", choix: "essentiel" }] },
      },
    ]);
    expect(res).toMatchObject({ reussi: false, reussis: 1, echoues: 2 });
    expect(res.cas[0]!.reussi).toBe(true);
    expect(res.cas[1]!.ecarts).toEqual([
      { type: "EFFET_MANQUANT", effet: { type: "activer_brique", brique: "atelier_unique" } },
      { type: "REGLES_DECLENCHEES", attendues: ["petite_entreprise"], obtenues: [] },
      { type: "CONFLITS", attendus: 1, obtenus: 0 },
    ]);
    expect(res.cas[2]!.ecarts).toEqual([
      {
        type: "EFFET_INATTENDU",
        effet: { type: "gabarit", cible: "questionnaire", choix: "essentiel" },
      },
    ]);
    expect(executerCasTypes(REGLES, []).reussi).toBe(true);
    const seul = executerCasTypes(REGLES, [
      { code: "regles_seules", contexte: GRANDE_BANQUE, attendu: { reglesDeclenchees: [] } },
    ]);
    expect(seul.reussi).toBe(true);
  });

  it("refuse des cas types mal formés", () => {
    const cas = { code: "c", contexte: {}, attendu: {} };
    expect(erreurDe(() => executerCasTypes(REGLES, [cas, cas])).code).toBe("CAS_TYPE_INVALIDE");
    expect(erreurDe(() => executerCasTypes(REGLES, null as never)).code).toBe("CAS_TYPE_INVALIDE");
    expect(
      erreurDe(() => executerCasTypes(REGLES, [{ ...cas, attendu: null as never }])).code,
    ).toBe("CAS_TYPE_INVALIDE");
    expect(
      erreurDe(() =>
        executerCasTypes(REGLES, [
          { ...cas, attendu: { presents: [{ type: "inconnu" } as never] } },
        ]),
      ).code,
    ).toBe("CAS_TYPE_INVALIDE");
    expect(
      erreurDe(() => executerCasTypes(REGLES, [{ ...cas, attendu: { conflitsNonResolus: -1 } }]))
        .code,
    ).toBe("CAS_TYPE_INVALIDE");
    expect(
      erreurDe(() =>
        executerCasTypes(REGLES, [{ ...cas, attendu: { reglesDeclenchees: "a" as never } }]),
      ).code,
    ).toBe("CAS_TYPE_INVALIDE");
  });
});

describe("API publique du domaine modulation", () => {
  it("expose les moteurs", () => {
    for (const nom of [
      "ErreurModulation",
      "appliquerModulation",
      "simulerModulation",
      "comparerModulations",
      "executerCasTypes",
      "validerReglesModulation",
      "validerContexteModulation",
      "validerFacteursContexte",
      "dependancesRegles",
      "cleEffet",
      "signatureEffet",
      "comparerValeur",
      "TYPES_EFFET_MODULATION",
      "COMPARATEURS_MODULATION",
    ]) {
      expect(modulation).toHaveProperty(nom);
    }
    expect(cleEffet({ type: "seuil", cible: "c", valeur: 1 })).toBe("seuil:c");
  });
});
