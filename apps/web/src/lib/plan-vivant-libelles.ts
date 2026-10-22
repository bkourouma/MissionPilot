/** Plan vivant (PLA-18) : libellés, mises en forme des montants et choix des versions. */
import {
  METHODE_REPREVISION_PLAN_LIBELLES,
  type MethodeReprevisionPlan,
} from "@missionpilot/shared";
import { formaterMontantMineur, formaterPourcentage, VALEUR_ABSENTE, type Devise } from "./format";
import type { VersionRetenue } from "./plan-vivant-types";

// --- Libellés ---------------------------------------------------------------------------------

export const MENTION_PLAN_VIVANT =
  "Le plan validé n'est jamais modifié : la re-prévision compare l'exercice prévu aux réalisés " +
  "saisis et en tire une projection annuelle. Écarts, décomposition et projection sont calculés " +
  "par le moteur du cabinet ; l'IA peut seulement les commenter, sous la validation d'un consultant.";

export const MENTION_PROJECTION_SIMPLIFIEE =
  "Projection simplifiée : la trésorerie de clôture re-prévue reprend la trésorerie prévue, corrigée " +
  "de l'écart constaté en fin de dernier trimestre et de l'écart d'EBE du reste de l'exercice. Elle " +
  "ne remplace pas un recalcul du modèle financier.";

export const LIBELLE_METHODE = METHODE_REPREVISION_PLAN_LIBELLES;

/** Explication d'une phrase de chaque méthode, affichée sous le choix. */
export const EXPLICATION_METHODE: Record<MethodeReprevisionPlan, string> = {
  reste_du_plan:
    "Le réalisé est conservé et le reste de l'exercice reprend le prévu du plan, sans correction.",
  tendance:
    "Le reste de l'exercice est ajusté du rapport entre le chiffre d'affaires réalisé et le prévu (entre 50 % et 150 %).",
};

export const LIBELLE_TRIMESTRE = (t: number) => `Trimestre ${t}`;
export const MESSAGE_AUCUN_REALISE = "Aucun réalisé n'est encore saisi pour cet exercice.";
export const MESSAGE_AUCUNE_VERSION_VALIDEE =
  "Aucune version validée du modèle financier : faites valider une version dans l'onglet Modèle financier pour pouvoir re-prévoir.";

export const LIBELLE_SIGNIFICATIF = "Significatif";
export const LIBELLE_NON_SIGNIFICATIF = "Dans le seuil";
export const LIBELLE_NON_SAISI = "Non saisi";

/** Mesures d'un tableau d'écarts, dans l'ordre d'affichage. */
export const LIBELLE_MESURES = {
  chiffreAffaires: "Chiffre d'affaires",
  excedentBrutExploitation: "Excédent brut d'exploitation (EBE)",
  resultatNet: "Résultat net",
  tresorerieFin: "Trésorerie de fin de trimestre",
  tresorerieCloture: "Trésorerie de clôture (projection simplifiée)",
} as const;

// --- Mise en forme ----------------------------------------------------------------------------

/** Montant en unités mineures entières → texte avec devise ; null → « Non saisi ». */
export function montantOuNonSaisi(v: number | null | undefined, devise: Devise): string {
  return v === null || v === undefined ? LIBELLE_NON_SAISI : formaterMontantMineur(v, devise);
}

/** Écart signé : « +1 500 FCFA », « −2 000 FCFA » (le signe est écrit, jamais porté par la couleur seule). */
export function formaterEcart(v: number | null | undefined, devise: Devise): string {
  if (v === null || v === undefined) return VALEUR_ABSENTE;
  const texte = formaterMontantMineur(Math.abs(v), devise);
  return v > 0 ? `+${texte}` : v < 0 ? `−${texte}` : texte;
}

/** Points de base (1/10 000) fournis par le moteur → « +12,73 % » ; absent → « — ». */
export function formaterEcartRelatif(pointsDeBase: number | null | undefined): string {
  if (pointsDeBase === null || pointsDeBase === undefined) return VALEUR_ABSENTE;
  const texte = formaterPourcentage(Math.abs(pointsDeBase) / 10_000, 2);
  return pointsDeBase > 0 ? `+${texte}` : pointsDeBase < 0 ? `−${texte}` : texte;
}

/** Seuil du moteur (pour mille) → « 10 % ». */
export const formaterSeuil = (pourMille: number) => formaterPourcentage(pourMille / 1000, 1);

export function libelleMethode(m: string): string {
  return (LIBELLE_METHODE as Record<string, string>)[m] ?? m;
}

export function libelleVersionRetenue(v: VersionRetenue): string {
  return `Version ${v.version}${v.validee ? " (validée)" : " (non validée)"}`;
}

/** Versions validées seulement (le moteur et la base refusent les autres), de la plus récente à la plus ancienne. */
export function versionsValidees(versions: readonly VersionRetenue[]): VersionRetenue[] {
  return versions.filter((v) => v.validee);
}

/** Version de départ : la plus récente des validées (liste de la plus récente à la plus ancienne). */
export function versionParDefaut(versions: readonly VersionRetenue[]): number | null {
  return versionsValidees(versions)[0]?.version ?? null;
}

/** Exercices de l'horizon d'une version du modèle : du premier exercice sur `horizon` années. */
export function exercicesHorizon(premierExercice: number, horizon: number): number[] {
  return Array.from({ length: Math.max(0, horizon) }, (_, i) => premierExercice + i);
}
