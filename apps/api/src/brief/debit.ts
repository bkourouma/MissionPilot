import { AppError } from "../errors.js";

/*
 * Plafond de débit de GET /api/brief : chaque appel enchaîne ~27 sources (KPI, suivis, habilitations)
 * et la page d'accueil l'appelle à chaque affichage. Au plus REQUETES_BRIEF_PAR_FENETRE appels par
 * utilisateur sur FENETRE_BRIEF_MINUTES minutes (429 `TROP_DE_REQUETES_BRIEF` sinon).
 *
 * Compteur EN MÉMOIRE (fenêtre glissante), et non `journal_audit` comme les PDF ou le copilote : ces
 * routes journalisent un acte sensible ; le brief est une lecture que la page d'accueil répète, et
 * une ligne de journal à chaque affichage serait un coût d'écriture bien supérieur au calcul qu'on
 * protège. Limite assumée : le compteur est propre à chaque processus de l'API (n instances : au
 * plus n fois le plafond) et repart à zéro au redémarrage ; il borne l'emballement d'un client ou
 * d'un script, pas un abus distribué (le limiteur de connexion, lui, est en base).
 */

/** Appels admis par utilisateur sur la fenêtre glissante ; à valider. */
export const REQUETES_BRIEF_PAR_FENETRE = 60;
export const FENETRE_BRIEF_MINUTES = 10;
/** Utilisateurs suivis au plus (au-delà, on balaie les entrées échues) : borne la mémoire. */
const UTILISATEURS_SUIVIS_MAX = 10_000;

const appels = new Map<string, number[]>();

/**
 * Compte un appel et lève 429 si l'utilisateur a déjà atteint le plafond sur la fenêtre. Un appel
 * refusé ne compte pas (le client qui attend sort de la fenêtre). `maintenant` est injectable.
 */
export function verifierDebitBrief(utilisateurId: string, maintenant: number = Date.now()): void {
  const debut = maintenant - FENETRE_BRIEF_MINUTES * 60_000;
  const recents = (appels.get(utilisateurId) ?? []).filter((t) => t > debut);
  if (recents.length >= REQUETES_BRIEF_PAR_FENETRE) {
    appels.set(utilisateurId, recents);
    throw new AppError(
      429,
      "TROP_DE_REQUETES_BRIEF",
      `Au plus ${REQUETES_BRIEF_PAR_FENETRE} consultations du brief par ${FENETRE_BRIEF_MINUTES} minutes : réessayez dans quelques instants.`,
    );
  }
  recents.push(maintenant);
  appels.set(utilisateurId, recents);
  if (appels.size > UTILISATEURS_SUIVIS_MAX) {
    for (const [id, ts] of appels) {
      if (!ts.some((t) => t > debut)) appels.delete(id);
    }
  }
}

/** Remet les compteurs à zéro (tests). */
export function reinitialiserDebitBrief(): void {
  appels.clear();
}
