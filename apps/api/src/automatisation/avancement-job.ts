import { composerAvancementHebdo, jourSemaine, lundiDeLaSemaine } from "@missionpilot/engines";
import {
  chargeAvancementHebdoSchema,
  contenuAvancementSchema,
  type ContenuAvancement,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import { dependancesIaParDefaut } from "../ia/job.js";
import type { DependancesIa } from "../ia/orchestrateur.js";
import type { Auth } from "../auth/contexte.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { ContexteJob, HandlerJob } from "../jobs/registre.js";
import { notifier } from "../notifications/notifier.js";
import { journaliserIncident } from "./diagnostic.js";
import { suggererCommentaire } from "./avancement-ia.js";
import {
  COLONNES_MISSION_AVANCEMENT,
  lireFaitsMission,
  parametresKpiDuCabinet,
  suivisPourAvancement,
  type MissionAvancement,
} from "./avancement-lecture.js";
import {
  fonctionActive,
  lienAvancement,
  LOTS_MAX_AVANCEMENT,
  MISSIONS_PAR_LOT_AVANCEMENT,
} from "./avancement-service.js";

/*
 * Rapport d'avancement hebdomadaire au client (AUT-10, PRD complémentaire §8) : tâche
 * « avancement_hebdo », une par cabinet et par SEMAINE (clé `avancement_hebdo:<lundi>`), planifiée
 * chaque jour ouvré par le planificateur récurrent : elle s'exécute le premier jour ouvré où le
 * cabinet est éligible (jamais le week-end), sinon elle existe déjà et le second appel ne la double pas.
 *
 * Pour chaque mission SIGNÉE ou EN COURS du cabinet (RLS : le contexte du job est celui du cabinet),
 * elle prépare un BROUILLON de rapport d'avancement à partir des données réelles ; TOUS les chiffres
 * sortent du moteur pur `composerAvancementHebdo`. Rien n'est visible du client avant la validation du
 * chef de mission, et AUCUN e-mail n'est envoyé : seule une notification INTERNE (sans e-mail) prévient
 * le chef de mission (à défaut le directeur) qu'un brouillon est prêt.
 *
 * - Idempotente : `INSERT … ON CONFLICT (mission_id, semaine) DO NOTHING` ; une mission qui a déjà un
 *   rapport pour la semaine (brouillon, modifié par le chef ou validé) est écartée AVANT tout calcul ;
 *   rejouée ou doublée, la tâche ne duplique rien, n'écrase rien et ne notifie qu'à la création.
 * - Lots plafonnés : MISSIONS_PAR_LOT_AVANCEMENT missions par exécution, par curseur d'identifiant ;
 *   s'il en reste, une tâche de SUITE du même type (charge { semaine, apres_id, lot }, clé
 *   `avancement_hebdo:<lundi>:lot:<n>`) est mise en file, au plus LOTS_MAX_AVANCEMENT lots par semaine
 *   (au-delà, un incident est consigné : la génération manuelle reste possible).
 * - Une mission dont le calcul échoue est isolée par un point de sauvegarde : les autres brouillons
 *   du lot sont créés, l'échec est consigné (sans contenu) et la mission n'est pas retentée avant la
 *   semaine suivante (génération manuelle possible).
 * - Commentaire IA (brouillon) : pour les brouillons CRÉÉS par ce lot (au plus SUGGESTIONS_IA_PAR_LOT), la
 *   tâche demande une suggestion à l'orchestrateur IA (avancement-ia.ts), après la création de tous les
 *   brouillons. Utilisateur d'imputation : le chef de la mission, à défaut son directeur (jamais un humain
 *   connecté) ; son droit « ia.utiliser » est vérifié par l'orchestrateur. Stockée dans `commentaire_ia`
 *   (statut « brouillon_ia ») seulement si aucun commentaire n'existe ; sinon, ou sans IA (désactivée, droit,
 *   clé, plafond, erreur, sortie rejetée), le commentaire reste VIDE : jamais d'échec de la tâche.
 * - Cabinet qui a désactivé la fonction (`avancement_parametres.actif`) : rien n'est produit.
 */

export const TYPE_JOB_AVANCEMENT_HEBDO = "avancement_hebdo";
/** Suggestions IA demandées au plus par exécution (latence et coût bornés ; les autres : bouton manuel). */
export const SUGGESTIONS_IA_PAR_LOT = 10;
/** Heure de la tâche (UTC), avant la journée de travail UEMOA ; à valider. */
export const HEURE_AVANCEMENT_HEBDO_UTC = "06:30:00";

/** Planification du jour de `maintenant` : clé unique par cabinet et par semaine ; `ouvre` faux le week-end. */
export function planificationAvancementHebdo(maintenant: Date): {
  cle: string;
  executeA: Date;
  semaine: string;
  ouvre: boolean;
} {
  const jour = maintenant.toISOString().slice(0, 10);
  const semaine = lundiDeLaSemaine(jour);
  return {
    cle: `${TYPE_JOB_AVANCEMENT_HEBDO}:${semaine}`,
    executeA: new Date(`${jour}T${HEURE_AVANCEMENT_HEBDO_UTC}Z`),
    semaine,
    ouvre: jourSemaine(jour) <= 5,
  };
}

/**
 * Planifie la tâche de la semaine pour les cabinets éligibles (fonction SECURITY DEFINER étroite,
 * migration 0308) ; renvoie le nombre de tâches créées. Aucune planification le week-end.
 */
export async function planifierAvancementHebdo(db: Db, maintenant: Date): Promise<number> {
  const p = planificationAvancementHebdo(maintenant);
  if (!p.ouvre) return 0;
  const r = await db.query("SELECT planifier_avancement_hebdo($1, $2, $3) AS n", [
    p.cle,
    p.executeA,
    p.semaine,
  ]);
  return r.rows[0].n as number;
}

/** Bilan d'une exécution (lot) de la tâche. */
export interface BilanAvancementHebdo {
  /** La fonction est désactivée pour le cabinet : rien n'a été lu ni produit. */
  desactive: boolean;
  /** Missions examinées dans ce lot (sans rapport pour la semaine). */
  missions: number;
  /** Brouillons créés par cette exécution. */
  crees: number;
  /** Missions dont le calcul a échoué (consignées, sans contenu). */
  echecs: number;
  /** Curseur de la tâche de suite mise en file, s'il restait des missions. */
  suite: string | null;
  /** Suggestions de commentaire IA enregistrées (brouillon IA) par cette exécution. */
  suggestions: number;
}

const sansContenu = (e: unknown): Record<string, string> => {
  const o = typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {};
  const champ = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : undefined);
  const r: Record<string, string> = { message: "Échec du rapport d'avancement d'une mission." };
  for (const [cle, v] of [
    ["code", o.code],
    ["constraint", o.constraint],
    ["table", o.table],
  ] as const) {
    const c = champ(v);
    if (c) r[cle] = c;
  }
  return r;
};

/** Un lot de la tâche « avancement_hebdo » : charge { semaine, apres_id?, lot? } (schéma strict). */
export interface OptionsAvancementHebdo {
  lot?: number;
  lotsMax?: number;
  /** Dépendances IA (tests : fournisseur simulé) ; défaut : configuration de l'environnement. */
  ia?: DependancesIa;
  suggestionsMax?: number;
}

export async function executerAvancementHebdo(
  ctx: ContexteJob,
  options: OptionsAvancementHebdo = {},
  notificationsIa: (NotificationCreee | null)[] = [],
): Promise<BilanAvancementHebdo> {
  const taille = options.lot ?? MISSIONS_PAR_LOT_AVANCEMENT;
  const lotsMax = options.lotsMax ?? LOTS_MAX_AVANCEMENT;
  const charge = chargeAvancementHebdoSchema.safeParse(ctx.charge);
  if (!charge.success || jourSemaine(charge.data.semaine) !== 1) {
    throw new ErreurJobDefinitive("Charge de la tâche avancement_hebdo invalide.");
  }
  const { semaine, apres_id: apresId } = charge.data;
  const numeroLot = charge.data.lot ?? 1;
  const bilan: BilanAvancementHebdo = {
    desactive: false,
    missions: 0,
    crees: 0,
    echecs: 0,
    suite: null,
    suggestions: 0,
  };
  const crees: { id: string; mission: MissionAvancement; contenu: ContenuAvancement }[] = [];
  if (!(await fonctionActive(ctx.db))) return { ...bilan, desactive: true };

  // Missions actives sans rapport pour la semaine, après le curseur : une de plus que le lot dit s'il en reste.
  const lue = await ctx.db.query(
    `SELECT ${COLONNES_MISSION_AVANCEMENT} FROM missions m
     WHERE m.statut IN ('signee', 'en_cours')
       AND ($1::uuid IS NULL OR m.id > $1::uuid)
       AND NOT EXISTS (SELECT 1 FROM avancement_rapports r
                       WHERE r.mission_id = m.id AND r.semaine = $2::date)
     ORDER BY m.id LIMIT $3`,
    [apresId ?? null, semaine, taille + 1],
  );
  const lignes = lue.rows as MissionAvancement[];
  const lot = lignes.slice(0, taille);
  bilan.missions = lot.length;
  if (lot.length === 0) return bilan;

  const dateReference = ctx.maintenant.toISOString().slice(0, 10);
  const suivis = await suivisPourAvancement(
    ctx.db,
    ctx.cabinetId,
    lot.map((m) => m.id),
  );
  const paramsKpi = await parametresKpiDuCabinet(ctx.db);

  for (const mission of lot) {
    await ctx.db.query("SAVEPOINT avancement_mission");
    try {
      const faits = await lireFaitsMission(ctx.db, mission, suivis.get(mission.id), {
        semaine,
        dateReference,
        paramsKpi,
      });
      const contenu = composerAvancementHebdo(faits);
      const ins = await ctx.db.query(
        `INSERT INTO avancement_rapports
           (cabinet_id, mission_id, client_id, semaine, contenu, job_id, genere_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (mission_id, semaine) DO NOTHING RETURNING id`,
        [
          ctx.cabinetId,
          mission.id,
          mission.client_id,
          semaine,
          JSON.stringify(contenu),
          ctx.jobId,
          ctx.maintenant,
        ],
      );
      const id = ins.rows[0]?.id as string | undefined;
      if (id) {
        bilan.crees += 1;
        crees.push({ id, mission, contenu: contenuAvancementSchema.parse(contenu) });
        await journaliser(ctx.db, {
          cabinetId: ctx.cabinetId,
          utilisateurId: null,
          action: "avancement.brouillon_genere",
          entite: "avancement_rapport",
          entiteId: id,
          details: { mission_id: mission.id, semaine, origine: "tache" },
        });
        // Notification INTERNE au chef de mission (à défaut le directeur) : jamais d'e-mail, jamais le client.
        const destinataire = mission.chef_id ?? mission.directeur_id;
        if (destinataire) {
          await notifier(ctx.db, {
            cabinetId: ctx.cabinetId,
            destinataireId: destinataire,
            type: "avancement_brouillon",
            titre: `Rapport d'avancement à relire : ${mission.intitule}`,
            corps: `Le brouillon de la semaine du ${semaine} est prêt. Relisez-le, complétez-le et validez-le : le client ne voit rien avant votre validation.`,
            lien: lienAvancement(mission.id),
            email: false,
          });
        }
      }
      await ctx.db.query("RELEASE SAVEPOINT avancement_mission");
    } catch (erreur) {
      await ctx.db.query("ROLLBACK TO SAVEPOINT avancement_mission");
      await ctx.db.query("RELEASE SAVEPOINT avancement_mission");
      bilan.echecs += 1;
      journaliserIncident("avancement_hebdo", sansContenu(erreur), {
        mission_id: mission.id,
        semaine,
      });
    }
  }

  if (lignes.length > taille) {
    const curseur = lot[lot.length - 1]?.id ?? null;
    if (curseur && numeroLot < lotsMax) {
      await ctx.db.query(
        `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
        [
          ctx.cabinetId,
          TYPE_JOB_AVANCEMENT_HEBDO,
          JSON.stringify({ semaine, apres_id: curseur, lot: numeroLot + 1 }),
          ctx.maintenant,
          `${TYPE_JOB_AVANCEMENT_HEBDO}:${semaine}:lot:${numeroLot + 1}`,
        ],
      );
      bilan.suite = curseur;
    } else if (curseur) {
      journaliserIncident("avancement_hebdo_plafond", "Nombre maximal de lots atteint.", {
        semaine,
        lots: numeroLot,
      });
    }
  }
  bilan.suggestions = await suggererPourLesBrouillons(ctx, options, crees, notificationsIa);
  return bilan;
}

/**
 * Handler de la tâche « avancement_hebdo ». `lot` et `lotsMax` sont injectables pour les tests ; la
 * production garde MISSIONS_PAR_LOT_AVANCEMENT et LOTS_MAX_AVANCEMENT. Ne renvoie aucune notification
 * à envoyer par e-mail : AUCUN e-mail n'est émis par cette tâche.
 */
export function creerHandlerAvancementHebdo(options: OptionsAvancementHebdo = {}): HandlerJob {
  return async (ctx) => {
    const notifications: (NotificationCreee | null)[] = [];
    await executerAvancementHebdo(ctx, options, notifications);
    // Seules les alertes internes de plafond IA éventuelles : jamais d'e-mail au client.
    return notifications;
  };
}

/** Utilisateur d'imputation de la tâche : le chef de la mission, à défaut le directeur (actif). */
async function utilisateurImputation(ctx: ContexteJob, m: MissionAvancement): Promise<Auth | null> {
  const id = m.chef_id ?? m.directeur_id;
  if (!id) return null;
  const r = await ctx.db.query(
    "SELECT id, email, nom, roles FROM utilisateurs WHERE id = $1 AND actif",
    [id],
  );
  const u = r.rows[0];
  if (!u) return null;
  return {
    utilisateurId: u.id as string,
    cabinetId: ctx.cabinetId,
    email: u.email as string,
    nom: u.nom as string,
    roles: u.roles as Auth["roles"],
  };
}

/**
 * Commentaire IA des brouillons créés (voir l'en-tête). Ne lève jamais : toute erreur laisse le
 * commentaire vide. L'écriture est gardée en base (`statut_commentaire = 'vide'`) : un commentaire du
 * chef n'est jamais écrasé.
 */
async function suggererPourLesBrouillons(
  ctx: ContexteJob,
  options: OptionsAvancementHebdo,
  crees: { id: string; mission: MissionAvancement; contenu: ContenuAvancement }[],
  notificationsIa: (NotificationCreee | null)[],
): Promise<number> {
  if (!ctx.database || crees.length === 0) return 0;
  let ia: DependancesIa;
  try {
    ia = options.ia ?? dependancesIaParDefaut();
  } catch {
    return 0;
  }
  let enregistrees = 0;
  for (const c of crees.slice(0, options.suggestionsMax ?? SUGGESTIONS_IA_PAR_LOT)) {
    try {
      const auth = await utilisateurImputation(ctx, c.mission);
      if (!auth) continue;
      const r = await suggererCommentaire(
        { database: ctx.database, ia },
        auth,
        c.contenu,
        ctx.maintenant,
      );
      notificationsIa.push(...r.notifications);
      if (r.type !== "ok") continue;
      await ctx.db.query("SAVEPOINT avancement_ia");
      try {
        const maj = await ctx.db.query(
          `UPDATE avancement_rapports SET commentaire_ia = $2, statut_commentaire = 'brouillon_ia'
           WHERE id = $1 AND statut = 'brouillon' AND statut_commentaire = 'vide' RETURNING id`,
          [c.id, r.commentaire],
        );
        if (maj.rows[0]) {
          enregistrees += 1;
          await journaliser(ctx.db, {
            cabinetId: ctx.cabinetId,
            utilisateurId: null,
            action: "avancement.commentaire_ia_suggere",
            entite: "avancement_rapport",
            entiteId: c.id,
            details: { mission_id: c.mission.id, origine: "tache" },
          });
        }
        await ctx.db.query("RELEASE SAVEPOINT avancement_ia");
      } catch (erreur) {
        await ctx.db.query("ROLLBACK TO SAVEPOINT avancement_ia");
        await ctx.db.query("RELEASE SAVEPOINT avancement_ia");
        journaliserIncident("avancement_commentaire_ia", sansContenu(erreur), {
          mission_id: c.mission.id,
        });
      }
    } catch (erreur) {
      journaliserIncident("avancement_commentaire_ia", sansContenu(erreur), {
        mission_id: c.mission.id,
      });
    }
  }
  return enregistrees;
}
