import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import type { ApiUtilisateur } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  repondre,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";

/*
 * Observatoire inter-cabinets (CAP-04) : droits par rôle, adhésion volontaire (désactivée par
 * défaut, consentement exigé, historique en ajout seul, journal), versement réel depuis une
 * notation PUBLIÉE (aucun identifiant de client), versements concurrents sans doublon, portail
 * fermé, et garanties SQL de la fonction inter-cabinets (SECURITY DEFINER, search_path figé,
 * EXECUTE retiré à PUBLIC). Seuils et agrégats : `observatoire-agregats.test.ts`.
 */

const B = "/api/observatoire";

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let directeur: ApiUtilisateur;
let consultant: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  directeur = s.a.directeur;
  consultant = s.consultant;
  gestionnaire = s.gestionnaire;
  // Notation publiée du client A1 (secteur libre, taille renseignée).
  await proprietaire((cl) =>
    cl.query(
      `UPDATE clients SET secteur = 'Agro-industrie (cacao)', taille = 'pme' WHERE id = $1`,
      [s.a.clientId],
    ),
  );
  const { versionId, definition } = await versionValidee(s.consultant, "observatoire");
  const envoiId = await envoyer(s.consultant, s.missionId, versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId },
  ]);
  await repondre(s.dirigeant, envoiId, reponsesAuNiveau(definition, 4));
  const n = await s.consultant.post(`/api/missions/${s.missionId}/notation`, {});
  attendre(201, n, "notation");
  const notationId = n.json().id as string;
  attendre(
    201,
    await s.consultant.post(`/api/notations/${notationId}/calculs`, { envoi_id: envoiId }),
    "calcul",
  );
  attendre(200, await s.consultant.post(`/api/notations/${notationId}/soumettre`), "soumission");
  attendre(200, await s.expert.post(`/api/notations/${notationId}/publier`), "publication");
}, 240_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("adhésion volontaire, désactivée par défaut", () => {
  it("par défaut : non adhérent, agrégats 403, versement 409", async () => {
    const r = await s.a.associe.get(`${B}/adhesion`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ active: false, depuis: null, historique: [] });
    expect((await s.a.associe.get(`${B}/agregats`)).json().erreur.code).toBe(
      "OBSERVATOIRE_RESERVE_ADHERENTS",
    );
    expect((await s.a.associe.post(`${B}/contributions`, {})).statusCode).toBe(409);
    expect((await s.a.associe.post(`${B}/adhesion/retrait`, {})).json().erreur.code).toBe(
      "OBSERVATOIRE_NON_ADHERENT",
    );
  });

  it("droits : seul l'associé adhère ; le directeur lit l'état ; les autres rien", async () => {
    for (const u of [directeur, consultant, gestionnaire, s.expert]) {
      expect((await u.post(`${B}/adhesion`, { consentement: true })).statusCode).toBe(403);
      expect((await u.post(`${B}/contributions`, {})).statusCode).toBe(403);
      expect((await u.delete(`${B}/contributions`)).statusCode).toBe(403);
      expect((await u.get(`${B}/contributions/resume`)).statusCode).toBe(403);
    }
    expect((await directeur.get(`${B}/adhesion`)).statusCode).toBe(200);
    for (const u of [consultant, gestionnaire, s.expert]) {
      expect((await u.get(`${B}/adhesion`)).statusCode).toBe(403);
      expect((await u.get(`${B}/agregats`)).statusCode).toBe(403);
    }
    expect((await s.anonyme.get(`${B}/adhesion`)).statusCode).toBe(401);
  });

  it("consentement explicite exigé ; schéma strict", async () => {
    expect((await s.a.associe.post(`${B}/adhesion`, {})).statusCode).toBe(400);
    expect((await s.a.associe.post(`${B}/adhesion`, { consentement: false })).statusCode).toBe(400);
    const inconnu = await s.a.associe.post(`${B}/adhesion`, { consentement: true, x: 1 });
    expect(inconnu.statusCode).toBe(400);
  });

  it("adhésion de l'associé : historique, journal ; double adhésion 409", async () => {
    const r = await s.a.associe.post(`${B}/adhesion`, { consentement: true, motif: "Benchmark" });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ active: true });
    expect(r.json().historique).toMatchObject([
      { rang: 1, action: "adhesion", motif: "Benchmark" },
    ]);
    const d = await s.a.associe.post(`${B}/adhesion`, { consentement: true });
    expect(d.statusCode).toBe(409);
    expect(d.json().erreur.code).toBe("OBSERVATOIRE_DEJA_ADHERENT");
    const j = await proprietaire((cl) =>
      cl.query(
        `SELECT count(*)::int AS n FROM journal_audit
          WHERE cabinet_id = $1 AND action = 'observatoire.adhesion'`,
        [s.a.cabinetId],
      ),
    );
    expect(j.rows[0].n).toBe(1);
    // L'adhésion de A ne fait pas adhérer B.
    expect((await s.b.associe.get(`${B}/adhesion`)).json().active).toBe(false);
  });

  it("historique en ajout seul : ni modification ni suppression, même par le propriétaire", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE obs_adhesion_evenements SET motif = 'x'"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) => db.query("DELETE FROM obs_adhesion_evenements")),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      proprietaire((cl) =>
        cl.query("DELETE FROM obs_adhesion_evenements WHERE cabinet_id = $1", [s.a.cabinetId]),
      ),
    ).rejects.toMatchObject({ code: "MQK20" });
  });
});

describe("versement des données du cabinet", () => {
  it("versement réel : secteur normalisé, taille, valeur ; aucun identifiant de client", async () => {
    const r = await s.a.associe.post(`${B}/contributions`, {});
    expect(r.statusCode, r.body).toBe(201);
    const v = r.json();
    expect(v.versees + v.ecartees_sans_valeur).toBe(1);
    expect(v.versees).toBe(1);
    expect(v.en_attente).toMatchObject({ periode: v.periode_courante, nombre: 1 });
    expect(v.retenu).toBeNull();
    expect(v.par_case).toEqual([{ secteur: "agriculture", taille: "pme", nombre: 1 }]);
    const lignes = await proprietaire((cl) =>
      cl.query("SELECT * FROM obs_contributions WHERE cabinet_id = $1", [s.a.cabinetId]),
    );
    expect(lignes.rows).toHaveLength(1);
    expect(Object.keys(lignes.rows[0]).sort()).toEqual([
      "cabinet_id",
      "id",
      "indicateur",
      "periode",
      "secteur",
      "taille",
      "valeur",
      "verse_le",
      "verse_par",
    ]);
    expect(JSON.stringify(v)).not.toContain(s.a.clientId);
  });

  it("versements concurrents : le versement du mois est remplacé, jamais doublé", async () => {
    const r = await Promise.all([1, 2, 3].map(() => s.a.associe.post(`${B}/contributions`, {})));
    for (const x of r) expect(x.statusCode, x.body).toBe(201);
    const n = await proprietaire((cl) =>
      cl.query("SELECT count(*)::int AS n FROM obs_contributions WHERE cabinet_id = $1", [
        s.a.cabinetId,
      ]),
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("une contribution ne se modifie pas", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) => db.query("UPDATE obs_contributions SET valeur = 0")),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      proprietaire((cl) =>
        cl.query("UPDATE obs_contributions SET valeur = 0 WHERE cabinet_id = $1", [s.a.cabinetId]),
      ),
    ).rejects.toMatchObject({ code: "MQK23" });
  });

  it("le cabinet ne peut verser pour un autre cabinet", async () => {
    const erreur = await ctx.db
      .withTenant(s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO obs_contributions (cabinet_id, indicateur, secteur, taille, valeur, periode, verse_par)
           VALUES ($1, 'notation_score_global', 'commerce', 'pme', 50, obs_periode_courante(), $2)`,
          [s.b.cabinetId, s.b.associeId],
        ),
      )
      .then(
        () => null,
        (e: { code?: string }) => e,
      );
    // Le déclencheur (MQK22 : l'adhésion de B est invisible depuis A) ou la RLS (42501) refuse.
    expect(["MQK22", "42501"]).toContain(erreur?.code);
  });

  it("retrait de l'adhésion puis retrait des contributions (journalisés)", async () => {
    const r = await s.a.associe.post(`${B}/adhesion/retrait`, {});
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().active).toBe(false);
    expect(r.json().historique.map((e: { action: string }) => e.action)).toEqual([
      "retrait",
      "adhesion",
    ]);
    expect((await s.a.associe.post(`${B}/contributions`, {})).statusCode).toBe(409);
    expect((await directeur.get(`${B}/agregats`)).statusCode).toBe(403);
    const ret = await s.a.associe.post(`${B}/contributions/retrait`, {});
    expect(ret.statusCode, ret.body).toBe(200);
    expect(ret.json().retirees).toBe(1);
    const j = await proprietaire((cl) =>
      cl.query(
        `SELECT action FROM journal_audit
          WHERE cabinet_id = $1 AND action LIKE 'observatoire.%' ORDER BY cree_le`,
        [s.a.cabinetId],
      ),
    );
    expect(j.rows.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        "observatoire.adhesion",
        "observatoire.versement",
        "observatoire.retrait",
        "observatoire.retrait_contributions",
      ]),
    );
  });
});

describe("portail client fermé", () => {
  it("toutes les routes de l'observatoire : 403 PORTAIL_ROUTE_INTERDITE", async () => {
    for (const r of [
      await s.dirigeant.get(`${B}/agregats`),
      await s.dirigeant.get(`${B}/adhesion`),
      await s.dirigeant.post(`${B}/adhesion`, { consentement: true }),
      await s.dirigeant.post(`${B}/contributions`, {}),
      await s.dirigeant.get(`${B}/contributions/resume`),
      await s.dirigeant.delete(`${B}/contributions`),
    ]) {
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });
});

describe("garanties SQL de la fonction inter-cabinets", () => {
  it("obs_agregats : SECURITY DEFINER, search_path figé, EXECUTE retiré à PUBLIC", async () => {
    const r = await proprietaire((cl) =>
      cl.query(
        `SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS proprietaire,
                p.proacl IS NULL AS acl_par_defaut,
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public,
                has_function_privilege('missionpilot_app', p.oid, 'EXECUTE') AS app
           FROM pg_proc p
          WHERE p.proname IN ('obs_agregats', 'obs_adhesion_active')
          ORDER BY p.proname`,
      ),
    );
    expect(r.rows).toHaveLength(2);
    for (const f of r.rows) {
      expect(f.acl_par_defaut, f.proname).toBe(false);
      expect(f.public, f.proname).toBe(false);
      expect(f.app, f.proname).toBe(true);
      expect(f.proconfig, f.proname).toEqual(["search_path=public, pg_temp"]);
      expect(f.proprietaire).not.toBe("missionpilot_app");
    }
    expect(r.rows.find((f) => f.proname === "obs_agregats").prosecdef).toBe(true);
    // Fonction d'invocateur : lue par le rôle applicatif, elle reste sous RLS.
    expect(r.rows.find((f) => f.proname === "obs_adhesion_active").prosecdef).toBe(false);
  });

  it("le rôle applicatif n'a ni UPDATE sur les contributions, ni UPDATE/DELETE sur l'historique", async () => {
    const r = await proprietaire((cl) =>
      cl.query(
        `SELECT has_table_privilege('missionpilot_app', 'obs_contributions', 'UPDATE') AS c_upd,
                has_table_privilege('missionpilot_app', 'obs_adhesion_evenements', 'UPDATE') AS a_upd,
                has_table_privilege('missionpilot_app', 'obs_adhesion_evenements', 'DELETE') AS a_del`,
      ),
    );
    expect(r.rows[0]).toEqual({ c_upd: false, a_upd: false, a_del: false });
  });
});
