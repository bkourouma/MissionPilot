/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAFONDS_OCR } from "@missionpilot/shared";
import { ErreurIngestion } from "../src/ingestion/erreurs.js";
import type { Ocr, PageOcr } from "../src/ingestion/ocr.js";
import { avecPlaceExtraction, extrairePagesPdf } from "../src/ingestion/pdf.js";
import type { MailerJournal } from "../src/notifications/mailer.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { proprietaire } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import {
  LIASSE_PAGE_1,
  LIASSE_PAGE_2,
  demarrerIngestion,
  etatDe,
  executerJobs,
  fabriquerPdf,
  fabriquerPdfBombe,
  ingerer,
  registreIngestion,
  televerserEtat,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Intégration de l'OCR LOCAL dans la chaîne d'extraction (lot 11, ADR-009 décisions 4 et 5) avec un adaptateur
 * FACTICE qui déclare `mode: "local"` (aucun moteur réel, aucun réseau) : méthode `ocr`, budget propre de la
 * phase OCR, conversion des pannes de l'adaptateur en codes stables, plafond de pages, OCR hors sémaphore des
 * extractions, puis bout en bout par le job `ingestion_extraction`.
 */

type Reconnaitre = Ocr["reconnaitre"];

/** Adaptateur factice « local » : `reconnaitre` est fourni par chaque test. */
function ocrLocal(reconnaitre: Reconnaitre): Ocr & { appels: number } {
  const ocr = {
    fournisseur: "factice-local",
    mode: "local",
    appels: 0,
    reconnaitre(demande: { pdf: Buffer; pages: number[] }) {
      ocr.appels += 1;
      return reconnaitre(demande);
    },
  };
  // Le port déclare encore `mode: "simule"` tant que le lot de l'adaptateur réel n'a pas élargi le type.
  return ocr as unknown as Ocr & { appels: number };
}

const TEXTE_P1 = ["ACTIF", "AD Frais de développement 1 200 000", "TOTAL ACTIF 1 200 000"].join(
  "\n",
);

async function code(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    if (e instanceof ErreurIngestion) return e.code;
    throw e;
  }
  return "AUCUNE_ERREUR";
}

const unePage = (numero: number, texte: string, confiance_pm: number): PageOcr => ({
  numero,
  texte,
  confiance_pm,
});

describe("OCR local : extrairePagesPdf", () => {
  it("méthode `ocr` du document et des pages, confiance conservée et bornée", async () => {
    const ocr = ocrLocal(async ({ pages }) =>
      pages.map((n) => unePage(n, n === 1 ? TEXTE_P1 : "", n === 1 ? 870 : 1500)),
    );
    const r = await extrairePagesPdf(fabriquerPdf({ nbPages: 2 }), { ocr });
    expect(r.methode).toBe("ocr");
    expect(r.pages.map((p) => [p.numero, p.methode, p.confiance_pm])).toEqual([
      [1, "ocr", 870],
      [2, "ocr", 1000],
    ]);
    expect(r.pages[0]?.texte).toBe(TEXTE_P1);
  });

  it("la confiance négative ou illisible est ramenée à 0", async () => {
    const ocr = ocrLocal(async () => [
      unePage(1, TEXTE_P1, -50),
      { numero: 2, texte: "Suite", confiance_pm: Number.NaN },
    ]);
    const r = await extrairePagesPdf(fabriquerPdf({ nbPages: 2 }), { ocr });
    expect(r.pages.map((p) => p.confiance_pm)).toEqual([0, 0]);
  });

  it("toutes les pages du document sont demandées à l'adaptateur", async () => {
    let demandees: number[] = [];
    const ocr = ocrLocal(async ({ pages }) => {
      demandees = pages;
      return [unePage(1, TEXTE_P1, 800)];
    });
    const r = await extrairePagesPdf(fabriquerPdf({ nbPages: 3 }), { ocr });
    expect(demandees).toEqual([1, 2, 3]);
    // Une page absente du résultat est une page vide (confiance 0), jamais un trou.
    expect(r.pages.map((p) => [p.numero, p.texte === "", p.confiance_pm])).toEqual([
      [1, false, 800],
      [2, true, 0],
      [3, true, 0],
    ]);
  });

  it("budget de l'OCR dépassé : DELAI_DEPASSE", async () => {
    const ocr = ocrLocal(() => new Promise(() => undefined));
    const debut = Date.now();
    expect(
      await code(extrairePagesPdf(fabriquerPdf({ nbPages: 1 }), { ocr, dureeOcrMs: 200 })),
    ).toBe("DELAI_DEPASSE");
    expect(Date.now() - debut).toBeLessThan(10_000);
  });

  it("`dureeMs` règle le texte natif seulement : un OCR plus long que lui n'est pas coupé", async () => {
    const ocr = ocrLocal(async ({ pages }) => {
      await new Promise((ok) => setTimeout(ok, 600));
      return pages.map((n) => unePage(n, TEXTE_P1, 700));
    });
    const r = await extrairePagesPdf(fabriquerPdf({ nbPages: 1 }), { ocr, dureeMs: 20_000 });
    expect(r.methode).toBe("ocr");
  });

  it("exception quelconque de l'adaptateur : OCR_ECHEC, sans fuite de message", async () => {
    const secret = "SECRET-INTERNE tesseract /srv/données/client.pdf";
    const asynchrone = ocrLocal(async () => {
      throw new Error(secret);
    });
    const synchrone = ocrLocal(() => {
      throw new TypeError(secret);
    });
    for (const ocr of [asynchrone, synchrone]) {
      let erreur: unknown;
      try {
        await extrairePagesPdf(fabriquerPdf({ nbPages: 1 }), { ocr });
      } catch (e) {
        erreur = e;
      }
      expect(erreur).toBeInstanceOf(ErreurIngestion);
      expect((erreur as ErreurIngestion).code).toBe("OCR_ECHEC");
      expect(String((erreur as Error).message)).not.toContain("SECRET");
    }
  });

  it("résultat inexploitable de l'adaptateur : OCR_ECHEC", async () => {
    const pasUnTableau = ocrLocal(async () => null as unknown as PageOcr[]);
    expect(await code(extrairePagesPdf(fabriquerPdf({ nbPages: 1 }), { ocr: pasUnTableau }))).toBe(
      "OCR_ECHEC",
    );
  });

  it("ErreurIngestion de l'adaptateur : son code est conservé", async () => {
    for (const c of ["IMAGE_TROP_GRANDE", "OCR_ECHEC", "PLAFOND_PAGES", "DELAI_DEPASSE"] as const) {
      const ocr = ocrLocal(async () => {
        throw new ErreurIngestion(c);
      });
      expect(await code(extrairePagesPdf(fabriquerPdf({ nbPages: 1 }), { ocr }))).toBe(c);
    }
  });

  it("plus de pagesMax pages scannées : PLAFOND_PAGES, l'OCR n'est pas appelé", async () => {
    const ocr = ocrLocal(async () => [unePage(1, TEXTE_P1, 900)]);
    const trop = fabriquerPdf({ nbPages: PLAFONDS_OCR.pagesMax + 1 });
    expect(await code(extrairePagesPdf(trop, { ocr }))).toBe("PLAFOND_PAGES");
    expect(ocr.appels).toBe(0);
    // À la limite exacte, le document est lu en entier.
    const limite = fabriquerPdf({ nbPages: PLAFONDS_OCR.pagesMax });
    const r = await extrairePagesPdf(limite, { ocr });
    expect(r.pages).toHaveLength(PLAFONDS_OCR.pagesMax);
    expect(ocr.appels).toBe(1);
  });

  it("scan sans OCR : OCR_INDISPONIBLE ; l'OCR a tourné sans rien lire : PDF_SANS_TEXTE", async () => {
    expect(await code(extrairePagesPdf(fabriquerPdf({ nbPages: 2 }), { ocr: null }))).toBe(
      "OCR_INDISPONIBLE",
    );
    const vide = ocrLocal(async ({ pages }) => pages.map((n) => unePage(n, "   ", 30)));
    expect(await code(extrairePagesPdf(fabriquerPdf({ nbPages: 2 }), { ocr: vide }))).toBe(
      "PDF_SANS_TEXTE",
    );
  });

  it("PDF à couche texte : l'OCR n'est jamais appelé (la couche texte l'emporte)", async () => {
    const ocr = ocrLocal(async () => [unePage(1, "autre", 900)]);
    const r = await extrairePagesPdf(fabriquerPdf({ pages: [["Bonjour"], []] }), { ocr });
    expect(r.methode).toBe("texte");
    expect(ocr.appels).toBe(0);
    // Limite assumée : la page 2 (éventuellement scannée) reste vide, sans OCR.
    expect(r.pages[1]?.texte).toBe("");
    expect(r.pages[1]?.methode).toBe("texte");
  });

  it("le pré-contrôle de bombe s'applique AVANT l'OCR", async () => {
    const ocr = ocrLocal(async () => [unePage(1, TEXTE_P1, 900)]);
    expect(await code(extrairePagesPdf(fabriquerPdfBombe(300), { ocr }))).toBe("PLAFOND_TEXTE");
    expect(ocr.appels).toBe(0);
  });

  it("texte OCR au-delà du plafond par page : PLAFOND_TEXTE", async () => {
    const ocr = ocrLocal(async () => [unePage(1, "x".repeat(25_001), 900)]);
    expect(await code(extrairePagesPdf(fabriquerPdf({ nbPages: 1 }), { ocr }))).toBe(
      "PLAFOND_TEXTE",
    );
  });

  it("l'OCR n'occupe aucune place du sémaphore d'extraction", async () => {
    let liberer: () => void = () => undefined;
    const portail = new Promise<void>((ok) => (liberer = ok));
    let enCours = 0;
    const ocr = ocrLocal(async ({ pages }) => {
      enCours += 1;
      await portail;
      return pages.map((n) => unePage(n, TEXTE_P1, 800));
    });
    // Trois OCR en attente : plus que les deux places du sémaphore.
    const ocrs = Array.from({ length: 3 }, () =>
      extrairePagesPdf(fabriquerPdf({ nbPages: 1 }), { ocr }),
    );
    const debut = Date.now();
    while (enCours < 3 && Date.now() - debut < 20_000)
      await new Promise((ok) => setTimeout(ok, 20));
    expect(enCours).toBe(3);
    // Pendant ce temps, deux extractions de PDF texte aboutissent.
    const textes = await Promise.all([
      extrairePagesPdf(fabriquerPdf({ pages: [["Bonjour"]] }), { ocr: null }),
      extrairePagesPdf(fabriquerPdf({ pages: [["Monde"]] }), { ocr: null }),
    ]);
    expect(textes.map((t) => t.methode)).toEqual(["texte", "texte"]);
    // Une place du sémaphore est immédiatement disponible.
    expect(await avecPlaceExtraction(async () => "libre")).toBe("libre");
    liberer();
    const finis = await Promise.all(ocrs);
    expect(finis.map((f) => f.methode)).toEqual(["ocr", "ocr", "ocr"]);
  });
});

describe("OCR local : job ingestion_extraction de bout en bout", () => {
  let ctx: ContexteIngestion;
  let a: CabinetMissions;
  let exercice = 2000;
  const exo = () => ++exercice;
  const scan = () => fabriquerPdf({ nbPages: 2 });

  beforeAll(async () => {
    ctx = await demarrerIngestion();
    a = await preparerCabinet(ctx, "Ingestion OCR local");
    ctx.cabinets.push(a.cabinetId);
    await creerMission(a);
  }, 240_000);
  afterAll(async () => {
    await ctx?.fermer();
  });

  const avec = async (ocr: Ocr | null, nom: string) => {
    const avant = ctx.deps.ocr;
    ctx.deps.ocr = ocr;
    try {
      return await ingerer(ctx, a.directeur, a.clientId, nom, scan(), { exercice: exo() });
    } finally {
      ctx.deps.ocr = avant;
    }
  };

  it("adaptateur local : pages `ocr` avec confiance, document en structuration puis état en revue", async () => {
    const ocr = ocrLocal(async () => [
      unePage(1, LIASSE_PAGE_1.join("\n"), 930),
      unePage(2, LIASSE_PAGE_2.join("\n"), 610),
    ]);
    const { id, document } = await avec(ocr, "scan-local.pdf");
    expect(document).toMatchObject({ statut: "termine", resultat: "etat_cree", methode: "ocr" });
    expect(document.pages.map((p: any) => [p.methode, p.confiance_pm])).toEqual([
      ["ocr", 930],
      ["ocr", 610],
    ]);
    // Enregistrement en base : méthode `ocr` et confiance non nulle sur chaque page.
    const lignes = await proprietaire(async (c) =>
      (
        await c.query(
          "SELECT numero, methode, confiance_pm FROM ingestion_pages WHERE document_id = $1 ORDER BY numero",
          [id],
        )
      ).rows.map((r) => [r.numero, r.methode, r.confiance_pm]),
    );
    expect(lignes).toEqual([
      [1, "ocr", 930],
      [2, "ocr", 610],
    ]);
    // Jamais d'acceptation automatique d'un état lu par OCR.
    const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
    expect(etat).toMatchObject({ origine: "pdf", statut: "en_revue", decision: null });
  });

  it("le job d'extraction seul laisse le document en `structuration`, pages `ocr` écrites", async () => {
    const ocr = ocrLocal(async () => [unePage(1, LIASSE_PAGE_1.join("\n"), 900)]);
    const avant = ctx.deps.ocr;
    ctx.deps.ocr = ocr;
    try {
      const r = await televerserEtat(a.directeur, a.clientId, "scan-statut.pdf", scan(), {
        exercice: exo(),
      });
      attendre(202, r, "téléversement");
      const id = r.json().id as string;
      // Un seul job : l'extraction (la structuration est mise en file par elle).
      const worker = new WorkerJobs(ctx.db, {
        mailer: ctx.app.mailer as MailerJournal,
        registre: registreIngestion(ctx),
        horloge: () => new Date(),
        delaiReprise: () => 60_000,
      });
      const resultat = await worker.traiterUn();
      expect(resultat).toMatchObject({ type: "ingestion_extraction", statut: "termine" });
      const doc = await proprietaire(
        async (c) =>
          (
            await c.query(
              "SELECT statut, methode, nb_pages FROM ingestion_documents WHERE id = $1",
              [id],
            )
          ).rows[0],
      );
      expect(doc).toMatchObject({ statut: "structuration", methode: "ocr", nb_pages: 2 });
      await executerJobs(ctx); // ménage : termine la structuration
    } finally {
      ctx.deps.ocr = avant;
    }
  });

  it("scan sans OCR : OCR_INDISPONIBLE, échec définitif, fichier effacé", async () => {
    const { id, document } = await avec(null, "scan-sans-ocr.pdf");
    expect(document).toMatchObject({
      statut: "echec",
      erreur_code: "OCR_INDISPONIBLE",
      etat_financier_id: null,
    });
    expect(document.erreur).toMatch(/scanné/);
    const reste = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT d.fichier_id, (SELECT count(*)::int FROM ingestion_pages p WHERE p.document_id = d.id) AS pages
           FROM ingestion_documents d WHERE d.id = $1`,
            [id],
          )
        ).rows[0],
    );
    expect(reste).toMatchObject({ fichier_id: null, pages: 0 });
  });

  it("pannes de l'adaptateur : codes stables, définitifs, sans reprise ni message", async () => {
    const cas: [string, Ocr, string][] = [
      [
        "echec.pdf",
        ocrLocal(async () => {
          throw new Error("SECRET moteur interne");
        }),
        "OCR_ECHEC",
      ],
      [
        "image.pdf",
        ocrLocal(async () => {
          throw new ErreurIngestion("IMAGE_TROP_GRANDE");
        }),
        "IMAGE_TROP_GRANDE",
      ],
      [
        "vide.pdf",
        ocrLocal(async ({ pages }) => pages.map((n) => unePage(n, "", 100))),
        "PDF_SANS_TEXTE",
      ],
    ];
    for (const [nom, ocr, attendu] of cas) {
      const { id, document } = await avec(ocr, nom);
      expect(document).toMatchObject({ statut: "echec", erreur_code: attendu });
      expect(JSON.stringify(document)).not.toContain("SECRET");
      // Échec définitif : le job est terminé (une seule tentative), pas remis en attente.
      const job = await proprietaire(
        async (c) =>
          (
            await c.query(
              `SELECT statut, tentatives FROM jobs WHERE type = 'ingestion_extraction' AND charge->>'document_id' = $1`,
              [id],
            )
          ).rows[0],
      );
      expect(job).toMatchObject({ statut: "termine", tentatives: 1 });
      // Le journal d'audit porte le code, sans contenu.
      const audit = await proprietaire(
        async (c) =>
          (
            await c.query(
              `SELECT details FROM journal_audit WHERE action = 'ingestion.echec' AND entite_id = $1`,
              [id],
            )
          ).rows[0],
      );
      expect(audit?.details).toMatchObject({ code: attendu });
      expect(JSON.stringify(audit?.details)).not.toContain("SECRET");
    }
  });
});
