/** Sous-module de `questionnaires.ts` : droits, actions d'un envoi et répondants. */
import { aPermission, type Langue, type RepondantEligible, type Role } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import {
  type RepondantEnvoi,
  type EnvoiDetail,
  DELAI_RELANCE_HEURES,
} from "./questionnaires-types";
import { type SaisieEnvoi } from "./questionnaires-envoi";
import { messageQuestionnaire } from "./questionnaires-erreurs";

// --- Droits et actions ------------------------------------------------------------------------

export interface ContexteQuestionnaires {
  roles: readonly Role[];
  missionCloturee: boolean;
}

export const peutLireQuestionnaires = (roles: readonly Role[]) =>
  aPermission(roles, "questionnaire.lire");
export const peutGererQuestionnaires = (roles: readonly Role[]) =>
  aPermission(roles, "questionnaire.gerer");

/** Écrire sur les envois d'une mission : droit de gestion ET mission non clôturée. */
export const peutEcrireEnvois = (c: ContexteQuestionnaires) =>
  peutGererQuestionnaires(c.roles) && !c.missionCloturee;

export interface ActionsEnvoi {
  envoyer: boolean;
  relancer: boolean;
  clore: boolean;
  modifierReglages: boolean;
  /** Pourquoi aucune action n'est proposée, `null` si au moins une l'est. */
  raisonLectureSeule: string | null;
}

export function actionsEnvoi(
  envoi: Pick<EnvoiDetail, "statut">,
  c: ContexteQuestionnaires,
  langue: Langue = "fr",
): ActionsEnvoi {
  const ecrire = peutEcrireEnvois(c);
  const a = {
    envoyer: ecrire && envoi.statut === "brouillon",
    relancer: ecrire && envoi.statut === "envoye",
    clore: ecrire && envoi.statut === "envoye",
    modifierReglages: ecrire && envoi.statut !== "clos",
  };
  if (langue === "en") {
    const raisonEn = c.missionCloturee
      ? "Engagement closed: questionnaires remain viewable, but no sending, setting change or reminder is possible."
      : !peutGererQuestionnaires(c.roles)
        ? "Your role lets you view questionnaires, not send or remind them."
        : envoi.statut === "clos"
          ? "Questionnaire closed: no more entries or reminders."
          : null;
    return { ...a, raisonLectureSeule: raisonEn };
  }
  const raisonLectureSeule = c.missionCloturee
    ? "Mission clôturée : les questionnaires restent consultables, plus aucun envoi, réglage ni relance n'est possible."
    : !peutGererQuestionnaires(c.roles)
      ? "Votre rôle permet de consulter les questionnaires, pas de les envoyer ni de les relancer."
      : envoi.statut === "clos"
        ? "Questionnaire clos : plus aucune saisie ni relance."
        : null;
  return { ...a, raisonLectureSeule };
}

/** Le répondant attend-il encore (réponse non soumise) ? Collectif : réponse partagée. */
export function repondantEnAttente(
  envoi: Pick<EnvoiDetail, "mode" | "reponse_collective">,
  r: Pick<RepondantEnvoi, "statut">,
): boolean {
  if (envoi.mode === "collectif") return envoi.reponse_collective?.statut !== "soumise";
  return r.statut !== "soumise";
}

/** Relancé il y a moins de 24 h (indication ; l'API refuse en 409). */
export function relanceRecente(
  derniere: string | null,
  maintenant: Date,
  heures = DELAI_RELANCE_HEURES,
): boolean {
  if (!derniere) return false;
  const t = new Date(derniere).getTime();
  if (Number.isNaN(t)) return false;
  const ecart = maintenant.getTime() - t;
  return ecart >= 0 && ecart < heures * 3_600_000;
}

// --- Répondants -------------------------------------------------------------------------------

/** Seuls le dirigeant et le contributeur client répondent (DECISIONS.md, V2). */
export const ROLES_REPONDANTS = ["client_dirigeant", "client_contributeur"] as const;

export const ROLE_REPONDANT_LIBELLES: Record<(typeof ROLES_REPONDANTS)[number], string> = {
  client_dirigeant: "Dirigeant",
  client_contributeur: "Contributeur",
};

/** « Dirigeant », « Contributeur », ou les deux. */
export const ROLE_REPONDANT_LIBELLES_EN: Record<(typeof ROLES_REPONDANTS)[number], string> = {
  client_dirigeant: "Executive",
  client_contributeur: "Contributor",
};

export function rolesRepondant(c: { roles: readonly string[] }, langue: Langue = "fr"): string {
  return ROLES_REPONDANTS.filter((r) => c.roles.includes(r))
    .map((r) => (langue === "en" ? ROLE_REPONDANT_LIBELLES_EN : ROLE_REPONDANT_LIBELLES)[r])
    .join(", ");
}

/**
 * Échec du chargement des répondants désignables : 409 mission clôturée, 404 mission
 * invisible (uniforme), 403 rôle sans `questionnaire.gerer`.
 */
export function messageRepondantsEligibles(e: unknown, langue: Langue = "fr"): string {
  if (langue === "en") {
    if (!(e instanceof ErreurApi)) return "The list of respondents could not be loaded.";
    if (e.statut === 409) return "Engagement closed: no more questionnaires can be sent.";
    if (e.statut === 404) {
      return "Engagement not found: it was removed, or you no longer have access to it.";
    }
    if (e.statut === 403) return "Your role does not allow preparing a questionnaire to be sent.";
    return messageErreur(e);
  }
  if (!(e instanceof ErreurApi)) return "La liste des répondants n'a pas pu être chargée.";
  if (e.statut === 409) {
    return "Mission clôturée : plus aucun envoi de questionnaire n'est possible.";
  }
  if (e.statut === 404) {
    return "Mission introuvable : elle a été retirée, ou vous n'y avez plus accès.";
  }
  if (e.statut === 403) return "Votre rôle ne permet pas de préparer l'envoi d'un questionnaire.";
  return messageErreur(e);
}

export const TITRE_AUCUN_REPONDANT =
  "Aucun répondant éligible : invitez d'abord des utilisateurs du portail du client.";

export const TITRE_AUCUN_REPONDANT_EN = "No eligible respondent: first invite client portal users.";

/** Explication de l'état vide, selon le droit d'inviter au portail (`portail.gerer`). */
export function aideAucunRepondant(peutInviter: boolean, langue: Langue = "fr"): string {
  if (langue === "en") {
    const rule =
      "Only active executives and contributors of the client portal of a non-archived client can respond; investors and deactivated accounts are not offered.";
    return peutInviter
      ? `${rule} Invite them from the "Client portal" tab of the client record, then refresh the list.`
      : `${rule} Portal invitations are handled by the partner, the engagement director or the engagement manager: ask them to invite the respondents, then refresh the list.`;
  }
  const regle =
    "Seuls les dirigeants et contributeurs actifs du portail d'un client non archivé répondent ; les investisseurs et les comptes désactivés ne sont pas proposés.";
  return peutInviter
    ? `${regle} Invitez-les depuis l'onglet « Portail client » de la fiche du client, puis actualisez la liste.`
    : `${regle} L'invitation au portail revient à l'associé, au directeur ou au chef de mission : demandez-leur d'inviter les répondants, puis actualisez la liste.`;
}

/** Ne garde de la saisie que les répondants encore proposés (après actualisation de la liste). */
export function garderRepondants(
  repondants: SaisieEnvoi["repondants"],
  proposes: readonly Pick<RepondantEligible, "id">[],
): SaisieEnvoi["repondants"] {
  const ids = new Set(proposes.map((p) => p.id));
  return Object.fromEntries(Object.entries(repondants).filter(([id]) => ids.has(id)));
}

export const MESSAGE_REPONDANT_REFUSE =
  "Un répondant choisi n'est plus désignable : son compte du portail a été désactivé ou retiré, ou le client a été archivé entre-temps. La liste des répondants est actualisée : vérifiez la sélection puis réessayez.";

export const MESSAGE_REPONDANT_REFUSE_EN =
  "A selected respondent can no longer be designated: their portal account was deactivated or removed, or the client was archived in the meantime. The list of respondents has been refreshed: check the selection and try again.";

/**
 * Refus d'un répondant à la création d'un envoi : 400 métier sans détail de champ (compte
 * désactivé ou détaché, client archivé : `REQUETE_INVALIDE` de `creerEnvoi`) ou déclencheur
 * (`REPONDANT_INVALIDE`). Un 400 de validation (« Données invalides. », détails) n'en est pas un.
 */
export function estRefusRepondant(e: unknown): boolean {
  if (!(e instanceof ErreurApi) || e.statut !== 400) return false;
  if (e.code === "REPONDANT_INVALIDE") return true;
  return (
    e.code === "REQUETE_INVALIDE" && e.details === undefined && e.message !== "Données invalides."
  );
}

/** Message d'une création d'envoi refusée (sinon `null` : message générique). */
export function messageCreationEnvoi(e: unknown, langue: Langue = "fr"): string | null {
  return estRefusRepondant(e)
    ? langue === "en"
      ? MESSAGE_REPONDANT_REFUSE_EN
      : MESSAGE_REPONDANT_REFUSE
    : messageQuestionnaire(e, langue);
}
