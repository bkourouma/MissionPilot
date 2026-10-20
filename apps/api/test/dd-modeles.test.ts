/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAFONDS_DD } from "@missionpilot/shared";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendu, creerDossierDd, INCONNU, preparerDd, type ScenarioDd } from "./dd-outils.js";
import { preparerPortail } from "./portail-outils.js";

/*
 * Modèles d'analyse par secteur (DD-07, migration 0511) : véhicule seul, vide par défaut. Droits par
 * rôle, isolation, ajout seul (MPZ21), versions sans trou (MPZ23), motif dès la v2, plafonds,
 * catégorie invalide (MQD11), portail fermé, modèle applicable à un dossier.
 */

let ctx: Contexte;
let s: ScenarioDd;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD modèles");
}, 240_000);
afterAll(() => ctx.fermer());

const corps = (extra: Record<string, unknown> = {}) => ({
  secteur_code: "citi_a",
  analyse: "pestel",
  points: [
    { categorie: "politique", libelle: "Quelle est la stabilité du cadre réglementaire ?" },
    { categorie: "juridique", libelle: "Quelles licences sont requises ?" },
  ],
  ...extra,
});

const refus = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

describe("vide par défaut et droits", () => {
  it("aucun modèle fourni : liste vide, aucune ligne en base", async () => {
    const l = attendu(200, await s.consultantEquipe.get("/api/dd/modeles-secteur"));
    expect(l.elements).toEqual([]);
    expect(l.curseur_suivant).toBeNull();
    const n = await proprietaire(
      async (c) =>
        (await c.query("SELECT (SELECT count(*) FROM dd_modeles_secteur)::int AS n")).rows[0].n,
    );
    expect(n).toBe(0);
  });

  it("401 ; écriture 403 (consultant, gestionnaire, chef) ; 201 (expert métier, directeur, associé)", async () => {
    expect((await api(ctx).get("/api/dd/modeles-secteur")).statusCode).toBe(401);
    expect((await api(ctx).post("/api/dd/modeles-secteur", corps())).statusCode).toBe(401);
    for (const u of [s.consultantEquipe, s.gestionnaire, s.a.chef]) {
      expect((await u.post("/api/dd/modeles-secteur", corps())).statusCode).toBe(403);
    }
    expect((await s.gestionnaire.get("/api/dd/modeles-secteur")).statusCode).toBe(403);
    attendu(
      201,
      await s.expertMetier.post(
        "/api/dd/modeles-secteur",
        corps({ analyse: "swot", points: [{ categorie: "forces", libelle: "Quels atouts ?" }] }),
      ),
    );
    attendu(
      201,
      await s.a.directeur.post(
        "/api/dd/modeles-secteur",
        corps({
          analyse: "cinq_forces",
          points: [{ categorie: "rivalite", libelle: "Combien d'acteurs ?" }],
        }),
      ),
    );
    attendu(
      201,
      await s.a.associe.post(
        "/api/dd/modeles-secteur",
        corps({
          analyse: "operationnelle",
          points: [{ categorie: "goulots", libelle: "Où sont les goulots ?" }],
        }),
      ),
    );
    const l = attendu(200, await s.consultantEquipe.get("/api/dd/modeles-secteur?limite=100"));
    expect(l.elements).toHaveLength(3);
  });
});

describe("création, lecture, validations", () => {
  it("unicité par secteur et analyse (MODELE_EXISTANT) ; autre cabinet indépendant et cloisonné", async () => {
    const c = attendu(201, await s.expertMetier.post("/api/dd/modeles-secteur", corps()));
    const r = await s.expertMetier.post("/api/dd/modeles-secteur", corps());
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("MODELE_EXISTANT");
    const b = attendu(201, await s.b.associe.post("/api/dd/modeles-secteur", corps()));
    const liste = attendu(200, await s.consultantEquipe.get("/api/dd/modeles-secteur?limite=100"));
    expect(liste.elements.some((e: any) => e.id === b.id)).toBe(false);
    expect(liste.elements.some((e: any) => e.id === c.id)).toBe(true);
    expect((await s.b.associe.get(`/api/dd/modeles-secteur/${c.id}`)).statusCode).toBe(404);
    expect((await s.b.associe.get(`/api/dd/modeles-secteur/${c.id}/versions`)).statusCode).toBe(
      404,
    );
    const lu = attendu(200, await s.consultantEquipe.get(`/api/dd/modeles-secteur/${c.id}`));
    expect(lu).toMatchObject({
      secteur_code: "citi_a",
      analyse: "pestel",
      version: 1,
      actif: true,
    });
    expect(lu.points).toHaveLength(2);
    expect((await s.consultantEquipe.get(`/api/dd/modeles-secteur/${INCONNU}`)).statusCode).toBe(
      404,
    );
  });

  it("filtres par secteur, analyse, état et pagination par curseur", async () => {
    const parSecteur = attendu(
      200,
      await s.consultantEquipe.get("/api/dd/modeles-secteur?secteur_code=citi_a&limite=100"),
    );
    expect(parSecteur.elements.length).toBeGreaterThan(0);
    expect(parSecteur.elements.every((e: any) => e.secteur_code === "citi_a")).toBe(true);
    const parAnalyse = attendu(
      200,
      await s.consultantEquipe.get("/api/dd/modeles-secteur?analyse=swot"),
    );
    expect(parAnalyse.elements.every((e: any) => e.analyse === "swot")).toBe(true);
    expect(
      attendu(200, await s.consultantEquipe.get("/api/dd/modeles-secteur?actif=false")).elements,
    ).toEqual([]);
    const p1 = attendu(200, await s.consultantEquipe.get("/api/dd/modeles-secteur?limite=2"));
    expect(p1.elements).toHaveLength(2);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = attendu(
      200,
      await s.consultantEquipe.get(
        `/api/dd/modeles-secteur?limite=2&curseur=${p1.curseur_suivant}`,
      ),
    );
    expect(p2.elements.every((e: any) => !p1.elements.some((x: any) => x.id === e.id))).toBe(true);
    expect((await s.consultantEquipe.get("/api/dd/modeles-secteur?limite=101")).statusCode).toBe(
      400,
    );
    expect((await s.consultantEquipe.get("/api/dd/modeles-secteur?curseur=%25")).statusCode).toBe(
      400,
    );
  });

  it("400 : secteur inconnu, analyse inconnue, champ inconnu, liste de points vide ou mal formée", async () => {
    for (const extra of [
      { secteur_code: "citi_zz" },
      { analyse: "autre" },
      { inconnu: 1 },
      { points: [] },
      { points: [{ categorie: "politique" }] },
      { points: [{ categorie: "politique", libelle: "" }] },
      { points: [{ categorie: "politique", libelle: "x".repeat(301) }] },
      { points: [{ categorie: "politique", libelle: "Q ?", montant: 1 }] },
    ]) {
      const r = await s.expertMetier.post(
        "/api/dd/modeles-secteur",
        corps({ secteur_code: "citi_b", analyse: "pestel", ...extra }),
      );
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
    }
    const r = await s.expertMetier.post(
      "/api/dd/modeles-secteur",
      corps({ secteur_code: "citi_zz" }),
    );
    expect(r.json().erreur.code).toBe("TAXONOMIE_INCONNUE");
  });

  it("point à catégorie invalide pour l'analyse refusé (API et base, MQD11)", async () => {
    const r = await s.expertMetier.post(
      "/api/dd/modeles-secteur",
      corps({
        secteur_code: "citi_b",
        points: [{ categorie: "forces", libelle: "Hors PESTEL ?" }],
      }),
    );
    expect(r.statusCode).toBe(400);
    const c = attendu(
      201,
      await s.expertMetier.post("/api/dd/modeles-secteur", corps({ secteur_code: "citi_b" })),
    );
    const v = await s.expertMetier.post(`/api/dd/modeles-secteur/${c.id}/versions`, {
      points: [{ categorie: "goulots", libelle: "Hors PESTEL ?" }],
      version_courante: 1,
      motif: "Essai.",
    });
    expect(v.statusCode).toBe(400);
    expect(v.json().erreur.code).toBe("POINT_MODELE_INVALIDE");
    const garde = (points: unknown) =>
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO dd_modele_secteur_versions (cabinet_id, modele_id, version, points, motif, cree_par)
           SELECT cabinet_id, id, 2, $1::jsonb, 'Essai.', cree_par FROM dd_modeles_secteur WHERE id = $2`,
          [JSON.stringify(points), c.id],
        ),
      );
    await refus(garde([{ categorie: "goulots", libelle: "Q ?" }]), "MQD11");
    await refus(garde([{ categorie: "politique", libelle: "Q ?", chiffre: 3 }]), "MQD11");
    await refus(garde([{ categorie: "politique", libelle: "   " }]), "MQD11");
    await refus(garde(["politique"]), "MQD11");
  });
});

describe("versions, retrait, ajout seul", () => {
  it("versions sans trou, motif dès la v2, version périmée, retrait puis réactivation, droits", async () => {
    const c = attendu(
      201,
      await s.expertMetier.post("/api/dd/modeles-secteur", corps({ secteur_code: "citi_c" })),
    );
    const url = `/api/dd/modeles-secteur/${c.id}/versions`;
    const v2 = {
      points: [{ categorie: "economique", libelle: "Quelle exposition aux prix mondiaux ?" }],
      version_courante: 1,
      motif: "Ajout d'un point.",
    };
    expect((await s.expertMetier.post(url, { ...v2, motif: undefined })).statusCode).toBe(400);
    expect(attendu(201, await s.expertMetier.post(url, v2)).version).toBe(2);
    expect((await s.expertMetier.post(url, v2)).json().erreur.code).toBe("VERSION_PERIMEE");
    attendu(
      201,
      await s.expertMetier.post(url, {
        ...v2,
        version_courante: 2,
        actif: false,
        motif: "Retiré.",
      }),
    );
    expect(
      attendu(200, await s.consultantEquipe.get(`/api/dd/modeles-secteur/${c.id}`)).actif,
    ).toBe(false);
    attendu(
      201,
      await s.expertMetier.post(url, { ...v2, version_courante: 3, motif: "Réactivé." }),
    );
    const versions = attendu(200, await s.consultantEquipe.get(`${url}`)).elements;
    expect(versions.map((v: any) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions.map((v: any) => v.motif)).toEqual([
      "Réactivé.",
      "Retiré.",
      "Ajout d'un point.",
      null,
    ]);
    expect((await s.consultantEquipe.post(url, { ...v2, version_courante: 4 })).statusCode).toBe(
      403,
    );
    expect((await s.b.associe.post(url, { ...v2, version_courante: 4 })).statusCode).toBe(404);
    const trous = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT array_agg(version ORDER BY version) AS v FROM dd_modele_secteur_versions WHERE modele_id = $1",
            [c.id],
          )
        ).rows[0].v,
    );
    expect(trous).toEqual([1, 2, 3, 4]);
    // MPZ23 : un trou dans la numérotation est refusé par la base.
    await refus(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO dd_modele_secteur_versions (cabinet_id, modele_id, version, points, motif, cree_par)
           SELECT cabinet_id, modele_id, 9, points, 'Trou.', cree_par FROM dd_modele_secteur_versions WHERE modele_id = $1 AND version = 1`,
          [c.id],
        ),
      ),
      "MPZ23",
    );
  });

  it("ajout seul : UPDATE et DELETE refusés (rôle applicatif : droit ; propriétaire : MPZ21)", async () => {
    for (const t of ["dd_modeles_secteur", "dd_modele_secteur_versions"]) {
      await expect(
        ctx.db.withTenant(s.a.cabinetId, (db) =>
          db.query(`UPDATE ${t} SET cabinet_id = cabinet_id`),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        ctx.db.withTenant(s.a.cabinetId, (db) => db.query(`DELETE FROM ${t}`)),
      ).rejects.toThrow(/permission denied/);
      await refus(
        proprietaire((cl) => cl.query(`UPDATE ${t} SET cabinet_id = cabinet_id`)),
        "MPZ21",
      );
      await refus(
        proprietaire((cl) => cl.query(`DELETE FROM ${t}`)),
        "MPZ21",
      );
    }
  });

  it("isolation en base : l'autre cabinet ne voit rien, n'écrit pas chez autrui, le portail est fermé", async () => {
    const propre = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query("SELECT 1 FROM dd_modeles_secteur"),
    );
    expect(propre.rows.length).toBeGreaterThan(0);
    for (const t of ["dd_modeles_secteur", "dd_modele_secteur_versions"]) {
      const autre = await ctx.db.withTenant(s.b.cabinetId, (db) =>
        db.query(`SELECT cabinet_id FROM ${t}`),
      );
      expect(
        autre.rows.every((r: any) => r.cabinet_id === s.b.cabinetId),
        t,
      ).toBe(true);
      const portail = await ctx.db.withTenant(s.a.cabinetId, async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [s.a.clientId]);
        return db.query(`SELECT 1 FROM ${t}`);
      });
      expect(portail.rows, t).toHaveLength(0);
    }
    await expect(
      ctx.db.withTenant(s.b.cabinetId, (db) =>
        db.query(
          `INSERT INTO dd_modeles_secteur (cabinet_id, secteur_code, "analyse", cree_par) VALUES ($1, 'citi_a', 'swot', $2)`,
          [s.a.cabinetId, s.a.associeId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("plafonds", () => {
  it("points par modèle (validation) ; modèles par cabinet (409 PLAFOND_ATTEINT) ; versions par modèle", async () => {
    const trop = Array.from({ length: PLAFONDS_DD.points_par_modele + 1 }, (_, i) => ({
      categorie: "politique",
      libelle: `Point ${i}`,
    }));
    expect(
      (
        await s.expertMetier.post(
          "/api/dd/modeles-secteur",
          corps({ secteur_code: "citi_b", analyse: "swot", points: trop }),
        )
      ).statusCode,
    ).toBe(400);
    const plein = Array.from({ length: PLAFONDS_DD.points_par_modele }, (_, i) => ({
      categorie: "politique",
      libelle: `Point ${i}`,
    }));
    attendu(
      201,
      await s.b.associe.post(
        "/api/dd/modeles-secteur",
        corps({ secteur_code: "citi_b", points: plein }),
      ),
    );

    // Plafond du cabinet : remplissage direct (propriétaire) du cabinet B jusqu'à la limite.
    const existants = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT count(*)::int AS n FROM dd_modeles_secteur WHERE cabinet_id = $1",
            [s.b.cabinetId],
          )
        ).rows[0].n as number,
    );
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO dd_modeles_secteur (cabinet_id, secteur_code, "analyse", cree_par)
         SELECT $1, 'plafond-' || g, 'pestel', $2 FROM generate_series(1, $3::int) g`,
        [s.b.cabinetId, s.b.associeId, PLAFONDS_DD.modeles_secteur_par_cabinet - existants],
      ),
    );
    const r = await s.b.associe.post(
      "/api/dd/modeles-secteur",
      corps({
        secteur_code: "citi_e",
        analyse: "swot",
        points: [{ categorie: "forces", libelle: "Quels atouts ?" }],
      }),
    );
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
  });
});

describe("modèle applicable à un dossier", () => {
  it("secteur du cadrage courant ; actifs seulement ; vide sans modèle ; filtre d'analyse ; droits", async () => {
    const d = (await creerDossierDd(s.consultantEquipe, s.missionId)).id; // secteur citi_a
    const l = attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d}/modeles-secteur`));
    expect(l.secteur_code).toBe("citi_a");
    const analyses = l.elements.map((e: any) => e.analyse).sort();
    expect(analyses).toEqual(["cinq_forces", "operationnelle", "pestel", "swot"]);
    expect(l.elements.every((e: any) => e.secteur_code === "citi_a" && e.actif)).toBe(true);
    const pestel = attendu(
      200,
      await s.consultantEquipe.get(`/api/dd/dossiers/${d}/modeles-secteur?analyse=pestel`),
    );
    expect(pestel.elements).toHaveLength(1);
    expect(pestel.elements[0].points[0]).toEqual({
      categorie: "politique",
      libelle: "Quelle est la stabilité du cadre réglementaire ?",
    });
    // Retrait du modèle SWOT : il n'est plus proposé.
    const swot = l.elements.find((e: any) => e.analyse === "swot");
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/modeles-secteur/${swot.id}/versions`, {
        points: swot.points,
        actif: false,
        version_courante: swot.version,
        motif: "Retiré.",
      }),
    );
    const apres = attendu(
      200,
      await s.consultantEquipe.get(`/api/dd/dossiers/${d}/modeles-secteur`),
    );
    expect(apres.elements.map((e: any) => e.analyse)).not.toContain("swot");
    // Dossier d'un secteur sans modèle (citi_c inconnu : cadrage sur citi_b sans filière, modèle absent pour pestel ailleurs).
    const sans = (
      await creerDossierDd(s.consultantEquipe, s.missionId, {
        secteur_code: "citi_d",
        filiere_code: null,
      })
    ).id;
    const vide = attendu(
      200,
      await s.consultantEquipe.get(`/api/dd/dossiers/${sans}/modeles-secteur`),
    );
    expect(vide.secteur_code).toBe("citi_d");
    expect(vide.elements).toEqual([]);
    expect(
      (await s.consultantEquipe.get(`/api/dd/dossiers/${d}/modeles-secteur?analyse=autre`))
        .statusCode,
    ).toBe(400);
    expect((await s.consultantHors.get(`/api/dd/dossiers/${d}/modeles-secteur`)).statusCode).toBe(
      404,
    );
    expect((await s.b.associe.get(`/api/dd/dossiers/${d}/modeles-secteur`)).statusCode).toBe(404);
    expect((await s.gestionnaire.get(`/api/dd/dossiers/${d}/modeles-secteur`)).statusCode).toBe(
      403,
    );
  });
});

describe("portail fermé", () => {
  it("un compte portail reçoit 403 PORTAIL_ROUTE_INTERDITE sur toutes les routes", async () => {
    const p = await preparerPortail(ctx);
    for (const [methode, url] of [
      ["get", "/api/dd/modeles-secteur"],
      ["get", `/api/dd/modeles-secteur/${INCONNU}`],
      ["get", `/api/dd/modeles-secteur/${INCONNU}/versions`],
      ["get", `/api/dd/dossiers/${INCONNU}/modeles-secteur`],
    ] as const) {
      const r = await p.dirigeant[methode](url);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().erreur.code, url).toBe("PORTAIL_ROUTE_INTERDITE");
    }
    for (const url of ["/api/dd/modeles-secteur", `/api/dd/modeles-secteur/${INCONNU}/versions`]) {
      const r = await p.dirigeant.post(url, {});
      expect(r.statusCode, url).toBe(403);
      expect(r.json().erreur.code, url).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  }, 120_000);
});
