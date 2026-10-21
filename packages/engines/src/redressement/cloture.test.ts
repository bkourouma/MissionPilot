import { describe, expect, it } from "vitest";
import {
  CLOTURE_ACTIONS_MAX,
  CLOTURE_CHECKLISTS_MAX,
  CLOTURE_CREANCIERS_MAX,
  CONTROLES_CLOTURE,
  SENS_RATIO_CLOTURE,
  VERSION_BILAN_CLOTURE,
  comparerReNotation,
  construireBilanCloture,
  type ChecklistCloture,
  type CreancierCloture,
  type EntreesBilanCloture,
  type NotationPublieeCloture,
} from "./cloture";
import { ErreurRedressement } from "./erreurs";
import type { ActionPlan } from "./plan";
import {
  CLES_RATIO_REDRESSEMENT,
  type CleRatioRedressement,
  type RatioRedressement,
  type RatiosExercice,
} from "./ratios";

const calcule = (valeur: number): RatioRedressement => ({
  valeur,
  statut: "calcule",
  raison: null,
  manquants: [],
});
const nonCalculable: RatioRedressement = {
  valeur: null,
  statut: "non_calculable",
  raison: "postes_manquants",
  manquants: [],
};

function ratios(
  exercice: number,
  valeurs: Partial<Record<CleRatioRedressement, RatioRedressement>> = {},
  base = 10_000,
): RatiosExercice {
  const r = {} as Record<CleRatioRedressement, RatioRedressement>;
  for (const cle of CLES_RATIO_REDRESSEMENT) r[cle] = calcule(base);
  return { exercice, devise: "XOF", postes: {}, ratios: { ...r, ...valeurs } };
}

const action = (surcharges: Partial<ActionPlan> = {}): ActionPlan => ({
  numero: 1,
  titre: "Action",
  volet: "quick_win",
  domaine: "tresorerie",
  echeance: "2026-12-01",
  statut: "a_faire",
  rang: 0,
  responsableId: "u1",
  levierCode: null,
  impactTresorerieUnique: null,
  impactResultatAnnuel: null,
  ...surcharges,
});

const tres = (besoin: number, semaines: number) => ({
  semainesTension: semaines,
  premiereSemaineTension: semaines > 0 ? 3 : null,
  besoinFinancement: besoin,
  soldeMinimum: -besoin,
});

const notation = (
  numero: number,
  score: number | null,
  classe: NotationPublieeCloture["classe"],
): NotationPublieeCloture => ({ numero, score, classe });

/** Entrées complètes : tous les contrôles satisfaits. */
function entrees(surcharges: Partial<EntreesBilanCloture> = {}): EntreesBilanCloture {
  return {
    dateReference: "2026-10-20",
    devise: "XOF",
    ratios: {
      ouverture: ratios(2024, { endettement: calcule(15_000), bfr_jours: calcule(70) }),
      fin: ratios(2025, { endettement: calcule(12_000), bfr_jours: calcule(54) }),
    },
    alerte: {
      ouverture: { score: 70, niveau: "eleve", dateReference: "2026-01-10" },
      fin: { score: 40, niveau: "modere", dateReference: "2026-10-01" },
    },
    urgence: {
      ouverture: { voyant: "rouge", domainesRouges: 3 },
      fin: { voyant: "orange", domainesRouges: 1 },
    },
    tresorerie: { ouverture: tres(500_000, 6), fin: tres(100_000, 2) },
    plan: {
      actions: [
        action({
          numero: 1,
          statut: "terminee",
          levierCode: "delais_clients",
          impactTresorerieUnique: 300,
          impactResultatAnnuel: 50,
        }),
        action({
          numero: 2,
          statut: "en_cours",
          volet: "restructuration",
          echeance: "2027-06-01",
          levierCode: "prix",
          impactTresorerieUnique: 200,
          impactResultatAnnuel: -20,
        }),
        action({
          numero: 3,
          statut: "abandonnee",
          levierCode: "prix",
          impactTresorerieUnique: 999,
        }),
        action({ numero: 4, statut: "a_faire", echeance: "2026-09-01" }),
      ],
      actionsAuPlanValide: 3,
    },
    creanciers: [
      {
        encoursInitial: 1_000,
        encoursRestant: 400,
        echu: 0,
        remise: 100,
        totalPaye: 500,
        statutAccord: "respecte",
      },
      {
        encoursInitial: 500,
        encoursRestant: 0,
        echu: 0,
        remise: 0,
        totalPaye: 500,
        statutAccord: "solde",
      },
      {
        encoursInitial: 500,
        encoursRestant: 500,
        echu: 500,
        remise: 0,
        totalPaye: 0,
        statutAccord: "rompu",
      },
      {
        encoursInitial: 100,
        encoursRestant: 100,
        echu: 0,
        remise: 0,
        totalPaye: 0,
        statutAccord: "en_retard",
      },
      {
        encoursInitial: 100,
        encoursRestant: 100,
        echu: 100,
        remise: 0,
        totalPaye: 0,
        statutAccord: null,
      },
    ],
    covenantsEnDefaut: 1,
    checklists: [
      { completudePb: 10_000, conformitePb: 8_000 },
      { completudePb: 5_000, conformitePb: 6_001 },
    ],
    notation: { premiere: notation(1, 42.5, "D"), derniere: notation(3, 61, "C") },
    causes: { validee: true, nombre: 4 },
    ...surcharges,
  };
}

const erreur = (f: () => unknown): ErreurRedressement => {
  try {
    f();
  } catch (e) {
    return e as ErreurRedressement;
  }
  throw new Error("Aucune erreur levée.");
};

describe("bilan complet", () => {
  const b = construireBilanCloture(entrees());

  it("recopie les constantes et les exercices", () => {
    expect(b.version).toBe(VERSION_BILAN_CLOTURE);
    expect(b.date_reference).toBe("2026-10-20");
    expect(b.devise).toBe("XOF");
    expect(b.exercice_ouverture).toBe(2024);
    expect(b.exercice_fin).toBe(2025);
    expect(b.complet).toBe(true);
    expect(b.controles).toHaveLength(CONTROLES_CLOTURE.length);
    expect(b.controles.every((c) => c.satisfait)).toBe(true);
  });

  it("ratios : variation signée et évolution selon le sens", () => {
    expect(b.ratios).toHaveLength(CLES_RATIO_REDRESSEMENT.length);
    const endettement = b.ratios.find((r) => r.cle === "endettement");
    expect(endettement).toEqual({
      cle: "endettement",
      unite: "pb",
      ouverture: 15_000,
      fin: 12_000,
      variation: -3_000,
      evolution: "amelioration",
    });
    const bfr = b.ratios.find((r) => r.cle === "bfr_jours");
    expect(bfr).toMatchObject({ unite: "jours", variation: -16, evolution: "amelioration" });
    const stable = b.ratios.find((r) => r.cle === "marge_brute");
    expect(stable).toMatchObject({ variation: 0, evolution: "stable" });
    expect(SENS_RATIO_CLOTURE.endettement).toBe("bas");
  });

  it("alerte, urgence, trésorerie : écarts et évolutions", () => {
    expect(b.alerte.variation_points).toBe(-30);
    expect(b.alerte.evolution).toBe("amelioration");
    expect(b.urgence).toMatchObject({ variation_domaines_rouges: -2, evolution: "amelioration" });
    expect(b.tresorerie).toMatchObject({
      variation_besoin_financement: -400_000,
      variation_semaines_tension: -4,
      evolution: "amelioration",
    });
    expect(b.tresorerie.fin?.premiere_semaine_tension).toBe(3);
  });

  it("plan : avancement, retards, leviers retenus et réalisés", () => {
    expect(b.plan.total).toBe(4);
    expect(b.plan.terminees).toBe(1);
    expect(b.plan.abandonnees).toBe(1);
    expect(b.plan.avancement_pb).toBe(3_333);
    expect(b.plan.en_retard).toBe(1);
    expect(b.plan.actions_au_plan_valide).toBe(3);
    expect(b.plan.par_volet.restructuration.total).toBe(1);
    expect(b.plan.leviers).toEqual({
      actions_avec_levier: 2,
      impact_tresorerie_unique_retenu: 500,
      impact_resultat_annuel_retenu: 30,
      impact_tresorerie_unique_realise: 300,
      impact_resultat_annuel_realise: 50,
    });
  });

  it("créanciers : totaux, apurement et accords tenus", () => {
    expect(b.creanciers).toEqual({
      nombre: 5,
      encours_initial: 2_200,
      encours_restant: 1_100,
      echu: 600,
      remises_obtenues: 100,
      total_paye: 1_000,
      apurement_pb: 5_000,
      accords: {
        total: 4,
        respectes: 1,
        en_retard: 1,
        soldes: 1,
        rompus: 1,
        tenus: 2,
        tenus_pb: 5_000,
      },
    });
  });

  it("covenants, check-lists, causes, re-notation et synthèse", () => {
    expect(b.covenants.en_defaut).toBe(1);
    expect(b.checklists).toEqual({
      nombre: 2,
      completes: 1,
      completude_moyenne_pb: 7_500,
      conformite_moyenne_pb: 7_001,
      conformite_minimale_pb: 6_001,
    });
    expect(b.causes).toEqual({ validee: true, nombre: 4 });
    expect(b.renotation).toMatchObject({
      statut: "compare",
      ecart_dixiemes: 185,
      changement_classe: "amelioration",
    });
    // 2 ratios améliorés + alerte + urgence + trésorerie ; 8 ratios stables.
    expect(b.synthese).toEqual({
      ameliorations: 5,
      degradations: 0,
      stables: 8,
      non_comparables: 0,
    });
  });

  it("est déterministe et sérialisable (aucune valeur flottante)", () => {
    const encore = construireBilanCloture(entrees());
    expect(JSON.stringify(encore)).toBe(JSON.stringify(b));
    for (const nombre of JSON.stringify(b).match(/-?\d+\.\d+/g) ?? []) {
      throw new Error(`Valeur non entière : ${nombre}`);
    }
  });
});

describe("dégradations et comparaisons impossibles", () => {
  it("détecte une dégradation sur chaque section", () => {
    const b = construireBilanCloture(
      entrees({
        ratios: {
          ouverture: ratios(2024, { liquidite_generale: calcule(15_000) }),
          fin: ratios(2025, { liquidite_generale: calcule(9_000) }),
        },
        alerte: {
          ouverture: { score: 30, niveau: "modere", dateReference: "2026-01-10" },
          fin: { score: 80, niveau: "critique", dateReference: "2026-10-01" },
        },
        urgence: {
          ouverture: { voyant: "vert", domainesRouges: 0 },
          fin: { voyant: "rouge", domainesRouges: 2 },
        },
        tresorerie: { ouverture: tres(0, 0), fin: tres(10, 1) },
        notation: { premiere: notation(1, 80, "B"), derniere: notation(2, 50, "D") },
      }),
    );
    expect(b.ratios.find((r) => r.cle === "liquidite_generale")?.evolution).toBe("degradation");
    expect(b.alerte.evolution).toBe("degradation");
    expect(b.urgence.evolution).toBe("degradation");
    expect(b.tresorerie.evolution).toBe("degradation");
    expect(b.renotation).toMatchObject({ ecart_dixiemes: -300, changement_classe: "degradation" });
  });

  it("trésorerie : même besoin, l'écart de semaines tranche ; tout égal = stable", () => {
    const meme = construireBilanCloture(
      entrees({ tresorerie: { ouverture: tres(5, 2), fin: tres(5, 3) } }),
    );
    expect(meme.tresorerie.evolution).toBe("degradation");
    const stable = construireBilanCloture(
      entrees({ tresorerie: { ouverture: tres(5, 2), fin: tres(5, 2) } }),
    );
    expect(stable.tresorerie.evolution).toBe("stable");
  });

  it("sans ouverture : non comparable, contrôle non bloquant", () => {
    const b = construireBilanCloture(
      entrees({
        ratios: { ouverture: null, fin: ratios(2025) },
        alerte: { ouverture: null, fin: entrees().alerte.fin },
        urgence: { ouverture: null, fin: entrees().urgence.fin },
        tresorerie: { ouverture: null, fin: tres(1, 1) },
      }),
    );
    expect(b.exercice_ouverture).toBeNull();
    expect(b.ratios.every((r) => r.evolution === "non_comparable" && r.variation === null)).toBe(
      true,
    );
    expect(b.alerte.evolution).toBe("non_comparable");
    expect(b.urgence.evolution).toBe("non_comparable");
    expect(b.tresorerie.evolution).toBe("non_comparable");
    expect(b.complet).toBe(true);
    expect(b.controles.find((c) => c.code === "ouverture_comparable")?.satisfait).toBe(false);
    expect(b.synthese.non_comparables).toBe(13);
  });

  it("un ratio non calculé d'un côté n'est pas comparable", () => {
    const b = construireBilanCloture(
      entrees({
        ratios: {
          ouverture: ratios(2024, { endettement: nonCalculable }),
          fin: ratios(2025),
        },
      }),
    );
    expect(b.ratios.find((r) => r.cle === "endettement")).toMatchObject({
      ouverture: null,
      fin: 10_000,
      variation: null,
      evolution: "non_comparable",
    });
  });

  it("alerte : repli sur le niveau quand un score manque ; insuffisant = non comparable", () => {
    const repli = construireBilanCloture(
      entrees({
        alerte: {
          ouverture: { score: null, niveau: "faible", dateReference: "2026-01-10" },
          fin: { score: 55, niveau: "eleve", dateReference: "2026-10-01" },
        },
      }),
    );
    expect(repli.alerte.variation_points).toBeNull();
    expect(repli.alerte.evolution).toBe("degradation");
    const insuffisant = construireBilanCloture(
      entrees({
        alerte: {
          ouverture: { score: null, niveau: "insuffisant", dateReference: "2026-01-10" },
          fin: { score: 55, niveau: "eleve", dateReference: "2026-10-01" },
        },
      }),
    );
    expect(insuffisant.alerte.evolution).toBe("non_comparable");
  });

  it("urgence non évaluée : non comparable", () => {
    const b = construireBilanCloture(
      entrees({
        urgence: {
          ouverture: { voyant: "non_evalue", domainesRouges: 0 },
          fin: { voyant: "vert", domainesRouges: 0 },
        },
      }),
    );
    expect(b.urgence.evolution).toBe("non_comparable");
  });

  it("créanciers et check-lists vides : taux absents", () => {
    const b = construireBilanCloture(
      entrees({
        creanciers: [],
        checklists: [{ completudePb: null, conformitePb: null }],
        covenantsEnDefaut: null,
      }),
    );
    expect(b.creanciers.apurement_pb).toBeNull();
    expect(b.creanciers.accords.tenus_pb).toBeNull();
    expect(b.checklists).toMatchObject({
      nombre: 1,
      completes: 0,
      completude_moyenne_pb: null,
      conformite_moyenne_pb: null,
      conformite_minimale_pb: null,
    });
    expect(b.covenants.en_defaut).toBeNull();
    expect(b.controles.find((c) => c.code === "creanciers_saisis")?.satisfait).toBe(false);
    expect(b.controles.find((c) => c.code === "covenants_definis")?.satisfait).toBe(false);
    const aucune = construireBilanCloture(entrees({ checklists: [] }));
    expect(aucune.checklists.nombre).toBe(0);
    expect(aucune.controles.find((c) => c.code === "checklists_saisies")?.satisfait).toBe(false);
  });

  it("apurement négatif quand l'encours augmente", () => {
    const c: CreancierCloture = {
      encoursInitial: 100,
      encoursRestant: 150,
      echu: 0,
      remise: 0,
      totalPaye: 0,
      statutAccord: null,
    };
    expect(construireBilanCloture(entrees({ creanciers: [c] })).creanciers.apurement_pb).toBe(
      -5_000,
    );
  });
});

describe("complétude : ce qui bloque la validation", () => {
  const bloquants = CONTROLES_CLOTURE.filter((c) => c.bloquant).map((c) => c.code);

  it("liste fermée : 6 bloquants et 5 informatifs", () => {
    expect(bloquants).toEqual([
      "ratios_fin",
      "alerte_fin",
      "urgence_fin",
      "tresorerie_fin",
      "plan_present",
      "causes_validees",
    ]);
    expect(CONTROLES_CLOTURE).toHaveLength(11);
  });

  const cas: [string, Partial<EntreesBilanCloture>][] = [
    ["ratios_fin", { ratios: { ouverture: null, fin: null } }],
    ["alerte_fin", { alerte: { ouverture: null, fin: null } }],
    ["urgence_fin", { urgence: { ouverture: null, fin: null } }],
    ["tresorerie_fin", { tresorerie: { ouverture: null, fin: null } }],
    ["plan_present", { plan: { actions: [], actionsAuPlanValide: null } }],
    ["causes_validees", { causes: { validee: false, nombre: 0 } }],
  ];
  for (const [code, surcharge] of cas) {
    it(`${code} manquant : bilan incomplet`, () => {
      const b = construireBilanCloture(entrees(surcharge));
      expect(b.complet).toBe(false);
      expect(b.controles.find((c) => c.code === code)?.satisfait).toBe(false);
    });
  }

  it("un plan dont toutes les actions sont abandonnées est vide", () => {
    const b = construireBilanCloture(
      entrees({
        plan: { actions: [action({ statut: "abandonnee" })], actionsAuPlanValide: null },
      }),
    );
    expect(b.complet).toBe(false);
    expect(b.plan.avancement_pb).toBeNull();
  });

  it("cartographie validée sans cause : non satisfait", () => {
    const b = construireBilanCloture(entrees({ causes: { validee: true, nombre: 0 } }));
    expect(b.causes.validee).toBe(false);
    expect(b.complet).toBe(false);
  });

  it("un contrôle informatif manquant ne bloque pas", () => {
    const b = construireBilanCloture(
      entrees({ notation: { premiere: null, derniere: null }, covenantsEnDefaut: null }),
    );
    expect(b.complet).toBe(true);
  });
});

describe("re-notation", () => {
  it("aucune version publiée", () => {
    expect(comparerReNotation(null, null)).toEqual({
      statut: "aucune_version_publiee",
      premiere: null,
      derniere: null,
      ecart_dixiemes: null,
      changement_classe: "non_comparable",
    });
  });

  it("une seule version, ou deux fois la même", () => {
    const n = notation(2, 55.5, "C");
    const seule = comparerReNotation(n, null);
    expect(seule.statut).toBe("une_seule_version");
    expect(seule.premiere).toEqual({ numero: 2, score_dixiemes: 555, classe: "C" });
    expect(comparerReNotation(null, n).statut).toBe("une_seule_version");
    const doublon = comparerReNotation(n, n);
    expect(doublon).toMatchObject({ statut: "une_seule_version", ecart_dixiemes: null });
  });

  it("écart en dixièmes et classe inchangée", () => {
    const r = comparerReNotation(notation(1, 60.1, "C"), notation(2, 60.0, "C"));
    expect(r).toMatchObject({
      statut: "compare",
      ecart_dixiemes: -1,
      changement_classe: "inchangee",
    });
  });

  it("note ou classe absente : non comparable sur ce point", () => {
    const sansNote = comparerReNotation(notation(1, null, null), notation(2, 70, "B"));
    expect(sansNote).toMatchObject({
      statut: "compare",
      ecart_dixiemes: null,
      changement_classe: "non_comparable",
    });
  });

  it("entrées invalides", () => {
    expect(erreur(() => comparerReNotation(notation(0, 50, "C"), null)).code).toBe(
      "ENTREE_INVALIDE",
    );
    expect(erreur(() => comparerReNotation(notation(1, 101, "C"), null)).code).toBe(
      "ENTREE_INVALIDE",
    );
    expect(erreur(() => comparerReNotation(notation(1, Number.NaN, "C"), null)).code).toBe(
      "ENTREE_INVALIDE",
    );
    expect(
      erreur(() => comparerReNotation(notation(1, 50, "Z" as unknown as "A"), null)).code,
    ).toBe("ENTREE_INVALIDE");
  });
});

describe("entrées invalides", () => {
  it("date et devise", () => {
    expect(
      erreur(() => construireBilanCloture(entrees({ dateReference: "pas-une-date" }))).code,
    ).toBe("DATE_INVALIDE");
    expect(
      erreur(() => construireBilanCloture(entrees({ devise: "GBP" as unknown as "XOF" }))).code,
    ).toBe("ENTREE_INVALIDE");
  });

  it("alerte, urgence, trésorerie", () => {
    const alerte = (niveau: string, score: number | null, date = "2026-01-10") =>
      entrees({
        alerte: {
          ouverture: { score, niveau: niveau as "faible", dateReference: date },
          fin: null,
        },
      });
    expect(erreur(() => construireBilanCloture(alerte("inconnu", 5))).code).toBe("ENTREE_INVALIDE");
    expect(erreur(() => construireBilanCloture(alerte("faible", 101))).code).toBe(
      "ENTREE_INVALIDE",
    );
    expect(erreur(() => construireBilanCloture(alerte("faible", 5, "2026-13-40"))).code).toBe(
      "DATE_INVALIDE",
    );
    expect(
      erreur(() =>
        construireBilanCloture(
          entrees({
            urgence: { ouverture: { voyant: "bleu" as "vert", domainesRouges: 0 }, fin: null },
          }),
        ),
      ).code,
    ).toBe("ENTREE_INVALIDE");
    expect(
      erreur(() =>
        construireBilanCloture(
          entrees({ urgence: { ouverture: { voyant: "vert", domainesRouges: 6 }, fin: null } }),
        ),
      ).code,
    ).toBe("ENTREE_INVALIDE");
    expect(
      erreur(() =>
        construireBilanCloture(entrees({ tresorerie: { ouverture: tres(1, 14), fin: null } })),
      ).code,
    ).toBe("ENTREE_INVALIDE");
  });

  it("plafonds de volume et valeurs", () => {
    const creancier: CreancierCloture = {
      encoursInitial: 1,
      encoursRestant: 1,
      echu: 0,
      remise: 0,
      totalPaye: 0,
      statutAccord: null,
    };
    expect(
      erreur(() =>
        construireBilanCloture(
          entrees({ creanciers: Array(CLOTURE_CREANCIERS_MAX + 1).fill(creancier) }),
        ),
      ).code,
    ).toBe("ENTREE_INVALIDE");
    expect(
      erreur(() =>
        construireBilanCloture(
          entrees({ creanciers: [{ ...creancier, statutAccord: "x" as "rompu" }] }),
        ),
      ).code,
    ).toBe("ENTREE_INVALIDE");
    expect(
      erreur(() => construireBilanCloture(entrees({ creanciers: [{ ...creancier, echu: -1 }] })))
        .code,
    ).toBe("ENTREE_INVALIDE");
    const liste: ChecklistCloture = { completudePb: 1, conformitePb: 1 };
    expect(
      erreur(() =>
        construireBilanCloture(
          entrees({ checklists: Array(CLOTURE_CHECKLISTS_MAX + 1).fill(liste) }),
        ),
      ).code,
    ).toBe("ENTREE_INVALIDE");
    expect(
      erreur(() =>
        construireBilanCloture(
          entrees({ checklists: [{ completudePb: 10_001, conformitePb: null }] }),
        ),
      ).code,
    ).toBe("ENTREE_INVALIDE");
    expect(
      erreur(() =>
        construireBilanCloture(
          entrees({
            plan: {
              actions: Array(CLOTURE_ACTIONS_MAX + 1).fill(action()),
              actionsAuPlanValide: null,
            },
          }),
        ),
      ).code,
    ).toBe("ENTREE_INVALIDE");
    expect(
      erreur(() => construireBilanCloture(entrees({ causes: { validee: true, nombre: 13 } }))).code,
    ).toBe("ENTREE_INVALIDE");
    expect(erreur(() => construireBilanCloture(entrees({ covenantsEnDefaut: 13 }))).code).toBe(
      "ENTREE_INVALIDE",
    );
    expect(
      erreur(() =>
        construireBilanCloture(entrees({ plan: { actions: [action()], actionsAuPlanValide: -1 } })),
      ).code,
    ).toBe("ENTREE_INVALIDE");
  });

  it("une action mal formée est refusée par le moteur du plan", () => {
    expect(
      erreur(() =>
        construireBilanCloture(
          entrees({
            plan: { actions: [action({ volet: "x" as "quick_win" })], actionsAuPlanValide: null },
          }),
        ),
      ).code,
    ).toBe("PLAN_INVALIDE");
  });
});
