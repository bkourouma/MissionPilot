/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORRECTIONS_OCR_MAX, correctionOcrSchema } from "@missionpilot/shared";
import { CORRECTIONS_OCR_PROPOSEES_MAX } from "@missionpilot/engines";
import { proprietaire } from "./helpers.js";
import {
  activerIa,
  demarrerIngestion,
  etatDe,
  fabriquerPdf,
  ingerer,
  reponseLignes,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Lot 11 : confusions classiques d'OCR (O/0, l/1, virgule/point) -> corrections PROPOSÉES, et marquage « lu par
 * OCR ». Une correction n'entre jamais dans l'état : la ligne reste telle que les règles l'ont lue, l'état part
 * en revue, le relecteur voit la proposition. Vrai PostgreSQL, OCR simulé (aucun moteur réel, aucun réseau).
 */

let ctx: ContexteIngestion;
let a: CabinetMissions;
let b: CabinetMissions;
let exercice = 2030;
const exo = () => ++exercice;

beforeAll(async () => {
  ctx = await demarrerIngestion();
  a = await preparerCabinet(ctx, "Ocr Corrections A");
  b = await preparerCabinet(ctx, "Ocr Corrections B");
  ctx.cabinets.push(a.cabinetId, b.cabinetId);
  await creerMission(a);
  await creerMission(b);
  await activerIa(b.associe);
}, 240_000);
afterAll(async () => {
  await ctx?.fermer();
});

const PAGE_CONFUSIONS = [
  "BILAN - ACTIF",
  "AD Frais de développement 1 234 56O",
  "AE Brevets et licences l 234 567",
  "BK Terrains 15 000 000",
  "BZ TOTAL ACTIF 16 234 567",
];

const scanne = (lignes: string[], confiance_pm = 880) =>
  fabriquerPdf({
    nbPages: 1,
    ocr: { pages: [{ numero: 1, texte: lignes.join("\n"), confiance_pm }] },
  });
const natif = (lignes: string[]) => fabriquerPdf({ pages: [lignes] });
const parCode = (etat: any) => Object.fromEntries(etat.lignes.map((l: any) => [l.code, l]));

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

describe("état lu par OCR avec confusions", () => {
  let id: string;
  let document: any;
  let etat: any;

  beforeAll(async () => {
    const r = await ingerer(ctx, a.directeur, a.clientId, "scan.pdf", scanne(PAGE_CONFUSIONS), {
      exercice: exo(),
    });
    id = r.id;
    document = r.document;
    etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
  });

  it("part toujours en revue, jamais accepté automatiquement", () => {
    expect(document).toMatchObject({
      statut: "termine",
      resultat: "etat_cree",
      methode: "ocr_simule",
    });
    expect(etat).toMatchObject({ origine: "pdf", statut: "en_revue", decision: null });
  });

  it("corrections_ocr contient les propositions attendues, valides au schéma", () => {
    expect(document.corrections_ocr).toEqual(CORRECTIONS_ATTENDUES);
    for (const c of document.corrections_ocr) {
      expect(correctionOcrSchema.safeParse(c).success).toBe(true);
    }
  });

  it("la ligne proposée n'entre pas dans l'état, la ligne lue de travers reste telle quelle", () => {
    const lignes = parCode(etat);
    expect(lignes.AD).toBeUndefined();
    expect(lignes.AE.montant).toBe(234567);
    expect(Object.keys(lignes).sort()).toEqual(["AE", "BK", "BZ"]);
    expect(etat.lignes.map((l: any) => l.montant)).not.toContain(1234560);
    expect(etat.lignes.map((l: any) => l.montant)).not.toContain(1234567);
  });

  it("chaque ligne porte reference.ocr = true et la confiance de sa page", () => {
    for (const l of etat.lignes) {
      expect(l.reference).toEqual({ fichier: "scan.pdf", page: 1, ocr: true, confiance_pm: 880 });
    }
  });

  it("le détail de l'état expose l'ingestion d'origine et les corrections", () => {
    expect(etat.ingestion).toEqual({
      document_id: id,
      methode: "ocr_simule",
      corrections_ocr: CORRECTIONS_ATTENDUES,
    });
  });

  it("la liste des documents n'expose pas les corrections", async () => {
    const r = await a.directeur.get(`/api/dossiers/${a.clientId}/ingestions`);
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("corrections_ocr");
    expect(r.body).toContain(id);
  });

  it("un autre cabinet reçoit 404 sur le document et sur l'état", async () => {
    const doc = await b.directeur.get(`/api/dossiers/${a.clientId}/ingestions/${id}`);
    expect(doc.statusCode).toBe(404);
    const e = await b.directeur.get(
      `/api/dossiers/${a.clientId}/etats-financiers/${document.etat_financier_id}`,
    );
    expect(e.statusCode).toBe(404);
  });

  it("le journal d'audit ne contient ni montant ni texte de page", async () => {
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT action, entite, details::text AS details FROM journal_audit
             WHERE cabinet_id = $1 AND (entite IN ('ingestion_document', 'dossier_etat_financier')
                OR (entite = 'fichier' AND details->>'ingestion' = 'true'))`,
            [a.cabinetId],
          )
        ).rows,
    );
    expect(lignes.length).toBeGreaterThan(2);
    const tout = JSON.stringify(lignes);
    for (const interdit of [
      "Brevets",
      "Frais de développement",
      "1 234 56O",
      "l 234 567",
      "1234560",
      "1234567",
      "234567",
      "corrections_ocr",
    ]) {
      expect(tout).not.toContain(interdit);
    }
  });
});

describe("lignes proposées par le modèle (IA activée)", () => {
  it("le montant lu de travers est rejeté, proposé en correction, et n'entre pas dans l'état", async () => {
    ctx.serveur.repondre(() =>
      reponseLignes([
        "1 | actif | AD | | | Frais de développement | 1234560",
        "1 | actif | BK | | | Terrains | 15000000",
      ]),
    );
    const { document } = await ingerer(
      ctx,
      b.directeur,
      b.clientId,
      "scan-ia.pdf",
      scanne(PAGE_CONFUSIONS),
      {
        exercice: exo(),
      },
    );
    expect(document).toMatchObject({ statut: "termine", methode: "ocr_simule" });
    expect(document.corrections_ocr.map((c: any) => [c.code, c.montant_propose])).toEqual([
      ["AD", 1234560],
      ["AE", 1234567],
    ]);
    const etat = await etatDe(b.directeur, b.clientId, document.etat_financier_id);
    expect(etat.statut).toBe("en_revue");
    expect(etat.lignes.map((l: any) => l.code)).toEqual(["BK"]);
    expect(etat.lignes[0].reference).toMatchObject({ page: 1, ocr: true, confiance_pm: 880 });
  });
});

describe("autres documents", () => {
  it("un état texte natif : corrections_ocr NULL, aucune reference.ocr", async () => {
    const { id, document } = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "natif.pdf",
      natif(PAGE_CONFUSIONS),
      { exercice: exo() },
    );
    expect(document).toMatchObject({ statut: "termine", methode: "texte", corrections_ocr: null });
    const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
    for (const l of etat.lignes) {
      expect(l.reference).toEqual({ fichier: "natif.pdf", page: 1 });
    }
    expect(etat.ingestion).toEqual({ document_id: id, methode: "texte", corrections_ocr: null });
    const bd = await proprietaire(
      async (c) =>
        (await c.query("SELECT corrections_ocr FROM ingestion_documents WHERE id = $1", [id]))
          .rows[0],
    );
    expect(bd.corrections_ocr).toBeNull();
  });

  it("un état saisi à la main n'a pas d'ingestion", async () => {
    const e = exo();
    const r = await a.directeur.post(`/api/dossiers/${a.clientId}/etats-financiers`, {
      exercice: e,
      date_cloture: `${e}-12-31`,
      devise: "XOF",
      lignes: [{ code: "AZ", libelle: "Actif", section: "actif", montant: 10 }],
    });
    expect(r.statusCode).toBe(201);
    const etat = await etatDe(a.directeur, a.clientId, r.json().id);
    expect(etat.ingestion).toBeNull();
  });

  it("un scan sans confusion : liste de corrections vide, lignes marquées OCR, revue", async () => {
    const { document } = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "propre.pdf",
      scanne(["BILAN - ACTIF", "AD Frais 1 200 000", "BZ TOTAL ACTIF 1 200 000"], 640),
      { exercice: exo() },
    );
    expect(document.corrections_ocr).toEqual([]);
    const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
    expect(etat).toMatchObject({ statut: "en_revue" });
    expect(
      etat.lignes.every((l: any) => l.reference.ocr === true && l.reference.confiance_pm === 640),
    ).toBe(true);
    expect(etat.ingestion.corrections_ocr).toEqual([]);
  });

  it("des confusions sans aucune ligne lue : rien trouvé, corrections conservées et bornées", async () => {
    const lignes = ["BILAN - ACTIF"];
    for (let i = 0; i < CORRECTIONS_OCR_MAX + 20; i++) lignes.push("Poste Alpha 1 234 56O");
    const { document } = await ingerer(ctx, a.directeur, a.clientId, "bruit.pdf", scanne(lignes), {
      exercice: exo(),
    });
    expect(document).toMatchObject({
      statut: "termine",
      resultat: "rien_trouve",
      etat_financier_id: null,
    });
    expect(document.corrections_ocr).toHaveLength(CORRECTIONS_OCR_PROPOSEES_MAX);
    expect(CORRECTIONS_OCR_PROPOSEES_MAX).toBe(CORRECTIONS_OCR_MAX);
    expect(document.corrections_ocr[0]).toMatchObject({ montant_propose: 1234560, page: 1 });
  });

  it("un contenu invalide en base donne null, sans exception", async () => {
    const { id } = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "invalide.pdf",
      scanne(PAGE_CONFUSIONS),
      { exercice: exo() },
    );
    // Le déclencheur MQG01 interdit de modifier un document terminé : levé le temps de cette écriture de test.
    await proprietaire(async (c) => {
      await c.query("ALTER TABLE ingestion_documents DISABLE TRIGGER ingestion_documents_controle");
      try {
        await c.query(
          `UPDATE ingestion_documents SET corrections_ocr = '[{"page": 0}]'::jsonb WHERE id = $1`,
          [id],
        );
      } finally {
        await c.query(
          "ALTER TABLE ingestion_documents ENABLE TRIGGER ingestion_documents_controle",
        );
      }
    });
    const r = await a.directeur.get(`/api/dossiers/${a.clientId}/ingestions/${id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().corrections_ocr).toBeNull();
  });
});
