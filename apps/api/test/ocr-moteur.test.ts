import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErreurIngestion } from "../src/ingestion/erreurs.js";
import { creerOcr } from "../src/ingestion/fabrique.js";
import { OcrSimule } from "../src/ingestion/ocr.js";
import {
  AVERTISSEMENT_SANS_PERMISSIONS,
  DOSSIER_DONNEES_OCR,
  OcrLocal,
  diagnosticOcrLocal,
  lecturesDossier,
  ocrLocalDisponible,
  oublierDiagnosticOcrLocal,
  permissionNodeDisponible,
  statistiquesOcrLocal,
  VARIABLES_WINDOWS_LIBUV,
  versionNodeAvecPermission,
} from "../src/ingestion/ocr-local.js";
import { mesurerTexte } from "./ocr-evaluation-mesures.js";
import {
  fabriquerPdfScanDepuisFixtures,
  fabriquerPdfScanHostile,
  lireManifesteOcr,
} from "./ocr-outils.js";

/*
 * Moteur OCR LOCAL (lot 11, ADR-009 décision 16) : tesseract.js dans un sous-processus isolé, hors ligne.
 * Aucune base de données, aucun réseau. Les tests du moteur réel sont CONDITIONNELS de façon explicite :
 * s'il n'est pas disponible (moteur ou données absents), ils sont sautés avec un message ; avec
 * `OCR_LOCAL_EXIGE=1` (CI), son absence fait ÉCHOUER le test « disponibilité exigée ». Les seuils de
 * qualité viennent des mesures de `test/ocr-evaluation.ts` (docs/workflows/notes-lots/lot-11.md).
 */

const DISPONIBLE = ocrLocalDisponible();
const RAISON = diagnosticOcrLocal();
/** Modèle de permissions de Node (`--permission`, Node >= 22.13) : exigé en CI comme le moteur. */
const PERMISSION = permissionNodeDisponible();
const SAUT_PERMISSION = PERMISSION ? "" : " (SAUTÉ : modèle de permissions absent, Node < 22.13)";
const manifeste = lireManifesteOcr();
const fixture = (nom: string) => {
  const f = manifeste.fichiers.find((x) => x.nom === nom);
  if (!f) throw new Error(`fixture absente : ${nom}`);
  return f;
};
const pdfDe = (...noms: string[]) =>
  fabriquerPdfScanDepuisFixtures(noms, fixture(noms[0] as string).dpi);

async function code(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
    return "aucune erreur";
  } catch (erreur) {
    return erreur instanceof ErreurIngestion ? erreur.code : `non stable : ${String(erreur)}`;
  }
}

function vivant(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erreur) {
    return (erreur as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Copie des données vendorées dans un dossier temporaire, avec un SHA256SUMS donné. */
function copieDonnees(sha256sums: string | null, langues = ["fra", "eng"]): string {
  const dossier = mkdtempSync(path.join(tmpdir(), "mp-ocr-"));
  for (const l of langues) {
    copyFileSync(
      path.join(DOSSIER_DONNEES_OCR, `${l}.traineddata`),
      path.join(dossier, `${l}.traineddata`),
    );
  }
  if (sha256sums !== null) writeFileSync(path.join(dossier, "SHA256SUMS"), sha256sums);
  return dossier;
}

describe("OCR local : disponibilité et choix de l'adaptateur (sans moteur)", () => {
  it("disponibilité exigée en CI (OCR_LOCAL_EXIGE=1)", () => {
    if (process.env.OCR_LOCAL_EXIGE === "1") {
      expect(RAISON, "le moteur OCR local doit être disponible (OCR_LOCAL_EXIGE=1)").toBeNull();
    } else if (!DISPONIBLE) {
      console.warn(`OCR local indisponible (${RAISON}) : tests du moteur réel sautés.`);
    }
  });

  it("modèle de permissions de Node exigé en CI (OCR_LOCAL_EXIGE=1)", () => {
    if (process.env.OCR_LOCAL_EXIGE === "1") {
      expect(
        PERMISSION,
        `le modèle de permissions de Node doit être disponible (OCR_LOCAL_EXIGE=1, Node ${process.versions.node} : 22.13 minimum)`,
      ).toBe(true);
    } else if (!PERMISSION) {
      console.warn(
        `Modèle de permissions de Node absent (Node ${process.versions.node}) : tests des permissions sautés.`,
      );
    }
  });

  it("version de Node porteuse de --permission : 22.13 au minimum (22.0 à 22.12 : aucune restriction)", () => {
    for (const v of ["22.0.0", "22.12.0", "22.12.9", "21.9.0", "20.18.1", "v22.12.0", "", "x.y"]) {
      expect(versionNodeAvecPermission(v), v).toBe(false);
    }
    for (const v of ["22.13.0", "22.13.1", "22.20.0", "23.0.0", "24.12.0", "v25.1.0"]) {
      expect(versionNodeAvecPermission(v), v).toBe(true);
    }
    // Le Node qui exécute les tests : la présence du drapeau suit la version.
    if (!versionNodeAvecPermission(process.versions.node)) expect(PERMISSION).toBe(false);
  });

  describe("exigence du modèle de permissions (version et permissions simulées)", () => {
    const nodeEnv = process.env.NODE_ENV;
    beforeEach(() => oublierDiagnosticOcrLocal());
    afterEach(() => {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      oublierDiagnosticOcrLocal();
    });
    const sans = () => false;
    const avec = () => true;
    // Moteur ou données absents : cette raison prime (vérification des fichiers d'abord).
    const attendue = (raison: string | null) => RAISON ?? raison;

    it("production SANS permissions : indisponible (raison « permissions »), aucun sous-processus, port null", async () => {
      const avertir = vi.fn();
      const options = { production: true, permissionDisponible: sans, avertir };
      expect(diagnosticOcrLocal(options)).toBe(attendue("permissions"));
      expect(ocrLocalDisponible(options)).toBe(false);
      // Aucun avertissement : en production, c'est un refus, pas une tolérance.
      expect(avertir).not.toHaveBeenCalled();

      const avant = statistiquesOcrLocal.sousProcessusCrees;
      const pdf = Buffer.from("%PDF-1.4");
      expect(await code(new OcrLocal(options).reconnaitre({ pdf, pages: [1] }))).toBe(
        "OCR_INDISPONIBLE",
      );
      // `permission: "non"` est refusé de même en production.
      expect(
        await code(
          new OcrLocal({
            production: true,
            permissionDisponible: avec,
            permission: "non",
          }).reconnaitre({ pdf, pages: [1] }),
        ),
      ).toBe("OCR_INDISPONIBLE");
      expect(statistiquesOcrLocal.sousProcessusCrees).toBe(avant);

      // Chaîne : la fabrique ne retient pas l'adaptateur, le port vaut null (scan -> OCR_INDISPONIBLE).
      expect(
        creerOcr({ NODE_ENV: "production" }, { disponible: () => ocrLocalDisponible(options) }),
      ).toBeNull();
    });

    it("production par défaut déduite de NODE_ENV (staging compris) : permissions exigées", () => {
      for (const env of ["production", "staging"]) {
        process.env.NODE_ENV = env;
        expect(diagnosticOcrLocal({ permissionDisponible: sans }), env).toBe(
          attendue("permissions"),
        );
      }
      process.env.NODE_ENV = "development";
      const avertir = vi.fn();
      expect(diagnosticOcrLocal({ permissionDisponible: sans, avertir })).toBe(attendue(null));
    });

    it("développement SANS permissions : disponible, avec UN avertissement par processus (sans contenu)", () => {
      const avertir = vi.fn();
      const options = { production: false, permissionDisponible: sans, avertir };
      expect(ocrLocalDisponible(options)).toBe(RAISON === null);
      expect(ocrLocalDisponible(options)).toBe(RAISON === null);
      expect(diagnosticOcrLocal(options)).toBe(attendue(null));
      const autre = vi.fn();
      expect(ocrLocalDisponible({ ...options, avertir: autre })).toBe(RAISON === null);
      if (RAISON === null) {
        expect(avertir).toHaveBeenCalledTimes(1);
        expect(avertir).toHaveBeenCalledWith(AVERTISSEMENT_SANS_PERMISSIONS);
        expect(autre).not.toHaveBeenCalled();
      }
      // Un journal en panne ne change pas la disponibilité.
      oublierDiagnosticOcrLocal();
      const enPanne = () => {
        throw new Error("journal en panne");
      };
      expect(ocrLocalDisponible({ ...options, avertir: enPanne })).toBe(RAISON === null);
    });

    it("production AVEC permissions : disponible, sans avertissement", () => {
      const avertir = vi.fn();
      expect(diagnosticOcrLocal({ production: true, permissionDisponible: avec, avertir })).toBe(
        attendue(null),
      );
      // Une sonde de permission en panne vaut « absente » : refus en production.
      const enPanne = () => {
        throw new Error("panne");
      };
      expect(diagnosticOcrLocal({ production: true, permissionDisponible: enPanne })).toBe(
        attendue("permissions"),
      );
      if (PERMISSION) expect(diagnosticOcrLocal({ production: true })).toBe(attendue(null));
      expect(avertir).not.toHaveBeenCalled();
    });
  });

  it("--allow-fs-read d'un dossier : chemin exact ET séparateur final, jamais de joker ni de parent", () => {
    const dossier = path.join(tmpdir(), "mp-ocr-lecture", "node_modules");
    expect(lecturesDossier(dossier)).toEqual([dossier, dossier + path.sep]);
    expect(lecturesDossier(dossier + path.sep)).toEqual([dossier, dossier + path.sep]);
    expect(lecturesDossier(path.join(dossier, "a", ".."))).toEqual([dossier, dossier + path.sep]);
    const racine = path.parse(process.cwd()).root;
    expect(lecturesDossier(racine)).toEqual([racine]);
    expect(lecturesDossier(dossier).some((l) => l.includes("*"))).toBe(false);
  });

  it("creerOcr : simulé par défaut en test, local seulement s'il est demandé ET disponible", () => {
    const oui = { disponible: () => true };
    const non = { disponible: () => false };
    expect(creerOcr({ NODE_ENV: "test" }, oui)).toBeInstanceOf(OcrSimule);
    expect(creerOcr({ NODE_ENV: "test", OCR_LOCAL: "local" }, oui)).toBeInstanceOf(OcrLocal);
    expect(creerOcr({ NODE_ENV: "test", OCR_LOCAL: "local" }, non)).toBeInstanceOf(OcrSimule);
    expect(creerOcr({ NODE_ENV: "development" }, oui)).toBeInstanceOf(OcrLocal);
    expect(creerOcr({ NODE_ENV: "development" }, non)).toBeInstanceOf(OcrSimule);
    expect(creerOcr({ NODE_ENV: "development", OCR_LOCAL: "off" }, oui)).toBeInstanceOf(OcrSimule);
    expect(creerOcr({ NODE_ENV: "development", OCR_LOCAL: "simule" }, oui)).toBeInstanceOf(
      OcrSimule,
    );
  });

  it("creerOcr en production : local s'il est disponible, sinon AUCUN (jamais le simulé)", () => {
    const oui = { disponible: () => true };
    const non = { disponible: () => false };
    const enPanne = {
      disponible: () => {
        throw new Error("panne");
      },
    };
    expect(creerOcr({ NODE_ENV: "production" }, oui)).toBeInstanceOf(OcrLocal);
    expect(creerOcr({ NODE_ENV: "production" }, non)).toBeNull();
    expect(creerOcr({ NODE_ENV: "production" }, enPanne)).toBeNull();
    expect(creerOcr({ NODE_ENV: "production", OCR_LOCAL: "off" }, oui)).toBeNull();
    expect(creerOcr({ NODE_ENV: "production", OCR_LOCAL: "simule" }, oui)).toBeNull();
    expect(creerOcr({ NODE_ENV: "staging" }, non)).toBeNull();
    const ocr = creerOcr({ NODE_ENV: "production" }, oui);
    expect(ocr?.mode).toBe("local");
    expect(ocr?.fournisseur).toBe("tesseract.js");
  });

  it("données absentes, empreinte fausse ou absente : désactivation propre, sans exception ni sous-processus", async () => {
    const vide = mkdtempSync(path.join(tmpdir(), "mp-ocr-vide-"));
    expect(diagnosticOcrLocal({ dossierDonnees: vide })).toBe("donnees");
    expect(ocrLocalDisponible({ dossierDonnees: vide })).toBe(false);

    const fausse = copieDonnees(
      `${"0".repeat(64)}  fra.traineddata\n${"1".repeat(64)}  eng.traineddata\n`,
    );
    expect(diagnosticOcrLocal({ dossierDonnees: fausse })).toBe("empreintes");
    const sansSommes = copieDonnees(null);
    expect(diagnosticOcrLocal({ dossierDonnees: sansSommes })).toBe("empreintes");
    const illisible = copieDonnees("pas une empreinte\n");
    expect(diagnosticOcrLocal({ dossierDonnees: illisible })).toBe("empreintes");
    expect(diagnosticOcrLocal({ langues: "fra+../../x" })).toBe("donnees");

    const avant = statistiquesOcrLocal.sousProcessusCrees;
    const ocr = new OcrLocal({ dossierDonnees: fausse });
    expect(await code(ocr.reconnaitre({ pdf: Buffer.from("%PDF-1.4"), pages: [1] }))).toBe(
      "OCR_INDISPONIBLE",
    );
    expect(statistiquesOcrLocal.sousProcessusCrees).toBe(avant);
  });

  it("plafond de pages vérifié AVANT tout travail (aucun sous-processus, aucune file)", async () => {
    const avant = statistiquesOcrLocal.sousProcessusCrees;
    const ocr = new OcrLocal({ dossierDonnees: mkdtempSync(path.join(tmpdir(), "mp-ocr-p-")) });
    const pages = Array.from({ length: 31 }, (_, i) => i + 1);
    expect(await code(ocr.reconnaitre({ pdf: Buffer.from("%PDF-1.4"), pages }))).toBe(
      "PLAFOND_PAGES",
    );
    expect(
      await code(
        new OcrLocal({ pagesMax: 2 }).reconnaitre({ pdf: Buffer.alloc(0), pages: [1, 2, 3] }),
      ),
    ).toBe("PLAFOND_PAGES");
    expect(await code(ocr.reconnaitre({ pdf: Buffer.alloc(0), pages: [0] }))).toBe("PDF_ILLISIBLE");
    expect(await new OcrLocal().reconnaitre({ pdf: Buffer.alloc(0), pages: [] })).toEqual([]);
    expect(statistiquesOcrLocal.sousProcessusCrees).toBe(avant);
  });
});

describe.skipIf(!DISPONIBLE)(
  `OCR local : moteur réel tesseract.js${DISPONIBLE ? "" : ` (SAUTÉ : ${RAISON})`}`,
  () => {
    const rssApiDepart = process.memoryUsage.rss();
    let rssApiPic = rssApiDepart;
    const noterRss = () => {
      rssApiPic = Math.max(rssApiPic, process.memoryUsage.rss());
    };
    beforeEach(noterRss);
    afterAll(() => {
      // Le processus de l'API ne porte ni le décodage ni le moteur : sa mémoire reste bornée.
      noterRss();
      expect(rssApiPic - rssApiDepart).toBeLessThan(200 * 1024 * 1024);
    });

    it("scan net (français) : montants et lignes retrouvés exactement, sous-processus terminé, aucune tentative réseau", async () => {
      const f = fixture("etat-net.jpg");
      const [page] = await new OcrLocal().reconnaitre({ pdf: pdfDe(f.nom), pages: [1] });
      noterRss();
      const bilan = statistiquesOcrLocal.derniere;
      expect(page?.numero).toBe(1);
      const m = mesurerTexte(page?.texte ?? "", f.lignes, "fra");
      // Mesuré : 12/12 montants et 11 à 12/12 lignes exactes (voir lot-11.md).
      expect(m.montantsExacts).toBeGreaterThanOrEqual(11);
      expect(m.lignesExactes).toBeGreaterThanOrEqual(10);
      // Les colonnes restent sur la même ligne, séparées par des espaces.
      expect(page?.texte).toMatch(/Capital {2,}10 000 000/);
      expect(page?.confiance_pm).toBeGreaterThanOrEqual(850);
      expect(page?.confiance_pm).toBeLessThanOrEqual(1000);
      expect(bilan?.issue).toBe("ok");
      expect(bilan?.tentatives_reseau).toBe(0);
      expect(bilan?.termine).toBe(true);
      expect(vivant(bilan?.pid)).toBe(false);
    }, 90_000);

    it("scan dégradé, anglais et police difficile : seuils mesurés ; page blanche : texte vide et confiance nulle", async () => {
      const noms = [
        "etat-degrade.jpg",
        "etat-anglais.jpg",
        "etat-confusions.jpg",
        "page-blanche.png",
      ];
      const pdf = fabriquerPdfScanDepuisFixtures(noms, 150);
      const pages = await new OcrLocal().reconnaitre({ pdf, pages: [1, 2, 3, 4] });
      noterRss();
      expect(pages.map((p) => p.numero)).toEqual([1, 2, 3, 4]);
      const [degrade, anglais, confusions, blanche] = pages;
      const md = mesurerTexte(degrade?.texte ?? "", fixture(noms[0] as string).lignes, "fra");
      const ma = mesurerTexte(anglais?.texte ?? "", fixture(noms[1] as string).lignes, "eng");
      const mc = mesurerTexte(confusions?.texte ?? "", fixture(noms[2] as string).lignes, "fra");
      expect(md.montantsExacts).toBeGreaterThanOrEqual(11); // mesuré 12/12
      expect(ma.montantsExacts).toBeGreaterThanOrEqual(8); // mesuré 9/9
      expect(mc.montantsExacts).toBeGreaterThanOrEqual(9); // mesuré 11/12 (cas sans vérité stricte)
      expect(blanche?.texte.trim()).toBe("");
      expect(blanche?.confiance_pm).toBe(0);
      expect(statistiquesOcrLocal.derniere?.tentatives_reseau).toBe(0);
    }, 120_000);

    it("page sans image utile (200 vignettes) : texte vide, confiance nulle", async () => {
      const pdf = fabriquerPdfScanHostile({ type: "beaucoup_d_images" });
      const pages = await new OcrLocal().reconnaitre({ pdf, pages: [1] });
      expect(pages).toEqual([{ numero: 1, texte: "", confiance_pm: 0 }]);
    }, 60_000);

    it("images géantes (1 bit et RGB) : IMAGE_TROP_GRANDE avant tout décodage, mémoire bornée", async () => {
      for (const type of ["image_geante", "image_geante_rgb"] as const) {
        const debut = Date.now();
        expect(
          await code(
            new OcrLocal().reconnaitre({ pdf: fabriquerPdfScanHostile({ type }), pages: [1] }),
          ),
        ).toBe("IMAGE_TROP_GRANDE");
        noterRss();
        const bilan = statistiquesOcrLocal.derniere;
        // Retirée par `maxImageSize` sur son dictionnaire : jamais décodée (432 Mo / 200 Mo annoncés).
        expect(bilan?.rss_pic ?? 0).toBeLessThan(400 * 1024 * 1024);
        expect(Date.now() - debut).toBeLessThan(30_000);
        expect(vivant(bilan?.pid)).toBe(false);
      }
    }, 90_000);

    it("dimensions mensongères : vérification de secours sur l'en-tête JPEG, avant pdf.js (IMAGE_TROP_GRANDE)", async () => {
      const pdf = fabriquerPdfScanHostile({ type: "dimensions_mensongeres" });
      // Dictionnaire 100 x 100 (accepté par `maxImageSize` de pdf.js), en-tête JPEG réel 1240 x 1754 =
      // 2,2 Mpx > 1 Mpx : refusé par la lecture des en-têtes SOFn, sans aucun décodage.
      expect(
        await code(new OcrLocal({ pixelsParImageMax: 1_000_000 }).reconnaitre({ pdf, pages: [1] })),
      ).toBe("IMAGE_TROP_GRANDE");
      // Plafond normal : pdf.js ramène l'image aux dimensions déclarées (100 x 100), une vignette ignorée.
      const [page] = await new OcrLocal().reconnaitre({ pdf, pages: [1] });
      expect(page).toEqual({ numero: 1, texte: "", confiance_pm: 0 });
      expect(statistiquesOcrLocal.derniere?.issue).toBe("ok");
    }, 90_000);

    it("flux d'image tronqué : code stable (jamais de plantage ni de message de bibliothèque)", async () => {
      const pdf = fabriquerPdfScanHostile({ type: "flux_tronque" });
      let issue: string;
      try {
        const pages = await new OcrLocal().reconnaitre({ pdf, pages: [1] });
        issue = pages.length === 1 ? "lu" : "absent";
      } catch (erreur) {
        issue = erreur instanceof ErreurIngestion ? erreur.code : "non stable";
      }
      // Mesuré : JPEG coupé que pdf.js ne décode pas -> page sans image utile (texte vide).
      expect(["lu", "PDF_ILLISIBLE", "IMAGE_TROP_GRANDE"]).toContain(issue);
      expect(vivant(statistiquesOcrLocal.derniere?.pid)).toBe(false);
    }, 60_000);

    it("plafond de caractères par page : PLAFOND_TEXTE", async () => {
      const ocr = new OcrLocal({ caracteresParPage: 50 });
      expect(await code(ocr.reconnaitre({ pdf: pdfDe("etat-anglais.jpg"), pages: [1] }))).toBe(
        "PLAFOND_TEXTE",
      );
    }, 60_000);

    it("délai par étape dépassé : DELAI_DEPASSE, sous-processus tué et constaté mort", async () => {
      const ocr = new OcrLocal({ delaiParEtapeMs: 50 });
      expect(await code(ocr.reconnaitre({ pdf: pdfDe("etat-net.jpg"), pages: [1] }))).toBe(
        "DELAI_DEPASSE",
      );
      const bilan = statistiquesOcrLocal.derniere;
      expect(bilan?.tueParParent).toBe(true);
      expect(bilan?.termine).toBe(true);
      expect(vivant(bilan?.pid)).toBe(false);
    }, 60_000);

    it("délai global dépassé : DELAI_DEPASSE, sous-processus tué", async () => {
      const ocr = new OcrLocal({ dureeMs: 400 });
      expect(await code(ocr.reconnaitre({ pdf: pdfDe("etat-net.jpg"), pages: [1] }))).toBe(
        "DELAI_DEPASSE",
      );
      expect(vivant(statistiquesOcrLocal.derniere?.pid)).toBe(false);
    }, 60_000);

    it("mémoire du sous-processus dépassée : OCR_ECHEC, sous-processus tué", async () => {
      const ocr = new OcrLocal({ rssMaxOctets: 48 * 1024 * 1024 });
      expect(await code(ocr.reconnaitre({ pdf: pdfDe("etat-net.jpg"), pages: [1] }))).toBe(
        "OCR_ECHEC",
      );
      const bilan = statistiquesOcrLocal.derniere;
      expect(bilan?.termine).toBe(true);
      expect(vivant(bilan?.pid)).toBe(false);
    }, 60_000);

    it("garde réseau : toute tentative (fil principal ET worker) est bloquée et comptée -> OCR_ECHEC", async () => {
      const ocr = new OcrLocal({ sonde: { reseau: true } });
      expect(await code(ocr.reconnaitre({ pdf: pdfDe("page-blanche.png"), pages: [1] }))).toBe(
        "OCR_ECHEC",
      );
      const bilan = statistiquesOcrLocal.derniere;
      const essais = (bilan?.sonde.reseau ?? []) as { nom: string; bloque: boolean }[];
      expect(essais.map((e) => e.nom)).toEqual([
        "net.connect",
        "socket.connect",
        "dns.lookup",
        "dns.promises.resolve",
        "http.get",
        "https.request",
        "fetch",
        "child_process.spawn",
        "worker",
      ]);
      expect(essais.every((e) => e.bloque)).toBe(true);
      // 8 tentatives dans le fil principal + 2 dans le worker.
      expect(bilan?.tentatives_reseau).toBeGreaterThanOrEqual(10);
      expect(bilan?.cibles_reseau.some((c) => c.startsWith("worker:"))).toBe(true);
    }, 60_000);

    it("sans chemin de données, tesseract.js voudrait le CDN : le garde le refuse et le compte", async () => {
      const ocr = new OcrLocal({ sonde: { sansCheminDonnees: true } });
      expect(await code(ocr.reconnaitre({ pdf: pdfDe("etat-anglais.jpg"), pages: [1] }))).toBe(
        "OCR_ECHEC",
      );
      const bilan = statistiquesOcrLocal.derniere;
      expect(bilan?.tentatives_reseau).toBeGreaterThanOrEqual(1);
      expect(bilan?.cibles_reseau).toContain("worker:fetch");
    }, 60_000);

    it("donnée de langue manquante : échec immédiat (OCR_ECHEC), aucun téléchargement tenté", async () => {
      const dossier = copieDonnees(null, ["fra"]);
      const ocr = new OcrLocal({
        dossierDonnees: dossier,
        langues: "fra+eng",
        ignorerEmpreintes: true,
      });
      // Le diagnostic voit le fichier manquant : l'adaptateur ne démarre même pas.
      expect(await code(ocr.reconnaitre({ pdf: pdfDe("etat-anglais.jpg"), pages: [1] }))).toBe(
        "OCR_INDISPONIBLE",
      );
    });

    it("environnement du sous-processus VIDE : aucune variable (secrète ou non) de l'API transmise", async () => {
      process.env.MP_SECRET_TEST_OCR = "ne-doit-pas-sortir";
      try {
        await new OcrLocal().reconnaitre({ pdf: pdfDe("page-blanche.png"), pages: [1] });
      } finally {
        delete process.env.MP_SECRET_TEST_OCR;
      }
      const cles = statistiquesOcrLocal.derniere?.env_cles ?? null;
      expect(cles).not.toBeNull();
      expect(cles).not.toContain("MP_SECRET_TEST_OCR");
      expect(cles).not.toContain("DATABASE_URL");
      expect(cles).not.toContain("NODE_OPTIONS");
      // Linux : vide. Windows : seulement les variables système que libuv ajoute d'office.
      const admises: readonly string[] =
        process.platform === "win32" ? VARIABLES_WINDOWS_LIBUV : [];
      expect((cles ?? []).filter((c) => !admises.includes(c.toUpperCase()))).toEqual([]);
    }, 60_000);

    // Sans le modèle de permissions : sauté AVEC message ; avec OCR_LOCAL_EXIGE=1, le test « modèle de
    // permissions de Node exigé en CI » échoue explicitement.
    it.skipIf(!PERMISSION)(
      `modèle de permissions de Node : aucune écriture, aucun sous-processus, lecture hors périmètre refusée${SAUT_PERMISSION}`,
      async () => {
        const horsPerimetre = fileURLToPath(new URL("../../../package.json", import.meta.url));
        await new OcrLocal({ sonde: { fichier: horsPerimetre } }).reconnaitre({
          pdf: pdfDe("page-blanche.png"),
          pages: [1],
        });
        const bilan = statistiquesOcrLocal.derniere;
        expect(bilan?.permission).toEqual({ actif: true, ecriture: false, enfants: false });
        expect(bilan?.sonde.fichier).toBe("refuse");
      },
      60_000,
    );

    it.skipIf(!PERMISSION)(
      `droits de lecture insuffisants (données hors --allow-fs-read) : OCR_ECHEC, échec FERMÉ, aucun repli réseau${SAUT_PERMISSION}`,
      async () => {
        // Simule une version de Node dont la sémantique de --allow-fs-read ne couvrirait pas un dossier :
        // l'OCR doit échouer, jamais tourner sans le périmètre ni chercher les données ailleurs. Garde
        // aussi le dossier courant du sous-processus : sous Node 24.12, un worker_thread lit le dossier
        // courant hors --allow-fs-read ; si le sous-processus héritait de celui de l'API (`apps/api`, qui
        // contient `ocr-data/`), tesseract.js lirait ses données et ce test échouerait.
        const donnee = path.join(DOSSIER_DONNEES_OCR, "fra.traineddata");
        const ocr = new OcrLocal({ sonde: { sansLectureDonnees: true, fichier: donnee } });
        expect(await code(ocr.reconnaitre({ pdf: pdfDe("etat-anglais.jpg"), pages: [1] }))).toBe(
          "OCR_ECHEC",
        );
        const bilan = statistiquesOcrLocal.derniere;
        expect(bilan?.permission?.actif).toBe(true);
        expect(bilan?.sonde.fichier).toBe("refuse");
        expect(bilan?.tentatives_reseau).toBe(0);
        expect(bilan?.termine).toBe(true);
        expect(vivant(bilan?.pid)).toBe(false);
      },
      60_000,
    );

    it("une seule reconnaissance à la fois par processus ; un sous-processus par document, jamais réutilisé", async () => {
      statistiquesOcrLocal.simultanesMax = 0;
      const avant = statistiquesOcrLocal.sousProcessusCrees;
      const pdf = pdfDe("page-blanche.png");
      const a = new OcrLocal().reconnaitre({ pdf, pages: [1] });
      const b = new OcrLocal().reconnaitre({ pdf, pages: [1] });
      // La seconde attend son tour (file) : un troisième appel avec une file de 1 place serait accepté,
      // avec 0 place il est refusé tout de suite.
      expect(statistiquesOcrLocal.enAttente).toBe(1);
      expect(await code(new OcrLocal({ fileAttenteMax: 0 }).reconnaitre({ pdf, pages: [1] }))).toBe(
        "OCR_ECHEC",
      );
      await Promise.all([a, b]);
      expect(statistiquesOcrLocal.simultanesMax).toBe(1);
      expect(statistiquesOcrLocal.sousProcessusCrees - avant).toBe(2);
      expect(statistiquesOcrLocal.enCours).toBe(0);
    }, 90_000);
  },
);
