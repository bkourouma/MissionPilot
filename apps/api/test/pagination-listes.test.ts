import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cabinetTest, type Api, type CabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Pagination par curseur de GET /missions et GET /opportunites (dette « LIMIT 500
 * silencieux ») : tri `cree_le DESC, id DESC`, curseur (horodatage ISO à la
 * microseconde, id), `limite` 1–500 (défaut 100), `suivant` null en fin de liste.
 * Parcours complet sans doublon ni oubli, ordre stable malgré des dates de création
 * identiques ou distantes d'une microseconde, visibilité et isolation conservées,
 * index (cabinet_id, cree_le DESC, id DESC) (migration 0121, mineur 5 de l'audit).
 */

let ctx: Contexte;
let a: CabinetTest & { clientId: string };
let b: CabinetTest & { clientId: string };
let chefA: Api & { utilisateurId: string };

const N_MISSIONS = 230;
const N_OPPORTUNITES = 160;
const T0 = "2026-05-01T08:00:00.000000Z";

async function preparer(nom: string): Promise<CabinetTest & { clientId: string }> {
  const c = await cabinetTest(ctx, nom);
  const client = await c.associe.post("/api/clients", { raison_sociale: `Client ${nom}` });
  if (client.statusCode !== 201) throw new Error(client.body);
  return { ...c, clientId: client.json().id as string };
}

/** Missions semées en base : 4 par horodatage (égalités de date), un tiers confiées au chef. */
async function semerMissions(c: { cabinetId: string; clientId: string }, chefId: string | null) {
  await proprietaire((cl) =>
    cl.query(
      `INSERT INTO missions (cabinet_id, intitule, client_id, mode_facturation, statut, chef_id, cree_le)
       SELECT $1, 'Mission ' || g, $2, 'forfait',
              CASE WHEN g % 2 = 0 THEN 'opportunite' ELSE 'proposition' END,
              CASE WHEN g % 3 = 0 THEN $3::uuid END,
              $4::timestamptz - (g / 4) * interval '1 second'
       FROM generate_series(1, $5::int) g`,
      [c.cabinetId, c.clientId, chefId, T0, N_MISSIONS],
    ),
  );
}

async function semerOpportunites(c: { cabinetId: string; clientId: string }) {
  await proprietaire((cl) =>
    cl.query(
      `INSERT INTO opportunites (cabinet_id, client_id, intitule, montant_estime, etape, cree_le)
       SELECT $1, $2, 'Opportunité ' || g, g * 1000,
              CASE WHEN g % 2 = 0 THEN 'qualification' ELSE 'prospection' END,
              $3::timestamptz - (g / 5) * interval '1 millisecond'
       FROM generate_series(1, $4::int) g`,
      [c.cabinetId, c.clientId, T0, N_OPPORTUNITES],
    ),
  );
}

/** Ordre attendu, lu directement en base (propriétaire) : plus récentes d'abord, puis id décroissant. */
const attendus = (table: "missions" | "opportunites", cabinetId: string, filtre = "true") =>
  proprietaire(async (cl) =>
    (
      await cl.query(
        `SELECT id FROM ${table} WHERE cabinet_id = $1 AND ${filtre}
         ORDER BY cree_le DESC, id DESC`,
        [cabinetId],
      )
    ).rows.map((r) => r.id as string),
  );

/** Curseur forgé (même encodage que l'API : JSON en base64url). */
const curseurForge = (cle: unknown) =>
  encodeURIComponent(Buffer.from(JSON.stringify(cle), "utf8").toString("base64url"));

/** Suit `suivant` jusqu'au bout ; vérifie la taille de chaque page. */
async function parcourir(par: Api, chemin: string, limite: number) {
  const ids: string[] = [];
  let curseur: string | null = null;
  let pages = 0;
  do {
    const sep = chemin.includes("?") ? "&" : "?";
    const suite: string = curseur ? `&curseur=${encodeURIComponent(curseur)}` : "";
    const r = await par.get(`${chemin}${sep}limite=${limite}${suite}`);
    expect(r.statusCode, r.body).toBe(200);
    const corps = r.json() as { elements: { id: string }[]; suivant: string | null };
    expect(corps.elements.length).toBeLessThanOrEqual(limite);
    if (corps.suivant !== null) expect(corps.elements).toHaveLength(limite);
    ids.push(...corps.elements.map((e) => e.id));
    curseur = corps.suivant;
    pages += 1;
    if (pages > 500) throw new Error("Parcours sans fin");
  } while (curseur !== null);
  return { ids, pages };
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparer("Cabinet Pagination A");
  b = await preparer("Cabinet Pagination B");
  chefA = await a.avecRoles(["chef_mission"]);
  await semerMissions(a, chefA.utilisateurId);
  await semerMissions(b, null);
  await semerOpportunites(a);
  await semerOpportunites(b);
});
afterAll(async () => {
  await ctx.fermer();
});

describe("GET /missions : pagination par curseur", () => {
  it("parcours complet sans doublon ni oubli, dans l'ordre (date de création, id)", async () => {
    const attendu = await attendus("missions", a.cabinetId);
    expect(attendu.length).toBeGreaterThanOrEqual(N_MISSIONS);
    for (const limite of [7, 100, 500]) {
      const { ids, pages } = await parcourir(a.associe, "/api/missions", limite);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(attendu);
      expect(pages).toBe(Math.max(1, Math.ceil(attendu.length / limite)));
    }
  });

  it("appelant existant (sans paramètre) : 100 éléments par défaut et `suivant`", async () => {
    const r = await a.associe.get("/api/missions");
    expect(r.statusCode).toBe(200);
    expect(r.json().elements).toHaveLength(100);
    expect(typeof r.json().suivant).toBe("string");
    const fin = await a.associe.get(`/api/missions?limite=500`);
    expect(fin.json().suivant).toBeNull();
  });

  it("limite et curseur validés", async () => {
    for (const q of ["limite=0", "limite=501", "limite=abc", "curseur=pas-un-curseur"]) {
      expect((await a.associe.get(`/api/missions?${q}`)).statusCode, q).toBe(400);
    }
  });

  it("filtres et visibilité conservés à travers les pages", async () => {
    const opp = await parcourir(a.associe, "/api/missions?statut=opportunite", 9);
    expect(opp.ids).toEqual(await attendus("missions", a.cabinetId, "statut = 'opportunite'"));
    // Le chef ne voit que ses missions, page après page.
    const vues = await parcourir(chefA, "/api/missions", 11);
    expect(vues.ids).toEqual(
      await attendus("missions", a.cabinetId, `chef_id = '${chefA.utilisateurId}'`),
    );
    expect(vues.ids.length).toBe(Math.floor(N_MISSIONS / 3));
  });

  it("isolation : le curseur d'un cabinet ne révèle rien d'un autre", async () => {
    const pageA = (await a.associe.get("/api/missions?limite=50")).json();
    const idsA = new Set(await attendus("missions", a.cabinetId));
    const avecCurseurA = await b.associe.get(
      `/api/missions?limite=500&curseur=${encodeURIComponent(pageA.suivant)}`,
    );
    expect(avecCurseurA.statusCode).toBe(200);
    for (const m of avecCurseurA.json().elements) expect(idsA.has(m.id)).toBe(false);
    const toutB = await parcourir(b.associe, "/api/missions", 60);
    expect(toutB.ids).toEqual(await attendus("missions", b.cabinetId));
  });

  it("une mission créée pendant le parcours n'entraîne ni doublon ni oubli", async () => {
    const avant = await attendus("missions", a.cabinetId);
    const p1 = (await a.associe.get("/api/missions?limite=40")).json();
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO missions (cabinet_id, intitule, client_id, mode_facturation)
         VALUES ($1, 'Mission tardive', $2, 'forfait')`,
        [a.cabinetId, a.clientId],
      ),
    );
    let ids = p1.elements.map((m: { id: string }) => m.id) as string[];
    let curseur: string | null = p1.suivant;
    while (curseur) {
      const r = (
        await a.associe.get(`/api/missions?limite=40&curseur=${encodeURIComponent(curseur)}`)
      ).json();
      ids = [...ids, ...r.elements.map((m: { id: string }) => m.id)];
      curseur = r.suivant;
    }
    expect(ids).toEqual(avant); // la plus récente, créée après la 1re page, n'y revient pas
  });

  it("curseur à la microseconde : dates distantes d'une microseconde, sans doublon ni oubli", async () => {
    const c = await preparer("Cabinet Pagination Microsecondes");
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO missions (cabinet_id, intitule, client_id, mode_facturation, cree_le)
         SELECT $1, 'Mission µs ' || g, $2, 'forfait',
                $3::timestamptz + (g / 2) * interval '1 microsecond'
         FROM generate_series(1, 9) g`,
        [c.cabinetId, c.clientId, T0],
      ),
    );
    const attendu = await attendus("missions", c.cabinetId);
    expect(attendu).toHaveLength(9);
    for (const limite of [1, 2, 4]) {
      expect((await parcourir(c.associe, "/api/missions", limite)).ids).toEqual(attendu);
    }
    // Le curseur porte l'horodatage ISO à la microseconde de la dernière ligne servie.
    const page = (await c.associe.get("/api/missions?limite=1")).json();
    const [horodatage, id] = JSON.parse(Buffer.from(page.suivant, "base64url").toString("utf8"));
    expect(id).toBe(attendu[0]);
    expect(horodatage).toBe("2026-05-01T08:00:00.000004Z");
  });

  it("curseur forgé : date inexistante ou illisible → 400 (jamais 500) ; date valide acceptée", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    for (const chemin of ["/api/missions", "/api/opportunites"]) {
      for (const date of [
        "2026-02-31T00:00:00.000000Z",
        "2026-13-01T00:00:00.000000Z",
        "0000-01-01T00:00:00.000000Z",
        "2026-05-01T08:00:00.000Z",
        "pas une date",
      ]) {
        const r = await a.associe.get(`${chemin}?curseur=${curseurForge([date, id])}`);
        expect(r.statusCode, `${chemin} ${date}`).toBe(400);
      }
      const ok = await a.associe.get(
        `${chemin}?limite=5&curseur=${curseurForge(["2026-05-01T08:00:00.000001Z", id])}`,
      );
      expect(ok.statusCode, chemin).toBe(200);
    }
  });

  it("index (cabinet_id, cree_le DESC, id DESC) : présent et utilisable par la page suivante", async () => {
    for (const [table, index] of [
      ["missions", "missions_recentes_idx"],
      ["opportunites", "opportunites_recentes_idx"],
    ] as const) {
      const plan = await ctx.db.withTenant(a.cabinetId, async (db) => {
        await db.query("SET LOCAL enable_seqscan = off");
        await db.query("SET LOCAL enable_sort = off");
        const r = await db.query(
          `EXPLAIN SELECT t.id FROM ${table} t
           WHERE (t.cree_le, t.id) < ($1::timestamptz, $2::uuid)
           ORDER BY t.cree_le DESC, t.id DESC LIMIT 10`,
          [T0, "00000000-0000-4000-8000-000000000000"],
        );
        return r.rows.map((l) => l["QUERY PLAN"] as string).join("\n");
      });
      expect(plan, table).toContain(index);
      expect(plan, table).not.toMatch(/\bSort\b/);
    }
  });
});

describe("GET /opportunites : pagination par curseur", () => {
  it("parcours complet sans doublon ni oubli ; montants conservés", async () => {
    const attendu = await attendus("opportunites", a.cabinetId);
    expect(attendu).toHaveLength(N_OPPORTUNITES);
    for (const limite of [13, 100]) {
      const { ids } = await parcourir(a.associe, "/api/opportunites", limite);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(attendu);
    }
    const premiere = (await a.associe.get("/api/opportunites?limite=1")).json();
    expect(typeof premiere.elements[0].montant_estime).toBe("number");
  });

  it("défaut 100, bornes, filtre d'étape, droit pipeline.gerer et isolation", async () => {
    const r = await a.associe.get("/api/opportunites");
    expect(r.json().elements).toHaveLength(100);
    expect(r.json().suivant).not.toBeNull();
    expect((await a.associe.get("/api/opportunites?limite=501")).statusCode).toBe(400);
    expect((await a.associe.get("/api/opportunites?curseur=AAAA")).statusCode).toBe(400);
    const qualif = await parcourir(a.associe, "/api/opportunites?etape=qualification", 17);
    expect(qualif.ids).toEqual(
      await attendus("opportunites", a.cabinetId, "etape = 'qualification'"),
    );
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get("/api/opportunites")).statusCode).toBe(403);
    const idsA = new Set(await attendus("opportunites", a.cabinetId));
    const toutB = await parcourir(b.associe, "/api/opportunites", 70);
    expect(toutB.ids).toEqual(await attendus("opportunites", b.cabinetId));
    for (const id of toutB.ids) expect(idsA.has(id)).toBe(false);
  });
});
