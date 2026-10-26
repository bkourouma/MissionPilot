import type { ContexteTenantDemo } from "../contexte.js";
import type { CleClient } from "../cles.js";

/*
 * Casting des missions du Tenant démo (noms EXACTS partagés par les lots 2a à 6) et utilitaire
 * pour retrouver une mission créée par le lot 2a. Les missions du casting restent OUVERTES
 * pendant toutes les phases (la clôture des missions 1 à 5 est faite à la fin de « gestion »).
 *
 * Le champ s'appelle `missions.intitule` (le brief parle de `nom`).
 */

export interface MissionCasting {
  /** Numéro dans le casting (1 à 11). */
  numero: number;
  intitule: string;
  client: CleClient;
}

export const CASTING = {
  sicafe: { numero: 1, intitule: "Plan stratégique 2025-2028 — SICAFE", client: "sicafe" },
  sahelCoton: { numero: 2, intitule: "Notation financière — Sahel Coton", client: "sahel-coton" },
  atlantique: {
    numero: 5,
    intitule: "Business plan bancable — Atlantique Retail",
    client: "atlantique-retail",
  },
  baobab: {
    numero: 6,
    intitule: "Plan stratégique 2026-2030 — Baobab Assurances",
    client: "baobab-assurances",
  },
  banqueSahel: {
    numero: 9,
    intitule: "Notation financière — Banque du Sahel (portefeuille PME)",
    client: "banque-sahel",
  },
  sicafeExport: {
    numero: 10,
    intitule: "Plan stratégique — Sicafe Export",
    client: "sicafe-export",
  },
} as const satisfies Record<string, MissionCasting>;

export interface MissionTrouvee {
  id: string;
  intitule: string;
  clientId: string;
  statut: string;
  dateDebut: string | null;
  dateFin: string | null;
}

/** Mission du casting, retrouvée par intitulé exact ; erreur claire si le lot 2a ne l'a pas créée. */
export async function trouverMission(
  ctx: ContexteTenantDemo,
  cible: MissionCasting,
): Promise<MissionTrouvee> {
  const r = await ctx.proprietaire.query<{
    id: string;
    intitule: string;
    client_id: string;
    statut: string;
    date_debut: string | null;
    date_fin: string | null;
  }>(
    `SELECT id, intitule, client_id, statut, date_debut::text, date_fin::text
       FROM missions WHERE cabinet_id = $1 AND intitule = $2`,
    [ctx.cabinetId, cible.intitule],
  );
  const m = r.rows[0];
  if (!m) {
    throw new Error(
      `Mission « ${cible.intitule} » introuvable : la phase « missions » doit être exécutée avant « notation-plans ».`,
    );
  }
  return {
    id: m.id,
    intitule: m.intitule,
    clientId: m.client_id,
    statut: m.statut,
    dateDebut: m.date_debut,
    dateFin: m.date_fin,
  };
}
