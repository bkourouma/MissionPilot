import { ajouterJours, arrondirAuPas, calculerDatesAuPlusTot } from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import { chargerDecoupage } from "../missions/decoupage.js";
import { aujourdhui, chargerCalendrier, nombre } from "../missions/outils.js";
import { versMoteurPlanning } from "../planification/outils.js";
import type { Db } from "./pool.js";

/*
 * Démonstration de la planification (données fictives) : affectations sur la
 * mission signée de démonstration (dont un profil à pourvoir), une absence
 * validée et une absence demandée. Idempotent : rien n'est recréé si la
 * mission a déjà des affectations, ou le consultant déjà des absences.
 */

const MISSION_DEMO = "Plan stratégique Transports Akwaba (démo)";
const DUREE_TACHE_DEMO = 10;
const JOURS_MAX_DEMO = 8;

async function idCollaborateur(db: Db, utilisateurId: string | undefined) {
  if (!utilisateurId) return undefined;
  const r = await db.query(
    `SELECT c.id, c.grade_id FROM collaborateurs c WHERE c.utilisateur_id = $1 AND c.actif`,
    [utilisateurId],
  );
  return r.rows[0] as { id: string; grade_id: string | null } | undefined;
}

async function semerAffectations(db: Db, cabinetId: string, ids: Map<Role, string>) {
  const m = await db.query(
    "SELECT id, date_debut::text AS date_debut FROM missions WHERE intitule = $1",
    [MISSION_DEMO],
  );
  const mission = m.rows[0] as { id: string; date_debut: string | null } | undefined;
  if (!mission?.date_debut) return;
  const deja = await db.query("SELECT 1 FROM affectations WHERE mission_id = $1 LIMIT 1", [
    mission.id,
  ]);
  if (deja.rowCount) return;

  // Deux premières tâches budgétées : durée réaliste, puis fenêtres par le moteur.
  const taches = await db.query(
    `SELECT t.id FROM mission_taches t JOIN mission_phases p ON p.id = t.phase_id
     WHERE t.mission_id = $1 AND EXISTS (SELECT 1 FROM tache_budget_lignes l WHERE l.tache_id = t.id)
     ORDER BY p.ordre, t.ordre, t.id LIMIT 2`,
    [mission.id],
  );
  if (taches.rows.length === 0) return;
  // Première tâche budgétée pour un junior : support du profil à pourvoir.
  const tacheJunior = await db.query(
    `SELECT t.id FROM mission_taches t JOIN mission_phases p ON p.id = t.phase_id
     JOIN tache_budget_lignes l ON l.tache_id = t.id JOIN grades g ON g.id = l.grade_id
     WHERE t.mission_id = $1 AND g.code = 'junior' AND l.jours > 0
     ORDER BY p.ordre, t.ordre, t.id LIMIT 1`,
    [mission.id],
  );
  const tJunior = tacheJunior.rows[0]?.id as string | undefined;
  for (const t of [...taches.rows, ...tacheJunior.rows]) {
    await db.query("UPDATE mission_taches SET duree_jours_ouvres = $2 WHERE id = $1", [
      t.id,
      DUREE_TACHE_DEMO,
    ]);
  }
  const d = await chargerDecoupage(db, mission.id);
  const { taches: moteur, dependances } = versMoteurPlanning(mission.date_debut, d);
  const dates = calculerDatesAuPlusTot(moteur, dependances, await chargerCalendrier(db, cabinetId));

  const budgetDuGrade = async (tacheId: string, gradeId: string | null) => {
    if (!gradeId) return 0;
    const r = await db.query(
      "SELECT jours::text AS jours FROM tache_budget_lignes WHERE tache_id = $1 AND grade_id = $2",
      [tacheId, gradeId],
    );
    return r.rows[0] ? nombre(r.rows[0].jours) : 0;
  };
  const auteur = ids.get("chef_mission") ?? null;
  const inserer = async (
    tacheId: string,
    cible: { collaborateurId: string | null; gradeId: string | null; competence: string | null },
  ) => {
    const fenetre = dates.get(tacheId);
    const budget = await budgetDuGrade(tacheId, cible.gradeId);
    if (!fenetre || budget <= 0) return;
    const jours = arrondirAuPas(Math.min(budget, JOURS_MAX_DEMO), "demi_journee");
    if (jours <= 0) return;
    await db.query(
      `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, grade_id,
         competence, jours_alloues, date_debut, date_fin, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        cabinetId,
        mission.id,
        tacheId,
        cible.collaborateurId,
        cible.collaborateurId ? null : cible.gradeId,
        cible.collaborateurId ? null : cible.competence,
        jours,
        fenetre.debut,
        fenetre.fin,
        auteur,
      ],
    );
  };

  const [t1, t2] = taches.rows.map((t) => t.id as string);
  for (const [role, tacheId] of [
    ["consultant", t1],
    ["chef_mission", t2 ?? t1],
  ] as const) {
    const c = await idCollaborateur(db, ids.get(role));
    if (!c || !tacheId) continue;
    await inserer(tacheId, { collaborateurId: c.id, gradeId: c.grade_id, competence: null });
    await db.query(
      `INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id, ajoute_par)
       VALUES ($1, $2, $3, $4) ON CONFLICT (mission_id, utilisateur_id) DO NOTHING`,
      [cabinetId, mission.id, ids.get(role), auteur],
    );
  }
  // Profil à pourvoir : un junior sur la première tâche qui en prévoit un.
  const junior = await db.query("SELECT id FROM grades WHERE code = 'junior'");
  if (junior.rows[0] && tJunior) {
    await inserer(tJunior, {
      collaborateurId: null,
      gradeId: junior.rows[0].id as string,
      competence: "Analyse de données",
    });
  }
}

async function semerAbsences(db: Db, cabinetId: string, ids: Map<Role, string>) {
  const consultant = ids.get("consultant");
  const valideur = ids.get("ressources");
  const c = await idCollaborateur(db, consultant);
  if (!c || !consultant || !valideur) return;
  const deja = await db.query("SELECT 1 FROM absences WHERE collaborateur_id = $1 LIMIT 1", [c.id]);
  if (deja.rowCount) return;
  const jour = aujourdhui();
  await db.query(
    `INSERT INTO absences (cabinet_id, collaborateur_id, demandeur_id, type, date_debut, date_fin,
       commentaire, statut, decide_par, decide_le)
     VALUES ($1, $2, $3, 'conge_paye', $4, $5, 'Congé de démonstration', 'validee', $6, now())`,
    [cabinetId, c.id, consultant, ajouterJours(jour, 30), ajouterJours(jour, 32), valideur],
  );
  await db.query(
    `INSERT INTO absences (cabinet_id, collaborateur_id, demandeur_id, type, date_debut, date_fin,
       commentaire)
     VALUES ($1, $2, $3, 'formation', $4, $5, 'Formation de démonstration')`,
    [cabinetId, c.id, consultant, ajouterJours(jour, 60), ajouterJours(jour, 61)],
  );
}

/** Affectations et absences de démonstration. Idempotent. */
export async function semerPlanification(
  db: Db,
  cabinetId: string,
  ids: Map<Role, string>,
): Promise<void> {
  await semerAffectations(db, cabinetId, ids);
  await semerAbsences(db, cabinetId, ids);
}
