import { journaliser } from "../../../audit.js";
import { attendre, type ContexteTenantDemo, type SessionDemo } from "../contexte.js";

/*
 * Outils COMMUNS de la phase « redressement-dd » (preuves, redressement, due diligence).
 *
 * - noms EXACTS des missions du casting (lot 2a), retrouvées par `nom` ;
 * - acteurs : les sessions des comptes qui portent les droits utiles (voir roles.ts) ;
 * - étapes marquées (journal d'audit) : une étape terminée n'est plus rejouée ;
 * - les missions 1 à 5 du casting sont terminées mais NON clôturées pendant cette phase (leur clôture
 *   réelle a lieu à la fin de la phase « gestion ») : les routes y acceptent donc les écritures ;
 * - `appliquerSql` : antidatage par requête LITTÉRALE (jamais de nom de table interpolé).
 */

export { attendre };

/** Noms exacts des missions du casting (brief commun). */
export const MISSIONS = {
  plan2025: "Plan stratégique 2025-2028 — SICAFE",
  notation: "Notation financière — Sahel Coton",
  redressementTermine: "Redressement — Brasseries du Wouri",
  ddTerminee: "Due diligence — Mboa Solaire",
  businessPlan: "Business plan bancable — Atlantique Retail",
  planBaobab: "Plan stratégique 2026-2030 — Baobab Assurances",
  redressementEnCours: "Redressement — Gabon Offshore Services",
  diagnosticFlash: "Diagnostic flash — Teranga Logistique",
  notationBanque: "Notation financière — Banque du Sahel (portefeuille PME)",
  planExport: "Plan stratégique — Sicafe Export",
  ddPreparation: "Due diligence — Wouri Distribution",
} as const;

export type NomMission = (typeof MISSIONS)[keyof typeof MISSIONS];

/** Les cinq missions terminées du casting (registre des preuves). */
export const MISSIONS_TERMINEES: readonly NomMission[] = [
  MISSIONS.plan2025,
  MISSIONS.notation,
  MISSIONS.redressementTermine,
  MISSIONS.ddTerminee,
  MISSIONS.businessPlan,
];

export interface MissionTrouvee {
  id: string;
  nom: string;
  clientId: string;
  statut: string;
  directeurId: string | null;
  chefId: string | null;
  dateDebut: string | null;
  dateFin: string | null;
}

/** Mission du casting par son nom exact ; erreur claire si le lot « missions » n'est pas passé. */
export async function trouverMission(
  ctx: ContexteTenantDemo,
  nom: NomMission,
): Promise<MissionTrouvee> {
  const r = await ctx.proprietaire.query(
    `SELECT id, intitule, client_id, statut, directeur_id, chef_id,
            to_char(date_debut, 'YYYY-MM-DD') AS debut, to_char(date_fin, 'YYYY-MM-DD') AS fin
       FROM missions WHERE cabinet_id = $1 AND intitule = $2`,
    [ctx.cabinetId, nom],
  );
  const m = r.rows[0] as Record<string, string | null> | undefined;
  if (!m)
    throw new Error(`Mission « ${nom} » introuvable : la phase « missions » doit passer avant.`);
  return {
    id: m.id as string,
    nom,
    clientId: m.client_id as string,
    statut: m.statut as string,
    directeurId: m.directeur_id ?? null,
    chefId: m.chef_id ?? null,
    dateDebut: m.debut ?? null,
    dateFin: m.fin ?? null,
  };
}

/** Sessions des comptes utilisés par la phase (clés de cles.ts). */
export interface Acteurs {
  associe: SessionDemo;
  associe2: SessionDemo;
  directeur: SessionDemo;
  directeur2: SessionDemo;
  chef: SessionDemo;
  chef2: SessionDemo;
  consultant: SessionDemo;
  consultant2: SessionDemo;
  junior: SessionDemo;
  expert: SessionDemo;
  expert2: SessionDemo;
  gestionnaire: SessionDemo;
  /** Compte du portail rôle investisseur (client `mboa-solaire` ou autre, voir le socle). */
  investisseur: SessionDemo;
  investisseur2: SessionDemo;
}

export function acteurs(ctx: ContexteTenantDemo): Acteurs {
  return {
    associe: ctx.session("associe"),
    associe2: ctx.session("associe.2"),
    directeur: ctx.session("directeur.mission"),
    directeur2: ctx.session("directeur.mission.2"),
    chef: ctx.session("chef.mission"),
    chef2: ctx.session("chef.mission.2"),
    consultant: ctx.session("consultant"),
    consultant2: ctx.session("consultant.2"),
    junior: ctx.session("consultant.junior"),
    expert: ctx.session("expert.metier"),
    expert2: ctx.session("expert.metier.2"),
    gestionnaire: ctx.session("gestionnaire"),
    investisseur: ctx.session("investisseur.client"),
    investisseur2: ctx.session("investisseur.client.2"),
  };
}

/**
 * Acteurs d'UNE mission : `chef` et `directeur` sont le chef et le directeur RÉELS de la mission
 * (le casting en répartit deux de chaque entre les missions), `chef2` et `directeur2` l'autre
 * compte du même rôle (il est ajouté à l'équipe de la mission). Les écritures par les routes exigent d'être dans l'équipe de la mission.
 */
export async function acteursPour(ctx: ContexteTenantDemo, nom: NomMission): Promise<Acteurs> {
  const base = acteurs(ctx);
  const m = await trouverMission(ctx, nom);
  const [chef, chef2] =
    m.chefId === base.chef2.utilisateurId ? [base.chef2, base.chef] : [base.chef, base.chef2];
  const [directeur, directeur2] =
    m.directeurId === base.directeur2.utilisateurId
      ? [base.directeur2, base.directeur]
      : [base.directeur, base.directeur2];
  // L'autre chef rejoint l'équipe (chef adjoint) : il intervient sur plusieurs étapes.
  await assurerEquipe(ctx, m.id, [chef2.utilisateurId]);
  return { ...base, chef, chef2, directeur, directeur2 };
}

/* ----- Étapes marquées (reprise sans doublon) ----- */

const ACTION_ETAPE = "semis_tenant_demo_etape";

export async function etapeDejaFaite(ctx: ContexteTenantDemo, etape: string): Promise<boolean> {
  return ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const r = await db.query(
      "SELECT 1 FROM journal_audit WHERE action = $1 AND details->>'etape' = $2 LIMIT 1",
      [ACTION_ETAPE, etape],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

async function marquerEtape(ctx: ContexteTenantDemo, etape: string): Promise<void> {
  await ctx.database.withTenant(ctx.cabinetId, (db) =>
    journaliser(db, {
      cabinetId: ctx.cabinetId,
      utilisateurId: null,
      action: ACTION_ETAPE,
      entite: "cabinet",
      entiteId: ctx.cabinetId,
      details: { etape },
    }),
  );
}

/**
 * Exécute `fn` une seule fois par cabinet : l'étape est marquée à la fin. Une étape qui a échoué
 * en cours de route n'est pas marquée ; sa relance échoue alors clairement (conflit des routes)
 * ou reprend : repartir d'une base neuve si besoin (voir tenant-demo/index.ts).
 */
export async function etape(
  ctx: ContexteTenantDemo,
  nom: string,
  fn: () => Promise<void>,
): Promise<void> {
  if (await etapeDejaFaite(ctx, nom)) {
    ctx.journal(`  étape « ${nom} » déjà faite.`);
    return;
  }
  ctx.journal(`  étape « ${nom} »…`);
  await fn();
  await marquerEtape(ctx, nom);
}

/* ----- Équipe de mission ----- */

const ACTION_EQUIPE = "semis_tenant_demo_equipe";

/**
 * Ajoute à l'équipe de la mission les comptes qui n'en font pas déjà partie (un membre existant
 * n'est jamais touché) et consigne chaque AJOUT au journal d'audit : `retirerEquipesAjoutees`
 * retire ensuite ces ajouts des missions terminées (la revue à froide veut des relecteurs hors
 * équipe).
 */
export async function assurerEquipe(
  ctx: ContexteTenantDemo,
  missionId: string,
  utilisateurs: readonly string[],
): Promise<void> {
  const a = acteurs(ctx);
  for (const u of utilisateurs) {
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2 AND cabinet_id = $3",
      [missionId, u, ctx.cabinetId],
    );
    if (deja.rowCount) continue;
    const r = await a.associe.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u });
    if (r.statusCode === 409) continue;
    attendre(201, r, `équipe ${missionId}`);
    await ctx.database.withTenant(ctx.cabinetId, (db) =>
      journaliser(db, {
        cabinetId: ctx.cabinetId,
        utilisateurId: null,
        action: ACTION_EQUIPE,
        entite: "mission",
        entiteId: missionId,
        details: { utilisateur_id: u },
      }),
    );
  }
}

/**
 * Retire des équipes des missions données les comptes AJOUTÉS par cette phase (jamais un membre
 * du casting). Appelé en fin de phase pour les missions terminées : les contenus restent attribués
 * à leurs auteurs, mais l'équipe retrouve la composition du casting.
 */
export async function retirerEquipesAjoutees(
  ctx: ContexteTenantDemo,
  missionIds: readonly string[],
): Promise<number> {
  const a = acteurs(ctx);
  const ajouts = await ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const r = await db.query(
      "SELECT DISTINCT entite_id AS mission_id, details->>'utilisateur_id' AS utilisateur_id FROM journal_audit WHERE action = $1",
      [ACTION_EQUIPE],
    );
    return r.rows as { mission_id: string; utilisateur_id: string }[];
  });
  let retires = 0;
  for (const x of ajouts.filter((y) => missionIds.includes(y.mission_id))) {
    const r = await ctx.app.inject({
      method: "DELETE",
      url: `/api/missions/${x.mission_id}/equipe/${x.utilisateur_id}`,
      headers: { cookie: a.associe.cookie },
    });
    if (r.statusCode === 200) retires += 1;
    else if (r.statusCode !== 404) attendre(200, r, `retrait de l'équipe ${x.mission_id}`);
  }
  return retires;
}

/* ----- Antidatage littéral ----- */

/**
 * Exécute UNE requête littérale (fournie par l'appelant, nom de table écrit en dur) sans
 * déclencheurs (`session_replication_role = replica`) : RÉSERVÉ à remonter `cree_le` des tables en
 * ajout seul, que les routes horodatent « maintenant ». Jamais de nom de table interpolé, jamais
 * pour contourner une règle métier.
 */
export async function appliquerSql(
  ctx: ContexteTenantDemo,
  sql: string,
  parametres: unknown[],
): Promise<void> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(sql, parametres);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/** Midi UTC d'un jour ISO, pour une colonne `timestamptz`. */
export const midi = (jourISO: string): string => `${jourISO}T12:00:00Z`;
