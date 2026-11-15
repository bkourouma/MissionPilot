/**
 * Salle de mission vue du portail client (CLI-01) : contrats de `/api/portail/salle/**`,
 * libellés pour le client, et file d'envoi des dépôts tolérante à la perte de réseau.
 * Logique pure, testée dans `salle-mission-portail.test.ts`.
 *
 * Hors connexion : un fichier choisi reste en mémoire (jamais dans le stockage du navigateur)
 * tant que la page est ouverte, puis part au retour du réseau. Un envoi interrompu après sa
 * réception par le serveur peut être renvoyé sans risque : l'API reconnaît le même fichier et
 * ne crée pas de second dépôt (réponse 200).
 */
import {
  creerTraduire,
  type Langue,
  type StatutDemandeSalle,
  type StatutPieceSalle,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { erreurReprenable, messageTeleversement } from "./fichiers";
import { formaterDate } from "./format";
import { CHEMIN_PORTAIL } from "./portail-routes";

// --- Contrats de l'API ---------------------------------------------------------------------

export interface SynthesePortail {
  total: number;
  demandee: number;
  recue: number;
  acceptee: number;
  rejetee: number;
  obligatoires_restantes: number;
}

export interface DemandePortailResume {
  id: string;
  titre: string;
  message: string | null;
  statut: Exclude<StatutDemandeSalle, "brouillon">;
  echeance: string;
  envoyee_le: string;
  close_le: string | null;
  synthese: SynthesePortail;
}

export interface DepotPortail {
  id: string;
  nom: string;
  type_mime: string;
  taille: number;
  depose_le: string;
  depose_par_moi: boolean;
  accuse_le: string | null;
}

export interface PiecePortail {
  id: string;
  libelle: string;
  description: string | null;
  obligatoire: boolean;
  statut: StatutPieceSalle;
  statut_le: string | null;
  motif_rejet: string | null;
  depots: DepotPortail[];
}

export interface DemandePortail extends DemandePortailResume {
  pieces: PiecePortail[];
}

/** Réponse d'un dépôt : la demande à jour, le dépôt, et s'il est nouveau (201) ou rejoué (200). */
export interface ReponseDepot extends DemandePortail {
  depot_id: string;
  nouveau: boolean;
}

// --- Chemins -------------------------------------------------------------------------------

export const CHEMIN_SALLE_PORTAIL = `${CHEMIN_PORTAIL}/salle`;
export const API_SALLE_PORTAIL = "/api/portail/salle/demandes";
export const hrefDemandePortail = (id: string) =>
  `${CHEMIN_SALLE_PORTAIL}/${encodeURIComponent(id)}`;
export const cheminApiDemandePortail = (id: string) =>
  `${API_SALLE_PORTAIL}/${encodeURIComponent(id)}`;
export const cheminApiDepot = (pieceId: string) =>
  `/api/portail/salle/pieces/${encodeURIComponent(pieceId)}/depots`;

// --- Libellés pour le client -----------------------------------------------------------------

type Libelle = { libelle: string; tonalite: TonaliteStatut };

export const STATUT_PIECE_PORTAIL: Record<StatutPieceSalle, Libelle> = {
  demandee: { libelle: "À fournir", tonalite: "attention" },
  recue: { libelle: "Reçue, en cours d'examen", tonalite: "neutre" },
  acceptee: { libelle: "Acceptée", tonalite: "succes" },
  rejetee: { libelle: "À fournir de nouveau", tonalite: "danger" },
};

const STATUT_PIECE_PORTAIL_EN: Record<StatutPieceSalle, string> = {
  demandee: "To provide",
  recue: "Received, under review",
  acceptee: "Accepted",
  rejetee: "To provide again",
};

export function statutPiece(statut: string, langue: Langue = "fr"): Libelle {
  const base = STATUT_PIECE_PORTAIL[statut as StatutPieceSalle] ?? {
    libelle: "—",
    tonalite: "neutre",
  };
  return langue === "en"
    ? { ...base, libelle: STATUT_PIECE_PORTAIL_EN[statut as StatutPieceSalle] ?? base.libelle }
    : base;
}

/** Le client peut-il déposer sur cette pièce ? (demande ouverte, pièce non acceptée) */
export function depotPossible(
  d: Pick<DemandePortailResume, "statut">,
  p: Pick<PiecePortail, "statut">,
): boolean {
  return d.statut === "envoyee" && p.statut !== "acceptee";
}

/** Pièces encore à fournir (à déposer ou à redéposer), dans l'ordre de la demande. */
export function piecesAFournir(d: Pick<DemandePortail, "pieces">): PiecePortail[] {
  return d.pieces.filter((p) => p.statut === "demandee" || p.statut === "rejetee");
}

/** « Avant le 12/03/2027 », « Échéance passée (12/03/2027) » ou « Demande close ». */
export function libelleEcheance(
  d: Pick<DemandePortailResume, "statut" | "echeance">,
  aujourdhui: string,
  langue: Langue = "fr",
): { texte: string; tonalite: TonaliteStatut } {
  const t = creerTraduire(langue);
  const date = formaterDate(d.echeance, "UTC", langue);
  if (d.statut === "close")
    return { texte: t("Demande close", "Request closed"), tonalite: "neutre" };
  if (d.echeance < aujourdhui) {
    return { texte: t(`Échéance passée (${date})`, `Past due (${date})`), tonalite: "danger" };
  }
  return { texte: t(`Avant le ${date}`, `Before ${date}`), tonalite: "neutre" };
}

/** « 2 pièces à fournir », « Tout est fourni ». */
export function resumePourClient(s: SynthesePortail, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  const aFournir = s.demandee + s.rejetee;
  if (aFournir === 0)
    return s.recue > 0
      ? t("Tout est fourni, en cours d'examen", "Everything provided, under review")
      : t("Tout est fourni", "Everything provided");
  return t(
    `${aFournir} pièce${aFournir > 1 ? "s" : ""} à fournir`,
    `${aFournir} file${aFournir > 1 ? "s" : ""} to provide`,
  );
}

// --- File d'envoi tolérante à la perte de réseau ---------------------------------------------

export type EtatEnvoi =
  | { etape: "inactif" }
  | { etape: "envoi"; progression: number }
  | { etape: "attente_reseau"; message: string }
  | { etape: "reussi"; rejoue: boolean }
  | { etape: "echec"; message: string };

export type EvenementEnvoi =
  | { type: "demarrer" }
  | { type: "progression"; fraction: number }
  | { type: "succes"; nouveau: boolean }
  | { type: "erreur"; erreur: unknown; enLigne: boolean }
  | { type: "hors_ligne" }
  | { type: "annuler" };

export const MESSAGE_ATTENTE_RESEAU =
  "Vous êtes hors connexion : le fichier est gardé sur cette page et partira automatiquement au retour du réseau. Ne fermez pas cette page d'ici là.";
const MESSAGE_ATTENTE_RESEAU_EN =
  "You are offline: the file is kept on this page and will be sent automatically when the network returns. Do not close this page until then.";

/** Transition de l'état d'envoi d'un dépôt (réducteur pur). */
export function etatSuivant(etat: EtatEnvoi, e: EvenementEnvoi, langue: Langue = "fr"): EtatEnvoi {
  const t = creerTraduire(langue);
  const attenteReseau = t(MESSAGE_ATTENTE_RESEAU, MESSAGE_ATTENTE_RESEAU_EN);
  switch (e.type) {
    case "demarrer":
      return { etape: "envoi", progression: 0 };
    case "progression":
      return etat.etape === "envoi"
        ? { etape: "envoi", progression: Math.max(0, Math.min(1, e.fraction)) }
        : etat;
    case "succes":
      return { etape: "reussi", rejoue: !e.nouveau };
    case "hors_ligne":
      return { etape: "attente_reseau", message: attenteReseau };
    case "erreur":
      // Réseau perdu ou serveur momentanément indisponible : on garde le fichier et on
      // réessaie au retour du réseau (le serveur ne crée jamais de doublon).
      if (erreurReprenable(e.erreur)) {
        return e.enLigne
          ? {
              etape: "attente_reseau",
              message: t(
                "L'envoi a été interrompu. Le fichier est gardé sur cette page : réessayez dans un instant.",
                "The upload was interrupted. The file is kept on this page: try again in a moment.",
              ),
            }
          : { etape: "attente_reseau", message: attenteReseau };
      }
      return { etape: "echec", message: messageDepot(e.erreur, langue) };
    case "annuler":
      return { etape: "inactif" };
  }
}

/** Faut-il relancer l'envoi automatiquement au retour du réseau ? */
export const relancerAuRetour = (etat: EtatEnvoi): boolean => etat.etape === "attente_reseau";

/** Message d'un refus de dépôt, en termes simples pour le client. */
export function messageDepot(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.statut === 404) {
      return t(
        "Cette pièce n'est plus disponible : rechargez la page.",
        "This item is no longer available: reload the page.",
      );
    }
    if (e.code === "CONTENU_IDENTIQUE") {
      return t(
        "Ce fichier est identique à celui déjà examiné : déposez une version corrigée.",
        "This file is identical to the one already reviewed: upload a corrected version.",
      );
    }
    if (e.code === "CONFLIT" || e.code === "DEPOT_REFUSE") {
      return t(
        `${e.message} Rechargez la page pour voir l'état à jour.`,
        `${e.message} Reload the page to see the current status.`,
      );
    }
    if (e.code === "FICHIERS_OCCUPE") {
      return t(
        "Le service reçoit beaucoup de fichiers en ce moment : réessayez dans quelques instants.",
        "The service is receiving a lot of files right now: try again in a few moments.",
      );
    }
  }
  return messageTeleversement(e, langue);
}
