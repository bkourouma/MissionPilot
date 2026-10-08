import { randomUUID } from "node:crypto";
import {
  agregerArborescence,
  sommerJours,
  type NoeudAgrege,
  type NoeudPlanning,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { ordonnerArbre } from "../routes/catalogue.js";
import { gradesParCode, nombre } from "./outils.js";

/** Élément source d'un découpage (modèle du catalogue ou proposition) : 1 phase, 2 lot, 3 tâche. */
export interface ElementSource {
  id: string;
  parent_id: string | null;
  niveau: number;
  libelle: string;
  ordre: number;
  est_livrable: boolean;
  est_jalon: boolean;
  /** Jours par identifiant de grade. */
  jours: Map<string, number>;
}

interface Insere {
  phaseId: string;
  lotId: string | null;
}

async function insererTache(
  db: Db,
  cabinetId: string,
  missionId: string,
  parent: Insere,
  e: ElementSource,
): Promise<void> {
  const t = await db.query(
    `INSERT INTO mission_taches (cabinet_id, mission_id, phase_id, lot_id, libelle, ordre, est_livrable)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [cabinetId, missionId, parent.phaseId, parent.lotId, e.libelle, e.ordre, e.est_livrable],
  );
  for (const [gradeId, jours] of e.jours) {
    await db.query(
      `INSERT INTO tache_budget_lignes (cabinet_id, mission_id, tache_id, grade_id, jours)
       VALUES ($1, $2, $3, $4, $5)`,
      [cabinetId, missionId, t.rows[0].id, gradeId, jours],
    );
  }
}

/**
 * Copie un découpage source dans la mission : niveau 1 → phase, 2 → lot,
 * 3 → tâche. Des jours portés par une phase ou un lot (sans tâche) deviennent
 * une tâche du même libellé, pour ne perdre aucun jour. Un élément marqué
 * jalon crée aussi un jalon de sa phase.
 */
export async function copierElements(
  db: Db,
  cabinetId: string,
  missionId: string,
  elements: ElementSource[],
): Promise<void> {
  const inseres = new Map<string, Insere>();
  for (const e of ordonnerArbre(elements)) {
    const parent = e.parent_id === null ? undefined : inseres.get(e.parent_id);
    let cible: Insere;
    if (e.niveau === 1) {
      const p = await db.query(
        `INSERT INTO mission_phases (cabinet_id, mission_id, libelle, ordre) VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [cabinetId, missionId, e.libelle, e.ordre],
      );
      cible = { phaseId: p.rows[0].id, lotId: null };
    } else if (e.niveau === 2 && parent) {
      const l = await db.query(
        `INSERT INTO mission_lots (cabinet_id, mission_id, phase_id, libelle, ordre, est_livrable)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [cabinetId, missionId, parent.phaseId, e.libelle, e.ordre, e.est_livrable],
      );
      cible = { phaseId: parent.phaseId, lotId: l.rows[0].id };
    } else if (e.niveau === 3 && parent) {
      await insererTache(db, cabinetId, missionId, parent, e);
      cible = parent;
    } else {
      continue;
    }
    if (e.niveau < 3 && e.jours.size > 0) await insererTache(db, cabinetId, missionId, cible, e);
    if (e.est_jalon) {
      await db.query(
        `INSERT INTO mission_jalons (cabinet_id, mission_id, phase_id, libelle, ordre)
         VALUES ($1, $2, $3, $4, $5)`,
        [cabinetId, missionId, cible.phaseId, e.libelle, e.ordre],
      );
    }
    inseres.set(e.id, cible);
  }
}

/** Modèle d'un type du catalogue, jours par grade traduits en identifiants de grade. */
export async function elementsDuModele(db: Db, typeId: string): Promise<ElementSource[]> {
  const r = await db.query(
    `SELECT id, parent_id, niveau, libelle, ordre, est_livrable, est_jalon, jours_par_grade
     FROM modele_elements WHERE type_mission_id = $1`,
    [typeId],
  );
  const codes = r.rows.flatMap((e) => Object.keys(e.jours_par_grade as Record<string, number>));
  const grades = await gradesParCode(db, codes);
  return r.rows.map((e) => ({
    ...e,
    jours: new Map(
      Object.entries(e.jours_par_grade as Record<string, number>)
        .filter(([, j]) => j > 0)
        .map(([code, j]) => [grades.get(code) as string, j]),
    ),
  })) as ElementSource[];
}

/** Découpage d'une proposition, avec ses jours par grade. */
export async function elementsDeProposition(
  db: Db,
  propositionId: string,
): Promise<ElementSource[]> {
  const r = await db.query(
    `SELECT id, parent_id, niveau, libelle, ordre, est_livrable, est_jalon
     FROM proposition_elements WHERE proposition_id = $1`,
    [propositionId],
  );
  const lignes = await db.query(
    `SELECT element_id, grade_id, jours::text AS jours FROM proposition_lignes
     WHERE proposition_id = $1 AND jours > 0`,
    [propositionId],
  );
  const parElement = new Map<string, Map<string, number>>();
  for (const l of lignes.rows) {
    const m = parElement.get(l.element_id) ?? new Map<string, number>();
    m.set(l.grade_id, nombre(l.jours));
    parElement.set(l.element_id, m);
  }
  return r.rows.map((e) => ({ ...e, jours: parElement.get(e.id) ?? new Map() })) as ElementSource[];
}

/** Copie tout le découpage d'une mission vers une autre (duplication, MIS-12). */
export async function dupliquerDecoupage(
  db: Db,
  cabinetId: string,
  sourceId: string,
  cibleId: string,
): Promise<void> {
  const d = await chargerDecoupage(db, sourceId);
  const nouveaux = new Map<string, string>();
  const nouvel = (ancien: unknown): string | null => {
    if (ancien === null || ancien === undefined) return null;
    const id = nouveaux.get(ancien as string) ?? randomUUID();
    nouveaux.set(ancien as string, id);
    return id;
  };
  for (const p of d.phases) {
    await db.query(
      `INSERT INTO mission_phases (id, cabinet_id, mission_id, libelle, ordre) VALUES ($1, $2, $3, $4, $5)`,
      [nouvel(p.id), cabinetId, cibleId, p.libelle, p.ordre],
    );
  }
  for (const l of d.lots) {
    await db.query(
      `INSERT INTO mission_lots (id, cabinet_id, mission_id, phase_id, libelle, ordre, est_livrable)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [nouvel(l.id), cabinetId, cibleId, nouvel(l.phase_id), l.libelle, l.ordre, l.est_livrable],
    );
  }
  for (const t of d.taches) {
    await db.query(
      `INSERT INTO mission_taches (id, cabinet_id, mission_id, phase_id, lot_id, libelle, ordre,
         est_livrable, duree_jours_ouvres)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        nouvel(t.id),
        cabinetId,
        cibleId,
        nouvel(t.phase_id),
        nouvel(t.lot_id),
        t.libelle,
        t.ordre,
        t.est_livrable,
        t.duree_jours_ouvres,
      ],
    );
  }
  for (const j of d.jalons) {
    await db.query(
      `INSERT INTO mission_jalons (cabinet_id, mission_id, phase_id, libelle, ordre)
       VALUES ($1, $2, $3, $4, $5)`,
      [cabinetId, cibleId, nouvel(j.phase_id), j.libelle, j.ordre],
    );
  }
  for (const l of d.lignes) {
    await db.query(
      `INSERT INTO tache_budget_lignes (cabinet_id, mission_id, tache_id, grade_id, collaborateur_id, jours)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [cabinetId, cibleId, nouvel(l.tache_id), l.grade_id, l.collaborateur_id, l.jours],
    );
  }
  for (const dep of d.dependances) {
    await db.query(
      `INSERT INTO mission_dependances (cabinet_id, mission_id, predecesseur_id, successeur_id, decalage)
       VALUES ($1, $2, $3, $4, $5)`,
      [cabinetId, cibleId, nouvel(dep.predecesseur_id), nouvel(dep.successeur_id), dep.decalage],
    );
  }
}

/* ----- Lecture et agrégation ----- */

export interface Decoupage {
  phases: Record<string, unknown>[];
  lots: Record<string, unknown>[];
  taches: Record<string, unknown>[];
  jalons: Record<string, unknown>[];
  lignes: Record<string, unknown>[];
  dependances: Record<string, unknown>[];
}

export async function chargerDecoupage(db: Db, missionId: string): Promise<Decoupage> {
  // Requêtes successives : un client pg n'exécute qu'une requête à la fois.
  const q = async (sql: string) => (await db.query(sql, [missionId])).rows;
  return {
    phases: await q(
      `SELECT id, libelle, ordre FROM mission_phases WHERE mission_id = $1 ORDER BY ordre, libelle, id`,
    ),
    lots: await q(`SELECT id, phase_id, libelle, ordre, est_livrable FROM mission_lots
       WHERE mission_id = $1 ORDER BY ordre, libelle, id`),
    taches: await q(`SELECT id, phase_id, lot_id, libelle, ordre, est_livrable,
         date_debut::text AS date_debut, duree_jours_ouvres
       FROM mission_taches WHERE mission_id = $1 ORDER BY ordre, libelle, id`),
    jalons: await q(`SELECT id, phase_id, libelle, date_prevue::text AS date_prevue, atteint, ordre
       FROM mission_jalons WHERE mission_id = $1 ORDER BY ordre, libelle, id`),
    lignes: await q(`SELECT l.id, l.tache_id, l.grade_id, g.code AS grade_code, l.collaborateur_id,
         c.nom AS collaborateur_nom, l.jours::float8 AS jours
       FROM tache_budget_lignes l LEFT JOIN grades g ON g.id = l.grade_id
       LEFT JOIN collaborateurs c ON c.id = l.collaborateur_id
       WHERE l.mission_id = $1 ORDER BY g.code NULLS LAST, c.nom, l.id`),
    dependances:
      await q(`SELECT id, predecesseur_id, successeur_id, decalage FROM mission_dependances
       WHERE mission_id = $1 ORDER BY cree_le, id`),
  };
}

/** Jours budgétés par tâche (somme des lignes, au centième, via le moteur). */
export function joursParTache(lignes: Record<string, unknown>[]): Map<string, number> {
  const brut = new Map<string, number[]>();
  for (const l of lignes) {
    const id = l.tache_id as string;
    brut.set(id, [...(brut.get(id) ?? []), nombre(l.jours)]);
  }
  return new Map([...brut].map(([id, valeurs]) => [id, sommerJours(valeurs)]));
}

/**
 * Arborescence agrégée mission > phase > lot > tâche (PLN-02) par le moteur
 * planning. Sans temps saisis (vague « temps » à venir), le réalisé vaut 0 et
 * le reste à faire vaut le budget : l'atterrissage égale le budget.
 */
export function agregerDecoupage(missionId: string, d: Decoupage): NoeudAgrege {
  const jours = joursParTache(d.lignes);
  const feuille = (t: Record<string, unknown>): NoeudPlanning => {
    const budget = jours.get(t.id as string) ?? 0;
    return {
      id: t.id as string,
      niveau: "tache",
      libelle: t.libelle as string,
      budget,
      realise: 0,
      resteAFaire: budget,
    };
  };
  const racine: NoeudPlanning = {
    id: missionId,
    niveau: "mission",
    enfants: d.phases.map((p) => ({
      id: p.id as string,
      niveau: "phase",
      libelle: p.libelle as string,
      enfants: [
        ...d.lots
          .filter((l) => l.phase_id === p.id)
          .map((l): NoeudPlanning => ({
            id: l.id as string,
            niveau: "lot",
            libelle: l.libelle as string,
            enfants: d.taches.filter((t) => t.lot_id === l.id).map(feuille),
          })),
        ...d.taches.filter((t) => t.phase_id === p.id && t.lot_id === null).map(feuille),
      ],
    })),
  };
  return agregerArborescence(racine);
}
