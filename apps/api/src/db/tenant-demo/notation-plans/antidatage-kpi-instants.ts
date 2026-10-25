import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql, etalerSurFenetre } from "./antidatage.js";
import type { MissionTrouvee } from "./casting.js";

/*
 * Antidatage des instants techniques des KPI d'UNE mission terminée : définitions, cibles,
 * contributeurs, mesures, alertes et rappels. Toutes les requêtes sont littérales, filtrées par
 * `cabinet_id`, exécutées en mode « replica » (`appliquerSql`) ; les paramètres portent les
 * bornes de la mission ($3 plancher, $4 plafond) et la graine ($5).
 *
 * Valeur calculée PAR LIGNE depuis la date métier de la ligne :
 *  - mesure : date de la mesure + 1 à 4 jours (jour et heure tirés de md5(libellé | date | graine),
 *    donc déterministes), + 1 jour par ligne de même date dans l'ordre d'écriture (annulation,
 *    ressaisie) ; jamais avant le début de la mission (+ 1 h) ni après son plafond ;
 *  - alerte : une à vingt minutes après la dernière saisie de sa période ;
 *  - rappel : le 8 du mois suivant la période, 7 h UTC (heure de la tâche quotidienne).
 */

export interface BornesKpi {
  mission: MissionTrouvee;
  /** Début de mission, 08:00 UTC (création des définitions). */
  debut: string;
  /** Plancher des saisies : début de mission + 1 h. */
  plancher: string;
  /** Fin de mission, 17:00 UTC. */
  fin: string;
  /** Plafond absolu : fin de mission + 4 jours, 17:00 UTC. */
  plafond: string;
  /** Graine textuelle dérivée de `ctx.alea.deriver("antidatage-kpi")`. */
  graine: string;
}

export function bornesKpi(ctx: ContexteTenantDemo, m: MissionTrouvee): BornesKpi {
  if (!m.dateDebut || !m.dateFin) throw new Error(`Mission « ${m.intitule} » sans dates.`);
  const graine = ctx.alea.deriver("antidatage-kpi").deriver(m.intitule).entier(1, 1_000_000);
  return {
    mission: m,
    debut: `${m.dateDebut}T08:00:00Z`,
    plancher: `${m.dateDebut}T09:00:00Z`,
    fin: `${m.dateFin}T17:00:00Z`,
    plafond: `${ajouterJours(m.dateFin, 4)}T17:00:00Z`,
    graine: String(graine),
  };
}

/** Un octet (0 à 255) tiré d'un condensat md5 hexadécimal `h` : positions 1, 3 ou 5. */
const octet = (h: string, pos: 1 | 3 | 5): string =>
  `get_byte(decode(substr(${h}, ${pos}, 2), 'hex'), 0)`;

/**
 * Définitions : celles du catalogue (`libellesCatalogue`) sont créées dans l'heure qui suit le début
 * de la mission, dans leur ordre d'écriture réel ; une définition créée par un plan (absente du
 * catalogue) l'est 30 minutes avant le premier lien d'un objectif de plan (déjà antidaté), à défaut
 * une heure après le début. Dernière modification = fin de mission (fin du suivi).
 */
export async function antidaterDefinitions(
  ctx: ContexteTenantDemo,
  b: BornesKpi,
  libellesCatalogue: readonly string[],
): Promise<void> {
  await etalerSurFenetre(
    ctx,
    [
      {
        select: `SELECT id, cree_le AS t FROM kpi_definitions
                  WHERE cabinet_id = $1 AND mission_id = $2 AND libelle = ANY($3::text[])`,
        params: [b.mission.id, libellesCatalogue],
        update:
          "UPDATE kpi_definitions SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
      },
    ],
    b.debut,
    `${b.mission.dateDebut}T08:59:00Z`,
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_definitions d
        SET cree_le = LEAST($4::timestamptz, GREATEST($3::timestamptz,
              COALESCE((SELECT min(l.cree_le) FROM plan_objectif_kpis l
                         WHERE l.cabinet_id = $1 AND l.kpi_id = d.id) - interval '30 minutes',
                       $3::timestamptz + interval '1 hour')))
      WHERE d.cabinet_id = $1 AND d.mission_id = $2 AND NOT (d.libelle = ANY($5::text[]))`,
    [ctx.cabinetId, b.mission.id, b.debut, b.plafond, libellesCatalogue],
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_definitions
        SET modifie_le = LEAST($4::timestamptz, GREATEST(cree_le, $3::timestamptz))
      WHERE cabinet_id = $1 AND mission_id = $2`,
    [ctx.cabinetId, b.mission.id, b.fin, b.plafond],
  );
}

/** Cibles (version 1 : une minute après la définition ; révisions : à la date d'effet) et contributeurs. */
export async function antidaterCiblesEtContributeurs(
  ctx: ContexteTenantDemo,
  b: BornesKpi,
): Promise<void> {
  await appliquerSql(
    ctx,
    `UPDATE kpi_cibles c
        SET cree_le = CASE WHEN c.version = 1 THEN d.cree_le + interval '1 minute'
              ELSE LEAST($3::timestamptz, GREATEST(d.cree_le + interval '2 minutes',
                     ((c.a_partir_de::timestamp + interval '8 hours 30 minutes') AT TIME ZONE 'UTC')
                       + c.version * interval '1 minute')) END
       FROM kpi_definitions d
      WHERE c.cabinet_id = $1 AND d.cabinet_id = $1 AND d.id = c.kpi_id AND d.mission_id = $2`,
    [ctx.cabinetId, b.mission.id, b.plafond],
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_contributeurs c SET ajoute_le = d.cree_le + interval '2 minutes'
       FROM kpi_definitions d
      WHERE c.cabinet_id = $1 AND d.cabinet_id = $1 AND d.id = c.kpi_id AND d.mission_id = $2`,
    [ctx.cabinetId, b.mission.id],
  );
}

/** Saisies des mesures, alertes et rappels de relance. */
export async function antidaterMesuresEtAlertes(
  ctx: ContexteTenantDemo,
  b: BornesKpi,
): Promise<void> {
  const h = "r.h";
  await appliquerSql(
    ctx,
    `WITH base AS (
       SELECT me.id, me.kpi_id, me.date_mesure, me.numero,
              md5(d.libelle || '|' || me.date_mesure::text || '|' || $5::text) AS h
         FROM kpi_mesures me
         JOIN kpi_definitions d ON d.id = me.kpi_id AND d.cabinet_id = me.cabinet_id
        WHERE me.cabinet_id = $1 AND d.mission_id = $2
     ), r AS (
       SELECT base.*, row_number() OVER (PARTITION BY kpi_id, date_mesure ORDER BY numero) AS rn
         FROM base
     )
     UPDATE kpi_mesures m
        SET saisie_le = LEAST($4::timestamptz, GREATEST(
              $3::timestamptz + (${octet(h, 5)} % 50) * interval '1 minute',
              ((r.date_mesure::timestamp
                 + (1 + ${octet(h, 1)} % 4) * interval '1 day'
                 + (8 + ${octet(h, 3)} % 9) * interval '1 hour'
                 + (${octet(h, 5)} % 60) * interval '1 minute') AT TIME ZONE 'UTC')
                + (r.rn - 1) * interval '1 day'))
       FROM r
      WHERE m.id = r.id AND m.cabinet_id = $1`,
    [ctx.cabinetId, b.mission.id, b.plancher, b.plafond, b.graine],
  );
  const ha = "md5(a.code || '|' || a.periode_cle || '|' || $4::text)";
  await appliquerSql(
    ctx,
    `UPDATE kpi_alertes a
        SET detectee_le = LEAST($3::timestamptz, COALESCE(
              (SELECT max(m.saisie_le) FROM kpi_mesures m
                WHERE m.cabinet_id = $1 AND m.kpi_id = a.kpi_id
                  AND to_char(m.date_mesure, 'YYYY-MM') = a.periode_cle)
                + (1 + ${octet(ha, 1)} % 20) * interval '1 minute',
              $3::timestamptz))
       FROM kpi_definitions d
      WHERE a.cabinet_id = $1 AND d.cabinet_id = $1 AND d.id = a.kpi_id AND d.mission_id = $2`,
    [ctx.cabinetId, b.mission.id, b.plafond, b.graine],
  );
  await appliquerSql(
    ctx,
    `UPDATE kpi_rappels r
        SET envoye_le = LEAST($3::timestamptz,
              ((to_date(r.periode_cle || '-01', 'YYYY-MM-DD') + interval '1 month 7 days 7 hours')
                 AT TIME ZONE 'UTC'))
       FROM kpi_definitions d
      WHERE r.cabinet_id = $1 AND d.cabinet_id = $1 AND d.id = r.kpi_id AND d.mission_id = $2
        AND r.periode_cle ~ '^[0-9]{4}-[0-9]{2}$'`,
    [ctx.cabinetId, b.mission.id, b.plafond],
  );
}
