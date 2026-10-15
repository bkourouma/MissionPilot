import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MailerJournal } from "../src/notifications/mailer.js";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createDatabase } from "../src/db/pool.js";
import {
  creerHandlerCanalEntrantAudio,
  TYPE_JOB_CANAL_ENTRANT_AUDIO,
} from "../src/canaux/entrants.js";
import { creerHandlerCanalEnvoi, TYPE_JOB_CANAL_ENVOI } from "../src/canaux/envois.js";
import { creerCanaux } from "../src/canaux/fabrique.js";
import {
  creerHandlerCanauxMaintenance,
  TYPE_JOB_CANAUX_MAINTENANCE,
} from "../src/canaux/maintenance.js";
import { CanalWhatsAppSimule, signerWebhook } from "../src/canaux/whatsapp-simule.js";
import { PasserelleSmsSimulee } from "../src/canaux/sms-simule.js";
import type { Canaux } from "../src/canaux/ports.js";
import {
  creerHandlerCanalRelanceQuestionnaire,
  TYPE_JOB_CANAL_RELANCE_QUESTIONNAIRE,
} from "../src/canaux/relance-questionnaire.js";
import {
  creerHandlerCanalSyntheseHebdo,
  TYPE_JOB_CANAL_SYNTHESE_HEBDO,
} from "../src/canaux/synthese.js";
import {
  creerHandlerCanalTranscription,
  TYPE_JOB_CANAL_TRANSCRIPTION,
} from "../src/canaux/transcriptions.js";
import { creerRegistre } from "../src/jobs/registre.js";
import {
  relanceQuestionnaire,
  TYPE_JOB_RELANCE_QUESTIONNAIRE,
} from "../src/questionnaires/relances.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { api, type Api } from "./api.js";
import { configTest, MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Outils des tests du lot canaux simulés : application dont les quatre ports sont SIMULÉS (ni envoi
 * réel, ni réseau), secret de webhook de test, stockage temporaire, exécution des jobs sous horloge
 * injectable, envoi d'événements signés au webhook.
 */

export const SECRET_WEBHOOK = "secret-de-test-webhook-0123456789abcdef";
export const NUMERO = "+2250000000012";
export const NUMERO_SMS = "+2250000000013";

export interface ContexteCanaux extends Contexte {
  canaux: Canaux;
  whatsapp: CanalWhatsAppSimule;
  sms: PasserelleSmsSimulee;
  dossier: string;
}

export async function demarrerCanaux(surcharge: Partial<Config> = {}): Promise<ContexteCanaux> {
  const dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-canaux-"));
  const config: Config = {
    ...configTest(),
    STORAGE_DIR: dossier,
    WHATSAPP_FOURNISSEUR: "simule",
    SMS_FOURNISSEUR: "simule",
    TRANSCRIPTION_FOURNISSEUR: "simule",
    SIGNATURE_FOURNISSEUR: "local",
    WHATSAPP_WEBHOOK_SECRET: SECRET_WEBHOOK,
    ...surcharge,
  };
  const canaux = creerCanaux(config);
  const db = createDatabase(config);
  const app = await buildApp(config, db, { canaux });
  return {
    config,
    db,
    app,
    canaux,
    whatsapp: canaux.whatsapp as CanalWhatsAppSimule,
    sms: canaux.sms as PasserelleSmsSimulee,
    dossier,
    fermer: async () => {
      await app.close();
      await db.close();
      await rm(dossier, { recursive: true, force: true });
      // Base de test partagée : les tâches en attente des cabinets de ce fichier (envois à reprendre,
      // relances à J+3 et J+10, e-mails) sont retirées pour ne pas gêner les fichiers suivants.
      await proprietaire((c) =>
        c.query(
          `DELETE FROM jobs WHERE statut IN ('en_attente', 'en_cours')
             AND cabinet_id IN (SELECT cabinet_id FROM canaux_comptes)`,
        ),
      );
    },
  };
}

/** Registre des jobs des canaux, avec les ports et la configuration du contexte de test. */
export function registreCanaux(ctx: ContexteCanaux) {
  const dependances = () => ({ config: ctx.config, canaux: ctx.canaux });
  return creerRegistre({
    [TYPE_JOB_CANAL_ENVOI]: creerHandlerCanalEnvoi(dependances),
    [TYPE_JOB_CANAL_RELANCE_QUESTIONNAIRE]: creerHandlerCanalRelanceQuestionnaire(dependances),
    [TYPE_JOB_CANAL_SYNTHESE_HEBDO]: creerHandlerCanalSyntheseHebdo(dependances),
    [TYPE_JOB_CANAL_ENTRANT_AUDIO]: creerHandlerCanalEntrantAudio(dependances),
    [TYPE_JOB_CANAL_TRANSCRIPTION]: creerHandlerCanalTranscription(dependances),
    [TYPE_JOB_CANAUX_MAINTENANCE]: creerHandlerCanauxMaintenance(dependances),
    // Relances J+3 et J+7 existantes (e-mail) : elles se traitent à côté de la relance J+10 WhatsApp.
    [TYPE_JOB_RELANCE_QUESTIONNAIRE]: relanceQuestionnaire,
  });
}

/** Exécute tous les jobs prêts à l'instant `quand` ; renvoie leurs résultats. */
export async function executerJobs(ctx: ContexteCanaux, quand: Date = new Date()) {
  const worker = new WorkerJobs(ctx.db, {
    mailer: ctx.app.mailer as MailerJournal,
    registre: registreCanaux(ctx),
    horloge: () => quand,
    delaiReprise: () => 60_000,
  });
  const resultats = [];
  for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
  return resultats;
}

/** Envoie un événement au webhook, signé (ou non) ; `horodatage` en secondes epoch. */
export function webhook(
  ctx: ContexteCanaux,
  charge: object | string,
  options: {
    secret?: string;
    horodatage?: number;
    entetes?: Record<string, string>;
    ip?: string;
  } = {},
) {
  const corps = typeof charge === "string" ? charge : JSON.stringify(charge);
  const signes = signerWebhook(
    corps,
    options.secret ?? SECRET_WEBHOOK,
    options.horodatage ?? Math.floor(Date.now() / 1000),
  );
  return ctx.app.inject({
    method: "POST",
    url: "/api/canaux/whatsapp/webhook",
    headers: { ...signes, ...(options.entetes ?? {}) },
    payload: corps,
    ...(options.ip ? { remoteAddress: options.ip } : {}),
  });
}

let evenements = 0;
export const evenementId = (prefixe = "evt") => `${prefixe}-${Date.now()}-${++evenements}`;

/** Message texte entrant signé. */
export function entrant(
  ctx: ContexteCanaux,
  compte: string,
  numero: string,
  texte: string,
  evenement = evenementId(),
) {
  return webhook(ctx, {
    compte,
    evenement,
    type: "message",
    numero,
    recu_le: new Date().toISOString(),
    genre: "texte",
    texte,
  });
}

/** Ce que les outils exigent d'un cabinet de test : son identifiant et l'associé (session). */
export interface CabinetApi {
  cabinetId: string;
  associe: Api;
}

/** Active les comptes WhatsApp (options : relance J+10, synthèse, saisie KPI) et SMS d'un cabinet. */
export async function activerComptes(c: CabinetApi): Promise<{ whatsapp: string; sms: string }> {
  const comptes: Record<string, string> = {};
  for (const canal of ["whatsapp", "sms"] as const) {
    const r = await c.associe.put(`/api/canaux/comptes/${canal}`, {
      actif: true,
      saisie_kpi: canal === "whatsapp",
      synthese_hebdo: canal === "whatsapp",
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    attendre(200, r, `activation ${canal}`);
    comptes[canal] = r.json().identifiant_compte as string;
  }
  return { whatsapp: comptes.whatsapp as string, sms: comptes.sms as string };
}

export interface CabinetCanaux extends CabinetMissions {
  missionId: string;
  dirigeant: UtilisateurPortail;
  contributeur: UtilisateurPortail;
  /** Identifiants publics des comptes (une fois activés). */
  compteWhatsapp: string;
  compteSms: string;
}

/** Cabinet avec une mission, un dirigeant et un contributeur du client, comptes WhatsApp et SMS ACTIFS. */
export async function preparerCabinetCanaux(
  ctx: ContexteCanaux,
  nom: string,
): Promise<CabinetCanaux> {
  const a = await preparerCabinet(ctx, nom);
  const missionId = (await creerMission(a)).id;
  const dirigeant = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
  const contributeur = await inviterClient(ctx, a.chef, a.clientId, ["client_contributeur"]);
  const comptes = await activerComptes(a);
  return {
    ...a,
    missionId,
    dirigeant,
    contributeur,
    compteWhatsapp: comptes.whatsapp,
    compteSms: comptes.sms,
  };
}

/** Dernier code à six chiffres envoyé à ce numéro (boîte du simulateur : rien ne sort de la machine). */
export function dernierCode(
  ctx: ContexteCanaux,
  numero: string,
  canal: "whatsapp" | "sms" = "whatsapp",
) {
  const boite = canal === "whatsapp" ? ctx.whatsapp.boite : ctx.sms.boite;
  const m = [...boite].reverse().find((x) => x.numero === numero && /\d{6}/.test(x.texte));
  const code = m?.texte.match(/\d{6}/)?.[0];
  if (!code) throw new Error("Aucun code dans la boîte du simulateur.");
  return code;
}

/**
 * Enregistre le numéro d'un utilisateur du portail (par le cabinet), exécute les jobs, saisit le code
 * reçu, puis, si `consentement`, enregistre un consentement recueilli par le cabinet.
 * Renvoie l'identifiant du destinataire.
 */
export async function destinataireVerifie(
  ctx: ContexteCanaux,
  c: CabinetApi,
  utilisateurId: string,
  canal: "whatsapp" | "sms",
  numero: string,
  consentement = true,
): Promise<string> {
  const r = await c.associe.put(`/api/canaux/destinataires/${utilisateurId}/${canal}`, { numero });
  attendre(200, r, "numéro");
  await executerJobs(ctx);
  const id = r.json().destinataire.id as string;
  attendre(
    200,
    await c.associe.post(`/api/canaux/destinataires/${id}/verification`, {
      code: dernierCode(ctx, numero, canal),
    }),
    "vérification",
  );
  if (consentement) {
    attendre(
      200,
      await c.associe.post(`/api/canaux/destinataires/${id}/consentements`, {
        statut: "accorde",
        reference_preuve: "Formulaire papier signé le 12/10/2026",
      }),
      "consentement",
    );
  }
  return id;
}

/** Lignes du journal d'envois d'un destinataire (jamais un contenu : la table n'en a pas). */
export async function envoisDe(destinataireId: string) {
  return proprietaire(
    async (c) =>
      (
        await c.query(
          `SELECT id, canal, gabarit, categorie, statut, motif_blocage, code_refus, id_externe, repli_de,
                  tentatives, cle
           FROM canaux_envois WHERE destinataire_id = $1 ORDER BY cree_le, id`,
          [destinataireId],
        )
      ).rows,
  );
}

export type { Api };
export { api };

/**
 * Comme `destinataireVerifie`, pour un numéro dont le code ne peut pas être reçu (numéros « 99 », « 95 »
 * du simulateur : le message de vérification n'arrive pas) : la vérification est posée par le
 * propriétaire de la base en consommant le code émis (le déclencheur MPH12 l'exige), puis le
 * consentement est recueilli par le cabinet.
 */
export async function destinataireForce(
  c: CabinetApi,
  utilisateurId: string,
  canal: "whatsapp" | "sms",
  numero: string,
): Promise<string> {
  const r = await c.associe.put(`/api/canaux/destinataires/${utilisateurId}/${canal}`, { numero });
  attendre(200, r, "numéro");
  const id = r.json().destinataire.id as string;
  await proprietaire((cl) =>
    cl.query(
      "UPDATE canaux_destinataires SET verifie_le = now(), code_empreinte = NULL, code_expire_le = NULL WHERE id = $1",
      [id],
    ),
  );
  attendre(
    200,
    await c.associe.post(`/api/canaux/destinataires/${id}/consentements`, {
      statut: "accorde",
      reference_preuve: "Formulaire papier signé le 12/10/2026",
    }),
    "consentement",
  );
  return id;
}

/** Met un envoi en file (transaction du cabinet) ; renvoie son identifiant. */
export async function enfiler(
  ctx: ContexteCanaux,
  c: CabinetApi,
  destinataireId: string,
  options: {
    canal?: "whatsapp" | "sms";
    gabarit?: import("@missionpilot/engines").CodeGabarit;
    variables?: string[];
    cle: string;
    maintenant?: Date;
  },
) {
  const { mettreEnFileEnvoi } = await import("../src/canaux/envois.js");
  const { trousseauDepuisConfig } = await import("../src/auth/chiffrement.js");
  return ctx.db.withTenant(c.cabinetId, (db) =>
    mettreEnFileEnvoi(db, trousseauDepuisConfig(ctx.config), {
      cabinetId: c.cabinetId,
      canal: options.canal ?? "whatsapp",
      destinataireId,
      gabarit: options.gabarit ?? "relance_questionnaire_j10",
      variables: options.variables ?? [
        "Cabinet de test",
        "/portail/questionnaires/3f2c9b1e-0000-4000-8000-000000000001",
      ],
      objetType: "questionnaire_envoi",
      objetId: "3f2c9b1e-0000-4000-8000-000000000001",
      cle: options.cle,
      maintenant: options.maintenant ?? new Date(),
    }),
  );
}

/**
 * Maintenance quotidienne exécutée « à l'instant » `quand` (voyage dans le temps de la base de test :
 * le réglage `app.horloge_test`, honoré dans une base « _test » seulement, remplace l'horloge de
 * référence de la garde de `anonymiser_transcriptions`).
 */
export async function maintenirA(ctx: ContexteCanaux, cabinetId: string, quand: Date) {
  const { maintenirCanaux } = await import("../src/canaux/maintenance.js");
  const r = await ctx.db.withTenant(cabinetId, async (db) => {
    await db.query("SELECT set_config('app.horloge_test', $1, true)", [quand.toISOString()]);
    return maintenirCanaux(db, cabinetId, quand);
  });
  const { stockageDe } = await import("../src/stockage/index.js");
  for (const cle of r.cles) await stockageDe(ctx.config).supprimer(cabinetId, cle);
  return r.bilan;
}
