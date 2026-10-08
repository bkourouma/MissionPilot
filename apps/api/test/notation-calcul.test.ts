import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appliquerAjustement,
  detecterEcarts,
  noterRepondants,
  preparerReponses,
  type DefinitionQuestionnaire,
  type GrilleNotation,
  type Reponses,
} from "@missionpilot/engines";
import { GRILLE_GENERIQUE } from "@missionpilot/shared";
import type { Api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
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
 * Notation (service 1) : droits, isolation, calcul IDENTIQUE au moteur sur
 * les réponses soumises, écarts entre répondants (NOT-05), ajustements
 * motivés (NOT-04) contrôlés par le moteur, grilles du cabinet.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let definition: DefinitionQuestionnaire;
let envoiId: string;
let notationId: string;
let grilleRelueId: string;
const INCONNU = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  const v = await versionValidee(s.consultant, "notation_calcul");
  definition = v.definition;
  envoiId = await envoyer(s.consultant, s.missionId, v.versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId },
    { utilisateur_id: s.contributeur.utilisateurId },
  ]);
}, 180_000);
afterAll(() => ctx.fermer());

async function reponsesCabinet(): Promise<{ repondant: string; reponses: Reponses }[]> {
  const r = await s.consultant.get(`/api/questionnaires/envois/${envoiId}/reponses`);
  return r.json().elements.map((e: { repondant: { id: string }; reponses: Reponses }) => ({
    repondant: e.repondant.id,
    reponses: e.reponses,
  }));
}

function attenduMoteur(
  grille: GrilleNotation,
  jeux: { repondant: string; reponses: Reponses }[],
  options = {},
) {
  return noterRepondants(
    grille,
    jeux.map((j) => {
      const p = preparerReponses(grille, definition, j.reponses);
      return { repondant: j.repondant, reponses: p.reponses, nonApplicables: p.nonApplicables };
    }),
    options,
  );
}

describe("notation : création et droits", () => {
  it("401, 403, 404 (hors équipe, autre cabinet) ; une seule notation par mission", async () => {
    const url = `/api/missions/${s.missionId}/notation`;
    expect((await s.anonyme.post(url, {})).statusCode).toBe(401);
    expect((await s.expert.post(url, {})).statusCode).toBe(403);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.horsEquipe.post(url, {})).statusCode).toBe(404);
    expect((await s.b.associe.post(url, {})).statusCode).toBe(404);
    expect((await s.dirigeant.get(url)).statusCode).toBe(403);
    expect((await s.consultant.get(url)).statusCode).toBe(404);
    const r = await s.consultant.post(url, {});
    expect(r.statusCode).toBe(201);
    notationId = r.json().id;
    expect(r.json().versions).toEqual([]);
    expect((await s.consultant.post(url, {})).statusCode).toBe(409);
    expect((await s.expert.get(url)).statusCode).toBe(200);
    expect((await s.b.associe.get(`/api/notations/${notationId}/version`)).statusCode).toBe(404);
    expect((await s.horsEquipe.get(`/api/notations/${notationId}/rapport`)).statusCode).toBe(404);
  });

  it("sans réponse soumise, pas de calcul (409)", async () => {
    const r = await s.consultant.post(`/api/notations/${notationId}/calculs`, {
      envoi_id: envoiId,
    });
    expect(r.statusCode).toBe(409);
  });
});

describe("calcul par le moteur", () => {
  it("résultat IDENTIQUE au moteur (moyenne par indicateur des répondants), figé et horodaté", async () => {
    await repondre(s.dirigeant, envoiId, reponsesAuNiveau(definition, 5));
    await repondre(s.contributeur, envoiId, reponsesAuNiveau(definition, 2));
    const url = `/api/notations/${notationId}/calculs`;
    expect((await s.expert.post(url, { envoi_id: envoiId })).statusCode).toBe(403);
    expect((await s.horsEquipe.post(url, { envoi_id: envoiId })).statusCode).toBe(404);
    const r = await s.consultant.post(url, { envoi_id: envoiId });
    expect(r.statusCode).toBe(201);
    const jeux = await reponsesCabinet();
    const attendu = attenduMoteur(GRILLE_GENERIQUE as GrilleNotation, jeux);
    expect(r.json().resultat).toEqual(JSON.parse(JSON.stringify(attendu)));
    expect(r.json()).toMatchObject({
      numero: 1,
      statut: "brouillon",
      grille: { generique: true, code: "notation_generique" },
      reponses_utilisees: 2,
      score: { score: attendu.score, classe: attendu.classe, score_calcule: attendu.score },
    });
    expect(r.json().calcule_le).toBeTruthy();
  });

  it("écarts entre répondants (NOT-05) : ceux du moteur, avec nom des répondants", async () => {
    const v = await s.expert.get(`/api/notations/${notationId}/version`);
    const jeux = await reponsesCabinet();
    const attendus = detecterEcarts(definition, jeux);
    expect(attendus.length).toBeGreaterThan(0);
    expect(
      v.json().ecarts.map((e: { question: string; ecart: number }) => [e.question, e.ecart]),
    ).toEqual(attendus.map((e) => [e.question, e.ecart]));
    expect(v.json().ecarts[0].repondants_max[0].nom).toBeTruthy();
    const direct = await s.consultant.get(`/api/questionnaires/envois/${envoiId}/ecarts?seuil=3`);
    expect(direct.json().ecarts.map((e: { question: string }) => e.question)).toEqual(
      detecterEcarts(definition, jeux, { seuil: 3 }).map((e) => e.question),
    );
  });

  it("secteur : pondérations de la grille ; secteur inconnu refusé ; grille d'autrui introuvable", async () => {
    const url = `/api/notations/${notationId}/calculs`;
    const inconnu = await s.consultant.post(url, { envoi_id: envoiId, secteur: "spatial" });
    expect(inconnu.statusCode).toBe(400);
    const r = await s.consultant.post(url, { envoi_id: envoiId, secteur: "industrie" });
    expect(r.statusCode).toBe(201);
    expect(r.json().numero).toBe(2);
    const attendu = attenduMoteur(GRILLE_GENERIQUE as GrilleNotation, await reponsesCabinet(), {
      secteur: "industrie",
    });
    expect(r.json().resultat).toEqual(JSON.parse(JSON.stringify(attendu)));
    expect(r.json().resultat.secteur).toBe("industrie");
    const grilleB = await s.b.associe.post("/api/notation/grilles", {
      code: "grille_b",
      source: { type: "generique" },
    });
    const vB = grilleB.json().versions[0].id;
    const autrui = await s.consultant.post(url, { envoi_id: envoiId, grille_version_id: vB });
    expect(autrui.statusCode).toBe(404);
    const envoiB = await s.consultant.post(url, {
      envoi_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(envoiB.statusCode).toBe(404);
  });

  it("grille du cabinet : copie de la générique, brouillon modifiable, validée par l'expert seulement", async () => {
    const g = await s.consultant.post("/api/notation/grilles", {
      code: "grille_cabinet",
      titre: "Grille du cabinet",
      source: { type: "generique" },
    });
    expect(g.statusCode).toBe(201);
    const versionId = g.json().versions[0].id as string;
    const lue = await s.expert.get(`/api/notation/grilles/versions/${versionId}`);
    const contenu = lue.json().contenu as GrilleNotation;
    const modifie = {
      ...contenu,
      dimensions: contenu.dimensions.map((d, i) => (i === 0 ? { ...d, poids: d.poids * 3 } : d)),
    };
    const put = await s.consultant.put(`/api/notation/grilles/versions/${versionId}`, {
      contenu: modifie,
    });
    expect(put.statusCode).toBe(200);
    const url = `/api/notations/${notationId}/calculs`;
    const brouillon = await s.consultant.post(url, {
      envoi_id: envoiId,
      grille_version_id: versionId,
    });
    expect(brouillon.statusCode).toBe(409);
    expect(
      (await s.consultant.post(`/api/notation/grilles/versions/${versionId}/valider`)).statusCode,
    ).toBe(403);
    attendre(
      200,
      await s.expert.post(`/api/notation/grilles/versions/${versionId}/valider`),
      "validation de la grille",
    );
    const figee = await s.expert.put(`/api/notation/grilles/versions/${versionId}`, {
      contenu: modifie,
    });
    expect(figee.statusCode).toBe(409);
    const r = await s.consultant.post(url, { envoi_id: envoiId, grille_version_id: versionId });
    expect(r.statusCode).toBe(201);
    const grille = (await s.expert.get(`/api/notation/grilles/versions/${versionId}`)).json()
      .contenu as GrilleNotation;
    expect(r.json().resultat).toEqual(
      JSON.parse(JSON.stringify(attenduMoteur(grille, await reponsesCabinet()))),
    );
    expect(r.json().grille).toMatchObject({ generique: false, code: "grille_cabinet", version: 1 });
    expect((await s.b.associe.get(`/api/notation/grilles/${g.json().id}`)).statusCode).toBe(404);
    const invalide = await s.consultant.post("/api/notation/grilles", {
      code: "grille_vide",
      source: {
        type: "contenu",
        contenu: { ...contenu, dimensions: [{ ...contenu.dimensions[0], poids: 0 }] },
      },
    });
    expect(invalide.statusCode).toBe(400);
  });

  it("validation d'une grille : expert métier seulement, jamais son auteur ni son dernier modificateur (doublé en base)", async () => {
    const g = await s.expert.post("/api/notation/grilles", {
      code: "grille_relue",
      source: { type: "generique" },
    });
    expect(g.statusCode).toBe(201);
    grilleRelueId = g.json().id as string;
    const versionId = g.json().versions[0].id as string;
    const valider = (u: Api) => u.post(`/api/notation/grilles/versions/${versionId}/valider`);

    const auteur = await valider(s.expert);
    expect(auteur.statusCode).toBe(403);
    expect(auteur.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    const associe = await valider(s.a.associe);
    expect(associe.statusCode).toBe(403);
    expect(associe.json().erreur.code).toBe("INTERDIT");
    // expert2 modifie le brouillon : il en devient le dernier modificateur.
    const contenu = (await s.expert2.get(`/api/notation/grilles/versions/${versionId}`)).json()
      .contenu as GrilleNotation;
    attendre(
      200,
      await s.expert2.put(`/api/notation/grilles/versions/${versionId}`, {
        contenu: { ...contenu, titre: "Grille relue par un second expert" },
      }),
      "modification par expert2",
    );
    const modificateur = await valider(s.expert2);
    expect(modificateur.statusCode).toBe(403);
    expect(modificateur.json().erreur.code).toBe("SEPARATION_DES_TACHES");

    const enBase = (par: string, changerContenu = false) =>
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `UPDATE notation_grille_versions SET statut = 'valide', valide_par = $2, valide_le = now(),
             modifie_par = $2${changerContenu ? ", contenu = jsonb_set(contenu, '{titre}', '\"x\"')" : ""}
           WHERE id = $1`,
          [versionId, par],
        ),
      );
    for (const par of [s.a.associeId, s.expert.utilisateurId, s.expert2.utilisateurId]) {
      await expect(enBase(par)).rejects.toMatchObject({ code: "MPN04" });
    }
    const expert3 = await s.a.avecRoles(["expert_metier"]);
    await expect(enBase(expert3.utilisateurId, true)).rejects.toMatchObject({ code: "MPN05" });
    const ok = await valider(expert3);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ statut: "valide", valide_par: expert3.utilisateurId });
  });

  it("identité d'une grille figée en base : seul le titre change (MPN05)", async () => {
    const modifier = (set: string) =>
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(`UPDATE notation_grilles SET ${set} WHERE id = $1`, [grilleRelueId]),
      );
    await expect(modifier("code = 'grille_detournee'")).rejects.toMatchObject({ code: "MPN05" });
    await expect(modifier("origine = 'cabinet'")).rejects.toMatchObject({ code: "MPN05" });
    await expect(modifier(`cree_par = '${s.consultant.utilisateurId}'`)).rejects.toMatchObject({
      code: "MPN05",
    });
    expect((await modifier("titre = 'Titre repris', modifie_le = now()")).rowCount).toBe(1);
  });
});

describe("ajustements motivés (NOT-04)", () => {
  it("motif obligatoire, précision contrôlée par le moteur, score ajusté = moteur", async () => {
    const url = `/api/notations/${notationId}/ajustements`;
    const v = (await s.consultant.get(`/api/notations/${notationId}/version`)).json();
    const dimension = v.resultat.dimensions.find((d: { notable: boolean }) => d.notable).dimension;
    expect((await s.consultant.post(url, { dimension, delta: 5 })).statusCode).toBe(400);
    const precision = await s.consultant.post(url, { dimension, delta: 2.25, motif: "Entretien" });
    expect(precision.statusCode).toBe(400);
    expect(precision.json().erreur.code).toBe("AJUSTEMENT_INVALIDE");
    const inconnue = await s.consultant.post(url, { dimension: "inconnue", delta: 2, motif: "x" });
    expect(inconnue.json().erreur.code).toBe("DIMENSION_INCONNUE");
    expect((await s.expert.post(url, { dimension, delta: 2, motif: "x" })).statusCode).toBe(403);

    const motif = "Observation terrain : revue mensuelle tenue mais non documentée.";
    const r = await s.consultant.post(url, { dimension, delta: -4.5, motif });
    expect(r.statusCode).toBe(201);
    const attendu = appliquerAjustement(v.resultat, {
      dimension,
      delta: -4.5,
      motif,
      auteur: s.consultant.utilisateurId,
      date: new Date().toISOString().slice(0, 10),
    });
    expect(r.json().score).toMatchObject({ score: attendu.score, classe: attendu.classe });
    expect(r.json().score.dimensions).toEqual(JSON.parse(JSON.stringify(attendu.dimensions)));
    expect(r.json().ajustements).toEqual([
      expect.objectContaining({
        rang: 1,
        dimension,
        delta: -4.5,
        motif,
        auteur: { id: s.consultant.utilisateurId, nom: expect.any(String) },
        score_avant: attendu.ajustements[0]?.scoreAvant,
        score_apres: attendu.ajustements[0]?.scoreApres,
      }),
    ]);
    expect(r.json().resultat).toEqual(v.resultat);
  });

  it("historique immuable en base (MPN01) : ni modification ni suppression", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE notation_ajustements SET delta = 10 WHERE TRUE"),
      ),
    ).rejects.toThrow();
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("DELETE FROM notation_versions WHERE TRUE"),
      ),
    ).rejects.toThrow();
    const { proprietaire } = await import("./helpers.js");
    await expect(
      proprietaire((c) => c.query("UPDATE notation_versions SET secteur = NULL")),
    ).rejects.toMatchObject({ code: "MPN01" });
    await expect(
      proprietaire((c) => c.query("DELETE FROM notation_ajustements")),
    ).rejects.toMatchObject({ code: "MPN01" });
  });

  it("aucune table de notation n'est visible depuis une transaction du portail", async () => {
    const n = await ctx.db.withTenant(s.a.cabinetId, async (db) => {
      await db.query("SELECT set_config('app.portail_client_id', $1, true)", [s.a.clientId]);
      await db.query("SELECT set_config('app.portail_utilisateur_id', $1, true)", [
        s.dirigeant.utilisateurId,
      ]);
      const r = await db.query(
        `SELECT (SELECT count(*) FROM notations) + (SELECT count(*) FROM notation_versions)
           + (SELECT count(*) FROM notation_ajustements) + (SELECT count(*) FROM notation_grilles)
           + (SELECT count(*) FROM notation_grille_versions) + (SELECT count(*) FROM notation_evenements) AS n`,
      );
      return Number(r.rows[0].n);
    });
    expect(n).toBe(0);
  });

  it("un calcul ne cite que des réponses SOUMISES de son questionnaire, sans doublon (MPN02)", async () => {
    const soumises = (
      (await s.consultant.get(`/api/questionnaires/envois/${envoiId}/reponses`)).json()
        .elements as { id: string }[]
    ).map((e) => e.id);
    expect(soumises).toHaveLength(2);
    // Copie de la dernière version avec ces réponses ; annulée en fin de transaction.
    const inserer = (ids: string[]) =>
      ctx.db.withTenant(s.a.cabinetId, async (db) => {
        await db.query(
          `INSERT INTO notation_versions (cabinet_id, notation_id, numero, envoi_id, grille_version_id,
             grille, definition, secteur, strategie, reponses_ids, resultat, ecarts, calcule_par)
           SELECT v.cabinet_id, v.notation_id, v.numero + 1, v.envoi_id, NULL, v.grille,
             v.definition, v.secteur, v.strategie, $2::uuid[], v.resultat, v.ecarts, v.calcule_par
           FROM notation_versions v WHERE v.notation_id = $1 ORDER BY v.numero DESC LIMIT 1`,
          [notationId, ids],
        );
        throw new Error("annulation du témoin");
      });
    await expect(inserer(soumises)).rejects.toThrow("annulation du témoin");
    await expect(inserer([INCONNU])).rejects.toMatchObject({ code: "MPN02" });
    await expect(inserer([soumises[0] as string, soumises[0] as string])).rejects.toMatchObject({
      code: "MPN02",
    });
  });
});
