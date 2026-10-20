/**
 * Hypothèses et verdicts (DD-09, SPEC-3b §5.5) : indication de verdict à partir de la solidité
 * des assertions liées, et contrôle de l'arbre d'hypothèses. Le moteur INDIQUE ; le verdict est
 * une décision humaine, validée par un tiers (« l'IA propose, l'expert dispose » étendu aux
 * moteurs d'indication). Seuils provisoires (DECISIONS.md).
 */
import type { LectureSolidite } from "../preuves/solidite";
import { ErreurDueDiligence } from "./erreurs";
import type { VerdictDd } from "./vocabulaire";

export const MIN_ASSERTIONS_SOUTIEN_PAR_DEFAUT = 2;
export const HYPOTHESES_PROFONDEUR_MAX = 4;

const MIN_SOUTIEN_BORNES = { min: 1, max: 20 } as const;
const LECTURES_VALIDES: readonly LectureSolidite[] = ["solide", "etayee", "fragile"];

export interface AssertionDeHypothese {
  readonly id: string;
  readonly sens: "soutient" | "contredit";
  /** « solide » ≥ 0,75, « etayee » ≥ 0,5, « fragile » en dessous (moteur des preuves). */
  readonly lecture: LectureSolidite;
}
export interface ParametresVerdict {
  /** Entier de 1 à 20. */
  readonly minAssertionsSoutien: number;
}
export type RaisonVerdict =
  | "AUCUNE_ASSERTION"
  | "CONTRE_SOLIDE_SANS_SOUTIEN_SOLIDE"
  | "CONFLIT_SOLIDE"
  | "CONTRE_ETAYE_OU_SOLIDE"
  | "SOUTIEN_SUFFISANT_SANS_CONTRE"
  | "SOUTIEN_INSUFFISANT";
export interface IndicationVerdict {
  readonly indication: VerdictDd;
  readonly raison: RaisonVerdict;
  readonly conflit: boolean;
  readonly soutien: Readonly<Record<LectureSolidite, number>>;
  readonly contre: Readonly<Record<LectureSolidite, number>>;
}

function entree(message: string): never {
  throw new ErreurDueDiligence("ENTREE_INVALIDE", message);
}

/**
 * Règle, dans cet ordre (S, E = soutiens solides et étayés ; Cs, Ce = contre solides et étayés) :
 * 1. aucune assertion → non concluante ;
 * 2. Cs ≥ 1 et S = 0 → infirmée ;
 * 3. S ≥ 1 et Cs ≥ 1 → non concluante (conflit) ;
 * 4. Ce ≥ 1 → non concluante ;
 * 5. S ≥ 1 et S + E ≥ minimum → confirmée ;
 * 6. sinon non concluante.
 * Les assertions fragiles ne comptent pour aucun verdict (elles figurent dans les décomptes).
 */
export function indicationVerdict(
  assertions: readonly AssertionDeHypothese[],
  parametres: ParametresVerdict = { minAssertionsSoutien: MIN_ASSERTIONS_SOUTIEN_PAR_DEFAUT },
): IndicationVerdict {
  const min = parametres.minAssertionsSoutien;
  if (!Number.isInteger(min) || min < MIN_SOUTIEN_BORNES.min || min > MIN_SOUTIEN_BORNES.max) {
    throw new ErreurDueDiligence(
      "PARAMETRE_INVALIDE",
      "minAssertionsSoutien : entier de 1 à 20 attendu.",
    );
  }
  const ids = new Set<string>();
  const soutien = { solide: 0, etayee: 0, fragile: 0 };
  const contre = { solide: 0, etayee: 0, fragile: 0 };
  for (const a of assertions) {
    if (ids.has(a.id)) entree(`Assertion « ${a.id} » en double.`);
    ids.add(a.id);
    if (a.sens !== "soutient" && a.sens !== "contredit") {
      entree(`Sens inconnu : « ${String(a.sens)} ».`);
    }
    if (!LECTURES_VALIDES.includes(a.lecture)) {
      entree(`Lecture de solidité inconnue : « ${String(a.lecture)} ».`);
    }
    (a.sens === "soutient" ? soutien : contre)[a.lecture] += 1;
  }

  const resultat = (
    indication: VerdictDd,
    raison: RaisonVerdict,
    conflit = false,
  ): IndicationVerdict => ({ indication, raison, conflit, soutien, contre });

  if (assertions.length === 0) return resultat("non_concluante", "AUCUNE_ASSERTION");
  if (contre.solide >= 1 && soutien.solide === 0) {
    return resultat("infirmee", "CONTRE_SOLIDE_SANS_SOUTIEN_SOLIDE");
  }
  if (soutien.solide >= 1 && contre.solide >= 1) {
    return resultat("non_concluante", "CONFLIT_SOLIDE", true);
  }
  if (contre.etayee >= 1) return resultat("non_concluante", "CONTRE_ETAYE_OU_SOLIDE");
  if (soutien.solide >= 1 && soutien.solide + soutien.etayee >= min) {
    return resultat("confirmee", "SOUTIEN_SUFFISANT_SANS_CONTRE");
  }
  return resultat("non_concluante", "SOUTIEN_INSUFFISANT");
}

export interface NoeudHypothese {
  readonly id: string;
  readonly parentId: string | null;
  readonly retiree: boolean;
  readonly verdict: VerdictDd | null;
  readonly enAttente: boolean;
}
export type CodeIncoherenceArbre =
  "PARENT_CONFIRME_ENFANT_INFIRME" | "PARENT_INFIRME_TOUS_ENFANTS_CONFIRMES";
export type EtatNoeudHypothese =
  "confirmee" | "infirmee" | "non_concluante" | "ouverte" | "en_attente";
export interface ControleArbre {
  /** Nœuds actifs (un descendant d'un nœud retiré est retiré). */
  readonly total: number;
  readonly racines: number;
  readonly profondeurMax: number;
  readonly parEtat: Readonly<Record<EtatNoeudHypothese, number>>;
  /** Tri par id. */
  readonly incoherences: readonly { noeud: string; code: CodeIncoherenceArbre }[];
}

function arbre(message: string): never {
  throw new ErreurDueDiligence("ARBRE_INVALIDE", message);
}

function etatDuNoeud(n: NoeudHypothese): EtatNoeudHypothese {
  return n.verdict ?? (n.enAttente ? "en_attente" : "ouverte");
}

export function controlerArbreHypotheses(noeuds: readonly NoeudHypothese[]): ControleArbre {
  const parId = new Map<string, NoeudHypothese>();
  for (const n of noeuds) {
    if (parId.has(n.id)) arbre(`Hypothèse « ${n.id} » en double.`);
    parId.set(n.id, n);
  }
  for (const n of noeuds) {
    if (n.parentId !== null && !parId.has(n.parentId)) {
      arbre(`Hypothèse « ${n.id} » : parent « ${n.parentId} » inconnu.`);
    }
  }

  // Profondeur (racine = 1) et retrait hérité, avec détection de cycle.
  const profondeurs = new Map<string, number>();
  const retirees = new Map<string, boolean>();
  for (const n of noeuds) {
    let profondeur = 0;
    let retire = false;
    const vus = new Set<string>();
    let courant: NoeudHypothese | undefined = n;
    while (courant !== undefined) {
      if (vus.has(courant.id)) arbre(`Hypothèse « ${n.id} » : cycle dans l'arbre.`);
      vus.add(courant.id);
      profondeur += 1;
      retire = retire || courant.retiree;
      courant = courant.parentId === null ? undefined : parId.get(courant.parentId);
    }
    if (profondeur > HYPOTHESES_PROFONDEUR_MAX) {
      arbre(`Hypothèse « ${n.id} » : profondeur maximale ${HYPOTHESES_PROFONDEUR_MAX} dépassée.`);
    }
    profondeurs.set(n.id, profondeur);
    retirees.set(n.id, retire);
  }

  const actifs = noeuds.filter((n) => retirees.get(n.id) !== true);
  const parEtat = { confirmee: 0, infirmee: 0, non_concluante: 0, ouverte: 0, en_attente: 0 };
  for (const n of actifs) parEtat[etatDuNoeud(n)] += 1;

  const incoherences: { noeud: string; code: CodeIncoherenceArbre }[] = [];
  for (const n of actifs) {
    const enfants = actifs.filter((e) => e.parentId === n.id).map(etatDuNoeud);
    const etat = etatDuNoeud(n);
    if (etat === "confirmee" && enfants.includes("infirmee")) {
      incoherences.push({ noeud: n.id, code: "PARENT_CONFIRME_ENFANT_INFIRME" });
    } else if (
      etat === "infirmee" &&
      enfants.length > 0 &&
      enfants.every((e) => e === "confirmee")
    ) {
      incoherences.push({ noeud: n.id, code: "PARENT_INFIRME_TOUS_ENFANTS_CONFIRMES" });
    }
  }
  incoherences.sort((a, b) => (a.noeud < b.noeud ? -1 : a.noeud > b.noeud ? 1 : 0));

  return {
    total: actifs.length,
    racines: actifs.filter((n) => n.parentId === null).length,
    profondeurMax: actifs.reduce((m, n) => Math.max(m, profondeurs.get(n.id) ?? 0), 0),
    parEtat,
    incoherences,
  };
}
