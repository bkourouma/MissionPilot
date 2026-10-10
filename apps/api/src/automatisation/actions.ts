import { ajouterJours, rendreGabarit, type PayloadEvenement } from "@missionpilot/engines";
import { NATURE_BROUILLON_LIBELLES, type ActionAutomatisationApi } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { authDe } from "../collaboration/entites.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { creerBrouillon } from "../facturation/factures.js";
import { exigerMissionVisible, STATUTS_SIGNES } from "../missions/acces.js";
import { notifier, texteBrut, type NotificationCreee } from "../notifications/notifier.js";
import { exigerEnvoiVisible, exigerMissionOuverte } from "../questionnaires/acces.js";
import { relancerManuellement } from "../questionnaires/relances.js";
import { annulationImpossible } from "./erreurs.js";
import { destinataires, voitMission, type ContexteMission } from "./executant.js";

/*
 * REGISTRE DES ACTIONS TYPÉES (AUT-02, AUT-05, AUT-06). Chaque exécuteur agit dans la
 * transaction du traitement, dans les droits de l'EXÉCUTANT (compte d'automatisation ou
 * déclencheur), avec les MÊMES services que l'humain (tâches, notifications, facturation,
 * relances) : mêmes contrôles, même journal d'audit, mêmes circuits d'approbation. La garde
 * (permission, visibilité, classe, coupe-circuits) a déjà autorisé l'action ; un service qui
 * refuse (409 métier) donne une action « sans objet » ou « en échec », jamais un contournement.
 * Les textes viennent des gabarits de la définition et du contenu de l'événement (aucun calcul,
 * aucun chiffre produit). L'appel d'un agent passe par sa propre file (`execution.ts`).
 */

export type EntiteResultat =
  | "tache_collaboration"
  | "notification"
  | "automatisation_brouillon"
  | "facture"
  | "agent_execution"
  | "questionnaire_envoi";

export interface ContexteAction {
  db: Db;
  cabinetId: string;
  executant: Auth;
  evenement: { id: string; payload: PayloadEvenement; acteur_id: string | null };
  mission: ContexteMission | null;
  responsableId: string;
  actionId: string;
  automatisationNom: string;
  maintenant: Date;
}

export interface ResultatAction {
  statut: "reussie" | "echec" | "ignoree";
  code?: string;
  message?: string;
  entite?: { type: EntiteResultat; id: string } | null;
  details?: Record<string, unknown>;
  notifications?: NotificationCreee[];
}

const sansObjet = (code: string, message: string): ResultatAction => ({
  statut: "ignoree",
  code,
  message,
});

const lienMission = (m: ContexteMission | null) =>
  m ? `/missions/${m.id}` : "/automatisations/journal";

async function tracer(ctx: ContexteAction, action: string, entite: string, id: string | null) {
  await journaliser(ctx.db, {
    cabinetId: ctx.cabinetId,
    utilisateurId: ctx.executant.utilisateurId,
    action,
    entite,
    entiteId: id,
    details: { automatisation_action_id: ctx.actionId, evenement_id: ctx.evenement.id },
  });
}

/** Personnes visées encore actives et qui voient la mission de l'événement. */
async function destinatairesAutorises(
  ctx: ContexteAction,
  liste: Parameters<typeof destinataires>[0],
): Promise<string[]> {
  const ids = destinataires(liste, {
    mission: ctx.mission,
    responsableId: ctx.responsableId,
    acteurId: ctx.evenement.acteur_id,
  });
  const retenus: string[] = [];
  for (const id of ids) {
    const auth = await authDe(ctx.db, ctx.cabinetId, id);
    if (!auth || auth.roles.some((r) => r.startsWith("client_"))) continue;
    if (ctx.mission && !(await voitMission(ctx.db, auth, ctx.mission.id))) continue;
    retenus.push(id);
  }
  return retenus;
}

type Action<T extends ActionAutomatisationApi["type"]> = Extract<
  ActionAutomatisationApi,
  { type: T }
>;

async function creerTache(ctx: ContexteAction, a: Action<"creer_tache">): Promise<ResultatAction> {
  const [assigne] = await destinatairesAutorises(ctx, [a.assigne]);
  if (!assigne) return sansObjet("DESTINATAIRE_ABSENT", "Aucune personne à qui assigner la tâche.");
  const titre = texteBrut(rendreGabarit(a.titre, ctx.evenement.payload), 200) || "Tâche";
  const description = texteBrut(rendreGabarit(a.description, ctx.evenement.payload), 5000);
  const echeance =
    a.echeance_jours === null
      ? null
      : ajouterJours(ctx.maintenant.toISOString().slice(0, 10), a.echeance_jours);
  const m = ctx.mission;
  const r = await ctx.db.query(
    `INSERT INTO taches_collaboration (cabinet_id, titre, description, assignee_id, cree_par,
       echeance, entite_type, entite_id, mission_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      ctx.cabinetId,
      titre,
      description,
      assigne,
      ctx.executant.utilisateurId,
      echeance,
      m ? "mission" : null,
      m?.id ?? null,
      m?.id ?? null,
    ],
  );
  const id = r.rows[0].id as string;
  await tracer(ctx, "creation", "tache_collaboration", id);
  const notifications: NotificationCreee[] = [];
  if (assigne !== ctx.executant.utilisateurId) {
    const n = await notifier(ctx.db, {
      cabinetId: ctx.cabinetId,
      destinataireId: assigne,
      type: "tache_assignee",
      titre: `Tâche assignée par l'automatisation « ${ctx.automatisationNom} » : ${titre}`,
      corps: echeance ? `Échéance : ${echeance}` : "",
      lien: "/mes-taches",
      email: true,
    });
    if (n) notifications.push(n);
  }
  return { statut: "reussie", entite: { type: "tache_collaboration", id }, notifications };
}

async function notifierPersonnes(
  ctx: ContexteAction,
  a: Action<"notifier">,
): Promise<ResultatAction> {
  const ids = await destinatairesAutorises(ctx, a.destinataires);
  if (ids.length === 0) return sansObjet("AUCUN_DESTINATAIRE", "Aucun destinataire joignable.");
  const notifications: NotificationCreee[] = [];
  for (const id of ids) {
    const n = await notifier(ctx.db, {
      cabinetId: ctx.cabinetId,
      destinataireId: id,
      type: "automatisation",
      titre: rendreGabarit(a.titre, ctx.evenement.payload),
      corps: rendreGabarit(a.corps, ctx.evenement.payload),
      lien: lienMission(ctx.mission),
      email: true,
    });
    if (n) notifications.push(n);
  }
  return { statut: "reussie", details: { destinataires: notifications.length }, notifications };
}

async function brouillon(ctx: ContexteAction, a: Action<"brouillon">): Promise<ResultatAction> {
  if (!ctx.mission) return sansObjet("MISSION_ABSENTE", "Un brouillon se rattache à une mission.");
  const titre =
    texteBrut(rendreGabarit(a.titre, ctx.evenement.payload), 200) ||
    NATURE_BROUILLON_LIBELLES[a.nature];
  const corps = rendreGabarit(a.corps, ctx.evenement.payload).trim().slice(0, 5000) || titre;
  const r = await ctx.db.query(
    `INSERT INTO automatisation_brouillons (cabinet_id, action_id, mission_id, nature, titre, corps)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [ctx.cabinetId, ctx.actionId, ctx.mission.id, a.nature, titre, corps],
  );
  const id = r.rows[0].id as string;
  await tracer(ctx, "creation", "automatisation_brouillon", id);
  return { statut: "reussie", entite: { type: "automatisation_brouillon", id } };
}

async function factureBrouillon(ctx: ContexteAction): Promise<ResultatAction> {
  const missionId = ctx.evenement.payload.mission_id;
  const jalonId = ctx.evenement.payload.jalon_id;
  if (typeof missionId !== "string" || typeof jalonId !== "string") {
    return sansObjet("JALON_ABSENT", "L'événement ne désigne pas de jalon.");
  }
  const mission = await exigerMissionVisible(ctx.db, ctx.executant, missionId, true);
  if (!STATUTS_SIGNES.includes(mission.statut)) {
    return sansObjet("MISSION_NON_SIGNEE", "Une mission se facture après sa signature.");
  }
  const e = await ctx.db.query(
    `SELECT e.id, e.statut FROM echeances_facturation e
     WHERE e.mission_id = $1 AND e.jalon_id = $2 AND e.statut IN ('prevue', 'a_facturer')
       AND NOT EXISTS (SELECT 1 FROM facturation_liens l WHERE l.echeance_id = e.id
                       AND l.libere_le IS NULL)
     ORDER BY e.date_prevue, e.ordre, e.id FOR UPDATE OF e`,
    [missionId, jalonId],
  );
  if (e.rows.length === 0) {
    return sansObjet("AUCUNE_ECHEANCE", "Aucune échéance à facturer n'est rattachée à ce jalon.");
  }
  const passees = e.rows.filter((l) => l.statut === "prevue").map((l) => l.id as string);
  if (passees.length > 0) {
    await ctx.db.query(
      `UPDATE echeances_facturation SET statut = 'a_facturer', modifie_le = now()
       WHERE id = ANY ($1::uuid[])`,
      [passees],
    );
    for (const id of passees) await tracer(ctx, "modification", "echeance_facturation", id);
  }
  const libelle = ctx.evenement.payload.libelle;
  const factureId = await creerBrouillon(ctx.db, ctx.executant, mission, {
    echeance_ids: e.rows.map((l) => l.id as string),
    debours_ids: [],
    objet: typeof libelle === "string" ? `Jalon « ${libelle} »`.slice(0, 200) : null,
  });
  await tracer(ctx, "creation", "facture", factureId);
  return {
    statut: "reussie",
    entite: { type: "facture", id: factureId },
    details: { echeances_passees_a_facturer: passees },
  };
}

async function relanceQuestionnaire(ctx: ContexteAction): Promise<ResultatAction> {
  const envoiId = ctx.evenement.payload.envoi_id;
  if (typeof envoiId !== "string") return sansObjet("ENVOI_ABSENT", "Aucun questionnaire désigné.");
  const envoi = await exigerEnvoiVisible(ctx.db, ctx.executant, envoiId, true);
  await exigerMissionOuverte(ctx.db, ctx.executant, envoi.mission_id);
  try {
    const r = await relancerManuellement(ctx.db, ctx.executant, envoi, undefined);
    return {
      statut: "reussie",
      entite: { type: "questionnaire_envoi", id: envoi.id },
      details: { relances: r.relances },
      notifications: r.notifications,
    };
  } catch (error) {
    // Rien à relancer (clos, tous ont répondu, relancés il y a moins de 24 h) : sans objet.
    if (error instanceof AppError && error.statut === 409) {
      return sansObjet("RIEN_A_RELANCER", error.message);
    }
    throw error;
  }
}

/** Exécute une action autorisée (hors appel d'agent, mis en file par l'appelant). */
export async function executerAction(
  ctx: ContexteAction,
  action: ActionAutomatisationApi,
): Promise<ResultatAction> {
  switch (action.type) {
    case "creer_tache":
      return creerTache(ctx, action);
    case "notifier":
      return notifierPersonnes(ctx, action);
    case "brouillon":
      return brouillon(ctx, action);
    case "facture_brouillon":
      return factureBrouillon(ctx);
    case "relance_questionnaire":
      return relanceQuestionnaire(ctx);
    default:
      // Invariant : l'appel d'un agent part dans sa propre file (execution.ts), jamais ici.
      throw new AppError(
        500,
        "ACTION_HORS_FILE",
        "Cette action s'exécute dans sa propre file, pas dans l'exécuteur d'actions.",
      );
  }
}

/* ----- Annulation (AUT-06) ----- */

export interface ActionAAnnuler {
  id: string;
  type: ActionAutomatisationApi["type"];
  entite_id: string | null;
  details: Record<string, unknown>;
}

/** Défait l'effet d'une action annulable réussie (dans la transaction de l'annulation). */
export async function defaireAction(
  db: Db,
  auth: Auth,
  a: ActionAAnnuler,
  motif: string,
): Promise<void> {
  if (a.type === "brouillon" && a.entite_id) {
    // Même verrou que la décision humaine sur ce brouillon (journal.ts).
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `automatisation_brouillon:${a.entite_id}`,
    ]);
    const d = await db.query(
      "SELECT 1 FROM automatisation_brouillon_decisions WHERE brouillon_id = $1",
      [a.entite_id],
    );
    if (d.rows[0]) throw annulationImpossible("Le brouillon a déjà été traité par un humain.");
    await db.query(
      `INSERT INTO automatisation_brouillon_decisions (cabinet_id, brouillon_id, decision, motif,
         auteur_id) VALUES ($1, $2, 'annulee', $3, $4)`,
      [auth.cabinetId, a.entite_id, motif, auth.utilisateurId],
    );
    return;
  }
  if (a.type === "facture_brouillon" && a.entite_id) {
    const f = await db.query("SELECT statut FROM factures WHERE id = $1 FOR UPDATE", [a.entite_id]);
    if (f.rows[0] && f.rows[0].statut !== "brouillon") {
      throw annulationImpossible(
        "La facture a avancé dans son circuit : corrigez-la depuis la facturation.",
      );
    }
    if (f.rows[0]) {
      await db.query("DELETE FROM factures WHERE id = $1", [a.entite_id]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "suppression",
        entite: "facture",
        entiteId: a.entite_id,
        details: { automatisation_action_id: a.id },
      });
    }
    const passees = Array.isArray(a.details.echeances_passees_a_facturer)
      ? (a.details.echeances_passees_a_facturer as string[])
      : [];
    if (passees.length > 0) {
      await db.query(
        `UPDATE echeances_facturation e SET statut = 'prevue', modifie_le = now()
         WHERE e.id = ANY ($1::uuid[]) AND e.statut = 'a_facturer'
           AND NOT EXISTS (SELECT 1 FROM facturation_liens l WHERE l.echeance_id = e.id
                           AND l.libere_le IS NULL)`,
        [passees],
      );
    }
    return;
  }
  throw annulationImpossible("Cette action ne s'annule pas.");
}
