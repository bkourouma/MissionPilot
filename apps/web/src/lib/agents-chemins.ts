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
