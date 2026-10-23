import type { Trousseau } from "../auth/chiffrement.js";
import { creerLimiteur } from "../auth/limiteur.js";
import type { Database } from "../db/pool.js";
import { AppError } from "../errors.js";

/*
 * Plafond de débit de GET /api/brief : chaque appel enchaîne ~29 sources (KPI, suivis, habilitations)
 * et la page d'accueil l'appelle à chaque affichage. Au plus REQUETES_BRIEF_PAR_FENETRE appels par
 * utilisateur sur FENETRE_BRIEF_MINUTES minutes (429 `TROP_DE_REQUETES_BRIEF` sinon).
 *
 * Compteur PERSISTANT et partagé entre instances : limiteur de tentatives (auth/limiteur.ts), espace
 * `brief_requetes` dont les règles (60 appels, fenêtre glissante de 10 minutes, 100 000 clés) sont
 * fixées en base (migration 0550). La clé est l'identifiant de l'utilisateur, stocké en empreinte
 * HMAC. Un appel refusé ne compte pas. Les constantes ci-dessous reprennent les règles de la base
 * pour le message d'erreur ; un test les compare à `tentatives_auth_regles`.
 */

/** Appels admis par utilisateur sur la fenêtre glissante ; à valider. */
export const REQUETES_BRIEF_PAR_FENETRE = 60;
export const FENETRE_BRIEF_MINUTES = 10;

/**
 * Compte un appel et lève 429 si l'utilisateur a déjà atteint le plafond sur la fenêtre. À appeler
 * AVANT le calcul du brief.
 */
export async function verifierDebitBrief(
  base: Database,
  trousseau: Trousseau,
  utilisateurId: string,
): Promise<void> {
  const admis = await creerLimiteur(base, "brief_requetes", trousseau).reserver(utilisateurId);
  if (!admis) {
    throw new AppError(
      429,
      "TROP_DE_REQUETES_BRIEF",
      `Au plus ${REQUETES_BRIEF_PAR_FENETRE} consultations du brief par ${FENETRE_BRIEF_MINUTES} minutes : réessayez dans quelques instants.`,
    );
  }
}
