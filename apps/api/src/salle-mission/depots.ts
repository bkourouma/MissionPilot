import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  SALLE_DEPOTS_PAR_PIECE_MAX,
  SALLE_DEPOTS_PORTAIL_PAR_FENETRE_MAX,
  SALLE_FENETRE_DEPOTS_PORTAIL_MINUTES,
  SALLE_OCTETS_PAR_DEMANDE_MAX,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { introuvablePortail, journaliserPortail, type AccesPortail } from "../portail/acces.js";
import { enregistrerFichier, type TeleversementRecu } from "../stockage/fichiers.js";
import { verrouillerDemande, verrouillerPiece, type DemandeDb, type PieceDb } from "./donnees.js";
import { depotOuvert } from "./regles.js";

/*
 * Dépôt d'une pièce (CLI-01) : depuis le portail (le client) ou, pour une pièce reçue hors
 * portail, par un membre du cabinet. Mêmes garanties que tout fichier reçu (stockage/fichiers.ts :
 * type détecté par le contenu, quota du cabinet, métadonnées en ajout seul) ; la route lit le
 * corps AVANT de prendre une place dans le sémaphore de réception (`avecPlaceAnalyse`).
 *
 * Le fichier, le dépôt et l'événement « reçue » s'écrivent dans UNE transaction (rattachement
 * de `enregistrerFichier`), sous le verrou consultatif de la pièce (exclusif) et celui de la
 * demande (partagé : la clôture de la demande le prend en exclusif) ; la demande doit être
 * envoyée, la mission non clôturée et la pièce non acceptée (doublé en base, MPL03 et MPL06).
 * Dans une transaction du portail, la RLS (0330, 0331) ne laisse écrire que SON fichier, SON
 * dépôt et l'événement qu'il signe.
 *
 * Plafonds (déni de service, doublés par `controler_salle_depot`, 0332) : au plus
 * SALLE_DEPOTS_PAR_PIECE_MAX dépôts non rejetés et non retirés par pièce ;
 * SALLE_OCTETS_PAR_DEMANDE_MAX octets déposés par demande ; pour le portail,
 * SALLE_DEPOTS_PORTAIL_PAR_FENETRE_MAX dépôts d'un même utilisateur par fenêtre de
 * SALLE_FENETRE_DEPOTS_PORTAIL_MINUTES minutes (429). Le débit se compte sur `salle_depots` : le
 * journal d'audit est invisible d'une transaction du portail (politique `portail_interdit`).
 *
 * Rejeu (réseau perdu après l'envoi, nouvel essai du téléphone) : un fichier identique (même
 * empreinte SHA-256) déjà déposé sur une pièce encore « reçue » n'est pas redéposé : la réponse
 * renvoie le dépôt existant (200). Sur une pièce rejetée, le même fichier est refusé (409
 * CONTENU_IDENTIQUE) : une version corrigée est attendue.
 */

export type OrigineDepot = "portail" | "cabinet";

export interface PieceDeposable {
  id: string;
  demande_id: string;
  client_id: string;
  libelle: string;
  statut: PieceDb["statut"];
  demande_statut: DemandeDb["statut"];
  /** Statut de la mission ; null si la mission n'est pas visible (contexte du portail). */
  mission_statut: string | null;
}

const fermee = (p: Pick<PieceDeposable, "demande_statut">) =>
  conflit(
    p.demande_statut === "close"
      ? "Cette demande est close : elle n'accepte plus de dépôt."
      : "Cette pièce est déjà acceptée : aucun dépôt n'est attendu.",
  );

/** La pièce accepte-t-elle un dépôt ? (409 sinon) */
export function exigerDepotOuvert(p: PieceDeposable): void {
  if (!depotOuvert(p.demande_statut, p.statut)) throw fermee(p);
}

/**
 * Dépôt possible : mission non clôturée (409 côté cabinet ; même 404 neutre côté portail), puis
 * demande envoyée et pièce non acceptée. Dans le contexte du portail la mission est le plus
 * souvent invisible : la demande close à la clôture de la mission (`cloreDemandesDeMission`) et le
 * déclencheur de 0332 tiennent alors la règle.
 */
export function exigerDepotPossible(p: PieceDeposable, origine: OrigineDepot): void {
  if (p.mission_statut === "cloturee") {
    throw origine === "portail" ? introuvablePortail() : conflit("La mission est clôturée.");
  }
  exigerDepotOuvert(p);
}

/** Pièce (et sa demande) lue dans la transaction courante ; `clientId` restreint au client. */
export async function lirePieceDeposable(
  db: Db,
  pieceId: string,
  filtre: { clientId?: string; missionId?: string },
): Promise<PieceDeposable | undefined> {
  const r = await db.query(
    `SELECT p.id, p.demande_id, p.client_id, p.libelle, d.statut AS demande_statut,
       m.statut AS mission_statut, salle_statut_piece(p.id) AS statut
     FROM salle_pieces p JOIN salle_demandes d ON d.id = p.demande_id
     LEFT JOIN missions m ON m.id = p.mission_id
     WHERE p.id = $1 AND ($2::uuid IS NULL OR p.client_id = $2)
       AND ($3::uuid IS NULL OR p.mission_id = $3)`,
    [pieceId, filtre.clientId ?? null, filtre.missionId ?? null],
  );
  return r.rows[0] as PieceDeposable | undefined;
}

/**
 * Plafonds des dépôts. Sans `taille` (contrôle avant lecture du corps), seuls le nombre de dépôts
 * de la pièce et le débit sont vérifiés ; avec elle, le volume de la demande aussi.
 */
export async function verifierPlafondsDepots(
  db: Db,
  auth: Auth,
  piece: PieceDeposable,
  origine: OrigineDepot,
  taille?: number,
): Promise<void> {
  if (origine === "portail") {
    const debit = await db.query(
      `SELECT count(*)::int AS n FROM salle_depots
       WHERE depose_par = $1 AND origine = 'portail'
         AND depose_le > now() - make_interval(mins => $2)`,
      [auth.utilisateurId, SALLE_FENETRE_DEPOTS_PORTAIL_MINUTES],
    );
    if ((debit.rows[0].n as number) >= SALLE_DEPOTS_PORTAIL_PAR_FENETRE_MAX) {
      throw new AppError(
        429,
        "DEPOTS_TROP_RAPIDES",
        `Au plus ${SALLE_DEPOTS_PORTAIL_PAR_FENETRE_MAX} dépôts par ${SALLE_FENETRE_DEPOTS_PORTAIL_MINUTES} minutes : réessayez plus tard.`,
      );
    }
  }
  const pieceN = await db.query(
    `SELECT count(*)::int AS n FROM salle_depots x
     WHERE x.piece_id = $1
       AND NOT EXISTS (SELECT 1 FROM salle_piece_evenements e
                       WHERE e.depot_id = x.id AND e.statut = 'rejetee')
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = x.fichier_id)`,
    [piece.id],
  );
  if ((pieceN.rows[0].n as number) >= SALLE_DEPOTS_PAR_PIECE_MAX) {
    throw new AppError(
      409,
      "DEPOTS_PLAFOND",
      `Cette pièce compte déjà ${SALLE_DEPOTS_PAR_PIECE_MAX} dépôts : le cabinet doit en retirer ou la rejeter avant un nouveau dépôt.`,
    );
  }
  if (taille === undefined) return;
  const octets = await db.query(
    `SELECT coalesce(sum(f.taille), 0)::text AS n
     FROM salle_depots x JOIN fichiers f ON f.id = x.fichier_id
     WHERE x.demande_id = $1
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)`,
    [piece.demande_id],
  );
  if (Number(octets.rows[0].n) + taille > SALLE_OCTETS_PAR_DEMANDE_MAX) {
    throw new AppError(
      409,
      "DEPOTS_PLAFOND",
      `Le volume de dépôts de cette demande (${Math.floor(SALLE_OCTETS_PAR_DEMANDE_MAX / (1024 * 1024))} Mo) est atteint : contactez le cabinet.`,
    );
  }
}

interface DepotIdentique {
  id: string;
}

/** Dépôt du même contenu sur la pièce (tout déposant du client, hors retirés), ou undefined. */
async function depotIdentique(
  db: Db,
  piece: PieceDeposable,
  sha256: string,
): Promise<DepotIdentique | undefined> {
  const r = await db.query(
    `SELECT x.id FROM salle_depots x JOIN fichiers f ON f.id = x.fichier_id
     WHERE x.piece_id = $1 AND f.sha256 = $2
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
     ORDER BY x.depose_le DESC, x.id LIMIT 1`,
    [piece.id, sha256],
  );
  return r.rows[0] as DepotIdentique | undefined;
}

/** Contenu déjà déposé : rejeu sans effet (pièce reçue) ou 409 (pièce rejetée). */
function issueDoublon(piece: PieceDeposable, doublon: DepotIdentique | undefined): string | null {
  if (!doublon) return null;
  if (piece.statut === "rejetee") {
    throw new AppError(
      409,
      "CONTENU_IDENTIQUE",
      "Ce fichier est identique à un dépôt déjà examiné : déposez une version corrigée.",
    );
  }
  return doublon.id;
}

/**
 * Signal interne : le contenu était déjà déposé (la transaction du fichier est annulée). Ce n'est
 * pas une erreur métier, seulement la sortie anticipée de `rattacher` : elle est interceptée dans
 * `deposer` et ne sort jamais du module (aucune route ne la voit).
 */
class DejaDepose extends Error {
  constructor(readonly depotId: string) {
    super("Dépôt déjà reçu.");
  }
}

export interface ResultatDepot {
  depotId: string;
  nouveau: boolean;
}

/**
 * Enregistre le fichier reçu et le dépôt. `lire` relit la pièce dans la transaction (portail :
 * restreinte au client ; cabinet : à la mission) ; `apresDepot` journalise dans la transaction.
 */
async function deposer(
  app: FastifyInstance,
  auth: Auth,
  recu: TeleversementRecu,
  options: {
    origine: OrigineDepot;
    lire: (db: Db) => Promise<PieceDeposable | undefined>;
    apresDepot: (db: Db, depotId: string, piece: PieceDeposable) => Promise<void>;
  },
): Promise<ResultatDepot> {
  const sha256 = createHash("sha256").update(recu.contenu).digest("hex");
  let depotId = "";
  try {
    await enregistrerFichier(app, auth, recu, {
      details: { salle_origine: options.origine },
      rattacher: async (db, fichier) => {
        const lue = await options.lire(db);
        if (!lue) throw options.origine === "portail" ? introuvablePortail() : introuvable("Pièce");
        await verrouillerPiece(db, lue.id);
        await verrouillerDemande(db, lue.demande_id, "partage");
        if (options.origine === "portail") {
          // Un seul dépôt du portail à la fois par utilisateur : le débit se compte sans course.
          await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
            `salle_debit:${auth.utilisateurId}`,
          ]);
        }
        const piece = (await options.lire(db)) as PieceDeposable;
        exigerDepotPossible(piece, options.origine);
        const existant = issueDoublon(piece, await depotIdentique(db, piece, sha256));
        if (existant) throw new DejaDepose(existant);
        await verifierPlafondsDepots(db, auth, piece, options.origine, Number(fichier.taille));
        const r = await db.query(
          `INSERT INTO salle_depots (cabinet_id, piece_id, demande_id, client_id, fichier_id,
             origine, depose_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            auth.cabinetId,
            piece.id,
            piece.demande_id,
            piece.client_id,
            fichier.id,
            options.origine,
            auth.utilisateurId,
          ],
        );
        depotId = r.rows[0].id as string;
        await db.query(
          `INSERT INTO salle_piece_evenements (cabinet_id, piece_id, client_id, rang, statut,
             depot_id, par)
           VALUES ($1, $2, $3, 1, 'recue', $4, $5)`,
          [auth.cabinetId, piece.id, piece.client_id, depotId, auth.utilisateurId],
        );
        await options.apresDepot(db, depotId, piece);
      },
    });
  } catch (error) {
    if (error instanceof DejaDepose) return { depotId: error.depotId, nouveau: false };
    throw error;
  }
  return { depotId, nouveau: true };
}

/** Rejeu détecté avant toute écriture (évite d'écrire un fichier pour rien). */
export async function depotDejaRecu(
  db: Db,
  piece: PieceDeposable,
  contenu: Buffer,
): Promise<string | null> {
  const sha256 = createHash("sha256").update(contenu).digest("hex");
  return issueDoublon(piece, await depotIdentique(db, piece, sha256));
}

/** Dépôt du client, dans le contexte RLS du portail (posé par db/pool.ts à chaque transaction). */
export function deposerDepuisPortail(
  app: FastifyInstance,
  acces: AccesPortail,
  pieceId: string,
  recu: TeleversementRecu,
): Promise<ResultatDepot> {
  return deposer(app, acces.auth, recu, {
    origine: "portail",
    lire: (db) => lirePieceDeposable(db, pieceId, { clientId: acces.clientId }),
    apresDepot: (db, depotId, piece) =>
      journaliserPortail(db, acces, "portail_depot", "salle_depot", depotId, {
        piece_id: piece.id,
        demande_id: piece.demande_id,
      }),
  });
}

/** Pièce reçue hors portail (courriel, remise en main propre), déposée par l'équipe. */
export function deposerParLeCabinet(
  app: FastifyInstance,
  auth: Auth,
  missionId: string,
  pieceId: string,
  recu: TeleversementRecu,
): Promise<ResultatDepot> {
  return deposer(app, auth, recu, {
    origine: "cabinet",
    lire: (db) => lirePieceDeposable(db, pieceId, { missionId }),
    apresDepot: (db, depotId, piece) =>
      journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "salle_depot_cabinet",
        entite: "salle_depot",
        entiteId: depotId,
        details: { mission_id: missionId, piece_id: piece.id, demande_id: piece.demande_id },
      }),
  });
}

/**
 * Retrait par l'équipe d'un dépôt NON ACCEPTÉ (fichier déposé à tort, contenu douteux) : le
 * fichier est marqué supprimé (`fichiers_suppressions`, motif « retire », ajout seul) : il ne
 * compte plus dans le quota, ni dans les plafonds, et n'est plus servi ; la ligne du dépôt et son
 * historique restent. Refusé (409) si une acceptation retient ce dépôt ou s'il est déjà versé au
 * dossier de mission. Renvoie la clé de stockage à effacer APRÈS validation de la transaction.
 */
export async function retirerDepot(
  db: Db,
  auth: Auth,
  missionId: string,
  depotId: string,
): Promise<{ cleStockage: string; pieceId: string }> {
  const r = await db.query(
    `SELECT x.id, x.piece_id, x.fichier_id, f.cle_stockage, f.nom_origine AS nom,
       EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = x.fichier_id) AS retire,
       EXISTS (SELECT 1 FROM salle_piece_evenements e
               WHERE e.depot_id = x.id AND e.statut = 'acceptee') AS accepte,
       EXISTS (SELECT 1 FROM mission_documents md WHERE md.fichier_id = x.fichier_id) AS verse
     FROM salle_depots x JOIN salle_pieces p ON p.id = x.piece_id
     JOIN fichiers f ON f.id = x.fichier_id
     WHERE x.id = $1 AND p.mission_id = $2`,
    [depotId, missionId],
  );
  const depot = r.rows[0] as
    | {
        id: string;
        piece_id: string;
        fichier_id: string;
        cle_stockage: string;
        nom: string;
        retire: boolean;
        accepte: boolean;
        verse: boolean;
      }
    | undefined;
  if (!depot || depot.retire) throw introuvable("Dépôt");
  await verrouillerPiece(db, depot.piece_id);
  // Relu sous le verrou : une acceptation concurrente retient peut-être ce dépôt.
  const retenu = await db.query(
    `SELECT EXISTS (SELECT 1 FROM salle_piece_evenements e
                    WHERE e.depot_id = $1 AND e.statut = 'acceptee') AS accepte`,
    [depotId],
  );
  if (depot.accepte || depot.verse || retenu.rows[0].accepte === true) {
    throw conflit(
      "Ce dépôt est retenu (pièce acceptée ou versé au dossier) : il ne se retire pas.",
    );
  }
  await db.query(
    `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif, supprime_par)
     VALUES ($1, $2, 'retire', $3)`,
    [auth.cabinetId, depot.fichier_id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_depot_retire",
    entite: "salle_depot",
    entiteId: depot.id,
    details: { mission_id: missionId, piece_id: depot.piece_id, fichier_id: depot.fichier_id },
  });
  return { cleStockage: depot.cle_stockage, pieceId: depot.piece_id };
}
