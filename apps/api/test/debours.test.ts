import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission, TOUS_LES_ROLES } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let missionId: string;
let consultant: Awaited<ReturnType<typeof utilisateurCollaborateur>>;
let collegue: Awaited<ReturnType<typeof utilisateurCollaborateur>>;

const DEBOURS = {
  date: "2026-10-05",
  categorie: "transport",
  libelle: "Billet Abidjan-Bouaké",
  montant: 45_000,
  refacturable: true,
  justificatif: "debours/2026/billet-bouake.jpg",
};

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Débours A");
  b = await preparerFacturation(ctx, "Cabinet Débours B");
  const m = await creerMission(a, { mode_facturation: "forfait" });
  missionId = m.id;
  attendre(
    200,
    await a.directeur.post(`/api/missions/${missionId}/signer`, { date_signature: "2026-10-01" }),
    "signature",
  );
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
afterAll(() => ctx.fermer());

async function deboursSoumis(corps: Record<string, unknown> = {}): Promise<string> {
  const r = await consultant.post(`/api/missions/${missionId}/debours`, { ...DEBOURS, ...corps });
  attendre(201, r, "débours");
  attendre(200, await consultant.post(`/api/debours/${r.json().id}/soumettre`), "soumission");
  return r.json().id;
}

describe("débours et notes de frais (FIN-05)", () => {
  it("saisie, soumission, validation par le chef de mission ; débours validé figé", async () => {
    const r = await consultant.post(`/api/missions/${missionId}/debours`, DEBOURS);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ statut: "brouillon", devise: "XOF", montant: 45_000 });
    const id = r.json().id as string;
    expect((await consultant.patch(`/api/debours/${id}`, { montant: 50_000 })).json().montant).toBe(
      50_000,
    );
    attendre(200, await consultant.post(`/api/debours/${id}/soumettre`), "soumission");
    // Soumis : figé pour l'auteur ; l'auteur ne valide pas.
    expect((await consultant.patch(`/api/debours/${id}`, { montant: 1 })).statusCode).toBe(409);
    expect((await consultant.post(`/api/debours/${id}/valider`)).statusCode).toBe(403);
    const v = await a.chef.post(`/api/debours/${id}/valider`);
    expect(v.statusCode).toBe(200);
    expect(v.json()).toMatchObject({ statut: "valide", decide_par: a.chef.utilisateurId });
    expect((await consultant.delete(`/api/debours/${id}`)).statusCode).toBe(409);
    // SQL direct (rôle applicatif) : un débours validé est immuable.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE debours SET montant = 1 WHERE id = $1", [id]),
      ),
    ).rejects.toThrow(/immuable/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM debours WHERE id = $1", [id])),
    ).rejects.toThrow(/suppression refusée/);
  });

  it("rejet motivé, correction par l'auteur puis nouvelle soumission", async () => {
    const id = await deboursSoumis();
    expect((await a.chef.post(`/api/debours/${id}/rejeter`, {})).statusCode).toBe(400);
    const rejet = await a.chef.post(`/api/debours/${id}/rejeter`, {
      motif: "Justificatif illisible",
    });
    expect(rejet.json()).toMatchObject({ statut: "rejete", motif_rejet: "Justificatif illisible" });
    const corrige = await consultant.patch(`/api/debours/${id}`, {
      justificatif: "debours/2026/billet-net.jpg",
    });
    expect(corrige.json().statut).toBe("brouillon");
    expect((await consultant.post(`/api/debours/${id}/soumettre`)).statusCode).toBe(200);
  });

  it("le valideur n'est jamais l'auteur : chef auteur de son débours → 403", async () => {
    const chef = await utilisateurCollaborateur(a, ["chef_mission"], "manager");
    const m = await creerMission(a, { chef_id: chef.utilisateurId });
    attendre(
      200,
      await a.directeur.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-10-01" }),
      "signature",
    );
    const r = await chef.post(`/api/missions/${m.id}/debours`, DEBOURS);
    attendre(201, r, "débours");
    attendre(200, await chef.post(`/api/debours/${r.json().id}/soumettre`), "soumission");
    const refus = await chef.post(`/api/debours/${r.json().id}/valider`);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    expect((await a.directeur.post(`/api/debours/${r.json().id}/valider`)).statusCode).toBe(200);
  });

  it("validation des entrées : justificatif, devise, date, montant, catégorie", async () => {
    const post = (corps: Record<string, unknown>) =>
      consultant.post(`/api/missions/${missionId}/debours`, { ...DEBOURS, ...corps });
    expect((await post({ justificatif: "../../etc/passwd" })).statusCode).toBe(400);
    expect((await post({ justificatif: "https://exemple.test/x.jpg" })).statusCode).toBe(400);
    expect((await post({ justificatif: "/absolu.jpg" })).statusCode).toBe(400);
    expect((await post({ devise: "EUR" })).statusCode).toBe(400);
    expect((await post({ date: "1999-12-31" })).statusCode).toBe(400);
    expect((await post({ montant: 0 })).statusCode).toBe(400);
    expect((await post({ montant: 12.5 })).statusCode).toBe(400);
    expect((await post({ categorie: "luxe" })).statusCode).toBe(400);
    expect((await post({ statut: "valide" })).statusCode).toBe(400);
  });

  it("visibilité : l'auteur voit les siens, le chef et le gestionnaire tous ; un collègue non", async () => {
    const id = await deboursSoumis();
    const siens = (await collegue.get(`/api/missions/${missionId}/debours`)).json();
    expect(siens.elements.some((d: { id: string }) => d.id === id)).toBe(false);
    expect((await collegue.get(`/api/debours/${id}`)).statusCode).toBe(404);
    for (const api of [a.chef, a.gestionnaire, a.associe]) {
      const tous = (await api.get(`/api/missions/${missionId}/debours?limite=100`)).json();
      expect(tous.elements.some((d: { id: string }) => d.id === id)).toBe(true);
    }
    const mes = (await consultant.get("/api/debours?statut=soumis")).json();
    expect(mes.elements.every((d: { statut: string }) => d.statut === "soumis")).toBe(true);
    expect(mes.elements.some((d: { id: string }) => d.id === id)).toBe(true);
  });

  it("matrice des droits de validation : 8 rôles", async () => {
    const id = await deboursSoumis();
    for (const role of TOUS_LES_ROLES.filter((r) => r !== "associe")) {
      const u = await a.avecRoles([role]);
      const statut = (await u.post(`/api/debours/${id}/valider`)).statusCode;
      // Gestionnaire : voit les débours (facturation) mais ne valide pas ; les
      // autres ne voient pas ce débours (ni auteur, ni responsable de la mission).
      expect(statut, role).toBe(role === "gestionnaire" ? 403 : 404);
    }
    const associe = await a.avecRoles(["associe"]);
    expect((await associe.post(`/api/debours/${id}/valider`)).statusCode).toBe(200);
  });

  it("un débours refacturable validé devient une ligne facturable (TVA des débours)", async () => {
    const id = await deboursSoumis({ montant: 80_000 });
    const nonValide = await a.gestionnaire.post(`/api/missions/${missionId}/factures`, {
      debours_ids: [id],
    });
    expect(nonValide.statusCode).toBe(409);
    attendre(200, await a.chef.post(`/api/debours/${id}/valider`), "validation");
    const nonRefacturable = await deboursSoumis({ refacturable: false, montant: 20_000 });
    attendre(200, await a.chef.post(`/api/debours/${nonRefacturable}/valider`), "validation");
    expect(
      (
        await a.gestionnaire.post(`/api/missions/${missionId}/factures`, {
          debours_ids: [nonRefacturable],
        })
      ).statusCode,
    ).toBe(409);
    const f = await a.gestionnaire.post(`/api/missions/${missionId}/factures`, {
      debours_ids: [id],
    });
    expect(f.statusCode).toBe(201);
    expect(f.json().lignes[0]).toMatchObject({ origine: "debours", debours_id: id, taux_tva: 0 });
    expect(f.json()).toMatchObject({ total_ht: 80_000, total_tva: 0, net_a_payer: 80_000 });
    expect((await a.gestionnaire.get(`/api/debours/${id}`)).json().facture_en_cours).toBe(true);
  });

  it("suivi : débours validés exposés avec budget.lire_montants seulement", async () => {
    const chef = (await a.chef.get(`/api/missions/${missionId}/suivi`)).json();
    expect(chef.debours.devise).toBe("XOF");
    expect(chef.debours.non_refacturables).toBeGreaterThanOrEqual(20_000);
    const vue = await consultant.get(`/api/missions/${missionId}/suivi`);
    expect(vue.statusCode).toBe(200);
    expect(vue.json()).not.toHaveProperty("debours");
  });

  it("isolation : débours d'un autre cabinet → 404", async () => {
    const id = await deboursSoumis();
    expect((await b.associe.get(`/api/debours/${id}`)).statusCode).toBe(404);
    expect((await b.associe.post(`/api/debours/${id}/valider`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/missions/${missionId}/debours`)).statusCode).toBe(404);
    expect((await b.associe.post(`/api/missions/${missionId}/debours`, DEBOURS)).statusCode).toBe(
      404,
    );
  });
});
