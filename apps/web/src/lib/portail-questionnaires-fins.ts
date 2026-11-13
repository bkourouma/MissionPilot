/** Questionnaires du portail : messages de fin de saisie (lecture seule, inaccessible). */
import type { Langue } from "@missionpilot/shared";
import { CHEMIN_SECURITE_PORTAIL } from "./portail-routes";
import {
  CHEMIN_QUESTIONNAIRES_PORTAIL,
  type QuestionnairePortail,
} from "./portail-questionnaires-contrats";
import { texteSoumission } from "./portail-questionnaires-libelles";
import { messageRefus, type IssueRefus } from "./portail-questionnaires-refus";

// --- Fin de la saisie ----------------------------------------------------------------------

/** Message qui remplace le formulaire : lecture seule (réponses affichées) ou inaccessible. */
export interface FinSaisie {
  type: "lecture" | "inaccessible";
  tonalite: "info" | "succes" | "attention" | "danger";
  titre: string;
  message: string;
  lien: { href: string; libelle: string } | null;
}

const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un);

function phrasePerdues(perdues: number, langue: Langue = "fr"): string {
  if (perdues <= 0) return "";
  if (langue === "en") {
    return ` Your latest changes (${perdues} ${pluriel(perdues, "question", "questions")}) could not be saved.`;
  }
  return ` Vos dernières modifications (${perdues} ${pluriel(perdues, "question", "questions")}) n'ont pas pu être enregistrées.`;
}

/**
 * Date limite dépassée (MPQ07) : plus de saisie ni d'envoi tant que le cabinet ne prolonge pas.
 * Les réponses enregistrées en brouillon restent affichées.
 */
export function finEcheance(
  q: Pick<QuestionnairePortail, "reponse">,
  perdues = 0,
  langue: Langue = "fr",
): FinSaisie {
  if (langue === "en") {
    return {
      type: "lecture",
      tonalite: "attention",
      titre: "Due date passed",
      message: `The due date of this questionnaire has passed: it no longer accepts responses. Contact your point of contact at the firm to request an extension.${
        q.reponse.statut === "brouillon"
          ? " The responses below had been saved as a draft, without being sent."
          : ""
      }${phrasePerdues(perdues, langue)}`,
      lien: null,
    };
  }
  return {
    type: "lecture",
    tonalite: "attention",
    titre: "Date limite dépassée",
    message: `La date limite de ce questionnaire est dépassée : il n'accepte plus de réponse. Contactez votre interlocuteur au cabinet pour demander une prolongation.${
      q.reponse.statut === "brouillon"
        ? " Les réponses ci-dessous avaient été enregistrées en brouillon, sans être envoyées."
        : ""
    }${phrasePerdues(perdues)}`,
    lien: null,
  };
}

/**
 * Questionnaire envoyé ou clos : ce qui est affiché au-dessus des réponses. Avec `aujourdhui`,
 * un questionnaire encore ouvert mais dont la date limite est passée affiche l'échéance.
 */
export function finLectureSeule(
  q: Pick<QuestionnairePortail, "mode" | "statut" | "reponse"> &
    Partial<Pick<QuestionnairePortail, "date_limite">>,
  perdues = 0,
  aujourdhui?: string,
  langue: Langue = "fr",
): FinSaisie {
  const soumission = texteSoumission(q, undefined, langue);
  if (soumission) {
    const collectif = q.mode === "collectif";
    if (langue === "en") {
      return {
        type: "lecture",
        tonalite: perdues > 0 ? "attention" : "succes",
        titre: collectif ? "Company response sent" : "Responses sent",
        message: `${soumission} ${collectif ? "It can no longer be edited." : "They can no longer be edited."}${phrasePerdues(perdues, langue)}`,
        lien: null,
      };
    }
    return {
      type: "lecture",
      tonalite: perdues > 0 ? "attention" : "succes",
      titre: collectif ? "Réponse de l'entreprise envoyée" : "Réponses envoyées",
      message: `${soumission} ${collectif ? "Elle n'est plus modifiable." : "Elles ne sont plus modifiables."}${phrasePerdues(perdues)}`,
      lien: null,
    };
  }
  if (
    q.statut === "envoye" &&
    aujourdhui !== undefined &&
    q.date_limite &&
    aujourdhui > q.date_limite
  ) {
    return finEcheance(q, perdues, langue);
  }
  if (langue === "en") {
    return {
      type: "lecture",
      tonalite: "attention",
      titre: "Questionnaire closed",
      message: `The firm has closed this questionnaire: it no longer accepts responses.${
        q.reponse.statut === "brouillon"
          ? " The responses below had been saved as a draft, without being sent."
          : ""
      }${phrasePerdues(perdues, langue)}`,
      lien: null,
    };
  }
  return {
    type: "lecture",
    tonalite: "attention",
    titre: "Questionnaire clos",
    message: `Le cabinet a clos ce questionnaire : il n'accepte plus de réponse.${
      q.reponse.statut === "brouillon"
        ? " Les réponses ci-dessous avaient été enregistrées en brouillon, sans être envoyées."
        : ""
    }${phrasePerdues(perdues)}`,
    lien: null,
  };
}

/** Après un envoi réussi depuis cette page. */
export function finApresEnvoi(
  q: Pick<QuestionnairePortail, "mode" | "statut" | "reponse">,
  langue: Langue = "fr",
) {
  const fin = finLectureSeule(q, 0, undefined, langue);
  if (langue === "en") {
    return {
      ...fin,
      titre: "Thank you, your responses have been sent",
      message: `${fin.message} The firm has been notified.`,
    } satisfies FinSaisie;
  }
  return {
    ...fin,
    titre: "Merci, vos réponses sont envoyées",
    message: `${fin.message} Le cabinet en est informé.`,
  } satisfies FinSaisie;
}

const TITRES_INACCESSIBLE_EN: Partial<Record<IssueRefus, string>> = {
  securite: "Two-factor authentication to enable",
  verrouille: "Questionnaire locked",
  clos: "Questionnaire closed",
  echeance: "Due date passed",
};

const TITRES_INACCESSIBLE: Partial<Record<IssueRefus, string>> = {
  securite: "Double authentification à activer",
  verrouille: "Questionnaire verrouillé",
  clos: "Questionnaire clos",
  echeance: "Date limite dépassée",
};

/**
 * Questionnaire devenu inaccessible (retiré, droits, double authentification), ou verrouillé /
 * clos sans que sa dernière version ait pu être relue : message seul, sans les réponses.
 */
export function finInaccessible(
  issue: IssueRefus,
  mode: string,
  perdues = 0,
  langue: Langue = "fr",
): FinSaisie {
  if (langue === "en") {
    return {
      type: "inaccessible",
      tonalite: "danger",
      titre: TITRES_INACCESSIBLE_EN[issue] ?? "Questionnaire inaccessible",
      message: `${messageRefus(issue, mode, "brouillon", undefined, langue)}${phrasePerdues(perdues, langue)}`,
      lien:
        issue === "securite"
          ? { href: CHEMIN_SECURITE_PORTAIL, libelle: 'Go to "Security"' }
          : { href: CHEMIN_QUESTIONNAIRES_PORTAIL, libelle: "Back to your questionnaires" },
    };
  }
  return {
    type: "inaccessible",
    tonalite: "danger",
    titre: TITRES_INACCESSIBLE[issue] ?? "Questionnaire inaccessible",
    message: `${messageRefus(issue, mode, "brouillon")}${phrasePerdues(perdues)}`,
    lien:
      issue === "securite"
        ? { href: CHEMIN_SECURITE_PORTAIL, libelle: "Aller à « Sécurité »" }
        : { href: CHEMIN_QUESTIONNAIRES_PORTAIL, libelle: "Retour à vos questionnaires" },
  };
}

/** Échec de la relecture des réponses des collègues (mode collectif). */
export function messageActualisation(
  issue: IssueRefus,
  e?: unknown,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    if (issue === "session")
      return messageRefus("session", "collectif", "brouillon", undefined, langue);
    if (issue === "reseau" || issue === "indisponible") {
      return "Your colleagues' latest responses could not be loaded: check your network, then try again.";
    }
    return `Your colleagues' latest responses could not be loaded. ${messageRefus("autre", "collectif", "brouillon", e, langue)}`;
  }
  if (issue === "session") return messageRefus("session", "collectif", "brouillon");
  if (issue === "reseau" || issue === "indisponible") {
    return "Les dernières réponses de vos collègues n'ont pas pu être chargées : vérifiez votre réseau puis réessayez.";
  }
  return `Les dernières réponses de vos collègues n'ont pas pu être chargées. ${messageRefus("autre", "collectif", "brouillon", e)}`;
}

/** Annonce après l'intégration des réponses de collègues (mode collectif). */
export function annonceCollegues(
  misesAJour: number,
  conflits: number,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    const partiesEn: string[] = [];
    if (misesAJour > 0) {
      partiesEn.push(
        `${misesAJour} ${pluriel(misesAJour, "response", "responses")} updated by your colleagues.`,
      );
    }
    if (conflits > 0) {
      partiesEn.push(
        conflits === 1
          ? "A colleague edited a question you were filling in: choose the response to keep."
          : `Colleagues edited ${conflits} questions you were filling in: choose the responses to keep.`,
      );
    }
    return partiesEn.join(" ");
  }
  const parties: string[] = [];
  if (misesAJour > 0) {
    parties.push(
      `${misesAJour} ${pluriel(misesAJour, "réponse mise à jour", "réponses mises à jour")} par vos collègues.`,
    );
  }
  if (conflits > 0) {
    parties.push(
      conflits === 1
        ? "Un collègue a modifié une question que vous étiez en train de remplir : choisissez la réponse à garder."
        : `Des collègues ont modifié ${conflits} questions que vous étiez en train de remplir : choisissez les réponses à garder.`,
    );
  }
  return parties.join(" ");
}
