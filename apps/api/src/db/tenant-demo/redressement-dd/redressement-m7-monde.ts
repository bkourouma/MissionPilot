import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS, trouverMission, type MissionTrouvee } from "./commun.js";
import {
  deviseDeMission,
  dossierDeMission,
  echelleDevise,
  type Echelle,
} from "./redressement-outils.js";

/*
 * Contexte de travail de la mission 7 « Redressement — Gabon Offshore Services », partagé par les
 * étapes de redressement-m7.ts (ouverture, diagnostic, trésorerie, créanciers, conformité) et de
 * redressement-m7-plan.ts (plan d'actions, causes racines). La devise n'est jamais écrite en dur :
 * elle est lue sur la mission (USD pour ce client) et les données, écrites en millions de XOF,
 * passent par l'échelle de cette devise (1 million de XOF = 5 000 USD).
 */

export interface MondeM7 {
  mission: MissionTrouvee;
  dossierId: string;
  devise: string;
  echelle: Echelle;
}

export async function monde7(ctx: ContexteTenantDemo, avecDossier = true): Promise<MondeM7> {
  const mission = await trouverMission(ctx, MISSIONS.redressementEnCours);
  const dossierId = avecDossier ? ((await dossierDeMission(ctx, mission.id)) ?? "") : "";
  const devise = await deviseDeMission(ctx, mission.id);
  return { mission, dossierId, devise, echelle: echelleDevise(devise) };
}
