import {
  CLASSE_RISQUE_LIBELLES,
  NIVEAU_AUTONOMIE_LIBELLES,
  NIVEAUX_AUTONOMIE,
  type ClasseRisque,
  type NiveauAutonomie,
} from "@missionpilot/shared";
import { formaterPourcentage } from "./format";
import type { EligibiliteIa, EvenementAutonomieIa, ExecutionIa } from "./agents-types";

/** Libellés et présentation de l'éligibilité des écrans « Agents IA ». */

/* ----- Libellés ----- */

export const libelleNiveau = (n: NiveauAutonomie) => `${n} — ${NIVEAU_AUTONOMIE_LIBELLES[n]}`;
export const libelleClasse = (c: ClasseRisque) => `${c} — ${CLASSE_RISQUE_LIBELLES[c]}`;

/** Tonalité d'un niveau : plus l'IA agit seule, plus le badge attire l'attention. */
export function tonaliteNiveau(n: NiveauAutonomie): "succes" | "attention" | "danger" | "neutre" {
  if (n === "N4") return "danger";
  if (n === "N3") return "attention";
  if (n === "N0") return "neutre";
  return "succes";
}

const RAISONS_NIVEAU: Record<string, string> = {
  PLAFOND_BRIQUE: "plafond de la brique ou de l'agent",
  N4_RESERVE_R0: "N4 réservé aux briques R0",
  COUPE_CIRCUIT_N4: "coupe-circuit N4 du cabinet",
};

export function libelleRaisonsNiveau(raisons: readonly string[]): string {
  return raisons.map((r) => RAISONS_NIVEAU[r] ?? r).join(", ");
}

const RAISONS_PROMOTION: Record<string, string> = {
  NIVEAU_NON_PROMOUVABLE: "le niveau actuel ne se promeut pas sur critères",
  PLAFOND_BRIQUE: "plafond de la brique atteint (ou N4 hors classe R0)",
  EXECUTIONS_INSUFFISANTES: "moins de 50 exécutions décidées à ce niveau",
  TAUX_ACCEPTATION_INSUFFISANT: "moins de 95 % acceptées sans modification majeure",
  INCIDENT_MAJEUR_RECENT: "incident majeur sur les 90 derniers jours",
};

export const libelleRaisonPromotion = (r: string) => RAISONS_PROMOTION[r] ?? r;

export const LIBELLES_EVENEMENT: Record<EvenementAutonomieIa["type"], string> = {
  initial: "Niveau initial",
  promotion: "Promotion (décision)",
  abaissement: "Abaissement (décision)",
  retrogradation_auto: "Rétrogradation automatique",
};

export const LIBELLES_DECISION: Record<NonNullable<ExecutionIa["decision"]>["decision"], string> = {
  acceptee: "Acceptée",
  modifiee: "Modifiée (modification majeure)",
  rejetee: "Rejetée",
};

const LIBELLES_OUTIL: Record<string, string> = {
  lire_mission: "Lire la mission",
  lire_documents: "Lire les documents",
  lire_reponses: "Lire les réponses",
  lire_preuves: "Lire les preuves",
  lire_banque_items: "Lire la banque d'items",
  lire_methode: "Lire la méthode",
  lire_dossier_client: "Lire le dossier client",
  lire_planning: "Lire le planning",
  lire_kpi: "Lire les KPI",
  lire_sources_externes: "Lire les sources externes",
  proposer_brouillon: "Proposer un brouillon",
  proposer_classement: "Proposer un classement",
  proposer_extraction: "Proposer une extraction",
  proposer_assertion: "Proposer une assertion",
  proposer_relance: "Proposer une relance",
  envoyer_relance: "Envoyer une relance (N4)",
  accuser_reception: "Accuser réception (N4)",
};

export const libelleOutil = (o: string) => LIBELLES_OUTIL[o] ?? o;

const SIGNAUX: Record<string, string> = {
  ignorer_consignes: "demande d'ignorer les consignes",
  changement_role: "changement de rôle",
  invite_systeme: "invite système",
  demande_action: "demande d'action",
  autorite_pretendue: "autorité prétendue",
  sortie_imposee: "sortie imposée",
};

export const libelleSignal = (s: string) => SIGNAUX[s] ?? s;

const RAISONS_CAS: Record<string, string> = {
  VARIABLES_MANQUANTES: "variables manquantes",
  VARIABLES_INCONNUES: "variables inconnues",
  ERREUR_FOURNISSEUR: "erreur du fournisseur",
  SORTIE_NON_CONFORME: "sortie non conforme au schéma",
  CHIFFRES_NON_VERIFIES: "chiffres non vérifiés",
  CONTENU_ATTENDU_ABSENT: "contenu attendu absent",
  CONTENU_INTERDIT_PRESENT: "contenu interdit présent",
  CHAMP_INATTENDU: "valeur de champ inattendue",
};

export const libelleRaisonCas = (r: string) => RAISONS_CAS[r] ?? r;

/** Durée de revue lisible : « 45 s », « 12 min », « 2 h 05 ». */
export function formaterDureeRevue(secondes: number): string {
  if (!Number.isFinite(secondes) || secondes < 0) return "—";
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Part conservée (ratio 0–1 de l'API) en pour-cent lisible. */
export const formaterPart = (ratio: number | null) => formaterPourcentage(ratio, 1);

/* ----- Présentation ----- */

export interface PresentationEligibilite {
  tonalite: "succes" | "attention" | "neutre";
  titre: string;
  details: string[];
}

export function presentationEligibilite(e: EligibiliteIa): PresentationEligibilite {
  if (e.niveau_suivant === null) {
    return { tonalite: "neutre", titre: "Niveau maximal atteint.", details: [] };
  }
  if (!e.criteres_requis) {
    return {
      tonalite: "neutre",
      titre: `Passage en ${e.niveau_suivant} sur simple décision : le contenu reste validé par un humain.`,
      details: [],
    };
  }
  if (e.evaluation.eligible) {
    return {
      tonalite: "succes",
      titre: `Éligible à ${e.evaluation.niveauPropose ?? e.niveau_suivant} : la décision revient à un associé.`,
      details: [],
    };
  }
  return {
    tonalite: "attention",
    titre: `Pas encore éligible à ${e.niveau_suivant}.`,
    details: e.evaluation.raisons.map(libelleRaisonPromotion),
  };
}

/** Niveaux qu'une décision peut accorder : tout niveau plus bas, ou le palier suivant sous le plafond. */
export function niveauxDecidables(
  accorde: NiveauAutonomie,
  plafond: NiveauAutonomie,
): NiveauAutonomie[] {
  const i = NIVEAUX_AUTONOMIE.indexOf(accorde);
  const max = NIVEAUX_AUTONOMIE.indexOf(plafond);
  return NIVEAUX_AUTONOMIE.filter((_, j) => j < i || (j === i + 1 && j <= max));
}
