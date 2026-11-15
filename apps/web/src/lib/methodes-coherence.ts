/**
 * Contrôle de cohérence d'une version de méthode (STD-11), côté lecture : libellé français de
 * chaque code d'anomalie, regroupement par catégorie, texte des pastilles. Logique pure, testée
 * dans `methodes-coherence.test.ts`. Le contrôle lui-même est fait par l'API (moteurs).
 */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import type { AnomalieVersion, CategorieValidation, ValidationVersion } from "./methodes";

/** Libellé court (expert métier) de chaque code d'anomalie que l'API peut rendre. */
export const LIBELLES_ANOMALIE: Readonly<Record<string, string>> = {
  // Structure
  VERSION_SANS_BRIQUE: "La version ne contient aucune brique",
  ETAPE_SANS_BRIQUE: "Étape sans brique",
  MOTEUR_INCONNU: "Moteur de calcul inconnu",
  AUTONOMIE_INCOMPATIBLE: "Autonomie de l'IA trop élevée pour la classe de risque",
  CLASSE_ABAISSEE: "Classe de risque abaissée par rapport au standard",
  AUTONOMIE_RELEVEE: "Autonomie de l'IA relevée par rapport au standard",
  // Références
  REFERENCE_CASSEE: "Référence cassée",
  REFERENCE_INCONNUE: "Référence inconnue dans une règle",
  // Règles de modulation
  REGLES_TROP_NOMBREUSES: "Trop de règles de contexte",
  REGLE_INVALIDE: "Règle de contexte mal formée",
  REGLES_INVALIDES: "Règles de contexte invalides",
  CODE_INVALIDE: "Code de règle invalide",
  CODE_EN_DOUBLE: "Code de règle en double",
  PRIORITE_INVALIDE: "Priorité de règle invalide",
  CONDITION_INVALIDE: "Condition de règle invalide",
  CONDITION_TROP_COMPLEXE: "Condition trop complexe",
  EFFET_INVALIDE: "Effet de règle invalide",
  FACTEUR_DEFINITION_INVALIDE: "Définition de facteur invalide",
  FACTEUR_INCONNU: "Facteur de contexte inconnu",
  COMPARATEUR_INCOMPATIBLE: "Comparaison incompatible avec le type du facteur",
  VALEUR_INVALIDE: "Valeur incompatible avec le facteur",
  CONFLIT_INTERNE: "Effets contradictoires dans une même règle",
  CONFLIT_MEME_PRIORITE: "Règles de même priorité aux effets contradictoires",
  CYCLE: "Les règles se déclenchent en boucle",
  CYCLE_REGLES: "Les règles se déclenchent en boucle",
  REGLE_SANS_EFFET: "Règle sans effet",
  REGLES_CONTRADICTOIRES: "Règles contradictoires",
  REGLE_SANS_EFFET_REEL: "Règle sans effet réel",
  REGLE_INACTIVE: "Règle désactivée",
  CONDITION_INSATISFAISABLE: "Condition qui ne peut jamais être vraie",
  BRIQUE_INATTEIGNABLE: "Brique que plus aucune règle n'active",
  OPTIONS_INVALIDES: "Options de contrôle invalides",
  // Rubriques
  RUBRIQUE_SANS_ANCRAGE: "Rubrique sans les cinq niveaux d'ancrage",
  RUBRIQUE_ANCRAGES_IDENTIQUES: "Niveaux d'ancrage identiques",
  RUBRIQUE_SANS_EXEMPLE: "Rubrique sans exemple d'ancrage",
  RUBRIQUE_NON_RATTACHEE: "Rubrique rattachée à aucune brique",
  // Héritage
  CYCLE_HERITAGE: "Cycle dans l'héritage des méthodes",
  HERITAGE_INCOHERENT: "Héritage incohérent",
  // Cas types
  AUCUN_CAS_TYPE: "Aucun cas type ne teste les règles",
  CAS_TYPE_ECHOUE: "Cas type qui ne donne pas le résultat attendu",
  CAS_TYPE_INVALIDE: "Cas type invalide",
};

export const LIBELLE_ANOMALIE_INCONNUE = "Anomalie de cohérence";

/** Version anglaise de `LIBELLES_ANOMALIE`. */
export const LIBELLES_ANOMALIE_EN: Readonly<Record<string, string>> = {
  VERSION_SANS_BRIQUE: "The version contains no building block",
  ETAPE_SANS_BRIQUE: "Step with no building block",
  MOTEUR_INCONNU: "Unknown calculation engine",
  AUTONOMIE_INCOMPATIBLE: "AI autonomy too high for the risk class",
  CLASSE_ABAISSEE: "Risk class lowered compared with the standard",
  AUTONOMIE_RELEVEE: "AI autonomy raised compared with the standard",
  REFERENCE_CASSEE: "Broken reference",
  REFERENCE_INCONNUE: "Unknown reference in a rule",
  REGLES_TROP_NOMBREUSES: "Too many context rules",
  REGLE_INVALIDE: "Malformed context rule",
  REGLES_INVALIDES: "Invalid context rules",
  CODE_INVALIDE: "Invalid rule code",
  CODE_EN_DOUBLE: "Duplicate rule code",
  PRIORITE_INVALIDE: "Invalid rule priority",
  CONDITION_INVALIDE: "Invalid rule condition",
  CONDITION_TROP_COMPLEXE: "Condition too complex",
  EFFET_INVALIDE: "Invalid rule effect",
  FACTEUR_DEFINITION_INVALIDE: "Invalid factor definition",
  FACTEUR_INCONNU: "Unknown context factor",
  COMPARATEUR_INCOMPATIBLE: "Comparison incompatible with the factor type",
  VALEUR_INVALIDE: "Value incompatible with the factor",
  CONFLIT_INTERNE: "Contradictory effects within a single rule",
  CONFLIT_MEME_PRIORITE: "Same-priority rules with contradictory effects",
  CYCLE: "Rules trigger each other in a loop",
  CYCLE_REGLES: "Rules trigger each other in a loop",
  REGLE_SANS_EFFET: "Rule with no effect",
  REGLES_CONTRADICTOIRES: "Contradictory rules",
  REGLE_SANS_EFFET_REEL: "Rule with no real effect",
  REGLE_INACTIVE: "Disabled rule",
  CONDITION_INSATISFAISABLE: "Condition that can never be true",
  BRIQUE_INATTEIGNABLE: "Building block that no rule can activate any more",
  OPTIONS_INVALIDES: "Invalid check options",
  RUBRIQUE_SANS_ANCRAGE: "Rubric without the five anchor levels",
  RUBRIQUE_ANCRAGES_IDENTIQUES: "Identical anchor levels",
  RUBRIQUE_SANS_EXEMPLE: "Rubric without an anchor example",
  RUBRIQUE_NON_RATTACHEE: "Rubric attached to no building block",
  CYCLE_HERITAGE: "Cycle in method inheritance",
  HERITAGE_INCOHERENT: "Inconsistent inheritance",
  AUCUN_CAS_TYPE: "No test case exercises the rules",
  CAS_TYPE_ECHOUE: "Test case that does not give the expected result",
  CAS_TYPE_INVALIDE: "Invalid test case",
};

export function libelleAnomalie(code: string, langue: Langue = "fr"): string {
  return (
    (langue === "en" ? LIBELLES_ANOMALIE_EN : LIBELLES_ANOMALIE)[code] ??
    creerTraduire(langue)(LIBELLE_ANOMALIE_INCONNUE, "Consistency issue")
  );
}

/** Les six catégories, dans l'ordre d'affichage, avec leur libellé et leur consigne. */
export const CATEGORIES_COHERENCE: readonly {
  categorie: CategorieValidation;
  libelle: string;
  consigne: string;
}[] = [
  {
    categorie: "structure",
    libelle: "Structure",
    consigne: "Étapes, briques, moteurs, classes de risque et autonomie de l'IA.",
  },
  {
    categorie: "references",
    libelle: "Références",
    consigne: "Ce que les briques, éléments, rubriques et règles désignent doit exister.",
  },
  {
    categorie: "regles",
    libelle: "Règles de modulation",
    consigne: "Règles de contexte : forme, conflits, portée réelle.",
  },
  {
    categorie: "rubriques",
    libelle: "Rubriques d'évaluation",
    consigne: "Cinq niveaux d'ancrage distincts, avec exemples, rattachés à une brique.",
  },
  {
    categorie: "heritage",
    libelle: "Héritage",
    consigne: "Lien avec la méthode parente et la version du standard dont elle part.",
  },
  {
    categorie: "cas_types",
    libelle: "Cas types",
    consigne: "Jeux d'essai qui vérifient que les règles font ce qu'on attend d'elles.",
  },
];

const CATEGORIES_COHERENCE_EN: Record<CategorieValidation, { libelle: string; consigne: string }> =
  {
    structure: {
      libelle: "Structure",
      consigne: "Steps, building blocks, engines, risk classes and AI autonomy.",
    },
    references: {
      libelle: "References",
      consigne: "What building blocks, elements, rubrics and rules point to must exist.",
    },
    regles: {
      libelle: "Modulation rules",
      consigne: "Context rules: form, conflicts, actual scope.",
    },
    rubriques: {
      libelle: "Rating rubrics",
      consigne: "Five distinct anchor levels, with examples, attached to a building block.",
    },
    heritage: {
      libelle: "Inheritance",
      consigne: "Link to the parent method and the standard version it starts from.",
    },
    cas_types: {
      libelle: "Test cases",
      consigne: "Test sets that check the rules do what is expected of them.",
    },
  };

const CODES_STRUCTURE = new Set([
  "VERSION_SANS_BRIQUE",
  "ETAPE_SANS_BRIQUE",
  "MOTEUR_INCONNU",
  "AUTONOMIE_INCOMPATIBLE",
  "CLASSE_ABAISSEE",
  "AUTONOMIE_RELEVEE",
]);

/**
 * Catégorie d'une anomalie. Reprend la répartition de l'API (les anomalies n'en portent pas) :
 * une référence cassée de l'héritage a pour chemin `methodes.…` ou `versions.…`.
 */
export function categorieAnomalie(
  a: Pick<AnomalieVersion, "code" | "chemin">,
): CategorieValidation {
  if (a.code === "CYCLE_HERITAGE" || a.code === "HERITAGE_INCOHERENT") return "heritage";
  if (a.code === "REFERENCE_CASSEE") {
    return /^(methodes|versions)(\.|$)/.test(a.chemin) ? "heritage" : "references";
  }
  if (CODES_STRUCTURE.has(a.code)) return "structure";
  if (a.code.startsWith("RUBRIQUE_")) return "rubriques";
  if (a.code === "AUCUN_CAS_TYPE" || a.code === "CAS_TYPE_ECHOUE" || a.chemin === "cas_types") {
    return "cas_types";
  }
  return "regles";
}

export interface GroupeAnomalies {
  categorie: CategorieValidation;
  libelle: string;
  consigne: string;
  erreurs: number;
  avertissements: number;
  anomalies: AnomalieVersion[];
}

/**
 * Anomalies regroupées par catégorie, dans l'ordre fixe des six catégories (une catégorie sans
 * anomalie est conservée : « conforme »). Les erreurs précèdent les avertissements.
 */
export function grouperAnomalies(
  v: Pick<ValidationVersion, "anomalies">,
  langue: Langue = "fr",
): GroupeAnomalies[] {
  return CATEGORIES_COHERENCE.map((base) => {
    const c = langue === "en" ? { ...base, ...CATEGORIES_COHERENCE_EN[base.categorie] } : base;
    const anomalies = v.anomalies
      .filter((a) => categorieAnomalie(a) === c.categorie)
      .sort((a, b) => Number(b.gravite === "erreur") - Number(a.gravite === "erreur"));
    return {
      ...c,
      anomalies,
      erreurs: anomalies.filter((a) => a.gravite === "erreur").length,
      avertissements: anomalies.filter((a) => a.gravite === "avertissement").length,
    };
  });
}

/** Texte de la pastille d'une catégorie : « 2 erreurs », « 1 avertissement », « conforme ». */
export function textePastille(
  g: Pick<GroupeAnomalies, "erreurs" | "avertissements">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const morceaux = [
    g.erreurs > 0
      ? `${g.erreurs} ${g.erreurs > 1 ? t("erreurs", "errors") : t("erreur", "error")}`
      : null,
    g.avertissements > 0
      ? `${g.avertissements} ${g.avertissements > 1 ? t("avertissements", "warnings") : t("avertissement", "warning")}`
      : null,
  ].filter((m): m is string => m !== null);
  return morceaux.length > 0 ? morceaux.join(" · ") : t("conforme", "compliant");
}

export type TonalitePastille = "danger" | "attention" | "succes";

export const tonalitePastille = (
  g: Pick<GroupeAnomalies, "erreurs" | "avertissements">,
): TonalitePastille => (g.erreurs > 0 ? "danger" : g.avertissements > 0 ? "attention" : "succes");

/** Effet d'une anomalie sur la publication, en toutes lettres. */
export const texteBlocage = (a: Pick<AnomalieVersion, "gravite">, langue: Langue = "fr"): string =>
  a.gravite === "erreur"
    ? creerTraduire(langue)("Bloque la publication", "Blocks publication")
    : creerTraduire(langue)("N'empêche pas la publication", "Does not prevent publication");

/** Nombre d'erreurs qui bloquent la publication. */
export const nombreErreursBloquantes = (v: Pick<ValidationVersion, "anomalies">): number =>
  v.anomalies.filter((a) => a.gravite === "erreur").length;

/**
 * Raison affichée à côté du bouton « Publier » désactivé, ou `null` si rien ne s'y oppose côté
 * écran. Le contrôle a pu échouer (`validation` null) : l'API reste seule juge.
 */
export function raisonPublicationBloquee(
  validation: Pick<ValidationVersion, "anomalies"> | null,
  langue: Langue = "fr",
): string | null {
  if (!validation) return null;
  const t = creerTraduire(langue);
  const n = nombreErreursBloquantes(validation);
  if (n === 0) return null;
  return n === 1
    ? t(
        "Publication impossible : une erreur de cohérence reste à corriger.",
        "Publication not possible: one consistency error remains to be fixed.",
      )
    : t(
        `Publication impossible : ${n} erreurs de cohérence restent à corriger.`,
        `Publication not possible: ${n} consistency errors remain to be fixed.`,
      );
}
