/**
 * Rapport d'avancement hebdomadaire au client (AUT-10) : contrats de l'API, chemins, libellés et
 * règles d'affichage. Logique pure, testée dans `avancement.test.ts`.
 *
 * Règles : TOUS les chiffres viennent du moteur et sont affichés en lecture seule ; seuls
 * l'introduction et le commentaire se modifient. Le client ne voit un rapport qu'une fois validé,
 * et aucun e-mail n'est envoyé. La suggestion de l'IA est un brouillon à relire : elle ne se valide
 * pas telle quelle. L'API reste seule juge (droits, états, versions).
 */
import {
  TAILLE_COMMENTAIRE_AVANCEMENT,
  TAILLE_INTRODUCTION_AVANCEMENT,
  type ContenuAvancement,
  type ContenuAvancementPortail,
  type StatutAvancementRapport,
  type StatutCommentaireAvancement,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import { formaterNombre } from "./format";
import { CHEMIN_PORTAIL } from "./portail-routes";
import { estDateIso, libelleSemaine } from "./semaine";

export type {
  ContenuAvancement,
  ContenuAvancementPortail,
  StatutAvancementRapport,
  StatutCommentaireAvancement,
};
export { TAILLE_COMMENTAIRE_AVANCEMENT, TAILLE_INTRODUCTION_AVANCEMENT };

// --- Contrats de l'API (cabinet) ------------------------------------------------------------

/** Ligne de `GET /api/missions/:id/avancement`. */
export interface LigneAvancement {
  id: string;
  mission_id: string;
  semaine: string;
  semaine_fin: string;
  statut: StatutAvancementRapport;
  statut_libelle: string;
  avancement_pourcentage: number | null;
  statut_commentaire: StatutCommentaireAvancement;
  statut_commentaire_libelle: string;
  version: number;
  genere_le: string;
  valide_le: string | null;
}

export interface PageAvancement {
  elements: LigneAvancement[];
  /** Semaine (lundi) strictement avant laquelle reprendre, ou `null`. */
  suivant: string | null;
}

/** `GET /api/avancement/:id`. */
export interface RapportAvancement {
  id: string;
  mission_id: string;
  mission_intitule: string;
  semaine: string;
  semaine_fin: string;
  statut: StatutAvancementRapport;
  statut_libelle: string;
  contenu: ContenuAvancement;
  introduction: string | null;
  commentaire: string | null;
  commentaire_ia: string | null;
  statut_commentaire: StatutCommentaireAvancement;
  statut_commentaire_libelle: string;
  version: number;
  genere_le: string;
  modifie_le: string;
  valide_par: { id: string; nom: string | null } | null;
  valide_le: string | null;
  peut_valider: boolean;
}

/** Raison pour laquelle l'IA n'a rien proposé (`POST /api/avancement/:id/suggerer-commentaire`). */
export type RaisonSuggestionAvancement =
  | "ia_desactivee"
  | "non_autorisee"
  | "indisponible"
  | "sortie_rejetee"
  | "echec"
  | "sans_utilisateur";

/** Réponse de la suggestion : le rapport et l'issue de la demande à l'IA. */
export type ReponseSuggestionAvancement = RapportAvancement & {
  suggestion: { obtenue: boolean; raison: RaisonSuggestionAvancement | null };
};

/** `GET /api/avancement/parametres`. */
export interface ParametresAvancement {
  actif: boolean;
  /** Toujours `false` : aucun envoi automatique au client n'existe. */
  envoi_email: false;
  modifie_le: string | null;
}

// --- Contrats de l'API (portail) ------------------------------------------------------------

export interface LignePortailAvancement {
  id: string;
  mission_id: string;
  mission_intitule: string;
  semaine: string;
  semaine_fin: string;
  avancement_pourcentage: number | null;
  valide_le: string;
}

export interface RapportPortailAvancement {
  id: string;
  mission_id: string;
  mission_intitule: string;
  semaine: string;
  semaine_fin: string;
  introduction: string | null;
  commentaire: string | null;
  valide_le: string;
  /** Projection portail : aucun décompte de livrables non partagés. */
  contenu: ContenuAvancementPortail;
}

// --- Chemins --------------------------------------------------------------------------------

export const CHEMIN_API_AVANCEMENT = "/api/avancement";
export const CHEMIN_API_PARAMETRES_AVANCEMENT = "/api/avancement/parametres";
export const CHEMIN_AVANCEMENT_PORTAIL = `${CHEMIN_PORTAIL}/avancement`;
export const API_AVANCEMENT_PORTAIL = "/api/portail/avancement";

export const cheminApiListeAvancement = (missionId: string, avant?: string | null): string => {
  const q = new URLSearchParams({ limite: "26" });
  if (avant) q.set("avant", avant);
  return `/api/missions/${missionId}/avancement?${q.toString()}`;
};
export const cheminApiGenerationAvancement = (missionId: string) =>
  `/api/missions/${missionId}/avancement`;
export const cheminApiRapportAvancement = (id: string) => `${CHEMIN_API_AVANCEMENT}/${id}`;
export const cheminApiPortailRapport = (id: string) => `${API_AVANCEMENT_PORTAIL}/${id}`;

export const hrefAvancementMission = (missionId: string, avant?: string | null): string =>
  avant
    ? `/missions/${missionId}/avancement?${new URLSearchParams({ avant }).toString()}`
    : `/missions/${missionId}/avancement`;
export const hrefRapportAvancement = (missionId: string, id: string) =>
  `/missions/${missionId}/avancement/${id}`;
export const hrefRapportPortail = (id: string) => `${CHEMIN_AVANCEMENT_PORTAIL}/${id}`;

/** Paramètre `?avant=` : une date valide, sinon rien (début de la liste). */
export function lireAvant(v: string | string[] | undefined): string | null {
  const brut = Array.isArray(v) ? v[0] : v;
  return estDateIso(brut) ? brut : null;
}

// --- Libellés -------------------------------------------------------------------------------

export const MENTION_VISIBILITE_CLIENT =
  "Le client ne voit ce rapport qu'une fois validé. Aucun e-mail n'est envoyé au client.";
export const LIBELLE_BROUILLON_IA = "Brouillon IA à relire";
export const MENTION_BROUILLON_IA =
  "Le commentaire ci-dessous a été proposé par l'IA. Relisez-le, corrigez-le ou effacez-le : un rapport ne peut pas être validé tant que ce brouillon n'a pas été relu.";
export const MENTION_CHIFFRES_MOTEUR =
  "Ces chiffres sont calculés par MissionPilot à partir des données de la mission. Ils ne se modifient pas ici ; « Régénérer les chiffres » les recalcule à la date du jour.";
export const LIBELLE_ENVOI_EMAIL = "Envoyer par e-mail au client";
export const AIDE_ENVOI_EMAIL = "Non disponible : aucun envoi automatique au client";

export const aucunRapportCabinet = {
  titre: "Aucun rapport d'avancement pour cette mission.",
  aide: "Préparez le rapport de cette semaine : les chiffres sont calculés, vous complétez ensuite l'introduction et le commentaire avant de valider.",
};
export const aucunRapportPortail = {
  titre: "Aucun rapport d'avancement pour le moment.",
  aide: "Votre cabinet publie ici un point hebdomadaire sur l'avancement de vos missions, dès qu'il l'a relu et validé. Il apparaîtra sur cette page.",
};

/** « Semaine du 5 au 11 octobre 2026 ». */
export const libelleSemaineRapport = (r: { semaine: string; semaine_fin: string }): string =>
  libelleSemaine(r.semaine, r.semaine_fin);

/** Pourcentage d'avancement fourni par le moteur : « 62 % », ou « Non calculé ». */
export function formaterAvancement(pourcentage: number | null | undefined): string {
  if (typeof pourcentage !== "number" || !Number.isFinite(pourcentage)) return "Non calculé";
  return `${formaterNombre(pourcentage, 0)}${NBSP}%`;
}

/** « 3 éléments » / « 1 élément » / « Aucun élément ». */
export function libelleElements(n: number): string {
  if (n <= 0) return "Aucun élément";
  return `${formaterNombre(n, 0)} élément${n > 1 ? "s" : ""}`;
}

/** Espace insécable (jamais de coupure avant l'unité). */
const NBSP = " ";

type Libelle = { libelle: string; tonalite: TonaliteStatut };

export function etatRapport(statut: StatutAvancementRapport): Libelle {
  return statut === "valide"
    ? { libelle: "Validé", tonalite: "succes" }
    : { libelle: "Brouillon", tonalite: "attention" };
}

export function etatCommentaire(statut: StatutCommentaireAvancement): Libelle | null {
  if (statut === "brouillon_ia") return { libelle: LIBELLE_BROUILLON_IA, tonalite: "attention" };
  if (statut === "redige") return { libelle: "Commentaire rédigé", tonalite: "neutre" };
  return null;
}

export const STATUT_KPI_AVANCEMENT: Record<
  ContenuAvancement["kpis"]["elements"][number]["statut"],
  Libelle
> = {
  vert: { libelle: "Dans la cible", tonalite: "succes" },
  orange: { libelle: "À surveiller", tonalite: "attention" },
  rouge: { libelle: "Hors cible", tonalite: "danger" },
  non_evalue: { libelle: "Non évalué", tonalite: "neutre" },
};

export const LIBELLES_FAIT_SAILLANT: Record<
  ContenuAvancement["faits_saillants"][number]["code"],
  string
> = {
  avancement: "Avancement",
  jalons_atteints: "Jalons atteints",
  jalons_en_retard: "Jalons en retard",
  jalons_a_venir: "Jalons à venir",
  kpis: "Indicateurs",
  livrables: "Livrables",
};

/** Valeur de KPI avec son unité, « — » si absente. */
export function formaterValeurKpi(valeur: number | null, unite: string): string {
  if (valeur === null) return "—";
  const n = formaterNombre(valeur, 2);
  return unite.trim() === "" ? n : `${n}${NBSP}${unite.trim()}`;
}

export function resumeKpis(k: ContenuAvancement["kpis"]): string {
  if (k.total === 0) return "Aucun indicateur suivi";
  return `${k.vert} dans la cible, ${k.orange} à surveiller, ${k.rouge} hors cible, ${k.non_evalue} non évalué${k.non_evalue > 1 ? "s" : ""}`;
}

export function resumeLivrables(l: ContenuAvancement["livrables"]): string {
  if (l.total === 0) return "Aucun livrable";
  return `${l.partages} partagé${l.partages > 1 ? "s" : ""} avec le client sur ${l.total}`;
}

// --- Règles d'édition -----------------------------------------------------------------------

/** Le rapport (validé) est-il figé ? */
export const estFige = (r: Pick<RapportAvancement, "statut">): boolean => r.statut === "valide";

/** Raison pour laquelle on ne peut pas valider, ou `null` si c'est permis (l'API reste juge). */
export function raisonValidationImpossible(
  r: Pick<RapportAvancement, "statut" | "peut_valider" | "statut_commentaire">,
  modifie: boolean,
): string | null {
  if (r.statut === "valide") return "Ce rapport est déjà validé.";
  if (!r.peut_valider) {
    return "Seuls un associé, le directeur ou le chef de la mission peuvent valider, et la mission ne doit pas être clôturée.";
  }
  if (modifie) return "Enregistrez vos modifications avant de valider.";
  if (r.statut_commentaire === "brouillon_ia") {
    return "Relisez le commentaire proposé par l'IA (réécrivez-le ou effacez-le) avant de valider.";
  }
  return null;
}

/**
 * Texte proposé dans la zone « Commentaire » : le texte du chef, sinon la suggestion de l'IA tant
 * qu'elle est à relire (elle ne devient commentaire qu'à l'enregistrement du chef).
 */
export function commentaireInitial(
  r: Pick<RapportAvancement, "commentaire" | "commentaire_ia" | "statut_commentaire">,
): string {
  if (r.commentaire) return r.commentaire;
  return r.statut_commentaire === "brouillon_ia" ? (r.commentaire_ia ?? "") : "";
}

export interface ChampsEdition {
  introduction: string;
  commentaire: string;
}

/** Valeurs de départ des deux champs modifiables. */
export function champsInitiaux(r: RapportAvancement): ChampsEdition {
  return { introduction: r.introduction ?? "", commentaire: commentaireInitial(r) };
}

/**
 * Corps du PATCH : seulement les champs modifiés (texte vide = effacé, l'API le lit comme `null`).
 * `forcerCommentaire` : confirmer la relecture d'une suggestion IA sans la changer.
 * `null` si rien à envoyer.
 */
export function corpsModification(
  depart: ChampsEdition,
  actuel: ChampsEdition,
  version: number,
  forcerCommentaire = false,
): { version: number; introduction?: string; commentaire?: string } | null {
  const corps: { version: number; introduction?: string; commentaire?: string } = { version };
  if (actuel.introduction !== depart.introduction) corps.introduction = actuel.introduction;
  if (forcerCommentaire || actuel.commentaire !== depart.commentaire) {
    corps.commentaire = actuel.commentaire;
  }
  return corps.introduction === undefined && corps.commentaire === undefined ? null : corps;
}

export const modifie = (depart: ChampsEdition, actuel: ChampsEdition): boolean =>
  actuel.introduction !== depart.introduction || actuel.commentaire !== depart.commentaire;

/** Erreur de longueur d'un champ, ou `undefined`. */
export function erreurLongueur(valeur: string, max: number, nom: string): string | undefined {
  const n = valeur.trim().length;
  return n > max
    ? `${nom} : ${formaterNombre(n, 0)} caractères pour ${formaterNombre(max, 0)} au plus.`
    : undefined;
}

// --- Erreurs --------------------------------------------------------------------------------

export const CODE_VERSION_CONFLIT = "VERSION_CONFLIT";

export const MESSAGES_AVANCEMENT: Record<string, string> = {
  VERSION_CONFLIT:
    "Ce rapport a été modifié par quelqu'un d'autre depuis son ouverture. Rechargez la dernière version avant de continuer.",
  RAPPORT_VALIDE: "Ce rapport est validé : il est figé et ne peut plus être modifié.",
  MISSION_NON_ACTIVE:
    "La mission n'est ni signée ni en cours : aucun rapport ne peut être préparé.",
  FONCTION_DESACTIVEE:
    "Les rapports d'avancement sont désactivés pour votre cabinet. Un gestionnaire peut les réactiver dans les paramètres.",
  COMMENTAIRE_DEJA_REDIGE:
    "Un commentaire est déjà rédigé : effacez-le avant de demander une suggestion à l'IA.",
  COMMENTAIRE_IA_A_RELIRE:
    "Le commentaire proposé par l'IA doit être relu (réécrit ou effacé) avant la validation.",
};

export const LIBELLES_RAISON_SUGGESTION: Record<RaisonSuggestionAvancement, string> = {
  ia_desactivee: "L'IA n'est pas activée pour votre cabinet.",
  non_autorisee: "Votre rôle n'autorise pas l'usage de l'IA.",
  indisponible: "L'IA est indisponible pour le moment (clé absente ou plafond atteint).",
  sortie_rejetee:
    "L'IA n'a pas produit de texte exploitable (nombre ou format non conforme) : rien n'a été enregistré.",
  echec: "L'IA n'a pas répondu : rien n'a été enregistré.",
  sans_utilisateur: "Aucun utilisateur n'est rattaché à cette mission.",
};

export const estConflitVersion = (e: unknown): boolean =>
  e instanceof ErreurApi && e.code === CODE_VERSION_CONFLIT;

/** Message affichable (français) pour une erreur d'appel. */
export function messageAvancement(e: unknown): string {
  if (e instanceof ErreurApi) {
    const connu = MESSAGES_AVANCEMENT[e.code];
    if (connu) return connu;
  }
  return messageErreur(e);
}
