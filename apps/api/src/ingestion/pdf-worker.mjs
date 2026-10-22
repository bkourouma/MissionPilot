// Worker d'extraction du texte d'un PDF (ADR-009, décisions 2 et 5). JavaScript natif, volontairement :
// il doit se charger tel quel sous tsx comme sous vitest. Aucune ressource distante, aucun rendu.
//
// Il lit page par page et ABANDONNE dès qu'un plafond est franchi. Le comptage porte sur le texte brut dont
// les blancs sont réduits ; le plafond exact (texte normalisé) est revérifié par pdf.ts, d'où une marge
// de 2 sur les plafonds de caractères ici : la défense est la mémoire bornée (`resourceLimits`) et l'arrêt
// anticipé, pas la précision.
//
// Contrat : `workerData = { contenu, pagesMax, caracteresParPage, caracteresParDocument }` ;
// message de sortie `{ ok: true, pages: string[] }` ou `{ ok: false, code }`
// (PDF_ILLISIBLE, PLAFOND_PAGES, PLAFOND_TEXTE).
import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";

const MARGE = 2;
const OPTIONS_PDFJS = {
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  useWorkerFetch: false,
  enableXfa: false,
  disableAutoFetch: true,
  disableStream: true,
  verbosity: 0,
};

async function extraire() {
  const { contenu, pagesMax, caracteresParPage, caracteresParDocument } = workerData;
  let doc;
  try {
    doc = await getDocumentProxy(contenu, { ...OPTIONS_PDFJS });
  } catch {
    return { ok: false, code: "PDF_ILLISIBLE" };
  }
  try {
    // Plafond de pages AVANT toute extraction de texte.
    if (doc.numPages < 1) return { ok: false, code: "PDF_ILLISIBLE" };
    if (doc.numPages > pagesMax) return { ok: false, code: "PLAFOND_PAGES" };
    const pages = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n += 1) {
      let texte;
      try {
        const page = await doc.getPage(n);
        const contenuPage = await page.getTextContent();
        texte = contenuPage.items
          .filter((item) => item.str != null)
          .map((item) => item.str + (item.hasEOL ? "\n" : ""))
          .join("");
        page.cleanup();
      } catch {
        return { ok: false, code: "PDF_ILLISIBLE" };
      }
      const compte = texte.replace(/\s+/g, " ").length;
      total += compte;
      if (compte > caracteresParPage * MARGE || total > caracteresParDocument * MARGE) {
        return { ok: false, code: "PLAFOND_TEXTE" };
      }
      pages.push(texte);
    }
    return { ok: true, pages };
  } finally {
    await doc.loadingTask.destroy().catch(() => undefined);
  }
}

extraire().then(
  (sortie) => parentPort.postMessage(sortie),
  () => parentPort.postMessage({ ok: false, code: "PDF_ILLISIBLE" }),
);
