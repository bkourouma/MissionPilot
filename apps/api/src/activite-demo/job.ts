import {
  ajouterJours,
  choisirMissionDeriveDemo,
  estLundiDuMoisDemo,
  jourEvenementDemo,
  lundiDeLaSemaine,
  lundisRestantsDemo,
  PARAMETRES_ACTIVITE_DEMO,
  semainesAGenererDemo,
  type DateISO,
} from "@missionpilot/engines";
import { chargeActiviteDemoSchema, type ChargeActiviteDemo } from "@missionpilot/shared";
import { journaliserIncident } from "../automatisation/diagnostic.js";
import { activiteDemoActive, loadConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { ContexteJob, HandlerJob } from "../jobs/registre.js";
import { evaluerAlertes } from "../temps/suivi.js";
import {
  ACTIONS_ACTIVITE_DEMO,
  bilanVideActiviteDemo,
  contexteActiviteDemo,
  dansPointDeSauvegarde,
  dernierMarqueur,
  poserMarqueur,
  type BilanActiviteDemo,
  type ContexteActiviteDemo,
} from "./commun.js";
import { maintenirDeriveDemo, missionsPourDeriveDemo } from "./derive.js";
import { encaisserSemaineDemo, facturerSemaineDemo, poserJalonDemo } from "./evenements.js";
import { genererFeuillesSemaineDemo, tachesCapaciteDemo } from "./feuilles.js";
import { lireCabinetDemo, lireSemaineDemo, type LecturesSemaineDemo } from "./lecture.js";
import {
  cleSuiteActiviteDemo,
  HEURE_SUITE_ACTIVITE_DEMO_UTC,
  TYPE_JOB_ACTIVITE_DEMO,
} from "./planification.js";
import { prolongerMoisDemo } from "./prolongation.js";

/*
 * Activité de démonstration automatique (job « activite_demo », §2.3 de la spécification,
 * DECISIONS « Activité de démonstration automatique », 2026-11-01).
 *
 * - Tâche MENSUELLE (charge { mois }) : met en file une tâche de SUITE par lundi restant du mois
 *   (charge { mois, semaine }, 5 h UTC, clé unique), prolonge les missions socles (avenant du mois,
 *   prolongation.ts), puis traite les semaines du mois écoulées jusqu'au jour (6 au plus).
 * - Tâche de SUITE : sa seule semaine, jamais une semaine à venir.
 * - Une semaine : feuilles de temps complètes, soumises et validées (feuilles.ts), dérive d'UNE mission
 *   maintenue dans sa bande (derive.ts), alertes de suivi réévaluées SANS notification, puis, pour la
 *   seule semaine qui contient le jour d'exécution (DT2), un jalon, une facture et un encaissement
 *   (evenements.ts). Tous les chiffres sortent des moteurs de `packages/engines`.
 * - Activation lue à CHAQUE exécution (DT14) : inactive, aucune écriture. Cabinet hors périmètre
 *   (non démo ou désactivé) ou en saisie à l'heure (DT10) : aucune écriture.
 * - Garde-fous (DT15) : délais de verrou et d'instruction bornés, verrou consultatif par cabinet,
 *   un point de sauvegarde par unité (commun.ts) ; les erreurs non isolables (sérialisation, verrou
 *   mortel, délai, connexion) remontent au worker, qui retente la tâche entière (idempotente, §2.5).
 * - Aucun e-mail : le handler ne rend aucune notification (worker.ts, `envoyerEmails`), et le job
 *   ne publie aucun signal de réveil du worker : ses suites sont différées.
 */

/** Plafonds de lecture d'une semaine (§2.6). */
const PLAFONDS = {
  collaborateursMax: PARAMETRES_ACTIVITE_DEMO.collaborateursMax,
  missionsMax: PARAMETRES_ACTIVITE_DEMO.missionsMax,
} as const;

/** Profondeur de lecture du marqueur de dérive (jours) : la mission choisie reste stable. */
const PROFONDEUR_MARQUEUR_DERIVE_JOURS = 400;

export interface OptionsActiviteDemo {
  /** Activation lue à chaque exécution (DT14) ; les tests l'injectent. */
  actif: () => boolean;
}

/** Activation depuis la configuration de l'environnement ; une configuration illisible la coupe. */
export const activiteDemoDepuisConfiguration = (): boolean => {
  try {
    return activiteDemoActive(loadConfig());
  } catch {
    return false;
  }
};

/** Charge validée (schéma strict) ; une semaine qui n'est pas un lundi du mois est refusée. */
function chargeValide(charge: Record<string, unknown>): ChargeActiviteDemo {
  const r = chargeActiviteDemoSchema.safeParse(charge);
  if (
    !r.success ||
    (r.data.semaine !== undefined && !estLundiDuMoisDemo(r.data.mois, r.data.semaine))
  ) {
    throw new ErreurJobDefinitive("Charge de la tâche activite_demo invalide.");
  }
  return r.data;
}

/** Délais bornés et une seule exécution à la fois par cabinet (DT15). */
async function garderTransactionDemo(db: Db, cabinetId: string): Promise<void> {
  await db.query("SET LOCAL lock_timeout = '5s'");
  await db.query("SET LOCAL statement_timeout = '30s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${TYPE_JOB_ACTIVITE_DEMO}:${cabinetId}`,
  ]);
}

/**
 * Tâches de suite des lundis restants du mois (clé unique : rejouable sans doublon). Aucun signal
 * de réveil : chacune attend son lundi à 5 h UTC.
 */
async function mettreEnFileSuites(c: ContexteActiviteDemo): Promise<void> {
  for (const lundi of lundisRestantsDemo(c.mois, c.jour)) {
    const r = await c.db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
      [
        c.cabinetId,
        TYPE_JOB_ACTIVITE_DEMO,
        JSON.stringify({ mois: c.mois, semaine: lundi }),
        new Date(`${lundi}T${HEURE_SUITE_ACTIVITE_DEMO_UTC}Z`),
        cleSuiteActiviteDemo(c.mois, lundi),
      ],
    );
    c.bilan.suites += r.rowCount ?? 0;
  }
}

/** Lecture d'une semaine, plafonnée (un plafond atteint est consigné par lecture.ts). */
const lireSemaine = (c: ContexteActiviteDemo, lundi: DateISO): Promise<LecturesSemaineDemo> =>
  lireSemaineDemo(c.db, c.cabinetId, lundi, PLAFONDS);

/** Tâche MENSUELLE : suites, avenant du mois, puis semaines écoulées du mois (6 au plus). */
async function preparerMoisDemo(c: ContexteActiviteDemo): Promise<DateISO[]> {
  await mettreEnFileSuites(c);
  const l0 = await lireSemaine(c, lundiDeLaSemaine(c.jour));
  c.bilan.prolongations = (await prolongerMoisDemo(c, l0.missions, l0.collaborateurs)).length;
  return semainesAGenererDemo(c.mois, c.jour, PARAMETRES_ACTIVITE_DEMO.semainesMax);
}

/** Tâche de SUITE : sa seule semaine, jamais une semaine à venir. */
function semaineDeSuite(c: ContexteActiviteDemo, semaine: DateISO): DateISO[] {
  return semaine <= lundiDeLaSemaine(c.jour) ? [semaine] : [];
}

/** Mission maintenue en dérive : celle du dernier marqueur si elle reste éligible (stabilité, DT6). */
async function missionEnDeriveDemo(
  c: ContexteActiviteDemo,
  l: LecturesSemaineDemo,
): Promise<string | null> {
  const depuis = ajouterJours(c.jour, -PROFONDEUR_MARQUEUR_DERIVE_JOURS);
  const marque = await dernierMarqueur(c.db, ACTIONS_ACTIVITE_DEMO.derive, depuis);
  return choisirMissionDeriveDemo(missionsPourDeriveDemo(l, c.acteurs), marque?.entiteId ?? null);
}

/** Alertes de suivi des missions touchées, SANS notification ni e-mail (DT9). */
async function reevaluerAlertesDemo(
  c: ContexteActiviteDemo,
  missions: ReadonlySet<string>,
): Promise<void> {
  for (const m of [...missions].sort()) {
    await dansPointDeSauvegarde(c, "ad_alertes", "alertes", { mission_id: m }, () =>
      evaluerAlertes(c.db, c.cabinetId, m, { notifier: false }),
    );
  }
}

/** Une semaine : feuilles, dérive, alertes, puis événements de la semaine courante seulement. */
async function genererSemaineDemo(c: ContexteActiviteDemo, lundi: DateISO): Promise<void> {
  const l = await lireSemaine(c, lundi);
  // Mission en dérive choisie AVANT les feuilles : la capacité de ses tâches en dépend.
  const missionDerive = await missionEnDeriveDemo(c, l);
  const taches = tachesCapaciteDemo(l, missionDerive);
  const { tempsParMission, missionsTouchees } = await genererFeuillesSemaineDemo(
    c,
    lundi,
    l,
    taches,
  );
  const touchees = new Set(missionsTouchees);
  const mission = l.missions.find((m) => m.id === missionDerive);
  if (mission) {
    // `bilan.derive` est posé par maintenirDeriveDemo (derive.ts).
    touchees.add(mission.id);
    await dansPointDeSauvegarde(
      c,
      "ad_derive",
      "derive",
      { semaine: lundi, mission_id: mission.id },
      () => maintenirDeriveDemo(c, mission, lundi),
    );
  }
  await reevaluerAlertesDemo(c, touchees);
  // DT2 : jalon, facture et encaissement pour la seule semaine qui contient le jour d'exécution.
  const j = jourEvenementDemo(lundi, c.jour);
  if (j !== null) {
    await poserJalonDemo(c, lundi, j, tempsParMission, l.missions);
    await facturerSemaineDemo(c, lundi, j, l.missions);
    await encaisserSemaineDemo(c, lundi, j);
  }
  c.bilan.semaines.push(lundi);
}

/**
 * Une exécution de la tâche « activite_demo » (charge { mois, semaine? }, schéma strict). Rend le
 * bilan (décomptes seulement) ; une charge invalide est un échec définitif, sans nouvelle tentative.
 */
export async function executerActiviteDemo(
  ctx: ContexteJob,
  o: OptionsActiviteDemo,
): Promise<BilanActiviteDemo> {
  const { mois, semaine } = chargeValide(ctx.charge);
  const bilan = bilanVideActiviteDemo(mois);
  // Inactive (D3) : aucune requête d'écriture, pas même la lecture du cabinet.
  if (!o.actif()) return { ...bilan, statut: "inactif" };
  const cabinet = await lireCabinetDemo(ctx.db, ctx.cabinetId);
  if (!cabinet || !cabinet.estDemo || !cabinet.actif) {
    return { ...bilan, statut: "hors_perimetre" };
  }
  if (cabinet.granularite !== "demi_journee") {
    journaliserIncident("activite_demo_granularite", "Saisie à l'heure non prise en charge.", {
      cabinet_id: ctx.cabinetId,
    });
    return { ...bilan, statut: "granularite_non_prise_en_charge" };
  }
  await garderTransactionDemo(ctx.db, ctx.cabinetId);
  const c = await contexteActiviteDemo(
    ctx.db,
    ctx.cabinetId,
    ctx.jobId,
    ctx.maintenant,
    mois,
    bilan,
  );
  const semaines = semaine === undefined ? await preparerMoisDemo(c) : semaineDeSuite(c, semaine);
  for (const lundi of [...semaines].sort()) await genererSemaineDemo(c, lundi);
  await poserMarqueur(c, ACTIONS_ACTIVITE_DEMO.execution, "cabinet", ctx.cabinetId, {
    mois,
    semaine: semaine ?? null,
    semaines: semaines.length,
    feuilles: c.bilan.feuilles,
    factures: c.bilan.factures,
    encaissements: c.bilan.encaissements,
    jalons: c.bilan.jalons,
    prolongations: c.bilan.prolongations,
    echecs: c.bilan.echecs,
  });
  return { ...c.bilan, statut: "fait" };
}

/**
 * Handler de la tâche « activite_demo » ; activation par défaut : la configuration de
 * l'environnement (DEMO_ACTIVITE_AUTO), relue à chaque exécution. Ne rend jamais de notification :
 * AUCUN e-mail n'est émis par cette tâche.
 */
export function creerHandlerActiviteDemo(
  o: OptionsActiviteDemo = { actif: activiteDemoDepuisConfiguration },
): HandlerJob {
  return async (ctx) => {
    await executerActiviteDemo(ctx, o);
    return [];
  };
}
