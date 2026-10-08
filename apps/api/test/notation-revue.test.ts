import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  comparerNotations,
  donneesRapport,
  type DefinitionQuestionnaire,
} from "@missionpilot/engines";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  ajouterEquipe,
  envoyer,
  preparerQuestionnaires,
  repondre,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";

/*
 * Revue et publication d'une notation (NOT-07) : brouillon → en revue →
 * publiée par un expert métier, séparation des tâches (ni l'auteur du calcul,
 * ni d'un ajustement, ni de la soumission), immuabilité de la version
 * publiée, données du rapport et comparaison avec la notation précédente
 * (NOT-06) dans le respect de la visibilité des missions.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let versionId: string;
let definition: DefinitionQuestionnaire;
let envoiId: string;
let notationId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  ({ versionId, definition } = await versionValidee(s.consultant, "notation_revue"));
  envoiId = await envoyer(s.consultant, s.missionId, versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId },
    { utilisateur_id: s.contributeur.utilisateurId },
  ]);
  await repondre(s.dirigeant, envoiId, reponsesAuNiveau(definition, 3));
  await repondre(s.contributeur, envoiId, reponsesAuNiveau(definition, 2));
  const n = await s.consultant.post(`/api/missions/${s.missionId}/notation`, {});
  attendre(201, n, "notation");
  notationId = n.json().id;
  attendre(
    201,
    await s.consultant.post(`/api/notations/${notationId}/calculs`, { envoi_id: envoiId }),
    "calcul",
  );
}, 180_000);
afterAll(() => ctx.fermer());

const url = (action: string) => `/api/notations/${notationId}/${action}`;

describe("revue : brouillon → en revue → publiée", () => {
  it("soumission par notation.gerer ; en revue, ni ajustement ni recalcul", async () => {
    expect((await s.expert.post(url("soumettre"))).statusCode).toBe(403);
    const r = await s.consultant.post(url("soumettre"));
    expect(r.statusCode).toBe(200);
    expect(r.json().statut).toBe("en_revue");
    expect((await s.consultant.post(url("soumettre"))).statusCode).toBe(409);
    const dimension = r.json().resultat.dimensions[0].dimension;
    const aj = await s.consultant.post(url("ajustements"), { dimension, delta: 1, motif: "x" });
    expect(aj.statusCode).toBe(409);
    expect((await s.consultant.post(url("calculs"), { envoi_id: envoiId })).statusCode).toBe(409);
  });

  it("renvoi motivé par l'expert ; le consultant ne publie pas (403)", async () => {
    expect((await s.consultant.post(url("publier"))).statusCode).toBe(403);
    expect((await s.consultant.post(url("renvoyer"), { motif: "x" })).statusCode).toBe(403);
    expect((await s.expert.post(url("renvoyer"), {})).statusCode).toBe(400);
    const r = await s.expert.post(url("renvoyer"), { motif: "Justifier l'écart sur le pilotage." });
    expect(r.statusCode).toBe(200);
    expect(r.json().statut).toBe("brouillon");
    expect(r.json().revue.map((e: { action: string }) => e.action)).toEqual([
      "soumission",
      "renvoi",
    ]);
  });

  it("l'expert qui a ajusté ne publie pas : séparation des tâches (403)", async () => {
    const v = (await s.consultant.get(url("version"))).json();
    const dimension = v.resultat.dimensions.find((d: { notable: boolean }) => d.notable).dimension;
    attendre(
      201,
      await s.consultant.post(url("ajustements"), {
        dimension,
        delta: 3,
        motif: "Entretien avec le directeur : revue trimestrielle effective.",
      }),
      "ajustement",
    );
    attendre(200, await s.consultant.post(url("soumettre")), "soumission");
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO notation_evenements (cabinet_id, version_id, rang, action, par)
           VALUES ($1, $2, 4, 'publication', $3)`,
          [s.a.cabinetId, v.id, s.consultant.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPN04" });
  });

  it("publication par l'expert : version immuable, rapport = moteur", async () => {
    const r = await s.expert.post(url("publier"));
    expect(r.statusCode).toBe(200);
    expect(r.json().statut).toBe("publiee");
    expect((await s.expert2.post(url("publier"))).statusCode).toBe(409);
    const dimension = r.json().resultat.dimensions[0].dimension;
    expect(
      (await s.consultant.post(url("ajustements"), { dimension, delta: 1, motif: "x" })).statusCode,
    ).toBe(409);
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO notation_ajustements (cabinet_id, version_id, rang, dimension, delta, motif,
             date_ajustement, score_avant, score_apres, plafonne, auteur_id)
           VALUES ($1, $2, 2, $3, 1, 'contournement', '2026-10-06', 50, 51, false, $4)`,
          [s.a.cabinetId, r.json().id, dimension, s.consultant.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPN02" });

    const rapport = await s.expert.get(url("rapport"));
    expect(rapport.statusCode).toBe(200);
    const score = r.json().score;
    expect(rapport.json().donnees).toEqual(JSON.parse(JSON.stringify(donneesRapport(score))));
    expect(rapport.json().donnees.radar).toHaveLength(score.dimensions.length);
    expect(rapport.json().version).toMatchObject({ numero: 1, statut: "publiee" });
    expect(rapport.json().comparaison).toBeNull();
  });

  it("une correction passe par un nouveau calcul ; la version publiée reste publiée", async () => {
    const r = await s.consultant.post(url("calculs"), {
      envoi_id: envoiId,
      strategie: "penaliser",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ numero: 2, statut: "brouillon", strategie: "penaliser" });
    const resume = await s.expert.get(`/api/missions/${s.missionId}/notation`);
    expect(
      resume.json().versions.map((v: { numero: number; statut: string }) => [v.numero, v.statut]),
    ).toEqual([
      [2, "brouillon"],
      [1, "publiee"],
    ]);
    expect((await s.expert.get(url("rapport"))).json().version.numero).toBe(1);
    expect((await s.expert.get(`${url("rapport")}?version=2`)).json().version).toMatchObject({
      numero: 2,
      statut: "brouillon",
    });
  });

  it("l'associé auteur du calcul ne publie pas ; un autre expert, oui", async () => {
    attendre(201, await s.a.associe.post(url("calculs"), { envoi_id: envoiId }), "calcul associé");
    attendre(200, await s.a.associe.post(url("soumettre")), "soumission associé");
    const refus = await s.a.associe.post(url("publier"));
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("EXPERT_METIER_REQUIS");
    const ok = await s.expert2.post(url("publier"));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ numero: 3, statut: "publiee" });
    const resume = await s.expert.get(`/api/missions/${s.missionId}/notation`);
    expect(resume.json().versions.map((v: { statut: string }) => v.statut)).toEqual([
      "publiee",
      "remplacee",
      "publiee",
    ]);
  });
});

describe("comparaison avec la notation précédente du client (NOT-06)", () => {
  it("rapport de sortie comparé à la notation publiée précédente, missions visibles seulement", async () => {
    const mission2 = (await creerMission(s.a, { intitule: "Notation de sortie" })).id;
    const consultant2 = await s.a.avecRoles(["consultant"]);
    for (const u of [s.consultant, consultant2, s.expert]) {
      await ajouterEquipe(s.a, mission2, u.utilisateurId);
    }
    const envoi2 = await envoyer(s.consultant, mission2, versionId, [
      { utilisateur_id: s.dirigeant.utilisateurId },
    ]);
    await repondre(s.dirigeant, envoi2, reponsesAuNiveau(definition, 5));
    const n2 = await s.consultant.post(`/api/missions/${mission2}/notation`, {});
    const id2 = n2.json().id as string;
    attendre(
      201,
      await s.consultant.post(`/api/notations/${id2}/calculs`, { envoi_id: envoi2 }),
      "calcul",
    );
    attendre(200, await s.consultant.post(`/api/notations/${id2}/soumettre`), "soumission");
    const publiee = await s.expert.post(`/api/notations/${id2}/publier`);
    attendre(200, publiee, "publication");

    const rapport = await s.expert.get(`/api/notations/${id2}/rapport`);
    expect(rapport.statusCode).toBe(200);
    const comparaison = rapport.json().comparaison;
    expect(comparaison.precedente).toMatchObject({ notation_id: notationId, numero: 3 });
    const avant = (await s.expert.get(`/api/notations/${notationId}/version?version=3`)).json()
      .score;
    const attendu = comparerNotations(avant, publiee.json().score);
    expect({ ...comparaison, precedente: undefined }).toEqual({
      ...JSON.parse(JSON.stringify(attendu)),
      precedente: undefined,
    });
    expect(comparaison.global.evolution).toBe("hausse");

    // consultant2 ne voit pas la première mission : pas de comparaison qui la révélerait.
    const sansVisibilite = await consultant2.get(`/api/notations/${id2}/rapport`);
    expect(sansVisibilite.statusCode).toBe(200);
    expect(sansVisibilite.json().comparaison).toBeNull();
    expect((await consultant2.get(`/api/notations/${notationId}/rapport`)).statusCode).toBe(404);
  });

  it("les étapes de notation sont journalisées", async () => {
    const actions = await ctx.db.withTenant(s.a.cabinetId, async (db) =>
      (
        await db.query(
          "SELECT action FROM journal_audit WHERE entite = 'notation' AND entite_id = $1 ORDER BY cree_le, id",
          [notationId],
        )
      ).rows.map((l) => l.action as string),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "creation",
        "calcul",
        "ajustement",
        "notation_soumission",
        "notation_renvoi",
        "notation_publication",
      ]),
    );
  });
});

describe("publication réservée à l'expert métier (NOT-07, DECISIONS.md)", () => {
  let mission3: string;
  let envoi3: string;
  let id3: string;
  const url3 = (action: string) => `/api/notations/${id3}/${action}`;
  const publierEnBase = (versionId: string, rang: number, par: string) =>
    ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `INSERT INTO notation_evenements (cabinet_id, version_id, rang, action, par)
         VALUES ($1, $2, $3, 'publication', $4)`,
        [s.a.cabinetId, versionId, rang, par],
      ),
    );

  it("un associé NON auteur ne publie ni ne renvoie (403, doublé en base) ; un expert non auteur publie", async () => {
    mission3 = (await creerMission(s.a, { intitule: "Notation relue par l'expert" })).id;
    for (const u of [s.consultant, s.expert, s.expert2]) {
      await ajouterEquipe(s.a, mission3, u.utilisateurId);
    }
    envoi3 = await envoyer(s.consultant, mission3, versionId, [
      { utilisateur_id: s.dirigeant.utilisateurId },
    ]);
    await repondre(s.dirigeant, envoi3, reponsesAuNiveau(definition, 4));
    const n = await s.consultant.post(`/api/missions/${mission3}/notation`, {});
    attendre(201, n, "notation");
    id3 = n.json().id as string;
    attendre(201, await s.consultant.post(url3("calculs"), { envoi_id: envoi3 }), "calcul");
    const soumise = await s.consultant.post(url3("soumettre"));
    attendre(200, soumise, "soumission");

    // L'associé détient « notation.publier » mais n'est pas expert métier.
    const refus = await s.a.associe.post(url3("publier"));
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("EXPERT_METIER_REQUIS");
    const renvoi = await s.a.associe.post(url3("renvoyer"), { motif: "Contournement" });
    expect(renvoi.statusCode).toBe(403);
    expect(renvoi.json().erreur.code).toBe("EXPERT_METIER_REQUIS");
    await expect(publierEnBase(soumise.json().id, 2, s.a.associeId)).rejects.toMatchObject({
      code: "MPN04",
    });

    const ok = await s.expert.post(url3("publier"));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ numero: 1, statut: "publiee" });
    expect(ok.json().revue.map((e: { action: string }) => e.action)).toEqual([
      "soumission",
      "publication",
    ]);
  });

  it("un expert métier auteur du calcul ne publie pas : la séparation des tâches reste", async () => {
    const hybride = await s.a.avecRoles(["consultant", "expert_metier"]);
    await ajouterEquipe(s.a, mission3, hybride.utilisateurId);
    const calcul = await hybride.post(url3("calculs"), { envoi_id: envoi3 });
    attendre(201, calcul, "calcul de l'expert");
    attendre(200, await s.consultant.post(url3("soumettre")), "soumission");
    const refus = await hybride.post(url3("publier"));
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    await expect(publierEnBase(calcul.json().id, 2, hybride.utilisateurId)).rejects.toMatchObject({
      code: "MPN04",
    });
    const ok = await s.expert2.post(url3("publier"));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ numero: 2, statut: "publiee" });
  });
});
