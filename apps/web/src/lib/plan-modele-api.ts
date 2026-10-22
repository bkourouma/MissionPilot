/** Modèle financier du plan : messages d'erreur et chemins d'API. */
import { traduireMessageMoteur } from "./plan-modele-comparaison";
import { ErreurApi, messageErreur } from "./api";
import { MESSAGE_PLAFOND } from "./plan-modele-versions";

// --- Messages d'erreur ------------------------------------------------------------------------

const CODES_MOTEUR: Record<string, string> = {
  HORIZON_INVALIDE: "Horizon refusé par le moteur de calcul.",
  HYPOTHESE_INVALIDE: "Hypothèse refusée par le moteur de calcul.",
  MONTANT_INVALIDE: "Montant refusé par le moteur de calcul.",
  INVESTISSEMENT_INVALIDE: "Investissement refusé par le moteur de calcul.",
  EMPRUNT_INVALIDE: "Emprunt refusé par le moteur de calcul.",
  BILAN_OUVERTURE_DESEQUILIBRE: "Bilan d'ouverture déséquilibré.",
  FLUX_INVALIDES: "Flux refusés par le moteur de calcul.",
};

export const MESSAGE_INTROUVABLE_MODELE =
  "Ce plan ou cette version du modèle n'est plus accessible. Actualisez la page.";

/** Message français d'une erreur du modèle financier (400 du moteur, 403, 404, 409…). */
export function messageModele(e: unknown): string {
  if (e instanceof ErreurApi) {
    const titre = CODES_MOTEUR[e.code];
    if (titre) return `${titre} ${traduireMessageMoteur(e.message)}`;
    if (e.code === "PLAN_PLAFOND_VERSIONS") return MESSAGE_PLAFOND;
    if (e.code === "VALIDATION_REQUISE") return `Séparation des tâches : ${e.message}`;
    if (e.code === "CONTENU_VALIDE") return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_MODELE;
    if (e.statut === 409) return e.message;
    if (e.statut === 403) {
      return "Votre rôle ne vous permet pas cette action : seul un responsable de la mission (directeur, chef de mission ou associé) valide une version, et seuls les rédacteurs du plan simulent ou enregistrent.";
    }
    if (e.code === "REQUETE_INVALIDE" && e.message !== "Données invalides.") return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'écran est probablement périmé : rafraîchir. */
export const etatModeleChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Chemins ----------------------------------------------------------------------------------

const seg = (id: string) => encodeURIComponent(id);

export const cheminSimulation = (planId: string) => `/api/plans/${seg(planId)}/modeles/simulation`;
export const cheminModeles = (planId: string) => `/api/plans/${seg(planId)}/modeles`;

export function cheminListeModeles(planId: string, limite: number, curseur: string | null) {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `${cheminModeles(planId)}?${q.toString()}`;
}

export const cheminVersionModele = (planId: string, version: number) =>
  `${cheminModeles(planId)}/${version}`;
export const cheminValidationModele = (planId: string, version: number) =>
  `${cheminVersionModele(planId, version)}/validation`;
export const cheminComparaison = (planId: string, de: number, a: number) =>
  `${cheminModeles(planId)}/comparaison?de=${de}&a=${a}`;
export const cheminRoi = (planId: string, version?: number | null) =>
  `/api/plans/${seg(planId)}/initiatives/roi${version ? `?version=${version}` : ""}`;
