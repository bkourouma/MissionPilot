import type { ContexteTenantDemo } from "../contexte.js";

/*
 * Lecture du CASTING des 11 missions du Tenant démo (créées par la phase `missions`, lot 2a) pour
 * la phase `gestion`. Les missions se retrouvent par leur `intitule` EXACT (brief commun) ; rien
 * n'est créé ici. Lecture seule par le client propriétaire (filtre `cabinet_id` explicite).
 */

/** Clés courtes des 11 missions du casting, et leur intitulé EXACT. */
export const MISSIONS_CASTING = {
  "sicafe-plan": "Plan stratégique 2025-2028 — SICAFE",
  "sahel-coton-notation": "Notation financière — Sahel Coton",
  "wouri-redressement": "Redressement — Brasseries du Wouri",
  "mboa-dd": "Due diligence — Mboa Solaire",
  "atlantique-bp": "Business plan bancable — Atlantique Retail",
  "baobab-plan": "Plan stratégique 2026-2030 — Baobab Assurances",
  "gabon-redressement": "Redressement — Gabon Offshore Services",
  "teranga-flash": "Diagnostic flash — Teranga Logistique",
  "banque-sahel-notation": "Notation financière — Banque du Sahel (portefeuille PME)",
  "sicafe-export-plan": "Plan stratégique — Sicafe Export",
  "wouri-dd": "Due diligence — Wouri Distribution",
} as const;
export type CleMission = keyof typeof MISSIONS_CASTING;
export const CLES_MISSIONS = Object.keys(MISSIONS_CASTING) as CleMission[];

/** Les 5 missions TERMINÉES (clôturées, facturées et encaissées). */
export const MISSIONS_TERMINEES: readonly CleMission[] = [
  "sicafe-plan",
  "sahel-coton-notation",
  "wouri-redressement",
  "mboa-dd",
  "atlantique-bp",
];
/** Missions EN COURS (staffées, temps saisis jusqu'à aujourd'hui). */
export const MISSIONS_EN_COURS: readonly CleMission[] = [
  "baobab-plan",
  "gabon-redressement",
  "teranga-flash",
  "banque-sahel-notation",
];
/** La mission en DÉPASSEMENT de budget (démo : alertes de suivi, marge négative). */
export const MISSION_DEPASSEMENT: CleMission = "gabon-redressement";

/** Mission du client `cle` -> clé de client (`CLES_CLIENTS`). */
export const CLIENT_DE_MISSION: Record<CleMission, string> = {
  "sicafe-plan": "sicafe",
  "sahel-coton-notation": "sahel-coton",
  "wouri-redressement": "brasseries-wouri",
  "mboa-dd": "mboa-solaire",
  "atlantique-bp": "atlantique-retail",
  "baobab-plan": "baobab-assurances",
  "gabon-redressement": "gabon-offshore",
  "teranga-flash": "teranga-logistique",
  "banque-sahel-notation": "banque-sahel",
  "sicafe-export-plan": "sicafe-export",
  "wouri-dd": "wouri-distribution",
};

export interface TacheLue {
  id: string;
  libelle: string;
  phase: string;
}

export interface AffectationLue {
  id: string;
  tacheId: string;
  collaborateurId: string;
  /** Compte utilisateur du collaborateur (null : sans compte, ne peut pas saisir ses temps). */
  utilisateurId: string | null;
  grade: string;
  joursAlloues: number;
  debut: string;
  fin: string;
}

export interface MissionLue {
  cle: CleMission;
  id: string;
  nom: string;
  clientId: string;
  statut: string;
  terminee: boolean;
  /** Dates de la mission (peuvent être nulles pour une mission en préparation). */
  debut: string | null;
  fin: string | null;
  dateSignature: string | null;
  devise: string;
  mode: string;
  directeurId: string | null;
  chefId: string | null;
  taches: TacheLue[];
  affectations: AffectationLue[];
  /** Jours budgétés (budget initial figé) par code de grade. */
  budgetJours: Record<string, number>;
  /** Honoraires du budget initial figé (somme jours x prix journalier, entiers), 0 si non signée. */
  budgetHonoraires: number;
  /** Honoraires de la dernière version de budget figée (initial + avenants validés), 0 si non signée. */
  budgetCourantHonoraires: number;
  /** Débours refacturables et sous-traitance du budget courant (montants forfaitaires, entiers). */
  budgetDeboursRefacturables: number;
}

export interface Casting {
  missions: Partial<Record<CleMission, MissionLue>>;
  /** Missions du casting introuvables (la phase doit alors les ignorer, avec un avertissement). */
  absentes: CleMission[];
}

/** Lit les missions du casting et leurs tâches, affectations et budget initial. */
export async function lireCasting(ctx: ContexteTenantDemo): Promise<Casting> {
  const q = (sql: string, p: unknown[]) => ctx.proprietaire.query(sql, p);
  const missions: Casting["missions"] = {};
  const absentes: CleMission[] = [];
  for (const cle of CLES_MISSIONS) {
    const nom = MISSIONS_CASTING[cle];
    const m = (
      await q(
        `SELECT id, client_id, statut, date_debut::text AS debut, date_fin::text AS fin,
                date_signature::text AS signature, devise, mode_facturation, directeur_id, chef_id
           FROM missions WHERE cabinet_id = $1 AND intitule = $2`,
        [ctx.cabinetId, nom],
      )
    ).rows[0];
    if (!m) {
      absentes.push(cle);
      continue;
    }
    const taches = (
      await q(
        `SELECT t.id, t.libelle, p.libelle AS phase FROM mission_taches t
           JOIN mission_phases p ON p.id = t.phase_id
          WHERE t.cabinet_id = $1 AND t.mission_id = $2 ORDER BY p.ordre, t.ordre, t.id`,
        [ctx.cabinetId, m.id],
      )
    ).rows;
    const affectations = (
      await q(
        `SELECT a.id, a.tache_id, a.collaborateur_id, c.utilisateur_id, g.code AS grade,
                a.jours_alloues::float8 AS jours, a.date_debut::text AS debut, a.date_fin::text AS fin
           FROM affectations a
           JOIN collaborateurs c ON c.id = a.collaborateur_id
           JOIN grades g ON g.id = c.grade_id
          WHERE a.cabinet_id = $1 AND a.mission_id = $2 ORDER BY a.date_debut, a.id`,
        [ctx.cabinetId, m.id],
      )
    ).rows;
    const budget = (
      await q(
        `SELECT l.grade_code, l.jours::float8 AS jours, l.prix_journalier::float8 AS prix
           FROM budget_lignes l JOIN budget_versions v ON v.id = l.version_id
          WHERE v.cabinet_id = $1 AND v.mission_id = $2 AND v.type = 'initial'
            AND l.nature = 'honoraires'`,
        [ctx.cabinetId, m.id],
      )
    ).rows;
    const courant = (
      await q(
        `SELECT l.nature, l.jours::float8 AS jours, l.prix_journalier::float8 AS prix,
                l.montant_forfait::float8 AS forfait, l.refacturable
           FROM budget_lignes l
          WHERE l.cabinet_id = $1 AND l.mission_id = $2
            AND l.version_id = (SELECT v.id FROM budget_versions v
                                 WHERE v.cabinet_id = $1 AND v.mission_id = $2 AND v.figee
                                 ORDER BY v.numero DESC LIMIT 1)`,
        [ctx.cabinetId, m.id],
      )
    ).rows;
    const budgetCourantHonoraires = courant
      .filter((l) => l.nature === "honoraires")
      .reduce((s, l) => s + Math.round(l.jours * l.prix), 0);
    const budgetDeboursRefacturables = courant
      .filter((l) => l.nature === "debours" && l.refacturable)
      .reduce((s, l) => s + (l.forfait ?? 0), 0);
    const budgetJours: Record<string, number> = {};
    let budgetHonoraires = 0;
    for (const l of budget) {
      if (l.grade_code) budgetJours[l.grade_code] = (budgetJours[l.grade_code] ?? 0) + l.jours;
      budgetHonoraires += Math.round(l.jours * l.prix);
    }
    missions[cle] = {
      cle,
      id: m.id,
      nom,
      clientId: m.client_id,
      statut: m.statut,
      terminee: MISSIONS_TERMINEES.includes(cle),
      debut: m.debut,
      fin: m.fin,
      dateSignature: m.signature,
      devise: m.devise,
      mode: m.mode_facturation,
      directeurId: m.directeur_id,
      chefId: m.chef_id,
      taches: taches.map((t) => ({ id: t.id, libelle: t.libelle, phase: t.phase })),
      affectations: affectations.map((a) => ({
        id: a.id,
        tacheId: a.tache_id,
        collaborateurId: a.collaborateur_id,
        utilisateurId: a.utilisateur_id,
        grade: a.grade,
        joursAlloues: a.jours,
        debut: a.debut,
        fin: a.fin,
      })),
      budgetJours,
      budgetHonoraires,
      budgetCourantHonoraires,
      budgetDeboursRefacturables,
    };
  }
  return { missions, absentes };
}

/** Clé de compte (`ctx.sessions`) d'un utilisateur, ou undefined. */
export function cleDeCompte(ctx: ContexteTenantDemo, utilisateurId: string): string | undefined {
  return Object.entries(ctx.utilisateurs).find(([, id]) => id === utilisateurId)?.[0];
}
