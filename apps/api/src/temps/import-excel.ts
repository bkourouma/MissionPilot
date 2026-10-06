import { crc32, inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { IMPORT_TEMPS_MAX_LIGNES } from "@missionpilot/shared";
import { AppError } from "../errors.js";
import type { LigneTableau, TableauImport } from "./import.js";

/*
 * Lecture d'un classeur Excel .xlsx pour l'import de l'historique des temps
 * (TPS-10). Le fichier est une entrée NON FIABLE ; il est contrôlé avant
 * d'être confié à ExcelJS :
 *
 * 1. taille bornée, signature ZIP exigée (un .xls ou un classeur chiffré par
 *    mot de passe, au format OLE, est refusé avec un message dédié) ;
 * 2. archive relue par notre propre lecteur ZIP : répertoire central cohérent
 *    et ENTIÈREMENT consommé (JSZip, le lecteur d'ExcelJS, lit les en-têtes
 *    tant que leur signature se répète, au-delà du nombre annoncé), pas de
 *    ZIP64, de chiffrement, de nom ambigu, de doublon, d'entrées qui se
 *    chevauchent ou qui empiètent sur le répertoire ; chaque entrée est
 *    décompressée avec un plafond égal à sa taille annoncée (une taille
 *    mensongère est refusée), le total décompressé et le taux de compression
 *    sont plafonnés (archive piégée) ;
 * 3. contenu, pour toute entrée hors média binaire (ExcelJS reconnaît ses
 *    entrées par des motifs non ancrés) : classeur et feuilles non protégés,
 *    aucune liaison externe ni connexion de données, aucune macro, aucune DTD
 *    (entités XML), éléments annexes de 1 Mio au plus, nombre de feuilles, de
 *    lignes, de cellules, de textes partagés et de styles borné ; les balises
 *    sont examinées en temps linéaire (aucune regex à retour arrière) ;
 * 4. ExcelJS reçoit une archive RECONSTRUITE à partir des seules entrées
 *    validées, jamais le fichier d'origine ; au plus
 *    `IMPORT_EXCEL_LECTURES_SIMULTANEES_MAX` lectures à la fois par instance ;
 * 5. ExcelJS ne fait que lire : les formules ne sont JAMAIS évaluées, seule
 *    la valeur en cache (calculée par Excel à l'enregistrement) est retenue ;
 *    aucune cellule n'est interprétée comme du code, tout devient du texte
 *    validé ensuite par le même pipeline que le CSV (`importerTableau`).
 *
 * Les messages d'erreur ne citent ni le nom du fichier, ni un chemin, ni le
 * message interne d'une bibliothèque.
 */

/** Taille maximale du fichier téléversé : 2 Mio. */
export const IMPORT_EXCEL_TAILLE_MAX = 2 * 1024 * 1024;
/** Taille décompressée maximale de l'archive (toutes entrées) : 16 Mio. */
export const IMPORT_EXCEL_DECOMPRESSE_MAX = 16 * 1024 * 1024;
/** Taux de compression maximal d'une entrée de plus de `SEUIL_RATIO` octets. */
export const IMPORT_EXCEL_RATIO_MAX = 100;
const SEUIL_RATIO = 256 * 1024;
/** Entrées de l'archive au plus. */
export const IMPORT_EXCEL_ENTREES_MAX = 200;
/** Feuilles du classeur au plus (seule la première feuille visible est lue). */
export const IMPORT_EXCEL_FEUILLES_MAX = 10;
/** Colonnes renseignées au plus (lettre AD). */
export const IMPORT_EXCEL_COLONNES_MAX = 30;
/** Lignes et cellules stockées dans l'ensemble des feuilles, mises en forme comprises. */
export const IMPORT_EXCEL_LIGNES_XML_MAX = 4 * IMPORT_TEMPS_MAX_LIGNES;
export const IMPORT_EXCEL_CELLULES_MAX = 100_000;
/** Longueur maximale du texte d'une cellule. */
export const IMPORT_EXCEL_CELLULE_CARACTERES_MAX = 200;
/** Styles (formats de cellule, polices, remplissages, bordures…) au plus dans xl/styles.xml. */
export const IMPORT_EXCEL_STYLES_MAX = 20_000;
/** Taille maximale d'une entrée hors feuilles, textes partagés et médias : 1 Mio. */
export const IMPORT_EXCEL_ANNEXE_MAX = 1024 * 1024;
/** Lectures Excel simultanées au plus, par instance de l'API (mémoire d'ExcelJS). */
export const IMPORT_EXCEL_LECTURES_SIMULTANEES_MAX = 2;
/** Longueur maximale d'une balise examinée (relation, partage du classeur). */
const BALISE_CARACTERES_MAX = 4096;

export const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const refus = (message: string) => new AppError(400, "EXCEL_INVALIDE", message);
const illisible = () =>
  refus("Classeur Excel illisible : enregistrer le fichier au format .xlsx puis réessayer.");
const piege = () =>
  refus(
    "Archive refusée : taille décompressée ou taux de compression hors limites " +
      `(${IMPORT_EXCEL_DECOMPRESSE_MAX / (1024 * 1024)} Mo décompressés au plus).`,
  );
export const tropVolumineux = () =>
  new AppError(
    413,
    "FICHIER_TROP_VOLUMINEUX",
    `Fichier trop volumineux : ${IMPORT_EXCEL_TAILLE_MAX / (1024 * 1024)} Mo au plus.`,
  );
const occupe = () =>
  new AppError(
    503,
    "IMPORT_EXCEL_OCCUPE",
    "Trop d'imports Excel en cours : réessayer dans quelques instants.",
  );

/* ----- Lecteur ZIP borné ----- */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_FIN = 0x06054b50;
/** Signature OLE (CFB) : .xls ou classeur .xlsx chiffré par mot de passe. */
const SIG_OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

interface EntreeZip {
  nom: string;
  methode: number;
  compresse: number;
  taille: number;
  decalage: number;
}

/** Nom d'entrée sans ambiguïté : ASCII imprimable, ni « / » initial, ni « \ », ni « .. ». */
const NOM_SUR = /^[\x20-\x7e]+$/;
const nomAmbigu = (nom: string) =>
  !NOM_SUR.test(nom) || nom.startsWith("/") || nom.includes("\\") || nom.split("/").includes("..");

/** Répertoire central vérifié et position de son début. */
interface Repertoire {
  entrees: EntreeZip[];
  debut: number;
}

/** Répertoire central, vérifié (une seule lecture possible de l'archive). */
function lireRepertoire(buf: Buffer): Repertoire {
  if (buf.length < 22) throw illisible();
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw illisible();
  const nombre = buf.readUInt16LE(fin + 10);
  const tailleRepertoire = buf.readUInt32LE(fin + 12);
  const debutRepertoire = buf.readUInt32LE(fin + 16);
  if (
    buf.readUInt16LE(fin + 4) !== 0 ||
    buf.readUInt16LE(fin + 6) !== 0 ||
    buf.readUInt16LE(fin + 8) !== nombre ||
    nombre === 0xffff ||
    // Répertoire collé à l'enregistrement de fin, lui-même en fin d'archive (commentaire
    // déclaré compris) : aucun octet ajouté ni ZIP64.
    debutRepertoire + tailleRepertoire !== fin ||
    fin + 22 + buf.readUInt16LE(fin + 20) !== buf.length
  ) {
    throw illisible();
  }
  if (nombre > IMPORT_EXCEL_ENTREES_MAX) {
    throw refus(`Classeur refusé : plus de ${IMPORT_EXCEL_ENTREES_MAX} éléments dans l'archive.`);
  }
  const entrees: EntreeZip[] = [];
  const noms = new Set<string>();
  let p = debutRepertoire;
  for (let n = 0; n < nombre; n++) {
    if (p + 46 > fin || buf.readUInt32LE(p) !== SIG_CENTRAL) throw illisible();
    const drapeaux = buf.readUInt16LE(p + 8);
    const methode = buf.readUInt16LE(p + 10);
    const compresse = buf.readUInt32LE(p + 20);
    const taille = buf.readUInt32LE(p + 24);
    const longueurNom = buf.readUInt16LE(p + 28);
    const longueurExtra = buf.readUInt16LE(p + 30);
    const longueurCommentaire = buf.readUInt16LE(p + 32);
    const decalage = buf.readUInt32LE(p + 42);
    const finEntree = p + 46 + longueurNom + longueurExtra + longueurCommentaire;
    if (finEntree > fin) throw illisible();
    if (drapeaux & 0x1) {
      throw refus("Classeur protégé par mot de passe : enregistrer une copie sans mot de passe.");
    }
    if ((methode !== 0 && methode !== 8) || compresse === 0xffffffff || taille === 0xffffffff) {
      throw illisible();
    }
    // Champs extra : ni ZIP64 (0x0001) ni nom Unicode de substitution (0x7075).
    for (let e = p + 46 + longueurNom; e + 4 <= p + 46 + longueurNom + longueurExtra;) {
      const id = buf.readUInt16LE(e);
      if (id === 0x0001 || id === 0x7075) throw illisible();
      e += 4 + buf.readUInt16LE(e + 2);
    }
    const nom = buf.toString("latin1", p + 46, p + 46 + longueurNom);
    if (nomAmbigu(nom) || noms.has(nom)) throw illisible();
    noms.add(nom);
    entrees.push({ nom, methode, compresse, taille, decalage });
    p = finEntree;
  }
  // Répertoire ENTIÈREMENT consommé : JSZip lit les en-têtes centraux tant que leur
  // signature se répète, sans s'arrêter au nombre annoncé ; un en-tête au-delà
  // ajouterait (ou remplacerait) une entrée qui échapperait à tous les contrôles.
  if (p !== fin) throw illisible();
  return { entrees, debut: debutRepertoire };
}

/**
 * Décompresse toutes les entrées sous plafonds (total, taux, taille annoncée)
 * et renvoie leur contenu. Toute incohérence refuse l'archive.
 */
export function lireArchive(buf: Buffer): Map<string, Buffer> {
  const { entrees, debut: debutRepertoire } = lireRepertoire(buf);
  // Les données des entrées s'arrêtent avant le répertoire central (pas de recouvrement).
  const finDonneesMax = debutRepertoire;
  let total = 0;
  for (const e of entrees) {
    total += e.taille;
    if (total > IMPORT_EXCEL_DECOMPRESSE_MAX) throw piege();
    if (e.taille > SEUIL_RATIO && e.taille > e.compresse * IMPORT_EXCEL_RATIO_MAX) throw piege();
  }
  const contenus = new Map<string, Buffer>();
  let finPrecedente = 0;
  for (const e of [...entrees].sort((x, y) => x.decalage - y.decalage)) {
    // Entrées disjointes et dans l'ordre : pas de données partagées (archive piégée).
    if (e.decalage < finPrecedente || e.decalage + 30 > finDonneesMax) throw illisible();
    if (buf.readUInt32LE(e.decalage) !== SIG_LOCAL) throw illisible();
    const longueurNom = buf.readUInt16LE(e.decalage + 26);
    const longueurExtra = buf.readUInt16LE(e.decalage + 28);
    if (buf.toString("latin1", e.decalage + 30, e.decalage + 30 + longueurNom) !== e.nom) {
      throw illisible();
    }
    const debut = e.decalage + 30 + longueurNom + longueurExtra;
    const finDonnees = debut + e.compresse;
    if (finDonnees > finDonneesMax) throw illisible();
    finPrecedente = finDonnees;
    const brut = buf.subarray(debut, finDonnees);
    let donnees: Buffer;
    if (e.methode === 0) {
      if (e.compresse !== e.taille) throw illisible();
      donnees = brut;
    } else {
      try {
        // Plafond = taille annoncée : un flux qui décompresse plus est refusé.
        donnees = inflateRawSync(brut, { maxOutputLength: Math.max(e.taille, 1) });
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw piege();
        throw illisible();
      }
      if (donnees.length !== e.taille) throw illisible();
    }
    contenus.set(e.nom, donnees);
  }
  return contenus;
}

/** Date DOS du 1er janvier 1980 (heure nulle) : aucune métadonnée reprise du fichier. */
const DATE_DOS = 0x21;

/**
 * Archive « stockée » (sans compression) reconstruite à partir des seules entrées
 * validées : ExcelJS ne reçoit jamais le fichier d'origine, donc aucune entrée ni aucun
 * octet que notre lecteur n'a pas contrôlé, quel que soit l'écart d'interprétation du
 * format ZIP entre lui et JSZip (défense en profondeur).
 */
export function reconstruireArchive(contenus: Map<string, Buffer>): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const [nom, donnees] of contenus) {
    const n = Buffer.from(nom, "latin1");
    const somme = crc32(donnees);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(DATE_DOS, 12);
    local.writeUInt32LE(somme, 14);
    local.writeUInt32LE(donnees.length, 18);
    local.writeUInt32LE(donnees.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(DATE_DOS, 14);
    central.writeUInt32LE(somme, 16);
    central.writeUInt32LE(donnees.length, 20);
    central.writeUInt32LE(donnees.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(decalage, 42);
    locaux.push(local, n, donnees);
    centraux.push(central, n);
    decalage += 30 + n.length + donnees.length;
  }
  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(SIG_FIN, 0);
  fin.writeUInt16LE(contenus.size, 8);
  fin.writeUInt16LE(contenus.size, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

/* ----- Contrôles du contenu OOXML ----- */

/**
 * Occurrences de `motif` (drapeau g) dans `texte`, comptées sans tableau intermédiaire et
 * au plus jusqu'à `plafond` + 1 : le décompte s'arrête dès que la borne est dépassée.
 */
function compter(texte: string, motif: RegExp, plafond: number): number {
  let n = 0;
  motif.lastIndex = 0;
  while (n <= plafond && motif.exec(texte) !== null) n++;
  return n;
}

/**
 * Ouverture de balise `<nom` ou `<prefixe:nom` (`noms` : alternatives). Préfixe borné : le
 * moteur ne revient en arrière que d'au plus 32 caractères par « < ».
 */
const balise = (noms: string, drapeaux = "") =>
  new RegExp(`<(?:[\\w.-]{1,32}:)?(?:${noms})\\b`, drapeaux);

/** Médias binaires : lus tels quels par ExcelJS, jamais analysés comme du XML. */
const MEDIA = /^xl\/media\/[A-Za-z0-9]+\.[A-Za-z0-9]{3,4}$/;
/** Seules entrées admises au-delà de `IMPORT_EXCEL_ANNEXE_MAX` (avec les médias). */
const VOLUMINEUSE = /^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml)$/;

/**
 * Balises `<nom …>` de `texte`, jusqu'au premier « > », en temps linéaire (aucune regex à
 * retour arrière) : une balise non fermée ou de plus de `BALISE_CARACTERES_MAX`
 * caractères rend le classeur illisible.
 */
function balises(texte: string, noms: string): string[] {
  const ouverture = balise(noms, "g");
  const trouvees: string[] = [];
  for (let m = ouverture.exec(texte); m !== null; m = ouverture.exec(texte)) {
    const fin = texte.indexOf(">", m.index);
    if (fin < 0 || fin - m.index > BALISE_CARACTERES_MAX) throw illisible();
    trouvees.push(texte.slice(m.index, fin + 1));
    ouverture.lastIndex = fin + 1;
  }
  return trouvees;
}

/**
 * Entrées à contrôler comme du texte : toutes sauf les médias. ExcelJS décode chaque
 * entrée et reconnaît feuilles, relations et dessins par des motifs NON ancrés
 * (« xl/worksheets/sheet2.xml.bak » est lu comme une feuille) : filtrer par extension
 * laisserait passer des entrées analysées. Taille bornée hors feuilles et textes partagés.
 */
function textesControles(contenus: Map<string, Buffer>): Map<string, string> {
  const textes = new Map<string, string>();
  for (const [nom, donnees] of contenus) {
    if (MEDIA.test(nom)) continue;
    if (donnees.length > IMPORT_EXCEL_ANNEXE_MAX && !VOLUMINEUSE.test(nom)) {
      const mo = IMPORT_EXCEL_ANNEXE_MAX / (1024 * 1024);
      throw refus(
        `Classeur refusé : un élément de l'archive fait plus de ${mo} Mo ` +
          "(hors feuilles, textes et images).",
      );
    }
    textes.set(nom, donnees.toString("utf8"));
  }
  return textes;
}

/** Refuse ce qu'un classeur d'historique n'a pas à contenir, et borne sa taille. */
function controlerContenu(contenus: Map<string, Buffer>): void {
  const textes = textesControles(contenus);
  const classeur = textes.get("xl/workbook.xml");
  if (!textes.has("[Content_Types].xml") || classeur === undefined) {
    throw refus("Le fichier n'est pas un classeur Excel .xlsx.");
  }
  // Protection en écriture : attribut de `<fileSharing>`, propre à xl/workbook.xml.
  for (const partage of balises(classeur, "fileSharing")) {
    if (/reservationPassword|hashValue/.test(partage)) {
      throw refus("Classeur protégé en écriture : retirer la protection avant l'import.");
    }
  }
  for (const texte of textes.values()) {
    // Pas de DTD : aucune entité XML (expansion exponentielle, entités externes).
    if (/<!DOCTYPE|<!ENTITY/i.test(texte)) throw illisible();
    if (balise("workbookProtection|sheetProtection").test(texte)) {
      throw refus("Classeur ou feuille protégé : retirer la protection avant l'import.");
    }
    // Relations de toute entrée (ExcelJS lit des .rels sous des noms non ancrés).
    for (const relation of balises(texte, "Relationship")) {
      const externe = /TargetMode\s*=\s*["']External["']/i.test(relation);
      const lien = /Type\s*=\s*["'][^"']*\/hyperlink["']/i.test(relation);
      if (externe && !lien) throw refus("Classeur refusé : il contient des liaisons externes.");
    }
  }
  controlerNoms(contenus, textes);
  controlerVolume(classeur, textes);
}

/** Liaisons externes, connexions de données et macros, repérées par nom d'entrée. */
function controlerNoms(contenus: Map<string, Buffer>, textes: Map<string, string>): void {
  for (const nom of contenus.keys()) {
    if (/(^|\/)(externalLinks\/|connections\.xml$|queryTables\/)/i.test(nom)) {
      throw refus("Classeur refusé : il contient des liaisons externes.");
    }
    if (/vbaProject/i.test(nom)) {
      throw refus("Classeur refusé : il contient des macros.");
    }
  }
  if (/macroEnabled/i.test(textes.get("[Content_Types].xml") ?? "")) {
    throw refus("Classeur refusé : il contient des macros.");
  }
}

const tropGrand = () =>
  refus(
    `Classeur trop grand : ${IMPORT_TEMPS_MAX_LIGNES} lignes de temps au plus ` +
      "(supprimer les lignes et colonnes vides mises en forme).",
  );

/** Bornes de volume : feuilles, lignes et cellules stockées, textes partagés, styles. */
function controlerVolume(classeur: string, textes: Map<string, string>): void {
  const feuilles = compter(classeur, balise("sheet", "g"), IMPORT_EXCEL_FEUILLES_MAX);
  if (feuilles === 0) throw illisible();
  if (feuilles > IMPORT_EXCEL_FEUILLES_MAX) {
    throw refus(`Classeur refusé : ${IMPORT_EXCEL_FEUILLES_MAX} feuilles au plus.`);
  }
  let lignes = 0;
  let cellules = 0;
  for (const [nom, texte] of textes) {
    if (!/worksheets\//i.test(nom)) continue;
    lignes += compter(texte, balise("row", "g"), IMPORT_EXCEL_LIGNES_XML_MAX - lignes);
    cellules += compter(texte, balise("c", "g"), IMPORT_EXCEL_CELLULES_MAX - cellules);
    if (lignes > IMPORT_EXCEL_LIGNES_XML_MAX || cellules > IMPORT_EXCEL_CELLULES_MAX) {
      throw tropGrand();
    }
  }
  // Textes partagés et fragments de texte enrichi : un objet ExcelJS chacun, bornés comme
  // les cellules.
  const partages = textes.get("xl/sharedStrings.xml") ?? "";
  for (const element of ["si", "r"]) {
    if (
      compter(partages, balise(element, "g"), IMPORT_EXCEL_CELLULES_MAX) > IMPORT_EXCEL_CELLULES_MAX
    ) {
      throw tropGrand();
    }
  }
  const styles = compter(
    textes.get("xl/styles.xml") ?? "",
    balise("xf|dxf|font|fill|border|numFmt|cellStyle", "g"),
    IMPORT_EXCEL_STYLES_MAX,
  );
  if (styles > IMPORT_EXCEL_STYLES_MAX) {
    throw refus(
      `Classeur refusé : plus de ${IMPORT_EXCEL_STYLES_MAX} styles de cellule ` +
        "(copier les données dans le modèle d'import).",
    );
  }
}

/* ----- Valeurs des cellules ----- */

type Lecture = { texte: string } | { erreur: string };

/** Valeur d'une cellule → texte, sans jamais évaluer de formule. */
export function lireCellule(valeur: ExcelJS.CellValue): Lecture {
  if (valeur === null || valeur === undefined) return { texte: "" };
  if (typeof valeur === "string") {
    return valeur.length > IMPORT_EXCEL_CELLULE_CARACTERES_MAX
      ? { erreur: `texte trop long (${IMPORT_EXCEL_CELLULE_CARACTERES_MAX} caractères au plus)` }
      : { texte: valeur };
  }
  if (typeof valeur === "number") {
    return Number.isFinite(valeur) ? { texte: String(valeur) } : { erreur: "nombre invalide" };
  }
  if (typeof valeur === "boolean") return { erreur: "valeur logique (VRAI/FAUX) inattendue" };
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return { erreur: "date invalide" };
    // Date Excel : minuit UTC. Une heure dans la cellule rend la date ambiguë.
    if (valeur.getTime() % 86_400_000 !== 0) return { erreur: "la date porte une heure" };
    return { texte: valeur.toISOString().slice(0, 10) };
  }
  if ("formula" in valeur || "sharedFormula" in valeur) {
    // Valeur en cache seulement : la formule n'est jamais évaluée.
    if (valeur.result === undefined || valeur.result === null) {
      return {
        erreur: "formule sans valeur calculée (ouvrir et enregistrer le classeur dans Excel)",
      };
    }
    return lireCellule(valeur.result);
  }
  if ("error" in valeur) {
    return { erreur: `valeur d'erreur Excel (${String(valeur.error).slice(0, 12)})` };
  }
  if ("richText" in valeur) {
    return lireCellule(valeur.richText.map((r) => r.text).join(""));
  }
  if ("text" in valeur) return lireCellule(valeur.text as ExcelJS.CellValue);
  return { erreur: "contenu de cellule non pris en charge" };
}

/** Nœuds de feuille sans intérêt pour l'import : non analysés par ExcelJS. */
const NOEUDS_IGNORES = [
  "sheetPr",
  "dimension",
  "sheetViews",
  "sheetFormatPr",
  "cols",
  "autoFilter",
  "mergeCells",
  "rowBreaks",
  "hyperlinks",
  "pageMargins",
  "dataValidations",
  "pageSetup",
  "headerFooter",
  "printOptions",
  "picture",
  "drawing",
  "sheetProtection",
  "tableParts",
  "conditionalFormatting",
  "extLst",
];

/** Lectures Excel en cours dans cette instance (sémaphore). */
let lecturesEnCours = 0;

/**
 * Contrôle puis lit la première feuille visible d'un classeur .xlsx :
 * première ligne non vide = en-tête, lignes suivantes non vides = données
 * (numéro = numéro de ligne Excel). Lève 400 `EXCEL_INVALIDE`, 413, ou 503
 * `IMPORT_EXCEL_OCCUPE` au-delà de `IMPORT_EXCEL_LECTURES_SIMULTANEES_MAX`
 * lectures simultanées dans l'instance.
 */
export async function lireClasseurTemps(contenu: Buffer): Promise<TableauImport> {
  if (contenu.length > IMPORT_EXCEL_TAILLE_MAX) throw tropVolumineux();
  // Place prise avant la première attente : le compte est exact entre requêtes.
  if (lecturesEnCours >= IMPORT_EXCEL_LECTURES_SIMULTANEES_MAX) throw occupe();
  lecturesEnCours += 1;
  try {
    return lireFeuille(await chargerClasseur(contenu));
  } finally {
    lecturesEnCours -= 1;
  }
}

/** Contrôles du fichier et de l'archive, puis lecture par ExcelJS de l'archive reconstruite. */
async function chargerClasseur(contenu: Buffer): Promise<ExcelJS.Workbook> {
  if (contenu.subarray(0, 8).equals(SIG_OLE)) {
    throw refus(
      "Classeur protégé par mot de passe ou au format Excel 97-2003 (.xls) : " +
        "enregistrer une copie au format .xlsx sans mot de passe.",
    );
  }
  if (contenu.length < 4 || contenu.readUInt32LE(0) !== SIG_LOCAL) {
    throw refus("Le fichier n'est pas un classeur Excel .xlsx.");
  }
  const entrees = lireArchive(contenu);
  controlerContenu(entrees);
  const classeur = new ExcelJS.Workbook();
  try {
    await classeur.xlsx.load(
      // Jamais le fichier d'origine : seulement les entrées validées.
      reconstruireArchive(entrees) as unknown as ExcelJS.Buffer,
      {
        ignoreNodes: NOEUDS_IGNORES,
        // Défense en profondeur (options de lecture d'ExcelJS non typées).
        maxRows: IMPORT_EXCEL_LIGNES_XML_MAX,
        maxCols: IMPORT_EXCEL_COLONNES_MAX * 4,
      } as Partial<ExcelJS.XlsxReadOptions>,
    );
  } catch {
    throw illisible();
  }
  if (classeur.worksheets.length > IMPORT_EXCEL_FEUILLES_MAX) {
    throw refus(`Classeur refusé : ${IMPORT_EXCEL_FEUILLES_MAX} feuilles au plus.`);
  }
  return classeur;
}

/** Première feuille visible → tableau d'import (en-tête et lignes non vides). */
function lireFeuille(classeur: ExcelJS.Workbook): TableauImport {
  const feuille = classeur.worksheets.find((f) => f.state !== "hidden" && f.state !== "veryHidden");
  if (!feuille) throw refus("Le classeur ne contient aucune feuille visible.");

  const lignes: { numero: number; textes: string[]; erreurs: (string | undefined)[] }[] = [];
  let colonnesHorsLimite = false;
  feuille.eachRow({ includeEmpty: false }, (ligne, numero) => {
    const textes: string[] = [];
    const erreurs: (string | undefined)[] = [];
    ligne.eachCell({ includeEmpty: false }, (cellule, colonne) => {
      const lecture = lireCellule(cellule.value);
      const vide = "texte" in lecture && lecture.texte.trim() === "";
      if (vide) return;
      if (colonne > IMPORT_EXCEL_COLONNES_MAX) {
        colonnesHorsLimite = true;
        return;
      }
      if ("texte" in lecture) textes[colonne - 1] = lecture.texte;
      else erreurs[colonne - 1] = `Cellule ${cellule.address} : ${lecture.erreur}.`;
    });
    if (textes.some((t) => t !== undefined) || erreurs.some((e) => e !== undefined)) {
      lignes.push({ numero, textes, erreurs });
    }
  });
  if (colonnesHorsLimite) {
    throw refus(`Classeur refusé : ${IMPORT_EXCEL_COLONNES_MAX} colonnes renseignées au plus.`);
  }
  const [entete, ...donnees] = lignes;
  return {
    // Une cellule d'en-tête illisible compte comme absente (« colonnes manquantes »).
    entete: Array.from({ length: entete?.textes.length ?? 0 }, (_, i) => entete?.textes[i] ?? ""),
    lignes: donnees.map((l): LigneTableau => {
      const largeur = Math.max(l.textes.length, l.erreurs.length);
      return {
        numero: l.numero,
        valeurs: Array.from({ length: largeur }, (_, i) => l.textes[i] ?? ""),
        erreurs: Array.from({ length: largeur }, (_, i) => l.erreurs[i]),
      };
    }),
  };
}

/* ----- Modèle téléchargeable ----- */

const AIDE: [string, string][] = [
  ["Collaborateur", "Nom du collaborateur actif, tel qu'il figure dans MissionPilot."],
  ["Mission", "Intitulé exact de la mission (sans tenir compte des accents ni de la casse)."],
  ["Tâche", "Libellé exact d'une tâche de cette mission."],
  [
    "Date",
    "Date Excel, ou texte AAAA-MM-JJ ou JJ/MM/AAAA. Pas d'heure. Hors période de temps clôturée.",
  ],
  [
    "Jours",
    "Nombre de jours entre 0 et 3, virgule décimale acceptée (ex. 0,5) ; pas de saisie du cabinet.",
  ],
];

const REGLES = [
  "Seule la première feuille visible est lue ; la première ligne non vide est l'en-tête.",
  `${IMPORT_TEMPS_MAX_LIGNES} lignes de temps et ${IMPORT_EXCEL_TAILLE_MAX / (1024 * 1024)} Mo au plus.`,
  "Les formules ne sont pas recalculées : la valeur enregistrée par Excel est lue.",
  "Refusés : classeur protégé ou chiffré, liaisons externes, macros.",
  "Lancer d'abord une simulation : rien n'est écrit tant qu'une ligne est en erreur.",
];

let modele: Promise<Buffer> | undefined;

/**
 * Classeur modèle : feuille « Temps » (en-tête seul) et feuille « Mode d'emploi ».
 * Généré une fois puis gardé en cache ; un échec n'est pas gardé (prochain appel = nouvel essai).
 */
export function modeleExcelTemps(): Promise<Buffer> {
  modele ??= genererModele().catch((error: unknown) => {
    modele = undefined;
    throw error;
  });
  return modele;
}

async function genererModele(): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = "MissionPilot";
  const temps = classeur.addWorksheet("Temps", { views: [{ state: "frozen", ySplit: 1 }] });
  temps.columns = [
    { header: "Collaborateur", width: 32 },
    { header: "Mission", width: 40 },
    { header: "Tâche", width: 32 },
    { header: "Date", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Jours", width: 10, style: { numFmt: "0.0#" } },
  ];
  temps.getRow(1).font = { bold: true };
  const aide = classeur.addWorksheet("Mode d'emploi");
  aide.columns = [
    { header: "Colonne", width: 16 },
    { header: "Contenu attendu", width: 100 },
  ];
  aide.getRow(1).font = { bold: true };
  for (const ligne of AIDE) aide.addRow(ligne);
  aide.addRow([]);
  for (const regle of REGLES) aide.addRow(["Règle", regle]);
  return Buffer.from((await classeur.xlsx.writeBuffer()) as ArrayBuffer);
}
