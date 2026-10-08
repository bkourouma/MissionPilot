import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet Clients A");
  b = await cabinetTest(ctx, "Cabinet Clients B");
});
afterAll(() => ctx.fermer());

const nouveauClient = (suffixe: string, extra: Record<string, unknown> = {}) => ({
  raison_sociale: `Société ${suffixe}`,
  forme_juridique: "SA",
  secteur: "Banque",
  taille: "pme",
  ...extra,
});

describe("clients (SOC-03)", () => {
  it("crée, lit et modifie une fiche client", async () => {
    const r = await a.associe.post(
      "/api/clients",
      nouveauClient("Alpha", { rccm: "CI-ABJ-2020-B-1", compte_contribuable: "" }),
    );
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ pays: "CI", actif: true, compte_contribuable: null });
    const id = r.json().id;
    const lu = await a.associe.get(`/api/clients/${id}`);
    expect(lu.json()).toMatchObject({ raison_sociale: "Société Alpha", contacts: [] });
    const m = await a.associe.patch(`/api/clients/${id}`, { secteur: "Assurance", actif: false });
    expect(m.json()).toMatchObject({ secteur: "Assurance", actif: false });
  });

  it("RCCM et compte contribuable uniques par cabinet quand renseignés (insensible à la casse)", async () => {
    await a.associe.post(
      "/api/clients",
      nouveauClient("Beta", { rccm: "CI-ABJ-UNIQUE-1", compte_contribuable: "CC-UNIQ-1" }),
    );
    const doublonRccm = await a.associe.post(
      "/api/clients",
      nouveauClient("Beta bis", { rccm: "ci-abj-unique-1" }),
    );
    expect(doublonRccm.statusCode).toBe(409);
    expect(doublonRccm.json().erreur.message).toMatch(/RCCM/);
    const doublonCc = await a.associe.post(
      "/api/clients",
      nouveauClient("Beta ter", { compte_contribuable: "CC-UNIQ-1" }),
    );
    expect(doublonCc.statusCode).toBe(409);
    // Sans RCCM : pas de contrainte.
    expect((await a.associe.post("/api/clients", nouveauClient("Sans RCCM 1"))).statusCode).toBe(
      201,
    );
    expect((await a.associe.post("/api/clients", nouveauClient("Sans RCCM 2"))).statusCode).toBe(
      201,
    );
    // Un autre cabinet peut avoir le même RCCM.
    expect(
      (await b.associe.post("/api/clients", nouveauClient("Beta B", { rccm: "CI-ABJ-UNIQUE-1" })))
        .statusCode,
    ).toBe(201);
  });

  it("recherche et pagination par curseur", async () => {
    const c = await cabinetTest(ctx, "Cabinet Pagination");
    for (const n of ["Delta", "Alpha", "Charlie", "Bravo", "Echo"]) {
      await c.associe.post("/api/clients", nouveauClient(n));
    }
    const p1 = await c.associe.get("/api/clients?limite=2");
    expect(p1.json().elements.map((x: { raison_sociale: string }) => x.raison_sociale)).toEqual([
      "Société Alpha",
      "Société Bravo",
    ]);
    expect(p1.body).not.toMatch(/cle_tri/);
    const p2 = await c.associe.get(`/api/clients?limite=2&curseur=${p1.json().curseur_suivant}`);
    expect(p2.json().elements.map((x: { raison_sociale: string }) => x.raison_sociale)).toEqual([
      "Société Charlie",
      "Société Delta",
    ]);
    const p3 = await c.associe.get(`/api/clients?limite=2&curseur=${p2.json().curseur_suivant}`);
    expect(p3.json().elements).toHaveLength(1);
    expect(p3.json().curseur_suivant).toBeNull();

    const recherche = await c.associe.get("/api/clients?q=char");
    expect(recherche.json().elements).toHaveLength(1);
    const joker = await c.associe.get("/api/clients?q=%25");
    expect(joker.json().elements).toHaveLength(0);
    expect((await c.associe.get("/api/clients?curseur=nimporte-quoi")).statusCode).toBe(400);
  });

  it("droits : lecture clients.lire, écriture clients.ecrire", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get("/api/clients")).statusCode).toBe(200);
    expect((await consultant.post("/api/clients", nouveauClient("Refus"))).statusCode).toBe(403);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.get("/api/clients")).statusCode).toBe(403);
    expect((await api(ctx).get("/api/clients")).statusCode).toBe(401);
  });

  it("valide les entrées", async () => {
    expect((await a.associe.post("/api/clients", { raison_sociale: "" })).statusCode).toBe(400);
    expect(
      (await a.associe.post("/api/clients", nouveauClient("X", { taille: "enorme" }))).statusCode,
    ).toBe(400);
    expect(
      (await a.associe.post("/api/clients", nouveauClient("X", { cabinet_id: b.cabinetId })))
        .statusCode,
    ).toBe(400);
  });

  it("isolation : un autre cabinet ne lit ni ne modifie un client par identifiant (404)", async () => {
    const id = (await a.associe.post("/api/clients", nouveauClient("Secret A"))).json().id;
    expect((await b.associe.get(`/api/clients/${id}`)).statusCode).toBe(404);
    expect((await b.associe.patch(`/api/clients/${id}`, { secteur: "x" })).statusCode).toBe(404);
    expect((await b.associe.get(`/api/clients/${id}/contacts`)).statusCode).toBe(404);
    expect(
      (await b.associe.post(`/api/clients/${id}/contacts`, { nom: "Intrus" })).statusCode,
    ).toBe(404);
    const liste = await b.associe.get("/api/clients?q=Secret");
    expect(liste.json().elements).toEqual([]);
  });
});

describe("contacts client", () => {
  it("CRUD, un seul contact principal", async () => {
    const id = (await a.associe.post("/api/clients", nouveauClient("Contacts"))).json().id;
    const c1 = await a.associe.post(`/api/clients/${id}/contacts`, {
      nom: "Awa",
      email: "awa@client.test",
      principal: true,
    });
    expect(c1.statusCode).toBe(201);
    const c2 = await a.associe.post(`/api/clients/${id}/contacts`, {
      nom: "Bakary",
      principal: true,
    });
    const liste = (await a.associe.get(`/api/clients/${id}/contacts`)).json().elements;
    expect(
      liste.filter((c: { principal: boolean }) => c.principal).map((c: { id: string }) => c.id),
    ).toEqual([c2.json().id]);
    const m = await a.associe.patch(`/api/clients/${id}/contacts/${c1.json().id}`, {
      fonction: "DAF",
      email: "",
    });
    expect(m.json()).toMatchObject({ fonction: "DAF", email: null });
    expect((await a.associe.delete(`/api/clients/${id}/contacts/${c1.json().id}`)).statusCode).toBe(
      204,
    );
    expect((await a.associe.delete(`/api/clients/${id}/contacts/${c1.json().id}`)).statusCode).toBe(
      404,
    );
  });

  it("un contact n'est accessible que sous son propre client", async () => {
    const id1 = (await a.associe.post("/api/clients", nouveauClient("C1"))).json().id;
    const id2 = (await a.associe.post("/api/clients", nouveauClient("C2"))).json().id;
    const contact = (await a.associe.post(`/api/clients/${id1}/contacts`, { nom: "Z" })).json().id;
    expect(
      (await a.associe.patch(`/api/clients/${id2}/contacts/${contact}`, { nom: "Y" })).statusCode,
    ).toBe(404);
    expect((await b.associe.delete(`/api/clients/${id1}/contacts/${contact}`)).statusCode).toBe(
      404,
    );
  });

  it("valide l'e-mail du contact", async () => {
    const id = (await a.associe.post("/api/clients", nouveauClient("Email"))).json().id;
    expect(
      (await a.associe.post(`/api/clients/${id}/contacts`, { nom: "A", email: "pas-un-email" }))
        .statusCode,
    ).toBe(400);
  });
});
