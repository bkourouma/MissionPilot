import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cheminNavigateur } from "../src/rapports/pdf.js";
import { nomFichierFacture, PDF_FACTURES_PAR_FENETRE } from "../src/routes/factures-pdf.js";
import { detecterType } from "../src/stockage/detection.js";
import { api } from "./api.js";
import {
  attendre,
  factureEmise,
  missionAvecEcheancier,
  aFacturer,
  preparerFacturation,
  type CabinetFacturation,
  type EcheanceTest,
} from "./facturation-outils.js";
import { configTest, demarrer, proprietaire, type Contexte } from "./helpers.js";
import { inviterClient } from "./portail-outils.js";

/*
 * GET /api/factures/:id/pdf : PDF du document de facture existant (FIN-07),
 * imprimé par le Chromium isolé des rapports ; droits « facture.lire »,
 * visibilité de la mission, isolation, portail fermé, journal.
 */

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let emiseId: string;
let brouillonId: string;
const navigateur = cheminNavigateur(configTest());
const url = (id: string) => `/api/factures/${id}/pdf`;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Factures PDF A");
  b = await preparerFacturation(ctx, "Cabinet Factures PDF B");
  emiseId = (await factureEmise(a)).facture.id as string;
  const m = await missionAvecEcheancier(a);
  const premiere = m.echeances[0] as EcheanceTest;
  await aFacturer(a.gestionnaire, premiere.id);
  const f = await a.gestionnaire.post(`/api/missions/${m.id}/factures`, {
    echeance_ids: [premiere.id],
  });
  attendre(201, f, "brouillon");
  brouillonId = f.json().id;
}, 180_000);
afterAll(() => ctx.fermer());

describe("PDF de facture", () => {
  it("nom de fichier sûr", () => {
    expect(nomFichierFacture("facture", "FA-2026-00001")).toBe("Facture FA-2026-00001.pdf");
    expect(nomFichierFacture("avoir", null)).toBe("Avoir brouillon.pdf");
    expect(nomFichierFacture("facture", 'A"/\\<x>\r\n')).toBe("Facture A----x---.pdf");
  });

  it("401 sans session, 403 sans facture.lire, 404 autre cabinet ou inexistante, 400 identifiant", async () => {
    expect((await api(ctx).get(url(emiseId))).statusCode).toBe(401);
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get(url(emiseId))).statusCode).toBe(403);
    expect((await b.associe.get(url(emiseId))).statusCode).toBe(404);
    expect((await a.associe.get(url("00000000-0000-4000-8000-000000000000"))).statusCode).toBe(404);
    expect((await a.associe.get(url("pas-un-uuid"))).statusCode).toBe(400);
  });

  it("portail : route fermée (403 avant tout rendu)", async () => {
    const client = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    const r = await client.get(url(emiseId));
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
  });

  it.skipIf(!navigateur)(
    "facture émise : PDF réel en pièce jointe, sans cache, journalisé",
    async () => {
      const r = await a.gestionnaire.get(url(emiseId));
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/pdf");
      expect(r.headers["content-disposition"]).toMatch(
        /^attachment; filename="Facture [^"]+\.pdf"$/,
      );
      expect(r.headers["cache-control"]).toBe("private, no-store");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(detecterType(r.rawPayload, "pdf").type).toBe("application/pdf");
      const journal = await proprietaire(
        async (c) =>
          (
            await c.query(
              `SELECT utilisateur_id, entite_id FROM journal_audit
             WHERE cabinet_id = $1 AND action = 'telechargement_facture_pdf'`,
              [a.cabinetId],
            )
          ).rows,
      );
      expect(journal).toEqual([
        { utilisateur_id: a.gestionnaire.utilisateurId, entite_id: emiseId },
      ]);
    },
  );

  it("limite de débit par utilisateur : 429 TROP_DE_PDF_FACTURES, avant tout rendu", async () => {
    const limite = await a.avecRoles(["gestionnaire"]);
    const autre = await a.avecRoles(["gestionnaire"]);
    const ancien = await a.avecRoles(["gestionnaire"]);
    const ligne = (utilisateurId: string, minutes: number) =>
      proprietaire((c) =>
        c.query(
          `INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite, entite_id, cree_le)
           VALUES ($1, $2, 'telechargement_facture_pdf', 'facture', $3,
                   now() - make_interval(mins => $4))`,
          [a.cabinetId, utilisateurId, emiseId, minutes],
        ),
      );
    // Presque au plafond : le dernier passe la garde (200, ou 503 sans navigateur), pas le suivant.
    for (let i = 0; i < PDF_FACTURES_PAR_FENETRE; i++) await ligne(limite.utilisateurId, 1);
    // Les téléchargements de plus de dix minutes ne comptent plus.
    for (let i = 0; i < PDF_FACTURES_PAR_FENETRE; i++) await ligne(ancien.utilisateurId, 11);

    const refus = await limite.get(url(emiseId));
    expect(refus.statusCode).toBe(429);
    expect(refus.json().erreur.code).toBe("TROP_DE_PDF_FACTURES");
    // Par utilisateur : un autre utilisateur du cabinet, ou dont les lignes sont anciennes, passe.
    for (const u of [autre, ancien]) {
      const ok = await u.get(url(emiseId));
      expect([200, 503], ok.body.slice(0, 200)).toContain(ok.statusCode);
      if (ok.statusCode === 503) expect(ok.json().erreur.code).toBe("RENDU_PDF_INDISPONIBLE");
    }
    // Les contrôles de droits et de visibilité priment sur le débit.
    expect((await b.associe.get(url(emiseId))).statusCode).toBe(404);
  });

  it.skipIf(!navigateur)("brouillon : PDF de l'aperçu (filigrane du document HTML)", async () => {
    const r = await a.chef.get(url(brouillonId));
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toContain('filename="Facture brouillon.pdf"');
  });
});
