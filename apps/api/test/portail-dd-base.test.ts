import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { SENTINELLE_CLIENT_PORTAIL } from "../src/portail/contexte.js";
import { attendu, sql } from "./dd-outils.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  changerOption,
  inviter,
  noteSoumise,
  preparerPortailDd,
  rapportNote,
  urlPublier,
  type NoteValidee,
  type ScenarioPortailDd,
} from "./portail-dd-outils.js";

/*
 * Portail investisseur de la due diligence (migration 0509), couche BASE, avec le rôle applicatif
 * réel : lecture seule dans le contexte du portail (un `withTenant` brut, paramètres posés comme
 * db/pool.ts, ne voit que ce que l'investisseur invité doit voir et n'écrit rien), retrait
 * invisible (le NOT EXISTS de la politique ne s'ouvre pas), isolation entre cabinets, ajout seul
 * (MPZ21) et gardes MQD01 à MQD08 éprouvées par du SQL direct du propriétaire.
 */

const TABLES = [
  "dd_portail_options",
  "dd_portail_invites",
  "dd_portail_publications",
  "dd_portail_publication_retraits",
  "dd_portail_pieces",
] as const;

let ctx: Contexte & { dossier: string };
let p: ScenarioPortailDd;
let note: NoteValidee;
let publicationId: string;
let rapportId: string;

const refus = (promesse: Promise<unknown>, code: string) =>
  expect(promesse).rejects.toMatchObject({ code });
const cab = () => p.s.a.cabinetId;

/** Transaction « du portail » : paramètres posés comme db/pool.ts pour une session du portail. */
function commePortail<T>(
  utilisateurId: string,
  fn: (db: Db) => Promise<T>,
  clientId = p.s.a.clientId,
  cabinetId = cab(),
): Promise<T> {
  return ctx.db.withTenant(cabinetId, async (db) => {
    await db.query(
      `SELECT set_config('app.portail_client_id', $1, true),
         set_config('app.portail_utilisateur_id', $2, true)`,
      [clientId, utilisateurId],
    );
    return fn(db);
  });
}

async function compter(db: Db): Promise<Record<string, number>> {
  const n: Record<string, number> = {};
  for (const t of TABLES) {
    n[t] = (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
  }
  return n;
}

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  p = await preparerPortailDd(ctx, "DD portail base");
  note = await noteSoumise(p.s);
  rapportId = (await rapportNote(p.s.consultantEquipe, note.noteId, "executive")).rapportId;
  await inviter(p.s.a.directeur, note.dossierId, p.investisseur.utilisateurId);
  publicationId = attendu(
    201,
    await p.s.a.directeur.post(urlPublier(note.noteId), {
      version: note.version,
      rapports: [rapportId],
    }),
  ).id;
  await changerOption(p.s.a.associe, true);
}, 300_000);
afterAll(() => ctx.fermer());

describe("contexte du portail : lecture seule, filtrée par la base", () => {
  it("l'investisseur invité voit SA publication, ses pièces, SES invitations et l'option", async () => {
    const vu = await commePortail(p.investisseur.utilisateurId, async (db) => ({
      n: await compter(db),
      publications: (await db.query("SELECT id FROM dd_portail_publications")).rows.map(
        (r) => r.id,
      ),
      invites: (await db.query("SELECT DISTINCT utilisateur_id FROM dd_portail_invites")).rows.map(
        (r) => r.utilisateur_id,
      ),
    }));
    expect(vu.publications).toEqual([publicationId]);
    expect(vu.invites).toEqual([p.investisseur.utilisateurId]);
    expect(vu.n.dd_portail_pieces).toBe(1);
    expect(vu.n.dd_portail_options).toBeGreaterThan(0);
    expect(vu.n.dd_portail_publication_retraits).toBe(0);
  });

  it("non invité, autre client, client sentinelle (rattachement inactif), autre cabinet : rien", async () => {
    const cas: [string, string, string][] = [
      [p.investisseur2.utilisateurId, p.s.a.clientId, cab()],
      [p.dirigeant.utilisateurId, p.s.a.clientId, cab()],
      [p.investisseurAutreClient.utilisateurId, p.s.autreClientId, cab()],
      [p.investisseur.utilisateurId, SENTINELLE_CLIENT_PORTAIL, cab()],
      [p.investisseurB.utilisateurId, p.s.b.clientId, p.s.b.cabinetId],
    ];
    for (const [u, client, cabinet] of cas) {
      const n = await commePortail(u, compter, client, cabinet);
      expect(n.dd_portail_publications, u).toBe(0);
      expect(n.dd_portail_pieces, u).toBe(0);
      expect(n.dd_portail_invites, u).toBe(0);
      expect(n.dd_portail_options, u).toBe(0);
    }
  });

  it("les tables internes de la note restent fermées au portail, même à l'investisseur invité", async () => {
    const n = await commePortail(p.investisseur.utilisateurId, async (db) => {
      const r: Record<string, number> = {};
      for (const t of [
        "dd_dossiers",
        "dd_notes",
        "dd_note_versions",
        "dd_note_validations",
        "rapports_mission",
      ]) {
        r[t] = (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
      }
      return r;
    });
    expect(Object.values(n)).toEqual([0, 0, 0, 0, 0]);
  });

  it("aucune écriture depuis le portail : insertion refusée par la RLS, ni UPDATE ni DELETE", async () => {
    const u = p.investisseur.utilisateurId;
    const insertions: [string, string, unknown[]][] = [
      [
        "INSERT INTO dd_portail_options (cabinet_id, actif, modifie_par) VALUES ($1, false, $2)",
        "options",
        [cab(), p.s.a.associeId],
      ],
      [
        `INSERT INTO dd_portail_invites (cabinet_id, dossier_id, utilisateur_id, action, auteur_id)
         VALUES ($1, $2, $3, 'retire', $4)`,
        "invites",
        [cab(), note.dossierId, u, p.s.a.associeId],
      ],
      [
        `INSERT INTO dd_portail_publication_retraits (cabinet_id, publication_id, client_id, retire_par)
         VALUES ($1, $2, $3, $4)`,
        "retraits",
        [cab(), publicationId, p.s.a.clientId, p.s.a.associeId],
      ],
    ];
    for (const [texte, quoi, params] of insertions) {
      await expect(
        commePortail(u, (db) => db.query(texte, params)),
        quoi,
      ).rejects.toThrow(/row-level security/);
    }
    for (const t of TABLES) {
      await expect(
        commePortail(u, (db) => db.query(`UPDATE ${t} SET cabinet_id = cabinet_id`)),
        t,
      ).rejects.toThrow(/permission denied/);
      await expect(
        commePortail(u, (db) => db.query(`DELETE FROM ${t}`)),
        t,
      ).rejects.toThrow(/permission denied/);
    }
    // Rien n'a bougé : la publication reste visible et non retirée.
    const n = await commePortail(u, compter);
    expect(n.dd_portail_publications).toBe(1);
  });

  it("publication retirée : invisible au portail (le retrait est lu, le filtre ne s'ouvre pas)", async () => {
    const autre = await noteSoumise(p.s);
    await inviter(p.s.a.associe, autre.dossierId, p.investisseur.utilisateurId);
    const pub = attendu(
      201,
      await p.s.a.associe.post(urlPublier(autre.noteId), { version: autre.version }),
    ).id as string;
    const ids = async () =>
      commePortail(p.investisseur.utilisateurId, async (db) =>
        (await db.query("SELECT id FROM dd_portail_publications ORDER BY numero")).rows.map(
          (r) => r.id,
        ),
      );
    expect(await ids()).toEqual([publicationId, pub]);
    attendu(201, await p.s.a.associe.post(`/api/dd/portail/publications/${pub}/retrait`));
    expect(await ids()).toEqual([publicationId]);
    const retraits = await commePortail(p.investisseur.utilisateurId, async (db) =>
      (await db.query("SELECT publication_id FROM dd_portail_publication_retraits")).rows.map(
        (r) => r.publication_id,
      ),
    );
    expect(retraits).toEqual([pub]);
  });
});

describe("isolation entre cabinets", () => {
  it("le cabinet B ne voit aucune ligne des cinq tables ; le cabinet A les voit", async () => {
    const b = await ctx.db.withTenant(p.s.b.cabinetId, compter);
    expect(Object.values(b)).toEqual([0, 0, 0, 0, 0]);
    const a = await ctx.db.withTenant(cab(), compter);
    for (const t of TABLES) expect(a[t], t).toBeGreaterThan(0);
  });
});

describe("ajout seul et gardes de la base (MQD01 à MQD08)", () => {
  it("MPZ21 : même le propriétaire ne modifie ni ne supprime aucune ligne", async () => {
    for (const t of TABLES) {
      await refus(sql(`UPDATE ${t} SET cabinet_id = cabinet_id`), "MPZ21");
      await refus(sql(`DELETE FROM ${t}`), "MPZ21");
    }
  });

  it("MQD01 : dirigeant, investisseur d'un autre client, compte désactivé ; MQD02 : transitions", async () => {
    const inviterSql = (u: string, action = "invite", dossier = note.dossierId) =>
      sql(
        `INSERT INTO dd_portail_invites (cabinet_id, dossier_id, utilisateur_id, action, auteur_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [cab(), dossier, u, action, p.s.a.associeId],
      );
    await refus(inviterSql(p.dirigeant.utilisateurId), "MQD01");
    await refus(inviterSql(p.investisseurAutreClient.utilisateurId), "MQD01");
    // Un utilisateur interne n'est pas un compte du portail (refusé avant même la clé étrangère
    // vers utilisateurs_portail).
    await refus(inviterSql(p.s.consultantEquipe.utilisateurId), "MQD01");
    await refus(inviterSql(p.investisseur.utilisateurId), "MQD02");
    await refus(inviterSql(p.investisseur2.utilisateurId, "retire"), "MQD02");
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs_portail SET statut = 'desactive' WHERE utilisateur_id = $1", [
        p.investisseur2.utilisateurId,
      ]),
    );
    try {
      await refus(inviterSql(p.investisseur2.utilisateurId), "MQD01");
    } finally {
      await proprietaire((c) =>
        c.query("UPDATE utilisateurs_portail SET statut = 'actif' WHERE utilisateur_id = $1", [
          p.investisseur2.utilisateurId,
        ]),
      );
    }
    // Un compte du portail n'est jamais l'auteur d'une invitation.
    await refus(
      sql(
        `INSERT INTO dd_portail_invites (cabinet_id, dossier_id, utilisateur_id, action, auteur_id)
         VALUES ($1, $2, $3, 'invite', $4)`,
        [cab(), note.dossierId, p.investisseur2.utilisateurId, p.investisseur.utilisateurId],
      ),
      "23503",
    );
  });

  /** Instantané exact de la version, prêt à insérer (propriétaire ; date en texte : microsecondes). */
  async function instantane(n: NoteValidee): Promise<Record<string, unknown>> {
    const [l] = await sql(
      `SELECT v.id AS note_version_id, v.version, v.recommandation, v.synthese, v.conditions,
         nt.titre, nt.dossier_id, d.client_id, x.valide_le::text AS valide_le
       FROM dd_note_versions v JOIN dd_notes nt ON nt.id = v.note_id
         JOIN dd_dossiers d ON d.id = nt.dossier_id
         LEFT JOIN dd_note_validations x ON x.note_version_id = v.id
       WHERE v.note_id = $1 AND v.version = $2`,
      [n.noteId, n.version],
    );
    return { ...l, note_id: n.noteId };
  }

  async function publierSql(v: Record<string, unknown>) {
    return proprietaire(
      async (c) =>
        (
          await c.query(
            `INSERT INTO dd_portail_publications (cabinet_id, dossier_id, client_id, note_id,
             note_version_id, version, titre, recommandation, synthese, conditions, valide_le,
             publie_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [
              cab(),
              v.dossier_id,
              v.client_id,
              v.note_id,
              v.note_version_id,
              v.version,
              v.titre,
              v.recommandation,
              v.synthese,
              v.conditions,
              v.valide_le,
              p.s.a.associeId,
            ],
          )
        ).rows[0].id as string,
    );
  }

  it("MQD03 : version non validée ; MQD04 : instantané altéré ; MQD05 : déjà publiée", async () => {
    const attente = await noteSoumise(p.s, { valider: false });
    await refus(publierSql({ ...(await instantane(attente)), valide_le: new Date() }), "MQD03");
    const v = await instantane(note);
    // Publication active de `note` : toute nouvelle publication cohérente est refusée.
    await refus(publierSql(v), "MQD05");
    const autre = await noteSoumise(p.s);
    const w = await instantane(autre);
    await refus(publierSql({ ...w, synthese: "Synthèse réécrite hors de la note." }), "MQD04");
    await refus(publierSql({ ...w, client_id: p.s.autreClientId }), "MQD04");
    await refus(publierSql({ ...w, valide_le: new Date("2026-01-01T00:00:00Z") }), "MQD04");
    await refus(publierSql({ ...w, titre: "Autre titre" }), "MQD04");
    // L'instantané exact passe (propriétaire, hors API).
    expect(await publierSql(w)).toMatch(/^[0-9a-f-]{36}$/);
  }, 90_000);

  it("MQD06 : retrait d'un autre client ; MQD07 : pièce hors de la transaction de publication ou d'une autre note", async () => {
    await refus(
      sql(
        `INSERT INTO dd_portail_publication_retraits (cabinet_id, publication_id, client_id, retire_par)
         VALUES ($1, $2, $3, $4)`,
        [cab(), publicationId, p.s.autreClientId, p.s.a.associeId],
      ),
      "MQD06",
    );
    const piece = (rapport: string, variante = "executive") =>
      sql(
        `INSERT INTO dd_portail_pieces (cabinet_id, publication_id, rapport_id, client_id, variante, format)
         VALUES ($1, $2, $3, $4, $5, 'docx')`,
        [cab(), publicationId, rapport, p.s.a.clientId, variante],
      );
    // Le bon rapport, mais après coup : l'ensemble des pièces est figé à la publication.
    await refus(piece(rapportId), "MQD07");
    const autre = await noteSoumise(p.s);
    const r = await rapportNote(p.s.a.associe, autre.noteId, "executive");
    await refus(piece(r.rapportId), "MQD07");
  });

  it("MQD08 : 500 événements d'invitation par dossier au plus", async () => {
    const n = await noteSoumise(p.s);
    await proprietaire((c) =>
      c.query(
        `DO $$
         DECLARE i integer;
         BEGIN
           FOR i IN 1..500 LOOP
             INSERT INTO dd_portail_invites (cabinet_id, dossier_id, utilisateur_id, action, auteur_id)
             VALUES ('${cab()}', '${n.dossierId}', '${p.investisseur2.utilisateurId}',
                     CASE WHEN i % 2 = 1 THEN 'invite' ELSE 'retire' END, '${p.s.a.associeId}');
           END LOOP;
         END $$`,
      ),
    );
    await refus(
      sql(
        `INSERT INTO dd_portail_invites (cabinet_id, dossier_id, utilisateur_id, action, auteur_id)
         VALUES ($1, $2, $3, 'invite', $4)`,
        [cab(), n.dossierId, p.investisseur2.utilisateurId, p.s.a.associeId],
      ),
      "MQD08",
    );
    // L'API refuse avant la base, avec le même code d'erreur.
    const r = await p.s.a.associe.post(`/api/dd/dossiers/${n.dossierId}/portail/invitations`, {
      utilisateur_id: p.investisseur.utilisateurId,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
  });

  it("toutes les politiques du portail des cinq tables sont RESTRICTIVES ; aucune fonction SECURITY DEFINER", async () => {
    const pol = await sql(
      `SELECT tablename, policyname, permissive, cmd FROM pg_policies
       WHERE tablename = ANY ($1) AND policyname LIKE 'portail%' ORDER BY 1, 2`,
      [TABLES],
    );
    for (const t of TABLES) {
      expect(
        pol.filter((x) => x.tablename === t).map((x) => `${x.policyname}:${x.cmd}`),
        t,
      ).toEqual([
        "portail:SELECT",
        "portail_sans_delete:DELETE",
        "portail_sans_insert:INSERT",
        "portail_sans_update:UPDATE",
      ]);
    }
    expect(pol.every((x) => x.permissive === "RESTRICTIVE")).toBe(true);
    const definer = await sql(
      `SELECT proname FROM pg_proc WHERE prosecdef AND proname LIKE '%dd\\_portail%'`,
    );
    expect(definer).toEqual([]);
  });
});
