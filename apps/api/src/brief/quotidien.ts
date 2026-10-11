import { jourSemaine, type BriefCompose } from "@missionpilot/engines";
import {
  aPermission,
  chargeBriefQuotidienSchema,
  ROLES_CLIENT,
  type Role,
} from "@missionpilot/shared";
import { journaliserIncident } from "../automatisation/diagnostic.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { ContexteJob, HandlerJob } from "../jobs/registre.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { calculerBrief } from "./calcul.js";

/*
 * Brief quotidien (AUT-07) : tâche « brief_quotidien », chaque jour ouvré à 7 h UTC, une par
 * cabinet et par jour (clé `brief_quotidien:AAAA-MM-JJ`, planificateur récurrent). Pour chaque
 * utilisateur actif du cabinet qui détient `brief.lire`, le brief est calculé dans SES droits
 * (calcul déterministe, aucun appel IA) ; s'il n'est pas vide, une notification interne
 * « Votre brief du jour : N éléments (X à décider, Y qui dérivent) » mène à /brief. Un brief vide
 * ne produit rien. Pas d'e-mail : le brief est un rendez-vous quotidien dans l'application, et la
 * plateforme n'a pas de réglage de préférence de notification à suivre (e-mail désactivé).
 * Idempotente : relancée le même jour, elle ne notifie pas deux fois la même personne.
 *
 * Volume : les utilisateurs sont lus par LOTS (UTILISATEURS_PAR_EXECUTION), par curseur
 * d'identifiant, en excluant d'emblée les comptes du portail client (ils n'ont pas de brief et ne
 * doivent pas occuper de place). Quand il en reste au-delà du lot, la tâche met en file une tâche
 * de SUITE du même type, de charge { date, apres_id } et de clé
 * `brief_quotidien:AAAA-MM-JJ:apres:<id>` (une seule par cabinet, jour et curseur) : personne
 * n'est laissé sans brief, quel que soit l'effectif.
 */

export const TYPE_JOB_BRIEF_QUOTIDIEN = "brief_quotidien";
/** Heure de la tâche quotidienne (UTC), avant la journée de travail UEMOA ; à valider. */
export const HEURE_BRIEF_QUOTIDIEN_UTC = "07:00:00";
/** Utilisateurs internes traités par exécution (garde de volume, une tâche de suite prend la suite) ; à valider. */
export const UTILISATEURS_PAR_EXECUTION = 500;

/**
 * Planification du jour de `maintenant` : clé unique par cabinet et par jour ; `ouvre` est faux
 * le samedi et le dimanche (pas de brief hors jour ouvré ; les fériés du cabinet ne sont pas
 * pris en compte).
 */
export function planificationBriefQuotidien(maintenant: Date): {
  cle: string;
  executeA: Date;
  jour: string;
  ouvre: boolean;
} {
  const jour = maintenant.toISOString().slice(0, 10);
  return {
    cle: `${TYPE_JOB_BRIEF_QUOTIDIEN}:${jour}`,
    executeA: new Date(`${jour}T${HEURE_BRIEF_QUOTIDIEN_UTC}Z`),
    jour,
    ouvre: jourSemaine(jour) <= 5,
  };
}

/**
 * Planifie la tâche du jour pour les cabinets qui ont un utilisateur interne actif (fonction
 * SECURITY DEFINER étroite, migration 0304) ; renvoie le nombre de tâches créées. Aucune
 * planification le week-end. Appelée par le planificateur récurrent (jobs/planificateur.ts).
 */
export async function planifierBriefQuotidien(db: Db, maintenant: Date): Promise<number> {
  const p = planificationBriefQuotidien(maintenant);
  if (!p.ouvre) return 0;
  const r = await db.query("SELECT planifier_brief_quotidien($1, $2, $3) AS n", [
    p.cle,
    p.executeA,
    p.jour,
  ]);
  return r.rows[0].n as number;
}

/** « Votre brief du jour : 3 éléments (2 à décider, 1 qui dérive) » : décomptes du moteur. */
export function titreNotificationBrief(brief: BriefCompose): string {
  const f = brief.familles;
  const element = brief.total > 1 ? "éléments" : "élément";
  const derive = f.deriver.total > 1 ? "qui dérivent" : "qui dérive";
  return `Votre brief du jour : ${brief.total} ${element} (${f.decider.total} à décider, ${f.deriver.total} ${derive})`;
}

interface UtilisateurBrief {
  id: string;
  email: string;
  nom: string;
  roles: Role[];
}

/**
 * Lot d'utilisateurs internes actifs après le curseur, par identifiant croissant. Les rôles du
 * portail sont exclus dans la requête (le plafond ne compte que des internes) ; la lecture d'un
 * élément de plus que le lot dit s'il en reste.
 */
async function lotUtilisateurs(
  db: Db,
  apresId: string | null,
  lot: number,
): Promise<{ utilisateurs: UtilisateurBrief[]; curseurSuite: string | null }> {
  const r = await db.query(
    `SELECT id, email, nom, roles FROM utilisateurs
     WHERE actif AND NOT (roles && $1::text[]) AND ($2::uuid IS NULL OR id > $2::uuid)
     ORDER BY id LIMIT $3`,
    [[...ROLES_CLIENT], apresId, lot + 1],
  );
  const lignes = r.rows as UtilisateurBrief[];
  const page = lignes.slice(0, lot);
  return {
    utilisateurs: page,
    curseurSuite: lignes.length > lot ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Sans contenu : code SQLSTATE, contrainte et table seulement, jamais le message ni le détail. */
function sansContenu(erreur: unknown): Record<string, string> {
  const e =
    typeof erreur === "object" && erreur !== null ? (erreur as Record<string, unknown>) : {};
  const champ = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : undefined);
  const resultat: Record<string, string> = {
    message: "Échec du calcul du brief d'un utilisateur.",
  };
  const code = champ(e.code);
  const contrainte = champ(e.constraint);
  const table = champ(e.table);
  if (code) resultat.code = code;
  if (contrainte) resultat.constraint = contrainte;
  if (table) resultat.table = table;
  return resultat;
}

/**
 * Brief d'un utilisateur, isolé par un point de sauvegarde : l'échec d'une extraction pour une
 * personne ne doit ni annuler les notifications des autres ni faire rejouer toute la tâche. Le
 * point est libéré dans les deux cas ; l'échec est rendu à l'appelant, qui le journalise.
 */
async function briefIsole(
  db: Db,
  auth: Auth,
  date: string,
): Promise<{ brief: BriefCompose } | { echec: unknown }> {
  await db.query("SAVEPOINT brief_utilisateur");
  try {
    const brief = await calculerBrief(db, auth, date);
    await db.query("RELEASE SAVEPOINT brief_utilisateur");
    return { brief };
  } catch (erreur) {
    // Pas de notification plutôt qu'un brief faux ; le même calcul, appelé par GET /api/brief,
    // remonterait l'erreur à l'utilisateur.
    await db.query("ROLLBACK TO SAVEPOINT brief_utilisateur");
    await db.query("RELEASE SAVEPOINT brief_utilisateur");
    return { echec: erreur };
  }
}

/** Bilan d'une exécution (lot) de la tâche. */
export interface BilanBriefQuotidien {
  notifications: NotificationCreee[];
  /** Utilisateurs internes actifs lus dans le lot. */
  utilisateurs: number;
  /** Utilisateurs dont le brief n'a pas pu être calculé (journalisés, sans contenu). */
  echecs: number;
  /** Curseur de la tâche de suite mise en file, s'il restait des utilisateurs. */
  suite: string | null;
}

/** Met en file la tâche de suite (clé unique par cabinet, jour et curseur : rejouable sans doublon). */
async function mettreEnFileSuite(ctx: ContexteJob, date: string, curseur: string): Promise<void> {
  await ctx.db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
    [
      ctx.cabinetId,
      TYPE_JOB_BRIEF_QUOTIDIEN,
      JSON.stringify({ date, apres_id: curseur }),
      ctx.maintenant,
      `${TYPE_JOB_BRIEF_QUOTIDIEN}:${date}:apres:${curseur}`,
    ],
  );
}

/** Un lot de la tâche « brief_quotidien » : charge { date?, apres_id? } (schéma strict). */
export async function executerBriefQuotidien(
  ctx: ContexteJob,
  lot: number = UTILISATEURS_PAR_EXECUTION,
): Promise<BilanBriefQuotidien> {
  const charge = chargeBriefQuotidienSchema.safeParse(ctx.charge);
  if (!charge.success) {
    throw new ErreurJobDefinitive("Charge de la tâche brief_quotidien invalide.");
  }
  const date = charge.data.date ?? ctx.maintenant.toISOString().slice(0, 10);
  const { utilisateurs, curseurSuite } = await lotUtilisateurs(
    ctx.db,
    charge.data.apres_id ?? null,
    lot,
  );
  const notifications: NotificationCreee[] = [];
  let echecs = 0;
  for (const u of utilisateurs) {
    if (!aPermission(u.roles, "brief.lire")) continue;
    // Une notification par personne et par jour : le corps porte la date du brief.
    const corps = `Brief du ${date}.`;
    const deja = await ctx.db.query(
      `SELECT 1 FROM notifications WHERE destinataire_id = $1 AND type = 'brief_quotidien'
         AND corps = $2 LIMIT 1`,
      [u.id, corps],
    );
    if (deja.rows[0]) continue;
    const auth: Auth = {
      utilisateurId: u.id,
      cabinetId: ctx.cabinetId,
      email: u.email,
      nom: u.nom,
      roles: u.roles,
    };
    const resultat = await briefIsole(ctx.db, auth, date);
    if ("echec" in resultat) {
      echecs += 1;
      journaliserIncident("brief_quotidien", sansContenu(resultat.echec), {
        utilisateur_id: u.id,
        date,
      });
      continue;
    }
    if (resultat.brief.vide) continue;
    const n = await notifier(ctx.db, {
      cabinetId: ctx.cabinetId,
      destinataireId: u.id,
      type: "brief_quotidien",
      titre: titreNotificationBrief(resultat.brief),
      corps,
      lien: "/brief",
      email: false,
    });
    if (n) notifications.push(n);
  }
  if (curseurSuite) await mettreEnFileSuite(ctx, date, curseurSuite);
  if (echecs > 0) {
    // Bilan d'un lot avec des échecs : décomptes seulement, aucun contenu.
    journaliserIncident("brief_quotidien_bilan", "Utilisateurs sans brief calculé.", {
      date,
      utilisateurs: utilisateurs.length,
      notifications: notifications.length,
      echecs,
    });
  }
  return { notifications, utilisateurs: utilisateurs.length, echecs, suite: curseurSuite };
}

/**
 * Handler de la tâche « brief_quotidien ». `lot` (utilisateurs lus par exécution) est injectable
 * pour les tests ; la production garde UTILISATEURS_PAR_EXECUTION.
 */
export function creerHandlerBriefQuotidien(options: { lot?: number } = {}): HandlerJob {
  return async (ctx) => (await executerBriefQuotidien(ctx, options.lot)).notifications;
}
