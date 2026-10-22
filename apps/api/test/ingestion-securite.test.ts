import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PLAFONDS_INGESTION } from "@missionpilot/shared";
import { StockageDisque } from "../src/stockage/disque.js";
import { api } from "./api.js";
import { ECHANTILLONS, televerser, zip } from "./fichiers-outils.js";
import { proprietaire } from "./helpers.js";
import {
  activerIa,
  demarrerIngestion,
  executerJobs,
  fabriquerPdf,
  ingerer,
  LIGNES_IA_LIASSE,
  objetsStockes,
  pdfLiasse,
  reponseLignes,
  televerserEtat,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Sécurité de l'ingestion (ADR-009, décision 6) : droits, isolation entre cabinets, portail fermé, types
 * refusés par le contenu, tailles, plafonds par cabinet, effacement du fichier après traitement, réponses sans
 * clé de stockage ni coût, aucun appel réseau externe.
 */

let ctx: ContexteIngestion;
let a: CabinetMissions;
let b: CabinetMissions;
let c: CabinetMissions; // plafonds
let portail: UtilisateurPortail;
let exercice = 2100 - 60;
const exo = () => ++exercice;
const INCONNU = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  ctx = await demarrerIngestion();
  a = await preparerCabinet(ctx, "Sécurité A");
  b = await preparerCabinet(ctx, "Sécurité B");
  c = await preparerCabinet(ctx, "Sécurité C");
  ctx.cabinets.push(a.cabinetId, b.cabinetId, c.cabinetId);
  for (const x of [a, b, c]) await creerMission(x);
  portail = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
}, 240_000);
afterAll(async () => {
  await ctx?.fermer();
});

const url = (clientId: string) =>
  `/api/dossiers/${clientId}/etats-financiers/document?exercice=2025&date_cloture=2025-12-31&devise=XOF`;

describe("droits et isolation", () => {
  it("401 sans session ; 403 sans permission ; portail fermé", async () => {
    const anonyme = api(ctx);
    const pdf = pdfLiasse();
    expect((await televerser(anonyme, url(a.clientId), "x.pdf", pdf)).statusCode).toBe(401);
    expect((await anonyme.get(`/api/dossiers/${a.clientId}/ingestions`)).statusCode).toBe(401);

    const doc = await ingerer(ctx, a.directeur, a.clientId, "droits.pdf", pdf, { exercice: exo() });
    const base = `/api/dossiers/${a.clientId}/ingestions`;
    const lectures = [base, `${base}/${doc.id}`, `${base}/${doc.id}/pages/1`];

    // Sans dossier.lire (gestionnaire) : 403 partout ; sans dossier.ecrire (expert métier) : lecture seule.
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    const expert = await a.avecRoles(["expert_metier"]);
    for (const u of lectures) expect((await gestionnaire.get(u)).statusCode).toBe(403);
    expect((await televerser(gestionnaire, url(a.clientId), "x.pdf", pdf)).statusCode).toBe(403);
    expect((await televerser(expert, url(a.clientId), "x.pdf", pdf)).statusCode).toBe(403);
    for (const u of lectures) expect((await a.associe.get(u)).statusCode).toBe(200);

    // Compte du portail : fermé par défaut, 403 sur toutes les routes.
    for (const u of lectures) expect((await portail.get(u)).statusCode).toBe(403);
    expect((await televerser(portail, url(a.clientId), "x.pdf", pdf)).statusCode).toBe(403);
  });

  it("autre cabinet : 404 en liste, détail, pages, et même en téléversement sur un dossier d'autrui", async () => {
    const doc = await ingerer(ctx, a.directeur, a.clientId, "isole.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    const avant = await objetsStockes(ctx, b.cabinetId);
    const base = `/api/dossiers/${a.clientId}/ingestions`;
    for (const u of [base, `${base}/${doc.id}`, `${base}/${doc.id}/pages/1`]) {
      expect((await b.associe.get(u)).statusCode).toBe(404);
    }
    expect((await televerser(b.associe, url(a.clientId), "x.pdf", pdfLiasse())).statusCode).toBe(
      404,
    );
    expect(await objetsStockes(ctx, b.cabinetId)).toBe(avant); // rien n'a été lu ni stocké
    // Un document de A cherché sous le dossier de B : 404.
    expect(
      (await b.associe.get(`/api/dossiers/${b.clientId}/ingestions/${doc.id}`)).statusCode,
    ).toBe(404);
    // Dossier inconnu, document inconnu : 404 ; identifiant mal formé : 400.
    expect((await a.associe.get(`/api/dossiers/${INCONNU}/ingestions`)).statusCode).toBe(404);
    expect((await a.associe.get(`${base}/${INCONNU}`)).statusCode).toBe(404);
    expect((await a.associe.get(`${base}/pas-un-uuid`)).statusCode).toBe(400);
  });

  it("un document d'un autre dossier du même cabinet répond 404", async () => {
    const autre = await a.associe.post("/api/clients", { raison_sociale: "Autre client de A" });
    attendre(201, autre, "client");
    const doc = await ingerer(ctx, a.directeur, a.clientId, "dossier1.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    const base = `/api/dossiers/${autre.json().id}/ingestions`;
    expect((await a.associe.get(`${base}/${doc.id}`)).statusCode).toBe(404);
    expect((await a.associe.get(`${base}/${doc.id}/pages/1`)).statusCode).toBe(404);
    expect((await a.associe.get(base)).json().elements).toEqual([]);
  });

  it("dossier non visible de l'utilisateur (hors équipe) : 404 avant de lire le corps", async () => {
    const hors = await a.avecRoles(["consultant"]);
    const avant = await objetsStockes(ctx, a.cabinetId);
    expect((await televerser(hors, url(a.clientId), "x.pdf", pdfLiasse())).statusCode).toBe(404);
    expect((await hors.get(`/api/dossiers/${a.clientId}/ingestions`)).statusCode).toBe(404);
    expect(await objetsStockes(ctx, a.cabinetId)).toBe(avant);
  });
});

describe("types et tailles", () => {
  it("le type est décidé par le contenu : faux PDF, PDF actif, CSV, Office, image", async () => {
    const avant = await objetsStockes(ctx, a.cabinetId);
    const refus = async (nom: string, contenu: Buffer) =>
      televerser(a.directeur, url(a.clientId), nom, contenu);
    // Exécutable renommé en .pdf, PDF actif (JavaScript) : refusés par la détection du contenu.
    for (const [nom, contenu] of [
      ["faux.pdf", ECHANTILLONS.exe()],
      ["script.pdf", Buffer.from("#!/bin/sh\necho oups\n")],
      ["actif.pdf", fabriquerPdf({ nbPages: 1, actif: true })],
      ["actif2.pdf", ECHANTILLONS.pdfActif()],
    ] as const) {
      const r = await refus(nom, contenu);
      expect([nom, r.statusCode]).toEqual([nom, 415]);
    }
    // Types détectés mais hors périmètre de l'ingestion : TYPE_DOCUMENT_REFUSE.
    for (const [nom, contenu] of [
      ["donnees.csv", ECHANTILLONS.csv()],
      ["note.txt", ECHANTILLONS.txt()],
      ["lettre.docx", ECHANTILLONS.docx()],
      ["photo.png", ECHANTILLONS.png()],
    ] as const) {
      const r = await refus(nom, contenu);
      expect([nom, r.statusCode, r.json().erreur.code]).toEqual([nom, 415, "TYPE_DOCUMENT_REFUSE"]);
    }
    // Extension mensongère sur un vrai PDF : refusée.
    expect((await refus("rapport.xlsx", pdfLiasse())).statusCode).toBe(415);
    // Corps non multipart.
    expect(
      (
        await a.directeur.brut({
          method: "POST",
          url: url(a.clientId),
          payload: pdfLiasse(),
          headers: { "content-type": "application/pdf" },
        })
      ).statusCode,
    ).toBe(415);
    expect(await objetsStockes(ctx, a.cabinetId)).toBe(avant);
  });

  it("fichier trop volumineux : 413 (PDF au-delà de 10 Mo, classeur au-delà de 2 Mo)", async () => {
    const avant = await objetsStockes(ctx, a.cabinetId);
    // Dans la marge de l'enveloppe multipart : refusé en flux ; au-delà : refusé d'après Content-Length.
    for (const taille of [PLAFONDS_INGESTION.tailleOctetsPdf + 1024, 11 * 1024 * 1024]) {
      const gros = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(taille, 0x20)]);
      const r = await televerser(a.directeur, url(a.clientId), "gros.pdf", gros);
      expect([taille, r.statusCode, r.json().erreur.code]).toEqual([
        taille,
        413,
        "FICHIER_TROP_VOLUMINEUX",
      ]);
    }
    const classeur = zip({
      "[Content_Types].xml": '<?xml version="1.0"?><Types/>',
      "xl/workbook.xml": "x".repeat(PLAFONDS_INGESTION.tailleOctetsXlsx + 1000),
    });
    const r = await televerser(a.directeur, url(a.clientId), "gros.xlsx", classeur);
    expect(r.statusCode).toBe(413);
    expect(await objetsStockes(ctx, a.cabinetId)).toBe(avant);
  });
});

describe("fichier temporaire et réponses", () => {
  it("l'objet de stockage est effacé après traitement ; aucune clé, aucun coût dans les réponses", async () => {
    const { id, document } = await ingerer(
      ctx,
      c.directeur,
      c.clientId,
      "temporaire.pdf",
      pdfLiasse(),
      {
        exercice: exo(),
      },
    );
    expect(document.statut).toBe("termine");
    expect(await objetsStockes(ctx, c.cabinetId)).toBe(0);
    const ligne = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT d.fichier_id, s.motif, s.supprime_par FROM ingestion_documents d
             LEFT JOIN fichiers f ON f.cabinet_id = d.cabinet_id AND f.nom_origine = d.nom AND f.cabinet_id = $2
             LEFT JOIN fichiers_suppressions s ON s.fichier_id = f.id
             WHERE d.id = $1`,
            [id, c.cabinetId],
          )
        ).rows[0],
    );
    expect(ligne).toEqual({
      fichier_id: null,
      motif: "retire",
      supprime_par: c.directeur.utilisateurId,
    });
    const reponses = JSON.stringify([
      document,
      (await c.directeur.get(`/api/dossiers/${c.clientId}/ingestions`)).json(),
      (await c.directeur.get(`/api/dossiers/${c.clientId}/ingestions/${id}/pages/1`)).json(),
    ]);
    expect(reponses).not.toMatch(/cle_stockage|fichier_id|cout|micro_usd|storage/i);
    // Le fichier n'est pas non plus téléchargeable par la route générale des fichiers.
    const fichiers = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT id FROM fichiers WHERE cabinet_id = $1", [c.cabinetId])).rows,
    );
    for (const f of fichiers) {
      expect((await c.directeur.get(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
    }
  });
});

describe("plafonds par cabinet", () => {
  it("le 6e document en traitement est refusé (409) et son objet effacé ; puis 40 créations par jour", async () => {
    const n = PLAFONDS_INGESTION.documentsEnTraitementParCabinet;
    const creation = (i: number) =>
      televerserEtat(c.directeur, c.clientId, `lot${i}.pdf`, pdfLiasse(), { exercice: exo() });
    for (let i = 0; i < n; i++) attendre(202, await creation(i), `document ${i + 1}`);
    expect(await objetsStockes(ctx, c.cabinetId)).toBe(n);
    const sixieme = await creation(n);
    expect(sixieme.statusCode).toBe(409);
    expect(sixieme.json().erreur.code).toBe("INGESTION_PLEIN");
    expect(await objetsStockes(ctx, c.cabinetId)).toBe(n); // l'objet du refusé n'est pas resté
    await executerJobs(ctx);
    expect(await objetsStockes(ctx, c.cabinetId)).toBe(0);
    attendre(202, await creation(n + 1), "après traitement, la place est rendue");
    await executerJobs(ctx);

    // Complète jusqu'à 40 créations dans les 24 heures (lignes terminées posées par le propriétaire).
    const existants = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT count(*)::int AS n FROM ingestion_documents WHERE cabinet_id = $1",
            [c.cabinetId],
          )
        ).rows[0].n as number,
    );
    await proprietaire(async (cl) => {
      await cl.query(
        `INSERT INTO ingestion_documents (cabinet_id, usage, client_id, nom, format, sha256, taille,
           parametres, cree_par)
         SELECT $1, 'etat_financier', $2, 'plafond-' || g || '.pdf', 'pdf', repeat('a', 64), 100,
           '{}', $3 FROM generate_series(1, $4) AS g`,
        [
          c.cabinetId,
          c.clientId,
          c.directeur.utilisateurId,
          PLAFONDS_INGESTION.documentsParJourEtCabinet - existants,
        ],
      );
      await cl.query(
        "UPDATE ingestion_documents SET statut = 'extraction' WHERE nom LIKE 'plafond-%'",
      );
      await cl.query(
        "UPDATE ingestion_documents SET statut = 'structuration' WHERE nom LIKE 'plafond-%'",
      );
      await cl.query(
        `UPDATE ingestion_documents SET statut = 'termine', resultat = 'rien_trouve', termine_le = now()
         WHERE nom LIKE 'plafond-%'`,
      );
    });
    const quarante_et_unieme = await creation(99);
    expect(quarante_et_unieme.statusCode).toBe(409);
    expect(quarante_et_unieme.json().erreur).toMatchObject({ code: "INGESTION_PLEIN" });
    expect(quarante_et_unieme.json().erreur.message).toMatch(/24 heures/);
    expect(await objetsStockes(ctx, c.cabinetId)).toBe(0);
  });
});

describe("documents bloqués et pannes inattendues", () => {
  it("un document « en traitement » de plus de 30 minutes ne bloque plus le quota", async () => {
    const x = await preparerCabinet(ctx, "Sécurité D");
    ctx.cabinets.push(x.cabinetId);
    await creerMission(x);
    const n = PLAFONDS_INGESTION.documentsEnTraitementParCabinet;
    for (let i = 0; i < n; i++) {
      attendre(
        202,
        await televerserEtat(x.directeur, x.clientId, `bloque${i}.pdf`, pdfLiasse(), {
          exercice: exo(),
        }),
        `document ${i + 1}`,
      );
    }
    const refuse = await televerserEtat(x.directeur, x.clientId, "refuse.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    expect(refuse.statusCode).toBe(409);
    // `cree_le` est immuable pour l'application : le propriétaire vieillit les lignes (déclencheur suspendu).
    await proprietaire(async (cl) => {
      await cl.query("BEGIN");
      await cl.query(
        "ALTER TABLE ingestion_documents DISABLE TRIGGER ingestion_documents_controle",
      );
      await cl.query(
        "UPDATE ingestion_documents SET cree_le = now() - interval '31 minutes' WHERE cabinet_id = $1",
        [x.cabinetId],
      );
      await cl.query("ALTER TABLE ingestion_documents ENABLE TRIGGER ingestion_documents_controle");
      await cl.query("COMMIT");
    });
    attendre(
      202,
      await televerserEtat(x.directeur, x.clientId, "libre.pdf", pdfLiasse(), { exercice: exo() }),
      "place rendue",
    );
  });

  it("panne du stockage à la dernière tentative : le document échoue en ERREUR_INTERNE", async () => {
    const x = await preparerCabinet(ctx, "Sécurité E");
    ctx.cabinets.push(x.cabinetId);
    await creerMission(x);
    const r = await televerserEtat(x.directeur, x.clientId, "panne.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    attendre(202, r, "téléversement");
    const id = r.json().id as string;
    // Une seule tentative permise : la première est la dernière.
    await proprietaire((cl) =>
      cl.query("UPDATE jobs SET tentatives_max = 1 WHERE cabinet_id = $1", [x.cabinetId]),
    );
    const panne = vi
      .spyOn(StockageDisque.prototype, "lire")
      .mockRejectedValue(new Error("panne simulée du stockage"));
    await executerJobs(ctx);
    const etat = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT statut, erreur_code FROM ingestion_documents WHERE id = $1", [id]))
          .rows[0],
    );
    panne.mockRestore();
    expect(etat).toEqual({ statut: "echec", erreur_code: "ERREUR_INTERNE" });
  });
});

describe("aucun appel réseau externe", () => {
  it("le seul fournisseur joignable est le serveur factice local", async () => {
    await activerIa(b.associe);
    ctx.serveur.repondre(() => reponseLignes(LIGNES_IA_LIASSE));
    const hotes: string[] = [];
    const reel = globalThis.fetch;
    const espion = vi.spyOn(globalThis, "fetch").mockImplementation(async (entree, init) => {
      const u =
        typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
      hotes.push(new URL(u).host);
      return reel(entree, init);
    });
    try {
      const avant = ctx.serveur.requetes.length;
      const { document } = await ingerer(ctx, b.directeur, b.clientId, "reseau.pdf", pdfLiasse(), {
        exercice: exo(),
      });
      expect(document.statut).toBe("termine");
      expect(ctx.serveur.requetes.length).toBe(avant + 1);
    } finally {
      espion.mockRestore();
    }
    const local = new URL(ctx.serveur.url).host;
    expect(hotes.length).toBeGreaterThan(0);
    expect(new Set(hotes)).toEqual(new Set([local]));
    expect(local).toMatch(/^127\.0\.0\.1:/);
  });
});
