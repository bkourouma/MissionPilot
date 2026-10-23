// Sous-processus de l'OCR LOCAL (ADR-009, décision 16). JavaScript natif, volontairement, comme les autres
// workers de l'ingestion : il se charge tel quel sous tsx, sous vitest et en production.
//
// Lancé par `ocr-local.ts` (child_process.fork) pour UN document, puis terminé : jamais réutilisé, aucune
// donnée ni adaptation du moteur ne passe d'un document (ou d'un cabinet) à l'autre. Environnement VIDE
// (aucun secret de l'API), tas JavaScript borné (`--max-old-space-size`), garde « aucun réseau » préchargé
// (`--require ocr-garde-reseau.cjs`, actif aussi dans les worker_threads), modèle de permissions de Node
// quand il est disponible (lecture seule du code et des données de langue, aucune écriture, aucun
// sous-processus), veille du RSS, de l'échéance et du parent dans un fil dédié (ocr-veille.mjs).
//
// Travail : le parent envoie `{ type: "travail", pdf, pages, reglages }` (IPC « advanced », le PDF en
// Uint8Array) ; pour chaque page demandée, les images du PDF sont décodées par pdf.js (unpdf) avec
// `maxImageSize` = plafond de pixels (une image plus grande est retirée par pdf.js AVANT décodage, ce que
// ce script détecte et transforme en IMAGE_TROP_GRANDE), converties en PNG gris 8 bits (encodé ici avec
// zlib) puis reconnues par tesseract.js (WebAssembly, données de langue LOCALES, aucun cache écrit).
//
// Messages vers le parent : `{ type: "pret" }`, `{ type: "etape", etape, numero? }`, `{ type: "rss", pic }`,
// `{ type: "page", numero, texte, confiance_pm }`, puis `{ type: "fin", bilan }` ou
// `{ type: "erreur", code, bilan }`. Aucun message de bibliothèque ne sort : seuls des codes stables
// (IMAGE_TROP_GRANDE, PDF_ILLISIBLE, PLAFOND_PAGES, PLAFOND_TEXTE, OCR_ECHEC).
/* global console, fetch, setTimeout, URL */
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import process from "node:process";
import { Worker } from "node:worker_threads";
import zlib from "node:zlib";

const exiger = createRequire(import.meta.url);
const garde = exiger("./ocr-garde-reseau.cjs");

// pdf.js signale par un avertissement (console) l'image retirée par `maxImageSize`, et rien d'autre ne doit
// sortir de ce processus (stdout et stderr sont ignorés par le parent, mais aucune bibliothèque ne doit
// écrire de contenu) : la console est remplacée par un capteur muet.
const MOTIF_IMAGE_RETIREE = "Image exceeded maximum allowed size";
let imageRetiree = false;
const capteur = (...args) => {
  for (const a of args) {
    if (typeof a === "string" && a.includes(MOTIF_IMAGE_RETIREE)) imageRetiree = true;
  }
};
for (const nom of ["log", "info", "warn", "error", "debug", "trace"]) console[nom] = capteur;

class ErreurCode extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

let picRss = 0;
let termine = false;
/** Résultats des sondes de test (vide hors tests), joints au bilan quel que soit l'issue. */
const sonde = {};

function bilan(extra = {}) {
  let permission = { actif: false, ecriture: true, enfants: true };
  try {
    if (process.permission && typeof process.permission.has === "function") {
      permission = {
        actif: true,
        ecriture: process.permission.has("fs.write"),
        enfants: process.permission.has("child"),
      };
    }
  } catch {
    // Mesure indisponible : valeurs prudentes ci-dessus (actif = false).
  }
  try {
    picRss = Math.max(picRss, process.memoryUsage.rss());
  } catch {
    // ignoré
  }
  return {
    tentatives_reseau: garde.compterTentativesReseau(),
    cibles_reseau: garde.detailsTentativesReseau(),
    env_cles: Object.keys(process.env),
    permission,
    rss_pic: picRss,
    sonde,
    ...extra,
  };
}

function envoyer(message) {
  return new Promise((ok) => {
    if (!process.connected) return ok();
    try {
      process.send(message, () => ok());
    } catch {
      ok();
    }
  });
}

/** Fin du processus : laisse aux workers le temps de signaler une tentative de sortie, puis s'arrête. */
async function conclure(message) {
  if (termine) return;
  termine = true;
  await new Promise((ok) => setTimeout(ok, 30));
  const complet = { ...message, bilan: bilan(message.bilan) };
  await envoyer(complet);
  process.exit(0);
}

// Parent disparu (canal IPC fermé) : arrêt immédiat, sans attendre la fin du travail.
process.on("disconnect", () => {
  try {
    process.kill(process.pid, "SIGKILL");
  } catch {
    process.exit(1);
  }
});
process.on("uncaughtException", () => void conclure({ type: "erreur", code: "OCR_ECHEC" }));
process.on("unhandledRejection", () => void conclure({ type: "erreur", code: "OCR_ECHEC" }));

// ---------------------------------------------------------------------------------------------------
// Images : conversion en gris, mise à l'échelle, PNG.

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (PNG) : `zlib.crc32` (Node >= 22.2), sinon table locale. */
function crc32(octets) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(octets) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i += 1) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type, donnees) {
  const entete = Buffer.alloc(8);
  entete.writeUInt32BE(donnees.length, 0);
  entete.write(type, 4, "latin1");
  const fin = Buffer.alloc(4);
  fin.writeUInt32BE(crc32(Buffer.concat([entete.subarray(4), donnees])), 0);
  return Buffer.concat([entete, donnees, fin]);
}

/** PNG gris 8 bits non entrelacé, filtre « aucun », résolution (pHYs) indiquée au moteur. */
export function encoderPngGris(gris, largeur, hauteur, dpi) {
  const ligne = largeur + 1;
  const brut = Buffer.alloc(ligne * hauteur);
  for (let y = 0; y < hauteur; y += 1) {
    brut[y * ligne] = 0;
    brut.set(gris.subarray(y * largeur, (y + 1) * largeur), y * ligne + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 0; // gris
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const phys = Buffer.alloc(9);
  const ppm = Math.max(1, Math.round(dpi / 0.0254));
  phys.writeUInt32BE(ppm, 0);
  phys.writeUInt32BE(ppm, 4);
  phys[8] = 1; // mètre
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc("IHDR", ihdr),
    bloc("pHYs", phys),
    bloc("IDAT", zlib.deflateSync(brut, { level: 3 })),
    bloc("IEND", Buffer.alloc(0)),
  ]);
}

/** Pixels décodés par pdf.js -> gris 8 bits (1 bit par pixel, gris, RGB ou RGBA), ou null si inconnu. */
function versGris(image) {
  const { width: l, height: h, data, kind } = image;
  const n = l * h;
  const gris = new Uint8Array(n);
  if (kind === 1 && data.length === Math.ceil(l / 8) * h) {
    // GRAYSCALE_1BPP de pdf.js : bit à 1 = blanc.
    const parLigne = Math.ceil(l / 8);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < l; x += 1) {
        const octet = data[y * parLigne + (x >> 3)];
        gris[y * l + x] = octet & (0x80 >> (x & 7)) ? 255 : 0;
      }
    }
    return gris;
  }
  const canaux = data.length / n;
  if (canaux === 1) {
    gris.set(data.subarray(0, n));
    return gris;
  }
  if (canaux !== 3 && canaux !== 4) return null;
  for (let i = 0, j = 0; i < n; i += 1, j += canaux) {
    gris[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return gris;
}

/** Mise à l'échelle bilinéaire (facteur > 0). */
function redimensionner(gris, l, h, facteur) {
  const L = Math.max(1, Math.round(l * facteur));
  const H = Math.max(1, Math.round(h * facteur));
  const sortie = new Uint8Array(L * H);
  const rx = l / L;
  const ry = h / H;
  for (let y = 0; y < H; y += 1) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) * ry - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < L; x += 1) {
      const sx = Math.min(l - 1, Math.max(0, (x + 0.5) * rx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(l - 1, x0 + 1);
      const fx = sx - x0;
      const a = gris[y0 * l + x0] + (gris[y0 * l + x1] - gris[y0 * l + x0]) * fx;
      const b = gris[y1 * l + x0] + (gris[y1 * l + x1] - gris[y1 * l + x0]) * fx;
      sortie[y * L + x] = Math.round(a + (b - a) * fy);
    }
  }
  return { gris: sortie, largeur: L, hauteur: H };
}

/** Binarisation par seuil d'Otsu (réglage d'évaluation, désactivé par défaut). */
function binariser(gris) {
  const histo = new Float64Array(256);
  for (let i = 0; i < gris.length; i += 1) histo[gris[i]] += 1;
  const total = gris.length;
  let somme = 0;
  for (let t = 0; t < 256; t += 1) somme += t * histo[t];
  let sommeB = 0;
  let poidsB = 0;
  let meilleur = 0;
  let seuil = 127;
  for (let t = 0; t < 256; t += 1) {
    poidsB += histo[t];
    if (poidsB === 0) continue;
    const poidsF = total - poidsB;
    if (poidsF === 0) break;
    sommeB += t * histo[t];
    const mB = sommeB / poidsB;
    const mF = (somme - sommeB) / poidsF;
    const v = poidsB * poidsF * (mB - mF) * (mB - mF);
    if (v > meilleur) {
      meilleur = v;
      seuil = t;
    }
  }
  for (let i = 0; i < gris.length; i += 1) gris[i] = gris[i] > seuil ? 255 : 0;
}

/**
 * Vérification de secours AVANT pdf.js : dimensions annoncées par les en-têtes JPEG (SOFn) présents en
 * clair dans le PDF. pdf.js juge `maxImageSize` sur le DICTIONNAIRE de l'image ; un JPEG qui ment sur ses
 * dimensions serait décodé à sa taille réelle. Un JPEG dont l'en-tête annonce plus de `pixelsMax` pixels
 * fait refuser le document (IMAGE_TROP_GRANDE) sans aucun décodage. Heuristique bornée (64 en-têtes).
 */
function jpegTropGrand(octets, pixelsMax) {
  let examines = 0;
  for (
    let i = octets.indexOf(0xff);
    i >= 0 && i + 4 < octets.length;
    i = octets.indexOf(0xff, i + 1)
  ) {
    if (octets[i + 1] !== 0xd8 || octets[i + 2] !== 0xff) continue;
    examines += 1;
    if (examines > 64) return false;
    let j = i + 2;
    for (let pas = 0; pas < 256 && j + 9 < octets.length; pas += 1) {
      if (octets[j] !== 0xff) break;
      const marqueur = octets[j + 1];
      if (marqueur === 0xff) {
        j += 1;
        continue;
      }
      if (marqueur === 0xd8 || (marqueur >= 0xd0 && marqueur <= 0xd7) || marqueur === 0x01) {
        j += 2;
        continue;
      }
      const longueur = (octets[j + 2] << 8) | octets[j + 3];
      const sof =
        marqueur >= 0xc0 &&
        marqueur <= 0xcf &&
        marqueur !== 0xc4 &&
        marqueur !== 0xc8 &&
        marqueur !== 0xcc;
      if (sof) {
        const hauteur = (octets[j + 5] << 8) | octets[j + 6];
        const largeur = (octets[j + 7] << 8) | octets[j + 8];
        if (largeur * hauteur > pixelsMax) return true;
        break;
      }
      if (longueur < 2) break;
      j += 2 + longueur;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Sondes réservées aux tests (jamais activées par l'application) : preuves que le garde et le modèle de
// permissions bloquent réellement.

async function sonderReseau() {
  const essais = [];
  const essayer = async (nom, f) => {
    try {
      await f();
      essais.push({ nom, bloque: false });
    } catch (erreur) {
      essais.push({ nom, bloque: erreur?.code === "ERR_OCR_RESEAU_INTERDIT" });
    }
  };
  const net = exiger("node:net");
  const dns = exiger("node:dns");
  const http = exiger("node:http");
  const https = exiger("node:https");
  const enfants = exiger("node:child_process");
  await essayer("net.connect", () => net.connect({ host: "127.0.0.1", port: 9 }));
  await essayer("socket.connect", () => new net.Socket().connect(9, "127.0.0.1"));
  await essayer("dns.lookup", () => dns.lookup("exemple.invalid", () => undefined));
  await essayer("dns.promises.resolve", () => dns.promises.resolve("exemple.invalid"));
  await essayer("http.get", () => http.get("http://127.0.0.1:9/"));
  await essayer("https.request", () => https.request("https://127.0.0.1:9/"));
  await essayer("fetch", () => fetch("http://127.0.0.1:9/"));
  await essayer("child_process.spawn", () => enfants.spawn(process.execPath, ["-v"]));
  // Même chose depuis un worker_thread : le garde (--require) doit y être actif aussi.
  const dansWorker = await new Promise((ok) => {
    const w = new Worker(
      `const { parentPort } = require("node:worker_threads");
       let bloques = 0;
       try { fetch("http://127.0.0.1:9/"); } catch (e) { if (e.code === "ERR_OCR_RESEAU_INTERDIT") bloques++; }
       try { require("node:net").connect(9, "127.0.0.1"); } catch (e) { if (e.code === "ERR_OCR_RESEAU_INTERDIT") bloques++; }
       parentPort.postMessage(bloques);`,
      { eval: true },
    );
    w.once("message", (n) => ok(n));
    w.once("error", () => ok(-1));
  });
  essais.push({ nom: "worker", bloque: dansWorker === 2 });
  return essais;
}

function sonderFichier(chemin) {
  try {
    exiger("node:fs").readFileSync(chemin);
    return "lu";
  } catch (erreur) {
    return erreur?.code === "ERR_ACCESS_DENIED" ? "refuse" : "erreur";
  }
}

// ---------------------------------------------------------------------------------------------------
// Travail.

const OPTIONS_PDFJS = {
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  useWorkerFetch: false,
  enableXfa: false,
  disableAutoFetch: true,
  disableStream: true,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  // Avertissements nécessaires pour détecter l'image retirée par `maxImageSize` (capteur ci-dessus).
  verbosity: 1,
};

function objetImage(page, cle) {
  return new Promise((ok) => {
    (cle.startsWith("g_") ? page.commonObjs : page.objs).get(cle, (image) => ok(image));
  });
}

async function lireImagesPage(doc, numero, r, OPS) {
  let page;
  try {
    page = await doc.getPage(numero);
  } catch {
    throw new ErreurCode("PDF_ILLISIBLE");
  }
  try {
    const vue = page.getViewport({ scale: 1 });
    imageRetiree = false;
    let ops;
    try {
      ops = await page.getOperatorList();
    } catch {
      throw new ErreurCode(imageRetiree ? "IMAGE_TROP_GRANDE" : "PDF_ILLISIBLE");
    }
    if (imageRetiree) throw new ErreurCode("IMAGE_TROP_GRANDE");
    const cles = [];
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
      const cle = ops.argsArray[i]?.[0];
      if (typeof cle === "string" && !cles.includes(cle)) cles.push(cle);
      if (cles.length > 1000) break;
    }
    const images = [];
    for (const cle of cles) {
      const image = await objetImage(page, cle);
      if (!image || !image.data || !image.width || !image.height) continue;
      // Vérification de secours sur les dimensions RÉELLEMENT décodées.
      if (image.width * image.height > r.pixelsParImageMax)
        throw new ErreurCode("IMAGE_TROP_GRANDE");
      if (image.width < r.coteMinPx || image.height < r.coteMinPx) continue; // vignette
      images.push(image);
    }
    images.sort((a, b) => b.width * b.height - a.width * a.height);
    return { images: images.slice(0, r.imagesParPageMax), largeurPagePt: vue.width };
  } finally {
    try {
      page.cleanup();
    } catch {
      // ignoré
    }
  }
}

/**
 * Image sans encre : moins de `max(50, 0,005 %)` pixels plus sombres que le fond (médiane) de 80 niveaux.
 * Une page blanche à grain n'en a aucun (fixture : aucun pixel sous 240) ; un état scanné en a 1,7 à
 * 2,8 % (mesures du lot 11). Elle n'est pas confiée au moteur, qui y « lirait » des fragments et y
 * passerait jusqu'à 10 s une fois agrandie.
 */
function sansEncre(gris) {
  const histo = new Uint32Array(256);
  for (let i = 0; i < gris.length; i += 1) histo[gris[i]] += 1;
  let cumul = 0;
  let mediane = 255;
  for (let t = 0; t < 256; t += 1) {
    cumul += histo[t];
    if (cumul >= gris.length / 2) {
      mediane = t;
      break;
    }
  }
  let encre = 0;
  for (let t = 0; t < mediane - 80; t += 1) encre += histo[t];
  return encre < Math.max(50, gris.length * 0.00005);
}

function preparer(image, largeurPagePt, r) {
  let gris = versGris(image);
  if (!gris || sansEncre(gris)) return null;
  let largeur = image.width;
  let hauteur = image.height;
  // Résolution estimée en supposant l'image sur toute la largeur de la page (cas d'un scan).
  let dpi = largeurPagePt > 0 ? (largeur * 72) / largeurPagePt : 200;
  if (!Number.isFinite(dpi) || dpi <= 0) dpi = 200;
  let facteur = 1;
  if (r.echelle === "auto") {
    if (dpi < r.dpiMinAuto) facteur = Math.min(2, r.dpiCible / dpi);
    else if (dpi > r.dpiMaxAuto) facteur = r.dpiCible / dpi;
  } else if (typeof r.echelle === "number") {
    facteur = r.echelle;
  }
  // Jamais au-delà du plafond de pixels après mise à l'échelle.
  const maxFacteur = Math.sqrt(r.pixelsParImageMax / (largeur * hauteur));
  facteur = Math.min(facteur, maxFacteur);
  if (Math.abs(facteur - 1) > 0.05) {
    const redim = redimensionner(gris, largeur, hauteur, facteur);
    gris = redim.gris;
    largeur = redim.largeur;
    hauteur = redim.hauteur;
    dpi *= facteur;
  }
  if (r.binariser) binariser(gris);
  const png = encoderPngGris(gris, largeur, hauteur, dpi);
  // Borne de la taille du PNG intermédiaire (deflate n'agrandit qu'à la marge).
  if (png.length > (largeur + 1) * hauteur * 1.01 + 4096) throw new ErreurCode("OCR_ECHEC");
  return png;
}

/**
 * Texte d'une image à partir des LIGNES du moteur : une ligne dont la confiance est sous `seuil` (0 à 100)
 * est écartée. Sur une page blanche à grain ou une tache, Tesseract « lit » des fragments à 10-30 % de
 * confiance ; les lignes d'un état lisible sont à 85-97 % (mesures du lot 11). Le texte d'une ligne garde
 * ses espaces (`preserve_interword_spaces`). Confiance rendue : moyenne des lignes retenues pondérée par
 * leur longueur (même échelle 0-100 que la confiance moyenne des mots de Tesseract).
 */
function lignesRetenues(donnees, seuil) {
  const lignes = [];
  for (const bloc of Array.isArray(donnees?.blocks) ? donnees.blocks : []) {
    for (const paragraphe of Array.isArray(bloc?.paragraphs) ? bloc.paragraphs : []) {
      for (const ligne of Array.isArray(paragraphe?.lines) ? paragraphe.lines : [])
        lignes.push(ligne);
    }
  }
  if (lignes.length === 0) {
    // Sortie sans structure : texte brut, confiance globale.
    const texte = typeof donnees?.text === "string" ? donnees.text : "";
    const confiance = Number(donnees?.confidence);
    const utile = texte.trim().length;
    const garde = utile > 0 && Number.isFinite(confiance) && confiance >= seuil;
    return garde
      ? { texte, sommeConfiance: confiance * utile, poids: utile }
      : { texte: "", sommeConfiance: 0, poids: 0 };
  }
  let texte = "";
  let sommeConfiance = 0;
  let poids = 0;
  for (const ligne of lignes) {
    const t = typeof ligne?.text === "string" ? ligne.text : "";
    const confiance = Number(ligne?.confidence);
    const utile = t.trim().length;
    if (utile === 0 || !Number.isFinite(confiance) || confiance < seuil) continue;
    texte += t.endsWith("\n") ? t : `${t}\n`;
    sommeConfiance += confiance * utile;
    poids += utile;
  }
  return { texte, sommeConfiance, poids };
}

async function travailler({ pdf, pages, reglages: r }) {
  // Veille (RSS, échéance, parent) dans un fil dédié, réactif même si ce fil est bloqué par pdf.js.
  const veille = new Worker(new URL("./ocr-veille.mjs", import.meta.url), {
    workerData: {
      rssMaxOctets: r.rssMaxOctets,
      echeance: r.echeance,
      ppid: process.ppid,
      intervalleMs: r.intervalleVeilleMs,
    },
  });
  veille.on("message", (m) => {
    if (m?.type === "rss" && typeof m.pic === "number" && m.pic > picRss) {
      picRss = m.pic;
      void envoyer({ type: "rss", pic: picRss });
    }
  });
  veille.unref();

  if (r.sonde?.reseau) sonde.reseau = await sonderReseau();
  if (typeof r.sonde?.fichier === "string") sonde.fichier = sonderFichier(r.sonde.fichier);

  const octets = new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  if (jpegTropGrand(octets, r.pixelsParImageMax)) throw new ErreurCode("IMAGE_TROP_GRANDE");

  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const { OPS } = await getResolvedPDFJS();
  let doc;
  try {
    doc = await getDocumentProxy(octets, { ...OPTIONS_PDFJS, maxImageSize: r.pixelsParImageMax });
  } catch {
    throw new ErreurCode("PDF_ILLISIBLE");
  }
  if (doc.numPages < 1) throw new ErreurCode("PDF_ILLISIBLE");
  const demandees = [...new Set(pages)].filter(
    (n) => Number.isInteger(n) && n >= 1 && n <= doc.numPages,
  );
  if (demandees.length > r.pagesMax) throw new ErreurCode("PLAFOND_PAGES");

  await envoyer({ type: "etape", etape: "moteur" });
  const Tesseract = exiger("tesseract.js");
  let moteur;
  // tesseract.js avale l'échec du chargement des langues (la promesse de `createWorker` ne se règle
  // jamais) : son `errorHandler` rejette ici, pour échouer tout de suite plutôt qu'au délai.
  let signalerEchec = () => undefined;
  const echecMoteur = new Promise((_, rejeter) => {
    signalerEchec = () => rejeter(new ErreurCode("OCR_ECHEC"));
  });
  echecMoteur.catch(() => undefined);
  try {
    const creation = Tesseract.createWorker(r.langues, Tesseract.OEM.LSTM_ONLY, {
      // Chemin LOCAL absolu : jamais d'URL, donc jamais de CDN (sans `langPath`, tesseract.js
      // téléchargerait ; le garde le refuserait et le compterait).
      ...(r.langPath ? { langPath: r.langPath } : {}),
      gzip: false,
      cacheMethod: "none",
      legacyCore: false,
      legacyLang: false,
      logger: () => undefined,
      errorHandler: () => signalerEchec(),
    });
    creation.catch(() => undefined);
    moteur = await Promise.race([creation, echecMoteur]);
    await moteur.setParameters({
      tessedit_pageseg_mode: String(r.psm),
      preserve_interword_spaces: r.preserveEspaces ? "1" : "0",
    });
  } catch {
    throw new ErreurCode("OCR_ECHEC");
  }

  let totalCaracteres = 0;
  for (const numero of demandees) {
    await envoyer({ type: "etape", etape: "page", numero });
    const { images, largeurPagePt } = await lireImagesPage(doc, numero, r, OPS);
    const morceaux = [];
    let sommeConfiance = 0;
    let poids = 0;
    for (const image of images) {
      const png = preparer(image, largeurPagePt, r);
      if (!png) continue;
      let resultat;
      try {
        resultat = await moteur.recognize(png, {}, { text: true, blocks: true });
      } catch {
        throw new ErreurCode("OCR_ECHEC");
      }
      const lu = lignesRetenues(resultat?.data, r.confianceLigneMin);
      if (lu.texte.trim().length > 0) {
        morceaux.push(lu.texte.replace(/\s+$/, ""));
        sommeConfiance += lu.sommeConfiance;
        poids += lu.poids;
      }
    }
    const texte = morceaux.join("\n");
    if (texte.length > r.caracteresParPage) throw new ErreurCode("PLAFOND_TEXTE");
    totalCaracteres += texte.length;
    if (totalCaracteres > r.caracteresParDocument) throw new ErreurCode("PLAFOND_TEXTE");
    const confiance_pm =
      poids > 0 ? Math.max(0, Math.min(1000, Math.round((sommeConfiance / poids) * 10))) : 0;
    await envoyer({ type: "page", numero, texte, confiance_pm });
  }
  try {
    await moteur.terminate();
    await doc.loadingTask.destroy();
  } catch {
    // Le processus s'arrête de toute façon.
  }
}

process.once("message", (message) => {
  if (message?.type !== "travail") {
    void conclure({ type: "erreur", code: "OCR_ECHEC" });
    return;
  }
  travailler(message).then(
    () => conclure({ type: "fin" }),
    (erreur) =>
      conclure({
        type: "erreur",
        code: erreur instanceof ErreurCode ? erreur.code : "OCR_ECHEC",
      }),
  );
});

void envoyer({ type: "pret" });
