import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ajouterJours } from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { planificationDuJour, planifierRecurrents } from "../src/jobs/planificateur.js";
import { REGISTRE_JOBS } from "../src/jobs/registre.js";
import { creerHandlerRelances, niveauAtteint } from "../src/finance/relances.js";
import {
  differerEmail,
  registreAvecEmails,
  TYPE_JOB_EMAIL,
} from "../src/notifications/file-email.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { aujourdhui } from "../src/missions/outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { factureDatee, retirerJobs } from "./finance-outils.js";
import { creerMissionSignee, TOUS_LES_ROLES } from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let missionA: string;
const jour = aujourdhui();
const il = (n: number) => ajouterJours(jour, -n);
const CONTACT = "dg-relance@client.test";

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Relances A");
  b = await preparerFacturation(ctx, "Cabinet Relances B");
  missionA = (await creerMissionSignee(a, { mode_facturation: "forfait" })).id;
  attendre(
    201,
    await a.associe.post(`/api/clients/${a.clientId}/contacts`, {
      nom: "Directeur général",
      email: CONTACT,
      principal: true,
    }),
    "contact",
  );
});
afterAll(() => ctx.fermer());

/** Exécute le handler quotidien dans le contexte RLS du cabinet, à une heure donnée. */
const executer = (
  cabinetId: string,
  maintenant: Date,
  differer?: Parameters<typeof creerHandlerRelances>[0],
) =>
  ctx.db.withTenant(cabinetId, (db) =>
    creerHandlerRelances(differer)({ db, cabinetId, jobId: "", charge: {}, maintenant }),
  );

const relancesDe = (factureId: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          "SELECT niveau, mode, jours_retard, email_envoye, destinataire_email FROM relances_factures WHERE facture_id = $1 ORDER BY cree_le",
          [factureId],
        )
      ).rows,
  );

describe("relances des factures échues (FIN-09)", () => {
  it("niveau atteint selon les délais du cabinet (J+7, J+15, J+30 par défaut)", () => {
    expect([0, 6, 7, 14, 15, 29, 30, 400].map((j) => niveauAtteint([7, 15, 30], j))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it("tâche quotidienne idempotente (horloge injectée) : une relance par niveau, jamais deux", async () => {
    // Émise il y a 40 jours, échue il y a 10 jours.
    const f = await factureDatee(ctx, a, missionA, 100_000, il(40));
    const t = new Date(`${jour}T18:00:00Z`);
    const premier = await executer(a.cabinetId, t);
    const second = await executer(a.cabinetId, t);
    expect(await relancesDe(f.id)).toEqual([
      {
        niveau: 1,
        mode: "automatique",
        jours_retard: 10,
        email_envoye: false,
        destinataire_email: CONTACT,
      },
    ]);
    // Notification du gestionnaire, sans montant ; e-mail au client préparé mais non envoyé.
    expect(
      (premier ?? []).filter((n) => n?.destinataire_id === a.gestionnaire.utilisateurId),
    ).toHaveLength(1);
    expect(second).toEqual([]);
    const notes = (await a.gestionnaire.get("/api/notifications?limite=100")).json().elements as {
      type: string;
      titre: string;
      corps: string;
    }[];
    const note = notes.find((n) => n.type === "relance_facture" && n.titre.includes(f.numero));
    expect(note?.corps).toMatch(/10 jours de retard/);
    expect(note?.corps).not.toMatch(/118/);
    // Huit jours plus tard (retard 18) : niveau 2, une seule fois.
    const plusTard = new Date(`${ajouterJours(jour, 8)}T18:00:00Z`);
    await executer(a.cabinetId, plusTard);
    await executer(a.cabinetId, plusTard);
    expect((await relancesDe(f.id)).map((r) => r.niveau)).toEqual([1, 2]);
  });

  it("envoi au client activé : e-mail préparé (reste à payer) sans envoi réel, ou mis en file chiffrée", async () => {
    attendre(
      200,
      await a.gestionnaire.patch("/api/finance/parametres-relances", { envoi_email_client: true }),
      "paramètres",
    );
    const f = await factureDatee(ctx, a, missionA, 200_000, il(50));
    const sorties = await executer(a.cabinetId, new Date(`${jour}T18:00:00Z`));
    const email = (sorties ?? []).find((n) => n?.email?.a === CONTACT)?.email;
    expect(email?.sujet).toContain(f.numero);
    expect(email?.texte).toMatch(/Reste à payer : 236\u202f000\u00a0FCFA/);
    expect((await relancesDe(f.id))[0]).toMatchObject({ niveau: 2, email_envoye: true });

    // Avec le worker de production : l'e-mail part dans la file chiffrée du cabinet.
    const f2 = await factureDatee(ctx, a, missionA, 50_000, il(70));
    const trousseau = trousseauDepuisConfig(ctx.config);
    await executer(a.cabinetId, new Date(`${jour}T18:00:00Z`), (db, cabinetId, message) =>
      differerEmail(db, trousseau, cabinetId, message, 0),
    );
    expect((await relancesDe(f2.id))[0]).toMatchObject({ niveau: 3 });
    const file = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT charge::text AS charge FROM jobs WHERE cabinet_id = $1 AND type = $2",
            [a.cabinetId, TYPE_JOB_EMAIL],
          )
        ).rows,
    );
    expect(file).toHaveLength(1);
    expect(file[0].charge).not.toContain(CONTACT);
    // Le registre de production remplace le handler par sa version « file d'e-mails ».
    expect(registreAvecEmails(new MailerJournal(), trousseau).has("relances_factures")).toBe(true);
    expect(REGISTRE_JOBS.has("relances_factures")).toBe(true);
    await proprietaire((cl) =>
      cl.query("DELETE FROM jobs WHERE cabinet_id = $1 AND type = $2", [
        a.cabinetId,
        TYPE_JOB_EMAIL,
      ]),
    );
    attendre(
      200,
      await a.gestionnaire.patch("/api/finance/parametres-relances", { envoi_email_client: false }),
      "paramètres",
    );
  });

  it("planificateur lancé deux fois : un seul job par cabinet et par jour, réservé aux cabinets concernés", async () => {
    const quand = new Date(`${ajouterJours(jour, 400)}T07:00:00Z`);
    const { cle, executeA } = planificationDuJour(quand);
    try {
      await ctx.db.withoutTenant((db) =>
        db.query("SELECT planifier_relances_factures($1, $2, $3)", [
          cle,
          executeA,
          ajouterJours(jour, 400),
        ]),
      );
      await ctx.db.withoutTenant((db) =>
        db.query("SELECT planifier_relances_factures($1, $2, $3)", [
          cle,
          executeA,
          ajouterJours(jour, 400),
        ]),
      );
      const jobs = await proprietaire(
        async (cl) =>
          (await cl.query("SELECT cabinet_id, execute_a FROM jobs WHERE cle = $1", [cle])).rows,
      );
      expect(jobs.filter((j) => j.cabinet_id === a.cabinetId)).toHaveLength(1);
      // Le cabinet B n'a aucune facture émise : pas de job.
      expect(jobs.filter((j) => j.cabinet_id === b.cabinetId)).toHaveLength(0);
      expect(new Date(jobs[0].execute_a).toISOString()).toBe(
        `${ajouterJours(jour, 400)}T18:00:00.000Z`,
      );
      await expect(
        ctx.db.withoutTenant((db) =>
          db.query("SELECT planifier_relances_factures('autre', now(), current_date)"),
        ),
      ).rejects.toThrow();
    } finally {
      await retirerJobs(cle);
    }
    expect(typeof planifierRecurrents).toBe("function");
  });

  it("relance manuelle : niveau suivant, contact requis pour l'e-mail, historique", async () => {
    const f = await factureDatee(ctx, a, missionA, 10_000, il(35));
    const r = await a.gestionnaire.post(`/api/factures/${f.id}/relances`, {
      envoyer_email: true,
      message: "Merci de régulariser.",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ niveau: 1, mode: "manuelle", email_envoye: true });
    expect(r.json().email_texte).toContain("Merci de régulariser.");
    const r2 = await a.gestionnaire.post(`/api/factures/${f.id}/relances`, {
      envoyer_email: false,
    });
    expect(r2.json()).toMatchObject({ niveau: 2, email_envoye: false });
    const p = (await a.gestionnaire.get(`/api/factures/${f.id}/paiement`)).json();
    expect(p.relances.map((x: { niveau: number }) => x.niveau)).toEqual([1, 2]);
    // Validation et facture soldée.
    expect(
      (await a.gestionnaire.post(`/api/factures/${f.id}/relances`, { niveau: 4 })).statusCode,
    ).toBe(400);
    await a.gestionnaire.post("/api/finance/encaissements", {
      client_id: a.clientId,
      date: jour,
      montant: 11_800,
      mode: "especes",
      imputations: [{ facture_id: f.id, montant: 11_800 }],
    });
    expect((await a.gestionnaire.post(`/api/factures/${f.id}/relances`, {})).statusCode).toBe(409);
    // Sans contact e-mail (cabinet B).
    const mb = (await creerMissionSignee(b, { mode_facturation: "forfait" })).id;
    const fb = await factureDatee(ctx, b, mb, 10_000, il(35));
    expect((await b.gestionnaire.post(`/api/factures/${fb.id}/relances`, {})).statusCode).toBe(400);
    expect(
      (await b.gestionnaire.post(`/api/factures/${fb.id}/relances`, { envoyer_email: false }))
        .statusCode,
    ).toBe(201);
    // Isolation : la facture de A n'existe pas pour B.
    expect((await b.gestionnaire.post(`/api/factures/${f.id}/relances`, {})).statusCode).toBe(404);
  });

  it("paramètres : validation, matrice des rôles, isolation", async () => {
    expect((await a.gestionnaire.get("/api/finance/parametres-relances")).json()).toMatchObject({
      delais_relance: [7, 15, 30],
      valeurs_validees: false,
    });
    for (const corps of [
      {},
      { delais_relance: [15, 7] },
      { delais_relance: [1, 2, 3, 4] },
      { x: 1 },
    ]) {
      expect(
        (await a.gestionnaire.patch("/api/finance/parametres-relances", corps)).statusCode,
      ).toBe(400);
    }
    const ok = await a.gestionnaire.patch("/api/finance/parametres-relances", {
      delais_relance: [10, 20, 45],
      valeurs_validees: true,
    });
    expect(ok.json()).toMatchObject({ delais_relance: [10, 20, 45], valeurs_validees: true });
    expect(
      (await b.gestionnaire.get("/api/finance/parametres-relances")).json().delais_relance,
    ).toEqual([7, 15, 30]);
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      const attendu = (["associe", "gestionnaire"] as Role[]).includes(role) ? 200 : 403;
      expect((await u.get("/api/finance/parametres-relances")).statusCode, role).toBe(attendu);
    }
  });

  it("historique des relances en ajout seul (rôle applicatif)", async () => {
    const [r] = await proprietaire(
      async (cl) =>
        (
          await cl.query("SELECT id FROM relances_factures WHERE cabinet_id = $1 LIMIT 1", [
            a.cabinetId,
          ])
        ).rows,
    );
    for (const sql of [
      "UPDATE relances_factures SET niveau = 3 WHERE id = $1",
      "DELETE FROM relances_factures WHERE id = $1",
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, [r.id])),
      ).rejects.toMatchObject({
        code: "42501",
      });
    }
    // Isolation RLS : invisible depuis le cabinet B.
    const vu = await ctx.db.withTenant(b.cabinetId, (db) =>
      db.query("SELECT 1 FROM relances_factures WHERE id = $1", [r.id]),
    );
    expect(vu.rowCount).toBe(0);
  });
});
