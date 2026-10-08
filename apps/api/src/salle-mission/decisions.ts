import { aPermission } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { traduireErreursPg } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { exigerPiece, verrouillerPiece, type DemandeDb, type PieceDb } from "./donnees.js";

/*
 * Décisions de l'équipe sur une pièce reçue (CLI-01) : accepter, ou rejeter avec un motif
 * adressé au client ; verser un dépôt d'une pièce acceptée au dossier de mission (documents de
 * mission, SOC-05 : nouvelle version d'un document « autre », même règle de version que
 * POST /missions/:id/documents). Transitions doublées en base (MPL02) ; une décision ne revient
 * jamais à un utilisateur du portail ni, sauf associé, à celui qui a déposé le fichier retenu (MPL09). Le déposant (portail) est prévenu du rejet et de
 * l'acceptation (notification doublée d'un e-mail pour le rejet : il doit agir).
 */

interface DernierDepot {
  id: string;
  fichier_id: string;
  origine: string;
  depose_par: string;
}

async function dernierDepot(db: Db, pieceId: string): Promise<DernierDepot | undefined> {
  const r = await db.query(
    `SELECT x.id, x.fichier_id, x.origine, x.depose_par FROM salle_depots x
     WHERE x.piece_id = $1
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = x.fichier_id)
     ORDER BY x.depose_le DESC, x.id DESC LIMIT 1`,
    [pieceId],
  );
  return r.rows[0] as DernierDepot | undefined;
}

/** Pièce de la mission, verrouillée, relue sous le verrou. */
async function pieceVerrouillee(db: Db, missionId: string, pieceId: string) {
  await exigerPiece(db, missionId, pieceId);
  await verrouillerPiece(db, pieceId);
  return exigerPiece(db, missionId, pieceId);
}

function exigerRecue(piece: PieceDb, demande: DemandeDb): void {
  if (demande.statut === "brouillon" || piece.statut !== "recue") {
    throw new AppError(
      409,
      "TRANSITION_REFUSEE",
      "Seule une pièce reçue (en attente d'examen) s'accepte ou se rejette.",
    );
  }
}

async function enregistrerDecision(
  db: Db,
  auth: Auth,
  piece: PieceDb,
  demande: DemandeDb,
  decision: { statut: "acceptee" | "rejetee"; motif: string | null; depotId: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO salle_piece_evenements (cabinet_id, piece_id, client_id, rang, statut, motif,
       depot_id, par)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
    [
      auth.cabinetId,
      piece.id,
      demande.client_id,
      decision.statut,
      decision.motif,
      decision.depotId,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: decision.statut === "acceptee" ? "salle_piece_acceptee" : "salle_piece_rejetee",
    entite: "salle_piece",
    entiteId: piece.id,
    details: {
      mission_id: demande.mission_id,
      demande_id: demande.id,
      depot_id: decision.depotId,
      ...(decision.motif ? { motif: decision.motif } : {}),
    },
  });
}

/** Notification du déposant (portail) : rejet (avec e-mail) ou acceptation. */
async function prevenirDeposant(
  db: Db,
  auth: Auth,
  piece: PieceDb,
  demande: DemandeDb,
  depot: DernierDepot | undefined,
  motif: string | null,
): Promise<NotificationCreee | null> {
  if (!depot || depot.origine !== "portail") return null;
  return notifier(db, {
    cabinetId: auth.cabinetId,
    destinataireId: depot.depose_par,
    type: motif ? "salle_piece_rejetee" : "salle_piece_acceptee",
    titre: motif
      ? `Pièce à déposer de nouveau : « ${piece.libelle} »`
      : `Pièce acceptée : « ${piece.libelle} »`,
    corps: motif
      ? `Votre dépôt pour la pièce « ${piece.libelle} » (demande « ${demande.titre} ») ne peut pas être retenu. Motif : ${motif} Merci de déposer une version corrigée depuis votre portail client.`
      : `Votre dépôt pour la pièce « ${piece.libelle} » (demande « ${demande.titre} ») a été accepté. Merci.`,
    lien: `/portail/salle/${demande.id}`,
    email: Boolean(motif),
  });
}

export async function rejeterPiece(
  db: Db,
  auth: Auth,
  missionId: string,
  pieceId: string,
  motif: string,
): Promise<NotificationCreee | null> {
  const { piece, demande } = await pieceVerrouillee(db, missionId, pieceId);
  exigerRecue(piece, demande);
  const depot = await dernierDepot(db, piece.id);
  await enregistrerDecision(db, auth, piece, demande, {
    statut: "rejetee",
    motif,
    depotId: depot?.id ?? null,
  });
  return prevenirDeposant(db, auth, piece, demande, depot, motif);
}

export async function accepterPiece(
  db: Db,
  auth: Auth,
  missionId: string,
  pieceId: string,
  options: { rattacher: boolean; nomDocument?: string },
): Promise<{ notification: NotificationCreee | null; documentId: string | null }> {
  if (options.rattacher && !aPermission(auth.roles, "document.ecrire")) throw interdit();
  const { piece, demande } = await pieceVerrouillee(db, missionId, pieceId);
  exigerRecue(piece, demande);
  const depot = await dernierDepot(db, piece.id);
  if (!depot) {
    throw new AppError(
      409,
      "TRANSITION_REFUSEE",
      "Aucun dépôt à retenir : la pièce n'a plus de fichier (retiré). La rejeter pour redemander un dépôt.",
    );
  }
  // Séparation des tâches : on n'accepte pas le dépôt qu'on a fait soi-même, sauf associé
  // (doublé en base, MPL09).
  if (depot.depose_par === auth.utilisateurId && !estAssocie(auth)) {
    throw new AppError(
      409,
      "ACCEPTATION_PAR_DEPOSANT",
      "Séparation des tâches : un autre membre de l'équipe (ou un associé) accepte un dépôt que vous avez fait.",
    );
  }
  await enregistrerDecision(db, auth, piece, demande, {
    statut: "acceptee",
    motif: null,
    depotId: depot.id,
  });
  const documentId = options.rattacher
    ? (await verserAuDossier(db, auth, missionId, depot.id, options.nomDocument)).id
    : null;
  return {
    notification: await prevenirDeposant(db, auth, piece, demande, depot, null),
    documentId,
  };
}

/**
 * Verse un dépôt d'une pièce ACCEPTÉE au dossier de mission : nouvelle version du document
 * « autre » de ce nom (libellé de la pièce par défaut). Un dépôt ne se verse qu'une fois (un
 * fichier désigne une seule version) ; un contenu identique à la version courante est refusé.
 */
export async function verserAuDossier(
  db: Db,
  auth: Auth,
  missionId: string,
  depotId: string,
  nomDocument?: string,
): Promise<{ id: string; nom: string; version: number }> {
  const r = await db.query(
    `SELECT x.id, x.piece_id, x.fichier_id, f.sha256, p.libelle,
       EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = x.fichier_id) AS supprime
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
        sha256: string;
        libelle: string;
        supprime: boolean;
      }
    | undefined;
  if (!depot || depot.supprime) throw introuvable("Dépôt");
  const { piece } = await exigerPiece(db, missionId, depot.piece_id);
  if (piece.statut !== "acceptee") {
    throw conflit("Seul le dépôt d'une pièce acceptée se verse au dossier de mission.");
  }
  // Seul le dépôt RETENU par l'acceptation (son événement cite `depot_id`) se verse : un dépôt
  // antérieur, rejeté ou non examiné ne devient pas un document de mission.
  const retenu = await db.query(
    `SELECT depot_id FROM salle_piece_evenements WHERE piece_id = $1 AND statut = 'acceptee'
     ORDER BY rang DESC LIMIT 1`,
    [depot.piece_id],
  );
  if (retenu.rows[0]?.depot_id !== depot.id) {
    throw conflit(
      "Seul le dépôt retenu à l'acceptation de la pièce se verse au dossier de mission.",
    );
  }
  const nom = nomDocument ?? depot.libelle;
  const courante = await db.query(
    `SELECT f.sha256 FROM mission_documents d JOIN fichiers f ON f.id = d.fichier_id
     WHERE d.mission_id = $1 AND d.type = 'autre' AND d.nom = $2
     ORDER BY d.version DESC LIMIT 1`,
    [missionId, nom],
  );
  if (courante.rows[0]?.sha256 === depot.sha256) {
    throw new AppError(
      409,
      "CONTENU_IDENTIQUE",
      "Ce fichier est identique à la version courante du document.",
    );
  }
  const insere = await traduireErreursPg(
    db.query(
      `INSERT INTO mission_documents (cabinet_id, mission_id, type, nom, version, auteur_id,
         fichier_id)
       SELECT $1, $2, 'autre', $3, coalesce(max(version), 0) + 1, $4, $5
       FROM mission_documents WHERE mission_id = $2 AND type = 'autre' AND nom = $3
       RETURNING id, version`,
      [auth.cabinetId, missionId, nom, auth.utilisateurId, depot.fichier_id],
    ),
    {
      mission_documents_fichier_uniq: "Ce dépôt est déjà versé au dossier de mission.",
      "*": "Une autre version vient d'être déposée : réessayer.",
    },
  );
  const document = insere.rows[0] as { id: string; version: number };
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "depot_document",
    entite: "mission_document",
    entiteId: document.id,
    details: {
      mission_id: missionId,
      type: "autre",
      nom,
      version: document.version,
      fichier_id: depot.fichier_id,
      salle_depot_id: depot.id,
    },
  });
  return { id: document.id, nom, version: document.version };
}
