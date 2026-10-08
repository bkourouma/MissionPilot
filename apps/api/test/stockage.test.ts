import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detecterType, entreesZip } from "../src/stockage/detection.js";
import { StockageDisque } from "../src/stockage/disque.js";
import { assainirNom, contentDisposition, extensionDe } from "../src/stockage/nom.js";
import { FichierAbsent } from "../src/stockage/stockage.js";
import { ECHANTILLONS, zip } from "./fichiers-outils.js";

const CABINET = "0b0c0d0e-0000-4000-8000-000000000001";

describe("détection du type par le contenu (signatures)", () => {
  it("liste blanche reconnue par signature", () => {
    expect(detecterType(ECHANTILLONS.pdf(), "pdf").type).toBe("application/pdf");
    expect(detecterType(ECHANTILLONS.png(), "png").type).toBe("image/png");
    expect(detecterType(ECHANTILLONS.jpeg(), "jpg").type).toBe("image/jpeg");
    expect(detecterType(ECHANTILLONS.jpeg(), "jpeg").type).toBe("image/jpeg");
    expect(detecterType(ECHANTILLONS.webp(), "webp").type).toBe("image/webp");
    expect(detecterType(ECHANTILLONS.docx(), "docx").type).toMatch(/wordprocessingml/);
    expect(detecterType(ECHANTILLONS.xlsx(), "xlsx").type).toMatch(/spreadsheetml/);
    expect(detecterType(ECHANTILLONS.pptx(), "pptx").type).toMatch(/presentationml/);
    expect(detecterType(ECHANTILLONS.csv(), "csv").type).toBe("text/csv");
    expect(detecterType(ECHANTILLONS.txt(), "txt").type).toBe("text/plain");
    // Sans extension : l'extension principale du type détecté est retenue.
    expect(detecterType(ECHANTILLONS.pdf(), "")).toEqual({
      type: "application/pdf",
      extension: "pdf",
    });
  });

  it("exécutable renommé en PDF, archive, macros, balisage, PDF actif : refusés (415)", () => {
    const refus = (contenu: Buffer, ext: string) => {
      try {
        detecterType(contenu, ext);
        return null;
      } catch (error) {
        return (error as { statut?: number; code?: string }).code;
      }
    };
    expect(refus(ECHANTILLONS.exe(), "pdf")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(ECHANTILLONS.elf(), "txt")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(ECHANTILLONS.archive(), "zip")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(ECHANTILLONS.archive(), "docx")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(ECHANTILLONS.docm(), "docx")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(ECHANTILLONS.svg(), "txt")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(ECHANTILLONS.html(), "txt")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(ECHANTILLONS.pdfActif(), "pdf")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(Buffer.from("#!/bin/sh\nrm -rf /\n"), "txt")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(Buffer.from([0x00, 0x01, 0x02]), "txt")).toBe("TYPE_FICHIER_REFUSE");
    // Extension qui ne correspond pas au contenu (PDF nommé .png ; texte nommé .md).
    expect(refus(ECHANTILLONS.pdf(), "png")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(ECHANTILLONS.txt(), "md")).toBe("TYPE_FICHIER_REFUSE");
    expect(refus(Buffer.alloc(0), "pdf")).toBe("FICHIER_VIDE");
    // Noms PDF échappés (#xx) : décodés avant la recherche.
    expect(refus(Buffer.from("%PDF-1.4\n<< /J#61vaScript (x) >>"), "pdf")).toBe(
      "TYPE_FICHIER_REFUSE",
    );
  });

  it("répertoire central ZIP lu sans décompresser ; archive tronquée illisible", () => {
    expect(entreesZip(zip({ "a.txt": "x", "b/c.xml": "y" }))).toEqual(["a.txt", "b/c.xml"]);
    expect(entreesZip(Buffer.from("PK\u0003\u0004 tronqué"))).toBeNull();
  });
});

describe("noms de fichiers", () => {
  it("assainis : ni chemin ni remontée, ni contrôle ni bidi, longueur bornée", () => {
    expect(assainirNom("../../etc/passwd")).toBe("passwd");
    expect(assainirNom("..\\..\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
    expect(assainirNom("rapport\u0000\u202e fdp.pdf")).toBe("rapport fdp.pdf");
    expect(assainirNom('a<b>:"c|d?*.txt')).toBe("a_b___c_d__.txt");
    expect(assainirNom("...")).toBe("fichier");
    expect(assainirNom("")).toBe("fichier");
    const long = assainirNom(`${"x".repeat(300)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(150);
    expect(long.endsWith(".pdf")).toBe(true);
    expect(extensionDe("Rapport.Final.PDF")).toBe("pdf");
    expect(extensionDe(".bashrc")).toBe("");
  });

  it("Content-Disposition : repli ASCII sans guillemet, forme UTF-8 encodée", () => {
    const h = contentDisposition('Note "été"; x.pdf', "attachment");
    expect(h).toBe(
      `attachment; filename="Note _ete__ x.pdf"; filename*=UTF-8''Note%20%22%C3%A9t%C3%A9%22%3B%20x.pdf`,
    );
    expect(contentDisposition("a.png", "inline").startsWith("inline;")).toBe(true);
  });
});

describe("stockage sur disque", () => {
  let racine: string;
  beforeAll(async () => {
    racine = await mkdtemp(path.join(os.tmpdir(), "missionpilot-d1-disque-"));
  });
  afterAll(() => rm(racine, { recursive: true, force: true }));

  it("clé aléatoire générée, rangée par cabinet, relue puis effacée", async () => {
    const s = new StockageDisque(racine);
    const cle = await s.ecrire(CABINET, Buffer.from("contenu"));
    expect(cle).toMatch(/^[0-9a-f]{32}$/);
    expect(await s.ecrire(CABINET, Buffer.from("contenu"))).not.toBe(cle);
    expect(await readdir(racine)).toEqual([CABINET]);
    const morceaux: Buffer[] = [];
    for await (const m of await s.lire(CABINET, cle)) morceaux.push(m as Buffer);
    expect(Buffer.concat(morceaux).toString()).toBe("contenu");
    expect(await readFile(path.join(racine, CABINET, cle.slice(0, 2), cle), "utf8")).toBe(
      "contenu",
    );
    await s.supprimer(CABINET, cle);
    await expect(s.lire(CABINET, cle)).rejects.toBeInstanceOf(FichierAbsent);
    await s.supprimer(CABINET, cle); // déjà absent : sans erreur
  });

  it("refuse toute clé ou tout cabinet qui ne sont pas des identifiants (pas de chemin libre)", async () => {
    const s = new StockageDisque(racine);
    await expect(s.lire(CABINET, "../../etc/passwd")).rejects.toThrow(/Clé de stockage invalide/);
    await expect(s.lire("../autre", "0".repeat(32))).rejects.toThrow(/cabinet invalide/);
    await expect(s.supprimer(CABINET, `${"a".repeat(31)}/`)).rejects.toThrow(/invalide/);
  });
});
