import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import {
  demarrerAvecStockage,
  ECHANTILLONS,
  marquerOrphelins,
  televerser,
} from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { creerMission, TOUS_LES_ROLES } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let missionId: string;
let consultant: Awaited<ReturnType<typeof utilisateurCollaborateur>>;
let collegue: Awaited<ReturnType<typeof utilisateurCollaborateur>>;

const DEBOURS = {
  date: "2026-10-05",
  categorie: "transport",
  libelle: "Taxi aéroport",
  montant: 15_000,
  refacturable: true,
};

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerFacturation(ctx, "Cabinet Justificatifs A");
  b = await preparerFacturation(ctx, "Cabinet Justificatifs B");
  missionId = (await creerMission(a, { mode_facturation: "forfait" })).id;
  consultant = await utilisateurCollaborateur(a, ["consultant"]);
  collegue = await utilisateurCollaborateur(a, ["consultant"]);
  for (const u of [consultant, collegue]) {
    attendre(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u.utilisateurId }),
      "équipe",
    );
  }
});
afterAll(async () => {
  await marquerOrphelins([a.cabinetId, b.cabinetId]);
  await ctx.fermer();
});

async function brouillon(par: Api = consultant, mission = missionId): Promise<string> {
  const r = await par.post(`/api/missions/${mission}/debours`, DEBOURS);
  attendre(201, r, "débours");
  return r.json().id;
}

const joindre = (par: Api, id: string, nom = "recu.jpg", contenu = ECHANTILLONS.jpeg()) =>
  televerser(par, `/api/debours/${id}/justificatif`, nom, contenu);

describe("justificatif des débours (FIN-05)", () => {
  it("photo jointe à SON débours en brouillon ; servie par GET /api/fichiers/:id", async () => {
    const id = await brouillon();
    const r = await joindre(consultant, id, "Reçu taxi.jpg");
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d).toMatchObject({
      id,
      statut: "brouillon",
      justificatif: null,
      justificatif_fichier: { nom: "Reçu taxi.jpg", type_mime: "image/jpeg" },
    });
    const fichierId = d.justificatif_fichier.id as string;
    expect(d.justificatif_fichier_id).toBe(fichierId);
    // L'auteur, le chef (valideur), le gestionnaire (facturation) lisent ; un collègue non.
    for (const lecteur of [consultant, a.chef, a.gestionnaire, a.associe]) {
      const t = await lecteur.get(`/api/fichiers/${fichierId}?affichage=inline`);
      expect(t.statusCode).toBe(200);
      expect(t.headers["content-disposition"]).toMatch(/^inline;/);
    }
    expect((await collegue.get(`/api/fichiers/${fichierId}`)).statusCode).toBe(404);
    // La liste et le détail exposent le fichier (jamais la clé de stockage).
    const detail = (await consultant.get(`/api/debours/${id}`)).json();
    expect(detail.justificatif_fichier.taille).toBe(ECHANTILLONS.jpeg().length);
    expect(JSON.stringify(detail)).not.toMatch(/cle_stockage/);
  });

  it("remplacement : l'ancien fichier n'est plus rattaché ; retrait du justificatif", async () => {
    const id = await brouillon();
    const premier = (await joindre(consultant, id)).json().justificatif_fichier.id;
    const second = (await joindre(consultant, id, "recu.png", ECHANTILLONS.png())).json();
    expect(second.justificatif_fichier.id).not.toBe(premier);
    // L'ancien redevient orphelin : seul son auteur le voit encore, jusqu'à la purge.
    expect((await a.chef.get(`/api/fichiers/${premier}`)).statusCode).toBe(404);
    const retire = await consultant.delete(`/api/debours/${id}/justificatif`);
    expect(retire.json()).toMatchObject({
      justificatif_fichier: null,
      justificatif_fichier_id: null,
    });
  });

  it("soumis ou validé : justificatif figé (409), y compris en SQL direct", async () => {
    const id = await brouillon();
    attendre(200, await joindre(consultant, id), "justificatif");
    attendre(200, await consultant.post(`/api/debours/${id}/soumettre`), "soumission");
    expect((await joindre(consultant, id)).statusCode).toBe(409);
    expect((await consultant.delete(`/api/debours/${id}/justificatif`)).statusCode).toBe(409);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE debours SET justificatif_fichier_id = NULL WHERE id = $1", [id]),
      ),
    ).rejects.toThrow(/figé/);
    attendre(200, await a.chef.post(`/api/debours/${id}/valider`), "validation");
    expect((await joindre(consultant, id)).statusCode).toBe(409);
    // Rejeté : il redevient modifiable (et repasse en brouillon).
    const autre = await brouillon();
    attendre(200, await consultant.post(`/api/debours/${autre}/soumettre`), "soumission");
    attendre(
      200,
      await a.chef.post(`/api/debours/${autre}/rejeter`, { motif: "Justificatif manquant" }),
      "rejet",
    );
    const r = await joindre(consultant, autre);
    expect(r.statusCode).toBe(200);
    expect(r.json().statut).toBe("brouillon");
  });

  it("droits : seul l'auteur joint ; un débours d'autrui → 403 ou 404 ; 401 sans session", async () => {
    const id = await brouillon();
    expect((await joindre(a.chef, id)).statusCode).toBe(403);
    expect((await joindre(collegue, id)).statusCode).toBe(404);
    expect((await joindre(api(ctx), id)).statusCode).toBe(401);
    // Les 8 rôles déclarent des débours : chacun joint à son propre débours.
    for (const role of TOUS_LES_ROLES) {
      const u = await utilisateurCollaborateur(a, [role]);
      await a.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u.utilisateurId });
      const sien = await brouillon(u);
      expect((await joindre(u, sien)).statusCode, role).toBe(200);
    }
  });

  it("contrôles du fichier : faux type et nom piégé", async () => {
    const id = await brouillon();
    const exe = await joindre(consultant, id, "recu.jpg", ECHANTILLONS.exe());
    expect(exe.statusCode).toBe(415);
    const r = await joindre(consultant, id, "../../../recu.pdf", ECHANTILLONS.pdf("recu"));
    expect(r.json().justificatif_fichier.nom).toBe("recu.pdf");
    // Le débours n'a pas changé après un refus.
    expect((await consultant.get(`/api/debours/${id}`)).json().justificatif_fichier.nom).toBe(
      "recu.pdf",
    );
  });

  it("isolation : débours et justificatif d'un autre cabinet → 404, par identifiant connu", async () => {
    const mb = await creerMission(b, { mode_facturation: "forfait" });
    const cb = await utilisateurCollaborateur(b, ["consultant"]);
    await b.chef.post(`/api/missions/${mb.id}/equipe`, { utilisateur_id: cb.utilisateurId });
    const idB = await brouillon(cb, mb.id);
    const fichierB = (await joindre(cb, idB)).json().justificatif_fichier.id;
    expect((await joindre(a.associe, idB)).statusCode).toBe(404);
    expect((await a.associe.delete(`/api/debours/${idB}/justificatif`)).statusCode).toBe(404);
    expect((await a.associe.get(`/api/fichiers/${fichierB}`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/fichiers/${fichierB}`)).statusCode).toBe(200);
  });

  it("anciens débours : le chemin libre reste lisible", async () => {
    const id = await brouillon();
    await proprietaire((cl) =>
      cl.query("UPDATE debours SET justificatif = 'anciens/recu.jpg' WHERE id = $1", [id]),
    );
    expect((await consultant.get(`/api/debours/${id}`)).json()).toMatchObject({
      justificatif: "anciens/recu.jpg",
      justificatif_fichier: null,
    });
    // Effacer l'ancien chemin reste possible (null), en remplacer un non.
    expect((await consultant.patch(`/api/debours/${id}`, { justificatif: null })).statusCode).toBe(
      200,
    );
  });
});
