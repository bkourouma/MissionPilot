import type { ControleCloture } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
} from "../finance/paiements.js";
import { aujourdhui } from "../missions/outils.js";

/*
 * Contrôles déterministes de la check-list de clôture (AUT-08). Chacun est NOMMÉ (liste fermée
 * `CONTROLES_CLOTURE`), lit la base sous la RLS du cabinet et renvoie un NOMBRE D'ÉCARTS entier :
 * zéro = conforme. Aucun montant n'est calculé ici : le solde d'une facture vient du moteur de
 * finance (`situationPaiement`). Le contrôle « capitalisation faite » n'a pas de donnée à
 * calculer : il se déclare par attestation (`attestations.ts`).
 */

const compter = async (db: Db, sql: string, parametres: unknown[]): Promise<number> => {
  const r = await db.query(sql, parametres);
  return Number(r.rows[0]?.n ?? 0);
};

/** Feuilles de temps portant des lignes de la mission et non validées (brouillon, soumise, rejetée). */
async function tempsValides(db: Db, missionId: string): Promise<number> {
  return compter(
    db,
    `SELECT count(DISTINCT f.id)::int AS n
       FROM lignes_temps l JOIN feuilles_temps f ON f.id = l.feuille_id
      WHERE l.mission_id = $1 AND f.statut IN ('brouillon', 'soumise', 'rejetee')`,
    [missionId],
  );
}

/** Débours en attente de décision (brouillon ou soumis). */
async function deboursTraites(db: Db, missionId: string): Promise<number> {
  return compter(
    db,
    `SELECT count(*)::int AS n FROM debours WHERE mission_id = $1 AND statut IN ('brouillon', 'soumis')`,
    [missionId],
  );
}

/** Factures non émises (brouillon, à approuver, approuvée) et échéances à facturer. */
async function facturesEmises(db: Db, missionId: string): Promise<number> {
  const factures = await compter(
    db,
    `SELECT count(*)::int AS n FROM factures
      WHERE mission_id = $1 AND statut IN ('brouillon', 'a_approuver', 'approuvee')`,
    [missionId],
  );
  const echeances = await compter(
    db,
    `SELECT count(*)::int AS n FROM echeances_facturation WHERE mission_id = $1 AND statut = 'a_facturer'`,
    [missionId],
  );
  return factures + echeances;
}

/** Livrables de classe R2 ou R3 suivis par la qualité et pas encore signés. */
async function livrablesSignes(db: Db, missionId: string): Promise<number> {
  return compter(
    db,
    `SELECT count(*)::int AS n FROM qualite_suivis
      WHERE mission_id = $1 AND classe IN ('R2', 'R3') AND statut <> 'signe'`,
    [missionId],
  );
}

/** Factures émises dont le moteur de finance ne dit pas « soldée ». */
async function encaissementsSoldes(db: Db, missionId: string): Promise<number> {
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT} FROM factures f
      WHERE f.mission_id = $1 AND f.nature = 'facture' AND f.statut = 'emise'`,
    [missionId],
  );
  if (r.rows.length === 0) return 0;
  const factures = r.rows.map(versFacturePaiement);
  const date = aujourdhui();
  const imputations = await imputationsParFacture(
    db,
    factures.map((f) => f.id),
    date,
  );
  return factures.filter(
    (f) => situationPaiement(f, imputations.get(f.id) ?? [], date).statut_paiement !== "soldee",
  ).length;
}

/** Zéro si une note de satisfaction de clôture a été saisie, un écart sinon. */
async function satisfactionDemandee(db: Db, missionId: string): Promise<number> {
  const n = await compter(
    db,
    `SELECT count(*)::int AS n FROM qualite_satisfactions WHERE mission_id = $1 AND moment = 'cloture'`,
    [missionId],
  );
  return n > 0 ? 0 : 1;
}

const CONTROLES_CALCULES: Record<
  Exclude<ControleCloture, "capitalisation_faite">,
  (db: Db, missionId: string) => Promise<number>
> = {
  temps_valides: tempsValides,
  debours_traites: deboursTraites,
  factures_emises: facturesEmises,
  livrables_signes: livrablesSignes,
  encaissements_soldes: encaissementsSoldes,
  satisfaction_demandee: satisfactionDemandee,
};

/** Nombre d'écarts d'un contrôle calculé ; `null` pour un contrôle par attestation. */
export async function executerControle(
  db: Db,
  controle: ControleCloture,
  missionId: string,
): Promise<number | null> {
  if (controle === "capitalisation_faite") return null;
  return CONTROLES_CALCULES[controle](db, missionId);
}
