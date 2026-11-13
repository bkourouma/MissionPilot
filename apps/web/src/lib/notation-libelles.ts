/** Notation : permissions, libellés et mise en forme (voir `notation.ts`). */
import {
  aPermission,
  LOCALES_INTL,
  type Langue,
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

const CLASSES_EN: Record<Classe, { libelle: string; plage: string }> = {
  A: { libelle: "Very advanced", plage: "80 and above" },
  B: { libelle: "Advanced", plage: "from 65 to under 80" },
  C: { libelle: "Intermediate", plage: "from 50 to under 65" },
  D: { libelle: "Fragile", plage: "from 35 to under 50" },
  E: { libelle: "Critical", plage: "under 35" },
};

/** Libellé et plage d'une classe dans la langue demandée (le français reste `CLASSES`). */
export function detailClasse(
  classe: Classe,
  langue: Langue = "fr",
): { libelle: string; plage: string; tonalite: TonaliteNotation } {
  const base = CLASSES[classe];
  return langue === "en" ? { ...base, ...CLASSES_EN[classe] } : base;
}

export const LISTE_CLASSES: readonly Classe[] = ["A", "B", "C", "D", "E"];

export const estClasse = (v: unknown): v is Classe =>
  typeof v === "string" && (LISTE_CLASSES as readonly string[]).includes(v);

/** « Classe B — Avancé » ; « Non notable » sans classe. */
export function libelleClasse(classe: Classe | null | undefined, langue: Langue = "fr"): string {
  if (!estClasse(classe)) return langue === "en" ? "Not rated" : "Non notable";
  if (langue === "en") return `Class ${classe} — ${CLASSES_EN[classe].libelle}`;
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

const STATUT_VERSION_EN: Record<string, string> = {
  brouillon: "Draft",
  en_revue: "In review (expert)",
  publiee: "Published",
  remplacee: "Replaced by a new computation",
};

export function libelleStatutVersion(statut: string, langue: Langue = "fr"): string {
  if (langue === "en") return STATUT_VERSION_EN[statut] ?? "Unknown status";
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

export const STRATEGIES_EN: Record<StrategieNotation, { libelle: string; aide: string }> = {
  ignorer: {
    libelle: "Ignore missing answers (recommended)",
    aide: "The score is computed on the answers given, renormalized. A dimension is rated only if half of its weight is answered.",
  },
  penaliser: {
    libelle: "Penalize missing answers",
    aide: "An applicable question with no answer counts for 0 points.",
  },
};

/** Libellé et aide d'une stratégie dans la langue demandée. */
export const detailStrategie = (s: StrategieNotation, langue: Langue = "fr") =>
  langue === "en" ? STRATEGIES_EN[s] : STRATEGIES[s];

export const libelleStrategie = (s: string, langue: Langue = "fr") =>
  ((langue === "en" ? STRATEGIES_EN : STRATEGIES) as Record<string, { libelle: string }>)[s]
    ?.libelle ?? (langue === "en" ? "Unknown strategy" : "Stratégie inconnue");

const FAMILLES: Record<string, string> = {
  excellence: "Excellence opérationnelle",
  competitivite: "Compétitivité",
};

const FAMILLES_EN: Record<string, string> = {
  excellence: "Operational excellence",
  competitivite: "Competitiveness",
};

/** Libellé d'une famille de dimensions ; le code brut si la grille du cabinet en a ajouté une. */
export const libelleFamille = (code: string, langue: Langue = "fr") =>
  (langue === "en" ? FAMILLES_EN : FAMILLES)[code] ??
  (code.trim() === "" ? (langue === "en" ? "No family" : "Sans famille") : code);

export const EVOLUTIONS: Record<Evolution, string> = {
  hausse: "En hausse",
  baisse: "En baisse",
  stable: "Stable",
  non_comparable: "Non comparable",
};

export const EVOLUTIONS_EN: Record<Evolution, string> = {
  hausse: "Up",
  baisse: "Down",
  stable: "Stable",
  non_comparable: "Not comparable",
};

export const libelleEvolution = (e: string, langue: Langue = "fr") => {
  const table = (langue === "en" ? EVOLUTIONS_EN : EVOLUTIONS) as Record<string, string>;
  return table[e] ?? table.non_comparable;
};

export const ACTIONS_REVUE: Record<ActionRevue, string> = {
  soumission: "Soumise en revue",
  renvoi: "Renvoyée en brouillon",
  publication: "Publiée",
};

export const ACTIONS_REVUE_EN: Record<ActionRevue, string> = {
  soumission: "Submitted for review",
  renvoi: "Sent back to draft",
  publication: "Published",
};

export const libelleActionRevue = (a: string, langue: Langue = "fr") =>
  ((langue === "en" ? ACTIONS_REVUE_EN : ACTIONS_REVUE) as Record<string, string>)[a] ??
  (langue === "en" ? "Review step" : "Étape de revue");

const SECTEURS_EN: Record<string, string> = {
  agro_industrie: "Agribusiness",
  numerique: "Digital",
  industrie: "Industry",
  services: "Services",
  commerce: "Commerce and distribution",
};

/** Libellé d'un secteur de la grille générique dans la langue demandée. */
export const libelleSecteurGenerique = (code: string, libelle: string, langue: Langue = "fr") =>
  langue === "en" ? (SECTEURS_EN[code] ?? libelle) : libelle;

/** Libellé d'un secteur : celui de la liste fournie, sinon celui de la grille générique. */
export function libelleSecteur(
  code: string | null,
  secteurs: readonly { secteur: string; libelle?: string }[] = [],
  langue: Langue = "fr",
): string {
  if (code === null) return langue === "en" ? "Default weightings" : "Pondérations par défaut";
  const s = secteurs.find((x) => x.secteur === code);
  const generique = SECTEURS_GRILLE_GENERIQUE.find((x) => x.code === code);
  if (s?.libelle) return generique ? libelleSecteurGenerique(code, s.libelle, langue) : s.libelle;
  return generique ? libelleSecteurGenerique(code, generique.libelle, langue) : code;
}

// --- Mise en forme (aucun calcul) ------------------------------------------------------------

const formatScore = (langue: Langue) =>
  new Intl.NumberFormat(LOCALES_INTL[langue], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

const nombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Score de l'API (déjà arrondi à 1 décimale par le moteur) : 72.4 → « 72,4 ». */
export function formaterScore(v: number | null | undefined, langue: Langue = "fr"): string {
  return nombre(v) ? formatScore(langue).format(v) : VALEUR_ABSENTE;
}

/** Écart signé fourni par l'API : 4.5 → « +4,5 », −4.5 → « −4,5 », 0 → « 0,0 ». */
export function formaterEcart(v: number | null | undefined, langue: Langue = "fr"): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  if (v === 0) return formatScore(langue).format(0);
  const texte = formatScore(langue).format(Math.abs(v));
  return v > 0 ? `+${texte}` : `−${texte}`;
}

/** Couverture (0-1) de l'API : 0.625 → « 62,5 % ». */
export function formaterCouverture(v: number | null | undefined, langue: Langue = "fr"): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  return new Intl.NumberFormat(LOCALES_INTL[langue], {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(v);
}

/** Écart de classes fourni par l'API : 1 → « +1 classe », −2 → « −2 classes ». */
export function formaterEcartClasses(v: number | null | undefined, langue: Langue = "fr"): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  if (v === 0) return langue === "en" ? "Same class" : "Même classe";
  const n = Math.abs(v);
  const signe = v > 0 ? "+" : "−";
  if (langue === "en") return `${signe}${n} ${n > 1 ? "classes" : "class"}`;
  return `${signe}${n} classe${n > 1 ? "s" : ""}`;
}

/** « 1 réponse soumise », « 3 réponses soumises ». */
export function pluriel(n: number, singulier: string, plurielTexte = `${singulier}s`): string {
  return `${n} ${n > 1 ? plurielTexte : singulier}`;
}
