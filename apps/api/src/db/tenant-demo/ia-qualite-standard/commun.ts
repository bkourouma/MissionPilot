import type { ContexteTenantDemo } from "../contexte.js";
import type { CleClient } from "../cles.js";

/*
 * Éléments communs aux modules de la phase « ia-qualite-standard » : casting des missions
 * (noms EXACTS partagés par tous les lots, colonne `missions.intitule`), accès au cabinet par
 * le rôle propriétaire et petits utilitaires d'idempotence.
 *
 * Règle d'écriture (superviseur) : pour antidater une table, requête SQL LITTÉRALE dans le
 * module (`UPDATE <table> SET cree_le = $1 WHERE id = $2`, nom de table écrit en dur), jamais
 * d'interpolation d'un nom de table. Les tables « ajout seul » refusent l'UPDATE : l'INSERT
 * porte alors directement `cree_le`.
 */

/** Casting du lot 2a : clé stable → intitulé EXACT, client, état attendu. */
export const CASTING = {
  "plan-sicafe": {
    intitule: "Plan stratégique 2025-2028 — SICAFE",
    client: "sicafe",
    debut: "2024-11-04",
    fin: "2025-04-30",
    etat: "terminee",
  },
  "notation-sahel-coton": {
    intitule: "Notation financière — Sahel Coton",
    client: "sahel-coton",
    debut: "2025-02-03",
    fin: "2025-06-20",
    etat: "terminee",
  },
  "redressement-wouri": {
    intitule: "Redressement — Brasseries du Wouri",
    client: "brasseries-wouri",
    debut: "2025-03-10",
    fin: "2025-11-14",
    etat: "terminee",
  },
  "dd-mboa": {
    intitule: "Due diligence — Mboa Solaire",
    client: "mboa-solaire",
    debut: "2025-09-01",
    fin: "2025-12-19",
    etat: "terminee",
  },
  "bp-atlantique": {
    intitule: "Business plan bancable — Atlantique Retail",
    client: "atlantique-retail",
    debut: "2026-01-12",
    fin: "2026-05-29",
    etat: "terminee",
  },
  "plan-baobab": {
    intitule: "Plan stratégique 2026-2030 — Baobab Assurances",
    client: "baobab-assurances",
    debut: "2026-06-08",
    fin: "2027-01-29",
    etat: "en_cours",
  },
  "redressement-gabon": {
    intitule: "Redressement — Gabon Offshore Services",
    client: "gabon-offshore",
    debut: "2026-07-06",
    fin: "2027-02-26",
    etat: "en_cours",
  },
  "flash-teranga": {
    intitule: "Diagnostic flash — Teranga Logistique",
    client: "teranga-logistique",
    debut: "2026-09-14",
    fin: "2026-11-20",
    etat: "en_cours",
  },
  "notation-banque-sahel": {
    intitule: "Notation financière — Banque du Sahel (portefeuille PME)",
    client: "banque-sahel",
    debut: "2026-08-24",
    fin: "2026-12-18",
    etat: "en_cours",
  },
  "plan-sicafe-export": {
    intitule: "Plan stratégique — Sicafe Export",
    client: "sicafe-export",
    debut: "2026-11-09",
    fin: "2027-04-30",
    etat: "signee",
  },
  "dd-wouri-distribution": {
    intitule: "Due diligence — Wouri Distribution",
    client: "wouri-distribution",
    debut: "2027-01-11",
    fin: "2027-03-26",
    etat: "preparation",
  },
} as const satisfies Record<
  string,
  { intitule: string; client: CleClient; debut: string; fin: string; etat: string }
>;

export type CleMission = keyof typeof CASTING;
export const CLES_MISSIONS = Object.keys(CASTING) as CleMission[];

/** Missions terminées du casting (clôturées), dans l'ordre chronologique. */
export const CLES_TERMINEES: readonly CleMission[] = [
  "plan-sicafe",
  "notation-sahel-coton",
  "redressement-wouri",
  "dd-mboa",
  "bp-atlantique",
];
/** Missions en cours du casting. */
export const CLES_EN_COURS: readonly CleMission[] = [
  "plan-baobab",
  "redressement-gabon",
  "flash-teranga",
  "notation-banque-sahel",
];

export interface MissionLot {
  cle: CleMission;
  id: string;
  intitule: string;
  clientId: string;
  statut: string;
  debut: string | null;
  fin: string | null;
  cloturee: boolean;
}

/** Missions du casting RETROUVÉES par intitulé exact (clé absente : mission non créée). */
export async function chargerMissions(
  ctx: ContexteTenantDemo,
): Promise<Partial<Record<CleMission, MissionLot>>> {
  const r = await ctx.proprietaire.query<{
    id: string;
    intitule: string;
    client_id: string;
    statut: string;
    date_debut: string | null;
    date_fin: string | null;
  }>(
    `SELECT id, intitule, client_id, statut, date_debut::text, date_fin::text
       FROM missions WHERE cabinet_id = $1 AND intitule = ANY($2::text[])`,
    [ctx.cabinetId, CLES_MISSIONS.map((c) => CASTING[c].intitule)],
  );
  const parIntitule = new Map(r.rows.map((m) => [m.intitule, m]));
  const resultat: Partial<Record<CleMission, MissionLot>> = {};
  for (const cle of CLES_MISSIONS) {
    const m = parIntitule.get(CASTING[cle].intitule);
    if (!m) continue;
    resultat[cle] = {
      cle,
      id: m.id,
      intitule: m.intitule,
      clientId: m.client_id,
      statut: m.statut,
      debut: m.date_debut,
      fin: m.date_fin,
      cloturee: m.statut === "cloturee",
    };
  }
  return resultat;
}

/** Une mission du casting, ou une erreur claire si le lot 2a n'a pas (encore) créé la mission. */
export async function exigerMission(ctx: ContexteTenantDemo, cle: CleMission): Promise<MissionLot> {
  const m = (await chargerMissions(ctx))[cle];
  if (!m) {
    throw new Error(
      `Mission « ${CASTING[cle].intitule} » introuvable : la phase « missions » doit la créer avant « ia-qualite-standard ».`,
    );
  }
  return m;
}

/** Nombre de lignes d'une requête de comptage (`SELECT count(*) ...`) : base de l'idempotence. */
export async function compterLignes(
  ctx: ContexteTenantDemo,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const r = await ctx.proprietaire.query<{ n: string }>(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

/** Module d'un domaine de la phase : reçoit le contexte, est idempotent (reprise sans doublon). */
export type ModuleLot = (ctx: ContexteTenantDemo) => Promise<void>;

/** Horodatage ISO à midi UTC d'une date `AAAA-MM-JJ` (+ minutes pour étaler une journée). */
export const midi = (date: string, minutes = 0): string => {
  const t = Date.parse(`${date}T12:00:00Z`) + minutes * 60_000;
  return new Date(t).toISOString();
};
