import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAFONDS_INGESTION,
  PLAFONDS_OCR,
  CODES_ERREUR_INGESTION,
  type CodeErreurIngestion,
} from "@missionpilot/shared";
import { estLocal } from "../config.js";
import { ErreurIngestion } from "./erreurs.js";
import type { Ocr, PageOcr } from "./ocr.js";

/*
 * OCR LOCAL (ADR-009, décision 16 ; décision de l'utilisateur du 2026-10-22 : « OCR local installé sur le
 * serveur, jamais de service externe »). Moteur : tesseract.js 7.0.0 (Tesseract 5 compilé en
 * WebAssembly, Apache-2.0), données de langue `fra` et `eng` « tessdata_fast » VENDORÉES dans
 * `apps/api/ocr-data/` et vérifiées par empreinte SHA-256. Aucune donnée ne quitte le serveur.
 *
 * Isolation (défense en profondeur ; le PDF est une entrée NON FIABLE) :
 * - un SOUS-PROCESSUS Node par document (`ocr-processus.mjs`), jamais réutilisé : aucune donnée ni
 *   adaptation du moteur ne passe d'un document ou d'un cabinet à l'autre ;
 * - environnement VIDE (aucun secret de l'API, ni NODE_OPTIONS hérité), `--max-old-space-size` borné,
 *   `--no-addons`, garde « aucun réseau » préchargé dans tous les fils (`ocr-garde-reseau.cjs` : toute
 *   tentative est refusée ET comptée ; une seule tentative fait échouer le document) ;
 * - modèle de permissions de Node (`--permission`, Node >= 22.13) : lecture seule du code et des données
 *   de langue, aucune écriture, aucun sous-processus, workers autorisés (tesseract.js). EXIGÉ en
 *   production (hors développement et test) : sans lui, l'OCR est indisponible (`OCR_INDISPONIBLE`) ;
 *   toléré en développement et en test avec un avertissement unique par processus ;
 * - mémoire surveillée par le sous-processus LUI-MÊME (fil de veille `ocr-veille.mjs`, réactif même si
 *   pdf.js bloque le fil principal) et par le parent (RSS lu dans /proc sous Linux, mesures relayées
 *   ailleurs) ; délai GLOBAL (`PLAFONDS_OCR.dureeMs`) et délai PAR ÉTAPE (démarrage du moteur, chaque
 *   page) ; au-delà, SIGKILL du sous-processus (ses fils sont des threads : ils meurent avec lui) ;
 * - aucun orphelin : le sous-processus s'arrête à la fermeture du canal IPC et sa veille le tue si le
 *   parent disparaît ou si l'échéance absolue est passée ; le parent tue les sous-processus vivants à
 *   sa sortie ;
 * - UNE reconnaissance à la fois par processus d'API (file d'attente bornée, voir `FILE_ATTENTE_MAX`).
 *
 * Bornes appliquées ICI (l'intégration ajoute un délai de secours) : pages (`PLAFOND_PAGES`, vérifié
 * avant tout travail), images par page (les plus grandes d'abord, vignettes ignorées), pixels par image
 * (`IMAGE_TROP_GRANDE` : `maxImageSize` de pdf.js retire l'image AVANT décodage, détecté et refusé ;
 * vérification de secours sur les en-têtes JPEG puis sur les dimensions décodées), caractères par page
 * et par document (`PLAFOND_TEXTE`), durée (`DELAI_DEPASSE`), mémoire et toute autre panne
 * (`OCR_ECHEC`). Aucun message de bibliothèque ne sort.
 */

/** Version exacte du moteur attendue (apps/api/package.json) : toute autre version désactive l'OCR. */
export const VERSION_MOTEUR_OCR = "7.0.0";

/** Dossier des données de langue vendorées (`apps/api/ocr-data/`). */
export const DOSSIER_DONNEES_OCR = fileURLToPath(new URL("../../ocr-data/", import.meta.url));

/**
 * Réglages de reconnaissance retenus sur MESURES (docs/workflows/notes-lots/lot-11.md, « Évaluation ») :
 * - `fra+eng` : le français d'abord, l'anglais en secours (documents en anglais) ; surcoût mesuré de 3 à
 *   14 % sur 30 pages, montants identiques à `fra` seul ;
 * - PSM 3 (segmentation automatique, défaut de Tesseract) : sur les scans de test, 100 % des montants du
 *   scan net, du scan dégradé et de l'état anglais ; PSM 6 (« bloc uniforme ») perdait une ligne entière
 *   du scan dégradé et lisait un 5 pour un 9 ; PSM 4 fait aussi bien que 3 mais mélangerait deux colonnes
 *   de texte (rapports de due diligence) ;
 * - `preserve_interword_spaces` : les espaces entre le libellé et le montant sont conservés (la chaîne
 *   aval lit « libellé [espaces] montant ») ;
 * - mise à l'échelle automatique : un scan sous 200 dpi est agrandi (vers 300 dpi, x2 au plus), un scan
 *   au-delà de 450 dpi est réduit vers 300 dpi (à 150 dpi sans agrandissement : 9 montants sur 12 au lieu
 *   de 11 sur la police difficile) ; pas de binarisation (Otsu : aucun gain, une ligne perdue).
 */
export const REGLAGES_OCR = {
  langues: "fra+eng",
  psm: 3,
  preserveEspaces: true,
  echelle: "auto" as "auto" | number,
  dpiMinAuto: 200,
  dpiMaxAuto: 450,
  dpiCible: 300,
  binariser: false,
  /** Côté minimal (px) d'une image lue : en deçà, c'est une vignette ou un ornement. */
  coteMinPx: 100,
  /**
   * Confiance minimale d'une LIGNE (0-100) : en deçà, elle est écartée (fragments « lus » dans le grain
   * d'une page blanche ou une tache : 10-30 % ; lignes d'un état lisible : 85-97 %).
   */
  confianceLigneMin: 50,
} as const;

/**
 * Limites du sous-processus, fixées sur MESURES (lot-11.md, Node 24, Windows) : le RSS du sous-processus
 * plafonne à 130-150 Mo (page blanche) et 190-256 Mo (pages A4 de 150 à 300 dpi, 30 pages comprises, sans
 * croissance d'une page à l'autre) ; 768 Mo laissent une marge de trois sans laisser une bombe épuiser le
 * serveur. Durée : ~1 s de démarrage (processus, pdf.js, moteur), puis ~2 s par page (30 pages : 58 à 71 s).
 */
export const LIMITES_OCR_LOCAL = {
  /** Tas JavaScript du sous-processus (Mo). La mémoire hors tas est bornée par la veille du RSS. */
  tasMaxMo: 256,
  /** RSS maximal du sous-processus (veille interne ; le parent coupe à +10 %). */
  rssMaxOctets: 768 * 1024 * 1024,
  /** Délai d'une étape (démarrage du moteur, une page). Une page mesurée prend 1,5 à 4,5 s. */
  delaiParEtapeMs: 60_000,
  /** Intervalle de la veille du RSS (sous-processus et parent). */
  intervalleVeilleMs: 100,
} as const;

/**
 * Documents en attente au plus derrière la reconnaissance en cours (par processus d'API). Les jobs
 * d'ingestion sont traités un par un par processus ; une file pleine signale une anomalie (appels
 * directs en rafale) : le document échoue `OCR_ECHEC` plutôt que d'accumuler des PDF en mémoire.
 * L'attente ne compte pas dans le délai du document.
 */
export const FILE_ATTENTE_MAX = 8;

export interface OptionsOcrLocal {
  /** Dossier des données de langue (défaut : `apps/api/ocr-data/`). */
  dossierDonnees?: string;
  /** Langues Tesseract (défaut `REGLAGES_OCR.langues`). */
  langues?: string;
  psm?: number;
  echelle?: "auto" | number;
  binariser?: boolean;
  preserveEspaces?: boolean;
  confianceLigneMin?: number;
  pagesMax?: number;
  dureeMs?: number;
  delaiParEtapeMs?: number;
  pixelsParImageMax?: number;
  imagesParPageMax?: number;
  caracteresParPage?: number;
  caracteresParDocument?: number;
  rssMaxOctets?: number;
  tasMaxMo?: number;
  intervalleVeilleMs?: number;
  fileAttenteMax?: number;
  /**
   * Modèle de permissions de Node : « auto » (défaut) l'active s'il est disponible. « non » (tests,
   * évaluation) n'est admis que hors production : en production, l'OCR est alors indisponible.
   */
  permission?: "auto" | "non";
  /**
   * Environnement de production : le modèle de permissions de Node y est EXIGÉ. Défaut : déduit de
   * `NODE_ENV` (`productionOcrParDefaut`) ; tout environnement autre que développement et test
   * (staging compris) est traité comme la production (option la plus prudente).
   */
  production?: boolean;
  /** RÉSERVÉ AUX TESTS : présence simulée du modèle de permissions (défaut `permissionNodeDisponible`). */
  permissionDisponible?: () => boolean;
  /** RÉSERVÉ AUX TESTS : destination de l'avertissement « sans permissions » (défaut `console.warn`). */
  avertir?: (message: string) => void;
  /** RÉSERVÉ AUX TESTS ET À L'ÉVALUATION : ne pas exiger les empreintes (données d'un autre dossier). */
  ignorerEmpreintes?: boolean;
  /**
   * RÉSERVÉ AUX TESTS : sondes qui prouvent les blocages (réseau, lecture de fichier, repli CDN, droits
   * de lecture insuffisants : `sansLectureDonnees` retire le dossier des données de `--allow-fs-read`).
   */
  sonde?: {
    reseau?: boolean;
    fichier?: string;
    sansCheminDonnees?: boolean;
    sansLectureDonnees?: boolean;
  };
}

/** Options de la vérification de disponibilité (`diagnosticOcrLocal`, `ocrLocalDisponible`). */
export type OptionsDisponibiliteOcr = Pick<
  OptionsOcrLocal,
  | "dossierDonnees"
  | "langues"
  | "ignorerEmpreintes"
  | "production"
  | "permissionDisponible"
  | "avertir"
>;

/** Bilan observable de la dernière exécution (tests, évaluation) : jamais de texte ni de contenu. */
export interface BilanOcrLocal {
  pid: number | null;
  issue: "ok" | CodeErreurIngestion;
  dureeMs: number;
  /** Tué par le parent (délai, mémoire). */
  tueParParent: boolean;
  /** Le sous-processus était terminé (événement `exit` reçu) quand `reconnaitre` a rendu la main. */
  termine: boolean;
  tentatives_reseau: number | null;
  cibles_reseau: string[];
  env_cles: string[] | null;
  permission: { actif: boolean; ecriture: boolean; enfants: boolean } | null;
  rss_pic: number;
  sonde: Record<string, unknown>;
  pagesLues: number;
}

/** Statistiques du processus (tests) : sous-processus créés, simultanés, file d'attente. */
export const statistiquesOcrLocal = {
  sousProcessusCrees: 0,
  enCours: 0,
  simultanesMax: 0,
  enAttente: 0,
  derniere: null as BilanOcrLocal | null,
};

const exiger = createRequire(import.meta.url);
const SCRIPT = fileURLToPath(new URL("./ocr-processus.mjs", import.meta.url));
const GARDE = fileURLToPath(new URL("./ocr-garde-reseau.cjs", import.meta.url));
const VEILLE = fileURLToPath(new URL("./ocr-veille.mjs", import.meta.url));
const CODES_SOUS_PROCESSUS = new Set<CodeErreurIngestion>([
  "IMAGE_TROP_GRANDE",
  "PDF_ILLISIBLE",
  "PLAFOND_PAGES",
  "PLAFOND_TEXTE",
  "OCR_ECHEC",
]);

// ---------------------------------------------------------------------------------------------------
// Disponibilité (vérification légère, mise en cache, jamais de réseau).

/** `permissions` : production sans modèle de permissions de Node (Node < 22.13). */
export type RaisonOcrIndisponible = "node" | "moteur" | "donnees" | "empreintes" | "permissions";

const LANGUE = /^[a-z]{3}(_[a-z]+)?$/;

function languesDe(langues: string): string[] | null {
  const liste = langues.split("+");
  return liste.length > 0 && liste.length <= 4 && liste.every((l) => LANGUE.test(l)) ? liste : null;
}

function majeurNode(): number {
  return Number(process.versions.node.split(".")[0]);
}

/** Paquets du moteur résolus (chemins réels), ou null s'il manque quelque chose. */
function resoudreMoteur(): { tesseract: string; coeur: string; unpdf: string } | null {
  try {
    const paquet = exiger.resolve("tesseract.js/package.json");
    const version = (JSON.parse(readFileSync(paquet, "utf8")) as { version?: unknown }).version;
    if (version !== VERSION_MOTEUR_OCR) return null;
    const tesseract = path.dirname(realpathSync(paquet));
    const coeur = path.dirname(
      realpathSync(createRequire(paquet).resolve("tesseract.js-core/package.json")),
    );
    for (const variante of [
      "tesseract-core-lstm",
      "tesseract-core-simd-lstm",
      "tesseract-core-relaxedsimd-lstm",
    ]) {
      if (!existsSync(path.join(coeur, `${variante}.js`))) return null;
      if (!existsSync(path.join(coeur, `${variante}.wasm`))) return null;
    }
    const unpdf = realpathSync(exiger.resolve("unpdf"));
    return { tesseract, coeur, unpdf };
  } catch {
    return null;
  }
}

const EMPREINTE = /^([0-9a-f]{64}) [ *]([A-Za-z0-9._-]+)$/;

/** Lit `SHA256SUMS` : nom de fichier -> empreinte attendue. */
export function lireEmpreintesOcr(dossier: string): Map<string, string> | null {
  try {
    const attendues = new Map<string, string>();
    for (const ligne of readFileSync(path.join(dossier, "SHA256SUMS"), "utf8").split(/\r?\n/)) {
      if (ligne.trim() === "") continue;
      const m = EMPREINTE.exec(ligne.trim());
      if (!m) return null;
      attendues.set(m[2] as string, m[1] as string);
    }
    return attendues;
  } catch {
    return null;
  }
}

const cacheDiagnostic = new Map<string, RaisonOcrIndisponible | null>();

/**
 * Production par défaut : tout `NODE_ENV` autre que développement et test (`estLocal`), staging compris.
 * Lu à chaque appel (jamais figé à l'import) ; la configuration (`loadConfig`) lit la même variable.
 */
export function productionOcrParDefaut(): boolean {
  return !estLocal(process.env.NODE_ENV);
}

export const AVERTISSEMENT_SANS_PERMISSIONS =
  "OCR local : modèle de permissions de Node absent (Node >= 22.13 requis) ; le sous-processus OCR " +
  "tourne sans restriction de fichiers. Toléré hors production seulement : en production, l'OCR est refusé.";

let avertissementEmis = false;

function sansException(test: () => boolean): boolean {
  try {
    return test() === true;
  } catch {
    return false;
  }
}

/**
 * Le modèle de permissions est-il présent, ou toléré ? Absent en production : non (OCR indisponible).
 * Absent hors production : oui, avec UN avertissement par processus (aucun contenu).
 */
function permissionsAdmises(options: OptionsDisponibiliteOcr): boolean {
  if (sansException(options.permissionDisponible ?? permissionNodeDisponible)) return true;
  if (options.production ?? productionOcrParDefaut()) return false;
  if (!avertissementEmis) {
    avertissementEmis = true;
    try {
      (options.avertir ?? console.warn)(AVERTISSEMENT_SANS_PERMISSIONS);
    } catch {
      // un journal en panne ne change pas la disponibilité
    }
  }
  return true;
}

/**
 * Raison pour laquelle l'OCR local ne peut pas tourner, ou null s'il est disponible : Node trop ancien,
 * moteur absent ou d'une autre version, données de langue absentes, empreintes fausses, production sans
 * modèle de permissions de Node. Les fichiers sont vérifiés une fois (cache par dossier et langues : ils
 * ne changent pas pendant la vie du processus) ; l'exigence des permissions, elle, à chaque appel.
 */
export function diagnosticOcrLocal(
  options: OptionsDisponibiliteOcr = {},
): RaisonOcrIndisponible | null {
  const dossier = path.resolve(options.dossierDonnees ?? DOSSIER_DONNEES_OCR);
  const langues = options.langues ?? REGLAGES_OCR.langues;
  const cle = `${dossier}|${langues}|${options.ignorerEmpreintes ? 1 : 0}`;
  let raison = cacheDiagnostic.get(cle);
  if (raison === undefined) {
    raison = calculerDiagnostic(dossier, langues, options.ignorerEmpreintes === true);
    cacheDiagnostic.set(cle, raison);
  }
  if (raison !== null) return raison;
  return permissionsAdmises(options) ? null : "permissions";
}

function calculerDiagnostic(
  dossier: string,
  langues: string,
  ignorerEmpreintes: boolean,
): RaisonOcrIndisponible | null {
  if (!(majeurNode() >= 22)) return "node";
  if (![SCRIPT, GARDE, VEILLE].every((f) => existsSync(f))) return "moteur";
  if (!resoudreMoteur()) return "moteur";
  const liste = languesDe(langues);
  if (!liste) return "donnees";
  const fichiers = liste.map((l) => `${l}.traineddata`);
  if (!fichiers.every((f) => existsSync(path.join(dossier, f)))) return "donnees";
  if (ignorerEmpreintes) return null;
  const attendues = lireEmpreintesOcr(dossier);
  if (!attendues) return "empreintes";
  for (const f of fichiers) {
    const attendue = attendues.get(f);
    if (!attendue) return "empreintes";
    try {
      const reelle = createHash("sha256")
        .update(readFileSync(path.join(dossier, f)))
        .digest("hex");
      if (reelle !== attendue) return "empreintes";
    } catch {
      return "donnees";
    }
  }
  return null;
}

/** Vrai si l'OCR local peut tourner (voir `diagnosticOcrLocal`). Jamais d'exception, jamais de réseau. */
export function ocrLocalDisponible(options: OptionsDisponibiliteOcr = {}): boolean {
  return diagnosticOcrLocal(options) === null;
}

/** Vide le cache du diagnostic et réarme l'avertissement « sans permissions » (tests). */
export function oublierDiagnosticOcrLocal(): void {
  cacheDiagnostic.clear();
  avertissementEmis = false;
}

// ---------------------------------------------------------------------------------------------------
// Une reconnaissance à la fois par processus d'API.

let occupe = false;
const file: (() => void)[] = [];

async function prendreTour(max: number): Promise<void> {
  if (!occupe) {
    occupe = true;
    return;
  }
  if (file.length >= max) throw new ErreurIngestion("OCR_ECHEC");
  statistiquesOcrLocal.enAttente += 1;
  try {
    // Le tour est transmis tel quel par `rendreTour` (`occupe` reste vrai).
    await new Promise<void>((ok) => file.push(ok));
  } finally {
    statistiquesOcrLocal.enAttente -= 1;
  }
}

function rendreTour(): void {
  const suivant = file.shift();
  if (suivant) suivant();
  else occupe = false;
}

// ---------------------------------------------------------------------------------------------------
// Sous-processus.

const vivants = new Set<ChildProcess>();
let nettoyageInscrit = false;

/** À la sortie du processus d'API, aucun sous-processus OCR ne lui survit. */
function inscrireNettoyage(): void {
  if (nettoyageInscrit) return;
  nettoyageInscrit = true;
  process.once("exit", () => {
    for (const enfant of vivants) {
      try {
        enfant.kill("SIGKILL");
      } catch {
        // déjà mort
      }
    }
  });
}

/** Dossiers `node_modules` à ouvrir en lecture : ceux que la résolution des modules parcourt. */
function dossiersModules(moteur: { tesseract: string; coeur: string; unpdf: string }): string[] {
  const dossiers = new Set<string>();
  // Chaque `node_modules` entre le script et la racine (chemins tels que Node les essaie).
  let courant = path.dirname(SCRIPT);
  for (;;) {
    const candidat = path.join(courant, "node_modules");
    if (existsSync(candidat)) dossiers.add(candidat);
    const parent = path.dirname(courant);
    if (parent === courant) break;
    courant = parent;
  }
  // Le `node_modules` le plus haut au-dessus de chaque paquet réel (magasin pnpm compris).
  for (const reel of [moteur.tesseract, moteur.coeur, moteur.unpdf]) {
    const morceaux = reel.split(path.sep);
    const i = morceaux.indexOf("node_modules");
    if (i > 0) dossiers.add(morceaux.slice(0, i + 1).join(path.sep));
  }
  return [...dossiers];
}

/**
 * Version de Node porteuse du modèle de permissions sous `--permission` : 22.13 et au-delà (avant 22.13,
 * seul `--experimental-permission` existait, non utilisé ; Node 22.0 à 22.12 n'a donc AUCUNE restriction).
 */
export function versionNodeAvecPermission(version: string): boolean {
  const [majeur, mineur] = version.replace(/^v/, "").split(".").map(Number);
  if (!Number.isInteger(majeur) || !Number.isInteger(mineur)) return false;
  return (majeur as number) > 22 || (majeur === 22 && (mineur as number) >= 13);
}

/** Le modèle de permissions de Node (`--permission`) est-il disponible dans ce Node ? */
export function permissionNodeDisponible(): boolean {
  if (!versionNodeAvecPermission(process.versions.node)) return false;
  try {
    return process.allowedNodeEnvironmentFlags.has("--permission");
  } catch {
    return false;
  }
}

/**
 * Valeurs `--allow-fs-read` d'un DOSSIER : le chemin exact ET le chemin avec séparateur final. Node (de
 * 20 à 24 au moins) résout le chemin puis, pour un dossier, ajoute lui-même `<séparateur>*` : les deux
 * formes donnent le même droit (le dossier et son contenu), jamais le parent ni un voisin de préfixe
 * commun (`node_modules2`) ; vérifié sous Node 24.12. Passer les deux protège d'une version qui
 * n'accepterait que l'une des conventions, sans élargir les droits. Jamais de joker `*` collé au nom
 * (`node_modules*` ouvrirait les voisins).
 */
export function lecturesDossier(dossier: string): string[] {
  const exact = path.resolve(dossier);
  return exact.endsWith(path.sep) ? [exact] : [exact, exact + path.sep];
}

/** Arguments de Node du sous-processus. Sans modèle de permissions alors qu'il est exigé : refus. */
function argumentsProcessus(
  r: Reglages,
  dossierDonnees: string,
  options: OptionsOcrLocal,
): string[] {
  const args = [`--max-old-space-size=${r.tasMaxMo}`, "--no-addons", "--require", GARDE];
  if (r.permission) {
    const moteur = resoudreMoteur();
    if (!moteur) throw new ErreurIngestion("OCR_INDISPONIBLE");
    const dossiers = [
      path.dirname(SCRIPT),
      ...(options.sonde?.sansLectureDonnees ? [] : [dossierDonnees]),
      ...dossiersModules(moteur),
    ];
    const lectures = new Set<string>([
      ...dossiers.flatMap(lecturesDossier),
      path.resolve(path.dirname(SCRIPT), "..", "..", "package.json"),
    ]);
    args.push("--permission", "--allow-worker");
    for (const l of lectures) args.push(`--allow-fs-read=${l}`);
  }
  return args;
}

interface Reglages {
  langues: string;
  langPath: string | null;
  psm: number;
  preserveEspaces: boolean;
  echelle: "auto" | number;
  dpiMinAuto: number;
  dpiMaxAuto: number;
  dpiCible: number;
  binariser: boolean;
  coteMinPx: number;
  confianceLigneMin: number;
  pagesMax: number;
  pixelsParImageMax: number;
  imagesParPageMax: number;
  caracteresParPage: number;
  caracteresParDocument: number;
  rssMaxOctets: number;
  tasMaxMo: number;
  intervalleVeilleMs: number;
  echeance: number;
  permission: boolean;
  sonde: { reseau?: boolean; fichier?: string };
}

type MessageEnfant =
  | { type: "pret" }
  | { type: "etape"; etape: string; numero?: number }
  | { type: "rss"; pic: number }
  | { type: "page"; numero: number; texte: string; confiance_pm: number }
  | { type: "fin"; bilan: BilanEnfant }
  | { type: "erreur"; code: string; bilan: BilanEnfant };

interface BilanEnfant {
  tentatives_reseau: number;
  cibles_reseau: string[];
  env_cles: string[];
  permission: { actif: boolean; ecriture: boolean; enfants: boolean };
  rss_pic: number;
  sonde: Record<string, unknown>;
}

/** RSS d'un autre processus sous Linux (/proc), en octets ; null ailleurs ou en cas d'échec. */
function rssProcessusLinux(pid: number): number | null {
  if (process.platform !== "linux") return null;
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/**
 * Environnement du sous-processus : VIDE. Sous Windows, libuv y ajoute de lui-même les variables système
 * qu'il juge indispensables (`VARIABLES_WINDOWS_LIBUV`, aucune n'est un secret de l'API) ; sous Linux, il
 * reste vide.
 */
function environnementEnfant(): NodeJS.ProcessEnv {
  return {};
}

/** Variables que libuv recopie d'office dans l'environnement d'un processus créé sous Windows. */
export const VARIABLES_WINDOWS_LIBUV = [
  "HOMEDRIVE",
  "HOMEPATH",
  "LOGONSERVER",
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
] as const;

function executer(
  pdf: Buffer,
  pages: number[],
  r: Reglages,
  options: OptionsOcrLocal,
  dossierDonnees: string,
): Promise<PageOcr[]> {
  const debut = Date.now();
  const dureeMs = options.dureeMs ?? PLAFONDS_OCR.dureeMs;
  const delaiEtape = options.delaiParEtapeMs ?? LIMITES_OCR_LOCAL.delaiParEtapeMs;
  return new Promise<PageOcr[]>((resoudre, rejeter) => {
    const bilan: BilanOcrLocal = {
      pid: null,
      issue: "OCR_ECHEC",
      dureeMs: 0,
      tueParParent: false,
      termine: false,
      tentatives_reseau: null,
      cibles_reseau: [],
      env_cles: null,
      permission: null,
      rss_pic: 0,
      sonde: {},
      pagesLues: 0,
    };
    statistiquesOcrLocal.derniere = bilan;
    let execArgv: string[];
    try {
      execArgv = argumentsProcessus(r, dossierDonnees, options);
    } catch (erreur) {
      const refus = erreur instanceof ErreurIngestion ? erreur : new ErreurIngestion("OCR_ECHEC");
      bilan.termine = true;
      bilan.issue = refus.code;
      rejeter(refus);
      return;
    }
    let enfant: ChildProcess;
    try {
      enfant = fork(SCRIPT, [], {
        // Dossier courant = dossier du script, DÉJÀ lisible : mesuré sous Node 24.12 (Windows), un
        // worker_thread créé sous `--permission` peut LIRE tout le dossier courant (et ses sous-dossiers)
        // hors `--allow-fs-read`, alors que le fil principal ne le peut pas. Hérité de l'API, ce dossier
        // (racine de l'application) pourrait contenir `.env` ou d'autres fichiers sensibles.
        cwd: path.dirname(SCRIPT),
        env: environnementEnfant(),
        execArgv,
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
    } catch {
      bilan.termine = true;
      rejeter(new ErreurIngestion("OCR_ECHEC"));
      return;
    }
    inscrireNettoyage();
    vivants.add(enfant);
    statistiquesOcrLocal.sousProcessusCrees += 1;
    statistiquesOcrLocal.enCours += 1;
    statistiquesOcrLocal.simultanesMax = Math.max(
      statistiquesOcrLocal.simultanesMax,
      statistiquesOcrLocal.enCours,
    );
    bilan.pid = enfant.pid ?? null;

    const lues = new Map<number, PageOcr>();
    let issue: { ok: true } | { ok: false; code: CodeErreurIngestion } | null = null;
    let sorti = false;
    let minuterieEtape: NodeJS.Timeout | undefined;

    const fin = () => {
      clearTimeout(minuterieGlobale);
      clearTimeout(minuterieEtape);
      clearInterval(moniteur);
      bilan.dureeMs = Date.now() - debut;
      bilan.termine = sorti;
      bilan.pagesLues = lues.size;
      if (issue?.ok) {
        bilan.issue = "ok";
        resoudre(pages.filter((n) => lues.has(n)).map((n) => lues.get(n) as PageOcr));
      } else {
        const code = issue?.ok === false ? issue.code : "OCR_ECHEC";
        bilan.issue = code;
        rejeter(new ErreurIngestion(code));
      }
    };
    // Conclut à la mort CONSTATÉE du sous-processus (jamais avant) : aucun processus ne survit au retour.
    const arreter = (code: CodeErreurIngestion | null, parParent: boolean) => {
      if (!issue) issue = code === null ? { ok: true } : { ok: false, code };
      if (parParent) bilan.tueParParent = true;
      if (sorti) return;
      try {
        enfant.kill("SIGKILL");
      } catch {
        // déjà mort : l'événement `exit` suit
      }
    };
    const relancerEtape = () => {
      clearTimeout(minuterieEtape);
      minuterieEtape = setTimeout(() => arreter("DELAI_DEPASSE", true), delaiEtape);
    };
    const minuterieGlobale = setTimeout(() => arreter("DELAI_DEPASSE", true), dureeMs);
    relancerEtape();
    const seuilParent = Math.round(r.rssMaxOctets * 1.1);
    const moniteur = setInterval(() => {
      if (sorti || enfant.pid === undefined) return;
      const rss = rssProcessusLinux(enfant.pid);
      if (rss !== null) {
        bilan.rss_pic = Math.max(bilan.rss_pic, rss);
        if (rss > seuilParent) arreter("OCR_ECHEC", true);
      }
    }, r.intervalleVeilleMs);
    moniteur.unref?.();

    enfant.on("message", (m: MessageEnfant) => {
      if (issue || !m || typeof m !== "object") return;
      switch (m.type) {
        case "pret":
        case "etape":
          relancerEtape();
          return;
        case "rss":
          if (typeof m.pic === "number") {
            bilan.rss_pic = Math.max(bilan.rss_pic, m.pic);
            if (m.pic > seuilParent) arreter("OCR_ECHEC", true);
          }
          return;
        case "page": {
          relancerEtape();
          const numero = m.numero;
          if (!pages.includes(numero) || typeof m.texte !== "string") {
            arreter("OCR_ECHEC", true);
            return;
          }
          const confiance = Number.isInteger(m.confiance_pm)
            ? Math.max(0, Math.min(1000, m.confiance_pm))
            : 0;
          lues.set(numero, { numero, texte: m.texte, confiance_pm: confiance });
          return;
        }
        case "fin":
        case "erreur": {
          const b = m.bilan;
          bilan.tentatives_reseau = Number.isInteger(b?.tentatives_reseau)
            ? b.tentatives_reseau
            : null;
          bilan.cibles_reseau = Array.isArray(b?.cibles_reseau) ? b.cibles_reseau.slice(0, 50) : [];
          bilan.env_cles = Array.isArray(b?.env_cles) ? b.env_cles.slice(0, 200) : null;
          bilan.permission = b?.permission ?? null;
          bilan.rss_pic = Math.max(bilan.rss_pic, Number(b?.rss_pic) || 0);
          bilan.sonde = b?.sonde && typeof b.sonde === "object" ? b.sonde : {};
          // Une seule tentative de sortie réseau (ou un bilan illisible) est une anomalie.
          if (bilan.tentatives_reseau !== 0) {
            arreter("OCR_ECHEC", false);
            return;
          }
          if (m.type === "fin") {
            arreter(null, false);
            return;
          }
          const code = (CODES_ERREUR_INGESTION as readonly string[]).includes(m.code)
            ? (m.code as CodeErreurIngestion)
            : "OCR_ECHEC";
          arreter(CODES_SOUS_PROCESSUS.has(code) ? code : "OCR_ECHEC", false);
          return;
        }
      }
    });
    enfant.on("error", () => arreter("OCR_ECHEC", false));
    enfant.once("exit", () => {
      sorti = true;
      vivants.delete(enfant);
      statistiquesOcrLocal.enCours -= 1;
      // Mort sans bilan (mémoire dépassée et veille, plantage) : OCR_ECHEC.
      if (!issue) issue = { ok: false, code: "OCR_ECHEC" };
      fin();
    });

    try {
      enfant.send({ type: "travail", pdf: new Uint8Array(pdf), pages, reglages: r }, (erreur) => {
        if (erreur) arreter("OCR_ECHEC", true);
      });
    } catch {
      arreter("OCR_ECHEC", true);
    }
  });
}

/**
 * Adaptateur OCR local (tesseract.js en sous-processus). `reconnaitre` lit les pages demandées d'un PDF
 * scanné ; une page sans image utile rend un texte vide et une confiance nulle. Erreurs : voir l'en-tête.
 */
export class OcrLocal implements Ocr {
  readonly fournisseur = "tesseract.js";
  readonly mode = "local" as const;

  constructor(private readonly options: OptionsOcrLocal = {}) {}

  async reconnaitre(demande: { pdf: Buffer; pages: number[] }): Promise<PageOcr[]> {
    const o = this.options;
    const pages = [...new Set(demande.pages)];
    if (!pages.every((n) => Number.isInteger(n) && n >= 1)) {
      throw new ErreurIngestion("PDF_ILLISIBLE");
    }
    const pagesMax = o.pagesMax ?? PLAFONDS_OCR.pagesMax;
    // Plafond de pages AVANT tout travail (ni file d'attente ni sous-processus).
    if (pages.length > pagesMax) throw new ErreurIngestion("PLAFOND_PAGES");
    if (pages.length === 0) return [];
    if (!ocrLocalDisponible(o)) throw new ErreurIngestion("OCR_INDISPONIBLE");
    // Modèle de permissions : actif s'il est demandé (défaut) et présent ; en production, son absence (Node
    // < 22.13 ou `permission: "non"`) rend l'OCR indisponible, avant la file et tout sous-processus.
    const avecPermission =
      (o.permission ?? "auto") === "auto" &&
      sansException(o.permissionDisponible ?? permissionNodeDisponible);
    if (!avecPermission && (o.production ?? productionOcrParDefaut())) {
      throw new ErreurIngestion("OCR_INDISPONIBLE");
    }
    const dossierDonnees = path.resolve(o.dossierDonnees ?? DOSSIER_DONNEES_OCR);
    await prendreTour(o.fileAttenteMax ?? FILE_ATTENTE_MAX);
    try {
      const dureeMs = o.dureeMs ?? PLAFONDS_OCR.dureeMs;
      const reglages: Reglages = {
        langues: o.langues ?? REGLAGES_OCR.langues,
        langPath: o.sonde?.sansCheminDonnees ? null : dossierDonnees,
        psm: o.psm ?? REGLAGES_OCR.psm,
        preserveEspaces: o.preserveEspaces ?? REGLAGES_OCR.preserveEspaces,
        echelle: o.echelle ?? REGLAGES_OCR.echelle,
        dpiMinAuto: REGLAGES_OCR.dpiMinAuto,
        dpiMaxAuto: REGLAGES_OCR.dpiMaxAuto,
        dpiCible: REGLAGES_OCR.dpiCible,
        binariser: o.binariser ?? REGLAGES_OCR.binariser,
        coteMinPx: REGLAGES_OCR.coteMinPx,
        confianceLigneMin: o.confianceLigneMin ?? REGLAGES_OCR.confianceLigneMin,
        pagesMax,
        pixelsParImageMax: o.pixelsParImageMax ?? PLAFONDS_OCR.pixelsParImageMax,
        imagesParPageMax: o.imagesParPageMax ?? PLAFONDS_OCR.imagesParPageMax,
        caracteresParPage: o.caracteresParPage ?? PLAFONDS_INGESTION.caracteresParPage,
        caracteresParDocument: o.caracteresParDocument ?? PLAFONDS_INGESTION.caracteresParDocument,
        rssMaxOctets: o.rssMaxOctets ?? LIMITES_OCR_LOCAL.rssMaxOctets,
        tasMaxMo: o.tasMaxMo ?? LIMITES_OCR_LOCAL.tasMaxMo,
        intervalleVeilleMs: o.intervalleVeilleMs ?? LIMITES_OCR_LOCAL.intervalleVeilleMs,
        // Filet de la veille interne : le parent tue au délai global, la veille 5 s plus tard.
        echeance: Date.now() + dureeMs + 5_000,
        permission: avecPermission,
        sonde: { reseau: o.sonde?.reseau, fichier: o.sonde?.fichier },
      };
      return await executer(demande.pdf, pages, reglages, o, dossierDonnees);
    } finally {
      rendreTour();
    }
  }
}
