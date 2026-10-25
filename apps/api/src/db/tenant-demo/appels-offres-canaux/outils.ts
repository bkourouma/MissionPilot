import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { attendre } from "../contexte.js";
import type { CleCompteCabinet } from "../cles.js";

/*
 * Outils partagés des modules de la phase « appels-offres-canaux » (lot 5 du Tenant démo).
 *
 * Les missions sont celles du casting du lot 2a, retrouvées par leur intitulé EXACT
 * (`missions.intitule` : le brief les appelle `nom`).
 */

/** Intitulés EXACTS du casting (voir brief-commun.md) ; clé = rôle de la mission dans la démo. */
export const MISSIONS_CASTING = {
  planSicafe: "Plan stratégique 2025-2028 — SICAFE",
  notationSahel: "Notation financière — Sahel Coton",
  redressementWouri: "Redressement — Brasseries du Wouri",
  ddMboa: "Due diligence — Mboa Solaire",
  businessPlanAtlantique: "Business plan bancable — Atlantique Retail",
  planBaobab: "Plan stratégique 2026-2030 — Baobab Assurances",
  redressementGabon: "Redressement — Gabon Offshore Services",
  flashTeranga: "Diagnostic flash — Teranga Logistique",
  notationBanqueSahel: "Notation financière — Banque du Sahel (portefeuille PME)",
  planSicafeExport: "Plan stratégique — Sicafe Export",
  ddWouriDistribution: "Due diligence — Wouri Distribution",
} as const;
export type CleMissionCasting = keyof typeof MISSIONS_CASTING;

/** Les 5 missions TERMINÉES (clôturées) du casting. */
export const CLES_MISSIONS_TERMINEES: readonly CleMissionCasting[] = [
  "planSicafe",
  "notationSahel",
  "redressementWouri",
  "ddMboa",
  "businessPlanAtlantique",
];

export interface MissionCasting {
  id: string;
  intitule: string;
  statut: string;
  clientId: string;
}

/** Mission du casting (erreur claire si la phase `missions` ne l'a pas créée). */
export async function missionDuCasting(
  ctx: ContexteTenantDemo,
  cle: CleMissionCasting,
): Promise<MissionCasting> {
  const intitule = MISSIONS_CASTING[cle];
  const r = await ctx.proprietaire.query(
    "SELECT id, intitule, statut, client_id FROM missions WHERE cabinet_id = $1 AND intitule = $2",
    [ctx.cabinetId, intitule],
  );
  const m = r.rows[0] as
    { id: string; intitule: string; statut: string; client_id: string } | undefined;
  if (!m) {
    throw new Error(
      `Mission « ${intitule} » introuvable : la phase « missions » (lot 2a) doit passer avant « appels-offres-canaux ».`,
    );
  }
  return { id: m.id, intitule: m.intitule, statut: m.statut, clientId: m.client_id };
}

/** Requête SQL du rôle propriétaire (lecture, ou écriture que les routes interdisent). */
export async function sql<T = Record<string, unknown>>(
  ctx: ContexteTenantDemo,
  texte: string,
  valeurs: unknown[] = [],
): Promise<T[]> {
  return (await ctx.proprietaire.query(texte, valeurs)).rows as T[];
}

/** Vrai si la requête (`SELECT 1 …`) renvoie au moins une ligne : test d'idempotence par clé naturelle. */
export async function existe(
  ctx: ContexteTenantDemo,
  texte: string,
  valeurs: unknown[] = [],
): Promise<boolean> {
  return (await ctx.proprietaire.query(texte, valeurs)).rowCount !== 0;
}

/** Corps multipart d'un fichier (champ `fichier`), pour `app.inject`. */
function multipart(nom: string, contenu: Buffer, type: string, seed: string) {
  const frontiere = `----mptd${seed}`;
  const entete =
    `--${frontiere}\r\nContent-Disposition: form-data; name="fichier"; filename="${nom}"\r\n` +
    `Content-Type: ${type}\r\n\r\n`;
  return {
    payload: Buffer.concat([
      Buffer.from(entete, "utf8"),
      contenu,
      Buffer.from(`\r\n--${frontiere}--\r\n`, "utf8"),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${frontiere}` },
  };
}

/** Téléverse un fichier par une vraie route (201 attendu) et renvoie l'identifiant créé. */
export async function televerser(
  ctx: ContexteTenantDemo,
  s: SessionDemo,
  url: string,
  nom: string,
  contenu: Buffer,
  type: string,
): Promise<string> {
  const m = multipart(nom, contenu, type, nom.replace(/[^a-z0-9]/gi, "").slice(0, 16));
  const r = await ctx.app.inject({
    method: "POST",
    url,
    headers: { cookie: s.cookie, ...m.headers },
    payload: m.payload,
  });
  attendre(201, r, `téléversement ${nom}`);
  return (r.json() as { id: string }).id;
}

/** Clé du compte du cabinet qui est le chef (ou le directeur) de la mission ; sinon l'associé fondateur. */
async function acteurDeMission(
  ctx: ContexteTenantDemo,
  missionId: string,
  colonne: "chef_id" | "directeur_id",
): Promise<CleCompteCabinet> {
  const r = await ctx.proprietaire.query(
    colonne === "chef_id"
      ? "SELECT chef_id AS u FROM missions WHERE id = $1"
      : "SELECT directeur_id AS u FROM missions WHERE id = $1",
    [missionId],
  );
  const id = (r.rows[0] as { u: string | null } | undefined)?.u;
  const cle = (Object.keys(ctx.utilisateurs) as CleCompteCabinet[]).find(
    (k) => ctx.utilisateurs[k] === id && ctx.sessions[k],
  );
  return cle ?? "associe";
}

/** Compte du chef de la mission (le seul visible à coup sûr dans une mission du casting). */
export const chefDe = (ctx: ContexteTenantDemo, missionId: string) =>
  acteurDeMission(ctx, missionId, "chef_id");

/** Compte du directeur de la mission. */
export const directeurDe = (ctx: ContexteTenantDemo, missionId: string) =>
  acteurDeMission(ctx, missionId, "directeur_id");
