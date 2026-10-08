import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerHandlerPurgeFichiers, DELAI_ORPHELIN_MS } from "../src/stockage/purge.js";
import { stockageDe } from "../src/stockage/index.js";
import {
  demarrerAvecStockage,
  ECHANTILLONS,
  marquerOrphelins,
  televerser,
} from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import { creerPreuve, PREUVE_DOCUMENT } from "./preuves-outils.js";

/*
 * `fichier_orphelin` (migration 0268) connaît les références de fichiers posées après 0130 :
 * une version de preuve (0240), un fait (0220) ou un facteur (0221) du dossier client. Un
 * fichier cité seulement par l'une d'elles n'est ni orphelin ni purgé à 24 h ; un fichier non
 * cité l'est et l'est resté.
 */

let ctx: Contexte & { dossier: string };
let a: CabinetMissions;
let missionId: string;

const orphelin = (id: string) =>
  proprietaire(
    async (c) => (await c.query("SELECT fichier_orphelin($1) AS o", [id])).rows[0].o as boolean,
  );

async function deposer(nom: string): Promise<string> {
  const r = await televerser(a.chef, "/api/fichiers", `${nom}.pdf`, ECHANTILLONS.pdf(nom));
  attendre(201, r, "téléversement");
  return r.json().id as string;
}

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerCabinet(ctx, "Cabinet Orphelins Références");
  missionId = (await creerMission(a)).id;
}, 120_000);
afterAll(async () => {
  await marquerOrphelins([a.cabinetId]);
  await ctx.fermer();
});

describe("fichier_orphelin et références du schéma V3", () => {
  it("fichier non cité : orphelin ; cité par une preuve, un fait ou un facteur : jamais", async () => {
    const libre = await deposer("libre");
    const parPreuve = await deposer("preuve");
    const parFait = await deposer("fait");
    const parFacteur = await deposer("facteur");
    for (const id of [libre, parPreuve, parFait, parFacteur]) expect(await orphelin(id)).toBe(true);

    await creerPreuve(a.chef, missionId, { ...PREUVE_DOCUMENT, fichier_id: parPreuve });
    const source = (id: string) => ({ type: "document", libelle: "Statuts", document_id: id });
    attendre(
      201,
      await a.chef.post(`/api/dossiers/${a.clientId}/faits`, {
        categorie: "organisation",
        cle: "effectif",
        valeur: { type: "nombre", nombre: 42 },
        date_effet: "2026-01-01",
        source: source(parFait),
        fiabilite: "B",
      }),
      "fait",
    );
    attendre(
      201,
      await a.chef.post(`/api/dossiers/${a.clientId}/facteurs`, {
        code: "effectif",
        type: "nombre",
        valeur: 42,
        date_effet: "2026-01-01",
        source: source(parFacteur),
        fiabilite: "B",
      }),
      "facteur",
    );

    expect(await orphelin(libre)).toBe(true);
    expect(await orphelin(parPreuve)).toBe(false);
    expect(await orphelin(parFait)).toBe(false);
    expect(await orphelin(parFacteur)).toBe(false);
  });

  it("la purge à 24 h efface le fichier non cité et épargne les fichiers cités", async () => {
    const libre = await deposer("purge-libre");
    const cite = await deposer("purge-cite");
    await creerPreuve(a.chef, missionId, { ...PREUVE_DOCUMENT, fichier_id: cite });

    const plusTard = new Date(Date.now() + DELAI_ORPHELIN_MS + 3600_000);
    await ctx.db.withTenant(a.cabinetId, (db) =>
      creerHandlerPurgeFichiers(() => stockageDe(ctx.config))({
        db,
        cabinetId: a.cabinetId,
        jobId: "test",
        charge: {},
        maintenant: plusTard,
      }),
    );

    expect((await a.chef.get(`/api/fichiers/${libre}`)).statusCode).toBe(404);
    expect((await a.chef.get(`/api/fichiers/${cite}`)).statusCode).toBe(200);
  });
});
