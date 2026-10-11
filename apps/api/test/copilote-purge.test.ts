import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { empreinteParametres } from "../src/copilote/actions.js";
import {
  CONSERVATION_ACTIONS_COPILOTE_JOURS,
  creerHandlerCopilotePurge,
  planificationPurgeCopilote,
  planifierPurgeCopilote,
  TYPE_JOB_COPILOTE_PURGE,
} from "../src/copilote/purge.js";
import { REGISTRE_JOBS } from "../src/jobs/registre.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";

/*
 * Conservation limitée des propositions d'actions du copilote (migration 0274, copilote/purge.ts) :
 * anonymisation (parametres et resume vidés, marqueur), fenêtre de 30 jours, bornée au cabinet du
 * contexte, déclencheur qui n'admet que cette anonymisation, planification quotidienne.
 */

vi.setConfig({ testTimeout: 60_000 });

const MARQUEUR = "Proposition anonymisée (durée de conservation écoulée).";
const ZEROS = "0".repeat(64);

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let chefA: ApiUtilisateur;
let chefB: ApiUtilisateur;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Copilote Purge A");
  b = await preparerCabinet(ctx, "Cabinet Copilote Purge B");
  chefA = await a.avecRoles(["chef_mission"]);
  chefB = await b.avecRoles(["chef_mission"]);
}, 120_000);

afterAll(async () => {
  await proprietaire((cl) =>
    cl.query("DELETE FROM jobs WHERE type = $1 AND cabinet_id = ANY($2::uuid[])", [
      TYPE_JOB_COPILOTE_PURGE,
      [a.cabinetId, b.cabinetId],
    ]),
  );
  await ctx.fermer();
});

type Statut = "proposee" | "confirmee" | "annulee" | "expiree" | "refusee";

/**
 * Sème une proposition créée il y a `ageJours` jours (expirée 5 minutes après) ; une proposition
 * terminée l'a été une minute après sa création (propriétaire : le rôle applicatif ne le fait pas).
 */
async function semer(
  c: CabinetMissions,
  u: ApiUtilisateur,
  statut: Statut,
  ageJours: number,
  titre = "Titre secret de tâche",
): Promise<string> {
  const parametres = { titre, echeance: null, assignee_id: u.utilisateurId, mission_id: null };
  return proprietaire(async (cl) => {
    const r = await cl.query(
      `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume,
         cree_le, expire_le)
       VALUES ($1, $2, 'creer_tache', $3::jsonb, $4, $5,
         now() - $6::float8 * interval '1 day', now() - $6::float8 * interval '1 day' + interval '5 minutes')
       RETURNING id`,
      [
        c.cabinetId,
        u.utilisateurId,
        JSON.stringify(parametres),
        empreinteParametres(parametres),
        `Créer la tâche « ${titre} », pour vous.`,
        ageJours,
      ],
    );
    const id = r.rows[0].id as string;
    if (statut !== "proposee") {
      await cl.query(
        `UPDATE copilote_actions
         SET statut = $2, decide_le = cree_le + interval '1 minute', resultat_id = $3 WHERE id = $1`,
        [id, statut, statut === "confirmee" ? randomUUID() : null],
      );
    }
    return id;
  });
}

const lire = (id: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT statut, outil, parametres, resume, empreinte, decide_le, resultat_id, expire_le,
             anonymise_le, utilisateur_id FROM copilote_actions WHERE id = $1`,
          [id],
        )
      ).rows[0],
  );

/** Exécute le job de purge du cabinet à l'instant donné (horloge du worker). */
async function purger(c: CabinetMissions, maintenant = new Date()): Promise<void> {
  const handler = creerHandlerCopilotePurge();
  await ctx.db.withTenant(c.cabinetId, async (db) => {
    await handler({ db, cabinetId: c.cabinetId, jobId: "test", charge: {}, maintenant });
  });
}

describe("durée de conservation : 30 jours (à valider)", () => {
  it("la constante vaut 30 jours et le job est inscrit au registre", () => {
    expect(CONSERVATION_ACTIONS_COPILOTE_JOURS).toBe(30);
    expect(REGISTRE_JOBS.has(TYPE_JOB_COPILOTE_PURGE)).toBe(true);
  });

  it("anonymise les propositions terminées de plus de 30 jours, garde la trace, pas avant", async () => {
    const vieilles: Record<string, string> = {};
    for (const s of ["confirmee", "annulee", "expiree", "refusee"] as const) {
      vieilles[s] = await semer(a, chefA, s, 31);
    }
    const recentes = await semer(a, chefA, "annulee", 29);
    const ouverte = await semer(a, chefA, "proposee", 0);
    const avant = await lire(vieilles["confirmee"] as string);
    await purger(a);
    for (const [statut, id] of Object.entries(vieilles)) {
      const l = await lire(id);
      expect(l, statut).toMatchObject({
        statut,
        outil: "creer_tache",
        parametres: {},
        resume: MARQUEUR,
        empreinte: ZEROS,
        utilisateur_id: chefA.utilisateurId,
      });
      expect(l.anonymise_le).not.toBeNull();
      // La trace de la décision survit au contenu.
      expect(l.decide_le).not.toBeNull();
    }
    expect((await lire(vieilles["confirmee"] as string)).resultat_id).toBe(avant.resultat_id);
    // 29 jours : rien. Une proposition ouverte et non échue : rien.
    for (const id of [recentes, ouverte]) {
      const l = await lire(id);
      expect(l.anonymise_le).toBeNull();
      expect(l.parametres).toMatchObject({ titre: "Titre secret de tâche" });
      expect(l.resume).toContain("Titre secret de tâche");
    }
    expect((await lire(ouverte)).statut).toBe("proposee");
    // Le journal garde le nombre, jamais un texte.
    const journal = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT details::text AS d FROM journal_audit
             WHERE cabinet_id = $1 AND action = 'copilote.purge' ORDER BY id DESC LIMIT 1`,
            [a.cabinetId],
          )
        ).rows[0]?.d as string,
    );
    expect(journal).toContain('"propositions": 4');
    expect(journal).not.toContain("Titre secret");
  });

  it("fenêtre : à 29 jours rien, à 31 jours tout (même proposition, horloge du worker avancée)", async () => {
    const id = await semer(a, chefA, "annulee", 29, "Tâche de la fenêtre");
    await purger(a);
    expect((await lire(id)).anonymise_le).toBeNull();
    // Le lendemain pour le worker (la fonction refuse seulement un instant futur de la base :
    // on recule donc la proposition plutôt que d'avancer l'horloge).
    await proprietaire((cl) =>
      cl.query(`ALTER TABLE copilote_actions DISABLE TRIGGER copilote_actions_controle`),
    );
    try {
      await proprietaire((cl) =>
        cl.query(
          `UPDATE copilote_actions SET decide_le = decide_le - interval '2 days' WHERE id = $1`,
          [id],
        ),
      );
    } finally {
      await proprietaire((cl) =>
        cl.query(`ALTER TABLE copilote_actions ENABLE TRIGGER copilote_actions_controle`),
      );
    }
    await purger(a);
    expect(await lire(id)).toMatchObject({ parametres: {}, resume: MARQUEUR });
  });

  it("une proposition « proposee » échue est d'abord marquée « expiree » (datée de son expiration)", async () => {
    // Échue depuis une heure : marquée expirée, mais encore récente : pas anonymisée.
    const recente = await semer(a, chefA, "proposee", 1 / 24, "Échue récemment");
    // Échue depuis 40 jours : marquée expirée puis anonymisée dans la même passe.
    const ancienne = await semer(a, chefA, "proposee", 40, "Échue il y a longtemps");
    // Pas encore échue : intacte.
    const vivante = await semer(a, chefA, "proposee", 0, "Encore valable");
    await purger(a);
    const r = await lire(recente);
    expect(r.statut).toBe("expiree");
    expect(new Date(r.decide_le).getTime()).toBe(new Date(r.expire_le).getTime());
    expect(r.anonymise_le).toBeNull();
    expect(r.parametres).toMatchObject({ titre: "Échue récemment" });
    const v = await lire(ancienne);
    expect(v).toMatchObject({ statut: "expiree", parametres: {}, resume: MARQUEUR });
    expect(v.anonymise_le).not.toBeNull();
    const encore = await lire(vivante);
    expect(encore.statut).toBe("proposee");
    expect(encore.decide_le).toBeNull();
  });

  it("idempotent : une seconde passe ne change rien (anonymise_le conservé)", async () => {
    const id = await semer(a, chefA, "refusee", 45);
    await purger(a);
    const premiere = await lire(id);
    await purger(a);
    const seconde = await lire(id);
    expect(new Date(seconde.anonymise_le).getTime()).toBe(
      new Date(premiere.anonymise_le).getTime(),
    );
  });

  it("bornée au cabinet du contexte : l'autre cabinet n'est pas touché", async () => {
    const idA = await semer(a, chefA, "annulee", 50, "Titre du cabinet A");
    const idB = await semer(b, chefB, "annulee", 50, "Titre du cabinet B");
    await purger(a);
    expect((await lire(idA)).anonymise_le).not.toBeNull();
    const l = await lire(idB);
    expect(l.anonymise_le).toBeNull();
    expect(l.parametres).toMatchObject({ titre: "Titre du cabinet B" });
    // Le job de B anonymise celle de B.
    await purger(b);
    expect((await lire(idB)).anonymise_le).not.toBeNull();
  });
});

describe("déclencheur et fonction : seule l'anonymisation prévue", () => {
  it("le déclencheur refuse tout autre UPDATE d'une proposition, terminée ou non (MPG10, MPG11)", async () => {
    const terminee = await semer(a, chefA, "annulee", 1);
    const ouverte = await semer(a, chefA, "proposee", 0);
    const modifier = (sql: string, id: string) => proprietaire((cl) => cl.query(sql, [id]));
    // Anonymiser une proposition OUVERTE : refusé.
    await expect(
      modifier(
        `UPDATE copilote_actions SET parametres = '{}', resume = '${MARQUEUR}', empreinte = '${ZEROS}',
           anonymise_le = now() WHERE id = $1`,
        ouverte,
      ),
    ).rejects.toMatchObject({ code: "MPG11" });
    // Anonymisation incomplète ou avec un autre texte : refusée.
    await expect(
      modifier("UPDATE copilote_actions SET anonymise_le = now() WHERE id = $1", terminee),
    ).rejects.toMatchObject({ code: "MPG11" });
    await expect(
      modifier(
        `UPDATE copilote_actions SET parametres = '{}', resume = 'autre texte', empreinte = '${ZEROS}',
           anonymise_le = now() WHERE id = $1`,
        terminee,
      ),
    ).rejects.toMatchObject({ code: "MPG11" });
    // Anonymisation accompagnée d'un autre changement : refusée.
    await expect(
      modifier(
        `UPDATE copilote_actions SET parametres = '{}', resume = '${MARQUEUR}', empreinte = '${ZEROS}',
           anonymise_le = now(), statut = 'refusee' WHERE id = $1`,
        terminee,
      ),
    ).rejects.toMatchObject({ code: "MPG11" });
    // Le texte d'une proposition terminée ne se réécrit toujours pas.
    await expect(
      modifier("UPDATE copilote_actions SET resume = 'x' WHERE id = $1", terminee),
    ).rejects.toMatchObject({ code: "MPG11" });
    // Une naissance déjà anonymisée est refusée.
    await expect(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO copilote_actions (cabinet_id, utilisateur_id, outil, parametres, empreinte, resume,
             expire_le, anonymise_le)
           VALUES ($1, $2, 'creer_tache', '{}', $3, 'r', now() + interval '5 minutes', now())`,
          [a.cabinetId, chefA.utilisateurId, ZEROS],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPG10" });
    // Anonymisation correcte, puis plus aucune modification (MPG10).
    await modifier(
      `UPDATE copilote_actions SET parametres = '{}', resume = '${MARQUEUR}', empreinte = '${ZEROS}',
         anonymise_le = now() WHERE id = $1`,
      terminee,
    );
    await expect(
      modifier("UPDATE copilote_actions SET anonymise_le = NULL WHERE id = $1", terminee),
    ).rejects.toMatchObject({ code: "MPG10" });
    await expect(
      modifier("UPDATE copilote_actions SET statut = 'refusee' WHERE id = $1", terminee),
    ).rejects.toMatchObject({ code: "MPG10" });
  });

  it("le rôle applicatif ne modifie aucun texte lui-même : la fonction est la seule voie", async () => {
    const id = await semer(a, chefA, "annulee", 60);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE copilote_actions SET anonymise_le = now() WHERE id = $1", [id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE copilote_actions SET parametres = '{}' WHERE id = $1", [id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("la fonction exige un contexte de cabinet et des paramètres valides (30 jours au moins, pas de futur)", async () => {
    // Sans contexte de cabinet : refusée (aucun cabinet courant).
    await expect(
      ctx.db.withoutTenant((db) => db.query("SELECT anonymiser_copilote_actions(now(), 30, 10)")),
    ).rejects.toThrow(/invalides/);
    const appeler = (maintenant: Date, jours: number, limite: number) =>
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("SELECT anonymiser_copilote_actions($1, $2, $3)", [maintenant, jours, limite]),
      );
    await expect(appeler(new Date(), 29, 10)).rejects.toThrow(/invalides/);
    await expect(appeler(new Date(), 30, 0)).rejects.toThrow(/invalides/);
    await expect(appeler(new Date(Date.now() + 3_600_000), 30, 10)).rejects.toThrow(/futur/);
    await expect(appeler(new Date(), 30, 10)).resolves.toBeDefined();
  });
});

describe("planification quotidienne (un job par cabinet concerné et par jour)", () => {
  it("planifie les seuls cabinets ayant une proposition à traiter, une fois par jour", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Copilote Purge C");
    const d = await preparerCabinet(ctx, "Cabinet Copilote Purge D");
    const chefC = await c.avecRoles(["chef_mission"]);
    await semer(c, chefC, "annulee", 40);
    const maintenant = new Date();
    const jobs = (cab: CabinetMissions) =>
      proprietaire(
        async (cl) =>
          (
            await cl.query(
              "SELECT cle, execute_a, statut FROM jobs WHERE cabinet_id = $1 AND type = $2",
              [cab.cabinetId, TYPE_JOB_COPILOTE_PURGE],
            )
          ).rows,
      );
    const n = await ctx.db.withoutTenant((db) => planifierPurgeCopilote(db, maintenant));
    expect(n).toBeGreaterThanOrEqual(1);
    const p = planificationPurgeCopilote(maintenant);
    const dejaC = await jobs(c);
    expect(dejaC).toHaveLength(1);
    expect(dejaC[0]).toMatchObject({ cle: p.cle, statut: "en_attente" });
    expect(p.cle).toMatch(/^copilote_purge:\d{4}-\d{2}-\d{2}$/);
    expect(await jobs(d)).toHaveLength(0);
    // Une seconde planification le même jour ne double rien.
    await ctx.db.withoutTenant((db) => planifierPurgeCopilote(db, maintenant));
    expect(await jobs(c)).toHaveLength(1);
    // La planification vaut pour TOUS les cabinets de la base : on ne laisse aucun job derrière.
    await proprietaire((cl) =>
      cl.query("DELETE FROM jobs WHERE type = $1", [TYPE_JOB_COPILOTE_PURGE]),
    );
  });

  it("la fonction de planification refuse une clé au mauvais format", async () => {
    await expect(
      ctx.db.withoutTenant((db) =>
        db.query("SELECT planifier_purge_copilote('mauvaise', now(), now(), 30)"),
      ),
    ).rejects.toThrow(/invalide/);
  });
});
