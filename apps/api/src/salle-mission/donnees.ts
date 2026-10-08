import {
  SALLE_DEMANDES_PAR_MISSION_MAX,
  type StatutDemandeSalle,
  type StatutPieceSalle,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable } from "../errors.js";
import { exigerMissionVisible, type MissionAcces } from "../missions/acces.js";
import { synthesePieces } from "./regles.js";

/*
 * Lectures de la salle de mission côté cabinet (CLI-01).
 *
 * Accès : permission de la route (`salle.lire` ou `salle.gerer`) ET mission visible
 * (`exigerMissionVisible`) ; une demande, une pièce ou un dépôt d'une autre mission, d'une
 * mission invisible ou d'un autre cabinet répond le même 404. Écriture : mission non clôturée
 * (409), ligne de la mission verrouillée pour sérialiser les écritures d'une même mission.
 */

export interface DemandeDb {
  id: string;
  mission_id: string;
  client_id: string;
  modele_id: string | null;
  titre: string;
  message: string | null;
  echeance: string | null;
  statut: StatutDemandeSalle;
  relances_auto: boolean;
  cree_par: string;
  cree_le: Date;
  modifie_le: Date;
  envoyee_par: string | null;
  envoyee_le: Date | null;
  close_par: string | null;
  close_le: Date | null;
}

export const COLONNES_DEMANDE = `d.id, d.mission_id, d.client_id, d.modele_id, d.titre, d.message,
  d.echeance::text AS echeance, d.statut, d.relances_auto, d.cree_par, d.cree_le, d.modifie_le,
  d.envoyee_par, d.envoyee_le, d.close_par, d.close_le`;

export interface PieceDb {
  id: string;
  demande_id: string;
  libelle: string;
  description: string | null;
  obligatoire: boolean;
  ordre: number;
  statut: StatutPieceSalle;
  statut_le: Date | null;
  motif_courant: string | null;
}

/** Pièces et statut courant (dernier événement, « demandée » sans événement). */
export const SELECT_PIECES = `SELECT p.id, p.demande_id, p.libelle, p.description, p.obligatoire,
    p.ordre, coalesce(e.statut, 'demandee') AS statut, e.cree_le AS statut_le,
    e.motif AS motif_courant
  FROM salle_pieces p
  LEFT JOIN LATERAL (SELECT x.statut, x.cree_le, x.motif FROM salle_piece_evenements x
                     WHERE x.piece_id = p.id ORDER BY x.rang DESC LIMIT 1) e ON true`;

/** Mission de la salle : visible ; en écriture, verrouillée et non clôturée. */
export async function exigerMissionSalle(
  db: Db,
  auth: Auth,
  missionId: string,
  ecriture = false,
): Promise<MissionAcces> {
  const mission = await exigerMissionVisible(db, auth, missionId, ecriture);
  if (ecriture && mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  return mission;
}

/** Demande de la mission, sinon 404. */
export async function exigerDemande(
  db: Db,
  missionId: string,
  demandeId: string,
  verrouiller = false,
): Promise<DemandeDb> {
  const r = await db.query(
    `SELECT ${COLONNES_DEMANDE} FROM salle_demandes d WHERE d.id = $1 AND d.mission_id = $2
     ${verrouiller ? "FOR UPDATE" : ""}`,
    [demandeId, missionId],
  );
  if (!r.rows[0]) throw introuvable("Demande");
  return r.rows[0] as DemandeDb;
}

/** Pièce d'une demande de la mission, avec son statut courant et sa demande, sinon 404. */
export async function exigerPiece(
  db: Db,
  missionId: string,
  pieceId: string,
): Promise<{ piece: PieceDb; demande: DemandeDb }> {
  const r = await db.query(`${SELECT_PIECES} WHERE p.id = $1 AND p.mission_id = $2`, [
    pieceId,
    missionId,
  ]);
  if (!r.rows[0]) throw introuvable("Pièce");
  const piece = r.rows[0] as PieceDb;
  return { piece, demande: await exigerDemande(db, missionId, piece.demande_id) };
}

/** Sérialise les écritures sur une pièce (dépôt, décision) : verrou consultatif de transaction. */
export async function verrouillerPiece(db: Db, pieceId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('salle_piece:' || $1, 0))", [
    pieceId,
  ]);
}

/**
 * Verrou consultatif d'une demande : PARTAGÉ pour un dépôt (plusieurs dépôts en parallèle),
 * EXCLUSIF pour la clôture de la demande. Un dépôt ne s'écrit donc jamais sur une demande qui se
 * clôt en même temps (un `FOR SHARE` de ligne ne convient pas : les politiques RESTRICTIVES du
 * portail interdisent la mise à jour, donc ce verrouillage de ligne).
 */
export async function verrouillerDemande(
  db: Db,
  demandeId: string,
  mode: "partage" | "exclusif",
): Promise<void> {
  const fonction = mode === "partage" ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock";
  await db.query(`SELECT ${fonction}(hashtextextended('salle_demande:' || $1, 0))`, [demandeId]);
}

export async function piecesDe(db: Db, demandeIds: readonly string[]): Promise<PieceDb[]> {
  if (demandeIds.length === 0) return [];
  const r = await db.query(
    `${SELECT_PIECES} WHERE p.demande_id = ANY ($1::uuid[]) ORDER BY p.demande_id, p.ordre, p.id`,
    [demandeIds],
  );
  return r.rows as PieceDb[];
}

/** Destinataires d'une demande : dirigeants et contributeurs du client, actifs sur le portail. */
export async function destinatairesClient(
  db: Db,
  clientId: string,
): Promise<{ id: string; nom: string }[]> {
  const r = await db.query(
    `SELECT u.id, u.nom FROM utilisateurs_portail up
     JOIN utilisateurs u ON u.id = up.utilisateur_id AND u.actif
       AND u.roles && ARRAY['client_dirigeant', 'client_contributeur']
     JOIN clients c ON c.id = up.client_id AND c.actif
     WHERE up.client_id = $1 AND up.statut = 'actif'
     ORDER BY lower(u.nom), u.id`,
    [clientId],
  );
  return r.rows as { id: string; nom: string }[];
}

function vueDemandeResumee(d: DemandeDb, pieces: readonly PieceDb[]) {
  return {
    id: d.id,
    mission_id: d.mission_id,
    titre: d.titre,
    statut: d.statut,
    echeance: d.echeance,
    relances_auto: d.relances_auto,
    modele_id: d.modele_id,
    cree_le: d.cree_le,
    envoyee_le: d.envoyee_le,
    close_le: d.close_le,
    synthese: synthesePieces(pieces),
  };
}

/** Méthode courante de la mission (dernière liaison), pour proposer les modèles adaptés. */
async function methodeCourante(db: Db, missionId: string): Promise<string[]> {
  const r = await db.query(
    `SELECT m.id, m.parent_id FROM mission_methodes mm
     JOIN methode_versions v ON v.id = mm.methode_version_id
     JOIN methodes m ON m.id = v.methode_id
     WHERE mm.mission_id = $1 ORDER BY mm.rang DESC LIMIT 1`,
    [missionId],
  );
  const l = r.rows[0] as { id: string; parent_id: string | null } | undefined;
  return l ? [l.id, ...(l.parent_id ? [l.parent_id] : [])] : [];
}

/** Salle d'une mission : demandes (plus récentes d'abord) et synthèse de leurs pièces. */
export async function salleDeMission(db: Db, mission: MissionAcces) {
  const r = await db.query(
    `SELECT ${COLONNES_DEMANDE} FROM salle_demandes d WHERE d.mission_id = $1
     ORDER BY d.cree_le DESC, d.id DESC LIMIT $2`,
    [mission.id, SALLE_DEMANDES_PAR_MISSION_MAX],
  );
  const demandes = r.rows as DemandeDb[];
  const pieces = await piecesDe(
    db,
    demandes.map((d) => d.id),
  );
  return {
    mission_id: mission.id,
    client_id: mission.client_id,
    mission_cloturee: mission.statut === "cloturee",
    methodes: await methodeCourante(db, mission.id),
    destinataires: await destinatairesClient(db, mission.client_id),
    demandes: demandes.map((d) =>
      vueDemandeResumee(
        d,
        pieces.filter((p) => p.demande_id === d.id),
      ),
    ),
  };
}

interface DepotLigne {
  id: string;
  piece_id: string;
  origine: string;
  depose_par: string;
  depose_par_nom: string | null;
  depose_le: Date;
  fichier_id: string;
  nom: string;
  type_mime: string;
  taille: string | number;
  sha256: string;
  supprime: boolean;
  accuse_statut: string | null;
  accuse_le: Date | null;
  document_id: string | null;
}

/** Plafond de l'historique des relances servi avec une demande. */
export const RELANCES_SERVIES_MAX = 200;

/** Vue détaillée d'une demande pour l'équipe : pièces, dépôts, historique, relances. */
export async function vueDemande(db: Db, d: DemandeDb) {
  const pieces = await piecesDe(db, [d.id]);
  const depots = (
    await db.query(
      `SELECT x.id, x.piece_id, x.origine, x.depose_par, u.nom AS depose_par_nom, x.depose_le,
         f.id AS fichier_id, f.nom_origine AS nom, f.type_mime, f.taille, f.sha256,
         EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id) AS supprime,
         a.statut AS accuse_statut, a.cree_le AS accuse_le,
         (SELECT md.id FROM mission_documents md WHERE md.fichier_id = x.fichier_id) AS document_id
       FROM salle_depots x JOIN fichiers f ON f.id = x.fichier_id
       LEFT JOIN utilisateurs u ON u.id = x.depose_par
       LEFT JOIN salle_accuses a ON a.depot_id = x.id
       WHERE x.demande_id = $1 ORDER BY x.depose_le, x.id`,
      [d.id],
    )
  ).rows as DepotLigne[];
  const evenements = (
    await db.query(
      `SELECT e.piece_id, e.rang, e.statut, e.motif, e.depot_id, e.cree_le, u.nom AS par_nom
       FROM salle_piece_evenements e JOIN salle_pieces p ON p.id = e.piece_id
       LEFT JOIN utilisateurs u ON u.id = e.par
       WHERE p.demande_id = $1 ORDER BY e.piece_id, e.rang`,
      [d.id],
    )
  ).rows as {
    piece_id: string;
    rang: number;
    statut: string;
    motif: string | null;
    depot_id: string | null;
    cree_le: Date;
    par_nom: string | null;
  }[];
  const relances = (
    await db.query(
      `SELECT r.palier, r.echeance::text AS echeance, r.cree_le, dest.nom AS destinataire_nom,
         par.nom AS relance_par_nom
       FROM salle_relances r
       LEFT JOIN utilisateurs dest ON dest.id = r.destinataire_id
       LEFT JOIN utilisateurs par ON par.id = r.relance_par
       WHERE r.demande_id = $1 ORDER BY r.cree_le DESC, r.id LIMIT $2`,
      [d.id, RELANCES_SERVIES_MAX],
    )
  ).rows;
  return {
    ...d,
    synthese: synthesePieces(pieces),
    destinataires: await destinatairesClient(db, d.client_id),
    pieces: pieces.map((p) => ({
      id: p.id,
      libelle: p.libelle,
      description: p.description,
      obligatoire: p.obligatoire,
      ordre: p.ordre,
      statut: p.statut,
      statut_le: p.statut_le,
      motif_rejet: p.statut === "rejetee" ? p.motif_courant : null,
      depots: depots
        .filter((x) => x.piece_id === p.id)
        .map((x) => ({
          id: x.id,
          origine: x.origine,
          depose_par: { id: x.depose_par, nom: x.depose_par_nom },
          depose_le: x.depose_le,
          fichier: x.supprime
            ? null
            : {
                id: x.fichier_id,
                nom: x.nom,
                type_mime: x.type_mime,
                taille: Number(x.taille),
                sha256: x.sha256,
              },
          accuse: x.accuse_statut ? { statut: x.accuse_statut, le: x.accuse_le } : null,
          document_id: x.document_id,
        })),
      historique: evenements
        .filter((e) => e.piece_id === p.id)
        .map((e) => ({
          rang: e.rang,
          statut: e.statut,
          motif: e.motif,
          depot_id: e.depot_id,
          par_nom: e.par_nom,
          le: e.cree_le,
        })),
    })),
    relances,
  };
}
