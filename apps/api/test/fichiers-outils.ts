import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createDatabase } from "../src/db/pool.js";
import type { Api } from "./api.js";
import { configTest, proprietaire, type Contexte } from "./helpers.js";

/** Contexte de test dont le stockage vit dans un dossier temporaire dédié, effacé à la fin. */
export async function demarrerAvecStockage(
  surcharge: Partial<Config> = {},
): Promise<Contexte & { dossier: string }> {
  const dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-d1-stockage-"));
  const config = { ...configTest(), STORAGE_DIR: dossier, ...surcharge };
  const db = createDatabase(config);
  const app = await buildApp(config, db);
  return {
    config,
    db,
    app,
    dossier,
    fermer: async () => {
      await app.close();
      await db.close();
      await rm(dossier, { recursive: true, force: true });
    },
  };
}

/** Corps multipart/form-data d'un seul fichier (champ « fichier » par défaut). */
export function multipart(
  nom: string,
  contenu: Buffer,
  options: { champ?: string; type?: string } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const frontiere = `----mp${Math.random().toString(16).slice(2)}`;
  const entete =
    `--${frontiere}\r\n` +
    `Content-Disposition: form-data; name="${options.champ ?? "fichier"}"; filename="${nom}"\r\n` +
    `Content-Type: ${options.type ?? "application/octet-stream"}\r\n\r\n`;
  return {
    payload: Buffer.concat([
      Buffer.from(entete, "utf8"),
      contenu,
      Buffer.from(`\r\n--${frontiere}--\r\n`, "utf8"),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${frontiere}` },
  };
}

/** Téléverse vers `url` (POST multipart) avec la session de `api`. */
export function televerser(
  api: Api,
  url: string,
  nom: string,
  contenu: Buffer,
  options: { champ?: string; type?: string } = {},
) {
  const m = multipart(nom, contenu, options);
  return api.brut({ method: "POST", url, payload: m.payload, headers: m.headers });
}

/** Archive ZIP « stockée » (sans compression) : de quoi simuler un document Office. */
export function zip(entrees: Record<string, string>): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const [nom, texte] of Object.entries(entrees)) {
    const n = Buffer.from(nom, "utf8");
    const donnees = Buffer.from(texte, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(donnees.length, 18);
    local.writeUInt32LE(donnees.length, 22);
    local.writeUInt16LE(n.length, 26);
    locaux.push(local, n, donnees);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(donnees.length, 20);
    central.writeUInt32LE(donnees.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(decalage, 42);
    centraux.push(central, n);
    decalage += 30 + n.length + donnees.length;
  }
  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(entrees).length, 8);
  fin.writeUInt16LE(Object.keys(entrees).length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

const TYPES_OFFICE = '<?xml version="1.0"?><Types/>';

/** Échantillons de contenus (signatures réelles, corps minimal). */
export const ECHANTILLONS = {
  pdf: (texte = "rapport") =>
    Buffer.from(
      `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${texte}\ntrailer << >>\n%%EOF\n`,
    ),
  pdfActif: () =>
    Buffer.from("%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n"),
  png: () =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]),
  jpeg: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]),
  webp: () =>
    Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x20, 0, 0, 0]),
      Buffer.from("WEBPVP8 "),
      Buffer.alloc(16),
    ]),
  docx: () => zip({ "[Content_Types].xml": TYPES_OFFICE, "word/document.xml": "<w:document/>" }),
  xlsx: () => zip({ "[Content_Types].xml": TYPES_OFFICE, "xl/workbook.xml": "<workbook/>" }),
  pptx: () =>
    zip({ "[Content_Types].xml": TYPES_OFFICE, "ppt/presentation.xml": "<presentation/>" }),
  docm: () =>
    zip({
      "[Content_Types].xml": TYPES_OFFICE,
      "word/document.xml": "<w:document/>",
      "word/vbaProject.bin": "macro",
    }),
  archive: () => zip({ "lisez-moi.txt": "bonjour", "outil.exe": "MZ" }),
  exe: () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0x90)]),
  elf: () => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(32)]),
  csv: () => Buffer.from("date;libelle;montant\n2026-10-05;Taxi;15000\n"),
  txt: () => Buffer.from("Compte rendu de réunion\n"),
  svg: () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  html: () => Buffer.from("<!doctype html><html><body>x</body></html>"),
};

/** Marque supprimés les orphelins des cabinets de test (la purge des autres fichiers ne les verra pas). */
export function marquerOrphelins(cabinetIds: string[]) {
  return proprietaire((cl) =>
    cl.query(
      `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif)
       SELECT cabinet_id, id, 'orphelin' FROM fichiers
       WHERE cabinet_id = ANY ($1::uuid[]) AND fichier_orphelin(id)`,
      [cabinetIds],
    ),
  );
}
