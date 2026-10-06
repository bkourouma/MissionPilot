import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import { demarrer, type Contexte } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";

/*
 * Questionnaire collectif (DECISIONS.md, V2) : UNE réponse partagée que les
 * répondants complètent ensemble, verrouillée à la PREMIÈRE soumission.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let definition: DefinitionQuestionnaire;
let envoiId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  const v = await versionValidee(s.consultant, "collectif_notation");
  definition = v.definition;
  envoiId = await envoyer(
    s.consultant,
    s.missionId,
    v.versionId,
    [
      { utilisateur_id: s.dirigeant.utilisateurId },
      { utilisateur_id: s.contributeur.utilisateurId },
    ],
    "collectif",
  );
}, 180_000);
afterAll(() => ctx.fermer());

describe("questionnaire collectif", () => {
  it("les saisies des répondants se fusionnent dans une réponse partagée", async () => {
    const url = `/api/portail/questionnaires/${envoiId}/reponses`;
    attendre(
      200,
      await s.dirigeant.patch(url, { reponses: { "strat.plan_formalise": true } }),
      "a",
    );
    const r = await s.contributeur.patch(url, { reponses: { "proc.cartographie": 3 } });
    expect(r.statusCode).toBe(200);
    const lu = await s.dirigeant.get(`/api/portail/questionnaires/${envoiId}`);
    expect(lu.json().reponse.reponses).toMatchObject({
      "strat.plan_formalise": true,
      "proc.cartographie": 3,
    });
    expect(JSON.stringify(lu.json())).not.toMatch(/saisies|auteur/);
    const detail = await s.consultant.get(`/api/questionnaires/envois/${envoiId}`);
    expect(detail.json().reponse_collective.statut).toBe("brouillon");
    expect(detail.json().completude).toEqual({ attendues: 1, soumises: 0, complet: false });
  });

  it("une valeur vide efface ; une valeur invalide fait refuser toute la contribution", async () => {
    const url = `/api/portail/questionnaires/${envoiId}/reponses`;
    const refus = await s.contributeur.patch(url, {
      reponses: { "proc.cartographie": 99, "strat.plan_formalise": false },
    });
    expect(refus.statusCode).toBe(400);
    const lu = await s.contributeur.get(`/api/portail/questionnaires/${envoiId}`);
    expect(lu.json().reponse.reponses["strat.plan_formalise"]).toBe(true);
    const efface = await s.contributeur.patch(url, { reponses: { "proc.cartographie": null } });
    expect(efface.json().reponse.reponses).not.toHaveProperty("proc.cartographie");
  });

  it("verrouillée à la première soumission : plus de saisie ni de seconde soumission", async () => {
    attendre(
      200,
      await s.contributeur.patch(`/api/portail/questionnaires/${envoiId}/reponses`, {
        reponses: reponsesAuNiveau(definition, 3),
      }),
      "saisie complète",
    );
    const soumis = await s.contributeur.post(`/api/portail/questionnaires/${envoiId}/soumettre`);
    expect(soumis.statusCode).toBe(200);
    expect(soumis.json().reponse.soumission).toMatchObject({ par_moi: true });
    const vu = await s.dirigeant.get(`/api/portail/questionnaires/${envoiId}`);
    expect(vu.json().reponse).toMatchObject({ statut: "soumise", soumission: { par_moi: false } });
    const saisie = await s.dirigeant.patch(`/api/portail/questionnaires/${envoiId}/reponses`, {
      reponses: { "strat.plan_formalise": false },
    });
    expect(saisie.statusCode).toBe(409);
    expect(saisie.json().erreur.code).toBe("QUESTIONNAIRE_DEJA_SOUMIS");
    const seconde = await s.dirigeant.post(`/api/portail/questionnaires/${envoiId}/soumettre`);
    expect(seconde.statusCode).toBe(409);
    const detail = await s.consultant.get(`/api/questionnaires/envois/${envoiId}`);
    expect(detail.json().completude).toEqual({ attendues: 1, soumises: 1, complet: true });
    const reponses = await s.consultant.get(`/api/questionnaires/envois/${envoiId}/reponses`);
    expect(reponses.json().elements).toHaveLength(1);
    expect(reponses.json().elements[0].repondant).toBeNull();
  });

  it("la relance manuelle ne vise plus personne une fois la réponse partagée soumise", async () => {
    const r = await s.consultant.post(`/api/questionnaires/envois/${envoiId}/relancer`, {});
    expect(r.statusCode).toBe(409);
  });

  it("une réponse collective ne reçoit pas de répondant ni de doublon (déclencheur et index)", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO questionnaire_reponses (cabinet_id, envoi_id, repondant_id, client_id, modifie_par)
           SELECT $1, $2, r.id, r.client_id, $3 FROM questionnaire_repondants r WHERE r.envoi_id = $2 LIMIT 1`,
          [s.a.cabinetId, envoiId, s.a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPQ04" });
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO questionnaire_reponses (cabinet_id, envoi_id, repondant_id, client_id, modifie_par)
           VALUES ($1, $2, NULL, $3, $4)`,
          [s.a.cabinetId, envoiId, s.a.clientId, s.a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
