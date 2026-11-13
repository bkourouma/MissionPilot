import type { Langue } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";

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

const MESSAGES_EN: Record<string, string> = {
  PROMOTION_NON_ELIGIBLE: "Promotion refused: the building block does not meet the criteria yet.",
  PROMOTION_PAR_PALIER: "Autonomy can only be raised one level at a time.",
  PLAFOND_BRIQUE: "This level exceeds the ceiling of the building block or of the agent.",
  PLAFOND_AGENT: "This level exceeds the one the standard grants to this agent.",
  NIVEAU_INCHANGE: "The building block is already at this level.",
  BRIQUE_EXISTE: "This building block is already assigned to an agent.",
  COUPE_CIRCUIT_INCHANGE: "The circuit breaker is already in this state.",
  JEU_ESSAI_ABSENT: "No test set for this prompt: create one first.",
  AGENT_INACTIF: "This agent is disabled for the firm.",
};

export function messageAgents(e: unknown, langue: Langue = "fr"): string {
  const messages = langue === "en" ? MESSAGES_EN : MESSAGES;
  if (e instanceof ErreurApi && messages[e.code]) return messages[e.code] as string;
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
