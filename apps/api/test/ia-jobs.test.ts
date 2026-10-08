import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { creerRegistre } from "../src/jobs/registre.js";
import { WorkerJobs, type ResultatJob } from "../src/jobs/worker.js";
import { APPELS_SIMULTANES_MAX, estimerCoutAppel } from "../src/ia/couts.js";
import { blocChiffres } from "../src/ia/gabarits.js";
import { creerHandlerIaGeneration } from "../src/ia/job.js";
import { MAX_TOKENS_SORTIE } from "../src/ia/modeles.js";
import { genererContenu } from "../src/ia/orchestrateur.js";
import { PROMPTS_EXEMPLE } from "../src/ia/prompts.js";
import { ErreurLlm, type LlmProvider, type ReponseLlm } from "../src/ia/fournisseur.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import type { Auth } from "../src/auth/contexte.js";
import { cabinetTest, type CabinetTest } from "./api.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  attendreQue,
  authDe,
  demarrerIa,
  serveurFactice,
  verrou,
  type ServeurFactice,
} from "./ia-outils.js";

vi.setConfig({ testTimeout: 60_000 });

/*
 * Générations en file (job « ia_generation », ADR-002) : horloge INJECTÉE,
 * fournisseur factice local. Progression lisible, reprise sur 5xx, échec à la
 * dernière tentative, annulation (en file et pendant l'appel), charge chiffrée
 * effacée.
 */

let serveur: ServeurFactice;
let ctx: Contexte;
let c: CabinetTest;

beforeAll(async () => {
  serveur = await serveurFactice();
  ctx = await demarrerIa(serveur.url);
  c = await cabinetTest(ctx, "Cabinet IA jobs");
  // L'IA est désactivée tant que le cabinet ne l'a pas activée.
  expect((await c.associe.put("/api/ia/parametres", { ia_activee: true })).statusCode).toBe(200);
});
afterAll(async () => {
  await ctx.fermer();
  await serveur.fermer();
});

function horloge(iso: string) {
  let t = new Date(iso);
  return { lire: () => t, avancer: (ms: number) => (t = new Date(t.getTime() + ms)) };
}

function worker(h: ReturnType<typeof horloge>, fournisseur?: LlmProvider) {
  return new WorkerJobs(ctx.db, {
    mailer: new MailerJournal(),
    registre: creerRegistre({
      ia_generation: creerHandlerIaGeneration(() => ({
        config: ctx.config,
        ...(fournisseur ? { fournisseur } : {}),
      })),
    }),
    horloge: h.lire,
    delaiReprise: () => 60_000,
  });
}

const REPONSE: ReponseLlm = {
  texte: "Synthèse.",
  modele: "anthropic/claude-sonnet-4.5",
  tokensEntree: 100,
  tokensSortie: 10,
  tokensEstimes: false,
  dureeMs: 5,
};

/** Coût estimé (réservé) d'un appel « resume_neutre » avec ce texte (modèle recommandé). */
function estimer(texte: string): number {
  const p = PROMPTS_EXEMPLE.find((x) => x.nom === "resume_neutre")!;
  return estimerCoutAppel(
    "anthropic/claude-sonnet-4.5",
    p.gabarit_systeme.length +
      p.gabarit_utilisateur.length +
      texte.length +
      blocChiffres([]).length,
    MAX_TOKENS_SORTIE.redaction,
  );
}

const lignes = <T>(sql: string, params: unknown[]) =>
  proprietaire(async (x) => (await x.query(sql, params)).rows as T[]);

/** Exécute les jobs prêts jusqu'à traiter celui-ci (d'autres jobs de la base peuvent passer avant). */
async function traiter(w: WorkerJobs, jobId: string): Promise<ResultatJob> {
  for (let i = 0; i < 500; i++) {
    const r = await w.traiterUn();
    if (!r) break;
    if (r.id === jobId) return r;
  }
  throw new Error("Job non traité");
}

const corps = {
  prompt_nom: "resume_neutre",
  mode: "file",
  variables: { texte: "Entretien avec Awa Koné : le climat est bon." },
  termes_sensibles: ["Awa Koné"],
};

const lireJob = (id: string) =>
  proprietaire(async (x) => (await x.query("SELECT * FROM jobs WHERE id = $1", [id])).rows[0]);
const jobDe = (demandeId: string) =>
  proprietaire(
    async (x) =>
      (await x.query("SELECT job_id FROM ia_demandes WHERE id = $1", [demandeId])).rows[0]
        .job_id as string,
  );

describe("génération en file (job ia_generation)", () => {
  it("en file → reprise après 5xx → terminée ; progression lisible ; entrée chiffrée puis effacée", async () => {
    const r = await c.associe.post("/api/ia/generations", corps);
    expect(r.statusCode).toBe(202);
    const g = r.json();
    expect(g).toMatchObject({
      statut: "en_file",
      progression: 0,
      statut_contenu: null,
      livrable_client: false,
    });
    const jobId = await jobDe(g.id);
    const job = await lireJob(jobId);
    expect(job.type).toBe("ia_generation");
    // Entrée chiffrée : ni le texte ni le nom en clair dans la charge.
    expect(JSON.stringify(job.charge)).not.toContain("Awa");
    expect(JSON.stringify(job.charge)).not.toContain("climat");

    // Un job pris par le worker rend la demande « en cours ».
    await proprietaire((x) =>
      x.query("UPDATE jobs SET statut = 'en_cours' WHERE id = $1", [jobId]),
    );
    expect((await c.associe.get(`/api/ia/generations/${g.id}`)).json()).toMatchObject({
      statut: "en_cours",
      progression: 50,
    });
    await proprietaire((x) =>
      x.query("UPDATE jobs SET statut = 'en_attente' WHERE id = $1", [jobId]),
    );

    const h = horloge(new Date(Date.now() + 1000).toISOString());
    serveur.requetes.length = 0;
    serveur.repondre(() => ({ statut: 503, brut: "{}" }));
    const w = worker(h);
    expect(await traiter(w, jobId)).toMatchObject({ statut: "reessai" });
    // Le fournisseur a fait ses 3 tentatives internes ; la demande reste en file.
    expect(serveur.requetes).toHaveLength(3);
    expect((await c.associe.get(`/api/ia/generations/${g.id}`)).json()).toMatchObject({
      statut: "en_file",
      statut_contenu: null,
    });
    // Rien n'est écrit pendant la tentative annulée (transaction du job).
    const avant = await proprietaire(
      async (x) =>
        (
          await x.query("SELECT count(*)::int AS n FROM ia_consommations WHERE demande_id = $1", [
            g.id,
          ])
        ).rows[0].n,
    );
    expect(avant).toBe(0);

    h.avancer(61_000);
    serveur.repondre(() => ({ contenu: "Synthèse : [PERSONNE_1] décrit un bon climat." }));
    expect(await traiter(w, jobId)).toMatchObject({ statut: "termine" });
    const fin = (await c.associe.get(`/api/ia/generations/${g.id}`)).json();
    expect(fin).toMatchObject({
      statut: "terminee",
      progression: 100,
      statut_contenu: "brouillon_ia",
      gabarit: false,
      texte: "Synthèse : Awa Koné décrit un bon climat.",
    });
    expect((await lireJob(jobId)).charge).toEqual({});
    // Horloge du worker : la consommation est datée de l'heure injectée.
    const conso = await proprietaire(
      async (x) =>
        (await x.query("SELECT cree_le FROM ia_consommations WHERE demande_id = $1", [g.id]))
          .rows[0],
    );
    expect(new Date(conso.cree_le).getTime()).toBe(h.lire().getTime());
  });

  it("dernière tentative en échec : la demande passe « echec » avec le code du fournisseur", async () => {
    const g = (await c.associe.post("/api/ia/generations", corps)).json();
    const jobId = await jobDe(g.id);
    await proprietaire((x) => x.query("UPDATE jobs SET tentatives_max = 1 WHERE id = $1", [jobId]));
    serveur.repondre(() => ({ statut: 500, brut: "{}" }));
    const w = worker(horloge(new Date(Date.now() + 1000).toISOString()));
    expect(await traiter(w, jobId)).toMatchObject({ statut: "termine" });
    expect((await c.associe.get(`/api/ia/generations/${g.id}`)).json()).toMatchObject({
      statut: "echec",
      statut_contenu: null,
      erreur: { code: "FOURNISSEUR_INDISPONIBLE" },
    });
    expect((await lireJob(jobId)).charge).toEqual({});
  });

  it("annulation en file : le job ne s'exécute pas, sa charge est effacée ; seconde annulation 409", async () => {
    const g = (await c.associe.post("/api/ia/generations", corps)).json();
    const jobId = await jobDe(g.id);
    const autre = await c.avecRoles(["consultant"]);
    expect((await autre.post(`/api/ia/generations/${g.id}/annuler`, {})).statusCode).toBe(404);
    const r = await c.associe.post(`/api/ia/generations/${g.id}/annuler`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ statut: "annulee", statut_contenu: null });
    expect(await lireJob(jobId)).toMatchObject({ statut: "termine", charge: {} });
    expect((await c.associe.post(`/api/ia/generations/${g.id}/annuler`, {})).statusCode).toBe(409);
    serveur.requetes.length = 0;
    await worker(horloge(new Date(Date.now() + 1000).toISOString())).traiterUn();
    expect(serveur.requetes).toHaveLength(0);
  });

  it("annulation PENDANT l'appel : pas de contenu, coût compté (issue « annulee »)", async () => {
    let liberer: () => void = () => undefined;
    let appele: () => void = () => undefined;
    const appelEnCours = new Promise<void>((ok) => (appele = ok));
    const fournisseur: LlmProvider = {
      nom: "openrouter",
      completer: async () => {
        appele();
        await new Promise<void>((ok) => (liberer = ok));
        return {
          texte: "Trop tard.",
          modele: "anthropic/claude-sonnet-4.5",
          tokensEntree: 100,
          tokensSortie: 10,
          tokensEstimes: false,
          dureeMs: 5,
        };
      },
    };
    const auth: Auth = await ctx.db.withTenant(c.cabinetId, async (db) => {
      const u = (
        await db.query("SELECT id, email, nom, roles FROM utilisateurs WHERE id = $1", [
          c.associeId,
        ])
      ).rows[0];
      return {
        utilisateurId: u.id,
        cabinetId: c.cabinetId,
        email: u.email,
        nom: u.nom,
        roles: u.roles,
      };
    });
    const enCours = genererContenu(
      ctx.db,
      { config: ctx.config, fournisseur },
      {
        promptNom: "resume_neutre",
        variables: { texte: "x" },
        utilisateur: auth,
      },
    );
    await appelEnCours;
    const id = await proprietaire(
      async (x) =>
        (
          await x.query(
            "SELECT id FROM ia_demandes WHERE cabinet_id = $1 AND statut = 'en_cours' ORDER BY cree_le DESC LIMIT 1",
            [c.cabinetId],
          )
        ).rows[0].id as string,
    );
    expect((await c.associe.post(`/api/ia/generations/${id}/annuler`, {})).statusCode).toBe(200);
    liberer();
    const { resultat } = await enCours;
    expect(resultat.statut).toBe("annulee");
    const etat = await proprietaire(async (x) => ({
      versions: (
        await x.query("SELECT count(*)::int AS n FROM ia_generations WHERE demande_id = $1", [id])
      ).rows[0].n,
      issues: (await x.query("SELECT issue FROM ia_consommations WHERE demande_id = $1", [id]))
        .rows,
    }));
    expect(etat).toEqual({ versions: 0, issues: [{ issue: "annulee" }] });
  });

  it("constat 1 : en file, la réservation est visible des autres appels pendant l'appel du job", async () => {
    const d = await cabinetTest(ctx, "Cabinet IA jobs plafond");
    const estimation = estimer(corps.variables.texte);
    expect(
      (
        await d.associe.put("/api/ia/parametres", {
          ia_activee: true,
          plafond_mensuel_micro_usd: estimation + Math.floor(estimation / 2),
        })
      ).statusCode,
    ).toBe(200);
    const g = (await d.associe.post("/api/ia/generations", corps)).json();
    const jobId = await jobDe(g.id);
    const appel = verrou();
    let appele = false;
    const fournisseur: LlmProvider = {
      nom: "openrouter",
      completer: async () => {
        appele = true;
        await appel.promesse;
        return REPONSE;
      },
    };
    const enCours = traiter(
      worker(horloge(new Date(Date.now() + 1000).toISOString()), fournisseur),
      jobId,
    );
    await attendreQue(() => appele);
    // Pendant l'appel : la réservation est validée (hors de la transaction du job), donc comptée.
    expect(
      await lignes<{ demande_id: string; cout: string }>(
        "SELECT demande_id, cout_estime_micro_usd::text AS cout FROM ia_reservations WHERE cabinet_id = $1",
        [d.cabinetId],
      ),
    ).toEqual([{ demande_id: g.id, cout: String(estimation) }]);
    serveur.requetes.length = 0;
    const refus = await d.associe.post("/api/ia/generations", { ...corps, mode: "immediat" });
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("PLAFOND_IA_ATTEINT");
    expect(serveur.requetes).toHaveLength(0);
    appel.liberer();
    expect(await enCours).toMatchObject({ statut: "termine" });
    expect(
      await lignes("SELECT id FROM ia_reservations WHERE cabinet_id = $1", [d.cabinetId]),
    ).toHaveLength(0);
    expect(
      await lignes("SELECT issue, source_cle FROM ia_consommations WHERE demande_id = $1", [g.id]),
    ).toEqual([{ issue: "succes", source_cle: "plateforme" }]);
  });

  it("constat 1 : délai dépassé en file : coût estimé inscrit, réservation soldée, job repris", async () => {
    let n = 0;
    const fournisseur: LlmProvider = {
      nom: "openrouter",
      completer: async () => {
        n += 1;
        if (n === 1) throw new ErreurLlm("DELAI_DEPASSE", true);
        return REPONSE;
      },
    };
    const g = (await c.associe.post("/api/ia/generations", corps)).json();
    const jobId = await jobDe(g.id);
    const h = horloge(new Date(Date.now() + 1000).toISOString());
    const w = worker(h, fournisseur);
    expect(await traiter(w, jobId)).toMatchObject({ statut: "reessai" });
    const issues = () =>
      lignes<{ issue: string; cout: string }>(
        "SELECT issue, cout_micro_usd::text AS cout FROM ia_consommations WHERE demande_id = $1 ORDER BY id",
        [g.id],
      );
    expect(await issues()).toEqual([
      { issue: "delai_depasse", cout: String(estimer(corps.variables.texte)) },
    ]);
    expect(
      await lignes("SELECT id FROM ia_reservations WHERE demande_id = $1", [g.id]),
    ).toHaveLength(0);
    expect((await c.associe.get(`/api/ia/generations/${g.id}`)).json()).toMatchObject({
      statut: "en_file",
    });
    h.avancer(61_000);
    expect(await traiter(w, jobId)).toMatchObject({ statut: "termine" });
    expect((await issues()).map((x) => x.issue)).toEqual(["delai_depasse", "succes"]);
  });

  it("constat 10 : erreur inattendue : reprise, puis à la dernière tentative échec et charge effacée", async () => {
    const fournisseur: LlmProvider = {
      nom: "openrouter",
      completer: async () => {
        throw new Error("Panne inattendue");
      },
    };
    const g = (await c.associe.post("/api/ia/generations", corps)).json();
    const jobId = await jobDe(g.id);
    const h = horloge(new Date(Date.now() + 1000).toISOString());
    const w = worker(h, fournisseur);
    expect(await traiter(w, jobId)).toMatchObject({ statut: "reessai" });
    expect((await lireJob(jobId)).charge).not.toEqual({});
    expect(
      await lignes("SELECT id FROM ia_reservations WHERE demande_id = $1", [g.id]),
    ).toHaveLength(0);
    // La tentative suivante est la dernière : aucune erreur ne remonte.
    await proprietaire((x) => x.query("UPDATE jobs SET tentatives_max = 2 WHERE id = $1", [jobId]));
    h.avancer(61_000);
    expect(await traiter(w, jobId)).toMatchObject({ statut: "termine" });
    expect((await c.associe.get(`/api/ia/generations/${g.id}`)).json()).toMatchObject({
      statut: "echec",
      erreur: { code: "ERREUR_INTERNE" },
    });
    expect((await lireJob(jobId)).charge).toEqual({});
  });

  it("constat 10 : l'annulation efface aussi la charge d'un job abandonné en échec par le worker", async () => {
    const g = (await c.associe.post("/api/ia/generations", corps)).json();
    const jobId = await jobDe(g.id);
    await proprietaire((x) => x.query("UPDATE jobs SET statut = 'echec' WHERE id = $1", [jobId]));
    expect((await c.associe.get(`/api/ia/generations/${g.id}`)).json()).toMatchObject({
      statut: "echec",
    });
    expect((await lireJob(jobId)).charge).not.toEqual({});
    const r = await c.associe.post(`/api/ia/generations/${g.id}/annuler`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ statut: "annulee" });
    expect(await lireJob(jobId)).toMatchObject({ statut: "echec", charge: {} });
  });

  it("constat 1 : au plus APPELS_SIMULTANES_MAX appels en cours par cabinet (429 au-delà)", async () => {
    const d = await cabinetTest(ctx, "Cabinet IA appels simultanés");
    expect((await d.associe.put("/api/ia/parametres", { ia_activee: true })).statusCode).toBe(200);
    const auth = await authDe(ctx, d.cabinetId, d.associeId);
    const appel = verrou();
    let appels = 0;
    let rejets = 0;
    const fournisseur: LlmProvider = {
      nom: "openrouter",
      completer: async () => {
        appels += 1;
        await appel.promesse;
        return REPONSE;
      },
    };
    const lancees = Array.from({ length: APPELS_SIMULTANES_MAX + 1 }, () =>
      genererContenu(
        ctx.db,
        { config: ctx.config, fournisseur },
        { promptNom: "resume_neutre", variables: { texte: "x" }, utilisateur: auth },
      ).then(
        () => 201,
        (e: { statut?: number; code?: string }) => {
          rejets += 1;
          return e.code === "GENERATIONS_SIMULTANEES" ? e.statut : 500;
        },
      ),
    );
    await attendreQue(() => appels === APPELS_SIMULTANES_MAX && rejets === 1);
    appel.liberer();
    const statuts = await Promise.all(lancees);
    expect(statuts.filter((s) => s === 201)).toHaveLength(APPELS_SIMULTANES_MAX);
    expect(statuts.filter((s) => s === 429)).toHaveLength(1);
  });
});
