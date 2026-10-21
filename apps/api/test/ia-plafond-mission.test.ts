import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Auth } from "../src/auth/contexte.js";
import type { LlmProvider, RequeteLlm } from "../src/ia/fournisseur.js";
import { creerHandlerIaGeneration } from "../src/ia/job.js";
import {
  genererContenu,
  mettreEnFile,
  type DemandeContenu,
  type DependancesIa,
} from "../src/ia/orchestrateur.js";
import { creerRegistre } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { attendreQue, authDe, demarrerIa, verrou } from "./ia-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

vi.setConfig({ testTimeout: 90_000 });

/*
 * Plafond de coût IA PAR MISSION (AGT-06, agents/plafonds.ts) appliqué par l'orchestrateur à TOUTE
 * génération rattachée à une mission (pas seulement aux agents), en immédiat comme en file (job
 * « ia_generation »), SOUS CONCURRENCE réelle (Promise.all, fournisseur retenu : les réservations
 * restent en cours pendant que les autres appels se préparent), et alertes 80 % / 100 % une fois
 * par seuil et par valeur du plafond. Fournisseur FACTICE injecté : aucun appel réseau.
 */

let ctx: Contexte;
let a: CabinetMissions;
let auth: Auth;
/** Auteurs distincts des appels simultanés : le verrou du quota PAR UTILISATEUR ne les sérialise pas. */
const auteurs: Auth[] = [];
let appels = 0;
let retenue: Promise<void> | null = null;

/** Fournisseur factice : jetons fixes (coût réel connu, inférieur au coût estimé réservé). */
const fournisseur: LlmProvider = {
  nom: "openrouter",
  async completer(r: RequeteLlm) {
    appels += 1;
    if (retenue) await retenue;
    return {
      texte: "Synthèse factuelle de l'étape.",
      modele: r.modele,
      tokensEntree: 50,
      tokensSortie: 50,
      tokensEstimes: false,
      dureeMs: 1,
    };
  },
};

let deps: DependancesIa;

function attendre<R extends { statusCode: number; body: string }>(statut: number, r: R): R {
  if (r.statusCode !== statut) throw new Error(`${r.statusCode} ${r.body}`);
  return r;
}

beforeAll(async () => {
  // Aucun appel réseau : le fournisseur est injecté, l'URL ne sert jamais.
  ctx = await demarrerIa("http://127.0.0.1:9/api/v1");
  deps = { config: ctx.config, fournisseur };
  a = await preparerCabinet(ctx, "Cabinet plafond mission IA");
  attendre(200, await a.associe.put("/api/ia/parametres", { ia_activee: true }));
  attendre(
    201,
    await a.associe.post("/api/ia/prompts", {
      nom: "synthese_mission",
      tache: "redaction",
      gabarit_systeme: "Tu rédiges une synthèse factuelle.",
      gabarit_utilisateur: "TEXTE :\n{{texte}}",
      schema_sortie: { type: "texte" },
    }),
  );
  auth = await authDe(ctx, a.cabinetId, a.associeId);
  auteurs.push(auth);
  for (let i = 0; i < 4; i++) {
    const u = await a.avecRoles(["associe"]);
    auteurs.push(await authDe(ctx, a.cabinetId, u.utilisateurId));
  }
});

afterAll(async () => {
  await ctx.fermer();
});

const demande = (missionId: string, extra: Partial<DemandeContenu> = {}): DemandeContenu => ({
  promptNom: "synthese_mission",
  variables: { texte: "Point d'étape de la mission : ateliers tenus." },
  utilisateur: auth,
  entite: { missionId },
  ...extra,
});

const generer = (missionId: string, extra: Partial<DemandeContenu> = {}) =>
  genererContenu(ctx.db, deps, demande(missionId, extra));

const urlPlafond = (missionId: string) => `/api/agents/missions/${missionId}/plafond`;

async function etat(missionId: string) {
  return attendre(200, await a.associe.get(urlPlafond(missionId))).json() as {
    plafond_micro_usd: number | null;
    consomme_micro_usd: number;
    atteint: boolean;
    alerte: boolean;
  };
}

async function plafond(missionId: string, valeur: number | null) {
  attendre(200, await a.associe.put(urlPlafond(missionId), { plafond_micro_usd: valeur }));
}

const reservationsMission = (missionId: string) =>
  proprietaire(async (c) =>
    (
      await c.query(
        `SELECT r.cout_estime_micro_usd::bigint AS cout FROM ia_reservations r
         JOIN ia_demandes d ON d.id = r.demande_id WHERE d.mission_id = $1`,
        [missionId],
      )
    ).rows.map((x) => Number(x.cout)),
  );

const generationDe = (demandeId: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          `SELECT d.statut, d.erreur_code, g.fournisseur, g.gabarit, g.statut_contenu
           FROM ia_demandes d LEFT JOIN ia_generations g ON g.demande_id = d.id WHERE d.id = $1`,
          [demandeId],
        )
      ).rows[0] as {
        statut: string;
        erreur_code: string | null;
        fournisseur: string | null;
        gabarit: boolean | null;
        statut_contenu: string | null;
      },
  );

/** Lance des générations simultanées, fournisseur retenu jusqu'à ce que toutes aient été admises ou refusées. */
async function simultanees(missionId: string, n: number) {
  const v = verrou();
  retenue = v.promesse;
  const avant = appels;
  let reglees = 0;
  const promesses = Array.from({ length: n }, (_, i) =>
    generer(missionId, { utilisateur: auteurs[i % auteurs.length]! }).then(
      (r) => r,
      (e: unknown) => {
        reglees += 1;
        throw e;
      },
    ),
  );
  const tous = Promise.allSettled(promesses);
  // Toutes les préparations sont passées : les admises attendent le fournisseur, les autres ont échoué.
  await attendreQue(() => appels - avant + reglees === n, 30_000);
  const reservees = await reservationsMission(missionId);
  v.liberer();
  retenue = null;
  const resultats = await tous;
  return {
    reservees,
    admises: resultats.filter((r) => r.status === "fulfilled"),
    refusees: resultats.filter((r) => r.status === "rejected") as PromiseRejectedResult[],
    appels: appels - avant,
  };
}

describe("plafond de coût par mission (AGT-06) appliqué à toute génération", () => {
  it("génération rattachée à une mission : comptée, refusée au plafond (409) ou gabarit (repli)", async () => {
    const m = (await creerMission(a)).id;
    const avant = appels;
    const r = await generer(m);
    expect(r.resultat.statut).toBe("terminee");
    expect(appels).toBe(avant + 1);
    const e = await etat(m);
    expect(e.consomme_micro_usd).toBeGreaterThan(0);

    await plafond(m, e.consomme_micro_usd);
    await expect(generer(m)).rejects.toMatchObject({ code: "PLAFOND_MISSION_ATTEINT" });
    expect(appels).toBe(avant + 1);
    // Refus avant toute création : aucune demande ni réservation résiduelle.
    expect(await reservationsMission(m)).toEqual([]);

    const g = await generer(m, { repliSiPlafond: true });
    expect(g.resultat.statut).toBe("terminee");
    expect(appels).toBe(avant + 1);
    expect(await generationDe(g.demandeId)).toMatchObject({
      statut: "terminee",
      fournisseur: "gabarit",
      gabarit: true,
      statut_contenu: "brouillon_ia",
    });

    // Plafond retiré : la mission génère de nouveau par le modèle.
    await plafond(m, null);
    expect((await generer(m)).resultat.statut).toBe("terminee");
    expect(appels).toBe(avant + 2);
  });

  it("concurrence : 4 appels simultanés avec une marge d'un seul appel → un seul admis", async () => {
    const m = (await creerMission(a)).id;
    await plafond(m, 1);
    const r = await simultanees(m, 4);
    expect(r.admises).toHaveLength(1);
    expect(r.appels).toBe(1);
    expect(r.refusees).toHaveLength(3);
    for (const x of r.refusees) {
      expect(x.reason).toMatchObject({ code: "PLAFOND_MISSION_ATTEINT" });
    }
    // Pendant l'appel retenu, une seule réservation (celle de l'appel admis).
    expect(r.reservees).toHaveLength(1);
    const estimation = r.reservees[0]!;
    const e = await etat(m);
    // Dépassement borné par le coût estimé du dernier appel admis.
    expect(e.consomme_micro_usd).toBeGreaterThan(0);
    expect(e.consomme_micro_usd).toBeLessThanOrEqual(1 + estimation);
    expect(await reservationsMission(m)).toEqual([]);
  });

  it("concurrence : marge de deux appels → 2 admis sur 5, jamais plus que plafond + coût estimé du dernier", async () => {
    const m = (await creerMission(a)).id;
    // Coût estimé d'un appel (même prompt, même entrée) : lu sur une réservation en cours.
    const sonde = await simultanees(m, 1);
    expect(sonde.admises).toHaveLength(1);
    const estimation = sonde.reservees[0]!;
    const depart = (await etat(m)).consomme_micro_usd;
    const valeur = depart + estimation + 1;
    await plafond(m, valeur);

    const r = await simultanees(m, 5);
    expect(r.admises).toHaveLength(2);
    expect(r.appels).toBe(2);
    expect(r.reservees).toHaveLength(2);
    for (const x of r.refusees) {
      expect(x.reason).toMatchObject({ code: "PLAFOND_MISSION_ATTEINT" });
    }
    const e = await etat(m);
    expect(e.consomme_micro_usd).toBeLessThanOrEqual(valeur + estimation);
    expect(e.atteint).toBe(e.consomme_micro_usd >= valeur);
  });

  it("job « ia_generation » : plafond contrôlé à l'exécution (refus ou gabarit), refus précoce en file", async () => {
    const m = (await creerMission(a)).id;
    const enFile = (extra: Partial<DemandeContenu> = {}) =>
      ctx.db.withTenant(a.cabinetId, (db) => mettreEnFile(db, deps, demande(m, extra)));
    // Mises en file AVANT que le plafond soit atteint : aucune réservation à la préparation.
    const sansRepli = await enFile();
    const avecRepli = await enFile({ repliSiPlafond: true });
    expect((await generer(m)).resultat.statut).toBe("terminee");
    await plafond(m, 1);
    await expect(enFile()).rejects.toMatchObject({ code: "PLAFOND_MISSION_ATTEINT" });

    const w = new WorkerJobs(ctx.db, {
      mailer: new MailerJournal(),
      registre: creerRegistre({ ia_generation: creerHandlerIaGeneration(() => deps) }),
      horloge: () => new Date(),
      delaiReprise: () => 60_000,
    });
    const avant = appels;
    for (let i = 0; i < 50 && (await w.traiterUn()); i++);
    expect(appels).toBe(avant);
    expect(await generationDe(sansRepli)).toMatchObject({
      statut: "echec",
      erreur_code: "PLAFOND_MISSION_ATTEINT",
      fournisseur: null,
    });
    // Motif lisible en français pour le demandeur.
    const vue = await a.associe.get(`/api/ia/generations/${sansRepli}`);
    expect(attendre(200, vue).json().erreur).toEqual({
      code: "PLAFOND_MISSION_ATTEINT",
      message: "Plafond de coût IA de la mission atteint.",
    });
    expect(await generationDe(avecRepli)).toMatchObject({
      statut: "terminee",
      fournisseur: "gabarit",
      gabarit: true,
      statut_contenu: "brouillon_ia",
    });
    expect(await reservationsMission(m)).toEqual([]);
  });

  it("alertes 80 % et 100 % : une notification par seuil et par valeur du plafond, sans montant", async () => {
    const m = (await creerMission(a)).id;
    const notifications = () =>
      proprietaire(
        async (c) =>
          (
            await c.query(
              `SELECT titre, corps, lien FROM notifications
               WHERE cabinet_id = $1 AND type = 'ia_plafond_mission_alerte' AND lien = $2`,
              [a.cabinetId, `/missions/${m}`],
            )
          ).rows as { titre: string; corps: string; lien: string }[],
      );
    const compter = async (seuil: "80 %" | "atteint") =>
      (await notifications()).filter((n) => n.titre.includes(seuil)).length;

    expect((await generer(m)).resultat.statut).toBe("terminee");
    const cout = (await etat(m)).consomme_micro_usd; // coût réel d'un appel (jetons fixes)
    expect(cout).toBeGreaterThan(0);
    // Après le 2e appel : 2 × coût ≈ 85 % du plafond.
    const p1 = Math.floor((2 * cout * 100) / 85);
    await plafond(m, p1);
    expect(await notifications()).toHaveLength(0);

    await generer(m);
    const n80 = await compter("80 %");
    expect(n80).toBeGreaterThan(0); // un par associé actif
    expect(await compter("atteint")).toBe(0);
    expect((await etat(m)).alerte).toBe(true);

    await generer(m); // 3 × coût ≥ plafond : 100 %, sans nouvelle alerte 80 %
    expect(await compter("80 %")).toBe(n80);
    expect(await compter("atteint")).toBe(n80);
    await expect(generer(m)).rejects.toMatchObject({ code: "PLAFOND_MISSION_ATTEINT" });

    // Nouvelle valeur du plafond : alertes réarmées.
    const p2 = Math.floor((3 * cout * 100) / 90);
    await plafond(m, p2);
    await generer(m); // 4 × coût ≥ p2 : 80 % et 100 % pour la nouvelle valeur
    expect(await compter("80 %")).toBe(2 * n80);
    expect(await compter("atteint")).toBe(2 * n80);

    for (const n of await notifications()) {
      expect(n.corps).not.toMatch(/\d/);
      expect(`${n.titre} ${n.corps}`).not.toMatch(/USD|\$|µ/);
    }
    const alertes = await proprietaire(async (c) =>
      (
        await c.query(
          `SELECT plafond_micro_usd::bigint AS p, seuil FROM ia_alertes_plafond_mission
             WHERE mission_id = $1 ORDER BY plafond_micro_usd, seuil`,
          [m],
        )
      ).rows.map((x) => [Number(x.p), x.seuil]),
    );
    expect(alertes).toEqual(
      [
        [p1, 80],
        [p1, 100],
        [p2, 80],
        [p2, 100],
      ].sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]!),
    );
  });
});
