import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { maintenirIngestion } from "../src/ingestion/maintenance.js";
import { proprietaire } from "./helpers.js";
import {
  ingererDd,
  LIGNES_RAPPORT_OK,
  pdfRapport,
  preparerIngestionDd,
  repondreLignes,
  type ScenarioIngestionDd,
} from "./ingestion-dd-outils.js";
import {
  activerIa,
  demarrerIngestion,
  etatDe,
  fabriquerPdf,
  ingerer,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Lot 11 : les corrections OCR (`ingestion_documents.corrections_ocr`, 0525) suivent la rétention du texte des pages
 * (0526) : purgées avec lui, décision + 90 jours. Jamais purgées tant qu'un brouillon est ouvert ou qu'un état est en
 * revue. L'état financier et ses lignes restent. Vrai PostgreSQL ; horloge de test `app.horloge_test`.
 */

let ctx: ContexteIngestion;
let s: ScenarioIngestionDd;
let exercice = 2060;
const exo = () => ++exercice;
const JOUR = 86_400_000;

const PAGE_CONFUSIONS = [
  "BILAN - ACTIF",
  "AD Frais de développement 1 234 56O",
  "AE Brevets et licences l 234 567",
  "BK Terrains 15 000 000",
  "BZ TOTAL ACTIF 16 234 567",
];
const scanne = () =>
  fabriquerPdf({
    nbPages: 1,
    ocr: { pages: [{ numero: 1, texte: PAGE_CONFUSIONS.join("\n"), confiance_pm: 880 }] },
  });
const CORRECTIONS_ATTENDUES = [
  {
    page: 1,
    code: "AD",
    libelle: "Frais de développement",
    texte_lu: "1 234 56O",
    montant_propose: 1234560,
    confusions: ["o_zero"],
  },
  {
    page: 1,
    code: "AE",
    libelle: "Brevets et licences",
    texte_lu: "l 234 567",
    montant_propose: 1234567,
    confusions: ["l_un"],
  },
];

interface Docs {
  accepte: string;
  etatAccepte: string;
  enRevue: string;
  ouvert: string;
  autreCabinet: string;
  t0: Date;
}
let d: Docs;

const sql = (texte: string, params: unknown[] = []) =>
  proprietaire(async (c) => (await c.query(texte, params)).rows);
const corrections = async (id: string) =>
  (await sql("SELECT corrections_ocr FROM ingestion_documents WHERE id = $1", [id]))[0]
    .corrections_ocr;
const purge = async (id: string) =>
  (await sql("SELECT texte_purge_le FROM ingestion_documents WHERE id = $1", [id]))[0]
    .texte_purge_le;
const nbPages = async (id: string) =>
  (await sql("SELECT count(*)::int AS n FROM ingestion_pages WHERE document_id = $1", [id]))[0].n;
const apres = (jours: number) => new Date(d.t0.getTime() + jours * JOUR + 3_600_000);

async function maintenirA(cabinetId: string, quand: Date) {
  return ctx.db.withTenant(cabinetId, async (db) => {
    await db.query("SELECT set_config('app.horloge_test', $1, true)", [quand.toISOString()]);
    return maintenirIngestion(db, ctx.config, cabinetId, quand);
  });
}

beforeAll(async () => {
  ctx = await demarrerIngestion();
  s = await preparerIngestionDd(ctx, "Ingestion purge ocr");
  const a = s.a;

  // État lu par OCR avec confusions : part en revue ; celui-ci est ensuite accepté par un humain.
  const accepte = await ingerer(ctx, a.directeur, a.clientId, "scan-a.pdf", scanne(), {
    exercice: exo(),
  });
  const etatAccepte = accepte.document.etat_financier_id as string;
  attendre(
    200,
    await a.associe.post(`/api/dossiers/${a.clientId}/etats-financiers/${etatAccepte}/decision`, {
      decision: "accepte",
      motif: "Relu par le consultant.",
    }),
    "acceptation",
  );
  // Un autre reste en revue, sans décision.
  const enRevue = await ingerer(ctx, a.directeur, a.clientId, "scan-r.pdf", scanne(), {
    exercice: exo(),
  });
  // Brouillon IA ouvert (extraction non décidée) sur un autre document : on y pose des corrections à la main.
  await activerIa(a.associe);
  repondreLignes(ctx, LIGNES_RAPPORT_OK);
  const ouvert = await ingererDd(ctx, a.chef, s.dossierId, "rapport", "r-ocr.pdf", pdfRapport());
  // Un document terminal n'est modifiable que par la purge : le déclencheur est suspendu le temps de la
  // transaction (DDL transactionnel : aucune autre session ne voit l'état suspendu).
  await proprietaire(async (c) => {
    await c.query("BEGIN");
    await c.query("ALTER TABLE ingestion_documents DISABLE TRIGGER ingestion_documents_controle");
    await c.query("UPDATE ingestion_documents SET corrections_ocr = $2::jsonb WHERE id = $1", [
      ouvert.id,
      JSON.stringify(CORRECTIONS_ATTENDUES),
    ]);
    await c.query("ALTER TABLE ingestion_documents ENABLE TRIGGER ingestion_documents_controle");
    await c.query("COMMIT");
  });

  const autre = await ingerer(ctx, s.b.directeur, s.b.clientId, "scan-b.pdf", scanne(), {
    exercice: exo(),
  });
  attendre(
    200,
    await s.b.associe.post(
      `/api/dossiers/${s.b.clientId}/etats-financiers/${autre.document.etat_financier_id}/decision`,
      { decision: "accepte", motif: "Relu par le consultant." },
    ),
    "acceptation B",
  );
  d = {
    accepte: accepte.id,
    etatAccepte,
    enRevue: enRevue.id,
    ouvert: ouvert.id,
    autreCabinet: autre.id,
    t0: new Date(),
  };
}, 300_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await ctx?.fermer();
});

describe("purge des corrections OCR avec le texte des pages", () => {
  it("préparation : corrections présentes, rien de purgé", async () => {
    for (const id of [d.accepte, d.enRevue, d.ouvert, d.autreCabinet]) {
      expect(await purge(id)).toBeNull();
      expect(await nbPages(id)).toBeGreaterThan(0);
    }
    expect(await corrections(d.accepte)).toEqual(CORRECTIONS_ATTENDUES);
    expect(await corrections(d.enRevue)).toEqual(CORRECTIONS_ATTENDUES);
    expect(await corrections(d.ouvert)).toEqual(CORRECTIONS_ATTENDUES);
    const detail = (
      await s.a.directeur.get(`/api/dossiers/${s.a.clientId}/ingestions/${d.accepte}`)
    ).json();
    expect(detail.corrections_ocr).toEqual(CORRECTIONS_ATTENDUES);
  });

  it("89 jours après la décision : rien n'est purgé, les corrections restent", async () => {
    const bilan = await maintenirA(s.a.cabinetId, apres(89));
    expect(bilan.documents_purges).toBe(0);
    expect(await corrections(d.accepte)).toEqual(CORRECTIONS_ATTENDUES);
    expect(await nbPages(d.accepte)).toBeGreaterThan(0);
    expect(await purge(d.accepte)).toBeNull();
  });

  it("91 jours : pages supprimées, texte_purge_le daté et corrections_ocr NULL ; le reste est intact", async () => {
    const bilan = await maintenirA(s.a.cabinetId, apres(91));
    expect(bilan.documents_purges).toBe(1);
    expect(await nbPages(d.accepte)).toBe(0);
    expect(await purge(d.accepte)).not.toBeNull();
    expect(await corrections(d.accepte)).toBeNull();
    // Un état en revue (sans décision) et un brouillon ouvert gardent texte et corrections.
    for (const id of [d.enRevue, d.ouvert]) {
      expect(await purge(id)).toBeNull();
      expect(await nbPages(id)).toBeGreaterThan(0);
      expect(await corrections(id)).toEqual(CORRECTIONS_ATTENDUES);
    }
    // Isolation : l'autre cabinet n'est pas touché par la purge du cabinet A.
    expect(await purge(d.autreCabinet)).toBeNull();
    expect(await corrections(d.autreCabinet)).toEqual(CORRECTIONS_ATTENDUES);
    expect(await nbPages(d.autreCabinet)).toBeGreaterThan(0);
  });

  it("jamais purgés, quelle que soit l'ancienneté : état en revue et brouillon ouvert", async () => {
    const bilan = await maintenirA(s.a.cabinetId, apres(5000));
    expect(bilan.documents_purges).toBe(0);
    for (const id of [d.enRevue, d.ouvert]) {
      expect(await purge(id)).toBeNull();
      expect(await corrections(id)).toEqual(CORRECTIONS_ATTENDUES);
    }
  });

  it("l'état financier accepté et ses lignes restent ; le détail renvoie corrections_ocr null", async () => {
    const etat = await etatDe(s.a.directeur, s.a.clientId, d.etatAccepte);
    expect(etat.statut).toBe("accepte");
    expect(etat.lignes.length).toBeGreaterThan(0);
    expect(etat.ingestion).toMatchObject({ document_id: d.accepte, corrections_ocr: null });
    const detail = (
      await s.a.directeur.get(`/api/dossiers/${s.a.clientId}/ingestions/${d.accepte}`)
    ).json();
    expect(detail).toMatchObject({ statut: "termine", corrections_ocr: null });
    expect(detail.texte_purge_le).not.toBeNull();
  });

  it("le cabinet B est purgé à son tour sans toucher au cabinet A", async () => {
    expect((await maintenirA(s.b.cabinetId, apres(91))).documents_purges).toBe(1);
    expect(await corrections(d.autreCabinet)).toBeNull();
    expect(await nbPages(d.autreCabinet)).toBe(0);
    expect(await corrections(d.enRevue)).toEqual(CORRECTIONS_ATTENDUES);
  });

  it("un second passage est sans effet (idempotence)", async () => {
    expect((await maintenirA(s.a.cabinetId, apres(120))).documents_purges).toBe(0);
  });
});

describe("garde-fous", () => {
  it("la fonction n'est exécutable que par le rôle applicatif (pas par PUBLIC)", async () => {
    const droits = (
      await sql(
        `SELECT has_function_privilege('missionpilot_app', 'purger_textes_ingestion(timestamptz, int, int)', 'EXECUTE') AS app,
                has_function_privilege('public', 'purger_textes_ingestion(timestamptz, int, int)', 'EXECUTE') AS pub`,
      )
    )[0];
    expect(droits).toEqual({ app: true, pub: false });
  });

  it("le déclencheur refuse toujours d'annuler seules les corrections d'un document terminal (MQG01)", async () => {
    await expect(
      sql("UPDATE ingestion_documents SET corrections_ocr = NULL WHERE id = $1", [d.enRevue]),
    ).rejects.toMatchObject({ code: "MQG01" });
    expect(await corrections(d.enRevue)).toEqual(CORRECTIONS_ATTENDUES);
  });

  it("la purge refuse l'appel sans contexte de cabinet", async () => {
    await expect(sql("SELECT purger_textes_ingestion(now(), 90, 10)")).rejects.toThrow(/invalides/);
  });
});
