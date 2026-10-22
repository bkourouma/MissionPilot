import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { PLAFONDS_INGESTION } from "@missionpilot/shared";
import { ErreurIngestion } from "../src/ingestion/erreurs.js";
import { creerOcr } from "../src/ingestion/fabrique.js";
import { OcrSimule, type Ocr } from "../src/ingestion/ocr.js";
import { avecPlaceExtraction, extrairePagesPdf, statistiquesPdf } from "../src/ingestion/pdf.js";
import { controlerBombePdf, statistiquesControlePdf } from "../src/ingestion/pdf-controle.js";
import { extrairePagesTableur, lignesDeTexteTableur } from "../src/ingestion/tableur.js";
import {
  fabriquerPdf,
  fabriquerPdfBlocsStockesVides,
  fabriquerPdfBombe,
  fabriquerPdfBombeCinfo,
  fabriquerPdfBombeVariante,
  fabriquerPdfCascadeFlate,
  fabriquerPdfCascadeNonBornee,
  fabriquerPdfFauxEntetes,
  fabriquerPdfFlate,
  fabriquerPdfFlateCinfo,
  fabriquerPdfFluxCorrompu,
  fabriquerPdfFluxCorrompusApresExpansion,
  fabriquerPdfFluxInvalides,
  fabriquerPdfFluxVides,
  fabriquerPdfImageFlate9Mo,
  fabriquerPdfMotsStream,
  fabriquerPdfNormal10Mo,
  fabriquerPdfPiege,
  fabriquerXlsx,
  LIASSE_PAGE_1,
  LIASSE_XLSX,
  pdfIllisible,
} from "./ingestion-pdf-outils.js";

/*
 * Extraction du texte (ADR-009) : PDF à couche texte, plafonds, PDF scanné et OCR SIMULÉ, tableur. Tests
 * unitaires : aucune base, aucun réseau.
 */

async function code(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    if (e instanceof ErreurIngestion) return e.code;
    throw e;
  }
  return "AUCUNE_ERREUR";
}

/**
 * Exécute `travail` en mesurant le RETARD de la boucle d'événements du fil principal : un minuteur de 10 ms
 * note le plus grand écart entre deux tours au-delà de 10 ms. Un pré-contrôle sur le fil principal le
 * ferait monter à la durée du balayage (73 s pour la construction K avant correction).
 */
async function sousSurveillanceBoucle<T>(
  travail: () => Promise<T>,
): Promise<{ resultat: T; ms: number; retardMaxMs: number }> {
  let retardMaxMs = 0;
  let dernier = performance.now();
  const minuteur = setInterval(() => {
    const maintenant = performance.now();
    retardMaxMs = Math.max(retardMaxMs, maintenant - dernier - 10);
    dernier = maintenant;
  }, 10);
  try {
    await new Promise((ok) => setTimeout(ok, 30));
    const debut = performance.now();
    const resultat = await travail();
    const ms = performance.now() - debut;
    await new Promise((ok) => setTimeout(ok, 30));
    return { resultat, ms, retardMaxMs };
  } finally {
    clearInterval(minuteur);
  }
}

const REFUS = { ok: false, code: "PLAFOND_TEXTE" } as const;

const TEXTE_OCR = ["ACTIF", "AD Frais de développement 1 200 000", "TOTAL ACTIF 1 200 000"].join(
  "\n",
);

describe("PDF à couche texte", () => {
  it("lit le texte, les pages et les accents, ligne par ligne", async () => {
    const r = await extrairePagesPdf(
      fabriquerPdf({ pages: [LIASSE_PAGE_1, ["COMPTE DE RÉSULTAT", "Charges (a) 100"], []] }),
      { ocr: null },
    );
    expect(r.methode).toBe("texte");
    expect(r.pages.map((p) => [p.numero, p.methode, p.confiance_pm])).toEqual([
      [1, "texte", null],
      [2, "texte", null],
      [3, "texte", null],
    ]);
    expect(r.pages[0]?.texte.split("\n")).toEqual(LIASSE_PAGE_1);
    expect(r.pages[1]?.texte).toBe("COMPTE DE RÉSULTAT\nCharges (a) 100");
    // Une page vide ne bloque rien tant qu'une autre page porte du texte.
    expect(r.pages[2]?.texte).toBe("");
  });

  it("refuse plus de 60 pages AVANT d'extraire le moindre texte", async () => {
    const pdf = fabriquerPdf({ nbPages: PLAFONDS_INGESTION.pagesMax + 1 });
    expect(await code(extrairePagesPdf(pdf, { ocr: null }))).toBe("PLAFOND_PAGES");
    // 60 pages exactement : le plafond n'est pas dépassé.
    const limite = fabriquerPdf({ pages: Array.from({ length: 60 }, (_, i) => [`Page ${i + 1}`]) });
    expect((await extrairePagesPdf(limite, { ocr: null })).pages).toHaveLength(60);
  });

  it("refuse une page ou un document trop chargé en texte (jamais tronqué en silence)", async () => {
    // Lignes de 2 000 caractères sur une grande page : 13 lignes (26 012 caractères) dépassent 25 000.
    const ligne = "x".repeat(2000);
    const lignes = (n: number) => Array.from({ length: n }, () => ligne);
    const page = fabriquerPdf({ grandePage: true, pages: [lignes(13)] });
    expect(await code(extrairePagesPdf(page, { ocr: null }))).toBe("PLAFOND_TEXTE");
    // 17 pages de 24 011 caractères = 408 187 > 400 000 (chaque page reste sous son plafond).
    const document = fabriquerPdf({
      grandePage: true,
      pages: Array.from({ length: 17 }, () => lignes(12)),
    });
    expect(await code(extrairePagesPdf(document, { ocr: null }))).toBe("PLAFOND_TEXTE");
    // Sous les plafonds : 16 pages de 24 011 caractères (384 176) passent.
    const ok = fabriquerPdf({
      grandePage: true,
      pages: Array.from({ length: 16 }, () => lignes(12)),
    });
    expect((await extrairePagesPdf(ok, { ocr: null })).pages).toHaveLength(16);
  });

  it("un PDF illisible donne PDF_ILLISIBLE, jamais un message de bibliothèque", async () => {
    expect(await code(extrairePagesPdf(pdfIllisible(), { ocr: null }))).toBe("PDF_ILLISIBLE");
    expect(await code(extrairePagesPdf(Buffer.from("%PDF-1.4\nrien"), { ocr: null }))).toBe(
      "PDF_ILLISIBLE",
    );
  });

  it("délai dépassé : DELAI_DEPASSE (sans reprise)", async () => {
    const lent: Ocr = {
      fournisseur: "lent",
      mode: "simule",
      reconnaitre: () => new Promise(() => undefined),
    };
    expect(
      await code(extrairePagesPdf(fabriquerPdf({ nbPages: 1 }), { ocr: lent, dureeMs: 150 })),
    ).toBe("DELAI_DEPASSE");
  });

  it("le pré-contrôle refuse une bombe FlateDecode de plusieurs centaines de Mo SANS lancer le worker", async () => {
    // Bombe de 300 Mo décompressés dans un petit fichier (constat C1 : 1,5 Go -> RSS 3,4 Go).
    const bombe = fabriquerPdfBombe(300);
    expect(bombe.length).toBeLessThan(2 * 1024 * 1024);
    const avant = statistiquesPdf.workersCrees;
    expect(await code(extrairePagesPdf(bombe, { ocr: null }))).toBe("PLAFOND_TEXTE");
    // AUCUN worker n'a été créé : le refus vient du pré-contrôle, pas du worker ni du délai.
    expect(statistiquesPdf.workersCrees).toBe(avant);
    // Le pré-contrôle seul rend le même verdict, y compris sur une bombe dont le flux produit du texte.
    expect(await controlerBombePdf(bombe)).toEqual({ ok: false, code: "PLAFOND_TEXTE" });
    expect(await controlerBombePdf(fabriquerPdfPiege(120))).toEqual({
      ok: false,
      code: "PLAFOND_TEXTE",
    });
  }, 20_000);

  it.each([
    "espace-avant-eol",
    "filtre-lointain",
    "texte-avant-eol",
    "endstream-interne",
    "flate-sur-flate",
  ] as const)(
    "le pré-contrôle refuse une bombe de 300 Mo qui le contournait (%s) SANS lancer le worker",
    async (variante) => {
      // Seconde vérification : le pré-contrôle ne dépend plus ni du dictionnaire ni de la fin de ligne.
      const bombe = fabriquerPdfBombeVariante(variante, 300);
      expect(bombe.length).toBeLessThan(2 * 1024 * 1024);
      expect(await controlerBombePdf(bombe)).toEqual({ ok: false, code: "PLAFOND_TEXTE" });
      const avant = statistiquesPdf.workersCrees;
      expect(await code(extrairePagesPdf(bombe, { ocr: null }))).toBe("PLAFOND_TEXTE");
      expect(statistiquesPdf.workersCrees).toBe(avant);
    },
    30_000,
  );

  it("le pré-contrôle reste linéaire et borné : PDF normal de 10 Mo, flux corrompus, mots « stream » en masse", async () => {
    // PDF normal de ~10 Mo (contenus Flate, images JPEG) : balayage en moins de 200 ms dans le worker.
    const normal = fabriquerPdfNormal10Mo();
    expect(normal.length).toBeGreaterThan(9.5 * 1024 * 1024);
    await controlerBombePdf(normal); // mise en route (chargement du module du worker)
    expect(await controlerBombePdf(normal)).toEqual({ ok: true });
    expect(statistiquesControlePdf.dernierBalayageMs).toBeLessThan(200);
    // Un flux corrompu est ignoré (pdf.js tranchera), pas refusé.
    expect(await controlerBombePdf(fabriquerPdfFluxCorrompu())).toEqual({ ok: true });
    // Flux qui échouent après ~31 Mo d'expansion : le plafond de TRAVAIL refuse vite (sans lui, plusieurs
    // secondes de travail).
    let debut = performance.now();
    expect(await controlerBombePdf(fabriquerPdfFluxCorrompusApresExpansion())).toEqual(REFUS);
    expect(performance.now() - debut).toBeLessThan(3000);
    // Mots « stream » en masse, même suivis d'une longue suite de blancs : refus rapide, jamais quadratique.
    const mots = Buffer.from(
      `%PDF-1.4\n${" stream".repeat(1_000_000)}\n${" ".repeat(5_000_000)}x`,
      "latin1",
    );
    debut = performance.now();
    expect(await controlerBombePdf(mots)).toEqual(REFUS);
    expect(performance.now() - debut).toBeLessThan(1000);
  }, 30_000);

  it.each([
    // Troisième vérification : blocs deflate « stockés » vides (aucune sortie, des Mo d'entrée relus à
    // chaque début candidat). Avant : K bloquait la boucle 73 s ; K2 7,5 s et était ACCEPTÉ.
    ["K : 2 500 marqueurs, 790 blocs vides chacun", () => fabriquerPdfBlocsStockesVides(2500, 790)],
    [
      "K2 : 300 marqueurs, 6 500 blocs vides chacun",
      () => fabriquerPdfBlocsStockesVides(300, 6500),
    ],
    // Rejeu des constructions du vérificateur qui n'étaient pas encore couvertes.
    ["C : 5 000 petits flux invalides", () => fabriquerPdfFluxInvalides(5000)],
    ["G : 12 000 flux Flate vides", () => fabriquerPdfFluxVides(12000)],
    ["H : 16 000 faux en-têtes zlib", () => fabriquerPdfFauxEntetes(16000)],
    ["H2 : 17 000 mots « stream »", () => fabriquerPdfMotsStream(17000)],
  ] as const)(
    "refus en moins de 1 s, SANS worker d'extraction ni boucle d'événements bloquée (%s)",
    async (_, fabriquer) => {
      const pdf = fabriquer();
      await controlerBombePdf(fabriquerPdf({ pages: [["chauffe"]] })); // mise en route du worker
      const extraction = statistiquesPdf.workersCrees;
      const controle = statistiquesControlePdf.workersCrees;
      const mesure = await sousSurveillanceBoucle(() => code(extrairePagesPdf(pdf, { ocr: null })));
      expect(mesure.resultat).toBe("PLAFOND_TEXTE");
      // Verdict rapide (budget d'entrée, nombre de décompressions) et fil principal jamais bloqué.
      expect(mesure.ms).toBeLessThan(1000);
      expect(mesure.retardMaxMs).toBeLessThan(100);
      // Un worker de CONTRÔLE, aucun worker d'EXTRACTION.
      expect(statistiquesPdf.workersCrees).toBe(extraction);
      expect(statistiquesControlePdf.workersCrees).toBe(controle + 1);
    },
    30_000,
  );

  it("PDF légitimes de ~9-10 Mo (Flate + JPEG ; image Flate) : acceptés, extraits, fil principal libre, surcoût du worker de contrôle borné", async () => {
    const normal = fabriquerPdfNormal10Mo();
    const image = fabriquerPdfImageFlate9Mo();
    expect(image.length).toBeGreaterThan(9 * 1024 * 1024);
    // Mise en route, puis meilleur de trois essais : la durée de bout en bout du contrôle (création du
    // worker, copie du PDF, verdict, arrêt) dépasse le balayage seul de moins de 150 ms.
    await controlerBombePdf(normal);
    for (const pdf of [normal, image]) {
      let surcout = Infinity;
      for (let essai = 0; essai < 3; essai += 1) {
        const m = await sousSurveillanceBoucle(() => controlerBombePdf(pdf));
        expect(m.resultat).toEqual({ ok: true });
        expect(m.retardMaxMs).toBeLessThan(100);
        expect(statistiquesControlePdf.dernierBalayageMs).toBeLessThan(200);
        surcout = Math.min(surcout, m.ms - statistiquesControlePdf.dernierBalayageMs);
      }
      expect(surcout).toBeLessThan(150);
    }
    // Extraction complète : un worker de contrôle puis un worker d'extraction par document.
    const extraction = statistiquesPdf.workersCrees;
    const controle = statistiquesControlePdf.workersCrees;
    const m = await sousSurveillanceBoucle(() => extrairePagesPdf(normal, { ocr: null }));
    expect(m.resultat.pages).toHaveLength(60);
    expect(m.resultat.pages[0]?.texte).toContain("Ligne 0 page 0");
    expect(m.resultat.pages[59]?.texte).toContain("Ligne 59 page 59");
    expect(m.retardMaxMs).toBeLessThan(100);
    const r = await extrairePagesPdf(image, { ocr: null });
    expect(r.pages[0]?.texte).toContain("Ligne deux du bilan");
    expect(statistiquesPdf.workersCrees).toBe(extraction + 2);
    expect(statistiquesControlePdf.workersCrees).toBe(controle + 2);
  }, 60_000);

  it("délai du pré-contrôle dépassé : worker de contrôle terminé, PLAFOND_TEXTE, aucun worker d'extraction", async () => {
    const extraction = statistiquesPdf.workersCrees;
    // Délai de 1 ms : le worker n'a pas le temps de rendre son verdict, il est terminé.
    expect(await controlerBombePdf(fabriquerPdfNormal10Mo(), { delaiMs: 1 })).toEqual(REFUS);
    expect(statistiquesPdf.workersCrees).toBe(extraction);
    // Le contrôle suivant fonctionne normalement.
    expect(await controlerBombePdf(fabriquerPdf({ pages: [["Bonjour"]] }))).toEqual({ ok: true });
  });

  it("en-tête zlib : CINFO > 7 accepté comme par pdf.js ; bombe CINFO = 8 de 400 Mo refusée SANS worker d'extraction", async () => {
    // Bombe de 400 Mo dont l'en-tête annonce une fenêtre CINFO = 8 (premier octet 0x88, FCHECK juste) :
    // pdf.js et inflateRaw ignorent CINFO, l'ancien pré-contrôle la laissait passer.
    const bombe = fabriquerPdfBombeCinfo(8, 400);
    expect(bombe[bombe.indexOf("stream\n") + 7]).toBe(0x88);
    const extraction = statistiquesPdf.workersCrees;
    const m = await sousSurveillanceBoucle(() => code(extrairePagesPdf(bombe, { ocr: null })));
    expect(m.resultat).toBe("PLAFOND_TEXTE");
    expect(m.ms).toBeLessThan(1000);
    expect(m.retardMaxMs).toBeLessThan(100);
    expect(statistiquesPdf.workersCrees).toBe(extraction);
    expect(await controlerBombePdf(fabriquerPdfBombeCinfo(15, 400))).toEqual(REFUS);
    // Flux légitimes : CINFO de 0 à 7 (et 8, lu par pdf.js) acceptés et extraits.
    for (const cinfo of [0, 7, 8]) {
      const pdf = fabriquerPdfFlateCinfo(cinfo, [`Fenetre ${cinfo} : 1 000 000`]);
      expect(await controlerBombePdf(pdf)).toEqual({ ok: true });
      const r = await extrairePagesPdf(pdf, { ocr: null });
      expect(r.pages[0]?.texte).toContain(`Fenetre ${cinfo} : 1 000 000`);
    }
  }, 30_000);

  it.each([2, 3, 5, 20])(
    "cascade Flate sur Flate de %i couches autour de 400 Mo : refus rapide SANS worker d'extraction",
    async (couches) => {
      const pdf = fabriquerPdfCascadeFlate(couches, 400);
      expect(pdf.length).toBeLessThan(1024 * 1024);
      const extraction = statistiquesPdf.workersCrees;
      const m = await sousSurveillanceBoucle(() => code(extrairePagesPdf(pdf, { ocr: null })));
      expect(m.resultat).toBe("PLAFOND_TEXTE");
      expect(m.ms).toBeLessThan(1000);
      expect(m.retardMaxMs).toBeLessThan(100);
      expect(statistiquesPdf.workersCrees).toBe(extraction);
    },
    30_000,
  );

  it("garde Node < 22.16 : sans Worker.getHeapStatistics, la surveillance du RSS termine encore le worker", async () => {
    // Simule un Node 22.0-22.15 (méthode absente), puis une méthode qui lève : seule la hausse du RSS du
    // processus (seuil abaissé par injection de test) peut alors couper le worker qui gonfle la mémoire.
    let appels = 0;
    const proto = Worker.prototype as unknown as Record<string, unknown>;
    const descripteur = Object.getOwnPropertyDescriptor(proto, "getHeapStatistics");
    const surveillance = {
      intervalleMs: 50,
      // Mémoire externe à 1 octet : si cette mesure était consultée, elle couperait d'elle-même.
      seuilArrayBuffersOctets: 1,
      seuilRssHausseOctets: 48 * 1024 * 1024,
    };
    try {
      for (const remplacement of [
        undefined,
        () => {
          appels += 1;
          throw new Error("mesure indisponible");
        },
      ]) {
        Object.defineProperty(proto, "getHeapStatistics", {
          value: remplacement,
          configurable: true,
          writable: true,
        });
        const avant = statistiquesPdf.workersCrees;
        const resultat = await code(
          extrairePagesPdf(fabriquerPdfCascadeNonBornee(200), {
            ocr: null,
            dureeMs: 25_000,
            surveillance,
          }),
        );
        expect(resultat).toBe("PLAFOND_TEXTE");
        expect(statistiquesPdf.workersCrees).toBe(avant + 1);
      }
      // La méthode qui lève a bien été appelée, sans qu'aucune exception ne sorte du timer ; après la fin
      // de l'extraction, le timer de surveillance est arrêté (plus aucun appel).
      expect(appels).toBeGreaterThan(0);
      const apres = appels;
      await new Promise((ok) => setTimeout(ok, 300));
      expect(appels).toBe(apres);
    } finally {
      if (descripteur) Object.defineProperty(proto, "getHeapStatistics", descripteur);
      else delete proto.getHeapStatistics;
    }
    // Méthode restaurée : extraction normale.
    const r = await extrairePagesPdf(fabriquerPdf({ pages: [["Bonjour"]] }), { ocr: null });
    expect(r.pages[0]?.texte).toBe("Bonjour");
  }, 60_000);

  it("la surveillance termine un worker qui gonfle la mémoire hors tas (flux en cascade, seuil abaissé)", async () => {
    // Flux `[/ASCIIHexDecode /FlateDecode]` : échappe au pré-contrôle, gonfle pdf.js dans le worker sans
    // produire de texte. Seule la SURVEILLANCE peut l'arrêter. Seuil abaissé par injection de test.
    const cascade = fabriquerPdfCascadeNonBornee(100);
    expect(cascade.length).toBeLessThan(2 * 1024 * 1024);
    expect(await controlerBombePdf(cascade)).toEqual({ ok: true });
    const avant = statistiquesPdf.workersCrees;
    const base = process.memoryUsage().rss;
    let pic = 0;
    const sonde = setInterval(() => (pic = Math.max(pic, process.memoryUsage().rss - base)), 50);
    try {
      const resultat = await code(
        extrairePagesPdf(cascade, {
          ocr: null,
          dureeMs: 25_000,
          surveillance: {
            intervalleMs: 100,
            seuilArrayBuffersOctets: 24 * 1024 * 1024,
            seuilRssHausseOctets: 500 * 1024 * 1024,
          },
        }),
      );
      expect(resultat).toBe("PLAFOND_TEXTE");
    } finally {
      clearInterval(sonde);
    }
    // Un seul worker, désormais terminé ; le pic de RSS de ce processus est resté borné (bien sous 1 Go).
    expect(statistiquesPdf.workersCrees).toBe(avant + 1);
    expect(pic).toBeLessThan(1024 * 1024 * 1024);
  }, 30_000);

  it("après un échec le sémaphore est libéré et le processus survit (extraction normale ensuite)", async () => {
    // Trois échecs de suite (bombe, cascade surveillée, PDF illisible) ne doivent fuiter aucune place.
    expect(await code(extrairePagesPdf(fabriquerPdfBombe(300), { ocr: null }))).toBe(
      "PLAFOND_TEXTE",
    );
    expect(
      await code(
        extrairePagesPdf(fabriquerPdfCascadeNonBornee(80), {
          ocr: null,
          dureeMs: 25_000,
          surveillance: { intervalleMs: 100, seuilArrayBuffersOctets: 24 * 1024 * 1024 },
        }),
      ),
    ).toBe("PLAFOND_TEXTE");
    expect(await code(extrairePagesPdf(pdfIllisible(), { ocr: null }))).toBe("PDF_ILLISIBLE");
    // Le processus tourne toujours et les deux places restent disponibles.
    const [a, b] = await Promise.all([
      extrairePagesPdf(fabriquerPdf({ pages: [["Bonjour"]] }), { ocr: null }),
      extrairePagesPdf(fabriquerPdf({ pages: [["Monde"]] }), { ocr: null }),
    ]);
    expect(a.pages[0]?.texte).toBe("Bonjour");
    expect(b.pages[0]?.texte).toBe("Monde");
  }, 30_000);

  it("un flux FlateDecode VALIDE (sous les bornes) passe le pré-contrôle et est extrait", async () => {
    // Un vrai PDF compresse ses flux de contenu : le pré-contrôle les décompresse sous ses bornes.
    const pdf = fabriquerPdfFlate(
      Array.from({ length: 10 }, (_, i) => `Ligne de bilan ${i + 1} : 1 000 000`),
    );
    expect(await controlerBombePdf(pdf)).toEqual({ ok: true });
    const r = await extrairePagesPdf(pdf, { ocr: null });
    expect(r.methode).toBe("texte");
    expect(r.pages[0]?.texte).toContain("Ligne de bilan 1");
    expect(r.pages[0]?.texte).toContain("Ligne de bilan 10");
  });

  it("deux extractions simultanées au plus par processus", async () => {
    let actives = 0;
    let max = 0;
    const travail = async () => {
      actives += 1;
      max = Math.max(max, actives);
      await new Promise((ok) => setTimeout(ok, 20));
      actives -= 1;
    };
    await Promise.all(Array.from({ length: 6 }, () => avecPlaceExtraction(travail)));
    expect(max).toBe(2);
  });
});

describe("PDF scanné et OCR simulé", () => {
  const scanne = (pages = 2) =>
    fabriquerPdf({
      nbPages: pages,
      ocr: {
        pages: [
          { numero: 1, texte: TEXTE_OCR, confiance_pm: 870 },
          { numero: 2, texte: "", confiance_pm: 400 },
        ],
      },
    });

  it("sans OCR : PDF_SANS_TEXTE", async () => {
    expect(await code(extrairePagesPdf(scanne(), { ocr: null }))).toBe("PDF_SANS_TEXTE");
  });

  it("avec l'OCR simulé : pages reconnues avec leur confiance", async () => {
    const r = await extrairePagesPdf(scanne(), { ocr: new OcrSimule() });
    expect(r.methode).toBe("ocr_simule");
    expect(r.pages.map((p) => [p.numero, p.methode, p.confiance_pm])).toEqual([
      [1, "ocr_simule", 870],
      [2, "ocr_simule", 400],
    ]);
    expect(r.pages[0]?.texte).toBe(TEXTE_OCR);
  });

  it("l'OCR simulé ne lit que son conteneur de test", async () => {
    const ocr = new OcrSimule();
    const sansConteneur = fabriquerPdf({ nbPages: 2 });
    expect(await code(extrairePagesPdf(sansConteneur, { ocr }))).toBe("OCR_NON_SIMULE");
    await expect(ocr.reconnaitre({ pdf: sansConteneur, pages: [1] })).rejects.toMatchObject({
      code: "OCR_NON_SIMULE",
    });
    const abime = Buffer.from("%PDF-1.4\n%MPOCRSIM1:AAAA\n", "latin1");
    await expect(ocr.reconnaitre({ pdf: abime, pages: [1] })).rejects.toMatchObject({
      code: "OCR_NON_SIMULE",
    });
    const charge = Buffer.from(JSON.stringify({ pages: [{ numero: 1, texte: 1 }] })).toString(
      "base64",
    );
    await expect(
      ocr.reconnaitre({ pdf: Buffer.from(`%PDF-1.4\n%MPOCRSIM1:${charge}\n`), pages: [1] }),
    ).rejects.toMatchObject({ code: "OCR_NON_SIMULE" });
    // Seules les pages demandées sont rendues.
    const lues = await ocr.reconnaitre({ pdf: scanne(), pages: [2] });
    expect(lues.map((p) => p.numero)).toEqual([2]);
  });

  it("un document dont l'OCR ne lit rien reste PDF_SANS_TEXTE", async () => {
    const vide = fabriquerPdf({
      nbPages: 1,
      ocr: { pages: [{ numero: 1, texte: "  ", confiance_pm: 10 }] },
    });
    expect(await code(extrairePagesPdf(vide, { ocr: new OcrSimule() }))).toBe("PDF_SANS_TEXTE");
  });

  it("aucun OCR en production, l'OCR simulé hors production", () => {
    expect(creerOcr({ NODE_ENV: "production" })).toBeNull();
    expect(creerOcr({ NODE_ENV: "test" })).toBeInstanceOf(OcrSimule);
    expect(creerOcr({ NODE_ENV: "development" })).toBeInstanceOf(OcrSimule);
    expect(new OcrSimule().mode).toBe("simule");
  });
});

describe("tableur", () => {
  it("une feuille = la page 1, une ligne de texte par ligne non vide, cellules à leur place", async () => {
    const r = await extrairePagesTableur(await fabriquerXlsx(LIASSE_XLSX));
    expect(r.methode).toBe("tableur");
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ numero: 1, methode: "tableur", confiance_pm: null });
    const lignes = lignesDeTexteTableur(r.pages[0]?.texte ?? "");
    expect(lignes[0]).toEqual({ numero: 1, valeurs: ["LIASSE EXEMPLE SA"] });
    expect(lignes[2]).toEqual({
      numero: 3,
      valeurs: ["AD", "Frais de développement", "1200000", "1000000"],
    });
    // La cellule vide du milieu garde sa position.
    expect(lignes.find((l) => l.numero === 13)?.valeurs).toEqual(["TOTAL CHARGES", "", "2000000"]);
  });

  it("un classeur illisible donne TABLEUR_ILLISIBLE", async () => {
    expect(await code(extrairePagesTableur(Buffer.from("pas un classeur")))).toBe(
      "TABLEUR_ILLISIBLE",
    );
  });
});
