import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerKpi,
  INCONNU,
  KPI_CA,
  preparerKpi,
  preparerPortailKpi,
  type ScenarioKpi,
} from "./kpi-outils.js";
import { attendre, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Pilotage par KPI (#4) : définitions, cibles versionnées, contributeurs,
 * paramètres. Droits (401, 403, matrice kpi.*), isolation entre cabinets et
 * IDOR (404), champs figés et historique des cibles en ajout seul ;
 * non-régressions d'audit : valeurs jamais arrondies en silence, début de
 * suivi borné, propriétaire choisi dans l'équipe de la mission.
 */

let ctx: Contexte;
let s: ScenarioKpi;
let p: Awaited<ReturnType<typeof preparerPortailKpi>>;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerKpi(ctx, "KPI déf");
  p = await preparerPortailKpi(ctx, s);
}, 180_000);
afterAll(() => ctx.fermer());

describe("droits et isolation des définitions", () => {
  it("401 sans session ; 403 sans la permission de la route", async () => {
    const anonyme = api(ctx);
    expect((await anonyme.get(`/api/missions/${s.missionId}/kpi`)).statusCode).toBe(401);
    expect((await anonyme.post(`/api/missions/${s.missionId}/kpi`, KPI_CA)).statusCode).toBe(401);
    // Consultant : lit la mission de son équipe mais ne gère pas ses KPI.
    expect(
      (await s.consultantEquipe.post(`/api/missions/${s.missionId}/kpi`, KPI_CA)).statusCode,
    ).toBe(403);
    expect((await s.gestionnaire.post(`/api/missions/${s.missionId}/kpi`, KPI_CA)).statusCode).toBe(
      403,
    );
    expect((await s.expertExterne.get(`/api/missions/${s.missionId}/kpi`)).statusCode).toBe(403);
    expect(
      (await s.consultantEquipe.patch("/api/kpi/parametres", { rappels_actifs: false })).statusCode,
    ).toBe(403);
  });

  it("matrice kpi.* : ni gestionnaire ni ressources, même en lisant toutes les missions", async () => {
    const ressources = await s.a.avecRoles(["ressources"]);
    for (const u of [s.gestionnaire, ressources]) {
      expect((await u.get(`/api/missions/${s.missionId}/kpi`)).statusCode).toBe(403);
      expect((await u.get(`/api/missions/${s.missionId}/kpi/tableau-de-bord`)).statusCode).toBe(
        403,
      );
      expect((await u.get(`/api/missions/${s.missionId}/kpi/export`)).statusCode).toBe(403);
      expect((await u.get("/api/kpi/parametres")).statusCode).toBe(403);
    }
    // Expert métier de l'équipe : lit, ne saisit ni ne gère ; hors équipe : 404.
    const expert = await s.a.avecRoles(["expert_metier"]);
    const expertHors = await s.a.avecRoles(["expert_metier"]);
    attendre(
      201,
      await s.a.chef.post(`/api/missions/${s.missionId}/equipe`, {
        utilisateur_id: expert.utilisateurId,
      }),
      "équipe",
    );
    const k = await creerKpi(s.a.chef, s.missionId, { libelle: "Lecture experte" });
    expect((await expert.get(`/api/kpi/${k.id}`)).statusCode).toBe(200);
    expect((await expertHors.get(`/api/kpi/${k.id}`)).statusCode).toBe(404);
    expect(
      (await expert.post(`/api/kpi/${k.id}/mesures`, { date_mesure: "2026-01-31", valeur: 1 }))
        .statusCode,
    ).toBe(403);
    expect((await expert.patch(`/api/kpi/${k.id}`, { libelle: "x" })).statusCode).toBe(403);
  });

  it("création par le chef de mission : début de suivi ramené au début de période, cible initiale", async () => {
    const r = await s.a.chef.post(`/api/missions/${s.missionId}/kpi`, {
      ...KPI_CA,
      debut_suivi: "2026-01-15",
      proprietaire_id: s.a.chef.utilisateurId,
    });
    expect(r.statusCode).toBe(201);
    const k = r.json();
    expect(k).toMatchObject({
      mission_id: s.missionId,
      client_id: s.a.clientId,
      debut_suivi: "2026-01-01",
      ponderation: 1,
      seuil_vert: null,
      actif: true,
      rappels_actifs: true,
      cible_actuelle: 1000,
    });
    expect(k.cibles).toEqual([
      expect.objectContaining({ version: 1, valeur: 1000, a_partir_de: "2026-01-01" }),
    ]);
    const journal = await proprietaire(
      async (c) =>
        (await c.query("SELECT action FROM journal_audit WHERE entite_id = $1", [k.id])).rows,
    );
    expect(journal).toContainEqual({ action: "kpi.creer" });
  });

  it("lecture : équipe oui, consultant hors équipe 404, autre cabinet 404 partout", async () => {
    const k = await creerKpi(s.a.chef, s.missionId, { libelle: "Marge brute" });
    expect((await s.consultantEquipe.get(`/api/missions/${s.missionId}/kpi`)).statusCode).toBe(200);
    expect((await s.consultantEquipe.get(`/api/kpi/${k.id}`)).statusCode).toBe(200);
    expect((await s.consultantHors.get(`/api/missions/${s.missionId}/kpi`)).statusCode).toBe(404);
    expect((await s.consultantHors.get(`/api/kpi/${k.id}`)).statusCode).toBe(404);
    for (const r of [
      await s.b.associe.get(`/api/kpi/${k.id}`),
      await s.b.associe.patch(`/api/kpi/${k.id}`, { libelle: "Piratage" }),
      await s.b.associe.post(`/api/kpi/${k.id}/cibles`, { valeur: 1, a_partir_de: "2026-02-01" }),
      await s.b.associe.put(`/api/kpi/${k.id}/contributeurs`, { utilisateurs: [] }),
      await s.b.associe.get(`/api/missions/${s.missionId}/kpi`),
      await s.b.associe.post(`/api/missions/${s.missionId}/kpi`, KPI_CA),
      await s.b.associe.get(`/api/kpi/${INCONNU}`),
    ]) {
      expect(r.statusCode).toBe(404);
    }
    const liste = (await s.b.associe.get(`/api/missions/${s.missionB}/kpi`)).json();
    expect(liste.elements).toEqual([]);
  });

  it("validation stricte : seuils, pondération, décimales, champ inconnu, propriétaire du portail", async () => {
    const url = `/api/missions/${s.missionId}/kpi`;
    for (const corps of [
      { ...KPI_CA, seuil_vert: 0.8, seuil_orange: 0.9 },
      { ...KPI_CA, seuil_vert: 0.9 },
      { ...KPI_CA, ponderation: -1 },
      { ...KPI_CA, cible: 1.1234567 },
      { ...KPI_CA, alerte_haut: 10, alerte_bas: 20 },
      { ...KPI_CA, frequence: "quotidienne" },
      { ...KPI_CA, debut_suivi: "2026-02-01", fin_suivi: "2026-01-31" },
      { ...KPI_CA, inconnu: true },
    ]) {
      expect((await s.a.chef.post(url, corps)).statusCode, JSON.stringify(corps)).toBe(400);
    }
    const r = await s.a.chef.post(url, {
      ...KPI_CA,
      proprietaire_id: p.contributeur.utilisateurId,
    });
    expect(r.statusCode).toBe(400);
  });

  it("non-régression : valeur arrondie en silence refusée, valeur de 15 chiffres conservée exacte", async () => {
    const url = `/api/missions/${s.missionId}/kpi`;
    // « 123456789012345.123456 » arrive en 123456789012345.12 : refusé, jamais tronqué.
    // Number(texte) reproduit le JSON.parse du serveur (un littéral perdrait déjà des chiffres).
    for (const corps of [
      { ...KPI_CA, cible: Number("123456789012345.123456") },
      { ...KPI_CA, alerte_haut: Number("999999999999999.9") },
    ]) {
      const r = await s.a.chef.post(url, corps);
      expect(r.statusCode, JSON.stringify(corps)).toBe(400);
      expect(r.json().erreur.code).toBe("REQUETE_INVALIDE");
    }
    const k = await creerKpi(s.a.chef, s.missionId, {
      libelle: "Exactitude",
      cible: 12345678901234.5,
    });
    const brute = await proprietaire(
      async (c) =>
        (await c.query("SELECT valeur::text AS v FROM kpi_cibles WHERE kpi_id = $1", [k.id])).rows,
    );
    expect(brute).toEqual([{ v: "12345678901234.5" }]);
  });

  it("non-régression : début de suivi au plus 10 ans avant la création (API et base)", async () => {
    const url = `/api/missions/${s.missionId}/kpi`;
    for (const debut_suivi of ["2000-01-01", "2010-06-30"]) {
      const r = await s.a.chef.post(url, { ...KPI_CA, debut_suivi, cible: null });
      expect(r.statusCode, debut_suivi).toBe(400);
      expect(r.json().erreur.code).toBe("KPI_DEBUT_SUIVI_TROP_ANCIEN");
    }
    const dixAns = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT ((now() AT TIME ZONE 'UTC')::date - interval '10 years' + interval '40 days')::date::text AS d",
          )
        ).rows[0].d as string,
    );
    expect(
      (await s.a.chef.post(url, { ...KPI_CA, debut_suivi: dixAns, cible: null })).statusCode,
    ).toBe(201);
    // Même hors API, la base refuse (contrainte liée à la date de création).
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO kpi_definitions (cabinet_id, mission_id, client_id, libelle, unite, sens,
             nature, frequence, debut_suivi, cree_par)
           VALUES ($1, $2, $3, 'Trop ancien', 'u', 'plus_haut_mieux', 'flux', 'mensuelle',
             '2001-01-01', $4)`,
          [s.a.cabinetId, s.missionId, s.a.clientId, s.a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "kpi_definitions_debut_suivi_borne" });
  });

  it("non-régression : propriétaire = directeur, chef ou membre de l'équipe qui lit les KPI", async () => {
    const url = `/api/missions/${s.missionId}/kpi`;
    for (const u of [s.consultantHors, s.gestionnaire, s.expertExterne]) {
      const r = await s.a.chef.post(url, { ...KPI_CA, proprietaire_id: u.utilisateurId });
      expect(r.statusCode).toBe(400);
      expect(r.json().erreur.code).toBe("REQUETE_INVALIDE");
    }
    const k = await creerKpi(s.a.chef, s.missionId, {
      libelle: "Propriété",
      proprietaire_id: s.consultantEquipe.utilisateurId,
    });
    expect(k.proprietaire_id).toBe(s.consultantEquipe.utilisateurId);
    for (const u of [s.consultantHors, s.gestionnaire, p.contributeur]) {
      expect(
        (await s.a.chef.patch(`/api/kpi/${k.id}`, { proprietaire_id: u.utilisateurId })).statusCode,
      ).toBe(400);
    }
    for (const id of [s.a.directeur.utilisateurId, s.a.chef.utilisateurId, null]) {
      const r = await s.a.chef.patch(`/api/kpi/${k.id}`, { proprietaire_id: id });
      expect(r.statusCode).toBe(200);
      expect(r.json().proprietaire_id).toBe(id);
    }
  });
});

describe("modification, champs figés, cibles versionnées", () => {
  it("modification journalisée ; sens, nature et fréquence figés (API et base)", async () => {
    const k = await creerKpi(s.a.chef, s.missionId, { libelle: "Effectif" });
    const r = await s.a.chef.patch(`/api/kpi/${k.id}`, {
      libelle: "Effectif total",
      seuil_vert: 0.9,
      seuil_orange: 0.7,
      alerte_variation: 0.2,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      libelle: "Effectif total",
      seuil_vert: 0.9,
      seuil_orange: 0.7,
    });
    expect((await s.a.chef.patch(`/api/kpi/${k.id}`, { sens: "plus_bas_mieux" })).statusCode).toBe(
      400,
    );
    expect((await s.a.chef.patch(`/api/kpi/${k.id}`, {})).statusCode).toBe(400);
    expect((await s.a.chef.patch(`/api/kpi/${k.id}`, { seuil_vert: 0.99 })).statusCode).toBe(400);
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE kpi_definitions SET frequence = 'annuelle' WHERE id = $1", [k.id]),
      ),
    ).rejects.toMatchObject({ code: "MPK01" });
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("DELETE FROM kpi_definitions WHERE id = $1", [k.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details FROM journal_audit WHERE entite_id = $1 AND action = 'kpi.modifier'",
            [k.id],
          )
        ).rows,
    );
    expect(journal[0].details.avant.libelle).toBe("Effectif");
    expect(journal[0].details.apres.libelle).toBe("Effectif total");
  });

  it("nouvelle cible : version suivante, début de période, historique en ajout seul", async () => {
    const k = await creerKpi(s.a.chef, s.missionId, { libelle: "CA export" });
    const r = await s.a.chef.post(`/api/kpi/${k.id}/cibles`, {
      valeur: 1200,
      a_partir_de: "2026-04-10",
      motif: "Révision du budget",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().cibles).toEqual([
      expect.objectContaining({ version: 1, valeur: 1000, a_partir_de: "2026-01-01" }),
      expect.objectContaining({ version: 2, valeur: 1200, a_partir_de: "2026-04-01" }),
    ]);
    // Correction d'une cible : nouvelle version, l'ancienne reste.
    await s.a.chef.post(`/api/kpi/${k.id}/cibles`, { valeur: 1100, a_partir_de: "2026-01-01" });
    expect((await s.a.chef.get(`/api/kpi/${k.id}`)).json().cibles).toHaveLength(3);
    expect(
      (await s.a.chef.post(`/api/kpi/${k.id}/cibles`, { valeur: 1, a_partir_de: "2025-12-01" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await s.consultantEquipe.post(`/api/kpi/${k.id}/cibles`, {
          valeur: 1,
          a_partir_de: "2026-02-01",
        })
      ).statusCode,
    ).toBe(403);
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE kpi_cibles SET valeur = 1 WHERE kpi_id = $1", [k.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      proprietaire((c) => c.query("DELETE FROM kpi_cibles WHERE kpi_id = $1", [k.id])),
    ).rejects.toMatchObject({ code: "MPK05" });
  });
});

describe("contributeurs du portail et paramètres du cabinet", () => {
  it("seuls les utilisateurs du portail du client du KPI (dirigeant ou contributeur)", async () => {
    const k = await creerKpi(s.a.chef, s.missionId, { libelle: "Satisfaction client" });
    const url = `/api/kpi/${k.id}/contributeurs`;
    const avec = (u: UtilisateurPortail | { utilisateurId: string }) =>
      s.a.chef.put(url, { utilisateurs: [u.utilisateurId] });
    expect((await avec(s.a.directeur)).statusCode).toBe(400);
    expect((await avec(p.contributeurA2)).statusCode).toBe(400);
    expect((await avec(p.investisseur)).statusCode).toBe(400);
    const r = await s.a.chef.put(url, {
      utilisateurs: [p.contributeur.utilisateurId, p.dirigeant.utilisateurId],
    });
    expect(r.statusCode).toBe(200);
    expect(
      r
        .json()
        .contributeurs.map((c: { id: string }) => c.id)
        .sort(),
    ).toEqual([p.contributeur.utilisateurId, p.dirigeant.utilisateurId].sort());
    expect((await s.consultantEquipe.put(url, { utilisateurs: [] })).statusCode).toBe(403);
  });

  it("paramètres : valeurs de départ, modification par l'associé, isolées par cabinet", async () => {
    expect((await s.a.chef.get("/api/kpi/parametres")).json()).toEqual({
      rappels_actifs: true,
      delai_grace_jours: 5,
      periodes_degradation: 3,
      valeurs_validees: false,
    });
    const r = await s.a.associe.patch("/api/kpi/parametres", { delai_grace_jours: 7 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ delai_grace_jours: 7, rappels_actifs: true });
    expect((await s.b.associe.get("/api/kpi/parametres")).json().delai_grace_jours).toBe(5);
    expect(
      (await s.a.associe.patch("/api/kpi/parametres", { delai_grace_jours: 90 })).statusCode,
    ).toBe(400);
    await s.a.associe.patch("/api/kpi/parametres", { delai_grace_jours: 5 });
  });
});
