import { createHash } from "node:crypto";
import {
  aPermission,
  EXPIRATION_ACTION_COPILOTE_MINUTES,
  ROLES_CLIENT,
  tacheCollaborationCreationSchema,
  type ActionProposeeCopilote,
  type ResultatActionCopilote,
} from "@missionpilot/shared";
import {
  LIBELLE_ACTION_CREER_TACHE,
  MESSAGE_MISSION_INTROUVABLE,
  plierTexteCopilote,
  resumerCreerTache,
  type ElementCopilote,
  type OutilActionCopilote,
  type ParametresCopilote,
} from "@missionpilot/engines";
import { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { authDe, voitEntite } from "../collaboration/entites.js";
import { creerTacheAssignee, LIEN_MES_TACHES } from "../collaboration/taches.js";
import type { Database, Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { motifContient } from "../http/outils.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import {
  actionAlteree,
  actionDejaTraitee,
  actionExpiree,
  actionIntrouvable,
  traduireErreurCopilote,
} from "./erreurs.js";
import { resoudreMission, type ContexteOutil } from "./lecture.js";
import { exigerCopiloteActif } from "./limites.js";

/*
 * ACTIONS MODIFIANTES DU COPILOTE (AGT-08) : le copilote ne les exécute JAMAIS directement.
 *
 * 0. NIVEAU : proposer et confirmer exigent un niveau d'autonomie effectif de l'agent « copilote »
 *    d'au moins N2 (`exigerCopiloteActif(db, "action")`, 409 sinon) ; la lecture reste permise dès N1.
 * 1. PROPOSITION (`proposerAction`) : le texte et les paramètres sont VALIDÉS et RÉSOLUS par le
 *    code (noms → identifiants, droits et visibilité vérifiés), le résumé en français est construit
 *    par le moteur (jamais par le modèle) et la proposition est inscrite dans `copilote_actions`
 *    (migration 0271) : outil, paramètres, empreinte SHA-256, expiration à 5 minutes.
 * 2. CONFIRMATION (`confirmerAction`) : le MÊME utilisateur seulement (une proposition d'autrui
 *    répond 404), non expirée, à usage UNIQUE (ligne verrouillée, statut `proposee` exigé), avec
 *    les droits RÉVÉRIFIÉS à cet instant (la permission a pu être retirée depuis : proposition
 *    « refusee »), l'empreinte relue, puis exécution par le service existant, sous les droits de
 *    l'utilisateur, et journal.
 * 3. ANNULATION (`annulerAction`) : transition vers `annulee` (permise à tout niveau).
 * Les propositions terminées sont anonymisées au bout de 30 jours (`purge.ts`, migration 0274).
 * Les transitions sont en AJOUT SEUL (déclencheur MPG10 et MPG11) : un état terminal ne change
 * plus. Cadre d'extension : une entrée de plus dans `ACTIONS` (et dans le catalogue du moteur).
 */

/* ----- Empreinte ----- */

/** JSON canonique (clés triées) : mêmes paramètres, même empreinte. */
export function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const empreinteParametres = (parametres: unknown): string =>
  createHash("sha256").update(canonique(parametres), "utf8").digest("hex");

/* ----- Registre ----- */

export type PreparationAction =
  | { type: "prete"; parametres: Record<string, unknown>; resume: string }
  | { type: "precision"; texte: string };

export interface ExecutionAction {
  resultatId: string;
  texte: string;
  elements: ElementCopilote[];
  notifications: (NotificationCreee | null)[];
}

export interface DefinitionAction<A extends OutilActionCopilote> {
  libelle: string;
  /** Droit exigé par la route du service appelé : vérifié à la proposition ET à la confirmation. */
  permission(auth: Auth): boolean;
  preparer(c: ContexteOutil, parametres: ParametresCopilote[A]): Promise<PreparationAction>;
  /** Exécute par le service existant, dans la transaction reçue, sous les droits de `auth`. */
  executer(db: Db, auth: Auth, parametres: unknown): Promise<ExecutionAction>;
}

/* ----- Créer une tâche ----- */

const parametresCreerTacheSchema = z
  .object({
    titre: z.string().min(1).max(200),
    echeance: z.string().nullable(),
    assignee_id: z.string().uuid(),
    mission_id: z.string().uuid().nullable(),
  })
  .strict();

const CANDIDATS_MAX = 6;

/**
 * Collaborateur INTERNE actif du cabinet dont le nom contient `nom` (accents et casse ignorés) :
 * jamais une personne du portail client (rôles `client_*`), ni proposée ni assignée.
 */
async function resoudrePersonne(db: Db, nom: string): Promise<{ id: string; nom: string }[]> {
  const cherche = plierTexteCopilote(nom).trim();
  const r = await db.query(
    `SELECT id, nom FROM utilisateurs
     WHERE actif AND NOT (roles && $3::text[]) AND cap_sans_accents(nom) LIKE $1
     ORDER BY nom, id LIMIT $2`,
    [motifContient(cherche), CANDIDATS_MAX, ROLES_CLIENT],
  );
  const trouves = r.rows.map((u) => ({ id: u.id as string, nom: u.nom as string }));
  const exacts = trouves.filter((u) => plierTexteCopilote(u.nom).trim() === cherche);
  return exacts.length === 1 ? exacts : trouves;
}

async function preparerCreerTache(
  c: ContexteOutil,
  p: ParametresCopilote["creer_tache"],
): Promise<PreparationAction> {
  const { db, auth } = c;
  const precision = (texte: string): PreparationAction => ({ type: "precision", texte });
  let assignee = { id: auth.utilisateurId, nom: auth.nom };
  if (p.pour) {
    // Comme le menu « Confier à » de l'écran : l'annuaire de l'équipe exige `collaborateurs.lire`.
    if (!aPermission(auth.roles, "collaborateurs.lire")) {
      return precision(
        "Vous ne pouvez créer une tâche que pour vous-même : l'annuaire de l'équipe ne vous est pas accessible.",
      );
    }
    const personnes = await resoudrePersonne(db, p.pour);
    if (personnes.length === 0) {
      return precision(`Je ne trouve aucun collaborateur correspondant à « ${p.pour} ».`);
    }
    if (personnes.length > 1) {
      return precision(
        `Plusieurs collaborateurs correspondent à « ${p.pour} » : précisez le nom complet (${personnes.map((x) => x.nom).join(", ")}).`,
      );
    }
    assignee = personnes[0] as { id: string; nom: string };
  }
  const soiMeme = assignee.id === auth.utilisateurId;
  let mission: { id: string; intitule: string } | null = null;
  if (p.mission) {
    if (!aPermission(auth.roles, "mission.lire")) {
      return precision("Vous ne pouvez pas rattacher une tâche à une mission par son nom.");
    }
    const r = await resoudreMission(c, p.mission);
    if (r.type === "introuvable" || r.type === "precision") {
      return precision(MESSAGE_MISSION_INTROUVABLE);
    }
    if (r.type === "candidates") {
      return precision(
        `Plusieurs missions correspondent à « ${p.mission} » : précisez laquelle (${r.missions.map((m) => m.intitule).join(", ")}).`,
      );
    }
    const intitule = await db.query("SELECT intitule FROM missions WHERE id = $1", [r.id]);
    mission = { id: r.id, intitule: (intitule.rows[0]?.intitule as string | undefined) ?? "" };
    if (!soiMeme) {
      const autre = await authDe(db, auth.cabinetId, assignee.id);
      if (!autre || !(await voitEntite(db, autre, "mission", mission.id))) {
        return precision(`${assignee.nom} n'a pas accès à cette mission.`);
      }
    }
  }
  const parametres = {
    titre: p.titre.trim(),
    echeance: p.echeance ?? null,
    assignee_id: assignee.id,
    mission_id: mission?.id ?? null,
  };
  const valide = tacheCollaborationCreationSchema.safeParse(entreeTache(parametres));
  if (!valide.success) {
    return precision(
      "Je n'ai pas pu préparer cette tâche : vérifiez l'intitulé (200 caractères au plus) et la date d'échéance.",
    );
  }
  return {
    type: "prete",
    parametres,
    resume: resumerCreerTache({
      titre: parametres.titre,
      echeance: parametres.echeance,
      pour_nom: soiMeme ? null : assignee.nom,
      mission_intitule: mission?.intitule ?? null,
    }),
  };
}

/** Corps du service de création (le même schéma que `POST /api/taches-collaboration`). */
function entreeTache(p: {
  titre: string;
  echeance: string | null;
  assignee_id: string;
  mission_id: string | null;
}) {
  return {
    titre: p.titre,
    description: "",
    assignee_id: p.assignee_id,
    echeance: p.echeance,
    ...(p.mission_id ? { entite_type: "mission", entite_id: p.mission_id } : {}),
  };
}

/**
 * Création d'une tâche assignée : le SERVICE COMMUN de `POST /api/taches-collaboration`
 * (collaboration/taches.ts : entité liée visible du créateur ET de l'assigné, assigné INTERNE actif
 * du cabinet, INSERT, journal, notification de l'assigné), sous les droits de l'utilisateur ; le
 * journal garde `via: "copilote"`.
 */
async function creerTache(db: Db, auth: Auth, parametres: unknown): Promise<ExecutionAction> {
  const p = parametresCreerTacheSchema.parse(parametres);
  const t = tacheCollaborationCreationSchema.parse(entreeTache(p));
  const { id, notifications } = await creerTacheAssignee(db, auth, t, "copilote");
  return {
    resultatId: id,
    texte: `La tâche « ${t.titre} » a été créée.`,
    elements: [{ libelle: t.titre, detail: "Tâche créée", lien: `${LIEN_MES_TACHES}/${id}` }],
    notifications,
  };
}

/** Une entrée par action modifiante : à étendre avec le catalogue du moteur. */
export const ACTIONS: { [A in OutilActionCopilote]: DefinitionAction<A> } = {
  creer_tache: {
    libelle: LIBELLE_ACTION_CREER_TACHE,
    permission: (auth) => aPermission(auth.roles, "tache.assigner"),
    preparer: preparerCreerTache,
    executer: creerTache,
  },
};

const estAction = (outil: string): outil is OutilActionCopilote =>
  Object.prototype.hasOwnProperty.call(ACTIONS, outil);

/* ----- Proposition ----- */

export type ResultatProposition =
  | { type: "proposee"; texte: string; action: ActionProposeeCopilote }
  | { type: "precision"; texte: string };

export async function proposerAction(
  c: ContexteOutil,
  outil: OutilActionCopilote,
  parametres: ParametresCopilote[OutilActionCopilote],
  maintenant: Date,
): Promise<ResultatProposition> {
  // Niveau d'autonomie de l'agent « copilote » : N2 au moins pour proposer une action (409 sinon).
  await exigerCopiloteActif(c.db, "action");
  const def = ACTIONS[outil];
  const prep = await def.preparer(c, parametres);
  if (prep.type === "precision") return prep;
  const expire = new Date(maintenant.getTime() + EXPIRATION_ACTION_COPILOTE_MINUTES * 60_000);
  const r = await c.db.query(
    `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume,
       cree_le, expire_le)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
    [
      c.auth.cabinetId,
      c.auth.utilisateurId,
      outil,
      JSON.stringify(prep.parametres),
      empreinteParametres(prep.parametres),
      prep.resume,
      maintenant,
      expire,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(c.db, {
    cabinetId: c.auth.cabinetId,
    utilisateurId: c.auth.utilisateurId,
    action: "copilote.action_proposee",
    entite: "copilote_action",
    entiteId: id,
    details: { outil },
  });
  return {
    type: "proposee",
    texte: "",
    action: {
      action_id: id,
      outil,
      libelle: def.libelle,
      resume: prep.resume,
      expire_le: expire.toISOString(),
    },
  };
}

/* ----- Confirmation et annulation ----- */

interface LigneAction {
  id: string;
  outil: string;
  parametres: unknown;
  empreinte: string;
  statut: string;
  expire_le: Date;
}

/** Proposition DE L'UTILISATEUR, ligne verrouillée ; celle d'autrui ou inexistante : 404. */
async function lireVerrouillee(db: Db, auth: Auth, id: string): Promise<LigneAction> {
  const r = await db.query(
    `SELECT id, outil, parametres, empreinte, statut, expire_le FROM copilote_actions
     WHERE id = $1 AND utilisateur_id = $2 FOR UPDATE`,
    [id, auth.utilisateurId],
  );
  if (!r.rows[0]) throw actionIntrouvable();
  return r.rows[0] as LigneAction;
}

async function decider(
  db: Db,
  id: string,
  statut: "confirmee" | "annulee" | "expiree" | "refusee",
  maintenant: Date,
  resultatId: string | null,
): Promise<void> {
  await db.query(
    "UPDATE copilote_actions SET statut = $2, decide_le = $3, resultat_id = $4 WHERE id = $1",
    [id, statut, maintenant, resultatId],
  );
}

export interface ResultatConfirmation {
  resultat: ResultatActionCopilote;
  notifications: (NotificationCreee | null)[];
}

type Sortie = { erreur: AppError } | { succes: ResultatConfirmation };

export async function confirmerAction(
  database: Database,
  auth: Auth,
  id: string,
  maintenant: Date,
): Promise<ResultatConfirmation> {
  const sortie = await database
    .withTenant(auth.cabinetId, async (db): Promise<Sortie> => {
      const a = await lireVerrouillee(db, auth, id);
      if (a.statut !== "proposee") throw actionDejaTraitee(a.statut);
      // Refus durable : la décision est inscrite (et validée) AVANT que l'erreur ne parte.
      const refuser = async (
        statut: "expiree" | "refusee",
        erreur: AppError,
        motif: string,
      ): Promise<Sortie> => {
        await decider(db, a.id, statut, maintenant, null);
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "copilote.action_refusee",
          entite: "copilote_action",
          entiteId: a.id,
          details: { outil: a.outil, motif },
        });
        return { erreur };
      };
      if (maintenant.getTime() >= a.expire_le.getTime()) {
        return refuser("expiree", actionExpiree(), "expiree");
      }
      // Le cabinet a pu plafonner l'agent depuis la proposition : rien n'est exécuté (409). La
      // proposition reste « proposee » (non décidée) jusqu'à son expiration.
      await exigerCopiloteActif(db, "action");
      if (!estAction(a.outil)) {
        return refuser("refusee", actionAlteree(), "outil_inconnu");
      }
      const def = ACTIONS[a.outil];
      // Droits RÉVÉRIFIÉS à la confirmation : ils ont pu être retirés depuis la proposition.
      if (!def.permission(auth)) {
        return refuser(
          "refusee",
          new AppError(403, "INTERDIT", "Vous n'avez plus le droit d'effectuer cette action."),
          "permission_retiree",
        );
      }
      if (empreinteParametres(a.parametres) !== a.empreinte) {
        return refuser("refusee", actionAlteree(), "empreinte");
      }
      const exec = await def.executer(db, auth, a.parametres);
      await decider(db, a.id, "confirmee", maintenant, exec.resultatId);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "copilote.action_confirmee",
        entite: "copilote_action",
        entiteId: a.id,
        details: { outil: a.outil, resultat_id: exec.resultatId },
      });
      return {
        succes: {
          resultat: { statut: "confirmee", texte: exec.texte, elements: exec.elements },
          notifications: exec.notifications,
        },
      };
    })
    .catch(traduireErreurCopilote);
  if ("erreur" in sortie) throw sortie.erreur;
  return sortie.succes;
}

export async function annulerAction(
  database: Database,
  auth: Auth,
  id: string,
  maintenant: Date,
): Promise<ResultatActionCopilote> {
  await database
    .withTenant(auth.cabinetId, async (db) => {
      const a = await lireVerrouillee(db, auth, id);
      if (a.statut !== "proposee") throw actionDejaTraitee(a.statut);
      await decider(db, a.id, "annulee", maintenant, null);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "copilote.action_annulee",
        entite: "copilote_action",
        entiteId: a.id,
        details: { outil: a.outil },
      });
    })
    .catch(traduireErreurCopilote);
  return {
    statut: "annulee",
    texte: "La proposition a été annulée : rien n'a été modifié.",
    elements: [],
  };
}
