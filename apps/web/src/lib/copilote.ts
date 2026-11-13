import {
  aPermission,
  creerTraduire,
  MESSAGE_COPILOTE_LONGUEUR_MAX,
  type ActionProposeeCopilote,
  type IdentifiantOutilCopilote,
  type Langue,
  type Permission,
  type ReponseCopilote,
  type ResultatActionCopilote,
  type Role,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";

/*
 * Copilote conversationnel (AGT-08) : logique pure de l'écran (testée dans copilote.test.ts).
 * Le fil de conversation vit dans l'état du navigateur : rien n'est conservé côté serveur. Le texte
 * des réponses vient du serveur (gabarits du code) ; l'écran ne l'interprète jamais (texte brut, pas
 * de HTML) et ne suit que les liens internes.
 */

export const CHEMIN_MESSAGES = "/api/copilote/messages";
export const cheminConfirmation = (actionId: string) =>
  `/api/copilote/actions/${encodeURIComponent(actionId)}/confirmer`;
export const cheminAnnulation = (actionId: string) =>
  `/api/copilote/actions/${encodeURIComponent(actionId)}/annuler`;

export const LONGUEUR_MESSAGE_MAX = MESSAGE_COPILOTE_LONGUEUR_MAX;
/** Entrées conservées dans le fil du navigateur (les plus anciennes sont retirées). */
export const FIL_MAX = 60;
/** Rafraîchissement du compte à rebours d'une proposition. */
export const INTERVALLE_EXPIRATION_MS = 15_000;

export const MENTION_CONFIDENTIALITE =
  "Les réponses viennent de vos données, dans vos droits. Quand l'IA est activée par votre cabinet, " +
  "votre question lui est envoyée après masquage des e-mails, des numéros et des noms de clients, " +
  "de collaborateurs et de missions déjà enregistrés dans votre cabinet. Un nom qui n'est pas " +
  "enregistré, un fragment de nom ou un texte libre ne sont pas masqués : n'y saisissez pas " +
  "d'informations confidentielles. Cette conversation reste dans votre onglet, n'est pas " +
  "envoyée au serveur et s'efface au bout de 30 minutes d'inactivité.";

export const MENTION_CONFIDENTIALITE_EN =
  "Answers come from your data, within your permissions. When AI is enabled by your firm, " +
  "your question is sent to it after masking e-mails, numbers and the names of clients, " +
  "staff and engagements already recorded in your firm. A name that is not " +
  "recorded, a name fragment or free text is not masked: do not enter " +
  "confidential information there. This conversation stays in your tab, is not " +
  "sent to the server and is cleared after 30 minutes of inactivity.";

/** Libellés des outils (identiques à ceux du serveur). */
export const LIBELLES_OUTILS: Readonly<Record<IdentifiantOutilCopilote, string>> = {
  mes_taches: "Mes tâches",
  mes_feuilles_temps: "Mes feuilles de temps",
  resume_mission: "Résumé d'une mission",
  kpi_rouges: "KPI au rouge",
  factures_echues: "Factures échues",
  recherche: "Recherche",
  missions_en_retard: "Mes missions en retard",
  retard_feuilles_temps: "Retards sur les feuilles de temps",
  creer_tache: "Créer une tâche",
  ajouter_commentaire: "Ajouter un commentaire",
  planifier_relance: "Relancer une facture échue",
};

export const LIBELLES_OUTILS_EN: Readonly<Record<IdentifiantOutilCopilote, string>> = {
  mes_taches: "My tasks",
  mes_feuilles_temps: "My timesheets",
  resume_mission: "Engagement summary",
  kpi_rouges: "Red KPIs",
  factures_echues: "Overdue invoices",
  recherche: "Search",
  missions_en_retard: "My overdue engagements",
  retard_feuilles_temps: "Late timesheets",
  creer_tache: "Create a task",
  ajouter_commentaire: "Add a comment",
  planifier_relance: "Remind an overdue invoice",
};

/** Libellé d'un outil ; null pour une réponse sans outil. */
export const libelleOutil = (
  outil: IdentifiantOutilCopilote | null,
  langue: Langue = "fr",
): string | null =>
  outil ? (langue === "en" ? LIBELLES_OUTILS_EN : LIBELLES_OUTILS)[outil] : null;

/* ----- Suggestions ----- */

export interface SuggestionCopilote {
  texte: string;
  /** Droit qui rend la question utile ; null : tout utilisateur du copilote. */
  permission: Permission | readonly Permission[] | null;
}

export const SUGGESTIONS: readonly SuggestionCopilote[] = [
  { texte: "Quelles sont mes tâches en retard ?", permission: null },
  { texte: "Quelles feuilles de temps dois-je soumettre ?", permission: "temps.saisir" },
  { texte: "Quels KPI sont au rouge sur mes missions ?", permission: "kpi.lire" },
  { texte: "Quelles sont mes missions en retard ?", permission: "mission.lire" },
  { texte: "Où en est la mission…", permission: "mission.lire" },
  // Comme l'outil du serveur : `facture.lire` ET (`encaissement.gerer` OU `indicateurs.cabinet`).
  {
    texte: "Quelles factures sont échues ?",
    permission: ["encaissement.gerer", "indicateurs.cabinet"],
  },
  { texte: "Cherche ", permission: "connaissance.lire" },
  // Aucune action (créer une tâche, commenter, relancer) n'est proposée en dur : les exemples
  // d'actions dépendent du niveau d'autonomie du cabinet et viennent de l'aide du serveur, qui
  // n'en cite aucun quand les actions sont désactivées.
];

const SUGGESTIONS_EN: readonly string[] = [
  "Which of my tasks are overdue?",
  "Which timesheets do I need to submit?",
  "Which KPIs are red on my engagements?",
  "Which of my engagements are late?",
  "Where does the engagement stand…",
  "Which invoices are overdue?",
  "Search ",
];

/** Suggestions utiles à ces rôles (le serveur reste la source de vérité des droits). */
export function suggestionsPour(roles: readonly Role[], langue: Langue = "fr"): string[] {
  return SUGGESTIONS.flatMap((s, i) => {
    if (s.permission !== null) {
      const liste = typeof s.permission === "string" ? [s.permission] : s.permission;
      if (!liste.some((p) => aPermission(roles, p))) return [];
    }
    return [langue === "en" ? (SUGGESTIONS_EN[i] ?? s.texte) : s.texte];
  });
}

/** Une suggestion à compléter (finit par « … », « : » ou une espace) remplit le champ au lieu de partir. */
export const estSuggestionComplete = (texte: string): boolean => !/[…:\s]$/.test(texte);

/* ----- Saisie ----- */

/**
 * Contenu du champ après la réponse du serveur : vidé (même pour un refus ou « non compris ») si
 * la requête a abouti et que le champ porte encore le texte envoyé ; conservé si la requête a
 * échoué (pour renvoyer) ; jamais écrasé si l'utilisateur a déjà tapé autre chose entre-temps.
 */
export function saisieApresEnvoi(courante: string, envoye: string, abouti: boolean): string {
  if (abouti) return courante.trim() === envoye ? "" : courante;
  return courante === "" ? envoye : courante;
}

export type SaisieValidee = { ok: true; texte: string } | { ok: false; erreur: string };

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function validerSaisie(brut: string, langue: Langue = "fr"): SaisieValidee {
  const t = creerTraduire(langue);
  const texte = brut.trim();
  if (texte === "") return { ok: false, erreur: t("Saisissez une question.", "Enter a question.") };
  if (texte.length > LONGUEUR_MESSAGE_MAX) {
    return {
      ok: false,
      erreur: t(
        `Votre message dépasse ${LONGUEUR_MESSAGE_MAX} caractères (${texte.length}).`,
        `Your message exceeds ${LONGUEUR_MESSAGE_MAX} characters (${texte.length}).`,
      ),
    };
  }
  if (CONTROLES.test(texte)) {
    return {
      ok: false,
      erreur: t(
        "Le message contient un caractère refusé.",
        "The message contains a forbidden character.",
      ),
    };
  }
  return { ok: true, texte };
}

export const libelleCompteur = (longueur: number, langue: Langue = "fr"): string =>
  creerTraduire(langue)(
    `${longueur} / ${LONGUEUR_MESSAGE_MAX} caractères`,
    `${longueur} / ${LONGUEUR_MESSAGE_MAX} characters`,
  );

export function corpsMessage(texte: string, missionId: string | null) {
  return missionId ? { message: texte, contexte: { mission_id: missionId } } : { message: texte };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mission affichée à l'écran, passée par `?mission=` : identifiant valide seulement. */
export function lireMissionContexte(
  params: Record<string, string | string[] | undefined>,
): string | null {
  const v = params.mission;
  return typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;
}

/* ----- Liens ----- */

/** Lien interne seulement (« /… ») : jamais un lien externe, protocole ou chemin protocole-relatif. */
export function lienSur(href: string): string {
  return /^\/(?![/\\])/.test(href) && !CONTROLES.test(href) ? href : "/";
}

/* ----- Mode ----- */

export function libelleMode(
  r: Pick<ReponseCopilote, "mode" | "repli">,
  langue: Langue = "fr",
): string | null {
  const t = creerTraduire(langue);
  if (r.mode === "ia")
    return t("Demande routée par l'IA du cabinet", "Request routed by the firm's AI");
  if (r.repli === "ia_desactivee") {
    return t(
      "Mode sans IA : l'IA n'est pas activée pour votre cabinet.",
      "No-AI mode: AI is not enabled for your firm.",
    );
  }
  if (r.repli === "non_autorisee") {
    return t(
      "Mode sans IA : l'IA n'est pas ouverte à votre rôle.",
      "No-AI mode: AI is not open to your role.",
    );
  }
  if (r.repli === "indisponible") {
    return t(
      "Mode sans IA : l'IA est momentanément indisponible.",
      "No-AI mode: AI is temporarily unavailable.",
    );
  }
  return t("Mode sans IA", "No-AI mode");
}

/* ----- Erreurs ----- */

export function messageErreurCopilote(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.statut === 429) {
      return t(
        "Vous avez envoyé trop de messages en peu de temps. Patientez quelques minutes avant de poser une nouvelle question.",
        "You have sent too many messages in a short time. Wait a few minutes before asking a new question.",
      );
    }
    if (e.code === "COPILOTE_DESACTIVE") {
      return t(
        "Le copilote est désactivé par votre cabinet.",
        "The copilot is disabled by your firm.",
      );
    }
    if (e.statut === 410) return e.message;
    if (e.statut === 409 || e.statut === 404 || e.statut === 400) return e.message;
  }
  return messageErreur(e);
}

/* ----- Propositions d'action ----- */

export type EtatAction =
  "proposee" | "en_cours" | "confirmee" | "annulee" | "expiree" | "refusee" | "erreur";

/** Secondes avant l'expiration (0 si passée ; null si la date est illisible). */
export function secondesRestantes(expireLe: string, maintenant: Date): number | null {
  const t = Date.parse(expireLe);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - maintenant.getTime()) / 1000));
}

export function estExpiree(expireLe: string, maintenant: Date): boolean {
  const s = secondesRestantes(expireLe, maintenant);
  return s === null || s <= 0;
}

export function libelleExpiration(
  expireLe: string,
  maintenant: Date,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const s = secondesRestantes(expireLe, maintenant);
  if (s === null) return t("Délai de validité inconnu.", "Validity period unknown.");
  if (s <= 0)
    return t(
      "Cette proposition a expiré : reformulez votre demande pour en obtenir une nouvelle.",
      "This proposal has expired: rephrase your request to get a new one.",
    );
  if (s < 60) return t("Expire dans moins d'une minute.", "Expires in less than a minute.");
  const minutes = Math.ceil(s / 60);
  return t(
    `Expire dans ${minutes} minute${minutes > 1 ? "s" : ""}.`,
    `Expires in ${minutes} minute${minutes > 1 ? "s" : ""}.`,
  );
}

export const LIBELLES_ETAT_ACTION: Readonly<Record<EtatAction, string>> = {
  proposee: "À confirmer",
  en_cours: "Confirmation en cours",
  confirmee: "Confirmée",
  annulee: "Annulée",
  expiree: "Expirée",
  refusee: "Refusée",
  erreur: "Non effectuée",
};

export const LIBELLES_ETAT_ACTION_EN: Readonly<Record<EtatAction, string>> = {
  proposee: "To confirm",
  en_cours: "Confirming",
  confirmee: "Confirmed",
  annulee: "Cancelled",
  expiree: "Expired",
  refusee: "Refused",
  erreur: "Not done",
};

/**
 * État de la carte après l'échec d'une confirmation ou d'une annulation : expirée (410), refusée
 * sans réessai possible (403 droit retiré, 404 introuvable, 409 déjà traitée) ; sinon (réseau,
 * 400) la carte reste ouverte pour réessayer.
 */
export function etatApresErreur(e: unknown): EtatAction {
  if (e instanceof ErreurApi) {
    if (e.statut === 410) return "expiree";
    if (e.statut === 403 || e.statut === 404 || e.statut === 409) return "refusee";
  }
  return "erreur";
}

/** Après un refus ou une expiration, la reprise se fait en reformulant la demande. */
export const peutReformuler = (etat: EtatAction): boolean =>
  etat === "refusee" || etat === "expiree";

export const TEXTE_REPRISE =
  "Cette proposition n'est plus valable. Reformulez votre demande pour en obtenir une nouvelle.";

export const TEXTE_PROPOSITION_EXPIREE =
  "Proposition expirée au rechargement de la page : reformulez votre demande pour en obtenir une nouvelle.";

export const TEXTE_REPRISE_EN =
  "This proposal is no longer valid. Rephrase your request to get a new one.";

export const TEXTE_PROPOSITION_EXPIREE_EN =
  "Proposal expired when the page was reloaded: rephrase your request to get a new one.";

/** Texte de la question de l'utilisateur qui précède l'entrée `id`, pour la reformuler. */
export function questionAvant(fil: readonly EntreeFil[], id: string): string | null {
  const i = fil.findIndex((e) => e.id === id);
  for (let j = i - 1; j >= 0; j -= 1) {
    const e = fil[j];
    if (e?.auteur === "utilisateur") return e.texte;
  }
  return null;
}

/** Une proposition n'offre plus ses boutons une fois traitée. */
export const peutDecider = (etat: EtatAction): boolean => etat === "proposee" || etat === "erreur";

/* ----- Fil de conversation (état client) ----- */

export interface EntreeUtilisateur {
  id: string;
  auteur: "utilisateur";
  texte: string;
}

export interface EntreeCopilote {
  id: string;
  auteur: "copilote";
  reponse: ReponseCopilote;
  /** État de la carte d'action proposée, le cas échéant. */
  etatAction: EtatAction | null;
  resultat: ResultatActionCopilote | null;
  erreurAction: string | null;
  /** Conversation rechargée : la proposition d'action de cette réponse n'est plus valable. */
  propositionExpiree?: boolean;
}

export interface EntreeErreur {
  id: string;
  auteur: "erreur";
  texte: string;
}

export type EntreeFil = EntreeUtilisateur | EntreeCopilote | EntreeErreur;

export function borner(fil: readonly EntreeFil[]): EntreeFil[] {
  return fil.length > FIL_MAX ? fil.slice(fil.length - FIL_MAX) : [...fil];
}

export const ajouterQuestion = (
  fil: readonly EntreeFil[],
  id: string,
  texte: string,
): EntreeFil[] => borner([...fil, { id, auteur: "utilisateur", texte }]);

export const ajouterReponse = (
  fil: readonly EntreeFil[],
  id: string,
  reponse: ReponseCopilote,
): EntreeFil[] =>
  borner([
    ...fil,
    {
      id,
      auteur: "copilote",
      reponse,
      etatAction: reponse.action ? "proposee" : null,
      resultat: null,
      erreurAction: null,
    },
  ]);

export const ajouterErreur = (fil: readonly EntreeFil[], id: string, texte: string): EntreeFil[] =>
  borner([...fil, { id, auteur: "erreur", texte }]);

/** Met à jour la carte d'action d'une entrée ; les autres entrées sont rendues telles quelles. */
export function majAction(
  fil: readonly EntreeFil[],
  id: string,
  patch: Partial<Pick<EntreeCopilote, "etatAction" | "resultat" | "erreurAction">>,
): EntreeFil[] {
  return fil.map((e) => (e.id === id && e.auteur === "copilote" ? { ...e, ...patch } : e));
}

/** L'action proposée d'une entrée du fil, si elle existe. */
export function actionDe(e: EntreeCopilote): ActionProposeeCopilote | null {
  return e.reponse.action ?? null;
}

/**
 * Faut-il afficher la ligne d'expiration ? Non quand la proposition vient d'expirer et que la
 * reprise (« Reformuler » + consigne) s'affiche : la consigne ne doit apparaître qu'une fois.
 */
export function afficherLigneExpiration(
  ouverte: boolean,
  expiree: boolean,
  repriseAffichee: boolean,
): boolean {
  return ouverte && !(expiree && repriseAffichee);
}
