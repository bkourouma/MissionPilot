import type { FastifyRequest } from "fastify";
import { COOKIE_LANGUE, ENTETE_LANGUE, resoudreLangue, type Langue } from "@missionpilot/shared";
import { MESSAGES_EN, MOTIFS_EN } from "./messages-en.js";

/**
 * Langue d'une requête : en-tête des appels serveur du web (`x-mp-langue`), puis cookie du
 * sélecteur (navigateur, même origine), puis `Accept-Language`, puis français.
 */
export function langueDeRequete(request: FastifyRequest): Langue {
  const entete = request.headers[ENTETE_LANGUE];
  const choix =
    (typeof entete === "string" ? entete : undefined) ?? request.cookies?.[COOKIE_LANGUE];
  return resoudreLangue(choix, request.headers["accept-language"]);
}

/**
 * Message d'erreur dans la langue demandée. Les messages sont écrits en français dans le code
 * (langue de référence) ; leur version anglaise vient de la table exacte, puis des motifs (messages
 * à partie variable). Sans traduction connue, le message français est rendu tel quel.
 */
export function traduireMessage(message: string, langue: Langue): string {
  if (langue === "fr") return message;
  const exact = MESSAGES_EN[message];
  if (exact !== undefined) return exact;
  for (const [motif, rendu] of MOTIFS_EN) {
    const m = motif.exec(message);
    if (m) return rendu(...m.slice(1).map((g) => traduireFragment(g ?? "")));
  }
  return message;
}

/** Fragment variable d'un motif (« Mission » de « Mission introuvable. ») : traduit s'il est connu. */
function traduireFragment(fragment: string): string {
  return MESSAGES_EN[fragment] ?? fragment;
}
