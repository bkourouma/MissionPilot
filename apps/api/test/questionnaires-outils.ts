import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import { api, type Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Scénario commun des tests de questionnaires et de notation : deux cabinets,
 * dans A deux clients, une mission du client A1 (équipe : consultant et
 * expert métier), des utilisateurs du portail (dirigeant, contributeur et
 * investisseur de A1, dirigeant de A2, dirigeant de B).
 */

export interface ScenarioQuestionnaires {
  ctx: Contexte;
  a: CabinetMissions;
  b: CabinetMissions;
  missionId: string;
  missionB: string;
  clientA2: string;
  consultant: ApiUtilisateur;
  expert: ApiUtilisateur;
  expert2: ApiUtilisateur;
  /** Consultant du cabinet A hors de l'équipe de la mission. */
  horsEquipe: ApiUtilisateur;
  gestionnaire: ApiUtilisateur;
  dirigeant: UtilisateurPortail;
  contributeur: UtilisateurPortail;
  investisseur: UtilisateurPortail;
  dirigeantA2: UtilisateurPortail;
  dirigeantB: UtilisateurPortail;
  anonyme: Api;
}

export async function ajouterEquipe(c: CabinetMissions, missionId: string, utilisateurId: string) {
  attendre(
    201,
    await c.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: utilisateurId }),
    "équipe",
  );
}

export async function preparerQuestionnaires(ctx: Contexte): Promise<ScenarioQuestionnaires> {
  const a = await preparerCabinet(ctx, "Questionnaires A");
  const b = await preparerCabinet(ctx, "Questionnaires B");
  const missionId = (await creerMission(a, { intitule: "Notation de compétitivité" })).id;
  const missionB = (await creerMission(b)).id;
  const c2 = await a.associe.post("/api/clients", { raison_sociale: "Client A2 (fictif)" });
  attendre(201, c2, "client A2");
  const consultant = await a.avecRoles(["consultant"]);
  const expert = await a.avecRoles(["expert_metier"]);
  const expert2 = await a.avecRoles(["expert_metier"]);
  for (const u of [consultant, expert, expert2]) await ajouterEquipe(a, missionId, u.utilisateurId);
  return {
    ctx,
    a,
    b,
    missionId,
    missionB,
    clientA2: c2.json().id as string,
    consultant,
    expert,
    expert2,
    horsEquipe: await a.avecRoles(["consultant"]),
    gestionnaire: await a.avecRoles(["gestionnaire"]),
    dirigeant: await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]),
    contributeur: await inviterClient(ctx, a.chef, a.clientId, ["client_contributeur"]),
    investisseur: await inviterClient(ctx, a.associe, a.clientId, ["client_investisseur"]),
    dirigeantA2: await inviterClient(ctx, a.associe, c2.json().id as string, ["client_dirigeant"]),
    dirigeantB: await inviterClient(ctx, b.associe, b.clientId, ["client_dirigeant"]),
    anonyme: api(ctx),
  };
}

/** Modèle copié d'un gabarit générique, version 1 validée ; renvoie l'identifiant de la version. */
export async function versionValidee(
  par: Api,
  code: string,
  gabarit: "notation_generique" | "preliminaire_dirigeants" = "notation_generique",
): Promise<{ modeleId: string; versionId: string; definition: DefinitionQuestionnaire }> {
  const m = await par.post("/api/questionnaires/modeles", {
    code,
    source: { type: "gabarit", gabarit },
  });
  attendre(201, m, "modèle");
  const versionId = m.json().versions[0].id as string;
  const v = await par.post(`/api/questionnaires/versions/${versionId}/valider`);
  attendre(200, v, "validation");
  return { modeleId: m.json().id, versionId, definition: v.json().definition };
}

/**
 * Réponses valides à TOUTES les questions d'une définition, au « niveau »
 * donné (1 à 5) : Likert au niveau, choix selon le niveau, oui si niveau ≥ 3.
 * Les réponses aux questions que la logique conditionnelle masque sont
 * écartées par le moteur à l'enregistrement.
 */
export function reponsesAuNiveau(def: DefinitionQuestionnaire, niveau: number) {
  const reponses: Record<string, unknown> = {};
  for (const q of def.sections.flatMap((s) => s.questions)) {
    switch (q.type) {
      case "likert":
        reponses[q.id] = Math.min(niveau, q.points);
        break;
      case "choix_unique":
        reponses[q.id] = q.options[Math.min(niveau, q.options.length) - 1]?.code;
        break;
      case "choix_multiple":
        reponses[q.id] = q.options.slice(0, Math.max(q.minSelections ?? 1, 1)).map((o) => o.code);
        break;
      case "oui_non":
        reponses[q.id] = niveau >= 3;
        break;
      case "numerique": {
        const min = q.min ?? 0;
        const max = q.max ?? min + 100;
        reponses[q.id] = min + Math.floor(((max - min) * (niveau - 1)) / 4);
        break;
      }
      case "texte":
        reponses[q.id] = `Réponse de niveau ${niveau}`;
        break;
      case "date":
        reponses[q.id] = q.min ?? "2026-01-15";
        break;
    }
  }
  return reponses;
}

/** Crée et envoie un questionnaire ; renvoie l'identifiant de l'envoi. */
export async function envoyer(
  par: Api,
  missionId: string,
  versionId: string,
  repondants: { utilisateur_id: string; fonction?: string }[],
  mode: "individuel" | "collectif" | "par_fonction" = "individuel",
  options: Record<string, unknown> = {},
): Promise<string> {
  const e = await par.post(`/api/missions/${missionId}/questionnaires`, {
    version_id: versionId,
    mode,
    repondants,
    ...options,
  });
  attendre(201, e, "création de l'envoi");
  attendre(200, await par.post(`/api/questionnaires/envois/${e.json().id}/envoyer`), "envoi");
  return e.json().id as string;
}

/** Saisit puis soumet toutes les réponses d'un répondant du portail. */
export async function repondre(
  u: Api,
  envoiId: string,
  reponses: Record<string, unknown>,
): Promise<void> {
  attendre(
    200,
    await u.patch(`/api/portail/questionnaires/${envoiId}/reponses`, { reponses }),
    "saisie",
  );
  attendre(200, await u.post(`/api/portail/questionnaires/${envoiId}/soumettre`), "soumission");
}
