/** Modèle financier du plan : messages d'erreur et chemins d'API. */
import type { Langue } from "@missionpilot/shared";
import { traduireMessageMoteur } from "./plan-modele-comparaison";
import { ErreurApi, messageErreur } from "./api";
import { MESSAGE_PLAFOND, MESSAGE_PLAFOND_EN } from "./plan-modele-versions";

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

const CODES_MOTEUR_EN: Record<string, string> = {
  HORIZON_INVALIDE: "Horizon rejected by the calculation engine.",
  HYPOTHESE_INVALIDE: "Assumption rejected by the calculation engine.",
  MONTANT_INVALIDE: "Amount rejected by the calculation engine.",
  INVESTISSEMENT_INVALIDE: "Investment rejected by the calculation engine.",
  EMPRUNT_INVALIDE: "Loan rejected by the calculation engine.",
  BILAN_OUVERTURE_DESEQUILIBRE: "Opening balance sheet is unbalanced.",
  FLUX_INVALIDES: "Cash flows rejected by the calculation engine.",
};

export const MESSAGE_INTROUVABLE_MODELE_EN =
  "This plan or this model version is no longer accessible. Refresh the page.";

export const MESSAGE_INTROUVABLE_MODELE =
  "Ce plan ou cette version du modèle n'est plus accessible. Actualisez la page.";

/** Message français d'une erreur du modèle financier (400 du moteur, 403, 404, 409…). */
export function messageModele(e: unknown, langue: Langue = "fr"): string {
  const en = langue === "en";
  if (e instanceof ErreurApi) {
    const titre = (en ? CODES_MOTEUR_EN : CODES_MOTEUR)[e.code];
    if (titre) return `${titre} ${traduireMessageMoteur(e.message, langue)}`;
    if (e.code === "PLAN_PLAFOND_VERSIONS") return en ? MESSAGE_PLAFOND_EN : MESSAGE_PLAFOND;
    if (e.code === "VALIDATION_REQUISE") {
      return en ? `Segregation of duties: ${e.message}` : `Séparation des tâches : ${e.message}`;
    }
    if (e.code === "CONTENU_VALIDE") return e.message;
    if (e.statut === 404) return en ? MESSAGE_INTROUVABLE_MODELE_EN : MESSAGE_INTROUVABLE_MODELE;
    if (e.statut === 409) return e.message;
    if (e.statut === 403) {
      if (en) {
        return "Your role does not allow this action: only an engagement lead (director, engagement manager or partner) approves a version, and only plan authors simulate or save.";
      }
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
