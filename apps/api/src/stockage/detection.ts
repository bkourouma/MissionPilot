import { constants as zlibConstantes, inflateRawSync } from "node:zlib";
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
 * - un PDF portant des noms actifs (JavaScript, Launch, fichier embarqué,
 *   RichMedia, formulaire XFA, 3D), y compris dans ses flux d'objets
 *   compressés (voir la section PDF plus bas). C'est une barrière de premier
 *   niveau, pas un antivirus (hors périmètre, voir SECURITY.md).
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

/* --------------------------------------------------------------------------
 * PDF : contenu actif
 *
 * On cherche les noms actifs (JavaScript, JS, Launch, EmbeddedFile(s),
 * RichMedia, et en nom entier XFA et 3D : formulaires XFA et annotations ou
 * flux 3D, qui portent des scripts exécutés par Acrobat) là où un lecteur PDF
 * les lit comme des noms, et seulement là :
 * les DONNÉES des flux (images, polices, contenus de page compressés) sont
 * des octets quelconques où « /JS » apparaît par hasard (ancien faux
 * positif : environ 4,5e-8 par octet, soit ~1 % des PDF de 300 Ko).
 *
 * 1. Analyse STRICTE de la structure (ISO 32000-1 § 7.2 à 7.5), en un
 *    passage : objets « n g obj … endobj », tables xref, trailers,
 *    commentaires. Toute construction que deux lecteurs pourraient lire
 *    différemment rend le fichier non conforme : chaîne hexadécimale
 *    invalide, clé de dictionnaire qui n'est pas un nom, valeur manquante,
 *    délimiteur orphelin, fin de fichier dans un objet, nom ou dictionnaire
 *    hors objet, flux sans « endstream ». Seules les données qui suivent
 *    « stream » après le dictionnaire de tête d'un objet, jusqu'au premier
 *    « endstream », sont exclues ; chaque nom lu ailleurs est décodé (« #xx »,
 *    coupé au premier NUL comme le font les lecteurs en C) puis comparé.
 * 2. Garde contre les lectures divergentes : un lecteur entre dans le
 *    fichier par un en-tête « n g obj » (table xref ou reconstruction) ou par
 *    un trailer. Une telle entrée possible dans une zone qui n'est pas lue
 *    ici comme syntaxe (chaîne, commentaire, données de flux) rend le fichier
 *    non conforme : un objet caché dans un flux ou une chaîne ne passe pas.
 * 3. Flux d'objets (ObjStm, PDF 1.5) : ce sont des objets compressés, donc de
 *    la syntaxe. Tout flux dont le dictionnaire porte /N, /First, /Extends ou
 *    /Type /ObjStm (/N est exigé par tous les lecteurs) est décompressé (sans
 *    filtre, ou Flate seul sans paramètres) sous plafonds (PLAFONDS_PDF :
 *    taille par flux, cumul, ratio, nombre de flux), puis chaque objet est lu
 *    depuis le décalage que donne l'en-tête du flux, comme le fait un lecteur
 *    (recherche brute si l'en-tête ou un objet est ambigu). Un flux d'objets
 *    indécodable (autre filtre, prédicteur, fichier chiffré, données
 *    corrompues, bombe de décompression) est REFUSÉ : c'est là qu'un contenu
 *    actif se cacherait. Chromium (rapports) n'en produit pas.
 * 4. Fichier non conforme : repli sur l'ancienne règle (plus XFA et 3D en
 *    nom entier), recherche sur le fichier entier, flux compris (faux
 *    positifs possibles, jamais moins strict), et refus de tout marqueur de
 *    flux d'objets (non inspectable sans structure fiable).
 * Hors périmètre (inchangé) : actions /URI, /SubmitForm, /GoToR, /ImportData ;
 * /OpenAction et /AA seuls ne sont pas refusés (une destination d'ouverture
 * est courante), l'action qu'ils portent l'est si elle est active.
 * -------------------------------------------------------------------------- */

const NOMS_ACTIFS = "(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia)(?![A-Za-z0-9])";
/** Recherche brute (repli, flux d'objets ambigu), après décodage des « #xx ». */
const PDF_ACTIF = new RegExp(`/${NOMS_ACTIFS}`);
/** Nom déjà isolé et décodé par l'analyse. */
const NOM_ACTIF = new RegExp(`^${NOMS_ACTIFS}`);
/**
 * Noms actifs comparés en ENTIER : /XFA (formulaire XFA), /3D (annotation
 * /Subtype /3D, flux /Type /3D). Un préfixe ne suffit pas : une couleur
 * « /3D-Rouge » ou « /3D#20Bleu » reste permise.
 */
const NOMS_ACTIFS_ENTIERS = new Set(["XFA", "3D"]);
/** Nom brut pouvant se décoder en XFA ou 3D (initiale X, 3 ou échappement « # »). */
const NOM_BRUT_ENTIER = /\/([X3#][^\0\t\n\f\r ()<>[\]{}/%]*)/g;

/** Recherche brute des noms entiers XFA ou 3D, pris entre délimiteurs dans le texte non décodé. */
function contientNomEntier(brut: string): boolean {
  for (const m of brut.matchAll(NOM_BRUT_ENTIER)) {
    if (NOMS_ACTIFS_ENTIERS.has(nomDecode(m[1] as string))) return true;
  }
  return false;
}

/** Recherche brute (ancienne règle, plus XFA et 3D) sur un texte latin1 et sa version décodée. */
const rechercheBrute = (brut: string, decode = decoderNoms(brut)) =>
  PDF_ACTIF.test(decode) || contientNomEntier(brut);
/** Marqueurs de flux d'objets, refusés quand la structure n'a pas pu être lue. */
const PDF_FLUX_OBJETS = /\/(ObjStm|Extends|First)(?![A-Za-z0-9])/;

/** Plafonds de la décompression des flux d'objets (bombes de décompression). */
export const PLAFONDS_PDF = {
  /** Taille décompressée maximale d'un flux d'objets. */
  fluxOctets: 8 * 1024 * 1024,
  /** Taille décompressée cumulée maximale des flux d'objets d'un fichier. */
  totalOctets: 32 * 1024 * 1024,
  /** Rapport décompressé / compressé maximal, au-delà d'une marge fixe. */
  ratio: 100,
  margeOctets: 64 * 1024,
  /** Nombre maximal de flux d'objets inspectés. */
  nombreFlux: 4096,
} as const;

const refusPdfActif = () =>
  refusType(
    "PDF refusé : il contient du contenu actif (script, lancement, pièce jointe, formulaire XFA, 3D).",
  );
const refusPdfIllisible = () =>
  refusType(
    "PDF refusé : flux d'objets compressé non analysable (filtre non pris en charge, chiffrement ou données corrompues).",
  );
const refusPdfVolume = () =>
  refusType("PDF refusé : flux d'objets trop volumineux une fois décompressé.");

const decoderNoms = (texte: string) =>
  texte.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** Nom décodé (« #xx ») et coupé au premier NUL, comme le lisent les lecteurs écrits en C. */
function nomDecode(brut: string): string {
  if (!brut.includes("#")) return brut;
  const nom = decoderNoms(brut);
  const nul = nom.indexOf("\0");
  return nul < 0 ? nom : nom.slice(0, nul);
}

/** Analyse interrompue : structure ambiguë ou hors du sous-ensemble strict. */
class NonConforme extends Error {}

/** Valeur sentinelle d'un octet hors du fichier. */
const HORS = 256;
/** Classe de chaque octet : 0 régulier, 1 blanc, 2 délimiteur, 3 hors du fichier (HORS). */
const CLASSE_PDF = new Uint8Array(257);
for (const o of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) CLASSE_PDF[o] = 1;
for (const c of "()<>[]{}/%") CLASSE_PDF[c.charCodeAt(0)] = 2;
CLASSE_PDF[HORS] = 3;

/*
 * Les octets se lisent dans le Buffer (rapide) ; la chaîne latin1 du même
 * contenu (un caractère par octet) sert aux extraits et aux recherches.
 */
const octet = (b: Buffer, i: number): number => b[i] ?? HORS;
const classe = (b: Buffer, i: number): number => CLASSE_PDF[octet(b, i)] as number;
const estChiffre = (o: number) => o >= 0x30 && o <= 0x39;
const finDeNombre = (o: number) => estChiffre(o) || o === 0x2e;
const estFinDeLigne = (o: number) => o === 0x0a || o === 0x0d;
const estHexa = (o: number) => estChiffre(o) || ((o | 0x20) >= 0x61 && (o | 0x20) <= 0x66);
const PROFONDEUR_MAX = 100;
/**
 * Au-delà, l'analyse stricte s'arrête et le repli (recherche brute, linéaire)
 * s'applique : jamais moins strict, seul le temps de calcul est borné. Un PDF
 * Chromium de 350 Ko compte environ 70 000 jetons ; 15 Mo de syntaxe pure,
 * 3,7 millions (environ 0,5 s).
 */
const PLAFOND_JETONS = 8_000_000;

/**
 * Garde contre les lectures divergentes (point 2) : signale une entrée de
 * lecteur (« n g obj » ou « trailer ») dans une zone non syntaxique. Travail
 * borné par un budget proportionnel à la taille du fichier.
 */
class GardeEntrees {
  private budget: number;
  /** Prochaine occurrence connue de chaque motif (Infinity : aucune). */
  private readonly prochaines = { obj: -1, trailer: -1 };

  constructor(
    private readonly b: Buffer,
    private readonly s: string,
  ) {
    this.budget = 4 * b.length + 1_000_000;
  }

  /** Zones vérifiées dans l'ordre du fichier : chaque motif est cherché une fois par occurrence. */
  verifier(debut: number, fin: number): void {
    if (fin - debut < 3) return;
    if (this.suivante("trailer", debut) < fin) throw new NonConforme();
    for (let i = this.suivante("obj", debut); i < fin; i = this.suivante("obj", i + 1)) {
      if (this.enTetePossible(i)) throw new NonConforme();
    }
  }

  private suivante(motif: "obj" | "trailer", depuis: number): number {
    let i = this.prochaines[motif];
    if (i < depuis) {
      i = this.s.indexOf(motif, depuis);
      this.prochaines[motif] = i = i < 0 ? Infinity : i;
    }
    return i;
  }

  /** « obj » en i clôt-il un en-tête possible : après un blanc et un nombre, pas suivi d'une lettre ? */
  private enTetePossible(i: number): boolean {
    const b = this.b;
    if (classe(b, i - 1) !== 1) return false;
    if (classe(b, i + 3) === 0 && !estChiffre(octet(b, i + 3))) return false; // « objectif »
    return this.nombreAvant(i - 1);
  }

  /**
   * Un nombre précède-t-il j, à travers blancs et commentaires ? Prudent :
   * tout « % » d'une ligne précédente est pris pour un début de commentaire
   * possible ; au-delà de 8 lignes ou de 4 096 octets par ligne, oui.
   */
  private nombreAvant(j: number): boolean {
    const b = this.b;
    for (let tour = 0; tour < 8; tour++) {
      const depart = j;
      let ligne = false;
      for (; classe(b, j) === 1; j--) ligne ||= estFinDeLigne(octet(b, j));
      if (finDeNombre(octet(b, j))) return true;
      if (!ligne || j < 0) return false;
      let debut = j;
      while (debut > 0 && !estFinDeLigne(octet(b, debut - 1))) {
        debut--;
        if (j - debut > 4096) return true;
      }
      this.depenser(depart - debut + 1);
      let premier = -1;
      for (let k = debut; k <= j; k++) {
        if (octet(b, k) !== 0x25) continue;
        if (premier < 0) premier = k;
        let m = k - 1;
        while (m >= debut && classe(b, m) === 1) m--;
        if (m >= debut && finDeNombre(octet(b, m))) return true;
      }
      if (premier < 0) return false;
      let m = premier - 1;
      while (m >= debut && classe(b, m) === 1) m--;
      if (m >= debut) return false; // le jeton avant le commentaire n'est pas un nombre
      j = debut - 1; // la ligne n'est qu'un commentaire : remonter d'une ligne
    }
    return true;
  }

  private depenser(n: number): void {
    this.budget -= n;
    if (this.budget < 0) throw new NonConforme();
  }
}

type Genre = "fin" | "nombre" | "mot" | "nom" | "chaine" | "hexa" | "<<" | ">>" | "[" | "]";
/** Jetons encore permis, partagés par toutes les analyses d'un même fichier. */
interface BudgetJetons {
  jetons: number;
}

/**
 * Lexique PDF : blancs, commentaires, chaînes, noms, nombres et mots-clés.
 * Sans allocation par jeton : `suivant` rend le genre, `texte` porte le nom
 * décodé (sans « / ») ou le mot-clé du dernier jeton.
 */
class LecteurPdf {
  p = 0;
  texte = "";
  /** Début du dernier jeton lu. */
  private debut = 0;
  private retenu: Genre | null = null;
  private texteRetenu = "";

  constructor(
    private readonly b: Buffer,
    private readonly s: string,
    private readonly garde: GardeEntrees,
    private readonly budget: BudgetJetons,
  ) {}

  /** Remet le dernier jeton lu : le prochain `suivant` le rendra de nouveau. */
  rendre(genre: Genre): void {
    this.retenu = genre;
    this.texteRetenu = this.texte;
  }

  /** Reprend la lecture à la position p (aucun jeton en attente). */
  allerA(p: number): void {
    this.p = p;
    this.retenu = null;
  }

  /** Texte brut du dernier jeton lu (valeur d'un nombre). */
  extrait(): string {
    return this.s.slice(this.debut, this.p);
  }

  suivant(): Genre {
    if (this.retenu !== null) {
      const genre = this.retenu;
      this.retenu = null;
      this.texte = this.texteRetenu;
      return genre;
    }
    if (--this.budget.jetons < 0) throw new NonConforme(); // borne le temps de calcul
    this.sauterBlancs();
    const b = this.b;
    const debut = this.p;
    const o = octet(b, debut);
    this.debut = debut;
    this.texte = "";
    if (o === HORS) return "fin";
    const double = octet(b, debut + 1) === o;
    if (o === 0x28) return this.chaine();
    if (o === 0x3c) return double ? this.symbole("<<", 2) : this.hexa();
    if (o === 0x3e && double) return this.symbole(">>", 2);
    if (o === 0x5b) return this.symbole("[", 1);
    if (o === 0x5d) return this.symbole("]", 1);
    if (o === 0x2f) return this.nom(debut + 1);
    if (classe(b, debut) === 2) throw new NonConforme(); // « ) », « > », « { », « } » orphelins
    return this.regulier(debut);
  }

  private sauterBlancs(): void {
    const b = this.b;
    for (;;) {
      while (classe(b, this.p) === 1) this.p++;
      if (octet(b, this.p) !== 0x25) return;
      const debut = this.p + 1;
      while (this.p < b.length && !estFinDeLigne(octet(b, this.p))) this.p++;
      this.garde.verifier(debut, this.p);
    }
  }

  private symbole(genre: Genre, longueur: number): Genre {
    this.p += longueur;
    return genre;
  }

  /** Nom décodé (« #xx ») et coupé au premier NUL, comme le lisent les lecteurs écrits en C. */
  private nom(debut: number): Genre {
    const b = this.b;
    let fin = debut;
    let diese = false;
    for (let o = octet(b, fin); CLASSE_PDF[o] === 0; o = octet(b, ++fin)) {
      if (o === 0x23) diese = true;
    }
    this.p = fin;
    const brut = this.s.slice(debut, fin);
    this.texte = diese ? nomDecode(brut) : brut;
    return "nom";
  }

  /** Nombre (signe facultatif, au plus un point, au moins un chiffre) ou mot-clé. */
  private regulier(debut: number): Genre {
    const b = this.b;
    let fin = debut;
    let chiffres = 0;
    let points = 0;
    let autres = 0;
    for (let o = octet(b, fin); CLASSE_PDF[o] === 0; o = octet(b, ++fin)) {
      if (estChiffre(o)) chiffres++;
      else if (o === 0x2e) points++;
      else if (fin > debut || (o !== 0x2b && o !== 0x2d)) autres++;
    }
    this.p = fin;
    if (chiffres > 0 && points <= 1 && autres === 0) return "nombre";
    this.texte = this.s.slice(debut, fin);
    return "mot";
  }

  /** Chaîne littérale : parenthèses équilibrées, « \ » échappe l'octet suivant. */
  private chaine(): Genre {
    const b = this.b;
    let profondeur = 0;
    let i = this.p;
    for (;;) {
      const o = octet(b, i);
      if (o === HORS) throw new NonConforme();
      if (o === 0x5c) i += 2;
      else {
        if (o === 0x28) profondeur++;
        else if (o === 0x29 && --profondeur === 0) break;
        i++;
      }
    }
    this.garde.verifier(this.p + 1, i);
    this.p = i + 1;
    return "chaine";
  }

  /** Chaîne hexadécimale : chiffres hexadécimaux et blancs seulement (sinon lectures divergentes). */
  private hexa(): Genre {
    const b = this.b;
    let i = this.p + 1;
    for (let o = octet(b, i); o !== 0x3e; o = octet(b, ++i)) {
      if (o === HORS || (!estHexa(o) && CLASSE_PDF[o] !== 1)) throw new NonConforme();
    }
    this.p = i + 1;
    return "hexa";
  }
}

/** Valeur d'une entrée de dictionnaire, réduite à ce que l'analyse des flux d'objets consulte. */
interface Entree {
  nom?: string;
  /** Tableau composé uniquement de noms. */
  noms?: string[];
  /** Nombre direct (une référence « n g R » n'en est pas un). */
  nombre?: number;
  nul?: boolean;
  /** Clé répétée dans le dictionnaire : valeur ambiguë. */
  doublon?: boolean;
}
const AUTRE: Entree = Object.freeze({});
const NUL: Entree = Object.freeze({ nul: true });
const DOUBLON: Entree = Object.freeze({ doublon: true });

interface FluxObjets {
  debut: number;
  fin: number;
  decodage: "brut" | "flate" | null;
  /** /N entier direct, sinon absent. */
  n?: number;
  /** /First : entier direct, null si présent sans être un entier direct, absent sinon. */
  premier?: number | null;
}

const entierPositif = (x: number | undefined) =>
  x !== undefined && Number.isInteger(x) && x >= 0 ? x : undefined;

interface StructurePdf {
  fluxObjets: FluxObjets[];
  chiffre: boolean;
}

/** Analyse stricte (point 1) ; lève NonConforme, ou le refus si un nom actif est lu. */
class AnalyseurPdf {
  private readonly garde: GardeEntrees;
  private readonly lecteur: LecteurPdf;
  private readonly structure: StructurePdf = { fluxObjets: [], chiffre: false };

  constructor(
    private readonly b: Buffer,
    private readonly s: string,
    budget: BudgetJetons,
  ) {
    this.garde = new GardeEntrees(b, s);
    this.lecteur = new LecteurPdf(b, s, this.garde, budget);
  }

  /**
   * Contenu décompressé d'un flux d'objets : en-tête de n paires « numéro
   * décalage », puis chaque objet lu depuis premier + décalage, comme le fait
   * un lecteur (une valeur par objet).
   */
  objetsCompresses(n: number, premier: number): void {
    const decalages: number[] = [];
    for (let k = 0; k < n; k++) {
      if (this.jeton() !== "nombre" || this.jeton() !== "nombre") throw new NonConforme();
      const decalage = entierPositif(Number(this.lecteur.extrait()));
      if (decalage === undefined || premier + decalage >= this.b.length) throw new NonConforme();
      decalages.push(premier + decalage);
    }
    for (const position of decalages) {
      this.lecteur.allerA(position);
      this.valeur(this.jeton(), 0, false);
    }
  }

  analyser(): StructurePdf {
    let nombres = 0;
    for (let g = this.jeton(); g !== "fin"; g = this.jeton()) {
      if (g === "nombre") {
        nombres++;
        continue;
      }
      // Hors objet et trailer : seuls des mots-clés (xref, n, f, startxref…) et des nombres.
      if (g !== "mot") throw new NonConforme();
      if (this.mot("obj")) {
        if (nombres < 2) throw new NonConforme();
        this.objet();
      } else if (this.mot("trailer")) {
        if (this.jeton() !== "<<") throw new NonConforme();
        this.dictionnaire(1, null);
      }
      nombres = 0;
    }
    return this.structure;
  }

  /** Jeton suivant ; un nom actif refuse le fichier sur-le-champ. */
  private jeton(): Genre {
    const genre = this.lecteur.suivant();
    if (genre === "nom") {
      const nom = this.lecteur.texte;
      // J, L, E, R, X, 3 : seules initiales des noms actifs (et d'Encrypt).
      const initiale = nom.charCodeAt(0);
      if (
        initiale === 0x4a ||
        initiale === 0x4c ||
        initiale === 0x45 ||
        initiale === 0x52 ||
        initiale === 0x58 ||
        initiale === 0x33
      ) {
        if (NOM_ACTIF.test(nom) || NOMS_ACTIFS_ENTIERS.has(nom)) throw refusPdfActif();
        if (nom === "Encrypt") this.structure.chiffre = true;
      }
    }
    return genre;
  }

  /** Le dernier jeton lu est-il ce mot-clé ? */
  private mot(texte: string): boolean {
    return this.lecteur.texte === texte;
  }

  private objet(): void {
    const tete = this.jeton();
    if (tete === "mot" && this.mot("endobj")) return; // objet vide
    if (tete === "<<") {
      const dict = new Map<string, Entree>();
      this.dictionnaire(1, dict);
      const suite = this.jeton();
      if (suite === "mot" && this.mot("stream")) this.flux(dict);
      else this.lecteur.rendre(suite);
    } else {
      this.valeur(tete, 0, false);
    }
    const fin = this.jeton();
    if (fin !== "mot" || !this.mot("endobj")) this.lecteur.rendre(fin);
  }

  /** Données du flux : de « stream » au premier « endstream » (comme les lecteurs qui le cherchent). */
  private flux(dict: Map<string, Entree>): void {
    const b = this.b;
    const apres = this.lecteur.p;
    const fin = this.s.indexOf("endstream", apres);
    if (fin < 0) throw new NonConforme();
    this.garde.verifier(apres, fin);
    if (estFluxObjets(dict)) {
      // Début des données : après les espaces et la fin de ligne qui suivent « stream ».
      let debut = apres;
      while (b[debut] === 0x20 || b[debut] === 0x09) debut++;
      if (b[debut] === 0x0d) debut++;
      if (b[debut] === 0x0a) debut++;
      const premier = dict.get("First");
      this.structure.fluxObjets.push({
        debut: Math.min(debut, fin),
        fin,
        decodage: decodage(dict),
        n: entierPositif(dict.get("N")?.nombre),
        premier: premier && (entierPositif(premier.nombre) ?? null),
      });
    }
    this.lecteur.p = fin + "endstream".length;
  }

  /** Dictionnaire après « << » ; entrées relevées seulement pour le dictionnaire de tête. */
  private dictionnaire(profondeur: number, entrees: Map<string, Entree> | null): void {
    if (profondeur > PROFONDEUR_MAX) throw new NonConforme();
    for (let cle = this.jeton(); cle !== ">>"; cle = this.jeton()) {
      if (cle !== "nom") throw new NonConforme(); // clé qui n'est pas un nom, fin du fichier
      const nom = this.lecteur.texte;
      const v = this.jeton();
      let entree = this.valeur(v, profondeur, entrees !== null);
      if (v === "nombre" && this.reference()) entree = AUTRE; // valeur indirecte, inconnue
      if (entrees) entrees.set(nom, entrees.has(nom) ? DOUBLON : entree);
    }
  }

  /** Après un nombre dans un dictionnaire : référence « n g R » complète (vrai), ou rien (faux). */
  private reference(): boolean {
    const g = this.jeton();
    if (g !== "nombre") {
      this.lecteur.rendre(g);
      return false;
    }
    if (this.jeton() !== "mot" || !this.mot("R")) throw new NonConforme();
    return true;
  }

  /** Valeur dont le premier jeton vient d'être lu. */
  private valeur(v: Genre, profondeur: number, relever: boolean): Entree {
    switch (v) {
      case "nom":
        return relever ? { nom: this.lecteur.texte } : AUTRE;
      case "nombre":
        return relever ? { nombre: Number(this.lecteur.extrait()) } : AUTRE;
      case "chaine":
      case "hexa":
        return AUTRE;
      case "<<":
        this.dictionnaire(profondeur + 1, null);
        return AUTRE;
      case "[":
        return this.tableau(profondeur + 1, relever);
      case "mot":
        if (this.mot("null")) return NUL;
        if (this.mot("true") || this.mot("false")) return AUTRE;
        throw new NonConforme();
      default:
        throw new NonConforme(); // « >> », « ] », fin du fichier
    }
  }

  private tableau(profondeur: number, relever: boolean): Entree {
    if (profondeur > PROFONDEUR_MAX) throw new NonConforme();
    const noms: string[] = [];
    let queDesNoms = relever;
    for (let v = this.jeton(); v !== "]"; v = this.jeton()) {
      if (v === "nom") {
        if (queDesNoms) noms.push(this.lecteur.texte);
        continue;
      }
      queDesNoms = false;
      if (v !== "mot" || !this.mot("R")) this.valeur(v, profondeur, false);
    }
    return queDesNoms ? { noms } : AUTRE;
  }
}

const estFluxObjets = (d: Map<string, Entree>) =>
  d.has("N") ||
  d.has("First") ||
  d.has("Extends") ||
  d.get("Type")?.nom === "ObjStm" ||
  d.get("Type")?.doublon === true;

/** Décodage d'un flux d'objets : sans filtre, ou Flate seul sans paramètres ; sinon null. */
function decodage(d: Map<string, Entree>): FluxObjets["decodage"] {
  if (d.has("F") || d.has("DP")) return null; // alias de filtre (pdf.js) ou flux externe
  const parametres = d.get("DecodeParms");
  if (parametres && !parametres.nul) return null; // prédicteur
  const filtre = d.get("Filter");
  if (!filtre || filtre.nul) return "brut";
  const noms = filtre.nom !== undefined ? [filtre.nom] : filtre.noms;
  if (!noms || noms.length > 1) return null;
  if (noms.length === 0) return "brut";
  return noms[0] === "FlateDecode" || noms[0] === "Fl" ? "flate" : null;
}

/**
 * Décompression zlib bornée (taille, cumul, ratio). En-tête RFC 1950 exigé ;
 * la somme Adler-32 finale ne l'est pas et un flux tronqué est lu jusqu'où il
 * va, comme le font les lecteurs tolérants.
 */
function inflerBorne(donnees: Buffer, reste: number): Buffer {
  const cmf = donnees[0] ?? 0;
  const flg = donnees[1] ?? 0;
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || (cmf * 256 + flg) % 31 !== 0 || (flg & 0x20) !== 0) {
    throw refusPdfIllisible();
  }
  const plafond = Math.min(
    PLAFONDS_PDF.fluxOctets,
    reste,
    donnees.length * PLAFONDS_PDF.ratio + PLAFONDS_PDF.margeOctets,
  );
  if (plafond <= 0) throw refusPdfVolume();
  try {
    return inflateRawSync(donnees.subarray(2), {
      finishFlush: zlibConstantes.Z_SYNC_FLUSH,
      maxOutputLength: plafond,
    });
  } catch (erreur) {
    if ((erreur as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw refusPdfVolume();
    throw refusPdfIllisible();
  }
}

/** Le contenu commence-t-il par un nombre, après blancs et commentaires ? */
function commenceParUnNombre(b: Buffer): boolean {
  let i = 0;
  for (;;) {
    while (classe(b, i) === 1) i++;
    if (b[i] !== 0x25) break;
    while (i < b.length && !estFinDeLigne(octet(b, i))) i++;
  }
  return (
    finDeNombre(octet(b, i)) || ((b[i] === 0x2b || b[i] === 0x2d) && finDeNombre(octet(b, i + 1)))
  );
}

/**
 * Objets d'un flux d'objets décompressé : lus chacun depuis son décalage, noms
 * comparés comme dans la syntaxe (une chaîne « …/JavaScript » d'un lien n'est
 * pas un nom). En-tête illisible, /N ou /First indirect, construction ambiguë :
 * recherche brute sur tout le contenu. Sans /First, seul MuPDF lit le flux
 * (décalage 0), et seulement s'il commence par un nombre : un profil ICC (/N)
 * n'est pas un flux d'objets.
 */
function inspecterObjets(clair: Buffer, flux: FluxObjets, budget: BudgetJetons): void {
  const { n, premier } = flux;
  if (n !== undefined && premier !== null) {
    if (premier === undefined && !commenceParUnNombre(clair)) return;
    try {
      new AnalyseurPdf(clair, clair.toString("latin1"), budget).objetsCompresses(n, premier ?? 0);
      return;
    } catch (erreur) {
      if (!(erreur instanceof NonConforme)) throw erreur;
    }
  }
  if (rechercheBrute(clair.toString("latin1"))) throw refusPdfActif();
}

/** Flux d'objets (point 3) : décompressés sous plafonds, puis inspectés. */
function inspecterFluxObjets(
  contenu: Buffer,
  { fluxObjets, chiffre }: StructurePdf,
  budget: BudgetJetons,
): void {
  if (fluxObjets.length === 0) return;
  if (chiffre) throw refusPdfIllisible(); // objets chiffrés : illisibles sans le mot de passe
  if (fluxObjets.length > PLAFONDS_PDF.nombreFlux) throw refusPdfVolume();
  let reste: number = PLAFONDS_PDF.totalOctets;
  for (const flux of fluxObjets) {
    if (flux.decodage === null) throw refusPdfIllisible();
    const donnees = contenu.subarray(flux.debut, flux.fin);
    const clair = flux.decodage === "flate" ? inflerBorne(donnees, reste) : donnees;
    if (flux.decodage === "flate") reste -= clair.length;
    inspecterObjets(clair, flux, budget);
  }
}

function verifierPdf(contenu: Buffer): void {
  const s = contenu.toString("latin1");
  const budget: BudgetJetons = { jetons: PLAFOND_JETONS };
  let structure: StructurePdf;
  try {
    structure = new AnalyseurPdf(contenu, s, budget).analyser();
  } catch (erreur) {
    if (!(erreur instanceof NonConforme)) throw erreur;
    // Repli (point 4) : fichier entier, flux compris.
    const texte = decoderNoms(s);
    if (rechercheBrute(s, texte)) throw refusPdfActif();
    if (PDF_FLUX_OBJETS.test(texte)) throw refusPdfIllisible();
    return;
  }
  inspecterFluxObjets(contenu, structure, budget);
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
