import {
  normaliserPayloadEvenement,
  simulerAutomatisation,
  type ConditionAutomatisation,
  type ContexteGarde,
  type EvenementSimule,
  type NiveauAutonomie,
} from "@missionpilot/engines";
import {
  aPermission,
  REGISTRE_ACTIONS_AUTOMATISATION,
  type ActionAutomatisationApi,
  type ClasseRisque,
  type DefinitionAutomatisationApi,
} from "@missionpilot/shared";
import { lireCoupeCircuit } from "../agents/autonomie.js";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { lireCoupeCircuitAutomatisation } from "./coupe-circuits.js";
import { champsMoteur, metaAction } from "./definitions.js";
import { tropDeSimulations } from "./erreurs.js";
import { executantDe, voitMission } from "./executant.js";
import { etatAgent } from "./execution.js";

/*
 * SIMULATION SUR LES ÉVÉNEMENTS PASSÉS (AUT-04) : la définition (brouillon ou automatisation
 * existante) est rejouée par le moteur sur les événements DÉJÀ PUBLIÉS de son code, avec la
 * MÊME garde qu'à l'exécution (coupe-circuits actuels, droits et visibilité de l'exécutant,
 * niveau des agents), sans AUCUN effet. Seuls les événements sans mission ou d'une mission que
 * l'utilisateur voit sont rejoués ; les plus récents d'abord retenus (`limite`), présentés dans
 * l'ordre chronologique.
 *
 * Coût : jusqu'à `limite` événements (500) sont rejoués ; l'exécutant et la visibilité de la
 * mission sont mémoïsés (une requête par clé, pas par événement) et chaque utilisateur est
 * plafonné à SIMULATIONS_PAR_FENETRE simulations par FENETRE_SIMULATION_MINUTES minutes
 * (429 TROP_DE_SIMULATIONS), le débit se comptant sur le journal d'audit comme les PDF de
 * factures (routes/factures-pdf.ts).
 */

/** Simulations admises par utilisateur sur la fenêtre glissante (à valider). */
export const SIMULATIONS_PAR_FENETRE = 30;
export const FENETRE_SIMULATION_MINUTES = 10;
const ACTION_SIMULATION = "simulation_automatisation";

/** 429 si l'utilisateur a déjà lancé SIMULATIONS_PAR_FENETRE simulations sur la fenêtre. */
async function verifierDebitSimulation(db: Db, auth: Auth): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, ACTION_SIMULATION, FENETRE_SIMULATION_MINUTES],
  );
  if ((r.rows[0].n as number) >= SIMULATIONS_PAR_FENETRE) {
    throw tropDeSimulations(SIMULATIONS_PAR_FENETRE, FENETRE_SIMULATION_MINUTES);
  }
}

interface EvenementLu {
  id: string;
  payload: Record<string, unknown>;
  cree_le: Date;
  mission_id: string | null;
  acteur_id: string | null;
}

export interface OptionsSimulationApi {
  depuis?: string | undefined;
  limite: number;
  automatisationId?: string | null;
  responsableId?: string | null;
}

export async function simulerSurLePasse(
  db: Db,
  auth: Auth,
  definition: DefinitionAutomatisationApi,
  o: OptionsSimulationApi,
) {
  await verifierDebitSimulation(db, auth);
  const r = await db.query(
    `SELECT e.id, e.payload, e.cree_le, e.mission_id, e.acteur_id
     FROM automatisation_evenements e LEFT JOIN missions m ON m.id = e.mission_id
     WHERE e.code = $1 AND ($2::date IS NULL OR e.cree_le >= $2::date)
       AND (e.mission_id IS NULL OR ${filtreVisibilite(3, 4)})
     ORDER BY e.cree_le DESC, e.id DESC LIMIT $5`,
    [
      definition.evenement_code,
      o.depuis ?? null,
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      o.limite,
    ],
  );
  const lus = (r.rows as EvenementLu[]).reverse();
  const champs = champsMoteur(definition.evenement_code);
  const evenements: (EvenementSimule & { lu: EvenementLu })[] = lus.map((e) => ({
    id: e.id,
    cree_le: e.cree_le.toISOString(),
    payload: normaliserPayloadEvenement(e.payload, champs),
    lu: e,
  }));
  const coupeCabinet = (await lireCoupeCircuitAutomatisation(db, null)).actif;
  const coupeAutomatisation = o.automatisationId
    ? (await lireCoupeCircuitAutomatisation(db, o.automatisationId)).actif
    : false;
  const coupeN4 = (await lireCoupeCircuit(db)).actif;
  const agents = new Map<number, { niveau: NiveauAutonomie | null; classe: ClasseRisque | null }>();
  for (const [i, a] of definition.actions.entries()) {
    if (a.type === "appeler_agent") agents.set(i, await etatAgent(db, a));
  }
  // Exécutant et visibilité de chaque événement, calculés d'avance (le moteur reste pur).
  const contexte = new Map<string, { executant: Auth | null; missionVisible: boolean }>();
  // Mémoïsation : en mode « responsable » l'exécutant est le même pour tous les événements ;
  // en mode « déclencheur » il y en a au plus un par acteur ; la visibilité dépend du couple
  // (exécutant, mission). Sans cela : deux requêtes par événement, jusqu'à 500 événements.
  const executants = new Map<string, Promise<Auth | null>>();
  const visibilites = new Map<string, Promise<boolean>>();
  const executantPour = (acteurId: string | null) => {
    const cle = definition.mode_execution === "responsable" ? "" : (acteurId ?? "");
    let p = executants.get(cle);
    if (!p) {
      p = executantDe(
        db,
        auth.cabinetId,
        definition.mode_execution,
        o.responsableId ?? auth.utilisateurId,
        acteurId,
      );
      executants.set(cle, p);
    }
    return p;
  };
  const visiblePour = (executant: Auth, missionId: string) => {
    const cle = `${executant.utilisateurId}:${missionId}`;
    let p = visibilites.get(cle);
    if (!p) {
      p = voitMission(db, executant, missionId);
      visibilites.set(cle, p);
    }
    return p;
  };
  for (const e of lus) {
    const executant = await executantPour(e.acteur_id);
    const missionVisible =
      e.mission_id === null || (executant !== null && (await visiblePour(executant, e.mission_id)));
    contexte.set(e.id, { executant, missionVisible });
  }
  const indexDe = new Map(definition.actions.map((a, i) => [a, i]));
  const resultat = simulerAutomatisation(
    {
      condition: definition.condition as ConditionAutomatisation | null,
      actions: definition.actions,
    },
    evenements,
    {
      metaDe: (a: ActionAutomatisationApi) =>
        metaAction(a, agents.get(indexDe.get(a) ?? -1)?.classe ?? null),
      contexteDe: (e, a): ContexteGarde => {
        const c = contexte.get(e.id);
        const permission = REGISTRE_ACTIONS_AUTOMATISATION[a.type].permission;
        return {
          coupeCircuitCabinet: coupeCabinet,
          coupeCircuitAutomatisation: coupeAutomatisation,
          coupeCircuitN4: coupeN4,
          droitsSuffisants:
            !!c?.executant && (permission === null || aPermission(c.executant.roles, permission)),
          missionVisible: c?.missionVisible ?? false,
          niveauAgentEffectif: agents.get(indexDe.get(a) ?? -1)?.niveau ?? null,
        };
      },
    },
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: ACTION_SIMULATION,
    entite: "automatisation",
    entiteId: o.automatisationId ?? null,
    details: { evenement: definition.evenement_code, evenements: lus.length },
  });
  return { ...resultat, tronque: lus.length === o.limite };
}
