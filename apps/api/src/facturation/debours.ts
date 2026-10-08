import { montant as montantMoteur, sommer, type Devise } from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import { nombre } from "../missions/outils.js";
import { missionVisibleOuNull, voitDeboursMission } from "./outils.js";

export const COLONNES_DEBOURS = `d.id, d.mission_id, d.collaborateur_id, c.nom AS collaborateur_nom,
  d.auteur_id, d.date::text AS date, d.categorie, d.libelle, d.montant, d.devise, d.refacturable,
  d.justificatif, d.statut, d.motif_rejet, d.soumis_le, d.decide_par, d.decide_le, d.cree_le,
  d.modifie_le, d.justificatif_fichier_id,
  (SELECT json_build_object('id', jf.id, 'nom', jf.nom_origine, 'type_mime', jf.type_mime,
     'taille', jf.taille, 'sha256', jf.sha256, 'cree_le', jf.cree_le)
   FROM fichiers jf WHERE jf.id = d.justificatif_fichier_id) AS justificatif_fichier`;
export const DEPUIS_DEBOURS = "debours d JOIN collaborateurs c ON c.id = d.collaborateur_id";

/** Débours au format de l'API (montant bigint → nombre) ; état de facturation dérivé. */
export function vueDebours(d: Record<string, unknown>): Record<string, unknown> {
  const j = d.justificatif_fichier as Record<string, unknown> | null | undefined;
  return {
    ...d,
    montant: nombre(d.montant),
    justificatif_fichier: j ? { ...j, taille: Number(j.taille) } : null,
  };
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
 * Débours visible : son auteur, ou qui voit les débours de la mission ; sinon
 * 404 (la mission doit rester visible, même pour l'auteur).
 */
export async function deboursVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<{ debours: Record<string, unknown>; mission: MissionAcces }> {
  const lu = await exigerDebours(db, id);
  // Verrou de la mission puis du débours (même ordre que la facturation).
  const mission = await missionVisibleOuNull(db, auth, lu.mission_id as string, verrouiller);
  const auteur = lu.auteur_id === auth.utilisateurId;
  if (!mission || (!auteur && !voitDeboursMission(auth, mission))) throw introuvable("Débours");
  return { debours: verrouiller ? await exigerDebours(db, id, true) : lu, mission };
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
