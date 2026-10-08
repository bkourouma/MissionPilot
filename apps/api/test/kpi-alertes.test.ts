import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerRegistre } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import {
  creerHandlerSuiviKpi,
  planificationSuiviKpi,
  planifierSuiviKpi,
  suivreKpis,
  TYPE_JOB_SUIVI_KPI,
} from "../src/kpi/suivi.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  preparerJeuTableau,
  preparerKpi,
  preparerPortailKpi,
  type JeuTableau,
  type ScenarioKpi,
} from "./kpi-outils.js";
import { attendre, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Alertes KPI-04 et rappels de mesure en retard (KPI-02) : détectés par le
 * moteur, enregistrés une seule fois (idempotence par KPI, code et
 * période), notifiés aux responsables ; rappels par la file de tâches,
 * désactivables pour le cabinet et par KPI. Aucun e-mail ne sort : transport
 * « journal » des tests.
 */

let ctx: Contexte;
let s: ScenarioKpi;
let jeu: JeuTableau;
let contributeur: UtilisateurPortail;
const mailer = new MailerJournal();

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerKpi(ctx, "KPI alertes");
  jeu = await preparerJeuTableau(s);
  contributeur = (await preparerPortailKpi(ctx, s)).contributeur;
  attendre(
    200,
    await s.a.chef.put(`/api/kpi/${jeu.delai}/contributeurs`, {
      utilisateurs: [contributeur.utilisateurId],
    }),
    "contributeurs",
  );
}, 180_000);
afterAll(() => ctx.fermer());

const lignes = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);

const alertesDe = (kpiId: string) =>
  lignes("SELECT code, periode_cle FROM kpi_alertes WHERE kpi_id = $1 ORDER BY code, periode_cle", [
    kpiId,
  ]);
const rappelsDe = (kpiId: string) =>
  lignes(
    "SELECT periode_cle, destinataires FROM kpi_rappels WHERE kpi_id = $1 ORDER BY periode_cle",
    [kpiId],
  );
const notificationsDe = (utilisateurId: string, type: string) =>
  lignes(
    "SELECT titre, lien FROM notifications WHERE destinataire_id = $1 AND type = $2 ORDER BY cree_le",
    [utilisateurId, type],
  );

/** Planifie et exécute la tâche du jour avec une horloge fixe ; rend les jobs KPI traités. */
async function executerSuivi(iso: string) {
  const maintenant = new Date(iso);
  const planifies = await planifierSuiviKpi(ctx.db, maintenant);
  const worker = new WorkerJobs(ctx.db, {
    mailer,
    registre: creerRegistre({ [TYPE_JOB_SUIVI_KPI]: creerHandlerSuiviKpi() }),
    horloge: () => maintenant,
  });
  const resultats = [];
  for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
  return { planifies, resultats: resultats.filter((r) => r.type === TYPE_JOB_SUIVI_KPI) };
}

describe("alertes enregistrées après la saisie", () => {
  it("seuil d'alerte franchi : alerte unique, responsables notifiés, sans valeur chiffrée", async () => {
    // La saisie de mars (62 > 60) a été évaluée à la validation (seuils et dégradation seulement).
    expect(await alertesDe(jeu.delai)).toEqual([{ code: "SEUIL_HAUT", periode_cle: "2026-03" }]);
    const n = await notificationsDe(s.a.chef.utilisateurId, "kpi_alerte");
    expect(n).toHaveLength(1);
    expect(n[0].titre).toContain("Délai moyen de paiement client");
    expect(n[0].titre).not.toMatch(/62|60/);
    expect(n[0].lien).toBe(`/missions/${s.missionId}/kpi`);
  });
});

describe("tâche quotidienne kpi_suivi", () => {
  it("planification idempotente : une tâche par cabinet et par jour", async () => {
    const p = planificationSuiviKpi(new Date("2026-05-15T06:00:00Z"));
    expect(p).toMatchObject({ cle: "kpi_suivi:2026-05-15", jour: "2026-05-15" });
    const { planifies, resultats } = await executerSuivi("2026-05-15T08:00:00Z");
    expect(planifies).toBeGreaterThanOrEqual(1);
    expect(resultats.length).toBe(planifies);
    expect(resultats.every((r) => r.statut === "termine")).toBe(true);
    expect((await executerSuivi("2026-05-15T09:00:00Z")).planifies).toBe(0);
  });

  it("dégradation et retard détectés par le moteur ; rappel aux contributeurs et au propriétaire", async () => {
    expect(await alertesDe(jeu.ca)).toEqual([
      { code: "DEGRADATION_CONSECUTIVE", periode_cle: "2026-04" },
    ]);
    expect(await alertesDe(jeu.delai)).toEqual([
      { code: "MESURE_EN_RETARD", periode_cle: "2026-04" },
      { code: "SEUIL_HAUT", periode_cle: "2026-03" },
    ]);
    // CA : propriétaire = directeur, plus le chef de mission ; une notification chacun.
    for (const id of [s.a.directeur.utilisateurId, s.a.chef.utilisateurId]) {
      const n = await notificationsDe(id, "kpi_alerte");
      expect(n.filter((x) => String(x.titre).includes("dégradation"))).toHaveLength(1);
    }
    expect(await rappelsDe(jeu.delai)).toEqual([{ periode_cle: "2026-04", destinataires: 2 }]);
    const rappel = await notificationsDe(contributeur.utilisateurId, "kpi_rappel_mesure");
    expect(rappel).toEqual([
      {
        titre: "Mesure attendue pour le KPI « Délai moyen de paiement client » (2026-04)",
        lien: `/portail/kpi/${jeu.delai}`,
      },
    ]);
    expect(mailer.dernierPour(contributeur.email)?.sujet).toContain("Mesure attendue");
    // Le contributeur du portail ne reçoit jamais les alertes internes.
    expect(await notificationsDe(contributeur.utilisateurId, "kpi_alerte")).toEqual([]);
  });

  it("relancée, l'évaluation ne recrée ni alerte, ni rappel, ni notification", async () => {
    const avant = await lignes(
      "SELECT count(*)::int AS n FROM notifications WHERE cabinet_id = $1",
      [s.a.cabinetId],
    );
    const creees = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      suivreKpis(db, s.a.cabinetId, "2026-05-15"),
    );
    expect(creees).toEqual([]);
    const apres = await lignes(
      "SELECT count(*)::int AS n FROM notifications WHERE cabinet_id = $1",
      [s.a.cabinetId],
    );
    expect(apres).toEqual(avant);
    expect(await rappelsDe(jeu.delai)).toHaveLength(1);
  });

  it("nouvelle période due : nouvelle alerte et nouveau rappel", async () => {
    await executerSuivi("2026-06-10T08:00:00Z");
    expect(await rappelsDe(jeu.delai)).toEqual([
      { periode_cle: "2026-04", destinataires: 2 },
      { periode_cle: "2026-05", destinataires: 2 },
    ]);
  });

  it("rappels désactivables : pour le cabinet, puis pour un KPI ; l'alerte reste enregistrée", async () => {
    attendre(
      200,
      await s.a.associe.patch("/api/kpi/parametres", { rappels_actifs: false }),
      "param",
    );
    await executerSuivi("2026-07-10T08:00:00Z");
    expect(await alertesDe(jeu.delai)).toContainEqual({
      code: "MESURE_EN_RETARD",
      periode_cle: "2026-06",
    });
    expect((await rappelsDe(jeu.delai)).map((r) => r.periode_cle)).toEqual(["2026-04", "2026-05"]);

    attendre(
      200,
      await s.a.associe.patch("/api/kpi/parametres", { rappels_actifs: true }),
      "param",
    );
    attendre(200, await s.a.chef.patch(`/api/kpi/${jeu.delai}`, { rappels_actifs: false }), "kpi");
    await executerSuivi("2026-08-10T08:00:00Z");
    expect((await rappelsDe(jeu.delai)).map((r) => r.periode_cle)).toEqual(["2026-04", "2026-05"]);

    attendre(200, await s.a.chef.patch(`/api/kpi/${jeu.delai}`, { rappels_actifs: true }), "kpi");
    await executerSuivi("2026-09-10T08:00:00Z");
    expect((await rappelsDe(jeu.delai)).map((r) => r.periode_cle)).toEqual([
      "2026-04",
      "2026-05",
      "2026-08",
    ]);
  });

  it("non-régression : rappel seulement si l'accès au portail ET l'entreprise cliente sont actifs", async () => {
    const suivre = (date: string) =>
      ctx.db.withTenant(s.a.cabinetId, (db) => suivreKpis(db, s.a.cabinetId, date));
    const rappelsRecus = async () =>
      (await notificationsDe(contributeur.utilisateurId, "kpi_rappel_mesure")).length;
    const avant = await rappelsRecus();
    // Accès au portail désactivé (compte toujours actif) : seul le propriétaire est prévenu.
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs_portail SET statut = 'desactive' WHERE utilisateur_id = $1", [
        contributeur.utilisateurId,
      ]),
    );
    await suivre("2026-10-10");
    expect(await rappelsDe(jeu.delai)).toContainEqual({ periode_cle: "2026-09", destinataires: 1 });
    expect(await rappelsRecus()).toBe(avant);
    // Accès réactivé mais entreprise cliente archivée : toujours pas de rappel au contributeur.
    await proprietaire(async (c) => {
      await c.query("UPDATE utilisateurs_portail SET statut = 'actif' WHERE utilisateur_id = $1", [
        contributeur.utilisateurId,
      ]);
      await c.query("UPDATE clients SET actif = false WHERE id = $1", [s.a.clientId]);
    });
    try {
      await suivre("2026-11-10");
      expect(await rappelsDe(jeu.delai)).toContainEqual({
        periode_cle: "2026-10",
        destinataires: 1,
      });
      expect(await rappelsRecus()).toBe(avant);
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE clients SET actif = true WHERE id = $1", [s.a.clientId]),
      );
    }
  });

  it("non-régression : un responsable qui ne lit plus les KPI n'est plus notifié", async () => {
    // Le directeur (propriétaire du KPI de CA) devient gestionnaire : sans kpi.lire.
    const alertesRecues = async (id: string) =>
      (await notificationsDe(id, "kpi_alerte")).filter((x) => String(x.titre).includes("retard"))
        .length;
    const directeurAvant = await alertesRecues(s.a.directeur.utilisateurId);
    const chefAvant = await alertesRecues(s.a.chef.utilisateurId);
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs SET roles = '{gestionnaire}' WHERE id = $1", [
        s.a.directeur.utilisateurId,
      ]),
    );
    try {
      await ctx.db.withTenant(s.a.cabinetId, (db) =>
        suivreKpis(db, s.a.cabinetId, "2026-12-10", { kpiIds: [jeu.ca] }),
      );
      expect(await alertesDe(jeu.ca)).toContainEqual({
        code: "MESURE_EN_RETARD",
        periode_cle: "2026-11",
      });
      expect(await alertesRecues(s.a.directeur.utilisateurId)).toBe(directeurAvant);
      expect(await alertesRecues(s.a.chef.utilisateurId)).toBe(chefAvant + 1);
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE utilisateurs SET roles = '{directeur_mission}' WHERE id = $1", [
          s.a.directeur.utilisateurId,
        ]),
      );
    }
  });

  it("historique des alertes : lecture paginée, ajout seul", async () => {
    const r = await s.a.chef.get(`/api/kpi/${jeu.delai}/alertes?limite=2`);
    expect(r.statusCode).toBe(200);
    expect(r.json().elements).toHaveLength(2);
    expect(r.json().curseur_suivant).not.toBeNull();
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("DELETE FROM kpi_alertes WHERE kpi_id = $1", [jeu.delai]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      proprietaire((c) => c.query("UPDATE kpi_rappels SET destinataires = 0")),
    ).rejects.toMatchObject({ code: "MPK05" });
  });
});
