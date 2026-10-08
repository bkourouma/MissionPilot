import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cheminNavigateur,
  htmlEnPdf,
  PREFIXE_PROFIL,
  RENDUS_PDF_SIMULTANES,
  rendusPdfEnCours,
} from "../src/rapports/pdf.js";
import { rendreRapport } from "../src/rapports/rendu.js";
import { detecterType } from "../src/stockage/detection.js";
import { configTest } from "./helpers.js";
import { INJECTION, rapportExemple } from "./rapports-outils.js";

/*
 * Rendu PDF RÉEL par le Chrome/Chromium local (CHROMIUM_PATH, ou Chrome
 * installé sous Windows). Sans navigateur, ces tests sont SAUTÉS : la raison
 * figure dans leur titre. Les bornes de simultanéité sont testées sans
 * navigateur (la réservation est synchrone, avant tout lancement).
 */
const navigateur = cheminNavigateur(configTest());
const raison = navigateur ? "" : " (SAUTÉ : aucun navigateur, définir CHROMIUM_PATH)";
const avecNavigateur = describe.skipIf(!navigateur);
const ABSENT = path.join(os.tmpdir(), "missionpilot-navigateur-absent", "chrome.exe");

/** Marqueurs de structure d'un PDF (non compressés chez Chromium/Skia). */
function structure(pdf: Buffer) {
  const t = pdf.toString("latin1");
  return {
    entete: t.startsWith("%PDF-"),
    pages: Number(/\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(t)?.[1] ?? 0),
    a4: /\/MediaBox \[0 0 595\.9\d* 841\.9\d*\]/.test(t),
    actif: /\/(JavaScript|JS|Launch|EmbeddedFiles?)\b/.test(t),
  };
}

let serveur: Server;
let port = 0;
const appels: string[] = [];
let dossier: string;
/** Dossier parent des profils jetables du navigateur : doit rester vide après chaque rendu. */
let profils: string;

const profilsRestants = async () =>
  (await readdir(profils)).filter((n) => n.startsWith(PREFIXE_PROFIL));

beforeAll(async () => {
  serveur = createServer((req, res) => {
    appels.push(req.url ?? "");
    res.end("x");
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  port = (serveur.address() as AddressInfo).port;
  dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-rapports-"));
  profils = await mkdtemp(path.join(os.tmpdir(), "missionpilot-profils-"));
});
afterAll(async () => {
  await new Promise((ok) => serveur.close(ok));
  await rm(dossier, { recursive: true, force: true });
  await rm(profils, { recursive: true, force: true });
});

describe("rendus simultanés bornés (non-régression : global ET par cabinet)", () => {
  /** Rendu vers un navigateur absent ; l'erreur est captée tout de suite (aucun rejet orphelin). */
  const rendu = (cabinetId: string) =>
    htmlEnPdf("<p>x</p>", { cheminNavigateur: ABSENT, cabinetId }).then(
      () => null,
      (e: unknown) => e,
    );

  it(`au plus ${RENDUS_PDF_SIMULTANES} rendus en tout : le suivant répond 503 RENDU_OCCUPE`, async () => {
    // Appels synchrones : les deux premiers réservent leur place avant toute attente.
    const p1 = rendu("cabinet-1");
    const p2 = rendu("cabinet-2");
    const p3 = rendu("cabinet-3");
    expect(rendusPdfEnCours()).toBe(2);
    expect(await p3).toMatchObject({ statut: 503, code: "RENDU_OCCUPE" });
    // Navigateur introuvable : les deux premiers échouent, puis rendent leur place.
    expect(await p1).toMatchObject({ statut: 503, code: "RENDU_PDF_INDISPONIBLE" });
    expect(await p2).toMatchObject({ statut: 503, code: "RENDU_PDF_INDISPONIBLE" });
    expect(rendusPdfEnCours()).toBe(0);
    expect(await rendu("cabinet-3")).toMatchObject({ code: "RENDU_PDF_INDISPONIBLE" });
  });

  it("au plus un rendu simultané par cabinet ; les autres cabinets passent", async () => {
    const p1 = rendu("cabinet-a");
    const p2 = rendu("cabinet-a");
    const p3 = rendu("cabinet-b");
    expect(rendusPdfEnCours("cabinet-a")).toBe(1);
    expect(await p2).toMatchObject({ statut: 503, code: "RENDU_OCCUPE" });
    expect(await p1).toMatchObject({ code: "RENDU_PDF_INDISPONIBLE" });
    expect(await p3).toMatchObject({ code: "RENDU_PDF_INDISPONIBLE" });
    expect(rendusPdfEnCours("cabinet-a")).toBe(0);
    expect(rendusPdfEnCours()).toBe(0);
  });
});

avecNavigateur(`PDF réel (Chromium)${raison}`, () => {
  it("A4, plusieurs pages, sans contenu actif, accepté par la détection du stockage", async () => {
    const { contenu } = await rendreRapport(
      rapportExemple({ titre: `Titre ${INJECTION}` }),
      "pdf",
      { cheminNavigateur: navigateur, cabinetId: null },
    );
    const s = structure(contenu);
    expect(s.entete).toBe(true);
    expect(s.a4).toBe(true);
    expect(s.pages).toBeGreaterThanOrEqual(1);
    expect(s.actif).toBe(false);
    expect(detecterType(contenu, "pdf").type).toBe("application/pdf");
  });

  it("aucune requête sortante : réseau, file:// et scripts bloqués", async () => {
    const secret = path.join(dossier, "secret.txt");
    await writeFile(secret, "SECRET");
    const fichier = pathToFileURL(secret).href;
    const base = `http://127.0.0.1:${port}`;
    // HTML NON échappé, volontairement hostile : vérifie les barrières du navigateur seules.
    const hostile = `<!doctype html><html><head>
      <link rel="stylesheet" href="${base}/css">
      <style>@import url("${base}/import"); body { background: url("${base}/fond"); }</style>
      <script>fetch("${base}/script"); document.write('<img src="${base}/ecrit">');</script>
      </head><body><img src="${base}/img"><iframe src="${fichier}"></iframe>
      <iframe src="${base}/cadre"></iframe><object data="${fichier}"></object>
      <img src="${fichier}"><a href="${base}/lien">lien</a></body></html>`;
    // (Une redirection <meta refresh> n est pas testée : le contenu réel est échappé, html.ts.)
    const journal: { url: string; issue: string }[] = [];
    const pdf = await htmlEnPdf(hostile, {
      cheminNavigateur: navigateur as string,
      cabinetId: null,
      journal: (e) => journal.push(e),
    });
    expect(structure(pdf).entete).toBe(true);
    expect(appels).toEqual([]);
    // Rien n'a été servi hors du document ; ce que le navigateur a tenté a été refusé.
    // Seules exceptions : images data: internes de la page d erreur de Chromium (cadre refusé).
    const servies = journal.filter((e) => e.issue === "terminee" && !e.url.startsWith("data:"));
    expect(servies).toEqual([]);
    expect(journal.some((e) => /^(file|https?):/.test(e.url) && e.issue === "terminee")).toBe(
      false,
    );
    expect(journal.some((e) => e.url.includes("/script") || e.url.includes("/ecrit"))).toBe(false);
  });

  it("profil jetable : supprimé après un rendu réussi, place rendue", async () => {
    const pdf = await htmlEnPdf("<p>x</p>", {
      cheminNavigateur: navigateur as string,
      cabinetId: "cabinet-profil",
      dossierTemporaire: profils,
    });
    expect(structure(pdf).entete).toBe(true);
    expect(await profilsRestants()).toEqual([]);
    expect(rendusPdfEnCours()).toBe(0);
  });

  it("délai maximal : 504, navigateur fermé, aucun profil résiduel, place rendue", async () => {
    for (const delaiMs of [5, 300]) {
      const erreur = await htmlEnPdf("<p>x</p>", {
        cheminNavigateur: navigateur as string,
        cabinetId: "cabinet-delai",
        delaiMs,
        dossierTemporaire: profils,
      }).catch((e) => e);
      expect(erreur, `délai ${delaiMs} ms`).toMatchObject({ statut: 504, code: "RENDU_TROP_LONG" });
      expect(await profilsRestants(), `délai ${delaiMs} ms`).toEqual([]);
      expect(rendusPdfEnCours("cabinet-delai")).toBe(0);
      expect(rendusPdfEnCours()).toBe(0);
    }
  });
});

describe("PDF : présence du navigateur", () => {
  it(`navigateur détecté ou saut annoncé${raison}`, () => {
    expect(typeof navigateur === "string" || raison.length > 0).toBe(true);
  });
});
