import { lundiDeLaSemaine } from "@missionpilot/engines";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  creerHandlerAvancementHebdo,
  planifierAvancementHebdo,
  TYPE_JOB_AVANCEMENT_HEBDO,
} from "../src/automatisation/avancement-job.js";
import {
  faitsPourIa,
  lireSuggestion,
  TAILLE_MAX_SUGGESTION_AVANCEMENT,
} from "../src/automatisation/avancement-ia.js";
import { contenuAvancementSchema } from "@missionpilot/shared";
import { creerMasque } from "../src/ia/masquage.js";
import { creerRegistre, type HandlerJob } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { demarrerIa, serveurFactice, type ServeurFactice } from "./ia-outils.js";
import { creerMission } from "./missions-outils.js";
import { attendre, clesDe, inviterClient } from "./portail-outils.js";

/*
 * Commentaire IA du rapport d'avancement (AUT-10) : brouillon IA proposé via l'orchestrateur, jamais
 * visible du client, validation bloquée tant qu'il n'est pas relu, chiffres inventés rejetés, repli
 * silencieux sans IA. Fournisseur SIMULÉ (serveur local factice) : aucun réseau, aucune vraie clé.
 */

vi.setConfig({ testTimeout: 90_000 });

const AUJOURDHUI = new Date().toISOString().slice(0, 10);
const LUNDI = lundiDeLaSemaine(AUJOURDHUI);
const MAINTENANT = new Date(`${LUNDI}T08:00:00Z`);
const mailer = new MailerJournal();
const TEXTE_IA = "La semaine ne compte aucun jalon ni indicateur suivi et 0 livrable partagé.";

let serveur: ServeurFactice;
let ctx: Contexte;
let a: CabinetFacturation;
let sansIa: CabinetFacturation;

const reponse = (commentaire: string) =>
  serveur.repondre(() => ({
    contenu: JSON.stringify({ commentaire }),
    usage: { prompt_tokens: 300, completion_tokens: 80 },
  }));

async function missionSignee(c: CabinetFacturation, intitule: string) {
  const id = (await creerMission(c, { intitule })).id;
  attendre(
    200,
    await c.directeur.post(`/api/missions/${id}/signer`, { date_signature: "2026-10-01" }),
    "signature",
  );
  return id;
}

async function brouillon(c: CabinetFacturation, missionId: string) {
  const g = await c.chef.post(`/api/missions/${missionId}/avancement`, { semaine: LUNDI });
  attendre(201, g, "génération");
  return g.json() as { id: string; version: number };
}

beforeAll(async () => {
  serveur = await serveurFactice();
  ctx = await demarrerIa(serveur.url);
  a = await preparerFacturation(ctx, "Avancement IA");
  sansIa = await preparerFacturation(ctx, "Avancement sans IA");
  attendre(200, await a.associe.put("/api/ia/parametres", { ia_activee: true }), "IA activée");
}, 240_000);
afterAll(async () => {
  await ctx.fermer();
  await serveur.fermer();
});
beforeEach(() => {
  serveur.requetes.length = 0;
  reponse(TEXTE_IA);
});

describe("lecture de la sortie (unitaire)", () => {
  const contenu = contenuAvancementSchema.parse({
    version: 1,
    semaine: "2026-10-19",
    semaine_fin: "2026-10-25",
    date_reference: "2026-10-21",
    mission: { intitule: "Mission secrète", statut: "en_cours" },
    avancement: { pourcentage: 40, elements: 5 },
    jalons: {
      total: 4,
      atteints: { nombre: 2, elements: [{ libelle: "Cadrage", date_prevue: "2026-10-01" }] },
      en_retard: { nombre: 1, elements: [] },
      a_venir: { nombre: 1, elements: [] },
      sans_date: 0,
    },
    kpis: { total: 0, vert: 0, orange: 0, rouge: 0, non_evalue: 0, elements: [] },
    livrables: {
      total: 5,
      partages: 2,
      non_partages: 3,
      elements: [{ nom: "Livrable secret", type: "livrable", version: 1 }],
    },
    faits_saillants: [],
  });
  const faits = faitsPourIa(contenu);
  const lire = (t: string) => lireSuggestion(t, faits.nombres, [], creerMasque([]));

  it("les faits ne portent ni intitulé, ni noms de livrables, ni livrables non partagés", () => {
    const tout = [...faits.lignes, ...faits.libelles].join("\n");
    expect(tout).not.toContain("secrète");
    expect(tout).not.toContain("Livrable secret");
    expect(faits.nombres).toEqual(expect.arrayContaining([40, 4, 2, 1, 0]));
    expect(faits.nombres).not.toContain(3);
    expect(faits.nombres).not.toContain(5);
  });

  it("accepte un texte aux seuls chiffres du moteur ; rejette chiffre inventé, JSON invalide, texte trop long", () => {
    const bon = JSON.stringify({
      commentaire: "Avancement de 40 %, avec 2 jalons atteints sur 4.",
    });
    expect(lire(bon)).toBe("Avancement de 40 %, avec 2 jalons atteints sur 4.");
    expect(lire(JSON.stringify({ commentaire: "Avancement de 41 %." }))).toBeNull();
    expect(lire(JSON.stringify({ commentaire: "Avancement de 40 %, 3 livrables." }))).toBeNull();
    expect(lire("pas du json")).toBeNull();
    expect(lire(JSON.stringify({ commentaire: "ok", autre: 1 }))).toBeNull();
    expect(lire(JSON.stringify({ commentaire: "" }))).toBeNull();
    expect(
      lire(JSON.stringify({ commentaire: "x".repeat(TAILLE_MAX_SUGGESTION_AVANCEMENT + 1) })),
    ).toBeNull();
    expect(lire(JSON.stringify({ commentaire: "Voir [TERME_99]." }))).toBeNull();
  });
});

describe("suggestion manuelle", () => {
  let missionId: string;
  let id: string;
  let version: number;

  it("brouillon IA : stocké, jamais envoyé avec des données internes ; le fournisseur ne reçoit que les faits", async () => {
    missionId = await missionSignee(a, "Intitulé confidentiel Zorglub");
    ({ id, version } = await brouillon(a, missionId));
    const r = await a.chef.post(`/api/avancement/${id}/suggerer-commentaire`, { version });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      commentaire_ia: TEXTE_IA,
      statut_commentaire: "brouillon_ia",
      commentaire: null,
      suggestion: { obtenue: true, raison: null },
    });
    expect(serveur.requetes).toHaveLength(1);
    const envoye = JSON.stringify(serveur.requetes[0]?.corps);
    expect(envoye).not.toContain("Zorglub");
    expect(envoye).not.toContain(a.chef.utilisateurId);
    version = r.json().version;
    const conso = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT tache, issue FROM ia_consommations WHERE cabinet_id = $1 ORDER BY id",
            [a.cabinetId],
          )
        ).rows,
    );
    expect(conso).toEqual([{ tache: "redaction", issue: "succes" }]);
  });

  it("validation bloquée tant que la suggestion n'est pas relue (409)", async () => {
    const v = await a.chef.post(`/api/avancement/${id}/valider`, { version });
    expect(v.statusCode).toBe(409);
    expect(v.json().erreur.code).toBe("COMMENTAIRE_IA_A_RELIRE");
  });

  it("un droit manquant ou un autre cabinet : refus ; version périmée : 409", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    expect(
      (await consultant.post(`/api/avancement/${id}/suggerer-commentaire`, { version })).statusCode,
    ).toBe(403);
    expect(
      (await sansIa.associe.post(`/api/avancement/${id}/suggerer-commentaire`, { version }))
        .statusCode,
    ).toBe(404);
    const perime = await a.chef.post(`/api/avancement/${id}/suggerer-commentaire`, {
      version: version - 1,
    });
    expect(perime.statusCode).toBe(409);
    expect(perime.json().erreur.code).toBe("VERSION_CONFLIT");
  });

  it("le client ne voit jamais commentaire_ia : seul le commentaire relu et validé", async () => {
    const dirigeant = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    attendre(
      200,
      await a.associe.put(`/api/portail/partages?client_id=${a.clientId}`, {
        missions: [{ mission_id: missionId }],
        documents: [],
      }),
      "partage",
    );
    // Brouillon : invisible du portail.
    expect((await dirigeant.get(`/api/portail/avancement/${id}`)).statusCode).toBe(404);
    // Le chef relit (réécrit) puis valide.
    const p = await a.chef.patch(`/api/avancement/${id}`, {
      version,
      commentaire: "Texte relu et réécrit par le chef.",
    });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ statut_commentaire: "redige" });
    const v = await a.chef.post(`/api/avancement/${id}/valider`, { version: p.json().version });
    expect(v.statusCode, v.body).toBe(200);
    const d = await dirigeant.get(`/api/portail/avancement/${id}`);
    expect(d.statusCode).toBe(200);
    expect(d.json().commentaire).toBe("Texte relu et réécrit par le chef.");
    expect(clesDe(d.json())).not.toContain("commentaire_ia");
    expect(d.body).not.toContain(TEXTE_IA);
    expect((await dirigeant.get("/api/portail/avancement")).body).not.toContain(TEXTE_IA);
  });

  it("un commentaire déjà rédigé n'est pas écrasé (409) ; un rapport validé non plus", async () => {
    const m = await missionSignee(a, "Mission commentaire rédigé");
    const r = await brouillon(a, m);
    const p = await a.chef.patch(`/api/avancement/${r.id}`, {
      version: r.version,
      commentaire: "Mon texte.",
    });
    const non = await a.chef.post(`/api/avancement/${r.id}/suggerer-commentaire`, {
      version: p.json().version,
    });
    expect(non.statusCode).toBe(409);
    expect(non.json().erreur.code).toBe("COMMENTAIRE_DEJA_REDIGE");
    const fige = await a.chef.post(`/api/avancement/${id}/suggerer-commentaire`, { version });
    expect(fige.statusCode).toBe(409);
    expect(fige.json().erreur.code).toBe("RAPPORT_VALIDE");
  });

  it("chiffre inventé : suggestion rejetée, rien n'est enregistré (commentaire vide)", async () => {
    const m = await missionSignee(a, "Mission chiffre inventé");
    const r = await brouillon(a, m);
    reponse("Excellent : avancement de 87 % cette semaine.");
    const s = await a.chef.post(`/api/avancement/${r.id}/suggerer-commentaire`, {
      version: r.version,
    });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({
      commentaire_ia: null,
      statut_commentaire: "vide",
      suggestion: { obtenue: false, raison: "sortie_rejetee" },
    });
    // L'appel a bien eu lieu et a été compté.
    expect(serveur.requetes).toHaveLength(1);
  });

  it("erreur du fournisseur : repli silencieux, requête réussie", async () => {
    const m = await missionSignee(a, "Mission fournisseur en panne");
    const r = await brouillon(a, m);
    serveur.repondre(() => ({ statut: 500, contenu: "erreur" }));
    const s = await a.chef.post(`/api/avancement/${r.id}/suggerer-commentaire`, {
      version: r.version,
    });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({
      statut_commentaire: "vide",
      suggestion: { obtenue: false, raison: "echec" },
    });
  });

  it("IA désactivée pour le cabinet : repli sans aucun appel au fournisseur", async () => {
    const m = await missionSignee(sansIa, "Mission sans IA");
    const r = await brouillon(sansIa, m);
    const s = await sansIa.chef.post(`/api/avancement/${r.id}/suggerer-commentaire`, {
      version: r.version,
    });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({
      commentaire_ia: null,
      statut_commentaire: "vide",
      suggestion: { obtenue: false, raison: "ia_desactivee" },
    });
    expect(serveur.requetes).toHaveLength(0);
  });
});

describe("tâche hebdomadaire", () => {
  const seulement =
    (cabinets: string[], h: HandlerJob): HandlerJob =>
    async (args) => {
      if (!cabinets.includes(args.cabinetId)) return;
      return h(args);
    };

  async function executer(cabinets: string[]) {
    await ctx.db.withoutTenant((db) => planifierAvancementHebdo(db, MAINTENANT));
    const worker = new WorkerJobs(ctx.db, {
      mailer,
      registre: creerRegistre({
        [TYPE_JOB_AVANCEMENT_HEBDO]: seulement(
          cabinets,
          creerHandlerAvancementHebdo({ lot: 25, ia: { config: ctx.config } }),
        ),
      }),
      horloge: () => MAINTENANT,
    });
    const r = [];
    for (let x = await worker.traiterUn(); x; x = await worker.traiterUn()) r.push(x);
    return r.filter((x) => x.type === TYPE_JOB_AVANCEMENT_HEBDO);
  }

  const rapports = (cabinetId: string) =>
    proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT statut_commentaire, commentaire_ia, commentaire, statut FROM avancement_rapports WHERE cabinet_id = $1",
            [cabinetId],
          )
        ).rows,
    );

  it("sans utilisateur connecté : brouillon IA imputé au chef de mission, tâche terminée", async () => {
    const cabinet = await preparerFacturation(ctx, "Avancement tâche IA");
    attendre(
      200,
      await cabinet.associe.put("/api/ia/parametres", { ia_activee: true }),
      "IA activée",
    );
    await missionSignee(cabinet, "Mission tâche IA");
    const resultats = await executer([cabinet.cabinetId]);
    expect(resultats.every((x) => x.statut === "termine")).toBe(true);
    expect(await rapports(cabinet.cabinetId)).toEqual([
      expect.objectContaining({
        statut: "brouillon",
        statut_commentaire: "brouillon_ia",
        commentaire_ia: TEXTE_IA,
        commentaire: null,
      }),
    ]);
    expect(serveur.requetes).toHaveLength(1);
  });

  it("repli silencieux : chiffre inventé, panne ou IA désactivée => commentaire vide, tâche terminée", async () => {
    reponse("Un avancement de 99 %.");
    const c1 = await preparerFacturation(ctx, "Avancement tâche chiffre");
    attendre(200, await c1.associe.put("/api/ia/parametres", { ia_activee: true }), "IA");
    await missionSignee(c1, "Mission tâche chiffre");
    const c2 = await preparerFacturation(ctx, "Avancement tâche sans IA");
    await missionSignee(c2, "Mission tâche sans IA");
    const resultats = await executer([c1.cabinetId, c2.cabinetId]);
    expect(resultats.every((x) => x.statut === "termine")).toBe(true);
    for (const c of [c1, c2]) {
      expect(await rapports(c.cabinetId)).toEqual([
        expect.objectContaining({ statut_commentaire: "vide", commentaire_ia: null }),
      ]);
    }
    // Seul le cabinet qui a l'IA a appelé le fournisseur.
    expect(serveur.requetes).toHaveLength(1);
  });
});
