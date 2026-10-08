import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";

/*
 * Date limite des questionnaires (HANDOFF, point 6) : après la date limite
 * (jour UTC, incluse), la saisie et la soumission depuis le portail sont
 * refusées (409 DATE_LIMITE_DEPASSEE, MPQ07) ; le consultant prolonge en
 * repoussant la date limite de l'envoi ; la base garde la soumission.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let versionId: string;
let definition: DefinitionQuestionnaire;

const jour = (decalage: number) =>
  new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);
const hier = () => jour(-1);

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  ({ versionId, definition } = await versionValidee(
    s.consultant,
    "date_limite_prelim",
    "preliminaire_dirigeants",
  ));
}, 180_000);
afterAll(() => ctx.fermer());

const complet = () => reponsesAuNiveau(definition, 4);

describe("date limite dépassée", () => {
  it("refuse la saisie et la soumission avec un code métier, tant que le cabinet ne prolonge pas", async () => {
    const id = await envoyer(
      s.consultant,
      s.missionId,
      versionId,
      [{ utilisateur_id: s.dirigeant.utilisateurId }],
      "individuel",
      { date_limite: hier() },
    );
    const url = `/api/portail/questionnaires/${id}`;
    const saisie = await s.dirigeant.patch(`${url}/reponses`, { reponses: complet() });
    expect(saisie.statusCode).toBe(409);
    expect(saisie.json().erreur.code).toBe("DATE_LIMITE_DEPASSEE");
    const soumission = await s.dirigeant.post(`${url}/soumettre`);
    expect(soumission.statusCode).toBe(409);
    expect(soumission.json().erreur.code).toBe("DATE_LIMITE_DEPASSEE");
    // Lecture toujours possible : le client voit sa date limite.
    const lecture = await s.dirigeant.get(url);
    attendre(200, lecture, "lecture");
    expect(lecture.json().date_limite).toBe(hier());

    // Prolongation par le consultant (action existante : PATCH de l'envoi).
    attendre(
      200,
      await s.consultant.patch(`/api/questionnaires/envois/${id}`, { date_limite: jour(7) }),
      "prolongation",
    );
    attendre(200, await s.dirigeant.patch(`${url}/reponses`, { reponses: complet() }), "saisie");
    const soumis = await s.dirigeant.post(`${url}/soumettre`);
    attendre(200, soumis, "soumission");
    expect(soumis.json().reponse.statut).toBe("soumise");
  });

  it("supprimer la date limite lève aussi le blocage", async () => {
    const id = await envoyer(
      s.consultant,
      s.missionId,
      versionId,
      [{ utilisateur_id: s.contributeur.utilisateurId }],
      "individuel",
      { date_limite: hier() },
    );
    const url = `/api/portail/questionnaires/${id}`;
    expect((await s.contributeur.post(`${url}/soumettre`)).statusCode).toBe(409);
    attendre(
      200,
      await s.consultant.patch(`/api/questionnaires/envois/${id}`, { date_limite: null }),
      "suppression de la date",
    );
    attendre(200, await s.contributeur.patch(`${url}/reponses`, { reponses: complet() }), "saisie");
    attendre(200, await s.contributeur.post(`${url}/soumettre`), "soumission");
  });

  it("collectif : la réponse partagée suit la même règle", async () => {
    const id = await envoyer(
      s.consultant,
      s.missionId,
      versionId,
      [
        { utilisateur_id: s.dirigeant.utilisateurId },
        { utilisateur_id: s.contributeur.utilisateurId },
      ],
      "collectif",
      { date_limite: hier() },
    );
    const url = `/api/portail/questionnaires/${id}`;
    const r = await s.dirigeant.post(`${url}/soumettre`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("DATE_LIMITE_DEPASSEE");
  });
});

describe("date limite respectée", () => {
  it("le jour même et avant la date limite, la soumission passe", async () => {
    for (const [i, date] of [jour(0), jour(30)].entries()) {
      const id = await envoyer(
        s.consultant,
        s.missionId,
        versionId,
        [{ utilisateur_id: i === 0 ? s.dirigeant.utilisateurId : s.contributeur.utilisateurId }],
        "individuel",
        { date_limite: date },
      );
      const u = i === 0 ? s.dirigeant : s.contributeur;
      const url = `/api/portail/questionnaires/${id}`;
      attendre(200, await u.patch(`${url}/reponses`, { reponses: complet() }), "saisie");
      attendre(200, await u.post(`${url}/soumettre`), `soumission ${date}`);
    }
  });
});

describe("garde en base", () => {
  it("le déclencheur MPQ07 refuse la soumission après la date limite, même hors application", async () => {
    const id = await envoyer(
      s.consultant,
      s.missionId,
      versionId,
      [{ utilisateur_id: s.dirigeant.utilisateurId }],
      "individuel",
      { date_limite: jour(5) },
    );
    attendre(
      200,
      await s.dirigeant.patch(`/api/portail/questionnaires/${id}/reponses`, {
        reponses: complet(),
      }),
      "saisie",
    );
    const code = await proprietaire(async (c) => {
      await c.query("UPDATE questionnaire_envois SET date_limite = $2 WHERE id = $1", [id, hier()]);
      try {
        await c.query(
          `UPDATE questionnaire_reponses SET statut = 'soumise', soumise_par = modifie_par,
             soumise_le = now() WHERE envoi_id = $1`,
          [id],
        );
        return "aucune";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(code).toBe("MPQ07");
  });
});
