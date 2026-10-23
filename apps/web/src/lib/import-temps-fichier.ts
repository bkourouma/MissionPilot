/** Import des temps : contrôle local du fichier choisi (format, taille). */
import { IMPORT_TEMPS_MAX_LIGNES, type TypeFichier } from "@missionpilot/shared";
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

export const LIMITES: Record<FormatImport, { octets: number; libelle: string }> = {
  xlsx: { octets: IMPORT_EXCEL_MAX_OCTETS, libelle: "2 Mo au plus pour un classeur Excel" },
  csv: { octets: IMPORT_CSV_MAX_OCTETS, libelle: "1 Mo au plus pour un fichier CSV" },
};

/** Formats voisins refusés, avec la marche à suivre (Map : pas de clé héritée d'Object). */
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
export function controlerFichierImport(f: { name: string; size: number }): ControleImport {
  const format = formatDe(f.name);
  if (!format) {
    return { ok: false, message: AUTRES_FORMATS.get(extensionDe(f.name)) ?? FORMAT_NON_ACCEPTE };
  }
  if (f.size <= 0) return { ok: false, message: "Ce fichier est vide : choisissez-en un autre." };
  const limite = LIMITES[format];
  if (f.size > limite.octets) {
    return {
      ok: false,
      message: `Fichier trop volumineux (${formaterTaille(f.size)}) : ${limite.libelle}. Découpez l'historique en plusieurs fichiers.`,
    };
  }
  return { ok: true, format };
}
