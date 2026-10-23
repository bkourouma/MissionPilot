import { Worker } from "node:worker_threads";

/*
 * Pré-contrôle du PDF AVANT le worker d'extraction (ADR-009, décisions 2 et 15 ; revue de sécurité
 * 2026-10-21, constat C1 ; deuxième et troisième vérifications 2026-10-22).
 *
 * Le worker d'extraction (pdf-worker.mjs) tourne à TAS JavaScript borné (`resourceLimits`), mais pas à
 * mémoire HORS TAS bornée : un flux Flate qui se décompresse en centaines de Mo fait gonfler les Buffer de
 * pdf.js et le zlib natif, mémoire qui appartient au PROCESSUS entier (le worker est un fil, pas un
 * processus). Un piège de 1,5 Go a fait monter le RSS de l'API à 3,4 Go sans jamais franchir le plafond de
 * tas du worker. La défense « mémoire bornée du worker » ne couvre donc PAS ce cas.
 *
 * Le pré-contrôle balaie les octets du PDF reçu et décompresse sous plafond strict (`inflateRawSync` +
 * `maxOutputLength`) TOUT flux candidat dont les données commencent par un en-tête zlib valide (méthode 8,
 * FCHECK, FDICT = 0 ; la taille de fenêtre n'est pas vérifiée, comme pdf.js). Un dépassement d'une borne
 * fait refuser le document (PLAFOND_TEXTE) SANS lancer le worker d'extraction ; un flux CORROMPU est ignoré
 * (pdf.js tranchera) mais son coût est compté. Le dictionnaire n'est pas lu, la fin de ligne après
 * « stream » n'est pas supposée, un flux non terminé au premier « endstream » est repris jusqu'à la fin du
 * fichier, et une cascade Flate sur Flate est suivie tant que le résultat commence par un en-tête zlib
 * (détail dans pdf-controle-worker.mjs).
 *
 * Il tourne dans un `worker_thread` DÉDIÉ (pdf-controle-worker.mjs), JAMAIS sur le fil principal : une
 * chaîne de blocs deflate « stockés » vides, qui ne produit rien mais fait relire des Mo à chaque début
 * candidat, bloquait la boucle d'événements de l'API 73 s (toutes requêtes, tous cabinets ; troisième
 * vérification). Désormais (1) le coût d'un appel à zlib est le MAX de sa sortie et de son ENTRÉE, et
 * l'entrée cumulée a son propre plafond, ce qui rend le verdict rapide ; (2) même une entrée hostile
 * imprévue ne bloque que le worker, que le fil principal TERMINE au délai `DELAI_CONTROLE_PDF_MS`.
 * Worker DÉDIÉ plutôt que le worker d'extraction : celui-ci charge pdf.js (~1,8 Mo à analyser) dès son
 * démarrage et porte la surveillance mémoire ; le pré-contrôle n'en a pas besoin, doit pouvoir refuser sans
 * qu'aucun code de pdf.js ne s'exécute, et son verdict reste observable séparément (compteurs distincts).
 *
 * Hors de portée (la SURVEILLANCE mémoire de pdf.ts les protège, défense réactive) : les cascades dont la
 * première couche n'est pas Flate (ASCIIHex, ASCII85, LZW, RunLength puis Flate) et les flux chiffrés.
 */

/** Plafonds du pré-contrôle des flux Flate (bombes de décompression). Réalistes pour un PDF de 10 Mo. */
export const PLAFONDS_CONTROLE_PDF = {
  /**
   * Taille décompressée maximale d'UN flux. 32 Mo : un PDF de 10 Mo ne contient aucun flux légitime qui
   * décompresse au-delà (une image bitmap pleine page reste sous ce seuil, les flux de texte bien en deçà) ;
   * une bombe le franchit immédiatement.
   */
  fluxOctets: 32 * 1024 * 1024,
  /**
   * Taille décompressée CUMULÉE maximale des flux Flate du document. 128 Mo : large pour un document normal
   * (dont le texte est plafonné à 400 000 caractères), très en dessous du RSS qui a déclenché l'incident.
   */
  totalOctets: 128 * 1024 * 1024,
  /**
   * Taille BRUTE maximale d'un flux (de « stream » à « endstream »), quel que soit son filtre. Un PDF reçu
   * fait au plus 10 Mo : seul un fichier hors plafond peut l'atteindre.
   */
  fluxBrutOctets: 32 * 1024 * 1024,
  /** Nombre maximal de décompressions tentées (comme `stockage/detection.ts`). Au-delà, refus. */
  nombreFlux: 4096,
  /**
   * Nombre maximal de mots « stream » isolés examinés (4 fois `nombreFlux` : les données des flux ne sont
   * pas sautées et peuvent contenir ce mot). Au-delà, refus (document anormal).
   */
  motsStream: 16384,
  /**
   * Travail de décompression maximal, réussites ET échecs, seconde passe et couches internes comprises :
   * chaque appel à zlib compte pour le MAX de sa sortie (pour un échec, la sortie maximale qu'il a pu
   * produire) et de son entrée. 512 Mo : ~1 s de zlib au pire, des dizaines de fois un PDF normal.
   */
  travailOctets: 512 * 1024 * 1024,
  /**
   * Octets d'ENTRÉE cumulés fournis à zlib (consommés quand zlib le dit, sinon tout ce qui lui est fourni).
   * Un PDF légitime de 10 Mo fait lire chaque octet de ses flux une fois, deux au plus (reprise jusqu'à la
   * fin du fichier d'un flux non terminé) : moins de 20 Mo. 64 Mo laissent une marge de trois tout en
   * bornant la relecture hostile (blocs « stockés » vides : 64 Mo lus en ~0,15 s ; sans ce plafond, 4 096
   * débuts candidats relisant chacun ~9 Mo bloquaient 73 s).
   */
  entreeOctets: 64 * 1024 * 1024,
  /**
   * Garde-fou de terminaison des cascades Flate sur Flate : au-delà de 64 couches dont chacune commence par
   * un en-tête zlib valide, refus (aucun PDF légitime n'en a plus de deux). La vraie borne d'une cascade
   * reste les budgets ci-dessus (sortie par flux, cumul, travail, entrée).
   */
  imbricationFlateMax: 64,
} as const;

/**
 * Délai maximal du pré-contrôle (le worker est TERMINÉ au-delà). Le balayage borné rend son verdict en
 * moins de 200 ms sur un PDF normal de 10 Mo et en ~1 s au pire théorique de ses budgets : 5 s ne coupent
 * qu'une entrée imprévue (ou une machine saturée). Verdict : PLAFOND_TEXTE, comme l'épuisement d'un budget
 * (le document exige un travail de décompression anormal) ; DELAI_DEPASSE reste réservé à l'extraction.
 */
export const DELAI_CONTROLE_PDF_MS = 5_000;

/** Mémoire bornée du worker de contrôle : son tas ne garde que quelques positions (les Buffer sont hors tas). */
const LIMITES_WORKER_CONTROLE = {
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  codeRangeSizeMb: 8,
} as const;

/**
 * Verdict du pré-contrôle : `ok` (lancer le worker d'extraction) ou refus (worker d'extraction non lancé) :
 * PLAFOND_TEXTE (borne, budget, délai ou mémoire du contrôle dépassés), PDF_ILLISIBLE (panne du worker de
 * contrôle, comme une panne du worker d'extraction).
 */
export type VerdictControlePdf =
  { ok: true } | { ok: false; code: "PLAFOND_TEXTE" | "PDF_ILLISIBLE" };

/**
 * Statistiques observables (tests, mesures) : workers de contrôle créés depuis le démarrage du processus,
 * durée du dernier balayage DANS le worker et durée de bout en bout du dernier contrôle (création du
 * worker, copie du PDF, verdict, arrêt du worker).
 */
export const statistiquesControlePdf = {
  workersCrees: 0,
  dernierBalayageMs: 0,
  dernierTotalMs: 0,
};

export interface OptionsControlePdf {
  /** Délai maximal (défaut : `DELAI_CONTROLE_PDF_MS`). */
  delaiMs?: number;
}

type SortieWorkerControle = { ok: boolean; code?: unknown; dureeMs?: unknown };

/**
 * Pré-contrôle (voir l'en-tête du module) dans un worker dédié : le fil principal ne fait que créer le
 * worker, attendre son verdict et appliquer le délai. Ne rejette jamais : toute panne est un refus.
 */
export function controlerBombePdf(
  contenu: Buffer,
  options: OptionsControlePdf = {},
): Promise<VerdictControlePdf> {
  const depart = performance.now();
  return new Promise<VerdictControlePdf>((resoudre) => {
    let worker: Worker;
    try {
      // Copie TRANSFÉRÉE (pas de seconde copie par clonage) : l'appelant garde son Buffer intact.
      const copie = new Uint8Array(contenu);
      worker = new Worker(new URL("./pdf-controle-worker.mjs", import.meta.url), {
        workerData: { role: "controle-pdf", contenu: copie, plafonds: PLAFONDS_CONTROLE_PDF },
        transferList: [copie.buffer],
        resourceLimits: { ...LIMITES_WORKER_CONTROLE },
      });
    } catch {
      resoudre({ ok: false, code: "PDF_ILLISIBLE" });
      return;
    }
    statistiquesControlePdf.workersCrees += 1;
    let fini = false;
    const conclure = (verdict: VerdictControlePdf) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      // Le worker est terminé dans TOUS les cas (il a peut-être déjà fini) ; le verdict n'attend que son
      // arrêt effectif, pour que sa mémoire hors tas soit rendue avant le worker d'extraction.
      worker
        .terminate()
        .catch(() => undefined)
        .finally(() => {
          statistiquesControlePdf.dernierTotalMs = performance.now() - depart;
          resoudre(verdict);
        });
    };
    const minuterie = setTimeout(
      () => conclure({ ok: false, code: "PLAFOND_TEXTE" }),
      options.delaiMs ?? DELAI_CONTROLE_PDF_MS,
    );
    worker.once("message", (m: SortieWorkerControle) => {
      if (typeof m?.dureeMs === "number") statistiquesControlePdf.dernierBalayageMs = m.dureeMs;
      if (m?.ok === true) conclure({ ok: true });
      else if (m?.ok === false && m.code === "PLAFOND_TEXTE")
        conclure({ ok: false, code: "PLAFOND_TEXTE" });
      else conclure({ ok: false, code: "PDF_ILLISIBLE" });
    });
    worker.once("error", (e: NodeJS.ErrnoException) =>
      conclure({
        ok: false,
        code: e?.code === "ERR_WORKER_OUT_OF_MEMORY" ? "PLAFOND_TEXTE" : "PDF_ILLISIBLE",
      }),
    );
    worker.once("exit", () => conclure({ ok: false, code: "PDF_ILLISIBLE" }));
  });
}
