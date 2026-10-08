/**
 * Niveaux d'autonomie de l'IA N0 à N4, par brique et par cabinet (AGT-03,
 * PRD complémentaire §7.1, DECISIONS.md du 2026-10-08).
 *
 * | Niveau | Comportement                                                    |
 * | ------ | --------------------------------------------------------------- |
 * | N0     | pas d'IA                                                        |
 * | N1     | suggestion à la demande                                         |
 * | N2     | brouillon automatique, validation obligatoire avant tout usage  |
 * | N3     | exécution automatique interne, contrôle par échantillonnage     |
 * | N4     | exécution automatique y compris vers le client                  |
 *
 * Règles :
 * - niveau effectif = min(plafond de la brique, niveau accordé par le cabinet) ;
 * - N4 est réservé aux briques de classe R0 (ni conclusion, ni chiffre) et
 *   tombe à N3 sinon ; le coupe-circuit du cabinet le ramène aussi à N3 ;
 * - promotion N2 → N3 : au moins 50 exécutions au niveau actuel, au moins
 *   95 % acceptées sans modification majeure, aucun incident majeur sur
 *   90 jours. Le moteur dit seulement « éligible » : la promotion exige la
 *   DÉCISION d'un associé, enregistrée ailleurs ;
 * - le premier incident majeur ramène automatiquement une brique N3 ou N4 à
 *   N2 (validation humaine de nouveau obligatoire).
 *
 * Pur : pas d'horloge (la date de référence est un paramètre), comptages en
 * entiers, taux comparés par produits croisés.
 */
import { arrondirRatio } from "../commun/ratio";
import { analyserDateISO, type DateISO } from "../commun/dates";
import { estClasseRisque, type ClasseRisque } from "../qualite/classes";
import { ErreurAutonomie } from "./erreurs";

export const NIVEAUX_AUTONOMIE = ["N0", "N1", "N2", "N3", "N4"] as const;
export type NiveauAutonomie = (typeof NIVEAUX_AUTONOMIE)[number];

export function estNiveauAutonomie(valeur: unknown): valeur is NiveauAutonomie {
  return typeof valeur === "string" && (NIVEAUX_AUTONOMIE as readonly string[]).includes(valeur);
}

/** Rang du niveau (N0 → 0, N4 → 4). */
export function rangNiveauAutonomie(niveau: NiveauAutonomie): number {
  return NIVEAUX_AUTONOMIE.indexOf(niveau);
}

function verifierNiveau(niveau: unknown, quoi: string): asserts niveau is NiveauAutonomie {
  if (!estNiveauAutonomie(niveau)) {
    throw new ErreurAutonomie("NIVEAU_INVALIDE", `Niveau d'autonomie ${quoi} inconnu (N0 à N4).`);
  }
}

function minNiveau(a: NiveauAutonomie, b: NiveauAutonomie): NiveauAutonomie {
  return rangNiveauAutonomie(a) <= rangNiveauAutonomie(b) ? a : b;
}

// ---------------------------------------------------------------------------
// Niveau effectif
// ---------------------------------------------------------------------------

/** Ce qui a abaissé le niveau accordé. */
export type RaisonNiveauAutonomie = "PLAFOND_BRIQUE" | "N4_RESERVE_R0" | "COUPE_CIRCUIT_N4";

export interface OptionsNiveauEffectif {
  /** Coupe-circuit du cabinet : aucune exécution automatique vers le client (N4 → N3). */
  readonly coupeCircuitN4?: boolean;
}

export interface NiveauEffectif {
  readonly niveau: NiveauAutonomie;
  /** Raisons, dans l'ordre d'application ; vide si le niveau accordé s'applique tel quel. */
  readonly raisons: readonly RaisonNiveauAutonomie[];
}

export function niveauEffectif(
  niveauMaxBrique: NiveauAutonomie,
  niveauAccorde: NiveauAutonomie,
  classeRisque: ClasseRisque,
  options: OptionsNiveauEffectif = {},
): NiveauEffectif {
  verifierNiveau(niveauMaxBrique, "maximal de la brique");
  verifierNiveau(niveauAccorde, "accordé");
  if (!estClasseRisque(classeRisque)) {
    throw new ErreurAutonomie("CLASSE_INVALIDE", "Classe de risque inconnue (R0 à R3).");
  }
  const raisons: RaisonNiveauAutonomie[] = [];
  let niveau = minNiveau(niveauMaxBrique, niveauAccorde);
  if (niveau !== niveauAccorde) raisons.push("PLAFOND_BRIQUE");
  if (niveau === "N4" && classeRisque !== "R0") {
    niveau = "N3";
    raisons.push("N4_RESERVE_R0");
  }
  if (niveau === "N4" && options.coupeCircuitN4 === true) {
    niveau = "N3";
    raisons.push("COUPE_CIRCUIT_N4");
  }
  return { niveau, raisons };
}

// ---------------------------------------------------------------------------
// Statistiques et promotion N2 → N3
// ---------------------------------------------------------------------------

export const SEUILS_PROMOTION_AUTONOMIE_DEFAUT = {
  executionsMin: 50,
  tauxAcceptationMinPct: 95,
  fenetreIncidentsJours: 90,
} as const;

export interface SeuilsPromotionAutonomie {
  readonly executionsMin: number;
  /** Pour-cent entier d'exécutions acceptées sans modification majeure. */
  readonly tauxAcceptationMinPct: number;
  readonly fenetreIncidentsJours: number;
}

export type GraviteIncidentAutonomie = "mineur" | "majeur";

export interface ExecutionBrique {
  readonly date: DateISO;
  /** Sortie acceptée par le relecteur (et non rejetée). */
  readonly acceptee: boolean;
  /** Modification majeure du brouillon avant acceptation (voir `evaluerModificationMajeure`). */
  readonly modificationMajeure: boolean;
}

export interface IncidentBrique {
  readonly date: DateISO;
  readonly gravite: GraviteIncidentAutonomie;
}

export interface StatistiquesAutonomie {
  readonly niveauActuel: NiveauAutonomie;
  readonly niveauMaxBrique: NiveauAutonomie;
  /** Exécutions depuis le passage au niveau actuel. */
  readonly executions: number;
  readonly accepteesSansModificationMajeure: number;
  /** Incidents majeurs dans la fenêtre (90 jours par défaut) qui précède la date de référence. */
  readonly incidentsMajeursFenetre: number;
}

function entierPositif(valeur: unknown): valeur is number {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 0;
}

function jour(date: unknown, quoi: string): number {
  const analyse = typeof date === "string" ? analyserDateISO(date) : null;
  if (!analyse?.valide) {
    throw new ErreurAutonomie("DATE_INVALIDE", `Date ${quoi} invalide (AAAA-MM-JJ attendu).`);
  }
  return analyse.jourUTC;
}

function seuilsValides(seuils: SeuilsPromotionAutonomie): SeuilsPromotionAutonomie {
  if (
    !entierPositif(seuils.executionsMin) ||
    !entierPositif(seuils.tauxAcceptationMinPct) ||
    seuils.tauxAcceptationMinPct > 100 ||
    !entierPositif(seuils.fenetreIncidentsJours) ||
    seuils.fenetreIncidentsJours < 1
  ) {
    throw new ErreurAutonomie("OPTIONS_INVALIDES", "Seuils de promotion invalides.");
  }
  return seuils;
}

/**
 * Compte les exécutions (déjà filtrées par l'appelant au niveau actuel) et les
 * incidents majeurs de la fenêtre `]dateReference − fenêtre ; dateReference]`.
 * Un incident postérieur à la date de référence est ignoré.
 */
export function statistiquesAutonomie(entree: {
  readonly niveauActuel: NiveauAutonomie;
  readonly niveauMaxBrique: NiveauAutonomie;
  readonly executions: readonly ExecutionBrique[];
  readonly incidents: readonly IncidentBrique[];
  readonly dateReference: DateISO;
  readonly fenetreIncidentsJours?: number;
}): StatistiquesAutonomie {
  verifierNiveau(entree.niveauActuel, "actuel");
  verifierNiveau(entree.niveauMaxBrique, "maximal de la brique");
  const reference = jour(entree.dateReference, "de référence");
  const fenetre =
    entree.fenetreIncidentsJours ?? SEUILS_PROMOTION_AUTONOMIE_DEFAUT.fenetreIncidentsJours;
  if (!entierPositif(fenetre) || fenetre < 1) {
    throw new ErreurAutonomie("OPTIONS_INVALIDES", "Fenêtre d'incidents invalide.");
  }
  let acceptees = 0;
  for (const e of entree.executions) {
    jour(e.date, "d'exécution");
    if (e.acceptee === true && e.modificationMajeure !== true) acceptees += 1;
  }
  let incidentsMajeursFenetre = 0;
  for (const i of entree.incidents) {
    const j = jour(i.date, "d'incident");
    if (i.gravite !== "majeur" && i.gravite !== "mineur") {
      throw new ErreurAutonomie("STATISTIQUES_INVALIDES", "Gravité d'incident inconnue.");
    }
    if (i.gravite === "majeur" && j <= reference && j > reference - fenetre) {
      incidentsMajeursFenetre += 1;
    }
  }
  return {
    niveauActuel: entree.niveauActuel,
    niveauMaxBrique: entree.niveauMaxBrique,
    executions: entree.executions.length,
    accepteesSansModificationMajeure: acceptees,
    incidentsMajeursFenetre,
  };
}

export type RaisonRefusPromotion =
  | "NIVEAU_NON_PROMOUVABLE"
  | "PLAFOND_BRIQUE"
  | "EXECUTIONS_INSUFFISANTES"
  | "TAUX_ACCEPTATION_INSUFFISANT"
  | "INCIDENT_MAJEUR_RECENT";

export interface EvaluationPromotion {
  /** Tous les critères sont remplis : la promotion peut être PROPOSÉE à un associé. */
  readonly eligible: boolean;
  readonly niveauActuel: NiveauAutonomie;
  /** N3 si éligible, sinon null. */
  readonly niveauPropose: NiveauAutonomie | null;
  /** Critères non remplis, dans l'ordre de contrôle ; vide si éligible. */
  readonly raisons: readonly RaisonRefusPromotion[];
  /** La promotion n'est jamais automatique (AGT-03). */
  readonly decisionRequise: "associe";
  /** Part acceptée sans modification majeure, arrondie à 4 décimales ; null sans exécution. */
  readonly tauxAcceptation: number | null;
}

/** Dit si une brique N2 est éligible à la promotion en N3 (décision d'un associé requise). */
export function evaluerPromotion(
  stats: StatistiquesAutonomie,
  seuils: SeuilsPromotionAutonomie = SEUILS_PROMOTION_AUTONOMIE_DEFAUT,
): EvaluationPromotion {
  verifierNiveau(stats.niveauActuel, "actuel");
  verifierNiveau(stats.niveauMaxBrique, "maximal de la brique");
  const { executionsMin, tauxAcceptationMinPct } = seuilsValides(seuils);
  const { executions, accepteesSansModificationMajeure: acceptees } = stats;
  if (
    !entierPositif(executions) ||
    !entierPositif(acceptees) ||
    acceptees > executions ||
    !entierPositif(stats.incidentsMajeursFenetre)
  ) {
    throw new ErreurAutonomie("STATISTIQUES_INVALIDES", "Statistiques d'exécution invalides.");
  }
  const raisons: RaisonRefusPromotion[] = [];
  if (stats.niveauActuel !== "N2") raisons.push("NIVEAU_NON_PROMOUVABLE");
  if (rangNiveauAutonomie(stats.niveauMaxBrique) < rangNiveauAutonomie("N3")) {
    raisons.push("PLAFOND_BRIQUE");
  }
  if (executions < executionsMin) raisons.push("EXECUTIONS_INSUFFISANTES");
  if (executions === 0 || acceptees * 100 < tauxAcceptationMinPct * executions) {
    raisons.push("TAUX_ACCEPTATION_INSUFFISANT");
  }
  if (stats.incidentsMajeursFenetre > 0) raisons.push("INCIDENT_MAJEUR_RECENT");
  const eligible = raisons.length === 0;
  return {
    eligible,
    niveauActuel: stats.niveauActuel,
    niveauPropose: eligible ? "N3" : null,
    raisons,
    decisionRequise: "associe",
    tauxAcceptation: executions === 0 ? null : arrondirRatio(acceptees / executions),
  };
}

// ---------------------------------------------------------------------------
// Rétrogradation automatique
// ---------------------------------------------------------------------------

/** Niveau auquel un incident majeur ramène une brique plus autonome. */
export const NIVEAU_APRES_INCIDENT_MAJEUR: NiveauAutonomie = "N2";

export type RaisonRetrogradation = "INCIDENT_MAJEUR" | "INCIDENT_MINEUR" | "DEJA_SOUS_VALIDATION";

export interface Retrogradation {
  readonly retrograde: boolean;
  readonly niveauAvant: NiveauAutonomie;
  readonly niveauApres: NiveauAutonomie;
  readonly raison: RaisonRetrogradation;
}

/**
 * Rétrogradation automatique sur incident : un incident majeur ramène une
 * brique N3 ou N4 à N2 ; un incident mineur ne change rien (il est compté
 * pour la promotion) ; une brique déjà sous validation humaine (N0 à N2) reste
 * où elle est.
 */
export function retrogradationAuto(incident: {
  readonly niveauActuel: NiveauAutonomie;
  readonly gravite: GraviteIncidentAutonomie;
}): Retrogradation {
  verifierNiveau(incident.niveauActuel, "actuel");
  const niveauAvant = incident.niveauActuel;
  if (incident.gravite !== "majeur" && incident.gravite !== "mineur") {
    throw new ErreurAutonomie("STATISTIQUES_INVALIDES", "Gravité d'incident inconnue.");
  }
  if (incident.gravite === "mineur") {
    return { retrograde: false, niveauAvant, niveauApres: niveauAvant, raison: "INCIDENT_MINEUR" };
  }
  if (rangNiveauAutonomie(niveauAvant) <= rangNiveauAutonomie(NIVEAU_APRES_INCIDENT_MAJEUR)) {
    return {
      retrograde: false,
      niveauAvant,
      niveauApres: niveauAvant,
      raison: "DEJA_SOUS_VALIDATION",
    };
  }
  return {
    retrograde: true,
    niveauAvant,
    niveauApres: NIVEAU_APRES_INCIDENT_MAJEUR,
    raison: "INCIDENT_MAJEUR",
  };
}
