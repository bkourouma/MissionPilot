import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser, type HTTPRequest } from "puppeteer-core";
import { estLocal, type Config } from "../config.js";
import { AppError } from "../errors.js";
import { CSP_RAPPORT, enTeteHtml, piedHtml, rapportEnHtml } from "./html.js";
import type { Rapport } from "./modele.js";

/*
 * Rendu PDF : HTML échappé (html.ts) imprimé par Chromium headless
 * (docs/DECISIONS.md, « Rapports »), via puppeteer-core (aucun navigateur
 * téléchargé : le chemin vient de la configuration, CHROMIUM_PATH).
 *
 * BARRIÈRES (défense en profondeur) :
 * - JavaScript de la page désactivé ;
 * - interception de TOUTES les requêtes : seule la navigation initiale vers
 *   une adresse fictive reçoit le document (réponse fabriquée ici, avec la
 *   politique CSP `default-src 'none'`), tout le reste est refusé (réseau,
 *   file://, data:, service workers) ;
 * - résolution DNS neutralisée (`--host-resolver-rules`), extensions,
 *   synchronisation et services d'arrière-plan désactivés, liaison par tube
 *   (aucun port de débogage ouvert) ;
 * - profil de navigateur jetable : dossier créé par `mkdtemp` pour CE rendu,
 *   supprimé explicitement à la fin (y compris après un délai dépassé) ;
 * - délai maximal sur l'ensemble du rendu (504) ; à son terme, le navigateur
 *   est fermé sans attendre ;
 * - fermeture bornée : `close()` limité à DELAI_FERMETURE_MS, puis le
 *   processus est tué (SIGKILL) et sa sortie attendue (bornée) ;
 * - rendus simultanés bornés : RENDUS_PDF_SIMULTANES au total et
 *   RENDUS_PDF_PAR_CABINET par cabinet (503 RENDU_OCCUPE au-delà). Une place
 *   n'est rendue qu'après la fermeture effective du navigateur et la
 *   suppression de son profil : la promesse ne se résout (ou n'échoue)
 *   qu'une fois ce nettoyage fait.
 * Le contenu est du texte échappé : aucune donnée utilisateur n'est
 * interprétée (voir html.ts).
 */

/** Chemin de Chrome sous Windows de développement (repli si CHROMIUM_PATH est absent). */
export const CHROME_WINDOWS_DEV = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export const DELAI_RENDU_PDF_MS = 30_000;
/** Lancement du navigateur (il ne dépend pas du document) ; borne le nettoyage après un délai. */
export const DELAI_LANCEMENT_MS = 15_000;
/** Fermeture gracieuse attendue au plus ce délai avant SIGKILL ; même borne pour la sortie. */
export const DELAI_FERMETURE_MS = 5_000;
export const RENDUS_PDF_SIMULTANES = 2;
export const RENDUS_PDF_PAR_CABINET = 1;
/** Préfixe des profils jetables (sous `dossierTemporaire`, par défaut le dossier temporaire du système). */
export const PREFIXE_PROFIL = "missionpilot-pdf-";
const URL_DOCUMENT = "https://rapport.missionpilot.invalid/";

/**
 * Chemin du navigateur : CHROMIUM_PATH (absolu et existant, vérifié par
 * loadConfig), sinon, en développement ou test sous Windows, l'installation
 * standard de Chrome si elle existe ; null si aucun navigateur n'est
 * disponible (le PDF répond alors 503).
 */
export function cheminNavigateur(
  config: Pick<Config, "NODE_ENV" | "CHROMIUM_PATH">,
): string | null {
  if (config.CHROMIUM_PATH) return config.CHROMIUM_PATH;
  if (estLocal(config.NODE_ENV) && process.platform === "win32" && existsSync(CHROME_WINDOWS_DEV)) {
    return CHROME_WINDOWS_DEV;
  }
  return null;
}

export const ARGUMENTS_CHROMIUM: readonly string[] = [
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-breakpad",
  "--disable-domain-reliability",
  "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-pings",
  "--mute-audio",
  "--metrics-recording-only",
  "--block-new-web-contents",
  "--host-resolver-rules=MAP * ~NOTFOUND",
];

export interface OptionsPdf {
  cheminNavigateur: string;
  /** Cabinet demandeur (borne par cabinet) ; null seulement hors requête (tests du rendu). */
  cabinetId: string | null;
  delaiMs?: number;
  enTete?: string;
  pied?: string;
  /** Dossier parent des profils jetables (défaut : dossier temporaire du système). */
  dossierTemporaire?: string;
  /** Diagnostic (tests) : chaque requête refusée ou servie par le navigateur. */
  journal?: (evenement: { url: string; issue: "bloquee" | "terminee" }) => void;
}

const occupation = { total: 0, parCabinet: new Map<string, number>() };

/** Diagnostic (tests) : rendus en cours, au total et pour un cabinet. */
export function rendusPdfEnCours(cabinetId?: string): number {
  return cabinetId === undefined ? occupation.total : (occupation.parCabinet.get(cabinetId) ?? 0);
}

const indisponible = () =>
  new AppError(
    503,
    "RENDU_PDF_INDISPONIBLE",
    "Le rendu PDF est indisponible : navigateur introuvable ou en échec.",
  );
const tropLong = () =>
  new AppError(504, "RENDU_TROP_LONG", "Le rendu du rapport a dépassé le délai.");

/** Réserve une place (synchrone : avant toute attente) ; renvoie la fonction qui la rend. */
function reserverRendu(cabinetId: string | null): () => void {
  const duCabinet = cabinetId === null ? 0 : (occupation.parCabinet.get(cabinetId) ?? 0);
  if (occupation.total >= RENDUS_PDF_SIMULTANES || duCabinet >= RENDUS_PDF_PAR_CABINET) {
    throw new AppError(503, "RENDU_OCCUPE", "Trop de rapports en cours de rendu : réessayez.");
  }
  occupation.total++;
  if (cabinetId !== null) occupation.parCabinet.set(cabinetId, duCabinet + 1);
  let rendue = false;
  return () => {
    if (rendue) return;
    rendue = true;
    occupation.total--;
    if (cabinetId === null) return;
    const reste = (occupation.parCabinet.get(cabinetId) ?? 1) - 1;
    if (reste > 0) occupation.parCabinet.set(cabinetId, reste);
    else occupation.parCabinet.delete(cabinetId);
  };
}

/** Vrai si `promesse` se résout dans le délai ; faux si elle échoue ou expire. */
async function dansLeDelai(promesse: Promise<unknown>, ms: number): Promise<boolean> {
  let minuteur: NodeJS.Timeout | undefined;
  const expiration = new Promise<boolean>((ok) => {
    minuteur = setTimeout(() => ok(false), ms);
  });
  try {
    return await Promise.race([
      promesse.then(
        () => true,
        () => false,
      ),
      expiration,
    ]);
  } finally {
    clearTimeout(minuteur);
  }
}

const termine = (p: ChildProcess) => p.exitCode !== null || p.signalCode !== null;

/** Fermeture bornée : close(), sinon SIGKILL ; attend (borné) la sortie du processus. */
async function fermer(navigateur: Browser): Promise<void> {
  const processus = navigateur.process();
  const ferme = await dansLeDelai(navigateur.close(), DELAI_FERMETURE_MS);
  if (!processus) return;
  if (!ferme && !termine(processus)) {
    try {
      processus.kill("SIGKILL");
    } catch {
      // Déjà terminé.
    }
  }
  if (!termine(processus)) {
    await dansLeDelai(new Promise((ok) => processus.once("exit", ok)), DELAI_FERMETURE_MS);
  }
}

/** Suppression tolérante du profil (fichiers encore verrouillés un instant sous Windows). */
async function supprimerProfil(dossier: string): Promise<void> {
  await rm(dossier, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
    () => undefined,
  );
}

function avecDelai<T>(promesse: Promise<T>, ms: number, surDelai: () => void): Promise<T> {
  let minuteur: NodeJS.Timeout | undefined;
  const delai = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => {
      surDelai();
      rejeter(tropLong());
    }, ms);
  });
  return Promise.race([promesse, delai]).finally(() => clearTimeout(minuteur));
}

/** Route chaque requête : le document initial est servi une fois, tout le reste refusé. */
function intercepter(html: string, journal: OptionsPdf["journal"]) {
  let servi = false;
  return (requete: HTTPRequest) => {
    if (!servi && requete.isNavigationRequest() && requete.url() === URL_DOCUMENT) {
      servi = true;
      void requete.respond({
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: { "Content-Security-Policy": CSP_RAPPORT, "X-Content-Type-Options": "nosniff" },
        body: html,
      });
      return;
    }
    journal?.({ url: requete.url(), issue: "bloquee" });
    void requete.abort("blockedbyclient");
  };
}

async function imprimer(navigateur: Browser, html: string, options: OptionsPdf, delai: number) {
  const page = await navigateur.newPage();
  page.setDefaultTimeout(delai);
  await page.setJavaScriptEnabled(false);
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on("request", intercepter(html, options.journal));
  page.on("requestfinished", (r) => {
    if (r.url() !== URL_DOCUMENT) options.journal?.({ url: r.url(), issue: "terminee" });
  });
  await page.goto(URL_DOCUMENT, { waitUntil: "load", timeout: delai });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: options.enTete ?? "<span></span>",
    footerTemplate: options.pied ?? "<span></span>",
    margin: { top: "22mm", bottom: "20mm", left: "15mm", right: "15mm" },
    timeout: delai,
  });
  return Buffer.from(pdf);
}

interface EtatRendu {
  navigateur: Browser | null;
  profil: string | null;
  abandonne: boolean;
  fermeture: Promise<void> | null;
}

/** Profil jetable, navigateur lancé dessus, puis impression (abandon vérifié à chaque étape). */
async function produire(etat: EtatRendu, html: string, options: OptionsPdf, delai: number) {
  try {
    etat.profil = await mkdtemp(
      path.join(options.dossierTemporaire ?? os.tmpdir(), PREFIXE_PROFIL),
    );
  } catch {
    throw indisponible();
  }
  if (etat.abandonne) throw tropLong();
  try {
    etat.navigateur = await puppeteer.launch({
      executablePath: options.cheminNavigateur,
      headless: true,
      pipe: true,
      userDataDir: etat.profil,
      args: [...ARGUMENTS_CHROMIUM],
      timeout: DELAI_LANCEMENT_MS,
      protocolTimeout: delai + DELAI_FERMETURE_MS,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  } catch {
    throw indisponible();
  }
  if (etat.abandonne) throw tropLong();
  return imprimer(etat.navigateur, html, options, delai);
}

/**
 * Imprime un document HTML en PDF A4 dans un Chromium isolé (barrières en
 * tête de fichier). Erreurs : 503 navigateur indisponible ou rendus
 * simultanés trop nombreux, 504 délai dépassé. Quand la promesse se règle,
 * le navigateur est fermé, son profil supprimé et la place rendue.
 */
export async function htmlEnPdf(html: string, options: OptionsPdf): Promise<Buffer> {
  const liberer = reserverRendu(options.cabinetId);
  const delai = options.delaiMs ?? DELAI_RENDU_PDF_MS;
  const etat: EtatRendu = { navigateur: null, profil: null, abandonne: false, fermeture: null };
  const fermerNavigateur = () => {
    if (!etat.navigateur) return Promise.resolve();
    etat.fermeture ??= fermer(etat.navigateur);
    return etat.fermeture;
  };
  const travail = produire(etat, html, options, delai);
  try {
    return await avecDelai(travail, delai, () => {
      etat.abandonne = true;
      void fermerNavigateur();
    });
  } finally {
    try {
      // Lancement en cours au délai : attendu (borné par DELAI_LANCEMENT_MS), puis fermé.
      await travail.catch(() => undefined);
      await fermerNavigateur();
      if (etat.profil) await supprimerProfil(etat.profil);
    } finally {
      liberer();
    }
  }
}

/** Rapport → PDF A4 avec en-tête (émetteur, titre) et pied (statut, page n sur N). */
export function rapportEnPdf(r: Rapport, options: Omit<OptionsPdf, "enTete" | "pied">) {
  return htmlEnPdf(rapportEnHtml(r), { ...options, enTete: enTeteHtml(r), pied: piedHtml(r) });
}
