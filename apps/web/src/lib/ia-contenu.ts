/**
 * Cycle d'un contenu IA « brouillon IA → modifié → validé » (PRD SOC-06, ADR-003) : types des
 * réponses de /api/ia/generations, libellés, droits d'action affichés, saisies, suivi d'une
 * génération en file. Logique pure, testée dans `ia-contenu.test.ts`.
 *
 * L'IA propose, l'expert dispose : seul un contenu « validé » par un humain peut atteindre le
 * client (`livrable_client`). Les règles reproduisent celles de l'API, qui reste seule juge
 * (403 APPROBATION_REQUISE, 409 CHIFFRES_NON_VERIFIES ou CONTENU_VALIDE).
 */
import {
  aPermission,
  STATUTS_GENERATION,
  type Role,
  type SourceIa,
  type StatutContenu,
  type StatutGeneration,
  type TacheIa,
  type TermeSensible,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { NomIcone } from "../components/ui/Icone";
import { formaterDateHeure, formaterNombre } from "./format";
import { formaterMicroUsd } from "./ia";
import type { Resultat } from "./saisie";

// --- Réponses de l'API -----------------------------------------------------------------------

/**
 * Traçabilité de l'appel (version 1). Sans « finance.lire », l'API ne renvoie que `fournisseur`
 * et `duree_ms` : modèle, jetons et coût sont des données de gestion, ABSENTS de la réponse
 * (jamais remplacés par un zéro). L'écran n'affiche donc que les champs présents.
 */
export interface TraceIa {
  fournisseur: string;
  duree_ms?: number | null;
  modele?: string | null;
  tokens_entree?: number | null;
  tokens_sortie?: number | null;
  cout_micro_usd?: number;
}

/** Version d'un contenu (ajout seul) : la 1 vient de l'IA ou du gabarit, les suivantes d'un humain. */
export interface VersionContenuIa {
  version: number;
  statut_contenu: StatutContenu;
  fournisseur: string;
  auteur_id: string;
  auteur_nom: string | null;
  chiffres_non_verifies: boolean;
  nombres_non_verifies: string[];
  chiffres_acquittes: boolean | null;
  texte: string;
  cree_le: string;
}

/**
 * Échec d'une génération : `code` parmi DELAI_DEPASSE, REPONSE_INVALIDE, REPONSE_TROP_GRANDE,
 * GENERATIONS_SIMULTANEES, PLAFOND_IA_ATTEINT, ERREUR_INTERNE (ou un autre code du fournisseur) ;
 * `message` en français, fourni par l'API.
 */
export interface ErreurGenerationIa {
  code: string;
  message: string;
}

/**
 * GET /api/ia/generations/:id (le détail ajoute `versions`) ; la liste omet `texte`.
 * `prompt.exemple` : essai fait avec un prompt « exemple », JAMAIS livrable au client, même
 * validé (`livrable_client` reste faux).
 */
export interface GenerationIa {
  id: string;
  tache: TacheIa;
  prompt: { id: string; nom: string; version: number; exemple: boolean };
  mission_id: string | null;
  entite: { type: string; id: string } | null;
  demandeur: { id: string; nom: string };
  statut: StatutGeneration;
  progression: number;
  erreur: ErreurGenerationIa | null;
  statut_contenu: StatutContenu | null;
  livrable_client: boolean;
  version: number | null;
  texte?: string | null;
  donnees?: Record<string, unknown> | null;
  /** Contenu produit sans IA par un gabarit déterministe. */
  gabarit: boolean | null;
  chiffres_non_verifies: boolean | null;
  nombres_non_verifies: string[];
  chiffres_acquittes: boolean | null;
  sources: SourceIa[];
  trace: TraceIa | null;
  /** Empreinte de l'entrée (jamais l'entrée en clair) et noms des champs fournis. */
  entree?: { empreinte: string; champs: string[] };
  cree_le: string;
  termine_le: string | null;
  versions?: VersionContenuIa[];
}

// --- Libellés --------------------------------------------------------------------------------

export interface PresentationStatut {
  libelle: string;
  tonalite: TonaliteStatut;
  icone: NomIcone;
  aide: string;
}

/** Statut du contenu : texte et icône propres (la couleur ne porte jamais seule le sens). */
export const STATUT_CONTENU_IA: Record<StatutContenu, PresentationStatut> = {
  brouillon_ia: {
    libelle: "Brouillon IA",
    tonalite: "attention",
    icone: "attention",
    aide: "Contenu proposé par l'IA ou un gabarit : à relire et valider avant tout envoi au client.",
  },
  modifie: {
    libelle: "Modifié",
    tonalite: "neutre",
    icone: "crayon",
    aide: "Relu et corrigé par un humain, en attente de validation.",
  },
  valide: {
    libelle: "Validé",
    tonalite: "succes",
    icone: "succes",
    aide: "Validé par un humain : contenu définitif.",
  },
};

export const STATUT_GENERATION_IA: Record<StatutGeneration, Omit<PresentationStatut, "aide">> = {
  en_file: { libelle: "En file d'attente", tonalite: "neutre", icone: "horloge" },
  en_cours: { libelle: "Génération en cours", tonalite: "neutre", icone: "historique" },
  terminee: { libelle: "Terminée", tonalite: "succes", icone: "succes" },
  echec: { libelle: "Échec", tonalite: "danger", icone: "danger" },
  annulee: { libelle: "Annulée", tonalite: "neutre", icone: "fermer" },
};

/** Essai fait avec un prompt « exemple » : jamais livrable au client, même validé. */
export const estEssai = (g: Pick<GenerationIa, "prompt">) => g.prompt.exemple === true;

export const MESSAGE_ESSAI =
  "Contenu d'essai (prompt d'exemple) : il n'est jamais transmis au client, même validé.";

/** Phrase de livraison d'un contenu validé, d'après `livrable_client` (seul juge : l'API). */
function phraseLivraison(g: Pick<GenerationIa, "livrable_client" | "prompt">): string {
  if (g.livrable_client) return "Il peut être transmis au client.";
  return estEssai(g)
    ? "Contenu d'essai : il n'est jamais transmis au client."
    : "Il n'est pas marqué livrable au client.";
}

/** Validé : livrable au client seulement si l'API le dit (jamais un essai). */
export function messageValide(
  g: Pick<GenerationIa, "livrable_client" | "chiffres_acquittes" | "prompt">,
) {
  const acquit = g.chiffres_acquittes
    ? " Les nombres signalés ont été attestés par le valideur."
    : "";
  return `Validé par un humain : contenu définitif. ${phraseLivraison(g)}${acquit}`;
}

/** Message de réussite de la validation (réponse de POST …/valider). */
export function messageSuccesValidation(g: Pick<GenerationIa, "livrable_client" | "prompt">) {
  return `Contenu validé : il est définitif. ${phraseLivraison(g)}`;
}

/** Échec d'une génération : message de l'API complété de la conduite à tenir. */
const CONSEILS_ECHEC: Readonly<Record<string, string>> = {
  DELAI_DEPASSE: "Relancez la génération ; l'appel a pu être facturé et reste compté.",
  REPONSE_INVALIDE: "Relancez la génération ; l'appel a pu être facturé et reste compté.",
  REPONSE_TROP_GRANDE: "Relancez la génération ; l'appel a pu être facturé et reste compté.",
  GENERATIONS_SIMULTANEES: "Relancez la génération dans un instant.",
  PLAFOND_IA_ATTEINT:
    "Relancez-la en acceptant le gabarit, ou attendez le mois prochain ou le relèvement du plafond.",
  ERREUR_INTERNE: "Relancez la génération ; si l'échec se répète, prévenez le support.",
};

export function messageEchecGeneration(erreur: ErreurGenerationIa | null | undefined): string {
  const base = erreur?.message?.trim() || "Échec de la génération.";
  const conseil = erreur ? CONSEILS_ECHEC[erreur.code] : undefined;
  return conseil ? `${base} ${conseil}` : base;
}

/** Message affiché sur tout contenu produit sans appel au modèle. */
export const MESSAGE_GABARIT = "Contenu généré sans IA par un gabarit";
export const AIDE_GABARIT =
  "Aucun modèle d'IA n'a été appelé : le texte vient d'un gabarit déterministe. Il suit la même relecture et la même validation humaine.";

export const TYPE_SOURCE_LIBELLES: Record<string, string> = {
  mission: "Mission",
  mission_document: "Document de mission",
  moteur: "Moteur de calcul",
};

const TERMINAUX: readonly StatutGeneration[] = ["terminee", "echec", "annulee"];

export const estTerminal = (statut: StatutGeneration) => TERMINAUX.includes(statut);

/** Statut reçu d'une version plus récente de l'API : traité comme « en cours ». */
export function statutConnu(statut: string): StatutGeneration {
  return (STATUTS_GENERATION as readonly string[]).includes(statut)
    ? (statut as StatutGeneration)
    : "en_cours";
}

/** « 1,2 s », « 850 ms ». */
export function libelleDuree(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${formaterNombre(ms, 0)}\u00a0ms`;
  return `${formaterNombre(ms / 1000, 1)}\u00a0s`;
}

/**
 * Lignes de traçabilité : prompt, production, puis seulement les champs que l'API a renvoyés
 * (modèle, jetons et coût sont absents sans « finance.lire » : aucune ligne, jamais un zéro).
 */
export function lignesTracabilite(
  g: Pick<GenerationIa, "prompt" | "gabarit" | "trace" | "termine_le">,
): [string, string][] {
  const t = g.trace;
  const lignes: [string, string][] = [
    ["Prompt", `« ${g.prompt.nom} », version ${g.prompt.version}`],
    [
      "Production",
      g.gabarit
        ? "Gabarit déterministe (aucun appel à un modèle)"
        : t
          ? `Fournisseur ${t.fournisseur}`
          : "—",
    ],
  ];
  if (typeof t?.modele === "string" && t.modele !== "") lignes.push(["Modèle", t.modele]);
  if (typeof t?.duree_ms === "number") lignes.push(["Durée", libelleDuree(t.duree_ms)]);
  if (typeof t?.tokens_entree === "number" && typeof t?.tokens_sortie === "number") {
    lignes.push([
      "Jetons",
      `${formaterNombre(t.tokens_entree, 0)} en entrée, ${formaterNombre(t.tokens_sortie, 0)} en sortie`,
    ]);
  }
  if (typeof t?.cout_micro_usd === "number") {
    lignes.push(["Coût estimé", formaterMicroUsd(t.cout_micro_usd)]);
  }
  if (g.termine_le) lignes.push(["Terminée le", formaterDateHeure(g.termine_le)]);
  return lignes;
}

/** « Version 2 · Modifié · par Awa Koné · 12 oct. 2026 à 14:05 ». */
export function libelleVersion(v: VersionContenuIa): string {
  const statut = STATUT_CONTENU_IA[v.statut_contenu]?.libelle ?? v.statut_contenu;
  const auteur =
    v.version === 1 && v.fournisseur !== "humain"
      ? v.fournisseur === "gabarit"
        ? "gabarit"
        : "IA"
      : (v.auteur_nom ?? "auteur inconnu");
  return `Version ${v.version} · ${statut} · par ${auteur} · ${formaterDateHeure(v.cree_le)}`;
}

/** Version qui précède `version` dans l'historique (null pour la première). */
export function versionPrecedente(
  versions: readonly VersionContenuIa[],
  version: number,
): VersionContenuIa | null {
  let meilleure: VersionContenuIa | null = null;
  for (const v of versions) {
    if (v.version < version && (!meilleure || v.version > meilleure.version)) meilleure = v;
  }
  return meilleure;
}

// --- Droits d'action (confort d'affichage ; l'API décide) -----------------------------------

export interface UtilisateurIa {
  id: string;
  roles: readonly Role[];
}

/** Auteurs des versions : le demandeur (version 1) et chaque relecteur. */
export function contributeursDe(g: Pick<GenerationIa, "demandeur" | "versions">): Set<string> {
  return new Set([g.demandeur.id, ...(g.versions ?? []).map((v) => v.auteur_id)]);
}

export interface ActionsGeneration {
  modifier: boolean;
  valider: boolean;
  /** Pourquoi la validation n'est pas proposée à cet utilisateur. */
  raisonValidation: string | null;
  annuler: boolean;
}

const VALIDATION_PAR_AUTRUI =
  "sa validation revient à une autre personne (responsable de la mission ou associé).";
export const RAISON_DEMANDEUR = `Vous avez demandé ce contenu : ${VALIDATION_PAR_AUTRUI}`;
export const RAISON_AUTEUR_VERSION = `Vous avez rédigé une version de ce contenu : ${VALIDATION_PAR_AUTRUI}`;

/**
 * Pourquoi l'API refuserait la validation à cet utilisateur (403 APPROBATION_REQUISE) : il est
 * le demandeur, ou l'auteur d'UNE version quelconque (pas seulement la dernière). Un associé
 * n'est jamais exclu. null : rien ne l'exclut côté écran (l'API reste juge, notamment des
 * droits sur la mission).
 */
export function raisonExclusionValidation(
  g: Pick<GenerationIa, "demandeur" | "versions">,
  u: UtilisateurIa | undefined,
): string | null {
  if (!u || u.roles.includes("associe")) return null;
  if (g.demandeur.id === u.id) return RAISON_DEMANDEUR;
  return (g.versions ?? []).some((v) => v.auteur_id === u.id) ? RAISON_AUTEUR_VERSION : null;
}

/** Contenu produit, non validé : il peut être relu, modifié puis validé. */
export function contenuOuvert(g: GenerationIa): boolean {
  return (
    g.statut === "terminee" &&
    g.version !== null &&
    g.statut_contenu !== null &&
    g.statut_contenu !== "valide"
  );
}

/**
 * Séparation des tâches (API) : ni le demandeur ni l'auteur d'une version ne valide, sauf un
 * associé. `refusValidation` : message d'un refus APPROBATION_REQUISE déjà reçu de l'API (droits
 * sur la mission) ; « Valider » est alors masqué et ce message l'explique. Sans utilisateur
 * connu, tout est proposé et l'API tranche.
 */
export function actionsGeneration(
  g: GenerationIa,
  u?: UtilisateurIa,
  refusValidation?: string | null,
): ActionsGeneration {
  const ouvert = contenuOuvert(g);
  const raison = raisonExclusionValidation(g, u) ?? refusValidation ?? null;
  const enAttente = g.statut === "en_file" || g.statut === "en_cours";
  return {
    modifier: ouvert,
    valider: ouvert && raison === null,
    raisonValidation: ouvert ? raison : null,
    annuler:
      enAttente &&
      (u === undefined || g.demandeur.id === u.id || aPermission(u.roles, "ia.configurer")),
  };
}

// --- Saisies ---------------------------------------------------------------------------------

export const LONGUEUR_MAX_TEXTE_IA = 100_000;

/** Texte modifié par l'humain : non vide, borné, différent de la version actuelle. */
export function validerTexteModifie(
  texte: string,
  actuel: string | null | undefined,
): Resultat<{ texte: string }, "texte"> {
  const t = texte.trim();
  if (t === "") return { ok: false, erreurs: { texte: "Le contenu ne peut pas être vide." } };
  if (t.length > LONGUEUR_MAX_TEXTE_IA) {
    return {
      ok: false,
      erreurs: { texte: "Le contenu ne doit pas dépasser 100 000 caractères." },
    };
  }
  if (t === (actuel ?? "").trim()) {
    return {
      ok: false,
      erreurs: { texte: "Aucune modification : le texte est identique à la version actuelle." },
    };
  }
  return { ok: true, charge: { texte: t } };
}

export const ERREUR_ACQUITTEMENT =
  "Cochez la case pour attester que vous avez vérifié chacun des nombres signalés.";

/** Validation : des chiffres non vérifiés exigent l'acquittement explicite de l'humain. */
export function validerAcquittement(
  g: Pick<GenerationIa, "chiffres_non_verifies">,
  acquitte: boolean,
): Resultat<{ acquitte_chiffres?: true }, "acquittement"> {
  if (g.chiffres_non_verifies !== true) return { ok: true, charge: {} };
  if (!acquitte) return { ok: false, erreurs: { acquittement: ERREUR_ACQUITTEMENT } };
  return { ok: true, charge: { acquitte_chiffres: true } };
}

/** Demande de génération d'un écran (POST /api/ia/generations). */
export interface DemandeGenerationIa {
  prompt_nom: string;
  variables?: Record<string, string>;
  termes_sensibles?: TermeSensible[];
  sources?: SourceIa[];
  mode?: "file" | "immediat";
  repli_si_plafond?: boolean;
}

/**
 * Corps envoyé à POST /api/ia/generations (essai d'un prompt « exemple »). Jamais de
 * `contexte_chiffres` ni de source « moteur » (les chiffres viennent des moteurs, côté serveur,
 * jamais du navigateur), ni de `mission_id` (un essai n'est rattaché à aucune mission). Les
 * services de conseil passent par leurs propres routes, qui établissent ces éléments.
 */
export function corpsGeneration(d: DemandeGenerationIa): Record<string, unknown> {
  const sources = (d.sources ?? []).filter((s) => s.type !== "moteur");
  return {
    prompt_nom: d.prompt_nom,
    variables: d.variables ?? {},
    mode: d.mode ?? "file",
    ...(d.termes_sensibles && d.termes_sensibles.length > 0
      ? { termes_sensibles: d.termes_sensibles }
      : {}),
    ...(sources.length > 0 ? { sources } : {}),
    ...(d.repli_si_plafond ? { repli_si_plafond: true } : {}),
  };
}

/** Termes à masquer avant l'envoi au fournisseur : un par ligne, sans doublon ni ligne vide. */
export function lireTermesSensibles(texte: string): Resultat<string[], "termes"> {
  const termes = [
    ...new Set(
      texte
        .split("\n")
        .map((t) => t.trim())
        .filter((t) => t !== ""),
    ),
  ];
  if (termes.length > 200) {
    return { ok: false, erreurs: { termes: "200 termes au plus, un par ligne." } };
  }
  if (termes.some((t) => t.length > 200)) {
    return { ok: false, erreurs: { termes: "Un terme ne doit pas dépasser 200 caractères." } };
  }
  return { ok: true, charge: termes };
}

// --- Suivi d'une génération en file ----------------------------------------------------------

/** Intervalles d'interrogation, espacés (réseau mobile) : 1 s, 2 s, 3 s, 5 s, 8 s puis 10 s. */
export const DELAIS_INTERROGATION_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 10_000] as const;
export const DELAI_MAX_INTERROGATION_MS = 30_000;
/** Au-delà, le suivi s'arrête et l'écran propose de recharger. */
export const DUREE_MAX_SUIVI_MS = 15 * 60_000;

/** Délai avant la prochaine interrogation ; chaque erreur réseau consécutive le double. */
export function delaiInterrogation(tentative: number, erreursConsecutives = 0): number {
  const rang = Math.min(Math.max(0, Math.trunc(tentative)), DELAIS_INTERROGATION_MS.length - 1);
  const base = DELAIS_INTERROGATION_MS[rang] ?? 10_000;
  const facteur = 2 ** Math.min(Math.max(0, Math.trunc(erreursConsecutives)), 5);
  return Math.min(base * facteur, DELAI_MAX_INTERROGATION_MS);
}

export const cheminGeneration = (id: string) => `/api/ia/generations/${encodeURIComponent(id)}`;

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant de génération lu dans l'URL (sinon null). */
export function lireIdGeneration(v: unknown): string | null {
  return typeof v === "string" && FORMAT_UUID.test(v) ? v.toLowerCase() : null;
}
