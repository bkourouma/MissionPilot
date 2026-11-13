/**
 * Redressement, onglet « Clôture » (RED-08) : chemins d'API, libellés, textes fixes, mise en forme
 * des valeurs du bilan et messages d'erreur. Logique pure, testée dans `redressement-cloture.test.ts`.
 *
 * Aucun calcul métier : toutes les valeurs du bilan (points de base, jours, unités mineures,
 * dixièmes de point, variations signées) sortent du moteur et sont seulement mises en forme ici.
 * Aucun texte ne qualifie juridiquement la situation du client : une évolution est un constat sur
 * un écart entre l'état d'ouverture et l'état de fin.
 */
import {
  creerTraduire,
  type Langue,
  RED_CHANGEMENT_CLASSE_LIBELLES,
  RED_CONTROLES_CLOTURE,
  RED_EVOLUTION_CLOTURE_LIBELLES,
  RED_RATIO_LIBELLES,
  RED_STATUT_CLOTURE_LIBELLES,
  RED_STATUT_RENOTATION_LIBELLES,
  type RedChangementClasse,
  type RedCleRatio,
  type RedEvolutionCloture,
  type RedStatutCloture,
  type RedStatutReNotation,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { formaterMontantMineur, formaterNombre, VALEUR_ABSENTE, type Devise } from "./format";
import { FORME_RATIO, messageRedressement } from "./redressement";

const enc = encodeURIComponent;

// --- Chemins d'API ----------------------------------------------------------------------------------

export const cheminClotures = (dossierId: string) =>
  `/api/redressement/dossiers/${enc(dossierId)}/clotures`;
export const cheminCloture = (id: string) => `/api/redressement/clotures/${enc(id)}`;
export const cheminValidationCloture = (id: string) => `${cheminCloture(id)}/validation`;
export const cheminRapportsCloture = (id: string) => `${cheminCloture(id)}/rapports`;

export const FORMATS_RAPPORT_CLOTURE = ["pdf", "docx"] as const;
export type FormatRapportCloture = (typeof FORMATS_RAPPORT_CLOTURE)[number];
export const FORMAT_RAPPORT_CLOTURE_LIBELLES: Record<FormatRapportCloture, string> = {
  pdf: "PDF",
  docx: "Word",
};

export const cheminGenerationRapportCloture = (id: string, format: FormatRapportCloture) =>
  `${cheminRapportsCloture(id)}?format=${format}`;

/** Réponse de la génération d'un rapport de clôture. */
export interface RapportClotureCree {
  rapport: { id: string; format: FormatRapportCloture; statut: "brouillon" | "valide" };
  fichier: { id: string; nom: string; type_mime: string; taille: number };
}

// --- Textes fixes -----------------------------------------------------------------------------------

export const TEXTE_CLOTURE_INTRO =
  "Le bilan de clôture compare l'état du dossier à l'ouverture et à la fin. Il est construit par le serveur à partir des calculs du dossier ; seul le directeur de la mission le valide, et un bilan validé est figé.";
export const TEXTE_CLOTURE_AUCUN =
  "Aucun bilan de clôture pour l'instant. Établissez-en un depuis l'état courant du dossier : les contrôles de complétude indiqueront ce qu'il reste à renseigner.";
export const TEXTE_CLOTURE_EVOLUTION =
  "Une évolution est un constat sur l'écart entre l'ouverture et la fin ; elle ne qualifie pas la situation du client.";
export const TEXTE_CLOTURE_VALIDE =
  "Bilan validé : il est figé. Les rapports de clôture se génèrent à partir de cette version.";
export const TEXTE_CLOTURE_RAPPORT_NON_VALIDE =
  "Le rapport de clôture se génère seulement à partir d'un bilan validé.";
export const TEXTE_CLOTURE_RAPPORT_CLOTUREE =
  "La mission est clôturée : la génération est désactivée. Les rapports déjà générés restent téléchargeables.";
export const TEXTE_CLOTURE_PERIMEE =
  "Le dossier a changé depuis la construction de ce bilan : il ne peut plus être validé.";
export const TEXTE_CLOTURE_LECTURE_SEULE =
  "Lecture seule : le bilan se construit tant que le dossier n'est pas clos.";
export const TEXTE_RENOTATION_NON_COMPARABLE =
  "La comparaison suppose deux versions publiées de la notation de la mission : sans elles, aucun écart n'est affiché.";

/** Textes fixes de l'onglet, dans la langue demandée (le français reste celui des constantes). */
export function textesCloture(langue: Langue = "fr") {
  const t = creerTraduire(langue);
  return {
    intro: t(
      TEXTE_CLOTURE_INTRO,
      "The close-out review compares the state of the file at opening and at the end. It is built by the server from the file's computations; only the engagement director approves it, and an approved review is frozen.",
    ),
    aucun: t(
      TEXTE_CLOTURE_AUCUN,
      "No close-out review yet. Create one from the current state of the file: the completeness checks will show what is still to be filled in.",
    ),
    evolution: t(
      TEXTE_CLOTURE_EVOLUTION,
      "A change is an observation on the gap between opening and end; it does not characterize the client's situation.",
    ),
    valide: t(
      TEXTE_CLOTURE_VALIDE,
      "Review approved: it is frozen. Close-out reports are generated from this version.",
    ),
    rapportNonValide: t(
      TEXTE_CLOTURE_RAPPORT_NON_VALIDE,
      "The close-out report can only be generated from an approved review.",
    ),
    rapportCloturee: t(
      TEXTE_CLOTURE_RAPPORT_CLOTUREE,
      "The engagement is closed: generation is disabled. Reports already generated remain available for download.",
    ),
    perimee: t(
      TEXTE_CLOTURE_PERIMEE,
      "The file has changed since this review was built: it can no longer be approved.",
    ),
    lectureSeule: t(
      TEXTE_CLOTURE_LECTURE_SEULE,
      "Read-only: the review can be built as long as the file is not closed.",
    ),
    renotationNonComparable: t(
      TEXTE_RENOTATION_NON_COMPARABLE,
      "The comparison requires two published versions of the engagement's rating: without them, no gap is shown.",
    ),
  };
}

const STATUT_CLOTURE_EN: Record<RedStatutCloture, string> = {
  brouillon: "Draft",
  valide: "Approved",
};
const EVOLUTION_EN: Record<RedEvolutionCloture, string> = {
  amelioration: "Improvement",
  degradation: "Deterioration",
  stable: "Stable",
  non_comparable: "Not comparable",
};
const CHANGEMENT_CLASSE_EN: Record<RedChangementClasse, string> = {
  amelioration: "Class improved",
  degradation: "Class lowered",
  inchangee: "Class unchanged",
  non_comparable: "Not comparable",
};
const STATUT_RENOTATION_EN: Record<RedStatutReNotation, string> = {
  compare: "Two published versions compared",
  une_seule_version: "Only one published version: no comparison",
  aucune_version_publiee: "No published version of the rating",
};
const CONTROLES_EN: Record<string, string> = {
  ratios_fin: "At least one accepted fiscal year (end state)",
  alerte_fin: "A computed alert score (end state)",
  urgence_fin: "A recorded urgency assessment (end state)",
  tresorerie_fin: "A 13-week cash forecast (end state)",
  plan_present: "A plan with at least one action",
  causes_validees: "A root-cause map approved by a consultant",
  ouverture_comparable: "An opening state distinct from the end state (ratios, alert, urgency)",
  creanciers_saisis: "Creditors entered",
  checklists_saisies: "Checklists filled in",
  covenants_definis: "Covenants defined",
  notation_comparable: "Two published versions of the engagement rating",
};
const RATIO_EN: Record<string, string> = {
  liquidite_generale: "Current ratio",
  liquidite_reduite: "Quick ratio",
  liquidite_immediate: "Cash ratio",
  autonomie_financiere: "Financial autonomy",
  solvabilite_generale: "General solvency",
  endettement: "Debt ratio",
  marge_brute: "Gross margin",
  marge_nette: "Net margin",
  couverture_charges_financieres: "Financial charges coverage",
  bfr_jours: "Working capital need in days of revenue",
};

export const libelleStatutCloture = (s: RedStatutCloture, langue: Langue = "fr") =>
  langue === "en" ? (STATUT_CLOTURE_EN[s] ?? s) : (RED_STATUT_CLOTURE_LIBELLES[s] ?? s);
export const libelleEvolution = (e: RedEvolutionCloture, langue: Langue = "fr") =>
  langue === "en" ? (EVOLUTION_EN[e] ?? e) : (RED_EVOLUTION_CLOTURE_LIBELLES[e] ?? e);
export const libelleChangementClasse = (c: RedChangementClasse, langue: Langue = "fr") =>
  langue === "en" ? (CHANGEMENT_CLASSE_EN[c] ?? c) : (RED_CHANGEMENT_CLASSE_LIBELLES[c] ?? c);
export const libelleStatutReNotation = (s: RedStatutReNotation, langue: Langue = "fr") =>
  langue === "en" ? (STATUT_RENOTATION_EN[s] ?? s) : (RED_STATUT_RENOTATION_LIBELLES[s] ?? s);

/** Libellé d'un code de contrôle (repli : le code lui-même). */
export function libelleControle(code: string, langue: Langue = "fr"): string {
  if (langue === "en") return CONTROLES_EN[code] ?? code;
  return RED_CONTROLES_CLOTURE.find((c) => c.code === code)?.libelle ?? code;
}

export function tonaliteStatutCloture(s: RedStatutCloture): TonaliteStatut {
  return s === "valide" ? "succes" : "neutre";
}

/** Une dégradation est signalée en « attention » : c'est un constat, pas un état de gravité. */
export function tonaliteEvolution(e: RedEvolutionCloture | RedChangementClasse): TonaliteStatut {
  if (e === "amelioration") return "succes";
  if (e === "degradation") return "attention";
  return "neutre";
}

// --- Mise en forme des valeurs du bilan -------------------------------------------------------------

const avecSigne = (texte: string, n: number) => (n > 0 ? `+${texte}` : texte);

/** Variation d'un score ou d'un compte : « +5 », « -3 », « 0 » ; `null` → « — ». */
export function formaterVariationEntier(
  n: number | null | undefined,
  langue: Langue = "fr",
): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return VALEUR_ABSENTE;
  return avecSigne(formaterNombre(n, 0, langue), n);
}

/** Variation de points d'alerte : « +5 points ». */
export function formaterVariationPoints(
  n: number | null | undefined,
  langue: Langue = "fr",
): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return VALEUR_ABSENTE;
  const unite = langue === "en" || Math.abs(n) > 1 ? "points" : "point";
  return `${formaterVariationEntier(n, langue)} ${unite}`;
}

/**
 * Variation d'un ratio entre l'ouverture et la fin (points de base du moteur) :
 * pourcentages en POINTS de pourcentage (250 → « +2,50 points »), rapports en écart de rapport
 * (2500 → « +0,25 »), BFR en jours.
 */
export function formaterVariationRatio(
  cle: RedCleRatio,
  variation: number | null | undefined,
  langue: Langue = "fr",
): string {
  if (typeof variation !== "number" || !Number.isFinite(variation)) return VALEUR_ABSENTE;
  const forme = FORME_RATIO[cle];
  if (forme === "jours") {
    const plusieurs = Math.abs(variation) > 1;
    const unite = langue === "en" ? (plusieurs ? "days" : "day") : plusieurs ? "jours" : "jour";
    return `${avecSigne(formaterNombre(variation, 0, langue), variation)} ${unite}`;
  }
  if (forme === "pourcentage") {
    return `${avecSigne(formaterNombre(variation / 100, 2, langue), variation)} points`;
  }
  return avecSigne(formaterNombre(variation / 10_000, 2, langue), variation);
}

export const libelleRatioCloture = (cle: RedCleRatio, langue: Langue = "fr") =>
  langue === "en" ? (RATIO_EN[cle] ?? cle) : (RED_RATIO_LIBELLES[cle] ?? cle);

/** Montant signé en unités mineures : « +1 500 000 FCFA ». */
export function formaterVariationMontant(
  n: number | null | undefined,
  devise: Devise,
  langue: Langue = "fr",
): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return VALEUR_ABSENTE;
  return avecSigne(formaterMontantMineur(n, devise, langue), n);
}

/** Score de notation en dixièmes de point : 75 → « 7,5 » ; `null` → « — ». */
export function formaterScoreDixiemes(d: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof d !== "number" || !Number.isFinite(d)) return VALEUR_ABSENTE;
  return formaterNombre(d / 10, 1, langue);
}

export function formaterEcartDixiemes(d: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof d !== "number" || !Number.isFinite(d)) return VALEUR_ABSENTE;
  return avecSigne(formaterNombre(d / 10, 1, langue), d);
}

/** « Semaine 4 » ou « Aucune » pour la première semaine de tension. */
export function libelleSemaineTension(s: number | null | undefined, langue: Langue = "fr"): string {
  if (langue === "en") return typeof s === "number" ? `week ${s}` : "none";
  return typeof s === "number" ? `semaine ${s}` : "aucune";
}

/** « 3 sur 8 » : décompte déjà calculé par le serveur. */
export const libelleSurTotal = (n: number, total: number, langue: Langue = "fr") =>
  `${formaterNombre(n, 0, langue)} ${langue === "en" ? "of" : "sur"} ${formaterNombre(total, 0, langue)}`;

// --- Messages d'erreur ------------------------------------------------------------------------------

export function manquantsDe(details: unknown): string[] {
  if (typeof details !== "object" || details === null) return [];
  const m = (details as { manquants?: unknown }).manquants;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
}

/** « Contrôles à satisfaire : Un plan avec au moins une action ; … ». */
export function messageClotureIncomplete(
  manquants: readonly string[],
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    if (manquants.length === 0)
      return "The review is incomplete: blocking checks remain to be satisfied.";
    return `The review is incomplete. Blocking checks to satisfy: ${manquants.map((m) => libelleControle(m, "en")).join("; ")}.`;
  }
  if (manquants.length === 0)
    return "Le bilan est incomplet : des contrôles bloquants restent à satisfaire.";
  return `Le bilan est incomplet. Contrôles bloquants à satisfaire : ${manquants.map((m) => libelleControle(m)).join(" ; ")}.`;
}

/** Vrai quand le bilan ne reflète plus l'état du dossier (il faut en établir un nouveau). */
export const clotureEstPerimee = (e: unknown) =>
  e instanceof ErreurApi && e.code === "RED_CLOTURE_PERIMEE";

/**
 * Message affichable (français) d'une action sur le bilan. Les refus de l'API (403, 409, 429) sont
 * déjà en français et s'affichent tels quels, sauf l'incomplétude, détaillée par contrôle.
 */
export function messageCloture(e: unknown, langue: Langue = "fr"): string {
  if (e instanceof ErreurApi) {
    if (e.code === "RED_CLOTURE_INCOMPLETE")
      return messageClotureIncomplete(manquantsDe(e.details), langue);
    if (e.code === "RED_CLOTURE_PERIMEE")
      return `${textesCloture(langue).perimee} ${e.message}`.trim();
  }
  return messageRedressement(e, langue);
}
