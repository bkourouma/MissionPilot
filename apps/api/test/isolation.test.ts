import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerCabinet, demarrer, proprietaire, type Contexte } from "./helpers.js";

let ctx: Contexte;
let a: Awaited<ReturnType<typeof creerCabinet>>;
let b: Awaited<ReturnType<typeof creerCabinet>>;

beforeAll(async () => {
  ctx = await demarrer();
  a = await creerCabinet(ctx, "Cabinet A");
  b = await creerCabinet(ctx, "Cabinet B");
});
afterAll(() => ctx.fermer());

describe("isolation entre cabinets (SOC-01)", () => {
  it("un cabinet ne voit que ses propres utilisateurs", async () => {
    const vusParA = await ctx.db.withTenant(
      a.cabinetId,
      async (db) => (await db.query("SELECT cabinet_id FROM utilisateurs")).rows,
    );
    expect(vusParA.length).toBeGreaterThan(0);
    expect(vusParA.every((r) => r.cabinet_id === a.cabinetId)).toBe(true);
  });

  it("un cabinet ne voit pas la fiche d'un autre cabinet, même par identifiant", async () => {
    const lignes = await ctx.db.withTenant(
      a.cabinetId,
      async (db) => (await db.query("SELECT id FROM cabinets WHERE id = $1", [b.cabinetId])).rows,
    );
    expect(lignes).toHaveLength(0);
  });

  it("sans contexte de cabinet, aucune ligne n'est visible (échec sûr)", async () => {
    const lignes = await ctx.db.withoutTenant(
      async (db) => (await db.query("SELECT id FROM utilisateurs")).rows,
    );
    expect(lignes).toHaveLength(0);
  });

  it("écrire dans un autre cabinet est refusé", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO journal_audit (cabinet_id, action, entite) VALUES ($1, 'intrusion', 'x')`,
          [b.cabinetId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("modifier ou supprimer les données d'un autre cabinet n'affecte aucune ligne", async () => {
    const r = await ctx.db.withTenant(a.cabinetId, async (db) => {
      const maj = await db.query("UPDATE utilisateurs SET nom = 'piraté' WHERE cabinet_id = $1", [
        b.cabinetId,
      ]);
      const sup = await db.query("DELETE FROM sessions WHERE cabinet_id = $1", [b.cabinetId]);
      return { maj: maj.rowCount, sup: sup.rowCount };
    });
    expect(r).toEqual({ maj: 0, sup: 0 });
  });

  it("le rôle applicatif ne peut supprimer ni cabinets ni utilisateurs (le journal d'audit en dépend)", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM utilisateurs")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM cabinets")),
    ).rejects.toThrow(/permission denied/);
  });

  it("un identifiant de cabinet non valide est rejeté avant toute requête", async () => {
    await expect(
      ctx.db.withTenant("x'; DROP TABLE utilisateurs;--", async () => 1),
    ).rejects.toThrow();
  });

  it("le contexte ne fuit pas d'une transaction à la suivante", async () => {
    await ctx.db.withTenant(a.cabinetId, async () => undefined);
    const lignes = await ctx.db.withoutTenant(
      async (db) => (await db.query("SELECT id FROM utilisateurs")).rows,
    );
    expect(lignes).toHaveLength(0);
  });
});

describe("garanties de la base", () => {
  it("le rôle applicatif n'est ni superutilisateur, ni BYPASSRLS, ni propriétaire des tables", async () => {
    const role = await ctx.db.withoutTenant(
      async (db) =>
        (await db.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"))
          .rows[0],
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const proprietaires = await ctx.db.withoutTenant(
      async (db) =>
        (
          await db.query(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user",
          )
        ).rows,
    );
    expect(proprietaires).toHaveLength(0);
  });

  it("toute table portant cabinet_id (ou cabinets) a RLS activée et une politique", async () => {
    const manquantes = await proprietaire(async (c) => {
      const r = await c.query(`
        SELECT t.tablename
        FROM pg_tables t
        JOIN pg_class cl ON cl.relname = t.tablename AND cl.relnamespace = 'public'::regnamespace
        WHERE t.schemaname = 'public'
          AND (t.tablename = 'cabinets' OR EXISTS (
                SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'public' AND c.table_name = t.tablename AND c.column_name = 'cabinet_id'))
          AND (NOT cl.relrowsecurity
               OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.tablename))`);
      return r.rows.map((x) => x.tablename);
    });
    expect(manquantes).toEqual([]);
  });

  it("le journal d'audit est en ajout seul pour le rôle applicatif", async () => {
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(`INSERT INTO journal_audit (cabinet_id, action, entite) VALUES ($1, 't', 't')`, [
        a.cabinetId,
      ]),
    );
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("UPDATE journal_audit SET action = 'x'")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM journal_audit")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("file de tâches (ADR-002)", () => {
  it("un job n'est réservé qu'une fois, même par des workers concurrents", async () => {
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("INSERT INTO jobs (cabinet_id, type) VALUES ($1, 'test'), ($1, 'test')", [
        a.cabinetId,
      ]),
    );
    const prises = await Promise.all(
      [1, 2, 3, 4].map(() =>
        ctx.db.withoutTenant(async (db) => (await db.query("SELECT id FROM reserver_job()")).rows),
      ),
    );
    const ids = prises.flat().map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
