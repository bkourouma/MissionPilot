/**
 * Brouillons d'extraction de l'ingestion (lot 6, ADR-009) : lecture IA d'un document de due diligence
 * (DD-02, DD-10) et proposition d'amorçage du standard (STD-13). Aides PURES du web : statuts,
 * retrait d'un élément, droits d'affichage, validité d'une décision, résultat appliqué. L'API reste
 * seule juge (droits, séparation des tâches, vérification des extraits et des nombres dans la page) ;
 * le web ne calcule aucun chiffre et ne décide rien.
 */
import {
  aPermission,
  creerTraduire,
  LIBELLES_ELEMENT_LECTURE,
  TYPE_ELEMENT_LIBELLES,
  type ContenuLecture,
  type ContenuProposition,
  type Langue,
  type Role,
  type StatutExtraction,
  type TypeElementLecture,
  type TypeElementMethode,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { DecisionExtraction } from "./ingestion-api";
import type { DocumentIngestion, ExtractionIngestion } from "./ingestion";

// --- Statuts ---------------------------------------------------------------------------------

export const TONALITE_STATUT_EXTRACTION: Record<StatutExtraction, TonaliteStatut> = {
  brouillon_ia: "attention",
  modifie: "attention",
  valide: "succes",
  rejete: "neutre",
};

/** Brouillon encore ouvert (pas tranché) : il se corrige, se valide ou se rejette. */
export const extractionOuverte = (statut: StatutExtraction): boolean =>
  statut === "brouillon_ia" || statut === "modifie";

/** Extraction la plus récente (l'API les range de la plus récente à la plus ancienne). */
export const extractionCourante = (
  extractions: readonly ExtractionIngestion[],
): ExtractionIngestion | null => extractions[0] ?? null;

// --- Lecture d'un document (DD-02, DD-10) ----------------------------------------------------

const LIBELLES_ELEMENT_LECTURE_EN: Record<string, string> = {
  fait: "Fact",
  risque: "Risk",
  chiffre: "Figure",
  engagement: "Commitment",
  autre: "Other",
};

export function libelleTypeElementLecture(t: string, langue: Langue = "fr"): string {
  const table = langue === "en" ? LIBELLES_ELEMENT_LECTURE_EN : LIBELLES_ELEMENT_LECTURE;
  return (table as Record<string, string>)[t as TypeElementLecture] ?? t;
}

/** Texte du badge de vérification : le sens est écrit, la couleur ne le porte jamais seule. */
export function libelleVerification(verifie: boolean, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  return verifie
    ? t("Vérifié dans la page", "Verified in the page")
    : t("NON retrouvé dans la page", "NOT found in the page");
}

export const compterNonVerifies = (c: Pick<ContenuLecture, "elements">): number =>
  c.elements.filter((e) => !e.verifie).length;

/** Contenu sans l'élément d'indice `index` (le contenu d'origine n'est pas modifié). */
export function retirerElementLecture(c: ContenuLecture, index: number): ContenuLecture {
  if (!Number.isInteger(index) || index < 0 || index >= c.elements.length) return c;
  return { ...c, elements: c.elements.filter((_, i) => i !== index) };
}

export const ENONCE_MAX = 500;

/** Message si l'énoncé est inacceptable (vide ou trop long), sinon null. */
export function erreurEnonce(enonce: string, langue: Langue = "fr"): string | null {
  const t = creerTraduire(langue);
  const e = enonce.trim();
  if (e === "") return t("L'énoncé ne peut pas être vide.", "The statement cannot be empty.");
  if (e.length > ENONCE_MAX)
    return t(
      `L'énoncé est limité à ${ENONCE_MAX} caractères.`,
      `The statement is limited to ${ENONCE_MAX} characters.`,
    );
  return null;
}

/**
 * Contenu dont l'énoncé de l'élément `index` est remplacé. Le champ `verifie` est conservé tel quel :
 * le serveur le recalcule à l'enregistrement (extrait et nombres retrouvés dans la page citée).
 */
export function modifierEnonceLecture(
  c: ContenuLecture,
  index: number,
  enonce: string,
): ContenuLecture {
  if (!Number.isInteger(index) || index < 0 || index >= c.elements.length) return c;
  if (erreurEnonce(enonce) !== null) return c;
  return {
    ...c,
    elements: c.elements.map((e, i) => (i === index ? { ...e, enonce: enonce.trim() } : e)),
  };
}

// --- Proposition de standard (STD-13) --------------------------------------------------------

export const FAMILLES_PROPOSITION = ["etapes", "briques", "elements", "rubriques"] as const;
export type FamilleProposition = (typeof FAMILLES_PROPOSITION)[number];

export const LIBELLES_FAMILLE_PROPOSITION: Record<FamilleProposition, string> = {
  etapes: "Étapes",
  briques: "Briques",
  elements: "Éléments",
  rubriques: "Rubriques de notation",
};

export const LIBELLES_FAMILLE_PROPOSITION_EN: Record<FamilleProposition, string> = {
  etapes: "Steps",
  briques: "Building blocks",
  elements: "Elements",
  rubriques: "Rating criteria",
};
export const libelleFamilleProposition = (f: FamilleProposition, langue: Langue = "fr"): string =>
  (langue === "en" ? LIBELLES_FAMILLE_PROPOSITION_EN : LIBELLES_FAMILLE_PROPOSITION)[f];

const TYPE_ELEMENT_LIBELLES_EN: Record<string, string> = {
  livrable: "Deliverable",
  item: "Item",
  kpi_type: "KPI type",
  initiative_type: "Initiative type",
  risque_type: "Risk type",
  gabarit: "Template",
  automatisation: "Automation",
};

export function libelleTypeElementMethode(t: string, langue: Langue = "fr"): string {
  const table = langue === "en" ? TYPE_ELEMENT_LIBELLES_EN : TYPE_ELEMENT_LIBELLES;
  return (table as Record<string, string>)[t as TypeElementMethode] ?? t;
}

export function compterProposition(c: ContenuProposition): Record<FamilleProposition, number> {
  return {
    etapes: c.etapes.length,
    briques: c.briques.length,
    elements: c.elements.length,
    rubriques: c.rubriques.length,
  };
}

export const totalProposition = (c: ContenuProposition): number =>
  FAMILLES_PROPOSITION.reduce((n, f) => n + c[f].length, 0);

/** Contenu sans l'élément d'indice `index` de la famille (le contenu d'origine n'est pas modifié). */
export function retirerDeProposition(
  c: ContenuProposition,
  famille: FamilleProposition,
  index: number,
): ContenuProposition {
  const liste = c[famille];
  if (!Number.isInteger(index) || index < 0 || index >= liste.length) return c;
  return { ...c, [famille]: liste.filter((_, i) => i !== index) } as ContenuProposition;
}

// --- Relance ---------------------------------------------------------------------------------

/**
 * Relance possible (miroir de l'API, qui reste juge) : document terminé, aucun brouillon ouvert, et
 * IA indisponible ou rien trouvé ou dernier brouillon rejeté. Pour le standard, l'état « rien
 * trouvé » ou « IA indisponible » ne compte que s'il n'existe encore aucune extraction.
 */
export function relancePossible(
  domaine: "dd" | "standard",
  doc: Pick<DocumentIngestion, "statut" | "resultat">,
  extractions: readonly Pick<ExtractionIngestion, "statut">[],
): boolean {
  if (doc.statut !== "termine") return false;
  if (extractions.some((x) => extractionOuverte(x.statut))) return false;
  const sansResultat = doc.resultat === "ia_indisponible" || doc.resultat === "rien_trouve";
  const dernierRejete = extractions[0]?.statut === "rejete";
  if (domaine === "dd") return sansResultat || dernierRejete;
  return extractions.length === 0 ? sansResultat : dernierRejete;
}

// --- Droits d'affichage ----------------------------------------------------------------------

/** Confort d'affichage seulement : l'API vérifie chaque droit. */
export interface DroitsIngestion {
  /** Téléverser un document. */
  televerser: boolean;
  /** Corriger un brouillon (retrait d'élément, énoncé). */
  corriger: boolean;
  /** Relancer la lecture (droit d'écriture ET d'usage de l'IA). */
  relancer: boolean;
  /** Valider ou rejeter. */
  decider: boolean;
  /** La validation peut aboutir (STD-13 : la version cible doit être un brouillon). */
  validerPossible: boolean;
}

export function droitsIngestionDd(
  roles: readonly Role[],
  mission?: { statut: string },
): DroitsIngestion {
  const ouverte = mission?.statut !== "cloturee";
  const ecrire = aPermission(roles, "dd.ecrire") && ouverte;
  const valider = aPermission(roles, "dd.valider") && ouverte;
  return {
    televerser: ecrire,
    corriger: ecrire,
    relancer: ecrire && aPermission(roles, "ia.utiliser"),
    decider: valider,
    validerPossible: valider,
  };
}

export function droitsIngestionStandard(
  roles: readonly Role[],
  versionBrouillon: boolean,
): DroitsIngestion {
  const gerer = aPermission(roles, "standard.gerer");
  return {
    televerser: gerer && versionBrouillon,
    corriger: gerer,
    relancer: gerer && versionBrouillon && aPermission(roles, "ia.utiliser"),
    decider: gerer,
    validerPossible: gerer && versionBrouillon,
  };
}

// --- Décision --------------------------------------------------------------------------------

export const MOTIF_REJET_MAX = 1000;

export interface SaisieDecision {
  decision: "validee" | "rejetee";
  motif: string;
  /** « J'ai relu les éléments non retrouvés dans la source. » */
  acquitte: boolean;
  /** Le brouillon contient des éléments non vérifiés dans la source. */
  nonVerifies: boolean;
}

/** Message si la décision est incomplète (motif de rejet, acquittement), sinon null. */
export function erreurDecision(s: SaisieDecision, langue: Langue = "fr"): string | null {
  const t = creerTraduire(langue);
  if (s.decision === "rejetee") {
    const m = s.motif.trim();
    if (m === "") return t("Précisez le motif du rejet.", "Specify the reason for rejection.");
    if (m.length > MOTIF_REJET_MAX)
      return t(
        `Le motif est limité à ${MOTIF_REJET_MAX} caractères.`,
        `The reason is limited to ${MOTIF_REJET_MAX} characters.`,
      );
    return null;
  }
  if (s.nonVerifies && !s.acquitte) {
    return t(
      "Cochez la case pour confirmer que vous avez relu les éléments non retrouvés dans la source.",
      "Tick the box to confirm that you have reviewed the elements not found in the source.",
    );
  }
  return null;
}

/** Corps de la requête de décision (l'acquittement n'est envoyé que s'il est nécessaire et donné). */
export function corpsDecision(s: SaisieDecision): DecisionExtraction {
  if (s.decision === "rejetee") return { decision: "rejetee", motif: s.motif.trim() };
  return s.nonVerifies && s.acquitte
    ? { decision: "validee", acquitte_chiffres: true }
    : { decision: "validee" };
}

// --- Résultat appliqué (STD-13) --------------------------------------------------------------

export interface ResultatApplicationVue {
  crees: { etapes: number; briques: number; elements: number; rubriques: number };
  ignores: { famille: string; code: string; motif: string }[];
}

const nombre = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Relit prudemment le `resultat` d'une proposition validée ; null s'il n'a pas la forme attendue. */
export function lireResultatApplication(
  resultat: Record<string, unknown> | null | undefined,
): ResultatApplicationVue | null {
  if (!resultat || typeof resultat.crees !== "object" || resultat.crees === null) return null;
  const c = resultat.crees as Record<string, unknown>;
  const ignores = Array.isArray(resultat.ignores) ? resultat.ignores : [];
  return {
    crees: {
      etapes: nombre(c.etapes),
      briques: nombre(c.briques),
      elements: nombre(c.elements),
      rubriques: nombre(c.rubriques),
    },
    ignores: ignores.flatMap((i: unknown) => {
      if (typeof i !== "object" || i === null) return [];
      const l = i as Record<string, unknown>;
      return typeof l.famille === "string" && typeof l.code === "string"
        ? [{ famille: l.famille, code: l.code, motif: typeof l.motif === "string" ? l.motif : "" }]
        : [];
    }),
  };
}

const LIBELLES_FAMILLE_APPLICATION: Record<string, string> = {
  etape: "Étape",
  brique: "Brique",
  element: "Élément",
  rubrique: "Rubrique",
};

const LIBELLES_MOTIF_IGNORE: Record<string, string> = {
  code_existant: "ce code existe déjà dans la méthode (non écrasé)",
  etape_introuvable: "l'étape de rattachement est introuvable dans la méthode",
  invalide: "contenu refusé par l'éditeur de méthodes",
};

const LIBELLES_FAMILLE_APPLICATION_EN: Record<string, string> = {
  etape: "Step",
  brique: "Building block",
  element: "Element",
  rubrique: "Criterion",
};

const LIBELLES_MOTIF_IGNORE_EN: Record<string, string> = {
  code_existant: "this code already exists in the method (not overwritten)",
  etape_introuvable: "the parent step cannot be found in the method",
  invalide: "content rejected by the method editor",
};

export const libelleFamilleApplication = (f: string, langue: Langue = "fr"): string =>
  (langue === "en" ? LIBELLES_FAMILLE_APPLICATION_EN : LIBELLES_FAMILLE_APPLICATION)[f] ?? f;
export const libelleMotifIgnore = (m: string, langue: Langue = "fr"): string =>
  (langue === "en" ? LIBELLES_MOTIF_IGNORE_EN : LIBELLES_MOTIF_IGNORE)[m] ??
  creerTraduire(langue)("non appliqué", "not applied");

/** Total d'éléments créés, pour l'annonce du résultat. */
export const totalCrees = (r: ResultatApplicationVue): number =>
  r.crees.etapes + r.crees.briques + r.crees.elements + r.crees.rubriques;
