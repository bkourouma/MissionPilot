import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Propositions A");
  b = await preparerCabinet(ctx, "Cabinet Propositions B");
});
afterAll(() => ctx.fermer());

async function opportunite(c: CabinetMissions, corps: Record<string, unknown> = {}) {
  const r = await c.chef.post("/api/opportunites", {
    client_id: c.clientId,
    intitule: "Plan stratégique Lagune",
    type_mission_id: c.typePlanId,
    montant_estime: 25_000_000,
    ...corps,
  });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

async function proposition(c: CabinetMissions, corps: Record<string, unknown> = {}) {
  const r = await c.chef.post(`/api/opportunites/${await opportunite(c)}/propositions`, corps);
  expect(r.statusCode).toBe(201);
  return r.json();
}

/** Somme attendue : jours du modèle × taux standard du grade (catalogue conseil). */
async function prixAttendu(c: CabinetMissions) {
  const modele = (await c.associe.get(`/api/types-mission/${c.typePlanId}`)).json();
  const taux = Object.fromEntries(
    (await c.associe.get("/api/grades/taux"))
      .json()
      .elements.map((g: { code: string; taux_vente_standard: number }) => [
        g.code,
        g.taux_vente_standard,
      ]),
  );
  let jours = 0;
  let prix = 0;
  for (const e of modele.elements as { jours_par_grade: Record<string, number> }[]) {
    for (const [code, j] of Object.entries(e.jours_par_grade)) {
      jours += j;
      prix += j * (taux[code] as number);
    }
  }
  return { jours, prix, nbElements: modele.elements.length };
}

describe("génération d'une proposition (MIS-05)", () => {
  it("copie le découpage du type, les jours par grade, l'équipe ; chiffre jours × taux", async () => {
    const p = await proposition(a);
    const attendu = await prixAttendu(a);
    expect(p).toMatchObject({ numero: 1, statut: "brouillon", devise: "XOF" });
    expect(p.elements).toHaveLength(attendu.nbElements);
    expect(p.equipe.length).toBeGreaterThan(0);
    expect(p.chiffrage).toMatchObject({
      devise: "XOF",
      jours_total: attendu.jours,
      honoraires_total: attendu.prix,
      taux_manquants: [],
    });
  });

  it("devise sans taux standard : taux à renseigner avant validation", async () => {
    const p = await proposition(a, { devise: "EUR" });
    expect(p.chiffrage.taux_manquants.length).toBeGreaterThan(0);
    const url = `/api/propositions/${p.id}`;
    await a.chef.post(`${url}/statut`, { statut: "a_valider" });
    const refus = await a.associe.post(`${url}/statut`, { statut: "validee" });
    expect(refus.statusCode).toBe(400);
    // Renvoyée en brouillon, l'associé ajuste les taux puis valide.
    await a.associe.post(`${url}/statut`, { statut: "brouillon" });
    const taux = Object.fromEntries(
      p.chiffrage.taux_manquants.map((code: string) => [code, 50_000]),
    );
    const t = await a.associe.put(`${url}/taux`, { taux });
    expect(t.json().chiffrage.taux_manquants).toEqual([]);
    expect(t.json().chiffrage.honoraires_total).toBe(t.json().chiffrage.jours_total * 50_000);
  });

  it("type requis, type et grades du cabinet seulement", async () => {
    const sansType = await opportunite(a, { type_mission_id: null });
    expect((await a.chef.post(`/api/opportunites/${sansType}/propositions`, {})).statusCode).toBe(
      400,
    );
    expect(
      (
        await a.chef.post(`/api/opportunites/${sansType}/propositions`, {
          type_mission_id: b.typePlanId,
        })
      ).statusCode,
    ).toBe(400);
    const p = await proposition(a);
    expect(
      (await a.chef.put(`/api/propositions/${p.id}/taux`, { taux: { inconnu: 1 } })).statusCode,
    ).toBe(400);
  });
});

describe("validation par un associé, statuts et proposition figée", () => {
  it("brouillon → à valider → validée (associé) → envoyée → acceptée ; opportunité gagnée", async () => {
    const p = await proposition(a);
    const url = `/api/propositions/${p.id}`;
    const statut = (api: typeof a.associe, s: string) => api.post(`${url}/statut`, { statut: s });

    // Ajustements en brouillon : équipe, jours d'un élément.
    const tache = p.elements.find((e: { niveau: number }) => e.niveau === 3);
    const e = await a.chef.patch(`${url}/elements/${tache.id}`, {
      jours_par_grade: { senior: 4, junior: 2 },
    });
    expect(e.statusCode).toBe(200);
    expect(
      e.json().elements.find((x: { id: string }) => x.id === tache.id).jours_par_grade,
    ).toEqual({ senior: 4, junior: 2 });
    expect(
      (await a.chef.patch(url, { equipe: [{ grade_code: "senior", nombre: 3 }] })).statusCode,
    ).toBe(200);

    expect((await statut(a.chef, "validee")).statusCode).toBe(409);
    expect((await statut(a.chef, "a_valider")).statusCode).toBe(200);
    // Le chef de mission n'a pas « proposition.valider ».
    expect((await statut(a.chef, "validee")).statusCode).toBe(403);
    const v = await statut(a.associe, "validee");
    expect(v.json()).toMatchObject({ statut: "validee", validee_par: a.associeId });

    // Figée : plus aucune modification, en code…
    expect((await a.associe.patch(url, { intitule: "Changé" })).statusCode).toBe(409);
    expect((await a.associe.put(`${url}/taux`, { taux: { senior: 1 } })).statusCode).toBe(409);
    expect(
      (await a.associe.patch(`${url}/elements/${tache.id}`, { libelle: "X" })).statusCode,
    ).toBe(409);
    // … et en base, même en SQL direct avec le rôle applicatif.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE proposition_lignes SET jours = 99 WHERE proposition_id = $1", [p.id]),
      ),
    ).rejects.toMatchObject({ code: "MPF02" });
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE propositions SET intitule = 'pirate' WHERE id = $1", [p.id]),
      ),
    ).rejects.toMatchObject({ code: "MPF02" });
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE propositions SET statut = 'brouillon' WHERE id = $1", [p.id]),
      ),
    ).rejects.toMatchObject({ code: "MPF02" });

    expect((await statut(a.chef, "acceptee")).statusCode).toBe(409);
    expect((await statut(a.chef, "envoyee")).json().statut).toBe("envoyee");
    expect((await statut(a.chef, "acceptee")).json().statut).toBe("acceptee");
    const opp = (await a.chef.get(`/api/opportunites/${p.opportunite_id}`)).json();
    expect(opp).toMatchObject({ statut: "gagnee", probabilite: 100 });
  });

  it("nouvelle version numérotée, modifiable, depuis une version figée", async () => {
    const p = await proposition(a);
    const url = `/api/propositions/${p.id}`;
    await a.chef.post(`${url}/statut`, { statut: "a_valider" });
    await a.associe.post(`${url}/statut`, { statut: "validee" });
    const v2 = await a.chef.post(`${url}/nouvelle-version`);
    expect(v2.statusCode).toBe(201);
    expect(v2.json()).toMatchObject({ numero: 2, statut: "brouillon" });
    expect(v2.json().chiffrage.honoraires_total).toBe(p.chiffrage.honoraires_total);
    expect(v2.json().elements).toHaveLength(p.elements.length);
    const liste = (await a.chef.get(`/api/opportunites/${p.opportunite_id}/propositions`)).json();
    expect(liste.elements.map((x: { numero: number }) => x.numero)).toEqual([1, 2]);
  });

  it("droits : pipeline.gerer pour tout, sauf la validation", async () => {
    const p = await proposition(a);
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get(`/api/propositions/${p.id}`)).statusCode).toBe(403);
    expect(
      (await consultant.post(`/api/propositions/${p.id}/statut`, { statut: "a_valider" }))
        .statusCode,
    ).toBe(403);
  });

  it("isolation : une proposition d'un autre cabinet répond 404", async () => {
    const p = await proposition(b);
    const element = p.elements[0].id;
    for (const r of [
      await a.associe.get(`/api/propositions/${p.id}`),
      await a.associe.patch(`/api/propositions/${p.id}`, { intitule: "X" }),
      await a.associe.patch(`/api/propositions/${p.id}/elements/${element}`, { libelle: "X" }),
      await a.associe.put(`/api/propositions/${p.id}/taux`, { taux: { senior: 1 } }),
      await a.associe.post(`/api/propositions/${p.id}/statut`, { statut: "a_valider" }),
      await a.associe.post(`/api/propositions/${p.id}/nouvelle-version`),
      await a.associe.post(`/api/propositions/${p.id}/mission`, {}),
    ]) {
      expect(r.statusCode).toBe(404);
    }
    // Élément d'une autre proposition (même cabinet) : 404.
    const propre = await proposition(a);
    expect(
      (await a.chef.patch(`/api/propositions/${propre.id}/elements/${element}`, { libelle: "X" }))
        .statusCode,
    ).toBe(404);
  });
});

describe("mission depuis une proposition acceptée (parcours A)", () => {
  it("copie le découpage et signe le budget aux taux de la proposition", async () => {
    const p = await proposition(a);
    const url = `/api/propositions/${p.id}`;
    // L'associé ajuste le prix : senior à 200 000 au lieu du standard.
    await a.associe.put(`${url}/taux`, { taux: { senior: 200_000 } });
    expect((await a.chef.post(`${url}/mission`, {})).statusCode).toBe(409);
    for (const [api, s] of [
      [a.chef, "a_valider"],
      [a.associe, "validee"],
      [a.chef, "envoyee"],
      [a.chef, "acceptee"],
    ] as const) {
      expect((await api.post(`${url}/statut`, { statut: s })).statusCode).toBe(200);
    }
    const detail = (await a.chef.get(url)).json();
    const m = await a.associe.post(`${url}/mission`, {
      directeur_id: a.directeur.utilisateurId,
      chef_id: a.chef.utilisateurId,
      date_debut: "2026-11-02",
    });
    expect(m.statusCode).toBe(201);
    expect(m.json()).toMatchObject({
      statut: "proposition",
      proposition_id: p.id,
      opportunite_id: p.opportunite_id,
      client_id: a.clientId,
    });
    // Une proposition ne donne qu'une mission.
    expect((await a.associe.post(`${url}/mission`, {})).statusCode).toBe(409);
    const synthese = (await a.chef.get(`/api/missions/${m.json().id}/synthese`)).json();
    expect(synthese.arborescence.suivi.budget).toBe(detail.chiffrage.jours_total);

    const s = await a.directeur.post(`/api/missions/${m.json().id}/signer`, {
      date_signature: "2026-10-05",
    });
    expect(s.statusCode).toBe(200);
    expect(s.json().budget_initial.synthese.honoraires).toBe(detail.chiffrage.honoraires_total);
  });
});
