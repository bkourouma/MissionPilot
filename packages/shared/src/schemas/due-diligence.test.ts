import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  affirmationDdSchema,
  modeleSecteurCreationSchema,
  modeleSecteurVersionSchema,
  modelesSecteurQuerySchema,
  analysesQuerySchema,
  ANALYSES_DD,
  ANALYSE_DD_LIBELLES,
  CATEGORIES_ANALYSE_DD,
  CATEGORIE_ANALYSE_DD_LIBELLES,
  CODES_AVERTISSEMENTS_NOTE,
  libelleDimensionDd,
  CODES_BLOQUANTS_NOTE,
  CODE_AVERTISSEMENT_NOTE_LIBELLES,
  CODE_BLOQUANT_NOTE_LIBELLES,
  cadrageSchema,
  cadrageVersionSchema,
  dimensionnementCalculSchema,
  dimensionnementCreationSchema,
  dimensionnementVersionSchema,
  estCategorieAnalyseDd,
  etapeChaineCreationSchema,
  etapeChaineVersionSchema,
  filtrageCreationSchema,
  filtrageDecisionSchema,
  hypotheseAssertionSchema,
  hypotheseCreationSchema,
  hypotheseLienSchema,
  hypotheseVersionSchema,
  listeExclusionCreationSchema,
  listeExclusionVersionSchema,
  METHODES_DIMENSIONNEMENT,
  METHODE_DIMENSIONNEMENT_LIBELLES,
  NIVEAUX_ES,
  NIVEAUX_RISQUE_DD,
  NIVEAU_ES_LIBELLES,
  NIVEAU_RISQUE_DD_LIBELLES,
  noteBaseSchema,
  noteCreationSchema,
  noteSoumissionSchema,
  noteValidationSchema,
  noteVersionSchema,
  PARAMETRES_DIMENSIONNEMENT,
  PARAMETRE_DIMENSIONNEMENT_LIBELLES,
  planActionCreationSchema,
  planActionVersionSchema,
  PLAFONDS_DD,
  pointCreationSchema,
  pointVersionSchema,
  RECOMMANDATIONS_NOTE,
  RECOMMANDATION_NOTE_LIBELLES,
  rapportNoteQuerySchema,
  regleExclusionSchema,
  risqueCreationSchema,
  risquesQuerySchema,
  risqueVersionSchema,
  signalConstatSchema,
  signalCreationSchema,
  signalVersionSchema,
  signauxQuerySchema,
  THEMES_ES,
  THEME_ES_LIBELLES,
  VARIANTES_NOTE,
  VARIANTE_NOTE_LIBELLES,
  verdictProposeSchema,
  verdictValidationSchema,
  VERDICTS_DD,
  VERDICT_DD_LIBELLES,
} from "./due-diligence";

const U1 = "6f1c1b0e-6a52-4a8f-9d54-3b9b1a5d0a01";
const U2 = "6f1c1b0e-6a52-4a8f-9d54-3b9b1a5d0a02";
const affirmation = { enonce: "Le marché croît de 6 % par an.", classe_risque: "R2" as const };

function ok(schema: z.ZodTypeAny, valeur: unknown): void {
  const r = schema.safeParse(valeur);
  expect(r.success, JSON.stringify(r.success ? "" : r.error.issues)).toBe(true);
}
function ko(schema: z.ZodTypeAny, valeur: unknown, message?: string): void {
  const r = schema.safeParse(valeur);
  expect(r.success).toBe(false);
  if (!r.success && message !== undefined) {
    expect(r.error.issues.map((i) => i.message).join(" | ")).toContain(message);
  }
}

describe("constantes et libellés français", () => {
  it("chaque valeur d'un vocabulaire a son libellé", () => {
    for (const a of ANALYSES_DD) expect(ANALYSE_DD_LIBELLES[a]).toBeTruthy();
    for (const a of ANALYSES_DD) {
      for (const c of CATEGORIES_ANALYSE_DD[a])
        expect(CATEGORIE_ANALYSE_DD_LIBELLES[c]).toBeTruthy();
    }
    for (const n of NIVEAUX_RISQUE_DD) expect(NIVEAU_RISQUE_DD_LIBELLES[n]).toBeTruthy();
    for (const n of NIVEAUX_ES) expect(NIVEAU_ES_LIBELLES[n]).toBeTruthy();
    for (const v of VERDICTS_DD) expect(VERDICT_DD_LIBELLES[v]).toBeTruthy();
    for (const t of THEMES_ES) expect(THEME_ES_LIBELLES[t]).toBeTruthy();
    for (const r of RECOMMANDATIONS_NOTE) expect(RECOMMANDATION_NOTE_LIBELLES[r]).toBeTruthy();
    for (const v of VARIANTES_NOTE) expect(VARIANTE_NOTE_LIBELLES[v]).toBeTruthy();
    for (const m of METHODES_DIMENSIONNEMENT) {
      expect(METHODE_DIMENSIONNEMENT_LIBELLES[m]).toBeTruthy();
      for (const p of PARAMETRES_DIMENSIONNEMENT[m]) {
        expect(PARAMETRE_DIMENSIONNEMENT_LIBELLES[p.code]).toBeTruthy();
      }
    }
    for (const c of CODES_BLOQUANTS_NOTE) expect(CODE_BLOQUANT_NOTE_LIBELLES[c]).toBeTruthy();
    for (const c of CODES_AVERTISSEMENTS_NOTE) {
      expect(CODE_AVERTISSEMENT_NOTE_LIBELLES[c]).toBeTruthy();
    }
  });

  it("vocabulaires du §3.4 : tailles et ordre", () => {
    expect(ANALYSES_DD.flatMap((a) => CATEGORIES_ANALYSE_DD[a])).toHaveLength(18);
    expect(THEMES_ES).toHaveLength(8);
    expect(NIVEAUX_RISQUE_DD).toEqual(["faible", "modere", "eleve", "critique"]);
    expect(NIVEAUX_ES[0]).toBe("non_concerne");
    expect(estCategorieAnalyseDd("swot", "forces")).toBe(true);
    expect(estCategorieAnalyseDd("swot", "politique")).toBe(false);
  });

  it("plafonds du §3.3", () => {
    expect(PLAFONDS_DD).toMatchObject({
      dossiers_par_mission: 10,
      points_par_dossier: 300,
      etapes_par_dossier: 30,
      risques_par_dossier: 200,
      hypotheses_par_dossier: 100,
      actions_par_dossier: 200,
      versions_par_objet: 200,
      dimensionnements_par_dossier: 20,
      filtrages_par_dossier: 50,
      notes_par_dossier: 10,
      verdicts_par_hypothese: 50,
      constats_par_dossier: 2_000,
      ajustements_par_dossier: 1_000,
      signaux_par_cabinet: 2_000,
      listes_exclusion_par_cabinet: 50,
      regles_par_liste: 100,
      base_figee_octets: 1_000_000,
      assertions_par_mission: 2_000,
    });
  });
});

describe("affirmation", () => {
  it("R0 et R1 refusés ; R2 et R3 admis ; valeurs par défaut", () => {
    ok(affirmationDdSchema, affirmation);
    ok(affirmationDdSchema, { ...affirmation, classe_risque: "R3" });
    ko(affirmationDdSchema, { ...affirmation, classe_risque: "R1" });
    ko(affirmationDdSchema, { ...affirmation, classe_risque: "R0" });
    expect(affirmationDdSchema.parse(affirmation)).toMatchObject({
      avis_expert: false,
      avis_expert_motif: null,
      signer_avis: false,
    });
  });

  it("contrôle croisé : avis d'expert ⇒ motif ; motif ou signature ⇒ avis d'expert", () => {
    ko(affirmationDdSchema, { ...affirmation, avis_expert: true }, "Un avis d'expert se justifie.");
    ok(affirmationDdSchema, { ...affirmation, avis_expert: true, avis_expert_motif: "Terrain." });
    ok(affirmationDdSchema, {
      ...affirmation,
      avis_expert: true,
      avis_expert_motif: "Terrain.",
      signer_avis: true,
    });
    ko(affirmationDdSchema, { ...affirmation, avis_expert_motif: "Terrain." });
    ko(affirmationDdSchema, { ...affirmation, signer_avis: true });
  });

  it("rigueur, énoncé borné", () => {
    ko(affirmationDdSchema, { ...affirmation, intrus: 1 });
    ko(affirmationDdSchema, { ...affirmation, enonce: "x".repeat(2001) });
    ko(affirmationDdSchema, { ...affirmation, enonce: "   " });
  });
});

const cadrage = {
  titre: "Étude du cacao ivoirien",
  secteur_code: "cacao",
  pays_code: "ci",
  type_operation: "entree_marche",
  devise: "XOF",
};

describe("cadrage", () => {
  it("cas nominal et valeurs par défaut", () => {
    expect(cadrageSchema.parse(cadrage)).toMatchObject({
      filiere_code: null,
      cible_nom: null,
      date_operation: null,
      question_investissement: null,
      perimetre: null,
    });
  });

  it("une acquisition exige sa cible", () => {
    ko(cadrageSchema, { ...cadrage, type_operation: "acquisition" }, "désigne sa cible");
    ok(cadrageSchema, { ...cadrage, type_operation: "acquisition", cible_nom: "SOCIETE X" });
    ok(cadrageSchema, { ...cadrage, type_operation: "partenariat" });
  });

  it("bornes : devise, date, type, code", () => {
    ko(cadrageSchema, { ...cadrage, devise: "GBP" });
    ko(cadrageSchema, { ...cadrage, type_operation: "fusion" });
    ko(cadrageSchema, { ...cadrage, date_operation: "1999-12-31" });
    ko(cadrageSchema, { ...cadrage, date_operation: "2101-01-01" });
    ko(cadrageSchema, { ...cadrage, date_operation: "2026-02-30" });
    ok(cadrageSchema, { ...cadrage, date_operation: "2026-09-30" });
    ko(cadrageSchema, { ...cadrage, secteur_code: "Cacao" });
    ko(cadrageSchema, { ...cadrage, titre: "" });
    ko(cadrageSchema, { ...cadrage, titre: "x".repeat(201) });
    ko(cadrageSchema, { ...cadrage, perimetre: "x".repeat(4001) });
    ko(cadrageSchema, { ...cadrage, intrus: true });
  });

  it("version : version courante et motif obligatoires, même contrôle d'acquisition", () => {
    ok(cadrageVersionSchema, { ...cadrage, version_courante: 1, motif: "Précision." });
    ko(cadrageVersionSchema, { ...cadrage, version_courante: 1 });
    ko(cadrageVersionSchema, { ...cadrage, motif: "Précision." });
    ko(cadrageVersionSchema, { ...cadrage, version_courante: 201, motif: "x" });
    ko(cadrageVersionSchema, { ...cadrage, version_courante: 0, motif: "x" });
    ko(cadrageVersionSchema, {
      ...cadrage,
      type_operation: "acquisition",
      version_courante: 1,
      motif: "x",
    });
  });
});

describe("points d'analyse", () => {
  const point = { analyse: "pestel", categorie: "politique", ...affirmation };

  it("création : catégorie valide pour l'analyse", () => {
    ok(pointCreationSchema, point);
    ko(pointCreationSchema, { ...point, categorie: "forces" }, "Catégorie inconnue");
    ok(pointCreationSchema, { ...point, analyse: "swot", categorie: "forces" });
    ko(pointCreationSchema, { ...point, analyse: "inconnue" });
    ko(pointCreationSchema, { ...point, niveau: "extreme" });
    ok(pointCreationSchema, { ...point, niveau: "eleve", libelle: "Stabilité" });
    ko(pointCreationSchema, { ...point, classe_risque: "R1" });
    ko(pointCreationSchema, { ...point, avis_expert: true });
    ko(pointCreationSchema, { ...point, intrus: 1 });
  });

  it("version : au moins un champ à modifier ; contrôle croisé de l'affirmation", () => {
    ko(pointVersionSchema, { version_courante: 1, motif: "x" }, "Au moins un champ");
    ok(pointVersionSchema, { version_courante: 1, motif: "x", retire: true });
    ok(pointVersionSchema, { version_courante: 2, motif: "x", enonce: "Nouvel énoncé." });
    ok(pointVersionSchema, { version_courante: 2, motif: "x", libelle: null });
    ko(pointVersionSchema, { version_courante: 1, motif: "x", avis_expert: true });
    ko(pointVersionSchema, { version_courante: 1, motif: "x", signer_avis: true });
    ko(pointVersionSchema, { version_courante: 1, motif: "x", classe_risque: "R0" });
    ko(pointVersionSchema, { version_courante: 1, retire: true });
    ko(pointVersionSchema, { motif: "x", retire: true });
  });
});

describe("chaîne de valeur", () => {
  it("création : parts en points de base 0 à 10 000", () => {
    ok(etapeChaineCreationSchema, { libelle: "Collecte", ordre: 1 });
    expect(etapeChaineCreationSchema.parse({ libelle: "Collecte", ordre: 1 })).toMatchObject({
      part_cout_bp: null,
      part_marge_bp: null,
      acteurs: [],
      contraintes: null,
    });
    ok(etapeChaineCreationSchema, {
      libelle: "x",
      ordre: 1,
      part_cout_bp: 10_000,
      part_marge_bp: 0,
    });
    ko(etapeChaineCreationSchema, { libelle: "x", ordre: 1, part_cout_bp: 10_001 });
    ko(etapeChaineCreationSchema, { libelle: "x", ordre: 1, part_marge_bp: -1 });
    ko(etapeChaineCreationSchema, { libelle: "x", ordre: 1, part_marge_bp: 12.5 });
    ko(etapeChaineCreationSchema, { libelle: "x", ordre: 0 });
    ko(etapeChaineCreationSchema, { libelle: "x", ordre: 201 });
    ok(etapeChaineCreationSchema, { libelle: "x", ordre: 1, acteurs: Array(12).fill("Acteur") });
    ko(etapeChaineCreationSchema, { libelle: "x", ordre: 1, acteurs: Array(13).fill("Acteur") });
    ko(etapeChaineCreationSchema, { libelle: "x", ordre: 1, intrus: 1 });
  });

  it("version : un champ au moins", () => {
    ko(etapeChaineVersionSchema, { version_courante: 1, motif: "x" });
    ok(etapeChaineVersionSchema, { version_courante: 1, motif: "x", part_cout_bp: null });
    ok(etapeChaineVersionSchema, { version_courante: 1, motif: "x", retire: true });
  });
});

describe("risques", () => {
  const risque = { famille: "pays", niveau: "eleve", libelle: "Instabilité", ...affirmation };

  it("création", () => {
    expect(risqueCreationSchema.parse(risque)).toMatchObject({ etape_id: null, signal_id: null });
    ok(risqueCreationSchema, { ...risque, etape_id: U1, signal_id: U2, motif_ecart: "Terrain." });
    ko(risqueCreationSchema, { ...risque, famille: "social" });
    ko(risqueCreationSchema, { ...risque, niveau: "grave" });
    ko(risqueCreationSchema, { ...risque, etape_id: "pas-un-uuid" });
    ko(risqueCreationSchema, { ...risque, classe_risque: "R1" });
    ko(risqueCreationSchema, { ...risque, signer_avis: true });
  });

  it("version", () => {
    ko(risqueVersionSchema, { version_courante: 1, motif: "x" });
    ok(risqueVersionSchema, {
      version_courante: 1,
      motif: "x",
      niveau: "critique",
      motif_ecart: "Raison.",
    });
    ok(risqueVersionSchema, { version_courante: 1, motif: "x", etape_id: null });
    ko(risqueVersionSchema, { version_courante: 1, motif: "x", avis_expert: true });
  });

  it("requêtes de lecture", () => {
    ok(risquesQuerySchema, {});
    ok(risquesQuerySchema, { famille: "change", etape_id: U1, niveau: "faible" });
    ko(risquesQuerySchema, { famille: "x" });
    ok(analysesQuerySchema, { analyse: "swot" });
    ko(analysesQuerySchema, { analyse: "x" });
    ko(analysesQuerySchema, { intrus: 1 });
  });
});

describe("hypothèses, liens et verdicts", () => {
  it("hypothèse : création et version", () => {
    expect(hypotheseCreationSchema.parse({ libelle: "Le marché est porteur" })).toMatchObject({
      description: null,
      critere: null,
      parent_id: null,
    });
    ok(hypotheseCreationSchema, { libelle: "x", parent_id: U1, critere: "Croissance > 5 %" });
    ko(hypotheseCreationSchema, { libelle: "x", parent_id: "non" });
    ko(hypotheseVersionSchema, { version_courante: 1, motif: "x" });
    ok(hypotheseVersionSchema, { version_courante: 1, motif: "x", retire: true });
  });

  it("lien : le sens est exigé si et seulement si on lie", () => {
    ok(hypotheseLienSchema, { assertion_id: U1, action: "lier", sens: "soutient" });
    ok(hypotheseLienSchema, { assertion_id: U1, action: "delier" });
    ko(hypotheseLienSchema, { assertion_id: U1, action: "lier" });
    ko(hypotheseLienSchema, { assertion_id: U1, action: "delier", sens: "contredit" });
    ko(hypotheseLienSchema, { assertion_id: U1, action: "lier", sens: "neutre" });
    ko(hypotheseLienSchema, { assertion_id: U1, action: "supprimer" });
  });

  it("assertion créée depuis une hypothèse", () => {
    ok(hypotheseAssertionSchema, { sens: "contredit", ...affirmation });
    ko(hypotheseAssertionSchema, { ...affirmation });
    ko(hypotheseAssertionSchema, { sens: "soutient", ...affirmation, signer_avis: true });
  });

  it("verdict proposé : citations distinctes, au moins une sauf non concluante", () => {
    const base = { hypothese_version: 1, motif: "Deux sources solides concordantes." };
    ok(verdictProposeSchema, { ...base, verdict: "confirmee", assertions_citees: [U1, U2] });
    ok(verdictProposeSchema, { ...base, verdict: "non_concluante" });
    ok(verdictProposeSchema, { ...base, verdict: "non_concluante", assertions_citees: [U1] });
    ko(verdictProposeSchema, { ...base, verdict: "confirmee" }, "cite au moins une assertion");
    ko(verdictProposeSchema, { ...base, verdict: "infirmee", assertions_citees: [] });
    ko(verdictProposeSchema, { ...base, verdict: "confirmee", assertions_citees: [U1, U1] });
    ko(verdictProposeSchema, {
      ...base,
      verdict: "confirmee",
      assertions_citees: Array.from(
        { length: 51 },
        (_, i) => `6f1c1b0e-6a52-4a8f-9d54-${String(i).padStart(12, "0")}`,
      ),
    });
    ko(verdictProposeSchema, { ...base, verdict: "peut-etre" });
    ko(verdictProposeSchema, { ...base, motif: "", verdict: "non_concluante" });
  });

  it("aucun champ calculé ou d'auteur n'est accepté d'un client", () => {
    const base = { hypothese_version: 1, motif: "x", verdict: "non_concluante" };
    for (const intrus of [
      { indication_moteur: "confirmee" },
      { indication: "confirmee" },
      { solidite: "solide" },
      { proposee_par: U1 },
      { auteur_id: U1 },
    ]) {
      ko(verdictProposeSchema, { ...base, ...intrus });
    }
  });

  it("validation d'un verdict : un rejet se motive", () => {
    ok(verdictValidationSchema, { decision: "valide" });
    ok(verdictValidationSchema, { decision: "rejete", motif: "Source insuffisante." });
    ko(verdictValidationSchema, { decision: "rejete" }, "Un rejet se motive.");
    ko(verdictValidationSchema, { decision: "peut-etre" });
  });
});

describe("signaux", () => {
  const contenu = {
    libelle: "Contrôle des changes",
    famille: "change",
    gravite_indicative: "eleve",
  };

  it("création et version", () => {
    expect(signalCreationSchema.parse({ code: "ci_controle_changes", ...contenu })).toMatchObject({
      actif: true,
      secteur_code: null,
      pays_code: null,
      question: null,
      reference_publique: null,
    });
    ko(signalCreationSchema, { ...contenu });
    ko(signalCreationSchema, { code: "Code Majuscule", ...contenu });
    ko(signalCreationSchema, { code: "x", ...contenu, famille: "social" });
    ko(signalCreationSchema, { code: "x", ...contenu, gravite_indicative: "grave" });
    ko(signalCreationSchema, { code: "x", ...contenu, reference_publique: "x".repeat(501) });
    ok(signalVersionSchema, { ...contenu, version_courante: 1, motif: "Mise à jour." });
    ko(signalVersionSchema, { ...contenu, version_courante: 1 });
  });

  it("requête : booléen coercé sans piège « false », limite 1 à 100", () => {
    expect(signauxQuerySchema.parse({}).limite).toBe(30);
    expect(signauxQuerySchema.parse({ actif: "false" }).actif).toBe(false);
    expect(signauxQuerySchema.parse({ actif: "true" }).actif).toBe(true);
    expect(signauxQuerySchema.parse({ actif: "0" }).actif).toBe(false);
    expect(signauxQuerySchema.parse({ actif: "1" }).actif).toBe(true);
    ko(signauxQuerySchema, { actif: "peut-etre" });
    ok(signauxQuerySchema, { limite: "100", q: "chan", famille: "change", secteur_code: "cacao" });
    ko(signauxQuerySchema, { limite: "101" });
    ko(signauxQuerySchema, { limite: "0" });
    ko(signauxQuerySchema, { q: "x".repeat(101) });
  });

  it("constat : un signal écarté se justifie", () => {
    ok(signalConstatSchema, { etat: "constate" });
    ok(signalConstatSchema, { etat: "a_verifier", risque_id: U1 });
    ok(signalConstatSchema, { etat: "ecarte", commentaire: "Hors périmètre." });
    ko(signalConstatSchema, { etat: "ecarte" }, "Un signal écarté se justifie.");
    ko(signalConstatSchema, { etat: "inconnu" });
  });
});

const MD = 1_000_000_000;
const param = (code: string, bas: number, base: number, haut: number) => ({
  code,
  bas,
  base,
  haut,
  source: { type: "avis_expert" as const, motif: "Estimation du directeur." },
});
const descendant = [
  param("marche_total", 80 * MD, 100 * MD, 120 * MD),
  param("part_segment", 3_000, 4_000, 5_000),
  param("part_adressable", 4_000, 5_000, 6_000),
  param("part_capturable", 800, 1_000, 1_200),
];
const ascendant = [
  param("clients_cibles", 1_500, 2_000, 2_500),
  param("taux_conquete", 1_500, 2_000, 2_500),
  param("volume_par_client", 10, 12, 14),
  param("prix_unitaire", 200_000, 250_000, 300_000),
];

describe("dimensionnement de marché", () => {
  it("création descendante et ascendante", () => {
    ok(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "Cacao",
      parametres: descendant,
    });
    ok(dimensionnementCreationSchema, {
      methode: "ascendant",
      libelle: "Cacao",
      parametres: ascendant,
    });
    expect(
      dimensionnementCreationSchema.parse({
        methode: "ascendant",
        libelle: "x",
        parametres: ascendant,
      }).ajustements,
    ).toEqual([]);
  });

  it("les quatre codes de la méthode, chacun une fois", () => {
    ko(
      dimensionnementCreationSchema,
      { methode: "descendant", libelle: "x", parametres: ascendant },
      "quatre paramètres",
    );
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: [descendant[0], descendant[0], descendant[1], descendant[2]],
    });
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: descendant.slice(0, 3),
    });
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: [...descendant, param("prix_unitaire", 1, 1, 1)],
    });
  });

  it("la source est obligatoire à l'enregistrement, facultative au calcul à blanc", () => {
    const sansSource = descendant.map(({ source: _s, ...p }) => p);
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: sansSource,
    });
    ok(dimensionnementCalculSchema, { methode: "descendant", parametres: sansSource });
    expect(
      dimensionnementCalculSchema.parse({ methode: "descendant", parametres: sansSource })
        .parametres[0]?.source,
    ).toBeNull();
    ko(dimensionnementCalculSchema, { methode: "descendant", parametres: ascendant });
  });

  it("source : preuve (uuid) ou avis d'expert motivé (10 caractères au moins)", () => {
    const avec = (source: unknown) => [{ ...descendant[0], source }, ...descendant.slice(1)];
    ok(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: avec({ type: "preuve", preuve_id: U1 }),
    });
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: avec({ type: "preuve", preuve_id: "x" }),
    });
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: avec({ type: "avis_expert", motif: "court" }),
    });
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: avec({ type: "avis_expert", motif: "x".repeat(501) }),
    });
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: avec({ type: "livre", motif: "xxxxxxxxxxxx" }),
    });
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: avec({ type: "preuve", preuve_id: U1, motif: "intrus" }),
    });
  });

  it("bornes : bas ≤ base ≤ haut, pourcentage ≤ 10 000, entiers sûrs", () => {
    const remplace = (p: ReturnType<typeof param>) => [p, ...descendant.slice(1)];
    const dim = (parametres: unknown) => ({ methode: "descendant", libelle: "x", parametres });
    ko(
      dimensionnementCreationSchema,
      dim(remplace(param("marche_total", 10, 5, 20))),
      "bas ≤ base",
    );
    ko(dimensionnementCreationSchema, dim(remplace(param("marche_total", 1, 5, 4))));
    ko(dimensionnementCreationSchema, dim(remplace(param("marche_total", 1.5, 5, 6))));
    ko(dimensionnementCreationSchema, dim(remplace(param("marche_total", -1, 5, 6))));
    ko(
      dimensionnementCreationSchema,
      dim(remplace(param("marche_total", 1, 5, Number.MAX_SAFE_INTEGER + 1))),
    );
    ok(
      dimensionnementCreationSchema,
      dim(remplace(param("marche_total", 0, 5, Number.MAX_SAFE_INTEGER))),
    );
    const pct = (haut: number) => [
      descendant[0],
      descendant[1],
      descendant[2],
      param("part_capturable", 0, 0, haut),
    ];
    ok(dimensionnementCreationSchema, dim(pct(10_000)));
    ko(dimensionnementCreationSchema, dim(pct(10_001)), "10 000 points de base");
    // Un nombre ou un montant n'est pas plafonné à 10 000.
    ok(dimensionnementCalculSchema, {
      methode: "ascendant",
      parametres: [
        param("clients_cibles", 0, 50_000, 100_000),
        ascendant[1],
        ascendant[2],
        ascendant[3],
      ],
    });
  });

  it("ajustements : 10 au plus, facteur 1 à 20 000, motif de 10 caractères", () => {
    const aj = (facteur_bp: number, motif = "Marché informel important.") => ({
      libelle: "Informel",
      facteur_bp,
      motif,
    });
    const dim = (ajustements: unknown) => ({
      methode: "descendant",
      libelle: "x",
      parametres: descendant,
      ajustements,
    });
    ok(dimensionnementCreationSchema, dim([aj(1), aj(20_000)]));
    ko(dimensionnementCreationSchema, dim([aj(0)]));
    ko(dimensionnementCreationSchema, dim([aj(20_001)]));
    ko(dimensionnementCreationSchema, dim([aj(9_000.5)]));
    ko(dimensionnementCreationSchema, dim([aj(9_000, "court")]));
    ok(dimensionnementCreationSchema, dim(Array.from({ length: 10 }, () => aj(9_000))));
    ko(dimensionnementCreationSchema, dim(Array.from({ length: 11 }, () => aj(9_000))));
    ok(dimensionnementCalculSchema, {
      methode: "descendant",
      parametres: descendant,
      ajustements: [aj(9_000)],
    });
  });

  it("version : sans méthode, codes d'une même méthode ; motif et version courante", () => {
    ok(dimensionnementVersionSchema, {
      libelle: "x",
      parametres: ascendant,
      version_courante: 1,
      motif: "Nouvelle donnée.",
    });
    ko(dimensionnementVersionSchema, { libelle: "x", parametres: ascendant });
    ko(dimensionnementVersionSchema, {
      libelle: "x",
      parametres: [descendant[0], ascendant[1], descendant[2], ascendant[3]],
      version_courante: 1,
      motif: "x",
    });
    ko(dimensionnementVersionSchema, {
      methode: "ascendant",
      libelle: "x",
      parametres: ascendant,
      version_courante: 1,
      motif: "x",
    });
  });

  it("aucun résultat de moteur n'est accepté d'un client", () => {
    ko(dimensionnementCreationSchema, {
      methode: "descendant",
      libelle: "x",
      parametres: descendant,
      resultat: { bas: 1, base: 2, haut: 3 },
    });
    ko(dimensionnementCalculSchema, {
      methode: "descendant",
      parametres: descendant,
      sensibilite: [],
    });
  });
});

describe("filtrage environnemental et social", () => {
  const regle = { code: "r1", libelle: "Jeux d'argent", mots_cles: ["casino"] };

  it("règle : au moins un critère", () => {
    expect(regleExclusionSchema.parse(regle)).toMatchObject({ secteur_codes: [], pays_codes: [] });
    ok(regleExclusionSchema, { code: "r2", libelle: "x", secteur_codes: ["citi_b"] });
    ok(regleExclusionSchema, { code: "r3", libelle: "x", pays_codes: ["ml"] });
    ko(regleExclusionSchema, { code: "r4", libelle: "x" }, "au moins un critère");
    ok(regleExclusionSchema, { ...regle, mots_cles: Array(10).fill("a") });
    ko(regleExclusionSchema, { ...regle, mots_cles: Array(11).fill("a") });
    ok(regleExclusionSchema, { ...regle, mots_cles: ["x".repeat(60)] });
    ko(regleExclusionSchema, { ...regle, mots_cles: ["x".repeat(61)] });
    ko(regleExclusionSchema, { ...regle, secteur_codes: Array(21).fill("a") });
    ko(regleExclusionSchema, { ...regle, intrus: 1 });
  });

  it("liste : 1 à 100 règles, codes distincts", () => {
    ok(listeExclusionCreationSchema, { nom: "Liste générale", regles: [regle] });
    expect(listeExclusionCreationSchema.parse({ nom: "x", regles: [regle] })).toMatchObject({
      client_id: null,
      reference_cadre: null,
    });
    ko(listeExclusionCreationSchema, { nom: "x", regles: [] });
    ko(
      listeExclusionCreationSchema,
      { nom: "x", regles: [regle, regle] },
      "Codes de règle en double",
    );
    ok(listeExclusionCreationSchema, {
      nom: "x",
      regles: Array.from({ length: 100 }, (_, i) => ({ ...regle, code: `r${i}` })),
    });
    ko(listeExclusionCreationSchema, {
      nom: "x",
      regles: Array.from({ length: 101 }, (_, i) => ({ ...regle, code: `r${i}` })),
    });
    ko(listeExclusionCreationSchema, {
      nom: "x",
      regles: [regle],
      reference_cadre: "x".repeat(301),
    });
    ok(listeExclusionCreationSchema, {
      nom: "x",
      regles: [regle],
      client_id: U1,
      reference_cadre: "Cadre public",
    });
    ok(listeExclusionVersionSchema, { regles: [regle], version_courante: 1, motif: "Ajout." });
    ko(listeExclusionVersionSchema, { regles: [regle], version_courante: 1 });
  });

  it("filtrage : déclarations bornées, thèmes distincts, justification dès « modéré »", () => {
    const base = { liste_id: U1, declarations: { activites: ["Exploitation d'un casino"] } };
    ok(filtrageCreationSchema, base);
    expect(filtrageCreationSchema.parse(base).themes).toEqual([]);
    ko(filtrageCreationSchema, { ...base, declarations: { activites: Array(31).fill("a") } });
    ko(filtrageCreationSchema, { ...base, declarations: { activites: ["x".repeat(301)] } });
    ko(filtrageCreationSchema, { ...base, declarations: { secteur_codes: Array(21).fill("a") } });
    const theme = (extra: object) => ({ code: "biodiversite", niveau: "faible", ...extra });
    ok(filtrageCreationSchema, { ...base, themes: [theme({})] });
    ok(filtrageCreationSchema, { ...base, themes: [theme({ niveau: "non_concerne" })] });
    ko(filtrageCreationSchema, { ...base, themes: [theme({ niveau: "modere" })] }, "se justifie");
    ko(filtrageCreationSchema, { ...base, themes: [theme({ niveau: "eleve" })] });
    ko(filtrageCreationSchema, { ...base, themes: [theme({ niveau: "critique" })] });
    ok(filtrageCreationSchema, {
      ...base,
      themes: [theme({ niveau: "critique", justification: "Forêt classée.", assertion_id: U2 })],
    });
    ko(filtrageCreationSchema, { ...base, themes: [theme({}), theme({})] }, "Thèmes en double");
    ko(filtrageCreationSchema, { ...base, themes: [theme({ code: "inconnu" })] });
    ko(filtrageCreationSchema, { ...base, themes: [theme({ niveau: "enorme" })] });
    ok(filtrageCreationSchema, {
      ...base,
      themes: THEMES_ES.map((code) => ({ code, niveau: "faible" })),
    });
  });

  it("décision sur une exclusion : motif de 10 caractères", () => {
    ok(filtrageDecisionSchema, {
      regle_code: "r1",
      decision: "ecartee",
      motif: "Faux positif : tabacologie.",
    });
    ko(filtrageDecisionSchema, { regle_code: "r1", decision: "ecartee", motif: "court" });
    ko(filtrageDecisionSchema, { regle_code: "r1", decision: "peut-etre", motif: "x".repeat(20) });
  });
});

describe("note au comité", () => {
  const note = {
    titre: "Note au comité d'investissement",
    recommandation: "favorable_sous_conditions",
    synthese: "Opération attractive sous réserve de levées.",
    conditions: ["Levée de l'exclusion R1"],
  };

  it("création : 20 conditions de 300 caractères au plus, synthèse de 4 000", () => {
    ok(noteCreationSchema, note);
    expect(noteCreationSchema.parse({ ...note, conditions: undefined }).conditions).toEqual([]);
    ok(noteCreationSchema, { ...note, conditions: Array(20).fill("Condition") });
    ko(noteCreationSchema, { ...note, conditions: Array(21).fill("Condition") });
    ko(noteCreationSchema, { ...note, conditions: ["x".repeat(301)] });
    ok(noteCreationSchema, { ...note, conditions: ["x".repeat(300)] });
    ok(noteCreationSchema, { ...note, synthese: "x".repeat(4000) });
    ko(noteCreationSchema, { ...note, synthese: "x".repeat(4001) });
    ko(noteCreationSchema, { ...note, recommandation: "tres_favorable" });
    ko(noteCreationSchema, { ...note, titre: "" });
    ko(noteCreationSchema, { ...note, base_figee: {} });
  });

  it("version, soumission, validation", () => {
    const contenu = {
      recommandation: note.recommandation,
      synthese: note.synthese,
      conditions: note.conditions,
    };
    ok(noteVersionSchema, { ...contenu, version_courante: 1, motif: "Relecture." });
    ko(noteVersionSchema, { ...contenu, version_courante: 1 });
    ok(noteSoumissionSchema, { version: 2 });
    ko(noteSoumissionSchema, { version: 0 });
    ko(noteSoumissionSchema, { version: 2, base_figee: {} });
    ok(noteValidationSchema, { version: 2, decision: "valide" });
    ok(noteValidationSchema, { version: 2, decision: "rejete", motif: "Hypothèse 3 à revoir." });
    ko(noteValidationSchema, { version: 2, decision: "rejete" }, "Un rejet se motive.");
    ko(noteValidationSchema, { decision: "valide" });
  });

  it("rapport : format, variante, version facultative", () => {
    ok(rapportNoteQuerySchema, { format: "docx", variante: "executive" });
    expect(
      rapportNoteQuerySchema.parse({ format: "pdf", variante: "detaillee", version: "3" }).version,
    ).toBe(3);
    ko(rapportNoteQuerySchema, { format: "xlsx", variante: "executive" });
    ko(rapportNoteQuerySchema, { format: "pdf" });
    ko(rapportNoteQuerySchema, { format: "pdf", variante: "courte" });
    ko(rapportNoteQuerySchema, { format: "pdf", variante: "executive", version: "0" });
  });
});

describe("plan des 100 jours", () => {
  const action = { libelle: "Nommer le directeur financier", jour_debut: 0, jour_fin: 30 };

  it("création : jours 0 à 100, début avant fin, statut par défaut", () => {
    expect(planActionCreationSchema.parse(action)).toMatchObject({
      statut_action: "a_faire",
      responsable_id: null,
      plan_element_id: null,
      kpi_id: null,
      description: null,
    });
    ok(planActionCreationSchema, { ...action, jour_debut: 100, jour_fin: 100 });
    ko(planActionCreationSchema, { ...action, jour_fin: 101 });
    ko(planActionCreationSchema, { ...action, jour_debut: -1 });
    ko(planActionCreationSchema, { ...action, jour_debut: 1.5 });
    ko(planActionCreationSchema, { ...action, jour_debut: 31 }, "ne précède pas");
    ok(planActionCreationSchema, {
      ...action,
      responsable_id: U1,
      plan_element_id: U2,
      kpi_id: U1,
      statut_action: "bloquee",
    });
    ko(planActionCreationSchema, { ...action, statut_action: "annulee" });
    ko(planActionCreationSchema, { ...action, kpi_id: "x" });
  });

  it("version : un champ au moins, jours cohérents quand les deux sont donnés", () => {
    ko(planActionVersionSchema, { version_courante: 1, motif: "x" });
    ok(planActionVersionSchema, { version_courante: 1, motif: "x", statut_action: "terminee" });
    ok(planActionVersionSchema, { version_courante: 1, motif: "x", jour_debut: 90 });
    ok(planActionVersionSchema, { version_courante: 1, motif: "x", jour_debut: 5, jour_fin: 5 });
    ko(planActionVersionSchema, { version_courante: 1, motif: "x", jour_debut: 6, jour_fin: 5 });
    ok(planActionVersionSchema, { version_courante: 1, motif: "x", kpi_id: null, retire: true });
    ko(planActionVersionSchema, { version_courante: 1, motif: "x", jour_fin: 101 });
  });
});

describe("noteBaseSchema", () => {
  const fourchette = { bas: 768_000_000, base: 2_000_000_000, haut: 4_320_000_000 };
  const base = {
    version_base: 1,
    genere_le: "2026-10-11",
    cadrage: {
      titre: "Étude du cacao",
      secteur_code: "cacao",
      secteur_libelle: "Cacao",
      filiere_code: null,
      filiere_libelle: null,
      pays_code: "ci",
      pays_libelle: "Côte d'Ivoire",
      cible_nom: null,
      type_operation: "entree_marche",
      devise: "XOF",
      date_operation: "2027-01-15",
      question_investissement: null,
      perimetre: null,
    },
    hypotheses: [
      {
        id: U1,
        parent_id: null,
        libelle: "Le marché est porteur",
        critere: null,
        verdict: "confirmee",
        indication_moteur: "confirmee",
        nb_citees: 2,
        solidite_min: "etayee",
      },
    ],
    risques: [
      {
        id: U2,
        famille: "pays",
        niveau: "eleve",
        libelle: "Instabilité",
        etape: null,
        lecture: "fragile",
      },
    ],
    marche: {
      present: true,
      dimensionnements: [
        {
          methode: "descendant",
          libelle: "Cacao",
          resultat: fourchette,
          avant_ajustement: fourchette,
          couverture: { total: 4, preuve: 2, avis_expert: 1, absente: ["part_capturable"] },
        },
      ],
      recoupement: { ecart_bp: 4_000, plus_eleve: "descendant", alerte: true, chevauchement: true },
    },
    filtrage_es: {
      realise: true,
      liste: { nom: "Liste générale", version: 2 },
      filtrages_anterieurs: 1,
      exclusions_anterieures_non_levees: 0,
      niveau_global: "modere",
      bloquant: false,
      touches: [{ regle: "r1", libelle: "Jeux d'argent", decision: "ecartee" }],
      themes: [{ code: "biodiversite", niveau: "modere", justification: "Zone tampon." }],
    },
    plan_100j: {
      present: true,
      total: 1,
      terminees: 0,
      par_phase: {
        jours_0_30: { total: 1, terminees: 0 },
        jours_31_60: { total: 0, terminees: 0 },
        jours_61_100: { total: 0, terminees: 0 },
      },
      actions: [
        {
          libelle: "Nommer le DAF",
          jour_debut: 0,
          jour_fin: 30,
          statut: "a_faire",
          date_debut: "2027-01-15",
          date_fin: "2027-02-14",
        },
      ],
    },
    ajustements: [
      {
        cible_type: "verdict",
        champ: "verdict",
        avant: "non_concluante",
        apres: "confirmee",
        motif: "Sources solides concordantes.",
        cree_le: "2026-10-11T10:00:00.000Z",
      },
    ],
    sources: { assertions: { solides: 1, etayees: 1, fragiles: 1 }, anomalies: 0 },
    detail: {
      analyses: [
        {
          analyse: "pestel",
          categorie: "politique",
          enonce: "Stabilité relative.",
          niveau: null,
          lecture: "etayee",
          renvois: [1],
        },
      ],
      chaine: [
        {
          ordre: 1,
          libelle: "Collecte",
          part_cout_bp: 3_000,
          part_marge_bp: null,
          rang_marge: null,
        },
      ],
      signaux: [
        { libelle: "Contrôle des changes", famille: "change", gravite: "eleve", etat: "constate" },
      ],
      sensibilite: [
        {
          methode: "descendant",
          code: "part_segment",
          resultat_bas: 1_500_000_000,
          resultat_haut: 2_500_000_000,
          amplitude: 1_000_000_000,
          part_amplitude_bp: 10_000,
        },
      ],
      sources: [
        {
          n: 1,
          type: "document",
          source: "Rapport sectoriel 2025",
          date: "2025-06-30",
          fiabilite: "B",
          extrait: null,
          masque: true,
        },
      ],
    },
    bloquants: [],
    avertissements: ["RISQUES_CRITIQUES_FRAGILES"],
    exclusions_bloquantes: 0,
  };

  it("une base conforme passe ; les paramètres du marché ont un défaut", () => {
    ok(noteBaseSchema, base);
    expect(noteBaseSchema.parse(base).marche.dimensionnements[0]?.parametres).toEqual([]);
  });

  it("rigueur : clé inconnue refusée à chaque niveau", () => {
    ko(noteBaseSchema, { ...base, intrus: 1 });
    ko(noteBaseSchema, { ...base, cadrage: { ...base.cadrage, intrus: 1 } });
    ko(noteBaseSchema, {
      ...base,
      hypotheses: [{ ...base.hypotheses[0], auteur: "Jeanne Dupont" }],
    });
    ko(noteBaseSchema, { ...base, detail: { ...base.detail, intrus: [] } });
    ko(noteBaseSchema, { ...base, sources: { ...base.sources, intrus: 1 } });
  });

  it("version, dates, vocabulaire et bornes", () => {
    ko(noteBaseSchema, { ...base, version_base: 2 });
    ko(noteBaseSchema, { ...base, genere_le: "2026-13-01" });
    ko(noteBaseSchema, { ...base, cadrage: { ...base.cadrage, devise: "GBP" } });
    ko(noteBaseSchema, { ...base, bloquants: ["INCONNU"] });
    ko(noteBaseSchema, { ...base, avertissements: ["INCONNU"] });
    ko(noteBaseSchema, { ...base, exclusions_bloquantes: -1 });
    ko(noteBaseSchema, {
      ...base,
      detail: {
        ...base.detail,
        sources: [{ ...base.detail.sources[0], fiabilite: "E" }],
      },
    });
    ko(noteBaseSchema, {
      ...base,
      marche: { ...base.marche, recoupement: { ...base.marche.recoupement, ecart_bp: 10_001 } },
    });
    ko(noteBaseSchema, {
      ...base,
      hypotheses: Array.from({ length: 101 }, () => base.hypotheses[0]),
    });
  });

  it("filtrage E&S : liste du dernier filtrage, compteurs des filtrages antérieurs", () => {
    const f = base.filtrage_es;
    ok(noteBaseSchema, { ...base, filtrage_es: { ...f, liste: null } });
    ok(noteBaseSchema, {
      ...base,
      filtrage_es: { ...f, filtrages_anterieurs: 49, exclusions_anterieures_non_levees: 3 },
    });
    ko(noteBaseSchema, { ...base, filtrage_es: { ...f, liste: { nom: "x" } } });
    ko(noteBaseSchema, { ...base, filtrage_es: { ...f, liste: { nom: "x", version: 0 } } });
    ko(noteBaseSchema, {
      ...base,
      filtrage_es: { ...f, liste: { nom: "x", version: 1, intrus: 1 } },
    });
    ko(noteBaseSchema, { ...base, filtrage_es: { ...f, filtrages_anterieurs: 51 } });
    ko(noteBaseSchema, { ...base, filtrage_es: { ...f, filtrages_anterieurs: -1 } });
    ko(noteBaseSchema, { ...base, filtrage_es: { ...f, exclusions_anterieures_non_levees: 1.5 } });
    ko(noteBaseSchema, { ...base, filtrage_es: { ...f, exclusions_anterieures_non_levees: -1 } });
    ko(noteBaseSchema, { ...base, filtrage_es: { ...f, liste: undefined } });
  });

  it("un bloquant peut figurer (la validation de la base ne le refuse pas ; c'est la base de données)", () => {
    ok(noteBaseSchema, { ...base, bloquants: ["SANS_HYPOTHESE"] });
  });
});

describe("modèles d'analyse par secteur (DD-07)", () => {
  const point = { categorie: "politique", libelle: "Quelle stabilité du cadre réglementaire ?" };
  const base = { secteur_code: "citi_a", analyse: "pestel", points: [point] };

  it("création : secteur, analyse et au moins un point de la bonne analyse", () => {
    ok(modeleSecteurCreationSchema, base);
    ko(modeleSecteurCreationSchema, { ...base, points: [] });
    ko(modeleSecteurCreationSchema, { ...base, analyse: "autre" });
    ko(modeleSecteurCreationSchema, { ...base, inconnu: 1 });
    ko(modeleSecteurCreationSchema, { ...base, points: [{ ...point, montant: 1 }] });
    ko(modeleSecteurCreationSchema, { ...base, points: [{ ...point, libelle: " " }] });
    ko(modeleSecteurCreationSchema, { ...base, points: [{ ...point, libelle: "x".repeat(301) }] });
    ko(
      modeleSecteurCreationSchema,
      { ...base, points: [{ categorie: "forces", libelle: "Hors PESTEL ?" }] },
      "Catégorie inconnue pour cette analyse.",
    );
  });

  it("plafond de points par modèle", () => {
    const n = PLAFONDS_DD.points_par_modele;
    const points = (k: number) =>
      Array.from({ length: k }, (_, i) => ({ ...point, libelle: `P${i}` }));
    ok(modeleSecteurCreationSchema, { ...base, points: points(n) });
    ko(modeleSecteurCreationSchema, { ...base, points: points(n + 1) });
  });

  it("version : motif obligatoire, actif vrai par défaut, requête filtrable", () => {
    expect(
      modeleSecteurVersionSchema.parse({
        points: [point],
        version_courante: 1,
        motif: "Mise à jour.",
      }),
    ).toMatchObject({ actif: true });
    ko(modeleSecteurVersionSchema, { points: [point], version_courante: 1 });
    ko(modeleSecteurVersionSchema, { points: [point], version_courante: 0, motif: "x" });
    expect(modelesSecteurQuerySchema.parse({ actif: "false", analyse: "swot" })).toMatchObject({
      actif: false,
      limite: 30,
    });
    ko(modelesSecteurQuerySchema, { analyse: "autre" });
  });
});

describe("libelleDimensionDd", () => {
  it("libelle les dimensions dd.* en français", () => {
    expect(libelleDimensionDd("dd.pestel.politique")).toBe("Analyse PESTEL — Politique");
    expect(libelleDimensionDd("dd.cinq_forces.rivalite")).toBe(
      "Cinq forces — Rivalité entre concurrents",
    );
    expect(libelleDimensionDd("dd.swot.opportunites")).toBe("Analyse SWOT — Opportunités");
    expect(libelleDimensionDd("dd.operationnelle.goulots")).toBe(
      "Analyse opérationnelle — Goulots d'étranglement",
    );
    expect(libelleDimensionDd("dd.risque.pays")).toBe("Risque — Pays");
    expect(libelleDimensionDd("dd.risque.change")).toBe("Risque — Change");
    expect(libelleDimensionDd("dd.risque.operationnel")).toBe("Risque — Opérationnel");
    expect(libelleDimensionDd("dd.risque.reglementaire")).toBe("Risque — Réglementaire");
  });

  it("couvre les 22 dimensions et rend null pour tout le reste", () => {
    for (const a of ANALYSES_DD)
      for (const c of CATEGORIES_ANALYSE_DD[a])
        expect(libelleDimensionDd(`dd.${a}.${c}`)).toMatch(/ — /);
    for (const code of [
      "finance",
      "dd.pestel",
      "dd.pestel.inconnu",
      "dd.inconnue.politique",
      "dd.risque.inconnu",
      "xx.pestel.politique",
      "dd.pestel.politique.x",
      "",
    ])
      expect(libelleDimensionDd(code)).toBeNull();
  });
});
