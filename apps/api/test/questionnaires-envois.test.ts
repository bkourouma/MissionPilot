import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { progression, type DefinitionQuestionnaire } from "@missionpilot/engines";
import { repondantsEligiblesReponseSchema } from "@missionpilot/shared";
import type { Db } from "../src/db/pool.js";
import type { MailerJournal } from "../src/notifications/mailer.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre, CLE_INTERDITE, clesDe, inviterClient } from "./portail-outils.js";
import {
  ajouterEquipe,
  envoyer,
  preparerQuestionnaires,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";

/*
 * Envois de questionnaires (SOC-10) et réponses depuis le portail client :
 * droits, visibilité de mission, isolation entre cabinets et entre clients,
 * IDOR (répondant non désigné, autre client), brouillon puis soumission
 * verrouillée, lecture des réponses par le cabinet, RLS du portail.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let versionId: string;
let definition: DefinitionQuestionnaire;
let envoiId: string;
const INCONNU = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  ({ versionId, definition } = await versionValidee(s.consultant, "envois_notation"));
}, 180_000);
afterAll(() => ctx.fermer());

const corpsEnvoi = (
  repondants: { utilisateur_id: string; fonction?: string }[],
  mode = "individuel",
) => ({
  version_id: versionId,
  mode,
  repondants,
});

describe("création et envoi par le cabinet", () => {
  it("401, 403 (sans questionnaire.gerer), 404 (hors équipe, autre cabinet)", async () => {
    const url = `/api/missions/${s.missionId}/questionnaires`;
    const corps = corpsEnvoi([{ utilisateur_id: s.dirigeant.utilisateurId }]);
    expect((await s.anonyme.post(url, corps)).statusCode).toBe(401);
    expect((await s.expert.post(url, corps)).statusCode).toBe(403);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.horsEquipe.post(url, corps)).statusCode).toBe(404);
    expect((await s.horsEquipe.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.post(url, corps)).statusCode).toBe(404);
    expect((await s.dirigeant.post(url, corps)).statusCode).toBe(403);
  });

  it("répondants : client de la mission seulement, ni investisseur, ni interne ; fonction exigée par fonction", async () => {
    const url = `/api/missions/${s.missionId}/questionnaires`;
    for (const utilisateur_id of [
      s.dirigeantA2.utilisateurId,
      s.dirigeantB.utilisateurId,
      s.investisseur.utilisateurId,
      s.consultant.utilisateurId,
      INCONNU,
    ]) {
      const r = await s.consultant.post(url, corpsEnvoi([{ utilisateur_id }]));
      expect(r.statusCode, utilisateur_id).toBe(400);
    }
    const sansFonction = await s.consultant.post(
      url,
      corpsEnvoi(
        [
          { utilisateur_id: s.dirigeant.utilisateurId, fonction: "Directeur général" },
          { utilisateur_id: s.contributeur.utilisateurId },
        ],
        "par_fonction",
      ),
    );
    expect(sansFonction.statusCode).toBe(400);
  });

  it("une version brouillon ne s'envoie pas ; une version d'un autre cabinet est introuvable", async () => {
    const m = await s.consultant.post("/api/questionnaires/modeles", {
      code: "brouillon_non_envoyable",
      source: { type: "gabarit", gabarit: "preliminaire_dirigeants" },
    });
    const brouillon = m.json().versions[0].id as string;
    const url = `/api/missions/${s.missionId}/questionnaires`;
    const r = await s.consultant.post(url, {
      ...corpsEnvoi([{ utilisateur_id: s.dirigeant.utilisateurId }]),
      version_id: brouillon,
    });
    expect(r.statusCode).toBe(409);
    const vb = await versionValidee(s.b.associe, "notation_b");
    const autre = await s.consultant.post(url, {
      ...corpsEnvoi([{ utilisateur_id: s.dirigeant.utilisateurId }]),
      version_id: vb.versionId,
    });
    expect(autre.statusCode).toBe(404);
  });

  it("envoi : notification et e-mail aux répondants, relances J+3 et J+7 en file", async () => {
    const boite = (ctx.app.mailer as MailerJournal).boite;
    const avant = boite.length;
    envoiId = await envoyer(
      s.consultant,
      s.missionId,
      versionId,
      [
        { utilisateur_id: s.dirigeant.utilisateurId, fonction: "Directeur général" },
        { utilisateur_id: s.contributeur.utilisateurId, fonction: "Responsable qualité" },
      ],
      "par_fonction",
      { date_limite: "2026-12-15" },
    );
    const mails = boite.slice(avant);
    expect(mails.map((m) => m.a).sort()).toEqual([s.dirigeant.email, s.contributeur.email].sort());
    expect(mails[0]?.texte).toMatch(/2026-12-15/);
    const jobs = await ctx.db.withTenant(
      s.a.cabinetId,
      async (db) =>
        (
          await db.query(
            `SELECT j.charge->>'nature' AS nature,
             round(extract(epoch FROM j.execute_a - e.envoye_le) / 86400) AS jours
           FROM jobs j JOIN questionnaire_envois e ON e.id = (j.charge->>'envoi_id')::uuid
           WHERE j.type = 'relance_questionnaire' AND e.id = $1 ORDER BY jours`,
            [envoiId],
          )
        ).rows,
    );
    expect(jobs).toEqual([
      { nature: "j3", jours: "3" },
      { nature: "j7", jours: "7" },
    ]);
    const deux = await s.consultant.post(`/api/questionnaires/envois/${envoiId}/envoyer`);
    expect(deux.statusCode).toBe(409);
    const detail = await s.expert.get(`/api/questionnaires/envois/${envoiId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      statut: "envoye",
      mode: "par_fonction",
      completude: { attendues: 2, soumises: 0, complet: false },
    });
    expect(detail.json().repondants.map((r: { statut: string }) => r.statut)).toEqual([
      "non_commence",
      "non_commence",
    ]);
    expect((await s.horsEquipe.get(`/api/questionnaires/envois/${envoiId}`)).statusCode).toBe(404);
    expect((await s.b.associe.get(`/api/questionnaires/envois/${envoiId}`)).statusCode).toBe(404);
  });
});

describe("portail client : seuls les répondants désignés, rien d'autre", () => {
  it("le répondant voit le questionnaire ; les autres reçoivent le même 404", async () => {
    const liste = await s.dirigeant.get("/api/portail/questionnaires");
    expect(liste.statusCode).toBe(200);
    expect(liste.json().elements.map((e: { id: string }) => e.id)).toContain(envoiId);
    const lu = await s.dirigeant.get(`/api/portail/questionnaires/${envoiId}`);
    expect(lu.statusCode).toBe(200);
    expect(lu.json()).toMatchObject({ fonction: "Directeur général", statut: "envoye" });
    expect(lu.json().definition.sections.length).toBeGreaterThan(0);
    expect(clesDe(lu.json()).filter((k) => CLE_INTERDITE.test(k) && !k.includes("."))).toEqual([]);
    for (const u of [s.dirigeantA2, s.dirigeantB]) {
      expect((await u.get("/api/portail/questionnaires")).json().elements).toEqual([]);
      for (const r of [
        await u.get(`/api/portail/questionnaires/${envoiId}`),
        await u.patch(`/api/portail/questionnaires/${envoiId}/reponses`, { reponses: {} }),
        await u.post(`/api/portail/questionnaires/${envoiId}/soumettre`),
      ]) {
        expect(r.statusCode).toBe(404);
      }
    }
    expect((await s.dirigeant.get(`/api/portail/questionnaires/${INCONNU}`)).statusCode).toBe(404);
    expect((await s.investisseur.get(`/api/portail/questionnaires/${envoiId}`)).statusCode).toBe(
      403,
    );
    expect((await s.consultant.get("/api/portail/questionnaires")).statusCode).toBe(403);
    expect((await s.anonyme.get("/api/portail/questionnaires")).statusCode).toBe(401);
  });

  it("un client non désigné d'une autre mission du même client ne voit pas l'envoi (IDOR)", async () => {
    const autreMission = (await creerMission(s.a, { intitule: "Autre mission A1" })).id;
    const autre = await envoyer(s.a.chef, autreMission, versionId, [
      { utilisateur_id: s.dirigeant.utilisateurId },
    ]);
    expect((await s.contributeur.get(`/api/portail/questionnaires/${autre}`)).statusCode).toBe(404);
    const patch = await s.contributeur.patch(`/api/portail/questionnaires/${autre}/reponses`, {
      reponses: { "strat.plan_formalise": true },
    });
    expect(patch.statusCode).toBe(404);
    const ids = (await s.contributeur.get("/api/portail/questionnaires"))
      .json()
      .elements.map((e: { id: string }) => e.id);
    expect(ids).toEqual([envoiId]);
  });

  it("brouillon : valeurs contrôlées par le moteur, fusion, progression ; soumission complète exigée", async () => {
    const url = `/api/portail/questionnaires/${envoiId}`;
    const invalide = await s.dirigeant.patch(`${url}/reponses`, {
      reponses: { "strat.plan_formalise": "peut-être" },
    });
    expect(invalide.statusCode).toBe(400);
    expect(JSON.stringify(invalide.json().erreur.details)).toMatch(/strat\.plan_formalise/);
    const partiel = await s.dirigeant.patch(`${url}/reponses`, {
      reponses: { "strat.plan_formalise": true },
    });
    expect(partiel.statusCode).toBe(200);
    expect(partiel.json().reponse.statut).toBe("brouillon");
    expect(partiel.json().reponse.reponses).toEqual({ "strat.plan_formalise": true });
    const attendu = progression(definition, { "strat.plan_formalise": true });
    expect(partiel.json().reponse.progression.pourcentage).toBe(attendu.pourcentage);
    expect((await s.dirigeant.post(`${url}/soumettre`)).statusCode).toBe(400);

    const complet = reponsesAuNiveau(definition, 4);
    attendre(200, await s.dirigeant.patch(`${url}/reponses`, { reponses: complet }), "saisie");
    const soumis = await s.dirigeant.post(`${url}/soumettre`);
    expect(soumis.statusCode).toBe(200);
    expect(soumis.json().reponse).toMatchObject({
      statut: "soumise",
      soumission: { par_moi: true },
      progression: { complet: true, pourcentage: 100 },
    });
    expect((await s.dirigeant.post(`${url}/soumettre`)).statusCode).toBe(409);
    const apres = await s.dirigeant.patch(`${url}/reponses`, {
      reponses: { "strat.plan_formalise": false },
    });
    expect(apres.statusCode).toBe(409);
    expect(apres.json().erreur.code).toBe("QUESTIONNAIRE_DEJA_SOUMIS");
  });

  it("le contributeur ne voit que SA réponse ; le cabinet lit les réponses soumises, jamais un brouillon", async () => {
    const url = `/api/portail/questionnaires/${envoiId}`;
    const lu = await s.contributeur.get(url);
    expect(lu.json().reponse.statut).toBe("non_commence");
    expect(lu.json().reponse.reponses).toEqual({});
    attendre(
      200,
      await s.contributeur.patch(`${url}/reponses`, {
        reponses: { "strat.plan_formalise": false },
      }),
      "brouillon contributeur",
    );
    const r = await s.consultant.get(`/api/questionnaires/envois/${envoiId}/reponses`);
    expect(r.statusCode).toBe(200);
    expect(r.json().elements).toHaveLength(1);
    expect(r.json().elements[0].repondant).toMatchObject({ fonction: "Directeur général" });
    const detail = await s.consultant.get(`/api/questionnaires/envois/${envoiId}`);
    const statuts = Object.fromEntries(
      detail
        .json()
        .repondants.map((x: { utilisateur_id: string; statut: string }) => [
          x.utilisateur_id,
          x.statut,
        ]),
    );
    expect(statuts).toEqual({
      [s.dirigeant.utilisateurId]: "soumise",
      [s.contributeur.utilisateurId]: "brouillon",
    });
    expect(detail.json().completude).toEqual({ attendues: 2, soumises: 1, complet: false });
    expect(JSON.stringify(detail.json())).not.toMatch(/"reponses"/);
    expect(
      (await s.horsEquipe.get(`/api/questionnaires/envois/${envoiId}/reponses`)).statusCode,
    ).toBe(404);
    expect(
      (await s.b.associe.get(`/api/questionnaires/envois/${envoiId}/reponses`)).statusCode,
    ).toBe(404);
  });

  it("une réponse soumise est verrouillée en base (MPQ04)", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `UPDATE questionnaire_reponses SET reponses = '{}'::jsonb
           WHERE envoi_id = $1 AND statut = 'soumise'`,
          [envoiId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPQ04" });
  });

  it("RLS du portail : seules SA désignation, SES envois et SA réponse sont visibles", async () => {
    const compter = (client: string, utilisateur: string | null) =>
      ctx.db.withTenant(s.a.cabinetId, async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [client]);
        if (utilisateur) {
          await db.query("SELECT set_config('app.portail_utilisateur_id', $1, true)", [
            utilisateur,
          ]);
        }
        const n = async (t: string) =>
          (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
        return {
          envois: await n("questionnaire_envois"),
          repondants: await n("questionnaire_repondants"),
          reponses: await n("questionnaire_reponses"),
          modeles: await n("questionnaire_modeles"),
          versions: await n("questionnaire_versions"),
          relances: await n("questionnaire_relances"),
        };
      });
    expect(await compter(s.a.clientId, s.contributeur.utilisateurId)).toEqual({
      envois: 1,
      repondants: 1,
      reponses: 1,
      modeles: 0,
      versions: 0,
      relances: 0,
    });
    const vide = { envois: 0, repondants: 0, reponses: 0, modeles: 0, versions: 0, relances: 0 };
    expect(await compter(s.a.clientId, null)).toEqual(vide);
    expect(await compter(s.clientA2, s.dirigeantA2.utilisateurId)).toEqual(vide);
    expect(await compter(s.clientA2, s.contributeur.utilisateurId)).toEqual(vide);
  });

  it("RLS du portail : envois et répondants en LECTURE SEULE (ni écriture, ni verrou de ligne)", async () => {
    const dansPortail = <T>(fn: (db: Db) => Promise<T>) =>
      ctx.db.withTenant(s.a.cabinetId, async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [s.a.clientId]);
        await db.query("SELECT set_config('app.portail_utilisateur_id', $1, true)", [
          s.contributeur.utilisateurId,
        ]);
        return fn(db);
      });
    const etat = await dansPortail(async (db) => ({
      visible: (await db.query("SELECT id FROM questionnaire_envois WHERE id = $1", [envoiId]))
        .rowCount,
      modifie: (
        await db.query(
          "UPDATE questionnaire_envois SET relances_auto = NOT relances_auto WHERE id = $1",
          [envoiId],
        )
      ).rowCount,
      verrouille: (
        await db.query("SELECT id FROM questionnaire_envois WHERE id = $1 FOR UPDATE", [envoiId])
      ).rowCount,
    }));
    expect(etat).toEqual({ visible: 1, modifie: 0, verrouille: 0 });
    // Politiques restrictives d'écriture, neutres hors du portail.
    const politiques = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT tablename, cmd, permissive FROM pg_policies
             WHERE tablename IN ('questionnaire_envois', 'questionnaire_repondants')
               AND policyname LIKE 'portail%' ORDER BY tablename, cmd`,
          )
        ).rows,
    );
    for (const table of ["questionnaire_envois", "questionnaire_repondants"]) {
      expect(politiques.filter((p) => p.tablename === table)).toEqual(
        ["DELETE", "INSERT", "SELECT", "UPDATE"].map((cmd) => ({
          tablename: table,
          cmd,
          permissive: "RESTRICTIVE",
        })),
      );
    }
    // Le cabinet, lui, modifie toujours l'envoi (politiques neutres hors portail).
    const cabinet = await ctx.db.withTenant(
      s.a.cabinetId,
      async (db) =>
        (await db.query("SELECT id FROM questionnaire_envois WHERE id = $1 FOR UPDATE", [envoiId]))
          .rowCount,
    );
    expect(cabinet).toBe(1);
  });

  it("relances : activables, clôture qui ferme la saisie", async () => {
    const off = await s.consultant.patch(`/api/questionnaires/envois/${envoiId}`, {
      relances_auto: false,
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().relances_auto).toBe(false);
    expect((await s.expert.post(`/api/questionnaires/envois/${envoiId}/clore`)).statusCode).toBe(
      403,
    );
    expect(
      (await s.consultant.post(`/api/questionnaires/envois/${envoiId}/clore`)).statusCode,
    ).toBe(200);
    const r = await s.contributeur.patch(`/api/portail/questionnaires/${envoiId}/reponses`, {
      reponses: { "strat.plan_formalise": true },
    });
    expect(r.statusCode).toBe(409);
    expect((await s.contributeur.get(`/api/portail/questionnaires/${envoiId}`)).json().statut).toBe(
      "clos",
    );
    expect(
      (await s.consultant.patch(`/api/questionnaires/envois/${envoiId}`, { relances_auto: true }))
        .statusCode,
    ).toBe(409);
  });

  it("les actions sont journalisées (cabinet et portail)", async () => {
    const actions = await ctx.db.withTenant(s.a.cabinetId, async (db) =>
      (
        await db.query(
          "SELECT DISTINCT action FROM journal_audit WHERE entite = 'questionnaire_envoi' AND entite_id = $1",
          [envoiId],
        )
      ).rows.map((l) => l.action as string),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "creation",
        "envoi",
        "modification",
        "cloture",
        "portail_lecture",
        "portail_saisie",
        "portail_soumission",
      ]),
    );
  });
});

describe("répondants désignables d'une mission (écran d'envoi)", () => {
  const url = (missionId: string, query = "") =>
    `/api/missions/${missionId}/questionnaires/repondants-eligibles${query}`;
  const ids = (r: { json(): { elements: { id: string }[] } }) => r.json().elements.map((e) => e.id);

  it("401, 403 (sans questionnaire.gerer, portail), 404 (mission invisible, autre cabinet, inconnue)", async () => {
    expect((await s.anonyme.get(url(s.missionId))).statusCode).toBe(401);
    for (const u of [s.expert, s.gestionnaire]) {
      expect((await u.get(url(s.missionId))).statusCode).toBe(403);
    }
    const portail = await s.dirigeant.get(url(s.missionId));
    expect(portail.statusCode).toBe(403);
    expect(portail.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    for (const [u, mission] of [
      [s.horsEquipe, s.missionId],
      [s.b.associe, s.missionId],
      [s.consultant, s.missionB],
      [s.consultant, INCONNU],
    ] as const) {
      const r = await u.get(url(mission));
      expect(r.statusCode).toBe(404);
      expect(r.json().erreur.code).toBe("INTROUVABLE");
    }
  });

  it("dirigeants et contributeurs actifs du client seulement, projection fermée {id, nom, email, roles}", async () => {
    const desactive = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]);
    const detache = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
    await proprietaire(async (c) => {
      await c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [
        desactive.utilisateurId,
      ]);
      await c.query(
        "UPDATE utilisateurs_portail SET statut = 'desactive' WHERE utilisateur_id = $1",
        [detache.utilisateurId],
      );
    });
    const r = await s.consultant.get(url(s.missionId, "?limite=100"));
    expect(r.statusCode).toBe(200);
    const page = repondantsEligiblesReponseSchema.parse(r.json());
    expect(page.curseur_suivant).toBeNull();
    expect(new Set(ids(r))).toEqual(
      new Set([s.dirigeant.utilisateurId, s.contributeur.utilisateurId]),
    );
    for (const e of r.json().elements) {
      expect(Object.keys(e).sort()).toEqual(["email", "id", "nom", "roles"]);
    }
    expect(page.elements.find((e) => e.id === s.dirigeant.utilisateurId)).toMatchObject({
      email: s.dirigeant.email,
      roles: ["client_dirigeant"],
    });
    // Chaque répondant listé est accepté à la création d'un envoi ; un exclu, non.
    const corps = (utilisateur_id: string) => ({
      version_id: versionId,
      mode: "individuel",
      repondants: [{ utilisateur_id }],
    });
    const refus = await s.consultant.post(
      `/api/missions/${s.missionId}/questionnaires`,
      corps(s.investisseur.utilisateurId),
    );
    expect(refus.statusCode).toBe(400);

    // Pagination par curseur (par nom), sans doublon.
    const p1 = await s.consultant.get(url(s.missionId, "?limite=1"));
    expect(p1.json().elements).toHaveLength(1);
    const p2 = await s.consultant.get(
      url(s.missionId, `?limite=1&curseur=${p1.json().curseur_suivant}`),
    );
    expect([...ids(p1), ...ids(p2)].sort()).toEqual([...ids(r)].sort());
  });

  it("client archivé : plus aucun répondant désignable", async () => {
    const c3 = await s.a.associe.post("/api/clients", { raison_sociale: "Client A3 (fictif)" });
    attendre(201, c3, "client A3");
    const clientA3 = c3.json().id as string;
    const mission = (await creerMission(s.a, { intitule: "Mission A3", client_id: clientA3 })).id;
    await ajouterEquipe(s.a, mission, s.consultant.utilisateurId);
    const dirigeantA3 = await inviterClient(ctx, s.a.associe, clientA3, ["client_dirigeant"]);
    expect(ids(await s.consultant.get(url(mission)))).toEqual([dirigeantA3.utilisateurId]);
    await proprietaire((c) =>
      c.query("UPDATE clients SET actif = false WHERE id = $1", [clientA3]),
    );
    const r = await s.consultant.get(url(mission));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ elements: [], curseur_suivant: null });
    const envoi = await s.consultant.post(`/api/missions/${mission}/questionnaires`, {
      version_id: versionId,
      mode: "individuel",
      repondants: [{ utilisateur_id: dirigeantA3.utilisateurId }],
    });
    expect(envoi.statusCode).toBe(400);
  });
});
