import type { StatutDemandeSalle } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { paginer } from "../http/outils.js";
import { introuvablePortail, type AccesPortail } from "../portail/acces.js";
import { SELECT_PIECES, type PieceDb } from "./donnees.js";
import { synthesePieces } from "./regles.js";

/*
 * Salle de mission vue du portail client (CLI-01).
 *
 * RÈGLES (testées dans test/salle-mission.test.ts, « portail : lecture » et « portail : dépôt »,
 * et test/portail-acces.test.ts pour l'inventaire des routes) :
 * 1. Lecture dans la transaction du portail (cabinet + client, politiques RESTRICTIVES de 0330) :
 *    seules les demandes ENVOYÉES ou closes de SON client sont visibles, avec leurs pièces ;
 *    chaque requête filtre EN PLUS explicitement sur le client (double barrière).
 * 2. Brouillon, autre client, autre cabinet, inexistant : le MÊME 404 du portail. Le partage
 *    de la mission n'est pas requis : envoyer une demande au client est un partage explicite.
 * 3. Projection explicite : ni mission, ni auteur, ni équipe, ni historique interne, ni relance ;
 *    pour chaque pièce, son statut, le motif d'un rejet (adressé au client) et les dépôts de
 *    son entreprise (nom, type, taille, date, « déposé par moi », accusé de réception).
 */

interface DemandePortail {
  id: string;
  titre: string;
  message: string | null;
  statut: StatutDemandeSalle;
  echeance: string;
  envoyee_le: Date;
  close_le: Date | null;
}

const COLONNES = `d.id, d.titre, d.message, d.statut, d.echeance::text AS echeance, d.envoyee_le,
  d.close_le`;
const FILTRE = `d.client_id = $1 AND d.statut IN ('envoyee', 'close')`;

async function piecesPortail(db: Db, acces: AccesPortail, demandeIds: readonly string[]) {
  if (demandeIds.length === 0) return [];
  const r = await db.query(
    `${SELECT_PIECES} WHERE p.demande_id = ANY ($1::uuid[]) AND p.client_id = $2
     ORDER BY p.demande_id, p.ordre, p.id`,
    [demandeIds, acces.clientId],
  );
  return r.rows as PieceDb[];
}

/** Demandes reçues par l'entreprise (page par curseur, plus récentes d'abord). */
export async function mesDemandes(
  db: Db,
  acces: AccesPortail,
  apres: [string, string] | null,
  limite: number,
) {
  const cle = `to_char(d.envoyee_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
  const r = await db.query(
    `SELECT ${COLONNES}, ${cle} AS cle_tri FROM salle_demandes d
     WHERE ${FILTRE} AND ($2::text IS NULL OR (${cle}, d.id) < ($2, $3::uuid))
     ORDER BY cle_tri DESC, d.id DESC LIMIT $4`,
    [acces.clientId, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  const page = paginer(r.rows as (DemandePortail & { cle_tri: string })[], limite);
  const pieces = await piecesPortail(
    db,
    acces,
    page.elements.map((d) => d.id),
  );
  return {
    elements: page.elements.map((d) => ({
      ...d,
      synthese: synthesePieces(pieces.filter((p) => p.demande_id === d.id)),
    })),
    curseur_suivant: page.curseur_suivant,
  };
}

/** Demande reçue : pièces, statut, motif d'un rejet, dépôts de l'entreprise. Sinon 404. */
export async function maDemande(db: Db, acces: AccesPortail, id: string) {
  const r = await db.query(
    `SELECT ${COLONNES} FROM salle_demandes d WHERE ${FILTRE} AND d.id = $2`,
    [acces.clientId, id],
  );
  const demande = r.rows[0] as DemandePortail | undefined;
  if (!demande) throw introuvablePortail();
  const pieces = await piecesPortail(db, acces, [demande.id]);
  const depots = (
    await db.query(
      `SELECT x.id, x.piece_id, x.depose_le, (x.depose_par = $3) AS depose_par_moi,
         f.nom_origine AS nom, f.type_mime, f.taille, a.cree_le AS accuse_le
       FROM salle_depots x JOIN fichiers f ON f.id = x.fichier_id
       LEFT JOIN salle_accuses a ON a.depot_id = x.id AND a.statut = 'envoye'
       WHERE x.demande_id = $1 AND x.client_id = $2
         AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = x.fichier_id)
       ORDER BY x.depose_le, x.id`,
      [demande.id, acces.clientId, acces.auth.utilisateurId],
    )
  ).rows as {
    id: string;
    piece_id: string;
    depose_le: Date;
    depose_par_moi: boolean;
    nom: string;
    type_mime: string;
    taille: string | number;
    accuse_le: Date | null;
  }[];
  return {
    ...demande,
    synthese: synthesePieces(pieces),
    pieces: pieces.map((p) => ({
      id: p.id,
      libelle: p.libelle,
      description: p.description,
      obligatoire: p.obligatoire,
      statut: p.statut,
      statut_le: p.statut_le,
      motif_rejet: p.statut === "rejetee" ? p.motif_courant : null,
      depots: depots
        .filter((x) => x.piece_id === p.id)
        .map((x) => ({
          id: x.id,
          nom: x.nom,
          type_mime: x.type_mime,
          taille: Number(x.taille),
          depose_le: x.depose_le,
          depose_par_moi: x.depose_par_moi === true,
          accuse_le: x.accuse_le,
        })),
    })),
  };
}
