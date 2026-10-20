import { z } from "zod";

/*
 * Portail investisseur de la due diligence (migration 0509) : contrat des routes du cabinet
 * `/api/dd/portail/**`, `/api/dd/dossiers/:id/portail/**`, `/api/dd/notes/:id/portail/**` et des
 * routes du portail `/api/portail/due-diligence/**`. Même schéma pour l'API et le web ; tous les
 * objets sont `.strict()`.
 *
 * Aucun corps ne porte un contenu de note : l'instantané publié (titre, recommandation, synthèse,
 * conditions, date de validation) est COPIÉ par le serveur depuis la version validée, jamais reçu
 * du client. Les types de réponse ci-dessous sont les projections exactes de l'API : côté portail,
 * aucun nom de membre du cabinet, aucun auteur, aucun coût (FIN-02).
 */

const uuid = z.string().uuid();

/** Plafonds (provisoires, DECISIONS.md) ; ceux marqués « base » sont doublés par MQD08. */
export const PLAFONDS_DD_PORTAIL = {
  /** Pièces (rapports) d'une publication (base). */
  pieces_par_publication: 10,
  /** Publications successives d'une note (base). */
  publications_par_note: 50,
  /** Événements d'invitation d'un dossier, invitations et retraits compris (base). */
  evenements_invitation_par_dossier: 500,
  /** Changements de l'option d'un cabinet. */
  changements_option: 1000,
  /** Comptes servis par la liste des comptes d'un dossier. */
  comptes_par_dossier: 200,
  /** Rapports proposés par note publiable (les plus récents). */
  rapports_par_note: 20,
  /** Publications servies par l'état du partage d'un dossier (les plus récentes). */
  publications_par_dossier: 100,
  /** Pagination de la liste du portail. */
  liste_limite_defaut: 20,
  liste_limite_max: 50,
} as const;

/* ----- Paramètres ----- */

export const ddPortailParamSchema = z.object({ id: uuid }).strict();

export const ddPortailInvitationParamSchema = z.object({ id: uuid, utilisateurId: uuid }).strict();

export const ddPortailPieceParamSchema = z.object({ id: uuid, pieceId: uuid }).strict();

export const ddPortailListeQuerySchema = z
  .object({
    limite: z.coerce
      .number()
      .int()
      .min(1)
      .max(PLAFONDS_DD_PORTAIL.liste_limite_max)
      .default(PLAFONDS_DD_PORTAIL.liste_limite_defaut),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/* ----- Corps ----- */

/** Activer ou désactiver l'option du cabinet (`dd.portail.configurer`). */
export const ddPortailOptionSchema = z.object({ actif: z.boolean() }).strict();

/** Inviter un compte du portail sur un dossier. */
export const ddPortailInvitationSchema = z.object({ utilisateur_id: uuid }).strict();

/**
 * Publier une version VALIDÉE (dernière soumise) d'une note, avec les rapports choisis (rapports
 * `note_comite` de cette version, 10 au plus, sans doublon).
 */
export const ddPortailPublicationSchema = z
  .object({
    version: z.number().int().min(1).max(200),
    rapports: z
      .array(uuid)
      .max(PLAFONDS_DD_PORTAIL.pieces_par_publication)
      .default([])
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Un rapport n'est choisi qu'une fois.",
      }),
  })
  .strict();

/* ----- Réponses : cabinet ----- */

export type RecommandationPubliee =
  "favorable" | "favorable_sous_conditions" | "reservee" | "defavorable";
export type VarianteRapportDd = "executive" | "detaillee";
export type FormatRapportDd = "pdf" | "docx";

/** GET et POST `/api/dd/portail/option`. `modifie_le` : null tant que l'option n'a jamais changé. */
export interface DdPortailOption {
  actif: boolean;
  modifie_le: string | null;
}

/**
 * Compte du portail d'un dossier : investisseur actif du client du dossier (`admissible`), ou
 * compte encore invité qui ne l'est plus (désactivé, rôle changé) et reste à retirer.
 */
export interface DdPortailCompte {
  utilisateur_id: string;
  nom: string;
  admissible: boolean;
  invite: boolean;
  invite_le: string | null;
}

export interface DdPortailPieceCabinet {
  id: string;
  rapport_id: string;
  variante: VarianteRapportDd;
  format: FormatRapportDd;
}

export interface DdPortailPublicationCabinet {
  id: string;
  note_id: string;
  version: number;
  titre: string;
  recommandation: RecommandationPubliee;
  valide_le: string;
  publie_le: string;
  retiree: boolean;
  retiree_le: string | null;
  /** Une version plus récente de la note a été soumise depuis la publication. */
  perimee: boolean;
  pieces: DdPortailPieceCabinet[];
}

export interface DdPortailRapportPubliable {
  id: string;
  variante: VarianteRapportDd;
  format: FormatRapportDd;
  genere_le: string;
}

/** Note dont la dernière version soumise est validée : publiable avec ses rapports. */
export interface DdPortailNotePubliable {
  note_id: string;
  titre: string;
  version: number;
  valide_le: string;
  /** Publication active de la note (à retirer avant d'en publier une autre), sinon null. */
  publication_active_id: string | null;
  rapports: DdPortailRapportPubliable[];
}

/** GET `/api/dd/dossiers/:id/portail`. */
export interface DdPortailEtatDossier {
  option_active: boolean;
  comptes: DdPortailCompte[];
  publications: DdPortailPublicationCabinet[];
  notes_publiables: DdPortailNotePubliable[];
}

/* ----- Réponses : portail ----- */

export interface DdPortailPublicationResume {
  id: string;
  titre: string;
  recommandation: RecommandationPubliee;
  version: number;
  valide_le: string;
  publie_le: string;
  nb_pieces: number;
}

export interface DdPortailPiece {
  id: string;
  variante: VarianteRapportDd;
  format: FormatRapportDd;
}

export interface DdPortailPublicationDetail {
  id: string;
  titre: string;
  recommandation: RecommandationPubliee;
  synthese: string;
  conditions: string[];
  version: number;
  valide_le: string;
  publie_le: string;
  pieces: DdPortailPiece[];
}

export interface PageDdPortail<T> {
  elements: T[];
  curseur_suivant: string | null;
}
