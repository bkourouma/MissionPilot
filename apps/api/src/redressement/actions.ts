import {
  transitionActionAdmise,
  type ActionPlan,
  type StatutActionRed,
} from "@missionpilot/engines";
import {
  aPermission,
  type RedActionCreation,
  type RedActionDeplacement,
  type RedActionDetailVue,
  type RedActionEvenementVue,
  type RedActionModification,
  type RedActionVue,
  type RedImpactLevierVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { exigerAssignable, creerTacheAssignee } from "../collaboration/taches.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable, requeteInvalide } from "../errors.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import {
  exigerDossierRedEcriture,
  exigerDossierRedVisible,
  lireDossier,
  type AccesDossierRed,
} from "./acces.js";
import { dateDuJour } from "./dates.js";
import { journalRed } from "./journal.js";
import { baseLevier, impactLevier } from "./leviers.js";
import { DEBIT_ACTIONS, verifierDebit } from "./limites.js";
import { isoOuVide, personne } from "./vues.js";

/*
 * Actions du plan de redressement (RED-05, RED-07) : cartes du kanban en deux volets (quick wins,
 * restructuration). Une action est vivante mais bornée : seuls statut, rang et contenu (tant
 * qu'elle n'est pas terminée ou abandonnée) bougent ; chaque changement ajoute un événement (ajout
 * seul) et une ligne au journal (champs et statuts seulement, jamais un titre ni un commentaire),
 * dans la même transaction. Le responsable est un utilisateur INTERNE actif qui voit la mission et
 * lit le redressement. Aucune synchronisation des statuts avec la tâche « Mes tâches » (limite
 * connue) ; la notification ne porte aucun montant.
 */

export interface ActionLue {
  id: string;
  dossier_id: string;
  numero: number;
  titre: string;
  description: string | null;
  volet: ActionPlan["volet"];
  domaine: ActionPlan["domaine"];
  echeance: string;
  statut: StatutActionRed;
  rang: number;
  motif: string | null;
  termine_le: string | null;
  responsable_id: string;
  responsable_nom: string;
  levier_code: string | null;
  levier_parametres: Record<string, number> | null;
  impact: RedImpactLevierVue | null;
  tache_collaboration_id: string | null;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  modifie_le: Date;
}

const COLONNES = `a.id, a.dossier_id, a.numero, a.titre, a.description, a.volet, a.domaine, a.echeance::text AS echeance,
  a.statut, a.rang, a.motif, a.termine_le::text AS termine_le, a.responsable_id, ur.nom AS responsable_nom,
  a.levier_code, a.levier_parametres, a.impact, a.tache_collaboration_id, a.cree_par, uc.nom AS cree_par_nom,
  a.cree_le, a.modifie_le`;
const JOINTURES = `FROM red_actions a JOIN utilisateurs ur ON ur.id = a.responsable_id
  JOIN utilisateurs uc ON uc.id = a.cree_par`;

/** Actions d'un dossier (1 000 au plus, abandonnées comprises : plafond de la base), par numéro ; `id` pour une seule. */
export async function lireActionsDossier(
  db: Db,
  dossierId: string,
  id: string | null = null,
  verrouiller = false,
): Promise<ActionLue[]> {
  const r = await db.query(
    `SELECT ${COLONNES} ${JOINTURES} WHERE a.dossier_id = $1 AND ($2::uuid IS NULL OR a.id = $2)
     ORDER BY a.numero LIMIT 1000 ${verrouiller ? "FOR UPDATE OF a" : ""}`,
    [dossierId, id],
  );
  return r.rows as ActionLue[];
}

/** Action au format du moteur du plan (impacts retenus à la création du levier). */
export function versPlan(a: ActionLue): ActionPlan {
  return {
    numero: a.numero,
    titre: a.titre,
    volet: a.volet,
    domaine: a.domaine,
    echeance: a.echeance,
    statut: a.statut,
    rang: a.rang,
    responsableId: a.responsable_id,
    levierCode: a.levier_code,
    impactTresorerieUnique: a.impact ? a.impact.tresorerie_unique : null,
    impactResultatAnnuel: a.impact ? a.impact.resultat_annuel : null,
  };
}

const STATUTS_EN_RETARD = new Set<string>(["a_faire", "en_cours", "bloquee"]);

export function vueAction(a: ActionLue, dateReference: string = dateDuJour()): RedActionVue {
  return {
    id: a.id,
    numero: a.numero,
    titre: a.titre,
    description: a.description,
    volet: a.volet,
    domaine: a.domaine,
    echeance: a.echeance,
    statut: a.statut,
    rang: a.rang,
    motif: a.motif,
    termine_le: a.termine_le,
    responsable: personne(a.responsable_id, a.responsable_nom),
    levier:
      a.levier_code && a.levier_parametres && a.impact
        ? {
            code: a.levier_code as NonNullable<RedActionVue["levier"]>["code"],
            parametres: a.levier_parametres,
            impact: a.impact,
          }
        : null,
    tache_collaboration_id: a.tache_collaboration_id,
    en_retard: STATUTS_EN_RETARD.has(a.statut) && a.echeance < dateReference,
    cree_par: personne(a.cree_par, a.cree_par_nom),
    cree_le: isoOuVide(a.cree_le),
    modifie_le: isoOuVide(a.modifie_le),
  };
}

/** Action visible (404 identique pour inconnue, d'autrui ou de mission invisible). */
export async function actionVisible(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ acces: AccesDossierRed; action: ActionLue }> {
  const r = await db.query("SELECT dossier_id FROM red_actions WHERE id = $1", [id]);
  if (!r.rows[0]) throw introuvable("Action");
  const acces = await exigerDossierRedVisible(db, auth, r.rows[0].dossier_id as string).catch(
    () => {
      throw introuvable("Action");
    },
  );
  const lues = await lireActionsDossier(db, acces.dossier.id, id);
  if (!lues[0]) throw introuvable("Action");
  return { acces, action: lues[0] };
}

/** Action ouverte à l'écriture : dossier verrouillé AVANT la relecture de son état (404 / 403 / 409). */
export async function actionEcriture(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ acces: AccesDossierRed; action: ActionLue }> {
  const r = await db.query("SELECT dossier_id FROM red_actions WHERE id = $1", [id]);
  if (!r.rows[0]) throw introuvable("Action");
  const dossierId = r.rows[0].dossier_id as string;
  if (!(await lireDossier(db, dossierId))) throw introuvable("Action");
  await exigerDossierRedVisible(db, auth, dossierId).catch(() => {
    throw introuvable("Action");
  });
  const acces = await exigerDossierRedEcriture(db, auth, dossierId);
  const lues = await lireActionsDossier(db, dossierId, id, true);
  if (!lues[0]) throw introuvable("Action");
  return { acces, action: lues[0] };
}

async function ajouterEvenement(
  db: Db,
  auth: Auth,
  a: { id: string; dossier_id: string },
  e: {
    type: "creation" | "statut" | "modification" | "commentaire";
    avant: string | null;
    apres: string;
    commentaire: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO red_action_evenements (cabinet_id, dossier_id, action_id, type, statut_avant, statut_apres,
       commentaire, auteur_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      a.dossier_id,
      a.id,
      e.type,
      e.avant,
      e.apres,
      e.commentaire,
      auth.utilisateurId,
    ],
  );
}

/** Responsable admis : utilisateur interne actif qui voit la mission ET lit le redressement (sinon 400). */
async function exigerResponsable(db: Db, auth: Auth, missionId: string, id: string): Promise<void> {
  const assigne = await exigerAssignable(db, auth, id, { type: "mission", id: missionId });
  if (!aPermission(assigne.roles, "redressement.lire")) {
    throw requeteInvalide(
      "Le responsable d'une action lit le redressement : choisissez un autre membre.",
    );
  }
}

export interface ActionEcrite {
  vue: RedActionVue;
  /** E-mails à envoyer APRÈS validation de la transaction. */
  notifications: (NotificationCreee | null)[];
}

/** Route 30 : création (dossier verrouillé par l'appelant), levier chiffré par le moteur, tâche ou notification. */
export async function creerAction(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  corps: RedActionCreation,
): Promise<ActionEcrite> {
  const { dossier, mission } = acces;
  await verifierDebit(db, auth, DEBIT_ACTIONS);
  if (corps.creer_tache && !aPermission(auth.roles, "tache.assigner")) throw interdit();
  await exigerResponsable(db, auth, mission.id, corps.responsable_id);
  const calcule = corps.levier
    ? impactLevier(corps.levier, await baseLevier(db, dossier)).impact
    : null;
  const r = await db.query(
    `INSERT INTO red_actions (cabinet_id, dossier_id, titre, description, volet, domaine, echeance,
       responsable_id, levier_code, levier_parametres, impact, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      corps.titre,
      corps.description ?? null,
      corps.volet,
      corps.domaine,
      corps.echeance,
      corps.responsable_id,
      corps.levier?.code ?? null,
      corps.levier ? JSON.stringify(corps.levier.parametres) : null,
      calcule ? JSON.stringify(calcule) : null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  const notifications: (NotificationCreee | null)[] = [];
  if (corps.creer_tache) {
    // Titre NEUTRE : le titre libre de l'action reste dans le module (un montant ou un nom y a sa place,
    // pas dans « Mes tâches » ni dans les e-mails de tâche).
    const numero = (await db.query("SELECT numero FROM red_actions WHERE id = $1", [id])).rows[0]
      .numero as number;
    const tache = await creerTacheAssignee(
      db,
      auth,
      {
        titre: `Action de redressement n° ${numero}`,
        description: `Plan de redressement de la mission : /missions/${mission.id}/redressement/plan`,
        assignee_id: corps.responsable_id,
        echeance: corps.echeance,
        entite_type: "mission",
        entite_id: mission.id,
      },
      "redressement",
    );
    notifications.push(...tache.notifications);
    await db.query("UPDATE red_actions SET tache_collaboration_id = $2 WHERE id = $1", [
      id,
      tache.id,
    ]);
  } else if (corps.responsable_id !== auth.utilisateurId) {
    notifications.push(
      await notifier(db, {
        cabinetId: auth.cabinetId,
        destinataireId: corps.responsable_id,
        type: "redressement_action_assignee",
        titre: `Action de redressement assignée par ${auth.nom}`,
        corps: `Échéance : ${corps.echeance}`,
        lien: `/missions/${mission.id}/redressement/plan`,
        email: true,
      }),
    );
  }
  await ajouterEvenement(
    db,
    auth,
    { id, dossier_id: dossier.id },
    {
      type: "creation",
      avant: null,
      apres: "a_faire",
      commentaire: null,
    },
  );
  const lue = (await lireActionsDossier(db, dossier.id, id))[0] as ActionLue;
  await journalRed(db, auth, "red_action", "creation", id, {
    dossier_id: dossier.id,
    numero: lue.numero,
    volet: corps.volet,
    levier_code: corps.levier?.code ?? null,
    tache: corps.creer_tache,
  });
  return { vue: vueAction(lue), notifications };
}

/** Route 31 : modification du contenu (action non terminée), levier recalculé s'il change. */
export async function modifierAction(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  action: ActionLue,
  corps: RedActionModification,
): Promise<RedActionVue> {
  if (action.statut === "terminee" || action.statut === "abandonnee") {
    throw new AppError(
      409,
      "RED_TRANSITION_INVALIDE",
      "Une action terminée ou abandonnée ne se modifie plus.",
    );
  }
  if (corps.responsable_id !== undefined) {
    await exigerResponsable(db, auth, acces.mission.id, corps.responsable_id);
  }
  const { levier, ...simples } = corps;
  const modif: Record<string, unknown> = { ...simples };
  if (levier === null) {
    modif.levier_code = null;
    modif.levier_parametres = null;
    modif.impact = null;
  } else if (levier !== undefined) {
    modif.levier_code = levier.code;
    modif.levier_parametres = JSON.stringify(levier.parametres);
    modif.impact = JSON.stringify(impactLevier(levier, await baseLevier(db, acces.dossier)).impact);
  }
  const set = clauseSet(modif, 3);
  await db.query(`UPDATE red_actions SET ${set.sql}, modifie_par = $2 WHERE id = $1`, [
    action.id,
    auth.utilisateurId,
    ...set.valeurs,
  ]);
  await ajouterEvenement(db, auth, action, {
    type: "modification",
    avant: action.statut,
    apres: action.statut,
    commentaire: null,
  });
  await journalRed(db, auth, "red_action", "modification", action.id, {
    dossier_id: action.dossier_id,
    champs: Object.keys(corps).filter((k) => (corps as Record<string, unknown>)[k] !== undefined),
  });
  return vueAction((await lireActionsDossier(db, action.dossier_id, action.id))[0] as ActionLue);
}

/** Route 32 : déplacement dans le kanban (statut et rang) ; transitions fermées par le moteur et la base. */
export async function deplacerAction(
  db: Db,
  auth: Auth,
  action: ActionLue,
  corps: RedActionDeplacement,
): Promise<RedActionVue> {
  const change = corps.statut !== action.statut;
  const terminale = action.statut === "terminee" || action.statut === "abandonnee";
  if (terminale || (change && !transitionActionAdmise(action.statut, corps.statut))) {
    throw new AppError(409, "RED_TRANSITION_INVALIDE", "Ce changement de statut n'est pas admis.");
  }
  if (change && (corps.statut === "bloquee" || corps.statut === "abandonnee") && !corps.motif) {
    throw requeteInvalide("Un motif est exigé pour bloquer ou abandonner une action.");
  }
  if (change && corps.statut === "terminee" && !corps.termine_le) {
    throw requeteInvalide("La date de fin est exigée pour terminer une action.");
  }
  await db.query(
    `UPDATE red_actions SET statut = $3, rang = $4, motif = $5, termine_le = $6, modifie_par = $2 WHERE id = $1`,
    [
      action.id,
      auth.utilisateurId,
      corps.statut,
      corps.rang ?? action.rang,
      corps.motif ?? action.motif,
      corps.statut === "terminee" ? (corps.termine_le ?? null) : null,
    ],
  );
  await ajouterEvenement(db, auth, action, {
    type: change ? "statut" : "modification",
    avant: action.statut,
    apres: corps.statut,
    commentaire: corps.motif ?? null,
  });
  await journalRed(db, auth, "red_action", change ? "statut" : "modification", action.id, {
    dossier_id: action.dossier_id,
    ...(change ? { de: action.statut, vers: corps.statut } : { champs: ["rang"] }),
  });
  return vueAction((await lireActionsDossier(db, action.dossier_id, action.id))[0] as ActionLue);
}

/** Route 33 : commentaire (événement en ajout seul), admis aussi sur une action terminée. */
export async function commenterAction(
  db: Db,
  auth: Auth,
  action: ActionLue,
  commentaire: string,
): Promise<RedActionVue> {
  await ajouterEvenement(db, auth, action, {
    type: "commentaire",
    avant: action.statut,
    apres: action.statut,
    commentaire,
  });
  await journalRed(db, auth, "red_action", "commentaire", action.id, {
    dossier_id: action.dossier_id,
  });
  return vueAction(action);
}

/** Route 34 : l'action et son fil d'événements (200 au plus, du plus récent). */
export async function detailAction(db: Db, action: ActionLue): Promise<RedActionDetailVue> {
  const r = await db.query(
    `SELECT e.id, e.type, e.statut_avant, e.statut_apres, e.commentaire, e.auteur_id, u.nom AS auteur_nom, e.cree_le
     FROM red_action_evenements e JOIN utilisateurs u ON u.id = e.auteur_id
     WHERE e.action_id = $1 ORDER BY e.cree_le DESC, e.id DESC LIMIT 200`,
    [action.id],
  );
  return {
    ...vueAction(action),
    evenements: (r.rows as Record<string, unknown>[]).map((e): RedActionEvenementVue => ({
      id: e.id as string,
      type: e.type as RedActionEvenementVue["type"],
      statut_avant: (e.statut_avant as RedActionEvenementVue["statut_avant"]) ?? null,
      statut_apres: e.statut_apres as RedActionEvenementVue["statut_apres"],
      commentaire: (e.commentaire as string | null) ?? null,
      auteur: personne(e.auteur_id as string, e.auteur_nom as string),
      cree_le: isoOuVide(e.cree_le as Date),
    })),
  };
}
