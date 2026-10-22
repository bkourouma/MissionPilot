/*
 * Générateur des images de test de l'OCR local (lot 11). Script de DÉVELOPPEMENT : il n'est pas lancé en
 * CI, les images qu'il produit sont vendorées dans ce dossier (≤ 120 Ko chacune).
 *
 * Relancer (depuis apps/api) :
 *   node test/fixtures/ocr/generer.mjs
 * Variable facultative : CHROME_PATH (par défaut C:\Program Files\Google\Chrome\Application\chrome.exe).
 *
 * Fonctionnement : puppeteer-core pilote le Chrome local sur du HTML INLINE (aucune URL distante, aucune
 * police web : Arial / Helvetica / DejaVu Sans) et prend des captures JPEG. Tout le texte est INVENTÉ.
 * Le bruit du scan dégradé vient d'un générateur pseudo-aléatoire à graine fixe, la page blanche est
 * écrite sans navigateur : seules les différences de version de Chrome peuvent changer les octets.
 * Le script écrit aussi MANIFESTE.json (vérité terrain : lignes et montants écrits sur chaque image).
 */
/* global document, console */
import { Buffer } from "node:buffer";
import process from "node:process";
import { writeFileSync, statSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath, URL } from "node:url";
import puppeteer from "puppeteer-core";

const DOSSIER = fileURLToPath(new URL("./", import.meta.url));
const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const ENTETE_FR = "ENTREPRISE EXEMPLE SA - Exercice clos le 31 décembre 2025";

/** Vérité terrain de l'état français (page 1) : section, code, libellé, montant entier, rôle. */
const LIGNES_FR = [
  ["actif", "AD", "Immobilisations incorporelles", 1200000, null],
  ["actif", "AE", "Immobilisations corporelles", 8750000, null],
  ["actif", "AF", "Stocks et en-cours", 2300000, null],
  ["actif", "AG", "Créances clients", 3100000, null],
  ["actif", "AH", "Trésorerie", 1200000, null],
  ["actif", "BZ", "Total actif", 16550000, "total"],
  ["passif", "CA", "Capital", 10000000, null],
  ["passif", "CB", "Réserves", 1500000, null],
  ["passif", "CJ", "Résultat net de l'exercice", 1050000, "resultat_exercice"],
  ["passif", "DA", "Emprunts et dettes financières", 2300000, null],
  ["passif", "DB", "Dettes fournisseurs", 1700000, null],
  ["passif", "DZ", "Total passif", 16550000, "total"],
].map(([section, code, libelle, montant, role]) => ({
  page: 1,
  section,
  code,
  libelle,
  montant,
  role,
}));

const LIGNES_EN = [
  ["assets", null, "Fixed assets", 5000000, null],
  ["assets", null, "Inventory", 1500000, null],
  ["assets", null, "Cash", 500000, null],
  ["assets", null, "Total assets", 7000000, "total"],
  ["liabilities", null, "Share capital", 4000000, null],
  ["liabilities", null, "Retained earnings", 1200000, null],
  ["liabilities", null, "Net income", 800000, null],
  ["liabilities", null, "Loans", 1000000, null],
  ["liabilities", null, "Total liabilities", 7000000, "total"],
].map(([section, code, libelle, montant, role]) => ({
  page: 1,
  section,
  code,
  libelle,
  montant,
  role,
}));

/** « 1200000 » -> « 1 200 000 » (espace simple, comme les tests d'ingestion). */
const fr = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const en = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const echapper = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Construit le HTML d'un état : `u` = pixels pour une unité de mise en page (largeur / 1240). */
function html({ largeur, hauteur, lignes, entete, titres, format, police, encre, fond, rotation }) {
  const u = largeur / 1240;
  const corps = [];
  let section = null;
  for (const l of lignes) {
    if (l.section !== section) {
      section = l.section;
      corps.push(`<tr class="t"><td colspan="3">${echapper(titres[section])}</td></tr>`);
    }
    corps.push(
      `<tr class="${l.role === "total" ? "tot" : ""}"><td class="c">${l.code ?? ""}</td>` +
        `<td>${echapper(l.libelle)}</td><td class="m">${format(l.montant)}</td></tr>`,
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:${fond};}
body{width:${largeur}px;height:${hauteur}px;overflow:hidden;font-family:${police};color:${encre};}
.page{position:absolute;left:0;top:0;width:${largeur}px;height:${hauteur}px;transform:rotate(${rotation}deg);transform-origin:50% 50%;}
h1{position:absolute;left:${110 * u}px;top:${120 * u}px;margin:0;font-size:${27 * u}px;font-weight:bold;}
table{position:absolute;left:${110 * u}px;top:${210 * u}px;width:${1020 * u}px;border-collapse:collapse;font-size:${30 * u}px;}
td{padding:${11 * u}px ${6 * u}px;}
td.c{width:${100 * u}px;font-weight:bold;}
td.m{text-align:right;white-space:nowrap;width:${260 * u}px;}
tr.t td{padding-top:${44 * u}px;font-weight:bold;font-size:${31 * u}px;border-bottom:${2 * u}px solid ${encre};}
tr.tot td{font-weight:bold;border-top:${2 * u}px solid ${encre};}
</style></head><body><div class="page"><h1>${echapper(entete)}</h1><table>${corps.join("")}</table></div></body></html>`;
}

/** Ajoute à la page un voile de bruit déterministe (graine fixe), réglé par `force` (0 à 255). */
async function ajouterBruit(page, largeur, hauteur, force, graine) {
  await page.evaluate(
    ({ largeur, hauteur, force, graine }) => {
      let s = graine >>> 0;
      const alea = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const c = document.createElement("canvas");
      c.width = largeur;
      c.height = hauteur;
      c.style.cssText = "position:absolute;left:0;top:0;mix-blend-mode:multiply;";
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(largeur, hauteur);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 255 - Math.floor(alea() * force);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      document.body.appendChild(c);
    },
    { largeur, hauteur, force, graine },
  );
}

const SANS = "Arial, Helvetica, 'DejaVu Sans', sans-serif";
const TITRES_FR = { actif: "BILAN - ACTIF", passif: "BILAN - PASSIF" };
const TITRES_EN = { assets: "ASSETS", liabilities: "LIABILITIES" };

/** Définition des images (nom, dimensions, rendu). */
const IMAGES = [
  {
    nom: "etat-net.jpg",
    role: "Scan propre, cas nominal (français).",
    langue: "fra",
    largeur: 1654,
    hauteur: 2339,
    dpi: 200,
    qualite: 45,
    lignes: LIGNES_FR,
    entete: ENTETE_FR,
    titres: TITRES_FR,
    format: fr,
    police: SANS,
    encre: "#000",
    fond: "#fff",
    rotation: 0,
  },
  {
    nom: "etat-degrade.jpg",
    role: "Même contenu que etat-net, dégradé façon scanner : rotation 0,6°, bruit, contraste réduit, 150 dpi, JPEG qualité 55.",
    langue: "fra",
    largeur: 1240,
    hauteur: 1754,
    dpi: 150,
    qualite: 55,
    lignes: LIGNES_FR,
    entete: ENTETE_FR,
    titres: TITRES_FR,
    format: fr,
    police: SANS,
    encre: "#4a4a4a",
    fond: "#e6e4e0",
    rotation: 0.6,
    bruit: { force: 16, graine: 20261022 },
    flou: 0.6,
  },
  {
    nom: "etat-anglais.jpg",
    role: "Petit état en anglais, pour le secours « eng ».",
    langue: "eng",
    largeur: 1240,
    hauteur: 1754,
    dpi: 150,
    qualite: 80,
    lignes: LIGNES_EN,
    entete: "EXAMPLE TRADING LTD - Year ended 31 December 2025",
    titres: TITRES_EN,
    format: en,
    police: SANS,
    encre: "#000",
    fond: "#fff",
    rotation: 0,
  },
  {
    nom: "etat-confusions.jpg",
    role: "Cas difficile : police Georgia (chiffres elzéviriens, 0 proche de o, 1 proche de l / I), encre pâle. Pas de vérité terrain stricte.",
    langue: "fra",
    largeur: 1240,
    hauteur: 1754,
    dpi: 150,
    qualite: 70,
    lignes: LIGNES_FR,
    entete: ENTETE_FR,
    titres: TITRES_FR,
    format: fr,
    police: "Georgia, 'DejaVu Serif', serif",
    encre: "#2a2a2a",
    fond: "#f4f4f4",
    rotation: 0,
    stricte: false,
  },
];

/** Page blanche à grain léger écrite sans navigateur : PNG 8 bits niveaux de gris (PRNG à graine fixe). */
function pngPageBlanche(largeur, hauteur) {
  let s = 0x1234abcd;
  const alea = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const brut = Buffer.alloc((largeur + 1) * hauteur, 255);
  for (let y = 0; y < hauteur; y += 1) {
    brut[y * (largeur + 1)] = 0; // filtre « aucun »
    for (let x = 0; x < largeur; x += 1) {
      if (alea() < 0.02) brut[y * (largeur + 1) + 1 + x] = 255 - 4 - Math.floor(alea() * 12);
    }
  }
  const crc = (buf) => {
    let c;
    let r = 0xffffffff;
    for (const o of buf) {
      c = (r ^ o) & 0xff;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      r = (r >>> 8) ^ c;
    }
    return (r ^ 0xffffffff) >>> 0;
  };
  const morceau = (type, donnees) => {
    const t = Buffer.concat([Buffer.from(type, "latin1"), donnees]);
    const long = Buffer.alloc(4);
    long.writeUInt32BE(donnees.length);
    const somme = Buffer.alloc(4);
    somme.writeUInt32BE(crc(t));
    return Buffer.concat([long, t, somme]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 0; // niveaux de gris
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau("IHDR", ihdr),
    morceau("IDAT", deflateSync(brut, { level: 9 })),
    morceau("IEND", Buffer.alloc(0)),
  ]);
}

const navigateur = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-sandbox",
    "--force-color-profile=srgb",
    "--font-render-hinting=none",
    "--disable-lcd-text",
  ],
});
const manifeste = {
  version: 1,
  generePar: "apps/api/test/fixtures/ocr/generer.mjs",
  note: "Textes inventés. Les montants sont des entiers (unité monétaire), séparateur de milliers : espace (fra) ou virgule (eng).",
  fichiers: [],
};
try {
  for (const def of IMAGES) {
    const page = await navigateur.newPage();
    await page.setViewport({ width: def.largeur, height: def.hauteur, deviceScaleFactor: 1 });
    await page.setContent(html(def), { waitUntil: "load" });
    if (def.flou) await page.addStyleTag({ content: `.page{filter:blur(${def.flou}px);}` });
    if (def.bruit) {
      await ajouterBruit(page, def.largeur, def.hauteur, def.bruit.force, def.bruit.graine);
    }
    await page.screenshot({ path: DOSSIER + def.nom, type: "jpeg", quality: def.qualite });
    await page.close();
    manifeste.fichiers.push({
      nom: def.nom,
      role: def.role,
      langue: def.langue,
      format: "jpeg",
      largeur: def.largeur,
      hauteur: def.hauteur,
      dpi: def.dpi,
      octets: statSync(DOSSIER + def.nom).size,
      verite_stricte: def.stricte !== false,
      entete: def.entete,
      lignes: def.lignes,
    });
  }
} finally {
  await navigateur.close();
}

const blanche = pngPageBlanche(827, 1169);
writeFileSync(DOSSIER + "page-blanche.png", blanche);
manifeste.fichiers.push({
  nom: "page-blanche.png",
  role: "Page blanche à grain léger : aucun texte (l'OCR doit renvoyer un texte vide ou négligeable).",
  langue: "fra",
  format: "png",
  largeur: 827,
  hauteur: 1169,
  dpi: 100,
  octets: blanche.length,
  verite_stricte: true,
  entete: "",
  lignes: [],
});

writeFileSync(DOSSIER + "MANIFESTE.json", JSON.stringify(manifeste, null, 2) + "\n");
console.log(manifeste.fichiers.map((f) => `${f.nom} ${f.octets} o`).join("\n"));
