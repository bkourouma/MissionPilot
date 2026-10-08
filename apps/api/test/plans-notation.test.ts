import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forcesEtFaiblesses, type DefinitionQuestionnaire } from "@missionpilot/engines";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  repondre,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";

/*
 * Diagnostic du plan lié à une notation PUBLIÉE (0182) : seules les versions
 * publiées des notations du client du plan, dont la mission est visible, se
 * lient ; score, classe, forces et faiblesses viennent du moteur de notation ;
 * historique en ajout seul ; partage du plan retiré au changement de lien ;
 * droits, autre client et autre cabinet.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let definition: DefinitionQuestionnaire;
let notationId: string;
let publieeId: string;
let brouillonId: string;
let planId: string;
let planA2: string;

const lien = (id = planId) => `/api/plans/${id}/diagnostic/notation`;
const proposees = (id = planId) => `/api/plans/${id}/diagnostic/notations-publiees`;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  const v = await versionValidee(s.consultant, "plan_diagnostic");
  definition = v.definition;
  const envoiId = await envoyer(s.consultant, s.missionId, v.versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId },
  ]);
  await repondre(s.dirigeant, envoiId, reponsesAuNiveau(definition, 4));
  const n = await s.consultant.post(`/api/missions/${s.missionId}/notation`, {});
  attendre(201, n, "notation");
  notationId = n.json().id;
  const c1 = await s.consultant.post(`/api/notations/${notationId}/calculs`, {
    envoi_id: envoiId,
  });
  attendre(201, c1, "calcul");
  publieeId = c1.json().id;
  attendre(200, await s.consultant.post(`/api/notations/${notationId}/soumettre`), "soumission");
  attendre(200, await s.expert.post(`/api/notations/${notationId}/publier`), "publication");
  const c2 = await s.consultant.post(`/api/notations/${notationId}/calculs`, {
    envoi_id: envoiId,
    strategie: "penaliser",
  });
  attendre(201, c2, "second calcul");
  brouillonId = c2.json().id;
  const p = await s.a.chef.post(`/api/missions/${s.missionId}/plans`, {
    titre: "Plan diagnostiqué",
  });
  attendre(201, p, "plan");
  planId = p.json().id;
  const missionA2 = (await creerMission(s.a, { intitule: "Mission A2", client_id: s.clientA2 })).id;
  const p2 = await s.a.chef.post(`/api/missions/${missionA2}/plans`, { titre: "Plan A2" });
  attendre(201, p2, "plan A2");
  planA2 = p2.json().id;
}, 180_000);

afterAll(() => ctx.fermer());

describe("lien du diagnostic : droits", () => {
  it("401 sans session ; 403 sans plan.* ; 403 pour écrire sans plan.ecrire", async () => {
    expect((await s.anonyme.get(lien())).statusCode).toBe(401);
    expect((await s.anonyme.put(lien(), { notation_version_id: publieeId })).statusCode).toBe(401);
    expect((await s.gestionnaire.get(lien())).statusCode).toBe(403);
    expect((await s.gestionnaire.get(proposees())).statusCode).toBe(403);
    // L'expert métier lit le plan et la notation, il ne rédige pas le plan.
    expect((await s.expert.get(lien())).statusCode).toBe(200);
    expect((await s.expert.put(lien(), { notation_version_id: publieeId })).statusCode).toBe(403);
  });

  it("hors équipe et autre cabinet : 404", async () => {
    expect((await s.horsEquipe.get(lien())).statusCode).toBe(404);
    expect((await s.b.associe.get(lien())).statusCode).toBe(404);
    expect((await s.b.associe.get(proposees())).statusCode).toBe(404);
    expect((await s.b.associe.put(lien(), { notation_version_id: publieeId })).statusCode).toBe(
      404,
    );
  });
});

describe("lien du diagnostic : notation publiée du client", () => {
  it("aucun lien au départ ; seule la version publiée est proposée, chiffres du moteur", async () => {
    const l = await s.consultant.get(lien());
    attendre(200, l, "lien");
    expect(l.json()).toEqual({ plan_id: planId, lien: null, modifie_le: null });
    const p = await s.consultant.get(proposees());
    attendre(200, p, "proposées");
    expect(p.json().elements.map((e: { version_id: string }) => e.version_id)).toEqual([publieeId]);
    const version = (
      await s.consultant.get(`/api/notations/${notationId}/version?version=1`)
    ).json();
    const e = p.json().elements[0];
    expect(e).toMatchObject({
      notation_id: notationId,
      numero: 1,
      mission_id: s.missionId,
      score: version.score.score,
      classe: version.score.classe,
    });
    expect(e.forces).toEqual(JSON.parse(JSON.stringify(forcesEtFaiblesses(version.score).forces)));
    // Autre client : rien à proposer.
    const autre = await s.a.chef.get(proposees(planA2));
    expect(autre.json().elements).toEqual([]);
  });

  it("refuse une version non publiée (409), inconnue ou d'un autre client (404)", async () => {
    const r = await s.consultant.put(lien(), { notation_version_id: brouillonId });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("NOTATION_NON_PUBLIEE");
    expect(
      (await s.consultant.put(lien(), { notation_version_id: crypto.randomUUID() })).statusCode,
    ).toBe(404);
    expect((await s.a.chef.put(lien(planA2), { notation_version_id: publieeId })).statusCode).toBe(
      404,
    );
    expect((await s.consultant.put(lien(), { notation_version_id: "x" })).statusCode).toBe(400);
    expect((await s.consultant.put(lien(), {})).statusCode).toBe(400);
  });

  it("lie la version publiée ; un plan partagé perd son partage", async () => {
    // Partage du plan : un diagnostic validé par le directeur (dispensé), puis partage.
    const d = await s.a.chef.post(`/api/plans/${planId}/elements`, {
      type: "diagnostic",
      donnees: { synthese: "Organisation solide, pilotage à renforcer." },
    });
    attendre(201, d, "diagnostic");
    attendre(
      200,
      await s.a.directeur.post(`/api/plans/${planId}/elements/${d.json().id}/validation`),
      "validation",
    );
    attendre(
      200,
      await s.a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true }),
      "partage",
    );

    const r = await s.consultant.put(lien(), { notation_version_id: publieeId });
    attendre(200, r, "lien");
    expect(r.json().lien).toMatchObject({
      accessible: true,
      lie_par: { id: s.consultant.utilisateurId },
      notation: { version_id: publieeId, numero: 1, mission_id: s.missionId },
    });
    expect((await s.consultant.get(lien())).json()).toEqual(r.json());
    expect((await s.a.chef.get(`/api/plans/${planId}`)).json().partage_client).toBe(false);
    const doublon = await s.consultant.put(lien(), { notation_version_id: publieeId });
    expect(doublon.statusCode).toBe(409);
  });

  it("retire le lien (null), historique conservé et journalisé", async () => {
    const r = await s.consultant.put(lien(), { notation_version_id: null });
    attendre(200, r, "retrait");
    expect(r.json().lien).toBeNull();
    expect((await s.consultant.put(lien(), { notation_version_id: null })).statusCode).toBe(409);
    const lignes = await proprietaire((c) =>
      c.query(
        "SELECT rang, notation_version_id FROM plan_diagnostic_notations WHERE plan_id = $1 ORDER BY rang",
        [planId],
      ),
    );
    expect(lignes.rows).toEqual([
      { rang: 1, notation_version_id: publieeId },
      { rang: 2, notation_version_id: null },
    ]);
    const journal = await proprietaire((c) =>
      c.query(
        `SELECT action FROM journal_audit WHERE entite_id = $1
           AND action LIKE 'plan.diagnostic.%' ORDER BY id`,
        [planId],
      ),
    );
    expect(journal.rows.map((l) => l.action)).toEqual([
      "plan.diagnostic.lier_notation",
      "plan.diagnostic.delier_notation",
    ]);
  });
});

describe("garanties en base du lien", () => {
  it("ajout seul (MPS01) et refus d'une version non publiée ou d'un autre client (MPS06)", async () => {
    for (const sql of [
      "UPDATE plan_diagnostic_notations SET rang = 9",
      "DELETE FROM plan_diagnostic_notations",
    ]) {
      await expect(
        ctx.db.withTenant(s.a.cabinetId, (db) => db.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/);
    }
    await proprietaire(async (c) => {
      await expect(c.query("DELETE FROM plan_diagnostic_notations")).rejects.toMatchObject({
        code: "MPS01",
      });
    });
    const inserer = (plan: string, version: string, rang: number) =>
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO plan_diagnostic_notations (cabinet_id, plan_id, rang, notation_version_id, lie_par)
           VALUES ($1, $2, $3, $4, $5)`,
          [s.a.cabinetId, plan, rang, version, s.consultant.utilisateurId],
        ),
      );
    await expect(inserer(planId, brouillonId, 3)).rejects.toMatchObject({ code: "MPS06" });
    await expect(inserer(planA2, publieeId, 1)).rejects.toMatchObject({ code: "MPS06" });
    await expect(inserer(planId, publieeId, 7)).rejects.toMatchObject({ code: "MPS02" });
  });
});
