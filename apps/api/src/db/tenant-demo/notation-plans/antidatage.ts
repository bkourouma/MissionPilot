import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import type { MissionTrouvee } from "./casting.js";

/*
 * Antidatage des objets de la phase « notation-plans » pour les missions TERMINÉES (1 à 5).
 *
 * Les routes horodatent tout « maintenant » (jour du semis) et plusieurs tables sont en ajout seul
 * ou figées par des déclencheurs : une mission clôturée en 2025 montrerait des notations, plans et
 * envois datés d'octobre 2026. Ce module remonte ces DATES (jamais du contenu) par du SQL du rôle
 * PROPRIÉTAIRE, dans une transaction avec `session_replication_role = replica` (même technique
 * bornée que `appliquerSql` de redressement-dd/commun.ts). Chaque requête est LITTÉRALE, écrite
 * par l'appelant, filtrée par `cabinet_id` : le module n'interpole jamais un nom de table.
 *
 * Principe : `etalerSurFenetre` prend des SOURCES (un SELECT d'identifiants et d'instants, plus
 * l'UPDATE qui pose le nouvel instant), les fusionne dans leur ordre d'écriture RÉEL, puis répartit
 * ces instants linéairement sur une fenêtre de la période de la mission. L'ordre entre lignes (et
 * entre tables d'un même objet : calcul, ajustements, soumission, publication) est donc conservé.
 * Rejouable : les rangs ne changent pas, les instants calculés non plus.
 */

/** Une source d'instants à répartir. */
export interface SourceInstants {
  /**
   * SELECT littéral renvoyant `id` (uuid) et `t` (timestamptz), filtré par `cabinet_id = $1`
   * (premier paramètre = `ctx.cabinetId`, les suivants dans `params`).
   */
  select: string;
  params?: readonly unknown[];
  /**
   * UPDATE littéral : `$1` = id, `$2` = nouvel instant (timestamptz), `$3` = cabinet_id ;
   * toujours `WHERE id = $1 AND cabinet_id = $3`.
   */
  update: string;
}

const instant = (ms: number): string => new Date(ms).toISOString();

/**
 * Répartit les instants de `sources` (ordre d'écriture conservé) linéairement entre `debut` et
 * `fin` (instants ISO). Une seule ligne : milieu de la fenêtre. Retourne le nombre de lignes.
 */
export async function etalerSurFenetre(
  ctx: ContexteTenantDemo,
  sources: readonly SourceInstants[],
  debut: string,
  fin: string,
): Promise<number> {
  const lignes: { id: string; t: number; source: number }[] = [];
  for (const [i, s] of sources.entries()) {
    const r = await ctx.proprietaire.query<{ id: string; t: Date }>(s.select, [
      ctx.cabinetId,
      ...(s.params ?? []),
    ]);
    for (const l of r.rows) lignes.push({ id: l.id, t: l.t.getTime(), source: i });
  }
  lignes.sort((a, b) => a.t - b.t || a.source - b.source || (a.id < b.id ? -1 : 1));
  if (lignes.length === 0) return 0;
  const d = Date.parse(debut);
  const f = Date.parse(fin);
  if (!(f >= d)) throw new Error(`Fenêtre d'antidatage invalide : ${debut} → ${fin}`);
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    for (const [rang, l] of lignes.entries()) {
      const part = lignes.length === 1 ? 0.5 : rang / (lignes.length - 1);
      const nouveau = instant(Math.round(d + (f - d) * part));
      await c.query((sources[l.source] as SourceInstants).update, [l.id, nouveau, ctx.cabinetId]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  return lignes.length;
}

/**
 * Exécute UNE requête littérale d'antidatage (UPDATE de colonnes de dates seulement) dans une
 * transaction en mode « replica » : déclencheurs d'ajout seul et d'immuabilité levés pour cette
 * requête. Toujours filtrée par `cabinet_id`. Jamais de nom de table interpolé.
 */
export async function appliquerSql(
  ctx: ContexteTenantDemo,
  sql: string,
  parametres: readonly unknown[],
): Promise<void> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(sql, [...parametres]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

export interface Fenetre {
  debut: string;
  fin: string;
}

/** Marge après la fin de mission (la clôture fictive reste ≤ fin + 6 jours). */
const MARGE_FIN_JOURS = 4;

/**
 * Sous-fenêtre [`a`, `b`] (fractions de 0 à 1) de la période de la mission, en instants ISO
 * (08:00 UTC au début, 17:00 UTC à la fin). `b` peut valoir 1 : la fin est alors la date de fin de
 * mission + 4 jours au plus (`apresFin: true`), sinon la date de fin elle-même.
 */
export function sousFenetre(
  m: MissionTrouvee,
  a: number,
  b: number,
  options: { apresFin?: boolean } = {},
): Fenetre {
  const debutM = m.dateDebut;
  const finM = m.dateFin;
  if (!debutM || !finM)
    throw new Error(`Mission « ${m.intitule} » sans dates : antidatage impossible.`);
  const jours = Math.round((Date.parse(finM) - Date.parse(debutM)) / 86_400_000);
  const jourA = ajouterJours(debutM, Math.round(jours * a));
  const jourB =
    options.apresFin && b >= 1
      ? ajouterJours(finM, MARGE_FIN_JOURS)
      : ajouterJours(debutM, Math.round(jours * b));
  return { debut: `${jourA}T08:00:00Z`, fin: `${jourB < jourA ? jourA : jourB}T17:00:00Z` };
}

/** Vrai pour une mission terminée du casting (numéros 1 à 5 : leurs objets sont antidatés). */
export const estTerminee = (numero: number): boolean => numero >= 1 && numero <= 5;
