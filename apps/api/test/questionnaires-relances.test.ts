import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import { creerRegistre } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import {
  relanceQuestionnaire,
  TYPE_JOB_RELANCE_QUESTIONNAIRE,
} from "../src/questionnaires/relances.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";
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
 * Relances des répondants (DECISIONS.md, V2) : J+3 puis J+7 par la file de
 * tâches, idempotentes, seulement pour qui n'a pas soumis, désactivables ;
 * relance manuelle par le consultant.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let versionId: string;
let definition: DefinitionQuestionnaire;
const JOUR = 86_400_000;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  ({ versionId, definition } = await versionValidee(s.consultant, "relances_notation"));
}, 180_000);
afterAll(() => ctx.fermer());

const registre = creerRegistre({ [TYPE_JOB_RELANCE_QUESTIONNAIRE]: relanceQuestionnaire });

/** Exécute tous les jobs prêts à l'instant `quand` ; renvoie les e-mails envoyés. */
async function executerA(quand: Date) {
  const mailer = new MailerJournal();
  const worker = new WorkerJobs(ctx.db, { mailer, registre, horloge: () => quand });
  const resultats = [];
  for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
  return { mailer, resultats };
}

async function relancesDe(envoiId: string) {
  return ctx.db.withTenant(
    s.a.cabinetId,
    async (db) =>
      (
        await db.query(
          `SELECT x.nature, r.utilisateur_id FROM questionnaire_relances x
         JOIN questionnaire_repondants r ON r.id = x.repondant_id
         WHERE x.envoi_id = $1 ORDER BY x.relance_le, x.nature`,
          [envoiId],
        )
      ).rows as { nature: string; utilisateur_id: string }[],
  );
}

describe("relances automatiques J+3 puis J+7", () => {
  it("à J+3 seuls les répondants qui n'ont pas soumis sont relancés, une seule fois", async () => {
    // Vide la file des jobs laissés par d'autres fichiers de test (base partagée).
    await executerA(new Date(Date.now() + 30 * JOUR));
    const envoiId = await envoyer(s.consultant, s.missionId, versionId, [
      { utilisateur_id: s.dirigeant.utilisateurId },
      { utilisateur_id: s.contributeur.utilisateurId },
    ]);
    await repondre(s.dirigeant, envoiId, reponsesAuNiveau(definition, 4));
    const maintenant = Date.now();

    const avant = await executerA(new Date(maintenant + 2 * JOUR));
    expect(avant.resultats.filter((r) => r.type === TYPE_JOB_RELANCE_QUESTIONNAIRE)).toEqual([]);

    const j3 = await executerA(new Date(maintenant + 3 * JOUR + 60_000));
    expect(j3.resultats.filter((r) => r.type === TYPE_JOB_RELANCE_QUESTIONNAIRE)).toEqual([
      expect.objectContaining({ statut: "termine" }),
    ]);
    expect(j3.mailer.boite.map((m) => m.a)).toEqual([s.contributeur.email]);
    expect(j3.mailer.boite[0]?.sujet).toMatch(/Rappel/);
    expect(await relancesDe(envoiId)).toEqual([
      { nature: "j3", utilisateur_id: s.contributeur.utilisateurId },
    ]);

    // Idempotence : le même palier rejoué (second job, second worker) ne relance personne.
    const doublon = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      relanceQuestionnaire({
        db,
        cabinetId: s.a.cabinetId,
        jobId: "00000000-0000-4000-8000-000000000000",
        charge: { envoi_id: envoiId, nature: "j3" },
        maintenant: new Date(),
      }),
    );
    expect(doublon).toEqual([]);
    expect(await relancesDe(envoiId)).toHaveLength(1);

    const j7 = await executerA(new Date(maintenant + 7 * JOUR + 60_000));
    expect(j7.mailer.boite.map((m) => m.a)).toEqual([s.contributeur.email]);
    expect((await relancesDe(envoiId)).map((r) => r.nature)).toEqual(["j3", "j7"]);

    const notifications = await ctx.db.withTenant(
      s.a.cabinetId,
      async (db) =>
        (
          await db.query(
            "SELECT type, lien FROM notifications WHERE destinataire_id = $1 AND type = 'questionnaire_relance'",
            [s.contributeur.utilisateurId],
          )
        ).rows,
    );
    expect(notifications).toEqual([
      { type: "questionnaire_relance", lien: `/portail/questionnaires/${envoiId}` },
      { type: "questionnaire_relance", lien: `/portail/questionnaires/${envoiId}` },
    ]);
  });

  it("relances désactivées : le job s'exécute sans relancer ; une charge invalide échoue sans reprise", async () => {
    const envoiId = await envoyer(
      s.consultant,
      s.missionId,
      versionId,
      [{ utilisateur_id: s.contributeur.utilisateurId }],
      "individuel",
      { relances_auto: false },
    );
    const j = await executerA(new Date(Date.now() + 8 * JOUR));
    expect(j.mailer.boite).toEqual([]);
    expect(await relancesDe(envoiId)).toEqual([]);
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        relanceQuestionnaire({
          db,
          cabinetId: s.a.cabinetId,
          jobId: "00000000-0000-4000-8000-000000000000",
          charge: { envoi_id: "pas-un-uuid" },
          maintenant: new Date(),
        }),
      ),
    ).rejects.toThrow(/invalide/);
  });

  it("seuls les répondants qui peuvent encore répondre sont relancés, et inscrits après notification", async () => {
    const inactif = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]);
    const detache = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]);
    const envoiId = await envoyer(s.consultant, s.missionId, versionId, [
      { utilisateur_id: s.dirigeant.utilisateurId },
      { utilisateur_id: inactif.utilisateurId },
      { utilisateur_id: detache.utilisateurId },
    ]);
    await proprietaire(async (c) => {
      await c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [inactif.utilisateurId]);
      await c.query(
        "UPDATE utilisateurs_portail SET statut = 'desactive' WHERE utilisateur_id = $1",
        [detache.utilisateurId],
      );
    });
    const notifications = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      relanceQuestionnaire({
        db,
        cabinetId: s.a.cabinetId,
        jobId: "00000000-0000-4000-8000-000000000000",
        charge: { envoi_id: envoiId, nature: "j3" },
        maintenant: new Date(),
      }),
    );
    expect((notifications ?? []).map((n) => n?.destinataire_id)).toEqual([
      s.dirigeant.utilisateurId,
    ]);
    expect(await relancesDe(envoiId)).toEqual([
      { nature: "j3", utilisateur_id: s.dirigeant.utilisateurId },
    ]);
  });

  it("l'historique des relances est en ajout seul", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) => db.query("DELETE FROM questionnaire_relances")),
    ).rejects.toThrow();
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE questionnaire_relances SET nature = 'manuelle'"),
      ),
    ).rejects.toThrow();
  });
});

describe("relance manuelle", () => {
  it("droits, cibles en attente seulement, e-mail et journal", async () => {
    const envoiId = await envoyer(s.consultant, s.missionId, versionId, [
      { utilisateur_id: s.dirigeant.utilisateurId },
      { utilisateur_id: s.contributeur.utilisateurId },
    ]);
    const url = `/api/questionnaires/envois/${envoiId}/relancer`;
    expect((await s.anonyme.post(url, {})).statusCode).toBe(401);
    expect((await s.expert.post(url, {})).statusCode).toBe(403);
    expect((await s.horsEquipe.post(url, {})).statusCode).toBe(404);
    expect((await s.b.associe.post(url, {})).statusCode).toBe(404);

    await repondre(s.contributeur, envoiId, reponsesAuNiveau(definition, 2));
    const boite = (ctx.app.mailer as MailerJournal).boite;
    const avant = boite.length;
    const r = await s.consultant.post(url, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ relances: 1 });
    expect(boite.slice(avant).map((m) => m.a)).toEqual([s.dirigeant.email]);

    const detail = await s.consultant.get(`/api/questionnaires/envois/${envoiId}`);
    const contributeur = detail
      .json()
      .repondants.find(
        (x: { utilisateur_id: string }) => x.utilisateur_id === s.contributeur.utilisateurId,
      );
    const cible = await s.consultant.post(url, { repondant_ids: [contributeur.id] });
    expect(cible.statusCode).toBe(409);
    const etranger = await s.consultant.post(url, {
      repondant_ids: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(etranger.statusCode).toBe(400);
    expect((await relancesDe(envoiId)).map((x) => x.nature)).toEqual(["manuelle"]);

    // Moins de 24 h après : ni relance de tous, ni relance ciblée du même répondant.
    const dirigeant = detail
      .json()
      .repondants.find(
        (x: { utilisateur_id: string }) => x.utilisateur_id === s.dirigeant.utilisateurId,
      );
    const avantRepetition = boite.length;
    const tous = await s.consultant.post(url, {});
    expect(tous.statusCode).toBe(409);
    expect(tous.json().erreur.message).toMatch(/24 h/);
    expect((await s.consultant.post(url, { repondant_ids: [dirigeant.id] })).statusCode).toBe(409);
    expect(boite.length).toBe(avantRepetition);
    expect((await relancesDe(envoiId)).map((x) => x.nature)).toEqual(["manuelle"]);
  });

  it("relance manuelle refusée sur une mission clôturée (409)", async () => {
    const mission = (await creerMission(s.a, { intitule: "Mission close (relances)" })).id;
    await ajouterEquipe(s.a, mission, s.consultant.utilisateurId);
    const envoiId = await envoyer(s.consultant, mission, versionId, [
      { utilisateur_id: s.dirigeant.utilisateurId },
    ]);
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [mission, s.a.associeId],
      ),
    );
    const r = await s.consultant.post(`/api/questionnaires/envois/${envoiId}/relancer`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.message).toMatch(/clôturée/);
    expect(await relancesDe(envoiId)).toEqual([]);
  });
});
