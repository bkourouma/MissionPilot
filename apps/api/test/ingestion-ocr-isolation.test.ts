/* eslint-disable @typescript-eslint/no-explicit-any */
import dns from "node:dns";
import net from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LIBELLES_ERREUR_INGESTION, PLAFONDS_OCR } from "@missionpilot/shared";
import { creerOcr } from "../src/ingestion/fabrique.js";
import { OcrLocal, statistiquesOcrLocal } from "../src/ingestion/ocr-local.js";
import { proprietaire } from "./helpers.js";
import {
  demarrerIngestion,
  etatDe,
  fabriquerPdf,
  ingerer,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import {
  avecOcr,
  DELAI_TEST_OCR,
  fragmentsConnus,
  OCR_LOCAL_DISPONIBLE,
  pdfScan,
  RAISON_OCR_INDISPONIBLE,
} from "./ocr-chaine-outils.js";
import { fabriquerPdfScanDepuisFixtures, fabriquerPdfScanHostile } from "./ocr-outils.js";

/*
 * OCR local : isolation entre cabinets, plafonds, indisponibilité, absence de réseau et journal d'audit,
 * de bout en bout par les jobs d'ingestion (lot 11, ADR-009 décision 16). Vrai PostgreSQL, IA désactivée.
 * Les tests qui lancent le moteur réel sont sautés AVEC un test explicite qui échoue sous
 * `OCR_LOCAL_EXIGE=1` ; ceux qui n'en ont pas besoin (plafond de pages, indisponibilité) tournent toujours.
 */

const INCONNU_DE_B = "00000000-0000-4000-8000-000000000000";

let ctx: ContexteIngestion;
let a: CabinetMissions;
let b: CabinetMissions;
let c: CabinetMissions;
let exercice = 2040;
const exo = () => ++exercice;

beforeAll(async () => {
  ctx = await demarrerIngestion();
  a = await preparerCabinet(ctx, "Isolation OCR A");
  b = await preparerCabinet(ctx, "Isolation OCR B");
  c = await preparerCabinet(ctx, "Isolation OCR C");
  ctx.cabinets.push(a.cabinetId, b.cabinetId, c.cabinetId);
  for (const x of [a, b, c]) await creerMission(x);
}, 240_000);
afterAll(async () => {
  await ctx?.fermer();
});

const lire = (cab: CabinetMissions, ocr: Parameters<typeof avecOcr>[1], pdf: Buffer, nom: string) =>
  avecOcr(ctx, ocr, () => ingerer(ctx, cab.directeur, cab.clientId, nom, pdf, { exercice: exo() }));

function vivant(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erreur) {
    return (erreur as NodeJS.ErrnoException).code === "EPERM";
  }
}

describe("OCR local : disponibilité exigée", () => {
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

// ---------------------------------------------------------------------------------------------------
// (c) Indisponibilité : sans moteur, mais avec la chaîne réelle.

describe("indisponibilité de l'OCR", () => {
  it("sans OCR branché (null) : OCR_INDISPONIBLE et libellé français exposé par le détail", async () => {
    const { document } = await lire(c, null, pdfScan("etat-net.jpg"), "sans-ocr.pdf");
    expect(document).toMatchObject({
      statut: "echec",
      erreur_code: "OCR_INDISPONIBLE",
      etat_financier_id: null,
    });
    expect(document.erreur).toBe(LIBELLES_ERREUR_INGESTION.OCR_INDISPONIBLE);
    expect(document.erreur).toMatch(/Document scanné/);
  });

  it("moteur présent mais OCR_LOCAL=off (production) : aucun adaptateur, même résultat", async () => {
    const ocr = creerOcr({ NODE_ENV: "production", OCR_LOCAL: "off" }, { disponible: () => true });
    expect(ocr).toBeNull();
    const { document } = await lire(c, ocr, pdfScan("etat-net.jpg"), "ocr-off.pdf");
    expect(document).toMatchObject({ statut: "echec", erreur_code: "OCR_INDISPONIBLE" });
    expect(document.erreur).toBe(LIBELLES_ERREUR_INGESTION.OCR_INDISPONIBLE);
  });

  it("un adaptateur local dont le moteur est indisponible (données absentes) : OCR_INDISPONIBLE", async () => {
    const ocr = new OcrLocal({ dossierDonnees: "Z:/dossier/inexistant" });
    const avant = statistiquesOcrLocal.sousProcessusCrees;
    const { document } = await lire(c, ocr, pdfScan("etat-net.jpg"), "donnees-absentes.pdf");
    expect(document).toMatchObject({ statut: "echec", erreur_code: "OCR_INDISPONIBLE" });
    expect(statistiquesOcrLocal.sousProcessusCrees).toBe(avant);
  });
});

// ---------------------------------------------------------------------------------------------------
// (b) Plafonds qui ne demandent pas le moteur.

describe("plafonds sans moteur", () => {
  it("plus de pagesMax pages scannées : PLAFOND_PAGES, aucun sous-processus lancé", async () => {
    const pdf = fabriquerPdfScanDepuisFixtures(
      Array.from({ length: PLAFONDS_OCR.pagesMax + 1 }, () => "page-blanche.png"),
      100,
    );
    const avant = statistiquesOcrLocal.sousProcessusCrees;
    const { document } = await lire(c, new OcrLocal(), pdf, "trop-de-pages.pdf");
    expect(document).toMatchObject({ statut: "echec", erreur_code: "PLAFOND_PAGES" });
    expect(document.erreur).toBe(LIBELLES_ERREUR_INGESTION.PLAFOND_PAGES);
    expect(statistiquesOcrLocal.sousProcessusCrees).toBe(avant);
  });
});

// ---------------------------------------------------------------------------------------------------
// Moteur réel.

describe.skipIf(!OCR_LOCAL_DISPONIBLE)(
  `OCR local réel : isolation, plafonds, réseau, audit${OCR_LOCAL_DISPONIBLE ? "" : ` (SAUTÉ : ${RAISON_OCR_INDISPONIBLE})`}`,
  () => {
    let docA: { id: string; document: any };
    let docB: { id: string; document: any };
    const pidsEtTextes: { pid: number | null; texte: string }[] = [];

    it(
      "deux cabinets traités l'un après l'autre : un sous-processus par document, aucun texte partagé",
      async () => {
        const avant = statistiquesOcrLocal.sousProcessusCrees;
        docA = await lire(a, new OcrLocal(), pdfScan("etat-net.jpg"), "cabinet-a.pdf");
        pidsEtTextes.push({ pid: statistiquesOcrLocal.derniere?.pid ?? null, texte: "" });
        docB = await lire(b, new OcrLocal(), pdfScan("etat-anglais.jpg"), "cabinet-b.pdf");
        pidsEtTextes.push({ pid: statistiquesOcrLocal.derniere?.pid ?? null, texte: "" });
        expect(statistiquesOcrLocal.sousProcessusCrees - avant).toBe(2);
        const [pa, pb] = pidsEtTextes;
        expect(pa?.pid).toBeTruthy();
        expect(pb?.pid).toBeTruthy();
        expect(pa?.pid).not.toBe(pb?.pid);
        expect(vivant(pa?.pid)).toBe(false);
        expect(vivant(pb?.pid)).toBe(false);

        const texte = async (cabinetId: string, docId: string) =>
          proprietaire(async (cl) =>
            (
              await cl.query(
                "SELECT texte FROM ingestion_pages WHERE document_id = $1 AND cabinet_id = $2",
                [docId, cabinetId],
              )
            ).rows
              .map((r) => r.texte)
              .join("\n"),
          );
        const tA = await texte(a.cabinetId, docA.id);
        const tB = await texte(b.cabinetId, docB.id);
        expect(tA).toMatch(/Immobilisations/);
        expect(tB).toMatch(/Total assets/i);
        // Le texte d'un cabinet n'apparaît jamais dans le résultat de l'autre.
        expect(tA).not.toMatch(/Total assets|Share capital|Retained earnings/i);
        expect(tB).not.toMatch(/Immobilisations|Créances|Capital {2,}|Réserves/);
        // Et les états financiers : aucun montant français dans l'état anglais, ni l'inverse.
        const etatA = await etatDe(a.directeur, a.clientId, docA.document.etat_financier_id);
        const montantsA = new Set(etatA.lignes.map((l: any) => l.montant));
        expect(montantsA.has(7000000)).toBe(false);
        if (docB.document.etat_financier_id) {
          const etatB = await etatDe(b.directeur, b.clientId, docB.document.etat_financier_id);
          const montantsB = new Set(etatB.lignes.map((l: any) => l.montant));
          expect(montantsB.has(16550000)).toBe(false);
        }
      },
      DELAI_TEST_OCR,
    );

    it("le cabinet B reçoit 404 sur le document, ses pages et l'état du cabinet A", async () => {
      const base = `/api/dossiers/${a.clientId}`;
      const etatId = docA.document.etat_financier_id as string;
      expect(etatId).toBeTruthy();
      for (const u of [
        `${base}/ingestions/${docA.id}`,
        `${base}/ingestions/${docA.id}/pages/1`,
        `${base}/etats-financiers/${etatId}`,
        `${base}/ingestions`,
      ]) {
        expect((await b.associe.get(u)).statusCode, u).toBe(404);
        expect((await a.associe.get(u)).statusCode, u).toBe(200);
      }
      // Sous son PROPRE dossier, B ne voit pas non plus le document de A.
      const propre = `/api/dossiers/${b.clientId}`;
      expect((await b.associe.get(`${propre}/ingestions/${docA.id}`)).statusCode).toBe(404);
      expect((await b.associe.get(`${propre}/etats-financiers/${etatId}`)).statusCode).toBe(404);
      expect((await b.associe.get(`${propre}/ingestions/${INCONNU_DE_B}`)).statusCode).toBe(404);
      // Les corrections OCR ne sortent que par ces routes : le détail de A les expose, pas à B.
      const detailA = (await a.associe.get(`${base}/ingestions/${docA.id}`)).json();
      expect("corrections_ocr" in detailA).toBe(true);
    });

    it("RLS : sous le contexte du cabinet B, la base ne montre ni pages, ni document, ni corrections, ni état de A", async () => {
      const vue = async (cabinetId: string) =>
        ctx.db.withTenant(cabinetId, async (db) => {
          const q = async (texte: string, params: unknown[]) =>
            (await db.query(texte, params)).rows.length;
          return {
            pages: await q("SELECT 1 FROM ingestion_pages WHERE document_id = $1", [docA.id]),
            documents: await q("SELECT 1 FROM ingestion_documents WHERE id = $1", [docA.id]),
            corrections: await q(
              "SELECT corrections_ocr FROM ingestion_documents WHERE id = $1 AND corrections_ocr IS NOT NULL",
              [docA.id],
            ),
            etats: await q("SELECT 1 FROM dossier_etats_financiers WHERE id = $1", [
              docA.document.etat_financier_id,
            ]),
            lignes: await q("SELECT 1 FROM dossier_etats_lignes WHERE etat_id = $1", [
              docA.document.etat_financier_id,
            ]),
          };
        });
      const deB = await vue(b.cabinetId);
      expect(deB).toEqual({ pages: 0, documents: 0, corrections: 0, etats: 0, lignes: 0 });
      // Témoin positif : le cabinet A voit bien ses propres lignes (le test n'est pas vide).
      const deA = await vue(a.cabinetId);
      expect(deA.pages).toBeGreaterThan(0);
      expect(deA.documents).toBe(1);
      expect(deA.etats).toBe(1);
      expect(deA.lignes).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------------------------------
    // (b) Plafonds avec le moteur réel.

    it(
      "image géante (40 000 x 40 000) : IMAGE_TROP_GRANDE, mémoire du processus de test non gonflée, aucun orphelin",
      async () => {
        const rssAvant = process.memoryUsage.rss();
        const { document } = await lire(
          c,
          new OcrLocal(),
          fabriquerPdfScanHostile({ type: "image_geante" }),
          "image-geante.pdf",
        );
        const rssApres = process.memoryUsage.rss();
        expect(document).toMatchObject({ statut: "echec", erreur_code: "IMAGE_TROP_GRANDE" });
        expect(document.erreur).toBe(LIBELLES_ERREUR_INGESTION.IMAGE_TROP_GRANDE);
        expect(rssApres - rssAvant).toBeLessThan(200 * 1024 * 1024);
        const bilan = statistiquesOcrLocal.derniere;
        expect(bilan?.issue).toBe("IMAGE_TROP_GRANDE");
        expect(bilan?.termine).toBe(true);
        expect(vivant(bilan?.pid)).toBe(false);
      },
      DELAI_TEST_OCR,
    );

    it(
      "200 petites images : PDF_SANS_TEXTE ; flux d'image tronqué : échec à code stable ; jamais ERREUR_INTERNE",
      async () => {
        const cas = {
          "beaucoup-d-images.pdf": fabriquerPdfScanHostile({ type: "beaucoup_d_images" }),
          "flux-tronque.pdf": fabriquerPdfScanHostile({ type: "flux_tronque" }),
          "dimensions-mensongeres.pdf": fabriquerPdfScanHostile({ type: "dimensions_mensongeres" }),
        };
        for (const [nom, pdf] of Object.entries(cas)) {
          const debut = Date.now();
          const { document } = await lire(c, new OcrLocal(), pdf, nom);
          expect(Date.now() - debut, nom).toBeLessThan(60_000);
          expect(document.statut, nom).toBe("echec");
          expect(document.erreur_code, nom).not.toBe("ERREUR_INTERNE");
          expect(
            ["PDF_SANS_TEXTE", "PDF_ILLISIBLE", "IMAGE_TROP_GRANDE", "OCR_ECHEC"],
            nom,
          ).toContain(document.erreur_code);
          expect(vivant(statistiquesOcrLocal.derniere?.pid), nom).toBe(false);
        }
        // La page à 200 vignettes est précisément « sans texte ».
        const { document } = await lire(
          c,
          new OcrLocal(),
          fabriquerPdfScanHostile({ type: "beaucoup_d_images" }),
          "beaucoup-d-images-bis.pdf",
        );
        expect(document.erreur_code).toBe("PDF_SANS_TEXTE");
      },
      DELAI_TEST_OCR,
    );

    it(
      "délai très court : DELAI_DEPASSE, sous-processus tué et constaté mort, aucun reste",
      async () => {
        const { document } = await lire(
          c,
          new OcrLocal({ delaiParEtapeMs: 50 }),
          pdfScan("etat-net.jpg"),
          "delai-court.pdf",
        );
        expect(document).toMatchObject({ statut: "echec", erreur_code: "DELAI_DEPASSE" });
        expect(document.erreur).toBe(LIBELLES_ERREUR_INGESTION.DELAI_DEPASSE);
        const bilan = statistiquesOcrLocal.derniere;
        expect(bilan?.tueParParent).toBe(true);
        expect(bilan?.termine).toBe(true);
        expect(vivant(bilan?.pid)).toBe(false);
        expect(statistiquesOcrLocal.enCours).toBe(0);
        expect(statistiquesOcrLocal.enAttente).toBe(0);
      },
      DELAI_TEST_OCR,
    );

    // -------------------------------------------------------------------------------------------------
    // (d) Pas de réseau : le processus de test lui-même n'ouvre aucun socket sortant pendant l'OCR.

    describe("aucun réseau", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it(
        "pendant un OCR déclenché par le job : zéro socket sortant (hors PostgreSQL), zéro résolution DNS, zéro tentative du sous-processus",
        async () => {
          const tentatives: string[] = [];
          const decrire = (args: unknown[]): string => {
            // Node normalise les arguments de `net.connect` en un tableau `[options, rappel]`.
            const [premier, deuxieme] = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
            if (premier && typeof premier === "object") {
              const o = premier as { port?: number; host?: string; path?: string };
              return o.path ? `ipc:${o.path}` : `${o.host ?? "localhost"}:${o.port}`;
            }
            if (typeof premier === "string") return `ipc:${premier}`;
            return `${typeof deuxieme === "string" ? deuxieme : "localhost"}:${String(premier)}`;
          };
          const connect = net.Socket.prototype.connect;
          vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (
            this: net.Socket,
            ...args: unknown[]
          ) {
            tentatives.push(`connect ${decrire(args)}`);
            return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
          } as never);
          const lookup = dns.lookup;
          vi.spyOn(dns, "lookup").mockImplementation(((...args: unknown[]) => {
            tentatives.push(`dns ${String(args[0])}`);
            return (lookup as (...a: unknown[]) => void)(...args);
          }) as never);
          const fetchInitial = globalThis.fetch;
          vi.spyOn(globalThis, "fetch").mockImplementation(((...args: unknown[]) => {
            tentatives.push(`fetch ${String(args[0])}`);
            return (fetchInitial as (...a: unknown[]) => Promise<Response>)(...args);
          }) as never);

          // Témoin positif : les espions voient bien une connexion et une résolution DNS (sinon le test serait vide).
          await new Promise<void>((fin) => {
            net.connect(1, "127.0.0.1").on("error", () => fin());
          });
          await new Promise<void>((fin) => dns.lookup("localhost", () => fin()));
          expect(tentatives).toContain("connect 127.0.0.1:1");
          expect(tentatives).toContain("dns localhost");
          tentatives.length = 0;

          const { document } = await lire(
            a,
            new OcrLocal(),
            pdfScan("etat-net.jpg"),
            "sans-reseau.pdf",
          );
          expect(document).toMatchObject({ statut: "termine", methode: "ocr" });
          // Seule la base de données de test (127.0.0.1:55440) peut être jointe par le processus de test.
          const base = new URL(ctx.config.DATABASE_URL);
          const postgres = `${base.hostname}:${base.port || "5432"}`;
          const autres = tentatives.filter((t) => t !== `connect ${postgres}`);
          expect(autres).toEqual([]);
          const bilan = statistiquesOcrLocal.derniere;
          expect(bilan?.issue).toBe("ok");
          expect(bilan?.tentatives_reseau).toBe(0);
          expect(bilan?.cibles_reseau).toEqual([]);
        },
        DELAI_TEST_OCR,
      );
    });

    // -------------------------------------------------------------------------------------------------
    // (e) Journal d'audit : ni texte OCR ni montant.

    it("journal d'audit : ni texte OCR ni montant lus, ni à la réussite ni à l'échec", async () => {
      const lignes = await proprietaire(
        async (cl) =>
          (
            await cl.query(
              `SELECT cabinet_id, action, entite, entite_id, details FROM journal_audit
               WHERE cabinet_id = ANY ($1::uuid[]) AND action LIKE 'ingestion.%'`,
              [[a.cabinetId, b.cabinetId, c.cabinetId]],
            )
          ).rows,
      );
      const actions = new Set(lignes.map((l) => l.action));
      expect(actions.has("ingestion.echec")).toBe(true);
      expect(lignes.some((l) => l.cabinet_id === a.cabinetId)).toBe(true);
      const fragments = [
        ...new Set([...fragmentsConnus("etat-net.jpg"), ...fragmentsConnus("etat-anglais.jpg")]),
      ];
      const serialise = lignes.map((l) => JSON.stringify([l.action, l.entite, l.details]));
      for (const s of serialise) {
        for (const f of fragments)
          expect(s.toLowerCase(), `fragment « ${f} »`).not.toContain(f.toLowerCase());
      }
      // Les échecs portent un code, jamais un contenu.
      for (const l of lignes.filter((x) => x.action === "ingestion.echec")) {
        expect(Object.keys(l.details).sort()).toEqual(["code", "usage"]);
      }
    });
  },
);

describe("texte natif : l'OCR n'est pas sollicité", () => {
  it("un PDF à couche texte ne démarre aucun sous-processus", async () => {
    const avant = statistiquesOcrLocal.sousProcessusCrees;
    const { document } = await lire(
      c,
      new OcrLocal(),
      fabriquerPdf({ pages: [["BILAN - ACTIF", "AD Frais de développement 1 200 000"]] }),
      "natif.pdf",
    );
    expect(document.methode).toBe("texte");
    expect(statistiquesOcrLocal.sousProcessusCrees).toBe(avant);
  });
});
