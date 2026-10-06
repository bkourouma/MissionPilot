import { montant as montantMoteur, sommer, type Devise } from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { nombre } from "../missions/outils.js";

export const COLONNES_DEBOURS = `d.id, d.mission_id, d.collaborateur_id, c.nom AS collaborateur_nom,
  d.auteur_id, d.date::text AS date, d.categorie, d.libelle, d.montant, d.devise, d.refacturable,
  d.justificatif, d.statut, d.motif_rejet, d.soumis_le, d.decide_par, d.decide_le, d.cree_le,
  d.modifie_le`;
export const DEPUIS_DEBOURS = "debours d JOIN collaborateurs c ON c.id = d.collaborateur_id";

/** Débours au format de l'API (montant bigint → nombre) ; état de facturation dérivé. */
export function vueDebours(d: Record<string, unknown>): Record<string, unknown> {
  return { ...d, montant: nombre(d.montant) };
}

export async function exigerDebours(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES_DEBOURS},
       EXISTS (SELECT 1 FROM facturation_liens l WHERE l.debours_id = d.id AND l.libere_le IS NULL)
         AS facture_en_cours
     FROM ${DEPUIS_DEBOURS} WHERE d.id = $1 ${verrouiller ? "FOR UPDATE OF d" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Débours");
  return r.rows[0];
}

/**
 * Débours VALIDÉS d'une mission, sommés par le moteur : les non refacturables
 * alimentent le réalisé (coût de la mission), les refacturables sont des
 * lignes facturables. Montants servis seulement avec « budget.lire_montants ».
 */
export async function deboursValidesMission(
  db: Db,
  missionId: string,
  devise: Devise,
): Promise<{ devise: Devise; refacturables: number; non_refacturables: number; nombre: number }> {
  const r = await db.query(
    "SELECT montant, refacturable FROM debours WHERE mission_id = $1 AND statut = 'valide' AND devise = $2",
    [missionId, devise],
  );
  const parType = (refacturable: boolean) =>
    sommer(
      r.rows
        .filter((d) => d.refacturable === refacturable)
        .map((d) => montantMoteur(nombre(d.montant), devise)),
      devise,
    ).valeur;
  return {
    devise,
    refacturables: parType(true),
    non_refacturables: parType(false),
    nombre: r.rows.length,
  };
}
