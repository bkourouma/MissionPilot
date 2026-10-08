import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerHandlerPurgeFichiers, DELAI_ORPHELIN_MS } from "../src/stockage/purge.js";
import { stockageDe } from "../src/stockage/index.js";
import { api, type Api } from "./api.js";
import {
  creerReference,
  INCONNU,
  preparerBanqueAo,
  REFERENCE,
  type ScenarioBanqueAo,
} from "./banque-ao-outils.js";
import {
  demarrerAvecStockage,
  ECHANTILLONS,
  marquerOrphelins,
  televerser,
} from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Banque de références et d'attestations (AO-05, lot AO-B) : versions en ajout seul, recherche
 * par secteur, pays, bailleur et montant dans une devise, pièces rattachées depuis le stockage
 * (fichier_orphelin, 0384), téléchargement revérifié, retrait motivé ; droits et isolation.
 */

let ctx: Contexte & { dossier: string };
let s: ScenarioBanqueAo;

const orphelin = (id: string) =>
  proprietaire(
    async (c) => (await c.query("SELECT fichier_orphelin($1) AS o", [id])).rows[0].o as boolean,
  );

async function deposer(par: Api = s.consultant, nom = "attestation"): Promise<string> {
  const r = await televerser(par, "/api/fichiers", `${nom}.pdf`, ECHANTILLONS.pdf(nom));
  attendre(201, r, "téléversement");
  return r.json().id as string;
}

const PIECE = {
  type: "attestation_bonne_execution",
  date_attestation: "2023-07-15",
  emetteur: "Ministère des Finances",
};

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerBanqueAo(ctx, "Banque Références");
}, 180_000);
afterAll(async () => {
  await marquerOrphelins([s.a.cabinetId, s.b.cabinetId]);
  await ctx.fermer();
});

describe("droits et validation", () => {
  it("401, 403, 400", async () => {
    expect((await api(ctx).get("/api/banque-ao/references")).statusCode).toBe(401);
    expect((await s.ressources.get("/api/banque-ao/references")).statusCode).toBe(403);
    expect((await s.expert.post("/api/banque-ao/references", REFERENCE)).statusCode).toBe(403);
    const post = (c: Record<string, unknown>) =>
      s.consultant.post("/api/banque-ao/references", { ...REFERENCE, ...c });
    expect((await post({ devise: "GBP" })).statusCode).toBe(400);
    expect((await post({ montant: 12.5 })).statusCode).toBe(400);
    expect((await post({ date_fin: "2021-01-01" })).statusCode).toBe(400);
    expect((await post({ pays: "CIV" })).statusCode).toBe(400);
    // Filtre de montant sans devise : refusé (aucun change implicite).
    expect((await s.consultant.get("/api/banque-ao/references?montant_min=1")).statusCode).toBe(
      400,
    );
  });
});

describe("références versionnées et recherche", () => {
  it("crée, corrige par version motivée, conserve l'historique", async () => {
    const ref = await creerReference(s.consultant);
    expect(ref.courante).toMatchObject({ version: 1, montant: 150_000_000, devise: "XOF" });
    const url = `/api/banque-ao/references/${ref.id}/versions`;
    expect((await s.consultant.post(url, { contenu: REFERENCE })).statusCode).toBe(400);
    const r = await s.consultant.post(url, {
      contenu: { ...REFERENCE, montant: 160_000_000 },
      motif: "Avenant n° 1",
    });
    attendre(201, r, "version");
    expect(r.json().courante).toMatchObject({ version: 2, montant: 160_000_000 });
    expect(r.json().versions).toHaveLength(2);
  });

  it("recherche par secteur, pays, bailleur, montant dans une devise", async () => {
    const bf = await creerReference(s.consultant, {
      titre: "Étude sectorielle énergie",
      pays: "BF",
      secteurs: ["Énergie"],
      bailleur: "Union européenne",
      montant: 80_000_00,
      devise: "EUR",
    });
    const ids = async (q: string) =>
      (await s.expert.get(`/api/banque-ao/references?${q}`))
        .json()
        .elements.map((e: { id: string }) => e.id) as string[];
    expect(await ids("pays=BF")).toEqual([bf.id]);
    expect(await ids(`secteur=${encodeURIComponent("Énergie")}`)).toContain(bf.id);
    expect(await ids("bailleur=union")).toContain(bf.id);
    expect(await ids("devise=EUR&montant_min=5000000&montant_max=9000000")).toEqual([bf.id]);
    expect(await ids("devise=EUR&montant_min=9000000")).not.toContain(bf.id);
    expect(await ids("devise=XOF")).not.toContain(bf.id);
    expect(await ids("q=sectorielle")).toEqual([bf.id]);
  });

  it("mission et client : la mission doit être visible et celle du client (MPW03)", async () => {
    const missionId = (await creerMission(s.a)).id as string;
    const autreClient = await s.a.associe.post("/api/clients", { raison_sociale: "Autre client" });
    attendre(201, autreClient, "client");
    const ok = await s.a.associe.post("/api/banque-ao/references", {
      ...REFERENCE,
      client_id: s.a.clientId,
      mission_id: missionId,
    });
    attendre(201, ok, "référence liée");
    const incoherent = await s.a.associe.post("/api/banque-ao/references", {
      ...REFERENCE,
      client_id: autreClient.json().id,
      mission_id: missionId,
    });
    expect(incoherent.statusCode).toBe(409);
    expect(incoherent.json().erreur.code).toBe("INCOHERENCE_BANQUE_AO");
    // Mission invisible du consultant (hors équipe) : 404 comme une inexistante.
    const invisible = await s.consultant.post("/api/banque-ao/references", {
      ...REFERENCE,
      mission_id: missionId,
    });
    expect(invisible.statusCode).toBe(404);
  });
});

describe("pièces justificatives", () => {
  it("fichier_orphelin garde toutes les références antérieures en ajoutant les pièces (0384)", async () => {
    const definition = await proprietaire(
      async (c) =>
        (await c.query("SELECT pg_get_functiondef('fichier_orphelin(uuid)'::regprocedure) AS d"))
          .rows[0].d as string,
    );
    for (const table of [
      "mission_documents",
      "debours",
      "rapports_mission",
      "preuve_versions",
      "dossier_faits",
      "dossier_facteurs",
      "salle_depots",
      "ao_attestations",
      "fichiers_suppressions",
    ]) {
      expect(definition, table).toContain(table);
    }
  });

  it("rattache un fichier téléversé : il n'est plus orphelin ; téléchargement par la banque", async () => {
    const ref = await creerReference(s.consultant);
    const fichierId = await deposer();
    expect(await orphelin(fichierId)).toBe(true);
    const url = `/api/banque-ao/references/${ref.id}/attestations`;
    const r = await s.consultant.post(url, { ...PIECE, fichier_id: fichierId });
    attendre(201, r, "pièce");
    const piece = r.json().attestations[0];
    expect(piece).toMatchObject({ type: PIECE.type, retiree: false });
    expect(piece.fichier).toMatchObject({ id: fichierId, type_mime: "application/pdf" });
    expect(await orphelin(fichierId)).toBe(false);
    // Déjà rattaché : refusé.
    expect((await s.consultant.post(url, { ...PIECE, fichier_id: fichierId })).statusCode).toBe(
      409,
    );
    // Fichier d'un autre utilisateur : 404 (jamais rattachable par un tiers).
    const autre = await deposer(s.a.chef, "autre");
    expect((await s.consultant.post(url, { ...PIECE, fichier_id: autre })).statusCode).toBe(404);

    const dl = await s.expert.get(`/api/banque-ao/attestations/${piece.id}/fichier`);
    attendre(200, dl, "téléchargement");
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect(String(dl.headers["content-disposition"])).toContain("attachment");
    expect(dl.headers["cache-control"]).toBe("private, no-store");
    expect(
      (await s.ressources.get(`/api/banque-ao/attestations/${piece.id}/fichier`)).statusCode,
    ).toBe(403);
    expect(
      (await s.b.associe.get(`/api/banque-ao/attestations/${piece.id}/fichier`)).statusCode,
    ).toBe(404);
  });

  it("retrait d'une pièce d'autrui : associé et directeur de mission seulement", async () => {
    for (const par of [s.a.directeur, s.a.associe]) {
      const ref = await creerReference(s.consultant);
      const fichierId = await deposer(s.consultant, "pièce-d-autrui");
      const piece = (
        await s.consultant.post(`/api/banque-ao/references/${ref.id}/attestations`, {
          ...PIECE,
          fichier_id: fichierId,
        })
      ).json().attestations[0];
      const r = await par.post(`/api/banque-ao/attestations/${piece.id}/retrait`, {
        motif: "Pièce déposée par erreur",
      });
      attendre(200, r, "retrait par un responsable");
      expect(r.json().attestations[0]).toMatchObject({ retiree: true });
    }
  });

  it("retrait motivé, une fois : le fichier redevient orphelin et la purge l'efface", async () => {
    const ref = await creerReference(s.consultant);
    const fichierId = await deposer(s.consultant, "a-retirer");
    const piece = (
      await s.consultant.post(`/api/banque-ao/references/${ref.id}/attestations`, {
        ...PIECE,
        fichier_id: fichierId,
      })
    ).json().attestations[0];
    const retrait = `/api/banque-ao/attestations/${piece.id}/retrait`;
    expect((await s.consultant.post(retrait, {})).statusCode).toBe(400);
    expect((await s.expert.post(retrait, { motif: "Erreur" })).statusCode).toBe(403);
    // Un autre détenteur de ao.gerer ne détruit pas la pièce d'un collègue (irréversible à 24 h).
    const chef = await s.a.chef.post(retrait, { motif: "Pas ma pièce" });
    expect(chef.statusCode).toBe(403);
    expect(await orphelin(fichierId)).toBe(false);
    const r = await s.consultant.post(retrait, { motif: "Pièce d'une autre mission" });
    attendre(200, r, "retrait");
    expect(r.json().attestations[0]).toMatchObject({ retiree: true });
    expect((await s.consultant.post(retrait, { motif: "Encore" })).statusCode).toBe(409);
    expect(await orphelin(fichierId)).toBe(true);
    expect((await s.expert.get(`/api/banque-ao/attestations/${piece.id}/fichier`)).statusCode).toBe(
      404,
    );
    // Un retrait se fait une fois, rien d'autre ne bouge (MPW01), même pour le propriétaire.
    await expect(
      proprietaire((c) =>
        c.query("UPDATE ao_attestations SET emetteur = 'x' WHERE id = $1", [piece.id]),
      ),
    ).rejects.toMatchObject({ code: "MPW01" });

    const cite = await deposer(s.consultant, "cite");
    await s.consultant.post(`/api/banque-ao/references/${ref.id}/attestations`, {
      ...PIECE,
      fichier_id: cite,
    });
    const plusTard = new Date(Date.now() + DELAI_ORPHELIN_MS + 3600_000);
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      creerHandlerPurgeFichiers(() => stockageDe(ctx.config))({
        db,
        cabinetId: s.a.cabinetId,
        jobId: "test",
        charge: {},
        maintenant: plusTard,
      }),
    );
    const supprimes = await proprietaire(async (c) =>
      (
        await c.query("SELECT fichier_id FROM fichiers_suppressions WHERE fichier_id = ANY ($1)", [
          [fichierId, cite],
        ])
      ).rows.map((l) => l.fichier_id as string),
    );
    expect(supprimes).toEqual([fichierId]);
  });
});

describe("isolation entre cabinets", () => {
  it("une référence d'un autre cabinet répond 404 et n'apparaît pas dans la recherche", async () => {
    const ref = await creerReference(s.consultant, { titre: "Référence cloisonnée" });
    const b = s.b.associe;
    expect((await b.get(`/api/banque-ao/references/${ref.id}`)).statusCode).toBe(404);
    expect(
      (
        await b.post(`/api/banque-ao/references/${ref.id}/versions`, {
          contenu: REFERENCE,
          motif: "x",
        })
      ).statusCode,
    ).toBe(404);
    const fichierB = await deposer(b, "b");
    expect(
      (
        await b.post(`/api/banque-ao/references/${ref.id}/attestations`, {
          ...PIECE,
          fichier_id: fichierB,
        })
      ).statusCode,
    ).toBe(404);
    expect((await b.get(`/api/banque-ao/references/${INCONNU}`)).statusCode).toBe(404);
    const liste = (await b.get("/api/banque-ao/references?q=cloisonn")).json().elements;
    expect(liste).toEqual([]);
  });
});
