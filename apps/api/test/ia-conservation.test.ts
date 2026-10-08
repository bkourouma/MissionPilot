import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerHandlerConservationIa, planificationConservationIa } from "../src/ia/conservation.js";
import type { Db } from "../src/db/pool.js";
import { cabinetTest, type CabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Conservation des générations IA (migration 0104, ia/conservation.ts) : durée par
 * cabinet (365 jours par défaut), anonymisation du texte démasqué par le job
 * « ia_conservation », horloge injectée. Le reste de la trace est conservé.
 */

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet IA conservation A");
  b = await cabinetTest(ctx, "Cabinet IA conservation B");
});
afterAll(() => ctx.fermer());

const JOUR = 24 * 3600_000;
const apres = (jours: number) => new Date(Date.now() + jours * JOUR);

const corps = {
  prompt_nom: "resume_neutre",
  mode: "immediat",
  variables: { texte: "Awa Koné a présenté le diagnostic. Le climat est bon." },
  termes_sensibles: ["Awa Koné"],
};

async function generer(c: CabinetTest) {
  const r = await c.associe.post("/api/ia/generations", corps);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; texte: string };
}

/**
 * Réglage de transaction `app.horloge_test` (mécanisme de 0120, honoré dans une base « _test »
 * seulement) : sans lui, `purger_textes_ia` refuse un instant futur.
 */
const regler = (db: Db, maintenant: Date) =>
  db.query("SELECT set_config('app.horloge_test', $1, true)", [maintenant.toISOString()]);

/** Exécute le job de conservation du cabinet à l'instant donné (horloge injectée). */
async function purger(c: CabinetTest, maintenant: Date): Promise<void> {
  const handler = creerHandlerConservationIa();
  await ctx.db.withTenant(c.cabinetId, async (db) => {
    await regler(db, maintenant);
    await handler({ db, cabinetId: c.cabinetId, jobId: "test", charge: {}, maintenant });
  });
}

const etat = (id: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT version, statut_contenu, texte, donnees, texte_purge_le, auteur_id, gabarit
           FROM ia_generations WHERE demande_id = $1 ORDER BY version`,
          [id],
        )
      ).rows,
  );

describe("durée de conservation (365 jours par défaut, par cabinet)", () => {
  it("défaut : rien avant 365 jours, tout le texte anonymisé après, la trace reste", async () => {
    const g = await generer(a);
    expect(g.texte.length).toBeGreaterThan(0);
    const modif = await a.associe.post(`/api/ia/generations/${g.id}/modifier`, {
      texte: "Version humaine du texte.",
    });
    expect(modif.statusCode, modif.body).toBe(200);
    const ok = await a.associe.post(`/api/ia/generations/${g.id}/valider`, {
      acquitte_chiffres: true,
    });
    expect(ok.statusCode, ok.body).toBe(200);

    await purger(a, apres(364));
    expect((await etat(g.id)).every((v) => v.texte !== "" && v.texte_purge_le === null)).toBe(true);

    await purger(a, apres(366));
    const versions = await etat(g.id);
    expect(versions.map((v) => v.statut_contenu)).toEqual(["brouillon_ia", "modifie", "valide"]);
    for (const v of versions) {
      expect(v.texte).toBe("");
      expect(v.donnees).toBeNull();
      expect(v.texte_purge_le).not.toBeNull();
      expect(v.auteur_id).toBe(a.associeId);
    }
    // La génération reste lisible (statut, versions) sans texte.
    const vue = await a.associe.get(`/api/ia/generations/${g.id}`);
    expect(vue.statusCode).toBe(200);
    expect(vue.json()).toMatchObject({ statut_contenu: "valide", texte: "" });
    expect(vue.json().texte_purge_le).not.toBeNull();
    expect(vue.json().versions.every((v: { texte: string }) => v.texte === "")).toBe(true);
  });

  it("une génération purgée et ouverte ne se modifie plus (409 CONTENU_PURGE)", async () => {
    const g = await generer(a);
    await purger(a, apres(366));
    const r = await a.associe.post(`/api/ia/generations/${g.id}/modifier`, { texte: "Trop tard." });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("CONTENU_PURGE");
    const v = await a.associe.post(`/api/ia/generations/${g.id}/valider`, {
      acquitte_chiffres: true,
    });
    expect(v.statusCode).toBe(409);
    expect(v.json().erreur.code).toBe("CONTENU_PURGE");
  });

  it("durée propre au cabinet : 30 jours pour B, 365 (défaut) pour A ; le job n'agit que sur son cabinet", async () => {
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO ia_parametres_cabinet (cabinet_id, conservation_jours) VALUES ($1, 30)
         ON CONFLICT (cabinet_id) DO UPDATE SET conservation_jours = 30`,
        [b.cabinetId],
      ),
    );
    const ga = await generer(a);
    const gb = await generer(b);
    // A (365 j) : rien à +100 jours ; le job de A ne touche pas B (autre cabinet).
    await purger(a, apres(100));
    expect((await etat(ga.id))[0]?.texte_purge_le).toBeNull();
    expect((await etat(gb.id))[0]?.texte_purge_le).toBeNull();
    await purger(b, apres(29));
    expect((await etat(gb.id))[0]?.texte_purge_le).toBeNull();
    await purger(b, apres(31));
    expect((await etat(gb.id))[0]?.texte).toBe("");
    expect((await etat(ga.id))[0]?.texte_purge_le).toBeNull();
  });

  it("le délai court depuis la DERNIÈRE version : une génération encore éditée n'est pas vidée", async () => {
    const g = await generer(a);
    const modif = await a.associe.post(`/api/ia/generations/${g.id}/modifier`, {
      texte: "Récent.",
    });
    expect(modif.statusCode, modif.body).toBe(200);
    await purger(a, apres(364));
    expect((await etat(g.id)).every((v) => v.texte_purge_le === null)).toBe(true);
  });

  it("la durée est bornée (30 à 3 650 jours)", async () => {
    for (const jours of [29, 3651]) {
      await expect(
        proprietaire((cl) =>
          cl.query(
            `INSERT INTO ia_parametres_cabinet (cabinet_id, conservation_jours) VALUES ($1, $2)
             ON CONFLICT (cabinet_id) DO UPDATE SET conservation_jours = $2`,
            [a.cabinetId, jours],
          ),
        ),
      ).rejects.toThrow(/check/i);
    }
  });
});

describe("garde du déclencheur d'ajout seul et de la fonction de purge", () => {
  it("seule l'anonymisation est permise ; le reste demeure refusé", async () => {
    const g = await generer(a);
    await proprietaire(async (cl) => {
      for (const sql of [
        `UPDATE ia_generations SET texte = 'x' WHERE demande_id = $1`,
        `UPDATE ia_generations SET texte = '', texte_purge_le = now(), statut_contenu = 'valide' WHERE demande_id = $1`,
        `UPDATE ia_generations SET texte = '', texte_purge_le = now(), cout_micro_usd = 1 WHERE demande_id = $1`,
        `UPDATE ia_generations SET texte_purge_le = now() WHERE demande_id = $1`,
        `DELETE FROM ia_generations WHERE demande_id = $1`,
      ]) {
        await expect(cl.query(sql, [g.id]), sql).rejects.toMatchObject({ code: "MPI01" });
      }
    });
    // Le rôle applicatif n'a aucun droit direct ; la fonction exige un cabinet de contexte.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(`UPDATE ia_generations SET texte = '' WHERE demande_id = $1`, [g.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withoutTenant((db) => db.query("SELECT purger_textes_ia(now(), 10)")),
    ).rejects.toThrow(/invalides/);
    // Une anonymisation répétée ne change rien.
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      await regler(db, apres(4000));
      await db.query("SELECT purger_textes_ia($1, 10)", [apres(4000)]);
    });
    const n2 = await ctx.db.withTenant(a.cabinetId, async (db) => {
      await regler(db, apres(4001));
      return (await db.query("SELECT purger_textes_ia($1, 10) AS n", [apres(4001)])).rows[0]
        .n as number;
    });
    expect(n2).toBe(0);
    expect((await etat(g.id))[0]?.texte).toBe("");
  });

  it("refuse un instant futur fourni par l'appelant (sauf horloge de test)", async () => {
    const g = await generer(a);
    const purge = (instant: Date, horloge?: Date) =>
      ctx.db.withTenant(a.cabinetId, async (db) => {
        if (horloge) await regler(db, horloge);
        return (await db.query("SELECT purger_textes_ia($1, 10) AS n", [instant])).rows[0]
          .n as number;
      });
    // Sans horloge de test : une date lointaine (ou à plus d'une minute) est refusée, rien n'est purgé.
    for (const instant of [apres(4000), new Date(Date.now() + 5 * 60_000)]) {
      await expect(purge(instant)).rejects.toThrow(/futur/);
    }
    expect((await etat(g.id))[0]?.texte_purge_le).toBeNull();
    // Marge d'une minute (décalage d'horloge) et passé : acceptés.
    expect(await purge(new Date(Date.now() + 30_000))).toBe(0);
    expect(await purge(new Date(Date.now() - 1000))).toBe(0);
    // L'horloge de test déplace la référence, mais n'autorise pas un instant au-delà d'elle.
    await expect(purge(apres(4000), apres(10))).rejects.toThrow(/futur/);
    expect(await purge(apres(4000), apres(4000))).toBeGreaterThanOrEqual(1);
    expect((await etat(g.id))[0]?.texte).toBe("");
  });
});

describe("planification quotidienne", () => {
  it("un job par cabinet et par jour, seulement pour un cabinet ayant un texte échu", async () => {
    const c = await cabinetTest(ctx, "Cabinet IA planification");
    const vide = await cabinetTest(ctx, "Cabinet IA sans génération");
    await generer(c);
    const futur = apres(400);
    const p = planificationConservationIa(futur);
    expect(p.cle).toBe(`ia_conservation:${futur.toISOString().slice(0, 10)}`);
    const planifier = () =>
      ctx.db.withoutTenant(
        async (db) =>
          (await db.query("SELECT planifier_conservation_ia($1, $2) AS n", [p.cle, p.executeA]))
            .rows[0].n as number,
      );
    expect(await planifier()).toBeGreaterThanOrEqual(1);
    expect(await planifier()).toBe(0); // clé unique par cabinet et par jour
    const jobs = await proprietaire((cl) =>
      cl.query(
        `SELECT cabinet_id FROM jobs WHERE type = 'ia_conservation' AND cle = $1
         AND cabinet_id = ANY ($2)`,
        [p.cle, [c.cabinetId, vide.cabinetId]],
      ),
    );
    expect(jobs.rows.map((r) => r.cabinet_id)).toEqual([c.cabinetId]);
    await expect(
      ctx.db.withoutTenant((db) => db.query("SELECT planifier_conservation_ia('autre', now())")),
    ).rejects.toThrow(/Clé de conservation IA invalide/);
  });
});
