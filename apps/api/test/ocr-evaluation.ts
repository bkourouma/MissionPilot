/*
 * Évaluation reproductible de l'OCR local (lot 11) sur les scans de test : temps par page, RSS maximal du
 * sous-processus, exactitude des montants et des lignes par rapport au manifeste. Pas un test (aucune
 * assertion) : un script de mesure, sans base de données ni réseau.
 *
 *   cd apps/api && npx tsx test/ocr-evaluation.ts                       # réglages retenus
 *   npx tsx test/ocr-evaluation.ts --matrice                            # comparaison des réglages
 *   npx tsx test/ocr-evaluation.ts --donnees <dossier> --langues fra    # autre jeu de données (ex. best)
 *
 * Options : --langues, --psm, --echelle (auto | nombre), --binariser, --sans-espaces, --donnees,
 * --repetitions <n>, --matrice. Les résultats sont imprimés (tableau) et à reporter dans
 * docs/workflows/notes-lots/lot-11.md.
 */
import { performance } from "node:perf_hooks";
import {
  OcrLocal,
  statistiquesOcrLocal,
  type OptionsOcrLocal,
} from "../src/ingestion/ocr-local.js";
import { mesurerTexte } from "./ocr-evaluation-mesures.js";
import { fabriquerPdfScanDepuisFixtures, lireManifesteOcr } from "./ocr-outils.js";

const argv = process.argv.slice(2);
const valeur = (nom: string) => {
  const i = argv.indexOf(nom);
  return i >= 0 ? argv[i + 1] : undefined;
};

const manifeste = lireManifesteOcr();
const fichiers = manifeste.fichiers;

interface Ligne {
  config: string;
  fichier: string;
  msParPage: number;
  rssPicMo: number;
  montants: string;
  lignes: string;
  confiance: number;
  manques: string;
}

async function evaluer(
  nom: string,
  options: OptionsOcrLocal,
  repetitions: number,
): Promise<Ligne[]> {
  const sortie: Ligne[] = [];
  for (const f of fichiers) {
    const pdf = fabriquerPdfScanDepuisFixtures([f.nom], f.dpi);
    let meilleur = Number.POSITIVE_INFINITY;
    let texte = "";
    let confiance = 0;
    let rss = 0;
    for (let k = 0; k < repetitions; k += 1) {
      const ocr = new OcrLocal(options);
      const t0 = performance.now();
      const pages = await ocr.reconnaitre({ pdf, pages: [1] });
      // Durée d'UNE page de bout en bout, démarrage du sous-processus et du moteur compris.
      const duree = performance.now() - t0;
      meilleur = Math.min(meilleur, duree);
      texte = pages[0]?.texte ?? "";
      confiance = pages[0]?.confiance_pm ?? 0;
      rss = Math.max(rss, statistiquesOcrLocal.derniere?.rss_pic ?? 0);
      if (statistiquesOcrLocal.derniere?.tentatives_reseau !== 0) {
        throw new Error("tentative réseau constatée");
      }
    }
    const m = mesurerTexte(texte, f.lignes, f.langue);
    sortie.push({
      config: nom,
      fichier: f.nom,
      msParPage: Math.round(meilleur),
      rssPicMo: Math.round(rss / (1024 * 1024)),
      montants: f.lignes.length ? `${m.montantsExacts}/${m.total}` : `${texte.trim().length} car.`,
      lignes: f.lignes.length ? `${m.lignesExactes}/${m.total}` : "-",
      confiance,
      manques: m.manques.join(","),
    });
    if (argv.includes("--texte")) console.log(`----- ${nom} ${f.nom}\n${texte}\n`);
  }
  return sortie;
}

async function principal(): Promise<void> {
  const repetitions = Number(valeur("--repetitions") ?? 1);
  const base: OptionsOcrLocal = {
    ...(valeur("--donnees")
      ? { dossierDonnees: valeur("--donnees"), ignorerEmpreintes: true }
      : {}),
  };
  const configurations: [string, OptionsOcrLocal][] = [];
  if (argv.includes("--matrice")) {
    // Première passe (2026-10-22) : {fra, fra+eng} x PSM {3, 4, 6} x échelle {1, auto}, binarisation,
    // sans espaces ; ci-dessous, la seconde passe autour des réglages retenus.
    for (const langues of ["fra", "fra+eng"]) {
      for (const psm of [3, 4, 6]) {
        configurations.push([
          `${langues} psm${psm} auto`,
          { ...base, langues, psm, echelle: "auto" },
        ]);
      }
      configurations.push([`${langues} psm3 ech=1`, { ...base, langues, psm: 3, echelle: 1 }]);
    }
    configurations.push(["fra+eng psm3 auto bin", { ...base, psm: 3, binariser: true }]);
    configurations.push(["fra+eng psm3 auto conf0", { ...base, psm: 3, confianceLigneMin: 0 }]);
  } else {
    const echelle = valeur("--echelle");
    configurations.push([
      "retenu",
      {
        ...base,
        ...(valeur("--langues") ? { langues: valeur("--langues") } : {}),
        ...(valeur("--psm") ? { psm: Number(valeur("--psm")) } : {}),
        ...(echelle ? { echelle: echelle === "auto" ? "auto" : Number(echelle) } : {}),
        ...(argv.includes("--binariser") ? { binariser: true } : {}),
        ...(argv.includes("--sans-espaces") ? { preserveEspaces: false } : {}),
      },
    ]);
  }
  const resultats: Ligne[] = [];
  for (const [nom, options] of configurations) {
    resultats.push(...(await evaluer(nom, options, repetitions)));
  }
  console.table(resultats);
}

await principal();
