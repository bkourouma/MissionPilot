import {
  PLAFONDS_DD_PORTAIL,
  type DdPortailPiece,
  type DdPortailPublicationDetail,
  type DdPortailPublicationResume,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import type { AccesPortail } from "../portail/acces.js";
import { introuvablePortail } from "../portail/acces.js";

/*
 * Portail investisseur de la due diligence, côté PORTAIL (migration 0509) : lectures faites dans
 * `avecPortail` (politiques RESTRICTIVES `portail` de 0509), AVEC en plus le filtre explicite
 * ci-dessous (double barrière) : SON client, option du cabinet active, invitation ACTIVE de
 * l'utilisateur sur le dossier, publication non retirée. Inexistante, d'un autre client ou d'un
 * autre cabinet, non invité, option désactivée, retirée : le MÊME 404. Projections explicites :
 * l'instantané publié et les pièces (variante, format), jamais un auteur, un nom du cabinet, un
 * dossier interne ni un coût.
 */

/** Publication visible ($1 : client, $2 : utilisateur du portail ; alias `p`). */
export const FILTRE_PUBLICATION_VISIBLE = `p.client_id = $1
  AND dd_portail_option_active(p.cabinet_id)
  AND dd_portail_invitation_active(p.dossier_id, $2)
  AND NOT EXISTS (SELECT 1 FROM dd_portail_publication_retraits r WHERE r.publication_id = p.id)`;

const iso = (d: Date) => d.toISOString();

type Recommandation = DdPortailPublicationResume["recommandation"];

/** Page des publications visibles, plus récente d'abord (curseur sur le numéro). */
export async function publicationsVisibles(
  db: Db,
  acces: AccesPortail,
  apresNumero: string | null,
  limite: number,
): Promise<(DdPortailPublicationResume & { cle_tri: string })[]> {
  const r = await db.query(
    `SELECT p.id, p.titre, p.recommandation, p.version, p.valide_le, p.cree_le AS publie_le,
       p.numero::text AS cle_tri,
       (SELECT count(*)::int FROM dd_portail_pieces x WHERE x.publication_id = p.id) AS nb_pieces
     FROM dd_portail_publications p
     WHERE ${FILTRE_PUBLICATION_VISIBLE} AND ($3::bigint IS NULL OR p.numero < $3::bigint)
     ORDER BY p.numero DESC LIMIT $4`,
    [acces.clientId, acces.auth.utilisateurId, apresNumero, limite + 1],
  );
  return r.rows.map((l) => ({
    id: l.id as string,
    titre: l.titre as string,
    recommandation: l.recommandation as Recommandation,
    version: l.version as number,
    valide_le: iso(l.valide_le as Date),
    publie_le: iso(l.publie_le as Date),
    nb_pieces: l.nb_pieces as number,
    cle_tri: l.cle_tri as string,
  }));
}

/** Détail d'une publication visible (instantané et pièces), sinon 404. */
export async function publicationVisible(
  db: Db,
  acces: AccesPortail,
  id: string,
): Promise<DdPortailPublicationDetail> {
  const r = await db.query(
    `SELECT p.id, p.titre, p.recommandation, p.synthese, p.conditions, p.version, p.valide_le,
       p.cree_le AS publie_le
     FROM dd_portail_publications p WHERE p.id = $3 AND ${FILTRE_PUBLICATION_VISIBLE}`,
    [acces.clientId, acces.auth.utilisateurId, id],
  );
  const l = r.rows[0];
  if (!l) throw introuvablePortail();
  const pieces = await db.query(
    `SELECT x.id, x.variante, x.format FROM dd_portail_pieces x
     WHERE x.publication_id = $1 AND x.client_id = $2 ORDER BY x.numero LIMIT $3`,
    [id, acces.clientId, PLAFONDS_DD_PORTAIL.pieces_par_publication],
  );
  return {
    id: l.id as string,
    titre: l.titre as string,
    recommandation: l.recommandation as Recommandation,
    synthese: l.synthese as string,
    conditions: l.conditions as string[],
    version: l.version as number,
    valide_le: iso(l.valide_le as Date),
    publie_le: iso(l.publie_le as Date),
    pieces: pieces.rows.map((x) => ({
      id: x.id as string,
      variante: x.variante as DdPortailPiece["variante"],
      format: x.format as DdPortailPiece["format"],
    })),
  };
}

/** Contrôle dans le contexte du portail : la pièce est celle de CETTE publication visible. */
export async function exigerPieceVisible(
  db: Db,
  acces: AccesPortail,
  publicationId: string,
  pieceId: string,
): Promise<void> {
  const r = await db.query(
    `SELECT 1 FROM dd_portail_pieces x JOIN dd_portail_publications p ON p.id = x.publication_id
     WHERE x.id = $3 AND x.publication_id = $4 AND x.client_id = $1
       AND ${FILTRE_PUBLICATION_VISIBLE}`,
    [acces.clientId, acces.auth.utilisateurId, pieceId, publicationId],
  );
  if (!r.rows[0]) throw introuvablePortail();
}

export interface FichierPiece {
  nom: string;
  type_mime: string;
  taille: string | number;
  cle_stockage: string;
}

/**
 * Lecture INTERNE (hors du contexte du portail : `rapports_mission` et `fichiers` y sont fermés),
 * après `exigerPieceVisible`. Revérifie TOUT explicitement, dans cette transaction : rattachement
 * actif de l'utilisateur à CE client, publication visible (option, invitation, non retirée), pièce
 * de CETTE publication, rapport `note_comite` de la note et de la version publiées, fichier non
 * supprimé ; 404 sinon. Ne renvoie que ce qu'il faut pour servir le fichier.
 */
export async function fichierDePiece(
  db: Db,
  acces: AccesPortail,
  publicationId: string,
  pieceId: string,
): Promise<FichierPiece> {
  const r = await db.query(
    `SELECT f.nom_origine AS nom, f.type_mime, f.taille, f.cle_stockage
     FROM dd_portail_pieces x
       JOIN dd_portail_publications p ON p.id = x.publication_id
       JOIN rapports_mission r ON r.id = x.rapport_id AND r.modele = 'note_comite'
         AND r.dd_note_id = p.note_id AND r.version_source = p.version
       JOIN fichiers f ON f.id = r.fichier_id
     WHERE x.id = $3 AND x.publication_id = $4 AND x.client_id = $1
       AND ${FILTRE_PUBLICATION_VISIBLE}
       AND EXISTS (SELECT 1 FROM utilisateurs_portail up
                   WHERE up.utilisateur_id = $2 AND up.client_id = $1 AND up.statut = 'actif')
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)`,
    [acces.clientId, acces.auth.utilisateurId, pieceId, publicationId],
  );
  if (!r.rows[0]) throw introuvablePortail();
  return r.rows[0] as FichierPiece;
}
