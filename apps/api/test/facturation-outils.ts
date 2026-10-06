import type { Api } from "./api.js";
import {
  creerMissionSignee,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import type { Contexte } from "./helpers.js";

export function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

export interface CabinetFacturation extends CabinetMissions {
  gestionnaire: ApiUtilisateur;
}

/** Mentions légales fictives du cabinet (obligatoires pour émettre). */
export const MENTIONS_TEST = {
  raison_sociale: "Cabinet Test Conseil SARL (fictif)",
  forme_juridique: "SARL",
  rccm: "CI-ABJ-TEST-B-0001",
  compte_contribuable: "TEST0001X",
  adresse: "Plateau, Abidjan",
  iban: "CI93 CI00 0000 0000 0000 0000 0000",
};

/** Cabinet prêt à facturer : catalogue, client, collaborateurs, gestionnaire, mentions légales. */
export async function preparerFacturation(
  ctx: Contexte,
  nom: string,
  mentions = true,
): Promise<CabinetFacturation> {
  const c = await preparerCabinet(ctx, nom);
  if (mentions) {
    attendre(200, await c.associe.patch("/api/parametres-facturation", MENTIONS_TEST), "mentions");
  }
  return { ...c, gestionnaire: await c.avecRoles(["gestionnaire"]) };
}

export interface EcheanceTest {
  id: string;
  montant: number;
  statut: string;
  type: string;
  facture_id: string | null;
}

/** Mission signée (forfait) et son échéancier généré (30 % / 70 % par défaut). */
export async function missionAvecEcheancier(
  c: CabinetFacturation,
  generation: Record<string, unknown> = {},
): Promise<{ id: string; budget: number; echeances: EcheanceTest[] }> {
  const m = await creerMissionSignee(c, { mode_facturation: "forfait" });
  attendre(
    201,
    await c.gestionnaire.post(`/api/missions/${m.id}/echeancier/generer`, generation),
    "génération",
  );
  const e = (await c.gestionnaire.get(`/api/missions/${m.id}/echeancier`)).json();
  return { id: m.id, budget: e.budget_signe, echeances: e.echeances };
}

/** Passe une échéance « à facturer ». */
export async function aFacturer(par: Api, echeanceId: string): Promise<void> {
  attendre(
    200,
    await par.patch(`/api/echeances/${echeanceId}`, { statut: "a_facturer" }),
    "à facturer",
  );
}

/** Brouillon → soumis (gestionnaire) → approuvé (associé) → émis (gestionnaire). */
export async function emettreFacture(
  c: CabinetFacturation,
  factureId: string,
): Promise<Record<string, unknown>> {
  attendre(200, await c.gestionnaire.post(`/api/factures/${factureId}/soumettre`), "soumission");
  attendre(200, await c.associe.post(`/api/factures/${factureId}/approuver`), "approbation");
  const r = await c.gestionnaire.post(`/api/factures/${factureId}/emettre`);
  attendre(200, r, "émission");
  return r.json();
}

/** Facture émise sur la première échéance d'une nouvelle mission. */
export async function factureEmise(
  c: CabinetFacturation,
): Promise<{ missionId: string; facture: Record<string, unknown>; echeances: EcheanceTest[] }> {
  const m = await missionAvecEcheancier(c);
  const premiere = m.echeances[0] as EcheanceTest;
  await aFacturer(c.gestionnaire, premiere.id);
  const f = await c.gestionnaire.post(`/api/missions/${m.id}/factures`, {
    echeance_ids: [premiere.id],
  });
  attendre(201, f, "brouillon");
  return { missionId: m.id, facture: await emettreFacture(c, f.json().id), echeances: m.echeances };
}
