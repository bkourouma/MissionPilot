import { randomBytes } from "node:crypto";
import { constants as zlibConstantes, deflateRawSync, deflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import { MARQUEUR_OCR_SIMULE } from "../src/ingestion/ocr.js";

/*
 * Fabrique de documents de test de l'ingestion (aucun fichier sur disque, aucun réseau) : PDF à couche
 * texte « maison » (objets Catalog, Pages, Font Helvetica, Page, Content ; table xref exacte), PDF avec le
 * marqueur de l'OCR simulé, PDF actif, classeurs .xlsx. Séparé du harnais (ingestion-outils.ts) pour servir
 * aussi aux tests unitaires sans base de données.
 */

export interface PageOcrTest {
  numero: number;
  texte: string;
  confiance_pm: number;
}

export interface OptionsPdfTest {
  /** Lignes de texte de chaque page ([] : page vide). Prioritaire sur `nbPages`. */
  pages?: string[][];
  /** Nombre de pages vides, quand `pages` est absent. */
  nbPages?: number;
  /** Charge du conteneur de l'OCR simulé (commentaire `%MPOCRSIM1:<base64>`). */
  ocr?: { pages: PageOcrTest[] };
  /** Page très grande (14 400 points) : de quoi porter plus de 25 000 caractères sur une page. */
  grandePage?: boolean;
  /** Ajoute une action JavaScript (PDF actif, refusé au téléversement). */
  actif?: boolean;
}

/** Échappe une chaîne PDF : « \ », « ( » et « ) ». */
function echapper(texte: string): string {
  return texte.split("\\").join("\\\\").split("(").join("\\(").split(")").join("\\)");
}

/** Octets latin1 (WinAnsi) : un caractère hors latin1 devient « ? ». */
function latin1(texte: string): string {
  return Array.from(texte, (c) => ((c.codePointAt(0) as number) <= 0xff ? c : "?")).join("");
}

export function fabriquerPdf(options: OptionsPdfTest = {}): Buffer {
  const pages = options.pages ?? Array.from({ length: options.nbPages ?? 1 }, () => [] as string[]);
  const n = pages.length;
  const [largeur, hauteur] = options.grandePage ? [14400, 14400] : [612, 792];
  const objets: string[] = [];
  const kids = pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ");
  objets.push(
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${options.actif ? " /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>" : ""} >>\nendobj\n`,
  );
  objets.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);
  objets.push(
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
  );
  pages.forEach((lignes, i) => {
    const flux =
      lignes.length === 0
        ? ""
        : `BT /F1 10 Tf 40 760 Td 12 TL\n${lignes
            .map((l) => `(${echapper(latin1(l))}) Tj T*`)
            .join("\n")}\nET`;
    objets.push(
      `${4 + 2 * i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largeur} ${hauteur}] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
    );
    objets.push(
      `${5 + 2 * i} 0 obj\n<< /Length ${flux.length} >>\nstream\n${flux}\nendstream\nendobj\n`,
    );
  });
  let entete = "%PDF-1.4\n";
  if (options.ocr) {
    entete += `${MARQUEUR_OCR_SIMULE}${Buffer.from(JSON.stringify(options.ocr), "utf8").toString("base64")}\n`;
  }
  let corps = entete;
  const decalages: number[] = [];
  for (const o of objets) {
    decalages.push(corps.length);
    corps += o;
  }
  const debutXref = corps.length;
  const total = objets.length + 1;
  corps += `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const d of decalages) corps += `${String(d).padStart(10, "0")} 00000 n \n`;
  corps += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`;
  return Buffer.from(corps, "latin1");
}

/** Liasse SYSCOHADA simplifiée, équilibrée (actif = passif = 16 550 000, résultat 1 050 000), deux pages. */
export const LIASSE_PAGE_1 = [
  "ENTREPRISE EXEMPLE SA - Exercice clos le 31 décembre 2025",
  "BILAN - ACTIF",
  "REF LIBELLÉS NOTE 2025 2024",
  "AD Frais de développement et de prospection 3 1 200 000 1 000 000",
  "AE Brevets, licences et logiciels 350 000 300 000",
  "BK Terrains ........ 15 000 000 15 000 000",
  "BZ TOTAL ACTIF 16 550 000 16 300 000",
  "BILAN - PASSIF (suite)",
  "CA Capital 10 000 000 10 000 000",
  "CF Report à nouveau (500 000) (300 000)",
  "CJ RÉSULTAT NET DE L'EXERCICE 1 050 000 800 000",
  "DA Emprunts et dettes financières 6 000 000 5 800 000",
  "DZ TOTAL PASSIF 16 550 000 16 300 000",
];
export const LIASSE_PAGE_2 = [
  "COMPTE DE RÉSULTAT",
  "CHARGES",
  "RC Achats de marchandises 2 000 000 1 800 000",
  "RE Charges de personnel 1 950 000 1 700 000",
  "TOTAL CHARGES 3 950 000 3 500 000",
  "PRODUITS",
  "TA Ventes de marchandises 5 000 000 4 300 000",
  "TOTAL PRODUITS 5 000 000 4 300 000",
  "RÉSULTAT NET 1 050 000 800 000",
];

/** PDF de la liasse équilibrée (`variante` : variantes de test). */
export function pdfLiasse(
  variante: "equilibree" | "desequilibree" | "ambigue" = "equilibree",
): Buffer {
  let p1 = [...LIASSE_PAGE_1];
  if (variante === "desequilibree") {
    p1 = p1.map((l) => (l.startsWith("DZ ") ? "DZ TOTAL PASSIF 16 000 000 16 300 000" : l));
  }
  if (variante === "ambigue") {
    // Une ligne de plus, hors des totaux, à trois montants (brut, amortissements, net) : rejetée
    // (montants_ambigus) ; le bilan reste équilibré, mais l'état doit partir en revue.
    p1 = p1.flatMap((l) =>
      l.startsWith("AE ") ? [l, "AF Provisions techniques 500 000 150 000 350 000"] : [l],
    );
  }
  return fabriquerPdf({ pages: [p1, LIASSE_PAGE_2] });
}

/** PDF reconnu par la détection (structure saine) mais dont l'arbre des pages manque : illisible. */
export function pdfIllisible(): Buffer {
  return Buffer.from(
    fabriquerPdf({ pages: [["ACTIF", "AD Frais 100"]] })
      .toString("latin1")
      .replace("/Pages 2 0 R", ""),
    "latin1",
  );
}

/** Lignes du modèle (format « page | section | code | parent | role | libellé | montant ») de la liasse. */
export const LIGNES_IA_LIASSE: string[] = [
  "1 | actif | AD | | | Frais de développement et de prospection | 1 200 000",
  "1 | actif | AE | | | Brevets, licences et logiciels | 350 000",
  "1 | actif | BK | | | Terrains | 15 000 000",
  "1 | actif | BZ | | total | TOTAL ACTIF | 16 550 000",
  "1 | passif | CA | | | Capital | 10 000 000",
  "1 | passif | CF | | | Report à nouveau | -500 000",
  "1 | passif | CJ | | resultat_exercice | Résultat net de l'exercice | 1 050 000",
  "1 | passif | DA | | | Emprunts et dettes financières | 6 000 000",
  "1 | passif | DZ | | total | TOTAL PASSIF | 16 550 000",
  "2 | charges | RC | | | Achats de marchandises | 2 000 000",
  "2 | charges | RE | | | Charges de personnel | 1 950 000",
  "2 | charges | TC | | total | TOTAL CHARGES | 3 950 000",
  "2 | produits | TA | | | Ventes de marchandises | 5 000 000",
  "2 | produits | TP | | total | TOTAL PRODUITS | 5 000 000",
  "2 | resultat | RN | | resultat_net | Résultat net | 1 050 000",
];

/** Classeur .xlsx d'une seule feuille ; une ligne = un tableau de cellules (null : cellule vide). */
export async function fabriquerXlsx(lignes: (string | number | null)[][]): Promise<Buffer> {
  const c = new ExcelJS.Workbook();
  const f = c.addWorksheet("Liasse");
  for (const l of lignes) f.addRow(l);
  return Buffer.from((await c.xlsx.writeBuffer()) as ArrayBuffer);
}

/** Liasse Excel à lignes libres (titre en ligne 1, sections, code / libellé / montant). */
export const LIASSE_XLSX: (string | number | null)[][] = [
  ["LIASSE EXEMPLE SA", null, null, null],
  ["ACTIF", null, null, null],
  ["AD", "Frais de développement", 1_200_000, 1_000_000],
  ["BK", "Terrains", 15_000_000, 15_000_000],
  ["BZ", "TOTAL ACTIF", 16_200_000, 16_000_000],
  ["PASSIF", null, null, null],
  ["CA", "Capital", 10_000_000, 10_000_000],
  ["CJ", "Résultat net de l'exercice", 1_050_000, 800_000],
  ["DA", "Emprunts", 5_150_000, 5_200_000],
  ["DZ", "TOTAL PASSIF", 16_200_000, 16_000_000],
  ["CHARGES", null, null, null],
  ["RC", "Achats", 2_000_000, 1_800_000],
  ["TOTAL CHARGES", null, 2_000_000, null],
  ["PRODUITS", null, null, null],
  ["TA", "Ventes", 3_050_000, 4_300_000],
  ["TOTAL PRODUITS", null, 3_050_000, null],
  ["RESULTAT NET", null, 1_050_000, null],
];

/**
 * PDF PIÈGE (« bombe » FlateDecode) : un petit fichier dont le flux de contenu se décompresse en `mo` Mo
 * de « (AAAAAAAAAA) Tj ». Même nature que la preuve de 400 Mo de la revue, en plus petit. La xref est
 * fausse à dessein : pdf.js la reconstruit.
 */
export function fabriquerPdfPiege(mo = 120): Buffer {
  const motif = Buffer.from("(AAAAAAAAAA) Tj\n", "latin1");
  const brut = Buffer.alloc(mo * 1024 * 1024);
  for (let i = 0; i < brut.length; i += motif.length)
    motif.copy(brut, i, 0, Math.min(motif.length, brut.length - i));
  const flux = deflateSync(Buffer.concat([Buffer.from("BT /F1 10 Tf 40 760 Td\n"), brut]));
  return pdfUnFlux(`/FlateDecode`, flux);
}

/** PDF à un seul flux de contenu : squelette minimal (xref fausse, reconstruite par pdf.js). */
function pdfUnFlux(
  filtre: string,
  flux: Buffer,
  mise: { avantFiltre?: string; apresStream?: string } = {},
): Buffer {
  return Buffer.concat([
    Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
        "4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n" +
        `5 0 obj\n<< /Filter ${filtre} ${mise.avantFiltre ?? ""}/Length ${flux.length} >>\n` +
        `stream${mise.apresStream ?? "\n"}`,
      "latin1",
    ),
    flux,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n", "latin1"),
  ]);
}

/**
 * Variantes de BOMBE FlateDecode (`moDecompresse` Mo d'espaces) qui contournaient le pré-contrôle avant la
 * seconde vérification (2026-10-22) ; pdf.js les décompresse toutes :
 * - `espace-avant-eol` : « stream » suivi d'un espace puis de la fin de ligne (`stream \n`) ;
 * - `filtre-lointain` : `/Filter /FlateDecode` à plus de 4 096 octets avant « stream » (clé de remplissage) ;
 * - `texte-avant-eol` : « stream » suivi d'octets quelconques avant la fin de ligne (pdf.js les saute) ;
 * - `endstream-interne` : des octets « endstream » DANS les données compressées (bloc stocké), la bombe
 *   après (pdf.js lit `/Length` octets) ;
 * - `flate-sur-flate` : `[/FlateDecode /FlateDecode]`, la bombe dans la couche interne.
 */
export function fabriquerPdfBombeVariante(
  variante:
    | "espace-avant-eol"
    | "filtre-lointain"
    | "texte-avant-eol"
    | "endstream-interne"
    | "flate-sur-flate",
  moDecompresse = 300,
): Buffer {
  const espaces = Buffer.alloc(moDecompresse * 1024 * 1024, 0x20);
  switch (variante) {
    case "espace-avant-eol":
      return pdfUnFlux(`/FlateDecode`, deflateSync(espaces), { apresStream: " \n" });
    case "filtre-lointain":
      return pdfUnFlux(`/FlateDecode`, deflateSync(espaces), {
        avantFiltre: `/Remplissage (${"x".repeat(6000)}) `,
      });
    case "texte-avant-eol":
      return pdfUnFlux(`/FlateDecode`, deflateSync(espaces), { apresStream: " %note\r\n" });
    case "endstream-interne": {
      // En-tête zlib, bloc STOCKÉ non final contenant « endstream », puis la bombe en deflate brut.
      const leurre = Buffer.from("\nendstream\nendobj\n", "latin1");
      const stocke = Buffer.alloc(5);
      stocke.writeUInt8(0x00, 0); // BFINAL = 0, BTYPE = 00 (stocké), reste de l'octet ignoré
      stocke.writeUInt16LE(leurre.length, 1);
      stocke.writeUInt16LE(~leurre.length & 0xffff, 3);
      const flux = Buffer.concat([
        Buffer.from([0x78, 0x9c]),
        stocke,
        leurre,
        deflateRawSync(espaces),
      ]);
      return pdfUnFlux(`/FlateDecode`, flux);
    }
    case "flate-sur-flate":
      return pdfUnFlux(`[/FlateDecode /FlateDecode]`, deflateSync(deflateSync(espaces)));
  }
}

/**
 * BOMBE FlateDecode de `moDecompresse` Mo décompressés (flux d'espaces), fabriquée VITE (remplissage d'un
 * seul octet, compression quasi instantanée). Le pré-contrôle (`pdf-controle.ts`) la refuse sans lancer le
 * worker : sert à prouver le pré-contrôle sur plusieurs centaines de Mo en restant sous quelques secondes.
 */
export function fabriquerPdfBombe(moDecompresse = 300): Buffer {
  return pdfUnFlux(`/FlateDecode`, deflateSync(Buffer.alloc(moDecompresse * 1024 * 1024, 0x20)));
}

/**
 * PDF à un flux de contenu FlateDecode VALIDE et petit : texte réel compressé (comme un vrai PDF). Le
 * pré-contrôle le décompresse sous ses bornes et le laisse passer ; pdf.js en extrait le texte.
 */
export function fabriquerPdfFlate(lignes: string[]): Buffer {
  const contenu =
    "BT /F1 10 Tf 40 760 Td 12 TL\n" +
    lignes.map((l) => `(${echapper(latin1(l))}) Tj T*`).join("\n") +
    "\nET";
  return pdfUnFlux(`/FlateDecode`, deflateSync(Buffer.from(contenu, "latin1")));
}

/** PDF de plusieurs objets-flux (« n 0 obj << dict >> stream … endstream endobj »), xref fausse. */
function pdfFlux(flux: { dict: string; donnees: Buffer }[]): Buffer {
  const parts: Buffer[] = [
    Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n",
      "latin1",
    ),
  ];
  flux.forEach((f, i) => {
    parts.push(
      Buffer.from(
        `${i + 3} 0 obj\n<< ${f.dict} /Length ${f.donnees.length} >>\nstream\n`,
        "latin1",
      ),
      f.donnees,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    );
  });
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}

/**
 * PDF NORMAL d'environ 10 Mo, LISIBLE : 60 pages dont le contenu (texte) est compressé en Flate et qui
 * affichent chacune une image JPEG (octets pseudo-aléatoires, jamais décompressés par le pré-contrôle ni par
 * l'extraction du texte). Arbre des pages réel (Catalog, Pages, Page), xref fausse reconstruite par pdf.js.
 */
export function fabriquerPdfNormal10Mo(): Buffer {
  const pages = 60;
  // Objets : 1 Catalog, 2 Pages, 3 Font, puis par page p : Page (4 + 3p), contenu (5 + 3p), image (6 + 3p).
  const kids = Array.from({ length: pages }, (_, p) => `${4 + 3 * p} 0 R`).join(" ");
  const parts: Buffer[] = [
    Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n` +
        "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
      "latin1",
    ),
  ];
  let graine = 7;
  for (let p = 0; p < pages; p += 1) {
    const lignes = Array.from(
      { length: 60 },
      (_, l) => `(Ligne ${l} page ${p} : charges de personnel ${(l * 7919) % 1_000_000}) Tj T*`,
    );
    const contenu = deflateSync(
      Buffer.from(
        `BT /F1 9 Tf 30 800 Td 11 TL\n${lignes.join("\n")}\nET\nq 50 0 0 50 500 20 cm /Im1 Do Q`,
      ),
    );
    const jpeg = Buffer.alloc(172_000);
    for (let i = 0; i < jpeg.length; i += 1) {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      jpeg[i] = graine >> 16;
    }
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    const [page, flux, image] = [4 + 3 * p, 5 + 3 * p, 6 + 3 * p];
    parts.push(
      Buffer.from(
        `${page} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents ${flux} 0 R ` +
          `/Resources << /Font << /F1 3 0 R >> /XObject << /Im1 ${image} 0 R >> >> >>\nendobj\n` +
          `${flux} 0 obj\n<< /Filter /FlateDecode /Length ${contenu.length} >>\nstream\n`,
        "latin1",
      ),
      contenu,
      Buffer.from(
        "\nendstream\nendobj\n" +
          `${image} 0 obj\n<< /Type /XObject /Subtype /Image /Width 234 /Height 234 ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
          "stream\n",
        "latin1",
      ),
      jpeg,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    );
  }
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}

/**
 * PDF LÉGITIME d'environ 9 Mo dont l'image (octets aléatoires, incompressibles) est compressée en Flate : le
 * pré-contrôle décompresse ~9 Mo d'entrée pour ~9 Mo de sortie, sous tous ses budgets. Une page de texte.
 */
export function fabriquerPdfImageFlate9Mo(): Buffer {
  const image = deflateSync(randomBytes(9 * 1024 * 1024));
  const contenu = deflateSync(
    Buffer.from(
      "BT /F1 10 Tf 40 760 Td 12 TL (Ligne un du bilan) Tj T* (Ligne deux du bilan) Tj ET\n" +
        "q 100 0 0 100 10 10 cm /Im1 Do Q",
    ),
  );
  return Buffer.concat([
    Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
        "4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R " +
        "/Resources << /Font << /F1 3 0 R >> /XObject << /Im1 6 0 R >> >> >>\nendobj\n" +
        `5 0 obj\n<< /Filter /FlateDecode /Length ${contenu.length} >>\nstream\n`,
      "latin1",
    ),
    contenu,
    Buffer.from(
      "\nendstream\nendobj\n6 0 obj\n<< /Type /XObject /Subtype /Image /Width 1500 /Height 2000 " +
        "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode " +
        `/Length ${image.length} >>\nstream\n`,
      "latin1",
    ),
    image,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 7 >>\n%%EOF\n", "latin1"),
  ]);
}

/**
 * PDF de 10 Mo fait de flux Flate CORROMPUS APRÈS une forte expansion (~31 Mo d'espaces, puis un bloc de
 * type réservé) : chacun reste sous la borne par flux et échoue, donc n'entre pas dans le cumul. Sans
 * plafond de TRAVAIL, le pré-contrôle bloquait la boucle d'événements plusieurs secondes (330 flux).
 */
export function fabriquerPdfFluxCorrompusApresExpansion(): Buffer {
  const corps = deflateRawSync(Buffer.alloc(31 * 1024 * 1024, 0x20), {
    finishFlush: zlibConstantes.Z_SYNC_FLUSH,
  });
  const donnees = Buffer.concat([Buffer.from([0x78, 0x9c]), corps, Buffer.from([0x07, 0, 0, 0])]);
  const n = Math.floor((10 * 1024 * 1024) / (donnees.length + 80));
  return pdfFlux(Array.from({ length: n }, () => ({ dict: "/Filter /FlateDecode", donnees })));
}

/** PDF dont un flux déclaré Flate est CORROMPU dès le début (ignoré par le pré-contrôle, laissé à pdf.js). */
export function fabriquerPdfFluxCorrompu(): Buffer {
  return pdfFlux([
    { dict: "/Filter /FlateDecode", donnees: Buffer.from([0x78, 0x9c, 0x07, 0xff, 0xff, 0xff]) },
  ]);
}

/**
 * Flux en CASCADE `[/ASCIIHexDecode /FlateDecode]` dont la couche Flate se décompresse en `moClair` Mo
 * d'espaces. Il ÉCHAPPE au pré-contrôle (filtre non Flate pur, octets bruts sous la borne), mais fait gonfler
 * la mémoire hors tas de pdf.js dans le worker SANS produire de texte (seule la SURVEILLANCE peut l'arrêter).
 */
export function fabriquerPdfCascadeNonBornee(moClair = 100): Buffer {
  const flate = deflateSync(
    Buffer.concat([
      Buffer.from("BT /F1 10 Tf 40 760 Td ET\n"),
      Buffer.alloc(moClair * 1024 * 1024, 0x20),
    ]),
  );
  const hex = Buffer.from(flate.toString("hex") + ">", "latin1");
  return pdfUnFlux(`[/ASCIIHexDecode /FlateDecode]`, hex);
}

/**
 * Chaîne de blocs deflate « STOCKÉS » VIDES (troisième vérification 2026-10-22, constructions K et K2) :
 * `marqueurs` fois un bloc stocké non final de 11 octets portant `>>stream\nx\x9c` (donc un nouveau début
 * candidat à en-tête zlib valide), suivi de `vides` blocs stockés vides (`00 00 00 FF FF`, aucune sortie).
 * Chaque début candidat fait relire à zlib tout le reste du fichier pour une sortie quasi nulle : l'ancien
 * pré-contrôle, qui ne comptait que la sortie, bloquait la boucle d'événements 73 s (K, 2 500 marqueurs,
 * 9,46 Mo) ou 7,5 s en ACCEPTANT le document (K2, 300 marqueurs, 9,30 Mo).
 */
export function fabriquerPdfBlocsStockesVides(marqueurs = 2500, vides = 790): Buffer {
  const entete = Buffer.from([0x00, 0x0b, 0x00, 0xf4, 0xff]); // stocké, non final, 11 octets
  const marqueur = Buffer.from(">>stream\nx\x9c", "latin1");
  const unite = Buffer.concat([
    entete,
    marqueur,
    Buffer.alloc(vides * 5).fill(Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff])),
  ]);
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\nx\x9c", "latin1"),
    ...Array.from({ length: marqueurs }, () => unite),
    Buffer.from("\nendstream\nendobj\n", "latin1"),
  ]);
}

/** Construction C : `n` petits flux à en-tête zlib valide mais deflate invalide (bloc de type réservé). */
export function fabriquerPdfFluxInvalides(n = 5000): Buffer {
  const objet = (i: number) =>
    `${i + 10} 0 obj\n<< /Filter /FlateDecode /Length 8 >>\nstream\n` +
    "x\x9c\x07\x07\x07\x07\x07\x07\nendstream\nendobj\n";
  return Buffer.from(
    "%PDF-1.4\n" + Array.from({ length: n }, (_, i) => objet(i)).join(""),
    "latin1",
  );
}

/** Construction G : `n` flux Flate valides et vides (au-delà du nombre maximal de décompressions). */
export function fabriquerPdfFluxVides(n = 12000): Buffer {
  return Buffer.from(
    "%PDF-1.4\n" + "<<>>\nstream\nx\x9c\x03\x00\x00\x00\x00\x01\nendstream\n".repeat(n),
    "latin1",
  );
}

/** Construction H : `n` mots « stream » suivis d'un faux en-tête zlib (deflate invalide). */
export function fabriquerPdfFauxEntetes(n = 16000): Buffer {
  return Buffer.from("%PDF-1.4\n" + ">>stream\nx\x9c\xff\n".repeat(n), "latin1");
}

/** Construction H2 : `n` mots « stream » isolés, sans aucune donnée. */
export function fabriquerPdfMotsStream(n = 17000): Buffer {
  return Buffer.from("%PDF-1.4\n" + ">>stream\n".repeat(n), "latin1");
}

/** En-tête zlib (RFC 1950) de taille de fenêtre `cinfo` (0 à 15), méthode 8, FDICT = 0, FCHECK juste. */
export function enteteZlib(cinfo: number): Buffer {
  const cmf = (cinfo << 4) | 8;
  let flg = 0;
  while ((cmf * 256 + flg) % 31 !== 0) flg += 1;
  return Buffer.from([cmf, flg]);
}

const deflatesEspaces = new Map<number, Buffer>();
/** `deflateSync` de `mo` Mo d'espaces, mémorisé (la compression de 400 Mo prend ~1,5 s). */
function espacesCompresses(mo: number): Buffer {
  let d = deflatesEspaces.get(mo);
  if (!d) {
    d = deflateSync(Buffer.alloc(mo * 1024 * 1024, 0x20));
    deflatesEspaces.set(mo, d);
  }
  return d;
}

/**
 * BOMBE de `mo` Mo décompressés dont l'en-tête zlib annonce une fenêtre CINFO = `cinfo` (8 par défaut :
 * premier octet 0x88, FCHECK juste). pdf.js et `inflateRaw` ignorent CINFO : c'est une vraie bombe.
 */
export function fabriquerPdfBombeCinfo(cinfo = 8, mo = 400): Buffer {
  const flux = Buffer.from(espacesCompresses(mo));
  enteteZlib(cinfo).copy(flux, 0);
  return pdfUnFlux(`/FlateDecode`, flux);
}

/** Flux de texte LÉGITIME dont l'en-tête zlib annonce une fenêtre CINFO = `cinfo` (pdf.js le lit). */
export function fabriquerPdfFlateCinfo(cinfo: number, lignes: string[]): Buffer {
  const contenu =
    "BT /F1 10 Tf 40 760 Td 12 TL\n" +
    lignes.map((l) => `(${echapper(latin1(l))}) Tj T*`).join("\n") +
    "\nET";
  const flux = Buffer.concat([enteteZlib(cinfo), deflateRawSync(Buffer.from(contenu, "latin1"))]);
  return pdfUnFlux(`/FlateDecode`, flux);
}

/** Cascade Flate sur Flate de `couches` couches (`[/FlateDecode ...]`) autour de `mo` Mo d'espaces. */
export function fabriquerPdfCascadeFlate(couches: number, mo = 400): Buffer {
  let flux = espacesCompresses(mo);
  for (let i = 1; i < couches; i += 1) flux = deflateSync(flux);
  return pdfUnFlux(`[${Array.from({ length: couches }, () => "/FlateDecode").join(" ")}]`, flux);
}
