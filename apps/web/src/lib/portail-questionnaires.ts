/**
 * Questionnaires du portail client (SOC-09, SOC-10) : contrats de `/api/portail/questionnaires`,
 * libellés, états affichés et traduction des refus de l'API. Logique pure, testée dans
 * `portail-questionnaires.test.ts` ; la saisie (affichage conditionnel, validation des champs,
 * brouillon) est dans `portail-questionnaires-saisie.ts`.
 *
 * Règles (DECISIONS.md, V2) : seuls le dirigeant et le contributeur client répondent ; en mode
 * collectif, l'entreprise a UNE réponse partagée, verrouillée à la première soumission ; en mode
 * par fonction, chaque répondant porte un libellé de fonction. L'API reste seule juge : la
 * progression vient de son moteur, jamais d'un calcul du navigateur.
 *
 * Aucune réponse n'est gardée dans le navigateur (ni stockage local, ni cache) : le brouillon
 * vit côté serveur.
 */
import type { Langue, QuestionQuestionnaire } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure, formaterNombre } from "./format";
import type { ValeurReponse } from "./portail-questionnaires-contrats";

export * from "./portail-questionnaires-contrats";
export * from "./portail-questionnaires-fins";
export * from "./portail-questionnaires-libelles";
export * from "./portail-questionnaires-refus";

// --- Lecture seule -------------------------------------------------------------------------

export const SANS_REPONSE = "Sans réponse";
export const SANS_REPONSE_EN = "No response";

/** Réponse lisible d'une question (lecture seule) : libellé d'option, « Oui », « 12 % »… */
const SANS_REPONSE_FR = SANS_REPONSE;

export function libelleReponse(
  q: QuestionQuestionnaire,
  v: ValeurReponse | null | undefined,
  langue: Langue = "fr",
): string {
  const en = langue === "en";
  const SANS_REPONSE = en ? SANS_REPONSE_EN : SANS_REPONSE_FR;
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
    return SANS_REPONSE;
  }
  switch (q.type) {
    case "likert": {
      if (typeof v !== "number") return SANS_REPONSE;
      const texte = q.libelles[v - 1];
      return en
        ? texte
          ? `${v} out of ${q.points}: ${texte}`
          : `${v} out of ${q.points}`
        : texte
          ? `${v} sur ${q.points} : ${texte}`
          : `${v} sur ${q.points}`;
    }
    case "choix_unique":
      return q.options.find((o) => o.code === v)?.libelle ?? String(v);
    case "choix_multiple": {
      const codes = Array.isArray(v) ? v : [String(v)];
      return codes.map((c) => q.options.find((o) => o.code === c)?.libelle ?? c).join(", ");
    }
    case "oui_non":
      return v === true ? (en ? "Yes" : "Oui") : v === false ? (en ? "No" : "Non") : SANS_REPONSE;
    case "numerique": {
      if (typeof v !== "number") return SANS_REPONSE;
      const nombre = formaterNombre(v, 4, langue);
      return q.unite ? `${nombre}\u00a0${q.unite}` : nombre;
    }
    case "date":
      return typeof v === "string" ? formaterDate(v, undefined, langue) : SANS_REPONSE;
    case "texte":
      return typeof v === "string" ? v : SANS_REPONSE;
  }
}

// --- Sauvegarde du brouillon ---------------------------------------------------------------

export type EtatSauvegarde =
  | "a_jour"
  | "modifie"
  | "enregistrement"
  | "hors_ligne"
  | "indisponible"
  | "session"
  | "refuse"
  | "bloque";

/** Texte d'état affiché près des boutons (non annoncé : seules les étapes clés le sont). */
export function texteSauvegarde(
  etat: EtatSauvegarde,
  derniereSauvegarde: string | null,
  fuseau = "Africa/Abidjan",
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    switch (etat) {
      case "a_jour":
        return derniereSauvegarde
          ? `Draft saved on ${formaterDateHeure(derniereSauvegarde, fuseau, langue)}.`
          : "No changes to save.";
      case "modifie":
        return "Changes waiting to be saved…";
      case "enregistrement":
        return "Saving the draft…";
      case "hors_ligne":
        return "Connection lost: automatic retry as soon as the network returns.";
      case "indisponible":
        return "Service temporarily unavailable: automatic retry.";
      case "session":
        return "Session expired: sign in again to save.";
      case "refuse":
        return "Some responses are not saved: correct the flagged questions.";
      case "bloque":
        return "Entry impossible: this questionnaire no longer accepts changes.";
    }
  }
  switch (etat) {
    case "a_jour":
      return derniereSauvegarde
        ? `Brouillon enregistré le ${formaterDateHeure(derniereSauvegarde, fuseau)}.`
        : "Aucune modification à enregistrer.";
    case "modifie":
      return "Modifications en attente d'enregistrement…";
    case "enregistrement":
      return "Enregistrement du brouillon…";
    case "hors_ligne":
      return "Connexion perdue : nouvel essai automatique dès le retour du réseau.";
    case "indisponible":
      return "Service momentanément indisponible : nouvel essai automatique.";
    case "session":
      return "Session expirée : reconnectez-vous pour enregistrer.";
    case "refuse":
      return "Certaines réponses ne sont pas enregistrées : corrigez les questions signalées.";
    case "bloque":
      return "Saisie impossible : ce questionnaire n'accepte plus de modification.";
  }
}

/** Annonce aux lecteurs d'écran après un enregistrement réussi. */
export const ANNONCE_BROUILLON = "Brouillon enregistré.";
export const ANNONCE_BROUILLON_EN = "Draft saved.";

/** Annonce des questions qui apparaissent ou disparaissent selon les réponses. */
export function annonceVisibilite(
  apparues: number,
  masquees: number,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    const partiesEn: string[] = [];
    if (apparues > 0) {
      partiesEn.push(
        apparues === 1 ? "A new question is displayed" : `${apparues} new questions are displayed`,
      );
    }
    if (masquees > 0) {
      partiesEn.push(
        masquees === 1
          ? "a question is no longer displayed"
          : `${masquees} questions are no longer displayed`,
      );
    }
    if (partiesEn.length === 0) return "";
    const phraseEn = partiesEn.join(" and ");
    return `${phraseEn.charAt(0).toUpperCase()}${phraseEn.slice(1)}.`;
  }
  const parties: string[] = [];
  if (apparues > 0) {
    parties.push(
      apparues === 1
        ? "Une nouvelle question est affichée"
        : `${apparues} nouvelles questions sont affichées`,
    );
  }
  if (masquees > 0) {
    parties.push(
      masquees === 1
        ? "une question n'est plus affichée"
        : `${masquees} questions ne sont plus affichées`,
    );
  }
  if (parties.length === 0) return "";
  const phrase = parties.join(" et ");
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}
