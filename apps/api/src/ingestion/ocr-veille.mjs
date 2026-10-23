// Veille du sous-processus OCR (ADR-009, décision 16). JavaScript natif, comme les autres workers de
// l'ingestion. Ce `worker_thread` tourne DANS le sous-processus (ocr-processus.mjs), à côté du fil
// principal (qui décode les images du PDF avec pdf.js, parfois en bloquant sa boucle) et du fil de
// tesseract.js : il reste réactif quoi que fassent les deux autres.
//
// Il TUE le processus entier (SIGKILL sur son propre PID ; un `process.exit` dans un worker ne
// terminerait que ce fil) dès que :
// - le RSS du processus dépasse `rssMaxOctets` (mémoire hors tas de pdf.js et mémoire WebAssembly de
//   tesseract comprises : `--max-old-space-size` ne borne que le tas JavaScript) ;
// - l'échéance absolue `echeance` (horloge murale, ms) est franchie : filet si le parent a disparu sans
//   que le canal IPC ne le signale ;
// - le parent n'existe plus (`process.kill(ppid, 0)` échoue avec ESRCH) : aucun processus orphelin.
// Le pic de RSS est renvoyé au fil principal, qui le relaie au parent (battement de cœur et mesure).
//
// Contrat : `workerData = { rssMaxOctets, echeance, ppid, intervalleMs }` ; messages sortants
// `{ type: "rss", rss, pic }`.
/* global setInterval, clearInterval */
import process from "node:process";
import { parentPort, workerData } from "node:worker_threads";

const { rssMaxOctets, echeance, ppid, intervalleMs } = workerData;
let pic = 0;

function tuer() {
  try {
    process.kill(process.pid, "SIGKILL");
  } catch {
    // Dernier recours : le parent tue le processus à son propre délai.
  }
}

function parentVivant() {
  if (!Number.isInteger(ppid) || ppid <= 1) return false;
  try {
    process.kill(ppid, 0);
    return true;
  } catch (erreur) {
    // EPERM : le processus existe mais n'est pas signalable par nous ; il est vivant.
    return erreur?.code === "EPERM";
  }
}

const minuterie = setInterval(() => {
  let rss = 0;
  try {
    rss = process.memoryUsage.rss();
  } catch {
    rss = 0;
  }
  if (rss > pic) pic = rss;
  if (rss > rssMaxOctets || Date.now() > echeance || !parentVivant()) {
    clearInterval(minuterie);
    tuer();
    return;
  }
  parentPort?.postMessage({ type: "rss", rss, pic });
}, intervalleMs);
