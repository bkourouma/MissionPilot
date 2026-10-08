import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerAssertion,
  creerPreuve,
  lier,
  preparerPreuves,
  type ScenarioPreuves,
} from "./preuves-outils.js";

/*
 * Garanties de la base du registre des preuves (migrations 0240 à 0242), éprouvées avec le rôle
 * applicatif réel et avec le propriétaire : ajout seul (REVOKE + déclencheurs MPV…), isolation
 * entre cabinets (RLS), cohérence des liens, signature de l'avis d'expert, portail fermé.
 */

let ctx: Contexte;
let s: ScenarioPreuves;
let preuveId: string;
let assertionId: string;

const TABLES = [
  "preuves",
  "preuve_versions",
  "assertions",
  "assertion_versions",
  "assertion_preuve_liens",
  "preuve_arbitrages",
];

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerPreuves(ctx, "PRV base");
  preuveId = (await creerPreuve(s.a.chef, s.missionId)).id;
  assertionId = (await creerAssertion(s.a.chef, s.missionId)).id;
  await lier(s.a.chef, assertionId, preuveId, "contre");
  await s.a.chef.post(`/api/assertions/${assertionId}/arbitrages`, {
    preuve_id: preuveId,
    decision: "contradiction_maintenue",
    motif: "Contradiction assumée.",
  });
}, 180_000);
afterAll(() => ctx.fermer());

describe("ajout seul", () => {
  it("le rôle applicatif ne peut ni modifier ni supprimer une ligne des tables d'historique", async () => {
    for (const table of TABLES) {
      await expect(
        ctx.db.withTenant(s.a.cabinetId, (db) =>
          db.query(`UPDATE ${table} SET cabinet_id = cabinet_id`),
        ),
        `UPDATE ${table}`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        ctx.db.withTenant(s.a.cabinetId, (db) => db.query(`DELETE FROM ${table}`)),
        `DELETE ${table}`,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("même le propriétaire de la base est refusé par les déclencheurs (MPV01)", async () => {
    for (const table of TABLES) {
      await expect(
        proprietaire((c) => c.query(`UPDATE ${table} SET cabinet_id = cabinet_id`)),
        `UPDATE ${table}`,
      ).rejects.toMatchObject({ code: "MPV01" });
      await expect(
        proprietaire((c) => c.query(`DELETE FROM ${table}`)),
        `DELETE ${table}`,
      ).rejects.toMatchObject({
        code: "MPV01",
      });
    }
  });

  it("le code et la mission d'une dimension sont figés ; son libellé change", async () => {
    const d = (
      await s.a.chef.post(`/api/missions/${s.missionId}/preuves/dimensions`, {
        code: "base",
        libelle: "Base",
      })
    ).json();
    await expect(
      proprietaire((c) =>
        c.query("UPDATE preuve_dimensions SET code = 'autre' WHERE id = $1", [d.id]),
      ),
    ).rejects.toMatchObject({ code: "MPV01" });
    await expect(
      proprietaire((c) => c.query("DELETE FROM preuve_dimensions WHERE id = $1", [d.id])),
    ).rejects.toMatchObject({ code: "MPV01" });
    const r = await s.a.chef.patch(`/api/missions/${s.missionId}/preuves/dimensions/${d.id}`, {
      libelle: "Base renommée",
    });
    expect(r.json().libelle).toBe("Base renommée");
  });
});

describe("cohérence imposée par la base", () => {
  it("versions consécutives (MPV03)", async () => {
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO preuve_versions (cabinet_id, preuve_id, version, type_source, source_precise,
             date_preuve, auteur_id, fiabilite, motif, cree_par)
           SELECT cabinet_id, preuve_id, 5, type_source, source_precise, date_preuve, auteur_id,
             fiabilite, 'saut', cree_par FROM preuve_versions WHERE preuve_id = $1 AND version = 1`,
          [preuveId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPV03" });
  });

  it("lien entre une assertion et une preuve de missions différentes (MPV02)", async () => {
    const autre = (await creerPreuve(s.a.chef, s.mission2Id)).id;
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO assertion_preuve_liens (cabinet_id, mission_id, assertion_id, preuve_id, action, sens, cree_par)
           SELECT cabinet_id, mission_id, id, $2, 'lier', 'pour', cree_par FROM assertions WHERE id = $1`,
          [assertionId, autre],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPV02" });
  });

  it("délier ce qui n'est pas lié (MPV02) ; arbitrer un lien « pour » (MPV05)", async () => {
    const a = (await creerAssertion(s.a.chef, s.missionId)).id;
    const p = (await creerPreuve(s.a.chef, s.missionId)).id;
    const lien = (action: string, sens: string | null) =>
      proprietaire((c) =>
        c.query(
          `INSERT INTO assertion_preuve_liens (cabinet_id, mission_id, assertion_id, preuve_id, action, sens, cree_par)
           SELECT cabinet_id, mission_id, id, $2, $3, $4, cree_par FROM assertions WHERE id = $1`,
          [a, p, action, sens],
        ),
      );
    await expect(lien("delier", null)).rejects.toMatchObject({ code: "MPV02" });
    await lien("lier", "pour");
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO preuve_arbitrages (cabinet_id, mission_id, assertion_id, preuve_id, preuve_version, decision, motif, arbitre_par)
           SELECT cabinet_id, mission_id, id, $2, 1, 'contradiction_levee', 'x', cree_par FROM assertions WHERE id = $1`,
          [a, p],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPV05" });
  });

  it("un avis d'expert est signé par l'auteur de la version (MPV04)", async () => {
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO assertion_versions (cabinet_id, assertion_id, version, enonce, classe_risque,
             avis_expert, avis_expert_motif, signe_par, signe_le, motif, cree_par)
           SELECT a.cabinet_id, a.id, 2, 'x', 'R2', true, 'm', $2, now(), 'x', a.cree_par
           FROM assertions a WHERE a.id = $1`,
          [assertionId, s.a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPV04" });
  });
});

describe("isolation entre cabinets et portail", () => {
  it("un autre cabinet ne voit aucune ligne du registre", async () => {
    for (const table of [...TABLES, "preuve_dimensions"]) {
      const n = await ctx.db.withTenant(s.b.cabinetId, async (db) =>
        Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),
      );
      expect(n, table).toBe(0);
      await expect(
        ctx.db.withTenant(s.b.cabinetId, (db) =>
          db.query(`INSERT INTO ${table} (cabinet_id) VALUES ($1)`, [s.a.cabinetId]),
        ),
      ).rejects.toThrow();
    }
  });

  it("chaque table porte une politique restrictive portail_interdit", async () => {
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT tablename FROM pg_policies WHERE policyname = 'portail_interdit'
             AND permissive = 'RESTRICTIVE' AND tablename = ANY ($1::text[])`,
            [[...TABLES, "preuve_dimensions"]],
          )
        ).rows,
    );
    expect(lignes).toHaveLength(TABLES.length + 1);
  });
});
