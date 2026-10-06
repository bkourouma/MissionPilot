import { EXTENSIONS_FICHIER, type TypeFichier } from "@missionpilot/shared";
import { AppError } from "../errors.js";

/*
 * Détection du type d'un fichier par son CONTENU (signatures « magiques »),
 * jamais par l'en-tête Content-Type ni par la seule extension. Liste
 * blanche : PDF, PNG, JPEG, WebP, DOCX, XLSX, PPTX, CSV, TXT. Tout le reste
 * est refusé, en particulier :
 * - les archives (ZIP qui n'est pas un document Office Open XML, RAR, 7z,
 *   gzip…) et les exécutables (PE « MZ », ELF, Mach-O, scripts « #! ») ;
 * - les documents Office à macros (vbaProject.bin) ou à objets binaires
 *   embarqués (oleObject*.bin, .exe…) ;
 * - le balisage actif servi comme texte (HTML, SVG, XML) ;
 * - un PDF portant des actions actives visibles (JavaScript, Launch, fichier
 *   embarqué). Les flux compressés ne sont pas décompressés : c'est une
 *   barrière de premier niveau, pas un antivirus (hors périmètre, voir
 *   SECURITY.md).
 * L'extension du nom doit correspondre au type détecté (« .exe » renommé en
 * « .pdf » : refusé par le contenu ; PDF nommé « .png » : refusé).
 */

export const refusType = (message: string) => new AppError(415, "TYPE_FICHIER_REFUSE", message);

const MOTIF_OFFICE: Record<string, TypeFichier> = {
  "word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "ppt/presentation.xml":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Entrées d'archive Office refusées : macros, objets OLE, binaires exécutables ou scripts. */
const ENTREE_DANGEREUSE =
  /(^|\/)vbaProject\.bin$|(^|\/)embeddings\/.*\.bin$|\.(exe|dll|com|scr|msi|bat|cmd|ps1|vbs|js|jar|sh)$/i;

function commencePar(contenu: Buffer, octets: readonly number[], decalage = 0): boolean {
  if (contenu.length < decalage + octets.length) return false;
  return octets.every((o, i) => contenu[decalage + i] === o);
}

const ascii = (texte: string) => [...texte].map((c) => c.charCodeAt(0));

/** Noms des entrées du répertoire central d'une archive ZIP, ou null si illisible. */
export function entreesZip(contenu: Buffer): string[] | null {
  // Fin du répertoire central : signature 0x06054b50 dans les 65 557 derniers octets.
  const debut = Math.max(0, contenu.length - 65_557);
  let fin = -1;
  for (let i = contenu.length - 22; i >= debut; i--) {
    if (contenu.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return null;
  const nombre = contenu.readUInt16LE(fin + 10);
  const taille = contenu.readUInt32LE(fin + 12);
  const decalage = contenu.readUInt32LE(fin + 16);
  // ZIP64 ou valeurs incohérentes : refus (un document Office de 15 Mo n'en a pas besoin).
  if (nombre === 0xffff || decalage === 0xffffffff || decalage + taille > fin) return null;
  const noms: string[] = [];
  let p = decalage;
  for (let n = 0; n < nombre; n++) {
    if (p + 46 > contenu.length || contenu.readUInt32LE(p) !== 0x02014b50) return null;
    const lNom = contenu.readUInt16LE(p + 28);
    const lExtra = contenu.readUInt16LE(p + 30);
    const lCommentaire = contenu.readUInt16LE(p + 32);
    if (p + 46 + lNom > contenu.length) return null;
    noms.push(contenu.subarray(p + 46, p + 46 + lNom).toString("utf8"));
    p += 46 + lNom + lExtra + lCommentaire;
    if (noms.length > 10_000) return null;
  }
  return noms;
}

function typeOffice(contenu: Buffer): TypeFichier {
  const noms = entreesZip(contenu);
  if (!noms || !noms.includes("[Content_Types].xml")) {
    throw refusType("Les archives (ZIP, etc.) ne sont pas acceptées.");
  }
  if (noms.some((n) => ENTREE_DANGEREUSE.test(n))) {
    throw refusType("Document refusé : macros ou objets binaires embarqués.");
  }
  const types = Object.entries(MOTIF_OFFICE)
    .filter(([motif]) => noms.includes(motif))
    .map(([, type]) => type);
  if (types.length !== 1) throw refusType("Les archives (ZIP, etc.) ne sont pas acceptées.");
  return types[0] as TypeFichier;
}

/** Noms PDF actifs, après décodage des échappements « #xx » des noms. */
const PDF_ACTIF = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia)(?![A-Za-z0-9])/;

function verifierPdf(contenu: Buffer): void {
  const texte = contenu
    .toString("latin1")
    .replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  if (PDF_ACTIF.test(texte)) {
    throw refusType("PDF refusé : il contient du contenu actif (script, lancement, pièce jointe).");
  }
}

const BALISAGE = /<\s*(script|html|svg|iframe|object|embed|body|\?xml|!doctype)\b/i;

function estTexte(contenu: Buffer): boolean {
  for (const o of contenu) {
    // Contrôles C0 refusés hors tabulation, sauts de ligne et saut de page ; DEL refusé.
    if ((o < 0x20 && o !== 0x09 && o !== 0x0a && o !== 0x0c && o !== 0x0d) || o === 0x7f) {
      return false;
    }
  }
  return true;
}

/** Type détecté d'après le contenu seul (liste blanche), ou erreur 415. */
export function detecterContenu(contenu: Buffer, extension: string): TypeFichier {
  if (contenu.length === 0) throw new AppError(400, "FICHIER_VIDE", "Le fichier est vide.");
  if (commencePar(contenu, ascii("%PDF-"))) {
    verifierPdf(contenu);
    return "application/pdf";
  }
  if (commencePar(contenu, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (commencePar(contenu, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (commencePar(contenu, ascii("RIFF")) && commencePar(contenu, ascii("WEBP"), 8)) {
    return "image/webp";
  }
  if (commencePar(contenu, [0x50, 0x4b, 0x03, 0x04])) return typeOffice(contenu);
  if (commencePar(contenu, ascii("MZ")) || commencePar(contenu, [0x7f, 0x45, 0x4c, 0x46])) {
    throw refusType("Les exécutables ne sont pas acceptés.");
  }
  if (commencePar(contenu, ascii("#!"))) throw refusType("Les scripts ne sont pas acceptés.");
  // Texte : CSV ou TXT selon l'extension (le contenu ne les distingue pas).
  const corps = contenu.subarray(commencePar(contenu, [0xef, 0xbb, 0xbf]) ? 3 : 0);
  if (estTexte(corps)) {
    if (BALISAGE.test(corps.toString("utf8"))) {
      throw refusType("Le balisage HTML, SVG ou XML n'est pas accepté.");
    }
    return extension === "csv" ? "text/csv" : "text/plain";
  }
  throw refusType(
    "Type de fichier non accepté (PDF, PNG, JPEG, WebP, DOCX, XLSX, PPTX, CSV ou TXT).",
  );
}

/**
 * Type détecté et contrôlé contre l'extension du nom : renvoie le type et
 * l'extension à retenir (celle du nom, ou l'extension principale du type si
 * le nom n'en a pas).
 */
export function detecterType(
  contenu: Buffer,
  extension: string,
): { type: TypeFichier; extension: string } {
  const type = detecterContenu(contenu, extension);
  const admises = EXTENSIONS_FICHIER[type];
  if (extension === "") return { type, extension: admises[0] as string };
  if (!admises.includes(extension)) {
    throw refusType("L'extension du nom ne correspond pas au contenu du fichier.");
  }
  return { type, extension };
}
