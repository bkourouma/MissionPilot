import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { ErreurKpi } from "@missionpilot/engines";
import type { Database, Db } from "../db/pool.js";
import type { HandlerJob } from "../jobs/registre.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import { aujourdhui } from "../missions/outils.js";
import { envoyerEmails, notifier, type NotificationCreee } from "../notifications/notifier.js";
import { destinatairesKpiAutorises } from "./acces.js";
import {
  ciblesDe,
  COLONNES_KPI,
  lireParametresKpi,
  mesuresActivesDe,
  parKpi,
  versDefinition,
  type DefinitionKpi,
  type ParametresKpi,
} from "./donnees.js";
import { evaluerSerieKpi, type AlerteDatee } from "./evaluation.js";
import { detailsAlerte } from "./vues.js";

/*
 * Alertes et rappels du pilotage par KPI (KPI-02, KPI-04).
 *
 * - Les alertes sont DÉTECTÉES par le moteur (kpi/evaluation.ts) ; ce module
 *   les enregistre (kpi_alertes, une par KPI, code et période : un second
 *   passage n'en crée pas de nouvelle) et notifie les responsables du KPI
 *   (propriétaire, directeur et chef de la mission) encore autorisés à le
 *   lire (kpi/acces.ts, règle 5), in-app et e-mail, sans aucune valeur
 *   chiffrée dans le texte.
 * - Rappel de mesure en retard : un par KPI et par période due
 *   (kpi_rappels), adressé aux contributeurs du portail du KPI dont l'accès
 *   au portail ET l'entreprise cliente sont actifs, et à son propriétaire
 *   (même contrôle que les alertes). Désactivable pour le cabinet
 *   (`kpi_parametres`) et par KPI (`rappels_actifs`).
 * - Tâche quotidienne « kpi_suivi » (clé kpi_suivi:AAAA-MM-JJ, 7 h UTC) :
 *   évalue tous les KPI actifs des missions non clôturées du cabinet.
 *   Idempotente : relancée, elle ne recrée ni alerte ni rappel.
 */

export const TYPE_JOB_SUIVI_KPI = "kpi_suivi";
/** Heure de la tâche quotidienne (UTC), avant la journée de travail UEMOA ; à valider. */
export const HEURE_SUIVI_KPI_UTC = "07:00:00";

const LIBELLES_ALERTES: Record<AlerteDatee["alerte"]["code"], string> = {
  DEGRADATION_CONSECUTIVE: "dégradation sur plusieurs périodes consécutives",
  MESURE_EN_RETARD: "mesure en retard",
  SEUIL_HAUT: "seuil d'alerte haut dépassé",
  SEUIL_BAS: "seuil d'alerte bas franchi",
  VARIATION: "variation au-delà du seuil d'alerte",
};

interface KpiSuivi {
  def: DefinitionKpi;
  directeur_id: string | null;
  chef_id: string | null;
}

/** KPI actifs des missions non clôturées du cabinet (ou ceux listés). */
async function kpiASuivre(db: Db, ids: readonly string[] | null): Promise<KpiSuivi[]> {
  const r = await db.query(
    `SELECT ${COLONNES_KPI}, m.directeur_id, m.chef_id
     FROM kpi_definitions d JOIN missions m ON m.id = d.mission_id
     WHERE d.actif AND m.statut <> 'cloturee' AND ($1::uuid[] IS NULL OR d.id = ANY ($1::uuid[]))
     ORDER BY d.id`,
    [ids],
  );
  return r.rows.map((l) => ({
    def: versDefinition(l),
    directeur_id: (l.directeur_id as string | null) ?? null,
    chef_id: (l.chef_id as string | null) ?? null,
  }));
}

function responsables(k: KpiSuivi): string[] {
  const ids = [k.def.proprietaire_id, k.directeur_id, k.chef_id].filter(
    (x): x is string => x !== null,
  );
  return [...new Set(ids)];
}

async function enregistrerAlertes(
  db: Db,
  cabinetId: string,
  k: KpiSuivi,
  alertes: readonly AlerteDatee[],
): Promise<NotificationCreee[]> {
  const notifications: NotificationCreee[] = [];
  let destinataires: string[] | null = null;
  for (const a of alertes) {
    const r = await db.query(
      `INSERT INTO kpi_alertes (cabinet_id, kpi_id, code, periode_cle, details)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cabinet_id, kpi_id, code, periode_cle) DO NOTHING RETURNING id`,
      [cabinetId, k.def.id, a.alerte.code, a.periode_cle, JSON.stringify(detailsAlerte(a.alerte))],
    );
    if (!r.rows[0]) continue;
    destinataires ??= await destinatairesKpiAutorises(db, k.def.mission_id, responsables(k));
    for (const destinataireId of destinataires) {
      const n = await notifier(db, {
        cabinetId,
        destinataireId,
        type: "kpi_alerte",
        titre: `KPI « ${k.def.libelle} » : ${LIBELLES_ALERTES[a.alerte.code]} (${a.periode_cle})`,
        corps: "Consultez le tableau de bord des KPI de la mission pour le détail.",
        lien: `/missions/${k.def.mission_id}/kpi`,
        email: true,
      });
      if (n) notifications.push(n);
    }
  }
  return notifications;
}

async function envoyerRappel(
  db: Db,
  cabinetId: string,
  k: KpiSuivi,
  periodeCle: string,
): Promise<NotificationCreee[]> {
  // Contributeur joignable : compte actif, accès au portail actif, entreprise cliente active.
  const c = await db.query(
    `SELECT c.utilisateur_id FROM kpi_contributeurs c
     JOIN utilisateurs u ON u.id = c.utilisateur_id AND u.actif
     JOIN utilisateurs_portail up ON up.utilisateur_id = c.utilisateur_id AND up.statut = 'actif'
       AND up.client_id = $2
     JOIN clients cl ON cl.id = up.client_id AND cl.actif
     WHERE c.kpi_id = $1 ORDER BY c.utilisateur_id`,
    [k.def.id, k.def.client_id],
  );
  const contributeurs = c.rows.map((l) => l.utilisateur_id as string);
  const internes = await destinatairesKpiAutorises(
    db,
    k.def.mission_id,
    k.def.proprietaire_id ? [k.def.proprietaire_id] : [],
  );
  if (contributeurs.length + internes.length === 0) return [];
  const r = await db.query(
    `INSERT INTO kpi_rappels (cabinet_id, kpi_id, periode_cle, destinataires)
     VALUES ($1, $2, $3, $4) ON CONFLICT (cabinet_id, kpi_id, periode_cle) DO NOTHING RETURNING id`,
    [cabinetId, k.def.id, periodeCle, contributeurs.length + internes.length],
  );
  if (!r.rows[0]) return [];
  const notifications: NotificationCreee[] = [];
  const envoyer = async (destinataireId: string, lien: string) => {
    const n = await notifier(db, {
      cabinetId,
      destinataireId,
      type: "kpi_rappel_mesure",
      titre: `Mesure attendue pour le KPI « ${k.def.libelle} » (${periodeCle})`,
      corps: "La mesure de cette période n'a pas encore été saisie.",
      lien,
      email: true,
    });
    if (n) notifications.push(n);
  };
  for (const id of contributeurs) await envoyer(id, `/portail/kpi/${k.def.id}`);
  for (const id of internes) await envoyer(id, `/missions/${k.def.mission_id}/kpi`);
  return notifications;
}

export interface OptionsSuivi {
  /** KPI à évaluer (défaut : tous les KPI actifs des missions non clôturées). */
  kpiIds?: readonly string[];
  /**
   * Évaluation qui suit une saisie : seuils et dégradation seulement (une
   * saisie ne crée pas de retard) ; ni alerte de retard ni rappel.
   */
  apresSaisie?: boolean;
}

/**
 * Évalue les KPI à la date donnée, enregistre les nouvelles alertes et envoie
 * les rappels dus. Renvoie les notifications créées (e-mails après validation).
 * Un KPI dont la configuration est refusée par le moteur est ignoré.
 */
export async function suivreKpis(
  db: Db,
  cabinetId: string,
  date: string,
  options: OptionsSuivi = {},
): Promise<NotificationCreee[]> {
  const params: ParametresKpi = await lireParametresKpi(db);
  const kpis = await kpiASuivre(db, options.kpiIds ?? null);
  const ids = kpis.map((k) => k.def.id);
  const cibles = parKpi(await ciblesDe(db, ids));
  const mesures = parKpi(await mesuresActivesDe(db, ids));
  const notifications: NotificationCreee[] = [];
  for (const k of kpis) {
    let alertes: AlerteDatee[];
    try {
      alertes = evaluerSerieKpi(
        k.def,
        mesures.get(k.def.id) ?? [],
        cibles.get(k.def.id) ?? [],
        date,
        params,
      ).alertes.filter((a) => !options.apresSaisie || a.alerte.code !== "MESURE_EN_RETARD");
    } catch (error) {
      if (error instanceof ErreurKpi) continue;
      throw error;
    }
    notifications.push(...(await enregistrerAlertes(db, cabinetId, k, alertes)));
    const retard = alertes.find((a) => a.alerte.code === "MESURE_EN_RETARD");
    const rappels = !options.apresSaisie && params.rappels_actifs && k.def.rappels_actifs;
    if (retard && rappels) {
      notifications.push(...(await envoyerRappel(db, cabinetId, k, retard.periode_cle)));
    }
  }
  return notifications;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Handler de la tâche « kpi_suivi » : charge { date: AAAA-MM-JJ } (défaut : jour du worker). */
export function creerHandlerSuiviKpi(): HandlerJob {
  return async (ctx) => {
    const date = ctx.charge.date ?? ctx.maintenant.toISOString().slice(0, 10);
    if (typeof date !== "string" || !DATE.test(date)) {
      throw new ErreurJobDefinitive("Charge de la tâche kpi_suivi invalide.");
    }
    return suivreKpis(ctx.db, ctx.cabinetId, date);
  };
}

/** Suivi du jour de `maintenant` : clé unique par cabinet et par jour. */
export function planificationSuiviKpi(maintenant: Date): {
  cle: string;
  executeA: Date;
  jour: string;
} {
  const jour = maintenant.toISOString().slice(0, 10);
  return {
    cle: `kpi_suivi:${jour}`,
    executeA: new Date(`${jour}T${HEURE_SUIVI_KPI_UTC}Z`),
    jour,
  };
}

/**
 * Planifie la tâche du jour pour les cabinets ayant un KPI actif (fonction
 * SECURITY DEFINER étroite) ; renvoie le nombre de tâches créées. À appeler
 * depuis le planificateur récurrent (jobs/planificateur.ts).
 */
export async function planifierSuiviKpi(database: Database, maintenant: Date): Promise<number> {
  const p = planificationSuiviKpi(maintenant);
  return database.withoutTenant(async (db) => {
    const r = await db.query("SELECT planifier_suivi_kpi($1, $2, $3) AS n", [
      p.cle,
      p.executeA,
      p.jour,
    ]);
    return r.rows[0].n as number;
  });
}

/**
 * Après la VALIDATION d'une saisie (cabinet ou portail) : alertes de seuil et
 * de dégradation du KPI, notifiées aux responsables, dans une transaction
 * interne distincte (jamais celle du portail : les tables d'alertes y sont
 * invisibles). Un échec n'annule pas la saisie déjà validée : la tâche
 * quotidienne « kpi_suivi » reprendra l'évaluation.
 */
export async function evaluerApresSaisie(
  app: FastifyInstance,
  cabinetId: string,
  kpiId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const notifications = await app.db.withTenant(cabinetId, (db) =>
      suivreKpis(db, cabinetId, aujourdhui(), { kpiIds: [kpiId], apresSaisie: true }),
    );
    await envoyerEmails(app.mailer, notifications, (m) => log.warn(m));
  } catch (error) {
    log.warn({ message: (error as Error).message }, "Évaluation des alertes KPI reportée.");
  }
}
