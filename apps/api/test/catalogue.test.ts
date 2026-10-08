import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GRADES_DEPART,
  semerCatalogueConseil,
  TYPES_DEPART,
} from "../src/catalogue/catalogue-conseil.js";
import { ordonnerArbre } from "../src/routes/catalogue.js";
import { cabinetTest, type CabinetTest } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet Catalogue A");
  b = await cabinetTest(ctx, "Cabinet Catalogue B");
});
afterAll(() => ctx.fermer());

const typeBase = (code: string) => ({
  code,
  libelle: `Type ${code}`,
  domaine: "Stratégie",
  mode_facturation: "forfait",
  duree_type_jours: 60,
  equipe_type: [{ grade_code: "senior", nombre: 2 }],
});

describe("types de mission (MIS-01)", () => {
  it("crée, liste, lit et modifie un type", async () => {
    const r = await a.associe.post("/api/types-mission", typeBase("diag"));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      code: "diag",
      equipe_type: [{ grade_code: "senior", nombre: 2 }],
      a_valider: false,
    });
    const id = r.json().id;
    const m = await a.associe.patch(`/api/types-mission/${id}`, {
      mode_facturation: "regie",
      equipe_type: [],
    });
    expect(m.json()).toMatchObject({ mode_facturation: "regie", equipe_type: [] });
    const liste = await a.associe.get("/api/types-mission");
    expect(liste.json().elements.map((t: { code: string }) => t.code)).toContain("diag");
    expect((await a.associe.post("/api/types-mission", typeBase("diag"))).statusCode).toBe(409);
  });

  it("valide le mode de facturation, l'équipe type et les jours", async () => {
    expect(
      (
        await a.associe.post("/api/types-mission", {
          ...typeBase("x1"),
          mode_facturation: "gratuit",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.associe.post("/api/types-mission", {
          ...typeBase("x2"),
          equipe_type: [{ grade_code: "senior", nombre: 0 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await a.associe.patch(`/api/types-mission/${crypto.randomUUID()}`, { a_valider: true }))
        .statusCode,
    ).toBe(400);
  });

  it("droits : lecture catalogue.lire, écriture catalogue.ecrire (associé, expert métier)", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get("/api/types-mission")).statusCode).toBe(200);
    expect((await consultant.post("/api/types-mission", typeBase("refus"))).statusCode).toBe(403);
    const expert = await a.avecRoles(["expert_metier"]);
    expect((await expert.post("/api/types-mission", typeBase("par_expert"))).statusCode).toBe(201);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.get("/api/types-mission")).statusCode).toBe(403);
  });
});

describe("modèle hiérarchique (MIS-02)", () => {
  it("phase → lot → tâche, niveaux déduits, pas de 4e niveau, parent du même type", async () => {
    const typeId = (await a.associe.post("/api/types-mission", typeBase("arbre"))).json().id;
    const autreType = (await a.associe.post("/api/types-mission", typeBase("arbre2"))).json().id;
    const url = `/api/types-mission/${typeId}/elements`;
    const phase = await a.associe.post(url, { libelle: "Diagnostic", ordre: 10 });
    expect(phase.json().niveau).toBe(1);
    const lot = await a.associe.post(url, { libelle: "Entretiens", parent_id: phase.json().id });
    expect(lot.json().niveau).toBe(2);
    const tache = await a.associe.post(url, {
      libelle: "Entretiens direction",
      parent_id: lot.json().id,
      jours_par_grade: { senior: 2.5, junior: 3 },
      est_livrable: true,
    });
    expect(tache.json()).toMatchObject({ niveau: 3, jours_par_grade: { senior: 2.5, junior: 3 } });
    expect(
      (await a.associe.post(url, { libelle: "Trop profond", parent_id: tache.json().id }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await a.associe.post(`/api/types-mission/${autreType}/elements`, {
          libelle: "X",
          parent_id: phase.json().id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await a.associe.post(url, { libelle: "X", jours_par_grade: { senior: 1.3 } })).statusCode,
    ).toBe(400);

    const lu = await a.associe.get(`/api/types-mission/${typeId}`);
    expect(lu.json().elements.map((e: { niveau: number }) => e.niveau)).toEqual([1, 2, 3]);

    const m = await a.associe.patch(`${url}/${tache.json().id}`, {
      jours_par_grade: { senior: 4 },
    });
    expect(m.json().jours_par_grade).toEqual({ senior: 4 });

    // Supprimer la phase supprime ses descendants.
    expect((await a.associe.delete(`${url}/${phase.json().id}`)).statusCode).toBe(204);
    expect((await a.associe.get(`/api/types-mission/${typeId}`)).json().elements).toEqual([]);
  });

  it("ordonne l'arbre en profondeur", () => {
    const e = (id: string, parent_id: string | null, ordre: number) => ({
      id,
      parent_id,
      ordre,
      libelle: id,
    });
    const res = ordonnerArbre([e("b", null, 2), e("a2", "a", 2), e("a", null, 1), e("a1", "a", 1)]);
    expect(res.map((x) => x.id)).toEqual(["a", "a1", "a2", "b"]);
  });
});

describe("duplication d'un type (MIS-12)", () => {
  it("copie le type et tout son modèle avec de nouveaux identifiants", async () => {
    await a.associe.post("/api/catalogue/semer-conseil");
    const source = (await a.associe.get("/api/types-mission"))
      .json()
      .elements.find((t: { code: string }) => t.code === "plan_strategique");
    const r = await a.associe.post(`/api/types-mission/${source.id}/dupliquer`, {
      code: "plan_strategique_pme",
      libelle: "Plan stratégique PME",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      code: "plan_strategique_pme",
      a_valider: false,
      mode_facturation: "forfait",
    });
    const avant = (await a.associe.get(`/api/types-mission/${source.id}`)).json().elements;
    const apres = (await a.associe.get(`/api/types-mission/${r.json().id}`)).json().elements;
    expect(apres.map((e: { libelle: string; niveau: number }) => [e.libelle, e.niveau])).toEqual(
      avant.map((e: { libelle: string; niveau: number }) => [e.libelle, e.niveau]),
    );
    const idsAvant = new Set(avant.map((e: { id: string }) => e.id));
    expect(apres.some((e: { id: string }) => idsAvant.has(e.id))).toBe(false);
    expect(
      (
        await a.associe.post(`/api/types-mission/${source.id}/dupliquer`, {
          code: "plan_strategique_pme",
          libelle: "X",
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe("catalogue conseil de départ", () => {
  it("insère grades et 4 types avec 3 à 5 phases, marqués à valider, idempotent", async () => {
    const c = await cabinetTest(ctx, "Cabinet Semis");
    const premier = await ctx.db.withTenant(c.cabinetId, (db) =>
      semerCatalogueConseil(db, c.cabinetId),
    );
    expect(premier).toEqual({ grades: GRADES_DEPART.length, types: TYPES_DEPART.length });
    const second = await ctx.db.withTenant(c.cabinetId, (db) =>
      semerCatalogueConseil(db, c.cabinetId),
    );
    expect(second).toEqual({ grades: 0, types: 0 });

    const types = (await c.associe.get("/api/types-mission")).json().elements;
    expect(types.map((t: { code: string }) => t.code).sort()).toEqual([
      "assistance",
      "audit_organisationnel",
      "formation",
      "plan_strategique",
    ]);
    for (const t of types) {
      expect(t.a_valider).toBe(true);
      const elements = (await c.associe.get(`/api/types-mission/${t.id}`)).json().elements;
      const phases = elements.filter((e: { niveau: number }) => e.niveau === 1);
      expect(phases.length).toBeGreaterThanOrEqual(3);
      expect(phases.length).toBeLessThanOrEqual(5);
      expect(elements.some((e: { niveau: number }) => e.niveau === 3)).toBe(true);
      expect(elements.some((e: { est_livrable: boolean }) => e.est_livrable)).toBe(true);
    }
    const grades = (await c.associe.get("/api/grades/taux")).json().elements;
    expect(grades.map((g: { code: string }) => g.code)).toEqual([
      "stagiaire",
      "junior",
      "senior",
      "manager",
      "directeur",
      "associe",
    ]);
    expect(
      grades.every(
        (g: { a_valider: boolean; devise: string }) => g.a_valider && g.devise === "XOF",
      ),
    ).toBe(true);
  });

  it("les jours types ne référencent que des grades par défaut", () => {
    const codes = new Set(GRADES_DEPART.map((g) => g.code));
    const verifier = (
      els: readonly { jours?: Record<string, number>; enfants?: unknown[] }[],
    ): void => {
      for (const e of els) {
        for (const g of Object.keys(e.jours ?? {})) expect(codes.has(g)).toBe(true);
        verifier((e.enfants ?? []) as typeof els);
      }
    };
    for (const t of TYPES_DEPART) {
      verifier(t.phases);
      for (const m of t.equipe_type) expect(codes.has(m.grade_code)).toBe(true);
    }
  });

  it("semer le catalogue exige cabinet.gerer", async () => {
    const expert = await a.avecRoles(["expert_metier"]);
    expect((await expert.post("/api/catalogue/semer-conseil")).statusCode).toBe(403);
  });
});

describe("isolation du catalogue", () => {
  it("un autre cabinet ne lit, ne modifie ni ne duplique un type par identifiant (404)", async () => {
    const id = (await a.associe.post("/api/types-mission", typeBase("prive_a"))).json().id;
    const el = (
      await a.associe.post(`/api/types-mission/${id}/elements`, { libelle: "Phase" })
    ).json().id;
    expect((await b.associe.get(`/api/types-mission/${id}`)).statusCode).toBe(404);
    expect((await b.associe.patch(`/api/types-mission/${id}`, { libelle: "X" })).statusCode).toBe(
      404,
    );
    expect(
      (await b.associe.post(`/api/types-mission/${id}/dupliquer`, { code: "vol", libelle: "Vol" }))
        .statusCode,
    ).toBe(404);
    expect(
      (await b.associe.post(`/api/types-mission/${id}/elements`, { libelle: "X" })).statusCode,
    ).toBe(404);
    expect(
      (await b.associe.patch(`/api/types-mission/${id}/elements/${el}`, { libelle: "X" }))
        .statusCode,
    ).toBe(404);
    expect((await b.associe.delete(`/api/types-mission/${id}/elements/${el}`)).statusCode).toBe(
      404,
    );
  });

  it("un élément ne peut pas se rattacher à un parent d'un autre cabinet", async () => {
    const idA = (await a.associe.post("/api/types-mission", typeBase("parent_a"))).json().id;
    const phaseA = (
      await a.associe.post(`/api/types-mission/${idA}/elements`, { libelle: "Phase A" })
    ).json().id;
    const idB = (await b.associe.post("/api/types-mission", typeBase("enfant_b"))).json().id;
    const r = await b.associe.post(`/api/types-mission/${idB}/elements`, {
      libelle: "X",
      parent_id: phaseA,
    });
    expect(r.statusCode).toBe(400);
  });
});
