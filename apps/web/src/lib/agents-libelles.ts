import {
  CLASSE_RISQUE_LIBELLES,
  NIVEAU_AUTONOMIE_LIBELLES,
  NIVEAUX_AUTONOMIE,
  type ClasseRisque,
  type Langue,
  type NiveauAutonomie,
} from "@missionpilot/shared";
import { formaterPourcentage } from "./format";
import type { EligibiliteIa, EvenementAutonomieIa, ExecutionIa } from "./agents-types";

/** Libellés et présentation de l'éligibilité des écrans « Agents IA ». */

/* ----- Libellés ----- */

const NIVEAU_AUTONOMIE_LIBELLES_EN: Record<NiveauAutonomie, string> = {
  N0: "No AI",
  N1: "Suggestion on request",
  N2: "Automatic draft, approval required",
  N3: "Automatic internal execution, sampling control",
  N4: "Automatic execution, including to the client",
};
const CLASSE_RISQUE_LIBELLES_EN: Record<ClasseRisque, string> = {
  R0: "Internal operations",
  R1: "Internal analysis",
  R2: "Client deliverable",
  R3: "Binding",
};

export const libelleNiveau = (n: NiveauAutonomie, langue: Langue = "fr") =>
  `${n} — ${(langue === "en" ? NIVEAU_AUTONOMIE_LIBELLES_EN : NIVEAU_AUTONOMIE_LIBELLES)[n]}`;
export const libelleClasse = (c: ClasseRisque, langue: Langue = "fr") =>
  `${c} — ${(langue === "en" ? CLASSE_RISQUE_LIBELLES_EN : CLASSE_RISQUE_LIBELLES)[c]}`;

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

const RAISONS_NIVEAU_EN: Record<string, string> = {
  PLAFOND_BRIQUE: "ceiling of the building block or of the agent",
  N4_RESERVE_R0: "N4 reserved for R0 building blocks",
  COUPE_CIRCUIT_N4: "firm's N4 circuit breaker",
};

export function libelleRaisonsNiveau(raisons: readonly string[], langue: Langue = "fr"): string {
  const table = langue === "en" ? RAISONS_NIVEAU_EN : RAISONS_NIVEAU;
  return raisons.map((r) => table[r] ?? r).join(", ");
}

const RAISONS_PROMOTION: Record<string, string> = {
  NIVEAU_NON_PROMOUVABLE: "le niveau actuel ne se promeut pas sur critères",
  PLAFOND_BRIQUE: "plafond de la brique atteint (ou N4 hors classe R0)",
  EXECUTIONS_INSUFFISANTES: "moins de 50 exécutions décidées à ce niveau",
  TAUX_ACCEPTATION_INSUFFISANT: "moins de 95 % acceptées sans modification majeure",
  INCIDENT_MAJEUR_RECENT: "incident majeur sur les 90 derniers jours",
};

const RAISONS_PROMOTION_EN: Record<string, string> = {
  NIVEAU_NON_PROMOUVABLE: "the current level is not promoted on criteria",
  PLAFOND_BRIQUE: "building block ceiling reached (or N4 outside class R0)",
  EXECUTIONS_INSUFFISANTES: "fewer than 50 executions decided at this level",
  TAUX_ACCEPTATION_INSUFFISANT: "fewer than 95% accepted without major edits",
  INCIDENT_MAJEUR_RECENT: "major incident in the last 90 days",
};

export const libelleRaisonPromotion = (r: string, langue: Langue = "fr") =>
  (langue === "en" ? RAISONS_PROMOTION_EN : RAISONS_PROMOTION)[r] ?? r;

export const LIBELLES_EVENEMENT: Record<EvenementAutonomieIa["type"], string> = {
  initial: "Niveau initial",
  promotion: "Promotion (décision)",
  abaissement: "Abaissement (décision)",
  retrogradation_auto: "Rétrogradation automatique",
};

export const LIBELLES_EVENEMENT_EN: Record<EvenementAutonomieIa["type"], string> = {
  initial: "Initial level",
  promotion: "Promotion (decision)",
  abaissement: "Downgrade (decision)",
  retrogradation_auto: "Automatic demotion",
};

export const libelleEvenement = (type: EvenementAutonomieIa["type"], langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_EVENEMENT_EN : LIBELLES_EVENEMENT)[type];

export const LIBELLES_DECISION: Record<NonNullable<ExecutionIa["decision"]>["decision"], string> = {
  acceptee: "Acceptée",
  modifiee: "Modifiée (modification majeure)",
  rejetee: "Rejetée",
};

export const LIBELLES_DECISION_EN: Record<
  NonNullable<ExecutionIa["decision"]>["decision"],
  string
> = {
  acceptee: "Accepted",
  modifiee: "Edited (major edit)",
  rejetee: "Rejected",
};

export const libelleDecision = (
  decision: NonNullable<ExecutionIa["decision"]>["decision"],
  langue: Langue = "fr",
) => (langue === "en" ? LIBELLES_DECISION_EN : LIBELLES_DECISION)[decision];

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

const LIBELLES_OUTIL_EN: Record<string, string> = {
  lire_mission: "Read the engagement",
  lire_documents: "Read the documents",
  lire_reponses: "Read the answers",
  lire_preuves: "Read the evidence",
  lire_banque_items: "Read the item bank",
  lire_methode: "Read the method",
  lire_dossier_client: "Read the client file",
  lire_planning: "Read the schedule",
  lire_kpi: "Read the KPIs",
  lire_sources_externes: "Read external sources",
  proposer_brouillon: "Propose a draft",
  proposer_classement: "Propose a classification",
  proposer_extraction: "Propose an extraction",
  proposer_assertion: "Propose an assertion",
  proposer_relance: "Propose a reminder",
  envoyer_relance: "Send a reminder (N4)",
  accuser_reception: "Acknowledge receipt (N4)",
};

export const libelleOutil = (o: string, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_OUTIL_EN : LIBELLES_OUTIL)[o] ?? o;

const SIGNAUX: Record<string, string> = {
  ignorer_consignes: "demande d'ignorer les consignes",
  changement_role: "changement de rôle",
  invite_systeme: "invite système",
  demande_action: "demande d'action",
  autorite_pretendue: "autorité prétendue",
  sortie_imposee: "sortie imposée",
};

const SIGNAUX_EN: Record<string, string> = {
  ignorer_consignes: "request to ignore the instructions",
  changement_role: "role change",
  invite_systeme: "system prompt",
  demande_action: "action request",
  autorite_pretendue: "claimed authority",
  sortie_imposee: "imposed output",
};

export const libelleSignal = (s: string, langue: Langue = "fr") =>
  (langue === "en" ? SIGNAUX_EN : SIGNAUX)[s] ?? s;

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

const RAISONS_CAS_EN: Record<string, string> = {
  VARIABLES_MANQUANTES: "missing variables",
  VARIABLES_INCONNUES: "unknown variables",
  ERREUR_FOURNISSEUR: "provider error",
  SORTIE_NON_CONFORME: "output does not match the schema",
  CHIFFRES_NON_VERIFIES: "unverified figures",
  CONTENU_ATTENDU_ABSENT: "expected content missing",
  CONTENU_INTERDIT_PRESENT: "forbidden content present",
  CHAMP_INATTENDU: "unexpected field value",
};

export const libelleRaisonCas = (r: string, langue: Langue = "fr") =>
  (langue === "en" ? RAISONS_CAS_EN : RAISONS_CAS)[r] ?? r;

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
export const formaterPart = (ratio: number | null, langue: Langue = "fr") =>
  formaterPourcentage(ratio, 1, langue);

/* ----- Présentation ----- */

export interface PresentationEligibilite {
  tonalite: "succes" | "attention" | "neutre";
  titre: string;
  details: string[];
}

export function presentationEligibilite(
  e: EligibiliteIa,
  langue: Langue = "fr",
): PresentationEligibilite {
  const en = langue === "en";
  if (e.niveau_suivant === null) {
    return {
      tonalite: "neutre",
      titre: en ? "Maximum level reached." : "Niveau maximal atteint.",
      details: [],
    };
  }
  if (!e.criteres_requis) {
    return {
      tonalite: "neutre",
      titre: en
        ? `Move to ${e.niveau_suivant} on a simple decision: the content is still approved by a human.`
        : `Passage en ${e.niveau_suivant} sur simple décision : le contenu reste validé par un humain.`,
      details: [],
    };
  }
  if (e.evaluation.eligible) {
    const cible = e.evaluation.niveauPropose ?? e.niveau_suivant;
    return {
      tonalite: "succes",
      titre: en
        ? `Eligible for ${cible}: the decision rests with a partner.`
        : `Éligible à ${cible} : la décision revient à un associé.`,
      details: [],
    };
  }
  return {
    tonalite: "attention",
    titre: en
      ? `Not yet eligible for ${e.niveau_suivant}.`
      : `Pas encore éligible à ${e.niveau_suivant}.`,
    details: e.evaluation.raisons.map((r) => libelleRaisonPromotion(r, langue)),
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
