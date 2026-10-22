/** Plan vivant (PLA-18) : saisie et contrôle d'un réalisé, lancement d'une re-prévision. */
import {
  COMMENTAIRE_REALISE_MAX,
  EXERCICE_PLAN_VIVANT,
  METHODES_REPREVISION_PLAN,
  SEUIL_REPREVISION_PLAN,
  type MethodeReprevisionPlan,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import type { RealiseVersion } from "./plan-vivant-types";
import { lireNombre } from "./saisie";

// --- Saisie d'un réalisé ----------------------------------------------------------------------

export interface SaisieRealise {
  chiffre_affaires: string;
  ebe: string;
  resultat_net: string;
  tresorerie_fin: string;
  commentaire: string;
}

export type ChampRealise = keyof SaisieRealise;

export interface CorpsRealise {
  chiffre_affaires: number;
  ebe: number;
  resultat_net: number | null;
  tresorerie_fin: number | null;
  commentaire: string | null;
}

const FACTEUR_MINEUR: Record<Devise, number> = { XOF: 1, XAF: 1, EUR: 100, USD: 100 };

/**
 * Montant saisi (unités usuelles, signe admis) → entier en unités mineures. `null` si vide ;
 * `Number.NaN` si illisible, trop précis pour la devise ou hors des entiers sûrs.
 */
export function lireMontantSigne(v: string, devise: Devise): number | null {
  const n = lireNombre(v);
  if (n === null) return null;
  if (Number.isNaN(n)) return Number.NaN;
  const facteur = FACTEUR_MINEUR[devise];
  const mineur = Math.round(n * facteur);
  if (Math.abs(n * facteur - mineur) > 1e-6 || !Number.isSafeInteger(mineur)) return Number.NaN;
  // -0 → 0 : un zéro négatif ne part pas à l'API.
  return mineur === 0 ? 0 : mineur;
}

/** Aide à la saisie d'un montant de la devise du plan. */
export const aideSaisieMontant = (devise: Devise) =>
  FACTEUR_MINEUR[devise] === 1
    ? "Montant entier, sans décimale (ex. 150 000)."
    : "Deux décimales au plus (ex. 1 500,50).";

/** Montant de l'API → texte modifiable à la française (« 150000 », « -1500,5 »). */
export function realiseVersSaisie(mineur: number | null | undefined, devise: Devise): string {
  if (mineur === null || mineur === undefined) return "";
  return String(mineur / FACTEUR_MINEUR[devise]).replace(".", ",");
}

export function saisieDepuisRealise(r: RealiseVersion | null, devise: Devise): SaisieRealise {
  return {
    chiffre_affaires: realiseVersSaisie(r?.chiffre_affaires, devise),
    ebe: realiseVersSaisie(r?.ebe, devise),
    resultat_net: realiseVersSaisie(r?.resultat_net, devise),
    tresorerie_fin: realiseVersSaisie(r?.tresorerie_fin, devise),
    commentaire: r?.commentaire ?? "",
  };
}

const MESSAGE_MONTANT = (devise: Devise) =>
  FACTEUR_MINEUR[devise] === 1
    ? "Montant entier, sans décimale (ex. 150 000)."
    : "Montant avec deux décimales au plus (ex. 1 500,50).";

/** Contrôle d'un réalisé (mêmes règles que l'API) ; `corps` est nul s'il reste une erreur. */
export function validerRealise(
  s: SaisieRealise,
  devise: Devise,
): { erreurs: Partial<Record<ChampRealise, string>>; corps: CorpsRealise | null } {
  const erreurs: Partial<Record<ChampRealise, string>> = {};
  const ca = lireMontantSigne(s.chiffre_affaires, devise);
  if (ca === null) erreurs.chiffre_affaires = "Le chiffre d'affaires réalisé est obligatoire.";
  else if (Number.isNaN(ca)) erreurs.chiffre_affaires = MESSAGE_MONTANT(devise);
  else if (ca < 0) erreurs.chiffre_affaires = "Le chiffre d'affaires ne peut pas être négatif.";
  const ebe = lireMontantSigne(s.ebe, devise);
  if (ebe === null) erreurs.ebe = "L'EBE réalisé est obligatoire (négatif si perte).";
  else if (Number.isNaN(ebe)) erreurs.ebe = MESSAGE_MONTANT(devise);
  const rn = lireMontantSigne(s.resultat_net, devise);
  if (rn !== null && Number.isNaN(rn)) erreurs.resultat_net = MESSAGE_MONTANT(devise);
  const tr = lireMontantSigne(s.tresorerie_fin, devise);
  if (tr !== null && Number.isNaN(tr)) erreurs.tresorerie_fin = MESSAGE_MONTANT(devise);
  const commentaire = s.commentaire.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(commentaire)) {
    erreurs.commentaire = "Le commentaire contient un caractère de contrôle.";
  } else if (commentaire.length > COMMENTAIRE_REALISE_MAX) {
    erreurs.commentaire = `Le commentaire compte au plus ${COMMENTAIRE_REALISE_MAX} caractères.`;
  }
  if (Object.keys(erreurs).length > 0 || ca === null || ebe === null) {
    return { erreurs, corps: null };
  }
  return {
    erreurs,
    corps: {
      chiffre_affaires: ca,
      ebe,
      resultat_net: rn,
      tresorerie_fin: tr,
      commentaire: commentaire === "" ? null : commentaire,
    },
  };
}

/** Trimestres proposés à la saisie : ceux déjà saisis, plus le suivant (dans l'ordre, sans trou). */
export function trimestresSaisissables(saisis: readonly number[]): number[] {
  const dernier = saisis.reduce((m, t) => Math.max(m, t), 0);
  return Array.from({ length: Math.min(4, dernier + 1) }, (_, i) => i + 1);
}

// --- Lancement d'une re-prévision -------------------------------------------------------------

export interface SaisieReprevision {
  version: string;
  methode: string;
  /** Seuil de « significatif » en pourcentage (ex. « 10 » ou « 7,5 »). */
  seuil: string;
}

export interface CorpsReprevision {
  version: number;
  exercice: number;
  methode: MethodeReprevisionPlan;
  seuil: number;
}

/** Seuil par défaut, en pourcentage. */
export const SEUIL_DEFAUT_POURCENT = String(SEUIL_REPREVISION_PLAN.defaut / 10);

export function validerReprevision(
  s: SaisieReprevision,
  exercice: number,
): { erreurs: Partial<Record<keyof SaisieReprevision, string>>; corps: CorpsReprevision | null } {
  const erreurs: Partial<Record<keyof SaisieReprevision, string>> = {};
  const version = lireNombre(s.version);
  if (version === null || !Number.isInteger(version) || version < 1) {
    erreurs.version = "Choisissez une version validée du modèle financier.";
  }
  if (!(METHODES_REPREVISION_PLAN as readonly string[]).includes(s.methode)) {
    erreurs.methode = "Choisissez une méthode de re-prévision.";
  }
  const pourcent = lireNombre(s.seuil);
  const pourMille = pourcent === null || Number.isNaN(pourcent) ? NaN : Math.round(pourcent * 10);
  if (
    pourcent === null ||
    Number.isNaN(pourcent) ||
    Math.abs(pourcent * 10 - pourMille) > 1e-6 ||
    pourMille < SEUIL_REPREVISION_PLAN.min ||
    pourMille > SEUIL_REPREVISION_PLAN.max
  ) {
    erreurs.seuil = "Seuil de 0,1 % à 100 %, avec une décimale au plus.";
  }
  if (
    !Number.isInteger(exercice) ||
    exercice < EXERCICE_PLAN_VIVANT.min ||
    exercice > EXERCICE_PLAN_VIVANT.max
  ) {
    erreurs.version = erreurs.version ?? "Choisissez un exercice.";
  }
  if (Object.keys(erreurs).length > 0 || version === null) return { erreurs, corps: null };
  return {
    erreurs,
    corps: {
      version,
      exercice,
      methode: s.methode as MethodeReprevisionPlan,
      seuil: pourMille,
    },
  };
}
