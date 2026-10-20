import { ASSERTIONS_MISSION_MAX } from "@missionpilot/shared";
import type { LectureSolidite } from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { MissionAcces } from "../missions/acces.js";
import { assertionsDeMission, type AssertionCourante } from "../preuves/donnees.js";
import {
  corrigerAssertion,
  creerAssertion,
  type CorpsAssertion,
  type CorpsAssertionCorrigee,
} from "../preuves/ecriture.js";
import type { SoliditeVue } from "../preuves/evaluation.js";
import { chargerEtat, controleDeMission, type EtatRegistre } from "../preuves/synthese.js";

/*
 * Passerelle vers le registre des preuves (SPEC-3b §2.1) : une AFFIRMATION (point d'analyse,
 * justification d'un risque, assertion d'une hypothèse) est une assertion du registre, créée par
 * `creerAssertion` et corrigée par `corrigerAssertion` (aucun INSERT direct dans les tables du
 * registre). La solidité vient du moteur des preuves (`chargerEtat`), jamais recalculée ici.
 */

/**
 * Livrable cible des assertions du lot. Le texte ne contient NI « notation » NI « plan » : les
 * annexes de sources des rapports de notation et de plan (`rapports/sources.ts`) ne citent donc
 * jamais une assertion de due diligence.
 */
export const LIVRABLE_DD = "Note au comité — due diligence";

export interface AffirmationDd {
  enonce: string;
  classe_risque: "R2" | "R3";
  avis_expert: boolean;
  avis_expert_motif: string | null;
  signer_avis: boolean;
}

export type RattachementDd =
  | { type: "dimension"; code: string }
  | { type: "hypothese"; code: string }
  | { type: "risque"; code: string };

/** Crée l'assertion (statut `retenue`, classe R2 ou R3) ; 403 si signer sans habilitation d'expert. */
export async function creerAffirmation(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  a: AffirmationDd,
  rattachement: RattachementDd,
): Promise<string> {
  const corps: CorpsAssertion = {
    enonce: a.enonce,
    rattachement_type: rattachement.type,
    rattachement_code: rattachement.code,
    livrable: LIVRABLE_DD,
    classe_risque: a.classe_risque,
    statut: "retenue",
    avis_expert: a.avis_expert,
    avis_expert_motif: a.avis_expert ? a.avis_expert_motif : null,
    signer_avis: a.avis_expert && a.signer_avis,
  };
  return creerAssertion(db, auth, mission, corps);
}

export interface AssertionAvantCorrection {
  id: string;
  mission_id: string;
  version: number;
  rattachement_type: string | null;
  rattachement_code: string | null;
  classe_risque: string;
}

/** Nouvelle version d'assertion : l'état complet est fourni (corrigerAssertion n'écrit rien d'autre). */
export async function corrigerAffirmation(
  db: Db,
  auth: Auth,
  avant: AssertionAvantCorrection,
  suivant: AffirmationDd & {
    statut: "retenue" | "abandonnee";
    rattachement: RattachementDd;
    motif: string;
  },
): Promise<number> {
  const corps: CorpsAssertionCorrigee = {
    enonce: suivant.enonce,
    rattachement_type: suivant.rattachement.type,
    rattachement_code: suivant.rattachement.code,
    livrable: LIVRABLE_DD,
    classe_risque: suivant.classe_risque,
    statut: suivant.statut,
    avis_expert: suivant.avis_expert,
    avis_expert_motif: suivant.avis_expert ? suivant.avis_expert_motif : null,
    signer_avis: suivant.avis_expert && suivant.signer_avis,
    motif: suivant.motif,
  };
  return corrigerAssertion(db, auth, avant, corps);
}

export interface RegistreDossier {
  assertions: Map<string, AssertionCourante>;
  etat: EtatRegistre;
}

/** Charge les assertions données (état courant, liens, preuves, arbitrages, évaluations du moteur). */
export async function chargerRegistre(
  db: Db,
  missionId: string,
  ids: readonly string[],
): Promise<RegistreDossier> {
  const voulues = new Set(ids);
  const toutes = await assertionsDeMission(db, missionId, ASSERTIONS_MISSION_MAX);
  const lues = toutes.filter((a) => voulues.has(a.id));
  const etat = await chargerEtat(db, missionId, lues);
  return { assertions: new Map(lues.map((a) => [a.id, a])), etat };
}

export function soliditeDe(reg: RegistreDossier, assertionId: string): SoliditeVue | null {
  return reg.etat.evaluations.get(assertionId)?.solidite ?? null;
}

export function lectureDe(reg: RegistreDossier, assertionId: string): LectureSolidite | null {
  return soliditeDe(reg, assertionId)?.lecture ?? null;
}

/** Assertions d'un dossier : celles des points et des risques, et celles liées à ses hypothèses. */
export async function idsAssertionsDuDossier(db: Db, dossierId: string): Promise<string[]> {
  const r = await db.query(
    `SELECT e.assertion_id AS id FROM dd_elements e
     WHERE e.dossier_id = $1 AND e.assertion_id IS NOT NULL
     UNION
     SELECT d.assertion_id AS id FROM (
       SELECT DISTINCT ON (l.hypothese_id, l.assertion_id) l.assertion_id, l.action
       FROM dd_hypothese_liens l WHERE l.dossier_id = $1
       ORDER BY l.hypothese_id, l.assertion_id, l.numero DESC) d
     WHERE d.action = 'lier'`,
    [dossierId],
  );
  return r.rows.map((l) => l.id as string);
}

/** Contrôle PRV-03 (moteur) restreint aux assertions du dossier : R2 et R3 sans preuve ni avis signé. */
export async function anomaliesSourcesDuDossier(
  db: Db,
  missionId: string,
  idsDossier: ReadonlySet<string>,
) {
  const controle = await controleDeMission(db, missionId, LIVRABLE_DD);
  return controle.anomalies.filter((a) => idsDossier.has(a.assertion_id));
}
