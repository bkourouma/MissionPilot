import { lundiDeLaSemaine } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  creerHandlerAvancementHebdo,
  executerAvancementHebdo,
  planificationAvancementHebdo,
  planifierAvancementHebdo,
  TYPE_JOB_AVANCEMENT_HEBDO,
} from "../src/automatisation/avancement-job.js";
import { creerRegistre, type HandlerJob } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { ECHANTILLONS, televerser } from "./fichiers-outils.js";
import { attendre, CLE_INTERDITE, clesDe, inviterClient } from "./portail-outils.js";

/*
 * Rapport d'avancement hebdomadaire au client (AUT-10) : tâche hebdomadaire (jours ouvrés, lots,
 * idempotence, isolation), brouillon interne relu puis validé par le chef de mission, portail
 * (validés seulement, autre client refusé), validé figé, aucune donnée financière, aucun e-mail.
 */

const mailer = new MailerJournal();
const AUJOURDHUI = new Date().toISOString().slice(0, 10);
const LUNDI = lundiDeLaSemaine(AUJOURDHUI);
const MAINTENANT = new Date(`${LUNDI}T08:00:00Z`);
const JOB_FACTICE = "00000000-0000-4000-8000-000000000001";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
const missions: string[] = [];
let missionNonSignee: string;
let missionB: string;
let dirigeant: Awaited<ReturnType<typeof inviterClient>>;
let dirigeantA2: Awaited<ReturnType<typeof inviterClient>>;

const lignes = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);

const codeSql = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => {
    try {
      await c.query(sql, params);
      return "ok";
    } catch (e) {
      return (e as { code?: string }).code;
    }
  });

/** Le worker ne traite que les cabinets de ce fichier (la base de test est partagée par le run). */
const seulementMesCabinets =
  (h: HandlerJob): HandlerJob =>
  async (args) => {
    if (args.cabinetId !== a.cabinetId && args.cabinetId !== b.cabinetId) return;
    return h(args);
  };

/** Planifie (horloge fixe) et exécute les tâches « avancement » de MES cabinets seulement. */
async function executer(maintenant: Date, lot = 2) {
  const planifies = await ctx.db.withoutTenant((db) => planifierAvancementHebdo(db, maintenant));
  const worker = new WorkerJobs(ctx.db, {
    mailer,
    registre: creerRegistre({
      [TYPE_JOB_AVANCEMENT_HEBDO]: seulementMesCabinets(creerHandlerAvancementHebdo({ lot })),
    }),
    horloge: () => maintenant,
  });
  const resultats = [];
  for (let r = await worker.traiterUn(); r; r = await worker.traiterUn()) resultats.push(r);
  return { planifies, resultats: resultats.filter((r) => r.type === TYPE_JOB_AVANCEMENT_HEBDO) };
}

const rapportsDe = (cabinetId: string) =>
  lignes(
    "SELECT id, mission_id, statut, semaine::text AS semaine FROM avancement_rapports WHERE cabinet_id = $1 ORDER BY mission_id, semaine",
    [cabinetId],
  );

async function missionSignee(c: CabinetFacturation, intitule: string, corps = {}) {
  const id = (await creerMission(c, { intitule, ...corps })).id;
  attendre(
    200,
    await c.directeur.post(`/api/missions/${id}/signer`, { date_signature: "2026-10-01" }),
    "signature",
  );
  return id;
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Avancement A");
  b = await preparerFacturation(ctx, "Avancement B");
  for (const i of [1, 2, 3]) missions.push(await missionSignee(a, `Mission avancement ${i}`));
  missionNonSignee = (await creerMission(a, { intitule: "Mission en préparation" })).id;
  missionB = await missionSignee(b, "Mission B");
  const c2 = await a.associe.post("/api/clients", { raison_sociale: "Client avancement A2" });
  attendre(201, c2, "client A2");
  const clientA2 = c2.json().id as string;
  const mA2 = (await creerMission(a, { intitule: "Mission A2", client_id: clientA2 })).id;
  attendre(
    200,
    await a.associe.put(`/api/portail/partages?client_id=${a.clientId}`, {
      missions: missions.map((mission_id) => ({ mission_id })),
      documents: [],
    }),
    "partages A1",
  );
  attendre(
    200,
    await a.associe.put(`/api/portail/partages?client_id=${clientA2}`, {
      missions: [{ mission_id: mA2 }],
      documents: [],
    }),
    "partages A2",
  );
  dirigeant = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
  dirigeantA2 = await inviterClient(ctx, a.associe, clientA2, ["client_dirigeant"]);
}, 240_000);
afterAll(() => ctx.fermer());

describe("planification", () => {
  it("jour ouvré à 6 h 30 UTC, clé par semaine ; ni samedi ni dimanche", async () => {
    const mardi = planificationAvancementHebdo(new Date("2026-10-13T12:00:00Z"));
    expect(mardi).toMatchObject({
      cle: `${TYPE_JOB_AVANCEMENT_HEBDO}:2026-10-12`,
      semaine: "2026-10-12",
      ouvre: true,
    });
    expect(planificationAvancementHebdo(new Date("2026-10-17T08:00:00Z")).ouvre).toBe(false);
    expect(planificationAvancementHebdo(new Date("2026-10-18T08:00:00Z")).ouvre).toBe(false);
    const n = await ctx.db.withoutTenant((db) =>
      planifierAvancementHebdo(db, new Date("2026-10-17T08:00:00Z")),
    );
    expect(n).toBe(0);
  });
});

describe("tâche hebdomadaire", () => {
  it("lots plafonnés : 3 missions actives, lot de 2 => 2 lots, aucune oubliée ni dupliquée", async () => {
    const { planifies, resultats } = await executer(MAINTENANT, 2);
    expect(planifies).toBeGreaterThanOrEqual(2);
    expect(resultats.every((r) => r.statut === "termine")).toBe(true);
    const r = await rapportsDe(a.cabinetId);
    expect(r.map((x) => x.mission_id).sort()).toEqual([...missions].sort());
    expect(r.every((x) => x.statut === "brouillon" && x.semaine === LUNDI)).toBe(true);
    expect(r.map((x) => x.mission_id)).not.toContain(missionNonSignee);
    const suite = await lignes(
      "SELECT cle FROM jobs WHERE cabinet_id = $1 AND type = $2 ORDER BY cle",
      [a.cabinetId, TYPE_JOB_AVANCEMENT_HEBDO],
    );
    expect(suite.map((j) => j.cle)).toEqual([
      `avancement_hebdo:${LUNDI}`,
      `avancement_hebdo:${LUNDI}:lot:2`,
    ]);
  });

  it("isolation : le cabinet B n'a que sa mission", async () => {
    const r = await rapportsDe(b.cabinetId);
    expect(r.map((x) => x.mission_id)).toEqual([missionB]);
  });

  it("idempotente : une seconde planification et une seconde exécution ne changent rien", async () => {
    const avant = await rapportsDe(a.cabinetId);
    const { planifies } = await executer(MAINTENANT, 2);
    expect(planifies).toBe(0);
    const bilan = await ctx.db.withTenant(a.cabinetId, (db) =>
      executerAvancementHebdo(
        {
          db,
          cabinetId: a.cabinetId,
          jobId: JOB_FACTICE,
          charge: { semaine: LUNDI },
          maintenant: MAINTENANT,
        },
        { lot: 2 },
      ),
    );
    expect(bilan.crees).toBe(0);
    expect(await rapportsDe(a.cabinetId)).toEqual(avant);
  });

  it("notification INTERNE au chef de mission, aucun e-mail", async () => {
    const n = await lignes(
      "SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1 AND type = 'avancement_brouillon'",
      [a.chef.utilisateurId],
    );
    expect(n[0]?.n).toBe(3);
    const emails = await lignes(
      "SELECT count(*)::int AS n FROM jobs WHERE cabinet_id = $1 AND type = 'envoyer_email'",
      [a.cabinetId],
    );
    expect(emails[0]?.n).toBe(0);
    expect(mailer.boite).toHaveLength(0);
  });

  it("pas de week-end : rien le samedi", async () => {
    const samedi = new Date(MAINTENANT);
    samedi.setUTCDate(samedi.getUTCDate() + 5);
    expect(await ctx.db.withoutTenant((db) => planifierAvancementHebdo(db, samedi))).toBe(0);
  });
});

describe("cabinet : relecture, modification, validation", () => {
  let id: string;
  let version: number;

  it("liste et lecture (droit avancement.lire, mission visible)", async () => {
    const l = await a.chef.get(`/api/missions/${missions[0]}/avancement`);
    expect(l.statusCode).toBe(200);
    const el = l.json().elements as Record<string, unknown>[];
    expect(el).toHaveLength(1);
    expect(el[0]).toMatchObject({ statut: "brouillon", statut_libelle: "Brouillon" });
    id = el[0]?.id as string;
    const d = await a.chef.get(`/api/avancement/${id}`);
    expect(d.statusCode).toBe(200);
    version = d.json().version;
    expect(d.json()).toMatchObject({ statut_commentaire: "vide", peut_valider: true });
    // Aucune donnée financière interne dans le contenu.
    expect(clesDe(d.json().contenu).filter((k) => CLE_INTERDITE.test(k))).toEqual([]);
    // Un autre chef de mission, qui ne voit pas cette mission, et un cabinet tiers : 404.
    const autre = await a.avecRoles(["chef_mission"]);
    expect((await autre.get(`/api/avancement/${id}`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/avancement/${id}`)).statusCode).toBe(404);
    // Un rôle sans le droit : 403.
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get(`/api/avancement/${id}`)).statusCode).toBe(403);
  });

  it("brouillon invisible du portail, même par identifiant direct", async () => {
    const l = await dirigeant.get("/api/portail/avancement");
    expect(l.statusCode).toBe(200);
    expect(l.json().elements).toEqual([]);
    expect((await dirigeant.get(`/api/portail/avancement/${id}`)).statusCode).toBe(404);
  });

  it("modification : commentaire et introduction seulement, verrou optimiste", async () => {
    const p = await a.chef.patch(`/api/avancement/${id}`, {
      version,
      introduction: "Bonne semaine.",
      commentaire: "Point de vigilance sur le prochain jalon.",
    });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ statut_commentaire: "redige", version: version + 1 });
    const perime = await a.chef.patch(`/api/avancement/${id}`, { version, commentaire: "x" });
    expect(perime.statusCode).toBe(409);
    expect(perime.json().erreur.code).toBe("VERSION_CONFLIT");
    // Les chiffres ne se modifient pas : champ inconnu refusé.
    const chiffres = await a.chef.patch(`/api/avancement/${id}`, {
      version: version + 1,
      contenu: { avancement: { pourcentage: 100 } },
    });
    expect(chiffres.statusCode).toBe(400);
    version = p.json().version;
  });

  it("un brouillon modifié par le chef n'est pas régénéré par la tâche", async () => {
    const bilan = await ctx.db.withTenant(a.cabinetId, (db) =>
      executerAvancementHebdo(
        {
          db,
          cabinetId: a.cabinetId,
          jobId: JOB_FACTICE,
          charge: { semaine: LUNDI },
          maintenant: MAINTENANT,
        },
        { lot: 5 },
      ),
    );
    expect(bilan.crees).toBe(0);
    const d = await a.chef.get(`/api/avancement/${id}`);
    expect(d.json().commentaire).toBe("Point de vigilance sur le prochain jalon.");
  });

  it("régénération depuis le moteur : les textes du chef sont conservés", async () => {
    const r = await a.chef.post(`/api/avancement/${id}/regenerer`, { version });
    expect(r.statusCode).toBe(200);
    expect(r.json().commentaire).toBe("Point de vigilance sur le prochain jalon.");
    version = r.json().version;
  });

  it("validation : refusée à un non-chef de la mission, acceptée au chef", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.post(`/api/avancement/${id}/valider`, { version })).statusCode).toBe(
      403,
    );
    const v = await a.chef.post(`/api/avancement/${id}/valider`, { version });
    expect(v.statusCode).toBe(200);
    expect(v.json()).toMatchObject({
      statut: "valide",
      statut_libelle: "Validé",
      peut_valider: false,
    });
    expect(v.json().valide_par.id).toBe(a.chef.utilisateurId);
  });

  it("validé = figé : API (409) et base (MQU01, même propriétaire)", async () => {
    const d = (await a.chef.get(`/api/avancement/${id}`)).json();
    const p = await a.chef.patch(`/api/avancement/${id}`, {
      version: d.version,
      commentaire: "Tentative tardive.",
    });
    expect(p.statusCode).toBe(409);
    expect(p.json().erreur.code).toBe("RAPPORT_VALIDE");
    expect(
      (await a.chef.post(`/api/avancement/${id}/regenerer`, { version: d.version })).statusCode,
    ).toBe(409);
    expect(
      await codeSql("UPDATE avancement_rapports SET commentaire = 'x' WHERE id = $1", [id]),
    ).toBe("MQU01");
    expect(await codeSql("DELETE FROM avancement_rapports WHERE id = $1", [id])).toBe("MQU07");
    expect((await rapportsDe(a.cabinetId)).filter((x) => x.statut === "valide")).toHaveLength(1);
  });

  it("portail : le rapport validé est visible, sans suggestion IA ni donnée interne", async () => {
    const l = await dirigeant.get("/api/portail/avancement");
    expect(l.statusCode).toBe(200);
    expect(l.json().elements).toHaveLength(1);
    const d = await dirigeant.get(`/api/portail/avancement/${id}`);
    expect(d.statusCode).toBe(200);
    expect(d.json().commentaire).toBe("Point de vigilance sur le prochain jalon.");
    const cles = clesDe(d.json());
    expect(cles).not.toContain("commentaire_ia");
    expect(cles.filter((k) => CLE_INTERDITE.test(k))).toEqual([]);
    // Compte portail d'un AUTRE client du même cabinet : 404 et liste vide.
    expect((await dirigeantA2.get(`/api/portail/avancement/${id}`)).statusCode).toBe(404);
    expect((await dirigeantA2.get("/api/portail/avancement")).json().elements).toEqual([]);
    // Un compte portail n'accède ni aux routes du cabinet ni n'écrit.
    expect((await dirigeant.get(`/api/avancement/${id}`)).statusCode).toBe(403);
    expect((await dirigeant.post(`/api/avancement/${id}/valider`, { version: 1 })).statusCode).toBe(
      403,
    );
  });
});

describe("paramètre du cabinet", () => {
  it("l'envoi par e-mail reste désactivé : refusé par l'API et par la base", async () => {
    const lu = await a.associe.get("/api/avancement/parametres");
    expect(lu.json()).toMatchObject({ actif: true, envoi_email: false });
    const non = await a.associe.put("/api/avancement/parametres", {
      actif: true,
      envoi_email: true,
    });
    expect(non.statusCode).toBe(400);
    expect(
      await codeSql(
        "INSERT INTO avancement_parametres (cabinet_id, envoi_email) VALUES ($1, true)",
        [a.cabinetId],
      ),
    ).toBe("23514");
  });

  it("désactivée : plus de brouillon pour le cabinet, les autres cabinets continuent", async () => {
    attendre(
      200,
      await a.associe.put("/api/avancement/parametres", { actif: false }),
      "désactiver",
    );
    const lundiSuivant = new Date(MAINTENANT);
    lundiSuivant.setUTCDate(lundiSuivant.getUTCDate() + 7);
    await executer(lundiSuivant, 25);
    expect((await rapportsDe(a.cabinetId)).every((x) => x.semaine === LUNDI)).toBe(true);
    expect((await rapportsDe(b.cabinetId)).map((x) => x.semaine)).toEqual([
      LUNDI,
      lundiSuivant.toISOString().slice(0, 10),
    ]);
    // Sans le droit d'automatisation, le paramètre est refusé.
    expect((await a.chef.put("/api/avancement/parametres", { actif: true })).statusCode).toBe(403);
  });

  it("génération manuelle refusée si la fonction est désactivée", async () => {
    const g = await a.chef.post(`/api/missions/${missions[1]}/avancement`, {
      semaine: new Date(MAINTENANT.getTime() + 7 * 86_400_000).toISOString().slice(0, 10),
    });
    expect(g.statusCode).toBe(409);
    expect(g.json().erreur.code).toBe("FONCTION_DESACTIVEE");
  });
});

describe("portail : projection du contenu (aucune fuite des livrables non partagés)", () => {
  let jumelleSans: string;
  let jumelleAvec: string;
  let rapportSans: string;
  let rapportAvec: string;
  let documentPartage: string[] = [];

  async function livrable(missionId: string, nom: string) {
    const f = await televerser(a.chef, "/api/fichiers", `${nom}.pdf`, ECHANTILLONS.pdf(nom));
    attendre(201, f, "téléversement");
    const d = await a.chef.post(`/api/missions/${missionId}/documents`, {
      type: "livrable",
      nom,
      fichier_id: f.json().id,
    });
    attendre(201, d, "livrable");
    return d.json().id as string;
  }

  async function partager(missionsPartagees: string[], documents: string[]) {
    attendre(
      200,
      await a.associe.put(`/api/portail/partages?client_id=${a.clientId}`, {
        missions: missionsPartagees.map((mission_id) => ({ mission_id })),
        documents,
      }),
      "partages",
    );
  }

  async function validee(missionId: string) {
    const g = await a.chef.post(`/api/missions/${missionId}/avancement`, { semaine: LUNDI });
    attendre(201, g, "génération");
    const r = g.json();
    const v = await a.chef.post(`/api/avancement/${r.id}/valider`, { version: r.version });
    attendre(200, v, "validation");
    return r.id as string;
  }

  /** Réponse du portail sans les identifiants propres à chaque jumelle. */
  const sansIdentite = (j: Record<string, unknown>) => {
    const reste = { ...j };
    delete reste.id;
    delete reste.mission_id;
    delete reste.valide_le;
    return reste;
  };

  beforeAll(async () => {
    attendre(200, await a.associe.put("/api/avancement/parametres", { actif: true }), "réactiver");
    jumelleSans = await missionSignee(a, "Mission jumelle");
    jumelleAvec = await missionSignee(a, "Mission jumelle");
    const partageSans = await livrable(jumelleSans, "Livrable commun");
    const partageAvec = await livrable(jumelleAvec, "Livrable commun");
    // Le seul écart : un livrable NON partagé dans la seconde mission.
    await livrable(jumelleAvec, "Livrable interne confidentiel");
    documentPartage = [partageSans, partageAvec];
    await partager([...missions, jumelleSans, jumelleAvec], documentPartage);
    rapportSans = await validee(jumelleSans);
    rapportAvec = await validee(jumelleAvec);
  }, 120_000);

  it("un livrable non partagé ne change rien à la réponse du portail ; aucune clé non_partages", async () => {
    const sans = await dirigeant.get(`/api/portail/avancement/${rapportSans}`);
    const avec = await dirigeant.get(`/api/portail/avancement/${rapportAvec}`);
    expect(sans.statusCode).toBe(200);
    expect(avec.statusCode).toBe(200);
    expect(sansIdentite(avec.json())).toEqual(sansIdentite(sans.json()));
    for (const r of [sans, avec]) {
      expect(clesDe(r.json())).not.toContain("non_partages");
      expect(r.body).not.toContain("confidentiel");
      expect(r.json().contenu.livrables).toMatchObject({ total: 1, partages: 1 });
    }
    // Le cabinet, lui, garde le décompte des non partagés.
    const interne = await a.chef.get(`/api/avancement/${rapportAvec}`);
    expect(interne.json().contenu.livrables).toMatchObject({
      total: 2,
      partages: 1,
      non_partages: 1,
    });
    // La liste du portail ne porte pas non plus de décompte de livrables.
    const liste = await dirigeant.get("/api/portail/avancement");
    expect(clesDe(liste.json())).not.toContain("non_partages");
    expect(liste.body).not.toContain("livrables");
  });

  it("rapport validé dont la mission n'est plus partagée : 404 en liste et en détail", async () => {
    await partager([...missions, jumelleSans], [documentPartage[0] as string]);
    const liste = await dirigeant.get("/api/portail/avancement");
    expect(liste.statusCode).toBe(200);
    const ids = (liste.json().elements as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(rapportSans);
    expect(ids).not.toContain(rapportAvec);
    const detail = await dirigeant.get(`/api/portail/avancement/${rapportAvec}`);
    expect(detail.statusCode).toBe(404);
    expect((await dirigeant.get(`/api/portail/avancement/${rapportSans}`)).statusCode).toBe(200);
    // Le rapport existe toujours côté cabinet.
    expect((await a.chef.get(`/api/avancement/${rapportAvec}`)).statusCode).toBe(200);
  });
});
