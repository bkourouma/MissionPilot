import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import { planifierSyntheseHebdo } from "../src/canaux/synthese.js";
import { creerHandlerCanalRelanceQuestionnaire } from "../src/canaux/relance-questionnaire.js";
import { creerKpi, mesurer } from "./kpi-outils.js";
import { proprietaire } from "./helpers.js";
import { attendre, inviterClient } from "./portail-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  repondre,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";
import {
  activerComptes,
  demarrerCanaux,
  destinataireForce,
  destinataireVerifie,
  envoisDe,
  executerJobs,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Relance J+10 d'un questionnaire (SPEC-3c §7.3) et synthèse hebdomadaire du dirigeant (§7.4, CLI-07),
 * aperçu côté cabinet, portail : classe R0, au plus un envoi par clé, données minimales.
 */

const JOUR = 86_400_000;
let ctx: ContexteCanaux;
let s: ScenarioQuestionnaires;
let versionId: string;
let definition: DefinitionQuestionnaire;
let compte: string;

beforeAll(async () => {
  ctx = await demarrerCanaux();
  s = await preparerQuestionnaires(ctx);
  ({ versionId, definition } = await versionValidee(s.consultant, "relance_canaux"));
  compte = (await activerComptes(s.a)).whatsapp;
}, 300_000);
afterAll(() => ctx.fermer());

const cle = (envoiId: string) => `questionnaire_j10:${envoiId}`;
const jobs = (envoiId: string) =>
  proprietaire(
    async (c) =>
      (await c.query("SELECT id, statut, execute_a FROM jobs WHERE cle = $1", [cle(envoiId)])).rows,
  );

describe("relance J+10 par WhatsApp", () => {
  it("un job à l'envoi ; à J+10 un seul message pour qui a consenti, rien pour les autres ; rejeu sans doublon", async () => {
    const a1 = s.dirigeant;
    const b1 = s.contributeur;
    const c1 = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]);
    const destA = await destinataireVerifie(
      ctx,
      s.a,
      a1.utilisateurId,
      "whatsapp",
      "+2250000000061",
    );
    // B : aucun consentement ; C : consentement mais numéro indisponible (99).
    await ctx.app.inject({ method: "GET", url: "/api/sante" });
    const destC = await destinataireForce(s.a, c1.utilisateurId, "whatsapp", "+2250000000099");
    const envoiId = await envoyer(
      s.consultant,
      s.missionId,
      versionId,
      [a1, b1, c1].map((u) => ({ utilisateur_id: u.utilisateurId })),
    );
    const titre = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT titre FROM questionnaire_envois WHERE id = $1", [envoiId])).rows[0]
          .titre as string,
    );
    const j = await jobs(envoiId);
    expect(j).toHaveLength(1);
    const prevu = new Date(j[0].execute_a as string).getTime();
    expect(prevu - Date.now()).toBeGreaterThan(9.9 * JOUR);

    const avant = ctx.whatsapp.boite.length;
    await executerJobs(ctx, new Date(Date.now() + 10 * JOUR + 60_000));
    const lignesA = (await envoisDe(destA)).filter((l) => l.cle.startsWith("q_j10:"));
    expect(lignesA).toHaveLength(1);
    expect(lignesA[0]).toMatchObject({ gabarit: "relance_questionnaire_j10", statut: "accepte" });
    expect(lignesA[0].cle).toContain(envoiId);
    const msg = ctx.whatsapp.boite.slice(avant).find((m) => m.numero === "+2250000000061");
    // Données minimales : le lien du portail, ni le titre, ni un nom, ni la mission.
    expect(msg?.texte).toContain(`/portail/questionnaires/${envoiId}`);
    expect(titre.length).toBeGreaterThan(3);
    expect(msg?.texte).not.toContain(titre);
    expect(msg?.texte).not.toContain(a1.email);
    expect(msg?.texte).not.toMatch(/Personne cliente/);
    // B n'a rien reçu ; C est en file (puis retente).
    const destB = await proprietaire(
      async (cl) =>
        (
          await cl.query("SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1", [
            b1.utilisateurId,
          ])
        ).rows,
    );
    expect(destB).toEqual([]);
    expect((await envoisDe(destC)).filter((l) => l.cle.startsWith("q_j10:"))).toHaveLength(1);

    // Rejeu du job (second worker) : toujours un seul envoi pour A.
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      creerHandlerCanalRelanceQuestionnaire(() => ({ config: ctx.config, canaux: ctx.canaux }))({
        db,
        cabinetId: s.a.cabinetId,
        jobId: "00000000-0000-4000-8000-000000000000",
        charge: { envoi_id: envoiId },
        maintenant: new Date(Date.now() + 10 * JOUR + 120_000),
      }),
    );
    expect((await envoisDe(destA)).filter((l) => l.cle.startsWith("q_j10:"))).toHaveLength(1);
  });

  it("répondant qui a déjà répondu, relances automatiques désactivées, compte inactif : aucun envoi", async () => {
    const u = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]);
    const dest = await destinataireVerifie(ctx, s.a, u.utilisateurId, "whatsapp", "+2250000000062");
    const repondu = await envoyer(s.consultant, s.missionId, versionId, [
      { utilisateur_id: u.utilisateurId },
    ]);
    await repondre(u, repondu, reponsesAuNiveau(definition, 4));
    const sansAuto = await envoyer(
      s.consultant,
      s.missionId,
      versionId,
      [{ utilisateur_id: u.utilisateurId }],
      "individuel",
      { relances_auto: false },
    );
    await executerJobs(ctx, new Date(Date.now() + 10 * JOUR + 60_000));
    const lignes = (await envoisDe(dest)).filter((l) => l.cle.startsWith("q_j10:"));
    expect(lignes.map((l) => l.cle)).not.toContain(`q_j10:${repondu}:`);
    expect(lignes.some((l) => l.cle.includes(repondu) || l.cle.includes(sansAuto))).toBe(false);
    // Compte inactif au moment de l'envoi : pas de job J+10 du tout.
    attendre(
      200,
      await s.a.associe.put("/api/canaux/comptes/whatsapp", { actif: false }),
      "désactivation",
    );
    const inactif = await envoyer(s.consultant, s.missionId, versionId, [
      { utilisateur_id: u.utilisateurId },
    ]);
    expect(await jobs(inactif)).toEqual([]);
    attendre(
      200,
      await s.a.associe.put("/api/canaux/comptes/whatsapp", {
        actif: true,
        mot_de_passe: "Test-motdepasse-1",
      }),
      "réactivation",
    );
  });
});

describe("synthèse hebdomadaire du dirigeant", () => {
  const LUNDI = new Date("2026-10-12T00:00:00Z");
  let destDirigeant: string;
  let destA2: string;

  it("aperçu : deux nombres exacts, texte rendu, aucun envoi créé, audit, 31e aperçu en 10 minutes : 429", async () => {
    // 3 KPI (2 rouges, 1 orange) dont le dirigeant est contributeur ; 2 questionnaires à compléter.
    const a1 = s.dirigeant;
    destDirigeant = (
      await proprietaire(
        async (c) =>
          (
            await c.query(
              "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'whatsapp'",
              [a1.utilisateurId],
            )
          ).rows[0],
      )
    ).id as string;
    const valeurs = [500, 400, 850];
    for (const [i, v] of valeurs.entries()) {
      const k = await creerKpi(s.a.chef, s.missionId, {
        libelle: `Indicateur synthèse ${i}`,
        cible: 1000,
      });
      attendre(
        200,
        await s.a.chef.put(`/api/kpi/${k.id}/contributeurs`, { utilisateurs: [a1.utilisateurId] }),
        "contributeur",
      );
      await mesurer(s.a.chef, k.id, "2026-09-15", v);
    }
    await envoyer(s.consultant, s.missionId, versionId, [{ utilisateur_id: a1.utilisateurId }]);
    await envoyer(s.consultant, s.missionId, versionId, [{ utilisateur_id: a1.utilisateurId }]);
    const avant = await proprietaire(
      async (c) =>
        (await c.query("SELECT count(*)::int AS n FROM canaux_envois")).rows[0].n as number,
    );
    const r = await s.a.associe.get(
      `/api/canaux/synthese-dirigeant/apercu?client_id=${s.a.clientId}&destinataire_id=${a1.utilisateurId}`,
    );
    attendre(200, r, "aperçu");
    const apercu = r.json();
    expect(apercu).toMatchObject({ points_attention: 3, vide: false, mode_fournisseur: "simule" });
    expect(apercu.decisions_attendues).toBeGreaterThanOrEqual(2);
    expect(apercu.texte_message).toContain(
      `(3 point(s) d'attention, ${apercu.decisions_attendues} décision(s) attendue(s))`,
    );
    expect(apercu.texte_message).toContain("/portail/synthese");
    expect(JSON.stringify(apercu)).not.toMatch(/coût|marge|honoraire|montant/i);
    expect(
      await proprietaire(
        async (c) =>
          (await c.query("SELECT count(*)::int AS n FROM canaux_envois")).rows[0].n as number,
      ),
    ).toBe(avant);
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'canal.synthese.apercu' AND cabinet_id = $1",
            [s.a.cabinetId],
          )
        ).rows[0].n as number,
    );
    expect(audit).toBe(1);
    // Plafond : 30 aperçus par 10 minutes et par utilisateur (comptés en base).
    await proprietaire((c) =>
      c.query(
        `INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite)
         SELECT $1, $2, 'canal.synthese.apercu', 'client' FROM generate_series(1, 29)`,
        [s.a.cabinetId, s.a.associeId],
      ),
    );
    const trop = await s.a.associe.get(
      `/api/canaux/synthese-dirigeant/apercu?client_id=${s.a.clientId}&destinataire_id=${a1.utilisateurId}`,
    );
    expect(trop.statusCode).toBe(429);
    // Droits et isolation : sans canaux.lire 403 ; client ou dirigeant inconnu 404 ; autre cabinet 404.
    expect(
      (
        await s.consultant.get(
          `/api/canaux/synthese-dirigeant/apercu?client_id=${s.a.clientId}&destinataire_id=${a1.utilisateurId}`,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.b.associe.get(
          `/api/canaux/synthese-dirigeant/apercu?client_id=${s.a.clientId}&destinataire_id=${a1.utilisateurId}`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it("job du lundi : un envoi par destinataire et par semaine, rejeu sans doublon, rien à signaler : aucun envoi et audit", async () => {
    destA2 = await destinataireVerifie(
      ctx,
      s.a,
      s.dirigeantA2.utilisateurId,
      "whatsapp",
      "+2250000000063",
    );
    await proprietaire((c) => c.query("DELETE FROM jobs WHERE type = 'canal_synthese_hebdo'"));
    // La planification ne vise que le lundi, et que les cabinets dont l'option est active.
    await ctx.db.withoutTenant(async (db) => {
      expect(await planifierSyntheseHebdo(db, new Date("2026-10-13T10:00:00Z"))).toBe(0);
      expect(await planifierSyntheseHebdo(db, LUNDI)).toBeGreaterThanOrEqual(1);
      expect(await planifierSyntheseHebdo(db, LUNDI)).toBe(0);
    });
    await executerJobs(ctx, new Date("2026-10-12T08:00:00Z"));
    const semaine = (await envoisDe(destDirigeant)).filter((l) =>
      l.cle.startsWith("synthese:2026-10-12:"),
    );
    expect(semaine).toHaveLength(1);
    expect(semaine[0]).toMatchObject({ gabarit: "synthese_hebdo", statut: "accepte" });
    const message = ctx.whatsapp.boite.find(
      (m) => m.gabarit === "synthese_hebdo" && m.numero === "+2250000000061",
    );
    expect(message?.texte).toMatch(/\(3 point\(s\) d'attention, \d+ décision\(s\) attendue\(s\)\)/);
    // Rien à signaler pour le second client : aucun envoi, ligne d'audit.
    expect((await envoisDe(destA2)).filter((l) => l.gabarit === "synthese_hebdo")).toEqual([]);
    const vide = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'canal.synthese.vide' AND cabinet_id = $1",
            [s.a.cabinetId],
          )
        ).rows[0].n as number,
    );
    expect(vide).toBeGreaterThanOrEqual(1);
    // Rejeu : une seule ligne pour la semaine.
    await proprietaire((c) => c.query("DELETE FROM jobs WHERE type = 'canal_synthese_hebdo'"));
    await ctx.db.withoutTenant((db) => planifierSyntheseHebdo(db, LUNDI));
    await executerJobs(ctx, new Date("2026-10-12T09:00:00Z"));
    expect(
      (await envoisDe(destDirigeant)).filter((l) => l.cle.startsWith("synthese:2026-10-12:")),
    ).toHaveLength(1);
  });

  it("portail : sa synthèse seulement (contributeur 403, autre client : ses propres données)", async () => {
    attendre(200, await s.dirigeant.get("/api/portail/synthese"), "dirigeant");
    const moi = (await s.dirigeant.get("/api/portail/synthese")).json();
    expect(moi.points_attention).toBe(3);
    expect(JSON.stringify(moi)).not.toMatch(/coût|marge|honoraire|montant|@/i);
    expect((await s.contributeur.get("/api/portail/synthese")).statusCode).toBe(403);
    const autre = await s.dirigeantA2.get("/api/portail/synthese");
    attendre(200, autre, "autre client");
    expect(autre.json()).toMatchObject({ points_attention: 0, vide: true });
    expect((await s.dirigeantB.get("/api/portail/synthese")).json().points_attention).toBe(0);
    expect((await s.anonyme.get("/api/portail/synthese")).statusCode).toBe(401);
    void compte;
  });
});
