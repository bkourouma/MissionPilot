/** Notation : permissions, libellés et mise en forme (voir `notation.ts`). */
import {
  aPermission,
  SECTEURS_GRILLE_GENERIQUE,
  STATUT_VERSION_NOTATION_LIBELLES,
  type Permission,
  type Role,
  type StatutVersionNotation,
  type StrategieNotation,
} from "@missionpilot/shared";
import { VALEUR_ABSENTE } from "./format";
import type { ActionRevue, Classe, Evolution } from "./notation-types";

// --- Permissions (miroir des routes de l'API) -----------------------------------------------

/** Lecture des grilles et des notations : `notation.gerer` OU `notation.publier`. */
export const PERMISSIONS_LECTURE_NOTATION: readonly Permission[] = [
  "notation.gerer",
  "notation.publier",
];

export const peutLireNotation = (roles: readonly Role[]) =>
  PERMISSIONS_LECTURE_NOTATION.some((p) => aPermission(roles, p));

/** Expert métier détenteur de `notation.publier` : seul habilité à renvoyer et publier (NOT-07). */
export const estExpertPublieur = (roles: readonly Role[]) =>
  roles.includes("expert_metier") && aPermission(roles, "notation.publier");

// --- Libellés --------------------------------------------------------------------------------

export type TonaliteNotation = "succes" | "attention" | "danger" | "neutre";

/**
 * Classes A à E (DECISIONS.md, NOT-03) : la lettre, son libellé et sa plage sont TOUJOURS
 * affichés, la couleur ne porte jamais seule le sens. Libellés à valider par les experts.
 */
export const CLASSES: Record<
  Classe,
  { libelle: string; plage: string; tonalite: TonaliteNotation }
> = {
  A: { libelle: "Très avancé", plage: "80 et plus", tonalite: "succes" },
  B: { libelle: "Avancé", plage: "de 65 à moins de 80", tonalite: "succes" },
  C: { libelle: "Intermédiaire", plage: "de 50 à moins de 65", tonalite: "neutre" },
  D: { libelle: "Fragile", plage: "de 35 à moins de 50", tonalite: "attention" },
  E: { libelle: "Critique", plage: "moins de 35", tonalite: "danger" },
};

export const LISTE_CLASSES: readonly Classe[] = ["A", "B", "C", "D", "E"];

export const estClasse = (v: unknown): v is Classe =>
  typeof v === "string" && (LISTE_CLASSES as readonly string[]).includes(v);

/** « Classe B — Avancé » ; « Non notable » sans classe. */
export function libelleClasse(classe: Classe | null | undefined): string {
  if (!estClasse(classe)) return "Non notable";
  return `Classe ${classe} — ${CLASSES[classe].libelle}`;
}

export const tonaliteClasse = (classe: Classe | null | undefined): TonaliteNotation =>
  estClasse(classe) ? CLASSES[classe].tonalite : "neutre";

export const TONALITE_STATUT: Record<StatutVersionNotation, TonaliteNotation> = {
  brouillon: "neutre",
  en_revue: "attention",
  publiee: "succes",
  remplacee: "neutre",
};

export function libelleStatutVersion(statut: string): string {
  return (STATUT_VERSION_NOTATION_LIBELLES as Record<string, string>)[statut] ?? "Statut inconnu";
}

export const tonaliteStatutVersion = (statut: string): TonaliteNotation =>
  (TONALITE_STATUT as Record<string, TonaliteNotation>)[statut] ?? "neutre";

export const STRATEGIES: Record<StrategieNotation, { libelle: string; aide: string }> = {
  ignorer: {
    libelle: "Ignorer les réponses manquantes (recommandé)",
    aide: "Le score se calcule sur les réponses données, renormalisées. Une dimension n'est notable que si la moitié de son poids est répondue.",
  },
  penaliser: {
    libelle: "Pénaliser les réponses manquantes",
    aide: "Une question applicable sans réponse compte pour 0 point.",
  },
};

export const libelleStrategie = (s: string) =>
  (STRATEGIES as Record<string, { libelle: string }>)[s]?.libelle ?? "Stratégie inconnue";

const FAMILLES: Record<string, string> = {
  excellence: "Excellence opérationnelle",
  competitivite: "Compétitivité",
};

/** Libellé d'une famille de dimensions ; le code brut si la grille du cabinet en a ajouté une. */
export const libelleFamille = (code: string) =>
  FAMILLES[code] ?? (code.trim() === "" ? "Sans famille" : code);

export const EVOLUTIONS: Record<Evolution, string> = {
  hausse: "En hausse",
  baisse: "En baisse",
  stable: "Stable",
  non_comparable: "Non comparable",
};

export const libelleEvolution = (e: string) =>
  (EVOLUTIONS as Record<string, string>)[e] ?? EVOLUTIONS.non_comparable;

export const ACTIONS_REVUE: Record<ActionRevue, string> = {
  soumission: "Soumise en revue",
  renvoi: "Renvoyée en brouillon",
  publication: "Publiée",
};

export const libelleActionRevue = (a: string) =>
  (ACTIONS_REVUE as Record<string, string>)[a] ?? "Étape de revue";

/** Libellé d'un secteur : celui de la liste fournie, sinon celui de la grille générique. */
export function libelleSecteur(
  code: string | null,
  secteurs: readonly { secteur: string; libelle?: string }[] = [],
): string {
  if (code === null) return "Pondérations par défaut";
  const s = secteurs.find((x) => x.secteur === code);
  if (s?.libelle) return s.libelle;
  return SECTEURS_GRILLE_GENERIQUE.find((x) => x.code === code)?.libelle ?? code;
}

// --- Mise en forme (aucun calcul) ------------------------------------------------------------

const FORMAT_SCORE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const nombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Score de l'API (déjà arrondi à 1 décimale par le moteur) : 72.4 → « 72,4 ». */
export function formaterScore(v: number | null | undefined): string {
  return nombre(v) ? FORMAT_SCORE.format(v) : VALEUR_ABSENTE;
}

/** Écart signé fourni par l'API : 4.5 → « +4,5 », −4.5 → « −4,5 », 0 → « 0,0 ». */
export function formaterEcart(v: number | null | undefined): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  if (v === 0) return FORMAT_SCORE.format(0);
  const texte = FORMAT_SCORE.format(Math.abs(v));
  return v > 0 ? `+${texte}` : `−${texte}`;
}

/** Couverture (0-1) de l'API : 0.625 → « 62,5 % ». */
export function formaterCouverture(v: number | null | undefined): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(v);
}

/** Écart de classes fourni par l'API : 1 → « +1 classe », −2 → « −2 classes ». */
export function formaterEcartClasses(v: number | null | undefined): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  if (v === 0) return "Même classe";
  const n = Math.abs(v);
  return `${v > 0 ? "+" : "−"}${n} classe${n > 1 ? "s" : ""}`;
}

/** « 1 réponse soumise », « 3 réponses soumises ». */
export function pluriel(n: number, singulier: string, plurielTexte = `${singulier}s`): string {
  return `${n} ${n > 1 ? plurielTexte : singulier}`;
}
