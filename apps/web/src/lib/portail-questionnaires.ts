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
import type {
  DefinitionQuestionnaireDonnees,
  ModeEnvoiQuestionnaire,
  QuestionQuestionnaire,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { CODE_TFA_A_CONFIGURER, ErreurApi, MESSAGE_INATTENDU } from "./api";
import { formaterDate, formaterDateHeure, formaterNombre } from "./format";
import { CHEMIN_PORTAIL, CHEMIN_SECURITE_PORTAIL } from "./portail-routes";

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

// --- Libellés ------------------------------------------------------------------------------

export interface Libelle {
  libelle: string;
  tonalite: TonaliteStatut;
}

const MODES: Record<ModeEnvoiQuestionnaire, string> = {
  individuel: "Réponse individuelle",
  collectif: "Réponse partagée par l'entreprise",
  par_fonction: "Réponse par fonction",
};

/** Mode de réponse, en termes simples pour le client. */
export function libelleMode(mode: string, fonction: string | null = null): string {
  if (mode === "par_fonction" && fonction) return `Réponse en tant que ${fonction}`;
  return MODES[mode as ModeEnvoiQuestionnaire] ?? "Réponse individuelle";
}

/**
 * Le questionnaire accepte-t-il encore une saisie ? (l'API reste seule juge) Avec `aujourdhui`
 * (AAAA-MM-JJ), une date limite passée ferme aussi la saisie.
 */
export function estModifiable(
  q: Pick<QuestionnairePortail, "statut" | "reponse"> &
    Partial<Pick<QuestionnairePortail, "date_limite">>,
  aujourdhui?: string,
): boolean {
  if (q.statut !== "envoye" || q.reponse.statut === "soumise") return false;
  return !(aujourdhui !== undefined && q.date_limite && aujourdhui > q.date_limite);
}

/** Statut affiché d'un questionnaire reçu (liste et en-tête de la page de réponse). */
export function etatQuestionnaire(
  q: Pick<QuestionnairePortail, "statut" | "mode" | "date_limite" | "reponse">,
  aujourdhui: string,
): Libelle {
  if (q.reponse.statut === "soumise") {
    const partage = q.mode === "collectif" && q.reponse.soumission?.par_moi === false;
    return { libelle: partage ? "Envoyé par votre entreprise" : "Envoyé", tonalite: "succes" };
  }
  if (q.statut === "clos") return { libelle: "Clos, plus de réponse possible", tonalite: "neutre" };
  const depassee = echeance(q.date_limite, aujourdhui)?.depassee === true;
  if (q.reponse.statut === "brouillon") {
    return depassee
      ? { libelle: "En cours, date limite dépassée", tonalite: "danger" }
      : { libelle: "En cours", tonalite: "attention" };
  }
  return depassee
    ? { libelle: "À commencer, date limite dépassée", tonalite: "danger" }
    : { libelle: "À commencer", tonalite: "neutre" };
}

/** « 4 questions obligatoires sur 10 renseignées », d'après la progression calculée par l'API. */
export function texteProgression(p: ProgressionPortail): string {
  if (p.obligatoires_visibles === 0) return "Aucune question obligatoire à renseigner";
  const n = p.obligatoires_visibles;
  return `${p.obligatoires_repondues} question${p.obligatoires_repondues > 1 ? "s" : ""} obligatoire${
    p.obligatoires_repondues > 1 ? "s" : ""
  } sur ${n} renseignée${p.obligatoires_repondues > 1 ? "s" : ""}`;
}

/** Pourcentage borné 0..100 pour la barre de progression (valeur de l'API, jamais recalculée). */
export function pourcentageAffiche(p: Pick<ProgressionPortail, "pourcentage">): number {
  const v = Number.isFinite(p.pourcentage) ? Math.trunc(p.pourcentage) : 0;
  return Math.min(100, Math.max(0, v));
}

/** Phrase de soumission : « Vos réponses ont été envoyées le 12 janv. 2027 à 14:05. » */
export function texteSoumission(
  q: Pick<QuestionnairePortail, "mode" | "reponse">,
  fuseau = "Africa/Abidjan",
): string | null {
  const s = q.reponse.soumission;
  if (q.reponse.statut !== "soumise" || !s) return null;
  const quand = formaterDateHeure(s.le, fuseau);
  if (q.mode === "collectif") {
    return s.par_moi
      ? `Vous avez envoyé la réponse de votre entreprise le ${quand}.`
      : `Un collègue a envoyé la réponse de votre entreprise le ${quand}.`;
  }
  return `Vos réponses ont été envoyées le ${quand}.`;
}

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

function phrasePerdues(perdues: number): string {
  if (perdues <= 0) return "";
  return ` Vos dernières modifications (${perdues} ${pluriel(perdues, "question", "questions")}) n'ont pas pu être enregistrées.`;
}

/**
 * Date limite dépassée (MPQ07) : plus de saisie ni d'envoi tant que le cabinet ne prolonge pas.
 * Les réponses enregistrées en brouillon restent affichées.
 */
export function finEcheance(q: Pick<QuestionnairePortail, "reponse">, perdues = 0): FinSaisie {
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
): FinSaisie {
  const soumission = texteSoumission(q);
  if (soumission) {
    const collectif = q.mode === "collectif";
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
    return finEcheance(q, perdues);
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
export function finApresEnvoi(q: Pick<QuestionnairePortail, "mode" | "statut" | "reponse">) {
  const fin = finLectureSeule(q);
  return {
    ...fin,
    titre: "Merci, vos réponses sont envoyées",
    message: `${fin.message} Le cabinet en est informé.`,
  } satisfies FinSaisie;
}

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
export function finInaccessible(issue: IssueRefus, mode: string, perdues = 0): FinSaisie {
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
export function messageActualisation(issue: IssueRefus, e?: unknown): string {
  if (issue === "session") return messageRefus("session", "collectif", "brouillon");
  if (issue === "reseau" || issue === "indisponible") {
    return "Les dernières réponses de vos collègues n'ont pas pu être chargées : vérifiez votre réseau puis réessayez.";
  }
  return `Les dernières réponses de vos collègues n'ont pas pu être chargées. ${messageRefus("autre", "collectif", "brouillon", e)}`;
}

/** Annonce après l'intégration des réponses de collègues (mode collectif). */
export function annonceCollegues(misesAJour: number, conflits: number): string {
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

// --- Lecture seule -------------------------------------------------------------------------

export const SANS_REPONSE = "Sans réponse";

/** Réponse lisible d'une question (lecture seule) : libellé d'option, « Oui », « 12 % »… */
export function libelleReponse(
  q: QuestionQuestionnaire,
  v: ValeurReponse | null | undefined,
): string {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
    return SANS_REPONSE;
  }
  switch (q.type) {
    case "likert": {
      if (typeof v !== "number") return SANS_REPONSE;
      const texte = q.libelles[v - 1];
      return texte ? `${v} sur ${q.points} : ${texte}` : `${v} sur ${q.points}`;
    }
    case "choix_unique":
      return q.options.find((o) => o.code === v)?.libelle ?? String(v);
    case "choix_multiple": {
      const codes = Array.isArray(v) ? v : [String(v)];
      return codes.map((c) => q.options.find((o) => o.code === c)?.libelle ?? c).join(", ");
    }
    case "oui_non":
      return v === true ? "Oui" : v === false ? "Non" : SANS_REPONSE;
    case "numerique": {
      if (typeof v !== "number") return SANS_REPONSE;
      const nombre = formaterNombre(v, 4);
      return q.unite ? `${nombre}\u00a0${q.unite}` : nombre;
    }
    case "date":
      return typeof v === "string" ? formaterDate(v) : SANS_REPONSE;
    case "texte":
      return typeof v === "string" ? v : SANS_REPONSE;
  }
}

// --- Refus de l'API ------------------------------------------------------------------------

/** Conduite à tenir face à un refus de l'API pendant la saisie ou l'envoi. */
export type IssueRefus =
  | "reseau"
  | "indisponible"
  | "session"
  | "securite"
  | "interdit"
  | "introuvable"
  | "verrouille"
  | "clos"
  | "echeance"
  | "invalide"
  | "autre";

export function issueRefus(e: unknown): IssueRefus {
  if (!(e instanceof ErreurApi)) return "autre";
  if (e.statut === 0) return "reseau";
  if (e.statut >= 500 || e.statut === 429) return "indisponible";
  if (e.statut === 401) return "session";
  if (e.statut === 403) return e.code === CODE_TFA_A_CONFIGURER ? "securite" : "interdit";
  if (e.statut === 404) return "introuvable";
  if (e.statut === 409) {
    if (e.code === "QUESTIONNAIRE_DEJA_SOUMIS" || e.code === "REPONSE_VERROUILLEE") {
      return "verrouille";
    }
    if (e.code === "DATE_LIMITE_DEPASSEE") return "echeance";
    return "clos";
  }
  if (e.statut === 400) return "invalide";
  return "autre";
}

/** Une coupure, un délai ou une indisponibilité se retente ; un refus de l'API, non. */
export const estReessayable = (issue: IssueRefus) => issue === "reseau" || issue === "indisponible";

/** Délai avant une nouvelle tentative d'enregistrement : 2 s, 4 s, 8 s… plafonné à 30 s. */
export function delaiNouvelleTentative(tentatives: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, Math.min(tentatives, 10)));
}

/** L'issue fige-t-elle le questionnaire (lecture seule) ? */
export const issueBloquante = (issue: IssueRefus) =>
  issue === "verrouille" ||
  issue === "clos" ||
  issue === "echeance" ||
  issue === "introuvable" ||
  issue === "interdit";

/** Message affiché pour un refus, selon le moment (sauvegarde du brouillon ou envoi). */
export function messageRefus(
  issue: IssueRefus,
  mode: string,
  moment: "brouillon" | "envoi",
  e?: unknown,
): string {
  const collectif = mode === "collectif";
  switch (issue) {
    case "reseau":
      return moment === "brouillon"
        ? "Connexion perdue : vos réponses restent affichées dans cette page et seront enregistrées dès le retour du réseau. Ne fermez pas la page."
        : "La connexion a été interrompue : l'envoi n'a peut-être pas abouti. Vérifiez votre réseau puis réessayez.";
    case "indisponible":
      return moment === "brouillon"
        ? "Le service est momentanément indisponible : nouvelle tentative d'enregistrement dans quelques instants. Ne fermez pas la page."
        : "Le service est momentanément indisponible. Réessayez dans quelques instants.";
    case "session":
      return "Votre session a expiré : vos dernières réponses ne sont pas enregistrées. Reconnectez-vous dans un nouvel onglet, puis revenez sur cette page : vos réponses y sont toujours, choisissez « Enregistrer le brouillon ».";
    case "securite":
      return "Votre cabinet demande d'activer la double authentification : rendez-vous dans « Sécurité » pour continuer.";
    case "interdit":
      return "Votre accès ne permet pas de répondre à ce questionnaire. Pour toute question, contactez votre interlocuteur au cabinet.";
    case "introuvable":
      return "Ce questionnaire n'est plus accessible : il a pu être retiré par le cabinet.";
    case "verrouille":
      return collectif
        ? "La réponse de votre entreprise a déjà été envoyée : elle est verrouillée et ne peut plus être modifiée."
        : "Vos réponses ont déjà été envoyées : elles sont verrouillées et ne peuvent plus être modifiées.";
    case "clos":
      return "Le cabinet a clos ce questionnaire : il n'accepte plus de réponse.";
    case "echeance":
      return "La date limite de ce questionnaire est dépassée : il n'accepte plus de réponse. Contactez votre interlocuteur au cabinet pour demander une prolongation.";
    case "invalide":
      return moment === "brouillon"
        ? "Certaines réponses ont été refusées : corrigez les questions signalées pour les enregistrer."
        : "Le questionnaire ne peut pas être envoyé en l'état : vérifiez les questions signalées.";
    case "autre":
      return e instanceof ErreurApi && e.message ? e.message : MESSAGE_INATTENDU;
  }
}

/** Détails de validation renvoyés par l'API (`ZodError.flatten()`, chemins = questions). */
interface DetailsValidation {
  fieldErrors?: Record<string, unknown>;
}

const MESSAGES_CODES: Record<string, string> = {
  OBLIGATOIRE: "Cette question est obligatoire.",
  TYPE_INVALIDE: "Réponse d'un format inattendu : saisissez-la de nouveau.",
  HORS_ECHELLE: "Choisissez un niveau de l'échelle proposée.",
  OPTION_INCONNUE: "Ce choix n'est plus proposé : choisissez parmi les options affichées.",
  SELECTION_INSUFFISANTE: "Cochez davantage de choix.",
  SELECTION_EXCESSIVE: "Cochez moins de choix.",
  HORS_BORNES: "Valeur hors des limites indiquées.",
  NON_ENTIER: "Saisissez un nombre entier.",
  TROP_LONG: "Réponse trop longue : raccourcissez-la.",
  DATE_INVALIDE: "Saisissez une date valide.",
};

export const MESSAGE_REFUS_SERVEUR = "Réponse refusée par le serveur : vérifiez-la.";

/**
 * Erreurs par question renvoyées par l'API (400 REQUETE_INVALIDE, `details.fieldErrors`
 * indexés par identifiant de question, messages « CODE : texte »). Seuls les identifiants de
 * la définition sont retenus ; le texte affiché est celui de ce module, en français.
 */
export function erreursQuestionsServeur(
  e: unknown,
  idsConnus: ReadonlySet<string>,
): Record<string, string> {
  if (!(e instanceof ErreurApi) || e.code !== "REQUETE_INVALIDE") return {};
  const details = e.details as DetailsValidation | undefined;
  const champs = details && typeof details === "object" ? details.fieldErrors : undefined;
  if (!champs || typeof champs !== "object") return {};
  const erreurs: Record<string, string> = {};
  for (const [id, messages] of Object.entries(champs)) {
    if (!idsConnus.has(id)) continue;
    const premier = Array.isArray(messages) ? messages[0] : undefined;
    const code = typeof premier === "string" ? (premier.split(" : ", 1)[0] ?? "") : "";
    erreurs[id] = MESSAGES_CODES[code] ?? MESSAGE_REFUS_SERVEUR;
  }
  return erreurs;
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
): string {
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

/** Annonce des questions qui apparaissent ou disparaissent selon les réponses. */
export function annonceVisibilite(apparues: number, masquees: number): string {
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
