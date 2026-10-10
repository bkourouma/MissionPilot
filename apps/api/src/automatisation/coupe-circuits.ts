import { aPermission } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { interdit } from "../errors.js";
import { actionReservee, avecErreursAutomatisation, coupeCircuitInchange } from "./erreurs.js";

/*
 * Coupe-circuits (AUT-06) : celui du CABINET arrête toutes les automatisations, celui d'une
 * AUTOMATISATION n'arrête qu'elle. Couper : `automatisation.gerer` ; lever : un associé
 * seulement (rôle, doublé en base : MPU02). Historique en ajout seul ; l'état courant est la
 * dernière ligne de la portée. Un événement traité pendant la coupure est journalisé
 * « bloqué » et n'est PAS rejoué à la levée.
 */

export interface CoupeCircuit {
  actif: boolean;
  motif: string | null;
  auteur_id: string | null;
  modifie_le: string | null;
}

export async function lireCoupeCircuitAutomatisation(
  db: Db,
  automatisationId: string | null,
): Promise<CoupeCircuit> {
  const r = await db.query(
    `SELECT actif, motif, auteur_id, cree_le FROM automatisation_coupe_circuits
     WHERE automatisation_id IS NOT DISTINCT FROM $1::uuid ORDER BY id DESC LIMIT 1`,
    [automatisationId],
  );
  const l = r.rows[0];
  return l
    ? { actif: l.actif, motif: l.motif, auteur_id: l.auteur_id, modifie_le: l.cree_le }
    : { actif: false, motif: null, auteur_id: null, modifie_le: null };
}

/** Coupe-circuit actif, par automatisation (une lecture pour la liste). */
export async function coupeCircuitsActifs(db: Db): Promise<Set<string>> {
  const r = await db.query(
    `SELECT DISTINCT ON (automatisation_id) automatisation_id, actif
     FROM automatisation_coupe_circuits WHERE automatisation_id IS NOT NULL
     ORDER BY automatisation_id, id DESC`,
  );
  return new Set(r.rows.filter((l) => l.actif).map((l) => l.automatisation_id as string));
}

export async function changerCoupeCircuitAutomatisation(
  db: Db,
  auth: Auth,
  automatisationId: string | null,
  demande: { actif: boolean; motif: string },
): Promise<CoupeCircuit> {
  if (!aPermission(auth.roles, "automatisation.gerer")) throw interdit();
  if (!demande.actif && !auth.roles.includes("associe")) {
    throw actionReservee("Seul un associé lève un coupe-circuit d'automatisation.");
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `automatisation_coupe_circuit:${auth.cabinetId}:${automatisationId ?? "cabinet"}`,
  ]);
  if ((await lireCoupeCircuitAutomatisation(db, automatisationId)).actif === demande.actif) {
    throw coupeCircuitInchange();
  }
  await avecErreursAutomatisation(() =>
    db.query(
      `INSERT INTO automatisation_coupe_circuits (cabinet_id, automatisation_id, actif, motif,
         auteur_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.cabinetId, automatisationId, demande.actif, demande.motif, auth.utilisateurId],
    ),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: demande.actif
      ? "coupe_circuit_automatisation_active"
      : "coupe_circuit_automatisation_leve",
    entite: automatisationId ? "automatisation" : "automatisation_cabinet",
    entiteId: automatisationId,
    details: { motif: demande.motif },
  });
  return lireCoupeCircuitAutomatisation(db, automatisationId);
}
