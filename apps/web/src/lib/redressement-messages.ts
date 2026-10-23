/** Redressement : messages d'erreur affichables en français. */
import { ErreurApi, messageErreur, CODE_ORIGINE_REFUSEE, CODE_TFA_A_CONFIGURER } from "./api";
import { libellePoste } from "./redressement-libelles";

// --- Messages d'erreur ------------------------------------------------------------------------------

/** « Il manque des postes dans la correspondance : Stocks, Créances clients. » */
export function messageBaseIncomplete(manquants: readonly string[]): string {
  const liste = manquants.map(libellePoste).join(", ");
  return liste === ""
    ? "Il manque des postes dans la correspondance."
    : `Il manque des postes dans la correspondance : ${liste}.`;
}

function manquantsDe(details: unknown): string[] {
  if (typeof details !== "object" || details === null) return [];
  const m = (details as { manquants?: unknown }).manquants;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Message affichable (français). Un refus de l'API (400 métier, 403, 404, 409, 429) s'affiche tel
 * quel : ses messages sont en français et ne recopient ni montant ni nom (SPEC-3a §9.4).
 */
export function messageRedressement(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "RED_BASE_INCOMPLETE") return messageBaseIncomplete(manquantsDe(e.details));
    if (e.code === CODE_TFA_A_CONFIGURER || e.code === CODE_ORIGINE_REFUSEE) {
      return messageErreur(e);
    }
    const generique = e.code === "REQUETE_INVALIDE" && e.message === "Données invalides.";
    if (!generique && e.statut >= 400 && e.statut < 500) return e.message;
  }
  return messageErreur(e);
}

/** Vrai pour les refus qui laissent penser que l'écran est périmé (rafraîchir les données). */
export const etatRedressementChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);
