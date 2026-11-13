/** Import des temps : messages d'erreur affichés après un refus de l'API ou un échec réseau. */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import {
  CODE_TFA_A_CONFIGURER,
  ErreurApi,
  MESSAGE_TFA_A_CONFIGURER,
  MESSAGE_TFA_A_CONFIGURER_EN,
  messageErreur,
  messageInattendu,
} from "./api";
import { libelleLimite, type FormatImport } from "./import-temps-fichier";
import type { ErreurImportAffichee } from "./import-temps-etapes";

const MESSAGES_GENERIQUES = new Set(["Données invalides.", "Requête invalide."]);
const MESSAGES_GENERIQUES_EN = new Set(["Invalid data.", "Invalid request."]);
const NOTE_RESULTAT_INCERTAIN =
  "Relancez la simulation avant de réessayer : si l'import a abouti malgré tout, elle signalera les feuilles déjà importées.";
const NOTE_RESULTAT_INCERTAIN_EN =
  "Run the simulation again before retrying: if the import went through anyway, it will flag the timesheets already imported.";

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
  langue: Langue,
): ErreurImportAffichee | null {
  const t = creerTraduire(langue);
  if (e.code === "ORIGINE_REFUSEE") {
    return {
      titre,
      message: t(
        "Le serveur a refusé l'envoi : la page n'est pas ouverte à l'adresse habituelle de CabinetPilot. Rien n'a été importé : rouvrez CabinetPilot à son adresse habituelle puis relancez la simulation. Si le problème persiste, prévenez l'administrateur.",
        "The server refused the upload: the page is not open at CabinetPilot's usual address. Nothing was imported: reopen CabinetPilot at its usual address, then run the simulation again. If the problem persists, tell the administrator.",
      ),
    };
  }
  if (e.code === "IMPORT_CONCURRENT") {
    return {
      titre: t("Import refusé : rien n'a été importé", "Import refused: nothing was imported"),
      message: t(
        "Une feuille de temps a été saisie pendant l'import pour l'une de ces semaines. Relancez la simulation pour voir les feuilles concernées.",
        "A timesheet was entered during the import for one of these weeks. Run the simulation again to see the timesheets concerned.",
      ),
    };
  }
  if (e.code === "IMPORT_EXCEL_OCCUPE") {
    return {
      titre,
      message:
        phase === "simulation"
          ? t(
              "Le serveur traite déjà plusieurs classeurs Excel : réessayez dans un instant.",
              "The server is already processing several Excel workbooks: try again in a moment.",
            )
          : t(
              "Le serveur traite déjà plusieurs classeurs Excel et n'a rien importé : réessayez dans un instant, en relançant la simulation.",
              "The server is already processing several Excel workbooks and imported nothing: try again in a moment, by running the simulation again.",
            ),
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
  langue: Langue = "fr",
): ErreurImportAffichee {
  const t = creerTraduire(langue);
  const note = langue === "en" ? NOTE_RESULTAT_INCERTAIN_EN : NOTE_RESULTAT_INCERTAIN;
  const titre =
    phase === "simulation"
      ? t("Simulation impossible", "Simulation not possible")
      : t("Import non réalisé", "Import not performed");
  if (!(e instanceof ErreurApi)) {
    return phase === "simulation"
      ? { titre, message: messageInattendu(langue) }
      : {
          titre: t("Résultat de l'import inconnu", "Import result unknown"),
          message: `${messageInattendu(langue)} ${note}`,
        };
  }
  if (e.code === CODE_TFA_A_CONFIGURER)
    return {
      titre,
      message: langue === "en" ? MESSAGE_TFA_A_CONFIGURER_EN : MESSAGE_TFA_A_CONFIGURER,
    };
  const connue = erreurImportConnue(e, phase, titre, langue);
  if (connue) return connue;
  if (e.statut === 401) {
    return {
      titre,
      message: t(
        "Votre session a expiré. Reconnectez-vous puis relancez la simulation.",
        "Your session has expired. Sign in again, then run the simulation again.",
      ),
    };
  }
  if (e.statut === 403) {
    return {
      titre,
      message: t(
        "Votre rôle ne vous permet pas d'importer l'historique des temps.",
        "Your role does not allow you to import the time history.",
      ),
    };
  }
  if (e.statut === 413) {
    return {
      titre: t("Fichier trop volumineux", "File too large"),
      message: t(
        `Le serveur a refusé le fichier : ${libelleLimite(format, langue)}. Découpez l'historique en plusieurs fichiers.`,
        `The server refused the file: ${libelleLimite(format, langue)}. Split the history into several files.`,
      ),
      rappel: t(
        `Fichier trop volumineux : ${libelleLimite(format, langue)}.`,
        `File too large: ${libelleLimite(format, langue)}.`,
      ),
    };
  }
  if (e.statut === 415) {
    return {
      titre,
      message: t(
        "Le serveur n'a pas reconnu l'envoi du fichier. Choisissez de nouveau le fichier (.xlsx ou .csv) puis relancez la simulation.",
        "The server did not recognize the uploaded file. Choose the file again (.xlsx or .csv), then run the simulation again.",
      ),
    };
  }
  return erreurImportSuite(e, phase, format, titre, langue);
}

function erreurImportSuite(
  e: ErreurApi,
  phase: "simulation" | "execution",
  format: FormatImport,
  titre: string,
  langue: Langue,
): ErreurImportAffichee {
  const t = creerTraduire(langue);
  if (e.code === "IMPORT_INVALIDE") {
    return {
      titre: t("Import refusé : rien n'a été importé", "Import refused: nothing was imported"),
      message: t(
        `${e.message} Les données ont changé depuis la simulation (période clôturée, feuille déjà saisie…) : relancez la simulation pour voir le détail ligne par ligne.`,
        `${e.message} The data has changed since the simulation (closed period, timesheet already entered…): run the simulation again to see the line-by-line detail.`,
      ),
    };
  }
  if (e.code === "EXCEL_INVALIDE") {
    return {
      titre: t("Classeur Excel refusé", "Excel workbook refused"),
      message: e.message,
      rappel: t("Classeur refusé par le serveur.", "Workbook refused by the server."),
    };
  }
  if (e.statut === 400) {
    const message =
      MESSAGES_GENERIQUES.has(e.message) || MESSAGES_GENERIQUES_EN.has(e.message)
        ? t(
            `Le serveur n'a pas pu lire ${format === "xlsx" ? "le classeur" : "le CSV"} : vérifiez son en-tête et son format, puis réessayez.`,
            `The server could not read the ${format === "xlsx" ? "workbook" : "CSV"}: check its header and format, then try again.`,
          )
        : e.message;
    return { titre, message };
  }
  if (phase === "execution" && (e.statut === 0 || e.statut >= 500)) {
    return {
      titre: t("Résultat de l'import inconnu", "Import result unknown"),
      message: `${messageErreur(e, langue)} ${langue === "en" ? NOTE_RESULTAT_INCERTAIN_EN : NOTE_RESULTAT_INCERTAIN}`,
    };
  }
  return { titre, message: messageErreur(e, langue) };
}
