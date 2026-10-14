import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  erreur,
  INCONNU,
  ouvrirDossierRed,
  preparerRed,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Dossiers de redressement (routes 1 à 7) : 401, 403 par rôle (matrice de SPEC-3a §8), cas
 * nominal, mission invisible (404), autre cabinet (404), mission clôturée (409), doublon (409),
 * devise copiée de la mission, pagination par curseur, transitions de statut.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dossierId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED dossiers");
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("référentiel (route 1)", () => {
  it("401 sans session, 403 sans droit, 200 avec droit ; aucune lecture en base, cache privé", async () => {
    expect((await api(ctx).get("/api/redressement/referentiel")).statusCode).toBe(401);
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      expect((await u.get("/api/redressement/referentiel")).statusCode).toBe(403);
    }
    const r = await s.consultantHors.get("/api/redressement/referentiel");
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("private");
    const ref = r.json();
    expect(ref.grille_urgence).toHaveLength(15);
    expect(ref.leviers).toHaveLength(6);
    expect(ref.version_moteur).toBe(1);
    expect(ref.plafonds.actions).toBe(300);
    expect(Object.keys(ref.seuils_defaut.criteres)).toHaveLength(12);
    expect(Object.keys(ref.correspondance_indicative)).toHaveLength(10);
  });
});

describe("ouverture d'un dossier (route 3)", () => {
  it("401, 403 par rôle, 404 mission invisible ou d'un autre cabinet", async () => {
    const url = `/api/missions/${s.missionId}/redressement`;
    expect((await api(ctx).post(url, { intitule: "x" })).statusCode).toBe(401);
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne, s.expert]) {
      expect((await u.post(url, { intitule: "x" })).statusCode).toBe(403);
    }
    // Un simple membre de l'équipe n'ouvre pas ; un consultant hors équipe ne voit pas la mission.
    expect((await s.consultantEquipe.post(url, { intitule: "x" })).statusCode).toBe(403);
    expect((await s.consultantHors.post(url, { intitule: "x" })).statusCode).toBe(404);
    // Autre cabinet : la mission n'existe pas pour lui.
    expect((await s.b.associe.post(url, { intitule: "x" })).statusCode).toBe(404);
    expect(
      (await s.a.associe.post(`/api/missions/${INCONNU}/redressement`, { intitule: "x" }))
        .statusCode,
    ).toBe(404);
  });

  it("corps invalide : intitulé vide, champ inconnu, secteur hors liste (400)", async () => {
    const url = `/api/missions/${s.missionId}/redressement`;
    expect((await s.a.chef.post(url, { intitule: "  " })).statusCode).toBe(400);
    expect((await s.a.chef.post(url, { intitule: "x", exces: 1 })).statusCode).toBe(400);
    expect((await s.a.chef.post(url, { intitule: "x", secteur: "mines" })).statusCode).toBe(400);
  });

  it("nominal : 201, devise et client de la mission, statut ouvert ; doublon 409 RED_EXISTE", async () => {
    const mission = await creerMission(s.a, { intitule: "Mission en euros", devise: "EUR" });
    const r = await s.a.chef.post(`/api/missions/${mission.id}/redressement`, {
      intitule: "Redressement de la société",
      secteur: "commerce",
    });
    attendre(201, r, "ouverture");
    const d = r.json();
    expect(d).toMatchObject({
      intitule: "Redressement de la société",
      secteur: "commerce",
      devise: "EUR",
      statut: "ouvert",
      mission: { id: mission.id, intitule: "Mission en euros" },
      client: { id: s.a.clientId },
      urgence: null,
      alerte: null,
      tresorerie: null,
      correspondance_version: null,
      etats_acceptes: 0,
      creanciers: { nombre: 0, encours_total: 0, echu_total: 0 },
      droits: { ecrire: true, valider: false },
    });
    expect(d.plan).toMatchObject({
      version_courante: null,
      en_retard: 0,
      modifie_depuis_validation: false,
    });
    const bis = await s.a.chef.post(`/api/missions/${mission.id}/redressement`, {
      intitule: "Encore",
    });
    expect(bis.statusCode).toBe(409);
    expect(erreur(bis)).toBe("RED_EXISTE");
    // Le journal ne porte que des identifiants et des codes.
    const journal = await proprietaire((c) =>
      c.query(
        "SELECT details::text AS d FROM journal_audit WHERE entite = 'red_dossier' AND entite_id = $1",
        [d.id],
      ),
    );
    expect(journal.rows[0].d).not.toContain("Redressement de la société");
  });

  it("mission clôturée : 409 RED_MISSION_CLOTUREE", async () => {
    const m = await creerMissionSignee(s.a);
    await proprietaire((c) =>
      c.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [m.id]),
    );
    const r = await s.a.associe.post(`/api/missions/${m.id}/redressement`, {
      intitule: "Trop tard",
    });
    expect(r.statusCode).toBe(409);
  });
});

describe("lecture d'un dossier (routes 4 et 5)", () => {
  beforeAll(async () => {
    dossierId = (await ouvrirDossierRed(s)).id;
  });

  it("401, 403 par rôle, 404 mission invisible, 404 autre cabinet", async () => {
    const url = `/api/redressement/dossiers/${dossierId}`;
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      expect((await u.get(url)).statusCode).toBe(403);
    }
    expect((await s.consultantHors.get(url)).statusCode).toBe(404);
    expect((await s.expert.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.a.associe.get(`/api/redressement/dossiers/${INCONNU}`)).statusCode).toBe(404);
    const urlMission = `/api/missions/${s.missionId}/redressement`;
    expect((await api(ctx).get(urlMission)).statusCode).toBe(401);
    expect((await s.gestionnaire.get(urlMission)).statusCode).toBe(403);
    expect((await s.consultantHors.get(urlMission)).statusCode).toBe(404);
    expect((await s.b.associe.get(urlMission)).statusCode).toBe(404);
  });

  it("nominal : associé, directeur, chef et membre d'équipe lisent ; droits d'affichage", async () => {
    for (const u of [s.a.associe, s.a.directeur, s.a.chef, s.consultantEquipe]) {
      const r = await u.get(`/api/redressement/dossiers/${dossierId}`);
      expect(r.statusCode).toBe(200);
      expect(r.json().id).toBe(dossierId);
    }
    const consultant = (
      await s.consultantEquipe.get(`/api/redressement/dossiers/${dossierId}`)
    ).json();
    expect(consultant.droits).toEqual({ ecrire: true, valider: false });
    const directeur = (await s.a.directeur.get(`/api/redressement/dossiers/${dossierId}`)).json();
    expect(directeur.droits).toEqual({ ecrire: true, valider: true });
    const parMission = await s.a.chef.get(`/api/missions/${s.missionId}/redressement`);
    expect(parMission.statusCode).toBe(200);
    expect(parMission.json().id).toBe(dossierId);
  });

  it("route 4 : mission visible sans dossier : 404 RED_ABSENT", async () => {
    const m = await creerMission(s.a, { intitule: "Sans redressement" });
    const r = await s.a.chef.get(`/api/missions/${m.id}/redressement`);
    expect(r.statusCode).toBe(404);
    expect(erreur(r)).toBe("RED_ABSENT");
  });
});

describe("liste des dossiers (route 2)", () => {
  it("401, 403 ; pagination par curseur ; visibilité par mission ; filtres ; autre cabinet", async () => {
    expect((await api(ctx).get("/api/redressement/dossiers")).statusCode).toBe(401);
    expect((await s.gestionnaire.get("/api/redressement/dossiers")).statusCode).toBe(403);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const m = await creerMission(s.a, { intitule: `Liste ${i}` });
      ids.push(
        (await ouvrirDossierRed(s, m.id, { intitule: `Dossier liste ${i}`, secteur: "btp" })).id,
      );
    }
    const p1 = (await s.a.associe.get("/api/redressement/dossiers?limite=2")).json();
    expect(p1.elements).toHaveLength(2);
    expect(p1.suivant).toBeTruthy();
    expect(p1.elements[0].id).toBe(ids[2]);
    const p2 = (
      await s.a.associe.get(`/api/redressement/dossiers?limite=2&curseur=${p1.suivant}`)
    ).json();
    expect(p2.elements[0].id).toBe(ids[0]);
    expect(p2.elements.map((e: { id: string }) => e.id)).not.toContain(p1.elements[0].id);
    expect(
      (await s.a.associe.get("/api/redressement/dossiers?curseur=pas-un-curseur")).statusCode,
    ).toBe(400);
    expect((await s.a.associe.get("/api/redressement/dossiers?limite=101")).statusCode).toBe(400);
    const btp = (await s.a.associe.get("/api/redressement/dossiers?secteur=btp&limite=100")).json();
    expect(btp.elements.length).toBeGreaterThanOrEqual(3);
    expect(btp.elements.every((e: { secteur: string }) => e.secteur === "btp")).toBe(true);
    const q = (await s.a.associe.get("/api/redressement/dossiers?q=liste%201")).json();
    expect(q.elements.map((e: { id: string }) => e.id)).toContain(ids[1]);
    // Un consultant hors équipe ne voit aucune de ces missions ; l'autre cabinet non plus.
    expect(
      (await s.consultantHors.get("/api/redressement/dossiers?limite=100")).json().elements,
    ).toHaveLength(0);
    expect(
      (await s.b.associe.get("/api/redressement/dossiers?limite=100")).json().elements,
    ).toHaveLength(0);
    // Le membre d'équipe ne voit que le dossier de sa mission.
    const equipe = (await s.consultantEquipe.get("/api/redressement/dossiers?limite=100")).json();
    expect(equipe.elements.map((e: { id: string }) => e.id)).toEqual([dossierId]);
  });
});

describe("modification et statut (routes 6 et 7)", () => {
  it("401, 403, 404 : modification refusée à qui n'écrit pas ; membre d'équipe admis", async () => {
    const url = `/api/redressement/dossiers/${dossierId}`;
    expect((await api(ctx).patch(url, { intitule: "x" })).statusCode).toBe(401);
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne, s.expert]) {
      expect((await u.patch(url, { intitule: "x" })).statusCode).toBe(403);
    }
    expect((await s.consultantHors.patch(url, { intitule: "x" })).statusCode).toBe(404);
    expect((await s.b.associe.patch(url, { intitule: "x" })).statusCode).toBe(404);
    expect((await s.a.chef.patch(url, {})).statusCode).toBe(400);
    const r = await s.consultantEquipe.patch(url, {
      intitule: "Nouvel intitulé",
      secteur: "services",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ intitule: "Nouvel intitulé", secteur: "services" });
  });

  it("statut : mise en œuvre sans plan validé : 409 ; clore exige redressement.valider et un motif", async () => {
    const url = `/api/redressement/dossiers/${dossierId}/statut`;
    expect(
      (await api(ctx).post(url, { statut: "clos", motif: "Objectifs atteints" })).statusCode,
    ).toBe(401);
    const sans = await s.a.chef.post(url, { statut: "mise_en_oeuvre" });
    expect(sans.statusCode).toBe(409);
    expect(erreur(sans)).toBe("RED_TRANSITION_INVALIDE");
    // Le chef de mission n'a pas `redressement.valider` : il ne clôt pas.
    expect(
      (await s.a.chef.post(url, { statut: "clos", motif: "Objectifs atteints" })).statusCode,
    ).toBe(403);
    expect(
      (await s.consultantEquipe.post(url, { statut: "clos", motif: "Objectifs atteints" }))
        .statusCode,
    ).toBe(403);
    // Motif trop court : 400 (schéma).
    expect((await s.a.directeur.post(url, { statut: "clos", motif: "court" })).statusCode).toBe(
      400,
    );
    expect((await s.a.directeur.post(url, { statut: "plan_valide" })).statusCode).toBe(400);
    const clos = await s.a.directeur.post(url, { statut: "clos", motif: "Objectifs atteints" });
    expect(clos.statusCode).toBe(200);
    expect(clos.json()).toMatchObject({ statut: "clos", motif_cloture: "Objectifs atteints" });
    expect(clos.json().clos_le).toBeTruthy();
    expect(clos.json().droits).toEqual({ ecrire: false, valider: false });
    // Un dossier clos ne reçoit plus d'écriture (409) mais reste lisible.
    const patch = await s.a.chef.patch(`/api/redressement/dossiers/${dossierId}`, {
      intitule: "Encore",
    });
    expect(patch.statusCode).toBe(409);
    expect(erreur(patch)).toBe("RED_DOSSIER_CLOS");
    const reclos = await s.a.directeur.post(url, { statut: "clos", motif: "Une autre fois" });
    expect(reclos.statusCode).toBe(409);
    expect((await s.a.chef.get(`/api/redressement/dossiers/${dossierId}`)).statusCode).toBe(200);
    // Le journal de clôture ne recopie pas le motif.
    const journal = await proprietaire((c) =>
      c.query(
        "SELECT details::text AS d FROM journal_audit WHERE entite = 'red_dossier' AND action = 'statut' AND entite_id = $1",
        [dossierId],
      ),
    );
    expect(journal.rows[0].d).not.toContain("Objectifs");
  });

  it("mission clôturée : le dossier devient en lecture seule (409 RED_MISSION_CLOTUREE)", async () => {
    const m = await creerMissionSignee(s.a);
    const d = await ouvrirDossierRed(s, m.id);
    await proprietaire((c) =>
      c.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [m.id]),
    );
    const r = await s.a.associe.patch(`/api/redressement/dossiers/${d.id}`, {
      intitule: "Trop tard",
    });
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_MISSION_CLOTUREE");
    expect((await s.a.associe.get(`/api/redressement/dossiers/${d.id}`)).statusCode).toBe(200);
  });
});
