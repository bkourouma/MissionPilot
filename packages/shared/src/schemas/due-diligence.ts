import { z } from "zod";
import {
  dateIsoBorneeSchema,
  dateIsoSchema,
  deviseSchema,
  MESSAGE_CORPS_VIDE,
  texte,
} from "./commun";
import { codeReferentielSchema, FIABILITES_PREUVE } from "./fondations";

/*
 * Service #2 « Due diligence » (SPEC-3b, ADR-012) : contrat des routes `/api/missions/:id/dd/**`
 * et `/api/dd/**`. Le même schéma sert l'API et le web ; tous les objets sont `.strict()`.
 *
 * Aucun schéma de requête ne porte une indication de verdict, une solidité, un montant calculé, un
 * résultat de moteur ni un identifiant d'auteur : ils sortent du serveur (moteurs de
 * `packages/engines/src/due-diligence`, registre des preuves). Les vocabulaires fermés ci-dessous
 * sont les MÊMES que ceux du paquet des moteurs (qui n'importe pas celui-ci) ; le test
 * `apps/api/test/dd-vocabulaire.test.ts` vérifie l'égalité.
 */

const uuid = z.string().uuid();
const entier = (min: number, max: number) => z.number().int().min(min).max(max);

// ---------------------------------------------------------------------------
// Plafonds (provisoires, SPEC-3b §3.3)
// ---------------------------------------------------------------------------

/** 409 `PLAFOND_ATTEINT` au-delà ; seuls les plafonds de version sont doublés par `CHECK` en base. */
export const PLAFONDS_DD = {
  dossiers_par_mission: 10,
  points_par_dossier: 300,
  etapes_par_dossier: 30,
  risques_par_dossier: 200,
  hypotheses_par_dossier: 100,
  actions_par_dossier: 200,
  /** Versions par élément, cadrage, signal, dimensionnement, liste ou note. */
  versions_par_objet: 200,
  dimensionnements_par_dossier: 20,
  filtrages_par_dossier: 50,
  notes_par_dossier: 10,
  verdicts_par_hypothese: 50,
  constats_par_dossier: 2_000,
  /** Événements (lier, délier) du journal des liens d'une hypothèse, tous liens confondus. */
  evenements_liens_par_hypothese: 200,
  /** Décisions (confirmer, écarter) du journal d'un filtrage, toutes règles confondues. */
  decisions_par_filtrage: 200,
  ajustements_par_dossier: 1_000,
  signaux_par_cabinet: 2_000,
  listes_exclusion_par_cabinet: 50,
  regles_par_liste: 100,
  /** Mots (après normalisation) d'un mot-clé d'exclusion : borne le coût de la correspondance. */
  mots_par_mot_cle: 5,
  /** Mots (après normalisation) d'une activité déclarée dans un filtrage. */
  mots_par_activite: 60,
  /** Octets du jsonb `base_figee` d'une note (409 `NOTE_TROP_VOLUMINEUSE`). */
  base_figee_octets: 1_000_000,
  /** Assertions par mission : déjà `ASSERTIONS_MISSION_MAX`, partagé avec le registre des preuves. */
  assertions_par_mission: 2_000,
  profondeur_hypotheses: 4,
} as const;

// ---------------------------------------------------------------------------
// Vocabulaires fermés et libellés français (jamais un identifiant affiché à l'écran)
// ---------------------------------------------------------------------------

export const TYPES_OPERATION_DD = ["acquisition", "entree_marche", "partenariat"] as const;
export type TypeOperationDd = (typeof TYPES_OPERATION_DD)[number];
export const typeOperationDdSchema = z.enum(TYPES_OPERATION_DD);
export const TYPE_OPERATION_DD_LIBELLES: Record<TypeOperationDd, string> = {
  acquisition: "Acquisition",
  entree_marche: "Entrée sur un marché",
  partenariat: "Partenariat",
};

export const ANALYSES_DD = ["pestel", "cinq_forces", "swot", "operationnelle"] as const;
export type AnalyseDd = (typeof ANALYSES_DD)[number];
export const analyseDdSchema = z.enum(ANALYSES_DD);
export const ANALYSE_DD_LIBELLES: Record<AnalyseDd, string> = {
  pestel: "PESTEL",
  cinq_forces: "Cinq forces de Porter",
  swot: "Forces, faiblesses, opportunités, menaces",
  operationnelle: "Analyse opérationnelle",
};

export const CATEGORIES_ANALYSE_DD = {
  pestel: ["politique", "economique", "social", "technologique", "environnemental", "juridique"],
  cinq_forces: [
    "rivalite",
    "nouveaux_entrants",
    "substituts",
    "pouvoir_clients",
    "pouvoir_fournisseurs",
  ],
  swot: ["forces", "faiblesses", "opportunites", "menaces"],
  operationnelle: ["processus", "approvisionnement", "goulots"],
} as const satisfies Record<AnalyseDd, readonly string[]>;
export type CategorieAnalyseDd = (typeof CATEGORIES_ANALYSE_DD)[AnalyseDd][number];
export const CATEGORIE_ANALYSE_DD_LIBELLES: Record<CategorieAnalyseDd, string> = {
  politique: "Politique",
  economique: "Économique",
  social: "Social",
  technologique: "Technologique",
  environnemental: "Environnemental",
  juridique: "Juridique",
  rivalite: "Rivalité entre concurrents",
  nouveaux_entrants: "Menace des nouveaux entrants",
  substituts: "Menace des substituts",
  pouvoir_clients: "Pouvoir de négociation des clients",
  pouvoir_fournisseurs: "Pouvoir de négociation des fournisseurs",
  forces: "Forces",
  faiblesses: "Faiblesses",
  opportunites: "Opportunités",
  menaces: "Menaces",
  processus: "Processus",
  approvisionnement: "Approvisionnement",
  goulots: "Goulots d'étranglement",
};
export function estCategorieAnalyseDd(analyse: AnalyseDd, categorie: string): boolean {
  return (CATEGORIES_ANALYSE_DD[analyse] as readonly string[]).includes(categorie);
}

export const FAMILLES_RISQUE_DD = ["pays", "change", "operationnel", "reglementaire"] as const;
export type FamilleRisqueDd = (typeof FAMILLES_RISQUE_DD)[number];
export const familleRisqueDdSchema = z.enum(FAMILLES_RISQUE_DD);
export const FAMILLE_RISQUE_DD_LIBELLES: Record<FamilleRisqueDd, string> = {
  pays: "Risque pays",
  change: "Risque de change",
  operationnel: "Risque opérationnel",
  reglementaire: "Risque réglementaire",
};

/** Du moins grave au plus grave. */
export const NIVEAUX_RISQUE_DD = ["faible", "modere", "eleve", "critique"] as const;
export type NiveauRisqueDd = (typeof NIVEAUX_RISQUE_DD)[number];
export const niveauRisqueDdSchema = z.enum(NIVEAUX_RISQUE_DD);
export const NIVEAU_RISQUE_DD_LIBELLES: Record<NiveauRisqueDd, string> = {
  faible: "Faible",
  modere: "Modéré",
  eleve: "Élevé",
  critique: "Critique",
};

export const VERDICTS_DD = ["confirmee", "infirmee", "non_concluante"] as const;
export type VerdictDd = (typeof VERDICTS_DD)[number];
export const verdictDdSchema = z.enum(VERDICTS_DD);
export const VERDICT_DD_LIBELLES: Record<VerdictDd, string> = {
  confirmee: "Confirmée",
  infirmee: "Infirmée",
  non_concluante: "Non concluante",
};

export const SENS_LIEN_DD = ["soutient", "contredit"] as const;
export type SensLienDd = (typeof SENS_LIEN_DD)[number];
export const sensLienDdSchema = z.enum(SENS_LIEN_DD);
export const SENS_LIEN_DD_LIBELLES: Record<SensLienDd, string> = {
  soutient: "Soutient l'hypothèse",
  contredit: "Contredit l'hypothèse",
};

export const METHODES_DIMENSIONNEMENT = ["descendant", "ascendant"] as const;
export type MethodeDimensionnement = (typeof METHODES_DIMENSIONNEMENT)[number];
export const methodeDimensionnementSchema = z.enum(METHODES_DIMENSIONNEMENT);
export const METHODE_DIMENSIONNEMENT_LIBELLES: Record<MethodeDimensionnement, string> = {
  descendant: "Descendante (du marché total au marché capturable)",
  ascendant: "Ascendante (des clients au chiffre d'affaires)",
};

export const RECOMMANDATIONS_NOTE = [
  "favorable",
  "favorable_sous_conditions",
  "reservee",
  "defavorable",
] as const;
export type RecommandationNote = (typeof RECOMMANDATIONS_NOTE)[number];
export const recommandationNoteSchema = z.enum(RECOMMANDATIONS_NOTE);
export const RECOMMANDATION_NOTE_LIBELLES: Record<RecommandationNote, string> = {
  favorable: "Favorable",
  favorable_sous_conditions: "Favorable sous conditions",
  reservee: "Réservée",
  defavorable: "Défavorable",
};

export const VARIANTES_NOTE = ["executive", "detaillee"] as const;
export type VarianteNote = (typeof VARIANTES_NOTE)[number];
export const varianteNoteSchema = z.enum(VARIANTES_NOTE);
export const VARIANTE_NOTE_LIBELLES: Record<VarianteNote, string> = {
  executive: "Exécutive",
  detaillee: "Détaillée",
};

export const STATUTS_ACTION_100J = ["a_faire", "en_cours", "terminee", "bloquee"] as const;
export type StatutAction100j = (typeof STATUTS_ACTION_100J)[number];
export const statutAction100jSchema = z.enum(STATUTS_ACTION_100J);
export const STATUT_ACTION_100J_LIBELLES: Record<StatutAction100j, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  terminee: "Terminée",
  bloquee: "Bloquée",
};

export const ETATS_CONSTAT_SIGNAL = ["constate", "ecarte", "a_verifier"] as const;
export type EtatConstatSignal = (typeof ETATS_CONSTAT_SIGNAL)[number];
export const etatConstatSignalSchema = z.enum(ETATS_CONSTAT_SIGNAL);
export const ETAT_CONSTAT_SIGNAL_LIBELLES: Record<EtatConstatSignal, string> = {
  constate: "Constaté",
  ecarte: "Écarté",
  a_verifier: "À vérifier",
};

export const DECISIONS_EXCLUSION = ["confirmee", "ecartee"] as const;
export type DecisionExclusion = (typeof DECISIONS_EXCLUSION)[number];
export const decisionExclusionSchema = z.enum(DECISIONS_EXCLUSION);
export const DECISION_EXCLUSION_LIBELLES: Record<DecisionExclusion, string> = {
  confirmee: "Exclusion confirmée",
  ecartee: "Exclusion écartée (faux positif)",
};

/** Décision d'un tiers sur un verdict ou une note. */
export const DECISIONS_VALIDATION_DD = ["valide", "rejete"] as const;
export type DecisionValidationDd = (typeof DECISIONS_VALIDATION_DD)[number];
export const decisionValidationDdSchema = z.enum(DECISIONS_VALIDATION_DD);

/** Du moins grave au plus grave ; `non_concerne` = 0. */
export const NIVEAUX_ES = ["non_concerne", "faible", "modere", "eleve", "critique"] as const;
export type NiveauEs = (typeof NIVEAUX_ES)[number];
export const niveauEsSchema = z.enum(NIVEAUX_ES);
export const NIVEAU_ES_LIBELLES: Record<NiveauEs, string> = {
  non_concerne: "Non concerné",
  faible: "Faible",
  modere: "Modéré",
  eleve: "Élevé",
  critique: "Critique",
};

/**
 * Huit thèmes de revue environnementale et sociale : libellés courts propres à MissionPilot,
 * PROVISOIRES, à valider par un expert E&S. Cadre public cité en référence seulement
 * (« Normes de performance de la SFI, n° 1 à 8 ») : aucun texte du cadre n'est reproduit.
 */
export const THEMES_ES = [
  "evaluation_gestion",
  "main_oeuvre",
  "ressources_pollution",
  "sante_securite_communautes",
  "terres_reinstallation",
  "biodiversite",
  "peuples_autochtones",
  "patrimoine_culturel",
] as const;
export type ThemeEs = (typeof THEMES_ES)[number];
export const themeEsSchema = z.enum(THEMES_ES);
export const THEME_ES_LIBELLES: Record<ThemeEs, string> = {
  evaluation_gestion: "Gestion des risques E&S",
  main_oeuvre: "Main-d'œuvre",
  ressources_pollution: "Ressources et pollution",
  sante_securite_communautes: "Santé et sécurité des communautés",
  terres_reinstallation: "Terres et réinstallation",
  biodiversite: "Biodiversité",
  peuples_autochtones: "Peuples autochtones",
  patrimoine_culturel: "Patrimoine culturel",
};

/** Paramètres de dimensionnement par méthode, dans l'ordre d'affichage. */
export type UniteParametreDimensionnement = "nombre" | "pourcentage_bp" | "montant";
export const PARAMETRES_DIMENSIONNEMENT = {
  descendant: [
    { code: "marche_total", unite: "montant" },
    { code: "part_segment", unite: "pourcentage_bp" },
    { code: "part_adressable", unite: "pourcentage_bp" },
    { code: "part_capturable", unite: "pourcentage_bp" },
  ],
  ascendant: [
    { code: "clients_cibles", unite: "nombre" },
    { code: "taux_conquete", unite: "pourcentage_bp" },
    { code: "volume_par_client", unite: "nombre" },
    { code: "prix_unitaire", unite: "montant" },
  ],
} as const satisfies Record<
  MethodeDimensionnement,
  readonly { code: string; unite: UniteParametreDimensionnement }[]
>;
export const CODES_PARAMETRE_DIMENSIONNEMENT = [
  "marche_total",
  "part_segment",
  "part_adressable",
  "part_capturable",
  "clients_cibles",
  "taux_conquete",
  "volume_par_client",
  "prix_unitaire",
] as const;
export type CodeParametreDimensionnement = (typeof CODES_PARAMETRE_DIMENSIONNEMENT)[number];
export const PARAMETRE_DIMENSIONNEMENT_LIBELLES: Record<CodeParametreDimensionnement, string> = {
  marche_total: "Marché total",
  part_segment: "Part du segment visé",
  part_adressable: "Part adressable",
  part_capturable: "Part capturable",
  clients_cibles: "Clients cibles",
  taux_conquete: "Taux de conquête",
  volume_par_client: "Volume par client",
  prix_unitaire: "Prix unitaire",
};
const PLEIN_BP = 10_000;
const FACTEUR_AJUSTEMENT_MAX_BP = 20_000;
const AJUSTEMENTS_MAX = 10;

const uniteDuParametre = (code: string): UniteParametreDimensionnement | undefined =>
  [...PARAMETRES_DIMENSIONNEMENT.descendant, ...PARAMETRES_DIMENSIONNEMENT.ascendant].find(
    (p) => p.code === code,
  )?.unite;

/** Codes de blocage et d'avertissement de la note (miroir de `controlerNoteComite`). */
export const CODES_BLOQUANTS_NOTE = [
  "SANS_HYPOTHESE",
  "HYPOTHESE_SANS_VERDICT_VALIDE",
  "SOURCES_MANQUANTES",
  "EXCLUSION_NON_LEVEE_FAVORABLE",
  "HYPOTHESE_INFIRMEE_FAVORABLE",
  "CONDITIONS_MANQUANTES",
] as const;
export type CodeBloquantNote = (typeof CODES_BLOQUANTS_NOTE)[number];
export const CODE_BLOQUANT_NOTE_LIBELLES: Record<CodeBloquantNote, string> = {
  SANS_HYPOTHESE: "Aucune hypothèse n'est posée.",
  HYPOTHESE_SANS_VERDICT_VALIDE: "Une hypothèse n'a pas de verdict validé.",
  SOURCES_MANQUANTES: "Des affirmations importantes n'ont aucune source.",
  EXCLUSION_NON_LEVEE_FAVORABLE:
    "Une exclusion n'est pas levée : la recommandation ne peut pas être favorable.",
  HYPOTHESE_INFIRMEE_FAVORABLE:
    "Une hypothèse principale est infirmée : la recommandation ne peut pas être favorable.",
  CONDITIONS_MANQUANTES: "Une recommandation sous conditions exige au moins une condition.",
};
export const CODES_AVERTISSEMENTS_NOTE = [
  "RISQUES_CRITIQUES_FRAGILES",
  "AUCUN_DIMENSIONNEMENT",
  "RECOUPEMENT_MARCHE_DIVERGENT",
  "ARBRE_INCOHERENT",
] as const;
export type CodeAvertissementNote = (typeof CODES_AVERTISSEMENTS_NOTE)[number];
export const CODE_AVERTISSEMENT_NOTE_LIBELLES: Record<CodeAvertissementNote, string> = {
  RISQUES_CRITIQUES_FRAGILES: "Des risques élevés ou critiques sont mal étayés.",
  AUCUN_DIMENSIONNEMENT: "Aucun dimensionnement de marché n'est renseigné.",
  RECOUPEMENT_MARCHE_DIVERGENT: "Les deux méthodes de dimensionnement divergent fortement.",
  ARBRE_INCOHERENT: "L'arbre d'hypothèses contient des verdicts incohérents.",
};

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------

const limite = z.coerce.number().int().min(1).max(100).default(30);
const curseur = z.string().max(500).optional();
const versionCourante = entier(1, PLAFONDS_DD.versions_par_objet);

const nullableDefaut = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().default(null);

/** Au moins un champ modifiable renseigné (hors `version_courante` et `motif`). */
function aChampAModifier(v: Record<string, unknown>): boolean {
  return Object.entries(v).some(
    ([cle, valeur]) => cle !== "version_courante" && cle !== "motif" && valeur !== undefined,
  );
}
const exigerChampAModifier = (v: Record<string, unknown>, ctx: z.RefinementCtx): void => {
  if (!aChampAModifier(v)) ctx.addIssue({ code: "custom", message: MESSAGE_CORPS_VIDE });
};

/**
 * Affirmation = assertion du registre des preuves (SPEC-3b §2.1). Classe de risque R2 ou R3
 * seulement : R0 et R1 échapperaient au contrôle PRV-03 (assertions sans preuve).
 */
const classeRisqueDdSchema = z.enum(["R2", "R3"]);
const affirmationShape = {
  enonce: texte(2000),
  classe_risque: classeRisqueDdSchema,
  avis_expert: z.boolean().default(false),
  avis_expert_motif: nullableDefaut(texte(1000)),
  signer_avis: z.boolean().default(false),
};
const affirmationFacultativeShape = {
  enonce: texte(2000).optional(),
  classe_risque: classeRisqueDdSchema.optional(),
  avis_expert: z.boolean().optional(),
  avis_expert_motif: texte(1000).nullable().optional(),
  signer_avis: z.boolean().optional(),
};

/** Même contrôle croisé que `assertionCreationSchema` : avis d'expert ⇒ motif ; signer ⇒ avis. */
function controlerAffirmation(
  v: { avis_expert?: boolean; avis_expert_motif?: string | null; signer_avis?: boolean },
  ctx: z.RefinementCtx,
): void {
  if (v.avis_expert === true && v.avis_expert_motif == null) {
    ctx.addIssue({
      code: "custom",
      path: ["avis_expert_motif"],
      message: "Un avis d'expert se justifie.",
    });
  }
  if (v.avis_expert !== true && (v.avis_expert_motif != null || v.signer_avis === true)) {
    ctx.addIssue({
      code: "custom",
      path: ["avis_expert"],
      message: "Le motif et la signature supposent un avis d'expert.",
    });
  }
}

export const affirmationDdSchema = z
  .object(affirmationShape)
  .strict()
  .superRefine(controlerAffirmation);

// ---------------------------------------------------------------------------
// Cadrage (DD-01)
// ---------------------------------------------------------------------------

const cadrageShape = {
  titre: texte(200),
  secteur_code: codeReferentielSchema,
  filiere_code: nullableDefaut(codeReferentielSchema),
  pays_code: codeReferentielSchema,
  cible_nom: nullableDefaut(texte(200)),
  type_operation: typeOperationDdSchema,
  devise: deviseSchema,
  date_operation: nullableDefaut(dateIsoBorneeSchema),
  question_investissement: nullableDefaut(texte(2000)),
  perimetre: nullableDefaut(texte(4000)),
};

function controlerCadrage(
  v: { type_operation: string; cible_nom: string | null },
  ctx: z.RefinementCtx,
): void {
  if (v.type_operation === "acquisition" && v.cible_nom === null) {
    ctx.addIssue({
      code: "custom",
      path: ["cible_nom"],
      message: "Une acquisition désigne sa cible.",
    });
  }
}

/** Création d'un dossier (= cadrage de la version 1). */
export const cadrageSchema = z.object(cadrageShape).strict().superRefine(controlerCadrage);
export const cadrageVersionSchema = z
  .object({ ...cadrageShape, version_courante: versionCourante, motif: texte(500) })
  .strict()
  .superRefine(controlerCadrage);

// ---------------------------------------------------------------------------
// Analyses : points PESTEL, cinq forces, SWOT, opérationnelle (DD-03, DD-05)
// ---------------------------------------------------------------------------

export const pointCreationSchema = z
  .object({
    analyse: analyseDdSchema,
    categorie: z.string().min(1).max(60),
    libelle: nullableDefaut(texte(200)),
    niveau: nullableDefaut(niveauRisqueDdSchema),
    ...affirmationShape,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!estCategorieAnalyseDd(v.analyse, v.categorie)) {
      ctx.addIssue({
        code: "custom",
        path: ["categorie"],
        message: "Catégorie inconnue pour cette analyse.",
      });
    }
    controlerAffirmation(v, ctx);
  });

export const pointVersionSchema = z
  .object({
    version_courante: versionCourante,
    motif: texte(500),
    categorie: z.string().min(1).max(60).optional(),
    libelle: texte(200).nullable().optional(),
    niveau: niveauRisqueDdSchema.nullable().optional(),
    retire: z.boolean().optional(),
    ...affirmationFacultativeShape,
  })
  .strict()
  .superRefine((v, ctx) => {
    exigerChampAModifier(v, ctx);
    controlerAffirmation(v, ctx);
  });

// ---------------------------------------------------------------------------
// Chaîne de valeur (DD-04)
// ---------------------------------------------------------------------------

const acteursSchema = z.array(texte(120)).max(12);

export const etapeChaineCreationSchema = z
  .object({
    libelle: texte(200),
    description: nullableDefaut(texte(4000)),
    ordre: entier(1, 200),
    part_cout_bp: nullableDefaut(entier(0, PLEIN_BP)),
    part_marge_bp: nullableDefaut(entier(0, PLEIN_BP)),
    acteurs: acteursSchema.default([]),
    contraintes: nullableDefaut(texte(2000)),
  })
  .strict();

export const etapeChaineVersionSchema = z
  .object({
    version_courante: versionCourante,
    motif: texte(500),
    libelle: texte(200).optional(),
    description: texte(4000).nullable().optional(),
    ordre: entier(1, 200).optional(),
    part_cout_bp: entier(0, PLEIN_BP).nullable().optional(),
    part_marge_bp: entier(0, PLEIN_BP).nullable().optional(),
    acteurs: acteursSchema.optional(),
    contraintes: texte(2000).nullable().optional(),
    retire: z.boolean().optional(),
  })
  .strict()
  .superRefine(exigerChampAModifier);

// ---------------------------------------------------------------------------
// Risques (DD-06)
// ---------------------------------------------------------------------------

export const risqueCreationSchema = z
  .object({
    famille: familleRisqueDdSchema,
    niveau: niveauRisqueDdSchema,
    libelle: texte(200),
    etape_id: nullableDefaut(uuid),
    signal_id: nullableDefaut(uuid),
    /** Exigé par l'API si `niveau` diffère de la gravité indicative du signal d'origine. */
    motif_ecart: texte(1000).optional(),
    ...affirmationShape,
  })
  .strict()
  .superRefine(controlerAffirmation);

export const risqueVersionSchema = z
  .object({
    version_courante: versionCourante,
    motif: texte(500),
    famille: familleRisqueDdSchema.optional(),
    niveau: niveauRisqueDdSchema.optional(),
    libelle: texte(200).optional(),
    etape_id: uuid.nullable().optional(),
    signal_id: uuid.nullable().optional(),
    retire: z.boolean().optional(),
    motif_ecart: texte(1000).optional(),
    ...affirmationFacultativeShape,
  })
  .strict()
  .superRefine((v, ctx) => {
    exigerChampAModifier(v, ctx);
    controlerAffirmation(v, ctx);
  });

// ---------------------------------------------------------------------------
// Hypothèses, liens, verdicts (DD-09)
// ---------------------------------------------------------------------------

export const hypotheseCreationSchema = z
  .object({
    libelle: texte(200),
    description: nullableDefaut(texte(4000)),
    critere: nullableDefaut(texte(2000)),
    parent_id: nullableDefaut(uuid),
  })
  .strict();

export const hypotheseVersionSchema = z
  .object({
    version_courante: versionCourante,
    motif: texte(500),
    libelle: texte(200).optional(),
    description: texte(4000).nullable().optional(),
    critere: texte(2000).nullable().optional(),
    retire: z.boolean().optional(),
  })
  .strict()
  .superRefine(exigerChampAModifier);

export const hypotheseLienSchema = z
  .object({
    assertion_id: uuid,
    action: z.enum(["lier", "delier"]),
    sens: nullableDefaut(sensLienDdSchema),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === "lier") !== (v.sens !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["sens"],
        message: "Le sens est exigé pour lier une assertion, et seulement dans ce cas.",
      });
    }
  });

/** Crée l'assertion rattachée à l'hypothèse puis le lien. */
export const hypotheseAssertionSchema = z
  .object({ sens: sensLienDdSchema, ...affirmationShape })
  .strict()
  .superRefine(controlerAffirmation);

export const verdictProposeSchema = z
  .object({
    hypothese_version: versionCourante,
    verdict: verdictDdSchema,
    motif: texte(2000),
    assertions_citees: z
      .array(uuid)
      .max(50)
      .default([])
      .refine((v) => new Set(v).size === v.length, "Assertions en double."),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.verdict !== "non_concluante" && v.assertions_citees.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["assertions_citees"],
        message: "Un verdict confirmé ou infirmé cite au moins une assertion.",
      });
    }
  });

function exigerMotifSiRejet(
  v: { decision: string; motif?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (v.decision === "rejete" && v.motif == null) {
    ctx.addIssue({ code: "custom", path: ["motif"], message: "Un rejet se motive." });
  }
}

export const verdictValidationSchema = z
  .object({ decision: decisionValidationDdSchema, motif: texte(1000).optional() })
  .strict()
  .superRefine(exigerMotifSiRejet);

// ---------------------------------------------------------------------------
// Bibliothèque de signaux (DD-11)
// ---------------------------------------------------------------------------

const signalContenuShape = {
  libelle: texte(200),
  description: nullableDefaut(texte(2000)),
  famille: familleRisqueDdSchema,
  secteur_code: nullableDefaut(codeReferentielSchema),
  pays_code: nullableDefaut(codeReferentielSchema),
  gravite_indicative: niveauRisqueDdSchema,
  question: nullableDefaut(texte(1000)),
  /** Nom d'un document public, jamais un extrait. */
  reference_publique: nullableDefaut(texte(500)),
  actif: z.boolean().default(true),
};
export const signalContenuSchema = z.object(signalContenuShape).strict();
export const signalCreationSchema = z
  .object({ code: codeReferentielSchema, ...signalContenuShape })
  .strict();
export const signalVersionSchema = z
  .object({ ...signalContenuShape, version_courante: versionCourante, motif: texte(500) })
  .strict();

/** Booléen de requête : « true », « false », « 1 », « 0 » (`z.coerce.boolean` lirait « false » vrai). */
const booleenRequete = z.preprocess((v) => {
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return v;
}, z.boolean());

export const signauxQuerySchema = z
  .object({
    famille: familleRisqueDdSchema.optional(),
    secteur_code: codeReferentielSchema.optional(),
    pays_code: codeReferentielSchema.optional(),
    actif: booleenRequete.optional(),
    q: z.string().trim().max(100).optional(),
    limite,
    curseur,
  })
  .strict();

export const signalConstatSchema = z
  .object({
    etat: etatConstatSignalSchema,
    commentaire: nullableDefaut(texte(1000)),
    risque_id: nullableDefaut(uuid),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.etat === "ecarte" && v.commentaire === null) {
      ctx.addIssue({
        code: "custom",
        path: ["commentaire"],
        message: "Un signal écarté se justifie.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Dimensionnement de marché (DD-12)
// ---------------------------------------------------------------------------

const sourceParametreSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("preuve"), preuve_id: uuid }).strict(),
  z
    .object({
      type: z.literal("avis_expert"),
      motif: z.string().trim().min(10).max(500),
    })
    .strict(),
]);
export type SourceParametreDd = z.infer<typeof sourceParametreSchema>;

const parametreShape = {
  code: z.enum(CODES_PARAMETRE_DIMENSIONNEMENT),
  bas: entier(0, Number.MAX_SAFE_INTEGER),
  base: entier(0, Number.MAX_SAFE_INTEGER),
  haut: entier(0, Number.MAX_SAFE_INTEGER),
};

function controlerParametre(
  v: { code: string; bas: number; base: number; haut: number },
  ctx: z.RefinementCtx,
): void {
  if (v.bas > v.base || v.base > v.haut) {
    ctx.addIssue({ code: "custom", message: "Les bornes se suivent : bas ≤ base ≤ haut." });
  }
  if (uniteDuParametre(v.code) === "pourcentage_bp" && v.haut > PLEIN_BP) {
    ctx.addIssue({
      code: "custom",
      path: ["haut"],
      message: "Un pourcentage ne dépasse pas 10 000 points de base.",
    });
  }
}

/** Paramètre enregistré : la source est OBLIGATOIRE (preuve de la mission ou avis d'expert motivé). */
export const parametreDimensionnementSchema = z
  .object({ ...parametreShape, source: sourceParametreSchema })
  .strict()
  .superRefine(controlerParametre);
/** Paramètre d'un calcul à blanc : la source est facultative (signalée en sortie du moteur). */
export const parametreCalculSchema = z
  .object({ ...parametreShape, source: sourceParametreSchema.nullable().default(null) })
  .strict()
  .superRefine(controlerParametre);

export const ajustementDimensionnementSchema = z
  .object({
    libelle: texte(120),
    facteur_bp: entier(1, FACTEUR_AJUSTEMENT_MAX_BP),
    motif: z.string().trim().min(10).max(1000),
  })
  .strict();
const ajustementsSchema = z.array(ajustementDimensionnementSchema).max(AJUSTEMENTS_MAX).default([]);

function codesDeLaMethode(methode: MethodeDimensionnement): readonly string[] {
  return PARAMETRES_DIMENSIONNEMENT[methode].map((p) => p.code);
}
function memesCodes(codes: readonly string[], attendus: readonly string[]): boolean {
  return codes.length === attendus.length && attendus.every((c) => codes.includes(c));
}

export const dimensionnementCalculSchema = z
  .object({
    methode: methodeDimensionnementSchema,
    parametres: z.array(parametreCalculSchema).length(4),
    ajustements: ajustementsSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !memesCodes(
        v.parametres.map((p) => p.code),
        codesDeLaMethode(v.methode),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["parametres"],
        message: "Les quatre paramètres de la méthode sont attendus, chacun une fois.",
      });
    }
  });

export const dimensionnementCreationSchema = z
  .object({
    methode: methodeDimensionnementSchema,
    libelle: texte(200),
    parametres: z.array(parametreDimensionnementSchema).length(4),
    ajustements: ajustementsSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !memesCodes(
        v.parametres.map((p) => p.code),
        codesDeLaMethode(v.methode),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["parametres"],
        message: "Les quatre paramètres de la méthode sont attendus, chacun une fois.",
      });
    }
  });

/** La méthode est celle du dimensionnement (l'API vérifie les codes contre elle). */
export const dimensionnementVersionSchema = z
  .object({
    libelle: texte(200),
    parametres: z.array(parametreDimensionnementSchema).length(4),
    ajustements: ajustementsSchema,
    version_courante: versionCourante,
    motif: texte(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    const codes = v.parametres.map((p) => p.code);
    if (!METHODES_DIMENSIONNEMENT.some((m) => memesCodes(codes, codesDeLaMethode(m)))) {
      ctx.addIssue({
        code: "custom",
        path: ["parametres"],
        message: "Les quatre paramètres d'une même méthode sont attendus, chacun une fois.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Filtrage environnemental et social (DD-14)
// ---------------------------------------------------------------------------

/**
 * Mots d'un texte comme le moteur de filtrage les lit (`normaliserTexteDd`) : NFD sans accents,
 * minuscules, tout non alphanumérique → séparateur. Le test `dd-vocabulaire` vérifie l'égalité.
 */
export function motsDeFiltrage(texteLibre: string): string[] {
  const n = texteLibre
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return n === "" ? [] : n.split(" ");
}

/** Mot-clé d'exclusion : au moins une lettre ou un chiffre (sinon le moteur le refuse), 5 mots au plus. */
const motCleExclusionSchema = texte(60).superRefine((v, ctx) => {
  const n = motsDeFiltrage(v).length;
  if (n === 0) {
    ctx.addIssue({
      code: "custom",
      message: "Un mot-clé contient au moins une lettre ou un chiffre.",
    });
  } else if (n > PLAFONDS_DD.mots_par_mot_cle) {
    ctx.addIssue({
      code: "custom",
      message: `Un mot-clé compte ${PLAFONDS_DD.mots_par_mot_cle} mots au plus.`,
    });
  }
});

/** Activité déclarée : 60 mots au plus (la correspondance est quadratique en mots). */
const activiteDeclareeSchema = texte(300).superRefine((v, ctx) => {
  if (motsDeFiltrage(v).length > PLAFONDS_DD.mots_par_activite) {
    ctx.addIssue({
      code: "custom",
      message: `Une activité déclarée compte ${PLAFONDS_DD.mots_par_activite} mots au plus.`,
    });
  }
});

export const regleExclusionSchema = z
  .object({
    code: codeReferentielSchema,
    libelle: texte(200),
    mots_cles: z.array(motCleExclusionSchema).max(10).default([]),
    secteur_codes: z.array(codeReferentielSchema).max(20).default([]),
    pays_codes: z.array(codeReferentielSchema).max(20).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mots_cles.length + v.secteur_codes.length + v.pays_codes.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Une règle porte au moins un critère (mot-clé, secteur ou pays).",
      });
    }
  });

const reglesSchema = z
  .array(regleExclusionSchema)
  .min(1)
  .max(PLAFONDS_DD.regles_par_liste)
  .refine((v) => new Set(v.map((r) => r.code)).size === v.length, "Codes de règle en double.");

export const listeExclusionCreationSchema = z
  .object({
    nom: texte(200),
    client_id: nullableDefaut(uuid),
    /** Nom d'un cadre public dont la liste s'inspire ; jamais un extrait. */
    reference_cadre: nullableDefaut(texte(300)),
    regles: reglesSchema,
  })
  .strict();

export const listeExclusionVersionSchema = z
  .object({
    regles: reglesSchema,
    reference_cadre: nullableDefaut(texte(300)),
    version_courante: versionCourante,
    motif: texte(500),
  })
  .strict();

const themeFiltrageSchema = z
  .object({
    code: themeEsSchema,
    niveau: niveauEsSchema,
    justification: nullableDefaut(texte(1000)),
    assertion_id: nullableDefaut(uuid),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.niveau !== "non_concerne" && v.niveau !== "faible" && v.justification === null) {
      ctx.addIssue({
        code: "custom",
        path: ["justification"],
        message: "Un niveau modéré ou plus se justifie.",
      });
    }
  });

export const filtrageCreationSchema = z
  .object({
    liste_id: uuid,
    declarations: z
      .object({
        activites: z.array(activiteDeclareeSchema).max(30).default([]),
        secteur_codes: z.array(codeReferentielSchema).max(20).default([]),
        pays_codes: z.array(codeReferentielSchema).max(20).default([]),
      })
      .strict(),
    themes: z
      .array(themeFiltrageSchema)
      .max(THEMES_ES.length)
      .default([])
      .refine((v) => new Set(v.map((t) => t.code)).size === v.length, "Thèmes en double."),
  })
  .strict();

export const filtrageDecisionSchema = z
  .object({
    regle_code: codeReferentielSchema,
    decision: decisionExclusionSchema,
    motif: z.string().trim().min(10).max(1000),
  })
  .strict();

// ---------------------------------------------------------------------------
// Note au comité (DD-13)
// ---------------------------------------------------------------------------

/** Plafonds du modèle de rapport (`PLAFONDS_MODELE`) : synthèse 4 000, condition 300. */
const noteContenuShape = {
  recommandation: recommandationNoteSchema,
  synthese: texte(4000),
  conditions: z.array(texte(300)).max(20).default([]),
};
export const noteContenuSchema = z.object(noteContenuShape).strict();
export const noteCreationSchema = z.object({ titre: texte(200), ...noteContenuShape }).strict();
export const noteVersionSchema = z
  .object({ ...noteContenuShape, version_courante: versionCourante, motif: texte(500) })
  .strict();
/** La version « brouillon » à soumettre. */
export const noteSoumissionSchema = z.object({ version: versionCourante }).strict();
export const noteValidationSchema = z
  .object({
    version: versionCourante,
    decision: decisionValidationDdSchema,
    motif: texte(1000).optional(),
  })
  .strict()
  .superRefine(exigerMotifSiRejet);

// ---------------------------------------------------------------------------
// Plan des 100 jours (DD-15)
// ---------------------------------------------------------------------------

const jour = entier(0, 100);

export const planActionCreationSchema = z
  .object({
    libelle: texte(200),
    description: nullableDefaut(texte(4000)),
    jour_debut: jour,
    jour_fin: jour,
    statut_action: statutAction100jSchema.default("a_faire"),
    responsable_id: nullableDefaut(uuid),
    plan_element_id: nullableDefaut(uuid),
    kpi_id: nullableDefaut(uuid),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.jour_debut > v.jour_fin) {
      ctx.addIssue({
        code: "custom",
        path: ["jour_fin"],
        message: "Le jour de fin ne précède pas le jour de début.",
      });
    }
  });

export const planActionVersionSchema = z
  .object({
    version_courante: versionCourante,
    motif: texte(500),
    libelle: texte(200).optional(),
    description: texte(4000).nullable().optional(),
    jour_debut: jour.optional(),
    jour_fin: jour.optional(),
    statut_action: statutAction100jSchema.optional(),
    responsable_id: uuid.nullable().optional(),
    plan_element_id: uuid.nullable().optional(),
    kpi_id: uuid.nullable().optional(),
    retire: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    exigerChampAModifier(v, ctx);
    if (v.jour_debut !== undefined && v.jour_fin !== undefined && v.jour_debut > v.jour_fin) {
      ctx.addIssue({
        code: "custom",
        path: ["jour_fin"],
        message: "Le jour de fin ne précède pas le jour de début.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Requêtes de lecture et de rapport
// ---------------------------------------------------------------------------

export const analysesQuerySchema = z.object({ analyse: analyseDdSchema.optional() }).strict();
export const risquesQuerySchema = z
  .object({
    famille: familleRisqueDdSchema.optional(),
    etape_id: uuid.optional(),
    niveau: niveauRisqueDdSchema.optional(),
  })
  .strict();

export const rapportNoteQuerySchema = z
  .object({
    format: z.enum(["pdf", "docx"]),
    variante: varianteNoteSchema,
    /** Défaut : la dernière version validée. */
    version: z.coerce.number().int().min(1).max(PLAFONDS_DD.versions_par_objet).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// `base_figee` d'une note (SPEC-3b §9.2) : construite par le serveur à la soumission, validée à
// l'écriture ET à la lecture par le rendu. Tout nombre vient d'un moteur ; montants en unités
// mineures de la devise du dossier. Tout tableau est borné (le jsonb tient en 1 Mo).
// ---------------------------------------------------------------------------

const lectureSolidite = z.enum(["solide", "etayee", "fragile"]);
const compteur = entier(0, 1_000_000);
const montant = entier(0, Number.MAX_SAFE_INTEGER);
const fourchetteSchema = z.object({ bas: montant, base: montant, haut: montant }).strict();

const baseCadrageSchema = z
  .object({
    titre: texte(200),
    secteur_code: codeReferentielSchema,
    secteur_libelle: texte(300),
    filiere_code: codeReferentielSchema.nullable(),
    filiere_libelle: texte(300).nullable(),
    pays_code: codeReferentielSchema,
    pays_libelle: texte(300),
    cible_nom: texte(200).nullable(),
    type_operation: typeOperationDdSchema,
    devise: deviseSchema,
    date_operation: dateIsoSchema.nullable(),
    question_investissement: texte(2000).nullable(),
    perimetre: texte(4000).nullable(),
  })
  .strict();

const baseHypotheseSchema = z
  .object({
    id: uuid,
    parent_id: uuid.nullable(),
    libelle: texte(200),
    critere: texte(2000).nullable(),
    /** Verdict validé (en vigueur) ; `null` impossible pour une note soumissible. */
    verdict: verdictDdSchema.nullable(),
    indication_moteur: verdictDdSchema.nullable(),
    nb_citees: entier(0, 50),
    /** La plus faible lecture des assertions citées. */
    solidite_min: lectureSolidite.nullable(),
  })
  .strict();

const baseRisqueSchema = z
  .object({
    id: uuid,
    famille: familleRisqueDdSchema,
    niveau: niveauRisqueDdSchema,
    libelle: texte(200),
    /** Libellé de l'étape de la chaîne de valeur, ou `null`. */
    etape: texte(200).nullable(),
    lecture: lectureSolidite.nullable(),
  })
  .strict();

const baseDimensionnementSchema = z
  .object({
    methode: methodeDimensionnementSchema,
    libelle: texte(200),
    resultat: fourchetteSchema,
    avant_ajustement: fourchetteSchema,
    couverture: z
      .object({
        total: compteur,
        preuve: compteur,
        avis_expert: compteur,
        absente: z.array(z.string().max(60)).max(12),
      })
      .strict(),
    /** Paramètres et sources (rendu détaillé). */
    parametres: z
      .array(
        z
          .object({
            code: z.enum(CODES_PARAMETRE_DIMENSIONNEMENT),
            bas: montant,
            base: montant,
            haut: montant,
            source: z.enum(["preuve", "avis_expert"]).nullable(),
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict();

const baseMarcheSchema = z
  .object({
    present: z.boolean(),
    dimensionnements: z
      .array(baseDimensionnementSchema)
      .max(PLAFONDS_DD.dimensionnements_par_dossier),
    recoupement: z
      .object({
        ecart_bp: entier(0, PLEIN_BP),
        plus_eleve: z.enum(["descendant", "ascendant", "egal"]),
        alerte: z.boolean(),
        chevauchement: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const baseFiltrageSchema = z
  .object({
    realise: z.boolean(),
    /** Liste d'exclusion du DERNIER filtrage (nom et version), `null` sans filtrage. */
    liste: z
      .object({ nom: texte(200), version: versionCourante })
      .strict()
      .nullable(),
    /** Filtrages réalisés avant le dernier (le dernier n'est pas compté). */
    filtrages_anterieurs: entier(0, PLAFONDS_DD.filtrages_par_dossier).default(0),
    /**
     * Exclusions confirmées dans un filtrage antérieur et non levées dans le dernier : elles
     * restent bloquantes et sont comptées dans `exclusions_bloquantes`, sans figurer dans `touches`.
     */
    exclusions_anterieures_non_levees: compteur.default(0),
    niveau_global: niveauEsSchema.nullable(),
    bloquant: z.boolean(),
    touches: z
      .array(
        z
          .object({
            regle: codeReferentielSchema,
            libelle: texte(200),
            decision: decisionExclusionSchema.nullable(),
          })
          .strict(),
      )
      .max(PLAFONDS_DD.regles_par_liste),
    themes: z
      .array(
        z
          .object({
            code: themeEsSchema,
            niveau: niveauEsSchema,
            justification: texte(1000).nullable(),
          })
          .strict(),
      )
      .max(THEMES_ES.length),
  })
  .strict();

const baseActionSchema = z
  .object({
    libelle: texte(200),
    jour_debut: jour,
    jour_fin: jour,
    statut: statutAction100jSchema,
    date_debut: dateIsoSchema.nullable(),
    date_fin: dateIsoSchema.nullable(),
  })
  .strict();

const phaseSchema = z.object({ total: compteur, terminees: compteur }).strict();
const basePlanSchema = z
  .object({
    present: z.boolean(),
    total: compteur,
    terminees: compteur,
    par_phase: z
      .object({ jours_0_30: phaseSchema, jours_31_60: phaseSchema, jours_61_100: phaseSchema })
      .strict(),
    actions: z.array(baseActionSchema).max(PLAFONDS_DD.actions_par_dossier),
  })
  .strict();

const baseAjustementSchema = z
  .object({
    cible_type: z.enum(["verdict", "risque", "dimensionnement"]),
    champ: texte(120),
    avant: z.string().max(500),
    apres: z.string().max(500),
    motif: texte(1000),
    cree_le: z.string().max(40),
  })
  .strict();

const baseSourcesSchema = z
  .object({
    assertions: z.object({ solides: compteur, etayees: compteur, fragiles: compteur }).strict(),
    anomalies: compteur,
  })
  .strict();

const baseDetailSchema = z
  .object({
    analyses: z
      .array(
        z
          .object({
            analyse: analyseDdSchema,
            categorie: z.string().min(1).max(60),
            enonce: texte(2000),
            niveau: niveauRisqueDdSchema.nullable(),
            lecture: lectureSolidite.nullable(),
            /** Numéros de la liste `sources`. */
            renvois: z.array(entier(1, 1_000)).max(50),
          })
          .strict(),
      )
      .max(PLAFONDS_DD.points_par_dossier),
    chaine: z
      .array(
        z
          .object({
            ordre: entier(1, 200),
            libelle: texte(200),
            part_cout_bp: entier(0, PLEIN_BP).nullable(),
            part_marge_bp: entier(0, PLEIN_BP).nullable(),
            rang_marge: entier(1, 200).nullable(),
          })
          .strict(),
      )
      .max(PLAFONDS_DD.etapes_par_dossier),
    signaux: z
      .array(
        z
          .object({
            libelle: texte(200),
            famille: familleRisqueDdSchema,
            gravite: niveauRisqueDdSchema,
            etat: etatConstatSignalSchema,
          })
          .strict(),
      )
      .max(500),
    sensibilite: z
      .array(
        z
          .object({
            methode: methodeDimensionnementSchema,
            code: z.enum(CODES_PARAMETRE_DIMENSIONNEMENT),
            resultat_bas: montant,
            resultat_haut: montant,
            amplitude: montant,
            part_amplitude_bp: entier(0, PLEIN_BP),
          })
          .strict(),
      )
      .max(24),
    /** Annexe numérotée : extraits déjà masqués par `vuePreuve(…, false)`, aucun nom de personne. */
    sources: z
      .array(
        z
          .object({
            n: entier(1, 1_000),
            type: z.string().min(1).max(40),
            source: texte(300),
            date: dateIsoSchema,
            fiabilite: z.enum(FIABILITES_PREUVE),
            extrait: z.string().max(4000).nullable(),
            masque: z.boolean(),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();

export const noteBaseSchema = z
  .object({
    version_base: z.literal(1),
    genere_le: dateIsoSchema,
    cadrage: baseCadrageSchema,
    hypotheses: z.array(baseHypotheseSchema).max(PLAFONDS_DD.hypotheses_par_dossier),
    risques: z.array(baseRisqueSchema).max(PLAFONDS_DD.risques_par_dossier),
    marche: baseMarcheSchema,
    filtrage_es: baseFiltrageSchema,
    plan_100j: basePlanSchema,
    ajustements: z.array(baseAjustementSchema).max(PLAFONDS_DD.ajustements_par_dossier),
    sources: baseSourcesSchema,
    detail: baseDetailSchema,
    bloquants: z.array(z.enum(CODES_BLOQUANTS_NOTE)).max(CODES_BLOQUANTS_NOTE.length),
    avertissements: z
      .array(z.enum(CODES_AVERTISSEMENTS_NOTE))
      .max(CODES_AVERTISSEMENTS_NOTE.length),
    exclusions_bloquantes: compteur,
  })
  .strict();
export type NoteBase = z.infer<typeof noteBaseSchema>;
