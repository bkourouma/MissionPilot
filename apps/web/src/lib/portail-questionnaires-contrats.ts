/** Questionnaires du portail : contrats de l'API, chemins et date limite. */
import type { DefinitionQuestionnaireDonnees, ModeEnvoiQuestionnaire } from "@missionpilot/shared";
import { formaterDate } from "./format";
import { CHEMIN_PORTAIL } from "./portail-routes";

// --- Contrats de l'API ---------------------------------------------------------------------

/** Valeur d'une réponse : niveau ou nombre, code d'option, liste de codes, texte, oui/non, date. */
export type ValeurReponse = number | string | boolean | string[];

/** Réponses indexées par identifiant de question (valeurs normalisées par le moteur). */
export type Reponses = Record<string, ValeurReponse>;

export type StatutReponsePortail = "non_commence" | "brouillon" | "soumise";

export interface ProgressionPortail {
  /** Part des questions obligatoires visibles répondues, calculée par le moteur de l'API. */
  pourcentage: number;
  complet: boolean;
  obligatoires_visibles: number;
  obligatoires_repondues: number;
}

export interface ReponsePortail {
  statut: StatutReponsePortail;
  /** Présent sur la lecture d'un questionnaire, absent de la liste. */
  reponses?: Reponses;
  derniere_saisie: string | null;
  soumission: { le: string; par_moi: boolean } | null;
  progression: ProgressionPortail;
}

/** `GET /api/portail/questionnaires/:id` (et réponse des sauvegardes et de la soumission). */
export interface QuestionnairePortail {
  id: string;
  titre: string;
  mode: ModeEnvoiQuestionnaire;
  statut: "envoye" | "clos";
  date_limite: string | null;
  envoye_le: string;
  /** Libellé de fonction du répondant (obligatoire en mode « par fonction »). */
  fonction: string | null;
  /** Présente sur la lecture d'un questionnaire, absente de la liste. */
  definition?: DefinitionQuestionnaireDonnees;
  reponse: ReponsePortail;
}

/** Questionnaire lu avec sa définition (page de réponse). */
export type QuestionnaireComplet = QuestionnairePortail & {
  definition: DefinitionQuestionnaireDonnees;
};

export const aDefinition = (q: QuestionnairePortail): q is QuestionnaireComplet =>
  q.definition !== undefined && Array.isArray(q.definition.sections);

// --- Chemins -------------------------------------------------------------------------------

/** Rubrique des questionnaires de l'espace client. */
export const CHEMIN_QUESTIONNAIRES_PORTAIL = `${CHEMIN_PORTAIL}/questionnaires`;

export const API_QUESTIONNAIRES_PORTAIL = "/api/portail/questionnaires";

export const hrefQuestionnaire = (id: string) =>
  `${CHEMIN_QUESTIONNAIRES_PORTAIL}/${encodeURIComponent(id)}`;

export const cheminApiQuestionnaire = (id: string) =>
  `${API_QUESTIONNAIRES_PORTAIL}/${encodeURIComponent(id)}`;

/** Sauvegarde du brouillon (fusion des réponses citées ; `null` efface). */
export const cheminApiReponses = (id: string) => `${cheminApiQuestionnaire(id)}/reponses`;

export const cheminApiSoumission = (id: string) => `${cheminApiQuestionnaire(id)}/soumettre`;

/** Connexion dans un autre onglet, retour sur le questionnaire (session expirée en cours de saisie). */
export const hrefReconnexion = (id: string) =>
  `/connexion?suite=${encodeURIComponent(hrefQuestionnaire(id))}`;

// --- Dates ---------------------------------------------------------------------------------

/** Date du jour « AAAA-MM-JJ » dans le fuseau donné (UEMOA : Abidjan par défaut). */
export function dateDuJour(maintenant: Date, fuseau = "Africa/Abidjan"): string {
  // en-CA rend la date au format ISO (AAAA-MM-JJ).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(maintenant);
}

export interface Echeance {
  texte: string;
  /** Le jour de la date limite est passé (le jour même reste dans les temps). */
  depassee: boolean;
  dernierJour: boolean;
}

/**
 * Date limite affichée : « Date limite : le 12 janv. 2027 », ou `null` s'il n'y en a pas. Elle
 * est APPLIQUÉE par l'API (MPQ07) : passé le jour de la date limite (inclus), ni saisie ni
 * soumission, sauf prolongation par le cabinet.
 */
export function echeance(dateLimite: string | null, aujourdhui: string): Echeance | null {
  if (!dateLimite) return null;
  const date = formaterDate(dateLimite);
  if (aujourdhui > dateLimite) {
    return {
      texte: `Date limite dépassée (${date}) : les réponses ne sont plus acceptées, sauf prolongation par le cabinet`,
      depassee: true,
      dernierJour: false,
    };
  }
  if (aujourdhui === dateLimite) {
    return {
      texte: `Date limite : aujourd'hui (${date})`,
      depassee: false,
      dernierJour: true,
    };
  }
  return {
    texte: `Date limite : le ${date}`,
    depassee: false,
    dernierJour: false,
  };
}
