import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  RED_ACTIONS_MAX,
  RED_CATEGORIE_CREANCIER_LIBELLES,
  RED_CATEGORIE_FLUX_LIBELLES,
  RED_CATEGORIES_CREANCIER,
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  RED_CLES_RATIO,
  RED_CODES_LEVIER,
  RED_COLONNES_KANBAN,
  RED_CORRECTIONS_SEMAINE_MAX,
  RED_CRITERE_ALERTE_LIBELLES,
  RED_CRITERE_ALERTE_SENS,
  RED_CRITERE_ALERTE_UNITES,
  RED_CRITERES_ALERTE,
  RED_DOMAINE_LIBELLES,
  RED_DOMAINES,
  RED_FAMILLE_LEVIER_LIBELLES,
  RED_FAMILLES_LEVIER,
  RED_LEVIER_LIBELLES,
  RED_LIGNES_TRESORERIE_MAX,
  RED_MONTANT_MAX,
  RED_NIVEAU_ALERTE_LIBELLES,
  RED_NIVEAUX_ALERTE,
  RED_PLAFONDS,
  RED_POSTE_LIBELLES,
  RED_POSTES,
  RED_RAISON_RATIO_LIBELLES,
  RED_RAISONS_RATIO,
  RED_RATIO_LIBELLES,
  RED_RATIO_UNITES,
  RED_REPONSE_URGENCE_LIBELLES,
  RED_REPONSES_URGENCE,
  RED_SECTEUR_LIBELLES,
  RED_SECTEURS,
  RED_SENS_FLUX,
  RED_SENS_FLUX_LIBELLES,
  RED_SOURCE_SEUILS_LIBELLES,
  RED_SOURCES_SEUILS,
  RED_STATUT_ACCORD_LIBELLES,
  RED_STATUT_ACTION_LIBELLES,
  RED_STATUT_DOSSIER_LIBELLES,
  RED_STATUT_RATIO_LIBELLES,
  RED_STATUT_SEUILS_LIBELLES,
  RED_STATUT_VERSION_PLAN_LIBELLES,
  RED_STATUTS_ACCORD,
  RED_STATUTS_ACTION,
  RED_STATUTS_DOSSIER,
  RED_STATUTS_RATIO,
  RED_STATUTS_SEUILS,
  RED_STATUTS_VERSION_PLAN,
  RED_TYPE_EVENEMENT_ACTION_LIBELLES,
  RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES,
  RED_TYPES_EVENEMENT_ACTION,
  RED_TYPES_EVENEMENT_NEGOCIATION,
  RED_VOLET_LIBELLES,
  RED_VOLETS,
  RED_VOYANT_LIBELLES,
  RED_VOYANTS,
  redActionCreationSchema,
  redActionDeplacementSchema,
  redActionModificationSchema,
  redCommentaireSchema,
  redCorrespondanceCreationSchema,
  redCreanceCreationSchema,
  redCreancierCreationSchema,
  redCreancierModificationSchema,
  redDossierCreationSchema,
  redDossierModificationSchema,
  redDossierStatutSchema,
  redEvenementNegociationSchema,
  redHistoriqueQuerySchema,
  redLevierSimulationSchema,
  redListeDossiersQuerySchema,
  redPlanValidationSchema,
  redPlanVersionCreationSchema,
  redPointMortSchema,
  redRealiseCreationSchema,
  redScoreCreationSchema,
  redSeuilsCreationSchema,
  redSeuilsPublicationSchema,
  redSeuilsQuerySchema,
  redSeuilsSchema,
  redTresorerieVersionCreationSchema,
  redUrgenceCreationSchema,
} from "./redressement";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const UUID2 = "223e4567-e89b-42d3-a456-426614174000";

const ok = (schema: ZodTypeAny, valeur: unknown): boolean => schema.safeParse(valeur).success;
/** Copie de l'objet sans le champ donné. */
const sans = (objet: Record<string, unknown>, champ: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(objet).filter(([cle]) => cle !== champ));
const message = (schema: ZodTypeAny, valeur: unknown): string => {
  const r = schema.safeParse(valeur);
  return r.success
    ? ""
    : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");
};

describe("libellés et listes : aucun trou, aucun identifiant technique", () => {
  const paires: [string, readonly string[], Record<string, string>][] = [
    ["secteurs", RED_SECTEURS, RED_SECTEUR_LIBELLES],
    ["statuts du dossier", RED_STATUTS_DOSSIER, RED_STATUT_DOSSIER_LIBELLES],
    ["postes", RED_POSTES, RED_POSTE_LIBELLES],
    ["ratios", RED_CLES_RATIO, RED_RATIO_LIBELLES],
    ["statuts de ratio", RED_STATUTS_RATIO, RED_STATUT_RATIO_LIBELLES],
    ["raisons de ratio", RED_RAISONS_RATIO, RED_RAISON_RATIO_LIBELLES],
    ["domaines", RED_DOMAINES, RED_DOMAINE_LIBELLES],
    ["réponses d'urgence", RED_REPONSES_URGENCE, RED_REPONSE_URGENCE_LIBELLES],
    ["voyants", RED_VOYANTS, RED_VOYANT_LIBELLES],
    ["critères d'alerte", RED_CRITERES_ALERTE, RED_CRITERE_ALERTE_LIBELLES],
    ["niveaux d'alerte", RED_NIVEAUX_ALERTE, RED_NIVEAU_ALERTE_LIBELLES],
    ["statuts de seuils", RED_STATUTS_SEUILS, RED_STATUT_SEUILS_LIBELLES],
    ["sources de seuils", RED_SOURCES_SEUILS, RED_SOURCE_SEUILS_LIBELLES],
    ["sens de flux", RED_SENS_FLUX, RED_SENS_FLUX_LIBELLES],
    [
      "catégories de flux",
      [...RED_CATEGORIES_ENCAISSEMENT, ...RED_CATEGORIES_DECAISSEMENT],
      RED_CATEGORIE_FLUX_LIBELLES,
    ],
    ["catégories de créancier", RED_CATEGORIES_CREANCIER, RED_CATEGORIE_CREANCIER_LIBELLES],
    [
      "types d'événement de négociation",
      RED_TYPES_EVENEMENT_NEGOCIATION,
      RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES,
    ],
    ["statuts d'accord", RED_STATUTS_ACCORD, RED_STATUT_ACCORD_LIBELLES],
    ["volets", RED_VOLETS, RED_VOLET_LIBELLES],
    ["statuts d'action", RED_STATUTS_ACTION, RED_STATUT_ACTION_LIBELLES],
    ["types d'événement d'action", RED_TYPES_EVENEMENT_ACTION, RED_TYPE_EVENEMENT_ACTION_LIBELLES],
    ["statuts de version de plan", RED_STATUTS_VERSION_PLAN, RED_STATUT_VERSION_PLAN_LIBELLES],
    ["leviers", RED_CODES_LEVIER, RED_LEVIER_LIBELLES],
    ["familles de levier", RED_FAMILLES_LEVIER, RED_FAMILLE_LEVIER_LIBELLES],
  ];

  for (const [nom, valeurs, libelles] of paires) {
    it(`${nom} : un libellé par valeur, sans tiret bas`, () => {
      expect(Object.keys(libelles).sort()).toEqual([...valeurs].sort());
      for (const v of valeurs) {
        expect(libelles[v], v).toBeTruthy();
        expect(libelles[v]).not.toMatch(/_/);
      }
      expect(new Set(valeurs).size).toBe(valeurs.length);
    });
  }

  it("tailles des listes de la spécification", () => {
    expect(RED_SECTEURS).toHaveLength(6);
    expect(RED_POSTES).toHaveLength(14);
    expect(RED_CLES_RATIO).toHaveLength(10);
    expect(RED_CRITERES_ALERTE).toHaveLength(12);
    expect(RED_CATEGORIES_ENCAISSEMENT).toHaveLength(4);
    expect(RED_CATEGORIES_DECAISSEMENT).toHaveLength(7);
    expect(RED_CODES_LEVIER).toHaveLength(6);
    expect(RED_COLONNES_KANBAN).toEqual(["a_faire", "en_cours", "bloquee", "terminee"]);
  });

  it("unités et sens couvrent chaque ratio et chaque critère", () => {
    expect(Object.keys(RED_RATIO_UNITES).sort()).toEqual([...RED_CLES_RATIO].sort());
    expect(RED_RATIO_UNITES.bfr_jours).toBe("jours");
    expect(RED_RATIO_UNITES.endettement).toBe("pb");
    expect(Object.keys(RED_CRITERE_ALERTE_UNITES).sort()).toEqual([...RED_CRITERES_ALERTE].sort());
    expect(Object.keys(RED_CRITERE_ALERTE_SENS).sort()).toEqual([...RED_CRITERES_ALERTE].sort());
    expect(RED_CRITERE_ALERTE_UNITES.arrieres_fiscaux_sociaux).toBe("oui_non");
    expect(RED_CRITERE_ALERTE_SENS.endettement).toBe("haut_pire");
  });

  it("libellés fixes de la spécification (échantillon)", () => {
    expect(RED_VOYANT_LIBELLES).toEqual({
      vert: "Maîtrisé",
      orange: "Vigilance",
      rouge: "Critique",
      non_evalue: "Non évalué",
    });
    expect(RED_REPONSE_URGENCE_LIBELLES.inconnu).toBe("Je ne sais pas");
    expect(RED_NIVEAU_ALERTE_LIBELLES.insuffisant).toBe("Données insuffisantes");
    expect(RED_VOLET_LIBELLES.quick_win).toBe("Quick wins (3 à 6 mois)");
  });

  it("aucun libellé ne qualifie la situation en termes juridiques", () => {
    const tout = JSON.stringify([
      RED_STATUT_DOSSIER_LIBELLES,
      RED_VOYANT_LIBELLES,
      RED_NIVEAU_ALERTE_LIBELLES,
      RED_CRITERE_ALERTE_LIBELLES,
      RED_DOMAINE_LIBELLES,
      RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES,
      RED_SOURCE_SEUILS_LIBELLES,
    ]).toLowerCase();
    for (const interdit of [
      "cessation",
      "faillite",
      "défaillance",
      "procédure d'alerte",
      "état de crise",
    ]) {
      expect(tout).not.toContain(interdit);
    }
  });

  it("plafonds de la spécification (§9.5)", () => {
    expect(RED_PLAFONDS).toMatchObject({
      correspondances: 100,
      urgences: 200,
      scores: 500,
      seuils_par_secteur: 50,
      versions_tresorerie: 200,
      lignes_tresorerie: 600,
      realises: 1000,
      corrections_semaine: 10,
      creanciers: 200,
      creances: 100,
      evenements_negociation: 300,
      echeances: 60,
      actions: 300,
      evenements_action: 200,
      versions_plan: 100,
    });
    expect(RED_LIGNES_TRESORERIE_MAX).toBe(600);
    expect(RED_CORRECTIONS_SEMAINE_MAX).toBe(10);
    expect(RED_ACTIONS_MAX).toBe(300);
    expect(RED_MONTANT_MAX).toBe(10_000_000_000_000);
  });
});

describe("dossier", () => {
  it("création : valide, secteur par défaut, champ inconnu rejeté, intitulé obligatoire", () => {
    expect(redDossierCreationSchema.parse({ intitule: "  Redressement SA  " })).toEqual({
      intitule: "Redressement SA",
      secteur: "general",
    });
    expect(ok(redDossierCreationSchema, { intitule: "A", secteur: "btp" })).toBe(true);
    expect(ok(redDossierCreationSchema, {})).toBe(false);
    expect(ok(redDossierCreationSchema, { intitule: "" })).toBe(false);
    expect(ok(redDossierCreationSchema, { intitule: "x".repeat(200) })).toBe(true);
    expect(ok(redDossierCreationSchema, { intitule: "x".repeat(201) })).toBe(false);
    expect(ok(redDossierCreationSchema, { intitule: "A", secteur: "mines" })).toBe(false);
    expect(ok(redDossierCreationSchema, { intitule: "A", cabinet_id: UUID })).toBe(false);
  });

  it("modification : au moins un champ", () => {
    expect(ok(redDossierModificationSchema, { secteur: "commerce" })).toBe(true);
    expect(ok(redDossierModificationSchema, {})).toBe(false);
    expect(ok(redDossierModificationSchema, { statut: "clos" })).toBe(false);
  });

  it("statut : `clos` exige un motif d'au moins 10 caractères", () => {
    expect(ok(redDossierStatutSchema, { statut: "mise_en_oeuvre" })).toBe(true);
    expect(ok(redDossierStatutSchema, { statut: "clos" })).toBe(false);
    expect(message(redDossierStatutSchema, { statut: "clos", motif: "court" })).toContain("motif");
    expect(ok(redDossierStatutSchema, { statut: "clos", motif: "Mission terminée" })).toBe(true);
    expect(ok(redDossierStatutSchema, { statut: "clos", motif: "          " })).toBe(false);
    expect(ok(redDossierStatutSchema, { statut: "diagnostic" })).toBe(false);
    expect(ok(redDossierStatutSchema, { statut: "clos", motif: "x".repeat(1001) })).toBe(false);
  });

  it("liste : limite 1..100 (défaut 30), filtres, champ inconnu", () => {
    expect(redListeDossiersQuerySchema.parse({}).limite).toBe(30);
    expect(redListeDossiersQuerySchema.parse({ limite: "100" }).limite).toBe(100);
    expect(ok(redListeDossiersQuerySchema, { limite: "101" })).toBe(false);
    expect(ok(redListeDossiersQuerySchema, { limite: "0" })).toBe(false);
    expect(
      ok(redListeDossiersQuerySchema, { statut: "clos", secteur: "btp", client_id: UUID, q: "a" }),
    ).toBe(true);
    expect(ok(redListeDossiersQuerySchema, { client_id: "x" })).toBe(false);
    expect(ok(redListeDossiersQuerySchema, { q: "x".repeat(101) })).toBe(false);
    expect(ok(redListeDossiersQuerySchema, { curseur: "x".repeat(501) })).toBe(false);
    expect(ok(redListeDossiersQuerySchema, { autre: 1 })).toBe(false);
  });
});

describe("correspondance de postes", () => {
  const poste = { codes: ["BB"], sans_objet: false };
  it("valide ; au moins un poste ; poste inconnu rejeté ; champ inconnu", () => {
    expect(ok(redCorrespondanceCreationSchema, { postes: { stocks: poste } })).toBe(true);
    expect(
      ok(redCorrespondanceCreationSchema, {
        postes: { stocks: poste },
        motif: "Plan comptable client",
      }),
    ).toBe(true);
    expect(ok(redCorrespondanceCreationSchema, { postes: {} })).toBe(false);
    expect(ok(redCorrespondanceCreationSchema, {})).toBe(false);
    expect(ok(redCorrespondanceCreationSchema, { postes: { inconnu: poste } })).toBe(false);
    expect(
      ok(redCorrespondanceCreationSchema, { postes: { stocks: { ...poste, extra: 1 } } }),
    ).toBe(false);
    expect(ok(redCorrespondanceCreationSchema, { postes: { stocks: poste }, x: 1 })).toBe(false);
  });

  it("sans_objet ⇒ aucun code ; sinon au moins un code ; format et nombre de codes", () => {
    expect(
      ok(redCorrespondanceCreationSchema, { postes: { stocks: { codes: [], sans_objet: true } } }),
    ).toBe(true);
    expect(
      ok(redCorrespondanceCreationSchema, {
        postes: { stocks: { codes: ["A"], sans_objet: true } },
      }),
    ).toBe(false);
    expect(
      ok(redCorrespondanceCreationSchema, { postes: { stocks: { codes: [], sans_objet: false } } }),
    ).toBe(false);
    expect(
      ok(redCorrespondanceCreationSchema, {
        postes: { stocks: { codes: ["a b"], sans_objet: false } },
      }),
    ).toBe(false);
    expect(
      ok(redCorrespondanceCreationSchema, {
        postes: { stocks: { codes: ["x".repeat(41)], sans_objet: false } },
      }),
    ).toBe(false);
    const codes = (n: number) => Array.from({ length: n }, (_, i) => `C${i}`);
    expect(
      ok(redCorrespondanceCreationSchema, {
        postes: { stocks: { codes: codes(50), sans_objet: false } },
      }),
    ).toBe(true);
    expect(
      ok(redCorrespondanceCreationSchema, {
        postes: { stocks: { codes: codes(51), sans_objet: false } },
      }),
    ).toBe(false);
    expect(ok(redCorrespondanceCreationSchema, { postes: { stocks: { codes: ["A"] } } })).toBe(
      false,
    );
  });
});

describe("urgence", () => {
  it("valide ; 1 à 15 réponses ; code de question et réponse contrôlés", () => {
    expect(ok(redUrgenceCreationSchema, { reponses: { T1: "oui" } })).toBe(true);
    const toutes = Object.fromEntries(
      ["T", "A", "E", "S", "F"].flatMap((d) => [1, 2, 3].map((n) => [`${d}${n}`, "non"])),
    );
    expect(ok(redUrgenceCreationSchema, { reponses: toutes })).toBe(true);
    expect(ok(redUrgenceCreationSchema, { reponses: { ...toutes, T4: "non" } })).toBe(false);
    expect(ok(redUrgenceCreationSchema, { reponses: {} })).toBe(false);
    expect(ok(redUrgenceCreationSchema, {})).toBe(false);
    expect(ok(redUrgenceCreationSchema, { reponses: { Z9: "oui" } })).toBe(false);
    expect(ok(redUrgenceCreationSchema, { reponses: { T1: "peut-être" } })).toBe(false);
  });

  it("durée 0..86 400 ; commentaire ≤ 2 000 ; champ inconnu", () => {
    const base = { reponses: { T1: "non" } };
    expect(ok(redUrgenceCreationSchema, { ...base, duree_secondes: 0 })).toBe(true);
    expect(ok(redUrgenceCreationSchema, { ...base, duree_secondes: 86_400 })).toBe(true);
    expect(ok(redUrgenceCreationSchema, { ...base, duree_secondes: 86_401 })).toBe(false);
    expect(ok(redUrgenceCreationSchema, { ...base, duree_secondes: -1 })).toBe(false);
    expect(ok(redUrgenceCreationSchema, { ...base, commentaire: "x".repeat(2000) })).toBe(true);
    expect(ok(redUrgenceCreationSchema, { ...base, commentaire: "x".repeat(2001) })).toBe(false);
    expect(ok(redUrgenceCreationSchema, { ...base, extra: 1 })).toBe(false);
  });
});

describe("seuils et score d'alerte", () => {
  const critere = { orange: 1, rouge: 0, poids: 5 };
  const seuils = () => ({
    criteres: Object.fromEntries(RED_CRITERES_ALERTE.map((c) => [c, { ...critere }])),
    niveaux: { modere: 25, eleve: 50, critique: 75 },
    part_minimale_evaluee_pct: 50,
  });

  it("forme des seuils : douze critères exactement, entiers, champs stricts", () => {
    expect(ok(redSeuilsSchema, seuils())).toBe(true);
    const sans = seuils();
    delete (sans.criteres as Record<string, unknown>).bfr_jours;
    expect(ok(redSeuilsSchema, sans)).toBe(false);
    const trop = seuils();
    (trop.criteres as Record<string, unknown>).en_trop = critere;
    expect(ok(redSeuilsSchema, trop)).toBe(false);
    const decimal = seuils();
    (decimal.criteres as Record<string, unknown>).bfr_jours = { orange: 1.5, rouge: 0, poids: 5 };
    expect(ok(redSeuilsSchema, decimal)).toBe(false);
    const inconnu = seuils();
    (inconnu.criteres as Record<string, unknown>).bfr_jours = { ...critere, extra: 1 };
    expect(ok(redSeuilsSchema, inconnu)).toBe(false);
    expect(ok(redSeuilsSchema, { ...seuils(), niveaux: { modere: 25, eleve: 50 } })).toBe(false);
    expect(ok(redSeuilsSchema, { ...seuils(), part_minimale_evaluee_pct: 50.5 })).toBe(false);
    expect(
      ok(redSeuilsSchema, { ...seuils(), part_minimale_evaluee_pct: Number.MAX_SAFE_INTEGER + 2 }),
    ).toBe(false);
    // Les règles (somme des poids, sens, niveaux) sont celles du moteur, pas du schéma de forme.
    expect(
      ok(redSeuilsSchema, { ...seuils(), niveaux: { modere: 80, eleve: 50, critique: 10 } }),
    ).toBe(true);
  });

  it("création d'une version : secteur, seuils, motif", () => {
    expect(
      ok(redSeuilsCreationSchema, { secteur: "industrie", seuils: seuils(), motif: "Calibrage" }),
    ).toBe(true);
    expect(ok(redSeuilsCreationSchema, { seuils: seuils() })).toBe(false);
    expect(ok(redSeuilsCreationSchema, { secteur: "x", seuils: seuils() })).toBe(false);
    expect(ok(redSeuilsCreationSchema, { secteur: "btp" })).toBe(false);
    expect(
      ok(redSeuilsCreationSchema, { secteur: "btp", seuils: seuils(), motif: "x".repeat(501) }),
    ).toBe(false);
    expect(ok(redSeuilsCreationSchema, { secteur: "btp", seuils: seuils(), extra: 1 })).toBe(false);
  });

  it("requête et publication", () => {
    expect(ok(redSeuilsQuerySchema, {})).toBe(true);
    expect(ok(redSeuilsQuerySchema, { secteur: "btp" })).toBe(true);
    expect(ok(redSeuilsQuerySchema, { secteur: "x" })).toBe(false);
    expect(ok(redSeuilsQuerySchema, { autre: 1 })).toBe(false);
    expect(ok(redSeuilsPublicationSchema, {})).toBe(true);
    expect(ok(redSeuilsPublicationSchema, { motif: "x" })).toBe(false);
  });

  it("score : incidents facultatifs (défaut vide), bornes 0..999, nulls admis", () => {
    expect(redScoreCreationSchema.parse({})).toEqual({ incidents: {} });
    expect(
      ok(redScoreCreationSchema, {
        incidents: {
          rejets_bancaires_12m: 0,
          retards_fournisseurs_90j: 999,
          arrieres_fiscaux_sociaux: true,
        },
      }),
    ).toBe(true);
    expect(
      ok(redScoreCreationSchema, {
        incidents: { rejets_bancaires_12m: null, arrieres_fiscaux_sociaux: null },
      }),
    ).toBe(true);
    expect(ok(redScoreCreationSchema, { incidents: { rejets_bancaires_12m: 1000 } })).toBe(false);
    expect(ok(redScoreCreationSchema, { incidents: { retards_fournisseurs_90j: -1 } })).toBe(false);
    expect(ok(redScoreCreationSchema, { incidents: { rejets_bancaires_12m: 1.5 } })).toBe(false);
    expect(ok(redScoreCreationSchema, { incidents: { arrieres_fiscaux_sociaux: "oui" } })).toBe(
      false,
    );
    expect(ok(redScoreCreationSchema, { incidents: { autre: 1 } })).toBe(false);
    expect(ok(redScoreCreationSchema, { autre: 1 })).toBe(false);
  });

  it("historique : limite 1..50 (défaut 20)", () => {
    expect(redHistoriqueQuerySchema.parse({}).limite).toBe(20);
    expect(ok(redHistoriqueQuerySchema, { limite: "50" })).toBe(true);
    expect(ok(redHistoriqueQuerySchema, { limite: "51" })).toBe(false);
    expect(ok(redHistoriqueQuerySchema, { limite: "0" })).toBe(false);
    expect(ok(redHistoriqueQuerySchema, { autre: 1 })).toBe(false);
  });
});

describe("trésorerie", () => {
  const ligne = { semaine: 1, sens: "encaissement", categorie: "clients", montant: 1000 };
  const version = (surcharges: Record<string, unknown> = {}) => ({
    date_debut: "2026-10-12",
    solde_initial: 50_000_000,
    lignes: [ligne],
    ...surcharges,
  });

  it("version : valide, seuil par défaut 0, champs obligatoires, champ inconnu", () => {
    expect(redTresorerieVersionCreationSchema.parse(version()).seuil_tension).toBe(0);
    expect(ok(redTresorerieVersionCreationSchema, version({ lignes: [] }))).toBe(true);
    for (const champ of ["date_debut", "solde_initial", "lignes"]) {
      const reste = sans(version(), champ);
      expect(ok(redTresorerieVersionCreationSchema, reste), champ).toBe(false);
    }
    expect(ok(redTresorerieVersionCreationSchema, version({ extra: 1 }))).toBe(false);
    expect(ok(redTresorerieVersionCreationSchema, version({ motif: "x".repeat(501) }))).toBe(false);
  });

  it("date de début : un lundi, entre 2000 et 2100", () => {
    expect(ok(redTresorerieVersionCreationSchema, version({ date_debut: "2026-10-13" }))).toBe(
      false,
    );
    expect(
      message(redTresorerieVersionCreationSchema, version({ date_debut: "2026-10-13" })),
    ).toContain("lundi");
    expect(ok(redTresorerieVersionCreationSchema, version({ date_debut: "2026-02-30" }))).toBe(
      false,
    );
    expect(ok(redTresorerieVersionCreationSchema, version({ date_debut: "1999-12-27" }))).toBe(
      false,
    );
    expect(ok(redTresorerieVersionCreationSchema, version({ date_debut: "2101-01-04" }))).toBe(
      false,
    );
    expect(ok(redTresorerieVersionCreationSchema, version({ date_debut: "2000-01-03" }))).toBe(
      true,
    );
    expect(ok(redTresorerieVersionCreationSchema, version({ date_debut: "2100-12-27" }))).toBe(
      true,
    );
  });

  it("soldes et seuil : bornes ±10^13 ; le solde peut être négatif", () => {
    expect(
      ok(redTresorerieVersionCreationSchema, version({ solde_initial: -RED_MONTANT_MAX })),
    ).toBe(true);
    expect(
      ok(redTresorerieVersionCreationSchema, version({ solde_initial: RED_MONTANT_MAX })),
    ).toBe(true);
    expect(
      ok(redTresorerieVersionCreationSchema, version({ solde_initial: RED_MONTANT_MAX + 1 })),
    ).toBe(false);
    expect(
      ok(redTresorerieVersionCreationSchema, version({ solde_initial: -RED_MONTANT_MAX - 1 })),
    ).toBe(false);
    expect(ok(redTresorerieVersionCreationSchema, version({ solde_initial: 1.5 }))).toBe(false);
    expect(ok(redTresorerieVersionCreationSchema, version({ seuil_tension: -1 }))).toBe(false);
    expect(
      ok(redTresorerieVersionCreationSchema, version({ seuil_tension: RED_MONTANT_MAX })),
    ).toBe(true);
    expect(
      ok(redTresorerieVersionCreationSchema, version({ seuil_tension: RED_MONTANT_MAX + 1 })),
    ).toBe(false);
  });

  it("lignes : 600 au plus, semaine 1..13, montant 1..10^13, catégorie du sens, échéance ⇒ créancier", () => {
    const six = Array.from({ length: 600 }, () => ligne);
    expect(ok(redTresorerieVersionCreationSchema, version({ lignes: six }))).toBe(true);
    expect(ok(redTresorerieVersionCreationSchema, version({ lignes: [...six, ligne] }))).toBe(
      false,
    );
    const avec = (l: Record<string, unknown>) =>
      ok(redTresorerieVersionCreationSchema, version({ lignes: [{ ...ligne, ...l }] }));
    expect(avec({ semaine: 13 })).toBe(true);
    expect(avec({ semaine: 14 })).toBe(false);
    expect(avec({ semaine: 0 })).toBe(false);
    expect(avec({ montant: 0 })).toBe(false);
    expect(avec({ montant: RED_MONTANT_MAX })).toBe(true);
    expect(avec({ montant: RED_MONTANT_MAX + 1 })).toBe(false);
    expect(avec({ montant: 1.5 })).toBe(false);
    expect(avec({ categorie: "salaires" })).toBe(false);
    expect(avec({ sens: "decaissement", categorie: "salaires" })).toBe(true);
    expect(avec({ sens: "decaissement", categorie: "clients" })).toBe(false);
    expect(avec({ sens: "autre" })).toBe(false);
    expect(avec({ libelle: "x".repeat(201) })).toBe(false);
    expect(avec({ echeance_id: UUID })).toBe(false);
    expect(avec({ echeance_id: UUID, creancier_id: UUID2 })).toBe(true);
    expect(avec({ creancier_id: UUID2 })).toBe(true);
    expect(avec({ creancier_id: "pas un uuid" })).toBe(false);
    expect(avec({ extra: 1 })).toBe(false);
  });

  it("réalisé : lundi, catégories des deux sens, montants ≥ 0, solde constaté facultatif", () => {
    const realise = (s: Record<string, unknown> = {}) => ({
      semaine_debut: "2026-10-12",
      flux: { encaissement: { clients: 1000 }, decaissement: { salaires: 500 } },
      ...s,
    });
    expect(ok(redRealiseCreationSchema, realise())).toBe(true);
    expect(ok(redRealiseCreationSchema, realise({ flux: {} }))).toBe(true);
    expect(ok(redRealiseCreationSchema, realise({ semaine_debut: "2026-10-14" }))).toBe(false);
    expect(ok(redRealiseCreationSchema, realise({ flux: { encaissement: { salaires: 1 } } }))).toBe(
      false,
    );
    expect(ok(redRealiseCreationSchema, realise({ flux: { decaissement: { clients: 1 } } }))).toBe(
      false,
    );
    expect(ok(redRealiseCreationSchema, realise({ flux: { encaissement: { clients: -1 } } }))).toBe(
      false,
    );
    expect(ok(redRealiseCreationSchema, realise({ flux: { encaissement: { clients: 0 } } }))).toBe(
      true,
    );
    expect(ok(redRealiseCreationSchema, realise({ flux: { autre: {} } }))).toBe(false);
    expect(ok(redRealiseCreationSchema, realise({ solde_constate: -5 }))).toBe(true);
    expect(ok(redRealiseCreationSchema, realise({ solde_constate: null }))).toBe(true);
    expect(ok(redRealiseCreationSchema, realise({ solde_constate: RED_MONTANT_MAX + 1 }))).toBe(
      false,
    );
    expect(ok(redRealiseCreationSchema, realise({ commentaire: "x".repeat(1001) }))).toBe(false);
    expect(ok(redRealiseCreationSchema, { flux: {} })).toBe(false);
    expect(ok(redRealiseCreationSchema, realise({ extra: 1 }))).toBe(false);
  });

  it("point mort : trois montants, période 1..366", () => {
    const base = { chiffre_affaires: 100, charges_variables: 50, charges_fixes: 10 };
    expect(ok(redPointMortSchema, base)).toBe(true);
    expect(ok(redPointMortSchema, { ...base, periode_jours: 366 })).toBe(true);
    expect(ok(redPointMortSchema, { ...base, periode_jours: 367 })).toBe(false);
    expect(ok(redPointMortSchema, { ...base, periode_jours: 0 })).toBe(false);
    expect(ok(redPointMortSchema, { ...base, charges_fixes: -1 })).toBe(false);
    expect(ok(redPointMortSchema, { ...base, charges_fixes: RED_MONTANT_MAX + 1 })).toBe(false);
    expect(ok(redPointMortSchema, { chiffre_affaires: 1, charges_variables: 1 })).toBe(false);
    expect(ok(redPointMortSchema, { ...base, extra: 1 })).toBe(false);
  });
});

describe("créanciers et négociations", () => {
  const creancier = {
    nom: "Banque X",
    categorie: "banque",
    principal: 90_000_000,
    date_arrete: "2026-10-01",
  };

  it("création : valeurs par défaut, champs obligatoires, bornes", () => {
    const r = redCreancierCreationSchema.parse(creancier);
    expect(r).toMatchObject({ garanti: false, interets: 0 });
    for (const champ of ["nom", "categorie", "principal", "date_arrete"]) {
      const reste = sans(creancier, champ);
      expect(ok(redCreancierCreationSchema, reste), champ).toBe(false);
    }
    expect(ok(redCreancierCreationSchema, { ...creancier, categorie: "etat" })).toBe(false);
    expect(ok(redCreancierCreationSchema, { ...creancier, principal: -1 })).toBe(false);
    expect(ok(redCreancierCreationSchema, { ...creancier, principal: RED_MONTANT_MAX })).toBe(true);
    expect(ok(redCreancierCreationSchema, { ...creancier, principal: RED_MONTANT_MAX + 1 })).toBe(
      false,
    );
    expect(ok(redCreancierCreationSchema, { ...creancier, nom: "x".repeat(201) })).toBe(false);
    expect(ok(redCreancierCreationSchema, { ...creancier, reference: "x".repeat(121) })).toBe(
      false,
    );
    expect(ok(redCreancierCreationSchema, { ...creancier, date_arrete: "1999-12-31" })).toBe(false);
    expect(ok(redCreancierCreationSchema, { ...creancier, echeance_initiale: "2101-01-01" })).toBe(
      false,
    );
    expect(
      ok(redCreancierCreationSchema, {
        ...creancier,
        echeance_initiale: "2026-09-30",
        nature: "Prêt",
        garanti: true,
      }),
    ).toBe(true);
    expect(ok(redCreancierCreationSchema, { ...creancier, extra: 1 })).toBe(false);
  });

  it("modification : au moins un champ ; champs d'identité refusés", () => {
    expect(ok(redCreancierModificationSchema, { actif: false })).toBe(true);
    expect(ok(redCreancierModificationSchema, {})).toBe(false);
    expect(ok(redCreancierModificationSchema, { categorie: "autre" })).toBe(false);
    expect(ok(redCreancierModificationSchema, { nom: "" })).toBe(false);
  });

  it("créance : montants et dates", () => {
    expect(
      redCreanceCreationSchema.parse({ principal: 1, date_arrete: "2026-10-01" }).interets,
    ).toBe(0);
    expect(ok(redCreanceCreationSchema, { date_arrete: "2026-10-01" })).toBe(false);
    expect(ok(redCreanceCreationSchema, { principal: 1 })).toBe(false);
    expect(
      ok(redCreanceCreationSchema, {
        principal: 1,
        date_arrete: "2026-10-01",
        commentaire: "x".repeat(1001),
      }),
    ).toBe(false);
    expect(
      ok(redCreanceCreationSchema, { principal: 1, date_arrete: "2026-10-01", extra: 1 }),
    ).toBe(false);
  });

  it("événements simples : ouverture, proposition, contre-proposition, note", () => {
    for (const type of ["ouverture", "proposition", "contre_proposition", "note"]) {
      expect(ok(redEvenementNegociationSchema, { type, date_evenement: "2026-10-05" }), type).toBe(
        true,
      );
      expect(
        ok(redEvenementNegociationSchema, {
          type,
          date_evenement: "2026-10-05",
          montant: 0,
          conditions: "x",
        }),
        type,
      ).toBe(true);
      expect(
        ok(redEvenementNegociationSchema, { type, date_evenement: "2026-10-05", accord_id: UUID }),
        type,
      ).toBe(false);
      expect(ok(redEvenementNegociationSchema, { type }), type).toBe(false);
      expect(
        ok(redEvenementNegociationSchema, {
          type,
          date_evenement: "2026-10-05",
          conditions: "x".repeat(2001),
        }),
        type,
      ).toBe(false);
    }
  });

  it("accord : échéancier régulier ou explicite", () => {
    const accord = (echeancier: unknown, s: Record<string, unknown> = {}) => ({
      type: "accord",
      date_evenement: "2026-10-05",
      montant: 80_000_000,
      echeancier,
      ...s,
    });
    const regulier = {
      mode: "regulier",
      nombre_echeances: 4,
      date_premiere: "2026-11-15",
      periodicite_mois: 1,
    };
    expect(ok(redEvenementNegociationSchema, accord(regulier))).toBe(true);
    expect(ok(redEvenementNegociationSchema, accord({ ...regulier, nombre_echeances: 61 }))).toBe(
      false,
    );
    expect(ok(redEvenementNegociationSchema, accord({ ...regulier, nombre_echeances: 0 }))).toBe(
      false,
    );
    expect(ok(redEvenementNegociationSchema, accord({ ...regulier, periodicite_mois: 13 }))).toBe(
      false,
    );
    expect(ok(redEvenementNegociationSchema, accord({ ...regulier, periodicite_mois: 0 }))).toBe(
      false,
    );
    expect(
      ok(redEvenementNegociationSchema, accord({ ...regulier, date_premiere: "2101-01-01" })),
    ).toBe(false);
    const explicite = {
      mode: "explicite",
      lignes: [
        { date: "2026-12-01", montant: 40_000_000 },
        { date: "2027-01-01", montant: 40_000_000 },
      ],
    };
    expect(ok(redEvenementNegociationSchema, accord(explicite))).toBe(true);
    expect(ok(redEvenementNegociationSchema, accord({ mode: "explicite", lignes: [] }))).toBe(
      false,
    );
    const soixante = Array.from({ length: 60 }, () => ({ date: "2026-12-01", montant: 1 }));
    expect(ok(redEvenementNegociationSchema, accord({ mode: "explicite", lignes: soixante }))).toBe(
      true,
    );
    expect(
      ok(
        redEvenementNegociationSchema,
        accord({ mode: "explicite", lignes: [...soixante, soixante[0]] }),
      ),
    ).toBe(false);
    expect(
      ok(
        redEvenementNegociationSchema,
        accord({ mode: "explicite", lignes: [{ date: "2026-12-01", montant: 0 }] }),
      ),
    ).toBe(false);
    expect(ok(redEvenementNegociationSchema, accord({ mode: "autre" }))).toBe(false);
    expect(ok(redEvenementNegociationSchema, accord(undefined))).toBe(false);
    expect(ok(redEvenementNegociationSchema, accord(regulier, { montant: 0 }))).toBe(false);
    expect(ok(redEvenementNegociationSchema, accord(regulier, { conditions: "garantie" }))).toBe(
      true,
    );
    expect(ok(redEvenementNegociationSchema, accord(regulier, { accord_id: UUID }))).toBe(false);
  });

  it("paiement et rupture", () => {
    const paiement = {
      type: "paiement",
      date_evenement: "2026-11-16",
      montant: 20_000_000,
      accord_id: UUID,
    };
    expect(ok(redEvenementNegociationSchema, paiement)).toBe(true);
    expect(ok(redEvenementNegociationSchema, { ...paiement, echeance_rang: 1 })).toBe(true);
    expect(ok(redEvenementNegociationSchema, { ...paiement, echeance_rang: 61 })).toBe(false);
    expect(ok(redEvenementNegociationSchema, { ...paiement, echeance_rang: 0 })).toBe(false);
    expect(ok(redEvenementNegociationSchema, { ...paiement, montant: 0 })).toBe(false);
    expect(ok(redEvenementNegociationSchema, { ...paiement, accord_id: undefined })).toBe(false);
    const rupture = { type: "rupture", date_evenement: "2026-12-20", accord_id: UUID };
    expect(ok(redEvenementNegociationSchema, rupture)).toBe(true);
    expect(
      ok(redEvenementNegociationSchema, { ...rupture, conditions: "Échéance non honorée" }),
    ).toBe(true);
    expect(ok(redEvenementNegociationSchema, { ...rupture, montant: 5 })).toBe(false);
    expect(ok(redEvenementNegociationSchema, { ...rupture, accord_id: undefined })).toBe(false);
  });

  it("discriminant inconnu ou absent rejeté", () => {
    expect(
      ok(redEvenementNegociationSchema, { type: "saisie", date_evenement: "2026-10-05" }),
    ).toBe(false);
    expect(ok(redEvenementNegociationSchema, { date_evenement: "2026-10-05" })).toBe(false);
    expect(ok(redEvenementNegociationSchema, {})).toBe(false);
  });
});

describe("plan, actions et leviers", () => {
  const action = {
    titre: "Négocier les délais fournisseurs",
    volet: "quick_win",
    domaine: "tresorerie",
    echeance: "2026-12-01",
    responsable_id: UUID,
  };

  it("création d'action : défauts, obligatoires, bornes", () => {
    expect(redActionCreationSchema.parse(action).creer_tache).toBe(false);
    for (const champ of ["titre", "volet", "domaine", "echeance", "responsable_id"]) {
      const reste = sans(action, champ);
      expect(ok(redActionCreationSchema, reste), champ).toBe(false);
    }
    expect(ok(redActionCreationSchema, { ...action, volet: "autre" })).toBe(false);
    expect(ok(redActionCreationSchema, { ...action, domaine: "juridique" })).toBe(false);
    expect(ok(redActionCreationSchema, { ...action, echeance: "2101-01-01" })).toBe(false);
    expect(ok(redActionCreationSchema, { ...action, responsable_id: "x" })).toBe(false);
    expect(ok(redActionCreationSchema, { ...action, titre: "x".repeat(201) })).toBe(false);
    expect(ok(redActionCreationSchema, { ...action, description: "x".repeat(2001) })).toBe(false);
    expect(ok(redActionCreationSchema, { ...action, creer_tache: true })).toBe(true);
    expect(ok(redActionCreationSchema, { ...action, extra: 1 })).toBe(false);
  });

  it("levier d'une action : code de la liste, paramètres entiers", () => {
    const avec = (levier: unknown) => ok(redActionCreationSchema, { ...action, levier });
    expect(avec({ code: "reduction_delai_clients", parametres: { joursGagnes: 10 } })).toBe(true);
    expect(avec({ code: "inconnu", parametres: {} })).toBe(false);
    expect(avec({ code: "hausse_prix" })).toBe(false);
    expect(avec({ code: "hausse_prix", parametres: { hausseParPb: 1.5 } })).toBe(false);
    expect(avec({ code: "hausse_prix", parametres: { hausseParPb: -1 } })).toBe(false);
    expect(avec({ code: "hausse_prix", parametres: { "clé invalide": 1 } })).toBe(false);
    expect(avec({ code: "hausse_prix", parametres: { a: 1 }, extra: 1 })).toBe(false);
    const onze = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`p${i}`, 1]));
    expect(avec({ code: "hausse_prix", parametres: onze })).toBe(false);
    const dix = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}`, 1]));
    expect(avec({ code: "hausse_prix", parametres: dix })).toBe(true);
  });

  it("modification : au moins un champ ; levier nul retire le levier ; pas de creer_tache", () => {
    expect(ok(redActionModificationSchema, { titre: "Autre" })).toBe(true);
    expect(ok(redActionModificationSchema, { levier: null })).toBe(true);
    expect(ok(redActionModificationSchema, {})).toBe(false);
    expect(ok(redActionModificationSchema, { creer_tache: true })).toBe(false);
    expect(ok(redActionModificationSchema, { statut: "terminee" })).toBe(false);
    expect(ok(redActionModificationSchema, { echeance: "2026-12-32" })).toBe(false);
  });

  it("déplacement : statut de la liste, rang 0..100 000", () => {
    expect(ok(redActionDeplacementSchema, { statut: "en_cours" })).toBe(true);
    expect(ok(redActionDeplacementSchema, { statut: "en_cours", rang: 100_000 })).toBe(true);
    expect(ok(redActionDeplacementSchema, { statut: "en_cours", rang: 100_001 })).toBe(false);
    expect(ok(redActionDeplacementSchema, { statut: "en_cours", rang: -1 })).toBe(false);
    expect(
      ok(redActionDeplacementSchema, { statut: "terminee", termine_le: "2026-12-01", motif: "ok" }),
    ).toBe(true);
    expect(ok(redActionDeplacementSchema, { statut: "fait" })).toBe(false);
    expect(ok(redActionDeplacementSchema, {})).toBe(false);
    expect(ok(redActionDeplacementSchema, { statut: "bloquee", motif: "x".repeat(1001) })).toBe(
      false,
    );
  });

  it("commentaire, version de plan, validation", () => {
    expect(ok(redCommentaireSchema, { commentaire: "Point fait" })).toBe(true);
    expect(ok(redCommentaireSchema, { commentaire: "" })).toBe(false);
    expect(ok(redCommentaireSchema, { commentaire: "x".repeat(1001) })).toBe(false);
    expect(ok(redPlanVersionCreationSchema, {})).toBe(true);
    expect(ok(redPlanVersionCreationSchema, { date_reference: "2026-11-01" })).toBe(true);
    expect(ok(redPlanVersionCreationSchema, { date_reference: "2101-01-01" })).toBe(false);
    expect(ok(redPlanVersionCreationSchema, { autre: 1 })).toBe(false);
    expect(ok(redPlanValidationSchema, {})).toBe(true);
    expect(ok(redPlanValidationSchema, { motif: "x".repeat(2000) })).toBe(true);
    expect(ok(redPlanValidationSchema, { motif: "x".repeat(2001) })).toBe(false);
    expect(ok(redPlanValidationSchema, { contenu: {} })).toBe(false);
  });

  it("simulation d'un levier", () => {
    expect(
      ok(redLevierSimulationSchema, {
        code: "reduction_stocks",
        parametres: { reductionPb: 1500 },
      }),
    ).toBe(true);
    expect(ok(redLevierSimulationSchema, { code: "reduction_stocks" })).toBe(false);
    expect(ok(redLevierSimulationSchema, { parametres: {} })).toBe(false);
    expect(
      ok(redLevierSimulationSchema, {
        code: "reduction_stocks",
        parametres: { reductionPb: RED_MONTANT_MAX + 1 },
      }),
    ).toBe(false);
    expect(ok(redLevierSimulationSchema, { code: "x", parametres: {} })).toBe(false);
  });
});
