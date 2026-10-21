import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  creerMissionSignee,
  preparerCabinet,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Redressement (lot 3a), couche base : migrations 0480 à 0486, avec le rôle APPLICATIF réel
 * (RLS appliquée, privilèges réduits). Un test par règle de SPEC-3a §5.12 : isolation entre
 * cabinets, portail interdit, ajout seul, dossier, versions, seuils, scores, plan, négociation,
 * réalisés, lignes de trésorerie, actions, plafonds, mission clôturée ou dossier clos.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let expert1: string;
let expert2: string;
let consultant: string;
let chef: string;
let directeur: string;
let associe: string;
let associe2: string;
let portailUtilisateur: string;

const LUNDI = "2026-10-05";
const HASH = "a".repeat(64);

interface Jeu {
  mission: string;
  dossier: string;
  correspondance: string;
  urgence: string;
  seuils: string;
  score: string;
  creancier: string;
  creance: string;
  ouverture: string;
  accord: string;
  paiement: string;
  echeance1: string;
  tresoVersion: string;
  ligne: string;
  realise: string;
  action: string;
  actionEvenement: string;
  plan: string;
}

const TABLES = [
  "red_dossiers",
  "red_correspondances",
  "red_urgences",
  "red_seuils_versions",
  "red_scores",
  "red_creanciers",
  "red_creances",
  "red_negociation_evenements",
  "red_echeances",
  "red_tresorerie_versions",
  "red_tresorerie_lignes",
  "red_tresorerie_realises",
  "red_actions",
  "red_action_evenements",
  "red_plan_versions",
] as const;

/** Tables en ajout seul : aucun UPDATE (hors colonnes de publication), aucun DELETE. */
const AJOUT_SEUL = TABLES.filter(
  (t) => !["red_dossiers", "red_creanciers", "red_actions"].includes(t),
);

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "RED base A");
  b = await preparerCabinet(ctx, "RED base B");
  expert1 = (await a.avecRoles(["expert_metier"])).utilisateurId;
  expert2 = (await a.avecRoles(["expert_metier"])).utilisateurId;
  consultant = (await a.avecRoles(["consultant"])).utilisateurId;
  chef = a.chef.utilisateurId;
  directeur = a.directeur.utilisateurId;
  associe = a.associeId;
  associe2 = (await a.avecRoles(["associe"])).utilisateurId;
  // Un compte du portail du client A, inséré à la main (jamais désignable dans le cabinet).
  portailUtilisateur = await ctx.db.withTenant(a.cabinetId, async (db) => {
    const r = await db.query(
      `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
       VALUES ($1, $2, 'Dirigeant du client', ARRAY['client_dirigeant'], 'x') RETURNING id`,
      [a.cabinetId, `portail-${Date.now()}@exemple.test`],
    );
    return r.rows[0].id as string;
  });
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

/** Code SQLSTATE d'un refus de la base (rôle applicatif, RLS du cabinet), « aucun » si accepté. */
async function code(cabinetId: string, fn: (db: Db) => Promise<unknown>): Promise<string> {
  try {
    await ctx.db.withTenant(cabinetId, fn);
  } catch (e) {
    return (e as { code?: string }).code ?? "inconnu";
  }
  return "aucun";
}

async function une<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query(sql, params);
  return r.rows[0] as T;
}

async function nouvelleMission(signee = false): Promise<string> {
  const intitule = `Redressement ${Math.random()}`;
  return signee
    ? (await creerMissionSignee(a, { intitule })).id
    : (await creerMission(a, { intitule })).id;
}

/** Clôture une mission SIGNÉE (le CHECK des missions l'exige) par la connexion propriétaire. */
async function cloturer(missionId: string): Promise<void> {
  await proprietaire((c) =>
    c.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [
      missionId,
    ]),
  );
}

async function creerDossier(
  cabinetId: string,
  missionId: string,
  par = chef,
  extra: Partial<{ secteur: string }> = {},
): Promise<string> {
  return ctx.db.withTenant(cabinetId, async (db) => {
    const m = await une<{ client_id: string; devise: string }>(
      db,
      "SELECT client_id, devise FROM missions WHERE id = $1",
      [missionId],
    );
    const r = await une<{ id: string }>(
      db,
      `INSERT INTO red_dossiers (cabinet_id, mission_id, client_id, intitule, secteur, devise, cree_par)
       VALUES ($1, $2, $3, 'Dossier de test', $4, $5, $6) RETURNING id`,
      [cabinetId, missionId, m.client_id, extra.secteur ?? "general", m.devise, par],
    );
    return r.id;
  });
}

/** Une ligne dans chacune des quinze tables du cabinet A, par le rôle applicatif. */
async function peupler(signee = false): Promise<Jeu> {
  const mission = await nouvelleMission(signee);
  const dossier = await creerDossier(a.cabinetId, mission);
  const cab = a.cabinetId;
  const jeu: Partial<Jeu> = { mission, dossier };
  await ctx.db.withTenant(cab, async (db) => {
    jeu.correspondance = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_correspondances (cabinet_id, dossier_id, version, postes, cree_par)
         VALUES ($1, $2, 1, '{"stocks":{"codes":["BB"],"sans_objet":false}}', $3) RETURNING id`,
        [cab, dossier, chef],
      )
    ).id;
    jeu.urgence = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_urgences (cabinet_id, dossier_id, grille_version, reponses, resultat, voyant, saisi_par)
         VALUES ($1, $2, 1, '{"T1":"oui"}', '{"voyant":"rouge"}', 'rouge', $3) RETURNING id`,
        [cab, dossier, chef],
      )
    ).id;
    jeu.creancier = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
         VALUES ($1, $2, 'Fournisseur Alpha', 'fournisseur', $3) RETURNING id`,
        [cab, dossier, chef],
      )
    ).id;
    jeu.creance = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, interets, date_arrete, saisi_par)
         VALUES ($1, $2, $3, 1, 1000000, 0, '2026-10-01', $4) RETURNING id`,
        [cab, dossier, jeu.creancier, chef],
      )
    ).id;
    jeu.ouverture = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, auteur_id)
         VALUES ($1, $2, $3, 'ouverture', '2026-10-02', $4) RETURNING id`,
        [cab, dossier, jeu.creancier, chef],
      )
    ).id;
    // L'accord et ses échéances naissent dans la même transaction.
    jeu.accord = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, montant, auteur_id)
         VALUES ($1, $2, $3, 'accord', '2026-10-03', 900000, $4) RETURNING id`,
        [cab, dossier, jeu.creancier, chef],
      )
    ).id;
    jeu.echeance1 = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
         VALUES ($1, $2, $3, $4, 1, '2026-11-05', 450000) RETURNING id`,
        [cab, dossier, jeu.creancier, jeu.accord],
      )
    ).id;
    await db.query(
      `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
       VALUES ($1, $2, $3, $4, 2, '2026-12-05', 450000)`,
      [cab, dossier, jeu.creancier, jeu.accord],
    );
    // Trésorerie : version et ligne dans la même transaction.
    jeu.tresoVersion = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
         VALUES ($1, $2, 1, $3, 500000, $4) RETURNING id`,
        [cab, dossier, LUNDI, chef],
      )
    ).id;
    jeu.ligne = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_tresorerie_lignes (cabinet_id, dossier_id, version_id, rang, semaine, sens, categorie, montant, creancier_id, echeance_id)
         VALUES ($1, $2, $3, 1, 5, 'decaissement', 'fournisseurs', 450000, $4, $5) RETURNING id`,
        [cab, dossier, jeu.tresoVersion, jeu.creancier, jeu.echeance1],
      )
    ).id;
  });
  await ctx.db.withTenant(cab, async (db) => {
    jeu.paiement = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, montant, accord_id, echeance_rang, auteur_id)
         VALUES ($1, $2, $3, 'paiement', '2026-11-05', 450000, $4, 1, $5) RETURNING id`,
        [cab, dossier, jeu.creancier, jeu.accord, chef],
      )
    ).id;
    jeu.realise = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_tresorerie_realises (cabinet_id, dossier_id, semaine_debut, flux, solde_constate, saisi_par)
         VALUES ($1, $2, $3, '{"encaissement":{"clients":100000}}', 400000, $4) RETURNING id`,
        [cab, dossier, LUNDI, chef],
      )
    ).id;
    jeu.action = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_actions (cabinet_id, dossier_id, titre, volet, domaine, echeance, responsable_id, cree_par)
         VALUES ($1, $2, 'Relancer les clients', 'quick_win', 'tresorerie', '2026-12-01', $3, $3) RETURNING id`,
        [cab, dossier, chef],
      )
    ).id;
    jeu.actionEvenement = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_action_evenements (cabinet_id, dossier_id, action_id, type, statut_apres, auteur_id)
         VALUES ($1, $2, $3, 'creation', 'a_faire', $4) RETURNING id`,
        [cab, dossier, jeu.action, chef],
      )
    ).id;
    jeu.plan = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
         VALUES ($1, $2, 1, '2026-10-11', '{"actions":[]}', $3, $4) RETURNING id`,
        [cab, dossier, HASH, chef],
      )
    ).id;
  });
  // Seuils : rédigés par un expert, publiés par un autre ; un score les référence.
  const seuilsJson = '{"criteres":{},"niveaux":{"modere":25,"eleve":50,"critique":75}}';
  jeu.seuils = await ctx.db.withTenant(cab, async (db) => {
    const v = await une<{ id: string; version: number }>(
      db,
      `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
       VALUES ($1, 'industrie', coalesce((SELECT max(version) FROM red_seuils_versions WHERE secteur = 'industrie'), 0) + 1, $2, $3)
       RETURNING id, version`,
      [cab, seuilsJson, expert1],
    );
    return v.id;
  });
  await ctx.db.withTenant(cab, async (db) => {
    await db.query(
      `UPDATE red_seuils_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1`,
      [jeu.seuils, expert2],
    );
    jeu.score = (
      await une<{ id: string }>(
        db,
        `INSERT INTO red_scores (cabinet_id, dossier_id, secteur, seuils_version_id, seuils_source, seuils, version_moteur,
                                 date_reference, entrees, resultat, score, niveau, calcule_par)
         VALUES ($1, $2, 'industrie', $3, 'cabinet', $4, 1, '2026-10-11', '{"ratios":{}}', '{"score":40}', 40, 'modere', $5)
         RETURNING id`,
        [cab, dossier, jeu.seuils, seuilsJson, chef],
      )
    ).id;
  });
  return jeu as Jeu;
}

let jeu: Jeu;

/* ------------------------------------------------------------------------------------------ */
/* 1 à 3 : isolation, portail, ajout seul                                                      */
/* ------------------------------------------------------------------------------------------ */

describe("isolation, portail et ajout seul (quinze tables)", () => {
  beforeAll(async () => {
    jeu = await peupler();
  }, 120_000);

  it("le jeu de référence couvre les quinze tables du cabinet A", async () => {
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      for (const t of TABLES) {
        const n = (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
        expect(n, t).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it("1. un autre cabinet ne voit rien et n'insère nulle part (RLS)", async () => {
    await ctx.db.withTenant(b.cabinetId, async (db) => {
      for (const t of TABLES) {
        const n = (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
        expect(n, t).toBe(0);
      }
    });
    // Insertion « au nom » du cabinet A depuis le cabinet B : refusée par WITH CHECK.
    expect(
      await code(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_urgences (cabinet_id, dossier_id, grille_version, reponses, resultat, voyant, saisi_par)
           VALUES ($1, $2, 1, '{}', '{}', 'vert', $3)`,
          [a.cabinetId, jeu.dossier, chef],
        ),
      ),
    ).toBe("42501");
    // Clé étrangère composite : une ligne de B ne vise pas le dossier de A.
    expect(
      await code(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_urgences (cabinet_id, dossier_id, grille_version, reponses, resultat, voyant, saisi_par)
           VALUES ($1, $2, 1, '{}', '{}', 'vert', $3)`,
          [b.cabinetId, jeu.dossier, b.associeId],
        ),
      ),
    ).toBe("23503");
    // Un dossier du cabinet B ne peut pas viser la mission du cabinet A (le déclencheur ne la voit
    // pas : MPZ02 ; sans lui, la clé étrangère composite : 23503).
    expect(["MPZ02", "23503"]).toContain(
      await code(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_dossiers (cabinet_id, mission_id, client_id, intitule, devise, cree_par)
           VALUES ($1, $2, $3, 'Intrus', 'XOF', $4)`,
          [b.cabinetId, jeu.mission, b.clientId, b.associeId],
        ),
      ),
    );
    // Aucune modification d'une ligne d'un autre cabinet.
    await ctx.db.withTenant(b.cabinetId, async (db) => {
      const r = await db.query("UPDATE red_dossiers SET intitule = 'Pirate' WHERE id = $1", [
        jeu.dossier,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("2. dans une transaction du portail, aucune des quinze tables n'est lisible ni modifiable", async () => {
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      await db.query("SELECT set_config('app.portail_client_id', $1, true)", [a.clientId]);
      for (const t of TABLES) {
        const n = (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
        expect(n, t).toBe(0);
      }
    });
    const portail = (db: Db) =>
      db.query("SELECT set_config('app.portail_client_id', $1, true)", [a.clientId]);
    const insertions: Record<string, [string, unknown[]]> = {
      red_dossiers: [
        `INSERT INTO red_dossiers (cabinet_id, mission_id, client_id, intitule, devise, cree_par)
         VALUES ($1, $2, $3, 'Portail', 'XOF', $4)`,
        [a.cabinetId, jeu.mission, a.clientId, chef],
      ],
      red_correspondances: [
        `INSERT INTO red_correspondances (cabinet_id, dossier_id, version, postes, cree_par)
         VALUES ($1, $2, 1, '{}', $3)`,
        [a.cabinetId, jeu.dossier, chef],
      ],
      red_urgences: [
        `INSERT INTO red_urgences (cabinet_id, dossier_id, grille_version, reponses, resultat, voyant, saisi_par)
         VALUES ($1, $2, 1, '{}', '{}', 'vert', $3)`,
        [a.cabinetId, jeu.dossier, chef],
      ],
      red_seuils_versions: [
        `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
         VALUES ($1, 'btp', 1, '{}', $2)`,
        [a.cabinetId, chef],
      ],
      red_creanciers: [
        `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
         VALUES ($1, $2, 'Portail', 'autre', $3)`,
        [a.cabinetId, jeu.dossier, chef],
      ],
      red_actions: [
        `INSERT INTO red_actions (cabinet_id, dossier_id, titre, volet, domaine, echeance, responsable_id, cree_par)
         VALUES ($1, $2, 'Portail', 'quick_win', 'tresorerie', '2026-12-01', $3, $3)`,
        [a.cabinetId, jeu.dossier, chef],
      ],
      red_plan_versions: [
        `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
         VALUES ($1, $2, 1, '2026-10-11', '{}', $3, $4)`,
        [a.cabinetId, jeu.dossier, HASH, chef],
      ],
    };
    for (const [t, [sql, params]] of Object.entries(insertions)) {
      const c = await code(a.cabinetId, async (db) => {
        await portail(db);
        await db.query(sql, params);
      });
      // Sous la RLS du portail, les déclencheurs ne voient rien : seule la politique
      // `portail_interdit` refuse (42501) ; le dossier, lui, ne voit pas sa mission (MPZ02).
      expect(c, t).toBe(t === "red_dossiers" ? "MPZ02" : "42501");
    }
    // Modification : aucune ligne atteinte.
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      await portail(db);
      const r = await db.query("UPDATE red_dossiers SET intitule = 'Pirate' WHERE id = $1", [
        jeu.dossier,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("3. UPDATE et DELETE refusés sur chaque table en ajout seul ; DELETE refusé partout", async () => {
    for (const t of AJOUT_SEUL) {
      // Rôle applicatif : privilège retiré (ou déclencheur MPZ01).
      const maj = await code(a.cabinetId, (db) =>
        db.query(`UPDATE ${t} SET cabinet_id = cabinet_id WHERE true`),
      );
      expect(["42501", "MPZ01"], `UPDATE ${t} : ${maj}`).toContain(maj);
      // Propriétaire (privilèges complets) : le déclencheur dit MPZ01.
      const proprio = await proprietaire(async (c) => {
        try {
          await c.query(`UPDATE ${t} SET cabinet_id = cabinet_id`);
          return "aucun";
        } catch (e) {
          return (e as { code?: string }).code ?? "inconnu";
        }
      });
      // Les tables à GRANT UPDATE par colonnes ont leur propre déclencheur (MPZ06 : transition).
      expect(["MPZ01", "MPZ06"], `UPDATE propriétaire ${t} : ${proprio}`).toContain(proprio);
    }
    for (const t of TABLES) {
      const sup = await code(a.cabinetId, (db) => db.query(`DELETE FROM ${t} WHERE true`));
      expect(["42501", "MPZ01"], `DELETE ${t} : ${sup}`).toContain(sup);
    }
    const proprioSup = await proprietaire(async (c) => {
      const codes: string[] = [];
      for (const t of AJOUT_SEUL) {
        try {
          await c.query(`DELETE FROM ${t}`);
          codes.push("aucun");
        } catch (e) {
          codes.push((e as { code?: string }).code ?? "inconnu");
        }
      }
      return codes;
    });
    expect(new Set(proprioSup)).toEqual(new Set(["MPZ01"]));
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 4 : dossier                                                                                 */
/* ------------------------------------------------------------------------------------------ */

describe("dossier de redressement", () => {
  it("4. client incohérent (MPZ02), mission clôturée (MPZ03), un dossier par mission (23505)", async () => {
    const mission = await nouvelleMission();
    // Client d'une autre mission : refusé.
    const autreClient = await ctx.db.withTenant(a.cabinetId, async (db) => {
      const r = await une<{ id: string }>(
        db,
        "INSERT INTO clients (cabinet_id, raison_sociale) VALUES ($1, 'Autre client') RETURNING id",
        [a.cabinetId],
      );
      return r.id;
    });
    expect(
      await code(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_dossiers (cabinet_id, mission_id, client_id, intitule, devise, cree_par)
           VALUES ($1, $2, $3, 'Incohérent', 'XOF', $4)`,
          [a.cabinetId, mission, autreClient, chef],
        ),
      ),
    ).toBe("MPZ02");
    // Devise différente de celle de la mission : refusée.
    expect(
      await code(a.cabinetId, async (db) => {
        const m = await une<{ client_id: string }>(
          db,
          "SELECT client_id FROM missions WHERE id = $1",
          [mission],
        );
        await db.query(
          `INSERT INTO red_dossiers (cabinet_id, mission_id, client_id, intitule, devise, cree_par)
           VALUES ($1, $2, $3, 'Devise', 'USD', $4)`,
          [a.cabinetId, mission, m.client_id, chef],
        );
      }),
    ).toBe("MPZ02");
    // Statut initial autre que « ouvert » : refusé.
    expect(
      await code(a.cabinetId, async (db) => {
        const m = await une<{ client_id: string; devise: string }>(
          db,
          "SELECT client_id, devise FROM missions WHERE id = $1",
          [mission],
        );
        await db.query(
          `INSERT INTO red_dossiers (cabinet_id, mission_id, client_id, intitule, devise, statut, cree_par)
           VALUES ($1, $2, $3, 'Statut', $4, 'diagnostic', $5)`,
          [a.cabinetId, mission, m.client_id, m.devise, chef],
        );
      }),
    ).toBe("MPZ06");
    const dossier = await creerDossier(a.cabinetId, mission);
    // Deuxième dossier pour la même mission.
    expect(await code(a.cabinetId, () => creerDossier(a.cabinetId, mission))).toBe("23505");
    expect(dossier).toBeTruthy();
    // Mission clôturée : création refusée.
    const cloturee = await nouvelleMission(true);
    await cloturer(cloturee);
    expect(
      await code(a.cabinetId, async (db) => {
        const m = await une<{ client_id: string; devise: string }>(
          db,
          "SELECT client_id, devise FROM missions WHERE id = $1",
          [cloturee],
        );
        await db.query(
          `INSERT INTO red_dossiers (cabinet_id, mission_id, client_id, intitule, devise, cree_par)
           VALUES ($1, $2, $3, 'Clôturée', $4, $5)`,
          [a.cabinetId, cloturee, m.client_id, m.devise, chef],
        );
      }),
    ).toBe("MPZ03");
  });

  it("4. champs figés (MPZ04), transitions (MPZ06), plan_valide exige une version validée", async () => {
    const mission = await nouvelleMission();
    const d = await creerDossier(a.cabinetId, mission);
    // Intitulé et secteur restent modifiables.
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE red_dossiers SET intitule = 'Nouveau', secteur = 'btp' WHERE id = $1", [d]),
    );
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_dossiers SET devise = 'EUR' WHERE id = $1", [d]),
      ),
    ).toBe("MPZ04");
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_dossiers SET cree_par = $2 WHERE id = $1", [d, consultant]),
      ),
    ).toBe("MPZ04");
    const autreMission = await nouvelleMission();
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_dossiers SET mission_id = $2 WHERE id = $1", [d, autreMission]),
      ),
    ).toBe("MPZ04");
    // Transitions.
    for (const vers of ["mise_en_oeuvre", "plan_valide"]) {
      expect(
        await code(a.cabinetId, (db) =>
          db.query("UPDATE red_dossiers SET statut = $2 WHERE id = $1", [d, vers]),
        ),
        `ouvert vers ${vers}`,
      ).toBe("MPZ06");
    }
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE red_dossiers SET statut = 'diagnostic' WHERE id = $1", [d]),
    );
    // plan_valide sans version de plan validée.
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_dossiers SET statut = 'plan_valide' WHERE id = $1", [d]),
      ),
    ).toBe("MPZ06");
    // Avec une version brouillon seulement : toujours refusé.
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
         VALUES ($1, $2, 1, '2026-10-11', '{}', $3, $4)`,
        [a.cabinetId, d, HASH, chef],
      ),
    );
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_dossiers SET statut = 'plan_valide' WHERE id = $1", [d]),
      ),
    ).toBe("MPZ06");
    // Version validée par un autre que le créateur : le dossier peut passer à plan_valide.
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      await db.query(
        `UPDATE red_plan_versions SET statut = 'valide', valide_par = $2, valide_le = now()
         WHERE dossier_id = $1`,
        [d, directeur],
      );
      await db.query("UPDATE red_dossiers SET statut = 'plan_valide' WHERE id = $1", [d]);
      await db.query("UPDATE red_dossiers SET statut = 'mise_en_oeuvre' WHERE id = $1", [d]);
    });
    // Clôture : tous les champs ensemble, sinon CHECK ; un dossier clos est terminal.
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_dossiers SET statut = 'clos' WHERE id = $1", [d]),
      ),
    ).toBe("23514");
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        `UPDATE red_dossiers SET statut = 'clos', clos_le = now(), clos_par = $2,
           motif_cloture = 'Objectifs atteints' WHERE id = $1`,
        [d, associe],
      ),
    );
    expect(
      await code(a.cabinetId, (db) =>
        db.query(
          `UPDATE red_dossiers SET statut = 'diagnostic', clos_le = NULL, clos_par = NULL,
             motif_cloture = NULL WHERE id = $1`,
          [d],
        ),
      ),
    ).toBe("MPZ06");
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_dossiers SET intitule = 'Encore' WHERE id = $1", [d]),
      ),
    ).toBe("MPZ03");
  });

  it("4. mission clôturée : le dossier existant devient en lecture seule (MPZ03)", async () => {
    const mission = await nouvelleMission(true);
    const d = await creerDossier(a.cabinetId, mission);
    await cloturer(mission);
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_dossiers SET intitule = 'Trop tard' WHERE id = $1", [d]),
      ),
    ).toBe("MPZ03");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 5 : versions consécutives                                                                   */
/* ------------------------------------------------------------------------------------------ */

describe("versions consécutives", () => {
  it("5. correspondances, trésorerie, plan : une version saute, refusée (MPZ05) ; seuils par secteur", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    const corr = (version: number) => (db: Db) =>
      db.query(
        `INSERT INTO red_correspondances (cabinet_id, dossier_id, version, postes, cree_par)
         VALUES ($1, $2, $3, '{}', $4)`,
        [cab, d, version, chef],
      );
    expect(await code(cab, corr(2))).toBe("MPZ05");
    expect(await code(cab, corr(1))).toBe("aucun");
    expect(await code(cab, corr(1))).toBe("MPZ05");
    expect(await code(cab, corr(2))).toBe("aucun");
    const treso = (version: number) => (db: Db) =>
      db.query(
        `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
         VALUES ($1, $2, $3, $4, 0, $5)`,
        [cab, d, version, LUNDI, chef],
      );
    expect(await code(cab, treso(2))).toBe("MPZ05");
    expect(await code(cab, treso(1))).toBe("aucun");
    const plan = (version: number) => (db: Db) =>
      db.query(
        `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
         VALUES ($1, $2, $3, '2026-10-11', '{}', $4, $5)`,
        [cab, d, version, HASH, chef],
      );
    expect(await code(cab, plan(3))).toBe("MPZ05");
    expect(await code(cab, plan(1))).toBe("aucun");
    // Créances : par créancier.
    await ctx.db.withTenant(cab, async (db) => {
      const c = await une<{ id: string }>(
        db,
        `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
         VALUES ($1, $2, 'Versions', 'banque', $3) RETURNING id`,
        [cab, d, chef],
      );
      await db.query(
        `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, date_arrete, saisi_par)
         VALUES ($1, $2, $3, 1, 10, '2026-10-01', $4)`,
        [cab, d, c.id, chef],
      );
      await db.query("SAVEPOINT s");
      await expect(
        db.query(
          `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, date_arrete, saisi_par)
           VALUES ($1, $2, $3, 3, 10, '2026-10-01', $4)`,
          [cab, d, c.id, chef],
        ),
      ).rejects.toMatchObject({ code: "MPZ05" });
    });
    // Seuils : par (cabinet, secteur) ; un autre secteur repart de 1.
    const seuils = (secteur: string, version: number) => (db: Db) =>
      db.query(
        `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
         VALUES ($1, $2, $3, '{}', $4)`,
        [cab, secteur, version, expert1],
      );
    expect(await code(cab, seuils("agriculture", 2))).toBe("MPZ05");
    expect(await code(cab, seuils("agriculture", 1))).toBe("aucun");
    expect(await code(cab, seuils("services", 1))).toBe("aucun");
    expect(await code(cab, seuils("agriculture", 1))).toBe("MPZ05");
    // Les seuils d'un autre cabinet n'entrent pas dans la numérotation.
    expect(
      await code(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
           VALUES ($1, 'agriculture', 1, '{}', $2)`,
          [b.cabinetId, b.associeId],
        ),
      ),
    ).toBe("aucun");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 6 : seuils                                                                                  */
/* ------------------------------------------------------------------------------------------ */

describe("seuils : publication", () => {
  async function brouillon(secteur: string, auteur: string, seuils = "{}"): Promise<string> {
    return ctx.db.withTenant(a.cabinetId, async (db) => {
      const r = await une<{ id: string }>(
        db,
        `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
         VALUES ($1, $2, coalesce((SELECT max(version) FROM red_seuils_versions WHERE secteur = $2), 0) + 1, $3, $4)
         RETURNING id`,
        [a.cabinetId, secteur, seuils, auteur],
      );
      return r.id;
    });
  }
  const publier = (id: string, par: string) => (db: Db) =>
    db.query(
      `UPDATE red_seuils_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1`,
      [id, par],
    );

  it("6. publication par l'auteur refusée (MPZ07), par un autre expert acceptée", async () => {
    const id = await brouillon("commerce", expert1);
    expect(await code(a.cabinetId, publier(id, expert1))).toBe("MPZ07");
    expect(await code(a.cabinetId, publier(id, expert2))).toBe("aucun");
  });

  it("6. un associé auteur peut publier ; un consultant ne publie pas (MPZ07)", async () => {
    const id = await brouillon("btp", associe);
    expect(await code(a.cabinetId, publier(id, consultant))).toBe("MPZ07");
    expect(await code(a.cabinetId, publier(id, chef))).toBe("MPZ07");
    expect(await code(a.cabinetId, publier(id, associe))).toBe("aucun");
  });

  it("6. une version qui n'est pas la dernière ne se publie pas (MPZ05) ; contenu figé (MPZ04) ; un publié ne bouge plus", async () => {
    const recente = await brouillon("industrie", expert1);
    // Un seul brouillon à la fois par secteur : un second est refusé (MPZ06) tant que le premier n'est pas publié.
    expect(
      await code(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
           VALUES ($1, 'industrie', (SELECT max(version) + 1 FROM red_seuils_versions WHERE secteur = 'industrie'), '{}', $2)`,
          [a.cabinetId, expert1],
        ),
      ),
    ).toBe("MPZ06");
    // Contenu modifié à la publication : le rôle applicatif n'a pas le droit (colonne), le
    // propriétaire bute sur le déclencheur.
    expect(
      await code(a.cabinetId, (db) =>
        db.query(
          `UPDATE red_seuils_versions SET seuils = '{"x":1}', statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1`,
          [recente, expert2],
        ),
      ),
    ).toBe("42501");
    const proprio = await proprietaire(async (c) => {
      try {
        await c.query(
          `UPDATE red_seuils_versions SET seuils = '{"x":1}', statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1`,
          [recente, expert2],
        );
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(proprio).toBe("MPZ04");
    expect(await code(a.cabinetId, publier(recente, expert2))).toBe("aucun");
    // Une version publiée ne se republie pas, ne se rouvre pas.
    expect(await code(a.cabinetId, publier(recente, associe))).toBe("MPZ06");
    expect(
      await code(a.cabinetId, (db) =>
        db.query(
          `UPDATE red_seuils_versions SET statut = 'brouillon', publiee_par = NULL, publiee_le = NULL WHERE id = $1`,
          [recente],
        ),
      ),
    ).toBe("MPZ06");
  });

  it("6. publiee_par est un utilisateur actif ; un brouillon naît brouillon", async () => {
    const id = await brouillon("general", expert1);
    const inactif = (await a.avecRoles(["expert_metier"])).utilisateurId;
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [inactif]),
    );
    expect(await code(a.cabinetId, publier(id, inactif))).toBe("MPZ07");
    expect(
      await code(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, statut, publiee_par, publiee_le, cree_par)
           VALUES ($1, 'agriculture', 99, '{}', 'publiee', $2, now(), $3)`,
          [a.cabinetId, expert2, expert1],
        ),
      ),
    ).toBe("MPZ06");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 7 : scores                                                                                  */
/* ------------------------------------------------------------------------------------------ */

describe("scores d'alerte", () => {
  it("7. seuils non publiés, d'un autre secteur ou différents refusés (MPZ02) ; CHECK du niveau", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    const brouillon = await ctx.db.withTenant(cab, async (db) => {
      const r = await une<{ id: string }>(
        db,
        `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
         VALUES ($1, 'commerce', coalesce((SELECT max(version) FROM red_seuils_versions WHERE secteur = 'commerce'), 0) + 1, '{"a":1}', $2)
         RETURNING id`,
        [cab, expert1],
      );
      return r.id;
    });
    const insererScore =
      (over: {
        seuilsId: string | null;
        secteur?: string;
        seuils?: string;
        score?: number | null;
        niveau?: string;
        source?: string;
      }) =>
      (db: Db) =>
        db.query(
          `INSERT INTO red_scores (cabinet_id, dossier_id, secteur, seuils_version_id, seuils_source, seuils, version_moteur,
                                   date_reference, entrees, resultat, score, niveau, calcule_par)
           VALUES ($1, $2, $3, $4, $5, $6, 1, '2026-10-11', '{}', '{}', $7, $8, $9)`,
          [
            cab,
            d,
            over.secteur ?? "commerce",
            over.seuilsId,
            over.source ?? (over.seuilsId ? "cabinet" : "defaut_moteur"),
            over.seuils ?? '{"a":1}',
            over.score === undefined ? 10 : over.score,
            over.niveau ?? "faible",
            chef,
          ],
        );
    // Brouillon : refusé.
    expect(await code(cab, insererScore({ seuilsId: brouillon }))).toBe("MPZ02");
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `UPDATE red_seuils_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1`,
        [brouillon, expert2],
      ),
    );
    // Autre secteur : refusé. Seuils différents : refusé. Identiques : accepté.
    expect(await code(cab, insererScore({ seuilsId: brouillon, secteur: "services" }))).toBe(
      "MPZ02",
    );
    expect(await code(cab, insererScore({ seuilsId: brouillon, seuils: '{"a":2}' }))).toBe("MPZ02");
    expect(await code(cab, insererScore({ seuilsId: brouillon }))).toBe("aucun");
    // Seuils du moteur : sans version ; source et version doivent concorder (CHECK).
    expect(await code(cab, insererScore({ seuilsId: null }))).toBe("aucun");
    expect(await code(cab, insererScore({ seuilsId: null, source: "cabinet" }))).toBe("23514");
    // « insuffisant » sans score, jamais avec un score ; un score exige un autre niveau.
    expect(
      await code(cab, insererScore({ seuilsId: null, niveau: "insuffisant", score: null })),
    ).toBe("aucun");
    expect(
      await code(cab, insererScore({ seuilsId: null, niveau: "insuffisant", score: 12 })),
    ).toBe("23514");
    expect(await code(cab, insererScore({ seuilsId: null, niveau: "eleve", score: null }))).toBe(
      "23514",
    );
    expect(await code(cab, insererScore({ seuilsId: null, score: 101 }))).toBe("23514");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 8 : plan                                                                                    */
/* ------------------------------------------------------------------------------------------ */

describe("versions de plan : validation", () => {
  async function versionPlan(d: string, par: string): Promise<string> {
    return ctx.db.withTenant(a.cabinetId, async (db) => {
      const r = await une<{ id: string }>(
        db,
        `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
         VALUES ($1, $2, coalesce((SELECT max(version) FROM red_plan_versions WHERE dossier_id = $2), 0) + 1,
                 '2026-10-11', '{"actions":[]}', $3, $4) RETURNING id`,
        [a.cabinetId, d, HASH, par],
      );
      return r.id;
    });
  }
  const valider = (id: string, par: string) => (db: Db) =>
    db.query(
      `UPDATE red_plan_versions SET statut = 'valide', valide_par = $2, valide_le = now(),
         motif_validation = 'ok' WHERE id = $1`,
      [id, par],
    );

  it("8. le créateur ne valide pas (MPZ07) sauf associé ; un chef ou un consultant ne valident pas ; un directeur autre, oui", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const v1 = await versionPlan(d, directeur);
    expect(await code(a.cabinetId, valider(v1, directeur))).toBe("MPZ07");
    expect(await code(a.cabinetId, valider(v1, chef))).toBe("MPZ07");
    expect(await code(a.cabinetId, valider(v1, consultant))).toBe("MPZ07");
    expect(await code(a.cabinetId, valider(v1, expert1))).toBe("MPZ07");
    // 0492 : un associé qui n'est pas le directeur de la mission ne valide pas non plus.
    expect(await code(a.cabinetId, valider(v1, associe))).toBe("MPZ07");
    // Associé directeur de la mission ET créateur : dispensé de la séparation des tâches.
    const missionAssocie = (
      await creerMission(a, {
        intitule: `Associé directeur ${Math.random()}`,
        directeur_id: associe2,
      })
    ).id;
    const d3 = await creerDossier(a.cabinetId, missionAssocie);
    const v2 = await versionPlan(d3, associe2);
    expect(await code(a.cabinetId, valider(v2, associe2))).toBe("aucun");
    // Une version validée ne bouge plus.
    expect(await code(a.cabinetId, valider(v2, associe))).toBe("MPZ06");
  });

  it("8. une version obsolète ne se valide pas (MPZ05) ; le contenu est figé (MPZ04)", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const v1 = await versionPlan(d, chef);
    const v2 = await versionPlan(d, chef);
    expect(await code(a.cabinetId, valider(v1, directeur))).toBe("MPZ05");
    expect(await code(a.cabinetId, valider(v2, directeur))).toBe("aucun");
    // Contenu : colonne non accordée au rôle applicatif ; déclencheur côté propriétaire.
    const d2 = await creerDossier(a.cabinetId, await nouvelleMission());
    const v = await versionPlan(d2, chef);
    expect(
      await code(a.cabinetId, (db) =>
        db.query(`UPDATE red_plan_versions SET contenu = '{"x":1}' WHERE id = $1`, [v]),
      ),
    ).toBe("42501");
    const proprio = await proprietaire(async (c) => {
      try {
        await c.query(
          `UPDATE red_plan_versions SET contenu = '{"x":1}', statut = 'valide', valide_par = $2, valide_le = now() WHERE id = $1`,
          [v, directeur],
        );
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(proprio).toBe("MPZ04");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 9 : négociation                                                                             */
/* ------------------------------------------------------------------------------------------ */

describe("négociation, accords et échéances", () => {
  async function creancier(d: string, nom: string): Promise<string> {
    return ctx.db.withTenant(a.cabinetId, async (db) => {
      const r = await une<{ id: string }>(
        db,
        `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
         VALUES ($1, $2, $3, 'banque', $4) RETURNING id`,
        [a.cabinetId, d, nom, chef],
      );
      return r.id;
    });
  }
  const evenement =
    (
      d: string,
      c: string,
      type: string,
      montant: number | null,
      accord: string | null = null,
      rang: number | null = null,
    ) =>
    (db: Db) =>
      db.query(
        `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, montant, accord_id, echeance_rang, auteur_id)
         VALUES ($1, $2, $3, $4, '2026-10-10', $5, $6, $7, $8) RETURNING id`,
        [a.cabinetId, d, c, type, montant, accord, rang, chef],
      );

  it("9. deuxième accord en vigueur, paiement d'un autre créancier, paiement ou rupture après rupture : refusés (MPZ09)", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const c1 = await creancier(d, "Banque 1");
    const c2 = await creancier(d, "Banque 2");
    let accord1 = "";
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      accord1 = (await evenement(d, c1, "accord", 1000)(db)).rows[0].id;
    });
    // Deuxième accord pour le même créancier.
    expect(await code(a.cabinetId, evenement(d, c1, "accord", 500))).toBe("MPZ09");
    // Paiement d'un autre créancier sur cet accord.
    expect(await code(a.cabinetId, evenement(d, c2, "paiement", 100, accord1))).toBe("MPZ09");
    // Paiement d'un accord inexistant (un événement qui n'est pas un accord).
    let note = "";
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      note = (await evenement(d, c1, "note", null)(db)).rows[0].id;
    });
    expect(await code(a.cabinetId, evenement(d, c1, "paiement", 100, note))).toBe("MPZ09");
    // Échéance inexistante dans l'accord.
    expect(await code(a.cabinetId, evenement(d, c1, "paiement", 100, accord1, 3))).toBe("MPZ09");
    // Paiement nominal, puis rupture, puis plus rien sur cet accord.
    expect(await code(a.cabinetId, evenement(d, c1, "paiement", 100, accord1))).toBe("aucun");
    expect(await code(a.cabinetId, evenement(d, c1, "rupture", null, accord1))).toBe("aucun");
    expect(await code(a.cabinetId, evenement(d, c1, "paiement", 100, accord1))).toBe("MPZ09");
    expect(await code(a.cabinetId, evenement(d, c1, "rupture", null, accord1))).toBe("MPZ09");
    // Après rupture, un nouvel accord est possible.
    expect(await code(a.cabinetId, evenement(d, c1, "accord", 700))).toBe("aucun");
    // CHECK par type : accord sans montant, rupture avec montant, ouverture avec accord.
    const c3 = await creancier(d, "Banque 3");
    // (Les déclencheurs précèdent les CHECK : ces cas passent la cohérence de la négociation.)
    expect(await code(a.cabinetId, evenement(d, c3, "accord", null))).toBe("23514");
    expect(await code(a.cabinetId, evenement(d, c3, "accord", 0))).toBe("23514");
    expect(await code(a.cabinetId, evenement(d, c3, "ouverture", null, accord1))).toBe("23514");
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      const accord3 = (await evenement(d, c3, "accord", 400)(db)).rows[0].id;
      await db.query("SAVEPOINT s");
      await expect(evenement(d, c3, "rupture", 5, accord3)(db)).rejects.toMatchObject({
        code: "23514",
      });
    });
  });

  it("9. une échéance insérée hors de la transaction de l'accord est refusée ; elle doit viser un accord du même créancier", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const c1 = await creancier(d, "Banque A");
    const c2 = await creancier(d, "Banque B");
    let accord = "";
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      accord = (await evenement(d, c1, "accord", 1000)(db)).rows[0].id;
      // Même transaction, créancier de l'accord : acceptée.
      await db.query(
        `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
         VALUES ($1, $2, $3, $4, 1, '2026-12-01', 1000)`,
        [a.cabinetId, d, c1, accord],
      );
    });
    const echeance = (creancierId: string, rang: number) => (db: Db) =>
      db.query(
        `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
         VALUES ($1, $2, $3, $4, $5, '2027-01-01', 100)`,
        [a.cabinetId, d, creancierId, accord, rang],
      );
    // Transaction suivante : refusée.
    expect(await code(a.cabinetId, echeance(c1, 2))).toBe("MPZ09");
    // Même transaction que l'accord d'un autre créancier : refusée.
    expect(
      await code(a.cabinetId, async (db) => {
        const accord2 = (await evenement(d, c2, "accord", 500)(db)).rows[0].id;
        await db.query(
          `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
           VALUES ($1, $2, $3, $4, 1, '2027-01-01', 500)`,
          [a.cabinetId, d, c1, accord2],
        );
      }),
    ).toBe("MPZ09");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 10, 11 : trésorerie                                                                         */
/* ------------------------------------------------------------------------------------------ */

describe("trésorerie : réalisés et lignes", () => {
  it("10. remplacement d'une ligne non courante (MPZ08), 12e ligne d'une semaine (MPZ11), date non lundi (CHECK)", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    const realise = (semaine: string, remplace: string | null) => (db: Db) =>
      db.query(
        `INSERT INTO red_tresorerie_realises (cabinet_id, dossier_id, semaine_debut, flux, remplace_id, saisi_par)
         VALUES ($1, $2, $3, '{}', $4, $5) RETURNING id`,
        [cab, d, semaine, remplace, chef],
      );
    // Date non lundi.
    expect(await code(cab, realise("2026-10-06", null))).toBe("23514");
    // Initiale ; une initiale « bis » sans remplacer la courante est refusée.
    let r1 = "";
    await ctx.db.withTenant(cab, async (db) => {
      r1 = (await realise(LUNDI, null)(db)).rows[0].id;
    });
    expect(await code(cab, realise(LUNDI, null))).toBe("MPZ08");
    // Corrections successives : chacune remplace la courante.
    let courante = r1;
    const chaine = [r1];
    for (let i = 0; i < 10; i += 1) {
      await ctx.db.withTenant(cab, async (db) => {
        courante = (await realise(LUNDI, courante)(db)).rows[0].id;
      });
      chaine.push(courante);
    }
    // 12e ligne : plus de 10 corrections.
    expect(await code(cab, realise(LUNDI, courante))).toBe("MPZ11");
    // Remplacer une ligne qui n'est plus courante : MPZ08.
    expect(await code(cab, realise(LUNDI, r1))).toBe("MPZ08");
    // Une autre semaine est indépendante ; remplacer une ligne d'une autre semaine : MPZ08.
    expect(await code(cab, realise("2026-10-12", courante))).toBe("MPZ08");
    expect(await code(cab, realise("2026-10-12", null))).toBe("aucun");
  });

  it("11. lignes : hors transaction de la version (MPZ01), catégorie incompatible (CHECK), échéance d'un autre créancier (MPZ02)", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    let version = "";
    await ctx.db.withTenant(cab, async (db) => {
      version = (
        await une<{ id: string }>(
          db,
          `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
           VALUES ($1, $2, 1, $3, 0, $4) RETURNING id`,
          [cab, d, LUNDI, chef],
        )
      ).id;
    });
    const ligne =
      (
        sens: string,
        categorie: string,
        extra: { creancier?: string | null; echeance?: string | null } = {},
      ) =>
      (db: Db) =>
        db.query(
          `INSERT INTO red_tresorerie_lignes (cabinet_id, dossier_id, version_id, rang, semaine, sens, categorie, montant, creancier_id, echeance_id)
           VALUES ($1, $2, $3, 1, 1, $4, $5, 100, $6, $7)`,
          [cab, d, version, sens, categorie, extra.creancier ?? null, extra.echeance ?? null],
        );
    // La version vient d'une transaction antérieure : refusé.
    expect(await code(cab, ligne("encaissement", "clients"))).toBe("MPZ01");
    // Dans la transaction de la version : catégorie incompatible avec le sens, puis valide.
    const c1 = await ctx.db.withTenant(cab, async (db) => {
      const v = await une<{ id: string }>(
        db,
        `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
         VALUES ($1, $2, 2, $3, 0, $4) RETURNING id`,
        [cab, d, LUNDI, chef],
      );
      version = v.id;
      await db.query("SAVEPOINT s1");
      await expect(ligne("encaissement", "salaires")(db)).rejects.toMatchObject({ code: "23514" });
      await db.query("ROLLBACK TO SAVEPOINT s1");
      await expect(ligne("decaissement", "clients")(db)).rejects.toMatchObject({ code: "23514" });
      await db.query("ROLLBACK TO SAVEPOINT s1");
      await ligne("encaissement", "clients")(db);
      return v.id;
    });
    expect(c1).toBeTruthy();
    // Échéance d'un autre créancier : accord pour c1, ligne rattachée à c2.
    expect(
      await code(cab, async (db) => {
        const cr = async (nom: string) =>
          (
            await une<{ id: string }>(
              db,
              `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
               VALUES ($1, $2, $3, 'banque', $4) RETURNING id`,
              [cab, d, nom, chef],
            )
          ).id;
        const x = await cr("X");
        const y = await cr("Y");
        const accord = (
          await une<{ id: string }>(
            db,
            `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, montant, auteur_id)
             VALUES ($1, $2, $3, 'accord', '2026-10-10', 100, $4) RETURNING id`,
            [cab, d, x, chef],
          )
        ).id;
        const ech = (
          await une<{ id: string }>(
            db,
            `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
             VALUES ($1, $2, $3, $4, 1, '2026-12-01', 100) RETURNING id`,
            [cab, d, x, accord],
          )
        ).id;
        const v = (
          await une<{ id: string }>(
            db,
            `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
             VALUES ($1, $2, 3, $3, 0, $4) RETURNING id`,
            [cab, d, LUNDI, chef],
          )
        ).id;
        await db.query(
          `INSERT INTO red_tresorerie_lignes (cabinet_id, dossier_id, version_id, rang, semaine, sens, categorie, montant, creancier_id, echeance_id)
           VALUES ($1, $2, $3, 1, 1, 'decaissement', 'service_dette', 100, $4, $5)`,
          [cab, d, v, y, ech],
        );
      }),
    ).toBe("MPZ02");
  });

  it("11. versions de trésorerie : début un lundi, solde négatif admis, seuil de tension non négatif", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    const v = (version: number, debut: string, solde: number, seuil: number) => (db: Db) =>
      db.query(
        `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, seuil_tension, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cab, d, version, debut, solde, seuil, chef],
      );
    expect(await code(cab, v(1, "2026-10-06", 0, 0))).toBe("23514");
    expect(await code(cab, v(1, LUNDI, 0, -1))).toBe("23514");
    expect(await code(cab, v(1, LUNDI, -5000, 0))).toBe("aucun");
    expect(await code(cab, v(2, LUNDI, 10 ** 13 + 1, 0))).toBe("23514");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 12 : actions                                                                                */
/* ------------------------------------------------------------------------------------------ */

describe("actions du kanban", () => {
  const action =
    (d: string, over: Partial<Record<string, unknown>> = {}) =>
    (db: Db) =>
      db.query(
        `INSERT INTO red_actions (cabinet_id, dossier_id, titre, volet, domaine, echeance, responsable_id, cree_par, statut, motif)
       VALUES ($1, $2, 'Action', 'quick_win', 'tresorerie', '2026-12-01', $3, $4, $5, $6) RETURNING id, numero`,
        [
          a.cabinetId,
          d,
          over.responsable ?? chef,
          chef,
          over.statut ?? "a_faire",
          over.motif ?? null,
        ],
      );

  it("12. numérotation, transitions, états terminaux figés, responsable du portail refusé, CHECK du motif", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    const numeros: number[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await ctx.db.withTenant(cab, async (db) => {
        const r = (await action(d)(db)).rows[0];
        numeros.push(r.numero);
        ids.push(r.id);
      });
    }
    expect(numeros).toEqual([1, 2, 3]);
    const maj =
      (id: string, sql: string, params: unknown[] = []) =>
      (db: Db) =>
        db.query(`UPDATE red_actions SET ${sql} WHERE id = $1`, [id, ...params]);
    // Naissance autre que « a_faire » : refusée.
    expect(await code(cab, action(d, { statut: "en_cours" }))).toBe("MPZ06");
    // a_faire -> en_cours -> terminee ; terminee -> en_cours refusé.
    expect(await code(cab, maj(ids[0]!, "statut = 'en_cours'"))).toBe("aucun");
    expect(await code(cab, maj(ids[0]!, "statut = 'terminee', termine_le = '2026-11-01'"))).toBe(
      "aucun",
    );
    expect(await code(cab, maj(ids[0]!, "statut = 'en_cours', termine_le = NULL"))).toBe("MPZ06");
    // Une action terminée ne change plus du tout (contenu compris).
    expect(await code(cab, maj(ids[0]!, "titre = 'Autre'"))).toBe("MPZ06");
    // Bloquée sans motif : CHECK ; avec motif : acceptée ; bloquée -> terminee : refusé.
    expect(await code(cab, maj(ids[1]!, "statut = 'bloquee'"))).toBe("23514");
    expect(await code(cab, maj(ids[1]!, "statut = 'bloquee', motif = 'Attente banque'"))).toBe(
      "aucun",
    );
    expect(await code(cab, maj(ids[1]!, "statut = 'terminee', termine_le = '2026-11-02'"))).toBe(
      "MPZ06",
    );
    expect(await code(cab, maj(ids[1]!, "statut = 'en_cours'"))).toBe("aucun");
    // terminee sans date de fin : CHECK.
    expect(await code(cab, maj(ids[2]!, "statut = 'terminee'"))).toBe("23514");
    // Identité figée.
    expect(await code(cab, maj(ids[2]!, "numero = 99"))).toBe("MPZ04");
    expect(await code(cab, maj(ids[2]!, "cree_par = $2", [consultant]))).toBe("MPZ04");
    // Le rang et le titre d'une action ouverte bougent.
    expect(await code(cab, maj(ids[2]!, "rang = 5, titre = 'Nouveau titre'"))).toBe("aucun");
    // Le responsable du portail est refusé (23503), à l'insertion comme à la modification.
    expect(await code(cab, action(d, { responsable: portailUtilisateur }))).toBe("23503");
    expect(await code(cab, maj(ids[2]!, "responsable_id = $2", [portailUtilisateur]))).toBe(
      "23503",
    );
    // Levier : code, paramètres et impact vont ensemble.
    expect(await code(cab, maj(ids[2]!, "levier_code = 'prix'"))).toBe("23514");
    expect(
      await code(
        cab,
        maj(ids[2]!, `levier_code = 'prix', levier_parametres = '{"a":1}', impact = '{"b":2}'`),
      ),
    ).toBe("aucun");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 13 : plafonds                                                                               */
/* ------------------------------------------------------------------------------------------ */

describe("plafonds de volume (MPZ10)", () => {
  it("13. correspondances 100, urgences 200, scores 500, trésorerie 200, plan 100 par dossier", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    await ctx.db.withTenant(cab, async (db) => {
      await db.query(
        `INSERT INTO red_correspondances (cabinet_id, dossier_id, version, postes, cree_par)
         SELECT $1, $2, g, '{}', $3 FROM generate_series(1, 100) g`,
        [cab, d, chef],
      );
    });
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_correspondances (cabinet_id, dossier_id, version, postes, cree_par)
           VALUES ($1, $2, 101, '{}', $3)`,
          [cab, d, chef],
        ),
      ),
    ).toBe("MPZ10");
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `INSERT INTO red_urgences (cabinet_id, dossier_id, grille_version, reponses, resultat, voyant, saisi_par)
         SELECT $1, $2, 1, '{}', '{}', 'vert', $3 FROM generate_series(1, 200)`,
        [cab, d, chef],
      ),
    );
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_urgences (cabinet_id, dossier_id, grille_version, reponses, resultat, voyant, saisi_par)
           VALUES ($1, $2, 1, '{}', '{}', 'vert', $3)`,
          [cab, d, chef],
        ),
      ),
    ).toBe("MPZ10");
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `INSERT INTO red_scores (cabinet_id, dossier_id, secteur, seuils_source, seuils, version_moteur, date_reference,
                                 entrees, resultat, score, niveau, calcule_par)
         SELECT $1, $2, 'general', 'defaut_moteur', '{}', 1, '2026-10-11', '{}', '{}', 10, 'faible', $3
         FROM generate_series(1, 500)`,
        [cab, d, chef],
      ),
    );
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_scores (cabinet_id, dossier_id, secteur, seuils_source, seuils, version_moteur, date_reference,
                                   entrees, resultat, score, niveau, calcule_par)
           VALUES ($1, $2, 'general', 'defaut_moteur', '{}', 1, '2026-10-11', '{}', '{}', 10, 'faible', $3)`,
          [cab, d, chef],
        ),
      ),
    ).toBe("MPZ10");
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
         SELECT $1, $2, g, $4, 0, $3 FROM generate_series(1, 200) g`,
        [cab, d, chef, LUNDI],
      ),
    );
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
           VALUES ($1, $2, 201, $4, 0, $3)`,
          [cab, d, chef, LUNDI],
        ),
      ),
    ).toBe("MPZ10");
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
         SELECT $1, $2, g, '2026-10-11', '{}', $4, $3 FROM generate_series(1, 100) g`,
        [cab, d, chef, HASH],
      ),
    );
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
           VALUES ($1, $2, 101, '2026-10-11', '{}', $4, $3)`,
          [cab, d, chef, HASH],
        ),
      ),
    ).toBe("MPZ10");
  });

  it("13. seuils 50 par secteur, créanciers 200, actions 300, créances 100, négociations 300, échéances 60, lignes 600, réalisés 1000", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    // Seuils : 50 versions d'un secteur (cabinet B, que le reste du fichier n'utilise pas).
    // Un brouillon à la fois : chaque version est publiée (associé, auteur dispensé) avant la suivante.
    await ctx.db.withTenant(b.cabinetId, async (db) => {
      for (let v = 1; v <= 50; v += 1) {
        await db.query(
          `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
           VALUES ($1, 'general', $2, '{}', $3)`,
          [b.cabinetId, v, b.associeId],
        );
        await db.query(
          `UPDATE red_seuils_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now()
           WHERE secteur = 'general' AND version = $1`,
          [v, b.associeId],
        );
      }
    });
    expect(
      await code(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
           VALUES ($1, 'general', 51, '{}', $2)`,
          [b.cabinetId, b.associeId],
        ),
      ),
    ).toBe("MPZ10");
    // Un autre secteur du même cabinet est indépendant.
    expect(
      await code(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
           VALUES ($1, 'btp', 1, '{}', $2)`,
          [b.cabinetId, b.associeId],
        ),
      ),
    ).toBe("aucun");
    // Créanciers.
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
         SELECT $1, $2, 'Créancier ' || g, 'autre', $3 FROM generate_series(1, 200) g`,
        [cab, d, chef],
      ),
    );
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
           VALUES ($1, $2, 'Un de trop', 'autre', $3)`,
          [cab, d, chef],
        ),
      ),
    ).toBe("MPZ10");
    // Actions : 300.
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `INSERT INTO red_actions (cabinet_id, dossier_id, titre, volet, domaine, echeance, responsable_id, cree_par)
         SELECT $1, $2, 'Action ' || g, 'quick_win', 'tresorerie', '2026-12-01', $3, $3 FROM generate_series(1, 300) g`,
        [cab, d, chef],
      ),
    );
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_actions (cabinet_id, dossier_id, titre, volet, domaine, echeance, responsable_id, cree_par)
           VALUES ($1, $2, 'Une de trop', 'quick_win', 'tresorerie', '2026-12-01', $3, $3)`,
          [cab, d, chef],
        ),
      ),
    ).toBe("MPZ10");
    // Événements d'une action : 200.
    const action = await ctx.db.withTenant(cab, async (db) => {
      const r = await une<{ id: string }>(
        db,
        "SELECT id FROM red_actions WHERE dossier_id = $1 LIMIT 1",
        [d],
      );
      await db.query(
        `INSERT INTO red_action_evenements (cabinet_id, dossier_id, action_id, type, statut_apres, auteur_id)
         SELECT $1, $2, $3, 'commentaire', 'a_faire', $4 FROM generate_series(1, 200)`,
        [cab, d, r.id, chef],
      );
      return r.id;
    });
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_action_evenements (cabinet_id, dossier_id, action_id, type, statut_apres, auteur_id)
           VALUES ($1, $2, $3, 'commentaire', 'a_faire', $4)`,
          [cab, d, action, chef],
        ),
      ),
    ).toBe("MPZ10");
    // Créances (100 par créancier) et négociations (300) sur le premier créancier.
    const creancier = (
      await ctx.db.withTenant(cab, (db) =>
        db.query("SELECT id FROM red_creanciers WHERE dossier_id = $1 LIMIT 1", [d]),
      )
    ).rows[0].id as string;
    await ctx.db.withTenant(cab, async (db) => {
      await db.query(
        `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, date_arrete, saisi_par)
         SELECT $1, $2, $3, g, 10, '2026-10-01', $4 FROM generate_series(1, 100) g`,
        [cab, d, creancier, chef],
      );
      await db.query(
        `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, auteur_id)
         SELECT $1, $2, $3, 'note', '2026-10-10', $4 FROM generate_series(1, 300)`,
        [cab, d, creancier, chef],
      );
    });
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, date_arrete, saisi_par)
           VALUES ($1, $2, $3, 101, 10, '2026-10-01', $4)`,
          [cab, d, creancier, chef],
        ),
      ),
    ).toBe("MPZ10");
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, auteur_id)
           VALUES ($1, $2, $3, 'note', '2026-10-10', $4)`,
          [cab, d, creancier, chef],
        ),
      ),
    ).toBe("MPZ10");
    // Échéances d'un accord : 60 ; lignes d'une version : 600 (même transaction que la création).
    // Le déclencheur de plafond précède le CHECK du rang : le 61e rang donne MPZ10.
    const autre = (
      await ctx.db.withTenant(cab, (db) =>
        db.query("SELECT id FROM red_creanciers WHERE dossier_id = $1 ORDER BY nom DESC LIMIT 1", [
          d,
        ]),
      )
    ).rows[0].id as string;
    expect(
      await code(cab, async (db) => {
        const accord = (
          await une<{ id: string }>(
            db,
            `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, montant, auteur_id)
             VALUES ($1, $2, $3, 'accord', '2026-10-10', 6000, $4) RETURNING id`,
            [cab, d, autre, chef],
          )
        ).id;
        await db.query(
          `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
           SELECT $1, $2, $3, $4, g, '2027-01-01', 100 FROM generate_series(1, 60) g`,
          [cab, d, autre, accord],
        );
        await db.query(
          `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
           VALUES ($1, $2, $3, $4, 61, '2027-01-01', 100)`,
          [cab, d, autre, accord],
        );
      }),
    ).toBe("MPZ10");
    expect(
      await code(cab, async (db) => {
        const v = (
          await une<{ id: string }>(
            db,
            `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
             VALUES ($1, $2, 1, $3, 0, $4) RETURNING id`,
            [cab, d, LUNDI, chef],
          )
        ).id;
        await db.query(
          `INSERT INTO red_tresorerie_lignes (cabinet_id, dossier_id, version_id, rang, semaine, sens, categorie, montant)
           SELECT $1, $2, $3, g, 1, 'encaissement', 'clients', 10 FROM generate_series(1, 600) g`,
          [cab, d, v],
        );
        await db.query(
          `INSERT INTO red_tresorerie_lignes (cabinet_id, dossier_id, version_id, rang, semaine, sens, categorie, montant)
           VALUES ($1, $2, $3, 601, 1, 'encaissement', 'clients', 10)`,
          [cab, d, v],
        );
      }),
    ).toBe("MPZ10");
    // Réalisés : 1000 lignes par dossier (semaines distinctes).
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `INSERT INTO red_tresorerie_realises (cabinet_id, dossier_id, semaine_debut, flux, saisi_par)
         SELECT $1, $2, DATE '2026-10-05' + (g - 1) * 7, '{}', $3 FROM generate_series(1, 1000) g`,
        [cab, d, chef],
      ),
    );
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_tresorerie_realises (cabinet_id, dossier_id, semaine_debut, flux, saisi_par)
           VALUES ($1, $2, '2100-01-04', '{}', $3)`,
          [cab, d, chef],
        ),
      ),
    ).toBe("MPZ10");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* 14 : mission clôturée ou dossier clos                                                       */
/* ------------------------------------------------------------------------------------------ */

describe("mission clôturée ou dossier clos : plus d'écriture (MPZ03)", () => {
  /** Une insertion valide par table fille, jouée sur le dossier d'un jeu à l'état « ouvert ». */
  async function insertionsParTable(j: Jeu): Promise<Record<string, (db: Db) => Promise<unknown>>> {
    const cab = a.cabinetId;
    const d = j.dossier;
    return {
      red_correspondances: (db) =>
        db.query(
          `INSERT INTO red_correspondances (cabinet_id, dossier_id, version, postes, cree_par)
           VALUES ($1, $2, 2, '{}', $3)`,
          [cab, d, chef],
        ),
      red_urgences: (db) =>
        db.query(
          `INSERT INTO red_urgences (cabinet_id, dossier_id, grille_version, reponses, resultat, voyant, saisi_par)
           VALUES ($1, $2, 1, '{}', '{}', 'vert', $3)`,
          [cab, d, chef],
        ),
      red_scores: (db) =>
        db.query(
          `INSERT INTO red_scores (cabinet_id, dossier_id, secteur, seuils_source, seuils, version_moteur, date_reference,
                                   entrees, resultat, score, niveau, calcule_par)
           VALUES ($1, $2, 'general', 'defaut_moteur', '{}', 1, '2026-10-11', '{}', '{}', 10, 'faible', $3)`,
          [cab, d, chef],
        ),
      red_creanciers: (db) =>
        db.query(
          `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
           VALUES ($1, $2, 'Nouveau', 'autre', $3)`,
          [cab, d, chef],
        ),
      red_creances: (db) =>
        db.query(
          `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, date_arrete, saisi_par)
           VALUES ($1, $2, $3, 2, 10, '2026-10-01', $4)`,
          [cab, d, j.creancier, chef],
        ),
      red_negociation_evenements: (db) =>
        db.query(
          `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement, auteur_id)
           VALUES ($1, $2, $3, 'note', '2026-10-10', $4)`,
          [cab, d, j.creancier, chef],
        ),
      red_echeances: (db) =>
        db.query(
          `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
           VALUES ($1, $2, $3, $4, 3, '2027-01-01', 10)`,
          [cab, d, j.creancier, j.accord],
        ),
      red_tresorerie_versions: (db) =>
        db.query(
          `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial, cree_par)
           VALUES ($1, $2, 2, $3, 0, $4)`,
          [cab, d, LUNDI, chef],
        ),
      red_tresorerie_lignes: (db) =>
        db.query(
          `INSERT INTO red_tresorerie_lignes (cabinet_id, dossier_id, version_id, rang, semaine, sens, categorie, montant)
           VALUES ($1, $2, $3, 2, 1, 'encaissement', 'clients', 10)`,
          [cab, d, j.tresoVersion],
        ),
      red_tresorerie_realises: (db) =>
        db.query(
          `INSERT INTO red_tresorerie_realises (cabinet_id, dossier_id, semaine_debut, flux, saisi_par)
           VALUES ($1, $2, '2026-10-12', '{}', $3)`,
          [cab, d, chef],
        ),
      red_actions: (db) =>
        db.query(
          `INSERT INTO red_actions (cabinet_id, dossier_id, titre, volet, domaine, echeance, responsable_id, cree_par)
           VALUES ($1, $2, 'Nouvelle', 'quick_win', 'tresorerie', '2026-12-01', $3, $3)`,
          [cab, d, chef],
        ),
      red_action_evenements: (db) =>
        db.query(
          `INSERT INTO red_action_evenements (cabinet_id, dossier_id, action_id, type, statut_apres, auteur_id)
           VALUES ($1, $2, $3, 'commentaire', 'a_faire', $4)`,
          [cab, d, j.action, chef],
        ),
      red_plan_versions: (db) =>
        db.query(
          `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
           VALUES ($1, $2, 2, '2026-10-11', '{}', $3, $4)`,
          [cab, d, HASH, chef],
        ),
    };
  }

  it("14. avant la clôture, chaque insertion de contrôle est valide", async () => {
    const j = await peupler();
    const inserts = await insertionsParTable(j);
    expect(Object.keys(inserts)).toHaveLength(13);
    for (const [t, ins] of Object.entries(inserts)) {
      // Une échéance (ou une ligne de trésorerie) n'est valide que dans la transaction de son accord
      // (de sa version) : MPZ09 (MPZ01) hors de celle-ci, quel que soit l'état du dossier.
      if (t === "red_echeances" || t === "red_tresorerie_lignes") continue;
      // Chaque insertion s'exécute dans sa transaction annulée : la base n'est pas modifiée.
      const c = await code(a.cabinetId, async (db) => {
        await ins(db);
        throw Object.assign(new Error("annulation"), { code: "ANNULE" });
      });
      expect(c, t).toBe("ANNULE");
    }
  });

  it("14. mission clôturée : refus (MPZ03) sur toutes les tables filles, sauf les lectures", async () => {
    const j = await peupler(true);
    const inserts = await insertionsParTable(j);
    await cloturer(j.mission);
    for (const [t, ins] of Object.entries(inserts)) {
      expect(await code(a.cabinetId, ins), t).toBe("MPZ03");
    }
    // Modifications des tables vivantes : refusées aussi.
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_creanciers SET garanti = true WHERE id = $1", [j.creancier]),
      ),
    ).toBe("MPZ03");
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_actions SET rang = 3 WHERE id = $1", [j.action]),
      ),
    ).toBe("MPZ03");
    // La lecture reste possible.
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      const r = await db.query(
        "SELECT count(*)::int AS n FROM red_creanciers WHERE dossier_id = $1",
        [j.dossier],
      );
      expect(r.rows[0].n).toBe(1);
    });
  });

  it("14. dossier clos : refus (MPZ03) sur toutes les tables filles", async () => {
    const j = await peupler();
    const inserts = await insertionsParTable(j);
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        `UPDATE red_dossiers SET statut = 'clos', clos_le = now(), clos_par = $2,
           motif_cloture = 'Abandon du dossier' WHERE id = $1`,
        [j.dossier, associe],
      ),
    );
    for (const [t, ins] of Object.entries(inserts)) {
      expect(await code(a.cabinetId, ins), t).toBe("MPZ03");
    }
    expect(
      await code(a.cabinetId, (db) =>
        db.query("UPDATE red_creanciers SET actif = false WHERE id = $1", [j.creancier]),
      ),
    ).toBe("MPZ03");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Durcissements d'audit : actions abandonnées, annulation d'un paiement, brouillon unique     */
/* ------------------------------------------------------------------------------------------ */

describe("durcissements d'audit (base)", () => {
  it("actions : une action abandonnée libère sa place (300 non abandonnées), 1 000 au total", async () => {
    const d = await creerDossier(a.cabinetId, await nouvelleMission());
    const cab = a.cabinetId;
    const inserer = (n: number) => (db: Db) =>
      db.query(
        `INSERT INTO red_actions (cabinet_id, dossier_id, titre, volet, domaine, echeance, responsable_id, cree_par)
         SELECT $1, $2, 'Action ' || g, 'quick_win', 'tresorerie', '2026-12-01', $3, $3 FROM generate_series(1, $4) g`,
        [cab, d, chef, n],
      );
    const abandonner = (db: Db) =>
      db.query(
        `UPDATE red_actions SET statut = 'abandonnee', motif = 'Abandon' WHERE dossier_id = $1 AND statut = 'a_faire'`,
        [d],
      );
    await ctx.db.withTenant(cab, inserer(300));
    expect(await code(cab, inserer(1))).toBe("MPZ10");
    // Une action abandonnée libère sa place.
    await ctx.db.withTenant(cab, (db) =>
      db.query(
        `UPDATE red_actions SET statut = 'abandonnee', motif = 'Abandon'
         WHERE id = (SELECT id FROM red_actions WHERE dossier_id = $1 ORDER BY numero LIMIT 1)`,
        [d],
      ),
    );
    expect(await code(cab, inserer(1))).toBe("aucun");
    expect(await code(cab, inserer(1))).toBe("MPZ10");
    // Au total 1 000 actions, abandonnées comprises (les lectures sont bornées par ce plafond).
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await ctx.db.withTenant(cab, abandonner);
      await ctx.db.withTenant(cab, inserer(300));
    }
    await ctx.db.withTenant(cab, abandonner);
    await ctx.db.withTenant(cab, inserer(1000 - 901));
    const total = await ctx.db.withTenant(
      cab,
      async (db) =>
        (await db.query("SELECT count(*)::int AS n FROM red_actions WHERE dossier_id = $1", [d]))
          .rows[0].n,
    );
    expect(total).toBe(1000);
    expect(await code(cab, inserer(1))).toBe("MPZ10");
  });

  it("annulation d'un paiement : CHECK, même accord et même créancier, une seule fois (MPZ09)", async () => {
    const j = await peupler();
    const cab = a.cabinetId;
    const annulation =
      (over: {
        creancier?: string;
        accord?: string | null;
        paiement?: string | null;
        type?: string;
      }) =>
      (db: Db) =>
        db.query(
          `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement,
             accord_id, paiement_annule_id, auteur_id)
           VALUES ($1, $2, $3, $4, '2026-11-06', $5, $6, $7)`,
          [
            cab,
            j.dossier,
            over.creancier ?? j.creancier,
            over.type ?? "annulation_paiement",
            over.accord === undefined ? j.accord : over.accord,
            over.paiement === undefined ? j.paiement : over.paiement,
            chef,
          ],
        );
    // CHECK : l'annulation réclame l'accord et le paiement annulé ; seul ce type porte paiement_annule_id.
    expect(await code(cab, annulation({ type: "note", accord: null }))).toBe("23514");
    // (Le déclencheur précède le CHECK : un montant sur une annulation valide par ailleurs est refusé par le CHECK.)
    expect(
      await code(cab, (db) =>
        db.query(
          `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement,
             montant, accord_id, paiement_annule_id, auteur_id)
           VALUES ($1, $2, $3, 'annulation_paiement', '2026-11-06', 5, $4, $5, $6)`,
          [cab, j.dossier, j.creancier, j.accord, j.paiement, chef],
        ),
      ),
    ).toBe("23514");
    // Sans paiement annulé ou sans accord : le déclencheur refuse (MPZ09).
    expect(await code(cab, annulation({ paiement: null }))).toBe("MPZ09");
    expect(await code(cab, annulation({ accord: null }))).toBe("MPZ09");
    // Le paiement annulé est un paiement (pas l'accord), du même accord, du même créancier.
    expect(await code(cab, annulation({ paiement: j.accord }))).toBe("MPZ09");
    expect(await code(cab, annulation({ accord: j.ouverture }))).toBe("MPZ09");
    const autre = await ctx.db.withTenant(
      cab,
      async (db) =>
        (
          await une<{ id: string }>(
            db,
            `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
           VALUES ($1, $2, 'Autre créancier', 'autre', $3) RETURNING id`,
            [cab, j.dossier, chef],
          )
        ).id,
    );
    expect(await code(cab, annulation({ creancier: autre }))).toBe("MPZ09");
    // Nominal, puis une seconde annulation du même paiement : refusée.
    expect(await code(cab, annulation({}))).toBe("aucun");
    expect(await code(cab, annulation({}))).toBe("MPZ09");
    // Ajout seul : l'annulation ne se modifie pas.
    const refus = await proprietaire(async (c) => {
      try {
        await c.query("DELETE FROM red_negociation_evenements WHERE paiement_annule_id = $1", [
          j.paiement,
        ]);
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(refus).toBe("MPZ01");
  });

  it("seuils : un seul brouillon à la fois par secteur, même pour le propriétaire (MPZ06)", async () => {
    const insererBrouillon = (secteur: string) => (db: Db) =>
      db.query(
        `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, cree_par)
         VALUES ($1, $2, coalesce((SELECT max(version) FROM red_seuils_versions WHERE secteur = $2), 0) + 1, '{}', $3)`,
        [a.cabinetId, secteur, expert1],
      );
    expect(await code(a.cabinetId, insererBrouillon("commerce"))).toBe("aucun");
    expect(await code(a.cabinetId, insererBrouillon("commerce"))).toBe("MPZ06");
    expect(await code(a.cabinetId, insererBrouillon("btp"))).toBe("aucun");
  });
});
