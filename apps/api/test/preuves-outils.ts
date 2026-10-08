/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Outils des tests du registre des preuves (lot PRV) : deux cabinets, une mission par cabinet,
 * deux missions dans A, des utilisateurs internes aux droits variés.
 */

export const INCONNU = "00000000-0000-4000-8000-000000000000";

export interface ScenarioPreuves {
  a: CabinetMissions;
  b: CabinetMissions;
  missionId: string;
  /** Seconde mission du cabinet A (autre client potentiel : même client, autre mission). */
  mission2Id: string;
  missionB: string;
  consultantEquipe: ApiUtilisateur;
  consultantHors: ApiUtilisateur;
  expertMetier: ApiUtilisateur;
  gestionnaire: ApiUtilisateur;
  expertExterne: ApiUtilisateur;
}

export async function preparerPreuves(ctx: Contexte, nom = "Preuves"): Promise<ScenarioPreuves> {
  const a = await preparerCabinet(ctx, `${nom} A`);
  const b = await preparerCabinet(ctx, `${nom} B`);
  const missionId = (await creerMission(a, { intitule: "Diagnostic stratégique" })).id;
  const mission2Id = (await creerMission(a, { intitule: "Seconde mission" })).id;
  const missionB = (await creerMission(b, { intitule: "Mission du cabinet B" })).id;
  const consultantEquipe = await a.avecRoles(["consultant"]);
  for (const m of [missionId, mission2Id]) {
    attendre(
      201,
      await a.chef.post(`/api/missions/${m}/equipe`, {
        utilisateur_id: consultantEquipe.utilisateurId,
      }),
      "équipe",
    );
  }
  const expertMetier = await a.avecRoles(["expert_metier"]);
  attendre(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: expertMetier.utilisateurId,
    }),
    "équipe expert",
  );
  return {
    a,
    b,
    missionId,
    mission2Id,
    missionB,
    consultantEquipe,
    consultantHors: await a.avecRoles(["consultant"]),
    expertMetier,
    gestionnaire: await a.avecRoles(["gestionnaire"]),
    expertExterne: await a.avecRoles(["expert_externe"]),
  };
}

export const PREUVE_ENTRETIEN = {
  type_source: "entretien",
  source_precise: "Entretien avec la direction financière, 12 octobre",
  date_preuve: "2026-10-12",
  fiabilite: "B",
  extrait: "Le suivi de trésorerie se fait encore sur un classeur Excel.",
} as const;

export const PREUVE_DOCUMENT = {
  type_source: "document",
  source_precise: "Rapport annuel 2025, page 14",
  date_preuve: "2026-09-30",
  fiabilite: "A",
  extrait: "Trésorerie nette de clôture : voir note 7.",
} as const;

export async function creerPreuve(
  par: Api,
  missionId: string,
  corps: Record<string, unknown> = {},
): Promise<Record<string, any> & { id: string }> {
  const r = await par.post(`/api/missions/${missionId}/preuves`, { ...PREUVE_ENTRETIEN, ...corps });
  attendre(201, r, "preuve");
  return r.json();
}

export const ASSERTION_R2 = {
  enonce: "La gestion de trésorerie est insuffisamment outillée.",
  classe_risque: "R2",
  livrable: "Rapport de diagnostic",
} as const;

export async function creerAssertion(
  par: Api,
  missionId: string,
  corps: Record<string, unknown> = {},
): Promise<Record<string, any> & { id: string }> {
  const r = await par.post(`/api/missions/${missionId}/assertions`, { ...ASSERTION_R2, ...corps });
  attendre(201, r, "assertion");
  return r.json();
}

export async function lier(
  par: Api,
  assertionId: string,
  preuveId: string,
  sens: "pour" | "contre",
) {
  const r = await par.post(`/api/assertions/${assertionId}/liens`, { preuve_id: preuveId, sens });
  attendre(201, r, "lien");
  return r.json();
}
