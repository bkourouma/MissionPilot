/**
 * Espace client (portail, SOC-09) : contrats de l'API `/api/portail/*`, libellés et règles
 * d'affichage. Logique pure, testée dans `portail.test.ts`.
 *
 * Le client ne voit QUE ce que le cabinet a partagé : l'API filtre (partages explicites,
 * 404 identique pour inexistant / non partagé). Les droits testés ici ne servent qu'à
 * n'afficher que ce qui sera accepté ; l'API reste seule juge. Aucun montant n'est calculé :
 * totaux, encaissé, solde et jours de retard viennent de l'API (moteur de calcul).
 *
 * Aucune donnée de l'espace client n'est gardée dans le navigateur (ni stockage local, ni
 * cache : le service worker ne garde ni page ni réponse d'API).
 */
import {
  aPermission,
  MOT_DE_PASSE_MIN,
  TOUS_LES_ROLES,
  type Permission,
  type Role,
  type StatutFacture,
  type StatutMission,
  type StatutPaiement,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { NomIcone } from "../components/ui/Icone";
import { CODE_TFA_A_CONFIGURER, ErreurApi, MESSAGE_INATTENDU } from "./api";
import {
  DEVISES,
  formaterDate,
  formaterMontantMineur,
  formaterNombre,
  type Devise,
} from "./format";
import { CHEMIN_PORTAIL, CHEMIN_SECURITE_PORTAIL } from "./portail-routes";
import type { Resultat } from "./saisie";

export { MOT_DE_PASSE_MIN };

// --- Contrats de l'API ---------------------------------------------------------------------

/** `GET /api/portail/moi`. */
export interface ProfilPortail {
  utilisateur: { id: string; nom: string; email: string; roles: string[] };
  entreprise: { id: string; raison_sociale: string };
  cabinet: { nom: string };
  contact_principal: { nom: string; email: string | null } | null;
  /**
   * Limité aux droits du rôle : `missions` et `documents` absents sans
   * « portail.missions.lire », `factures` absent sans « portail.factures.lire »
   * (l'investisseur reçoit `{}`). Une clé absente vaut « rien de partagé ».
   */
  partages: { missions?: number; documents?: number; factures?: boolean };
}

/** Page d'une liste du portail (curseur opaque). */
export interface PagePortail<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export interface MissionPortail {
  id: string;
  intitule: string;
  statut: StatutMission;
  date_debut: string | null;
  date_fin: string | null;
  partage: { jalons: boolean; factures: boolean };
}

export interface ValidationJalon {
  valide_le: string;
  commentaire: string | null;
  valide_par_moi: boolean;
}

export interface JalonPortail {
  id: string;
  libelle: string;
  date_prevue: string | null;
  atteint: boolean;
  validation: ValidationJalon | null;
}

export interface LivrablePortail {
  id: string;
  type: string;
  nom: string;
  version: number;
  depose_le: string;
  type_mime: string | null;
  taille: number | null;
  telechargeable: boolean;
}

export interface PaiementPortail {
  statut_paiement: StatutPaiement;
  encaisse: number;
  solde: number;
  jours_retard: number;
}

export interface FacturePortail {
  id: string;
  nature: "facture" | "avoir";
  numero: string | null;
  facture_origine_id: string | null;
  date_emission: string | null;
  date_echeance: string | null;
  devise: string;
  statut: StatutFacture;
  objet: string | null;
  mission: { id: string; intitule: string };
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  total_retenues: number;
  net_a_payer: number;
  paiement: PaiementPortail | null;
}

// --- Navigation ----------------------------------------------------------------------------

export interface EntreePortail {
  id: "accueil" | "missions" | "questionnaires" | "salle" | "kpi" | "factures" | "securite";
  libelle: string;
  href: string;
  icone: NomIcone;
  /** `null` : tout utilisateur du portail (son propre compte). */
  permission: Permission | null;
}

export const NAVIGATION_PORTAIL: readonly EntreePortail[] = [
  {
    id: "accueil",
    libelle: "Accueil",
    href: CHEMIN_PORTAIL,
    icone: "accueil",
    permission: "portail.acceder",
  },
  {
    id: "missions",
    libelle: "Missions",
    href: `${CHEMIN_PORTAIL}/missions`,
    icone: "dossier",
    permission: "portail.missions.lire",
  },
  {
    // Césure conditionnelle (U+00AD) : le mot se coupe dans la barre basse d'un téléphone étroit.
    id: "questionnaires",
    libelle: "Question\u00adnaires",
    href: `${CHEMIN_PORTAIL}/questionnaires`,
    icone: "taches",
    permission: "portail.questionnaires.repondre",
  },
  {
    // Salle de mission (CLI-01) : pièces demandées par le cabinet, dépôt depuis le téléphone.
    id: "salle",
    libelle: "Documents",
    href: `${CHEMIN_PORTAIL}/salle`,
    icone: "trombone",
    permission: "portail.salle.deposer",
  },
  {
    id: "kpi",
    libelle: "KPI",
    href: `${CHEMIN_PORTAIL}/kpi`,
    icone: "courbe",
    permission: "portail.kpi.saisir",
  },
  {
    id: "factures",
    libelle: "Factures",
    href: `${CHEMIN_PORTAIL}/factures`,
    icone: "facture",
    permission: "portail.factures.lire",
  },
  {
    id: "securite",
    libelle: "Sécurité",
    href: CHEMIN_SECURITE_PORTAIL,
    icone: "cadenas",
    permission: null,
  },
];

/** Rôles connus de cette version du web (un rôle inconnu ne donne rien). */
function rolesConnus(roles: readonly string[]): Role[] {
  return roles.filter((r): r is Role => (TOUS_LES_ROLES as readonly string[]).includes(r));
}

/** L'utilisateur détient-il cette permission du portail ? (rôle inconnu : non) */
export function peut(roles: readonly string[], permission: Permission): boolean {
  return aPermission(rolesConnus(roles), permission);
}

/** Entrées de navigation accessibles avec ces rôles. */
export function entreesPortail(roles: readonly string[]): EntreePortail[] {
  return NAVIGATION_PORTAIL.filter((e) => e.permission === null || peut(roles, e.permission));
}

/** Entrée active : l'accueil sur son chemin exact, les autres sur leur préfixe. */
export function entreeActive(chemin: string, entree: Pick<EntreePortail, "href">): boolean {
  if (entree.href === CHEMIN_PORTAIL) return chemin === CHEMIN_PORTAIL;
  return chemin === entree.href || chemin.startsWith(`${entree.href}/`);
}

// --- Libellés ------------------------------------------------------------------------------

type Libelle = { libelle: string; tonalite: TonaliteStatut };

/** Statut d'une mission, en termes simples pour le client. */
export const STATUT_MISSION_PORTAIL: Record<StatutMission, Libelle> = {
  opportunite: { libelle: "En préparation", tonalite: "neutre" },
  proposition: { libelle: "En préparation", tonalite: "neutre" },
  signee: { libelle: "Signée, démarrage prochain", tonalite: "neutre" },
  en_cours: { libelle: "En cours", tonalite: "succes" },
  a_cloturer: { libelle: "En cours de finalisation", tonalite: "succes" },
  cloturee: { libelle: "Terminée", tonalite: "neutre" },
};

export function statutMission(statut: string): Libelle {
  return STATUT_MISSION_PORTAIL[statut as StatutMission] ?? { libelle: "—", tonalite: "neutre" };
}

/** Période d'une mission : « Du 12 janv. 2027 au 30 juin 2027 », ou ce qui est connu. */
export function periodeMission(debut: string | null, fin: string | null): string {
  if (debut && fin) return `Du ${formaterDate(debut)} au ${formaterDate(fin)}`;
  if (debut) return `Depuis le ${formaterDate(debut)}`;
  if (fin) return `Jusqu'au ${formaterDate(fin)}`;
  return "Dates à préciser";
}

/** Rubriques consultables d'une mission partagée : « À consulter : jalons, documents et factures. » */
export function rubriquesMission(partage: MissionPortail["partage"]): string {
  const rubriques = [
    ...(partage.jalons ? ["jalons"] : []),
    "documents",
    ...(partage.factures ? ["factures"] : []),
  ];
  const liste =
    rubriques.length === 1
      ? rubriques[0]
      : `${rubriques.slice(0, -1).join(", ")} et ${rubriques[rubriques.length - 1]}`;
  return `À consulter : ${liste}.`;
}

/** Statut de paiement d'une facture, du point de vue du client. */
export const STATUT_PAIEMENT_PORTAIL: Record<StatutPaiement, Libelle> = {
  non_payee: { libelle: "À régler", tonalite: "neutre" },
  partiellement_payee: { libelle: "Partiellement réglée", tonalite: "attention" },
  soldee: { libelle: "Réglée", tonalite: "succes" },
  en_retard: { libelle: "Échéance dépassée", tonalite: "danger" },
  annulee: { libelle: "Annulée", tonalite: "neutre" },
};

/** Badge de paiement : « Échéance dépassée de 12 jours » ; un avoir n'a pas de paiement. */
export function etatPaiement(f: Pick<FacturePortail, "nature" | "statut" | "paiement">): Libelle {
  if (f.statut === "annulee") return { libelle: "Annulée par un avoir", tonalite: "neutre" };
  if (f.nature === "avoir" || !f.paiement) return { libelle: "Sans objet", tonalite: "neutre" };
  const s = STATUT_PAIEMENT_PORTAIL[f.paiement.statut_paiement] ?? {
    libelle: "—",
    tonalite: "neutre",
  };
  const retard = f.paiement.jours_retard;
  if (f.paiement.statut_paiement === "en_retard" && retard > 0) {
    return { ...s, libelle: `${s.libelle} de ${retard} jour${retard > 1 ? "s" : ""}` };
  }
  return s;
}

/** « Facture FA-2027-0012 », « Avoir AV-2027-0003 ». */
export function designationFacturePortail(f: Pick<FacturePortail, "nature" | "numero">): string {
  const nature = f.nature === "avoir" ? "Avoir" : "Facture";
  return f.numero ? `${nature} ${f.numero}` : nature;
}

/** Espace insécable avant l'unité (comme `formaterMontantMineur`). */
const NBSP = String.fromCharCode(0xa0);

/** Montant en unités mineures dans sa devise ; une devise inconnue reste lisible, sans conversion. */
export function montantPortail(valeur: number | null | undefined, devise: string): string {
  if ((DEVISES as readonly string[]).includes(devise)) {
    return formaterMontantMineur(valeur, devise as Devise);
  }
  return `${formaterNombre(valeur, 0)}${NBSP}${devise}`;
}

const TYPES_LIVRABLE: Record<string, string> = {
  livrable: "Livrable",
  lettre_de_mission: "Lettre de mission",
};

export const libelleTypeLivrable = (type: string) => TYPES_LIVRABLE[type] ?? "Document";

// --- Jalons --------------------------------------------------------------------------------

export interface EtatJalon extends Libelle {
  /** Précision sous le libellé : date prévue, date et auteur de la validation. */
  detail: string | null;
}

/** Statut affiché d'un jalon : prévu, atteint (à valider) ou validé (par moi ou mon entreprise). */
export function etatJalon(j: Pick<JalonPortail, "atteint" | "date_prevue" | "validation">) {
  if (j.validation) {
    const quand = formaterDate(j.validation.valide_le, "Africa/Abidjan");
    return {
      libelle: "Validé",
      tonalite: "succes",
      detail: j.validation.valide_par_moi
        ? `Validé par vous le ${quand}`
        : `Validé par votre entreprise le ${quand}`,
    } satisfies EtatJalon;
  }
  if (j.atteint) {
    return {
      libelle: "Atteint, en attente de validation",
      tonalite: "attention",
      detail: j.date_prevue ? `Prévu le ${formaterDate(j.date_prevue)}` : null,
    } satisfies EtatJalon;
  }
  return {
    libelle: "À venir",
    tonalite: "neutre",
    detail: j.date_prevue ? `Prévu le ${formaterDate(j.date_prevue)}` : "Date à préciser",
  } satisfies EtatJalon;
}

/** Le bouton « Valider ce jalon » : dirigeant client, jalon atteint et pas encore validé. */
export function peutValiderJalon(
  j: Pick<JalonPortail, "atteint" | "validation">,
  roles: readonly string[],
): boolean {
  return j.atteint && !j.validation && peut(roles, "portail.jalons.valider");
}

/** Longueur maximale du commentaire de validation (contrat de l'API). */
export const COMMENTAIRE_VALIDATION_MAX = 1000;

/** Commentaire facultatif : vide → aucun champ envoyé. */
export function validerCommentaireValidation(
  commentaire: string,
): Resultat<{ commentaire?: string }, "commentaire"> {
  const t = commentaire.trim();
  if (t.length > COMMENTAIRE_VALIDATION_MAX) {
    return {
      ok: false,
      erreurs: {
        commentaire: `Le commentaire ne doit pas dépasser ${COMMENTAIRE_VALIDATION_MAX} caractères (actuellement ${t.length}).`,
      },
    };
  }
  return { ok: true, charge: t === "" ? {} : { commentaire: t } };
}

/** Chemin de la validation d'un jalon. */
export const cheminValidationJalon = (missionId: string, jalonId: string) =>
  `/api/portail/missions/${encodeURIComponent(missionId)}/jalons/${encodeURIComponent(jalonId)}/valider`;

/** Message affiché quand la validation d'un jalon est refusée. */
export function messageValidationJalon(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "JALON_DEJA_VALIDE")
      return "Ce jalon a déjà été validé. Rechargez la page pour voir la validation enregistrée.";
    if (e.code === "CONFLIT")
      return "Ce jalon n'est pas encore atteint : il pourra être validé quand le cabinet l'aura marqué comme atteint.";
    if (e.statut === 403 && e.code !== CODE_TFA_A_CONFIGURER)
      return "Seul le dirigeant de votre entreprise peut valider un jalon.";
  }
  return messageErreurPortail(e);
}

// --- Liens ---------------------------------------------------------------------------------

/** Téléchargement (ou ouverture dans un onglet) d'un livrable partagé : même origine, cookie. */
export function hrefLivrable(id: string, affichage: "inline" | "attachment" = "attachment") {
  return `/api/portail/livrables/${encodeURIComponent(id)}/fichier?affichage=${affichage}`;
}

/** Document imprimable d'une facture (HTML sûr servi par l'API, sans script). */
export const hrefDocumentFacture = (id: string) =>
  `/api/portail/factures/${encodeURIComponent(id)}/document`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estIdentifiant = (v: string) => UUID.test(v);

/** Curseur reçu dans l'URL : base64url borné, sinon ignoré (retour au début de la liste). */
export function lireCurseur(v: string | string[] | undefined): string | null {
  const brut = (Array.isArray(v) ? v[0] : v) ?? "";
  return brut !== "" && brut.length <= 500 && /^[A-Za-z0-9_-]+$/.test(brut) ? brut : null;
}

/** Taille d'une page des listes du portail. */
export const TAILLE_PAGE_PORTAIL = 20;

/** Requête de l'API pour une page. */
export function requetePage(chemin: string, curseur: string | null): string {
  const r = new URLSearchParams({ limite: String(TAILLE_PAGE_PORTAIL) });
  if (curseur) r.set("curseur", curseur);
  return `${chemin}?${r.toString()}`;
}

/** Lien vers une page d'une liste du portail. */
export function hrefPage(chemin: string, curseur: string | null): string {
  return curseur ? `${chemin}?${new URLSearchParams({ curseur }).toString()}` : chemin;
}

// --- Accueil -------------------------------------------------------------------------------

export interface ElementPartage {
  id: "missions" | "documents" | "factures";
  texte: string;
  /** Lien vers la rubrique, si l'utilisateur peut l'ouvrir. */
  href: string | null;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Résumé des partages pour l'accueil ; liste vide : rien n'a encore été partagé (ou rien
 * que ce rôle puisse voir). Une clé absente de la réponse compte comme rien de partagé.
 */
export function resumePartages(
  partages: ProfilPortail["partages"],
  roles: readonly string[],
): ElementPartage[] {
  const missions = peut(roles, "portail.missions.lire");
  const nbMissions = partages.missions ?? 0;
  const nbDocuments = partages.documents ?? 0;
  const elements: ElementPartage[] = [];
  if (nbMissions > 0) {
    elements.push({
      id: "missions",
      texte: pluriel(nbMissions, "mission partagée", "missions partagées"),
      href: missions ? `${CHEMIN_PORTAIL}/missions` : null,
    });
  }
  if (nbDocuments > 0) {
    elements.push({
      id: "documents",
      texte: pluriel(nbDocuments, "document mis à disposition", "documents mis à disposition"),
      href: missions ? `${CHEMIN_PORTAIL}/missions` : null,
    });
  }
  if (partages.factures === true) {
    elements.push({
      id: "factures",
      texte: "Factures émises consultables",
      href: peut(roles, "portail.factures.lire") ? `${CHEMIN_PORTAIL}/factures` : null,
    });
  }
  return elements;
}

// --- Erreurs -------------------------------------------------------------------------------

/** Conduite à tenir face à une erreur d'API sur une page du portail. */
export type IssueErreurPortail = "connexion" | "securite" | "afficher";

export function issueErreurPortail(statut: number, code: string): IssueErreurPortail {
  if (statut === 401) return "connexion";
  if (statut === 403 && code === CODE_TFA_A_CONFIGURER) return "securite";
  return "afficher";
}

/** Message affichable (français, sans jargon) pour une erreur d'appel du portail. */
export function messageErreurPortail(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === CODE_TFA_A_CONFIGURER)
    return "Votre cabinet demande d'activer la double authentification : rendez-vous dans « Sécurité » pour continuer.";
  if (e.statut === 403)
    return "Cet élément n'est pas accessible avec votre accès. Pour toute question, contactez votre interlocuteur au cabinet.";
  if (e.statut === 404) return "Cet élément n'existe pas ou n'est plus partagé avec vous.";
  if (e.code === "REQUETE_INVALIDE")
    return "La demande n'a pas pu être traitée. Revenez à la page précédente puis réessayez.";
  return e.message || MESSAGE_INATTENDU;
}

/** Résultat d'un chargement affiché dans la page. */
export type ChargementPortail<T> =
  { ok: true; donnees: T } | { ok: false; statut: number; code: string; message: string };

// --- Invitation ----------------------------------------------------------------------------

/** Message affiché pour un refus de l'acceptation d'une invitation au portail. */
export function messageErreurInvitationPortail(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === "INVITATION_INVALIDE")
    return "Ce lien d'invitation a expiré ou a déjà été utilisé. Demandez à votre interlocuteur au cabinet de vous envoyer une nouvelle invitation.";
  if (e.code === "CONFLIT")
    return "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec ce compte, ou contactez votre interlocuteur au cabinet.";
  if (e.code === "REQUETE_INVALIDE")
    return "Le lien d'invitation est incomplet ou les informations saisies sont refusées. Vérifiez le lien reçu par e-mail.";
  if (e.code === "TROP_DE_TENTATIVES" || e.statut === 429)
    return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
  return e.message || MESSAGE_INATTENDU;
}

/**
 * Règles du mot de passe affichées sous les champs, mises à jour à la saisie (contrat de
 * l'API : 12 à 200 caractères ; le champ refuse lui-même la saisie au-delà de 200).
 */
export interface RegleMotDePasse {
  id: "longueur" | "confirmation";
  texte: string;
  respectee: boolean;
}

export function reglesMotDePasse(motDePasse: string, confirmation: string): RegleMotDePasse[] {
  const n = motDePasse.length;
  return [
    {
      id: "longueur",
      texte: `Au moins ${MOT_DE_PASSE_MIN} caractères (${n} saisi${n > 1 ? "s" : ""})`,
      respectee: n >= MOT_DE_PASSE_MIN && n <= 200,
    },
    {
      id: "confirmation",
      texte: "Les deux mots de passe sont identiques",
      respectee: confirmation !== "" && confirmation === motDePasse,
    },
  ];
}
