import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MailerJournal } from "../src/notifications/mailer.js";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createDatabase } from "../src/db/pool.js";
import type { DependancesIngestion } from "../src/ingestion/fabrique.js";
import { creerHandlerIngestionExtraction } from "../src/ingestion/job-extraction.js";
import { creerHandlerIngestionStructuration } from "../src/ingestion/job-structuration.js";
import { OcrSimule } from "../src/ingestion/ocr.js";
import {
  TYPE_JOB_INGESTION_EXTRACTION,
  TYPE_JOB_INGESTION_STRUCTURATION,
} from "../src/ingestion/types.js";
import { creerRegistre } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import type { Api } from "./api.js";
import { televerser } from "./fichiers-outils.js";
import { configTest, proprietaire, type Contexte } from "./helpers.js";
import { CLE_PLATEFORME_FACTICE, serveurFactice, type ServeurFactice } from "./ia-outils.js";
import { attendre } from "./portail-outils.js";

export * from "./ingestion-pdf-outils.js";

/*
 * Harnais des tests de l'ingestion de documents (lot 6) : application dont le SEUL fournisseur IA joignable est
 * un serveur OpenRouter FACTICE local (aucune clé réelle, aucun appel réseau externe), stockage dans un dossier
 * temporaire, OCR SIMULÉ, registre de jobs limité aux deux handlers de l'ingestion et exécution des jobs sous
 * horloge injectable.
 */

export interface ContexteIngestion extends Contexte {
  serveur: ServeurFactice;
  /** Dossier de stockage temporaire. */
  dossier: string;
  /** Dépendances des handlers (l'OCR peut être retiré : `deps.ocr = null`). */
  deps: DependancesIngestion;
  /** Cabinets créés par ce contexte (ménage des jobs en fin de fichier). */
  cabinets: string[];
}

export async function demarrerIngestion(
  surcharge: Partial<Config> = {},
): Promise<ContexteIngestion> {
  const serveur = await serveurFactice();
  const dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-ingestion-"));
  const config: Config = {
    ...configTest(),
    STORAGE_DIR: dossier,
    OPENROUTER_BASE_URL: serveur.url,
    OPENROUTER_API_KEY: CLE_PLATEFORME_FACTICE,
    IA_TIMEOUT_MS: 3000,
    ...surcharge,
  };
  const db = createDatabase(config);
  const app = await buildApp(config, db);
  const cabinets: string[] = [];
  return {
    config,
    db,
    app,
    serveur,
    dossier,
    cabinets,
    deps: { config, ia: { config }, ocr: new OcrSimule() },
    fermer: async () => {
      await app.close();
      await db.close();
      await serveur.fermer();
      await rm(dossier, { recursive: true, force: true });
      // Base de test partagée : les tâches en attente des cabinets de ce fichier sont retirées.
      await proprietaire((c) =>
        c.query(
          `DELETE FROM jobs WHERE statut IN ('en_attente', 'en_cours') AND cabinet_id = ANY ($1::uuid[])`,
          [cabinets],
        ),
      );
    },
  };
}

/** Registre limité aux deux jobs de l'ingestion, avec les dépendances du contexte de test. */
export function registreIngestion(ctx: ContexteIngestion) {
  const dependances = () => ctx.deps;
  return creerRegistre({
    [TYPE_JOB_INGESTION_EXTRACTION]: creerHandlerIngestionExtraction(dependances),
    [TYPE_JOB_INGESTION_STRUCTURATION]: creerHandlerIngestionStructuration(dependances),
  });
}

/** Exécute tous les jobs prêts à l'instant `quand` ; renvoie leurs résultats. */
export async function executerJobs(ctx: ContexteIngestion, quand: Date = new Date()) {
  const worker = new WorkerJobs(ctx.db, {
    mailer: ctx.app.mailer as MailerJournal,
    registre: registreIngestion(ctx),
    horloge: () => quand,
    delaiReprise: () => 60_000,
  });
  const resultats = [];
  for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
  return resultats;
}

/** Active l'IA du cabinet (désactivée par défaut) : la clé de la plateforme est celle du serveur factice. */
export async function activerIa(associe: Api): Promise<void> {
  attendre(200, await associe.put("/api/ia/parametres", { ia_activee: true }), "activation IA");
}

export interface ParametresEtat {
  exercice?: number;
  date_cloture?: string;
  devise?: string;
  tolerance?: number;
}

export const urlEtatDocument = (clientId: string, p: ParametresEtat = {}) => {
  const exercice = p.exercice ?? 2025;
  const q = new URLSearchParams({
    exercice: String(exercice),
    date_cloture: p.date_cloture ?? `${exercice}-12-31`,
    devise: p.devise ?? "XOF",
    tolerance: String(p.tolerance ?? 0),
  });
  return `/api/dossiers/${clientId}/etats-financiers/document?${q.toString()}`;
};

/** Téléverse un document pour lecture d'un état financier ; renvoie la réponse HTTP. */
export function televerserEtat(
  api: Api,
  clientId: string,
  nom: string,
  contenu: Buffer,
  p: ParametresEtat = {},
) {
  return televerser(api, urlEtatDocument(clientId, p), nom, contenu);
}

/** Téléverse (202 attendu), exécute les jobs et renvoie le détail du document terminé. */
export async function ingerer(
  ctx: ContexteIngestion,
  api: Api,
  clientId: string,
  nom: string,
  contenu: Buffer,
  p: ParametresEtat = {},
) {
  const r = await televerserEtat(api, clientId, nom, contenu, p);
  attendre(202, r, "téléversement");
  const id = r.json().id as string;
  await executerJobs(ctx);
  const d = await api.get(`/api/dossiers/${clientId}/ingestions/${id}`);
  attendre(200, d, "détail du document");
  return { id, document: d.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** État financier (détail complet) créé par un document. */
export async function etatDe(api: Api, clientId: string, etatId: string) {
  const r = await api.get(`/api/dossiers/${clientId}/etats-financiers/${etatId}`);
  attendre(200, r, "état financier");
  return r.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Nombre d'objets présents dans le stockage temporaire du cabinet. */
export async function objetsStockes(ctx: ContexteIngestion, cabinetId: string): Promise<number> {
  const racine = path.join(ctx.dossier, cabinetId);
  const comptes = async (d: string): Promise<number> => {
    let n = 0;
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      n += e.isDirectory() ? await comptes(path.join(d, e.name)) : 1;
    }
    return n;
  };
  return comptes(racine);
}

/** Réponse de l'IA factice : un objet `{lignes}` en JSON. */
export const reponseLignes = (lignes: string[]) => ({ contenu: JSON.stringify({ lignes }) });
