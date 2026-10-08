import { z } from "zod";
import {
  auMoinsUnChamp,
  dateIsoBorneeSchema,
  MESSAGE_CORPS_VIDE,
  texte,
  texteOptionnel,
} from "./commun";

/*
 * Salle de mission (CLI-01, PRD complémentaire §13) : contrat des routes
 * /api/missions/:id/salle/**, /api/salle/modeles/** (cabinet) et /api/portail/salle/** (client).
 *
 * Une demande documentaire porte des pièces attendues et une échéance ; chaque pièce suit
 * demandée → reçue → acceptée, ou rejetée avec motif (puis reçue de nouveau). Le fichier d'une
 * pièce se dépose en multipart (champ « fichier », comme tout téléversement) : aucun schéma de
 * corps pour le dépôt.
 */

const uuid = z.string().uuid();

/** Plafonds (déni de service : une demande se charge entière). */
export const SALLE_PIECES_PAR_DEMANDE_MAX = 100;
export const SALLE_DEMANDES_PAR_MISSION_MAX = 200;
export const SALLE_MODELES_MAX = 500;
/**
 * Plafonds des dépôts (déni de service : un client ne remplit pas le stockage du cabinet).
 * Doublés par `controler_salle_depot` (migration 0332, mêmes valeurs en littéraux) :
 * - dépôts non rejetés (et non retirés) par pièce, tous déposants confondus ;
 * - octets déposés par demande (dépôts non retirés) ;
 * - dépôts d'un même utilisateur du portail sur la fenêtre glissante.
 */
export const SALLE_DEPOTS_PAR_PIECE_MAX = 20;
export const SALLE_OCTETS_PAR_DEMANDE_MAX = 500 * 1024 * 1024;
export const SALLE_DEPOTS_PORTAIL_PAR_FENETRE_MAX = 30;
export const SALLE_FENETRE_DEPOTS_PORTAIL_MINUTES = 10;
/**
 * Taille JSON maximale des pièces d'un modèle (CHECK de 0330 : 300 000 octets de `jsonb::text`,
 * un peu plus que le JSON compact ; marge pour les espaces et le multi-octets du texte).
 */
export const SALLE_MODELE_PIECES_OCTETS_MAX = 200_000;

export const STATUTS_DEMANDE_SALLE = ["brouillon", "envoyee", "close"] as const;
export type StatutDemandeSalle = (typeof STATUTS_DEMANDE_SALLE)[number];

export const STATUTS_PIECE_SALLE = ["demandee", "recue", "acceptee", "rejetee"] as const;
export type StatutPieceSalle = (typeof STATUTS_PIECE_SALLE)[number];

export const ORIGINES_DEPOT_SALLE = ["portail", "cabinet"] as const;
export type OrigineDepotSalle = (typeof ORIGINES_DEPOT_SALLE)[number];

/** Paliers de relance : automatiques (avant puis après l'échéance) ou manuelle. */
export const PALIERS_RELANCE_SALLE = [
  "rappel_j_moins_3",
  "relance_j_plus_1",
  "relance_j_plus_7",
  "manuelle",
] as const;
export type PalierRelanceSalle = (typeof PALIERS_RELANCE_SALLE)[number];

/** Pièce attendue (modèle ou demande). */
export const sallePieceSchema = z
  .object({
    libelle: texte(200),
    description: texteOptionnel(2000),
    obligatoire: z.boolean().optional(),
  })
  .strict();
export type SaisiePieceSalle = z.infer<typeof sallePieceSchema>;

export const sallePieceModificationSchema = z
  .object({
    libelle: texte(200).optional(),
    description: texteOptionnel(2000),
    obligatoire: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

const listePieces = (minimum: number) =>
  z
    .array(sallePieceSchema)
    .min(minimum)
    .max(SALLE_PIECES_PAR_DEMANDE_MAX)
    .refine(
      (l) => new TextEncoder().encode(JSON.stringify(l)).length <= SALLE_MODELE_PIECES_OCTETS_MAX,
      { message: "Les pièces sont trop volumineuses : raccourcir les libellés et descriptions." },
    );

/** Modèle de demande du cabinet, rattaché ou non à une méthode (standard ou du cabinet). */
export const salleModeleCreationSchema = z
  .object({
    nom: texte(200),
    description: texteOptionnel(2000),
    methode_id: uuid.nullable().optional(),
    pieces: listePieces(1),
  })
  .strict();

export const salleModeleModificationSchema = z
  .object({
    nom: texte(200).optional(),
    description: texteOptionnel(2000),
    methode_id: uuid.nullable().optional(),
    pieces: listePieces(1).optional(),
    actif: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const salleModelesQuerySchema = z
  .object({
    methode_id: uuid.optional(),
    /** Inclure les modèles archivés (par défaut : actifs seulement). */
    archives: z.enum(["true", "false"]).optional(),
  })
  .strict();

/** Nouvelle demande (brouillon) : pièces d'un modèle, pièces saisies, ou les deux. */
export const salleDemandeCreationSchema = z
  .object({
    titre: texte(200),
    message: texteOptionnel(4000),
    echeance: dateIsoBorneeSchema.nullable().optional(),
    modele_id: uuid.optional(),
    pieces: listePieces(0).optional(),
  })
  .strict();

/** Brouillon : tout ; demande envoyée : échéance (prolongation) et relances automatiques. */
export const salleDemandeModificationSchema = z
  .object({
    titre: texte(200).optional(),
    message: texteOptionnel(4000),
    echeance: dateIsoBorneeSchema.optional(),
    relances_auto: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const salleRejetSchema = z.object({ motif: texte(1000) }).strict();

/** Acceptation d'une pièce reçue ; `rattacher` verse le dernier dépôt au dossier de mission. */
export const salleAcceptationSchema = z
  .object({
    rattacher: z.boolean().optional(),
    nom_document: texte(200).optional(),
  })
  .strict();

/** Versement d'un dépôt d'une pièce acceptée au dossier de mission (documents de mission). */
export const salleRattachementSchema = z.object({ nom_document: texte(200).optional() }).strict();

export const salleRelanceSchema = z.object({}).strict();

export const sallePieceParamsSchema = z.object({ id: uuid, pieceId: uuid }).strict();
export const salleDemandeParamsSchema = z.object({ id: uuid, demandeId: uuid }).strict();
export const salleDepotParamsSchema = z.object({ id: uuid, depotId: uuid }).strict();
