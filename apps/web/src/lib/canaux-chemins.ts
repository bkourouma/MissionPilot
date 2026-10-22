/** Sous-module de `canaux.ts` : chemins de pages et d'API, formes de réponse tolérantes. */
import { PLAFONDS_CANAUX, type CanalMessagerie } from "@missionpilot/shared";
import type { PageCurseur } from "./pagination";
import { estObjet } from "./canaux-utilitaires";

// --- Chemins ---------------------------------------------------------------------------------

export const CHEMIN_PARAMETRES_CANAUX = "/parametres/canaux";
export const CHEMIN_CANAUX_DESTINATAIRES = `${CHEMIN_PARAMETRES_CANAUX}/destinataires`;
export const CHEMIN_CANAUX_JOURNAL = `${CHEMIN_PARAMETRES_CANAUX}/journal`;
export const CHEMIN_CANAUX_SAISIES = `${CHEMIN_PARAMETRES_CANAUX}/saisies`;
export const CHEMIN_CANAUX_SIMULATEUR = `${CHEMIN_PARAMETRES_CANAUX}/simulateur`;

export const API_CANAUX_COMPTES = "/api/canaux/comptes";
export const API_CANAUX_DESTINATAIRES = "/api/canaux/destinataires";
export const API_CANAUX_ENVOIS = "/api/canaux/envois";
export const API_CANAUX_APERCU_SYNTHESE = "/api/canaux/synthese-dirigeant/apercu";
export const API_CANAUX_SAISIES_KPI = "/api/canaux/saisies-kpi";
export const API_CANAUX_SIMULATEUR_BOITE = "/api/canaux/simulateur/boite";
export const API_CANAUX_SIMULATEUR_ENTRANT = "/api/canaux/simulateur/entrant";

const enc = encodeURIComponent;

/** `PUT /api/canaux/comptes/:canal`. */
export const cheminCompteCanal = (canal: CanalMessagerie) => `${API_CANAUX_COMPTES}/${enc(canal)}`;
/** `PUT /api/canaux/destinataires/:utilisateurId/:canal` (numéro dans le corps, jamais dans l'URL). */
export const cheminNumeroDestinataire = (utilisateurId: string, canal: CanalMessagerie) =>
  `${API_CANAUX_DESTINATAIRES}/${enc(utilisateurId)}/${enc(canal)}`;
/** `POST /api/canaux/destinataires/:id/verification`. */
export const cheminVerificationDestinataire = (id: string) =>
  `${API_CANAUX_DESTINATAIRES}/${enc(id)}/verification`;
/** `GET` et `POST /api/canaux/destinataires/:id/consentements`. */
export const cheminConsentementsDestinataire = (id: string) =>
  `${API_CANAUX_DESTINATAIRES}/${enc(id)}/consentements`;
/** `POST /api/canaux/saisies-kpi/:id/reprendre` ou `/rejeter`. */
export const cheminSaisieKpi = (id: string, action: "reprendre" | "rejeter") =>
  `${API_CANAUX_SAISIES_KPI}/${enc(id)}/${action === "reprendre" ? "reprendre" : "rejeter"}`;
/** Écran d'aperçu de la synthèse d'un client (cabinet). */
export const cheminSyntheseClient = (clientId: string) => `/clients/${enc(clientId)}/synthese`;

/** Plafond de `limite` des routes de ce lot (`PLAFONDS_CANAUX.listeLimiteMax`) : `limiteMax` des boucles. */
export const LIMITE_LISTE_CANAUX = PLAFONDS_CANAUX.listeLimiteMax;

// --- Formes de réponse tolérantes ------------------------------------------------------------

/**
 * Liste rendue par l'API : un tableau, ou une enveloppe `{ elements: [...] }`. Toute autre forme
 * donne une liste vide (jamais une exception dans une page).
 */
export function listeDepuis<T>(corps: unknown): T[] {
  if (Array.isArray(corps)) return corps as T[];
  if (estObjet(corps) && Array.isArray(corps.elements)) return corps.elements as T[];
  return [];
}

/**
 * Page paginée par curseur, vers la forme de `chargerToutesLesPages` (`suivant`). L'API de ce lot
 * rend `curseur_suivant` (`PageCanaux`) ; `suivant` est aussi accepté.
 */
export function pageDepuis<T>(corps: unknown): PageCurseur<T> {
  const suivant =
    estObjet(corps) && typeof corps.curseur_suivant === "string"
      ? corps.curseur_suivant
      : estObjet(corps) && typeof corps.suivant === "string"
        ? corps.suivant
        : null;
  return { elements: listeDepuis<T>(corps), suivant };
}
