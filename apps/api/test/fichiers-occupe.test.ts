import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELAI_RECEPTION_REQUETE_MS } from "../src/app.js";
import {
  avecPlaceAnalyse,
  FICHIERS_ANALYSES_PAR_CABINET_MAX,
  FICHIERS_ANALYSES_SIMULTANEES_MAX,
} from "../src/routes/fichiers.js";
import { api } from "./api.js";
import {
  demarrerAvecStockage,
  ECHANTILLONS,
  marquerOrphelins,
  televerser,
} from "./fichiers-outils.js";
import { connecter, creerCabinet, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Garde d'analyse des fichiers (HANDOFF n° 7) : même principe que l'import Excel des
 * temps (`lireClasseurTemps`), au plus FICHIERS_ANALYSES_SIMULTANEES_MAX analyses
 * simultanées par instance et FICHIERS_ANALYSES_PAR_CABINET_MAX par cabinet, au-delà 503
 * `FICHIERS_OCCUPE`. La place ne couvre que l'analyse du fichier REÇU, jamais la lecture du
 * corps (un téléversement lent ne la bloque pas), et la réception d'une requête a un délai.
 * La garde de taille (413) est testée dans fichiers.test.ts.
 */

let ctx: Contexte & { dossier: string };
let a: CabinetMissions;
let b: CabinetMissions;
const autresCabinets: string[] = [];

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerCabinet(ctx, "Cabinet Fichiers Occupé A");
  b = await preparerCabinet(ctx, "Cabinet Fichiers Occupé B");
});
afterAll(async () => {
  await marquerOrphelins([a.cabinetId, b.cabinetId, ...autresCabinets]);
  await ctx.fermer();
});

/** Occupe une place par cabinet de `cabinets` (répétés au besoin) jusqu'à l'appel de `liberer()`. */
function occuper(cabinets: string[]) {
  let liberer!: () => void;
  const porte = new Promise<void>((resolve) => (liberer = resolve));
  const prises = cabinets.map((c) => avecPlaceAnalyse(c, () => porte));
  return { liberer, attendreFin: () => Promise.all(prises) };
}

const televerserPdf = (cabinet: CabinetMissions, nom: string) =>
  televerser(cabinet.chef, "/api/fichiers", `${nom}.pdf`, ECHANTILLONS.pdf(nom));

describe("sémaphore d'analyse des fichiers", () => {
  it("au-delà du maximum de l'instance, 503 FICHIERS_OCCUPE ; les places libérées servent de nouveau", async () => {
    const occupation = occuper(
      Array.from({ length: FICHIERS_ANALYSES_SIMULTANEES_MAX }, (_, i) => `cabinet-fictif-${i}`),
    );
    const refus = await televerserPdf(a, "occupe");
    expect(refus.statusCode).toBe(503);
    expect(refus.json().erreur.code).toBe("FICHIERS_OCCUPE");
    // Le helper refuse aussi directement, sans exécuter le travail.
    let execute = false;
    await expect(
      avecPlaceAnalyse(a.cabinetId, async () => {
        execute = true;
      }),
    ).rejects.toMatchObject({ statut: 503, code: "FICHIERS_OCCUPE" });
    expect(execute).toBe(false);

    occupation.liberer();
    await occupation.attendreFin();
    const ok = await televerserPdf(a, "libre");
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("plafond par cabinet : un cabinet qui occupe ses places n'en prive pas un autre", async () => {
    const occupation = occuper(Array(FICHIERS_ANALYSES_PAR_CABINET_MAX).fill(a.cabinetId));
    // Le cabinet A est au plafond (503), pas B, et pas à cause du maximum de l'instance.
    expect(FICHIERS_ANALYSES_PAR_CABINET_MAX).toBeLessThan(FICHIERS_ANALYSES_SIMULTANEES_MAX);
    const refus = await televerserPdf(a, "cabinet-plein");
    expect(refus.statusCode).toBe(503);
    expect(refus.json().erreur.code).toBe("FICHIERS_OCCUPE");
    expect(refus.json().erreur.message).toContain("cabinet");
    const autre = await televerserPdf(b, "autre-cabinet");
    expect(autre.statusCode, autre.body).toBe(201);

    occupation.liberer();
    await occupation.attendreFin();
    const ok = await televerserPdf(a, "cabinet-libere");
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("une place est rendue même si le travail échoue (aucune fuite des compteurs)", async () => {
    for (let i = 0; i < FICHIERS_ANALYSES_SIMULTANEES_MAX * 3; i++) {
      await expect(
        avecPlaceAnalyse(a.cabinetId, async () => {
          throw new Error("échec");
        }),
      ).rejects.toThrow("échec");
    }
    const ok = await televerserPdf(a, "apres-echec");
    expect(ok.statusCode, ok.body).toBe(201);
  });
});

describe("lecture lente du corps", () => {
  it("des téléversements au point mort (corps jamais terminé) ne prennent aucune place", async () => {
    // Cabinet dédié : les envois bloqués ne gênent aucune autre suite.
    const c = await creerCabinet(ctx, "Cabinet Fichiers Lents");
    autresCabinets.push(c.cabinetId);
    const cookie = await connecter(ctx, c.email);
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const adresse = ctx.app.server.address();
    const port = typeof adresse === "object" && adresse ? adresse.port : 0;

    // Plus d'envois bloqués que de places par cabinet ET que de places dans l'instance.
    const nombre = FICHIERS_ANALYSES_SIMULTANEES_MAX + 2;
    const frontiere = "----lent";
    const entete =
      `--${frontiere}\r\nContent-Disposition: form-data; name="fichier"; filename="lent.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n%PDF-1.4\n`;
    const sockets = Array.from({ length: nombre }, () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("error", () => undefined);
      socket.write(
        `POST /api/fichiers HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: ${cookie}\r\n` +
          `Content-Type: multipart/form-data; boundary=${frontiere}\r\n` +
          `Content-Length: 5000\r\n\r\n${entete}`,
      );
      return socket;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const ok = await televerser(
        api(ctx, cookie),
        "/api/fichiers",
        "rapide.pdf",
        ECHANTILLONS.pdf("rapide"),
      );
      expect(ok.statusCode, ok.body).toBe(201);
    } finally {
      for (const socket of sockets) socket.destroy();
    }
  });

  it("la réception d'une requête entière a un délai (Fastify le désactive par défaut)", () => {
    expect(DELAI_RECEPTION_REQUETE_MS).toBeGreaterThanOrEqual(60_000);
    expect(ctx.app.server.requestTimeout).toBe(DELAI_RECEPTION_REQUETE_MS);
  });
});
