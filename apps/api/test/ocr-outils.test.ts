import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractImages, getDocumentProxy } from "unpdf";
import {
  entetesJpeg,
  fabriquerPdfScan,
  fabriquerPdfScanDepuisFixtures,
  fabriquerPdfScanHostile,
  lireFixtureOcr,
  lireManifesteOcr,
  type TypePdfScanHostile,
} from "./ocr-outils.js";

/* Tests sans base de données des fabriques de PDF scannés et du jeu d'images vendorées. */

async function ouvrir(pdf: Buffer) {
  return getDocumentProxy(new Uint8Array(pdf));
}

describe("fabriquerPdfScan", () => {
  it("produit un PDF multipage lisible, sans couche texte", async () => {
    const pdf = fabriquerPdfScanDepuisFixtures(["etat-net.jpg", "page-blanche.png"]);
    const doc = await ouvrir(pdf);
    expect(doc.numPages).toBe(2);
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const texte = await page.getTextContent();
      expect(texte.items).toHaveLength(0);
    }
    const page1 = await doc.getPage(1);
    const [, , l, h] = page1.view;
    // 1654 x 2339 pixels à 150 dpi.
    expect(l).toBeCloseTo((1654 * 72) / 150, 0);
    expect(h).toBeCloseTo((2339 * 72) / 150, 0);
  });

  it("accepte plusieurs images par page et des pixels bruts (Flate ou non)", async () => {
    const pdf = fabriquerPdfScan({
      pages: [
        [
          { brut: { largeur: 40, hauteur: 30, flate: true } },
          { brut: { largeur: 40, hauteur: 30, flate: false } },
        ],
      ],
    });
    const doc = await ouvrir(pdf);
    expect(doc.numPages).toBe(1);
    const images = await extractImages(doc, 1);
    expect(images).toHaveLength(2);
    for (const i of images) expect([i.width, i.height]).toEqual([40, 30]);
  });

  it("extractImages rend l'image d'un PDF JPEG", async () => {
    const jpeg = lireFixtureOcr("etat-anglais.jpg");
    const attendu = entetesJpeg(jpeg);
    const doc = await ouvrir(fabriquerPdfScan({ pages: [{ jpeg }] }));
    const images = await extractImages(doc, 1);
    expect(images).toHaveLength(1);
    const image = images[0] as (typeof images)[number];
    expect(image.width).toBe(attendu.largeur);
    expect(image.height).toBe(attendu.hauteur);
    expect([1, 3, 4]).toContain(image.channels);
    expect(image.data.length).toBe(image.width * image.height * image.channels);
  });

  it("extractImages rend l'image d'un PDF PNG", async () => {
    const png = lireFixtureOcr("page-blanche.png");
    const doc = await ouvrir(fabriquerPdfScan({ pages: [{ png }] }));
    const images = await extractImages(doc, 1);
    expect(images).toHaveLength(1);
    const image = images[0] as (typeof images)[number];
    expect(image.width).toBe(827);
    expect(image.height).toBe(1169);
    expect(image.data.length).toBe(image.width * image.height * image.channels);
  });
});

describe("fabriquerPdfScanHostile", () => {
  const declarations: Record<TypePdfScanHostile, RegExp[]> = {
    image_geante: [/\/Width 40000 \/Height 40000/, /\/BitsPerComponent 1 /],
    image_geante_rgb: [/\/Width 12000 \/Height 12000/, /\/DeviceRGB/],
    dimensions_mensongeres: [/\/Width 100 \/Height 100/],
    beaucoup_d_images: [/\/Im200 /],
    flux_tronque: [/\/Width 1240 \/Height 1754/],
  };
  for (const type of Object.keys(declarations) as TypePdfScanHostile[]) {
    it(`${type} : bien formé, petit, dimensions annoncées`, () => {
      const pdf = fabriquerPdfScanHostile({ type });
      expect(pdf.length).toBeLessThan(100 * 1024);
      const texte = pdf.toString("latin1");
      expect(texte.startsWith("%PDF-1.4")).toBe(true);
      for (const motif of declarations[type]) expect(texte).toMatch(motif);
    });
  }

  it("beaucoup_d_images : 200 images sur une page", () => {
    const texte = fabriquerPdfScanHostile({ type: "beaucoup_d_images" }).toString("latin1");
    expect(texte.match(/\/Subtype \/Image/g)).toHaveLength(200);
  });

  it("dimensions_mensongeres : le JPEG réel n'a pas la taille déclarée", () => {
    const reel = entetesJpeg(lireFixtureOcr("etat-anglais.jpg"));
    expect([reel.largeur, reel.hauteur]).not.toEqual([100, 100]);
  });
});

describe("manifeste OCR", () => {
  const manifeste = lireManifesteOcr();

  it("décrit chaque fichier vendoré (existence, taille, dimensions)", () => {
    const noms = manifeste.fichiers.map((f) => f.nom);
    expect(noms).toEqual(
      expect.arrayContaining([
        "etat-net.jpg",
        "etat-degrade.jpg",
        "etat-anglais.jpg",
        "page-blanche.png",
        "etat-confusions.jpg",
      ]),
    );
    let total = 0;
    for (const f of manifeste.fichiers) {
      const octets = statSync(new URL(`./fixtures/ocr/${f.nom}`, import.meta.url)).size;
      expect(octets).toBe(f.octets);
      expect(octets).toBeLessThanOrEqual(120 * 1024);
      total += octets;
      if (f.format === "jpeg") {
        const e = entetesJpeg(lireFixtureOcr(f.nom));
        expect([e.largeur, e.hauteur]).toEqual([f.largeur, f.hauteur]);
      }
    }
    expect(total).toBeLessThanOrEqual(600 * 1024);
  });

  it("l'état français s'équilibre (vérité terrain)", () => {
    const net = manifeste.fichiers.find((f) => f.nom === "etat-net.jpg");
    const somme = (section: string) =>
      (net?.lignes ?? [])
        .filter((l) => l.section === section && l.role !== "total")
        .reduce((s, l) => s + l.montant, 0);
    const total = (section: string) =>
      net?.lignes.find((l) => l.section === section && l.role === "total")?.montant;
    expect(somme("actif")).toBe(total("actif"));
    expect(somme("passif")).toBe(total("passif"));
    expect(total("actif")).toBe(total("passif"));
  });
});
