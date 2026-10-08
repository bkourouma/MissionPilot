import { ajouterJours, capacite, lundiDeLaSemaine } from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { chargerCalendrier } from "../missions/outils.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { absencesValidees } from "../planification/charge.js";

/*
 * Rappels de saisie (TPS-04), exécutés par la file de tâches dans le contexte
 * RLS du cabinet du job.
 * - Rappel du vendredi : chaque collaborateur actif (utilisateur actif) dont
 *   la feuille de la semaine n'est pas soumise, sauf semaine sans capacité
 *   (absence validée sur tous les jours ouvrés).
 * - Relance du lundi : chaque chef de mission reçoit la liste des
 *   collaborateurs affectés à ses missions la semaine précédente dont la
 *   feuille n'est pas soumise (absente, en brouillon ou rejetée).
 * Jamais deux fois le même rappel pour la même semaine et le même
 * utilisateur (table rappels_temps, contrainte d'unicité).
 */

const SOUMISE = "('soumise', 'validee', 'verrouillee')";

/** Semaine (lundi) portée par la charge du job. */
function semaineDeCharge(charge: Record<string, unknown>): string {
  const s = charge.semaine;
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error("Charge de job invalide : semaine attendue.");
  }
  return lundiDeLaSemaine(s);
}

async function marquerRappel(
  db: Db,
  cabinetId: string,
  utilisateurId: string,
  semaine: string,
  type: "rappel_saisie" | "relance_chef",
): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO rappels_temps (cabinet_id, utilisateur_id, semaine, type) VALUES ($1, $2, $3, $4)
     ON CONFLICT (cabinet_id, utilisateur_id, semaine, type) DO NOTHING RETURNING id`,
    [cabinetId, utilisateurId, semaine, type],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function rappelFeuilles(ctx: {
  db: Db;
  cabinetId: string;
  charge: Record<string, unknown>;
}): Promise<NotificationCreee[]> {
  const { db, cabinetId } = ctx;
  const semaine = semaineDeCharge(ctx.charge);
  const periode = { debut: semaine, fin: ajouterJours(semaine, 6) };
  const r = await db.query(
    `SELECT c.id AS collaborateur_id, u.id AS utilisateur_id FROM collaborateurs c
     JOIN utilisateurs u ON u.id = c.utilisateur_id
     WHERE c.actif AND u.actif
       AND NOT EXISTS (SELECT 1 FROM feuilles_temps f WHERE f.collaborateur_id = c.id
                       AND f.semaine = $1 AND f.statut IN ${SOUMISE})
     ORDER BY c.id`,
    [semaine],
  );
  const calendrier = await chargerCalendrier(db, cabinetId);
  const absences = await absencesValidees(
    db,
    r.rows.map((l) => l.collaborateur_id as string),
    periode,
  );
  const creees: NotificationCreee[] = [];
  for (const l of r.rows) {
    const id = l.collaborateur_id as string;
    if (capacite(periode, calendrier, absences.get(id) ?? [], 100) === 0) continue;
    if (!(await marquerRappel(db, cabinetId, l.utilisateur_id as string, semaine, "rappel_saisie")))
      continue;
    const n = await notifier(db, {
      cabinetId,
      destinataireId: l.utilisateur_id as string,
      type: "rappel_feuille_temps",
      titre: "Pensez à soumettre votre feuille de temps",
      corps: `Votre feuille de la semaine du ${semaine} n'est pas encore soumise.`,
      lien: `/temps?semaine=${semaine}`,
      email: true,
    });
    if (n) creees.push(n);
  }
  return creees;
}

export async function relanceFeuilles(ctx: {
  db: Db;
  cabinetId: string;
  charge: Record<string, unknown>;
}): Promise<NotificationCreee[]> {
  const { db, cabinetId } = ctx;
  const semaine = semaineDeCharge(ctx.charge);
  const r = await db.query(
    `SELECT DISTINCT m.chef_id, c.id AS collaborateur_id, c.nom FROM affectations a
     JOIN missions m ON m.id = a.mission_id
     JOIN collaborateurs c ON c.id = a.collaborateur_id
     JOIN utilisateurs u ON u.id = c.utilisateur_id
     WHERE m.chef_id IS NOT NULL AND m.statut <> 'cloturee' AND c.actif AND u.actif
       AND a.date_debut <= $2 AND a.date_fin >= $1
       AND NOT EXISTS (SELECT 1 FROM feuilles_temps f WHERE f.collaborateur_id = c.id
                       AND f.semaine = $1 AND f.statut IN ${SOUMISE})
     ORDER BY m.chef_id, c.nom`,
    [semaine, ajouterJours(semaine, 6)],
  );
  const parChef = new Map<string, string[]>();
  for (const l of r.rows) {
    const chef = l.chef_id as string;
    const noms = parChef.get(chef) ?? [];
    if (!noms.includes(l.nom as string)) noms.push(l.nom as string);
    parChef.set(chef, noms);
  }
  const creees: NotificationCreee[] = [];
  for (const [chef, noms] of parChef) {
    if (!(await marquerRappel(db, cabinetId, chef, semaine, "relance_chef"))) continue;
    const liste =
      noms.slice(0, 20).join(", ") + (noms.length > 20 ? `… (+${noms.length - 20})` : "");
    const n = await notifier(db, {
      cabinetId,
      destinataireId: chef,
      type: "relance_feuilles_temps",
      titre: `${noms.length} feuille(s) de temps incomplète(s)`,
      corps: `Semaine du ${semaine} : feuilles non soumises pour ${liste}.`,
      lien: `/temps/validation`,
      email: true,
    });
    if (n) creees.push(n);
  }
  return creees;
}
