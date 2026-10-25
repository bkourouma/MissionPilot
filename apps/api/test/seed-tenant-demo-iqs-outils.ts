import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ContexteTenantDemo } from "../src/db/tenant-demo/contexte.js";
import { creerBaseJetable, supprimerBaseJetable, type BaseJetable } from "./outils-base-jetable.js";

/*
 * Outils communs aux deux tests de la phase « ia-qualite-standard » du Tenant démo :
 * seed-tenant-demo-ia-agents.test.ts (IA, agents, automatisation) et
 * seed-tenant-demo-qualite-standard.test.ts (qualité, standard, revues à froid).
 */

/** Les 26 tables IA, copilote, agents, autonomie, automatisation et avancement de la phase. */
export const TABLES_PHASE_IA = [
  // IA et copilote
  "ia_modeles_taches",
  "ia_parametres_cabinet",
  "ia_prompt_activations",
  "ia_consommations",
  "copilote_actions",
  // Agents et autonomie
  "agents_restrictions",
  "agents_briques",
  "agents_executions",
  "agents_execution_decisions",
  "agents_contributions",
  "agents_plafonds_mission",
  "agents_jeux_essai",
  "agents_evaluations",
  "agents_evaluations_demandes",
  "autonomie_evenements",
  "autonomie_incidents",
  // Automatisation et avancement
  "automatisations",
  "automatisation_versions",
  "automatisation_executions",
  "automatisation_actions",
  "automatisation_action_resultats",
  "automatisation_annulations",
  "automatisation_brouillons",
  "automatisation_brouillon_decisions",
  "avancement_parametres",
  "avancement_rapports",
] as const;

/** Les 18 tables de qualité (hors revues à froid) et de standard de la phase. */
export const TABLES_PHASE_QUALITE = [
  // Qualité (hors revues à froid)
  "qualite_suivis",
  "qualite_evenements",
  "qualite_definitions",
  "qualite_definition_items",
  "qualite_verifications",
  "qualite_revue_elements",
  "qualite_revue_sessions",
  "qualite_revue_vus",
  "qualite_signatures",
  "qualite_validations",
  "qualite_acceptations",
  "qualite_relations_clients",
  "qualite_relations_retraits",
  "qualite_satisfactions",
  // Standard et méthodes
  "derogations",
  "derogation_validations",
  "propositions_standard",
  // Propositions du standard tirées des dérogations fréquentes (CAP-05), semées avec le standard.
  "cap_propositions_derogations",
] as const;

/** Les 6 tables de la revue à froid (QUA-05), semées après la clôture. */
export const TABLES_FROIDES = [
  "qualite_froide_campagnes",
  "qualite_froide_echantillon",
  "qualite_froide_constats",
  "qualite_froide_evaluations",
  "qualite_froide_actions",
  "qualite_froide_actions_historique",
] as const;

/** Interrupteurs d'urgence, réservations et dérivés : JAMAIS semés. */
export const TABLES_A_LAISSER_VIDES = [
  "ia_reservations",
  "ia_cache_reponses",
  "ia_alertes_plafond",
  "ia_alertes_plafond_mission",
  "automatisation_coupe_circuits",
  "autonomie_coupe_circuit",
] as const;

/** Tables non vides avant : leur nombre de lignes ne doit pas bouger au rejeu de la phase. */
export const TABLES_IDEMPOTENCE = ["ia_demandes", "taches_collaboration", "commentaires"] as const;

export type Comptages = Record<string, number>;

/**
 * Chronologie : aucune ligne de la phase n'est datée APRÈS la clôture d'une mission clôturée (la
 * clôture finale antidate cloturee_le à fin de mission + 6 jours). Chaque requête compte les
 * lignes fautives. NB : les écritures passées par les routes portent l'horloge RÉELLE du serveur
 * (environ une journée après « aujourd'hui » fictif) ; elles ne doivent donc concerner que des
 * missions ouvertes, ce que cet invariant garantit. mission_methodes en est exclue : sa liaison est posée par la route à l'horloge
 * réelle ; la phase n'en ajoute aucune à une mission terminée (test dédié).
 */
export const REQUETES_CHRONOLOGIE: Record<string, string> = {
  ia_demandes:
    "SELECT count(*) AS n FROM ia_demandes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  ia_consommations:
    "SELECT count(*) AS n FROM ia_consommations x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  agents_executions:
    "SELECT count(*) AS n FROM agents_executions x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  agents_contributions:
    "SELECT count(*) AS n FROM agents_contributions x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  agents_plafonds_mission:
    "SELECT count(*) AS n FROM agents_plafonds_mission x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.modifie_le > m.cloturee_le",
  derogations:
    "SELECT count(*) AS n FROM derogations x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  derogation_validations:
    "SELECT count(*) AS n FROM derogation_validations v JOIN derogations x ON x.id = v.derogation_id JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND v.cree_le > m.cloturee_le",
  automatisation_brouillons:
    "SELECT count(*) AS n FROM automatisation_brouillons x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.cree_le > m.cloturee_le",
  qualite_suivis:
    "SELECT count(*) AS n FROM qualite_suivis x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.ouvert_le > m.cloturee_le",
  qualite_evenements:
    "SELECT count(*) AS n FROM qualite_evenements v JOIN qualite_suivis x ON x.id = v.suivi_id JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND v.le > m.cloturee_le",
  qualite_validations:
    "SELECT count(*) AS n FROM qualite_validations v JOIN qualite_suivis x ON x.id = v.suivi_id JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND v.valide_le > m.cloturee_le",
  qualite_signatures:
    "SELECT count(*) AS n FROM qualite_signatures v JOIN qualite_suivis x ON x.id = v.suivi_id JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND v.signe_le > m.cloturee_le",
  qualite_acceptations:
    "SELECT count(*) AS n FROM qualite_acceptations x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.evalue_le > m.cloturee_le",
  qualite_satisfactions:
    "SELECT count(*) AS n FROM qualite_satisfactions x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.saisi_le > m.cloturee_le",
};

export async function compter(
  ctx: ContexteTenantDemo,
  tables: readonly string[],
): Promise<Comptages> {
  const r: Comptages = {};
  for (const t of tables) {
    // Nom de table issu des listes ci-dessus (constantes du test), jamais d'une entrée externe.
    const res = await ctx.proprietaire.query(
      `SELECT count(*) AS n FROM ${t} WHERE cabinet_id = $1`,
      [ctx.cabinetId],
    );
    r[t] = Number(res.rows[0].n);
  }
  return r;
}

export async function nombre(ctx: ContexteTenantDemo, sql: string): Promise<number> {
  const res = await ctx.proprietaire.query(sql, [ctx.cabinetId]);
  return Number(res.rows[0].n);
}

/** Base jetable + dossier de stockage temporaire d'un test de semis. */
export interface BaseDeTest {
  dossier: string;
  base: BaseJetable;
}

export async function ouvrirBaseDeTest(suffixe: string): Promise<BaseDeTest> {
  const dossier = await mkdtemp(path.join(os.tmpdir(), `missionpilot-seed-td-${suffixe}-`));
  return { dossier, base: await creerBaseJetable(suffixe, dossier) };
}

export async function fermerBaseDeTest(b: BaseDeTest | undefined): Promise<void> {
  if (!b) return;
  await supprimerBaseJetable(b.base);
  await rm(b.dossier, { recursive: true, force: true });
}
