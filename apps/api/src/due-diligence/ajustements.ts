import { PLAFONDS_DD } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";

/*
 * Ajustements des experts (DD-08, migration 0506, ajout seul). Écrits par l'API SEULEMENT (aucune
 * route POST), dans la transaction de l'écriture qui les provoque, mission verrouillée : verdict
 * différent de l'indication du moteur, niveau d'un risque différent de la gravité indicative du
 * signal d'origine, ajustement multiplicatif d'un dimensionnement. Les valeurs avant et après sont
 * des TEXTES déjà formatés par les moteurs (jamais calculés ici).
 */

export type CibleAjustement = "verdict" | "risque" | "dimensionnement";

export interface NouvelAjustement {
  dossierId: string;
  cibleType: CibleAjustement;
  cibleId: string;
  champ: string;
  avant: string;
  apres: string;
  motif: string;
}

export async function ecrireAjustement(db: Db, auth: Auth, a: NouvelAjustement): Promise<string> {
  const n = await db.query("SELECT count(*)::int AS n FROM dd_ajustements WHERE dossier_id = $1", [
    a.dossierId,
  ]);
  if ((n.rows[0].n as number) >= PLAFONDS_DD.ajustements_par_dossier) {
    throw new AppError(409, "PLAFOND_ATTEINT", "Trop d'ajustements tracés pour ce dossier.");
  }
  const r = await db.query(
    `INSERT INTO dd_ajustements (cabinet_id, dossier_id, cible_type, cible_id, champ, valeur_avant,
       valeur_apres, motif, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      auth.cabinetId,
      a.dossierId,
      a.cibleType,
      a.cibleId,
      a.champ,
      a.avant,
      a.apres,
      a.motif,
      auth.utilisateurId,
    ],
  );
  return r.rows[0].id as string;
}

/** Ajustements d'un dossier, du plus récent au plus ancien (au plus 1 000). */
export async function listerAjustements(db: Db, dossierId: string) {
  const r = await db.query(
    `SELECT a.id, a.numero::text AS numero, a.cible_type, a.cible_id, a.champ, a.valeur_avant,
       a.valeur_apres, a.motif, a.auteur_id, u.nom AS auteur_nom, a.cree_le
     FROM dd_ajustements a LEFT JOIN utilisateurs u ON u.id = a.auteur_id
     WHERE a.dossier_id = $1 ORDER BY a.numero DESC LIMIT $2`,
    [dossierId, PLAFONDS_DD.ajustements_par_dossier + 1],
  );
  return r.rows.slice(0, PLAFONDS_DD.ajustements_par_dossier).map((l) => ({
    id: l.id as string,
    numero: l.numero as string,
    cible_type: l.cible_type as string,
    cible_id: l.cible_id as string,
    champ: l.champ as string,
    valeur_avant: l.valeur_avant as string,
    valeur_apres: l.valeur_apres as string,
    motif: l.motif as string,
    auteur_id: l.auteur_id as string,
    auteur_nom: (l.auteur_nom as string | null) ?? null,
    cree_le: l.cree_le as Date,
  }));
}
