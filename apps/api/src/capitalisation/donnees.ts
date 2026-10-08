import {
  centiemesDepuisJours,
  ecartsRetour,
  sommeCentiemes,
  tempsParBrique,
  type EcartsRetour,
  type TempsBrique,
} from "@missionpilot/engines";
import type { ContexteModulationApi } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { methodeEffectiveMission } from "../standard/index.js";

/*
 * Faits d'une mission pour le retour d'expérience (CAP-01) et la base d'estimation (CAP-02),
 * lus dans la transaction de l'appelant (qui a déjà vérifié la visibilité de la mission). Toute
 * somme et tout écart sortent du moteur `capitalisation` ; la base ne fait que lire.
 *
 * Temps réel : lignes de temps des feuilles VALIDÉES ou VERROUILLÉES (une feuille en cours de
 * saisie ou rejetée ne compte pas). Budget : lignes de budget des tâches (tache_budget_lignes).
 */

export interface BriqueMethodeRetour {
  code: string;
  libelle: string;
  etape: string;
  active: boolean;
  temps_type_centiemes: number | null;
}

export interface FaitsRetour {
  mission: {
    id: string;
    intitule: string;
    client: string;
    type_mission: string | null;
    statut: string;
    date_debut: string | null;
    date_fin: string | null;
    secteur: string | null;
    activite: string | null;
  };
  methode: {
    code: string;
    libelle: string;
    version: number;
    origine: string;
    briques: BriqueMethodeRetour[];
  } | null;
  contexte: ContexteModulationApi;
  derogations: { brique_code: string; nature: string; statut: string; motif: string }[];
  temps: {
    realise_centiemes: number;
    budget_centiemes: number;
    taches: number;
    taches_rattachees: number;
    briques: TempsBrique[];
  };
  ecarts: EcartsRetour;
}

async function lireMission(db: Db, missionId: string): Promise<FaitsRetour["mission"]> {
  const r = await db.query(
    `SELECT m.id, m.intitule, c.raison_sociale AS client, t.libelle AS type_mission, m.statut,
            m.date_debut::text AS date_debut, m.date_fin::text AS date_fin, m.secteur, m.activite
     FROM missions m JOIN clients c ON c.id = m.client_id
     LEFT JOIN types_mission t ON t.id = m.type_mission_id
     WHERE m.id = $1`,
    [missionId],
  );
  if (!r.rows[0]) throw introuvable("Mission");
  return r.rows[0] as FaitsRetour["mission"];
}

const centiemesType = (jours: number | null): number | null =>
  jours === null ? null : centiemesDepuisJours(String(jours));

async function lireMethode(db: Db, missionId: string) {
  const m = await methodeEffectiveMission(db, missionId);
  if (!m) return { methode: null, contexte: {} };
  const briques = m.etapes.flatMap((e) =>
    e.briques.map((b) => ({
      code: b.code,
      libelle: b.libelle,
      etape: e.libelle,
      active: b.active,
      temps_type_centiemes: centiemesType(b.temps_type_jours),
    })),
  );
  return {
    methode: {
      code: m.version.methode_code,
      libelle: m.version.methode_libelle,
      version: m.version.version,
      origine: m.version.origine,
      briques,
    },
    contexte: m.liaison.contexte,
  };
}

/** Temps réel, budget et rattachements tâche → brique d'une mission. */
export async function lireTempsMission(db: Db, missionId: string) {
  const rattachements = await db.query(
    `SELECT tache_id, brique_code FROM cap_taches_briques WHERE mission_id = $1`,
    [missionId],
  );
  const temps = await db.query(
    `SELECT l.tache_id, l.centiemes FROM lignes_temps l
     JOIN feuilles_temps f ON f.id = l.feuille_id
     WHERE l.mission_id = $1 AND f.statut IN ('validee', 'verrouillee')`,
    [missionId],
  );
  const budget = await db.query(
    `SELECT tache_id, jours::text AS jours FROM tache_budget_lignes WHERE mission_id = $1`,
    [missionId],
  );
  const taches = await db.query(
    `SELECT count(*)::int AS n FROM mission_taches WHERE mission_id = $1`,
    [missionId],
  );
  const lignes = temps.rows as { tache_id: string; centiemes: number }[];
  const lignesBudget = budget.rows as { tache_id: string; jours: string }[];
  return {
    rattachements: rattachements.rows as { tache_id: string; brique_code: string }[],
    realise_centiemes: sommeCentiemes(lignes.map((l) => l.centiemes)),
    budget_centiemes: sommeCentiemes(lignesBudget.map((l) => centiemesDepuisJours(l.jours))),
    taches: taches.rows[0].n as number,
    briques: tempsParBrique(rattachements.rows, lignes, lignesBudget),
  };
}

export async function chargerFaitsRetour(db: Db, missionId: string): Promise<FaitsRetour> {
  const mission = await lireMission(db, missionId);
  const { methode, contexte } = await lireMethode(db, missionId);
  const d = await db.query(
    `SELECT brique_code, nature, statut, motif FROM derogations
     WHERE mission_id = $1 ORDER BY cree_le, id`,
    [missionId],
  );
  const t = await lireTempsMission(db, missionId);
  const typeDe = new Map((methode?.briques ?? []).map((b) => [b.code, b.temps_type_centiemes]));
  const ecarts = ecartsRetour({
    budget_centiemes: t.budget_centiemes,
    realise_centiemes: t.realise_centiemes,
    briques: t.briques.map((b) => ({
      brique_code: b.brique_code,
      budget_centiemes: b.budget_centiemes,
      realise_centiemes: b.realise_centiemes,
      temps_type_centiemes: typeDe.get(b.brique_code) ?? null,
    })),
  });
  return {
    mission,
    methode,
    contexte,
    derogations: d.rows as FaitsRetour["derogations"],
    temps: {
      realise_centiemes: t.realise_centiemes,
      budget_centiemes: t.budget_centiemes,
      taches: t.taches,
      taches_rattachees: t.rattachements.length,
      briques: t.briques,
    },
    ecarts,
  };
}
