import { sommerJours } from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { nombre } from "../missions/outils.js";

/**
 * Colonnes renvoyées pour une affectation (PLN-04, PLN-08) : jamais de coût
 * journalier, de taux ni de coût d'achat, même pour un expert externe.
 */
const COLONNES = `a.id, a.mission_id, a.tache_id, t.libelle AS tache_libelle, t.phase_id,
  a.collaborateur_id, c.nom AS collaborateur_nom, c.type AS collaborateur_type,
  coalesce(a.grade_id, c.grade_id) AS grade_id, g.code AS grade_code, g.libelle AS grade_libelle,
  a.competence, (a.collaborateur_id IS NULL) AS a_pourvoir, a.jours_alloues::float8 AS jours_alloues,
  a.date_debut::text AS date_debut, a.date_fin::text AS date_fin, a.cree_le, a.modifie_le`;
const DEPUIS = `affectations a
  JOIN mission_taches t ON t.id = a.tache_id
  LEFT JOIN collaborateurs c ON c.id = a.collaborateur_id
  LEFT JOIN grades g ON g.id = coalesce(a.grade_id, c.grade_id)`;

export async function lireAffectation(
  db: Db,
  missionId: string,
  id: string,
): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE a.id = $1 AND a.mission_id = $2`,
    [id, missionId],
  );
  if (!r.rows[0]) throw introuvable("Affectation");
  return r.rows[0];
}

/**
 * Page d'affectations d'une mission (F5), triée par (date de début, id) : la
 * clé de tri (`cle_tri`) est la date ISO, courte, ce qui garde le curseur
 * décodable. `apres` : clé de la dernière ligne servie ; `limite` : LIMIT.
 */
export async function listerAffectations(
  db: Db,
  missionId: string,
  apres: readonly [string, string] | null,
  limite: number,
): Promise<(Record<string, unknown> & { cle_tri: string; id: string })[]> {
  const r = await db.query(
    `SELECT ${COLONNES}, a.date_debut::text AS cle_tri FROM ${DEPUIS}
     WHERE a.mission_id = $1
       AND ($2::text IS NULL OR (a.date_debut::text, a.id) > ($2, $3::uuid))
     ORDER BY a.date_debut::text, a.id
     LIMIT $4`,
    [missionId, apres?.[0] ?? null, apres?.[1] ?? null, limite],
  );
  return r.rows;
}

export interface Avertissement {
  code: "DEPASSEMENT_BUDGET_TACHE";
  message: string;
  grade_code: string | null;
  budget_jours: number;
  jours_alloues: number;
}

/** Jours alloués par code de grade (« » pour une affectation sans grade) sur la mission. */
export async function joursAllouesParGrade(
  db: Db,
  missionId: string,
): Promise<Map<string, number>> {
  const r = await db.query(
    `SELECT coalesce(g.code, '') AS grade_code, a.jours_alloues::text AS jours
     FROM affectations a LEFT JOIN collaborateurs c ON c.id = a.collaborateur_id
     LEFT JOIN grades g ON g.id = coalesce(a.grade_id, c.grade_id)
     WHERE a.mission_id = $1`,
    [missionId],
  );
  return regrouper(r.rows.map((l) => [l.grade_code as string, nombre(l.jours)]));
}

function regrouper(couples: [string, number][]): Map<string, number> {
  const brut = new Map<string, number[]>();
  for (const [cle, jours] of couples) brut.set(cle, [...(brut.get(cle) ?? []), jours]);
  return new Map([...brut].map(([cle, v]) => [cle, sommerJours(v)]));
}

const total = (m: Map<string, number>) => sommerJours([...m.values()]);

/**
 * Compare les jours alloués d'une tâche à son budget en jours (PLN-02) pour
 * le grade de l'affectation : un dépassement donne un avertissement, pas un
 * refus. Sans grade (externe sans grade), la comparaison porte sur le total
 * de la tâche. Sommes au centième par le moteur.
 */
export async function avertissementsTache(
  db: Db,
  tacheId: string,
  gradeId: string | null,
): Promise<Avertissement[]> {
  const budget = await db.query(
    `SELECT l.jours::text AS jours FROM tache_budget_lignes l
     LEFT JOIN collaborateurs c ON c.id = l.collaborateur_id
     WHERE l.tache_id = $1 AND ($2::uuid IS NULL OR coalesce(l.grade_id, c.grade_id) = $2)`,
    [tacheId, gradeId],
  );
  const alloue = await db.query(
    `SELECT a.jours_alloues::text AS jours FROM affectations a
     LEFT JOIN collaborateurs c ON c.id = a.collaborateur_id
     WHERE a.tache_id = $1 AND ($2::uuid IS NULL OR coalesce(a.grade_id, c.grade_id) = $2)`,
    [tacheId, gradeId],
  );
  const budgetJours = sommerJours(budget.rows.map((l) => nombre(l.jours)));
  const alloueJours = sommerJours(alloue.rows.map((l) => nombre(l.jours)));
  if (alloueJours <= budgetJours) return [];
  const code =
    gradeId === null
      ? null
      : (((await db.query("SELECT code FROM grades WHERE id = $1", [gradeId])).rows[0]?.code as
          string | undefined) ?? null);
  return [
    {
      code: "DEPASSEMENT_BUDGET_TACHE",
      message:
        code === null
          ? `Les jours alloués sur la tâche (${alloueJours} j) dépassent son budget (${budgetJours} j).`
          : `Les jours alloués au grade « ${code} » sur la tâche (${alloueJours} j) dépassent son budget (${budgetJours} j).`,
      grade_code: code,
      budget_jours: budgetJours,
      jours_alloues: alloueJours,
    },
  ];
}

/**
 * Budget figé (FIN-03) : jours vendus par code de grade dans la dernière
 * version figée (initiale ou révision validée), lignes d'honoraires au temps.
 * Null si la mission n'a pas de budget figé ou si celui-ci n'a aucun jour par
 * grade (forfait global) : rien à contrôler.
 */
export async function joursFigesParGrade(
  db: Db,
  missionId: string,
): Promise<Map<string, number> | null> {
  const r = await db.query(
    `SELECT coalesce(l.grade_code, '') AS grade_code, l.jours::text AS jours FROM budget_lignes l
     WHERE l.version_id = (SELECT id FROM budget_versions WHERE mission_id = $1 AND figee
                           ORDER BY numero DESC LIMIT 1)
       AND l.nature = 'honoraires' AND l.jours IS NOT NULL`,
    [missionId],
  );
  if (r.rows.length === 0) return null;
  return regrouper(r.rows.map((l) => [l.grade_code as string, nombre(l.jours)]));
}

/**
 * Refuse (409 BUDGET_FIGE_DEPASSE) une écriture qui augmente les jours
 * alloués d'un grade au-delà du budget figé sans révision validée. Une
 * écriture qui réduit un dépassement existant reste permise. Une affectation
 * sans grade se compare au total figé.
 */
export function exigerDansBudgetFige(
  fige: Map<string, number> | null,
  avant: Map<string, number>,
  apres: Map<string, number>,
): void {
  if (!fige) return;
  const comparer = (alloueAvant: number, alloueApres: number, budget: number, quoi: string) => {
    if (alloueApres > budget && alloueApres > alloueAvant) {
      throw new AppError(
        409,
        "BUDGET_FIGE_DEPASSE",
        `Le budget signé prévoit ${budget} j ${quoi} ; ${alloueApres} j seraient alloués. Créer une révision du budget.`,
      );
    }
  };
  for (const [grade, jours] of apres) {
    if (grade === "") continue;
    comparer(avant.get(grade) ?? 0, jours, fige.get(grade) ?? 0, `pour le grade « ${grade} »`);
  }
  if (apres.has("")) comparer(total(avant), total(apres), total(fige), "au total");
}

/**
 * Budget figé et grade (F3) : le grade d'une affectation nominative est lu
 * sur le collaborateur ; le changer déplacerait ses jours alloués d'un grade à
 * l'autre et contournerait le contrôle du budget signé (exigerDansBudgetFige).
 * Refus 409 GRADE_BUDGET_FIGE tant que le collaborateur a une affectation sur
 * une mission non clôturée dont un budget est figé ; retirer l'affectation (ou
 * réviser le budget) d'abord. Sans changement effectif de grade : rien à
 * contrôler. La ligne du collaborateur est verrouillée : une affectation créée
 * en parallèle (clé étrangère) attend la fin de la transaction.
 */
export async function exigerGradeModifiable(
  db: Db,
  collaborateurId: string,
  gradeId: string | null | undefined,
): Promise<void> {
  if (gradeId === undefined) return;
  const c = await db.query("SELECT grade_id FROM collaborateurs WHERE id = $1 FOR UPDATE", [
    collaborateurId,
  ]);
  if (!c.rows[0] || c.rows[0].grade_id === gradeId) return;
  const r = await db.query(
    `SELECT 1 FROM affectations a JOIN missions m ON m.id = a.mission_id
     WHERE a.collaborateur_id = $1 AND m.statut <> 'cloturee'
       AND EXISTS (SELECT 1 FROM budget_versions v WHERE v.mission_id = m.id AND v.figee)
     LIMIT 1`,
    [collaborateurId],
  );
  if (r.rowCount) {
    throw new AppError(
      409,
      "GRADE_BUDGET_FIGE",
      "Ce collaborateur est affecté à une mission dont le budget est signé : retirer ses affectations ou réviser le budget avant de changer son grade.",
    );
  }
}
