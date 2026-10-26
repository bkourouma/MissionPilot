import {
  ajouterJours,
  garderActionAutomatisation,
  normaliserPayloadEvenement,
  planifierExecutionAutomatisation,
  rendreGabarit,
  type ConditionAutomatisation,
  type PayloadEvenement,
} from "@missionpilot/engines";
import {
  aPermission,
  REGISTRE_ACTIONS_AUTOMATISATION,
  type ActionAutomatisationApi,
  type Role,
} from "@missionpilot/shared";
import { champsMoteur, classeAction, metaAction } from "../../../automatisation/definitions.js";
import { destinataires } from "../../../automatisation/executant.js";
import { texteBrut } from "../../../notifications/notifier.js";
import type { ContexteTenantDemo } from "../contexte.js";
import {
  debutPeriode,
  finPeriode,
  type EvenementBd,
  type RegleBd,
} from "./automatisation-regles.js";

/*
 * Rejeu de l'HISTORIQUE d'exécution : pour chaque événement et chaque règle active à ce moment, on
 * rejoue ce que le moteur (automatisation/execution.ts) aurait enregistré, avec LES MÊMES briques
 * pures (planification et clés d'idempotence, garde des actions, gabarits) et les mêmes écritures
 * (exécution, actions, résultats, brouillons, tâches), mais datées du jour de l'événement : les
 * tables du journal sont en ajout seul (MPU01), l'INSERT porte donc `cree_le`. Aucune notification
 * ni aucun e-mail n'est écrit ; l'appel d'un agent et la relance du client ne sont pas utilisés.
 */

interface InfoMission {
  id: string;
  chefId: string | null;
  directeurId: string | null;
}

const plusSecondes = (iso: string, s: number): string =>
  new Date(Date.parse(iso) + s * 1000).toISOString();

type Resultat = {
  statut: "reussie" | "refusee" | "ignoree" | "echec";
  code?: string;
  message?: string;
  entite?: { type: string; id: string };
  details?: Record<string, unknown>;
};

export async function chargerInfosMissions(
  ctx: ContexteTenantDemo,
  ids: string[],
): Promise<Map<string, InfoMission>> {
  const r = await ctx.proprietaire.query<{
    id: string;
    chef_id: string | null;
    directeur_id: string | null;
  }>(
    "SELECT id, chef_id, directeur_id FROM missions WHERE cabinet_id = $1 AND id = ANY($2::uuid[])",
    [ctx.cabinetId, ids],
  );
  return new Map(
    r.rows.map((m) => [m.id, { id: m.id, chefId: m.chef_id, directeurId: m.directeur_id }]),
  );
}

interface ContexteRejeu {
  ctx: ContexteTenantDemo;
  regle: RegleBd;
  executantId: string;
  executantRole: Role;
  evenement: EvenementBd;
  payload: PayloadEvenement;
  mission: InfoMission;
  tExecution: string;
}

async function executer(
  r: ContexteRejeu,
  action: ActionAutomatisationApi,
  actionId: string,
  autorisee: boolean,
  refus: readonly string[],
  tAction: string,
): Promise<Resultat> {
  const c = r.ctx.proprietaire;
  if (!autorisee) {
    return {
      statut: "refusee",
      code: "GARDE_REFUSEE",
      message: `Refusée par la garde : ${refus.join(", ")}.`,
    };
  }
  const cibles = (liste: Parameters<typeof destinataires>[0]) =>
    destinataires(liste, {
      mission: { id: r.mission.id, chef_id: r.mission.chefId, directeur_id: r.mission.directeurId },
      responsableId: r.executantId,
      acteurId: null,
    });
  switch (action.type) {
    case "creer_tache": {
      const [assigne] = cibles([action.assigne]);
      if (!assigne) {
        return {
          statut: "ignoree",
          code: "DESTINATAIRE_ABSENT",
          message: "Aucune personne à qui assigner la tâche.",
        };
      }
      const jourExec = r.tExecution.slice(0, 10);
      const echeance =
        action.echeance_jours === null ? null : ajouterJours(jourExec, action.echeance_jours);
      const t = await c.query<{ id: string }>(
        `INSERT INTO taches_collaboration (cabinet_id, titre, description, assignee_id, cree_par,
           echeance, statut, fait_le, entite_type, entite_id, mission_id, cree_le, modifie_le)
         VALUES ($1, $2, $3, $4, $5, $6, 'fait', $7, 'mission', $8, $8, $9, $7) RETURNING id`,
        [
          r.ctx.cabinetId,
          texteBrut(rendreGabarit(action.titre, r.payload), 200) || "Tâche",
          texteBrut(rendreGabarit(action.description, r.payload), 5000),
          assigne,
          r.executantId,
          echeance,
          plusSecondes(r.tExecution, 6 * 86_400),
          r.mission.id,
          tAction,
        ],
      );
      return { statut: "reussie", entite: { type: "tache_collaboration", id: t.rows[0]!.id } };
    }
    case "notifier": {
      const n = cibles(action.destinataires).length;
      return n === 0
        ? {
            statut: "ignoree",
            code: "AUCUN_DESTINATAIRE",
            message: "Aucun destinataire joignable.",
          }
        : { statut: "reussie", details: { destinataires: n } };
    }
    case "brouillon": {
      const titre = texteBrut(rendreGabarit(action.titre, r.payload), 200) || "Note";
      const corps = rendreGabarit(action.corps, r.payload).trim().slice(0, 5000) || titre;
      const b = await c.query<{ id: string }>(
        `INSERT INTO automatisation_brouillons (cabinet_id, action_id, mission_id, nature, titre,
           corps, cree_le) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [r.ctx.cabinetId, actionId, r.mission.id, action.nature, titre, corps, tAction],
      );
      return { statut: "reussie", entite: { type: "automatisation_brouillon", id: b.rows[0]!.id } };
    }
    case "facture_brouillon":
      return {
        statut: "ignoree",
        code: "AUCUNE_ECHEANCE",
        message: "Aucune échéance à facturer n'est rattachée à ce jalon.",
      };
    default:
      return {
        statut: "ignoree",
        code: "ACTION_NON_REJOUEE",
        message: "Action non rejouée dans l'historique.",
      };
  }
}

/** Rejoue une règle sur un événement ; renvoie faux si l'exécution existait déjà (reprise). */
async function rejouerUne(r: ContexteRejeu): Promise<boolean> {
  const { ctx, regle, evenement, mission } = r;
  const c = ctx.proprietaire;
  const periode = regle.spec.periodes.find(
    (p) =>
      debutPeriode(p) <= evenement.creeLe &&
      (finPeriode(p) === null || evenement.creeLe < finPeriode(p)!),
  )!;
  const definition = regle.definitions.get(periode.version)!;
  const plan = planifierExecutionAutomatisation(
    regle.id,
    {
      condition: definition.condition as ConditionAutomatisation | null,
      actions: definition.actions,
    },
    { id: evenement.id, payload: r.payload },
  );
  const x = await c.query<{ id: string }>(
    `INSERT INTO automatisation_executions (cabinet_id, automatisation_id, version, evenement_id,
       issue, raison, mode_execution, executant_id, mission_id, cree_le)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9)
     ON CONFLICT (cabinet_id, automatisation_id, evenement_id) DO NOTHING RETURNING id`,
    [
      ctx.cabinetId,
      regle.id,
      periode.version,
      evenement.id,
      plan.declenchee ? "declenchee" : "conditions_non_remplies",
      definition.mode_execution,
      r.executantId,
      mission.id,
      r.tExecution,
    ],
  );
  const executionId = x.rows[0]?.id;
  if (!executionId) return false;
  for (const p of plan.actions) {
    const meta = REGISTRE_ACTIONS_AUTOMATISATION[p.action.type];
    const decision = garderActionAutomatisation(metaAction(p.action, null), {
      coupeCircuitCabinet: false,
      coupeCircuitAutomatisation: false,
      coupeCircuitN4: false,
      droitsSuffisants: meta.permission === null || aPermission([r.executantRole], meta.permission),
      missionVisible: true,
      niveauAgentEffectif: null,
    });
    const tAction = plusSecondes(r.tExecution, 2 + p.indice);
    const a = await c.query<{ id: string }>(
      `INSERT INTO automatisation_actions (cabinet_id, execution_id, indice, type, parametres,
         classe_risque, vers_client, annulable, cle, autorisee, refus, cree_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (cabinet_id, cle) DO NOTHING RETURNING id`,
      [
        ctx.cabinetId,
        executionId,
        p.indice,
        p.action.type,
        JSON.stringify(p.action),
        classeAction(p.action, null),
        meta.vers_client,
        meta.annulable,
        p.cle,
        decision.autorisee,
        [...decision.refus],
        tAction,
      ],
    );
    const actionId = a.rows[0]?.id;
    if (!actionId) continue;
    const res = await executer(r, p.action, actionId, decision.autorisee, decision.refus, tAction);
    await c.query(
      `INSERT INTO automatisation_action_resultats (cabinet_id, action_id, statut, code, message,
         entite_type, entite_id, details, cree_le) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ctx.cabinetId,
        actionId,
        res.statut,
        res.code ?? null,
        res.message ?? null,
        res.entite?.type ?? null,
        res.entite?.id ?? null,
        JSON.stringify(res.details ?? {}),
        plusSecondes(tAction, 1),
      ],
    );
  }
  return true;
}

/** Rejoue tout l'historique ; renvoie le nombre d'exécutions créées par cet appel. */
export async function rejouerHistorique(
  ctx: ContexteTenantDemo,
  regles: RegleBd[],
  evenements: EvenementBd[],
  missions: Map<string, InfoMission>,
): Promise<number> {
  let crees = 0;
  for (const evenement of evenements) {
    const mission = missions.get(evenement.missionId);
    if (!mission) continue;
    const payload = normaliserPayloadEvenement(evenement.payload, champsMoteur(evenement.code));
    for (const regle of regles) {
      if (regle.definitions.values().next().value?.evenement_code !== evenement.code) continue;
      const periode = regle.spec.periodes.find(
        (p) =>
          debutPeriode(p) <= evenement.creeLe &&
          (finPeriode(p) === null || evenement.creeLe < finPeriode(p)!),
      );
      if (!periode) continue;
      const executantId = ctx.utilisateurs[periode.responsable];
      const role = ctx.comptes[periode.responsable]?.role as Role | undefined;
      if (!executantId || !role) throw new Error(`Compte « ${periode.responsable} » indisponible.`);
      await ctx.proprietaire.query("BEGIN");
      try {
        const cree = await rejouerUne({
          ctx,
          regle,
          executantId,
          executantRole: role,
          evenement,
          payload,
          mission,
          tExecution: plusSecondes(evenement.creeLe, 90),
        });
        await ctx.proprietaire.query("COMMIT");
        if (cree) crees += 1;
      } catch (e) {
        await ctx.proprietaire.query("ROLLBACK");
        throw e;
      }
    }
  }
  return crees;
}
