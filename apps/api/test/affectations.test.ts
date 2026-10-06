import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  creerMissionSignee,
  preparerCabinet,
  type CabinetMissions,
} from "./missions-outils.js";
import {
  affectationNominative,
  missionPlanifiable,
  sansDonneeFinanciere,
  utilisateurCollaborateur,
} from "./planification-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Affectations A");
  b = await preparerCabinet(ctx, "Cabinet Affectations B");
});
afterAll(() => ctx.fermer());

describe("affectations (PLN-04)", () => {
  it("nominative : création, lecture, modification, suppression, sans donnée financière", async () => {
    const m = await missionPlanifiable(a);
    const r = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, a.collaborateurs.senior as string),
    );
    expect(r.statusCode, r.body).toBe(201);
    const { affectation, avertissements } = r.json();
    expect(affectation).toMatchObject({
      mission_id: m.id,
      tache_id: m.tacheId,
      collaborateur_id: a.collaborateurs.senior,
      grade_code: "senior",
      a_pourvoir: false,
      jours_alloues: 4,
      date_debut: "2026-11-02",
      date_fin: "2026-11-13",
    });
    expect(avertissements).toEqual([]);
    expect(sansDonneeFinanciere(r.body)).toBe(true);

    const liste = await a.chef.get(`/api/missions/${m.id}/affectations`);
    expect(liste.json().elements.map((x: { id: string }) => x.id)).toEqual([affectation.id]);

    const p = await a.chef.patch(`/api/missions/${m.id}/affectations/${affectation.id}`, {
      jours_alloues: 4.5,
      date_fin: "2026-11-10",
    });
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json().affectation).toMatchObject({ jours_alloues: 4.5, date_fin: "2026-11-10" });

    expect(
      (await a.chef.delete(`/api/missions/${m.id}/affectations/${affectation.id}`)).statusCode,
    ).toBe(204);
    expect((await a.chef.get(`/api/missions/${m.id}/affectations`)).json().elements).toEqual([]);
  });

  it("profil à pourvoir {grade, compétence} transformé en affectation nominative", async () => {
    const m = await missionPlanifiable(a);
    const r = await a.chef.post(`/api/missions/${m.id}/affectations`, {
      tache_id: m.tacheId,
      profil: { grade_id: a.grades.junior, competence: "Analyse de données" },
      jours_alloues: 3,
      date_debut: "2026-11-02",
      date_fin: "2026-11-06",
    });
    expect(r.statusCode, r.body).toBe(201);
    const profil = r.json().affectation;
    expect(profil).toMatchObject({
      a_pourvoir: true,
      collaborateur_id: null,
      grade_code: "junior",
      competence: "Analyse de données",
    });
    const pourvu = await a.chef.post(`/api/missions/${m.id}/affectations/${profil.id}/pourvoir`, {
      collaborateur_id: a.collaborateurs.junior,
    });
    expect(pourvu.statusCode, pourvu.body).toBe(200);
    expect(pourvu.json().affectation).toMatchObject({
      a_pourvoir: false,
      collaborateur_id: a.collaborateurs.junior,
      competence: null,
      jours_alloues: 3,
    });
    expect(
      (
        await a.chef.post(`/api/missions/${m.id}/affectations/${profil.id}/pourvoir`, {
          collaborateur_id: a.collaborateurs.junior,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("l'affectation nominative d'un utilisateur l'ajoute à l'équipe (il voit la mission)", async () => {
    const m = await missionPlanifiable(a);
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(404);
    const r = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, consultant.collaborateurId),
    );
    expect(r.statusCode, r.body).toBe(201);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(200);
    // Deux affectations de la même personne : pas de doublon d'équipe.
    const r2 = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, consultant.collaborateurId, { jours_alloues: 1 }),
    );
    expect(r2.statusCode, r2.body).toBe(201);
    const equipe = (await a.chef.get(`/api/missions/${m.id}`)).json().equipe as {
      utilisateur_id: string;
    }[];
    expect(equipe.filter((e) => e.utilisateur_id === consultant.utilisateurId)).toHaveLength(1);
  });

  it("validation : période (tâche, mission), pas du cabinet, cible, références", async () => {
    const m = await missionPlanifiable(a);
    const autre = await missionPlanifiable(a);
    const senior = a.collaborateurs.senior as string;
    const refus = async (corps: Record<string, unknown>) =>
      (
        await a.chef.post(
          `/api/missions/${m.id}/affectations`,
          affectationNominative(m, senior, corps),
        )
      ).statusCode;
    expect(await refus({ date_fin: "2026-11-16" })).toBe(400); // après la tâche
    expect(await refus({ date_debut: "2026-10-30" })).toBe(400); // avant la mission
    expect(await refus({ date_fin: "2026-11-01" })).toBe(400); // fin < début
    expect(await refus({ jours_alloues: 1.3 })).toBe(400); // pas de la demi-journée
    expect(await refus({ jours_alloues: 0 })).toBe(400);
    expect(await refus({ tache_id: autre.tacheId })).toBe(400); // tâche d'une autre mission
    expect(await refus({ profil: { grade_id: a.grades.senior } })).toBe(400); // les deux
    expect(await refus({ collaborateur_id: b.collaborateurs.senior })).toBe(400); // autre cabinet
    expect(await refus({ inconnu: 1 })).toBe(400); // schéma strict
    expect(
      (
        await a.chef.post(`/api/missions/${m.id}/affectations`, {
          tache_id: m.tacheId,
          profil: { grade_id: b.grades.senior },
          jours_alloues: 1,
          date_debut: "2026-11-02",
          date_fin: "2026-11-02",
        })
      ).statusCode,
    ).toBe(400);
    // Collaborateur inactif.
    const inactif = await a.associe.post("/api/collaborateurs", {
      nom: "Inactif",
      grade_id: a.grades.senior,
      actif: false,
    });
    expect(await refus({ collaborateur_id: inactif.json().id })).toBe(400);
    // Utilisateur rattaché désactivé.
    const desactive = await utilisateurCollaborateur(a, ["consultant"]);
    await a.associe.patch(`/api/utilisateurs/${desactive.utilisateurId}`, { actif: false });
    expect(await refus({ collaborateur_id: desactive.collaborateurId })).toBe(400);
  });

  it("avertit quand les jours alloués dépassent le budget de la tâche pour le grade", async () => {
    const m = await missionPlanifiable(a, { budget: { senior: 5 } });
    const r = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, a.collaborateurs.senior as string, { jours_alloues: 6 }),
    );
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().avertissements).toEqual([
      expect.objectContaining({
        code: "DEPASSEMENT_BUDGET_TACHE",
        grade_code: "senior",
        budget_jours: 5,
        jours_alloues: 6,
      }),
    ]);
  });

  it("refuse un dépassement du budget figé sans révision (mission signée)", async () => {
    const { id } = await creerMissionSignee(a);
    const planning = (await a.chef.get(`/api/missions/${id}/planning`)).json();
    const tache = planning.taches[0] as { id: string; debut: string; fin: string };
    const corps = (jours: number) => ({
      tache_id: tache.id,
      collaborateur_id: a.collaborateurs.senior,
      jours_alloues: jours,
      date_debut: tache.debut,
      date_fin: tache.fin,
    });
    const trop = await a.chef.post(`/api/missions/${id}/affectations`, corps(5000));
    expect(trop.statusCode, trop.body).toBe(409);
    expect(trop.json().erreur.code).toBe("BUDGET_FIGE_DEPASSE");
    expect(sansDonneeFinanciere(trop.body)).toBe(true);
    const ok = await a.chef.post(`/api/missions/${id}/affectations`, corps(1));
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("droits : affectation.gerer, mission visible et dirigée ; pas d'auto-affectation", async () => {
    const m = await missionPlanifiable(a);
    const corps = affectationNominative(m, a.collaborateurs.senior as string);
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.post(`/api/missions/${m.id}/affectations`, corps)).statusCode).toBe(
      403,
    );
    // Chef d'une autre mission : celle-ci lui est invisible.
    const autreChef = await a.avecRoles(["chef_mission"]);
    expect((await autreChef.post(`/api/missions/${m.id}/affectations`, corps)).statusCode).toBe(
      404,
    );
    // Simple membre de l'équipe avec affectation.gerer : 403.
    await a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: autreChef.utilisateurId });
    expect((await autreChef.post(`/api/missions/${m.id}/affectations`, corps)).statusCode).toBe(
      403,
    );
    // Responsable des ressources : voit toutes les missions, arbitre le staffing.
    const ressources = await utilisateurCollaborateur(a, ["ressources"]);
    const r = await ressources.post(`/api/missions/${m.id}/affectations`, corps);
    expect(r.statusCode, r.body).toBe(201);
    // … mais ne s'affecte pas lui-même.
    const auto = await ressources.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, ressources.collaborateurId),
    );
    expect(auto.statusCode).toBe(403);
    expect(auto.json().erreur.code).toBe("AUTO_AFFECTATION");
    // Le chef de la mission peut s'affecter sur sa mission.
    const chefCollab = await a.associe.post("/api/collaborateurs", {
      nom: "Chef affectable",
      utilisateur_id: a.chef.utilisateurId,
      grade_id: a.grades.manager,
    });
    expect(
      (
        await a.chef.post(
          `/api/missions/${m.id}/affectations`,
          affectationNominative(m, chefCollab.json().id, { jours_alloues: 1 }),
        )
      ).statusCode,
    ).toBe(201);
    // Un consultant membre lit les affectations sans les gérer.
    await a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    expect((await consultant.get(`/api/missions/${m.id}/affectations`)).statusCode).toBe(200);
  });

  it("mission clôturée : 409", async () => {
    const m = await creerMission(a, { type_mission_id: null, mode_facturation: "regie" });
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      await db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [m.id, a.associeId],
      );
    });
    const r = await a.associe.post(`/api/missions/${m.id}/affectations`, {
      tache_id: m.id,
      collaborateur_id: a.collaborateurs.senior,
      jours_alloues: 1,
      date_debut: "2026-11-02",
      date_fin: "2026-11-02",
    });
    expect(r.statusCode).toBe(409);
  });

  it("isolation entre cabinets : mission et affectation d'autrui → 404", async () => {
    const m = await missionPlanifiable(a);
    const r = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, a.collaborateurs.senior as string),
    );
    const affId = r.json().affectation.id as string;
    expect((await b.associe.get(`/api/missions/${m.id}/affectations`)).statusCode).toBe(404);
    expect(
      (
        await b.associe.post(
          `/api/missions/${m.id}/affectations`,
          affectationNominative(m, b.collaborateurs.senior as string),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await b.associe.patch(`/api/missions/${m.id}/affectations/${affId}`, { jours_alloues: 1 }))
        .statusCode,
    ).toBe(404);
    expect((await b.associe.delete(`/api/missions/${m.id}/affectations/${affId}`)).statusCode).toBe(
      404,
    );
    // Affectation d'une autre mission adressée par cette mission : 404.
    const autre = await missionPlanifiable(a);
    expect(
      (await a.chef.patch(`/api/missions/${autre.id}/affectations/${affId}`, { jours_alloues: 1 }))
        .statusCode,
    ).toBe(404);
  });

  it("expert externe affectable (PLN-08) sans jamais renvoyer son coût d'achat", async () => {
    const m = await missionPlanifiable(a);
    const externe = await a.associe.post("/api/collaborateurs", {
      nom: "Expert fiscal externe",
      type: "externe",
      grade_id: a.grades.senior,
    });
    await a.associe.post(`/api/collaborateurs/${externe.json().id}/couts`, {
      cout_achat: 250_000,
      devise: "XOF",
      depuis_le: "2026-01-01",
    });
    const r = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, externe.json().id),
    );
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().affectation.collaborateur_type).toBe("externe");
    expect(sansDonneeFinanciere(r.body)).toBe(true);
    const liste = await a.associe.get(`/api/missions/${m.id}/affectations`);
    expect(sansDonneeFinanciere(liste.body)).toBe(true);
    expect(liste.body).not.toContain("250000");
  });

  it("E1 : période bornée (an 1 → 9999 refusé), durée plafonnée, mission sans date → 409", async () => {
    const m = await missionPlanifiable(a);
    const senior = a.collaborateurs.senior as string;
    const r = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, senior, { date_debut: "0001-01-01", date_fin: "9999-12-31" }),
    );
    expect(r.statusCode, r.body).toBe(400);
    const ok = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, senior),
    );
    const affId = ok.json().affectation.id as string;
    expect(
      (
        await a.chef.patch(`/api/missions/${m.id}/affectations/${affId}`, {
          date_fin: "9999-12-31",
        })
      ).statusCode,
    ).toBe(400);

    // Mission sans date de début : aucune borne ne limiterait la période.
    const sansDate = await creerMission(a, {
      type_mission_id: null,
      mode_facturation: "regie",
      date_debut: null,
      date_fin: null,
    });
    const phase = (
      await a.chef.post(`/api/missions/${sansDate.id}/phases`, { libelle: "P" })
    ).json();
    const tache = (
      await a.chef.post(`/api/missions/${sansDate.id}/taches`, {
        parent_id: phase.id,
        libelle: "T",
        duree_jours_ouvres: 5,
      })
    ).json();
    const sd = await a.chef.post(`/api/missions/${sansDate.id}/affectations`, {
      tache_id: tache.id,
      collaborateur_id: senior,
      jours_alloues: 1,
      date_debut: "2026-01-05",
      date_fin: "2026-12-31",
    });
    expect(sd.statusCode, sd.body).toBe(409);
    expect(sd.json().erreur.code).toBe("MISSION_SANS_DATES");

    // La base refuse aussi une période hors bornes ou de plus de 366 jours.
    for (const [debut, fin] of [
      ["0001-01-01", "9999-12-31"],
      ["2026-01-01", "2027-01-02"],
    ]) {
      await expect(
        proprietaire((db) =>
          db.query(
            `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id,
               jours_alloues, date_debut, date_fin)
             VALUES ($1, $2, $3, $4, 1, $5, $6)`,
            [a.cabinetId, m.id, m.tacheId, senior, debut, fin],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("M1 : ajout d'équipe journalisé et retiré avec la dernière affectation ; membre manuel conservé", async () => {
    const m = await missionPlanifiable(a);
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const journal = async (action: string) =>
      (
        await proprietaire((db) =>
          db.query(
            `SELECT details FROM journal_audit WHERE cabinet_id = $1 AND entite = 'mission'
               AND entite_id = $2 AND action = $3`,
            [a.cabinetId, m.id, action],
          ),
        )
      ).rows.map((l) => l.details as Record<string, unknown>);
    const creer = async (jours: number) => {
      const r = await a.chef.post(
        `/api/missions/${m.id}/affectations`,
        affectationNominative(m, consultant.collaborateurId, { jours_alloues: jours }),
      );
      expect(r.statusCode, r.body).toBe(201);
      return r.json().affectation.id as string;
    };
    const supprimer = async (id: string) =>
      expect((await a.chef.delete(`/api/missions/${m.id}/affectations/${id}`)).statusCode).toBe(
        204,
      );

    const premiere = await creer(1);
    const seconde = await creer(1);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(200);
    // Un seul ajout réel, donc une seule trace.
    expect(await journal("ajout_equipe")).toEqual([
      expect.objectContaining({ utilisateur_id: consultant.utilisateurId, via: "affectation" }),
    ]);
    await supprimer(premiere);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(200); // il en reste une
    await supprimer(seconde);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(404);
    const retraits = await proprietaire((db) =>
      db.query(
        `SELECT utilisateur_id, details FROM journal_audit WHERE cabinet_id = $1
           AND entite_id = $2 AND action = 'retrait_equipe'`,
        [a.cabinetId, m.id],
      ),
    );
    expect(retraits.rows).toEqual([
      {
        utilisateur_id: a.chef.utilisateurId,
        details: expect.objectContaining({
          utilisateur_id: consultant.utilisateurId,
          via: "affectation",
        }),
      },
    ]);

    // Membre ajouté (ou confirmé) à la main : jamais retiré automatiquement.
    const troisieme = await creer(1);
    const equipe = () =>
      a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    expect((await equipe()).statusCode).toBe(201);
    expect((await equipe()).statusCode).toBe(409);
    await supprimer(troisieme);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(200);
  });

  it("M1 : retrait aussi quand la tâche est supprimée (cascade)", async () => {
    const m = await missionPlanifiable(a);
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const r = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, consultant.collaborateurId),
    );
    expect(r.statusCode, r.body).toBe(201);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(200);
    const sup = await a.chef.delete(`/api/missions/${m.id}/taches/${m.tacheId}`);
    expect(sup.statusCode, sup.body).toBe(204);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(404);
  });

  it("M1 : sans droit de modifier la mission (ressources), l'affectation n'ouvre pas l'équipe", async () => {
    const m = await missionPlanifiable(a);
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const ressources = await a.avecRoles(["ressources"]);
    const r = await ressources.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, consultant.collaborateurId),
    );
    expect(r.statusCode, r.body).toBe(201);
    expect((await consultant.get(`/api/missions/${m.id}`)).statusCode).toBe(404);
    const equipe = (await a.chef.get(`/api/missions/${m.id}`)).json().equipe as {
      utilisateur_id: string;
    }[];
    expect(equipe.some((e) => e.utilisateur_id === consultant.utilisateurId)).toBe(false);
  });

  it("F5 : liste paginée par curseur ; 200 affectations au plus par tâche", async () => {
    const m = await missionPlanifiable(a, { budget: { senior: 1000 } });
    const senior = a.collaborateurs.senior as string;
    for (const debut of ["2026-11-04", "2026-11-02", "2026-11-03"]) {
      const r = await a.chef.post(
        `/api/missions/${m.id}/affectations`,
        affectationNominative(m, senior, { jours_alloues: 1, date_debut: debut }),
      );
      expect(r.statusCode, r.body).toBe(201);
    }
    const p1 = (await a.chef.get(`/api/missions/${m.id}/affectations?limite=2`)).json();
    expect(p1.elements.map((x: { date_debut: string }) => x.date_debut)).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = (
      await a.chef.get(`/api/missions/${m.id}/affectations?limite=2&curseur=${p1.curseur_suivant}`)
    ).json();
    expect(p2.elements.map((x: { date_debut: string }) => x.date_debut)).toEqual(["2026-11-04"]);
    expect(p2.curseur_suivant).toBeNull();
    expect((await a.chef.get(`/api/missions/${m.id}/affectations?limite=201`)).statusCode).toBe(
      400,
    );

    // Plafond : 200 affectations sur la tâche (197 de plus, insérées hors API).
    await proprietaire((db) =>
      db.query(
        `INSERT INTO affectations (cabinet_id, mission_id, tache_id, grade_id, jours_alloues,
           date_debut, date_fin)
         SELECT $1, $2, $3, $4, 0.5, date '2026-11-02', date '2026-11-02'
         FROM generate_series(1, 197)`,
        [a.cabinetId, m.id, m.tacheId, a.grades.junior],
      ),
    );
    const trop = await a.chef.post(
      `/api/missions/${m.id}/affectations`,
      affectationNominative(m, senior, { jours_alloues: 1 }),
    );
    expect(trop.statusCode, trop.body).toBe(409);
    expect(trop.json().erreur.code).toBe("TROP_D_AFFECTATIONS");
  });

  it("F3 : grade figé tant que le collaborateur est affecté à une mission au budget signé", async () => {
    const { id } = await creerMissionSignee(a);
    const planning = (await a.chef.get(`/api/missions/${id}/planning`)).json();
    const tache = planning.taches[0] as { id: string; debut: string; fin: string };
    const collab = (
      await a.associe.post("/api/collaborateurs", {
        nom: "Senior promu",
        grade_id: a.grades.senior,
      })
    ).json().id as string;
    const changer = (corps: Record<string, unknown>) =>
      a.associe.patch(`/api/collaborateurs/${collab}`, corps);
    // Sans affectation : le grade change librement.
    expect((await changer({ grade_id: a.grades.junior })).statusCode).toBe(200);
    expect((await changer({ grade_id: a.grades.senior })).statusCode).toBe(200);
    const aff = await a.chef.post(`/api/missions/${id}/affectations`, {
      tache_id: tache.id,
      collaborateur_id: collab,
      jours_alloues: 1,
      date_debut: tache.debut,
      date_fin: tache.fin,
    });
    expect(aff.statusCode, aff.body).toBe(201);
    const refus = await changer({ grade_id: a.grades.manager });
    expect(refus.statusCode, refus.body).toBe(409);
    expect(refus.json().erreur.code).toBe("GRADE_BUDGET_FIGE");
    // Le même grade, ou un autre champ, reste modifiable.
    expect((await changer({ grade_id: a.grades.senior, nom: "Senior confirmé" })).statusCode).toBe(
      200,
    );
    const liste = (await a.chef.get(`/api/missions/${id}/affectations`)).json();
    expect(liste.elements[0].grade_code).toBe("senior");
  });
});
