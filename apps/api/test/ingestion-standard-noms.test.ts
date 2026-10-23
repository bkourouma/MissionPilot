/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BORNES_NOMS_INGESTION, termesNomsPropres } from "../src/copilote/noms-propres.js";
import { cabinetTest, type Api, type CabinetTest } from "./api.js";
import { televerser } from "./fichiers-outils.js";
import {
  activerIa,
  demarrerIngestion,
  executerJobs,
  fabriquerPdf,
  reponseLignes,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Masquage des noms sur TOUT le texte d'un document historique (amorçage du standard) : la présélection des
 * noms du cabinet ne s'arrête pas aux 200 premiers mots (copilote), elle porte sur des tranches de 200 mots,
 * 40 au plus (`BORNES_NOMS_INGESTION`). Serveur OpenRouter FACTICE, vraie base sous RLS.
 */

let ctx: ContexteIngestion;
let a: CabinetTest;
let expert: Api & { utilisateurId: string };
let serviceId: string;

const CLIENT = "Zorbaland Holding";

beforeAll(async () => {
  ctx = await demarrerIngestion();
  a = await cabinetTest(ctx, "Noms longs A");
  ctx.cabinets.push(a.cabinetId);
  expert = await a.avecRoles(["expert_metier"]);
  await activerIa(a.associe);
  attendre(201, await a.associe.post("/api/clients", { raison_sociale: CLIENT }), "client");
  const services = (await expert.get("/api/standard/services")).json();
  serviceId = (Array.isArray(services) ? services : services.elements)[0].id;
}, 240_000);
afterAll(async () => {
  await ctx?.fermer();
});

/** `n` lignes de dix mots tous distincts (« fil00001 »…), donc n × 10 mots avant la ligne suivante. */
const remplissage = (n: number): string[] =>
  Array.from({ length: n }, (_, i) =>
    Array.from({ length: 10 }, (_, j) => `fil${String(i * 10 + j).padStart(5, "0")}`).join(" "),
  );

describe("noms propres situés au-delà des 200 premiers mots", () => {
  it("le nom d'un client après le 300e mot est masqué à l'envoi et la ligne qui le recopie est écartée", async () => {
    const lignesPage = [
      "Proposition de mission",
      ...remplissage(40),
      `Client concerné : ${CLIENT}, phase de diagnostic`,
    ];
    const compteurMots = lignesPage.join(" ").split(/\s+/);
    expect(compteurMots.indexOf("Zorbaland")).toBeGreaterThan(300);

    const methode = await expert.post("/api/methodes", {
      service_id: serviceId,
      code: `noms_longs_${Date.now()}`,
      libelle: "Méthode noms longs",
    });
    attendre(201, methode, "méthode");
    const versionId = methode.json().version_id as string;

    const avant = ctx.serveur.requetes.length;
    ctx.serveur.repondre(() =>
      reponseLignes([
        "etape | diagnostic | Diagnostic initial | 1",
        "etape | clair | Revue zorbaland holding | 1",
        "etape | plan | Plan d'action | 1",
      ]),
    );
    const r = await televerser(
      expert,
      `/api/methodes/versions/${versionId}/amorcage/documents`,
      "historique-long.pdf",
      fabriquerPdf({ pages: [lignesPage] }),
    );
    attendre(202, r, "téléversement");
    await executerJobs(ctx);

    const requete = ctx.serveur.requetes[avant];
    expect(requete).toBeDefined();
    const envoye = JSON.stringify(requete?.corps);
    // Le texte long est bien parti (mots de remplissage), sans le nom du client.
    expect(envoye).toContain("fil00399");
    expect(envoye).not.toMatch(/zorbaland/i);
    expect(envoye).toMatch(/\[ORGANISATION_\d+\]/);

    const detail = (await expert.get(`/api/amorcage/documents/${r.json().id}`)).json();
    expect(detail).toMatchObject({ statut: "termine", resultat: "brouillon_cree" });
    expect(detail.extractions[0].contenu.etapes.map((e: any) => e.code)).toEqual([
      "diagnostic",
      "plan",
    ]);
    expect(JSON.stringify(detail)).not.toMatch(/zorbaland/i);
  });

  it("le copilote garde sa borne de 200 mots ; l'ingestion lit toutes les tranches (40 au plus)", async () => {
    const message = `${remplissage(40).join(" ")} client ${CLIENT}`;
    const copilote = await ctx.db.withTenant(a.cabinetId, (db) =>
      termesNomsPropres(db, a.cabinetId, message),
    );
    expect(copilote.termes).toEqual([]);
    const ingestion = await ctx.db.withTenant(a.cabinetId, (db) =>
      termesNomsPropres(db, a.cabinetId, message, BORNES_NOMS_INGESTION),
    );
    expect(ingestion.termes.map((t) => (typeof t === "string" ? t : t.valeur))).toEqual([CLIENT]);
    // Au-delà de 40 tranches (8 000 mots distincts), le nom n'est plus présélectionné : borne documentée.
    const trop = `${remplissage(850).join(" ")} client ${CLIENT}`;
    expect(
      (
        await ctx.db.withTenant(a.cabinetId, (db) =>
          termesNomsPropres(db, a.cabinetId, trop, BORNES_NOMS_INGESTION),
        )
      ).termes,
    ).toEqual([]);
  });
});
