/**
 * Vocabulaire fermé de la due diligence (SPEC-3b §3.4). Les mêmes valeurs sont déclarées dans
 * `packages/shared` (qui n'importe pas ce paquet) ; `apps/api/test/dd-vocabulaire.test.ts`
 * vérifie leur égalité.
 */
import { ESPACE_FINE_INSECABLE } from "../finance/monnaie";
import { ErreurDueDiligence } from "./erreurs";

export const ANALYSES_DD = ["pestel", "cinq_forces", "swot", "operationnelle"] as const;
export type AnalyseDd = (typeof ANALYSES_DD)[number];

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

export const FAMILLES_RISQUE_DD = ["pays", "change", "operationnel", "reglementaire"] as const;
export type FamilleRisqueDd = (typeof FAMILLES_RISQUE_DD)[number];

/** Du moins grave au plus grave. */
export const NIVEAUX_RISQUE_DD = ["faible", "modere", "eleve", "critique"] as const;
export type NiveauRisqueDd = (typeof NIVEAUX_RISQUE_DD)[number];

/** Du moins grave au plus grave ; `non_concerne` = 0. */
export const NIVEAUX_ES = ["non_concerne", "faible", "modere", "eleve", "critique"] as const;
export type NiveauEs = (typeof NIVEAUX_ES)[number];

export const VERDICTS_DD = ["confirmee", "infirmee", "non_concluante"] as const;
export type VerdictDd = (typeof VERDICTS_DD)[number];

export const TYPES_OPERATION_DD = ["acquisition", "entree_marche", "partenariat"] as const;
export type TypeOperationDd = (typeof TYPES_OPERATION_DD)[number];

export const METHODES_DIMENSIONNEMENT = ["descendant", "ascendant"] as const;
export type MethodeDimensionnement = (typeof METHODES_DIMENSIONNEMENT)[number];

export const RECOMMANDATIONS_NOTE = [
  "favorable",
  "favorable_sous_conditions",
  "reservee",
  "defavorable",
] as const;
export type RecommandationNote = (typeof RECOMMANDATIONS_NOTE)[number];

export const VARIANTES_NOTE = ["executive", "detaillee"] as const;
export type VarianteNote = (typeof VARIANTES_NOTE)[number];

export const STATUTS_ACTION_100J = ["a_faire", "en_cours", "terminee", "bloquee"] as const;
export type StatutAction100j = (typeof STATUTS_ACTION_100J)[number];

/** Huit thèmes de revue environnementale et sociale (libellés courts propres à MissionPilot, provisoires). */
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

export function estCategorieAnalyseDd(analyse: AnalyseDd, categorie: string): boolean {
  const categories = (CATEGORIES_ANALYSE_DD as Record<string, readonly string[] | undefined>)[
    analyse
  ];
  return categories !== undefined && categories.includes(categorie);
}

/** faible = 1 … critique = 4. */
export function rangNiveauRisqueDd(n: NiveauRisqueDd): 1 | 2 | 3 | 4 {
  const i = NIVEAUX_RISQUE_DD.indexOf(n);
  if (i < 0)
    throw new ErreurDueDiligence("ENTREE_INVALIDE", `Niveau de risque inconnu : « ${n} ».`);
  return (i + 1) as 1 | 2 | 3 | 4;
}

/** non_concerne = 0 … critique = 4. */
export function rangNiveauEs(n: NiveauEs): 0 | 1 | 2 | 3 | 4 {
  const i = NIVEAUX_ES.indexOf(n);
  if (i < 0) throw new ErreurDueDiligence("ENTREE_INVALIDE", `Niveau E&S inconnu : « ${n} ».`);
  return i as 0 | 1 | 2 | 3 | 4;
}

/**
 * Points de base en pourcentage français, entiers seulement, séparateur décimal « , » et milliers
 * séparés comme `formaterMontant` : 4000 → « 40 % », 2550 → « 25,5 % », 5 → « 0,05 % ».
 */
export function formaterPointsDeBase(bp: number): string {
  if (!Number.isInteger(bp) || bp < 0 || bp > 100_000) {
    throw new ErreurDueDiligence(
      "ENTREE_INVALIDE",
      "Points de base : entier de 0 à 100 000 attendu.",
    );
  }
  const entier = String(Math.trunc(bp / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ESPACE_FINE_INSECABLE,
  );
  const reste = bp % 100;
  const decimales = reste === 0 ? "" : `,${String(reste).padStart(2, "0").replace(/0$/, "")}`;
  return `${entier}${decimales} %`;
}
