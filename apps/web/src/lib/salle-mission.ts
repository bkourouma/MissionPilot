/**
 * Salle de mission côté cabinet (CLI-01) : types des réponses de l'API, libellés, chemins et
 * règles d'affichage. Logique pure, testée dans `salle-mission.test.ts` ; les droits affichés
 * ne sont qu'un confort : l'API fait foi (`salle.lire`, `salle.gerer`, mission visible).
 */
import {
  aPermission,
  SALLE_PIECES_PAR_DEMANDE_MAX,
  type PalierRelanceSalle,
  type Role,
  type StatutDemandeSalle,
  type StatutPieceSalle,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";

export interface SynthesePieces {
  total: number;
  demandee: number;
  recue: number;
  acceptee: number;
  rejetee: number;
  obligatoires_restantes: number;
}

export interface DemandeResume {
  id: string;
  mission_id: string;
  titre: string;
  statut: StatutDemandeSalle;
  echeance: string | null;
  relances_auto: boolean;
  modele_id: string | null;
  cree_le: string;
  envoyee_le: string | null;
  close_le: string | null;
  synthese: SynthesePieces;
}

export interface Destinataire {
  id: string;
  nom: string;
}

export interface SalleMission {
  mission_id: string;
  client_id: string;
  mission_cloturee: boolean;
  /** Méthode courante de la mission (et son parent du standard), pour suggérer un modèle. */
  methodes: string[];
  destinataires: Destinataire[];
  demandes: DemandeResume[];
}

export interface DepotSalle {
  id: string;
  origine: "portail" | "cabinet";
  depose_par: { id: string; nom: string | null };
  depose_le: string;
  fichier: { id: string; nom: string; type_mime: string; taille: number } | null;
  accuse: { statut: "envoye" | "suspendu"; le: string } | null;
  document_id: string | null;
}

export interface EvenementPiece {
  rang: number;
  statut: Exclude<StatutPieceSalle, "demandee">;
  motif: string | null;
  depot_id: string | null;
  par_nom: string | null;
  le: string;
}

export interface PieceSalle {
  id: string;
  libelle: string;
  description: string | null;
  obligatoire: boolean;
  ordre: number;
  statut: StatutPieceSalle;
  statut_le: string | null;
  motif_rejet: string | null;
  depots: DepotSalle[];
  historique: EvenementPiece[];
}

export interface RelanceSalle {
  palier: PalierRelanceSalle;
  echeance: string;
  cree_le: string;
  destinataire_nom: string | null;
  relance_par_nom: string | null;
}

export interface DemandeDetail extends Omit<DemandeResume, "synthese"> {
  message: string | null;
  client_id: string;
  synthese: SynthesePieces;
  destinataires: Destinataire[];
  pieces: PieceSalle[];
  relances: RelanceSalle[];
}

export interface ModeleSalle {
  id: string;
  nom: string;
  description: string | null;
  methode_id: string | null;
  pieces: { libelle: string; description: string | null; obligatoire: boolean }[];
  actif: boolean;
}

type Libelle = { libelle: string; tonalite: TonaliteStatut };

export const STATUT_DEMANDE: Record<StatutDemandeSalle, Libelle> = {
  brouillon: { libelle: "Brouillon", tonalite: "neutre" },
  envoyee: { libelle: "Envoyée au client", tonalite: "attention" },
  close: { libelle: "Close", tonalite: "succes" },
};

export const STATUT_PIECE: Record<StatutPieceSalle, Libelle> = {
  demandee: { libelle: "Demandée", tonalite: "neutre" },
  recue: { libelle: "Reçue, à examiner", tonalite: "attention" },
  acceptee: { libelle: "Acceptée", tonalite: "succes" },
  rejetee: { libelle: "Rejetée", tonalite: "danger" },
};

export const PALIER_RELANCE: Record<PalierRelanceSalle, string> = {
  rappel_j_moins_3: "Rappel trois jours avant l'échéance",
  relance_j_plus_1: "Relance au lendemain de l'échéance",
  relance_j_plus_7: "Relance ferme sept jours après l'échéance",
  manuelle: "Relance manuelle",
};

// --- Chemins -------------------------------------------------------------------------------

export const cheminSalle = (missionId: string) =>
  `/api/missions/${encodeURIComponent(missionId)}/salle`;
export const cheminDemande = (missionId: string, demandeId: string) =>
  `${cheminSalle(missionId)}/demandes/${encodeURIComponent(demandeId)}`;
export const cheminPiece = (missionId: string, pieceId: string) =>
  `${cheminSalle(missionId)}/pieces/${encodeURIComponent(pieceId)}`;
export const cheminDepot = (missionId: string, depotId: string) =>
  `${cheminSalle(missionId)}/depots/${encodeURIComponent(depotId)}`;
export const hrefFichierDepot = (missionId: string, depotId: string, enLigne = false) =>
  `${cheminDepot(missionId, depotId)}/fichier?affichage=${enLigne ? "inline" : "attachment"}`;
export const hrefSalle = (missionId: string) => `/missions/${encodeURIComponent(missionId)}/salle`;
export const hrefDemande = (missionId: string, demandeId: string) =>
  `${hrefSalle(missionId)}/${encodeURIComponent(demandeId)}`;

export function cheminModeles(methodeId?: string): string {
  return methodeId
    ? `/api/salle/modeles?methode_id=${encodeURIComponent(methodeId)}`
    : "/api/salle/modeles";
}

// --- Droits (confort d'affichage) -----------------------------------------------------------

export const peutLireSalle = (roles: readonly Role[]) => aPermission(roles, "salle.lire");
export const peutGererSalle = (roles: readonly Role[]) => aPermission(roles, "salle.gerer");

/** Actions possibles sur une demande selon son statut, la mission et les droits. */
export function actionsDemande(
  d: Pick<DemandeDetail, "statut">,
  contexte: { gerer: boolean; missionCloturee: boolean },
) {
  const ouvert = contexte.gerer && !contexte.missionCloturee;
  return {
    modifier: ouvert && d.statut === "brouillon",
    envoyer: ouvert && d.statut === "brouillon",
    supprimer: ouvert && d.statut === "brouillon",
    ajouterPiece: ouvert && d.statut !== "close",
    prolonger: ouvert && d.statut === "envoyee",
    relancer: ouvert && d.statut === "envoyee",
    clore: ouvert && d.statut === "envoyee",
  };
}

/** Une pièce reçue s'examine (accepter ou rejeter) tant que la mission est ouverte. */
export function peutDecider(
  p: Pick<PieceSalle, "statut">,
  contexte: { gerer: boolean; missionCloturee: boolean },
): boolean {
  return contexte.gerer && !contexte.missionCloturee && p.statut === "recue";
}

/** Un dépôt de pièce acceptée, non encore versé, peut rejoindre le dossier de mission. */
export function peutVerser(p: Pick<PieceSalle, "statut">, depot: DepotSalle): boolean {
  return p.statut === "acceptee" && depot.document_id === null && depot.fichier !== null;
}

/** Dépôt par l'équipe (pièce reçue hors portail) : demande envoyée, pièce non acceptée. */
export function peutDeposerPourLeClient(
  d: Pick<DemandeDetail, "statut">,
  p: Pick<PieceSalle, "statut">,
  contexte: { gerer: boolean; missionCloturee: boolean },
): boolean {
  return (
    contexte.gerer && !contexte.missionCloturee && d.statut === "envoyee" && p.statut !== "acceptee"
  );
}

/** Contexte d'affichage d'une demande pour l'utilisateur courant (confort : l'API fait foi). */
export interface ContexteSalle {
  gerer: boolean;
  missionCloturee: boolean;
  documents: boolean;
  /** Utilisateur courant : sert à repérer le dépôt qu'il a lui-même fait (MPL09). */
  utilisateurId: string;
  /** Un associé peut accepter le dépôt qu'il a fait (séparation des tâches). */
  associe: boolean;
}

/**
 * Dépôt que l'acceptation de la pièce retiendrait : le plus récent dont le fichier n'est pas
 * retiré (même règle que l'API, `dernierDepot`).
 */
export function dernierDepotRetenable(p: Pick<PieceSalle, "depots">): DepotSalle | null {
  let dernier: DepotSalle | null = null;
  for (const d of p.depots) {
    if (d.fichier === null) continue;
    if (
      !dernier ||
      d.depose_le > dernier.depose_le ||
      (d.depose_le === dernier.depose_le && d.id > dernier.id)
    ) {
      dernier = d;
    }
  }
  return dernier;
}

/**
 * Séparation des tâches (MPL09) : qui a déposé le fichier retenu ne l'accepte pas, sauf un
 * associé. Vrai : le bouton « Accepter » est remplacé par une explication (sinon le refus de
 * l'API ne surviendrait qu'après un clic).
 */
export function acceptationParDeposant(
  p: Pick<PieceSalle, "depots">,
  contexte: Pick<ContexteSalle, "utilisateurId" | "associe">,
): boolean {
  if (contexte.associe) return false;
  return dernierDepotRetenable(p)?.depose_par.id === contexte.utilisateurId;
}

/** Texte affiché à la place du bouton « Accepter » (voir `acceptationParDeposant`). */
export const MESSAGE_ACCEPTATION_PAR_DEPOSANT =
  "Vous avez déposé ce fichier : un autre membre de l'équipe (ou un associé) doit l'accepter. Vous pouvez le rejeter.";

/**
 * Un dépôt non retenu (ni accepté, ni versé au dossier) dont le fichier est encore là peut être
 * retiré par l'équipe ; sinon l'API refuse (409).
 */
export function peutRetirerDepot(
  p: Pick<PieceSalle, "historique">,
  depot: DepotSalle,
  contexte: Pick<ContexteSalle, "gerer" | "missionCloturee">,
): boolean {
  if (!contexte.gerer || contexte.missionCloturee) return false;
  if (depot.fichier === null || depot.document_id !== null) return false;
  return !p.historique.some((h) => h.statut === "acceptee" && h.depot_id === depot.id);
}

// --- Échéance ---------------------------------------------------------------------------------

/** Bornes des dates métier (`dateIsoBorneeSchema`, CHECK SQL). */
export const ECHEANCE_MIN = "2000-01-01";
export const ECHEANCE_MAX = "2100-12-31";
export const MESSAGE_ECHEANCE_BORNEE = "Date comprise entre 2000 et 2100 attendue.";

/** Contrôle local d'une échéance saisie (`""` : pas d'échéance) ; message ou `null`. */
export function erreurEcheance(echeance: string, aujourdhui: string): string | null {
  if (echeance === "") return null;
  if (echeance < ECHEANCE_MIN || echeance > ECHEANCE_MAX) return MESSAGE_ECHEANCE_BORNEE;
  if (echeance < aujourdhui) return "L'échéance doit être aujourd'hui ou plus tard.";
  return null;
}

/**
 * Message du schéma partagé pour le champ « échéance » quand l'API refuse la requête (400
 * REQUETE_INVALIDE, `details.fieldErrors.echeance`), sinon `null`. Les messages du schéma sont
 * en français.
 */
export function erreurEcheanceApi(e: unknown): string | null {
  if (!(e instanceof ErreurApi) || e.code !== "REQUETE_INVALIDE") return null;
  const details = e.details as { fieldErrors?: Record<string, unknown> } | undefined;
  const champ = details?.fieldErrors?.echeance;
  if (!Array.isArray(champ)) return null;
  const premier = champ.find((m): m is string => typeof m === "string" && m.trim() !== "");
  return premier ?? "Échéance invalide : saisissez une date valide.";
}

// --- Textes -----------------------------------------------------------------------------------

/** « 3 sur 7 pièces acceptées » (ou « Aucune pièce »). */
export function avancement(s: SynthesePieces): string {
  if (s.total === 0) return "Aucune pièce";
  return `${s.acceptee} sur ${s.total} pièce${s.total > 1 ? "s" : ""} acceptée${s.acceptee > 1 ? "s" : ""}`;
}

/** Détail court : « 2 à examiner · 1 rejetée · 4 attendues ». */
export function detailAvancement(s: SynthesePieces): string {
  const morceaux = [
    s.recue > 0 ? `${s.recue} à examiner` : null,
    s.rejetee > 0 ? `${s.rejetee} rejetée${s.rejetee > 1 ? "s" : ""}` : null,
    s.demandee > 0 ? `${s.demandee} attendue${s.demandee > 1 ? "s" : ""}` : null,
  ].filter((x): x is string => x !== null);
  return morceaux.join(" · ");
}

/** Échéance dépassée (jour UTC) pour une demande encore envoyée. */
export function echeanceDepassee(
  d: Pick<DemandeResume, "statut" | "echeance">,
  aujourdhui: string,
): boolean {
  return d.statut === "envoyee" && d.echeance !== null && d.echeance < aujourdhui;
}

// --- Saisie d'une nouvelle demande ------------------------------------------------------------

export interface SaisiePiece {
  libelle: string;
  description: string;
  obligatoire: boolean;
}

export interface SaisieDemande {
  titre: string;
  message: string;
  echeance: string;
  modeleId: string;
  pieces: SaisiePiece[];
}

export const SAISIE_DEMANDE_VIDE: SaisieDemande = {
  titre: "",
  message: "",
  echeance: "",
  modeleId: "",
  pieces: [],
};

export type ErreursDemande = Partial<Record<"titre" | "echeance" | "pieces", string>>;

/** Contrôles locaux avant l'appel (l'API revalide tout). */
export function validerDemande(s: SaisieDemande, aujourdhui: string): ErreursDemande {
  const erreurs: ErreursDemande = {};
  if (s.titre.trim() === "") erreurs.titre = "Donnez un titre à la demande.";
  else if (s.titre.trim().length > 200) erreurs.titre = "200 caractères au plus.";
  const echeance = erreurEcheance(s.echeance, aujourdhui);
  if (echeance) erreurs.echeance = echeance;
  const pieces = s.pieces.filter((p) => p.libelle.trim() !== "");
  if (s.modeleId === "" && pieces.length === 0) {
    erreurs.pieces = "Choisissez un modèle ou ajoutez au moins une pièce.";
  } else if (pieces.length > SALLE_PIECES_PAR_DEMANDE_MAX) {
    erreurs.pieces = `${SALLE_PIECES_PAR_DEMANDE_MAX} pièces au plus.`;
  }
  return erreurs;
}

/** Corps de `POST /missions/:id/salle/demandes` (pièces vides ignorées). */
export function corpsDemande(s: SaisieDemande) {
  const pieces = s.pieces
    .filter((p) => p.libelle.trim() !== "")
    .map((p) => ({
      libelle: p.libelle.trim(),
      description: p.description.trim() === "" ? null : p.description.trim(),
      obligatoire: p.obligatoire,
    }));
  return {
    titre: s.titre.trim(),
    ...(s.message.trim() !== "" ? { message: s.message.trim() } : {}),
    ...(s.echeance !== "" ? { echeance: s.echeance } : {}),
    ...(s.modeleId !== "" ? { modele_id: s.modeleId } : {}),
    ...(pieces.length > 0 ? { pieces } : {}),
  };
}

/** Modèles proposés : ceux de la méthode de la mission d'abord, puis les autres. */
export function modelesTries(
  modeles: readonly ModeleSalle[],
  methodes: readonly string[],
): { suggeres: ModeleSalle[]; autres: ModeleSalle[] } {
  const actifs = modeles.filter((m) => m.actif);
  const suggere = (m: ModeleSalle) => m.methode_id !== null && methodes.includes(m.methode_id);
  return { suggeres: actifs.filter(suggere), autres: actifs.filter((m) => !suggere(m)) };
}

/** Message d'erreur propre à la salle (codes de l'API), sinon `null` (message générique). */
export function messageSalle(code: string | undefined): string | null {
  switch (code) {
    case "SALLE_SANS_DESTINATAIRE":
      return "Aucun dirigeant ni contributeur du client n'est actif sur le portail : invitez-en un depuis la fiche du client, puis envoyez.";
    case "DEMANDE_FIGEE":
      return "Cette demande a changé d'état (envoyée ou close) : rechargez la page.";
    case "TRANSITION_REFUSEE":
      return "Cette pièce a changé d'état entre-temps : rechargez la page.";
    case "CONTENU_IDENTIQUE":
      return "Ce fichier est identique à la version déjà présente : aucune nouvelle version n'a été créée.";
    default:
      return null;
  }
}
