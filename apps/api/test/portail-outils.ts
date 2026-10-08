import type { MailerJournal } from "../src/notifications/mailer.js";
import { api, type Api } from "./api.js";
import {
  factureEmise,
  preparerFacturation,
  viderEmailsEnFile,
  type CabinetFacturation,
} from "./facturation-outils.js";
import { ECHANTILLONS, televerser } from "./fichiers-outils.js";
import { MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, type ApiUtilisateur } from "./missions-outils.js";

export function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

let compteur = 0;

export type UtilisateurPortail = ApiUtilisateur & { email: string; cookie: string };

/** Jeton de la dernière invitation envoyée à `email` (transport « journal » des tests). */
export function jetonInvitation(ctx: Contexte, email: string): string {
  const m = (ctx.app.mailer as MailerJournal).dernierPour(email);
  const jeton = m?.texte.match(/#jeton=([\w-]+)/)?.[1];
  if (!jeton) throw new Error(`Pas d'invitation pour ${email}`);
  return jeton;
}

/**
 * Chaque invitation au portail met en file l'alerte e-mail des associés : la
 * retirer pour ne pas laisser de job « envoyer_email » aux fichiers suivants
 * (base de test partagée, voir jobs.test.ts et isolation.test.ts).
 */
export async function viderAlertesInvitation(clientId: string): Promise<void> {
  const cabinetId = await proprietaire(
    async (c) =>
      (await c.query("SELECT cabinet_id FROM clients WHERE id = $1", [clientId])).rows[0]
        ?.cabinet_id as string | undefined,
  );
  if (cabinetId) await viderEmailsEnFile(cabinetId);
}

/** Invitation du portail par `par`, acceptation, session ouverte. */
export async function inviterClient(
  ctx: Contexte,
  par: Api,
  clientId: string,
  roles: string[],
): Promise<UtilisateurPortail> {
  compteur += 1;
  const email = `portail${compteur}-${Date.now()}@client.test`;
  attendre(
    201,
    await par.post("/api/portail/invitations", { email, client_id: clientId, roles }),
    "invitation portail",
  );
  await viderAlertesInvitation(clientId);
  const r = await api(ctx).post("/api/portail/invitations/accepter", {
    jeton: jetonInvitation(ctx, email),
    nom: `Personne cliente ${compteur}`,
    mot_de_passe: MOT_DE_PASSE_TEST,
  });
  attendre(201, r, "acceptation portail");
  const c = r.cookies[0];
  if (!c) throw new Error("Pas de cookie de session");
  const cookie = `${c.name}=${c.value}`;
  return { ...api(ctx, cookie), utilisateurId: r.json().utilisateur.id, email, cookie };
}

export interface ScenarioPortail {
  a: CabinetFacturation;
  b: CabinetFacturation;
  clientA2: string;
  /** Mission du client A1, partagée (jalons et factures), avec une facture émise. */
  missionId: string;
  factureId: string;
  jalonAtteint: string;
  jalonNonAtteint: string;
  /** Livrable partagé (avec fichier) et livrable NON partagé de la même mission. */
  documentId: string;
  documentNonPartage: string;
  documentBrouillonIa: string;
  contenuLivrable: Buffer;
  /** Mission du client A1 non partagée. */
  missionNonPartagee: string;
  /** Mission du client A2, partagée avec A2. */
  missionA2: string;
  dirigeant: UtilisateurPortail;
  contributeur: UtilisateurPortail;
  investisseur: UtilisateurPortail;
  dirigeantA2: UtilisateurPortail;
  dirigeantB: UtilisateurPortail;
}

async function deposer(a: CabinetFacturation, missionId: string, nom: string, contenu: Buffer) {
  const f = await televerser(a.chef, "/api/fichiers", `${nom}.pdf`, contenu);
  attendre(201, f, "téléversement");
  const d = await a.chef.post(`/api/missions/${missionId}/documents`, {
    type: "livrable",
    nom,
    fichier_id: f.json().id,
  });
  attendre(201, d, "dépôt");
  return d.json().id as string;
}

/** Deux cabinets, deux clients dans A, partages explicites, utilisateurs du portail. */
export async function preparerPortail(ctx: Contexte): Promise<ScenarioPortail> {
  const a = await preparerFacturation(ctx, "Portail A");
  const b = await preparerFacturation(ctx, "Portail B");
  const c2 = await a.associe.post("/api/clients", { raison_sociale: "Client A2 (fictif)" });
  attendre(201, c2, "client A2");
  const clientA2 = c2.json().id as string;

  const f = await factureEmise(a);
  const missionId = f.missionId;
  const jalon = async (libelle: string, atteint: boolean) => {
    const j = await a.chef.post(`/api/missions/${missionId}/jalons`, {
      libelle,
      date_prevue: "2026-11-20",
    });
    attendre(201, j, "jalon");
    if (atteint) {
      attendre(
        200,
        await a.chef.patch(`/api/missions/${missionId}/jalons/${j.json().id}`, { atteint: true }),
        "jalon atteint",
      );
    }
    return j.json().id as string;
  };
  const jalonAtteint = await jalon("Copil de lancement", true);
  const jalonNonAtteint = await jalon("Restitution finale", false);
  const contenuLivrable = ECHANTILLONS.pdf("diagnostic partage");
  const documentId = await deposer(a, missionId, "Rapport de diagnostic", contenuLivrable);
  const documentNonPartage = await deposer(
    a,
    missionId,
    "Note interne",
    ECHANTILLONS.pdf("note interne"),
  );
  const brouillon = await a.chef.post(`/api/missions/${missionId}/documents`, {
    type: "livrable",
    nom: "Synthèse générée",
    statut_contenu: "brouillon_ia",
  });
  attendre(201, brouillon, "brouillon IA");

  const missionNonPartagee = (await creerMission(a, { intitule: "Mission confidentielle" })).id;
  const missionA2 = (await creerMission(a, { intitule: "Mission A2", client_id: clientA2 })).id;

  attendre(
    200,
    await a.associe.put(`/api/portail/partages?client_id=${a.clientId}`, {
      missions: [{ mission_id: missionId, jalons: true, factures: true }],
      documents: [documentId],
      contact_principal_id: a.chef.utilisateurId,
    }),
    "partages A1",
  );
  attendre(
    200,
    await a.associe.put(`/api/portail/partages?client_id=${clientA2}`, {
      missions: [{ mission_id: missionA2 }],
      documents: [],
    }),
    "partages A2",
  );

  return {
    a,
    b,
    clientA2,
    missionId,
    factureId: f.facture.id as string,
    jalonAtteint,
    jalonNonAtteint,
    documentId,
    documentNonPartage,
    documentBrouillonIa: brouillon.json().id as string,
    contenuLivrable,
    missionNonPartagee,
    missionA2,
    dirigeant: await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]),
    contributeur: await inviterClient(ctx, a.chef, a.clientId, ["client_contributeur"]),
    investisseur: await inviterClient(ctx, a.associe, a.clientId, ["client_investisseur"]),
    dirigeantA2: await inviterClient(ctx, a.associe, clientA2, ["client_dirigeant"]),
    dirigeantB: await inviterClient(ctx, b.associe, b.clientId, ["client_dirigeant"]),
  };
}

/**
 * Clés interdites dans TOUTE réponse du portail : coûts, taux, marges, prix
 * unitaires, budget interne, grades, équipe et responsables internes.
 */
export const CLE_INTERDITE =
  /cout|coût|taux|marge|prix|tarif|rentab|budget|grade|salaire|equipe|collaborateur|directeur|chef|auteur|cree_par|emise_par|approuvee_par|soumise_par|modifie_par|mentions|hash|jeton|cle_stockage|iban|journal/i;

/** Liste des clés (récursive) d'une valeur JSON. */
export function clesDe(valeur: unknown, acc: string[] = []): string[] {
  if (Array.isArray(valeur)) for (const v of valeur) clesDe(v, acc);
  else if (valeur && typeof valeur === "object") {
    for (const [k, v] of Object.entries(valeur)) {
      acc.push(k);
      clesDe(v, acc);
    }
  }
  return acc;
}
