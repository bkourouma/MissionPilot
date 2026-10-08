import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  demarrerAvecStockage,
  ECHANTILLONS,
  marquerOrphelins,
  televerser,
} from "./fichiers-outils.js";
import type { Contexte } from "./helpers.js";
import type { Api } from "./api.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerCabinet(ctx, "Cabinet Versions A");
  b = await preparerCabinet(ctx, "Cabinet Versions B");
});
afterAll(async () => {
  await marquerOrphelins([a.cabinetId, b.cabinetId]);
  await ctx.fermer();
});

async function fichier(par: Api, texte: string): Promise<string> {
  const r = await televerser(par, "/api/fichiers", `${texte}.pdf`, ECHANTILLONS.pdf(texte));
  if (r.statusCode !== 201) throw new Error(r.body);
  return r.json().id;
}

describe("documents de mission reliés au stockage (SOC-05)", () => {
  it("versions incrémentales avec fichier, version courante, historique lisible", async () => {
    const { id } = await creerMission(a);
    const url = `/api/missions/${id}/documents`;
    const f1 = await fichier(a.chef, "diag-v1");
    const v1 = await a.chef.post(url, { type: "livrable", nom: "Diagnostic", fichier_id: f1 });
    expect(v1.statusCode).toBe(201);
    expect(v1.json()).toMatchObject({
      version: 1,
      fichier_id: f1,
      fichier: { id: f1, nom: "diag-v1.pdf", type_mime: "application/pdf" },
      chemin_stockage: null,
      statut_contenu: null,
      est_version_courante: true,
    });
    const f2 = await fichier(a.chef, "diag-v2");
    const v2 = (
      await a.chef.post(url, { type: "livrable", nom: "Diagnostic", fichier_id: f2 })
    ).json();
    expect(v2).toMatchObject({ version: 2, version_courante: 2 });
    // Compatibilité : l'ancien contrat (chemin relatif, ou rien) marche toujours.
    const v3 = await a.chef.post(url, {
      type: "livrable",
      nom: "Diagnostic",
      chemin_stockage: "missions/diag-v3.pdf",
    });
    expect(v3.json()).toMatchObject({ version: 3, fichier: null });

    const detail = (await a.chef.get(`/api/documents/${v1.json().id}`)).json();
    expect(detail.est_version_courante).toBe(false);
    expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    const liste = (await a.chef.get(`${url}?historique=true`)).json().elements;
    expect(liste.map((d: { version: number }) => d.version)).toEqual([3, 2, 1]);
    // Le fichier d'une version se télécharge par la route authentifiée.
    expect((await a.chef.get(`/api/fichiers/${f2}`)).statusCode).toBe(200);
  });

  it("fichier : identique à la version courante, déjà rattaché, d'autrui, ou avec un chemin → refus", async () => {
    const { id } = await creerMission(a);
    const url = `/api/missions/${id}/documents`;
    const f1 = await fichier(a.chef, "note");
    expect(
      (await a.chef.post(url, { type: "autre", nom: "Note", fichier_id: f1 })).statusCode,
    ).toBe(201);
    // Même contenu (empreinte) : nouvelle version refusée.
    const meme = await fichier(a.chef, "note");
    const r = await a.chef.post(url, { type: "autre", nom: "Note", fichier_id: meme });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("CONTENU_IDENTIQUE");
    // Un fichier ne se rattache qu'une fois.
    expect(
      (await a.chef.post(url, { type: "autre", nom: "Autre", fichier_id: f1 })).statusCode,
    ).toBe(409);
    // Le fichier d'un collègue ne se rattache pas (404 : on ne révèle rien).
    const autrui = await fichier(a.directeur, "autrui");
    expect(
      (await a.chef.post(url, { type: "autre", nom: "Vol", fichier_id: autrui })).statusCode,
    ).toBe(404);
    expect(
      (
        await a.chef.post(url, {
          type: "autre",
          nom: "Double",
          fichier_id: meme,
          chemin_stockage: "a/b.pdf",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("types réservés : la lettre de mission garde ses règles (mission.signer)", async () => {
    const { id } = await creerMission(a);
    const url = `/api/missions/${id}/documents`;
    const consultant = await a.avecRoles(["consultant"]);
    await a.chef.post(`/api/missions/${id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    const f = await fichier(consultant, "lettre");
    expect(
      (await consultant.post(url, { type: "lettre_de_mission", nom: "LM", fichier_id: f }))
        .statusCode,
    ).toBe(403);
    expect((await a.chef.post(url, { type: "lettre_de_mission", nom: "LM" })).statusCode).toBe(403);
    expect((await a.directeur.post(url, { type: "lettre_de_mission", nom: "LM" })).statusCode).toBe(
      201,
    );
  });
});

describe("statut des contenus générés (SOC-06)", () => {
  it("brouillon_ia → modifie → valide ; valideur ≠ auteur et ≠ modificateur ; historique tracé", async () => {
    const { id } = await creerMission(a);
    const url = `/api/missions/${id}/documents`;
    const consultant = await a.avecRoles(["consultant"]);
    await a.chef.post(`/api/missions/${id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    const doc = (
      await consultant.post(url, {
        type: "livrable",
        nom: "Synthèse",
        statut_contenu: "brouillon_ia",
      })
    ).json();
    expect(doc.statut_contenu).toBe("brouillon_ia");
    const statut = (api: Api, s: string) =>
      api.post(`/api/documents/${doc.id}/statut`, { statut: s });
    // L'auteur ne valide pas ; un simple membre non plus.
    expect((await statut(consultant, "valide")).statusCode).toBe(403);
    // Le chef modifie le contenu : il devient le dernier modificateur…
    expect((await statut(a.chef, "modifie")).json()).toMatchObject({
      statut_contenu: "modifie",
      contenu_modifie_par: a.chef.utilisateurId,
    });
    // … et ne peut donc plus le valider lui-même.
    const refus = await statut(a.chef, "valide");
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    const v = await statut(a.directeur, "valide");
    expect(v.json()).toMatchObject({
      statut_contenu: "valide",
      valide_par: a.directeur.utilisateurId,
    });
    expect((await statut(a.associe, "modifie")).statusCode).toBe(409);
    const detail = (await a.chef.get(`/api/documents/${doc.id}`)).json();
    expect(
      detail.historique_statut.map((h: { statut: string; par: string }) => [h.statut, h.par]),
    ).toEqual([
      ["brouillon_ia", consultant.utilisateurId],
      ["modifie", a.chef.utilisateurId],
      ["valide", a.directeur.utilisateurId],
    ]);
    expect((await statut(a.chef, "brouillon_ia")).statusCode).toBe(400);
  });

  it("l'associé peut valider son propre contenu ; seule la version courante change de statut", async () => {
    const { id } = await creerMission(a);
    const url = `/api/missions/${id}/documents`;
    const v1 = (
      await a.associe.post(url, { type: "livrable", nom: "Plan", statut_contenu: "brouillon_ia" })
    ).json();
    await a.associe.post(url, { type: "livrable", nom: "Plan", statut_contenu: "brouillon_ia" });
    expect(
      (await a.associe.post(`/api/documents/${v1.id}/statut`, { statut: "valide" })).statusCode,
    ).toBe(409);
    const courant = (await a.associe.get(`${url}?type=livrable`)).json().elements[0];
    expect(
      (await a.associe.post(`/api/documents/${courant.id}/statut`, { statut: "valide" })).json()
        .statut_contenu,
    ).toBe("valide");
    // Document déposé hors circuit IA : pas de statut à faire avancer.
    const simple = (await a.chef.post(url, { type: "autre", nom: "Simple" })).json();
    expect(
      (await a.chef.post(`/api/documents/${simple.id}/statut`, { statut: "modifie" })).statusCode,
    ).toBe(409);
  });

  it("en base : la séparation des tâches et l'immuabilité du validé tiennent même en SQL direct", async () => {
    const { id } = await creerMission(a);
    const doc = (
      await a.chef.post(`/api/missions/${id}/documents`, {
        type: "livrable",
        nom: "Direct",
        statut_contenu: "brouillon_ia",
      })
    ).json();
    const sql = (q: string, p: unknown[]) => ctx.db.withTenant(a.cabinetId, (db) => db.query(q, p));
    await expect(
      sql(
        "UPDATE mission_documents SET statut_contenu = 'valide', valide_par = $2, valide_le = now() WHERE id = $1",
        [doc.id, a.chef.utilisateurId],
      ),
    ).rejects.toThrow(/valideur/);
    await expect(
      sql("UPDATE mission_documents SET nom = 'x' WHERE id = $1", [doc.id]),
    ).rejects.toThrow(/permission denied/);
    await expect(sql("DELETE FROM mission_documents WHERE id = $1", [doc.id])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      sql("UPDATE mission_document_statuts SET statut = 'valide' WHERE document_id = $1", [doc.id]),
    ).rejects.toThrow(/permission denied/);
  });

  it("isolation et visibilité : document d'un autre cabinet ou d'une mission invisible → 404", async () => {
    const mb = await creerMission(b);
    const db = (
      await b.chef.post(`/api/missions/${mb.id}/documents`, {
        type: "livrable",
        nom: "B",
        statut_contenu: "brouillon_ia",
      })
    ).json();
    expect((await a.associe.get(`/api/documents/${db.id}`)).statusCode).toBe(404);
    expect(
      (await a.associe.post(`/api/documents/${db.id}/statut`, { statut: "valide" })).statusCode,
    ).toBe(404);
    const ma = await creerMission(a);
    const da = (
      await a.chef.post(`/api/missions/${ma.id}/documents`, { type: "livrable", nom: "A" })
    ).json();
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get(`/api/documents/${da.id}`)).statusCode).toBe(404);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.get(`/api/documents/${da.id}`)).statusCode).toBe(403);
  });
});
