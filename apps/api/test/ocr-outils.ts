import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

/*
 * Fabrique de PDF SCANNÉS pour les tests de l'OCR local (aucune dépendance, aucun réseau, aucune base) :
 * chaque page ne contient que des images plein cadre (XObject Image), sans couche texte. Sert aussi de
 * source de PDF hostiles (images géantes, dimensions mensongères, flux tronqué…) fabriqués SANS jamais
 * allouer de gros tampons. Les images vendorées vivent dans `fixtures/ocr/` (générées par `generer.mjs`).
 */

const DOSSIER_FIXTURES = new URL("./fixtures/ocr/", import.meta.url);

/** Image d'une page scannée : JPEG brut, PNG (gris ou RGB 8 bits non entrelacé) ou pixels bruts blancs. */
export type ImageScan =
  | { jpeg: Buffer }
  | { png: Buffer }
  | { brut: { largeur: number; hauteur: number; flate: boolean } };

export interface OptionsPdfScan {
  /** Une entrée par page : une image plein cadre, ou plusieurs images empilées. */
  pages: (ImageScan | ImageScan[])[];
  /** Résolution qui fixe la taille de la page en points (défaut : 150 dpi). */
  dpi?: number;
}

/** Image prête à être écrite : dictionnaire d'espace couleur / filtre et données déjà encodées. */
interface ImageObjet {
  largeur: number;
  hauteur: number;
  /** Entrées du dictionnaire hors Type, Subtype, Width, Height, Length. */
  dictionnaire: string;
  donnees: Buffer;
  /** `/Length` déclaré si différent de la taille réelle (flux tronqué). */
  longueurDeclaree?: number;
  /** Ne pas écrire « endstream » (flux coupé net). */
  sansFinFlux?: boolean;
}

/** Dimensions et composants d'un JPEG, lus dans le premier marqueur SOFn. */
export function entetesJpeg(jpeg: Buffer): {
  largeur: number;
  hauteur: number;
  composants: number;
} {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("JPEG : marqueur SOI absent");
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) throw new Error("JPEG : marqueur attendu");
    const marqueur = jpeg[i + 1] as number;
    if (marqueur === 0xff) {
      i += 1;
      continue;
    }
    const longueur = jpeg.readUInt16BE(i + 2);
    const sof =
      marqueur >= 0xc0 &&
      marqueur <= 0xcf &&
      marqueur !== 0xc4 &&
      marqueur !== 0xc8 &&
      marqueur !== 0xcc;
    if (sof) {
      return {
        hauteur: jpeg.readUInt16BE(i + 5),
        largeur: jpeg.readUInt16BE(i + 7),
        composants: jpeg[i + 9] as number,
      };
    }
    i += 2 + longueur;
  }
  throw new Error("JPEG : marqueur SOF introuvable");
}

/** Lit un PNG gris ou RGB 8 bits non entrelacé : dimensions, canaux et IDAT concaténés. */
export function lirePng(png: Buffer): {
  largeur: number;
  hauteur: number;
  canaux: 1 | 3;
  idat: Buffer;
} {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("PNG : signature");
  let i = 8;
  let ihdr: { largeur: number; hauteur: number; canaux: 1 | 3 } | null = null;
  const idat: Buffer[] = [];
  while (i + 8 <= png.length) {
    const longueur = png.readUInt32BE(i);
    const type = png.toString("latin1", i + 4, i + 8);
    const donnees = png.subarray(i + 8, i + 8 + longueur);
    if (type === "IHDR") {
      const [profondeur, couleur, , , entrelace] = [
        donnees[8],
        donnees[9],
        donnees[10],
        donnees[11],
        donnees[12],
      ];
      if (profondeur !== 8 || entrelace !== 0 || (couleur !== 0 && couleur !== 2)) {
        throw new Error("PNG : seuls gris et RGB 8 bits non entrelacés sont pris en charge");
      }
      ihdr = {
        largeur: donnees.readUInt32BE(0),
        hauteur: donnees.readUInt32BE(4),
        canaux: couleur === 0 ? 1 : 3,
      };
    } else if (type === "IDAT") {
      idat.push(donnees);
    } else if (type === "IEND") {
      break;
    }
    i += 12 + longueur;
  }
  if (!ihdr) throw new Error("PNG : IHDR absent");
  return { ...ihdr, idat: Buffer.concat(idat) };
}

function versObjet(image: ImageScan): ImageObjet {
  if ("jpeg" in image) {
    const { largeur, hauteur, composants } = entetesJpeg(image.jpeg);
    const espace = composants === 1 ? "/DeviceGray" : "/DeviceRGB";
    return {
      largeur,
      hauteur,
      dictionnaire: `/ColorSpace ${espace} /BitsPerComponent 8 /Filter /DCTDecode`,
      donnees: image.jpeg,
    };
  }
  if ("png" in image) {
    const { largeur, hauteur, canaux, idat } = lirePng(image.png);
    const espace = canaux === 1 ? "/DeviceGray" : "/DeviceRGB";
    return {
      largeur,
      hauteur,
      dictionnaire:
        `/ColorSpace ${espace} /BitsPerComponent 8 /Filter /FlateDecode ` +
        `/DecodeParms << /Predictor 15 /Colors ${canaux} /BitsPerComponent 8 /Columns ${largeur} >>`,
      donnees: idat,
    };
  }
  const { largeur, hauteur, flate } = image.brut;
  const pixels = Buffer.alloc(largeur * hauteur, 0xff);
  return {
    largeur,
    hauteur,
    dictionnaire: `/ColorSpace /DeviceGray /BitsPerComponent 8${flate ? " /Filter /FlateDecode" : ""}`,
    donnees: flate ? deflateSync(pixels) : pixels,
  };
}

/**
 * Assemble un PDF dont chaque page n'a que des images plein cadre ; `taille` donne la page en points.
 * Objets : 1 Catalog, 2 Pages, puis par page sa Page, son contenu et ses images. Table xref exacte.
 */
function assembler(pages: ImageObjet[][], taille: (p: ImageObjet[]) => [number, number]): Buffer {
  const parties: Buffer[] = [];
  const decalages: number[] = [];
  let position = 0;
  const ecrire = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    parties.push(buf);
    position += buf.length;
  };
  const objet = (numero: number, corps: (Buffer | string)[]) => {
    decalages[numero] = position;
    ecrire(`${numero} 0 obj\n`);
    for (const c of corps) ecrire(c);
    ecrire("\nendobj\n");
  };
  ecrire("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  let suivant = 3;
  const numerosPages: number[] = [];
  const pagesObjets: { page: number; contenu: number; images: number[] }[] = [];
  for (const images of pages) {
    const page = suivant++;
    const contenu = suivant++;
    pagesObjets.push({ page, contenu, images: images.map(() => suivant++) });
    numerosPages.push(page);
  }
  objet(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  objet(2, [
    `<< /Type /Pages /Kids [${numerosPages.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ]);
  pages.forEach((images, p) => {
    const { page, contenu, images: numeros } = pagesObjets[p] as (typeof pagesObjets)[number];
    const [l, h] = taille(images);
    const ressources = numeros.map((n, k) => `/Im${k + 1} ${n} 0 R`).join(" ");
    objet(page, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${l} ${h}] /Contents ${contenu} 0 R ` +
        `/Resources << /XObject << ${ressources} >> >> >>`,
    ]);
    const flux = images.map((_, k) => `q ${l} 0 0 ${h} 0 0 cm /Im${k + 1} Do Q`).join("\n");
    objet(contenu, [`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`]);
    images.forEach((image, k) => {
      const longueur = image.longueurDeclaree ?? image.donnees.length;
      objet(numeros[k] as number, [
        `<< /Type /XObject /Subtype /Image /Width ${image.largeur} /Height ${image.hauteur} ` +
          `${image.dictionnaire} /Length ${longueur} >>\nstream\n`,
        image.donnees,
        image.sansFinFlux ? "" : "\nendstream",
      ]);
    });
  });
  const debutXref = position;
  const total = suivant;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n += 1) xref += `${String(decalages[n]).padStart(10, "0")} 00000 n \n`;
  ecrire(`${xref}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`);
  return Buffer.concat(parties);
}

/** PDF scanné : une page par entrée de `options.pages`, taille de la page = celle de la première image. */
export function fabriquerPdfScan(options: OptionsPdfScan): Buffer {
  const dpi = options.dpi ?? 150;
  const pages = options.pages.map((p) => (Array.isArray(p) ? p : [p]).map(versObjet));
  return assembler(pages, (images) => {
    const premiere = images[0] as ImageObjet;
    return [
      Math.round(((premiere.largeur * 72) / dpi) * 100) / 100,
      Math.round(((premiere.hauteur * 72) / dpi) * 100) / 100,
    ];
  });
}

export type TypePdfScanHostile =
  | "image_geante"
  | "image_geante_rgb"
  | "dimensions_mensongeres"
  | "beaucoup_d_images"
  | "flux_tronque";

/** Octets d'un fixture vendoré (chemin relatif au dossier `fixtures/ocr/`). */
export function lireFixtureOcr(nom: string): Buffer {
  return readFileSync(fileURLToPath(new URL(nom, DOSSIER_FIXTURES)));
}

/**
 * PDF volontairement hostile, de moins de 100 Ko, fabriqué sans gros tampon :
 * - `image_geante` : XObject déclaré 40000 x 40000 en 1 bit (200 Mo de pixels annoncés) ; le flux Flate
 *   (quelques Ko) se décompresse en 1,5 Mo d'octets nuls, loin du compte attendu ;
 * - `image_geante_rgb` : déclaré 12000 x 12000 en DeviceRGB 8 bits (432 Mo annoncés), flux Flate de
 *   quelques dizaines d'octets ;
 * - `dimensions_mensongeres` : déclaré 100 x 100 mais le JPEG réel (etat-anglais.jpg) est bien plus grand ;
 * - `beaucoup_d_images` : une seule page qui affiche 200 petites images (8 x 8, gris, brutes) ;
 * - `flux_tronque` : flux image JPEG coupé net (3 000 octets d'un JPEG plus long, `/Length` plus grand que
 *   les octets présents, pas de « endstream »).
 */
export function fabriquerPdfScanHostile(options: { type: TypePdfScanHostile }): Buffer {
  const taille = (): [number, number] => [595, 842];
  switch (options.type) {
    case "image_geante":
      return assembler(
        [
          [
            {
              largeur: 40000,
              hauteur: 40000,
              dictionnaire: "/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode",
              donnees: deflateSync(Buffer.alloc(1_500_000)),
            },
          ],
        ],
        taille,
      );
    case "image_geante_rgb":
      return assembler(
        [
          [
            {
              largeur: 12000,
              hauteur: 12000,
              dictionnaire: "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode",
              donnees: deflateSync(Buffer.alloc(3000, 0x80)),
            },
          ],
        ],
        taille,
      );
    case "dimensions_mensongeres":
      return assembler(
        [
          [
            {
              largeur: 100,
              hauteur: 100,
              dictionnaire: "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
              donnees: lireFixtureOcr("etat-anglais.jpg"),
            },
          ],
        ],
        taille,
      );
    case "beaucoup_d_images":
      return assembler(
        [
          Array.from({ length: 200 }, () => ({
            largeur: 8,
            hauteur: 8,
            dictionnaire: "/ColorSpace /DeviceGray /BitsPerComponent 8",
            donnees: Buffer.alloc(64, 0xff),
          })),
        ],
        taille,
      );
    case "flux_tronque": {
      const coupe = lireFixtureOcr("etat-anglais.jpg").subarray(0, 3000);
      return assembler(
        [
          [
            {
              largeur: 1240,
              hauteur: 1754,
              dictionnaire: "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
              donnees: coupe,
              longueurDeclaree: 60000,
              sansFinFlux: true,
            },
          ],
        ],
        taille,
      );
    }
  }
}

/** PDF scanné multipage à partir des images vendorées (JPEG ou PNG, par nom de fichier). */
export function fabriquerPdfScanDepuisFixtures(noms: string[], dpi?: number): Buffer {
  return fabriquerPdfScan({
    dpi,
    pages: noms.map((nom) => {
      const octets = lireFixtureOcr(nom);
      return nom.toLowerCase().endsWith(".png") ? { png: octets } : { jpeg: octets };
    }),
  });
}

export interface LigneVeriteOcr {
  page: number;
  section: string;
  code: string | null;
  libelle: string;
  montant: number;
  role: string | null;
}

export interface FichierManifesteOcr {
  nom: string;
  role: string;
  langue: "fra" | "eng";
  format: "jpeg" | "png";
  largeur: number;
  hauteur: number;
  dpi: number;
  octets: number;
  verite_stricte: boolean;
  entete: string;
  lignes: LigneVeriteOcr[];
}

export interface ManifesteOcr {
  version: number;
  generePar: string;
  note: string;
  fichiers: FichierManifesteOcr[];
}

/** Manifeste des images vendorées : vérité terrain (lignes et montants écrits sur chaque image). */
export function lireManifesteOcr(): ManifesteOcr {
  return JSON.parse(lireFixtureOcr("MANIFESTE.json").toString("utf8")) as ManifesteOcr;
}
