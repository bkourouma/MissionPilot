import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { acteurs, appliquerSql, attendre, trouverMission, type MissionTrouvee } from "./commun.js";
import {
  DECISIONS_SOCLE,
  FAITS,
  type DefFait,
  type DefFacteur,
} from "./preuves-dossier-donnees.js";
import { EXPORTS, FACTEURS } from "./preuves-dossier-facteurs.js";
import { jourDe, type CleActeur } from "./preuves-ecriture.js";

/*
 * Dossier client des clients des missions 1 à 5, par les VRAIES routes de /api/dossiers :
 *   - faits proposés par un compte (`dossier.ecrire`) puis confirmés ou rejetés par un AUTRE
 *     compte (séparation des tâches, déclencheur MPO03) ; un fait peut en remplacer un autre ;
 *   - décisions sur des faits proposés par le socle (compte associé) ;
 *   - facteurs de contexte datés (avec historique de valeurs) ;
 *   - exports du dossier (clients de missions terminées).
 *
 * Les tables sont en ajout seul et horodatées « maintenant » par les routes : `cree_le` est ramené
 * au jour de la mission par des requêtes littérales (appliquerSql), en gardant la décision après
 * le fait. Les faits `dossier_faits` et `dossier_participations` du socle ne sont pas dupliqués.
 */

type Sessions = Record<CleActeur, SessionDemo>;

function sessionsDe(ctx: ContexteTenantDemo): Sessions {
  const a = acteurs(ctx);
  return {
    associe: a.associe,
    associe2: a.associe2,
    directeur: a.directeur,
    directeur2: a.directeur2,
    chef: a.chef,
    chef2: a.chef2,
    consultant: a.consultant,
    consultant2: a.consultant2,
    junior: a.junior,
  };
}

const horo = (jour: string, heure: number): string =>
  `${jour}T${String(heure).padStart(2, "0")}:00:00Z`;

async function missionsDe(ctx: ContexteTenantDemo) {
  const parNom = new Map<string, MissionTrouvee>();
  const noms = [
    ...new Set([
      ...FAITS.map((f) => f.mission),
      ...DECISIONS_SOCLE.map((d) => d.mission),
      ...FACTEURS.map((f) => f.mission),
      ...EXPORTS.map((e) => e.mission),
    ]),
  ];
  for (const nom of noms) parNom.set(nom, await trouverMission(ctx, nom));
  return parNom;
}

function jourMission(m: MissionTrouvee, j: number): string {
  return jourDe(m.dateDebut ?? "2024-10-01", j, m.dateFin ?? "2026-10-24");
}

async function faitsDuDossier(
  ctx: ContexteTenantDemo,
  s: Sessions,
  missions: Map<string, MissionTrouvee>,
): Promise<void> {
  const crees = new Map<string, string>();
  for (const f of FAITS) {
    const m = missions.get(f.mission) as MissionTrouvee;
    const cle = `${m.clientId}|${f.categorie}|${f.cle}`;
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM dossier_faits WHERE client_id = $1 AND categorie = $2 AND cle = $3 AND valeur = $4::jsonb",
      [m.clientId, f.categorie, f.cle, JSON.stringify(f.valeur)],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    const precedent = crees.get(cle);
    if (f.remplace && !precedent) throw new Error(`Fait à remplacer introuvable (${f.cle}).`);
    const r = await s[f.par].post(`/api/dossiers/${m.clientId}/faits`, corpsFait(f, precedent));
    attendre(201, r, `fait ${f.cle} (${m.nom})`);
    const id = (r.json() as { id: string }).id;
    crees.set(cle, id);
    const jourFait = jourMission(m, f.j);
    await appliquerSql(ctx, "UPDATE dossier_faits SET cree_le = $1::timestamptz WHERE id = $2", [
      horo(jourFait, 9),
      id,
    ]);
    const d = f.decision;
    if (!d) continue;
    await deciderFait(ctx, s, m, id, d.par, d.decision, d.motif, jourMission(m, d.j));
  }
}

function corpsFait(f: DefFait, remplaceId: string | undefined) {
  return {
    categorie: f.categorie,
    cle: f.cle,
    valeur: f.valeur,
    date_effet: f.effet,
    source: f.source,
    fiabilite: f.fiabilite,
    statut: "propose",
    ...(f.remplace && remplaceId ? { remplace_id: remplaceId } : {}),
  };
}

async function deciderFait(
  ctx: ContexteTenantDemo,
  s: Sessions,
  m: MissionTrouvee,
  faitId: string,
  par: CleActeur,
  decision: "confirme" | "rejete",
  motif: string | undefined,
  jour: string | null,
): Promise<void> {
  const r = await s[par].post(`/api/dossiers/${m.clientId}/faits/${faitId}/decision`, {
    decision,
    ...(motif ? { motif } : {}),
  });
  attendre(200, r, `décision fait ${faitId} (${m.nom})`);
  if (!jour) return;
  await appliquerSql(
    ctx,
    "UPDATE dossier_faits_decisions SET cree_le = $1::timestamptz WHERE fait_id = $2",
    [horo(jour, 15), faitId],
  );
}

/** Décisions sur les faits que le socle a proposés (aucun antidatage : ils datent d'aujourd'hui). */
async function decisionsSocle(
  ctx: ContexteTenantDemo,
  s: Sessions,
  missions: Map<string, MissionTrouvee>,
): Promise<void> {
  for (const d of DECISIONS_SOCLE) {
    const m = missions.get(d.mission) as MissionTrouvee;
    const r = await ctx.proprietaire.query(
      `SELECT f.id FROM dossier_faits f
        WHERE f.client_id = $1 AND f.categorie = $2 AND f.cle = $3
          AND NOT EXISTS (SELECT 1 FROM dossier_faits_decisions x WHERE x.fait_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM dossier_faits y WHERE y.remplace_id = f.id)`,
      [m.clientId, d.categorie, d.cle],
    );
    const id = r.rows[0]?.id as string | undefined;
    if (!id) {
      ctx.journal(`  fait ${d.cle} (${m.nom}) : déjà décidé ou absent.`);
      continue;
    }
    await deciderFait(ctx, s, m, id, d.par, d.decision, d.motif, null);
  }
}

async function facteursDuDossier(
  ctx: ContexteTenantDemo,
  s: Sessions,
  missions: Map<string, MissionTrouvee>,
): Promise<void> {
  for (const f of FACTEURS) {
    const m = missions.get(f.mission) as MissionTrouvee;
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM dossier_facteurs WHERE client_id = $1 AND code = $2 AND date_effet = $3::date",
      [m.clientId, f.code, f.effet],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    const r = await s[f.par].post(`/api/dossiers/${m.clientId}/facteurs`, corpsFacteur(f));
    attendre(201, r, `facteur ${f.code} (${m.nom})`);
    await appliquerSql(ctx, "UPDATE dossier_facteurs SET cree_le = $1::timestamptz WHERE id = $2", [
      horo(f.effet, 10),
      (r.json() as { id: string }).id,
    ]);
  }
}

function corpsFacteur(f: DefFacteur) {
  return {
    code: f.code,
    type: f.type,
    valeur: f.valeur,
    date_effet: f.effet,
    source: f.source,
    fiabilite: f.fiabilite,
  };
}

async function exportsDuDossier(
  ctx: ContexteTenantDemo,
  s: Sessions,
  missions: Map<string, MissionTrouvee>,
): Promise<void> {
  for (const e of EXPORTS) {
    const m = missions.get(e.mission) as MissionTrouvee;
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM dossier_exports WHERE client_id = $1 AND cree_le::date = $2::date",
      [m.clientId, e.jour],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    const r = await s[e.par].get(`/api/dossiers/${m.clientId}/export?format=${e.format}`);
    attendre(200, r, `export du dossier (${m.nom})`);
    const dernier = await ctx.proprietaire.query(
      "SELECT id FROM dossier_exports WHERE client_id = $1 ORDER BY cree_le DESC LIMIT 1",
      [m.clientId],
    );
    const id = dernier.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`Export du dossier introuvable (${m.nom}).`);
    await appliquerSql(ctx, "UPDATE dossier_exports SET cree_le = $1::timestamptz WHERE id = $2", [
      horo(e.jour, 11),
      id,
    ]);
  }
}

/** Sème le dossier client (faits, décisions, facteurs, exports) des missions 1 à 5. */
export async function semerDossierMissions(ctx: ContexteTenantDemo): Promise<void> {
  const s = sessionsDe(ctx);
  const missions = await missionsDe(ctx);
  await faitsDuDossier(ctx, s, missions);
  await decisionsSocle(ctx, s, missions);
  await facteursDuDossier(ctx, s, missions);
  await exportsDuDossier(ctx, s, missions);
  ctx.journal(
    `  dossier client : ${FAITS.length} faits, ${FACTEURS.length} facteurs, ${EXPORTS.length} exports.`,
  );
}
