import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  briqueAgentCreationSchema,
  contributionsIaQuerySchema,
  coupeCircuitAgentsSchema,
  decisionAutonomieSchema,
  decisionExecutionAgentSchema,
  evaluationAgentCreationSchema,
  evaluationOpenRouterCreationSchema,
  evaluationsAgentsQuerySchema,
  evaluationsOpenRouterQuerySchema,
  executionsAgentsQuerySchema,
  incidentAutonomieSchema,
  jeuEssaiCreationSchema,
  jeuxEssaiAgentsQuerySchema,
  paramsAgentSchema,
  paramsBriqueAgentSchema,
  paramsPromptEvaluationSchema,
  plafondIaMissionSchema,
  restrictionAgentSchema,
} from "@missionpilot/shared";
import { z } from "zod";
import {
  changerCoupeCircuit,
  declarerBrique,
  deciderAutonomie,
  eligibilite,
  etatAutonomie,
  historiqueBrique,
  lireBrique,
  lireCoupeCircuit,
  listerBriques,
  signalerIncident,
  type BriqueDb,
  type CoupeCircuit,
} from "../agents/autonomie.js";
import { lireContributions } from "../agents/contributions.js";
import { avecErreursAgents } from "../agents/erreurs.js";
import {
  demanderEvaluationOpenRouter,
  listerDemandesEvaluation,
  lireDemandeEvaluation,
} from "../agents/evaluations-openrouter.js";
import {
  creerJeuEssai,
  evaluerPrompt,
  listerEvaluations,
  listerJeux,
} from "../agents/evaluations.js";
import {
  deciderExecution,
  exigerExecutionVisible,
  lireExecution,
  listerExecutions,
} from "../agents/executions.js";
import { definirPlafondMission, etatPlafondMission } from "../agents/plafonds.js";
import {
  lireAgent,
  lireAgents,
  modelesRoutes,
  niveauMin,
  restreindreAgent,
  type AgentCabinet,
} from "../agents/registre.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { interdit } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";

/**
 * Agents IA (AGT-01 à AGT-07, AGT-09, AGT-10 ; PRD complémentaire §7, ADR-005) : registre,
 * autonomie par brique et par cabinet, coupe-circuit N4, exécutions tracées et décision
 * humaine, contribution de l'IA, jeux d'essai et évaluations de non-régression, plafond de
 * coût par mission.
 *
 * Permissions : `agent.lire` (lecture, incident mineur), `agent.gerer` (briques, restrictions,
 * jeux d'essai, évaluations locales et rejeu réel sur OpenRouter, coupe-circuit activé,
 * incident majeur), `autonomie.decider`
 * (associé : niveau accordé, coupe-circuit levé, brique R0, levée d'une restriction d'associé,
 * jeu d'essai affaibli), `ia.utiliser` (décision sur une exécution, par son déclencheur, le
 * chef ou le directeur de la mission, ou un associé), `ia.configurer` (plafond de mission). Aucune route n'est ouverte au portail client (`LISTE_BLANCHE_PORTAIL`). Le coût
 * d'une exécution et la consommation d'une mission n'apparaissent qu'avec `finance.lire`.
 */

const vueAgent = (a: AgentCabinet) => ({ ...a });

function vueBrique(b: BriqueDb, agent: AgentCabinet | undefined, coupe: CoupeCircuit) {
  return {
    id: b.id,
    code: b.brique_code,
    agent: agent ? { code: agent.code, nom: agent.nom, niveau_max: agent.niveau_max } : null,
    classe_risque: b.classe_risque,
    niveau_max: b.niveau_max,
    niveau_accorde: b.niveau_accorde,
    depuis: b.depuis,
    cree_le: b.cree_le,
    autonomie: agent ? etatAutonomie(b, agent, coupe) : null,
  };
}

const paramsMission = z.object({ id: z.string().uuid() }).strict();

export const routesAgents: FastifyPluginAsync = async (app) => {
  const tx = <T>(cabinetId: string, fn: (db: Db) => Promise<T>) =>
    avecErreursAgents(() => app.db.withTenant(cabinetId, fn));

  /* ----- Registre (AGT-01) ----- */

  app.get("/agents", async (request) => {
    const auth = exiger(request, "agent.lire");
    return tx(auth.cabinetId, async (db) => ({ elements: (await lireAgents(db)).map(vueAgent) }));
  });

  /* ----- Coupe-circuit N4 ----- */

  app.get("/agents/coupe-circuit", async (request) => {
    const auth = exiger(request, "agent.lire");
    return tx(auth.cabinetId, (db) => lireCoupeCircuit(db));
  });

  app.put("/agents/coupe-circuit", async (request) => {
    // Activer : agent.gerer ou autonomie.decider ; lever : autonomie.decider (vérifié par le service).
    const auth = exiger(request);
    if (!aPermission(auth.roles, "agent.gerer") && !aPermission(auth.roles, "autonomie.decider")) {
      exiger(request, "autonomie.decider");
    }
    const c = coupeCircuitAgentsSchema.parse(request.body);
    return tx(auth.cabinetId, (db) => changerCoupeCircuit(db, auth, c));
  });

  /* ----- Briques et autonomie (AGT-03) ----- */

  app.get("/agents/briques", async (request) => {
    const auth = exiger(request, "agent.lire");
    const q = jeuxEssaiAgentsQuerySchema.parse(request.query);
    return tx(auth.cabinetId, async (db) => {
      // Requêtes successives : une transaction n'exécute qu'une requête à la fois.
      const page = await listerBriques(db, q);
      const agents = await lireAgents(db);
      const coupe = await lireCoupeCircuit(db);
      const parCode = new Map(agents.map((a) => [a.code, a]));
      return {
        coupe_circuit: coupe,
        elements: page.elements.map((b) => vueBrique(b, parCode.get(b.agent_code), coupe)),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.post("/agents/briques", async (request, reply) => {
    const auth = exiger(request, "agent.gerer");
    const b = briqueAgentCreationSchema.parse(request.body);
    const cree = await tx(auth.cabinetId, async (db) => {
      const brique = await declarerBrique(db, auth, b);
      return vueBrique(brique, await lireAgent(db, brique.agent_code), await lireCoupeCircuit(db));
    });
    return reply.status(201).send(cree);
  });

  app.get("/agents/briques/:code", async (request) => {
    const auth = exiger(request, "agent.lire");
    const { code } = paramsBriqueAgentSchema.parse(request.params);
    return tx(auth.cabinetId, async (db) => {
      const brique = await lireBrique(db, code);
      const agent = await lireAgent(db, brique.agent_code);
      const coupe = await lireCoupeCircuit(db);
      const plafond = niveauMin(brique.niveau_max, agent.niveau_max);
      return {
        ...vueBrique(brique, agent, coupe),
        eligibilite: await eligibilite(db, brique, plafond, new Date()),
        historique: await historiqueBrique(db, brique),
      };
    });
  });

  app.post("/agents/briques/:code/decisions", async (request) => {
    const auth = exiger(request, "autonomie.decider");
    const { code } = paramsBriqueAgentSchema.parse(request.params);
    const d = decisionAutonomieSchema.parse(request.body);
    return tx(auth.cabinetId, async (db) => {
      const brique = await deciderAutonomie(db, auth, code, d, new Date());
      return vueBrique(brique, await lireAgent(db, brique.agent_code), await lireCoupeCircuit(db));
    });
  });

  app.post("/agents/briques/:code/incidents", async (request, reply) => {
    // Mineur : agent.lire ; MAJEUR (rétrogradation automatique) : agent.gerer ou
    // autonomie.decider (vérifié par le service).
    const auth = exiger(request, "agent.lire");
    const { code } = paramsBriqueAgentSchema.parse(request.params);
    const i = incidentAutonomieSchema.parse(request.body);
    if (
      i.gravite === "majeur" &&
      !aPermission(auth.roles, "agent.gerer") &&
      !aPermission(auth.roles, "autonomie.decider")
    ) {
      throw interdit();
    }
    const r = await tx(auth.cabinetId, async (db) => {
      // L'exécution citée doit être VISIBLE de l'appelant (même 404 qu'inexistante).
      if (i.execution_id) await exigerExecutionVisible(db, auth, i.execution_id);
      return signalerIncident(db, auth, code, i);
    });
    return reply.status(201).send(r);
  });

  /* ----- Exécutions (AGT-09) ----- */

  app.get("/agents/executions", async (request) => {
    const auth = exiger(request, "agent.lire");
    const q = executionsAgentsQuerySchema.parse(request.query);
    return tx(auth.cabinetId, (db) => listerExecutions(db, auth, q));
  });

  app.get("/agents/executions/:id", async (request) => {
    const auth = exiger(request, "agent.lire");
    const { id } = paramsId.parse(request.params);
    return tx(auth.cabinetId, (db) => lireExecution(db, auth, id));
  });

  app.post("/agents/executions/:id/decision", async (request) => {
    const auth = exiger(request, "ia.utiliser");
    exiger(request, "agent.lire");
    const { id } = paramsId.parse(request.params);
    const d = decisionExecutionAgentSchema.parse(request.body);
    return tx(auth.cabinetId, (db) => deciderExecution(db, auth, id, d));
  });

  /* ----- Contribution (AGT-05) ----- */

  app.get("/agents/contributions", async (request) => {
    const auth = exiger(request, "agent.lire");
    const q = contributionsIaQuerySchema.parse(request.query);
    return tx(auth.cabinetId, (db) => lireContributions(db, auth, q));
  });

  /* ----- Jeux d'essai et évaluations (AGT-04) ----- */

  app.get("/agents/jeux-essai", async (request) => {
    const auth = exiger(request, "agent.lire");
    const q = jeuxEssaiAgentsQuerySchema.parse(request.query);
    return tx(auth.cabinetId, (db) => listerJeux(db, auth, q));
  });

  app.post("/agents/jeux-essai", async (request, reply) => {
    const auth = exiger(request, "agent.gerer");
    const j = jeuEssaiCreationSchema.parse(request.body);
    const cree = await tx(auth.cabinetId, (db) => creerJeuEssai(db, auth, j));
    return reply.status(201).send(cree);
  });

  app.get("/agents/evaluations", async (request) => {
    const auth = exiger(request, "agent.lire");
    const q = evaluationsAgentsQuerySchema.parse(request.query);
    return tx(auth.cabinetId, (db) => listerEvaluations(db, auth, q));
  });

  app.post("/agents/evaluations", async (request, reply) => {
    const auth = exiger(request, "agent.gerer");
    const e = evaluationAgentCreationSchema.parse(request.body);
    const cree = await tx(auth.cabinetId, (db) => evaluerPrompt(db, auth, e));
    return reply.status(201).send(cree);
  });

  /* ----- Rejeu RÉEL sur OpenRouter (AGT-04) : file `jobs`, coût plafonné ----- */

  // Demander un rejeu (une DÉPENSE, plafonnée et limitée par cabinet : un seul en file, quota sur 24 h)
  // exige `agent.gerer`. SÉPARATION DES TÂCHES : l'activation d'un prompt et le choix d'un modèle
  // exigent `ia.configurer` ; qui demande l'évaluation n'est pas, par son seul rôle, qui active.
  app.post("/agents/prompts/:promptId/evaluations/openrouter", async (request, reply) => {
    const auth = exiger(request, "agent.gerer");
    const { promptId } = paramsPromptEvaluationSchema.parse(request.params);
    const e = evaluationOpenRouterCreationSchema.parse(request.body ?? {});
    const demande = await tx(auth.cabinetId, (db) =>
      demanderEvaluationOpenRouter(db, { config: app.config }, auth, {
        prompt_id: promptId,
        modele: e.modele,
      }),
    );
    // 202 : le rejeu s'exécute dans la file (ADR-002) ; l'état se lit par GET.
    return reply.status(202).send(demande);
  });

  app.get("/agents/prompts/:promptId/evaluations/openrouter", async (request) => {
    const auth = exiger(request, "agent.lire");
    const { promptId } = paramsPromptEvaluationSchema.parse(request.params);
    const q = evaluationsOpenRouterQuerySchema.parse(request.query);
    return tx(auth.cabinetId, (db) => listerDemandesEvaluation(db, auth, promptId, q));
  });

  app.get("/agents/evaluations/openrouter/:id", async (request) => {
    const auth = exiger(request, "agent.lire");
    const { id } = paramsId.parse(request.params);
    return tx(auth.cabinetId, (db) => lireDemandeEvaluation(db, auth, id));
  });

  /* ----- Plafond de coût par mission (AGT-06) ----- */

  app.get("/agents/missions/:id/plafond", async (request) => {
    const auth = exiger(request, "ia.configurer");
    const { id } = paramsMission.parse(request.params);
    return tx(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const { consomme_micro_usd, ...etat } = await etatPlafondMission(db, id, new Date());
      // Consommation : donnée de gestion (FIN-02), ABSENTE sans finance.lire.
      return {
        mission_id: id,
        ...etat,
        ...(aPermission(auth.roles, "finance.lire") ? { consomme_micro_usd } : {}),
      };
    });
  });

  app.put("/agents/missions/:id/plafond", async (request) => {
    const auth = exiger(request, "ia.configurer");
    const { id } = paramsMission.parse(request.params);
    const p = plafondIaMissionSchema.parse(request.body);
    return tx(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      await definirPlafondMission(db, auth, id, p.plafond_micro_usd);
      const { consomme_micro_usd, ...etat } = await etatPlafondMission(db, id, new Date());
      return {
        mission_id: id,
        ...etat,
        ...(aPermission(auth.roles, "finance.lire") ? { consomme_micro_usd } : {}),
      };
    });
  });

  /* ----- Un agent (après les chemins fixes) ----- */

  app.get("/agents/:code", async (request) => {
    const auth = exiger(request, "agent.lire");
    const { code } = paramsAgentSchema.parse(request.params);
    return tx(auth.cabinetId, async (db) => {
      const agent = await lireAgent(db, code);
      return { ...vueAgent(agent), modeles: await modelesRoutes(db, agent) };
    });
  });

  app.put("/agents/:code/restriction", async (request) => {
    const auth = exiger(request, "agent.gerer");
    const { code } = paramsAgentSchema.parse(request.params);
    const r = restrictionAgentSchema.parse(request.body);
    return tx(auth.cabinetId, async (db) => vueAgent(await restreindreAgent(db, auth, code, r)));
  });
};
