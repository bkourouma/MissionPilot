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
 * Inventaire AUTOMATIQUE (sans liste d'exceptions) : toute colonne qui a une clé étrangère vers
 * `fichiers` est citée dans la dernière définition de `fichier_orphelin` ; sinon la purge à 24 h
 * effacerait un fichier encore cité. Un fichier cité par une pièce justificative d'appel d'offres
 * non retirée ou par un dépôt de la salle de mission est traité comme rattaché (404 sur
 * GET /api/fichiers/:id, route dédiée seule).
 *
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

describe("inventaire des références vers fichiers", () => {
  it("toute colonne à clé étrangère vers fichiers figure dans fichier_orphelin", async () => {
    const { colonnes, definition } = await proprietaire(async (c) => ({
      colonnes: (
        await c.query(
          `SELECT DISTINCT cl.relname AS table_nom, at.attname AS colonne
           FROM pg_constraint k
           JOIN pg_class cl ON cl.oid = k.conrelid
           JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
           JOIN LATERAL unnest(k.conkey) AS u(num) ON true
           JOIN pg_attribute at ON at.attrelid = k.conrelid AND at.attnum = u.num
           WHERE k.contype = 'f' AND k.confrelid = 'public.fichiers'::regclass
             AND at.attname <> 'cabinet_id'`,
        )
      ).rows as { table_nom: string; colonne: string }[],
      definition: (
        await c.query("SELECT pg_get_functiondef('fichier_orphelin(uuid)'::regprocedure) AS d")
      ).rows[0].d as string,
    }));
    // Au moins les références connues : l'inventaire n'est pas vide par erreur.
    expect(colonnes.length).toBeGreaterThanOrEqual(8);
    const absentes = colonnes.filter(({ table_nom: table, colonne }) => {
      // « FROM <table> <alias> … <alias>.<colonne> » dans la définition.
      const re = new RegExp(
        String.raw`(?:FROM|JOIN)\s+(?:public\.)?${table}\s+(\w+)[\s\S]*?\b\1\.${colonne}\b`,
      );
      return !re.test(definition);
    });
    expect(absentes, "colonnes vers fichiers absentes de fichier_orphelin").toEqual([]);
  });

  it("fichier cité par une pièce d'appel d'offres non retirée : non orphelin et 404 générique ; retiré : de nouveau lisible par son auteur", async () => {
    const id = await deposer("attestation-ao");
    expect(await orphelin(id)).toBe(true);
    expect((await a.chef.get(`/api/fichiers/${id}`)).statusCode).toBe(200);
    const attestation = await proprietaire(async (c) => {
      const ref = await c.query(
        "INSERT INTO ao_references (cabinet_id, cree_par) VALUES ($1, $2) RETURNING id",
        [a.cabinetId, a.chef.utilisateurId],
      );
      const r = await c.query(
        `INSERT INTO ao_attestations (cabinet_id, reference_id, fichier_id, type, date_attestation,
           emetteur, cree_par)
         VALUES ($1, $2, $3, 'autre', '2026-01-15', 'Bailleur de test', $4) RETURNING id`,
        [a.cabinetId, ref.rows[0].id, id, a.chef.utilisateurId],
      );
      return r.rows[0].id as string;
    });
    expect(await orphelin(id)).toBe(false);
    expect((await a.chef.get(`/api/fichiers/${id}`)).statusCode).toBe(404);
    await proprietaire((c) =>
      c.query(
        `UPDATE ao_attestations SET retiree_le = now(), retiree_par = $2, motif_retrait = 'Erreur'
         WHERE id = $1`,
        [attestation, a.chef.utilisateurId],
      ),
    );
    expect(await orphelin(id)).toBe(true);
    expect((await a.chef.get(`/api/fichiers/${id}`)).statusCode).toBe(200);
  });
});
