import { composerBrief, type BriefCompose } from "@missionpilot/engines";
import { ROLES_CLIENT } from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brancherDiagnostic } from "../src/automatisation/diagnostic.js";
import { EXTRACTEURS_BRIEF } from "../src/brief/calcul.js";
import type { Extracteur } from "../src/brief/commun.js";
import {
  creerHandlerBriefQuotidien,
  executerBriefQuotidien,
  planificationBriefQuotidien,
  planifierBriefQuotidien,
  titreNotificationBrief,
  TYPE_JOB_BRIEF_QUOTIDIEN,
} from "../src/brief/quotidien.js";
import { creerRegistre, type HandlerJob } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMissionSignee } from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";

/*
 * Tâche quotidienne « brief_quotidien » (AUT-07) : planifiée chaque jour ouvré à 7 h UTC, une par
 * cabinet et par jour ; une notification interne pour chaque utilisateur actif dont le brief n'est
 * pas vide, jamais pour un brief vide, un compte inactif ou un utilisateur du portail ; aucun
 * e-mail ; idempotente (deux exécutions le même jour = une seule notification).
 */

const LUNDI = "2026-10-12";
const mailer = new MailerJournal();

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let missionId: string;
let consultant: Awaited<ReturnType<typeof utilisateurCollaborateur>>;
let inactif: Awaited<ReturnType<typeof utilisateurCollaborateur>>;
let dirigeantId: string;

const lignes = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);

const notificationsDe = (utilisateurId: string) =>
  lignes(
    `SELECT titre, corps, lien FROM notifications
     WHERE destinataire_id = $1 AND type = 'brief_quotidien' ORDER BY cree_le`,
    [utilisateurId],
  );

/**
 * La base de test est PARTAGÉE par tout le run (des centaines de cabinets créés par les autres
 * fichiers) et la planification vise tous les cabinets : le worker ne traite ici que les
 * cabinets de ce fichier (sinon le calcul de chaque brief de chaque cabinet dépasse le délai).
 */
const seulementMesCabinets =
  (h: HandlerJob): HandlerJob =>
  async (args) => {
    if (args.cabinetId !== a.cabinetId && args.cabinetId !== b.cabinetId) return;
    await h(args);
  };

/** Planifie et exécute les tâches du jour avec une horloge fixe ; rend les tâches « brief » traitées. */
async function executer(iso: string) {
  const maintenant = new Date(iso);
  const planifies = await ctx.db.withoutTenant((db) => planifierBriefQuotidien(db, maintenant));
  const worker = new WorkerJobs(ctx.db, {
    mailer,
    registre: creerRegistre({
      [TYPE_JOB_BRIEF_QUOTIDIEN]: seulementMesCabinets(creerHandlerBriefQuotidien()),
    }),
    horloge: () => maintenant,
  });
  const resultats = [];
  for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
  return { planifies, resultats: resultats.filter((r) => r.type === TYPE_JOB_BRIEF_QUOTIDIEN) };
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Brief job A");
  b = await preparerFacturation(ctx, "Brief job B");
  missionId = (await creerMissionSignee(a, { intitule: "Mission du brief" })).id;
  consultant = await utilisateurCollaborateur(a, ["consultant"]);
  inactif = await utilisateurCollaborateur(a, ["consultant"]);
  attendre(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultant.utilisateurId,
    }),
    "équipe",
  );
  // Le consultant dépose un débours : à décider pour le chef, le directeur et l'associé.
  const d = await consultant.post(`/api/missions/${missionId}/debours`, {
    date: "2026-10-05",
    categorie: "transport",
    libelle: "Billet",
    montant: 45_000,
    refacturable: true,
  });
  attendre(201, d, "débours");
  attendre(200, await consultant.post(`/api/debours/${d.json().id}/soumettre`), "soumission");
  // Tâches en retard : une pour le consultant, une pour un compte qui sera inactif.
  for (const u of [consultant, inactif]) {
    attendre(
      201,
      await a.chef.post("/api/taches-collaboration", {
        titre: "Relire le dossier",
        assignee_id: u.utilisateurId,
        echeance: "2026-03-01",
      }),
      "tâche",
    );
  }
  await proprietaire(async (c) => {
    await c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [inactif.utilisateurId]);
    // Arrivés après la date de rejeu : aucune feuille de temps non soumise (jours ouvrés d'avant).
    await c.query("UPDATE collaborateurs SET cree_le = '2026-12-01' WHERE id = ANY ($1::uuid[])", [
      [consultant.collaborateurId, inactif.collaborateurId],
    ]);
  });
  dirigeantId = (await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]))
    .utilisateurId;
}, 180_000);
afterAll(() => ctx.fermer());

describe("planification", () => {
  it("jour ouvré à 7 h UTC, clé par jour ; ni samedi ni dimanche", () => {
    const lundi = planificationBriefQuotidien(new Date("2026-10-12T03:00:00Z"));
    expect(lundi).toMatchObject({
      cle: `${TYPE_JOB_BRIEF_QUOTIDIEN}:2026-10-12`,
      jour: "2026-10-12",
      ouvre: true,
    });
    expect(lundi.executeA.toISOString()).toBe("2026-10-12T07:00:00.000Z");
    expect(planificationBriefQuotidien(new Date("2026-10-16T20:00:00Z")).ouvre).toBe(true);
    expect(planificationBriefQuotidien(new Date("2026-10-17T08:00:00Z")).ouvre).toBe(false);
    expect(planificationBriefQuotidien(new Date("2026-10-18T08:00:00Z")).ouvre).toBe(false);
  });

  it("aucune tâche le week-end ; une seule par cabinet et par jour ouvré", async () => {
    const dimanche = new Date("2026-10-18T08:00:00Z");
    expect(await ctx.db.withoutTenant((db) => planifierBriefQuotidien(db, dimanche))).toBe(0);
    const maintenant = new Date("2026-10-19T06:00:00Z");
    const n = await ctx.db.withoutTenant((db) => planifierBriefQuotidien(db, maintenant));
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await ctx.db.withoutTenant((db) => planifierBriefQuotidien(db, maintenant))).toBe(0);
    const taches = await lignes("SELECT cabinet_id FROM jobs WHERE type = $1 AND cle = $2", [
      TYPE_JOB_BRIEF_QUOTIDIEN,
      "brief_quotidien:2026-10-19",
    ]);
    expect(new Set(taches.map((t) => t.cabinet_id)).size).toBe(taches.length);
    // Retire ces tâches : elles ne concernent pas la suite.
    await proprietaire((c) =>
      c.query("DELETE FROM jobs WHERE cle = $1", ["brief_quotidien:2026-10-19"]),
    );
  });
});

describe("tâche quotidienne", () => {
  it("notifie chaque utilisateur actif dont le brief n'est pas vide, avec les décomptes du brief", async () => {
    const { planifies, resultats } = await executer(`${LUNDI}T08:00:00Z`);
    expect(planifies).toBeGreaterThanOrEqual(2);
    expect(resultats.length).toBe(planifies);
    expect(resultats.every((r) => r.statut === "termine")).toBe(true);

    // Le consultant : sa tâche en retard (1 qui dérive).
    expect(await notificationsDe(consultant.utilisateurId)).toEqual([
      {
        titre: "Votre brief du jour : 1 élément (0 à décider, 1 qui dérive)",
        corps: `Brief du ${LUNDI}.`,
        lien: "/brief",
      },
    ]);
    // Le chef, le directeur et l'associé : le débours à valider (1 à décider).
    for (const id of [a.chef.utilisateurId, a.directeur.utilisateurId, a.associeId]) {
      const n = await notificationsDe(id);
      expect(n, id).toHaveLength(1);
      expect(n[0]?.titre).toMatch(
        /^Votre brief du jour : \d+ éléments? \(\d+ à décider, \d+ qui dérive(?:nt)?\)$/,
      );
      expect(n[0]?.lien).toBe("/brief");
    }
    expect((await notificationsDe(a.chef.utilisateurId))[0]?.titre).toBe(
      "Votre brief du jour : 1 élément (1 à décider, 0 qui dérive)",
    );
  });

  it("un brief vide ne génère aucune notification ; ni compte inactif, ni portail", async () => {
    for (const id of [a.gestionnaire.utilisateurId, inactif.utilisateurId, dirigeantId]) {
      expect(await notificationsDe(id), id).toEqual([]);
    }
    // Cabinet B : rien à signaler pour personne.
    const b2 = await lignes(
      "SELECT count(*)::int AS n FROM notifications WHERE cabinet_id = $1 AND type = 'brief_quotidien'",
      [b.cabinetId],
    );
    expect(b2[0]?.n).toBe(0);
  });

  it("le contenu de la notification est celui du brief de l'utilisateur, sans aucun montant", async () => {
    const brief = (await a.chef.get(`/api/brief?date=${LUNDI}`)).json() as BriefCompose;
    const n = await notificationsDe(a.chef.utilisateurId);
    expect(n[0]?.titre).toBe(titreNotificationBrief(brief));
    expect(JSON.stringify(n)).not.toMatch(/45\s?000|XOF|FCFA/);
  });

  it("aucun e-mail n'est envoyé (e-mail désactivé par défaut pour le brief)", async () => {
    expect(mailer.boite).toEqual([]);
    const brief = await lignes(
      "SELECT count(*)::int AS n FROM notifications WHERE cabinet_id = $1 AND type = 'brief_quotidien'",
      [a.cabinetId],
    );
    expect(brief[0]?.n).toBe(4);
  });

  it("idempotente : deux exécutions le même jour, une seule notification", async () => {
    // Même jour, même heure : la clé du jour interdit une seconde tâche.
    const second = await executer(`${LUNDI}T09:00:00Z`);
    expect(second.planifies).toBe(0);
    // Tâche rejouée de force (clé différente, même charge) : le handler ne renotifie pas.
    await proprietaire((c) =>
      c.query(
        `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
         VALUES ($1, $2, $3, $4, 'brief_quotidien:rejeu-test')`,
        [
          a.cabinetId,
          TYPE_JOB_BRIEF_QUOTIDIEN,
          JSON.stringify({ date: LUNDI }),
          `${LUNDI}T10:00:00Z`,
        ],
      ),
    );
    const worker = new WorkerJobs(ctx.db, {
      mailer,
      registre: creerRegistre({
        [TYPE_JOB_BRIEF_QUOTIDIEN]: seulementMesCabinets(creerHandlerBriefQuotidien()),
      }),
      horloge: () => new Date(`${LUNDI}T11:00:00Z`),
    });
    for (let r = await worker.traiterUn(); r; r = await worker.traiterUn());
    for (const id of [consultant.utilisateurId, a.chef.utilisateurId, a.directeur.utilisateurId]) {
      expect(await notificationsDe(id), id).toHaveLength(1);
    }
  });

  it("le lendemain, une nouvelle notification (une par jour)", async () => {
    const { resultats } = await executer("2026-10-13T08:00:00Z");
    expect(resultats.length).toBeGreaterThanOrEqual(1);
    expect(await notificationsDe(a.chef.utilisateurId)).toHaveLength(2);
    expect((await notificationsDe(a.chef.utilisateurId))[1]?.corps).toBe("Brief du 2026-10-13.");
  });

  it("charge invalide : tâche en échec définitif, sans notification", async () => {
    await proprietaire((c) =>
      c.query(
        `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
         VALUES ($1, $2, $3, $4, 'brief_quotidien:charge-invalide')`,
        [
          b.cabinetId,
          TYPE_JOB_BRIEF_QUOTIDIEN,
          JSON.stringify({ date: "pas-une-date" }),
          "2026-10-14T07:00:00Z",
        ],
      ),
    );
    const worker = new WorkerJobs(ctx.db, {
      mailer,
      registre: creerRegistre({
        [TYPE_JOB_BRIEF_QUOTIDIEN]: seulementMesCabinets(creerHandlerBriefQuotidien()),
      }),
      horloge: () => new Date("2026-10-14T08:00:00Z"),
    });
    const resultats = [];
    for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
    const invalide = resultats.filter((r) => r.type === TYPE_JOB_BRIEF_QUOTIDIEN);
    expect(invalide.some((r) => r.statut === "echec")).toBe(true);
  });
});

/** Exécute en chaîne (tâche initiale + suites) avec un lot injecté et une horloge fixe. */
async function executerParLots(cabinetId: string, date: string, lot: number, cle: string) {
  await proprietaire((c) =>
    c.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle) VALUES ($1, $2, $3, $4, $5)`,
      [cabinetId, TYPE_JOB_BRIEF_QUOTIDIEN, JSON.stringify({ date }), `${date}T07:00:00Z`, cle],
    ),
  );
  const worker = new WorkerJobs(ctx.db, {
    mailer,
    registre: creerRegistre({
      [TYPE_JOB_BRIEF_QUOTIDIEN]: seulementMesCabinets(creerHandlerBriefQuotidien({ lot })),
    }),
    horloge: () => new Date(`${date}T08:00:00Z`),
  });
  const resultats = [];
  for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
  return resultats.filter((r) => r.type === TYPE_JOB_BRIEF_QUOTIDIEN);
}

const tachesDuJour = (cabinetId: string, date: string) =>
  lignes(
    `SELECT cle, statut, charge FROM jobs
     WHERE cabinet_id = $1 AND type = $2 AND cle LIKE $3 ORDER BY cree_le, cle`,
    [cabinetId, TYPE_JOB_BRIEF_QUOTIDIEN, `brief_quotidien:${date}%`],
  );

describe("volume : lots et tâches de suite", () => {
  const DATE = "2026-10-15";

  it("tous les internes reçoivent leur brief en plusieurs passes, une notification chacun, portail exclu du lot", async () => {
    const internes = (
      await lignes(
        `SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND actif AND NOT (roles && $2::text[])
         ORDER BY id`,
        [a.cabinetId, [...ROLES_CLIENT]],
      )
    ).map((l) => l.id as string);
    // Le compte du portail (client_dirigeant) existe : il n'occupe aucune place du lot.
    const tous = await lignes(
      "SELECT count(*)::int AS n FROM utilisateurs WHERE cabinet_id = $1 AND actif",
      [a.cabinetId],
    );
    expect(tous[0]?.n).toBeGreaterThan(internes.length);
    expect(internes.length).toBeGreaterThanOrEqual(5);

    const resultats = await executerParLots(a.cabinetId, DATE, 2, `brief_quotidien:${DATE}`);
    const pages = Math.ceil(internes.length / 2);
    expect(resultats).toHaveLength(pages);
    expect(resultats.every((r) => r.statut === "termine")).toBe(true);

    const taches = await tachesDuJour(a.cabinetId, DATE);
    expect(taches).toHaveLength(pages);
    // Curseurs : dernier identifiant de chaque lot précédent (internes seulement, ordre des id).
    const suites = taches.filter((t) => t.cle !== `brief_quotidien:${DATE}`);
    expect(suites.map((t) => t.charge)).toEqual(
      Array.from({ length: pages - 1 }, (_, i) => ({
        date: DATE,
        apres_id: internes[2 * i + 1],
      })),
    );
    expect(suites.map((t) => t.cle)).toEqual(
      suites.map((t) => `brief_quotidien:${DATE}:apres:${t.charge.apres_id}`),
    );

    // Une seule notification chacun, y compris pour ceux traités dans une passe de suite.
    for (const id of [consultant.utilisateurId, a.chef.utilisateurId, a.directeur.utilisateurId]) {
      const n = await lignes(
        `SELECT 1 FROM notifications WHERE destinataire_id = $1 AND type = 'brief_quotidien'
           AND corps = $2`,
        [id, `Brief du ${DATE}.`],
      );
      expect(n, id).toHaveLength(1);
    }
    expect(await notificationsDe(dirigeantId)).toEqual([]);
  });

  it("rejouer la chaîne (même jour) ne notifie personne de plus et ne crée aucune tâche de suite en double", async () => {
    const avant = await lignes(
      `SELECT count(*)::int AS n FROM notifications WHERE cabinet_id = $1
         AND type = 'brief_quotidien' AND corps = $2`,
      [a.cabinetId, `Brief du ${DATE}.`],
    );
    expect(avant[0]?.n).toBeGreaterThanOrEqual(4);
    const tachesAvant = (await tachesDuJour(a.cabinetId, DATE)).length;
    await executerParLots(a.cabinetId, DATE, 2, "brief_quotidien:rejeu-chaine");
    const apres = await lignes(
      `SELECT count(*)::int AS n FROM notifications WHERE cabinet_id = $1
         AND type = 'brief_quotidien' AND corps = $2`,
      [a.cabinetId, `Brief du ${DATE}.`],
    );
    expect(apres[0]?.n).toBe(avant[0]?.n);
    // Les suites ont les mêmes clés (cabinet, jour, curseur) : aucune nouvelle ligne `apres`.
    expect((await tachesDuJour(a.cabinetId, DATE)).length).toBe(tachesAvant);
    await proprietaire((c) =>
      c.query("DELETE FROM jobs WHERE cle = 'brief_quotidien:rejeu-chaine'"),
    );
  });

  it("un seul lot suffisant : aucune tâche de suite", async () => {
    const jour = "2026-10-16";
    const resultats = await executerParLots(b.cabinetId, jour, 500, `brief_quotidien:${jour}`);
    expect(resultats).toHaveLength(1);
    expect(await tachesDuJour(b.cabinetId, jour)).toHaveLength(1);
  });

  it("l'échec du brief d'un utilisateur est isolé, journalisé sans contenu et compté", async () => {
    const jour = "2026-10-19";
    const echouer: Extracteur = async (c) => {
      if (c.auth.utilisateurId === consultant.utilisateurId) {
        throw new Error("secret-du-message: contenu client");
      }
      return null;
    };
    const incidents: { entree: Record<string, unknown>; message: string }[] = [];
    const debrancher = brancherDiagnostic((entree, message) => incidents.push({ entree, message }));
    (EXTRACTEURS_BRIEF as Extracteur[]).push(echouer);
    try {
      const bilan = await ctx.db.withTenant(a.cabinetId, (db) =>
        executerBriefQuotidien(
          {
            db,
            cabinetId: a.cabinetId,
            jobId: "00000000-0000-4000-8000-000000000001",
            charge: { date: jour },
            maintenant: new Date(`${jour}T08:00:00Z`),
          },
          500,
        ),
      );
      expect(bilan.echecs).toBe(1);
      expect(bilan.suite).toBeNull();
      // Les autres sont notifiés ; le point de sauvegarde ne bloque pas la suite de la transaction.
      expect(bilan.notifications.length).toBeGreaterThanOrEqual(3);
    } finally {
      (EXTRACTEURS_BRIEF as Extracteur[]).pop();
      debrancher();
    }
    // Le consultant n'a pas de notification pour ce jour, le chef si.
    const pour = (id: string) =>
      lignes(
        "SELECT 1 FROM notifications WHERE destinataire_id = $1 AND type = 'brief_quotidien' AND corps = $2",
        [id, `Brief du ${jour}.`],
      );
    expect(await pour(consultant.utilisateurId)).toHaveLength(0);
    expect(await pour(a.chef.utilisateurId)).toHaveLength(1);
    const sorties = JSON.stringify(incidents);
    expect(incidents.some((i) => i.entree.contexte === "brief_quotidien")).toBe(true);
    const bilanJournal = incidents.find((i) => i.entree.contexte === "brief_quotidien_bilan");
    expect(bilanJournal?.entree).toMatchObject({ echecs: 1, date: jour });
    expect(sorties).not.toContain("secret-du-message");
    expect(sorties).not.toContain("contenu client");
  });

  it("charge invalide (date impossible, curseur non UUID, clé inconnue) : échec définitif", async () => {
    for (const charge of [
      { date: "2026-02-30" },
      { date: "2026-10-12", apres_id: "pas-un-uuid" },
      { date: "2026-10-12", autre: 1 },
    ]) {
      await expect(
        ctx.db.withTenant(b.cabinetId, (db) =>
          executerBriefQuotidien({
            db,
            cabinetId: b.cabinetId,
            jobId: "00000000-0000-4000-8000-000000000002",
            charge,
            maintenant: new Date("2026-10-14T08:00:00Z"),
          }),
        ),
      ).rejects.toThrow(/Charge de la tâche brief_quotidien invalide/);
    }
  });
});

describe("planification stricte (0304)", () => {
  const appeler = (cle: unknown, executeA: unknown, date: unknown) =>
    ctx.db.withoutTenant((db) =>
      db.query("SELECT planifier_brief_quotidien($1, $2, $3) AS n", [cle, executeA, date]),
    );

  it("refuse tout paramètre nul", async () => {
    const ok = ["brief_quotidien:2026-11-03", "2026-11-03T07:00:00Z", "2026-11-03"] as const;
    await expect(appeler(null, ok[1], ok[2])).rejects.toThrow(/Planification du brief quotidien/);
    await expect(appeler(ok[0], null, ok[2])).rejects.toThrow(/Planification du brief quotidien/);
    await expect(appeler(ok[0], ok[1], null)).rejects.toThrow(/Planification du brief quotidien/);
  });

  it("refuse une clé incohérente avec la date et une heure d'exécution hors de la journée visée", async () => {
    await expect(
      appeler("brief_quotidien:2026-11-03", "2026-11-04T07:00:00Z", "2026-11-04"),
    ).rejects.toThrow(/Clé du brief quotidien invalide/);
    await expect(
      appeler("brief_quotidien:2026-11-03", "2026-12-25T07:00:00Z", "2026-11-03"),
    ).rejects.toThrow(/hors de la journée visée/);
    await expect(
      appeler("brief_quotidien:2026-11-03", "2026-10-01T07:00:00Z", "2026-11-03"),
    ).rejects.toThrow(/hors de la journée visée/);
    // Rien n'a été planifié par ces appels refusés.
    const n = await lignes("SELECT count(*)::int AS n FROM jobs WHERE cle = $1", [
      "brief_quotidien:2026-11-03",
    ]);
    expect(n[0]?.n).toBe(0);
  });
});

describe("titre de la notification", () => {
  const brief = (decider: number, deriver: number): BriefCompose =>
    composerBrief({
      date_reference: LUNDI,
      sources: [
        { famille: "decider", candidats: [], restants: decider },
        { famille: "deriver", candidats: [], restants: deriver },
      ],
    });

  it("accorde éléments et « qui dérive(nt) » selon les nombres", () => {
    expect(titreNotificationBrief(brief(1, 0))).toBe(
      "Votre brief du jour : 1 élément (1 à décider, 0 qui dérive)",
    );
    expect(titreNotificationBrief(brief(2, 3))).toBe(
      "Votre brief du jour : 5 éléments (2 à décider, 3 qui dérivent)",
    );
    expect(titreNotificationBrief(brief(0, 1))).toBe(
      "Votre brief du jour : 1 élément (0 à décider, 1 qui dérive)",
    );
  });
});
