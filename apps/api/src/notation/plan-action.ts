import {
  prioriserInitiatives,
  type InitiativeType,
  type PlanActionPriorise,
} from "@missionpilot/engines";
import type { PlanActionNotation } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable } from "../errors.js";
import { clauseSet } from "../db/outils.js";
import { paginer } from "../http/outils.js";
import { exigerMissionOuverte } from "../questionnaires/acces.js";
import { versionOu404 } from "./explication.js";
import type { Notation } from "./notations.js";

/*
 * Plan d'action d'une notation (NOT-17, migration 0403). RÈGLES (testées dans
 * test/notation-augmentee.test.ts) :
 *
 * 1. Bibliothèque d'initiatives types du cabinet (`notation_initiatives_types`), rédigée par
 *    notation.gerer ou notation.publier ; une initiative se retire (active = false), jamais ne
 *    se supprime ; les gains observés par contexte sont en ajout seul (MPN12).
 *    Rapprochement à faire avec la bibliothèque PLA-13 du plan stratégique (0420–0439).
 * 2. La priorisation sort du moteur `prioriserInitiatives` (besoin de la note ajustée, impact
 *    observé dans le contexte le plus semblable, effort, capacité du client) sur les initiatives
 *    ACTIVES ; la proposition se lit sans rien écrire.
 * 3. Un plan enregistré fige la sortie du moteur, le contexte et la capacité (ajout seul, rang
 *    consécutif, version de la même notation : MPN12), sur une mission ouverte (notation.gerer).
 */

/** Au-delà, la priorisation est refusée (jamais tronquée) : retirer des initiatives inactives. */
export const INITIATIVES_PRIORISEES_MAX = 500;

export async function listerInitiatives(
  db: Db,
  actives: boolean | undefined,
  apres: [string, string] | null,
  limite: number,
) {
  const r = await db.query(
    `SELECT t.id, t.code, t.titre, t.description, t.dimensions, t.effort, t.duree_mois, t.active,
       t.cree_le, t.modifie_le, t.code AS cle_tri,
       (SELECT count(*) FROM notation_initiatives_impacts x WHERE x.initiative_id = t.id) AS impacts
     FROM notation_initiatives_types t
     WHERE ($1::text IS NULL OR (t.code, t.id) > ($1, $2::uuid)) AND ($3::boolean IS NULL OR t.active = $3)
     ORDER BY t.code, t.id LIMIT $4`,
    [apres?.[0] ?? null, apres?.[1] ?? null, actives ?? null, limite + 1],
  );
  return paginer(
    r.rows.map((l) => ({ ...l, impacts: Number(l.impacts) })) as { cle_tri: string; id: string }[],
    limite,
  );
}

export async function lireInitiative(db: Db, id: string) {
  const r = await db.query(
    `SELECT t.id, t.code, t.titre, t.description, t.dimensions, t.effort, t.duree_mois, t.active,
       t.cree_par, t.cree_le, t.modifie_le FROM notation_initiatives_types t WHERE t.id = $1`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Initiative type");
  const i = await db.query(
    `SELECT x.id, x.secteur, x.taille, x.gain::float8 AS gain, x.source, x.observe_le::text AS observe_le,
       u.nom AS saisi_par_nom, x.cree_le
     FROM notation_initiatives_impacts x JOIN utilisateurs u ON u.id = x.saisi_par
     WHERE x.initiative_id = $1 ORDER BY x.observe_le DESC, x.id`,
    [id],
  );
  return { ...r.rows[0], impacts: i.rows };
}

export async function creerInitiative(
  db: Db,
  auth: Auth,
  corps: {
    code: string;
    titre: string;
    description?: string | null;
    dimensions: string[];
    effort: number;
    duree_mois: number;
  },
) {
  const r = await db.query(
    `INSERT INTO notation_initiatives_types (cabinet_id, code, titre, description, dimensions,
       effort, duree_mois, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      corps.code,
      corps.titre,
      corps.description ?? null,
      corps.dimensions,
      corps.effort,
      corps.duree_mois,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "notation_initiative_type",
    entiteId: id,
    details: { code: corps.code },
  });
  return lireInitiative(db, id);
}

export async function modifierInitiative(
  db: Db,
  auth: Auth,
  id: string,
  corps: Record<string, unknown>,
) {
  await lireInitiative(db, id);
  const set = clauseSet(corps, 2);
  await db.query(`UPDATE notation_initiatives_types SET ${set.sql} WHERE id = $1`, [
    id,
    ...set.valeurs,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification",
    entite: "notation_initiative_type",
    entiteId: id,
    details: { champs: Object.keys(corps) },
  });
  return lireInitiative(db, id);
}

export async function ajouterImpact(
  db: Db,
  auth: Auth,
  id: string,
  corps: {
    secteur: string | null;
    taille: string | null;
    gain: number;
    source: string;
    observe_le: string;
  },
) {
  await lireInitiative(db, id);
  await db.query(
    `INSERT INTO notation_initiatives_impacts (cabinet_id, initiative_id, secteur, taille, gain,
       source, observe_le, saisi_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      id,
      corps.secteur,
      corps.taille,
      corps.gain,
      corps.source,
      corps.observe_le,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "impact_observe",
    entite: "notation_initiative_type",
    entiteId: id,
    details: { secteur: corps.secteur, taille: corps.taille, gain: corps.gain },
  });
  return lireInitiative(db, id);
}

/** Initiatives ACTIVES et leurs gains observés, au format du moteur. */
async function initiativesActives(db: Db): Promise<InitiativeType[]> {
  const r = await db.query(
    `SELECT t.code, t.titre, t.dimensions, t.effort, t.duree_mois,
       coalesce((SELECT jsonb_agg(jsonb_build_object('secteur', x.secteur, 'taille', x.taille,
                   'gain', x.gain) ORDER BY x.id)
                 FROM notation_initiatives_impacts x WHERE x.initiative_id = t.id), '[]'::jsonb) AS impacts
     FROM notation_initiatives_types t WHERE t.active ORDER BY t.code LIMIT $1`,
    [INITIATIVES_PRIORISEES_MAX + 1],
  );
  if (r.rows.length > INITIATIVES_PRIORISEES_MAX) {
    throw conflit(
      "Bibliothèque d'initiatives trop volumineuse : retirez des initiatives inactives.",
    );
  }
  return r.rows.map((l) => ({
    code: l.code,
    titre: l.titre,
    dimensions: l.dimensions,
    effort: l.effort,
    dureeMois: l.duree_mois,
    impacts: (
      l.impacts as { secteur: string | null; taille: string | null; gain: string | number }[]
    ).map((x) => ({ secteur: x.secteur, taille: x.taille, gain: Number(x.gain) })),
  }));
}

function vuePlan(p: PlanActionPriorise) {
  return {
    capacite: p.capacite,
    capacite_utilisee: p.capaciteUtilisee,
    initiatives: p.initiatives.map((i) => ({
      code: i.code,
      titre: i.titre,
      rang: i.rang,
      priorite: i.priorite,
      besoin: i.besoin,
      impact: i.impact,
      source_impact: i.sourceImpact,
      observations: i.observations,
      effort: i.effort,
      duree_mois: i.dureeMois,
      dimensions: i.dimensions,
      retenue: i.retenue,
      motif: i.motif,
    })),
  };
}

/** Proposition de plan priorisé pour une version (défaut : la dernière), sans écriture. */
export async function proposerPlan(db: Db, notation: Notation, q: PlanActionNotation) {
  const v = await versionOu404(db, notation, q.version);
  const contexte = { secteur: q.secteur ?? v.version.secteur ?? null, taille: q.taille ?? null };
  const plan = prioriserInitiatives(v.etat, await initiativesActives(db), contexte, {
    capacite: q.capacite,
    ...(q.max_initiatives !== undefined ? { maxInitiatives: q.max_initiatives } : {}),
  });
  return { version_id: v.version.id, numero: v.version.numero, contexte, ...vuePlan(plan) };
}

/** Enregistre le plan proposé (ajout seul), mission ouverte. */
export async function enregistrerPlan(
  db: Db,
  auth: Auth,
  notation: Notation,
  q: PlanActionNotation,
) {
  await exigerMissionOuverte(db, auth, notation.mission_id);
  const p = await proposerPlan(db, notation, q);
  const r = await db.query(
    `INSERT INTO notation_plans_action (cabinet_id, notation_id, version_id, rang, capacite, contexte,
       contenu, cree_par)
     VALUES ($1, $2, $3, coalesce((SELECT max(rang) FROM notation_plans_action WHERE notation_id = $2), 0) + 1,
       $4, $5, $6, $7) RETURNING id, rang, cree_le`,
    [
      auth.cabinetId,
      notation.id,
      p.version_id,
      p.capacite,
      JSON.stringify(p.contexte),
      JSON.stringify({ capacite_utilisee: p.capacite_utilisee, initiatives: p.initiatives }),
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan_action",
    entite: "notation",
    entiteId: notation.id,
    details: {
      plan_id: r.rows[0].id,
      numero: p.numero,
      retenues: p.initiatives.filter((i) => i.retenue).map((i) => i.code),
    },
  });
  return { id: r.rows[0].id, rang: r.rows[0].rang, cree_le: r.rows[0].cree_le, ...p };
}

/** Plans enregistrés d'une notation, plus récents d'abord. */
export async function listerPlans(
  db: Db,
  notation: Notation,
  apres: [string, string] | null,
  limite: number,
) {
  const r = await db.query(
    `SELECT p.id, p.rang, v.numero, p.capacite, p.contexte, p.contenu, u.nom AS cree_par_nom,
       p.cree_le, lpad(p.rang::text, 6, '0') AS cle_tri
     FROM notation_plans_action p JOIN notation_versions v ON v.id = p.version_id
     JOIN utilisateurs u ON u.id = p.cree_par
     WHERE p.notation_id = $1 AND ($2::text IS NULL OR (lpad(p.rang::text, 6, '0'), p.id) < ($2, $3::uuid))
     ORDER BY p.rang DESC, p.id DESC LIMIT $4`,
    [notation.id, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return paginer(r.rows as { cle_tri: string; id: string }[], limite);
}
