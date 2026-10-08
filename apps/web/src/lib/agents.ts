import {
  aPermission,
  CLASSE_RISQUE_LIBELLES,
  jeuEssaiCreationSchema,
  NIVEAU_AUTONOMIE_LIBELLES,
  NIVEAUX_AUTONOMIE,
  type ClasseRisque,
  type JeuEssaiCreation,
  type NiveauAutonomie,
  type Permission,
  type Role,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { formaterPourcentage } from "./format";
import type { Resultat } from "./saisie";

/**
 * Écrans « Agents IA » (AGT-01 à AGT-10, PRD complémentaire §7) : types des réponses de
 * l'API, libellés, présentation et lecture des saisies. Aucune règle de calcul : niveau
 * effectif, éligibilité et contribution viennent de l'API (moteurs purs).
 */

/* ----- Types des réponses ----- */

export interface AgentIa {
  code: string;
  version: number;
  nom: string;
  mission: string;
  ne_fait_jamais: string;
  entrees: string[];
  outils_autorises: string[];
  droits: string[];
  briques: string[];
  taches: string[];
  niveau_max_standard: NiveauAutonomie;
  niveau_max_cabinet: NiveauAutonomie | null;
  niveau_max: NiveauAutonomie;
  lit_contenu_client: boolean;
  notes_version: string;
  actif: boolean;
  restriction: { motif: string; auteur_id: string; cree_le: string } | null;
}

export interface CoupeCircuitIa {
  actif: boolean;
  motif: string | null;
  auteur_id: string | null;
  modifie_le: string | null;
}

export interface EtatAutonomieIa {
  niveau_accorde: NiveauAutonomie;
  plafond: NiveauAutonomie;
  niveau_effectif: NiveauAutonomie;
  raisons: string[];
  coupe_circuit_n4: boolean;
}

export interface BriqueIa {
  id: string;
  code: string;
  agent: { code: string; nom: string; niveau_max: NiveauAutonomie } | null;
  classe_risque: ClasseRisque;
  niveau_max: NiveauAutonomie;
  niveau_accorde: NiveauAutonomie;
  depuis: string;
  cree_le: string;
  autonomie: EtatAutonomieIa | null;
}

export interface PageBriquesIa {
  coupe_circuit: CoupeCircuitIa;
  elements: BriqueIa[];
  curseur_suivant: string | null;
}

export interface EligibiliteIa {
  statistiques: {
    executions: number;
    accepteesSansModificationMajeure: number;
    incidentsMajeursFenetre: number;
  };
  evaluation: {
    eligible: boolean;
    niveauPropose: NiveauAutonomie | null;
    raisons: string[];
    tauxAcceptation: number | null;
  };
  niveau_suivant: NiveauAutonomie | null;
  criteres_requis: boolean;
}

export interface EvenementAutonomieIa {
  id: string;
  type: "initial" | "promotion" | "abaissement" | "retrogradation_auto";
  niveau_avant: NiveauAutonomie | null;
  niveau_apres: NiveauAutonomie;
  motif: string;
  auteur_nom: string | null;
  cree_le: string;
}

export interface IncidentIa {
  id: string;
  gravite: "mineur" | "majeur";
  description: string;
  signale_par_nom: string;
  cree_le: string;
}

export interface DetailBriqueIa extends BriqueIa {
  eligibilite: EligibiliteIa;
  historique: { evenements: EvenementAutonomieIa[]; incidents: IncidentIa[]; tronque: boolean };
}

export interface ExecutionIa {
  id: string;
  agent: { code: string; version: number; nom: string };
  brique: { id: string; code: string } | null;
  classe_risque: ClasseRisque | null;
  mission_id: string | null;
  demande_id: string;
  declencheur: { id: string; nom: string };
  niveau_effectif: NiveauAutonomie;
  prompt: { nom: string; version: number };
  tache: string;
  fournisseur: "openrouter" | "gabarit";
  modele: string | null;
  mode_degrade: boolean;
  cout_micro_usd?: number;
  sources: { type: string; id: string; libelle: string }[];
  entree: { empreinte: string };
  sortie_valide: boolean;
  chiffres_non_verifies: boolean;
  donnees_non_fiables: string[];
  signaux_injection: string[];
  decision: {
    decision: "acceptee" | "modifiee" | "rejetee";
    taux_modification_pct: number | null;
    motif: string | null;
    decideur: { id: string; nom: string };
    cree_le: string;
  } | null;
  cree_le: string;
}

export interface PageIaAgents<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export interface ContributionIaLigne {
  id: string;
  livrable_type: string;
  livrable_id: string;
  mission_id: string | null;
  agent_code: string | null;
  brique_code: string | null;
  mots_brouillon: number;
  mots_valides: number;
  part_conservee_pct: number | null;
  taux_modification_pct: number;
  modification_majeure: boolean;
  temps_revue_secondes: number;
  exacte: boolean;
  cree_le: string;
}

export interface ContributionsIa extends PageIaAgents<ContributionIaLigne> {
  synthese: {
    livrables: number;
    motsBrouillon: number;
    motsConserves: number;
    partConservee: number | null;
    modificationsMajeures: number;
    totalRevueSecondes: number;
    exacte: boolean;
  };
}

export interface JeuEssaiIa {
  id: string;
  prompt_nom: string;
  version: number;
  brique_code: string | null;
  description: string;
  cas: { code: string }[];
  auteur_nom: string;
  cree_le: string;
}

export interface EvaluationIa {
  id: string;
  prompt_nom: string;
  jeu_version: number;
  prompt_id: string;
  prompt_version: number;
  prompt_reference_version: number | null;
  modele: string;
  fournisseur: "local" | "openrouter";
  cas_total: number;
  cas_reussis: number;
  regressions: number;
  reussie: boolean;
  resultats: {
    code: string;
    reussi: boolean;
    raisons: string[];
    reference_reussi: boolean | null;
  }[];
  lance_par_nom: string;
  cree_le: string;
}

/* ----- Navigation de la rubrique ----- */

export interface SousPageAgents {
  id: string;
  libelle: string;
  href: string;
  permission: Permission;
}

export const SOUS_PAGES_AGENTS: readonly SousPageAgents[] = [
  { id: "equipe", libelle: "Équipe d'agents", href: "/agents", permission: "agent.lire" },
  { id: "autonomie", libelle: "Autonomie", href: "/agents/autonomie", permission: "agent.lire" },
  { id: "executions", libelle: "Exécutions", href: "/agents/executions", permission: "agent.lire" },
  {
    id: "evaluations",
    libelle: "Évaluations",
    href: "/agents/evaluations",
    permission: "agent.lire",
  },
  {
    id: "contribution",
    libelle: "Contribution de l'IA",
    href: "/agents/contribution",
    permission: "agent.lire",
  },
];

export function sousPagesAgents(roles: readonly Role[]): SousPageAgents[] {
  return SOUS_PAGES_AGENTS.filter((p) => aPermission(roles, p.permission));
}

/** Droits d'affichage (l'API reste la source de vérité). */
export function droitsAgents(roles: readonly Role[]) {
  return {
    gerer: aPermission(roles, "agent.gerer"),
    decider: aPermission(roles, "autonomie.decider"),
    couper: aPermission(roles, "agent.gerer") || aPermission(roles, "autonomie.decider"),
    lever: aPermission(roles, "autonomie.decider"),
    /** Incident MAJEUR (rétrogradation automatique) : agent.gerer ou autonomie.decider. */
    incidentMajeur: aPermission(roles, "agent.gerer") || aPermission(roles, "autonomie.decider"),
    /** Brique R0 (seule à pouvoir aller jusqu'à N4) : associé. */
    declarerR0: aPermission(roles, "autonomie.decider"),
  };
}

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

/* ----- Lecture des saisies ----- */

export function lireDecisionAutonomie(s: {
  niveau: string;
  motif: string;
}): Resultat<{ niveau: NiveauAutonomie; motif: string }, "niveau" | "motif"> {
  const erreurs: Partial<Record<"niveau" | "motif", string>> = {};
  const niveau = s.niveau as NiveauAutonomie;
  if (!NIVEAUX_AUTONOMIE.includes(niveau)) erreurs.niveau = "Choisissez un niveau.";
  const motif = s.motif.trim();
  if (motif === "") erreurs.motif = "Le motif est obligatoire.";
  else if (motif.length > 2000) erreurs.motif = "2 000 caractères au plus.";
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { niveau, motif } };
}

export function lireIncident(s: {
  gravite: string;
  description: string;
}): Resultat<{ gravite: "mineur" | "majeur"; description: string }, "gravite" | "description"> {
  const erreurs: Partial<Record<"gravite" | "description", string>> = {};
  if (s.gravite !== "mineur" && s.gravite !== "majeur") erreurs.gravite = "Choisissez la gravité.";
  const description = s.description.trim();
  if (description === "") erreurs.description = "Décrivez l'incident.";
  else if (description.length > 2000) erreurs.description = "2 000 caractères au plus.";
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : {
        ok: true,
        charge: { gravite: s.gravite as "mineur" | "majeur", description },
      };
}

export function lireMotif(motif: string, max = 1000): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "") return { ok: false, erreurs: { motif: "Le motif est obligatoire." } };
  if (m.length > max) return { ok: false, erreurs: { motif: `${max} caractères au plus.` } };
  return { ok: true, charge: { motif: m } };
}

const CODE_BRIQUE = /^[a-z0-9_.-]{1,120}$/;

export function lireBrique(s: {
  brique_code: string;
  agent_code: string;
  classe_risque: string;
  niveau_max: string;
}): Resultat<
  {
    brique_code: string;
    agent_code: string;
    classe_risque: ClasseRisque;
    niveau_max: NiveauAutonomie;
  },
  "brique_code" | "agent_code" | "classe_risque" | "niveau_max"
> {
  const erreurs: Partial<
    Record<"brique_code" | "agent_code" | "classe_risque" | "niveau_max", string>
  > = {};
  const code = s.brique_code.trim();
  if (!CODE_BRIQUE.test(code)) {
    erreurs.brique_code = "Code : minuscules, chiffres, « _ », « . » et « - ».";
  }
  if (s.agent_code === "") erreurs.agent_code = "Choisissez un agent.";
  if (!["R0", "R1", "R2", "R3"].includes(s.classe_risque)) {
    erreurs.classe_risque = "Choisissez une classe.";
  }
  if (!NIVEAUX_AUTONOMIE.includes(s.niveau_max as NiveauAutonomie)) {
    erreurs.niveau_max = "Choisissez un niveau.";
  } else if (s.niveau_max === "N4" && s.classe_risque !== "R0") {
    erreurs.niveau_max = "N4 est réservé aux briques de classe R0.";
  }
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : {
        ok: true,
        charge: {
          brique_code: code,
          agent_code: s.agent_code,
          classe_risque: s.classe_risque as ClasseRisque,
          niveau_max: s.niveau_max as NiveauAutonomie,
        },
      };
}

/** Jeu d'essai saisi en JSON (tableau de cas) : contrôle par le schéma partagé, messages français. */
export function lireJeuEssai(s: {
  prompt_nom: string;
  description: string;
  cas: string;
}): Resultat<JeuEssaiCreation, "prompt_nom" | "cas"> {
  let cas: unknown;
  try {
    cas = JSON.parse(s.cas);
  } catch {
    return { ok: false, erreurs: { cas: "Les cas doivent être un tableau JSON valide." } };
  }
  const r = jeuEssaiCreationSchema.safeParse({
    prompt_nom: s.prompt_nom.trim(),
    description: s.description,
    cas,
  });
  if (r.success) return { ok: true, charge: r.data };
  const erreurs: Partial<Record<"prompt_nom" | "cas", string>> = {};
  for (const issue of r.error.issues) {
    if (issue.path[0] === "prompt_nom") {
      erreurs.prompt_nom = "Nom de prompt : minuscules, chiffres et tiret bas.";
    } else {
      erreurs.cas ??=
        "Cas invalides : de 1 à 50 cas, chacun avec un code unique, ses variables et ses critères.";
    }
  }
  return { ok: false, erreurs };
}

/* ----- Messages d'erreur propres ----- */

const MESSAGES: Record<string, string> = {
  PROMOTION_NON_ELIGIBLE: "Promotion refusée : la brique ne remplit pas encore les critères.",
  PROMOTION_PAR_PALIER: "Une hausse d'autonomie se fait d'un niveau à la fois.",
  PLAFOND_BRIQUE: "Ce niveau dépasse le plafond de la brique ou de l'agent.",
  PLAFOND_AGENT: "Ce niveau dépasse celui que le standard accorde à cet agent.",
  NIVEAU_INCHANGE: "La brique est déjà à ce niveau.",
  BRIQUE_EXISTE: "Cette brique est déjà confiée à un agent.",
  COUPE_CIRCUIT_INCHANGE: "Le coupe-circuit est déjà dans cet état.",
  JEU_ESSAI_ABSENT: "Aucun jeu d'essai pour ce prompt : créez-en un d'abord.",
  AGENT_INACTIF: "Cet agent est désactivé pour le cabinet.",
};

export function messageAgents(e: unknown): string {
  if (e instanceof ErreurApi && MESSAGES[e.code]) return MESSAGES[e.code] as string;
  // Action réservée (associé, décideur d'une exécution) : le message de l'API dit à qui.
  if (e instanceof ErreurApi && e.code === "ACTION_RESERVEE") return e.message;
  return messageErreur(e);
}

/* ----- Chemins ----- */

export function lireCurseur(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v !== "" && v.length <= 500 ? v : null;
}

export function cheminAvecCurseur(base: string, curseur: string | null, limite = 30): string {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `${base}?${q}`;
}

export function hrefPage(page: string, curseur: string | null): string {
  return curseur ? `${page}?curseur=${encodeURIComponent(curseur)}` : page;
}

export const hrefBrique = (code: string) => `/agents/autonomie/${encodeURIComponent(code)}`;
