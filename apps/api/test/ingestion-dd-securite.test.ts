import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PLAFONDS_INGESTION } from "@missionpilot/shared";
import { fournisseurSimule } from "../src/due-diligence/donnees-ouvertes.js";
import { api, type Api } from "./api.js";
import { cloturerMission, creerDossierDd } from "./dd-outils.js";
import { creerMissionSignee } from "./missions-outils.js";
import { ECHANTILLONS, televerser } from "./fichiers-outils.js";
import {
  activerIa,
  demarrerIngestion,
  executerJobs,
  ingerer,
  objetsStockes,
  pdfLiasse,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import {
  ingererDd,
  LIGNES_RAPPORT_OK,
  MARQUEUR,
  pdfRapport,
  preparerIngestionDd,
  repondreLignes,
  televerserDd,
  urlDocuments,
  type ScenarioIngestionDd,
} from "./ingestion-dd-outils.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Sécurité de l'ingestion pour la due diligence (DD-02, DD-10) : droits par rôle, isolation entre cabinets,
 * mission non visible ou clôturée, portail fermé, plafonds du socle inchangés, adaptateur de données ouvertes
 * toujours simulé et aucun appel réseau externe.
 */

let ctx: ContexteIngestion;
let s: ScenarioIngestionDd;
let docId: string;
let extractionId: string;
let contenu: Record<string, unknown>;
/** Mission clôturée : son dossier, son document et son brouillon. */
let ferme: { dossierId: string; docId: string; extractionId: string };
let dirigeant: UtilisateurPortail;
let investisseur: UtilisateurPortail;
const INCONNU = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  ctx = await demarrerIngestion();
  s = await preparerIngestionDd(ctx, "Ingestion DD sécurité");
  await activerIa(s.a.associe);
  repondreLignes(ctx, LIGNES_RAPPORT_OK);
  const d = await ingererDd(ctx, s.a.chef, s.dossierId, "rapport", "ouvert.pdf", pdfRapport());
  docId = d.id;
  extractionId = d.document.extractions[0].id;
  contenu = d.document.extractions[0].contenu;

  const m2 = (await creerMissionSignee(s.a)).id;
  const dossierFerme = await creerDossierDd(s.a.chef, m2);
  const f = await ingererDd(ctx, s.a.chef, dossierFerme.id, "salle", "ferme.pdf", pdfRapport());
  ferme = { dossierId: dossierFerme.id, docId: f.id, extractionId: f.document.extractions[0].id };
  await cloturerMission(s, m2);

  dirigeant = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
  investisseur = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_investisseur"]);
}, 300_000);
afterAll(async () => {
  await ctx?.fermer();
});

interface Route {
  methode: "GET" | "POST" | "PATCH";
  url: string;
  corps?: unknown;
  /** Téléversement multipart. */
  fichier?: boolean;
}

/** Les sept routes, pour un dossier, un document et une extraction donnés. */
const routes = (d: string, doc: string, x: string): Record<string, Route> => ({
  televerser: { methode: "POST", url: urlDocuments(d, "rapport"), fichier: true },
  liste: { methode: "GET", url: urlDocuments(d) },
  detail: { methode: "GET", url: `/api/dd/documents/${doc}` },
  page: { methode: "GET", url: `/api/dd/documents/${doc}/pages/1` },
  lecture: { methode: "POST", url: `/api/dd/documents/${doc}/lecture` },
  modifier: { methode: "PATCH", url: `/api/dd/extractions/${x}`, corps: { contenu } },
  decision: {
    methode: "POST",
    url: `/api/dd/extractions/${x}/decision`,
    corps: { decision: "validee", acquitte_chiffres: true },
  },
});

function appeler(par: Api, r: Route) {
  if (r.fichier) return televerser(par, r.url, "x.pdf", pdfRapport());
  if (r.methode === "GET") return par.get(r.url);
  return r.methode === "PATCH" ? par.patch(r.url, r.corps) : par.post(r.url, r.corps ?? {});
}

const ouvertes = () => routes(s.dossierId, docId, extractionId);

async function statuts(par: Api, table: Record<string, Route>) {
  const sortie: Record<string, number> = {};
  for (const [nom, r] of Object.entries(table)) sortie[nom] = (await appeler(par, r)).statusCode;
  return sortie;
}

const tous = (code: number, table: Record<string, Route>) =>
  Object.fromEntries(Object.keys(table).map((k) => [k, code]));

describe("sept routes, sans session, droits par rôle", () => {
  it("inventaire : sept routes DD de l'ingestion, une seule en PATCH, aucune route de données ouvertes", () => {
    const inventaire = ctx.app.routesInventoriees.filter(
      (r) =>
        r.motif.startsWith("/api/dd/") &&
        (r.motif.includes("/documents") || r.motif.includes("/extractions")) &&
        r.methode !== "OPTIONS" &&
        r.methode !== "HEAD",
    );
    expect(inventaire.map((r) => `${r.methode} ${r.motif}`).sort()).toEqual(
      [
        "GET /api/dd/dossiers/:id/documents",
        "GET /api/dd/documents/:docId",
        "GET /api/dd/documents/:docId/pages/:numero",
        "PATCH /api/dd/extractions/:id",
        "POST /api/dd/dossiers/:id/documents",
        "POST /api/dd/documents/:docId/lecture",
        "POST /api/dd/extractions/:id/decision",
      ].sort(),
    );
    const ouvertesDonnees = ctx.app.routesInventoriees.filter((r) =>
      /donnees[-_]ouvertes|open-?data/i.test(r.motif),
    );
    expect(ouvertesDonnees).toEqual([]);
  });

  it("401 sans session sur chaque route", async () => {
    expect(await statuts(api(ctx), ouvertes())).toEqual(tous(401, ouvertes()));
  });

  it("gestionnaire, ressources, expert externe : 403 partout (permission avant toute donnée)", async () => {
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      expect(await statuts(u, ouvertes())).toEqual(tous(403, ouvertes()));
    }
  });

  it("expert métier : lit et décide (dd.lire, dd.valider), n'écrit pas (dd.ecrire)", async () => {
    const o = ouvertes();
    const avant = await objetsStockes(ctx, s.a.cabinetId);
    expect(
      await statuts(s.expertMetier, { ...o, decision: { ...o.decision!, corps: {} } }),
    ).toMatchObject({
      televerser: 403,
      liste: 200,
      detail: 200,
      page: 200,
      lecture: 403,
      modifier: 403,
      decision: 400, // corps invalide : la permission est acceptée, la validation du corps répond
    });
    expect(await objetsStockes(ctx, s.a.cabinetId)).toBe(avant);
  });

  it("consultant : écrit (dd.ecrire) sans valider (dd.valider) ; la relance est refusée tant qu'un brouillon est ouvert", async () => {
    const o = ouvertes();
    const r = await statuts(s.consultantEquipe, { ...o, modifier: { ...o.modifier! } });
    expect(r).toMatchObject({ liste: 200, detail: 200, page: 200, lecture: 409, decision: 403 });
    expect(r.televerser).toBe(202); // téléversement permis à qui écrit
    expect(r.modifier).toBe(200);
    await executerJobs(ctx);
  });
});

describe("isolation entre cabinets et visibilité de la mission", () => {
  it("autre cabinet : 404 en liste, détail, pages, téléversement, relance, correction et décision", async () => {
    const avant = await objetsStockes(ctx, s.b.cabinetId);
    expect(await statuts(s.b.associe, ouvertes())).toEqual(tous(404, ouvertes()));
    expect(await objetsStockes(ctx, s.b.cabinetId)).toBe(avant); // corps jamais lu ni stocké
    // Mission du cabinet B : le document de A est introuvable aussi par un dossier de B.
    expect((await s.b.associe.get(`/api/dd/documents/${docId}`)).statusCode).toBe(404);
  });

  it("mission non visible (consultant hors équipe) : 404 partout, avant de lire le corps", async () => {
    const avant = await objetsStockes(ctx, s.a.cabinetId);
    expect(await statuts(s.consultantHors, ouvertes())).toMatchObject({
      televerser: 404,
      liste: 404,
      detail: 404,
      page: 404,
      modifier: 404,
    });
    expect(await objetsStockes(ctx, s.a.cabinetId)).toBe(avant);
    // Un valideur hors équipe est tout aussi aveugle : la permission ne suffit pas.
    const valideurHors = await s.a.avecRoles(["expert_metier"]);
    expect(await statuts(valideurHors, ouvertes())).toMatchObject({
      liste: 404,
      detail: 404,
      decision: 404,
    });
  });

  it("identifiants inconnus ou mal formés : 404 / 400", async () => {
    expect((await s.a.chef.get(`/api/dd/documents/${INCONNU}`)).statusCode).toBe(404);
    expect((await s.a.chef.get(`/api/dd/documents/${INCONNU}/pages/1`)).statusCode).toBe(404);
    expect((await s.a.chef.get(urlDocuments(INCONNU))).statusCode).toBe(404);
    expect((await s.a.chef.patch(`/api/dd/extractions/${INCONNU}`, { contenu })).statusCode).toBe(
      404,
    );
    expect(
      (await s.a.chef.post(`/api/dd/extractions/${INCONNU}/decision`, { decision: "validee" }))
        .statusCode,
    ).toBe(404);
    expect((await s.a.chef.get("/api/dd/documents/pas-un-uuid")).statusCode).toBe(400);
    expect((await s.a.chef.get(`/api/dd/documents/${docId}/pages/0`)).statusCode).toBe(400);
  });

  it("un document d'un autre usage (état financier) répond 404 sur ces routes", async () => {
    const etat = await ingerer(ctx, s.a.directeur, s.a.clientId, "etat.pdf", pdfLiasse(), {
      exercice: 2091,
    });
    expect((await s.a.associe.get(`/api/dd/documents/${etat.id}`)).statusCode).toBe(404);
    expect((await s.a.associe.get(`/api/dd/documents/${etat.id}/pages/1`)).statusCode).toBe(404);
    expect((await s.a.associe.post(`/api/dd/documents/${etat.id}/lecture`)).statusCode).toBe(404);
  });
});

describe("mission clôturée", () => {
  it("lecture permise ; téléversement, relance, correction et décision refusés (409 MISSION_CLOTUREE)", async () => {
    const o = routes(ferme.dossierId, ferme.docId, ferme.extractionId);
    const avant = await objetsStockes(ctx, s.a.cabinetId);
    expect((await appeler(s.a.chef, o.liste!)).statusCode).toBe(200);
    expect((await appeler(s.a.chef, o.detail!)).statusCode).toBe(200);
    expect((await appeler(s.a.chef, o.page!)).statusCode).toBe(200);
    for (const nom of ["televerser", "lecture", "modifier", "decision"]) {
      const r = await appeler(s.a.chef, o[nom]!);
      expect([nom, r.statusCode, r.json().erreur?.code]).toEqual([nom, 409, "MISSION_CLOTUREE"]);
    }
    const associe = await appeler(s.a.associe, o.decision!);
    expect(associe.statusCode).toBe(409);
    expect(await objetsStockes(ctx, s.a.cabinetId)).toBe(avant);
    // Le brouillon est resté ouvert.
    const d = (await s.a.chef.get(`/api/dd/documents/${ferme.docId}`)).json();
    expect(d.extractions[0].statut).toBe("brouillon_ia");
  });
});

describe("portail client fermé", () => {
  it("un compte du portail (dirigeant, investisseur) : 403 sur toutes les routes", async () => {
    for (const u of [dirigeant, investisseur]) {
      expect(await statuts(u, ouvertes())).toEqual(tous(403, ouvertes()));
    }
  });

  it("la lecture d'un brouillon n'atteint jamais le portail investisseur", async () => {
    const r = await investisseur.get("/api/portail/due-diligence/publications");
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(MARQUEUR);
  });
});

describe("téléversement : paramètres, types, plafonds du socle", () => {
  it("type obligatoire et borné, paramètres inconnus refusés, formats hors périmètre refusés", async () => {
    const pdf = pdfRapport();
    const avant = await objetsStockes(ctx, s.a.cabinetId);
    const sans = await televerser(
      s.a.chef,
      `/api/dd/dossiers/${s.dossierId}/documents`,
      "x.pdf",
      pdf,
    );
    expect(sans.statusCode).toBe(400);
    for (const q of ["type=autre", "type=rapport&extra=1", "type=salle&type=rapport"]) {
      const r = await televerser(
        s.a.chef,
        `/api/dd/dossiers/${s.dossierId}/documents?${q}`,
        "x.pdf",
        pdf,
      );
      expect([q, r.statusCode]).toEqual([q, 400]);
    }
    for (const [nom, c] of [
      ["donnees.csv", ECHANTILLONS.csv()],
      ["note.txt", ECHANTILLONS.txt()],
      ["actif.pdf", ECHANTILLONS.pdfActif()],
      ["faux.pdf", ECHANTILLONS.exe()],
    ] as const) {
      const r = await televerserDd(s.a.chef, s.dossierId, "salle", nom, c);
      expect([nom, r.statusCode]).toEqual([nom, 415]);
    }
    expect(await objetsStockes(ctx, s.a.cabinetId)).toBe(avant);
    // Sans fichier : rien n'est créé (multipart vide ou corps non multipart).
    const brut = await s.a.chef.brut({
      method: "POST",
      url: urlDocuments(s.dossierId, "rapport"),
      payload: pdf,
      headers: { "content-type": "application/pdf" },
    });
    expect(brut.statusCode).toBe(415);
  });

  it("les plafonds du socle sont inchangés", () => {
    expect(PLAFONDS_INGESTION).toEqual({
      tailleOctetsPdf: 10 * 1024 * 1024,
      tailleOctetsXlsx: 2 * 1024 * 1024,
      pagesMax: 60,
      caracteresParPage: 25_000,
      caracteresParDocument: 400_000,
      dureeExtractionMs: 30_000,
      documentsEnTraitementParCabinet: 5,
      documentsParJourEtCabinet: 40,
      caracteresTransmisAuModele: 40_000,
    });
  });

  it("fichier trop volumineux : 413 (PDF au-delà de 10 Mo)", async () => {
    const avant = await objetsStockes(ctx, s.a.cabinetId);
    const gros = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(PLAFONDS_INGESTION.tailleOctetsPdf + 1024, 0x20),
    ]);
    const r = await televerserDd(s.a.chef, s.dossierId, "rapport", "gros.pdf", gros);
    expect([r.statusCode, r.json().erreur.code]).toEqual([413, "FICHIER_TROP_VOLUMINEUX"]);
    expect(await objetsStockes(ctx, s.a.cabinetId)).toBe(avant);
  });

  it("5 documents en traitement par cabinet au plus : le 6e est refusé (409 INGESTION_PLEIN)", async () => {
    // Cabinet B : sa propre mission et son propre dossier DD.
    const dossierB = await creerDossierDd(s.b.chef, s.missionB);
    const nb = PLAFONDS_INGESTION.documentsEnTraitementParCabinet;
    for (let i = 0; i < nb; i++) {
      attendre(
        202,
        await televerserDd(s.b.chef, dossierB.id, "rapport", `lot${i}.pdf`, pdfRapport()),
        `document ${i + 1}`,
      );
    }
    const sixieme = await televerserDd(
      s.b.chef,
      dossierB.id,
      "rapport",
      "sixieme.pdf",
      pdfRapport(),
    );
    expect(sixieme.statusCode).toBe(409);
    expect(sixieme.json().erreur.code).toBe("INGESTION_PLEIN");
    await executerJobs(ctx);
  });
});

describe("données ouvertes et réseau", () => {
  it("l'adaptateur de données ouvertes reste simulé, sans route ni import par l'ingestion", async () => {
    const espion = vi.spyOn(globalThis, "fetch");
    try {
      const points = await fournisseurSimule.rechercherIndicateur("ci", "pib");
      expect(fournisseurSimule.identifiant).toBe("simule");
      expect(points.length).toBeGreaterThan(0);
      expect(points.every((p) => p.simule === true)).toBe(true);
      expect(espion).not.toHaveBeenCalled();
    } finally {
      espion.mockRestore();
    }
    const fichiers = [
      ...readdirSync("src/ingestion").map((f) => `src/ingestion/${f}`),
      ...readdirSync("src/routes").map((f) => `src/routes/${f}`),
    ].filter((f) => f.endsWith(".ts"));
    for (const f of fichiers) {
      expect(readFileSync(f, "utf8"), f).not.toContain("donnees-ouvertes");
    }
    expect(readFileSync("src/due-diligence/donnees-ouvertes.ts", "utf8")).toContain(
      "AUCUN appel réseau",
    );
  });

  it("aucun appel réseau externe : le seul fournisseur joignable est le serveur factice local", async () => {
    repondreLignes(ctx, LIGNES_RAPPORT_OK);
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
      const { document } = await ingererDd(
        ctx,
        s.a.chef,
        s.dossierId,
        "rapport",
        "reseau.pdf",
        pdfRapport(),
      );
      expect(document.resultat).toBe("brouillon_cree");
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
