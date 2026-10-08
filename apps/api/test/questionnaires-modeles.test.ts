import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUESTIONNAIRE_NOTATION_GENERIQUE } from "@missionpilot/shared";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import { preparerQuestionnaires, type ScenarioQuestionnaires } from "./questionnaires-outils.js";

/*
 * Modèles de questionnaires (SOC-10) : droits, isolation, définition validée
 * par le moteur, versions brouillon puis validées et figées.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
const INCONNU = "00000000-0000-4000-8000-000000000000";

const definitionSimple = {
  id: "ignore",
  version: 99,
  titre: "Diagnostic express",
  sections: [
    {
      id: "s1",
      titre: "Organisation",
      questions: [
        { id: "q1", type: "oui_non", libelle: "Un organigramme existe-t-il ?", obligatoire: true },
        {
          id: "q2",
          type: "likert",
          libelle: "Les rôles sont-ils clairs ?",
          obligatoire: true,
          points: 3,
          libelles: ["Non", "En partie", "Oui"],
          condition: { op: "egal", question: "q1", valeur: true },
        },
      ],
    },
  ],
};

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
}, 180_000);
afterAll(() => ctx.fermer());

describe("modèles de questionnaires : droits et isolation", () => {
  it("401 sans session ; 403 sans questionnaire.lire ; 403 en écriture pour l'expert métier", async () => {
    expect((await s.anonyme.get("/api/questionnaires/modeles")).statusCode).toBe(401);
    expect((await s.gestionnaire.get("/api/questionnaires/modeles")).statusCode).toBe(403);
    expect((await s.expert.get("/api/questionnaires/modeles")).statusCode).toBe(200);
    const r = await s.expert.post("/api/questionnaires/modeles", {
      code: "interdit",
      source: { type: "gabarit", gabarit: "notation_generique" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("un utilisateur du portail n'atteint pas les routes internes (403 avant tout accès)", async () => {
    const r = await s.dirigeant.get("/api/questionnaires/modeles");
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
  });

  it("copie d'un gabarit : version 1 en brouillon, identifiant et version posés par le serveur", async () => {
    const r = await s.consultant.post("/api/questionnaires/modeles", {
      code: "notation_entree",
      source: { type: "gabarit", gabarit: "notation_generique" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ code: "notation_entree", origine: "gabarit" });
    expect(r.json().versions).toHaveLength(1);
    const v = await s.consultant.get(`/api/questionnaires/versions/${r.json().versions[0].id}`);
    expect(v.json()).toMatchObject({ statut: "brouillon", version: 1 });
    expect(v.json().definition.id).toBe("notation_entree");
    expect(v.json().definition.version).toBe(1);
    expect(v.json().definition.sections).toEqual(QUESTIONNAIRE_NOTATION_GENERIQUE.sections);
    const doublon = await s.consultant.post("/api/questionnaires/modeles", {
      code: "notation_entree",
      source: { type: "gabarit", gabarit: "preliminaire_dirigeants" },
    });
    expect(doublon.statusCode).toBe(409);
  });

  it("un autre cabinet ne lit ni ne copie un modèle (404)", async () => {
    const r = await s.consultant.post("/api/questionnaires/modeles", {
      code: "prive_a",
      source: { type: "definition", definition: definitionSimple },
    });
    attendre(201, r, "modèle");
    const id = r.json().id as string;
    expect((await s.b.associe.get(`/api/questionnaires/modeles/${id}`)).statusCode).toBe(404);
    expect(
      (await s.b.associe.get(`/api/questionnaires/versions/${r.json().versions[0].id}`)).statusCode,
    ).toBe(404);
    const copie = await s.b.associe.post("/api/questionnaires/modeles", {
      code: "vol",
      source: { type: "copie", modele_id: id },
    });
    expect(copie.statusCode).toBe(404);
    expect((await s.b.associe.get(`/api/questionnaires/modeles/${INCONNU}`)).statusCode).toBe(404);
    const liste = await s.b.associe.get("/api/questionnaires/modeles");
    expect(liste.json().elements.map((m: { id: string }) => m.id)).not.toContain(id);
  });
});

describe("définition contrôlée par le moteur, versions figées", () => {
  it("une définition incohérente (référence inconnue) est refusée avec le détail", async () => {
    const def = structuredClone(definitionSimple);
    def.sections[0]!.questions[1]!.condition = { op: "egal", question: "inconnue", valeur: true };
    const r = await s.consultant.post("/api/questionnaires/modeles", {
      code: "incoherent",
      source: { type: "definition", definition: def },
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json().erreur.details)).toMatch(/REFERENCE_INCONNUE/);
  });

  it("brouillon modifiable, validation, puis version figée ; nouvelle version par copie", async () => {
    const m = await s.a.chef.post("/api/questionnaires/modeles", {
      code: "express",
      source: { type: "definition", definition: definitionSimple },
    });
    attendre(201, m, "modèle");
    const v1 = m.json().versions[0].id as string;
    const modif = await s.consultant.put(`/api/questionnaires/versions/${v1}`, {
      definition: { ...definitionSimple, titre: "Diagnostic express (révisé)" },
    });
    expect(modif.statusCode).toBe(200);
    expect(modif.json().definition.titre).toBe("Diagnostic express (révisé)");
    expect((await s.consultant.post(`/api/questionnaires/versions/${v1}/valider`)).statusCode).toBe(
      200,
    );
    const refus = await s.consultant.put(`/api/questionnaires/versions/${v1}`, {
      definition: definitionSimple,
    });
    expect(refus.statusCode).toBe(409);
    expect((await s.consultant.post(`/api/questionnaires/versions/${v1}/valider`)).statusCode).toBe(
      409,
    );
    const v2 = await s.consultant.post(`/api/questionnaires/modeles/${m.json().id}/versions`, {});
    expect(v2.statusCode).toBe(201);
    expect(v2.json()).toMatchObject({ version: 2, statut: "brouillon" });
    expect(v2.json().definition.titre).toBe("Diagnostic express (révisé)");
    const deuxieme = await s.consultant.post(
      `/api/questionnaires/modeles/${m.json().id}/versions`,
      {},
    );
    expect(deuxieme.statusCode).toBe(409);
    const detail = await s.expert.get(`/api/questionnaires/modeles/${m.json().id}`);
    expect(detail.json().versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it("une version validée est figée en base (MPQ01), même hors de l'API", async () => {
    const m = await s.consultant.post("/api/questionnaires/modeles", {
      code: "fige",
      source: { type: "definition", definition: definitionSimple },
    });
    const id = m.json().versions[0].id as string;
    attendre(200, await s.consultant.post(`/api/questionnaires/versions/${id}/valider`), "valider");
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE questionnaire_versions SET definition = '{}'::jsonb WHERE id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPQ01" });
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("DELETE FROM questionnaire_versions WHERE id = $1", [id]),
      ),
    ).rejects.toThrow();
    await expect(
      proprietaire((c) =>
        c.query("UPDATE questionnaire_versions SET statut = 'brouillon' WHERE id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPQ01" });
    // Le modèle lui-même : seul le titre change (code, origine, copie, auteur figés).
    const modifier = (set: string) =>
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(`UPDATE questionnaire_modeles SET ${set} WHERE id = $1`, [m.json().id]),
      );
    await expect(modifier("code = 'fige_detourne'")).rejects.toMatchObject({ code: "MPQ01" });
    await expect(modifier("origine = 'copie', copie_de = id")).rejects.toMatchObject({
      code: "MPQ01",
    });
    await expect(modifier(`cree_par = '${s.a.associeId}'`)).rejects.toMatchObject({
      code: "MPQ01",
    });
    expect((await modifier("titre = 'Titre repris', modifie_le = now()")).rowCount).toBe(1);
  });

  it("condition imbriquée sur 1 Mio (« non » en cascade) : 400 avant toute récursion, sans débordement de pile", async () => {
    // Corps JSON construit en texte : sa construction ne doit pas récurser non plus.
    const ouvrant = '{"op":"non","condition":';
    const feuille = '{"op":"vide","question":"q1"}';
    /** Définition simple dont la question q2 porte cette condition. */
    const avecCondition = (condition: unknown) => {
      const def = structuredClone(definitionSimple);
      (def.sections[0]?.questions[1] as { condition?: unknown }).condition = condition;
      return def;
    };
    const enveloppe = (condition: string) =>
      JSON.stringify({
        code: "imbrication",
        source: { type: "definition", definition: avecCondition("@@") },
      }).replace('"@@"', condition);
    const vide = enveloppe("").length;
    const niveaux = Math.floor((1_048_576 - vide - feuille.length - 64) / (ouvrant.length + 1));
    const corps = enveloppe(`${ouvrant.repeat(niveaux)}${feuille}${"}".repeat(niveaux)}`);
    expect(corps.length).toBeGreaterThan(1_000_000);
    expect(corps.length).toBeLessThan(1_048_576);
    const r = await s.consultant.brut({
      method: "POST",
      url: "/api/questionnaires/modeles",
      payload: corps,
      headers: { "content-type": "application/json" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("REQUETE_INVALIDE");
    expect(JSON.stringify(r.json().erreur)).toMatch(/trop imbriquée/);
    // Limite : 5 niveaux acceptés, 6 refusés par le schéma.
    const imbriquer = (n: number) =>
      JSON.parse(`${ouvrant.repeat(n - 1)}${feuille}${"}".repeat(n - 1)}`) as unknown;
    const avec = (condition: unknown, code: string) =>
      s.consultant.post("/api/questionnaires/modeles", {
        code,
        source: { type: "definition", definition: avecCondition(condition) },
      });
    expect((await avec(imbriquer(5), "imbrication_cinq")).statusCode).toBe(201);
    const six = await avec(imbriquer(6), "imbrication_six");
    expect(six.statusCode).toBe(400);
    expect(JSON.stringify(six.json().erreur)).toMatch(/trop imbriquée/);
  });

  it("liste paginée par curseur et gabarits disponibles", async () => {
    const p1 = await s.consultant.get("/api/questionnaires/modeles?limite=2");
    expect(p1.statusCode).toBe(200);
    expect(p1.json().elements).toHaveLength(2);
    expect(p1.json().curseur_suivant).toBeTruthy();
    const p2 = await s.consultant.get(
      `/api/questionnaires/modeles?limite=2&curseur=${p1.json().curseur_suivant}`,
    );
    const ids = [...p1.json().elements, ...p2.json().elements].map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const g = await s.expert.get("/api/questionnaires/gabarits");
    expect(g.json().elements.map((x: { code: string }) => x.code)).toEqual([
      "notation_generique",
      "preliminaire_dirigeants",
    ]);
  });
});
