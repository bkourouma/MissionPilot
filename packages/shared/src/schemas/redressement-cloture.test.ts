import { describe, expect, it } from "vitest";
import { FORMATS_RAPPORT_SERVICE } from "./rapports";
import { RED_CLES_RATIO } from "./redressement";
import {
  RED_CHANGEMENT_CLASSE_LIBELLES,
  RED_CHANGEMENTS_CLASSE,
  RED_CLOTURE_MOTIF_MAX,
  RED_CONTROLES_CLOTURE,
  RED_EVOLUTION_CLOTURE_LIBELLES,
  RED_EVOLUTIONS_CLOTURE,
  RED_STATUT_CLOTURE_DOSSIER_LIBELLES,
  RED_STATUT_CLOTURE_LIBELLES,
  RED_STATUT_RENOTATION_LIBELLES,
  RED_STATUTS_CLOTURE,
  RED_STATUTS_CLOTURE_DOSSIER,
  RED_STATUTS_RENOTATION,
  redClotureContenuSchema,
  redClotureCreationSchema,
  redClotureRapportQuerySchema,
  redClotureValidationSchema,
} from "./redressement-cloture";

const avancement = { total: 2, terminees: 1, abandonnees: 0, en_retard: 0, avancement_pb: 5000 };

function contenu(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    date_reference: "2026-10-20",
    devise: "XOF",
    exercice_ouverture: 2024,
    exercice_fin: 2025,
    ratios: RED_CLES_RATIO.map((cle) => ({
      cle,
      unite: cle === "bfr_jours" ? "jours" : "pb",
      ouverture: 10000,
      fin: 12000,
      variation: 2000,
      evolution: "amelioration",
    })),
    alerte: {
      ouverture: { score: 70, niveau: "eleve", date_reference: "2026-01-10" },
      fin: { score: 40, niveau: "modere", date_reference: "2026-10-01" },
      variation_points: -30,
      evolution: "amelioration",
    },
    urgence: {
      ouverture: { voyant: "rouge", domaines_rouges: 3 },
      fin: { voyant: "orange", domaines_rouges: 1 },
      variation_domaines_rouges: -2,
      evolution: "amelioration",
    },
    tresorerie: {
      ouverture: {
        semaines_tension: 6,
        premiere_semaine_tension: 2,
        besoin_financement: 500,
        solde_minimum: -500,
      },
      fin: {
        semaines_tension: 0,
        premiere_semaine_tension: null,
        besoin_financement: 0,
        solde_minimum: 10,
      },
      variation_besoin_financement: -500,
      variation_semaines_tension: -6,
      evolution: "amelioration",
    },
    plan: {
      ...avancement,
      par_volet: { quick_win: avancement, restructuration: avancement },
      actions_au_plan_valide: 2,
      leviers: {
        actions_avec_levier: 1,
        impact_tresorerie_unique_retenu: 100,
        impact_resultat_annuel_retenu: -5,
        impact_tresorerie_unique_realise: 0,
        impact_resultat_annuel_realise: 0,
      },
    },
    creanciers: {
      nombre: 1,
      encours_initial: 100,
      encours_restant: 40,
      echu: 0,
      remises_obtenues: 0,
      total_paye: 60,
      apurement_pb: 6000,
      accords: {
        total: 1,
        respectes: 1,
        en_retard: 0,
        soldes: 0,
        rompus: 0,
        tenus: 1,
        tenus_pb: 10000,
      },
    },
    covenants: { en_defaut: 0 },
    checklists: {
      nombre: 1,
      completes: 1,
      completude_moyenne_pb: 10000,
      conformite_moyenne_pb: 8000,
      conformite_minimale_pb: 8000,
    },
    renotation: {
      statut: "compare",
      premiere: { numero: 1, score_dixiemes: 425, classe: "D" },
      derniere: { numero: 2, score_dixiemes: 610, classe: "C" },
      ecart_dixiemes: 185,
      changement_classe: "amelioration",
    },
    causes: { validee: true, nombre: 3 },
    synthese: { ameliorations: 13, degradations: 0, stables: 0, non_comparables: 0 },
    controles: RED_CONTROLES_CLOTURE.map((c) => ({ ...c, satisfait: true })),
    complet: true,
    ...extra,
  };
}

describe("libellés et listes", () => {
  it("couvrent chaque valeur", () => {
    for (const s of RED_STATUTS_CLOTURE) expect(RED_STATUT_CLOTURE_LIBELLES[s]).toBeTruthy();
    for (const s of RED_STATUTS_CLOTURE_DOSSIER) {
      expect(RED_STATUT_CLOTURE_DOSSIER_LIBELLES[s]).toBeTruthy();
    }
    for (const e of RED_EVOLUTIONS_CLOTURE) expect(RED_EVOLUTION_CLOTURE_LIBELLES[e]).toBeTruthy();
    for (const s of RED_STATUTS_RENOTATION) expect(RED_STATUT_RENOTATION_LIBELLES[s]).toBeTruthy();
    for (const c of RED_CHANGEMENTS_CLASSE) expect(RED_CHANGEMENT_CLASSE_LIBELLES[c]).toBeTruthy();
  });

  it("aucun libellé ne qualifie juridiquement la situation du client", () => {
    const textes = [
      ...Object.values(RED_STATUT_CLOTURE_LIBELLES),
      ...Object.values(RED_STATUT_CLOTURE_DOSSIER_LIBELLES),
      ...Object.values(RED_EVOLUTION_CLOTURE_LIBELLES),
      ...Object.values(RED_STATUT_RENOTATION_LIBELLES),
      ...Object.values(RED_CHANGEMENT_CLASSE_LIBELLES),
      ...RED_CONTROLES_CLOTURE.map((c) => c.libelle),
    ].join(" | ");
    for (const mot of [
      "cessation des paiements",
      "faillite",
      "défaillance",
      "état de crise",
      "en difficulté",
    ]) {
      expect(textes).not.toContain(mot);
    }
  });

  it("contrôles : codes uniques, six bloquants", () => {
    const codes = RED_CONTROLES_CLOTURE.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(RED_CONTROLES_CLOTURE.filter((c) => c.bloquant)).toHaveLength(6);
  });
});

describe("entrées", () => {
  it("la création n'accepte aucun champ", () => {
    expect(redClotureCreationSchema.safeParse({}).success).toBe(true);
    expect(redClotureCreationSchema.safeParse({ contenu: {} }).success).toBe(false);
  });

  it("la validation : motif facultatif, borné, sans champ inconnu", () => {
    expect(redClotureValidationSchema.safeParse({}).success).toBe(true);
    expect(redClotureValidationSchema.parse({ motif: "  Relu  " }).motif).toBe("Relu");
    expect(redClotureValidationSchema.parse({ motif: "   " }).motif).toBeNull();
    expect(
      redClotureValidationSchema.safeParse({ motif: "x".repeat(RED_CLOTURE_MOTIF_MAX + 1) })
        .success,
    ).toBe(false);
    expect(redClotureValidationSchema.safeParse({ statut: "valide" }).success).toBe(false);
  });

  it("le rapport : formats de service seulement", () => {
    for (const format of FORMATS_RAPPORT_SERVICE) {
      expect(redClotureRapportQuerySchema.safeParse({ format }).success).toBe(true);
    }
    expect(redClotureRapportQuerySchema.safeParse({ format: "pptx" }).success).toBe(false);
    expect(redClotureRapportQuerySchema.safeParse({}).success).toBe(false);
    expect(redClotureRapportQuerySchema.safeParse({ format: "pdf", version: 2 }).success).toBe(
      false,
    );
  });
});

describe("contenu du bilan", () => {
  it("accepte un contenu complet", () => {
    expect(redClotureContenuSchema.safeParse(contenu()).success).toBe(true);
  });

  it("accepte un bilan sans ouverture ni notation", () => {
    const r = redClotureContenuSchema.safeParse(
      contenu({
        exercice_ouverture: null,
        alerte: { ouverture: null, fin: null, variation_points: null, evolution: "non_comparable" },
        renotation: {
          statut: "aucune_version_publiee",
          premiere: null,
          derniere: null,
          ecart_dixiemes: null,
          changement_classe: "non_comparable",
        },
        covenants: { en_defaut: null },
      }),
    );
    expect(r.success).toBe(true);
  });

  it("refuse une valeur non entière, un champ inconnu et une valeur hors liste", () => {
    expect(redClotureContenuSchema.safeParse(contenu({ exercice_fin: 2025.5 })).success).toBe(
      false,
    );
    expect(redClotureContenuSchema.safeParse(contenu({ extra: 1 })).success).toBe(false);
    expect(redClotureContenuSchema.safeParse(contenu({ devise: "GBP" })).success).toBe(false);
    expect(
      redClotureContenuSchema.safeParse(contenu({ covenants: { en_defaut: 1, autre: 2 } })).success,
    ).toBe(false);
    expect(redClotureContenuSchema.safeParse(contenu({ controles: [] })).success).toBe(false);
    expect(
      redClotureContenuSchema.safeParse(contenu({ date_reference: "20/10/2026" })).success,
    ).toBe(false);
  });
});
