import {
  aPermission,
  STATUTS_EVALUATION_OPENROUTER,
  type Role,
  type StatutEvaluationOpenRouter,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { libelleRaisonCas, messageAgents } from "./agents";
import { formaterNombre } from "./format";
import { formaterMicroUsd } from "./ia";
import type { Resultat } from "./saisie";

/**
 * Rejeu RÉEL des évaluations de non-régression sur OpenRouter (AGT-04, ADR-005) : types des
 * réponses de l'API, chemins, libellés français des statuts et des causes, droits d'affichage,
 * coût (µUSD → dollars, seulement s'il est fourni), sondage du statut. Aucune règle métier ni
 * aucun calcul : le statut, les comptes, le coût et le plafond viennent de l'API.
 */

/* ----- Types des réponses ----- */

export type StatutDemande = StatutEvaluationOpenRouter;

/** Détail d'un cas : jetons et coût seulement avec `finance.lire` (champs absents sinon). */
export interface ResultatCasOpenRouter {
  code: string;
  reussi: boolean;
  /** Codes de raison ; « NON_EVALUE » pour un cas que l'arrêt de l'évaluation a laissé de côté. */
  raisons: string[];
  /** Vrai : la version active réussissait ce cas ; faux : elle l'échouait ; null : non comparé. */
  reference_reussi: boolean | null;
  tokens_entree?: number;
  tokens_sortie?: number;
  cout_micro_usd?: number;
}

/** GET /api/agents/evaluations/openrouter/:id et éléments de la liste d'un prompt. */
export interface DemandeEvaluationOpenRouter {
  demande_id: string;
  prompt_id: string;
  prompt_nom: string;
  prompt_version: number;
  jeu_version: number;
  modele: string;
  statut: StatutDemande;
  cause: string | null;
  evaluation_id: string | null;
  cas_total: number;
  cas_traites: number;
  /** Nuls tant qu'aucune évaluation n'est enregistrée (demande en file, en cours ou ignorée). */
  cas_reussis: number | null;
  regressions: number | null;
  appels: number;
  demande_par_nom: string;
  cree_le: string;
  debut_le: string | null;
  termine_le: string | null;
  resultats: ResultatCasOpenRouter[] | null;
  /** Donnée de gestion (FIN-02) : champs ABSENTS sans `finance.lire`. */
  cout_micro_usd?: number;
  cout_estime_micro_usd?: number;
  plafond_evaluation_micro_usd?: number;
  tokens_entree?: number;
  tokens_sortie?: number;
}

export interface PageDemandesEvaluation {
  elements: DemandeEvaluationOpenRouter[];
  curseur_suivant: string | null;
}

/** Réponse 202 du lancement. */
export interface LancementEvaluation {
  demande_id: string;
  statut: "en_file";
}

/* ----- Chemins (appelés par lib/api.ts uniquement) ----- */

export const LIMITE_DEMANDES = 10;

export const cheminLancementEvaluation = (promptId: string) =>
  `/api/agents/prompts/${encodeURIComponent(promptId)}/evaluations/openrouter`;

export const cheminDemandeEvaluation = (demandeId: string) =>
  `/api/agents/evaluations/openrouter/${encodeURIComponent(demandeId)}`;

export function cheminDemandesEvaluation(
  promptId: string,
  curseur: string | null = null,
  limite = LIMITE_DEMANDES,
): string {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `${cheminLancementEvaluation(promptId)}?${q.toString()}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Version de prompt préselectionnée par `?prompt=` : un UUID, sinon rien. */
export function lirePromptPreselectionne(v: string | string[] | undefined): string | null {
  return typeof v === "string" && UUID.test(v) ? v : null;
}

/* ----- Droits d'affichage (confort : l'API reste la source de vérité) ----- */

export function droitsEvaluationOpenRouter(roles: readonly Role[]) {
  return {
    lire: aPermission(roles, "agent.lire"),
    lancer: aPermission(roles, "agent.gerer"),
    /** Coût, plafond et jetons : donnée de gestion (FIN-02). */
    voitCout: aPermission(roles, "finance.lire"),
  };
}

/* ----- Statuts ----- */

export type TonaliteDemande = "succes" | "attention" | "danger" | "neutre";

export const LIBELLES_STATUT: Record<StatutDemande, string> = {
  en_file: "En file d'attente",
  en_cours: "En cours",
  reussie: "Réussie",
  echouee: "Échouée",
  incomplete: "Incomplète",
  ignoree: "Ignorée",
};

const TONALITES_STATUT: Record<StatutDemande, TonaliteDemande> = {
  en_file: "neutre",
  en_cours: "attention",
  reussie: "succes",
  echouee: "danger",
  incomplete: "attention",
  ignoree: "neutre",
};

export function libelleStatut(statut: string): string {
  return (LIBELLES_STATUT as Record<string, string>)[statut] ?? "Statut inconnu";
}

export function tonaliteStatut(statut: string): TonaliteDemande {
  return (TONALITES_STATUT as Record<string, TonaliteDemande>)[statut] ?? "neutre";
}

/** Liste des statuts connus de l'API (pour les tests d'exhaustivité). */
export const STATUTS_CONNUS: readonly StatutDemande[] = STATUTS_EVALUATION_OPENROUTER;

/** Demande en file ou en cours : le statut change encore, on le rafraîchit. */
export const estEnAttente = (statut: string) => statut === "en_file" || statut === "en_cours";

/* ----- Causes ----- */

/**
 * Explication d'une cause d'arrêt ou d'échec (codes de l'API : cause de l'évaluation, erreurs du
 * fournisseur d'IA). Jamais de code brut à l'écran.
 */
export const LIBELLES_CAUSE: Record<string, string> = {
  CAS_ECHOUES: "Au moins un cas du jeu d'essai n'a pas été réussi.",
  PLAFOND_EVALUATION:
    "Le plafond de coût de cette évaluation a été atteint : les cas restants n'ont pas été rejoués.",
  PLAFOND_IA_ATTEINT:
    "Le plafond mensuel de coût IA du cabinet a été atteint : les cas restants n'ont pas été rejoués.",
  GENERATIONS_SIMULTANEES:
    "Trop de générations IA étaient en cours en même temps : l'évaluation s'est arrêtée. Relancez-la plus tard.",
  DUREE_MAX_ATTEINTE:
    "La durée maximale d'un rejeu a été atteinte : les cas restants n'ont pas été rejoués.",
  INTERROMPUE:
    "La demande est restée trop longtemps sans avancer (traitement interrompu) : relancez-la ; le coût déjà engagé reste compté.",
  COUPE_CIRCUIT_IA:
    "L'IA a été désactivée pour le cabinet : le rejeu s'est arrêté avant le cas suivant (les cas déjà rejoués restent comptés).",
  AGENT_DESACTIVE:
    "Les agents qui utilisent ce prompt ont été désactivés : le rejeu s'est arrêté avant le cas suivant (les cas déjà rejoués restent comptés).",
  IA_NON_CONFIGUREE:
    "Aucune clé API d'IA n'était disponible au moment de l'exécution : aucun appel n'a été fait.",
  JEU_ESSAI_CHANGE:
    "Le jeu d'essai a changé entre la demande et l'exécution : aucun appel n'a été fait. Relancez le rejeu.",
  JEU_ESSAI_INVALIDE:
    "Le jeu d'essai contient une variable de cas dans les consignes système du prompt : corrigez le jeu d'essai avant de relancer (aucun appel n'a été fait).",
  MODELE_SERVI_DIFFERENT:
    "Le fournisseur d'IA a répondu avec un autre modèle que celui demandé : l'évaluation ne prouve rien pour ce modèle et s'est arrêtée.",
  MODELE_NON_AUTORISE:
    "Le modèle demandé n'est plus autorisé (tarif inconnu) : aucun appel n'a été fait.",
  FOURNISSEUR_NON_REEL:
    "Le fournisseur d'IA réel n'était pas disponible (mode local) : aucun appel n'a été fait.",
  ERREUR_INTERNE:
    "Une erreur interne a interrompu le rejeu. Relancez-le ; le coût déjà engagé reste compté.",
  ERREUR_INATTENDUE:
    "Une erreur inattendue du fournisseur d'IA a arrêté l'évaluation (une seule tentative est faite, un appel payant n'est jamais répété).",
  CLE_REFUSEE: "Le fournisseur d'IA a refusé la clé API : vérifiez la clé dans les paramètres IA.",
  CREDIT_FOURNISSEUR_INSUFFISANT:
    "Le crédit du compte chez le fournisseur d'IA est insuffisant : rechargez-le puis relancez.",
  FOURNISSEUR_INDISPONIBLE:
    "Le fournisseur d'IA était indisponible : l'évaluation s'est arrêtée (aucune nouvelle tentative automatique).",
  DELAI_DEPASSE:
    "Le fournisseur d'IA n'a pas répondu dans le délai imparti : l'évaluation s'est arrêtée (aucune nouvelle tentative automatique).",
  REQUETE_REFUSEE: "Le fournisseur d'IA a refusé la requête (modèle ou paramètres non acceptés).",
  REPONSE_INVALIDE: "La réponse du fournisseur d'IA était illisible : l'évaluation s'est arrêtée.",
  REPONSE_TROP_GRANDE:
    "La réponse du fournisseur d'IA était trop volumineuse : l'évaluation s'est arrêtée.",
};

/** Causes connues, pour les tests d'exhaustivité. */
export const CAUSES_CONNUES: readonly string[] = Object.keys(LIBELLES_CAUSE);

/** Texte de la cause d'une demande ; vide si la demande n'a pas de cause (réussie, en cours). */
export function libelleCause(cause: string | null | undefined): string | null {
  if (cause === null || cause === undefined || cause === "") return null;
  return LIBELLES_CAUSE[cause] ?? "L'évaluation s'est arrêtée pour une cause non reconnue.";
}

/**
 * Phrase qui résume ce que le statut permet : seule une évaluation RÉUSSIE débloque
 * l'activation en production.
 */
export function consequenceStatut(statut: string): string {
  switch (statut) {
    case "reussie":
      return "Cette version de prompt, avec ce modèle, peut être activée en production.";
    case "echouee":
      return "Cette version ne peut pas être activée en production : corrigez-la puis relancez le rejeu.";
    case "incomplete":
      return "Une évaluation incomplète ne débloque rien : relancez le rejeu une fois la cause levée.";
    case "ignoree":
      return "Aucun appel n'a été fait : rien n'est débloqué. Relancez le rejeu une fois la cause levée.";
    case "en_file":
    case "en_cours":
      return "Le rejeu est en cours : le résultat s'affiche ici dès qu'il est connu.";
    default:
      return "";
  }
}

/* ----- Règle métier et confirmation ----- */

export const REGLE_PRODUCTION: readonly string[] = [
  "En production, seul un prompt dont l'évaluation sur OpenRouter est réussie peut être activé et exécuté par un agent.",
  "Une évaluation locale ne suffit pas, ni une évaluation échouée ou incomplète.",
  "Changer de prompt, de modèle ou de jeu d'essai impose un nouveau rejeu.",
  "Un rejeu appelle réellement le modèle : il est facturé, plafonné par évaluation et il compte dans le plafond mensuel du cabinet.",
];

/** Question posée avant de lancer un rejeu payant : le plafond par évaluation, s'il est connu. */
export function questionConfirmation(plafondMicroUsd: number | null | undefined): string {
  const plafond =
    typeof plafondMicroUsd === "number" && Number.isFinite(plafondMicroUsd)
      ? `Le coût de cette évaluation est plafonné à ${formaterMicroUsd(plafondMicroUsd)}`
      : "Un rejeu est facturé : le coût de cette évaluation est plafonné";
  return `${plafond}, et il compte dans le plafond mensuel du cabinet. Lancer le rejeu réel sur OpenRouter ?`;
}

/** Plafond par évaluation connu : celui de la demande la plus récente qui le porte. */
export function plafondConnu(demandes: readonly DemandeEvaluationOpenRouter[]): number | null {
  for (const d of demandes) {
    if (typeof d.plafond_evaluation_micro_usd === "number") return d.plafond_evaluation_micro_usd;
  }
  return null;
}

export interface PossibiliteLancement {
  possible: boolean;
  /** Explication quand le lancement est désactivé. */
  raison: string | null;
}

/** Lancement désactivé avec son explication (confort : l'API fait foi). */
export function possibiliteLancement(
  peutLancer: boolean,
  promptChoisi: boolean,
  derniere: Pick<DemandeEvaluationOpenRouter, "statut"> | null,
): PossibiliteLancement {
  if (!peutLancer) {
    return {
      possible: false,
      raison:
        "Le lancement d'un rejeu est réservé aux rôles qui gèrent les agents IA (expert métier, associé).",
    };
  }
  if (!promptChoisi)
    return { possible: false, raison: "Choisissez d'abord une version de prompt." };
  if (derniere && estEnAttente(derniere.statut)) {
    return {
      possible: false,
      raison: "Un rejeu est déjà en file ou en cours pour ce cabinet : attendez sa fin.",
    };
  }
  return { possible: true, raison: null };
}

/* ----- Saisie du modèle ----- */

const FORMAT_MODELE = /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,99}$/;

/** Modèle candidat facultatif : vide = modèle de la tâche (corps `{}`). */
export function lireModeleCandidat(modele: string): Resultat<{ modele?: string }, "modele"> {
  const m = modele.trim();
  if (m === "") return { ok: true, charge: {} };
  if (!FORMAT_MODELE.test(m)) {
    return { ok: false, erreurs: { modele: "Format attendu : « fournisseur/modèle »." } };
  }
  return { ok: true, charge: { modele: m } };
}

/* ----- Messages d'erreur du lancement ----- */

const MESSAGES_LANCEMENT: Record<string, string> = {
  JEU_ESSAI_ABSENT:
    "Aucun jeu d'essai pour ce prompt : créez-en un d'abord (section « Jeux d'essai »).",
  IA_DESACTIVEE:
    "L'IA est désactivée pour le cabinet : activez-la dans les paramètres IA avant de lancer un rejeu réel.",
  IA_NON_CONFIGUREE:
    "Aucune clé API d'IA n'est disponible (cabinet ou plateforme) : enregistrez une clé dans les paramètres IA.",
  PLAFOND_IA_ATTEINT:
    "Le plafond mensuel de coût IA du cabinet est atteint : le rejeu est refusé. Relevez le plafond ou attendez le mois suivant.",
  EVALUATION_EN_COURS:
    "Un rejeu est déjà en file ou en cours pour ce cabinet : attendez sa fin avant d'en lancer un autre.",
  TROP_DE_REJEUX:
    "Le nombre de rejeux payants des dernières 24 heures est atteint pour le cabinet : réessayez plus tard.",
  EVALUATION_DEJA_REUSSIE:
    "Cette version de prompt a déjà été évaluée avec succès pour ce modèle et ce jeu d'essai : un nouveau rejeu n'est pas nécessaire.",
  PLAFOND_EVALUATION_ESTIME:
    "Le coût estimé de ce jeu d'essai dépasse le plafond par évaluation : réduisez le nombre de cas ou la taille des variables.",
  EVALUATION_INCOHERENTE:
    "L'enregistrement de l'évaluation a été refusé par le contrôle d'intégrité : relancez le rejeu.",
};

export function messageLancementEvaluation(e: unknown): string {
  if (e instanceof ErreurApi && MESSAGES_LANCEMENT[e.code])
    return MESSAGES_LANCEMENT[e.code] as string;
  if (e instanceof ErreurApi && e.statut === 400 && e.code === "REQUETE_INVALIDE") {
    // « Modèle non autorisé » : le message de l'API est précis et français.
    return e.message === "Données invalides."
      ? "Le modèle saisi est refusé : choisissez un modèle au tarif connu (liste des paramètres IA)."
      : e.message;
  }
  return messageAgents(e);
}

/* ----- Présentation d'une demande ----- */

const pluriel = (n: number, singulier: string, plur: string) => (n > 1 ? plur : singulier);

/** « 3 cas évalués sur 5 », « 1 cas évalué sur 1 », « 0 cas évalué sur 4 ». */
export function libelleProgression(
  d: Pick<DemandeEvaluationOpenRouter, "cas_traites" | "cas_total">,
) {
  const n = d.cas_traites;
  return `${formaterNombre(n, 0)} ${pluriel(n, "cas évalué", "cas évalués")} sur ${formaterNombre(d.cas_total, 0)}`;
}

/** « 4 cas réussis sur 5 » ; null tant qu'aucune évaluation n'est enregistrée. */
export function libelleReussite(
  d: Pick<DemandeEvaluationOpenRouter, "cas_reussis" | "cas_total">,
): string | null {
  if (d.cas_reussis === null || d.cas_reussis === undefined) return null;
  const n = d.cas_reussis;
  return `${formaterNombre(n, 0)} ${pluriel(n, "cas réussi", "cas réussis")} sur ${formaterNombre(d.cas_total, 0)}`;
}

/** « 1 régression », « 2 régressions » ; null s'il n'y en a pas ou si le compte est inconnu. */
export function libelleRegressions(regressions: number | null | undefined): string | null {
  if (typeof regressions !== "number" || regressions <= 0) return null;
  return `${formaterNombre(regressions, 0)} ${pluriel(regressions, "régression", "régressions")}`;
}

export type EtatCas = "reussi" | "echoue" | "non_evalue";

export function etatCas(c: Pick<ResultatCasOpenRouter, "reussi" | "raisons">): EtatCas {
  if (c.raisons.includes("NON_EVALUE")) return "non_evalue";
  return c.reussi ? "reussi" : "echoue";
}

export const LIBELLES_ETAT_CAS: Record<EtatCas, string> = {
  reussi: "Réussi",
  echoue: "Échoué",
  non_evalue: "Non évalué",
};

export const TONALITES_ETAT_CAS: Record<EtatCas, TonaliteDemande> = {
  reussi: "succes",
  echoue: "danger",
  non_evalue: "neutre",
};

/** Raisons lisibles d'un cas (« NON_EVALUE » n'est pas une raison d'échec). */
export function raisonsCas(c: Pick<ResultatCasOpenRouter, "raisons">): string[] {
  return c.raisons.filter((r) => r !== "NON_EVALUE").map(libelleRaisonCas);
}

/** Comparaison à la version active, pour un cas échoué seulement. */
export function noteReference(c: Pick<ResultatCasOpenRouter, "reussi" | "reference_reussi">) {
  if (c.reussi || c.reference_reussi === null || c.reference_reussi === undefined) return null;
  return c.reference_reussi
    ? "La version active réussissait ce cas : régression."
    : "La version active échouait aussi ce cas.";
}

/* ----- Coût et jetons : seulement si l'API les fournit ----- */

/** Coût en dollars ; null (rien à afficher) si le champ est absent : jamais « 0 » par défaut. */
export function formaterCoutDemande(micro: number | null | undefined): string | null {
  return typeof micro === "number" && Number.isFinite(micro) ? formaterMicroUsd(micro) : null;
}

export interface LigneCout {
  libelle: string;
  valeur: string;
}

/** Lignes « coût, estimation, plafond, jetons » : seuls les champs présents, vide sans `finance.lire`. */
export function lignesCout(d: DemandeEvaluationOpenRouter): LigneCout[] {
  const lignes: LigneCout[] = [];
  const cout = formaterCoutDemande(d.cout_micro_usd);
  if (cout !== null) lignes.push({ libelle: "Coût réel", valeur: cout });
  const estime = formaterCoutDemande(d.cout_estime_micro_usd);
  if (estime !== null) lignes.push({ libelle: "Coût maximal estimé", valeur: estime });
  const plafond = formaterCoutDemande(d.plafond_evaluation_micro_usd);
  if (plafond !== null) lignes.push({ libelle: "Plafond de l'évaluation", valeur: plafond });
  if (typeof d.tokens_entree === "number" || typeof d.tokens_sortie === "number") {
    const e = typeof d.tokens_entree === "number" ? formaterNombre(d.tokens_entree, 0) : null;
    const s = typeof d.tokens_sortie === "number" ? formaterNombre(d.tokens_sortie, 0) : null;
    const parts = [
      e !== null ? `${e} en entrée` : null,
      s !== null ? `${s} en sortie` : null,
    ].filter((x): x is string => x !== null);
    lignes.push({ libelle: "Jetons", valeur: parts.join(" · ") });
  }
  return lignes;
}

/** Jetons et coût d'un cas, seulement s'ils sont présents. */
export function detailCoutCas(c: ResultatCasOpenRouter): string | null {
  const parts: string[] = [];
  const cout = formaterCoutDemande(c.cout_micro_usd);
  if (cout !== null) parts.push(cout);
  if (typeof c.tokens_entree === "number" && typeof c.tokens_sortie === "number") {
    parts.push(
      `${formaterNombre(c.tokens_entree, 0)} jetons en entrée, ${formaterNombre(c.tokens_sortie, 0)} en sortie`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/* ----- Liste et sondage ----- */

/** Remplace la demande de même identifiant, sinon l'ajoute en tête (la plus récente d'abord). */
export function fusionnerDemande(
  liste: readonly DemandeEvaluationOpenRouter[],
  demande: DemandeEvaluationOpenRouter,
): DemandeEvaluationOpenRouter[] {
  const i = liste.findIndex((d) => d.demande_id === demande.demande_id);
  if (i === -1) return [demande, ...liste];
  return liste.map((d, j) => (j === i ? demande : d));
}

/** Ajoute une page à la liste sans doublon (une demande déjà présente garde sa version fraîche). */
export function ajouterPage(
  liste: readonly DemandeEvaluationOpenRouter[],
  page: readonly DemandeEvaluationOpenRouter[],
): DemandeEvaluationOpenRouter[] {
  const connus = new Set(liste.map((d) => d.demande_id));
  return [...liste, ...page.filter((d) => !connus.has(d.demande_id))];
}

/** Sondage du statut d'une demande en file ou en cours : espacé, borné, jamais infini. */
export const INTERVALLE_SONDAGE_MS = 5000;
/** 360 sondages à 5 s : 30 minutes, au-delà de la durée maximale d'un rejeu (10 min) et de sa péremption. */
export const SONDAGES_MAX = 360;
/** Échecs de lecture consécutifs après lesquels le suivi automatique s'arrête. */
export const ECHECS_SONDAGE_MAX = 3;

/** Poursuivre le sondage ? Non si la demande est terminée, ou si une borne est atteinte. */
export function sondageContinue(statut: string, sondages: number, echecsConsecutifs: number) {
  return estEnAttente(statut) && sondages < SONDAGES_MAX && echecsConsecutifs < ECHECS_SONDAGE_MAX;
}
