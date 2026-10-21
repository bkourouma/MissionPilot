import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ObservatoireAgregats, ObservatoireCasePubliee } from "@missionpilot/shared";
import { api, cabinetTest, type Api, type CabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Observatoire inter-cabinets (CAP-04) : agrégats entre cinq cabinets (A, B, C, D adhérents, E
 * jamais adhérent). Seuils d'anonymat (5 entreprises ET 3 cabinets), attaque par différence entre
 * cases (marges des seules cases publiées), gel mensuel (seul le dernier versement d'un mois
 * ANTÉRIEUR compte), isolation (aucune ligne brute d'un autre cabinet), non-adhérent sans accès
 * ni contribution, appel direct de la fonction SQL, retrait d'adhésion à effet immédiat et
 * ré-adhésion sans réactivation. Les contributions sont semées par le propriétaire de la base
 * (versement réel : `observatoire.test.ts`), leur mois dérivé du mois courant.
 */

const B = "/api/observatoire";
const URL_AGREGATS = `${B}/agregats?indicateur=notation_score_global`;

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
let c: CabinetTest;
let d: CabinetTest;
let e: CabinetTest;
// Lecteur NEUTRE : adhérent sans contribution (ses lectures ne dépendent d'aucune de ses données).
let f: CabinetTest;
let directeurF: Api;

type Ligne = readonly [secteur: string, taille: string, valeur: number];

const repete = (n: number, l: Ligne): Ligne[] => Array.from({ length: n }, () => l);

/**
 * Contributions d'un cabinet adhérent, insérées par le propriétaire (le déclencheur exige
 * l'adhésion et impose le mois courant), puis reportées de `decalageMois` mois (déclencheur
 * suspendu dans la même transaction) pour simuler un versement d'un mois antérieur.
 */
async function semer(cab: CabinetTest, lignes: readonly Ligne[], decalageMois: number) {
  await proprietaire(async (cl) => {
    await cl.query("BEGIN");
    try {
      const r = await cl.query(
        `INSERT INTO obs_contributions (cabinet_id, indicateur, secteur, taille, valeur, periode, verse_par)
         SELECT $1, 'notation_score_global', x.s, x.t, x.v, obs_periode_courante(), $2
           FROM unnest($3::text[], $4::text[], $5::numeric[]) AS x(s, t, v)
         RETURNING id`,
        [
          cab.cabinetId,
          cab.associeId,
          lignes.map((l) => l[0]),
          lignes.map((l) => l[1]),
          lignes.map((l) => l[2]),
        ],
      );
      if (decalageMois !== 0) {
        await cl.query("ALTER TABLE obs_contributions DISABLE TRIGGER obs_contributions_controle");
        await cl.query(
          `UPDATE obs_contributions
              SET periode = (obs_periode_courante() + make_interval(months => $2))::date
            WHERE id = ANY($1::uuid[])`,
          [r.rows.map((x: { id: string }) => x.id), decalageMois],
        );
        await cl.query("ALTER TABLE obs_contributions ENABLE TRIGGER obs_contributions_controle");
      }
      await cl.query("COMMIT");
    } catch (erreur) {
      await cl.query("ROLLBACK");
      throw erreur;
    }
  });
}

async function adherer(cab: CabinetTest) {
  const r = await cab.associe.post(`${B}/adhesion`, { consentement: true });
  expect(r.statusCode, r.body).toBe(201);
}

async function lire(par: Api): Promise<ObservatoireAgregats> {
  const r = await par.get(URL_AGREGATS);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as ObservatoireAgregats;
}

function laCase(res: ObservatoireAgregats, secteur: string, taille: string) {
  const x = res.cases.find((k) => k.secteur === secteur && k.taille === taille);
  if (!x) throw new Error(`case ${secteur}/${taille} absente de la grille`);
  return x as ObservatoireCasePubliee & Record<string, unknown>;
}

/** Appel direct de `obs_agregats` par le rôle applicatif, dans le contexte d'un cabinet. */
function appelDirect(cabinetId: string, portailClientId?: string) {
  return ctx.db.withTenant(cabinetId, async (db) => {
    if (portailClientId) {
      await db.query("SELECT set_config('app.portail_client_id', $1, true)", [portailClientId]);
    }
    return db.query("SELECT * FROM obs_agregats('notation_score_global')");
  });
}

let agregatsInitiaux: ObservatoireAgregats;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Obs A");
  b = await cabinetTest(ctx, "Obs B");
  c = await cabinetTest(ctx, "Obs C");
  d = await cabinetTest(ctx, "Obs D");
  e = await cabinetTest(ctx, "Obs E");
  f = await cabinetTest(ctx, "Obs F");
  directeurF = await f.avecRoles(["directeur_mission"]);
  for (const cab of [a, b, c, d, f]) await adherer(cab);

  // Mois précédent (retenu) :
  // agriculture/pme : A 2, B 2, C 1 → 5 entreprises, 3 cabinets : PUBLIÉE ;
  // commerce/pme : A 4, B 3, C 3 → 10 entreprises, 3 cabinets : PUBLIÉE (détaillée) ;
  // industrie/pme : A 3, B 3 → 6 entreprises, 2 cabinets : MASQUÉE (cabinets) ;
  // btp/tpe : A, B, C, D une chacun → 4 entreprises, 4 cabinets : MASQUÉE (entreprises) ;
  // finance/eti : B 2, C 1 → masquée (les 2 de A sont d'un mois plus ancien, non retenus).
  await semer(
    a,
    [
      ["agriculture", "pme", 40],
      ["agriculture", "pme", 50],
      ["commerce", "pme", 10],
      ["commerce", "pme", 20],
      ["commerce", "pme", 30],
      ["commerce", "pme", 40],
      ...repete(3, ["industrie", "pme", 30]),
      ["btp", "tpe", 50],
    ],
    -1,
  );
  await semer(
    b,
    [
      ["agriculture", "pme", 60],
      ["agriculture", "pme", 70],
      ["commerce", "pme", 50],
      ["commerce", "pme", 60],
      ["commerce", "pme", 70],
      ...repete(3, ["industrie", "pme", 90]),
      ["btp", "tpe", 50],
      ...repete(2, ["finance", "eti", 50]),
    ],
    -1,
  );
  await semer(
    c,
    [
      ["agriculture", "pme", 80],
      ["commerce", "pme", 80],
      ["commerce", "pme", 90],
      ["commerce", "pme", 100],
      ["btp", "tpe", 50],
      ["finance", "eti", 50],
    ],
    -1,
  );
  await semer(d, [["btp", "tpe", 50]], -1);
  // Plus ancien (deux mois) : A complèterait finance/eti, mais seul son dernier mois compte.
  await semer(a, repete(2, ["finance", "eti", 50]), -2);
  // Le lecteur neutre est CONTRIBUTEUR (accès réservé aux contributeurs), dans une case à lui seul.
  await semer(f, [["autres", "grande_entreprise", 50]], -1);
  agregatsInitiaux = await lire(f.associe);
}, 240_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("seuils d'anonymat : 5 entreprises issues d'au moins 3 cabinets", () => {
  it("grille complète ; case sous seuil sans valeur ni effectif (vide et masquée indiscernables)", () => {
    const res = agregatsInitiaux;
    expect(res.cases).toHaveLength(res.secteurs.length * res.tailles.length);
    expect(res.seuils).toEqual({ entreprises_min: 5, cabinets_min: 3, effectif_detaille: 10 });
    const publiees = res.cases.filter((x) => x.statut === "publiee");
    expect(publiees.map((x) => `${x.secteur}/${x.taille}`).sort()).toEqual([
      "agriculture/pme",
      "commerce/pme",
    ]);
    for (const [secteur, taille] of [
      ["industrie", "pme"], // 6 entreprises mais 2 cabinets
      ["btp", "tpe"], // 4 cabinets mais 4 entreprises
      ["finance", "eti"], // contributions trop anciennes de A ignorées
      ["services", "eti"], // case vide
    ] as const) {
      expect(laCase(res, secteur, taille)).toEqual({
        secteur,
        taille,
        statut: "effectif_insuffisant",
      });
    }
  });

  it("valeurs arrondies ; quartiles et répartition seulement dès 10 entreprises", () => {
    const agri = laCase(agregatsInitiaux, "agriculture", "pme");
    expect(agri).toMatchObject({ statut: "publiee", effectif_minimum: 5, moyenne: 60 });
    expect(agri.q1).toBeNull();
    expect(agri.q3).toBeNull();
    expect(agri.repartition).toBeNull();
    const commerce = laCase(agregatsInitiaux, "commerce", "pme");
    expect(commerce).toMatchObject({ statut: "publiee", effectif_minimum: 10, moyenne: 55 });
    expect(commerce.q1).not.toBeNull();
    expect(commerce.repartition).toEqual([0, 10, 10, 10, 10, 10, 10, 10, 10, 20]);
  });

  it("aucune ligne brute, aucun identifiant ni effectif de cabinet dans la réponse", () => {
    const texte = JSON.stringify(agregatsInitiaux);
    for (const cab of [a, b, c, d, e]) {
      expect(texte).not.toContain(cab.cabinetId);
      expect(texte).not.toContain(cab.associeId);
    }
    expect(texte).not.toMatch(
      /client|"id"|valeur|verse|somme|histogramme|effectif_cabinets|effectif_entreprises|_autres/i,
    );
  });
});

describe("attaque par différence entre cases", () => {
  it("les marges n'agrègent que les cases publiées : marge − cases publiées = 0", () => {
    const { marges } = agregatsInitiaux;
    const pme = marges.par_taille.find((m) => m.taille === "pme");
    // 5 + 10 entreprises publiées ; avec industrie/pme (masquée, 6) la marge serait de 21.
    expect(pme).toMatchObject({ cases_publiees: 2, effectif_minimum: 15, moyenne: 57 });
    expect(marges.par_taille.map((m) => m.taille)).toEqual(["pme"]);
    expect(marges.par_secteur.map((m) => m.secteur)).toEqual(["agriculture", "commerce"]);
    expect(marges.par_secteur.find((m) => m.secteur === "agriculture")).toMatchObject({
      cases_publiees: 1,
      effectif_minimum: 5,
      moyenne: 60,
    });
    expect(marges.ensemble).toMatchObject({ cases_publiees: 2, effectif_minimum: 15, moyenne: 57 });
  });

  it("la fonction SQL elle-même ne renvoie aucune case sous seuil", async () => {
    const r = await appelDirect(f.cabinetId);
    expect(r.rows.map((x) => `${x.secteur}/${x.taille}`).sort()).toEqual([
      "agriculture/pme",
      "commerce/pme",
    ]);
    for (const x of r.rows) {
      expect(Object.keys(x).sort()).toEqual([
        "effectif_cabinets",
        "effectif_cabinets_autres",
        "effectif_entreprises",
        "effectif_entreprises_autres",
        "histogramme",
        "secteur",
        "somme",
        "taille",
      ]);
      expect(x.effectif_entreprises).toBeGreaterThanOrEqual(5);
      expect(x.effectif_cabinets).toBeGreaterThanOrEqual(3);
      expect(x.effectif_entreprises_autres).toBeGreaterThanOrEqual(5);
      expect(x.effectif_cabinets_autres).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("gel mensuel (différence temporelle)", () => {
  it("un versement du mois courant ne change pas les agrégats avant le mois suivant", async () => {
    await semer(d, repete(5, ["industrie", "pme", 10]), 0);
    await semer(a, repete(5, ["finance", "eti", 10]), 0);
    expect(await lire(f.associe)).toEqual(agregatsInitiaux);
  });
});

describe("droits et adhésion", () => {
  it("le directeur de mission d'un cabinet adhérent lit les agrégats", async () => {
    expect(await lire(directeurF)).toEqual(agregatsInitiaux);
  });

  it("cabinet non adhérent : 403 sur les agrégats, aucun versement, aucune contribution", async () => {
    const r = await e.associe.get(URL_AGREGATS);
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("OBSERVATOIRE_RESERVE_ADHERENTS");
    expect(r.body).not.toMatch(/agriculture|commerce|moyenne/);
    const v = await e.associe.post(`${B}/contributions`, {});
    expect(v.statusCode).toBe(409);
    expect(v.json().erreur.code).toBe("OBSERVATOIRE_ADHESION_INACTIVE");
    // Même par le rôle applicatif en direct, le déclencheur refuse (MQK22).
    await expect(
      ctx.db.withTenant(e.cabinetId, (db) =>
        db.query(
          `INSERT INTO obs_contributions (cabinet_id, indicateur, secteur, taille, valeur, periode, verse_par)
           VALUES ($1, 'notation_score_global', 'commerce', 'pme', 50, obs_periode_courante(), $2)`,
          [e.cabinetId, e.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQK22" });
    const n = await proprietaire((cl) =>
      cl.query("SELECT count(*)::int AS n FROM obs_contributions WHERE cabinet_id = $1", [
        e.cabinetId,
      ]),
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("appel direct de la fonction SQL : refusé au non-adhérent, hors cabinet et au portail", async () => {
    await expect(appelDirect(e.cabinetId)).rejects.toMatchObject({ code: "MQK25" });
    await expect(
      ctx.db.withoutTenant((db) => db.query("SELECT * FROM obs_agregats('notation_score_global')")),
    ).rejects.toMatchObject({ code: "MQK24" });
    await expect(appelDirect(a.cabinetId, a.cabinetId)).rejects.toMatchObject({ code: "MQK24" });
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("SELECT * FROM obs_agregats('autre')")),
    ).rejects.toMatchObject({ code: "MQK26" });
  });

  it("indicateur inconnu : 400 ; anonyme : 401", async () => {
    expect((await a.associe.get(`${B}/agregats?indicateur=autre`)).statusCode).toBe(400);
    expect((await api(ctx).get(URL_AGREGATS)).statusCode).toBe(401);
  });
});

describe("isolation entre cabinets", () => {
  it("le rôle applicatif ne voit que les contributions et l'adhésion de son cabinet", async () => {
    const vues = await ctx.db.withTenant(a.cabinetId, async (db) => ({
      contributions: (await db.query("SELECT DISTINCT cabinet_id FROM obs_contributions")).rows,
      adhesions: (await db.query("SELECT DISTINCT cabinet_id FROM obs_adhesion_evenements")).rows,
      autre: (await db.query("SELECT obs_adhesion_active($1) AS active", [b.cabinetId])).rows[0],
    }));
    expect(vues.contributions).toEqual([{ cabinet_id: a.cabinetId }]);
    expect(vues.adhesions).toEqual([{ cabinet_id: a.cabinetId }]);
    // L'adhésion d'un autre cabinet ne se lit pas (RLS) : toujours « faux ».
    expect(vues.autre.active).toBe(false);
  });

  it("le résumé des contributions ne porte que sur le cabinet appelant", async () => {
    const r = await a.associe.get(`${B}/contributions/resume`);
    expect(r.statusCode, r.body).toBe(200);
    const resume = r.json();
    expect(resume.retenu.nombre).toBe(10);
    expect(resume.en_attente.nombre).toBe(5);
    expect(resume.par_case).toEqual([{ secteur: "finance", taille: "eti", nombre: 5 }]);
    const total = await b.associe.get(`${B}/contributions/resume`);
    expect(total.json().retenu.nombre).toBe(11);
    expect(total.json().en_attente).toBeNull();
  });
});

describe("retrait d'adhésion", () => {
  it("le retrait de C exclut AUSSITÔT ses contributions : les cases repassent sous 3 cabinets", async () => {
    const r = await c.associe.post(`${B}/adhesion/retrait`, { motif: "Fin de participation" });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().active).toBe(false);
    const apres = await lire(f.associe);
    expect(apres.cases.every((x) => x.statut === "effectif_insuffisant")).toBe(true);
    expect(apres.marges).toEqual({ par_secteur: [], par_taille: [], ensemble: null });
    // C ne lit plus rien.
    expect((await c.associe.get(URL_AGREGATS)).statusCode).toBe(403);
    // Ses contributions restent à lui (il peut les retirer) mais n'alimentent plus rien.
    expect((await c.associe.get(`${B}/contributions/resume`)).json().adhesion_active).toBe(false);
  });

  it("la ré-adhésion ne réactive pas les contributions antérieures : il faut verser à nouveau", async () => {
    await adherer(c);
    const refus = await c.associe.get(URL_AGREGATS);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("OBSERVATOIRE_CONTRIBUTION_REQUISE");
    const resume = (await c.associe.get(`${B}/contributions/resume`)).json();
    expect(resume.adhesion_active).toBe(true);
    expect(resume.retenu).toBeNull();
  });

  it("retirer ses contributions : effet immédiat, réservé au cabinet lui-même", async () => {
    const r = await b.associe.delete(`${B}/contributions`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().retirees).toBe(11);
    const restantes = await proprietaire((cl) =>
      cl.query(
        `SELECT cabinet_id, count(*)::int AS n FROM obs_contributions
          WHERE cabinet_id = ANY($1::uuid[]) GROUP BY cabinet_id`,
        [[a.cabinetId, b.cabinetId]],
      ),
    );
    expect(restantes.rows).toEqual([{ cabinet_id: a.cabinetId, n: 17 }]);
  });
});

describe("règle de dominance : seuils calculés hors du cabinet appelant", () => {
  // Case numerique/grande_entreprise, jamais utilisée ailleurs :
  // G, H, I (2 entreprises chacun, 6 au total, 3 cabinets), puis J (2 de plus, 4 cabinets).
  let g: CabinetTest;
  let h: CabinetTest;
  let i: CabinetTest;
  let j: CabinetTest;
  const CASE = ["numerique", "grande_entreprise"] as const;
  const lignes = (valeur: number): Ligne[] => repete(2, [CASE[0], CASE[1], valeur]);

  beforeAll(async () => {
    g = await cabinetTest(ctx, "Obs G");
    h = await cabinetTest(ctx, "Obs H");
    i = await cabinetTest(ctx, "Obs I");
    j = await cabinetTest(ctx, "Obs J");
    for (const cab of [g, h, i, j]) await adherer(cab);
    await semer(g, lignes(20), -1);
    await semer(h, lignes(40), -1);
    await semer(i, lignes(60), -1);
  }, 120_000);

  it("3 cabinets dont l'appelant : masquée pour chacun d'eux, publiée pour un tiers neutre", async () => {
    for (const cab of [g, h, i]) {
      const res = await lire(cab.associe);
      expect(laCase(res, ...CASE)).toEqual({
        secteur: CASE[0],
        taille: CASE[1],
        statut: "effectif_insuffisant",
      });
      expect(res.marges.ensemble).toBeNull();
    }
    // Un lecteur qui ne contribue pas voit les 3 cabinets et leurs 6 entreprises.
    expect(laCase(await lire(f.associe), ...CASE)).toMatchObject({
      statut: "publiee",
      effectif_minimum: 5,
      moyenne: 40,
    });
    // La fonction SQL ne renvoie rien à l'appelant G, tandis que F reçoit la case.
    const pourG = await appelDirect(g.cabinetId);
    expect(pourG.rows.find((x) => x.secteur === CASE[0])).toBeUndefined();
    const pourF = await appelDirect(f.cabinetId);
    expect(pourF.rows.find((x) => x.secteur === CASE[0])).toMatchObject({
      effectif_entreprises: 6,
      effectif_cabinets: 3,
      effectif_entreprises_autres: 6,
      effectif_cabinets_autres: 3,
    });
  });

  it("4 cabinets dont l'appelant : publiée pour chacun (3 autres cabinets, 6 entreprises)", async () => {
    await semer(j, lignes(80), -1);
    const res = await lire(g.associe);
    expect(laCase(res, ...CASE)).toMatchObject({ statut: "publiee", effectif_minimum: 5 });
    const ligne = (await appelDirect(g.cabinetId)).rows.find((x) => x.secteur === CASE[0]);
    expect(ligne).toMatchObject({
      effectif_entreprises: 8,
      effectif_cabinets: 4,
      effectif_entreprises_autres: 6,
      effectif_cabinets_autres: 3,
    });
    // Attaque par différence : la marge de G ne compte que les cases publiées POUR G.
    expect(res.marges.ensemble).toMatchObject({
      cases_publiees: res.cases.filter((x) => x.statut === "publiee").length,
    });
  });
});

describe("accès réservé aux contributeurs (décision n° 1)", () => {
  let k: CabinetTest;

  beforeAll(async () => {
    k = await cabinetTest(ctx, "Obs K");
    await adherer(k);
  }, 60_000);

  it("adhérent sans contribution éligible : 403 explicite, API et fonction SQL (MQK27)", async () => {
    const r = await k.associe.get(URL_AGREGATS);
    expect(r.statusCode, r.body).toBe(403);
    expect(r.json().erreur.code).toBe("OBSERVATOIRE_CONTRIBUTION_REQUISE");
    expect(r.json().erreur.message).toMatch(/Versez d'abord vos données/);
    expect(r.body).not.toMatch(/agriculture|commerce|moyenne/);
    await expect(appelDirect(k.cabinetId)).rejects.toMatchObject({ code: "MQK27" });
  });

  it("un versement du mois courant n'ouvre pas l'accès avant le mois suivant (gel mensuel)", async () => {
    await semer(k, repete(2, ["services", "tpe", 40]), 0);
    expect((await k.associe.get(URL_AGREGATS)).statusCode).toBe(403);
    await expect(appelDirect(k.cabinetId)).rejects.toMatchObject({ code: "MQK27" });
  });

  it("une contribution d'un mois clos ouvre l'accès", async () => {
    await semer(k, repete(2, ["services", "tpe", 40]), -1);
    expect((await k.associe.get(URL_AGREGATS)).statusCode).toBe(200);
  });

  it("un cabinet non adhérent reste refusé comme non adhérent", async () => {
    const r = await e.associe.get(URL_AGREGATS);
    expect(r.json().erreur.code).toBe("OBSERVATOIRE_RESERVE_ADHERENTS");
  });
});
