import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import {
  CONTENU_CV,
  creerCv,
  INCONNU,
  preparerBanqueAo,
  type ScenarioBanqueAo,
} from "./banque-ao-outils.js";
import { demarrer, MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import { attendre } from "./portail-outils.js";

/*
 * Banque de CV (AO-04, lot AO-B) : profils et versions datées en ajout seul, années
 * d'expérience et contrôle des exigences par le moteur, gabarits par bailleur en données,
 * export Word par l'infrastructure de rapports ; droits, isolation entre cabinets.
 */

let ctx: Contexte;
let s: ScenarioBanqueAo;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerBanqueAo(ctx, "Banque CV");
}, 180_000);
afterAll(async () => {
  await ctx.fermer();
});

describe("droits", () => {
  it("401 sans session ; 403 sans ao.lire ou sans ao.gerer", async () => {
    const anonyme = api(ctx);
    expect((await anonyme.get("/api/banque-ao/cv")).statusCode).toBe(401);
    expect((await anonyme.post("/api/banque-ao/cv", {})).statusCode).toBe(401);
    for (const u of [s.ressources, s.externe]) {
      expect((await u.get("/api/banque-ao/cv")).statusCode).toBe(403);
      expect((await u.get("/api/banque-ao/gabarits-cv")).statusCode).toBe(403);
    }
    // Lecteurs sans ao.gerer : expert métier, gestionnaire.
    for (const u of [s.expert, s.gestionnaire]) {
      expect((await u.get("/api/banque-ao/cv")).statusCode).toBe(200);
      expect(
        (await u.post("/api/banque-ao/cv", { nom: "X", contenu: CONTENU_CV })).statusCode,
      ).toBe(403);
    }
  });

  it("corps invalide : 400 (champ inconnu, période inversée, mois invalide)", async () => {
    const post = (contenu: unknown, extra: Record<string, unknown> = {}) =>
      s.consultant.post("/api/banque-ao/cv", { nom: "X", contenu, ...extra });
    expect((await post(CONTENU_CV, { inconnu: 1 })).statusCode).toBe(400);
    const inverse = {
      ...CONTENU_CV,
      experiences: [{ ...CONTENU_CV.experiences[0], debut: "2020-01", fin: "2019-01" }],
    };
    expect((await post(inverse)).statusCode).toBe(400);
    const mois = {
      ...CONTENU_CV,
      experiences: [{ ...CONTENU_CV.experiences[0], debut: "2020-13" }],
    };
    expect((await post(mois)).statusCode).toBe(400);
  });
});

describe("profils et versions", () => {
  it("crée un CV rattaché à un collaborateur, calcule les années, liste et recherche", async () => {
    const collaborateurId = Object.values(s.a.collaborateurs)[0] as string;
    const cv = await creerCv(s.consultant, { collaborateur_id: collaborateurId });
    expect(cv.collaborateur_id).toBe(collaborateurId);
    expect(cv.courante.version).toBe(1);
    expect(cv.versions).toHaveLength(1);
    // 2010-01 → en cours : au moins 16 années complètes au 2026-10 (moteur banque-cv).
    expect(cv.annees_experience).toBeGreaterThanOrEqual(16);
    // Un seul CV par collaborateur.
    const doublon = await s.consultant.post("/api/banque-ao/cv", {
      nom: "Autre",
      collaborateur_id: collaborateurId,
      contenu: CONTENU_CV,
    });
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json().erreur.code).toBe("CV_EXISTANT");

    const liste = (
      await s.expert.get("/api/banque-ao/cv?secteur=gouvernance&langue=Anglais")
    ).json();
    expect(liste.elements.map((e: { id: string }) => e.id)).toContain(cv.id);
    const vide = (await s.expert.get("/api/banque-ao/cv?langue=Portugais")).json();
    expect(vide.elements.map((e: { id: string }) => e.id)).not.toContain(cv.id);
  });

  it("nouvelle version : motif obligatoire, versions consécutives, ancienne conservée", async () => {
    const cv = await creerCv(s.consultant, { nom: "Moussa Traoré" });
    const url = `/api/banque-ao/cv/${cv.id}/versions`;
    expect((await s.consultant.post(url, { contenu: CONTENU_CV })).statusCode).toBe(400);
    const r = await s.consultant.post(url, {
      contenu: { ...CONTENU_CV, titre: "Chef d'équipe gouvernance" },
      motif: "Mise à jour du titre",
    });
    attendre(201, r, "version");
    expect(r.json().courante).toMatchObject({ version: 2, motif: "Mise à jour du titre" });
    expect(r.json().courante.contenu.titre).toBe("Chef d'équipe gouvernance");
    expect(r.json().versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it("pagination par curseur", async () => {
    for (const nom of ["Zoé 1", "Zoé 2", "Zoé 3"]) await creerCv(s.consultant, { nom });
    const p1 = (await s.consultant.get("/api/banque-ao/cv?q=Zo&limite=2")).json();
    expect(p1.elements).toHaveLength(2);
    expect(p1.curseur_suivant).not.toBeNull();
    const p2 = (
      await s.consultant.get(`/api/banque-ao/cv?q=Zo&limite=2&curseur=${p1.curseur_suivant}`)
    ).json();
    expect(p2.elements).toHaveLength(1);
    expect(p2.curseur_suivant).toBeNull();
  });

  it("ajout seul en base (MPW01) et versions consécutives (MPW02), même pour le rôle applicatif", async () => {
    const cv = await creerCv(s.consultant, { nom: "Immuable" });
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE ao_cv_versions SET titre = 'x' WHERE cv_id = $1", [cv.id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      proprietaire((c) =>
        c.query("UPDATE ao_cv_versions SET titre = 'x' WHERE cv_id = $1", [cv.id]),
      ),
    ).rejects.toMatchObject({ code: "MPW01" });
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO ao_cv_versions (cabinet_id, cv_id, version, contenu, titre, motif, cree_par)
           VALUES ($1, $2, 3, '{}', 't', 'm', $3)`,
          [s.a.cabinetId, cv.id, s.a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPW02" });
  });
});

describe("contrôle des exigences (moteur banque-cv)", () => {
  it("conforme ou non, critère par critère, au mois de référence", async () => {
    const cv = await creerCv(s.consultant, { nom: "Contrôle" });
    const url = `/api/banque-ao/cv/${cv.id}/controle`;
    const ok = await s.expert.post(url, {
      annees_min: 10,
      annees_par_secteur: [{ secteur: "Finances publiques", annees: 5 }],
      niveau_diplome_min: "bac_5",
      langues: [{ langue: "anglais", niveau_min: "courant" }],
      experiences_bailleur: [{ bailleur: "Banque mondiale", nombre_min: 1 }],
      reference: "2026-10",
    });
    attendre(200, ok, "contrôle");
    expect(ok.json()).toMatchObject({
      conforme: true,
      annees_experience: 16,
      reference: "2026-10",
    });
    const ko = await s.expert.post(url, {
      annees_min: 20,
      niveau_diplome_min: "doctorat",
      reference: "2026-10",
    });
    expect(ko.json().conforme).toBe(false);
    expect(ko.json().criteres.map((c: { conforme: boolean }) => c.conforme)).toEqual([
      false,
      false,
    ]);
    expect((await s.expert.post(url, { annees_min: 61 })).statusCode).toBe(400);
  });
});

describe("gabarits par bailleur et export", () => {
  it("gabarits standard visibles ; gabarit du cabinet, code unique dans le cabinet", async () => {
    const liste = (await s.expert.get("/api/banque-ao/gabarits-cv")).json().elements;
    const codes = liste.map((g: { code: string }) => g.code);
    expect(codes).toEqual(
      expect.arrayContaining(["generique", "banque_mondiale", "bad", "union_europeenne"]),
    );
    const corps = {
      code: "afd_cabinet",
      libelle: "CV format AFD (cabinet)",
      bailleur: "Agence française de développement",
      sections: [
        { section: "identite", titre: "Identité" },
        { section: "experiences", titre: "Références de l'expert" },
      ],
      experiences_annees_max: 10,
    };
    expect((await s.expert.post("/api/banque-ao/gabarits-cv", corps)).statusCode).toBe(403);
    const r = await s.consultant.post("/api/banque-ao/gabarits-cv", corps);
    attendre(201, r, "gabarit");
    expect(r.json()).toMatchObject({ code: "afd_cabinet", standard: false });
    expect((await s.consultant.post("/api/banque-ao/gabarits-cv", corps)).statusCode).toBe(409);
    const doublon = { ...corps, code: "autre", sections: [corps.sections[0], corps.sections[0]] };
    expect((await s.consultant.post("/api/banque-ao/gabarits-cv", doublon)).statusCode).toBe(400);
    // Invisible de l'autre cabinet.
    const autres = (await s.b.associe.get("/api/banque-ao/gabarits-cv")).json().elements;
    expect(autres.map((g: { code: string }) => g.code)).not.toContain("afd_cabinet");
  });

  it("export Word au format d'un bailleur : pièce jointe journalisée sans contenu", async () => {
    const cv = await creerCv(s.consultant, { nom: "Export Word" });
    const r = await s.expert.get(
      `/api/banque-ao/cv/${cv.id}/export?gabarit=banque_mondiale&format=docx`,
    );
    attendre(200, r, "export");
    expect(r.headers["content-type"]).toContain("wordprocessingml");
    expect(String(r.headers["content-disposition"])).toContain("attachment");
    expect(r.rawPayload.subarray(0, 2).toString()).toBe("PK");
    expect(
      (await s.expert.get(`/api/banque-ao/cv/${cv.id}/export?gabarit=inconnu`)).statusCode,
    ).toBe(404);
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details FROM journal_audit WHERE action = 'export_cv' AND entite_id = $1",
            [cv.id],
          )
        ).rows,
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain("Ministère");
  });
});

describe("plafond de volume des gabarits du cabinet", () => {
  it("409 au-delà de 100 gabarits par cabinet", async () => {
    const associe = s.b.associe;
    const deja = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT count(*)::int AS n FROM ao_cv_gabarits WHERE cabinet_id = $1", [
            s.b.cabinetId,
          ])
        ).rows[0].n as number,
    );
    await proprietaire((c) =>
      c.query(
        `INSERT INTO ao_cv_gabarits (cabinet_id, code, libelle, bailleur, sections, cree_par)
         SELECT $1, 'plein_' || g, 'Gabarit ' || g, 'Bailleur',
           '[{"section":"identite","titre":"Identité"}]'::jsonb, $2
         FROM generate_series(1, 99 - $3::int) g`,
        [s.b.cabinetId, s.b.associeId, deja],
      ),
    );
    const corps = (code: string) => ({
      code,
      libelle: "Gabarit",
      bailleur: "Bailleur",
      sections: [{ section: "identite", titre: "Identité" }],
    });
    attendre(201, await associe.post("/api/banque-ao/gabarits-cv", corps("dernier")), "100e");
    const trop = await associe.post("/api/banque-ao/gabarits-cv", corps("de_trop"));
    expect(trop.statusCode).toBe(409);
    expect((await associe.get("/api/banque-ao/gabarits-cv")).json().elements.length).toBeLessThan(
      201,
    );
  });
});

describe("anonymisation d'un CV (départ d'une personne, droit à l'effacement)", () => {
  const url = (id: string) => `/api/banque-ao/cv/${id}/anonymisation`;
  const confirmation = { mot_de_passe: MOT_DE_PASSE_TEST };

  it("cabinet.gerer, reconfirmation d'identité, motif ; 404 hors cabinet", async () => {
    const cv = await creerCv(s.consultant, { nom: "Fatoumata Bamba" });
    const corps = { motif: "Départ du cabinet et demande d'effacement.", confirmation };
    expect((await api(ctx).post(url(cv.id), corps)).statusCode).toBe(401);
    expect((await s.consultant.post(url(cv.id), corps)).statusCode).toBe(403);
    expect((await s.gestionnaire.post(url(cv.id), corps)).statusCode).toBe(403);
    expect((await s.b.associe.post(url(cv.id), corps)).statusCode).toBe(404);
    expect((await s.a.associe.post(url(INCONNU), corps)).statusCode).toBe(404);
    expect((await s.a.associe.post(url(cv.id), { ...corps, motif: "" })).statusCode).toBe(400);
    const sans = await s.a.associe.post(url(cv.id), { motif: corps.motif });
    expect(sans.statusCode).toBe(403);
    expect(sans.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    const faux = await s.a.associe.post(url(cv.id), {
      motif: corps.motif,
      confirmation: { mot_de_passe: "Mauvais-mot-de-passe-1" },
    });
    expect(faux.statusCode).toBe(401);
    // Rien n'a été anonymisé par les refus.
    expect((await s.a.associe.get(`/api/banque-ao/cv/${cv.id}`)).json().nom).toBe(
      "Fatoumata Bamba",
    );
  });

  it("nom, contenu et motifs de toutes les versions effacés ; plus d'usage ; journal sans nom", async () => {
    // Un collaborateur sans CV (le premier sert à un test précédent).
    const collab = Object.values(s.a.collaborateurs)[1];
    const cv = await creerCv(s.consultant, { nom: "Mariam Ouattara", collaborateur_id: collab });
    attendre(
      201,
      await s.consultant.post(`/api/banque-ao/cv/${cv.id}/versions`, {
        contenu: { ...CONTENU_CV, resume: "Mariam Ouattara, ancienne cheffe de projet." },
        motif: "Mise à jour du parcours de Mariam",
      }),
      "version 2",
    );
    const r = await s.a.associe.post(url(cv.id), {
      motif: "Droit à l'effacement exercé par la personne.",
      confirmation,
    });
    attendre(200, r, "anonymisation");
    expect(r.json()).toMatchObject({ id: cv.id, anonymise: true, versions: 2 });

    const detail = (await s.expert.get(`/api/banque-ao/cv/${cv.id}`)).json();
    expect(detail).toMatchObject({ nom: "CV anonymisé", collaborateur_id: null, anonymise: true });
    expect(detail.annees_experience).toBe(0);
    const brut = JSON.stringify(detail);
    for (const interdit of ["Mariam", "Ouattara", "Conseiller budgétaire", "Master en gestion"]) {
      expect(brut).not.toContain(interdit);
    }
    expect(detail.versions.map((v: { motif: string | null }) => v.motif)).toEqual([
      "Anonymisation",
      null,
    ]);
    const liste = JSON.stringify((await s.expert.get("/api/banque-ao/cv?q=Mariam")).json());
    expect(liste).not.toContain("Mariam");
    // La liste porte l'indicateur : l'interface n'offre plus ce CV dans les choix d'équipe.
    const lignes = (await s.expert.get("/api/banque-ao/cv?q=anonymis")).json().elements;
    expect(lignes.find((x: { id: string }) => x.id === cv.id)).toMatchObject({ anonymise: true });

    // Plus d'usage : version, export, nouvelle anonymisation, offre : 409 CV_ANONYME.
    const version = await s.consultant.post(`/api/banque-ao/cv/${cv.id}/versions`, {
      contenu: CONTENU_CV,
      motif: "Retour",
    });
    expect(version.statusCode).toBe(409);
    expect(version.json().erreur.code).toBe("CV_ANONYME");
    expect(
      (await s.expert.get(`/api/banque-ao/cv/${cv.id}/export?gabarit=generique`)).statusCode,
    ).toBe(409);
    expect(
      (await s.a.associe.post(url(cv.id), { motif: "Encore une fois", confirmation })).statusCode,
    ).toBe(409);
    expect(
      (
        await s.consultant.post("/api/banque-ao/offres-techniques", {
          titre: "Offre",
          contexte: { client: "Client", termes_reference: "Termes de référence." },
          cv_ids: [cv.id],
        })
      ).statusCode,
    ).toBe(409);
    // Le collaborateur, détaché, peut recevoir un nouveau CV.
    attendre(
      201,
      await s.consultant.post("/api/banque-ao/cv", {
        nom: "Nouveau",
        collaborateur_id: collab,
        contenu: CONTENU_CV,
      }),
      "nouveau CV",
    );

    // Journal : motif, nombre de versions et facteur, jamais le nom ni le contenu.
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT action, details FROM journal_audit WHERE entite = 'ao_cv' AND entite_id = $1",
            [cv.id],
          )
        ).rows,
    );
    expect(audit.map((a) => a.action)).toContain("anonymisation_cv");
    expect(JSON.stringify(audit)).not.toContain("Mariam");
  });

  it("en base : seule l'anonymisation est admise, bornée au cabinet du contexte", async () => {
    const cv = await creerCv(s.consultant, { nom: "Base Protégée" });
    // Aucun UPDATE ni DELETE libre, même pour le propriétaire (MPW01).
    for (const sql of [
      "UPDATE ao_cv SET nom = 'x' WHERE id = $1",
      "UPDATE ao_cv SET anonymise_le = now() WHERE id = $1",
      "DELETE FROM ao_cv WHERE id = $1",
      "UPDATE ao_cv_versions SET anonymise_le = now() WHERE cv_id = $1",
      "UPDATE ao_cv_versions SET contenu = '{}', anonymise_le = now() WHERE cv_id = $1",
    ]) {
      await expect(
        proprietaire((c) => c.query(sql, [cv.id])),
        sql,
      ).rejects.toMatchObject({
        code: "MPW01",
      });
    }
    // Le rôle applicatif n'a toujours aucun droit UPDATE.
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE ao_cv SET nom = 'x' WHERE id = $1", [cv.id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Fonction SECURITY DEFINER : un autre cabinet ne l'atteint pas.
    await expect(
      ctx.db.withTenant(s.b.cabinetId, (db) => db.query("SELECT anonymiser_cv_ao($1)", [cv.id])),
    ).rejects.toMatchObject({ code: "MPW06" });
    expect((await s.a.associe.get(`/api/banque-ao/cv/${cv.id}`)).json().nom).toBe("Base Protégée");
    // Pas de nouvelle version sur un CV anonymisé, même en base (MPW06).
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query("SELECT anonymiser_cv_ao($1)", [cv.id]),
    );
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO ao_cv_versions (cabinet_id, cv_id, version, contenu, titre, motif, cree_par)
           VALUES ($1, $2, 2, '{}', 't', 'm', $3)`,
          [s.a.cabinetId, cv.id, s.a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPW06" });
  });
});

describe("isolation entre cabinets", () => {
  it("un CV d'un autre cabinet répond 404 (lecture, version, contrôle, export)", async () => {
    const cv = await creerCv(s.consultant, { nom: "Cloisonné" });
    const b = s.b.associe;
    expect((await b.get(`/api/banque-ao/cv/${cv.id}`)).statusCode).toBe(404);
    expect(
      (await b.post(`/api/banque-ao/cv/${cv.id}/versions`, { contenu: CONTENU_CV, motif: "x" }))
        .statusCode,
    ).toBe(404);
    expect((await b.post(`/api/banque-ao/cv/${cv.id}/controle`, {})).statusCode).toBe(404);
    expect((await b.get(`/api/banque-ao/cv/${cv.id}/export?gabarit=generique`)).statusCode).toBe(
      404,
    );
    expect((await b.get(`/api/banque-ao/cv/${INCONNU}`)).statusCode).toBe(404);
    const liste = (await b.get("/api/banque-ao/cv")).json().elements;
    expect(liste.map((e: { id: string }) => e.id)).not.toContain(cv.id);
    // Un collaborateur d'un autre cabinet ne se rattache pas.
    const collaborateurB = Object.values(s.b.collaborateurs)[0];
    const r = await s.consultant.post("/api/banque-ao/cv", {
      nom: "X",
      collaborateur_id: collaborateurB,
      contenu: CONTENU_CV,
    });
    expect(r.statusCode).toBe(400);
  });
});
