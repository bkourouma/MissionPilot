import {
  calculerBudget,
  montant as montantMoteur,
  montantLigne,
  sommerJours,
  type Devise,
  type LigneBudget,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { ordonnerArbre } from "../routes/catalogue.js";
import { gradesParCode, nombre } from "./outils.js";

export const COLONNES_PROPOSITION = `p.id, p.opportunite_id, p.type_mission_id, p.numero, p.intitule,
  p.devise, p.date_reference::text AS date_reference, p.equipe, p.statut, p.validee_par, p.validee_le,
  p.envoyee_le, p.repondue_le, p.cree_par, p.cree_le, p.modifie_le`;

export async function exigerProposition(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES_PROPOSITION} FROM propositions p WHERE p.id = $1
     ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Proposition");
  return r.rows[0];
}

/**
 * Génère le contenu d'une proposition depuis le modèle d'un type (MIS-05) :
 * découpage, jours par grade et taux standard des grades dans la devise
 * (null si le grade n'a pas de taux dans cette devise : à renseigner).
 */
export async function remplirDepuisModele(
  db: Db,
  cabinetId: string,
  propositionId: string,
  typeId: string,
  devise: string,
): Promise<void> {
  const elements = await db.query(
    `SELECT id, parent_id, niveau, libelle, ordre, est_livrable, est_jalon, jours_par_grade
     FROM modele_elements WHERE type_mission_id = $1`,
    [typeId],
  );
  const type = await db.query("SELECT equipe_type FROM types_mission WHERE id = $1", [typeId]);
  const equipe = (type.rows[0]?.equipe_type ?? []) as { grade_code: string }[];
  const codes = [
    ...elements.rows.flatMap((e) => Object.keys(e.jours_par_grade as Record<string, number>)),
    ...equipe.map((m) => m.grade_code),
  ];
  const grades = await gradesParCode(db, codes);
  const nouveaux = new Map<string, string>();
  for (const e of ordonnerArbre(elements.rows) as Record<string, unknown>[]) {
    const r = await db.query(
      `INSERT INTO proposition_elements (cabinet_id, proposition_id, parent_id, niveau, libelle, ordre,
         est_livrable, est_jalon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        cabinetId,
        propositionId,
        e.parent_id === null ? null : nouveaux.get(e.parent_id as string),
        e.niveau,
        e.libelle,
        e.ordre,
        e.est_livrable,
        e.est_jalon,
      ],
    );
    nouveaux.set(e.id as string, r.rows[0].id);
    for (const [code, jours] of Object.entries(e.jours_par_grade as Record<string, number>)) {
      await db.query(
        `INSERT INTO proposition_lignes (cabinet_id, proposition_id, element_id, grade_id, jours)
         VALUES ($1, $2, $3, $4, $5)`,
        [cabinetId, propositionId, r.rows[0].id, grades.get(code), jours],
      );
    }
  }
  await db.query(
    `INSERT INTO proposition_taux (cabinet_id, proposition_id, grade_id, taux_journalier)
     SELECT $1, $2, g.id, CASE WHEN g.devise = $4 THEN g.taux_vente_standard END
     FROM grades g WHERE g.code = ANY ($3::text[])`,
    [cabinetId, propositionId, [...new Set(codes)], devise],
  );
}

/** Copie le contenu d'une proposition dans une nouvelle version (brouillon). */
export async function copierContenu(
  db: Db,
  cabinetId: string,
  sourceId: string,
  cibleId: string,
): Promise<void> {
  const elements = await db.query(
    `SELECT id, parent_id, niveau, libelle, ordre, est_livrable, est_jalon
     FROM proposition_elements WHERE proposition_id = $1`,
    [sourceId],
  );
  const nouveaux = new Map<string, string>();
  for (const e of ordonnerArbre(elements.rows) as Record<string, unknown>[]) {
    const r = await db.query(
      `INSERT INTO proposition_elements (cabinet_id, proposition_id, parent_id, niveau, libelle, ordre,
         est_livrable, est_jalon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        cabinetId,
        cibleId,
        e.parent_id === null ? null : nouveaux.get(e.parent_id as string),
        e.niveau,
        e.libelle,
        e.ordre,
        e.est_livrable,
        e.est_jalon,
      ],
    );
    nouveaux.set(e.id as string, r.rows[0].id);
  }
  const lignes = await db.query(
    "SELECT element_id, grade_id, jours FROM proposition_lignes WHERE proposition_id = $1",
    [sourceId],
  );
  for (const l of lignes.rows) {
    await db.query(
      `INSERT INTO proposition_lignes (cabinet_id, proposition_id, element_id, grade_id, jours)
       VALUES ($1, $2, $3, $4, $5)`,
      [cabinetId, cibleId, nouveaux.get(l.element_id), l.grade_id, l.jours],
    );
  }
  await db.query(
    `INSERT INTO proposition_taux (cabinet_id, proposition_id, grade_id, taux_journalier)
     SELECT $1, $3, grade_id, taux_journalier FROM proposition_taux WHERE proposition_id = $2`,
    [cabinetId, sourceId, cibleId],
  );
}

export interface Chiffrage {
  devise: string;
  jours_total: number;
  honoraires_total: number;
  par_grade: {
    grade_code: string;
    jours: number;
    taux_journalier: number | null;
    montant: number | null;
  }[];
  /** Grades chiffrés en jours sans taux de vente : la proposition ne peut pas être validée. */
  taux_manquants: string[];
}

/** Détail de la proposition et chiffrage par le moteur finance (jours × taux). */
export async function detailProposition(
  db: Db,
  proposition: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = proposition.id as string;
  const devise = proposition.devise as Devise;
  const elements = await db.query(
    `SELECT id, parent_id, niveau, libelle, ordre, est_livrable, est_jalon
     FROM proposition_elements WHERE proposition_id = $1`,
    [id],
  );
  const lignes = await db.query(
    `SELECT l.element_id, g.code AS grade_code, l.jours::float8 AS jours
     FROM proposition_lignes l JOIN grades g ON g.id = l.grade_id
     WHERE l.proposition_id = $1 ORDER BY g.ordre, g.code`,
    [id],
  );
  const taux = await db.query(
    `SELECT g.code AS grade_code, t.taux_journalier FROM proposition_taux t
     JOIN grades g ON g.id = t.grade_id WHERE t.proposition_id = $1 ORDER BY g.ordre, g.code`,
    [id],
  );
  const tauxParGrade = new Map<string, number | null>(
    taux.rows.map((t) => [
      t.grade_code,
      t.taux_journalier === null ? null : nombre(t.taux_journalier),
    ]),
  );
  const joursParElement = (elementId: string) =>
    Object.fromEntries(
      lignes.rows.filter((l) => l.element_id === elementId).map((l) => [l.grade_code, l.jours]),
    );
  return {
    ...proposition,
    elements: ordonnerArbre(elements.rows).map((e: Record<string, unknown>) => ({
      ...e,
      jours_par_grade: joursParElement(e.id as string),
    })),
    taux: Object.fromEntries(tauxParGrade),
    chiffrage: chiffrer(devise, lignes.rows, tauxParGrade),
  };
}

export function chiffrer(
  devise: Devise,
  lignes: { grade_code: string; jours: number }[],
  taux: Map<string, number | null>,
): Chiffrage {
  const codes = [...new Set(lignes.map((l) => l.grade_code))];
  const parGrade = codes.map((code) => ({
    grade_code: code,
    jours: sommerJours(lignes.filter((l) => l.grade_code === code).map((l) => l.jours)),
    taux_journalier: taux.get(code) ?? null,
  }));
  const lignesMoteur: LigneBudget[] = parGrade
    .filter((g) => g.taux_journalier !== null)
    .map((g) => ({
      id: g.grade_code,
      libelle: g.grade_code,
      nature: "honoraires",
      grade: g.grade_code,
      valeur: {
        type: "jours",
        jours: g.jours,
        prixJournalier: montantMoteur(g.taux_journalier as number, devise),
      },
    }));
  const synthese = calculerBudget({
    id: "chiffrage",
    numero: 1,
    type: "initial",
    devise,
    figee: false,
    lignes: lignesMoteur,
  });
  return {
    devise,
    jours_total: sommerJours(parGrade.map((g) => g.jours)),
    honoraires_total: synthese.honoraires.valeur,
    par_grade: parGrade.map((g) => {
      const ligne = lignesMoteur.find((l) => l.id === g.grade_code);
      return { ...g, montant: ligne ? montantLigne(ligne, devise).valeur : null };
    }),
    taux_manquants: parGrade
      .filter((g) => g.taux_journalier === null && g.jours > 0)
      .map((g) => g.grade_code),
  };
}
