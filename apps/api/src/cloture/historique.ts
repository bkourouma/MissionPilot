import type { Db } from "../db/pool.js";
import { decoderCurseur, paginer } from "../http/outils.js";

/*
 * Historique de clôture d'une mission (vérifications et dérogations, ajout seul), du plus récent.
 * Chaque liste se pagine par SON curseur (clé : instant UTC à la microseconde, puis identifiant),
 * comme toute liste de l'API : un historique qui grossit n'est jamais servi d'un bloc.
 */

const CLE_INSTANT = (colonne: string) =>
  `to_char(${colonne} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

export interface PagesHistoriqueCloture {
  verifications: Record<string, unknown>[];
  derogations: Record<string, unknown>[];
  curseur_verifications_suivant: string | null;
  curseur_derogations_suivant: string | null;
}

export async function lireHistorique(
  db: Db,
  missionId: string,
  limite: number,
  curseurs: { verifications?: string; derogations?: string } = {},
): Promise<PagesHistoriqueCloture> {
  const apresV = decoderCurseur(curseurs.verifications);
  const apresD = decoderCurseur(curseurs.derogations);
  const cleV = CLE_INSTANT("v.verifie_le");
  const cleD = CLE_INSTANT("d.le");
  const v = await db.query(
    `SELECT v.id, v.controle, v.resultat, v.nombre_ecarts, v.bloquant, v.origine, v.declencheur,
            v.note, v.verifie_par, u.nom AS verifie_par_nom, v.verifie_le, ${cleV} AS cle_tri
       FROM cloture_verifications v LEFT JOIN utilisateurs u ON u.id = v.verifie_par
      WHERE v.mission_id = $1 AND ($2::text IS NULL OR (${cleV}, v.id) < ($2, $3::uuid))
      ORDER BY cle_tri DESC, v.id DESC LIMIT $4`,
    [missionId, apresV?.[0] ?? null, apresV?.[1] ?? null, limite + 1],
  );
  const d = await db.query(
    `SELECT d.id, d.controle, d.action, d.motif, d.par, u.nom AS par_nom, d.le, ${cleD} AS cle_tri
       FROM cloture_derogations d LEFT JOIN utilisateurs u ON u.id = d.par
      WHERE d.mission_id = $1 AND ($2::text IS NULL OR (${cleD}, d.id) < ($2, $3::uuid))
      ORDER BY cle_tri DESC, d.id DESC LIMIT $4`,
    [missionId, apresD?.[0] ?? null, apresD?.[1] ?? null, limite + 1],
  );
  const pageV = paginer(v.rows as { cle_tri: string; id: string }[], limite);
  const pageD = paginer(d.rows as { cle_tri: string; id: string }[], limite);
  return {
    verifications: pageV.elements,
    derogations: pageD.elements,
    curseur_verifications_suivant: pageV.curseur_suivant,
    curseur_derogations_suivant: pageD.curseur_suivant,
  };
}
