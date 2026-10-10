/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import { demarrer, type Contexte } from "./helpers.js";
import { creerAssertion, creerPreuve, lier } from "./preuves-outils.js";
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
 * Notation augmentée (PRD complémentaire §11.1) : banque d'items et questionnaire adaptatif
 * contrôlé (NOT-09), constats de perception (NOT-10), indice de confiance et garde de
 * publication (NOT-11), explicabilité et simulateur (NOT-12), calibration entre évaluateurs
 * (NOT-13), plan d'action priorisé (NOT-17). Pour chaque route : 401, 403, cas nominal et
 * autre cabinet (404) ; gardes doublées en base (MPN04, MPN08 à MPN12).
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let definition: DefinitionQuestionnaire;
let envoiId: string;
let notationId: string;
let dimension: string;

const LIBELLES = ["Inexistant", "Ponctuel", "En place", "Systématique", "Exemplaire"];
const item = (code: string, surcharge: Record<string, unknown> = {}) => ({
  code,
  dimension: "pilotage",
  pratique: code,
  intitule: `Pratique ${code}`,
  echelle: { niveaux: 5, libelles: LIBELLES },
  ancrages: LIBELLES.map((_, i) => ({ niveau: i + 1, comportement: `Comportement ${i + 1}` })),
  formulations: [
    { public: "tous", texte: `Comment jugez-vous ${code} ?` },
    { public: "dirigeant", texte: `En tant que dirigeant, comment jugez-vous ${code} ?` },
  ],
  poids: 1,
  priorite: 1,
  dureeSecondes: 30,
  ...surcharge,
});

const enBase = (sql: string, valeurs: unknown[]) =>
  ctx.db.withTenant(s.a.cabinetId, (db) => db.query(sql, valeurs));

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  const v = await versionValidee(s.consultant, "notation_augmentee");
  definition = v.definition;
  envoiId = await envoyer(s.consultant, s.missionId, v.versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId, fonction: "Direction générale" },
    { utilisateur_id: s.contributeur.utilisateurId },
  ]);
  await repondre(s.dirigeant, envoiId, reponsesAuNiveau(definition, 5));
  await repondre(s.contributeur, envoiId, reponsesAuNiveau(definition, 2));
  const n = await s.consultant.post(`/api/missions/${s.missionId}/notation`, {});
  attendre(201, n, "notation");
  notationId = n.json().id;
  const c = await s.consultant.post(`/api/notations/${notationId}/calculs`, { envoi_id: envoiId });
  attendre(201, c, "calcul");
  dimension = c.json().resultat.dimensions.find((d: any) => d.notable).dimension;
}, 180_000);
afterAll(() => ctx.fermer());

describe("banque d'items (NOT-09)", () => {
  let itemId: string;

  it("401, 403, création en brouillon, contenu contrôlé par le moteur", async () => {
    expect((await s.anonyme.get("/api/notation/banque")).statusCode).toBe(401);
    expect((await s.gestionnaire.get("/api/notation/banque")).statusCode).toBe(403);
    expect(
      (await s.gestionnaire.post("/api/notation/banque", { contenu: item("x") })).statusCode,
    ).toBe(403);
    const invalide = await s.consultant.post("/api/notation/banque", {
      contenu: item("incomplet", { ancrages: [{ niveau: 1, comportement: "x" }] }),
    });
    expect(invalide.statusCode).toBe(400);
    expect(invalide.json().erreur.code).toBe("ITEM_INVALIDE");
    expect(invalide.json().erreur.details.erreurs[0].code).toBe("ANCRAGE_MANQUANT");

    const r = await s.consultant.post("/api/notation/banque", { contenu: item("revue_strategie") });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ code: "revue_strategie", version: 1, statut: "brouillon" });
    itemId = r.json().id;
    const doublon = await s.consultant.post("/api/notation/banque", {
      contenu: item("revue_strategie"),
    });
    expect(doublon.statusCode).toBe(409);
    const liste = await s.expert.get("/api/notation/banque?statut=brouillon");
    expect(liste.statusCode).toBe(200);
    expect(liste.json().elements.map((e: any) => e.code)).toContain("revue_strategie");
  });

  it("validation par un expert métier non auteur ; l'item validé est figé (MPN04, MPN08)", async () => {
    expect((await s.consultant.post(`/api/notation/banque/${itemId}/valider`)).statusCode).toBe(
      403,
    );
    const propre = await s.expert.post("/api/notation/banque", { contenu: item("item_expert") });
    attendre(201, propre, "item de l'expert");
    const refus = await s.expert.post(`/api/notation/banque/${propre.json().id}/valider`);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    await expect(
      enBase(
        "UPDATE notation_banque_items SET statut = 'valide', valide_par = $2, valide_le = now() WHERE id = $1",
        [propre.json().id, s.expert.utilisateurId],
      ),
    ).rejects.toMatchObject({ code: "MPN04" });

    const ok = await s.expert.post(`/api/notation/banque/${itemId}/valider`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().statut).toBe("valide");
    const modif = await s.consultant.put(`/api/notation/banque/${itemId}`, {
      contenu: item("revue_strategie"),
    });
    expect(modif.statusCode).toBe(409);
    expect(modif.json().erreur.code).toBe("ITEM_FIGE");
    await expect(
      enBase("UPDATE notation_banque_items SET contenu = contenu WHERE id = $1", [itemId]),
    ).rejects.toMatchObject({ code: "MPN08" });
    expect((await s.b.associe.get(`/api/notation/banque/${itemId}`)).statusCode).toBe(404);
  });

  it("questionnaire adaptatif : items validés seulement, proposition contrôlée (MPN09)", async () => {
    attendre(
      201,
      await s.consultant.post("/api/notation/banque", {
        contenu: item("cout_revient", { dimension: "couts" }),
      }),
      "brouillon",
    );
    const url = `/api/missions/${s.missionId}/notation/selections`;
    expect((await s.anonyme.post(url, { regles: { public: "dirigeant" } })).statusCode).toBe(401);
    expect((await s.expert.post(url, { regles: { public: "dirigeant" } })).statusCode).toBe(403);
    expect(
      (
        await s.consultant.post(`/api/missions/${s.missionB}/notation/selections`, {
          regles: { public: "dirigeant" },
        })
      ).statusCode,
    ).toBe(404);
    expect((await s.horsEquipe.post(url, { regles: { public: "dirigeant" } })).statusCode).toBe(
      404,
    );

    const r = await s.consultant.post(url, { regles: { public: "dirigeant" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().selection_id).toBeNull();
    expect(r.json().items.map((i: any) => i.code)).toEqual(["revue_strategie"]);
    expect(r.json().items[0].formulation.public).toBe("dirigeant");
    expect(r.json().definition.sections[0].questions[0]).toMatchObject({
      id: "revue_strategie",
      type: "likert",
    });

    const horsBanque = await s.consultant.post(url, {
      regles: { public: "dirigeant" },
      proposition: [{ code: "cout_revient", public: "dirigeant" }],
    });
    expect(horsBanque.statusCode).toBe(400);
    expect(horsBanque.json().erreur.details.erreurs[0].code).toBe("ITEM_HORS_BANQUE");

    const enregistree = await s.consultant.post(url, {
      regles: { public: "equipe" },
      proposition: [{ code: "revue_strategie", public: "tous" }],
      enregistrer: true,
    });
    expect(enregistree.statusCode).toBe(201);
    const liste = await s.expert.get(url);
    expect(liste.statusCode).toBe(200);
    expect(liste.json().elements[0]).toMatchObject({ origine: "proposition", public: "equipe" });
    expect((await s.b.associe.get(url)).statusCode).toBe(404);

    const brouillon = await enBase(
      "SELECT id FROM notation_banque_items WHERE code = 'cout_revient'",
      [],
    );
    await expect(
      enBase(
        `INSERT INTO notation_selection_items (cabinet_id, selection_id, rang, item_id, public_formulation)
         VALUES ($1, $2, 2, $3, 'tous')`,
        [s.a.cabinetId, enregistree.json().selection_id, brouillon.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: "MPN09" });
  });
});

describe("constats de perception (NOT-10)", () => {
  it("les écarts du moteur deviennent des constats rattachés aux populations", async () => {
    const url = `/api/notations/${notationId}/constats`;
    expect((await s.anonyme.get(url)).statusCode).toBe(401);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.horsEquipe.get(url)).statusCode).toBe(404);
    const r = await s.expert.get(url);
    expect(r.statusCode).toBe(200);
    expect(r.json().constats.length).toBeGreaterThan(0);
    expect(r.json().constats[0]).toMatchObject({
      type: "entre_populations",
      populations_hautes: ["Direction générale"],
      populations_basses: ["Contributeurs"],
    });
    expect(r.json().constats[0].enonce).toContain("Direction générale");
  });
});

describe("indice de confiance et garde de publication (NOT-11)", () => {
  it("indice affiché avec ses composantes ; les preuves d'une dimension le relèvent", async () => {
    const url = `/api/notations/${notationId}/confiance`;
    expect((await s.anonyme.get(url)).statusCode).toBe(401);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    const avant = await s.consultant.get(url);
    expect(avant.statusCode).toBe(200);
    expect(avant.json()).toMatchObject({
      seuil: 0.5,
      repondants: { nombre: 2, cible: 3 },
      preuves: { valeur: 0, dimensions_etayees: 0 },
    });
    attendre(
      201,
      await s.a.chef.post(`/api/missions/${s.missionId}/preuves/dimensions`, {
        code: dimension,
        libelle: "Dimension notée",
      }),
      "dimension",
    );
    // Une assertion en brouillon (pas encore relue) ne relève pas l'indice.
    const brouillon = await creerAssertion(s.a.chef, s.missionId, {
      rattachement_type: "dimension",
      rattachement_code: dimension,
    });
    await lier(s.a.chef, brouillon.id, (await creerPreuve(s.a.chef, s.missionId)).id, "pour");
    const encoreBas = (await s.consultant.get(url)).json();
    expect(encoreBas.preuves).toMatchObject({ dimensions_etayees: 0, assertions: 0 });
    expect(encoreBas.indice).toBe(avant.json().indice);
    // Retenue, elle l'élève.
    const assertion = await creerAssertion(s.a.chef, s.missionId, {
      rattachement_type: "dimension",
      rattachement_code: dimension,
      statut: "retenue",
    });
    await lier(s.a.chef, assertion.id, (await creerPreuve(s.a.chef, s.missionId)).id, "pour");
    const apres = (await s.consultant.get(url)).json();
    expect(apres.preuves).toMatchObject({ dimensions_etayees: 1, assertions: 1 });
    expect(apres.indice).toBeGreaterThan(avant.json().indice);
  });

  it("paramètres : lecture, modification réservée à cabinet.gerer", async () => {
    expect((await s.anonyme.get("/api/notation/parametres")).statusCode).toBe(401);
    expect((await s.gestionnaire.get("/api/notation/parametres")).statusCode).toBe(403);
    const lu = await s.consultant.get("/api/notation/parametres");
    expect(lu.json()).toMatchObject({
      seuil_confiance: 0.5,
      repondants_cible: 3,
      par_defaut: true,
    });
    expect(
      (await s.consultant.put("/api/notation/parametres", { seuil_confiance: 0.1 })).statusCode,
    ).toBe(403);
    // Plancher : un seuil ou une cible de répondants vidés de leur substance sont refusés (400).
    for (const corps of [
      { seuil_confiance: 0 },
      { seuil_confiance: 0.29 },
      { repondants_cible: 1 },
    ]) {
      expect((await s.a.associe.put("/api/notation/parametres", corps)).statusCode).toBe(400);
    }
    // Un compte qui cumule associé et expert métier (il publie) ne règle pas le seuil.
    const cumul = await s.a.avecRoles(["associe", "expert_metier"]);
    const separation = await cumul.put("/api/notation/parametres", { seuil_confiance: 0.4 });
    expect(separation.statusCode).toBe(403);
    expect(separation.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    expect((await s.a.associe.put("/api/notation/parametres", {})).statusCode).toBe(400);
    expect(
      (await s.a.associe.put("/api/notation/parametres", { seuil_confiance: 0.12345 })).statusCode,
    ).toBe(400);
    const r = await s.a.associe.put("/api/notation/parametres", { seuil_confiance: 0.99 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ seuil_confiance: 0.99, par_defaut: false });
    expect((await s.b.associe.get("/api/notation/parametres")).json().seuil_confiance).toBe(0.5);
    // Plancher doublé en base (0404) : un seuil ou une cible sous le plancher est refusé (CHECK).
    await expect(
      enBase("UPDATE notation_parametres SET seuil_confiance = 0.1", []),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      enBase("UPDATE notation_parametres SET repondants_cible = 1", []),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("publication refusée sous le seuil (409, doublé en base MPN10), acceptée au-dessus", async () => {
    attendre(200, await s.consultant.post(`/api/notations/${notationId}/soumettre`), "soumission");
    const refus = await s.expert.post(`/api/notations/${notationId}/publier`);
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("CONFIANCE_INSUFFISANTE");
    const v = (await s.expert.get(`/api/notations/${notationId}/version`)).json();
    // En base, sans indice publiable de la même transaction : MPN10.
    await expect(
      enBase(
        `INSERT INTO notation_evenements (cabinet_id, version_id, rang, action, par)
         VALUES ($1, $2, 2, 'publication', $3)`,
        [s.a.cabinetId, v.id, s.expert2.utilisateurId],
      ),
    ).rejects.toMatchObject({ code: "MPN10" });
    // Un indice enregistré sous le seuil courant du cabinet est refusé.
    await expect(
      enBase(
        `INSERT INTO notation_confiances (cabinet_id, version_id, rang, indice, seuil, publiable,
           composantes, calcule_par)
         VALUES ($1, $2, 1, 0.6, 0.5, true, '{}', $3)`,
        [s.a.cabinetId, v.id, s.expert2.utilisateurId],
      ),
    ).rejects.toMatchObject({ code: "MPN10" });

    attendre(
      200,
      await s.a.associe.put("/api/notation/parametres", { seuil_confiance: 0.5 }),
      "seuil",
    );
    const ok = await s.expert.post(`/api/notations/${notationId}/publier`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().statut).toBe("publiee");
    const traces = await enBase(
      "SELECT publiable FROM notation_confiances WHERE version_id = $1 ORDER BY rang",
      [v.id],
    );
    expect(traces.rows.map((l) => l.publiable)).toEqual([true]);
  });
});

describe("explicabilité et simulateur (NOT-12)", () => {
  it("contributions dont la somme est le score ; simulation vers la classe supérieure", async () => {
    const url = `/api/notations/${notationId}/explication`;
    expect((await s.anonyme.get(url)).statusCode).toBe(401);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.consultant.get(`${url}?cible=F`)).statusCode).toBe(400);
    const r = await s.consultant.get(url);
    expect(r.statusCode).toBe(200);
    const e = r.json();
    expect(Math.abs(e.somme_contributions - e.score)).toBeLessThanOrEqual(0.05);
    expect(e.dimensions.length).toBeGreaterThan(0);
    if (e.classe !== "A") {
      expect(e.simulation).toMatchObject({ classe_actuelle: e.classe, deja_atteinte: false });
      expect(e.simulation.etapes.length).toBeGreaterThan(0);
    }
    const a = (await s.consultant.get(`${url}?cible=A`)).json();
    expect(a.simulation.cible).toBe("A");
  });
});

describe("calibration entre évaluateurs (NOT-13)", () => {
  let sessionId: string;
  const cas = [
    { code: "c1", libelle: "Pilotage – entreprise X" },
    { code: "c2", libelle: "Coûts – entreprise X" },
  ];

  it("session, double cotation à l'aveugle, mesure révélée à l'expert", async () => {
    expect((await s.anonyme.get("/api/notation/calibrations")).statusCode).toBe(401);
    expect(
      (await s.gestionnaire.post("/api/notation/calibrations", { titre: "x", cas })).statusCode,
    ).toBe(403);
    const r = await s.consultant.post("/api/notation/calibrations", {
      titre: "Calibrage d'octobre",
      cas,
      notation_id: notationId,
    });
    expect(r.statusCode).toBe(201);
    sessionId = r.json().id;
    const url = `/api/notation/calibrations/${sessionId}`;
    attendre(
      201,
      await s.consultant.post(`${url}/cotations`, {
        cotations: [
          { cas: "c1", niveau: 3 },
          { cas: "c2", niveau: 2 },
        ],
      }),
      "cotation 1",
    );
    attendre(
      201,
      await s.expert2.post(`${url}/cotations`, {
        cotations: [
          { cas: "c1", niveau: 3 },
          { cas: "c2", niveau: 4 },
        ],
      }),
      "cotation 2",
    );
    expect(
      (await s.consultant.post(`${url}/cotations`, { cotations: [{ cas: "c1", niveau: 1 }] }))
        .statusCode,
    ).toBe(409);
    expect(
      (await s.consultant.post(`${url}/cotations`, { cotations: [{ cas: "zz", niveau: 1 }] }))
        .statusCode,
    ).toBe(409);

    const aveugle = (await s.consultant.get(url)).json();
    expect(aveugle).toMatchObject({ close: false, mesure: null, cotations: null });
    expect(aveugle.mes_cotations).toHaveLength(2);
    expect(aveugle.avancement).toEqual([
      { code: "c1", libelle: cas[0]!.libelle, evaluateurs: 2 },
      { code: "c2", libelle: cas[1]!.libelle, evaluateurs: 2 },
    ]);
    // Expert métier évaluateur : il voit les cotations de tous, pour les seuls cas qu'il a cotés.
    const expert2 = (await s.expert2.get(url)).json();
    expect(expert2.mesure).toMatchObject({ taux_accord: 0.5, a_discuter: ["c2"] });
    expect(expert2.cotations).toHaveLength(4);
    // Expert métier qui n'a rien coté : ni cotations des autres, ni mesure (aveugle).
    const sansCotation = (await s.expert.get(url)).json();
    expect(sansCotation.mes_cotations).toEqual([]);
    expect(sansCotation.cotations).toEqual([]);
    expect(sansCotation.mesure).toBeNull();
    expect((await s.horsEquipe.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect(
      (await s.consultant.get("/api/notation/calibrations")).json().elements[0].evaluateurs,
    ).toBe(2);
  });

  it("un expert métier évaluateur ne voit que les cas qu'il a lui-même cotés (aveugle)", async () => {
    const url = `/api/notation/calibrations/${sessionId}`;
    attendre(
      201,
      await s.expert.post(`${url}/cotations`, { cotations: [{ cas: "c1", niveau: 3 }] }),
      "cotation de l'expert",
    );
    const vu = (await s.expert.get(url)).json();
    expect(vu.mes_cotations).toHaveLength(1);
    // Cotations des autres sur c1 seulement : jamais sur c2, pas encore coté par lui.
    expect(vu.cotations.map((c: any) => c.cas)).toEqual(["c1", "c1", "c1"]);
    expect(vu.mesure.cas.map((c: any) => c.cas)).toEqual(["c1"]);
    expect(vu.mesure.cas_doublement_cotes).toBe(1);
    // Un consultant (non expert) reste aveugle tant que la session est ouverte.
    expect((await s.consultant.get(url)).json()).toMatchObject({ cotations: null, mesure: null });
  });

  it("clôture par un expert métier ; session close figée (MPN11)", async () => {
    const url = `/api/notation/calibrations/${sessionId}`;
    expect((await s.consultant.post(`${url}/cloturer`, { conclusion: "x" })).statusCode).toBe(403);
    const r = await s.expert.post(`${url}/cloturer`, {
      conclusion: "Ancrage du niveau 3 précisé.",
    });
    expect(r.statusCode).toBe(200);
    expect((await s.consultant.get(url)).json().mesure.taux_accord).toBe(0.5);
    expect((await s.expert.post(`${url}/cloturer`, { conclusion: "x" })).statusCode).toBe(409);
    expect(
      (await s.expert.post(`${url}/cotations`, { cotations: [{ cas: "c1", niveau: 2 }] }))
        .statusCode,
    ).toBe(409);
    await expect(
      enBase(
        `INSERT INTO notation_calibration_cotations (cabinet_id, calibration_id, cas, evaluateur_id, niveau)
         VALUES ($1, $2, 'c1', $3, 2)`,
        [s.a.cabinetId, sessionId, s.expert.utilisateurId],
      ),
    ).rejects.toMatchObject({ code: "MPN11" });
  });
});

describe("plan d'action depuis la bibliothèque d'initiatives (NOT-17)", () => {
  let initiativeId: string;

  it("bibliothèque : création, impacts observés en ajout seul, retrait", async () => {
    const base = "/api/notation/initiatives-types";
    expect((await s.anonyme.get(base)).statusCode).toBe(401);
    expect((await s.gestionnaire.get(base)).statusCode).toBe(403);
    const corps = {
      code: "tableau_bord",
      titre: "Tableau de bord mensuel",
      dimensions: [dimension],
      effort: 2,
      duree_mois: 6,
    };
    expect((await s.gestionnaire.post(base, corps)).statusCode).toBe(403);
    const r = await s.consultant.post(base, corps);
    expect(r.statusCode).toBe(201);
    initiativeId = r.json().id;
    expect((await s.consultant.post(base, corps)).statusCode).toBe(409);
    // Date d'observation hors de 2000 à 2100 : 400 (CHECK SQL doublé par le schéma), jamais 500.
    for (const observe_le of ["1999-12-31", "2101-01-01"]) {
      const hors = await s.consultant.post(`${base}/${initiativeId}/impacts`, {
        secteur: null,
        taille: "pme",
        gain: 6.5,
        source: "Retour de trois missions 2025",
        observe_le,
      });
      expect(hors.statusCode).toBe(400);
    }
    const impact = await s.consultant.post(`${base}/${initiativeId}/impacts`, {
      secteur: null,
      taille: "pme",
      gain: 6.5,
      source: "Retour de trois missions 2025",
      observe_le: "2026-06-30",
    });
    expect(impact.statusCode).toBe(201);
    expect(impact.json().impacts[0]).toMatchObject({ taille: "pme", gain: 6.5 });
    attendre(
      201,
      await s.consultant.post(base, { ...corps, code: "inactive", effort: 1 }),
      "seconde",
    );
    const inactive = (await s.consultant.get(`${base}?actives=oui`))
      .json()
      .elements.find((e: any) => e.code === "inactive");
    attendre(200, await s.consultant.patch(`${base}/${inactive.id}`, { active: false }), "retrait");
    expect((await s.b.associe.get(`${base}/${initiativeId}`)).statusCode).toBe(404);
    await expect(
      enBase("UPDATE notation_initiatives_types SET code = 'autre' WHERE id = $1", [initiativeId]),
    ).rejects.toMatchObject({ code: "MPN12" });
  });

  it("proposition priorisée par le moteur, plan enregistré en ajout seul", async () => {
    const url = `/api/notations/${notationId}/plan-action/proposition?capacite=4&taille=pme`;
    expect((await s.anonyme.get(url)).statusCode).toBe(401);
    expect((await s.gestionnaire.get(url)).statusCode).toBe(403);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    const p = await s.expert.get(url);
    expect(p.statusCode).toBe(200);
    expect(p.json().initiatives.map((i: any) => i.code)).toEqual(["tableau_bord"]);
    expect(p.json().initiatives[0]).toMatchObject({
      source_impact: "taille",
      impact: 6.5,
      effort: 2,
    });

    const plans = `/api/notations/${notationId}/plans-action`;
    expect((await s.expert.post(plans, { capacite: 4 })).statusCode).toBe(403);
    const r = await s.consultant.post(plans, { capacite: 4, taille: "pme" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      rang: 1,
      capacite_utilisee: r.json().initiatives[0].retenue ? 2 : 0,
    });
    const liste = await s.expert.get(plans);
    expect(liste.json().elements).toHaveLength(1);
    expect((await s.b.associe.get(plans)).statusCode).toBe(404);
    const rangEnDouble = await enBase(
      `INSERT INTO notation_plans_action (cabinet_id, notation_id, version_id, rang, capacite, contexte, contenu, cree_par)
       SELECT $1, $2, v.id, 1, 1, '{}', '{}', $3 FROM notation_versions v WHERE v.notation_id = $2 LIMIT 1`,
      [s.a.cabinetId, notationId, s.consultant.utilisateurId],
    ).catch((e) => e);
    expect(rangEnDouble).toMatchObject({ code: "MPN12" });
  });
});
