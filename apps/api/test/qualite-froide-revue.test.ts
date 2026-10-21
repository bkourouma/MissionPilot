/* eslint-disable @typescript-eslint/no-explicit-any */
import { calculerRevueFroide } from "@missionpilot/engines";
import { CRITERES_REVUE_FROIDE } from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import type { ApiUtilisateur } from "./missions-outils.js";
import {
  attendre,
  cles,
  creerCampagne,
  echantillonDe,
  evaluerTout,
  missionAvecCasquette,
  P,
  preparerFroide,
  type CasViolation,
  type ScenarioFroide,
} from "./qualite-froide-outils.js";

/*
 * Revue à froid (QUA-05), relecture : séparation des tâches (API et base), affectation, accès au
 * dossier, grille, score et conclusion du moteur, revue figée, FIN-02 dans le dossier.
 */

const CAS: CasViolation[] = [
  "DIRECTEUR",
  "CHEF",
  "EQUIPE",
  "AFFECTE",
  "CREATEUR",
  "CLOTURE",
  "SIGNATAIRE",
  "INTERVENANT_QUALITE",
];

let ctx: Contexte;
let s: ScenarioFroide;
let campagne: any;
const candidats = new Map<CasViolation, ApiUtilisateur>();
const missionsCas = new Map<CasViolation, string>();
let echA: string; // affectée au relecteur indépendant `tiers`
let echB: string; // affectée à `tiers2`

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerFroide(ctx, "Froide Revue", 4);
  for (const cas of CAS) {
    const u = await s.c.avecRoles([cas === "SIGNATAIRE" ? "associe" : "expert_metier"]);
    candidats.set(cas, u);
    missionsCas.set(cas, await missionAvecCasquette(s.c, cas, u));
  }
  campagne = await creerCampagne(s.c.associe);
  echA = echantillonDe(campagne, s.missions[0]).id;
  echB = echantillonDe(campagne, s.missions[1]).id;
});
afterAll(async () => {
  await ctx.fermer();
});

const affecter = (u: ApiUtilisateur | { utilisateurId: string }, ech: string) =>
  s.c.associe.post(`${P}/echantillons/${ech}/affectation`, { relecteur_id: u.utilisateurId });

describe("séparation des tâches : l'API refuse, la base aussi", () => {
  for (const cas of CAS) {
    it(`${cas} : refusé à l'affectation (409 avec les violations) et par le déclencheur MQQ03`, async () => {
      const u = candidats.get(cas) as ApiUtilisateur;
      const ech = echantillonDe(campagne, missionsCas.get(cas) as string).id;
      const liste = await s.c.associe.get(`${P}/echantillons/${ech}/relecteurs-eligibles`);
      expect(liste.statusCode, liste.body).toBe(200);
      const ligne = liste.json().relecteurs.find((r: { id: string }) => r.id === u.utilisateurId);
      expect(ligne.eligible).toBe(false);
      expect(ligne.violations.map((v: { code: string }) => v.code)).toContain(cas);
      expect(ligne.violations[0]).toHaveProperty("message");

      const r = await affecter(u, ech);
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().erreur.code).toBe("RELECTEUR_NON_INDEPENDANT");
      expect(r.json().erreur.details.violations.map((v: { code: string }) => v.code)).toContain(
        cas,
      );

      // Même en contournant l'API (propriétaire de la base) : SQLSTATE MQQ03.
      await expect(
        proprietaire((cl) =>
          cl.query(
            `UPDATE qualite_froide_echantillon
             SET relecteur_id = $2, affecte_par = $3, affecte_le = now(), statut = 'affectee'
             WHERE id = $1`,
            [ech, u.utilisateurId, s.c.associeId],
          ),
        ),
      ).rejects.toMatchObject({ code: "MQQ03" });
      const apres = await s.c.associe.get(`${P}/echantillons/${ech}`);
      expect(apres.json().echantillon).toMatchObject({ statut: "a_affecter", relecteur: null });
    });
  }

  it("insertion directe d'une revue déjà affectée à un directeur de la mission : MQQ03", async () => {
    const petite = await creerCampagne(s.c.associe, { taille: 1, graine: "insertion" });
    const dejaTiree = petite.echantillon.map((e: { mission_id: string }) => e.mission_id);
    const mission = missionsCas.get("DIRECTEUR") as string;
    // Population complète : si la mission est déjà tirée par la petite campagne, prendre une autre casquette.
    const cible = dejaTiree.includes(mission) ? (missionsCas.get("CHEF") as string) : mission;
    const u = candidats.get(dejaTiree.includes(mission) ? "CHEF" : "DIRECTEUR") as ApiUtilisateur;
    await expect(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO qualite_froide_echantillon
             (cabinet_id, campagne_id, mission_id, rang, cle, relecteur_id, affecte_par, affecte_le, statut)
           VALUES ($1, $2, $3, 50, 'bbbbbbbbbbbbbb', $4, $5, now(), 'affectee')`,
          [s.c.cabinetId, petite.id, cible, u.utilisateurId, s.c.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ03" });
  });

  it("un tiers indépendant est accepté ; la ré-affectation est possible avant la fin", async () => {
    const r = await affecter(s.tiers, echA);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().echantillon).toMatchObject({
      statut: "affectee",
      relecteur: { id: s.tiers.utilisateurId },
    });
    const n = await proprietaire((cl) =>
      cl.query(
        "SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1 AND type = 'revue_froide_affectee'",
        [s.tiers.utilisateurId],
      ),
    );
    expect(n.rows[0].n).toBe(1);
    // Ré-affectation vers un autre indépendant, puis retour.
    const r2 = await affecter(s.tiers2, echA);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r2.json().echantillon.relecteur.id).toBe(s.tiers2.utilisateurId);
    expect((await affecter(s.tiers, echA)).statusCode).toBe(200);
    expect((await affecter(s.tiers2, echB)).statusCode).toBe(200);
  });

  it("refuse un relecteur sans le droit, inactif, ou inconnu", async () => {
    for (const u of [s.c.chef, s.consultant, s.gestionnaire]) {
      const r = await affecter(u, echantillonDe(campagne, s.missions[2]).id);
      expect(r.statusCode).toBe(409);
      expect(r.json().erreur.code).toBe("RELECTEUR_NON_HABILITE");
    }
    const inactif = await s.c.avecRoles(["expert_metier"]);
    await proprietaire((cl) =>
      cl.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [inactif.utilisateurId]),
    );
    const r = await affecter(inactif, echantillonDe(campagne, s.missions[2]).id);
    expect(r.statusCode).toBe(409);
    const inconnu = await affecter(
      { utilisateurId: "00000000-0000-4000-8000-000000000000" },
      echantillonDe(campagne, s.missions[2]).id,
    );
    expect(inconnu.statusCode).toBe(404);
    // La base refuse aussi un relecteur sans rôle habilité.
    await expect(
      proprietaire((cl) =>
        cl.query(
          `UPDATE qualite_froide_echantillon
           SET relecteur_id = $2, affecte_par = $3, affecte_le = now(), statut = 'affectee' WHERE id = $1`,
          [echantillonDe(campagne, s.missions[2]).id, s.consultant.utilisateurId, s.c.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ07" });
  });

  it("l'affectation exige qualite.froide.gerer", async () => {
    for (const u of [s.tiers, s.tiers2, s.c.directeur, s.c.chef, s.consultant]) {
      const r = await u.post(`${P}/echantillons/${echA}/affectation`, {
        relecteur_id: s.tiers.utilisateurId,
      });
      expect(r.statusCode).toBe(403);
      expect((await u.get(`${P}/echantillons/${echA}/relecteurs-eligibles`)).statusCode).toBe(403);
    }
  });
});

describe("accès à une revue", () => {
  it("un relecteur non affecté reçoit 404 ; le relecteur affecté et l'associé lisent", async () => {
    // tiers2 n'est pas le relecteur de A ; tiers n'est pas celui de B.
    for (const url of [`${P}/echantillons/${echB}`, `${P}/echantillons/${echB}/dossier`]) {
      expect((await s.tiers.get(url)).statusCode, url).toBe(404);
    }
    expect(
      (await s.tiers.put(`${P}/echantillons/${echB}/evaluations`, { critere: "usage_ia", note: 3 }))
        .statusCode,
    ).toBe(404);
    expect(
      (await s.tiers.post(`${P}/echantillons/${echB}/terminer`, { synthese: "x" })).statusCode,
    ).toBe(404);
    expect(
      (
        await s.tiers.post(`${P}/echantillons/${echB}/constats`, {
          gravite: "mineur",
          description: "x",
        })
      ).statusCode,
    ).toBe(404);
    expect((await s.tiers.get(`${P}/echantillons/${echA}`)).statusCode).toBe(200);
    expect((await s.c.associe.get(`${P}/echantillons/${echB}`)).statusCode).toBe(200);
    // Sans le droit de relecture : 403.
    for (const u of [s.consultant, s.c.chef, s.gestionnaire, s.ressources]) {
      expect((await u.get(`${P}/echantillons/${echA}`)).statusCode).toBe(403);
      expect((await u.get(`${P}/echantillons/${echA}/dossier`)).statusCode).toBe(403);
      expect((await u.get(`${P}/mes-revues`)).statusCode).toBe(403);
    }
    // Qui gère la revue sans en être le relecteur n'écrit pas dans la grille.
    expect(
      (
        await s.c.associe.put(`${P}/echantillons/${echA}/evaluations`, {
          critere: "usage_ia",
          note: 3,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("« mes revues » ne liste que les revues affectées à l'appelant", async () => {
    const r = await s.tiers.get(`${P}/mes-revues`);
    expect(r.statusCode, r.body).toBe(200);
    const ids = r.json().elements.map((e: { id: string }) => e.id);
    expect(ids).toEqual([echA]);
    expect(r.json().elements[0]).toMatchObject({
      criteres_total: 8,
      criteres_evalues: 0,
      statut: "affectee",
    });
    expect(r.json().elements[0]).toHaveProperty("mission_intitule");
    expect((await s.tiers2.get(`${P}/mes-revues`)).json().elements.map((e: any) => e.id)).toEqual([
      echB,
    ]);
  });
});

describe("dossier de revue et FIN-02", () => {
  const INTERDITES =
    /cout|coût|taux|marge|honorair|debours|débours|montant|prix|tarif|sous_traitance|budget/i;

  it("lisible sans appartenir à l'équipe ; sans droit financier, aucune clé de montant ni de coût", async () => {
    const r = await s.tiers.get(`${P}/echantillons/${echA}/dossier`);
    expect(r.statusCode, r.body).toBe(200);
    const d = r.json();
    expect(d.mission).toMatchObject({ intitule: "Mission close 1", statut: "cloturee" });
    expect(d.mission).toHaveProperty("client_nom");
    expect(d.mission).toHaveProperty("directeur_nom");
    expect(Array.isArray(d.suivis_qualite)).toBe(true);
    expect(d).toHaveProperty("acceptation");
    expect(d.satisfaction).toHaveProperty("synthese");
    expect(d.derogations).toMatchObject({ total: 0 });
    expect(d).toHaveProperty("methode");
    const interdites = cles(d).filter((k) => INTERDITES.test(k));
    expect(interdites).toEqual([]);
    expect(d).not.toHaveProperty("budget");
    // Non-membre de l'équipe : la mission n'est pas visible par l'API ordinaire.
    expect((await s.tiers.get(`/api/missions/${s.missions[0]}`)).statusCode).toBe(404);
  });

  it("budget_jours et honoraires avec les droits du directeur ; coûts et marge pour l'associé seul", async () => {
    const dir = (await s.tiers2.get(`${P}/echantillons/${echB}/dossier`)).json();
    expect(dir.budget).toHaveProperty("budget_jours");
    expect(dir.budget).toHaveProperty("honoraires");
    expect(cles(dir).filter((k) => /cout|marge|sous_traitance|taux/i.test(k))).toEqual([]);

    const assoc = (await s.c.associe.get(`${P}/echantillons/${echA}/dossier`)).json();
    for (const k of ["budget_jours", "honoraires", "couts_internes", "marge", "taux_marge"]) {
      expect(assoc.budget, k).toHaveProperty(k);
    }
  });

  it("le dossier reprend les suivis qualité de la mission", async () => {
    const ech = echantillonDe(campagne, missionsCas.get("INTERVENANT_QUALITE") as string).id;
    const d = (await s.c.associe.get(`${P}/echantillons/${ech}/dossier`)).json();
    expect(d.suivis_qualite).toHaveLength(1);
    expect(d.suivis_qualite[0]).toMatchObject({
      type_livrable: "rapport",
      classe: "R1",
      statut: "brouillon",
    });
  });
});

describe("grille, score et conclusion", () => {
  const ev = (u: any, ech: string, corps: unknown) =>
    u.put(`${P}/echantillons/${ech}/evaluations`, corps);

  it("refuse une note ou un critère invalide, et un critère sans objet non justifié", async () => {
    const t = s.tiers;
    expect((await ev(t, echA, { critere: "usage_ia", note: 6 })).statusCode).toBe(400);
    expect((await ev(t, echA, { critere: "inconnu", note: 3 })).statusCode).toBe(400);
    expect((await ev(t, echA, { critere: "usage_ia", note: null })).statusCode).toBe(400);
    expect((await ev(t, echA, { critere: "usage_ia", note: 3, autre: 1 })).statusCode).toBe(400);
  });

  it("terminer exige une grille complète (409 avec les critères manquants)", async () => {
    const t = s.tiers;
    const vide = await t.post(`${P}/echantillons/${echA}/terminer`, { synthese: "trop tôt" });
    expect(vide.statusCode).toBe(409);
    expect(vide.json().erreur.code).toBe("GRILLE_INCOMPLETE");
    expect(vide.json().erreur.details.manquants).toHaveLength(8);

    const premier = await ev(t, echA, { critere: "conformite_methode", note: 2 });
    expect(premier.statusCode, premier.body).toBe(200);
    expect(premier.json().echantillon.statut).toBe("en_revue");
    expect(premier.json().resultat).toMatchObject({ complete: false, conclusion: null });
    // Modifiable tant que la revue n'est pas terminée : une seule ligne par critère.
    const corr = await ev(t, echA, { critere: "conformite_methode", note: 4 });
    expect(corr.json().evaluations).toHaveLength(1);
    expect(corr.json().evaluations[0]).toMatchObject({ critere: "conformite_methode", note: 4 });
    const sans = await ev(t, echA, {
      critere: "usage_ia",
      note: null,
      commentaire: "Aucun usage de l'IA sur cette mission.",
    });
    expect(sans.statusCode, sans.body).toBe(200);
    const encore = await t.post(`${P}/echantillons/${echA}/terminer`, { synthese: "incomplet" });
    expect(encore.statusCode).toBe(409);
    expect(encore.json().erreur.details.manquants).toHaveLength(6);
    expect(encore.json().erreur.details.manquants).not.toContain("usage_ia");
  });

  it("constats : ajout, retrait, plafond de 100 par revue", async () => {
    const t = s.tiers2;
    // Plafond : 100 constats posés en base, le 101e est refusé par l'API et par la base (MQQ09).
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO qualite_froide_constats (cabinet_id, echantillon_id, gravite, description, auteur_id)
         SELECT $1, $2, 'mineur', 'Constat ' || g, $3 FROM generate_series(1, 100) g`,
        [s.c.cabinetId, echB, s.tiers2.utilisateurId],
      ),
    );
    const trop = await t.post(`${P}/echantillons/${echB}/constats`, {
      gravite: "mineur",
      description: "101e",
    });
    expect(trop.statusCode).toBe(409);
    expect(trop.json().erreur.code).toBe("PLAFOND_ATTEINT");
    await expect(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO qualite_froide_constats (cabinet_id, echantillon_id, gravite, description, auteur_id)
           VALUES ($1, $2, 'mineur', '101e', $3)`,
          [s.c.cabinetId, echB, s.tiers2.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ09" });
    const un = (await t.get(`${P}/echantillons/${echB}`)).json().constats[0].id;
    expect((await t.delete(`${P}/echantillons/${echB}/constats/${un}`)).statusCode).toBe(204);
    expect((await t.delete(`${P}/echantillons/${echB}/constats/${un}`)).statusCode).toBe(404);
    const ok = await t.post(`${P}/echantillons/${echB}/constats`, {
      critere: "solidite_preuves",
      gravite: "mineur",
      description: "Retrouvé",
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toHaveProperty("constat_id");
    // Une revue sans relecteur affecté ne reçoit ni note ni constat en base (MQQ11).
    await expect(
      proprietaire((cl) =>
        cl.query(
          `INSERT INTO qualite_froide_evaluations (cabinet_id, echantillon_id, critere, note, evaluateur_id)
           VALUES ($1, $2, 'usage_ia', 3, $3)`,
          [s.c.cabinetId, echantillonDe(campagne, s.missions[3]).id, s.tiers.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ11" });
    // Une revue ne passe pas à « terminée » sans grille complète (MQQ11).
    await expect(
      proprietaire((cl) =>
        cl.query(
          `UPDATE qualite_froide_echantillon SET statut = 'terminee', terminee_le = now(), score = 50,
             conclusion = 'reserves', synthese = 'x', version_grille = 1 WHERE id = $1`,
          [echB],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ11" });
  });

  it("score et conclusion sortent du moteur ; la revue est ensuite figée (API et base)", async () => {
    const t = s.tiers;
    await evaluerTout(t, echA, 4);
    attendre(
      200,
      await ev(t, echA, { critere: "usage_ia", note: null, commentaire: "Sans objet" }),
      "usage_ia sans objet",
    );
    const c = await t.post(`${P}/echantillons/${echA}/constats`, {
      critere: "budget_delais",
      gravite: "majeur",
      description: "Dépassement de délai non tracé.",
      recommandation: "Tracer les écarts de calendrier.",
    });
    expect(c.statusCode, c.body).toBe(201);
    const constatId = c.json().constat_id;

    const avant = (await t.get(`${P}/echantillons/${echA}`)).json();
    const attendu = calculerRevueFroide(
      CRITERES_REVUE_FROIDE.map((x) => ({ code: x.code, poids: x.poids })),
      avant.evaluations.map((v: any) => ({ critere: v.critere, note: v.note })),
      avant.constats,
    );
    expect(avant.resultat).toMatchObject({ complete: true, score: attendu.score });
    expect(avant.peut_ecrire).toBe(true);

    const fin = await t.post(`${P}/echantillons/${echA}/terminer`, { synthese: "Revue achevée." });
    expect(fin.statusCode, fin.body).toBe(200);
    const e = fin.json().echantillon;
    expect(e).toMatchObject({
      statut: "terminee",
      score: attendu.score,
      conclusion: attendu.conclusion,
      synthese: "Revue achevée.",
      version_grille: 1,
    });
    // 4/5 partout : 75 sur 100, « conforme » limité à « avec réserves » par le constat majeur.
    expect(attendu).toMatchObject({ score: 75, conclusion: "reserves" });
    expect(fin.json().peut_ecrire).toBe(false);

    // API : plus aucune écriture.
    const r1 = await ev(t, echA, { critere: "usage_ia", note: 5 });
    const r2 = await t.post(`${P}/echantillons/${echA}/constats`, {
      gravite: "mineur",
      description: "x",
    });
    const r3 = await t.delete(`${P}/echantillons/${echA}/constats/${constatId}`);
    const r4 = await t.post(`${P}/echantillons/${echA}/terminer`, { synthese: "bis" });
    const r5 = await affecter(s.tiers2, echA);
    for (const r of [r1, r2, r3, r4, r5]) {
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().erreur.code).toBe("REVUE_FROIDE_TERMINEE");
    }
    // Base : MQQ04 même pour le propriétaire.
    const sql = (texte: string, params: unknown[] = []) =>
      proprietaire((cl) => cl.query(texte, params));
    await expect(
      sql("UPDATE qualite_froide_evaluations SET note = 1 WHERE echantillon_id = $1", [echA]),
    ).rejects.toMatchObject({ code: "MQQ04" });
    await expect(
      sql(
        `INSERT INTO qualite_froide_constats (cabinet_id, echantillon_id, gravite, description, auteur_id)
         VALUES ($1, $2, 'mineur', 'x', $3)`,
        [s.c.cabinetId, echA, s.tiers.utilisateurId],
      ),
    ).rejects.toMatchObject({ code: "MQQ04" });
    await expect(
      sql("DELETE FROM qualite_froide_constats WHERE id = $1", [constatId]),
    ).rejects.toMatchObject({
      code: "MQQ04",
    });
    await expect(
      sql("UPDATE qualite_froide_echantillon SET relecteur_id = $2 WHERE id = $1", [
        echA,
        s.tiers2.utilisateurId,
      ]),
    ).rejects.toMatchObject({ code: "MQQ04" });
    await expect(
      sql("UPDATE qualite_froide_echantillon SET synthese = 'autre' WHERE id = $1", [echA]),
    ).rejects.toMatchObject({ code: "MQQ04" });
  });

  it("un constat critique impose la conclusion non conforme (moteur)", async () => {
    const x = echantillonDe(campagne, s.missions[2]).id;
    attendre(200, await affecter(s.tiers, x), "affectation");
    await evaluerTout(s.tiers, x, 5);
    attendre(
      201,
      await s.tiers.post(`${P}/echantillons/${x}/constats`, {
        gravite: "critique",
        description: "Livrable signé sans relecture.",
      }),
      "constat critique",
    );
    const fin = await s.tiers.post(`${P}/echantillons/${x}/terminer`, { synthese: "Critique." });
    expect(fin.statusCode, fin.body).toBe(200);
    expect(fin.json().echantillon).toMatchObject({ score: 100, conclusion: "non_conforme" });
  });
});

describe("clôture de campagne", () => {
  it("refusée tant que des revues ne sont pas terminées, réservée à qui gère", async () => {
    expect((await s.tiers.post(`${P}/campagnes/${campagne.id}/cloture`)).statusCode).toBe(403);
    const r = await s.c.associe.post(`${P}/campagnes/${campagne.id}/cloture`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("REVUES_NON_TERMINEES");
    const d = (await s.c.associe.get(`${P}/campagnes/${campagne.id}`)).json();
    expect(d.progression.terminees).toBe(2);
    expect(d.echantillon.find((e: any) => e.id === echA)).toMatchObject({
      statut: "terminee",
      relecteur_nom: expect.any(String),
    });
  });
});
