/**
 * Partage d'une note de due diligence avec un investisseur (côté cabinet) : chemins de l'API,
 * droits d'affichage, libellés, validation du choix des rapports et traduction des refus. Logique
 * pure, testée dans `due-diligence-portail.test.ts`.
 *
 * Règles : l'option est désactivée par défaut (l'associé seul la change) ; seule une version
 * VALIDÉE d'une note est publiable, avec les rapports choisis ; une note n'a qu'une publication
 * active à la fois (on la retire avant d'en publier une autre) ; le contenu publié est copié par
 * le serveur, jamais envoyé d'ici. Les droits ne servent qu'au confort d'affichage : l'API juge.
 */
import {
  aPermission,
  PLAFONDS_DD_PORTAIL,
  type DdPortailCompte,
  type DdPortailNotePubliable,
  type DdPortailPublicationCabinet,
  type DdPortailRapportPubliable,
  type FormatRapportDd,
  type Role,
  type VarianteRapportDd,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { hrefDossier } from "./due-diligence";
import type { Resultat } from "./saisie";

const seg = encodeURIComponent;

// --- Chemins ---------------------------------------------------------------------------------

export const cheminOptionPortailDd = "/api/dd/portail/option";
export const cheminPartageDossier = (dossierId: string) =>
  `/api/dd/dossiers/${seg(dossierId)}/portail`;
export const cheminInvitationsPortailDd = (dossierId: string) =>
  `${cheminPartageDossier(dossierId)}/invitations`;
export const cheminRetraitInvitationPortailDd = (dossierId: string, utilisateurId: string) =>
  `${cheminInvitationsPortailDd(dossierId)}/${seg(utilisateurId)}/retrait`;
export const cheminPublicationsNote = (noteId: string) =>
  `/api/dd/notes/${seg(noteId)}/portail/publications`;
export const cheminRetraitPublication = (publicationId: string) =>
  `/api/dd/portail/publications/${seg(publicationId)}/retrait`;

/** Page « Partage avec l'investisseur » d'un dossier. */
export const hrefPartageInvestisseur = (missionId: string, dossierId: string) =>
  `${hrefDossier(missionId, dossierId)}/portail`;

/** Réglage de l'option du cabinet (paramètres de la due diligence). */
export const hrefReglagePortailDd = "/parametres/due-diligence/portail";

// --- Droits ----------------------------------------------------------------------------------

export interface DroitsPortailDd {
  /** Inviter, retirer, publier (`dd.portail.gerer`). */
  gerer: boolean;
  /** Activer ou désactiver l'option du cabinet (`dd.portail.configurer`, associé seul). */
  configurer: boolean;
}

export function droitsPortailDd(roles: readonly Role[]): DroitsPortailDd {
  return {
    gerer: aPermission(roles, "dd.portail.gerer"),
    configurer: aPermission(roles, "dd.portail.configurer"),
  };
}

// --- Option du cabinet -----------------------------------------------------------------------

export const CONFIRMATION_ACTIVATION =
  "Les investisseurs invités pourront consulter les notes validées que vous publierez.";
export const CONFIRMATION_DESACTIVATION =
  "Les investisseurs ne verront plus aucune note : leurs invitations et les publications sont conservées, mais plus rien ne leur est servi.";

export const EXPLICATION_OPTION_DESACTIVEE =
  "Le partage avec les investisseurs est désactivé pour votre cabinet. Tant qu'il l'est, aucune note n'est visible dans le portail, même publiée. Un associé peut l'activer dans les paramètres de la due diligence.";

/** Phrase d'état de l'option. */
export function etatOption(actif: boolean, modifieLe: string | null): string {
  if (!actif) return modifieLe ? "Désactivé" : "Désactivé (réglage par défaut)";
  return "Activé";
}

// --- Comptes ---------------------------------------------------------------------------------

export type ActionCompte = "inviter" | "retirer" | null;

/** Action proposée sur un compte : inviter un compte admissible, retirer un compte invité. */
export function actionCompte(c: Pick<DdPortailCompte, "admissible" | "invite">): ActionCompte {
  if (c.invite) return "retirer";
  return c.admissible ? "inviter" : null;
}

export function libelleCompte(c: Pick<DdPortailCompte, "admissible" | "invite">): {
  libelle: string;
  tonalite: "succes" | "attention" | "neutre";
} {
  if (c.invite && !c.admissible)
    return { libelle: "Invité, n'est plus admissible", tonalite: "attention" };
  if (c.invite) return { libelle: "Invité", tonalite: "succes" };
  if (c.admissible) return { libelle: "Non invité", tonalite: "neutre" };
  return { libelle: "Non admissible", tonalite: "neutre" };
}

/** Un compte invité qui n'est plus admissible (désactivé, rôle changé) est à retirer. */
export const compteARetirer = (c: Pick<DdPortailCompte, "admissible" | "invite">): boolean =>
  c.invite && !c.admissible;

// --- Rapports et publications ----------------------------------------------------------------

const VARIANTES: Record<VarianteRapportDd, string> = {
  executive: "Version exécutive",
  detaillee: "Version détaillée",
};
const FORMATS: Record<FormatRapportDd, string> = { pdf: "PDF", docx: "Word" };

export function libelleRapport(r: Pick<DdPortailRapportPubliable, "variante" | "format">): string {
  return `${VARIANTES[r.variante] ?? "Document"} (${FORMATS[r.format] ?? String(r.format).toUpperCase()})`;
}

/** Publication encore servie à l'investisseur (non retirée), la plus récente d'abord. */
export function publicationsActives(
  publications: readonly DdPortailPublicationCabinet[],
): DdPortailPublicationCabinet[] {
  return publications
    .filter((p) => !p.retiree)
    .sort((a, b) => b.publie_le.localeCompare(a.publie_le));
}

export function badgePublication(p: Pick<DdPortailPublicationCabinet, "perimee">): {
  libelle: string;
  tonalite: "succes" | "attention";
} {
  return p.perimee
    ? { libelle: "Périmée : une version plus récente existe", tonalite: "attention" }
    : { libelle: "À jour", tonalite: "succes" };
}

/** Peut-on publier cette note ? Option active et aucune publication active à retirer d'abord. */
export function publicationPossible(
  note: Pick<DdPortailNotePubliable, "publication_active_id">,
  optionActive: boolean,
): { possible: boolean; raison: string | null } {
  if (!optionActive) {
    return { possible: false, raison: "Activez d'abord l'option dans les paramètres du cabinet." };
  }
  if (note.publication_active_id !== null) {
    return {
      possible: false,
      raison: "Une publication est active : retirez-la avant d'en publier une autre.",
    };
  }
  return { possible: true, raison: null };
}

export type ChampPublication = "rapports";

export interface ChargePublication {
  version: number;
  rapports: string[];
}

/** Choix des rapports : au plus 10, sans doublon, uniquement des rapports proposés. */
export function validerPublication(
  version: number,
  rapportsChoisis: readonly string[],
  disponibles: readonly Pick<DdPortailRapportPubliable, "id">[],
): Resultat<ChargePublication, ChampPublication> {
  const uniques = [...new Set(rapportsChoisis)];
  if (uniques.length > PLAFONDS_DD_PORTAIL.pieces_par_publication) {
    return {
      ok: false,
      erreurs: {
        rapports: `Choisissez ${PLAFONDS_DD_PORTAIL.pieces_par_publication} rapports au plus.`,
      },
    };
  }
  const connus = new Set(disponibles.map((r) => r.id));
  if (uniques.some((id) => !connus.has(id))) {
    return {
      ok: false,
      erreurs: { rapports: "Un rapport choisi n'est plus proposé : rechargez la page." },
    };
  }
  return { ok: true, charge: { version, rapports: uniques } };
}

// --- Erreurs ---------------------------------------------------------------------------------

export const MESSAGES_PORTAIL_DD: Record<string, string> = {
  DD_PORTAIL_COMPTE_NON_ADMISSIBLE:
    "Ce compte ne peut pas être invité : il doit être un investisseur actif du client de ce dossier.",
  DD_PORTAIL_PIECE_NON_ADMISSIBLE:
    "Un des rapports choisis ne peut pas être joint : il doit être un rapport de cette version de la note.",
  DD_PORTAIL_DEJA_INVITE: "Ce compte est déjà invité sur ce dossier.",
  NOTE_NON_VALIDEE: "Seule une version validée de la note peut être publiée.",
  NOTE_PERIMEE:
    "Une version plus récente de la note a été soumise : publiez la dernière version validée.",
  DD_PORTAIL_PUBLICATION_ACTIVE:
    "Une publication de cette note est déjà active : retirez-la avant d'en publier une autre.",
  DD_PORTAIL_PUBLICATION_RETIREE: "Cette publication est déjà retirée.",
  MISSION_CLOTUREE: "La mission est clôturée : le partage avec l'investisseur est figé.",
  PLAFOND_ATTEINT: "Le plafond d'éléments de ce type est atteint pour ce dossier ou cette note.",
};

/** Message français pour un refus de l'API ; `null` pour une erreur sans lien avec le partage. */
export function messagePortailDd(e: unknown): string {
  if (e instanceof ErreurApi) {
    const specifique = MESSAGES_PORTAIL_DD[e.code];
    if (specifique) return specifique;
    if (e.statut === 404) {
      return "Cet élément n'existe plus ou n'est plus accessible : rechargez la page.";
    }
  }
  return messageErreur(e);
}

/** Après ce refus, l'écran est probablement périmé : le rafraîchir. */
export const partageChange = (e: unknown): boolean =>
  e instanceof ErreurApi &&
  (e.statut === 404 || (e.statut === 409 && e.code !== "PLAFOND_ATTEINT"));
