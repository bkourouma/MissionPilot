import { Worker } from "node:worker_threads";
import { normaliserTextePage, verifierPlafondsDocument } from "@missionpilot/engines";
import { PLAFONDS_INGESTION, type CodeErreurIngestion } from "@missionpilot/shared";
import { ErreurIngestion } from "./erreurs.js";
import { controlerBombePdf } from "./pdf-controle.js";
import type { Ocr } from "./ocr.js";
import type { PageExtraite, ResultatExtractionTexte } from "./types.js";

/*
 * Extraction du texte d'un PDF (ADR-009, décisions 2, 4 et 5). Le fichier est une entrée NON FIABLE :
 *
 * - `unpdf` (pdf.js sans dépendance) en mode texte seulement : aucune évaluation de code
 *   (`isEvalSupported: false`), aucune police système ni ressource distante, aucun rendu ;
 * - PRÉ-CONTRÔLE des bombes de décompression AVANT le worker d'extraction (`pdf-controle.ts`, défense
 *   PRINCIPALE) : un flux Flate qui se décompresse au-delà des bornes fait échouer le document
 *   (PLAFOND_TEXTE) sans même lancer le worker d'extraction. Le pré-contrôle tourne lui-même dans un worker
 *   DÉDIÉ, à délai propre (`DELAI_CONTROLE_PDF_MS`) : le fil principal de l'API n'est jamais bloqué ;
 * - l'extraction tourne dans un `worker_thread` (pdf-worker.mjs) à TAS JavaScript borné (`resourceLimits`) :
 *   un flux piégé bloque la boucle du worker, pas celle du processus, et le délai le TERMINE ; le worker
 *   abandonne dès qu'un plafond de pages ou de caractères est franchi ;
 * - SURVEILLANCE de la mémoire du worker (`SURVEILLANCE_MEMOIRE`) : `resourceLimits` borne le TAS JavaScript
 *   mais PAS la mémoire HORS TAS (ArrayBuffer/Buffer de pdf.js, zlib natif), qui appartient au PROCESSUS
 *   entier (le worker est un fil, pas un processus). Un flux qui échapperait au pré-contrôle (filtres en
 *   cascade, expansion interne de pdf.js) est donc aussi surveillé : au-delà d'un seuil (hausse du RSS du
 *   processus, ou mémoire externe du worker), le worker est TERMINÉ immédiatement et le document échoue
 *   PLAFOND_TEXTE. Un piège de 1,5 Go avait fait monter le RSS de l'API à 3,4 Go sans jamais franchir le
 *   plafond de tas du worker (revue de sécurité 2026-10-21, constat C1). La surveillance du RSS est
 *   active dans tous les cas ; celle de la mémoire externe exige `Worker.getHeapStatistics()` (Node >=
 *   22.16, garde défensive en dessous) ; une mesure en échec ne lève jamais ;
 * - le nombre de pages est lu et plafonné AVANT toute extraction de texte (`PLAFOND_PAGES`) ;
 * - durée totale plafonnée (30 s, `DELAI_DEPASSE`, sans reprise) ; deux extractions simultanées au
 *   plus par processus (sémaphore à file d'attente : le job attend sa place) ;
 * - texte normalisé (`normaliserTextePage`) puis plafonds de caractères (`PLAFOND_TEXTE`) ;
 * - PDF sans aucune couche texte : OCR si un adaptateur est branché, sinon `PDF_SANS_TEXTE`. Une page
 *   vide ne bloque rien tant qu'une autre page porte du texte.
 *
 * Aucun message de bibliothèque ne sort d'ici : tout échec est un `ErreurIngestion` à code stable.
 */

export const EXTRACTIONS_SIMULTANEES_MAX = 2;

let enCours = 0;
const attente: (() => void)[] = [];

async function prendrePlace(): Promise<void> {
  if (enCours < EXTRACTIONS_SIMULTANEES_MAX) {
    enCours += 1;
    return;
  }
  // La place est transmise telle quelle par `rendrePlace` (le compte ne change pas).
  await new Promise<void>((ok) => attente.push(ok));
}

function rendrePlace(): void {
  const suivant = attente.shift();
  if (suivant) suivant();
  else enCours -= 1;
}

/** Exécute `travail` dans le sémaphore des extractions (attend une place libre). */
export async function avecPlaceExtraction<T>(travail: () => Promise<T>): Promise<T> {
  await prendrePlace();
  try {
    return await travail();
  } finally {
    rendrePlace();
  }
}

/**
 * Seuils de la surveillance mémoire du worker (exportés, voir l'en-tête), fixés sur MESURES (2026-10-22,
 * Node 24, seuils de production) :
 * - PDF légitimes de ~10 Mo (60 pages de texte et de tracés, 60 pages d'images Flate ou JPEG, un flux de
 *   tracés de 31 Mo décompressés, 10 pages de 3 Mo de tracés) : mémoire externe du worker 21 à 88 Mo, hausse
 *   du RSS du processus 28 à 100 Mo (147 Mo au plus observé) ; tous passent encore avec des seuils DEUX fois
 *   plus bas (128 Mo / 256 Mo) ;
 * - cascade `[/ASCIIHexDecode /FlateDecode]` de 1,5 Go qui échappe au pré-contrôle : avec les anciens seuils
 *   (512 Mo / 768 Mo), coupure en 3,4 à 5,1 s et pic de RSS de +589 à +628 Mo ; avec ceux-ci (256 Mo /
 *   512 Mo), coupure en 2,6 à 3,0 s et pic de +321 à +363 Mo ; sans la mesure du worker (Node < 22.16, RSS
 *   seul à 512 Mo), coupure en 4,5 s et pic de +529 Mo.
 * pdf.js agrandit ses tampons par DOUBLEMENT : le pic dépasse le seuil d'un palier, d'où des seuils
 * nettement sous la mémoire tolérable. Le seuil du RSS (partagé par les deux extractions simultanées et le
 * reste de l'API) reste large pour ne pas couper un document légitime voisin d'une bombe.
 */
export const SURVEILLANCE_MEMOIRE = {
  /** Intervalle entre deux mesures (~150 ms) : assez fin pour arrêter une bombe avant l'épuisement. */
  intervalleMs: 150,
  /**
   * Hausse maximale du RSS du PROCESSUS depuis le départ du worker. Le RSS est à l'échelle du processus (le
   * worker est un fil) : c'est le signal qui aurait coupé l'incident (le `resourceLimits` ne le borne pas),
   * et le SEUL disponible quand `Worker.getHeapStatistics()` manque (Node < 22.16).
   */
  seuilRssHausseOctets: 512 * 1024 * 1024,
  /**
   * Mémoire EXTERNE du worker (ArrayBuffer/Buffer hors tas V8), lue par `worker.getHeapStatistics()`
   * (Node >= 22.16). Le `process.memoryUsage().arrayBuffers` du PARENT ne voit pas l'isolat du worker :
   * cette mesure est son équivalent côté worker, et répond en quelques ms même quand la boucle du worker
   * est saturée.
   */
  seuilArrayBuffersOctets: 256 * 1024 * 1024,
} as const;

export interface OptionsSurveillance {
  intervalleMs?: number;
  seuilRssHausseOctets?: number;
  seuilArrayBuffersOctets?: number;
}

export interface OptionsPdf {
  ocr: Ocr | null;
  /** Durée maximale (défaut : 30 s). */
  dureeMs?: number;
  /**
   * Seuils de surveillance abaissés, RÉSERVÉS AUX TESTS (injection) : permettent de déclencher la coupure
   * mémoire avec un worker qui alloue modestement, sans fabriquer une vraie bombe de plusieurs Go.
   */
  surveillance?: OptionsSurveillance;
}

/**
 * Statistiques observables (tests) : nombre de workers d'EXTRACTION créés depuis le démarrage du processus.
 * Les workers du pré-contrôle sont comptés à part (`statistiquesControlePdf`, pdf-controle.ts) : un refus du
 * pré-contrôle laisse `workersCrees` inchangé.
 */
export const statistiquesPdf = { workersCrees: 0 };

/** Mémoire bornée du worker : un flux piégé fait échouer le worker, jamais le processus. */
const LIMITES_WORKER = {
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 16,
} as const;

type SortieWorker = { ok: true; pages: string[] } | { ok: false; code: CodeErreurIngestion };

/** RSS du processus (worker compris), ou `null` si la mesure échoue : la surveillance ne lève jamais. */
function rssActuel(): number | null {
  try {
    return process.memoryUsage.rss();
  } catch {
    return null;
  }
}

/**
 * Lit le texte brut des pages dans un `worker_thread` à mémoire bornée (voir pdf-worker.mjs). Mémoire
 * épuisée -> PLAFOND_TEXTE ; autre panne du worker -> PDF_ILLISIBLE. `ouvert.worker` permet à l'appelant de
 * le terminer (délai) : une promesse ne peut pas interrompre un décodage qui bloque la boucle d'événements.
 */
function lireTexteBrut(
  pdf: Buffer,
  ouvert: { worker?: Worker },
  surveillance: Required<OptionsSurveillance>,
): Promise<string[]> {
  return new Promise<string[]>((ok, refuser) => {
    const worker = new Worker(new URL("./pdf-worker.mjs", import.meta.url), {
      workerData: {
        contenu: new Uint8Array(pdf),
        pagesMax: PLAFONDS_INGESTION.pagesMax,
        caracteresParPage: PLAFONDS_INGESTION.caracteresParPage,
        caracteresParDocument: PLAFONDS_INGESTION.caracteresParDocument,
      },
      resourceLimits: { ...LIMITES_WORKER },
    });
    statistiquesPdf.workersCrees += 1;
    ouvert.worker = worker;
    // RSS de référence ; s'il n'a pas pu être lu, il est pris à la première mesure réussie.
    let rssDepart = rssActuel();
    let fini = false;
    let enMesure = false;
    const conclure = (suite: () => void) => {
      if (fini) return;
      fini = true;
      // Nettoyage du timer de surveillance dans TOUS les cas (succès, échec, délai) : aucun handle orphelin.
      clearInterval(moniteur);
      suite();
    };
    // Coupure mémoire : termine le worker et échoue PLAFOND_TEXTE, comme une mémoire épuisée.
    const couperPourMemoire = () =>
      conclure(() => {
        void worker.terminate();
        refuser(new ErreurIngestion("PLAFOND_TEXTE"));
      });
    const moniteur = setInterval(() => {
      // Aucune exception ne sort de ce rappel (elle tuerait le processus) : une mesure qui échoue est
      // simplement manquée, la suivante a lieu au prochain tour ; le timer est arrêté par `conclure`.
      try {
        if (fini) return;
        // RSS du processus : signal à l'échelle du processus, le seul qui aurait coupé l'incident. Mesuré
        // à CHAQUE tour, avant et indépendamment de la mesure du worker (absente, lente ou en échec).
        const rss = rssActuel();
        if (rss !== null && rssDepart === null) rssDepart = rss;
        else if (
          rss !== null &&
          rssDepart !== null &&
          rss - rssDepart > surveillance.seuilRssHausseOctets
        ) {
          couperPourMemoire();
          return;
        }
        // Mémoire externe du worker (hors tas) : `Worker.getHeapStatistics()` n'existe qu'à partir de
        // Node 22.16 ; absente, seule la surveillance du RSS reste active. Lecture asynchrone, sans
        // recouvrement (`enMesure`), qui ne bloque jamais la mesure du RSS ci-dessus.
        if (enMesure || typeof worker.getHeapStatistics !== "function") return;
        enMesure = true;
        let mesure: Promise<{ external_memory?: unknown } | undefined>;
        try {
          mesure = worker.getHeapStatistics();
        } catch {
          enMesure = false;
          return;
        }
        // Aucun rejet non traité : tout échec (promesse rejetée, résultat inattendu) est absorbé.
        Promise.resolve(mesure)
          .then((h) => {
            enMesure = false;
            const externe = h?.external_memory;
            if (
              !fini &&
              typeof externe === "number" &&
              externe > surveillance.seuilArrayBuffersOctets
            ) {
              couperPourMemoire();
            }
          })
          .catch(() => {
            enMesure = false;
          });
      } catch {
        // Mesure manquée (voir ci-dessus).
      }
    }, surveillance.intervalleMs);
    // Ne pas retenir la boucle d'événements du processus pour ce seul timer.
    moniteur.unref?.();
    worker.once("message", (m: SortieWorker) =>
      conclure(() => (m.ok ? ok(m.pages) : refuser(new ErreurIngestion(m.code)))),
    );
    worker.once("error", (e: NodeJS.ErrnoException) =>
      conclure(() =>
        refuser(
          new ErreurIngestion(
            e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "PLAFOND_TEXTE" : "PDF_ILLISIBLE",
          ),
        ),
      ),
    );
    worker.once("exit", () => conclure(() => refuser(new ErreurIngestion("PDF_ILLISIBLE"))));
  });
}

const estVide = (texte: string) => texte.trim().length === 0;

function verifierPlafonds(pages: readonly { numero: number; texte: string }[]): void {
  const depasse = verifierPlafondsDocument(pages, {
    pagesMax: PLAFONDS_INGESTION.pagesMax,
    caracteresParPage: PLAFONDS_INGESTION.caracteresParPage,
    caracteresParDocument: PLAFONDS_INGESTION.caracteresParDocument,
  });
  if (depasse) throw new ErreurIngestion(depasse);
}

async function lireDocument(
  pdf: Buffer,
  ocr: Ocr | null,
  ouvert: { worker?: Worker },
  surveillance: Required<OptionsSurveillance>,
): Promise<ResultatExtractionTexte> {
  const brutes = await lireTexteBrut(pdf, ouvert, surveillance);
  const pages = brutes.map((t, i) => ({ numero: i + 1, texte: normaliserTextePage(t) }));
  verifierPlafonds(pages);
  if (pages.some((p) => !estVide(p.texte))) {
    const extraites: PageExtraite[] = pages.map((p) => ({
      ...p,
      methode: "texte",
      confiance_pm: null,
    }));
    return { methode: "texte", pages: extraites };
  }
  // Aucune couche texte : document scanné.
  if (!ocr) throw new ErreurIngestion("PDF_SANS_TEXTE");
  const lues = await ocr.reconnaitre({ pdf, pages: pages.map((p) => p.numero) });
  const parNumero = new Map(lues.map((p) => [p.numero, p]));
  const reconnues = pages.map((p) => {
    const l = parNumero.get(p.numero);
    return {
      numero: p.numero,
      texte: normaliserTextePage(l?.texte ?? ""),
      confiance: l?.confiance_pm ?? 0,
    };
  });
  verifierPlafonds(reconnues);
  if (reconnues.every((p) => estVide(p.texte))) throw new ErreurIngestion("PDF_SANS_TEXTE");
  const extraites: PageExtraite[] = reconnues.map((p) => ({
    numero: p.numero,
    texte: p.texte,
    methode: "ocr_simule",
    confiance_pm: Math.max(0, Math.min(1000, Math.round(p.confiance))),
  }));
  return { methode: "ocr_simule", pages: extraites };
}

/**
 * Pages de texte d'un PDF (couche texte, sinon OCR). Lève `ErreurIngestion` : PDF_ILLISIBLE,
 * PLAFOND_PAGES, PLAFOND_TEXTE, DELAI_DEPASSE, PDF_SANS_TEXTE, OCR_NON_SIMULE.
 */
export function extrairePagesPdf(
  pdf: Buffer,
  options: OptionsPdf,
): Promise<ResultatExtractionTexte> {
  return avecPlaceExtraction(async () => {
    // PRÉ-CONTRÔLE (défense principale), dans son propre worker : une bombe de décompression est refusée
    // AVANT de lancer le worker d'extraction. Il occupe la même place du sémaphore que l'extraction.
    const controle = await controlerBombePdf(pdf);
    if (!controle.ok) throw new ErreurIngestion(controle.code);

    const surveillance: Required<OptionsSurveillance> = {
      intervalleMs: options.surveillance?.intervalleMs ?? SURVEILLANCE_MEMOIRE.intervalleMs,
      seuilRssHausseOctets:
        options.surveillance?.seuilRssHausseOctets ?? SURVEILLANCE_MEMOIRE.seuilRssHausseOctets,
      seuilArrayBuffersOctets:
        options.surveillance?.seuilArrayBuffersOctets ??
        SURVEILLANCE_MEMOIRE.seuilArrayBuffersOctets,
    };
    const ouvert: { worker?: Worker } = {};
    let minuterie: NodeJS.Timeout | undefined;
    const delai = new Promise<never>((_, refuser) => {
      minuterie = setTimeout(() => {
        // Terminer le worker d'abord : sinon le décodage continuerait à consommer processeur et mémoire.
        void ouvert.worker?.terminate();
        refuser(new ErreurIngestion("DELAI_DEPASSE"));
      }, options.dureeMs ?? PLAFONDS_INGESTION.dureeExtractionMs);
    });
    const travail = lireDocument(pdf, options.ocr, ouvert, surveillance);
    // Si le délai gagne, le travail échoue en arrière-plan : son échec tardif est absorbé.
    travail.catch(() => undefined);
    try {
      return await Promise.race([travail, delai]);
    } finally {
      clearTimeout(minuterie);
      await ouvert.worker?.terminate().catch(() => undefined);
    }
  });
}
