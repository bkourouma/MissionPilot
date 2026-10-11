import {
  FENETRE_MESSAGES_COPILOTE_MINUTES,
  MESSAGES_COPILOTE_PAR_FENETRE,
} from "@missionpilot/shared";
import { AppError, conflit } from "../errors.js";

/*
 * Erreurs du copilote (AGT-08) : messages en français, sans donnée sensible (jamais le texte du
 * message, une clé ou un contenu client). Les SQLSTATE `MPG10` et `MPG11` de la table
 * `copilote_actions` (migration 0271) se traduisent ici, jamais en 500.
 */

export const tropDeMessagesCopilote = () =>
  new AppError(
    429,
    "TROP_DE_MESSAGES_COPILOTE",
    `Au plus ${MESSAGES_COPILOTE_PAR_FENETRE} messages par ${FENETRE_MESSAGES_COPILOTE_MINUTES} minutes au copilote : réessayez plus tard.`,
  );

export const copiloteDesactive = () =>
  new AppError(409, "COPILOTE_DESACTIVE", "Le copilote est désactivé par votre cabinet.");

export const copiloteActionNonAutorisee = () =>
  new AppError(
    409,
    "COPILOTE_ACTION_NON_AUTORISEE",
    "Votre cabinet limite le copilote à la lecture : il ne peut ni proposer ni confirmer une action (niveau d'autonomie N2 requis).",
  );

export const actionIntrouvable = () =>
  new AppError(404, "INTROUVABLE", "Proposition d'action introuvable.");

export const actionExpiree = () =>
  new AppError(
    410,
    "ACTION_EXPIREE",
    "Cette proposition a expiré : reformulez votre demande pour en obtenir une nouvelle.",
  );

const PHRASES_ETAT: Record<string, string> = {
  confirmee: "Cette proposition a déjà été confirmée.",
  annulee: "Cette proposition a été annulée.",
  expiree: "Cette proposition a expiré : reformulez votre demande pour en obtenir une nouvelle.",
  refusee: "Cette proposition a été refusée : vos droits ne la permettent plus.",
};

export const actionDejaTraitee = (statut: string) =>
  conflit(PHRASES_ETAT[statut] ?? "Cette proposition n'est plus valable.");

export const actionAlteree = () =>
  conflit("Cette proposition ne correspond plus à ce qui avait été proposé : elle est refusée.");

/** Traduit les violations de la table des actions en erreurs d'API (409), sinon relance. */
export function traduireErreurCopilote(error: unknown): never {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "MPG10") {
    throw conflit("Cette proposition est terminée : elle ne peut plus être modifiée.");
  }
  if (code === "MPG11") {
    throw conflit("Cette proposition est incohérente : elle est refusée.");
  }
  throw error;
}
