import type { Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Outils des tests du pilotage par KPI (service #4) : deux cabinets, une
 * mission par cabinet, des utilisateurs internes aux droits variés et, côté
 * portail, un contributeur et un dirigeant du client A, un contributeur d'un
 * second client de A.
 */

export const INCONNU = "00000000-0000-4000-8000-000000000000";

export interface ScenarioKpi {
  a: CabinetMissions;
  b: CabinetMissions;
  missionId: string;
  missionB: string;
  /** Mission d'un second client de A (client A2). */
  missionA2: string;
  clientA2: string;
  consultantEquipe: ApiUtilisateur;
  consultantHors: ApiUtilisateur;
  gestionnaire: ApiUtilisateur;
  expertExterne: ApiUtilisateur;
}

export async function preparerKpi(ctx: Contexte, nom = "KPI"): Promise<ScenarioKpi> {
  const a = await preparerCabinet(ctx, `${nom} A`);
  const b = await preparerCabinet(ctx, `${nom} B`);
  const missionId = (await creerMission(a, { intitule: "Pilotage de la performance" })).id;
  const missionB = (await creerMission(b, { intitule: "Mission du cabinet B" })).id;
  const c2 = await a.associe.post("/api/clients", { raison_sociale: "Client A2 (fictif)" });
  attendre(201, c2, "client A2");
  const clientA2 = c2.json().id as string;
  const missionA2 = (await creerMission(a, { intitule: "Mission A2", client_id: clientA2 })).id;
  const consultantEquipe = await a.avecRoles(["consultant"]);
  attendre(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultantEquipe.utilisateurId,
    }),
    "équipe",
  );
  return {
    a,
    b,
    missionId,
    missionB,
    missionA2,
    clientA2,
    consultantEquipe,
    consultantHors: await a.avecRoles(["consultant"]),
    gestionnaire: await a.avecRoles(["gestionnaire"]),
    expertExterne: await a.avecRoles(["expert_externe"]),
  };
}

/** KPI de chiffre d'affaires mensuel (flux, plus haut = mieux), cible 1000 dès janvier 2026. */
export const KPI_CA = {
  libelle: "Chiffre d'affaires mensuel",
  unite: "kFCFA",
  perspective: "finances",
  sens: "plus_haut_mieux",
  nature: "flux",
  frequence: "mensuelle",
  debut_suivi: "2026-01-01",
  cible: 1000,
} as const;

export async function creerKpi(
  par: Api,
  missionId: string,
  corps: Record<string, unknown> = {},
): Promise<Record<string, unknown> & { id: string }> {
  const r = await par.post(`/api/missions/${missionId}/kpi`, { ...KPI_CA, ...corps });
  attendre(201, r, "KPI");
  return r.json();
}

export async function mesurer(
  par: Api,
  kpiId: string,
  date_mesure: string,
  valeur: number,
): Promise<Record<string, unknown> & { id: string }> {
  const r = await par.post(`/api/kpi/${kpiId}/mesures`, { date_mesure, valeur });
  attendre(201, r, `mesure ${date_mesure}`);
  return r.json();
}

/** Contributeurs du portail : client A (contributeur, dirigeant) et client A2. */
export async function preparerPortailKpi(
  ctx: Contexte,
  s: ScenarioKpi,
): Promise<{
  contributeur: UtilisateurPortail;
  dirigeant: UtilisateurPortail;
  contributeurA2: UtilisateurPortail;
  investisseur: UtilisateurPortail;
}> {
  return {
    contributeur: await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]),
    dirigeant: await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]),
    contributeurA2: await inviterClient(ctx, s.a.associe, s.clientA2, ["client_contributeur"]),
    investisseur: await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_investisseur"]),
  };
}

export interface JeuTableau {
  ca: string;
  delai: string;
  sansCible: string;
}

/**
 * Jeu de référence (date d'arrêté 2026-05-15) :
 * - CA mensuel (flux, plus haut = mieux) : cible 1000 puis 1200 dès avril ;
 *   janvier 400 + 600, février 900, mars 800, avril 700, mai (en cours) 300 ;
 * - délai client (stock, plus bas = mieux, poids 2, alerte haute 60) :
 *   cible 45 ; janvier 50, février 55, mars 62, avril NON mesuré ;
 * - indicateur sans cible (stock) : janvier 5.
 */
export async function preparerJeuTableau(
  s: ScenarioKpi,
  missionId = s.missionId,
): Promise<JeuTableau> {
  const ca = await creerKpi(s.a.chef, missionId, { proprietaire_id: s.a.directeur.utilisateurId });
  attendre(
    201,
    await s.a.chef.post(`/api/kpi/${ca.id}/cibles`, { valeur: 1200, a_partir_de: "2026-04-01" }),
    "cible",
  );
  for (const [date, valeur] of [
    ["2026-01-10", 400],
    ["2026-01-25", 600],
    ["2026-02-28", 900],
    ["2026-03-31", 800],
    ["2026-04-30", 700],
    ["2026-05-10", 300],
  ] as const) {
    await mesurer(s.a.chef, ca.id, date, valeur);
  }
  const delai = await creerKpi(s.a.chef, missionId, {
    libelle: "Délai moyen de paiement client",
    unite: "jours",
    perspective: "clients",
    sens: "plus_bas_mieux",
    nature: "stock",
    ponderation: 2,
    alerte_haut: 60,
    cible: 45,
    proprietaire_id: s.a.chef.utilisateurId,
  });
  for (const [date, valeur] of [
    ["2026-01-31", 50],
    ["2026-02-28", 55],
    ["2026-03-31", 62],
  ] as const) {
    await mesurer(s.a.chef, delai.id, date, valeur);
  }
  const sansCible = await creerKpi(s.a.chef, missionId, {
    libelle: "Nombre d'agences",
    unite: "agences",
    perspective: "processus",
    nature: "stock",
    cible: null,
  });
  await mesurer(s.a.chef, sansCible.id, "2026-01-31", 5);
  return { ca: ca.id, delai: delai.id, sansCible: sansCible.id };
}
