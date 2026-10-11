import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkerJobs } from "../src/jobs/worker.js";
import type { Mailer } from "../src/notifications/mailer.js";
import type { Api } from "./api.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMissionSignee, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Événement `mission.cloture_demandee` (AUT-01, AUT-08 ; migration 0303) : publié PAR LA BASE
 * quand la mission passe à « à clôturer », non bloquant, idempotent par mission et par passage,
 * jamais depuis le portail client ; l'automatisation standard « rappel de la check-list de
 * clôture » se déclenche de bout en bout.
 */

const CODE = "mission.cloture_demandee";

let ctx: Contexte;
let f: CabinetFacturation;
let autre: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  f = await preparerFacturation(ctx, "Clôture demandée");
  autre = await preparerCabinet(ctx, "Clôture demandée autre");
});

afterAll(async () => {
  await ctx.fermer();
});

async function viderFile(): Promise<void> {
  const worker = new WorkerJobs(ctx.db, {
    mailer: ctx.app.mailer as Mailer,
    horloge: () => new Date(Date.now() + 60_000),
  });
  for (let i = 0; i < 2000; i++) if (!(await worker.traiterUn())) return;
  throw new Error("File de jobs non vidée.");
}

async function changerStatut(par: Api, missionId: string, statut: string): Promise<void> {
  attendre(200, await par.post(`/api/missions/${missionId}/statut`, { statut }), statut);
}

/** Mission signée, puis « en cours » (prête à passer « à clôturer »). */
async function missionEnCours(c: CabinetMissions): Promise<string> {
  const m = await creerMissionSignee(c);
  await changerStatut(c.directeur, m.id, "en_cours");
  return m.id;
}

interface LigneEvenement {
  cle: string;
  source: string;
  acteur_id: string | null;
  mission_id: string;
  cabinet_id: string;
  payload: Record<string, unknown>;
}

async function evenements(missionId: string): Promise<LigneEvenement[]> {
  const r = await proprietaire((c) =>
    c.query(
      `SELECT cle, source, acteur_id, mission_id, cabinet_id, payload
       FROM automatisation_evenements WHERE code = $1 AND mission_id = $2 ORDER BY cree_le, id`,
      [CODE, missionId],
    ),
  );
  return r.rows as LigneEvenement[];
}

async function jobsDEvenement(cabinetId: string): Promise<number> {
  const r = await proprietaire((c) =>
    c.query(
      `SELECT count(*)::int AS n FROM jobs j
       WHERE j.cabinet_id = $1 AND j.type = 'automatisation_evenement'
         AND (j.charge->>'evenement_id')::uuid IN
           (SELECT id FROM automatisation_evenements WHERE cabinet_id = $1 AND code = $2)`,
      [cabinetId, CODE],
    ),
  );
  return r.rows[0].n as number;
}

async function executionsDe(par: Api, automatisationId: string) {
  const r = await par.get(`/api/automatisations/executions?automatisation_id=${automatisationId}`);
  attendre(200, r, "journal");
  return r.json().elements as {
    id: string;
    issue: string;
    mission_id: string | null;
    actions: { type: string; statut: string }[];
  }[];
}

async function notificationsDe(par: Api): Promise<{ type: string; titre: string }[]> {
  const r = await par.get("/api/notifications?limite=100");
  attendre(200, r, "notifications");
  return r.json().elements as { type: string; titre: string }[];
}

describe("publication par la base au passage « à clôturer »", () => {
  it("publie UN événement (mission seule, source base) et rien aux autres transitions", async () => {
    const m = await creerMissionSignee(f);
    expect(await evenements(m.id)).toEqual([]);
    await changerStatut(f.directeur, m.id, "en_cours");
    expect(await evenements(m.id)).toEqual([]);

    await changerStatut(f.directeur, m.id, "a_cloturer");
    const lignes = await evenements(m.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      source: "base",
      acteur_id: null,
      mission_id: m.id,
      cabinet_id: f.cabinetId,
      payload: { mission_id: m.id },
    });
    // Identifiants seulement : jamais un montant ni un libellé libre.
    expect(Object.keys(lignes[0]?.payload ?? {})).toEqual(["mission_id"]);
    expect(lignes[0]?.cle).toMatch(new RegExp(`^${CODE}:${m.id}:\\d{8}T\\d{12}$`));
    // Aucune automatisation active : rien n'est mis en file.
    expect(await jobsDEvenement(f.cabinetId)).toBe(0);
  });

  it("idempotent par passage ; une réouverture rapide puis un nouveau passage ne republie pas", async () => {
    const m = await missionEnCours(f);
    // Un seul passage, même transaction : « à clôturer » deux fois = une clé, un événement.
    await ctx.db.withTenant(f.cabinetId, async (db) => {
      await db.query("UPDATE missions SET statut = 'a_cloturer' WHERE id = $1", [m]);
      await db.query("UPDATE missions SET statut = 'en_cours' WHERE id = $1", [m]);
      await db.query("UPDATE missions SET statut = 'a_cloturer' WHERE id = $1", [m]);
    });
    expect(await evenements(m)).toHaveLength(1);

    // UPDATE du même statut ou d'une autre colonne : rien de plus.
    await ctx.db.withTenant(f.cabinetId, async (db) => {
      await db.query("UPDATE missions SET statut = 'a_cloturer' WHERE id = $1", [m]);
      await db.query("UPDATE missions SET modifie_le = now() WHERE id = $1", [m]);
    });
    expect(await evenements(m)).toHaveLength(1);

    // Réouverture puis nouveau passage (autres transactions) dans les 10 minutes : anti-répétition,
    // pas de second événement (voir les tests dédiés plus bas).
    await changerStatut(f.directeur, m, "en_cours");
    expect(await evenements(m)).toHaveLength(1);
    await changerStatut(f.directeur, m, "a_cloturer");
    expect(await evenements(m)).toHaveLength(1);
  });

  it("la clôture (« cloturee ») ne publie pas l'événement", async () => {
    const m = await missionEnCours(f);
    await changerStatut(f.directeur, m, "a_cloturer");
    expect(await evenements(m)).toHaveLength(1);
    const r = await f.directeur.post(`/api/missions/${m}/cloturer`);
    attendre(200, r, "clôture");
    expect(r.json()).toMatchObject({ statut: "cloturee" });
    expect(await evenements(m)).toHaveLength(1);
  });

  it("jamais depuis une transaction du portail client", async () => {
    const m = await missionEnCours(f);
    const modifiees = await proprietaire(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.cabinet_id', $1, true)", [f.cabinetId]);
        await c.query("SELECT set_config('app.portail_client_id', $1, true)", [f.clientId]);
        const r = await c.query("UPDATE missions SET statut = 'a_cloturer' WHERE id = $1", [m]);
        await c.query("COMMIT");
        return r.rowCount;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    });
    // Le passage a bien eu lieu (le déclencheur s'est exécuté), mais n'a rien publié.
    expect(modifiees).toBe(1);
    expect(await evenements(m)).toEqual([]);
    const statut = await proprietaire((c) =>
      c.query("SELECT statut FROM missions WHERE id = $1", [m]),
    );
    expect(statut.rows[0].statut).toBe("a_cloturer");
  });

  it("non bloquant : une erreur de publication est absorbée, le changement de statut se poursuit", async () => {
    const m = await missionEnCours(f);
    const r = await ctx.db.withTenant(f.cabinetId, async (db) => {
      // Même fonction que le déclencheur : une mission inconnue viole la clé étrangère, l'erreur
      // est absorbée (avertissement) et la transaction continue.
      await db.query("SELECT automatisation_publier_base($1, $2, '{}'::jsonb, 'inconnue', $3)", [
        f.cabinetId,
        CODE,
        "00000000-0000-4000-8000-0000000000bb",
      ]);
      await db.query("UPDATE missions SET statut = 'a_cloturer' WHERE id = $1", [m]);
      return (await db.query("SELECT statut FROM missions WHERE id = $1", [m])).rows[0].statut;
    });
    expect(r).toBe("a_cloturer");
    expect(await evenements(m)).toHaveLength(1);
  });
});

describe("rappel de la check-list de clôture (standard), de bout en bout", () => {
  it("activé par un associé, se déclenche au passage « à clôturer » et prévient chef et directeur", async () => {
    const standard = await f.associe.post("/api/automatisations/standard/cloture_rappel_checklist");
    attendre(201, standard, "standard");
    const autoId = standard.json().id as string;
    attendre(200, await f.associe.post(`/api/automatisations/${autoId}/activer`), "activation");

    const m = await missionEnCours(f);
    await changerStatut(f.directeur, m, "a_cloturer");
    // Une automatisation active écoute l'événement : un traitement est mis en file par la base.
    expect(await evenements(m)).toHaveLength(1);
    expect(await jobsDEvenement(f.cabinetId)).toBe(1);
    await viderFile();

    const journal = await executionsDe(f.associe, autoId);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ issue: "declenchee", mission_id: m });
    expect(journal[0]?.actions.map((a) => [a.type, a.statut])).toEqual([["notifier", "reussie"]]);

    for (const destinataire of [f.chef, f.directeur]) {
      const notes = await notificationsDe(destinataire);
      expect(
        notes.some((n) => n.type === "automatisation" && n.titre.includes("Clôture demandée")),
      ).toBe(true);
    }

    // Rejouer le traitement ne refait rien : une seule exécution pour ce passage.
    await viderFile();
    expect(await executionsDe(f.associe, autoId)).toHaveLength(1);

    // Réouverture puis nouveau passage dans les 10 minutes : aucune nouvelle exécution (pas de
    // spam du directeur par bascules successives).
    await changerStatut(f.directeur, m, "en_cours");
    await changerStatut(f.directeur, m, "a_cloturer");
    await viderFile();
    expect(await executionsDe(f.associe, autoId)).toHaveLength(1);
    expect(await evenements(m)).toHaveLength(1);

    // La clôture elle-même ne déclenche plus rien.
    attendre(200, await f.directeur.post(`/api/missions/${m}/cloturer`), "clôture");
    await viderFile();
    expect(await executionsDe(f.associe, autoId)).toHaveLength(1);
  });

  it("la mission d'un autre cabinet ne déclenche rien, et reste cloisonnée", async () => {
    const liste = (await f.associe.get("/api/automatisations?limite=100")).json().elements as {
      id: string;
      standard_code: string;
    }[];
    const autoId = liste.find((x) => x.standard_code === "cloture_rappel_checklist")?.id as string;
    expect(autoId).toBeTruthy();
    const avant = (await executionsDe(f.associe, autoId)).length;
    const evenementsAvant = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM automatisation_evenements WHERE cabinet_id = $1", [
        f.cabinetId,
      ]),
    );

    const m = await missionEnCours(autre);
    await changerStatut(autre.directeur, m, "a_cloturer");
    await viderFile();

    // Événement enregistré dans SON cabinet seulement ; aucune exécution chez f.
    const lignes = await evenements(m);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.cabinet_id).toBe(autre.cabinetId);
    expect(await executionsDe(f.associe, autoId)).toHaveLength(avant);
    const evenementsApres = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM automatisation_evenements WHERE cabinet_id = $1", [
        f.cabinetId,
      ]),
    );
    expect(evenementsApres.rows[0].n).toBe(evenementsAvant.rows[0].n);
    expect(await jobsDEvenement(autre.cabinetId)).toBe(0);
    // Chaque cabinet ne lit que ses événements (RLS).
    const lus = await ctx.db.withTenant(f.cabinetId, (db) =>
      db.query("SELECT 1 FROM automatisation_evenements WHERE mission_id = $1", [m]),
    );
    expect(lus.rowCount).toBe(0);
  });
});

describe("anti-répétition : un seul événement par mission en 10 minutes (0303)", () => {
  /** Événement « simulé » de la mission, daté de `minutes` minutes dans le passé (insertion datée). */
  const evenementDate = (missionId: string, minutes: number) =>
    proprietaire((c) =>
      c.query(
        `INSERT INTO automatisation_evenements (cabinet_id, code, payload, cle, source, mission_id, cree_le)
         VALUES ($1, $2, $3, $4, 'base', $5, now() - make_interval(mins => $6))`,
        [
          f.cabinetId,
          CODE,
          JSON.stringify({ mission_id: missionId }),
          `${CODE}:${missionId}:ancien-${minutes}`,
          missionId,
          minutes,
        ],
      ),
    );

  it("un événement vieux d'une minute : le nouveau passage ne publie rien", async () => {
    const m = await missionEnCours(f);
    await evenementDate(m, 1);
    await changerStatut(f.directeur, m, "a_cloturer");
    expect(await evenements(m)).toHaveLength(1);
    // Bascule en boucle : toujours rien de plus.
    await changerStatut(f.directeur, m, "en_cours");
    await changerStatut(f.directeur, m, "a_cloturer");
    expect(await evenements(m)).toHaveLength(1);
  });

  it("un événement vieux de onze minutes : le nouveau passage publie un second événement", async () => {
    const m = await missionEnCours(f);
    await evenementDate(m, 11);
    await changerStatut(f.directeur, m, "a_cloturer");
    const lignes = await evenements(m);
    expect(lignes).toHaveLength(2);
    expect(lignes.map((l) => l.source)).toEqual(["base", "base"]);
    // Et ce nouveau passage ouvre à son tour la fenêtre : la bascule suivante est absorbée.
    await changerStatut(f.directeur, m, "en_cours");
    await changerStatut(f.directeur, m, "a_cloturer");
    expect(await evenements(m)).toHaveLength(2);
  });

  it("la limite est propre à la mission : une autre mission du même cabinet publie", async () => {
    const recente = await missionEnCours(f);
    await evenementDate(recente, 1);
    const autreMission = await missionEnCours(f);
    await changerStatut(f.directeur, autreMission, "a_cloturer");
    expect(await evenements(autreMission)).toHaveLength(1);
    await changerStatut(f.directeur, recente, "a_cloturer");
    expect(await evenements(recente)).toHaveLength(1);
  });
});

describe("définition de l'automatisation sur cet événement", () => {
  it("le mode « droits de la personne à l'origine » est refusé (aucune personne à l'origine)", async () => {
    const r = await f.associe.post("/api/automatisations", {
      nom: "Clôture en mode déclencheur",
      definition: {
        evenement_code: CODE,
        condition: null,
        mode_execution: "declencheur",
        actions: [{ type: "notifier", destinataires: ["chef_mission"], titre: "Clôture demandée" }],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("DEFINITION_INVALIDE");
    expect(r.json().erreur.details.erreurs[0]).toMatchObject({
      chemin: "mode_execution",
      code: "DECLENCHEUR_ABSENT",
    });
  });
});
