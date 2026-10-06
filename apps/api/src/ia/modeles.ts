import type { TacheGenerative, TacheIa } from "@missionpilot/shared";
import { diviserAuDessus } from "./fournisseur.js";

/*
 * Modèles recommandés et tarifs (ADR-003, DECISIONS : « le système
 * recommande un modèle par défaut, modifiable par le cabinet »).
 *
 * VALEURS DE DÉPART À VALIDER : les identifiants et les prix des modèles
 * OpenRouter évoluent ; ils sont relevés ici à titre indicatif et doivent
 * être revus avant le pilote, avec la clause « pas d'entraînement sur les
 * données » de chaque modèle retenu. Le cabinet choisit un autre modèle par
 * tâche (ia_modeles_taches) PARMI ceux de TARIFS_MODELES seulement
 * (`modeleAutorise`, contrôlé par PUT /api/ia/parametres) : un modèle au
 * tarif inconnu fausserait le plafond. Un modèle inconnu resté en base (ou
 * annoncé par le fournisseur) est valorisé au tarif TRÈS prudent
 * TARIF_INCONNU, pour que le plafond mensuel reste protecteur.
 */

export const MODELES_RECOMMANDES: Readonly<Record<TacheIa, string>> = {
  // Rédaction et analyse : modèle Claude (PRD, « Décisions techniques »).
  redaction: "anthropic/claude-sonnet-4.5",
  analyse: "anthropic/claude-sonnet-4.5",
  // Extraction et classification : modèle plus léger.
  extraction: "google/gemini-2.5-flash",
  classification: "google/gemini-2.5-flash",
  embedding: "openai/text-embedding-3-small",
};

/** Tarif en nano-dollars US par jeton (= dollars par million de jetons × 1 000). */
export interface Tarif {
  entree: number;
  sortie: number;
}

export const TARIFS_MODELES: Readonly<Record<string, Tarif>> = {
  "anthropic/claude-sonnet-4.5": { entree: 3_000, sortie: 15_000 },
  "anthropic/claude-haiku-4.5": { entree: 1_000, sortie: 5_000 },
  "google/gemini-2.5-flash": { entree: 300, sortie: 2_500 },
  "openai/gpt-4o-mini": { entree: 150, sortie: 600 },
  "openai/text-embedding-3-small": { entree: 20, sortie: 0 },
};

/**
 * Tarif d'un modèle inconnu : 200 USD (entrée) et 600 USD (sortie) par million
 * de jetons, bien au-dessus de tout modèle courant, pour ne jamais
 * sous-estimer le plafond.
 */
export const TARIF_INCONNU: Tarif = { entree: 200_000, sortie: 600_000 };

/** Modèles qu'un cabinet peut choisir : ceux dont le tarif est connu. */
export const MODELES_AUTORISES: readonly string[] = Object.keys(TARIFS_MODELES);

/** Plafond de jetons de sortie par tâche. */
export const MAX_TOKENS_SORTIE: Readonly<Record<TacheGenerative, number>> = {
  redaction: 4_000,
  analyse: 4_000,
  extraction: 2_000,
  classification: 500,
};

/** Plafond mensuel de départ d'un cabinet : 50 USD (à valider par le métier). */
export const PLAFOND_MENSUEL_DEPART_MICRO_USD = 50_000_000;

export function tarifDe(modele: string): { tarif: Tarif; connu: boolean } {
  // Variante (« :free », « :nitro ») : même tarif de référence, prudent.
  const tarif = TARIFS_MODELES[modele] ?? TARIFS_MODELES[modele.split(":")[0] ?? ""];
  return tarif ? { tarif, connu: true } : { tarif: TARIF_INCONNU, connu: false };
}

/**
 * Un modèle est choisissable s'il figure TEL QUEL dans TARIFS_MODELES : pas de
 * variante (« :online » ajoute par exemple une recherche web au coût non
 * compté).
 */
export function modeleAutorise(modele: string): boolean {
  return Object.prototype.hasOwnProperty.call(TARIFS_MODELES, modele);
}

/**
 * Coût estimé en micro-dollars US, arrondi AU-DESSUS (entiers seulement) :
 * jetons × tarif (nano-dollars) / 1 000.
 */
export function coutMicroUsd(modele: string, tokensEntree: number, tokensSortie: number) {
  const { tarif, connu } = tarifDe(modele);
  const nano = tokensEntree * tarif.entree + tokensSortie * tarif.sortie;
  return { cout: diviserAuDessus(nano, 1000), connu };
}
