/** Import des temps : messages d'erreur affichés après un refus de l'API ou un échec réseau. */
import {
  CODE_TFA_A_CONFIGURER,
  ErreurApi,
  MESSAGE_INATTENDU,
  MESSAGE_TFA_A_CONFIGURER,
  messageErreur,
} from "./api";
import { LIMITES, type FormatImport } from "./import-temps-fichier";
import type { ErreurImportAffichee } from "./import-temps-etapes";

const MESSAGES_GENERIQUES = new Set(["Données invalides.", "Requête invalide."]);
const NOTE_RESULTAT_INCERTAIN =
  "Relancez la simulation avant de réessayer : si l'import a abouti malgré tout, elle signalera les feuilles déjà importées.";

/**
 * Refus certains de l'API, rien n'est importé : 403 `ORIGINE_REFUSEE` (garde CSRF : page
 * ouverte à une autre adresse que celle du web, extension…), 409 `IMPORT_CONCURRENT` (feuille
 * saisie pendant l'exécution), 503 `IMPORT_EXCEL_OCCUPE` (trop de classeurs lus en même temps).
 * Ni « votre rôle ne vous permet pas » (403) ni « résultat inconnu » (5xx) : `null` sinon.
 */
function erreurImportConnue(
  e: ErreurApi,
  phase: "simulation" | "execution",
  titre: string,
): ErreurImportAffichee | null {
  if (e.code === "ORIGINE_REFUSEE") {
    return {
      titre,
      message:
        "Le serveur a refusé l'envoi : la page n'est pas ouverte à l'adresse habituelle de CabinetPilot. Rien n'a été importé : rouvrez CabinetPilot à son adresse habituelle puis relancez la simulation. Si le problème persiste, prévenez l'administrateur.",
    };
  }
  if (e.code === "IMPORT_CONCURRENT") {
    return {
      titre: "Import refusé : rien n'a été importé",
      message:
        "Une feuille de temps a été saisie pendant l'import pour l'une de ces semaines. Relancez la simulation pour voir les feuilles concernées.",
    };
  }
  if (e.code === "IMPORT_EXCEL_OCCUPE") {
    return {
      titre,
      message:
        phase === "simulation"
          ? "Le serveur traite déjà plusieurs classeurs Excel : réessayez dans un instant."
          : "Le serveur traite déjà plusieurs classeurs Excel et n'a rien importé : réessayez dans un instant, en relançant la simulation.",
    };
  }
  return null;
}

/**
 * Message affiché après un refus de l'API ou un échec réseau, selon l'étape et le format.
 * Les messages métier de l'API (en français, ligne ou cellule citée) sont repris tels quels ;
 * les réponses génériques reçoivent une explication et la marche à suivre.
 */
export function erreurImport(
  e: unknown,
  phase: "simulation" | "execution",
  format: FormatImport,
): ErreurImportAffichee {
  const titre = phase === "simulation" ? "Simulation impossible" : "Import non réalisé";
  if (!(e instanceof ErreurApi)) {
    return phase === "simulation"
      ? { titre, message: MESSAGE_INATTENDU }
      : {
          titre: "Résultat de l'import inconnu",
          message: `${MESSAGE_INATTENDU} ${NOTE_RESULTAT_INCERTAIN}`,
        };
  }
  if (e.code === CODE_TFA_A_CONFIGURER) return { titre, message: MESSAGE_TFA_A_CONFIGURER };
  const connue = erreurImportConnue(e, phase, titre);
  if (connue) return connue;
  if (e.statut === 401) {
    return {
      titre,
      message: "Votre session a expiré. Reconnectez-vous puis relancez la simulation.",
    };
  }
  if (e.statut === 403) {
    return { titre, message: "Votre rôle ne vous permet pas d'importer l'historique des temps." };
  }
  if (e.statut === 413) {
    return {
      titre: "Fichier trop volumineux",
      message: `Le serveur a refusé le fichier : ${LIMITES[format].libelle}. Découpez l'historique en plusieurs fichiers.`,
      rappel: `Fichier trop volumineux : ${LIMITES[format].libelle}.`,
    };
  }
  if (e.statut === 415) {
    return {
      titre,
      message:
        "Le serveur n'a pas reconnu l'envoi du fichier. Choisissez de nouveau le fichier (.xlsx ou .csv) puis relancez la simulation.",
    };
  }
  return erreurImportSuite(e, phase, format, titre);
}

function erreurImportSuite(
  e: ErreurApi,
  phase: "simulation" | "execution",
  format: FormatImport,
  titre: string,
): ErreurImportAffichee {
  if (e.code === "IMPORT_INVALIDE") {
    return {
      titre: "Import refusé : rien n'a été importé",
      message: `${e.message} Les données ont changé depuis la simulation (période clôturée, feuille déjà saisie…) : relancez la simulation pour voir le détail ligne par ligne.`,
    };
  }
  if (e.code === "EXCEL_INVALIDE") {
    return {
      titre: "Classeur Excel refusé",
      message: e.message,
      rappel: "Classeur refusé par le serveur.",
    };
  }
  if (e.statut === 400) {
    const message = MESSAGES_GENERIQUES.has(e.message)
      ? `Le serveur n'a pas pu lire ${format === "xlsx" ? "le classeur" : "le CSV"} : vérifiez son en-tête et son format, puis réessayez.`
      : e.message;
    return { titre, message };
  }
  if (phase === "execution" && (e.statut === 0 || e.statut >= 500)) {
    return {
      titre: "Résultat de l'import inconnu",
      message: `${messageErreur(e)} ${NOTE_RESULTAT_INCERTAIN}`,
    };
  }
  return { titre, message: messageErreur(e) };
}
