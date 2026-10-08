import { rangNiveauAutonomie, type NiveauAutonomie } from "@missionpilot/engines";
import {
  aPermission,
  type Permission,
  type RestrictionAgent,
  type SchemaSortie,
  type TacheGenerative,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { lireParametres, modeleDe } from "../ia/parametres.js";
import { contratSortieAgent } from "../ia/sortie-agent.js";
import { actionReservee, avecErreursAgents, plafondAgent } from "./erreurs.js";

/*
 * Registre des agents (AGT-01, migration 0260) : version COURANTE du standard
 * (agents_registre_courant, lecture seule) et restriction du cabinet (dernière
 * ligne de agents_restrictions). Niveau maximal effectif de l'agent pour le
 * cabinet = le plus bas du standard et de la restriction ; N0 si désactivé.
 *
 * Une restriction posée par un ASSOCIÉ ne se lève (réactivation, niveau relevé)
 * que par `autonomie.decider` : la plus récente restriction d'un associé est un
 * plancher de sévérité pour les autres auteurs (doublé en base, 0267, MPG08).
 */

export interface AgentCabinet {
  code: string;
  version: number;
  nom: string;
  mission: string;
  ne_fait_jamais: string;
  entrees: string[];
  outils_autorises: string[];
  droits: Permission[];
  briques: string[];
  taches: TacheGenerative[];
  niveau_max_standard: NiveauAutonomie;
  schema_sortie: SchemaSortie;
  lit_contenu_client: boolean;
  notes_version: string;
  actif: boolean;
  niveau_max_cabinet: NiveauAutonomie | null;
  /** Plafond appliqué au cabinet : N0 si l'agent est désactivé. */
  niveau_max: NiveauAutonomie;
  restriction: {
    motif: string;
    auteur_id: string;
    cree_le: string;
  } | null;
}

const COLONNES = `r.code, r.version, r.nom, r.mission, r.ne_fait_jamais, r.entrees, r.outils_autorises,
  r.droits, r.briques, r.taches, r.niveau_max, r.schema_sortie, r.lit_contenu_client, r.notes_version,
  x.actif AS x_actif, x.niveau_max AS x_niveau_max, x.motif AS x_motif, x.auteur_id AS x_auteur_id,
  x.cree_le AS x_cree_le`;

const DEPUIS = `agents_registre_courant r
  LEFT JOIN LATERAL (SELECT * FROM agents_restrictions s WHERE s.agent_code = r.code
    ORDER BY s.id DESC LIMIT 1) x ON true`;

/** Le plus bas de deux niveaux. */
export function niveauMin(a: NiveauAutonomie, b: NiveauAutonomie): NiveauAutonomie {
  return rangNiveauAutonomie(a) <= rangNiveauAutonomie(b) ? a : b;
}

function versAgent(l: Record<string, unknown>): AgentCabinet {
  const standard = l.niveau_max as NiveauAutonomie;
  const actif = l.x_actif === null || l.x_actif === undefined ? true : (l.x_actif as boolean);
  const cabinet = (l.x_niveau_max as NiveauAutonomie | null) ?? null;
  return {
    code: l.code as string,
    version: l.version as number,
    nom: l.nom as string,
    mission: l.mission as string,
    ne_fait_jamais: l.ne_fait_jamais as string,
    entrees: l.entrees as string[],
    outils_autorises: l.outils_autorises as string[],
    droits: l.droits as Permission[],
    briques: l.briques as string[],
    taches: l.taches as TacheGenerative[],
    niveau_max_standard: standard,
    schema_sortie: contratSortieAgent(l.schema_sortie),
    lit_contenu_client: l.lit_contenu_client as boolean,
    notes_version: l.notes_version as string,
    actif,
    niveau_max_cabinet: cabinet,
    niveau_max: !actif ? "N0" : cabinet ? niveauMin(standard, cabinet) : standard,
    restriction: l.x_motif
      ? {
          motif: l.x_motif as string,
          auteur_id: l.x_auteur_id as string,
          cree_le: l.x_cree_le as string,
        }
      : null,
  };
}

/** Tous les agents du standard, avec la restriction du cabinet courant (14 lignes au départ). */
export async function lireAgents(db: Db): Promise<AgentCabinet[]> {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} ORDER BY r.code`);
  return r.rows.map(versAgent);
}

export async function lireAgent(db: Db, code: string): Promise<AgentCabinet> {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE r.code = $1`, [code]);
  if (!r.rows[0]) throw introuvable("Agent");
  return versAgent(r.rows[0]);
}

/** L'utilisateur détient-il tous les droits que l'agent exige (et le droit d'utiliser l'IA) ? */
export function droitsManquants(auth: Pick<Auth, "roles">, agent: AgentCabinet): Permission[] {
  return (["ia.utiliser", ...agent.droits] as Permission[]).filter(
    (p) => !aPermission(auth.roles, p),
  );
}

/** Modèle routé pour chaque tâche de l'agent (AGT-06 : modèle par tâche, ia/modeles.ts). */
export async function modelesRoutes(
  db: Db,
  agent: AgentCabinet,
): Promise<{ tache: TacheGenerative; modele: string }[]> {
  const p = await lireParametres(db);
  return agent.taches.map((tache) => ({ tache, modele: modeleDe(p, tache) }));
}

/** La nouvelle restriction est-elle moins sévère que la référence (réactivation, niveau relevé) ? */
export function leveRestriction(
  standard: NiveauAutonomie,
  reference: { actif: boolean; niveau_max: NiveauAutonomie | null },
  nouvelle: { actif: boolean; niveau_max: NiveauAutonomie | null },
): boolean {
  return (
    (!reference.actif && nouvelle.actif) ||
    rangNiveauAutonomie(nouvelle.niveau_max ?? standard) >
      rangNiveauAutonomie(reference.niveau_max ?? standard)
  );
}

/** Nouvelle restriction du cabinet (ajout seul) : désactiver, ou abaisser le niveau maximal. */
export async function restreindreAgent(
  db: Db,
  auth: Auth,
  code: string,
  r: RestrictionAgent,
): Promise<AgentCabinet> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `agents_restriction:${auth.cabinetId}:${code}`,
  ]);
  const agent = await lireAgent(db, code);
  if (
    r.niveau_max !== null &&
    rangNiveauAutonomie(r.niveau_max) > rangNiveauAutonomie(agent.niveau_max_standard)
  ) {
    throw plafondAgent();
  }
  if (!aPermission(auth.roles, "autonomie.decider")) {
    const ref = await db.query(
      `SELECT s.actif, s.niveau_max FROM agents_restrictions s
       JOIN utilisateurs u ON u.id = s.auteur_id AND 'associe' = ANY (u.roles)
       WHERE s.agent_code = $1 ORDER BY s.id DESC LIMIT 1`,
      [code],
    );
    const reference = ref.rows[0] as
      { actif: boolean; niveau_max: NiveauAutonomie | null } | undefined;
    if (reference && leveRestriction(agent.niveau_max_standard, reference, r)) {
      throw actionReservee("Restriction posée par un associé : seul un associé la lève.");
    }
  }
  await avecErreursAgents(() =>
    db.query(
      `INSERT INTO agents_restrictions (cabinet_id, agent_code, actif, niveau_max, motif, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.cabinetId, code, r.actif, r.niveau_max, r.motif, auth.utilisateurId],
    ),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "restriction_agent_ia",
    entite: "agent_ia",
    entiteId: null,
    details: { agent: code, actif: r.actif, niveau_max: r.niveau_max },
  });
  return lireAgent(db, code);
}
