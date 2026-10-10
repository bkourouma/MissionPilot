import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { attendu, cloturer, preparerCap, type ScenarioCap } from "./capitalisation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMissionSignee, type ApiUtilisateur } from "./missions-outils.js";

/*
 * Retour d'expérience (CAP-01) ouvert AUTOMATIQUEMENT à la clôture d'une mission, et rattrapage
 * des missions clôturées avant cette fonction : `GET /capitalisation/retours/a-ouvrir`.
 */

let ctx: Contexte;
let a: ScenarioCap;
let b: ScenarioCap;
let gestionnaire: ApiUtilisateur;
let horsEquipe: ApiUtilisateur;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCap(ctx, "Clôture capitalisation A");
  b = await preparerCap(ctx, "Clôture capitalisation B");
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  horsEquipe = await a.avecRoles(["consultant"]);
}, 240_000);
afterAll(() => ctx.fermer());

/** Mission signée « à clôturer » (statuts par le directeur de mission, sans tâche ni brique). */
async function missionACloturer(intitule: string): Promise<string> {
  const m = await creerMissionSignee(a, { intitule });
  for (const statut of ["en_cours", "a_cloturer"]) {
    attendu(200, await a.directeur.post(`/api/missions/${m.id}/statut`, { statut }));
  }
  return m.id;
}

const retoursEnBase = (missionId: string) =>
  proprietaire(async (cl) => {
    const r = await cl.query(
      `SELECT id, statut, ouvert_par FROM retours_experience WHERE mission_id = $1`,
      [missionId],
    );
    return r.rows as { id: string; statut: string; ouvert_par: string }[];
  });

const actionsJournal = (missionId: string | null, entite: string) =>
  proprietaire(async (cl) => {
    const r = await cl.query(
      `SELECT action, details FROM journal_audit WHERE entite = $1
         AND ($2::text IS NULL OR entite_id = $2::text OR details->>'mission_id' = $2::text)
       ORDER BY cree_le, id`,
      [entite, missionId],
    );
    return r.rows as { action: string; details: Record<string, unknown> }[];
  });

describe("ouverture automatique à la clôture", () => {
  it("clôturer une mission sans tâche ni brique ouvre un retour en brouillon", async () => {
    const id = await missionACloturer("Mission vierge à clôturer");
    expect(await retoursEnBase(id)).toHaveLength(0);
    attendu(200, await a.directeur.post(`/api/missions/${id}/cloturer`));
    const retours = await retoursEnBase(id);
    expect(retours).toHaveLength(1);
    expect(retours[0]).toMatchObject({
      statut: "brouillon",
      ouvert_par: a.directeur.utilisateurId,
    });

    const lu = attendu(200, await a.directeur.get(`/api/capitalisation/missions/${id}/retour`));
    expect(lu.retour).toMatchObject({
      id: retours[0]?.id,
      statut: "brouillon",
      version_validee: null,
    });
    expect(lu.retour.version_courante).toMatchObject({ version: 1, origine: "gabarit" });
    expect(lu.retour.mission).toMatchObject({ id, statut: "cloturee" });

    const journal = await actionsJournal(id, "retour_experience");
    expect(journal.map((j) => j.action)).toContain("capitalisation.retour.ouvrir");
  });

  it("une seconde clôture est refusée et n'ouvre pas un second retour", async () => {
    const id = await missionACloturer("Mission clôturée deux fois");
    attendu(200, await a.directeur.post(`/api/missions/${id}/cloturer`));
    const [premier] = await retoursEnBase(id);
    expect((await a.directeur.post(`/api/missions/${id}/cloturer`)).statusCode).toBe(409);
    const apres = await retoursEnBase(id);
    expect(apres).toHaveLength(1);
    expect(apres[0]?.id).toBe(premier?.id);
    // Rouvrir à la main un retour déjà ouvert rend le même retour, sans doublon.
    const r = await a.directeur.post(`/api/capitalisation/missions/${id}/retour`);
    expect(attendu(201, r).id).toBe(premier?.id);
    expect(await retoursEnBase(id)).toHaveLength(1);
  });

  it("un échec d'ouverture n'empêche pas la clôture : il est journalisé, le rattrapage reste possible", async () => {
    const id = await missionACloturer("Mission dont l'ouverture échoue");
    await proprietaire(async (cl) => {
      await cl.query(
        `CREATE FUNCTION test_refuser_retour() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION 'Ouverture refusée pour le test.'; END $$`,
      );
      await cl.query(
        `CREATE TRIGGER test_refuser_retour BEFORE INSERT ON retours_experience
         FOR EACH ROW WHEN (NEW.mission_id = '${id}') EXECUTE FUNCTION test_refuser_retour()`,
      );
    });
    try {
      const cloturee = attendu(200, await a.directeur.post(`/api/missions/${id}/cloturer`));
      expect(cloturee.statut).toBe("cloturee");
      expect(await retoursEnBase(id)).toHaveLength(0);
      const journal = await actionsJournal(id, "mission");
      expect(journal.map((j) => j.action)).toEqual(
        expect.arrayContaining(["cloture", "capitalisation.retour.ouvrir_echec"]),
      );
    } finally {
      await proprietaire(async (cl) => {
        await cl.query(`DROP TRIGGER IF EXISTS test_refuser_retour ON retours_experience`);
        await cl.query(`DROP FUNCTION IF EXISTS test_refuser_retour()`);
      });
    }
    // Le retour échoué est rattrapable (la mission est listée, puis ouvrable).
    const liste = attendu(200, await a.associe.get("/api/capitalisation/retours/a-ouvrir"));
    expect(liste.elements.map((e: { mission_id: string }) => e.mission_id)).toContain(id);
    attendu(201, await a.associe.post(`/api/capitalisation/missions/${id}/retour`));
    expect(await retoursEnBase(id)).toHaveLength(1);
  });
});

describe("rattrapage : missions clôturées sans retour (GET /capitalisation/retours/a-ouvrir)", () => {
  const chemin = "/api/capitalisation/retours/a-ouvrir";
  let ancienne: string;
  let ancienne2: string;
  let autreCabinet: string;

  beforeAll(async () => {
    ancienne = await missionACloturer("Mission ancienne un");
    await cloturer(a, ancienne);
    ancienne2 = await missionACloturer("Mission ancienne deux");
    await cloturer(a, ancienne2);
    const m = await creerMissionSignee(b, { intitule: "Mission ancienne chez B" });
    autreCabinet = m.id;
    await proprietaire((cl) =>
      cl.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), cloturee_par = $2 WHERE id = $1`,
        [autreCabinet, b.associeId],
      ),
    );
  });

  it("exige une session et le droit de lire les connaissances", async () => {
    expect((await api(ctx).get(chemin)).statusCode).toBe(401);
    expect((await gestionnaire.get(chemin)).statusCode).toBe(403);
  });

  it("liste les missions clôturées sans retour, sans autre cabinet ni mission non clôturée", async () => {
    const enCours = await missionACloturer("Mission encore à clôturer");
    const r = attendu(200, await a.associe.get(chemin));
    const ids = r.elements.map((e: { mission_id: string }) => e.mission_id);
    expect(ids).toEqual(expect.arrayContaining([ancienne, ancienne2]));
    expect(ids).not.toContain(enCours);
    expect(ids).not.toContain(autreCabinet);
    const ligne = r.elements.find((e: { mission_id: string }) => e.mission_id === ancienne);
    expect(ligne).toMatchObject({
      mission_intitule: "Mission ancienne un",
      peut_ouvrir: true,
    });
    expect(ligne.client).toEqual(expect.any(String));
    expect(ligne).not.toHaveProperty("cle_tri");
  });

  it("ne montre à l'autre cabinet que ses propres missions", async () => {
    const r = attendu(200, await b.associe.get(chemin));
    const ids = r.elements.map((e: { mission_id: string }) => e.mission_id);
    expect(ids).toContain(autreCabinet);
    expect(ids).not.toContain(ancienne);
  });

  it("applique la visibilité des missions et dit qui peut ouvrir", async () => {
    // Un consultant hors équipe ne voit aucune de ces missions.
    const vide = attendu(200, await horsEquipe.get(chemin));
    expect(vide.elements).toEqual([]);
    // Un consultant de l'équipe voit la mission mais n'est pas responsable.
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id)
         SELECT cabinet_id, id, $2 FROM missions WHERE id = $1`,
        [ancienne2, a.consultant.utilisateurId],
      ),
    );
    const r = attendu(200, await a.consultant.get(chemin));
    const ligne = r.elements.find((e: { mission_id: string }) => e.mission_id === ancienne2);
    expect(ligne).toMatchObject({ peut_ouvrir: false });
    expect(r.elements).toHaveLength(1);
    // L'ouverture reste refusée par l'API à un non-responsable (403 ou 404 selon le droit).
    expect(
      (await a.consultant.post(`/api/capitalisation/missions/${ancienne2}/retour`)).statusCode,
    ).toBe(403);
  });

  it("pagine par curseur, sans doublon, et refuse un curseur invalide", async () => {
    const p1 = attendu(200, await a.associe.get(`${chemin}?limite=1`));
    expect(p1.elements).toHaveLength(1);
    expect(p1.curseur_suivant).toEqual(expect.any(String));
    const p2 = attendu(
      200,
      await a.associe.get(`${chemin}?limite=1&curseur=${encodeURIComponent(p1.curseur_suivant)}`),
    );
    expect(p2.elements).toHaveLength(1);
    expect(p2.elements[0].mission_id).not.toBe(p1.elements[0].mission_id);
    expect((await a.associe.get(`${chemin}?curseur=n-importe-quoi`)).statusCode).toBe(400);
    expect((await a.associe.get(`${chemin}?limite=0`)).statusCode).toBe(400);
    expect((await a.associe.get(`${chemin}?statut=valide`)).statusCode).toBe(400);
  });

  it("ouvrir le retour retire la mission de la liste", async () => {
    attendu(201, await a.associe.post(`/api/capitalisation/missions/${ancienne}/retour`));
    const r = attendu(200, await a.associe.get(chemin));
    const ids = r.elements.map((e: { mission_id: string }) => e.mission_id);
    expect(ids).not.toContain(ancienne);
    expect(ids).toContain(ancienne2);
  });
});
