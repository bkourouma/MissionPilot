import {
  garderActionAutomatisation,
  normaliserPayloadEvenement,
  planifierExecutionAutomatisation,
  rendreGabarit,
  type ConditionAutomatisation,
  type NiveauAutonomie,
  type PayloadEvenement,
} from "@missionpilot/engines";
import {
  actionAutomatisationSchema,
  aPermission,
  definitionAutomatisationSchema,
  REGISTRE_ACTIONS_AUTOMATISATION,
  type ActionAutomatisationApi,
  type ClasseRisque,
  type CodeEvenementAutomatisation,
  type DefinitionAutomatisationApi,
} from "@missionpilot/shared";
import { z } from "zod";
import { etatAutonomie, lireBrique, lireCoupeCircuit } from "../agents/autonomie.js";
import { executerAgent } from "../agents/executions.js";
import { lireAgent } from "../agents/registre.js";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import type { DependancesIa } from "../ia/orchestrateur.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { executerAction, type ResultatAction } from "./actions.js";
import { lireCoupeCircuitAutomatisation } from "./coupe-circuits.js";
import { champsMoteur, classeAction, metaAction } from "./definitions.js";
import { journaliserIncident } from "./diagnostic.js";
import { executantDe, missionDe, voitMission, type ContexteMission } from "./executant.js";

/*
 * TRAITEMENT ASYNCHRONE D'UN ÉVÉNEMENT (AUT-02, AUT-05, AUT-06) — job
 * `automatisation_evenement`, dans la transaction du job et le contexte RLS du cabinet.
 *
 * Pour chaque automatisation ACTIVE de ce code, activée AVANT l'événement :
 * 1. coupe-circuit du cabinet ou de l'automatisation → exécution « bloquée », aucune action ;
 * 2. condition évaluée par le moteur sur le contenu NORMALISÉ (champs déclarés seulement) ;
 * 3. actions planifiées avec leur clé d'idempotence, chacune passée à la GARDE du moteur
 *    (coupe-circuits, R2/R3 jamais vers le client, N4 réservé à R0 et coupé par le
 *    coupe-circuit N4 des agents, niveau effectif de la brique d'un agent, permission de
 *    l'exécutant, visibilité de la mission) ; décision ENREGISTRÉE avec l'action ;
 * 4. action autorisée exécutée dans un SAVEPOINT : l'échec de l'une n'annule pas les autres ;
 *    l'appel d'un agent part dans sa propre file (`automatisation_agent`, une tentative).
 * Idempotence : une exécution par (automatisation, événement), une action par clé ; un job
 * rejoué ne refait rien. Les notifications sont renvoyées au worker (e-mails après commit).
 */

export const TYPE_JOB_AGENT_AUTOMATISATION = "automatisation_agent";

interface EvenementDb {
  id: string;
  code: CodeEvenementAutomatisation;
  payload: Record<string, unknown>;
  acteur_id: string | null;
  mission_id: string | null;
  cree_le: Date;
}

interface AutomatisationDb {
  id: string;
  nom: string;
  responsable_id: string;
  version_courante: number;
  definition: unknown;
}

const chargeEvenementSchema = z.object({ evenement_id: z.string().uuid() }).strict();
const chargeAgentSchema = z.object({ action_id: z.string().uuid() }).strict();

async function lireEvenementDb(db: Db, id: string): Promise<EvenementDb | null> {
  const r = await db.query(
    `SELECT id, code, payload, acteur_id, mission_id, cree_le FROM automatisation_evenements
     WHERE id = $1`,
    [id],
  );
  return (r.rows[0] as EvenementDb | undefined) ?? null;
}

interface ContexteExecution {
  db: Db;
  cabinetId: string;
  maintenant: Date;
  evenement: EvenementDb;
  payload: PayloadEvenement;
  mission: ContexteMission | null;
  coupeCabinet: boolean;
  coupeN4: boolean;
}

/** Niveau effectif et classe de la brique de l'agent appelé (null si inconnus). */
export async function etatAgent(
  db: Db,
  action: Extract<ActionAutomatisationApi, { type: "appeler_agent" }>,
): Promise<{ niveau: NiveauAutonomie | null; classe: ClasseRisque | null }> {
  try {
    const agent = await lireAgent(db, action.agent_code);
    if (!agent.actif) return { niveau: "N0", classe: null };
    if (!action.brique_code) return { niveau: agent.niveau_max, classe: null };
    const brique = await lireBrique(db, action.brique_code);
    if (brique.agent_code !== agent.code) return { niveau: null, classe: brique.classe_risque };
    const e = etatAutonomie(brique, agent, await lireCoupeCircuit(db));
    return { niveau: e.niveau_effectif, classe: brique.classe_risque };
  } catch (error) {
    if (error instanceof AppError && error.statut === 404) return { niveau: null, classe: null };
    throw error;
  }
}

async function inscrireResultat(
  db: Db,
  cabinetId: string,
  actionId: string,
  r: ResultatAction | { statut: "refusee"; code: string; message: string },
): Promise<void> {
  const entite = "entite" in r ? (r.entite ?? null) : null;
  await db.query(
    `INSERT INTO automatisation_action_resultats (cabinet_id, action_id, statut, code, message,
       entite_type, entite_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      cabinetId,
      actionId,
      r.statut,
      r.code ?? null,
      r.message ? r.message.slice(0, 500) : null,
      entite?.type ?? null,
      entite?.id ?? null,
      JSON.stringify(("details" in r ? r.details : undefined) ?? {}),
    ],
  );
}

/**
 * Échec d'une action : code métier d'une AppError ; toute autre erreur devient ERREUR_INTERNE
 * (le résultat n'en dit rien) mais est CONSIGNÉE côté serveur (message, code, contrainte), avec
 * les repères non sensibles de l'appelant : sans cette trace, une panne resterait invisible.
 */
function echecDe(
  error: unknown,
  contexte: string,
  reperes: Readonly<Record<string, string | number | null>>,
): ResultatAction {
  if (error instanceof AppError) {
    return { statut: "echec", code: error.code, message: error.message };
  }
  journaliserIncident(contexte, error, reperes);
  return { statut: "echec", code: "ERREUR_INTERNE", message: "Erreur inattendue." };
}

async function executerUneAction(
  c: ContexteExecution,
  a: AutomatisationDb,
  executant: Auth | null,
  plan: { indice: number; action: ActionAutomatisationApi; cle: string },
  executionId: string,
  coupeAutomatisation: boolean,
): Promise<NotificationCreee[]> {
  const { db, cabinetId } = c;
  const action = plan.action;
  const meta = REGISTRE_ACTIONS_AUTOMATISATION[action.type];
  const agent = action.type === "appeler_agent" ? await etatAgent(db, action) : null;
  const decision = garderActionAutomatisation(metaAction(action, agent?.classe ?? null), {
    coupeCircuitCabinet: c.coupeCabinet,
    coupeCircuitAutomatisation: coupeAutomatisation,
    coupeCircuitN4: c.coupeN4,
    droitsSuffisants:
      executant !== null &&
      (meta.permission === null || aPermission(executant.roles, meta.permission)),
    missionVisible:
      c.mission === null ||
      (executant !== null && (await voitMission(db, executant, c.mission.id))),
    niveauAgentEffectif: agent?.niveau ?? null,
  });
  const refus: string[] = [...decision.refus];
  if (executant === null) refus.push("EXECUTANT_INDISPONIBLE");
  if (agent && agent.niveau === null) refus.push("AGENT_INCONNU");
  const ins = await db.query(
    `INSERT INTO automatisation_actions (cabinet_id, execution_id, indice, type, parametres,
       classe_risque, vers_client, annulable, cle, autorisee, refus)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (cabinet_id, cle) DO NOTHING RETURNING id`,
    [
      cabinetId,
      executionId,
      plan.indice,
      action.type,
      JSON.stringify(action),
      classeAction(action, agent?.classe ?? null),
      meta.vers_client,
      meta.annulable,
      plan.cle,
      refus.length === 0,
      refus,
    ],
  );
  const actionId = ins.rows[0]?.id as string | undefined;
  if (!actionId) return [];
  if (refus.length > 0 || executant === null) {
    await inscrireResultat(db, cabinetId, actionId, {
      statut: "refusee",
      code: "GARDE_REFUSEE",
      message: `Refusée par la garde : ${refus.join(", ")}.`,
    });
    return [];
  }
  if (action.type === "appeler_agent") {
    await db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, tentatives_max, execute_a, cle)
       VALUES ($1, $2, $3, 1, $4, $5) ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
      [
        cabinetId,
        TYPE_JOB_AGENT_AUTOMATISATION,
        JSON.stringify({ action_id: actionId }),
        c.maintenant,
        `${TYPE_JOB_AGENT_AUTOMATISATION}:${actionId}`,
      ],
    );
    return [];
  }
  await db.query("SAVEPOINT automatisation_action");
  let resultat: ResultatAction;
  try {
    resultat = await executerAction(
      {
        db,
        cabinetId,
        executant,
        evenement: { id: c.evenement.id, payload: c.payload, acteur_id: c.evenement.acteur_id },
        mission: c.mission,
        responsableId: a.responsable_id,
        actionId,
        automatisationNom: a.nom,
        maintenant: c.maintenant,
      },
      action,
    );
    await db.query("RELEASE SAVEPOINT automatisation_action");
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT automatisation_action");
    await db.query("RELEASE SAVEPOINT automatisation_action");
    resultat = echecDe(error, "action", {
      automatisation_id: a.id,
      action_id: actionId,
      type: action.type,
    });
  }
  await inscrireResultat(db, cabinetId, actionId, resultat);
  return resultat.notifications ?? [];
}

async function executerAutomatisation(
  c: ContexteExecution,
  a: AutomatisationDb,
): Promise<NotificationCreee[]> {
  const lue = definitionAutomatisationSchema.safeParse(a.definition);
  if (!lue.success) return [];
  const definition: DefinitionAutomatisationApi = lue.data;
  const coupeAutomatisation = (await lireCoupeCircuitAutomatisation(c.db, a.id)).actif;
  const executant = await executantDe(
    c.db,
    c.cabinetId,
    definition.mode_execution,
    a.responsable_id,
    c.evenement.acteur_id,
  );
  const raison = c.coupeCabinet
    ? "COUPE_CIRCUIT_CABINET"
    : coupeAutomatisation
      ? "COUPE_CIRCUIT_AUTOMATISATION"
      : null;
  const plan = raison
    ? { declenchee: false, actions: [] }
    : planifierExecutionAutomatisation(
        a.id,
        {
          condition: definition.condition as ConditionAutomatisation | null,
          actions: definition.actions,
        },
        { id: c.evenement.id, payload: c.payload },
      );
  const issue = raison ? "bloquee" : plan.declenchee ? "declenchee" : "conditions_non_remplies";
  const x = await c.db.query(
    `INSERT INTO automatisation_executions (cabinet_id, automatisation_id, version, evenement_id,
       issue, raison, mode_execution, executant_id, mission_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (cabinet_id, automatisation_id, evenement_id) DO NOTHING RETURNING id`,
    [
      c.cabinetId,
      a.id,
      a.version_courante,
      c.evenement.id,
      issue,
      raison,
      definition.mode_execution,
      executant?.utilisateurId ?? null,
      c.mission?.id ?? null,
    ],
  );
  const executionId = x.rows[0]?.id as string | undefined;
  if (!executionId || issue !== "declenchee") return [];
  const notifications: NotificationCreee[] = [];
  for (const p of plan.actions) {
    notifications.push(
      ...(await executerUneAction(c, a, executant, p, executionId, coupeAutomatisation)),
    );
  }
  return notifications;
}

/** Traite un événement pour toutes les automatisations actives qui l'écoutent. */
export async function traiterEvenement(
  db: Db,
  cabinetId: string,
  evenementId: string,
  maintenant: Date,
): Promise<NotificationCreee[]> {
  const evenement = await lireEvenementDb(db, evenementId);
  if (!evenement) return [];
  const autos = await db.query(
    `SELECT a.id, a.nom, a.responsable_id, a.version_courante, v.definition
     FROM automatisations a
     JOIN automatisation_versions v ON v.automatisation_id = a.id AND v.version = a.version_courante
     WHERE a.active AND a.evenement_code = $1 AND a.active_depuis <= $2
     ORDER BY a.cree_le, a.id`,
    [evenement.code, evenement.cree_le],
  );
  if (autos.rows.length === 0) return [];
  const c: ContexteExecution = {
    db,
    cabinetId,
    maintenant,
    evenement,
    payload: normaliserPayloadEvenement(evenement.payload, champsMoteur(evenement.code)),
    mission: await missionDe(db, evenement.mission_id),
    coupeCabinet: (await lireCoupeCircuitAutomatisation(db, null)).actif,
    coupeN4: (await lireCoupeCircuit(db)).actif,
  };
  const notifications: NotificationCreee[] = [];
  for (const a of autos.rows as AutomatisationDb[]) {
    notifications.push(...(await executerAutomatisation(c, a)));
  }
  return notifications;
}

export function creerHandlerEvenementAutomatisation(): HandlerJob {
  return async (ctx) => {
    const charge = chargeEvenementSchema.safeParse(ctx.charge);
    if (!charge.success) throw new ErreurJobDefinitive("Charge d'événement invalide.");
    return traiterEvenement(ctx.db, ctx.cabinetId, charge.data.evenement_id, ctx.maintenant);
  };
}

/* ----- Appel d'un agent (file propre, une tentative) ----- */

interface ActionAgentDb {
  id: string;
  parametres: unknown;
  responsable_id: string;
  mode_execution: "responsable" | "declencheur";
  acteur_id: string | null;
  code: CodeEvenementAutomatisation;
  payload: Record<string, unknown>;
  mission_id: string | null;
  resultat: string | null;
  automatisation_id: string;
  active: boolean;
}

async function lireActionAgent(db: Db, actionId: string): Promise<ActionAgentDb | null> {
  const r = await db.query(
    `SELECT a.id, a.parametres, au.responsable_id, x.mode_execution, e.acteur_id, e.code, e.payload,
       e.mission_id, r.id AS resultat, au.id AS automatisation_id, au.active
     FROM automatisation_actions a
     JOIN automatisation_executions x ON x.id = a.execution_id
     JOIN automatisations au ON au.id = x.automatisation_id
     JOIN automatisation_evenements e ON e.id = x.evenement_id
     LEFT JOIN automatisation_action_resultats r ON r.action_id = a.id
     WHERE a.id = $1 AND a.type = 'appeler_agent' AND a.autorisee`,
    [actionId],
  );
  return (r.rows[0] as ActionAgentDb | undefined) ?? null;
}

async function appelerAgent(
  database: Database,
  deps: DependancesIa,
  executant: Auth,
  a: ActionAgentDb,
): Promise<{ resultat: ResultatAction; notifications: NotificationCreee[] }> {
  const action = actionAutomatisationSchema.parse(a.parametres);
  if (action.type !== "appeler_agent") throw new ErreurJobDefinitive("Action inattendue.");
  const payload = normaliserPayloadEvenement(a.payload, champsMoteur(a.code));
  const variables = Object.fromEntries(
    Object.entries(action.variables).map(([nom, g]) => [nom, rendreGabarit(g, payload)]),
  );
  const r = await executerAgent(database, deps, {
    utilisateur: executant,
    agentCode: action.agent_code,
    briqueCode: action.brique_code,
    promptNom: action.prompt_nom,
    variables,
    entite: { missionId: a.mission_id, type: "automatisation_action", id: a.id },
    repliSiPlafond: true,
  });
  const notifications = r.resultat.notifications.filter((n): n is NotificationCreee => n !== null);
  if (r.statut !== "terminee") {
    return {
      resultat: {
        statut: "echec",
        code: `AGENT_${r.statut.toUpperCase()}`,
        message: "Exécution de l'agent non terminée.",
      },
      notifications,
    };
  }
  return {
    resultat: {
      statut: "reussie",
      entite: { type: "agent_execution", id: String(r.execution.id) },
    },
    notifications,
  };
}

/** Raison pour laquelle l'appel d'un agent ne doit plus partir (null s'il peut partir). */
async function blocageAvantAppel(
  db: Db,
  a: ActionAgentDb,
): Promise<{ raison: string; message: string } | null> {
  if ((await lireCoupeCircuitAutomatisation(db, null)).actif) {
    return {
      raison: "COUPE_CIRCUIT_CABINET",
      message: "Appel de l'agent ignoré : coupe-circuit des automatisations du cabinet actif.",
    };
  }
  if ((await lireCoupeCircuitAutomatisation(db, a.automatisation_id)).actif) {
    return {
      raison: "COUPE_CIRCUIT_AUTOMATISATION",
      message: "Appel de l'agent ignoré : coupe-circuit de l'automatisation actif.",
    };
  }
  if (!a.active) {
    return {
      raison: "AUTOMATISATION_INACTIVE",
      message: "Appel de l'agent ignoré : l'automatisation a été désactivée.",
    };
  }
  return null;
}

export function creerHandlerAgentAutomatisation(dependances: () => DependancesIa): HandlerJob {
  return async (ctx) => {
    const charge = chargeAgentSchema.safeParse(ctx.charge);
    if (!charge.success) throw new ErreurJobDefinitive("Charge d'appel d'agent invalide.");
    const a = await lireActionAgent(ctx.db, charge.data.action_id);
    if (!a || a.resultat) return [];
    // L'appel part dans sa propre file, plus tard que la décision de la garde : on relit ce
    // qui a pu changer entre-temps (coupe-circuit du cabinet ou de l'automatisation,
    // désactivation) et l'on n'appelle pas l'agent si l'un bloque. « ignoree » est admis par la
    // base pour une action autorisée (MPU05 n'impose « refusee » qu'aux actions refusées).
    const blocage = await blocageAvantAppel(ctx.db, a);
    if (blocage) {
      await inscrireResultat(ctx.db, ctx.cabinetId, a.id, {
        statut: "ignoree",
        code: "COUPE_CIRCUIT",
        message: blocage.message,
        details: { raison: blocage.raison },
      });
      return [];
    }
    const executant = await executantDe(
      ctx.db,
      ctx.cabinetId,
      a.mode_execution,
      a.responsable_id,
      a.acteur_id,
    );
    let sortie: { resultat: ResultatAction; notifications: NotificationCreee[] };
    if (!executant) {
      sortie = {
        resultat: {
          statut: "echec",
          code: "EXECUTANT_INDISPONIBLE",
          message: "Aucun exécutant actif.",
        },
        notifications: [],
      };
    } else if (!ctx.database) {
      sortie = {
        resultat: echecDe(new Error("Base de l'application absente du contexte du job."), "agent", {
          action_id: a.id,
        }),
        notifications: [],
      };
    } else {
      try {
        sortie = await appelerAgent(
          ctx.database,
          { ...dependances(), horloge: () => ctx.maintenant },
          executant,
          a,
        );
      } catch (error) {
        if (error instanceof ErreurJobDefinitive) throw error;
        sortie = {
          resultat: echecDe(error, "agent", {
            automatisation_id: a.automatisation_id,
            action_id: a.id,
          }),
          notifications: [],
        };
      }
    }
    await inscrireResultat(ctx.db, ctx.cabinetId, a.id, sortie.resultat);
    return sortie.notifications;
  };
}
