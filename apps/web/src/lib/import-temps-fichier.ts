/** Import des temps : contrôle local du fichier choisi (format, taille). */
import {
  creerTraduire,
  IMPORT_TEMPS_MAX_LIGNES,
  type Langue,
  type TypeFichier,
} from "@missionpilot/shared";
import { extensionDe, formaterTaille } from "./fichiers";
import { formaterNombre } from "./format";
import { IMPORT_MAX_OCTETS_FICHIER } from "./temps-admin";

export type FormatImport = "xlsx" | "csv";

// --- Contrôle local du fichier -------------------------------------------------------------------

/** Plafond d'un classeur, égal à celui de l'API (`IMPORT_EXCEL_TAILLE_MAX`) : 2 Mio. */
export const IMPORT_EXCEL_MAX_OCTETS = 2 * 1024 * 1024;
/** Plafond d'un CSV : il part en JSON, dans un corps de 1 Mio au plus côté API. */
export const IMPORT_CSV_MAX_OCTETS = IMPORT_MAX_OCTETS_FICHIER;

export const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Types proposés au choix de fichier (sous-ensemble de la liste blanche partagée). */
export const TYPES_IMPORT: readonly TypeFichier[] = [TYPE_XLSX, "text/csv"];

export const AIDE_FICHIER_IMPORT =
  `Classeur Excel .xlsx (2 Mo au plus) ou fichier CSV encodé en UTF-8 (1 Mo au plus), ` +
  `${formaterNombre(IMPORT_TEMPS_MAX_LIGNES, 0)} lignes au plus. Un ancien classeur .xls ` +
  `s'enregistre d'abord au format « Classeur Excel (.xlsx) ».`;

export const aideFichierImport = (langue: Langue = "fr") =>
  langue === "en"
    ? `Excel workbook .xlsx (2 MB maximum) or UTF-8 encoded CSV file (1 MB maximum), ` +
      `${formaterNombre(IMPORT_TEMPS_MAX_LIGNES, 0, "en")} rows maximum. An old .xls workbook ` +
      `must first be saved as "Excel Workbook (.xlsx)".`
    : AIDE_FICHIER_IMPORT;

export const LIMITES: Record<FormatImport, { octets: number; libelle: string }> = {
  xlsx: { octets: IMPORT_EXCEL_MAX_OCTETS, libelle: "2 Mo au plus pour un classeur Excel" },
  csv: { octets: IMPORT_CSV_MAX_OCTETS, libelle: "1 Mo au plus pour un fichier CSV" },
};

const LIMITES_EN: Record<FormatImport, string> = {
  xlsx: "2 MB maximum for an Excel workbook",
  csv: "1 MB maximum for a CSV file",
};

/** Libellé de la limite d'un format, dans la langue demandée. */
export const libelleLimite = (format: FormatImport, langue: Langue = "fr") =>
  langue === "en" ? LIMITES_EN[format] : LIMITES[format].libelle;

/** Taille lisible (ko / Mo en français, KB / MB en anglais). */
function tailleLisible(octets: number, langue: Langue): string {
  if (langue !== "en") return formaterTaille(octets);
  if (!Number.isFinite(octets) || octets < 0) return "—";
  if (octets < 1024) return `${octets} byte${octets > 1 ? "s" : ""}`;
  if (octets < 1024 * 1024)
    return `${formaterNombre(Math.max(1, Math.round(octets / 1024)), 0, "en")} KB`;
  return `${formaterNombre(octets / (1024 * 1024), 1, "en")} MB`;
}

/** Formats voisins refusés, avec la marche à suivre (Map : pas de clé héritée d'Object). */
const AUTRES_FORMATS_EN = new Map<string, string>([
  [
    "xls",
    'Old Excel format (.xls) is not supported: open the file in Excel and save it as "Excel Workbook (.xlsx)".',
  ],
  ["xlsm", 'Macro-enabled workbook (.xlsm) rejected: save it as "Excel Workbook (.xlsx)".'],
  ["xlsb", 'Binary workbook (.xlsb) is not supported: save it as "Excel Workbook (.xlsx)".'],
  ["ods", "OpenDocument workbook (.ods) is not supported: save it as .xlsx or .csv."],
]);

const AUTRES_FORMATS = new Map<string, string>([
  [
    "xls",
    "Ancien format Excel (.xls) non pris en charge : ouvrez le fichier dans Excel et enregistrez-le au format « Classeur Excel (.xlsx) ».",
  ],
  [
    "xlsm",
    "Classeur à macros (.xlsm) refusé : enregistrez-le au format « Classeur Excel (.xlsx) ».",
  ],
  [
    "xlsb",
    "Classeur binaire (.xlsb) non pris en charge : enregistrez-le au format « Classeur Excel (.xlsx) ».",
  ],
  [
    "ods",
    "Classeur OpenDocument (.ods) non pris en charge : enregistrez-le au format .xlsx ou .csv.",
  ],
]);

const FORMAT_NON_ACCEPTE =
  "Format non accepté : choisissez un classeur Excel (.xlsx) ou un fichier CSV (.csv).";
const FORMAT_NON_ACCEPTE_EN =
  "Format not accepted: choose an Excel workbook (.xlsx) or a CSV file (.csv).";

/** Format d'import d'après l'extension du nom, ou `null`. */
export function formatDe(nom: string): FormatImport | null {
  const ext = extensionDe(nom);
  return ext === "xlsx" || ext === "csv" ? ext : null;
}

export type ControleImport = { ok: true; format: FormatImport } | { ok: false; message: string };

/**
 * Contrôle local d'un fichier choisi : extension .xlsx ou .csv, non vide, sous le plafond de son
 * format. Le type MIME annoncé par le navigateur n'est pas cru ; l'API détecte le vrai format.
 */
export function controlerFichierImport(
  f: { name: string; size: number },
  langue: Langue = "fr",
): ControleImport {
  const t = creerTraduire(langue);
  const format = formatDe(f.name);
  if (!format) {
    const autres = langue === "en" ? AUTRES_FORMATS_EN : AUTRES_FORMATS;
    const defaut = langue === "en" ? FORMAT_NON_ACCEPTE_EN : FORMAT_NON_ACCEPTE;
    return { ok: false, message: autres.get(extensionDe(f.name)) ?? defaut };
  }
  if (f.size <= 0)
    return {
      ok: false,
      message: t(
        "Ce fichier est vide : choisissez-en un autre.",
        "This file is empty: choose another one.",
      ),
    };
  const limite = LIMITES[format];
  if (f.size > limite.octets) {
    return {
      ok: false,
      message: t(
        `Fichier trop volumineux (${tailleLisible(f.size, langue)}) : ${libelleLimite(format, langue)}. Découpez l'historique en plusieurs fichiers.`,
        `File too large (${tailleLisible(f.size, langue)}): ${libelleLimite(format, langue)}. Split the history into several files.`,
      ),
    };
  }
  return { ok: true, format };
}
