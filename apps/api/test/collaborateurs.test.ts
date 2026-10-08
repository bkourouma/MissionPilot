import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@missionpilot/shared";
import { cabinetTest, type Api, type CabinetTest } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
let gradeId: string;
let collabId: string;

/** Clés qui ne doivent jamais apparaître dans le référentiel (FIN-02). */
const CHAMPS_FINANCIERS = /cout|taux|marge|tarif|prix/i;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet Collaborateurs A");
  b = await cabinetTest(ctx, "Cabinet Collaborateurs B");
  gradeId = (
    await a.associe.post("/api/grades", { code: "senior", libelle: "Senior", ordre: 30 })
  ).json().id;
  await a.associe.put(`/api/grades/${gradeId}/taux`, {
    taux_vente_standard: 175_000,
    devise: "XOF",
  });
  collabId = (
    await a.associe.post("/api/collaborateurs", {
      nom: "Koffi Test",
      grade_id: gradeId,
      competences: ["Finance", "Finance", "Stratégie"],
      capacite_pct: 80,
    })
  ).json().id;
  await a.associe.post(`/api/collaborateurs/${collabId}/couts`, {
    cout_journalier: 90_000,
    devise: "XOF",
    depuis_le: "2026-01-01",
  });
});
afterAll(() => ctx.fermer());

describe("grades (PLN-05)", () => {
  it("liste les grades sans aucun taux", async () => {
    const r = await a.associe.get("/api/grades");
    expect(r.statusCode).toBe(200);
    expect(r.json().elements[0]).toMatchObject({ code: "senior", libelle: "Senior" });
    expect(Object.keys(r.json().elements[0]).join(",")).not.toMatch(CHAMPS_FINANCIERS);
  });

  it("code unique par cabinet, validation du code, modification", async () => {
    expect(
      (await a.associe.post("/api/grades", { code: "senior", libelle: "Doublon" })).statusCode,
    ).toBe(409);
    expect(
      (await a.associe.post("/api/grades", { code: "Sénior !", libelle: "X" })).statusCode,
    ).toBe(400);
    expect(
      (await b.associe.post("/api/grades", { code: "senior", libelle: "Senior B" })).statusCode,
    ).toBe(201);
    const id = (await a.associe.post("/api/grades", { code: "junior", libelle: "Junior" })).json()
      .id;
    expect(
      (await a.associe.patch(`/api/grades/${id}`, { libelle: "Consultant junior" })).json().libelle,
    ).toBe("Consultant junior");
    expect(
      (await a.associe.patch(`/api/grades/${id}`, { taux_vente_standard: 1 })).statusCode,
    ).toBe(400);
  });

  it("le taux se lit et s'écrit par /grades/taux, montant entier", async () => {
    const r = await a.associe.get("/api/grades/taux");
    expect(r.json().elements.find((g: { id: string }) => g.id === gradeId)).toMatchObject({
      taux_vente_standard: 175_000,
      devise: "XOF",
    });
    expect(
      (
        await a.associe.put(`/api/grades/${gradeId}/taux`, {
          taux_vente_standard: 1.5,
          devise: "XOF",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.associe.put(`/api/grades/${gradeId}/taux`, {
          taux_vente_standard: -1,
          devise: "XOF",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("isolation : un autre cabinet ne modifie ni le grade ni son taux (404)", async () => {
    expect((await b.associe.patch(`/api/grades/${gradeId}`, { libelle: "X" })).statusCode).toBe(
      404,
    );
    expect(
      (
        await b.associe.put(`/api/grades/${gradeId}/taux`, {
          taux_vente_standard: 1,
          devise: "XOF",
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("collaborateurs (PLN-05, PLN-08)", () => {
  it("crée et lit un collaborateur, listes dédoublonnées, aucune donnée financière", async () => {
    const r = await a.associe.get(`/api/collaborateurs/${collabId}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      nom: "Koffi Test",
      grade_code: "senior",
      competences: ["Finance", "Stratégie"],
      capacite_pct: 80,
      type: "interne",
      langues: ["français"],
    });
    expect(Object.keys(r.json()).join(",")).not.toMatch(CHAMPS_FINANCIERS);
    const liste = await a.associe.get("/api/collaborateurs");
    for (const c of liste.json().elements)
      expect(Object.keys(c).join(",")).not.toMatch(CHAMPS_FINANCIERS);
    expect(liste.body).not.toMatch(/90000|175000/);
  });

  it("filtre et recherche", async () => {
    await a.associe.post("/api/collaborateurs", {
      nom: "Externe Fiscaliste",
      type: "externe",
      competences: ["Fiscalité"],
    });
    const externes = await a.associe.get("/api/collaborateurs?type=externe");
    expect(externes.json().elements.map((c: { nom: string }) => c.nom)).toEqual([
      "Externe Fiscaliste",
    ]);
    const parCompetence = await a.associe.get("/api/collaborateurs?q=fiscal");
    expect(parCompetence.json().elements).toHaveLength(1);
  });

  it("modifie un collaborateur, rattache un utilisateur une seule fois", async () => {
    const u = await a.avecRoles(["consultant"]);
    const m = await a.associe.patch(`/api/collaborateurs/${collabId}`, {
      utilisateur_id: u.utilisateurId,
      capacite_pct: 50,
    });
    expect(m.statusCode).toBe(200);
    expect(m.json()).toMatchObject({ utilisateur_id: u.utilisateurId, capacite_pct: 50 });
    const doublon = await a.associe.post("/api/collaborateurs", {
      nom: "Doublon",
      utilisateur_id: u.utilisateurId,
    });
    expect(doublon.statusCode).toBe(409);
  });

  it("valide : capacité hors 0-100, type inconnu", async () => {
    expect(
      (await a.associe.post("/api/collaborateurs", { nom: "X", capacite_pct: 120 })).statusCode,
    ).toBe(400);
    expect(
      (await a.associe.post("/api/collaborateurs", { nom: "X", type: "stagiaire" })).statusCode,
    ).toBe(400);
  });

  it("isolation : grade, utilisateur ou collaborateur d'un autre cabinet refusés", async () => {
    // Référencer le grade de A depuis B : refusé (clé étrangère composite).
    const r = await b.associe.post("/api/collaborateurs", { nom: "Intrus", grade_id: gradeId });
    expect(r.statusCode).toBe(400);
    const r2 = await b.associe.post("/api/collaborateurs", {
      nom: "Intrus",
      utilisateur_id: a.associeId,
    });
    expect(r2.statusCode).toBe(400);
    expect((await b.associe.get(`/api/collaborateurs/${collabId}`)).statusCode).toBe(404);
    expect(
      (await b.associe.patch(`/api/collaborateurs/${collabId}`, { nom: "X" })).statusCode,
    ).toBe(404);
    expect((await b.associe.get(`/api/collaborateurs/${collabId}/couts`)).statusCode).toBe(404);
    expect(
      (
        await b.associe.post(`/api/collaborateurs/${collabId}/couts`, {
          cout_journalier: 1,
          devise: "XOF",
          depuis_le: "2026-02-01",
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("coûts des collaborateurs (FIN-02)", () => {
  it("historique : une révision ajoute une ligne, la ligne en vigueur est la plus récente passée", async () => {
    await a.associe.post(`/api/collaborateurs/${collabId}/couts`, {
      cout_journalier: 95_000,
      taux_vente_specifique: 180_000,
      devise: "XOF",
      depuis_le: "2026-06-01",
    });
    await a.associe.post(`/api/collaborateurs/${collabId}/couts`, {
      cout_journalier: 120_000,
      devise: "XOF",
      depuis_le: "2099-01-01",
    });
    const r = await a.associe.get(`/api/collaborateurs/${collabId}/couts`);
    expect(r.statusCode).toBe(200);
    expect(r.json().historique).toHaveLength(3);
    expect(r.json().courant).toMatchObject({
      cout_journalier: 95_000,
      taux_vente_specifique: 180_000,
      depuis_le: "2026-06-01",
    });
    expect(
      (
        await a.associe.post(`/api/collaborateurs/${collabId}/couts`, {
          cout_journalier: 1,
          devise: "XOF",
          depuis_le: "2026-06-01",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await a.associe.post(`/api/collaborateurs/${collabId}/couts`, {
          devise: "XOF",
          depuis_le: "2026-07-01",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("l'historique des coûts n'est ni modifiable ni supprimable par le rôle applicatif", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE collaborateur_couts SET cout_journalier = 0"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM collaborateur_couts")),
    ).rejects.toThrow(/permission denied/);
  });

  it("le journal d'audit ne contient aucun montant", async () => {
    const r = await a.associe.get("/api/audit?limite=200");
    expect(r.body).not.toMatch(/90000|95000|175000|180000/);
  });

  describe("matrice des droits par rôle", () => {
    const sessions = new Map<Role, Api>();
    beforeAll(async () => {
      for (const role of ROLES) sessions.set(role, await a.avecRoles([role]));
    });

    const voientLesCouts: Role[] = ["associe", "gestionnaire"];

    it.each(ROLES.map((r) => [r]))("%s", async (role) => {
      const s = sessions.get(role)!;
      const attendu = voientLesCouts.includes(role) ? 200 : 403;
      expect((await s.get(`/api/collaborateurs/${collabId}/couts`)).statusCode).toBe(attendu);
      expect((await s.get("/api/grades/taux")).statusCode).toBe(attendu);
      const ecritureCout = await s.post(`/api/collaborateurs/${collabId}/couts`, {
        cout_journalier: 1,
        devise: "XOF",
        depuis_le: `2030-01-${String(ROLES.indexOf(role) + 1).padStart(2, "0")}`,
      });
      expect(ecritureCout.statusCode).toBe(voientLesCouts.includes(role) ? 201 : 403);
      const ecritureTaux = await s.put(`/api/grades/${gradeId}/taux`, {
        taux_vente_standard: 175_000,
        devise: "XOF",
      });
      expect(ecritureTaux.statusCode).toBe(attendu);

      // Le référentiel, lui, ne porte jamais de champ financier, quel que soit le rôle.
      const ref = await s.get(`/api/collaborateurs/${collabId}`);
      if (ref.statusCode === 200)
        expect(Object.keys(ref.json()).join(",")).not.toMatch(CHAMPS_FINANCIERS);
    });

    it("le consultant, le chef et le directeur de mission reçoivent 403 sur les coûts", async () => {
      for (const role of ["consultant", "chef_mission", "directeur_mission"] as const) {
        const r = await sessions.get(role)!.get(`/api/collaborateurs/${collabId}/couts`);
        expect(r.statusCode).toBe(403);
        expect(r.body).not.toMatch(/\d{5}/);
      }
    });

    it("droits du référentiel : lecture collaborateurs.lire, écriture collaborateurs.ecrire", async () => {
      expect((await sessions.get("consultant")!.get("/api/collaborateurs")).statusCode).toBe(403);
      expect((await sessions.get("chef_mission")!.get("/api/collaborateurs")).statusCode).toBe(200);
      expect(
        (await sessions.get("chef_mission")!.post("/api/collaborateurs", { nom: "X" })).statusCode,
      ).toBe(403);
      expect(
        (await sessions.get("ressources")!.post("/api/collaborateurs", { nom: "Par RH" }))
          .statusCode,
      ).toBe(201);
      expect(
        (await sessions.get("gestionnaire")!.post("/api/grades", { code: "x", libelle: "X" }))
          .statusCode,
      ).toBe(403);
    });
  });
});
