/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OcrLocal } from "../src/ingestion/ocr-local.js";
import type { Ocr } from "../src/ingestion/ocr.js";
import { proprietaire } from "./helpers.js";
import {
  demarrerIngestion,
  etatDe,
  fabriquerPdf,
  ingerer,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import {
  avecOcr,
  DELAI_TEST_OCR,
  fixtureOcr,
  montantsVerite,
  OCR_LOCAL_DISPONIBLE,
  pdfScan,
  RAISON_OCR_INDISPONIBLE,
} from "./ocr-chaine-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * OCR local RÉEL de bout en bout (lot 11) : `new OcrLocal()` injecté comme dépendance `ocr` des jobs
 * d'ingestion, vrai PostgreSQL, IA désactivée (règles déterministes). Un scan donne des pages `ocr`, un
 * état financier TOUJOURS `en_revue` (jamais accepté automatiquement), des lignes marquées « lu par OCR ».
 * Si le moteur n'est pas disponible, les tests réels sont sautés AVEC un test explicite qui échoue sous
 * `OCR_LOCAL_EXIGE=1` (jamais d'ignorance silencieuse).
 */

describe("OCR local réel : disponibilité exigée", () => {
  it("le moteur est disponible quand OCR_LOCAL_EXIGE=1", () => {
    if (process.env.OCR_LOCAL_EXIGE === "1") {
      expect(
        RAISON_OCR_INDISPONIBLE,
        "le moteur OCR local doit être disponible (OCR_LOCAL_EXIGE=1)",
      ).toBeNull();
    } else if (!OCR_LOCAL_DISPONIBLE) {
      console.warn(`OCR local indisponible (${RAISON_OCR_INDISPONIBLE}) : tests réels sautés.`);
    }
  });
});

describe.skipIf(!OCR_LOCAL_DISPONIBLE)(
  `OCR local réel : chaîne complète${OCR_LOCAL_DISPONIBLE ? "" : ` (SAUTÉ : ${RAISON_OCR_INDISPONIBLE})`}`,
  () => {
    let ctx: ContexteIngestion;
    let a: CabinetMissions;
    let exercice = 2040;
    const exo = () => ++exercice;

    beforeAll(async () => {
      ctx = await demarrerIngestion();
      a = await preparerCabinet(ctx, "Ingestion OCR réel");
      ctx.cabinets.push(a.cabinetId);
      await creerMission(a);
    }, 240_000);
    afterAll(async () => {
      await ctx?.fermer();
    });

    const lire = (pdf: Buffer, nom: string) =>
      avecOcr(ctx, new OcrLocal(), () =>
        ingerer(ctx, a.directeur, a.clientId, nom, pdf, { exercice: exo() }),
      );

    const montantsLus = (etat: any): Set<number> => new Set(etat.lignes.map((l: any) => l.montant));

    it(
      "scan net : pages `ocr` avec confiance, état en revue (jamais accepté), lignes marquées OCR, montants du manifeste",
      async () => {
        const { id, document } = await lire(pdfScan("etat-net.jpg"), "scan-net.pdf");
        expect(document).toMatchObject({
          statut: "termine",
          resultat: "etat_cree",
          methode: "ocr",
        });
        expect(document.etat_financier_id).toBeTruthy();

        const pages = await proprietaire(
          async (c) =>
            (
              await c.query(
                "SELECT numero, methode, confiance_pm FROM ingestion_pages WHERE document_id = $1 ORDER BY numero",
                [id],
              )
            ).rows,
        );
        expect(pages).toHaveLength(1);
        expect(pages[0]).toMatchObject({ numero: 1, methode: "ocr" });
        expect(pages[0].confiance_pm).toBeGreaterThan(0);
        expect(pages[0].confiance_pm).toBeLessThanOrEqual(1000);

        const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
        // JAMAIS d'acceptation automatique d'un état lu par OCR.
        expect(etat).toMatchObject({ origine: "pdf", statut: "en_revue", decision: null });
        expect(etat.ingestion).toMatchObject({ document_id: id, methode: "ocr" });
        expect(etat.lignes.length).toBeGreaterThan(0);
        for (const l of etat.lignes) {
          expect(l.reference).toMatchObject({ ocr: true, page: 1 });
          expect(l.reference.confiance_pm).toBeGreaterThan(0);
        }
        // Seuil réaliste (lot-11.md : 12/12 mesurés sur ce scan) : les montants lus sont ceux écrits sur
        // l'image, et presque uniquement eux (aucun montant inventé).
        const lus = montantsLus(etat);
        const verite = montantsVerite("etat-net.jpg");
        expect(verite.filter((m) => lus.has(m)).length).toBeGreaterThanOrEqual(10);
        const autorises = new Set(verite);
        expect([...lus].filter((m) => !autorises.has(m)).length).toBeLessThanOrEqual(2);
      },
      DELAI_TEST_OCR,
    );

    it(
      "scan dégradé (150 dpi, rotation, bruit) : état en revue, montants du manifeste retrouvés",
      async () => {
        const { document } = await lire(pdfScan("etat-degrade.jpg"), "scan-degrade.pdf");
        expect(document).toMatchObject({ statut: "termine", methode: "ocr" });
        const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
        expect(etat).toMatchObject({ statut: "en_revue", decision: null });
        const lus = montantsLus(etat);
        expect(
          montantsVerite("etat-degrade.jpg").filter((m) => lus.has(m)).length,
        ).toBeGreaterThanOrEqual(9);
        for (const l of etat.lignes) expect(l.reference.ocr).toBe(true);
      },
      DELAI_TEST_OCR,
    );

    it(
      "scan anglais : pages `ocr`, texte anglais conservé (fra+eng), jamais d'état accepté",
      async () => {
        const { id, document } = await lire(pdfScan("etat-anglais.jpg"), "scan-anglais.pdf");
        expect(document).toMatchObject({ statut: "termine", methode: "ocr" });
        const pages = await proprietaire(
          async (c) =>
            (await c.query("SELECT texte FROM ingestion_pages WHERE document_id = $1", [id])).rows,
        );
        expect(pages[0].texte).toMatch(/Total assets/i);
        expect(pages[0].texte).toMatch(/7,000,000/);
        if (document.etat_financier_id) {
          const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
          expect(etat).toMatchObject({ statut: "en_revue", decision: null });
        }
        expect(fixtureOcr("etat-anglais.jpg").langue).toBe("eng");
      },
      DELAI_TEST_OCR,
    );

    it(
      "PDF scanné blanc : document en échec PDF_SANS_TEXTE, aucune page, aucun état",
      async () => {
        const { id, document } = await lire(pdfScan("page-blanche.png"), "scan-blanc.pdf");
        expect(document).toMatchObject({
          statut: "echec",
          erreur_code: "PDF_SANS_TEXTE",
          etat_financier_id: null,
        });
        const pages = await proprietaire(
          async (c) =>
            (
              await c.query(
                "SELECT count(*)::int AS n FROM ingestion_pages WHERE document_id = $1",
                [id],
              )
            ).rows[0].n,
        );
        expect(pages).toBe(0);
      },
      DELAI_TEST_OCR,
    );

    it(
      "PDF à couche texte : l'OCR n'est pas utilisé (méthode `texte`)",
      async () => {
        let appels = 0;
        const reel = new OcrLocal();
        const espion: Ocr = {
          fournisseur: reel.fournisseur,
          mode: reel.mode,
          reconnaitre: (d) => {
            appels += 1;
            return reel.reconnaitre(d);
          },
        };
        const { document } = await avecOcr(ctx, espion, () =>
          ingerer(
            ctx,
            a.directeur,
            a.clientId,
            "natif.pdf",
            fabriquerPdf({ pages: [["BILAN - ACTIF", "AD Frais de développement 1 200 000"]] }),
            { exercice: exo() },
          ),
        );
        expect(document.methode).toBe("texte");
        expect(appels).toBe(0);
        expect(document.pages.every((p: any) => p.methode === "texte")).toBe(true);
      },
      DELAI_TEST_OCR,
    );
  },
);
