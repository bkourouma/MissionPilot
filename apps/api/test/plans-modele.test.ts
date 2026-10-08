import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calculerScenariosPlan,
  ECARTS_SCENARIOS_DEFAUT,
  TAUX_ACTUALISATION_DEFAUT,
  tauxRendementInterne,
  valeurActuelleNette,
  type HypothesesPlan,
} from "@missionpilot/engines";
import { VERSIONS_MODELE_PAR_PLAN_MAX } from "../src/plans/modele.js";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Modèle financier du plan (PLA-06, PLA-07, PLA-09) : le résultat figé est
 * EXACTEMENT celui du moteur, versions en ajout seul, horizon du plan imposé,
 * hypothèses refusées par le moteur (400), validation avec séparation des
 * tâches, comparaison de versions, ROI par initiative (VAN/TRI du moteur),
 * données de rapport.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
/** Expert métier de l'équipe : lit le plan (plan.lire), ne le rédige pas. */
let lecteur: ApiUtilisateur;
let planId: string;
let plan5Id: string;
let missionId: string;

/** Cas A du moteur (modele.test.ts), sans horizon ni devise : ceux du plan s'appliquent. */
const hypotheses = {
  premierExercice: 2027,
  chiffreAffairesReference: 100_000_000,
  croissanceChiffreAffaires: 10,
  tauxMargeBrute: 40,
  tauxChargesVariables: 5,
  chargesFixes: 10_000_000,
  effectifs: [
    { libelle: "Consultants", effectifs: 4, salaireAnnuelBrut: 3_000_000, tauxChargesSociales: 20 },
  ],
  investissements: [{ libelle: "Matériel", annee: 1, montant: 12_000_000, dureeAmortissement: 4 }],
  emprunts: [
    { libelle: "Prêt bancaire", anneeDeblocage: 1, montant: 10_000_000, tauxAnnuel: 10, duree: 2 },
  ],
  delaiClientsJours: 36,
  delaiFournisseursJours: 60,
  stocksJours: 30,
  tauxImpotSocietes: 25,
  tauxActualisation: 10,
  bilanOuverture: { tresorerie: 20_000_000, capital: 20_000_000 },
};

/** Résultat attendu : le moteur lui-même, sérialisé comme en base. */
function moteur(h: Record<string, unknown>, horizon: number, ecarts = ECARTS_SCENARIOS_DEFAUT) {
  const complet = { ...h, horizon, devise: "XOF" } as unknown as HypothesesPlan;
  return JSON.parse(JSON.stringify(calculerScenariosPlan(complet, ecarts)));
}

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Modèle A");
  b = await preparerCabinet(ctx, "Modèle B");
  missionId = (await creerMission(a)).id;
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  lecteur = await a.avecRoles(["expert_metier"]);
  for (const u of [consultant, lecteur]) {
    attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u.utilisateurId }),
    );
  }
  planId = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan 3 ans", horizon: 3 }),
  ).id;
  plan5Id = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan 5 ans" }),
  ).id;
});

afterAll(async () => {
  await ctx.fermer();
});

describe("versions du modèle financier", () => {
  it("droits : 401, 403 sans droit d'écriture, 404 autre cabinet", async () => {
    expect((await api(ctx).post(`/api/plans/${planId}/modeles`, { hypotheses })).statusCode).toBe(
      401,
    );
    for (const u of [gestionnaire, lecteur]) {
      expect((await u.post(`/api/plans/${planId}/modeles`, { hypotheses })).statusCode).toBe(403);
    }
    // Masse salariale et états du client : le gestionnaire ne lit pas le modèle (plan.lire).
    expect((await gestionnaire.get(`/api/plans/${planId}/modeles`)).statusCode).toBe(403);
    expect((await b.associe.post(`/api/plans/${planId}/modeles`, { hypotheses })).statusCode).toBe(
      404,
    );
    expect((await b.associe.get(`/api/plans/${planId}/modeles`)).statusCode).toBe(404);
  });

  it("version 1 : résultat figé identique au moteur, horizon et devise du plan", async () => {
    const v1 = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/modeles`, {
        hypotheses,
        commentaire: "Hypothèses du dirigeant",
      }),
    );
    expect(v1).toMatchObject({
      version: 1,
      moteur: "engines/plan-strategique@1",
      cree_par: consultant.utilisateurId,
      validation: null,
      equilibre: true,
      commentaire: "Hypothèses du dirigeant",
    });
    expect(v1.hypotheses).toEqual({ ...hypotheses, horizon: 3, devise: "XOF" });
    expect(v1.ecarts).toEqual(ECARTS_SCENARIOS_DEFAUT);
    expect(v1.resultat).toEqual(moteur(hypotheses, 3));
    expect(v1.resultat.base.annees).toHaveLength(3);
    expect(v1.resultat.base.annees[0].compteResultat.resultatNet).toBe(7_575_000);
    expect(v1.synthese.map((s: { scenario: string }) => s.scenario)).toEqual([
      "base",
      "optimiste",
      "pessimiste",
    ]);
    // Relu tel quel, horodaté.
    const relu = attendu(200, await lecteur.get(`/api/plans/${planId}/modeles/1`));
    expect((await gestionnaire.get(`/api/plans/${planId}/modeles/1`)).statusCode).toBe(403);
    expect(relu.resultat).toEqual(v1.resultat);
    expect(Date.parse(relu.calcule_le)).not.toBeNaN();
  });

  it("horizon 5 par défaut ; hypothèses annuelles de 5 valeurs ; écarts personnalisés", async () => {
    const h = { ...hypotheses, croissanceChiffreAffaires: [10, 8, 6, 5, 5] };
    const ecarts = {
      optimiste: { croissanceChiffreAffaires: 3 },
      pessimiste: { croissanceChiffreAffaires: -3, delaiClientsJours: 30 },
    };
    const v = attendu(
      201,
      await a.chef.post(`/api/plans/${plan5Id}/modeles`, { hypotheses: h, ecarts }),
    );
    expect(v.resultat).toEqual(moteur(h, 5, ecarts));
    expect(v.resultat.base.annees.map((x: { exercice: number }) => x.exercice)).toEqual([
      2027, 2028, 2029, 2030, 2031,
    ]);
  });

  it("hypothèses refusées par le moteur : 400 avec son code, rien n'est enregistré", async () => {
    const cas: [Record<string, unknown>, string][] = [
      [{ ...hypotheses, tauxMargeBrute: 150 }, "HYPOTHESE_INVALIDE"],
      [{ ...hypotheses, croissanceChiffreAffaires: [1, 2, 3, 4] }, "HYPOTHESE_INVALIDE"],
      [
        { ...hypotheses, bilanOuverture: { tresorerie: 1, capital: 2 } },
        "BILAN_OUVERTURE_DESEQUILIBRE",
      ],
      [{ ...hypotheses, chiffreAffairesReference: -5 }, "MONTANT_INVALIDE"],
      [
        {
          ...hypotheses,
          investissements: [{ libelle: "x", annee: 4, montant: 1, dureeAmortissement: 1 }],
        },
        "INVESTISSEMENT_INVALIDE",
      ],
    ];
    for (const [h, code] of cas) {
      const r = await consultant.post(`/api/plans/${planId}/modeles`, { hypotheses: h });
      expect(r.statusCode, code).toBe(400);
      expect(r.json().erreur.code).toBe(code);
    }
    // L'horizon et la devise ne se saisissent pas : ceux du plan s'imposent.
    for (const extra of [{ horizon: 5 }, { devise: "EUR" }]) {
      const r = await consultant.post(`/api/plans/${planId}/modeles`, {
        hypotheses: { ...hypotheses, ...extra },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().erreur.code).toBe("REQUETE_INVALIDE");
    }
    // Écart de scénario qui fait sortir une hypothèse de ses bornes.
    const r = await consultant.post(`/api/plans/${planId}/modeles`, {
      hypotheses,
      ecarts: { optimiste: { tauxMargeBrute: 70 }, pessimiste: {} },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erreur.code).toBe("HYPOTHESE_INVALIDE");
    const liste = attendu(200, await consultant.get(`/api/plans/${planId}/modeles`));
    expect(liste.elements).toHaveLength(1);
  });

  it("simulation : recalcul instantané par le moteur, sans version enregistrée", async () => {
    const h = { ...hypotheses, tauxMargeBrute: 45 };
    const s = attendu(
      200,
      await consultant.post(`/api/plans/${planId}/modeles/simulation`, { hypotheses: h }),
    );
    expect(s.resultat).toEqual(moteur(h, 3));
    expect(
      attendu(200, await consultant.get(`/api/plans/${planId}/modeles`)).elements,
    ).toHaveLength(1);
    expect(
      (await gestionnaire.post(`/api/plans/${planId}/modeles/simulation`, { hypotheses: h }))
        .statusCode,
    ).toBe(403);
  });

  it("validation : l'auteur ne valide pas sa version ; un responsable le fait, une seule fois", async () => {
    expect((await consultant.post(`/api/plans/${planId}/modeles/1/validation`)).statusCode).toBe(
      403,
    );
    const v = attendu(200, await a.chef.post(`/api/plans/${planId}/modeles/1/validation`));
    expect(v.validation).toMatchObject({ valide_par: a.chef.utilisateurId });
    const encore = await a.chef.post(`/api/plans/${planId}/modeles/1/validation`);
    expect(encore.statusCode).toBe(409);
    // Le chef auteur d'une version ne la valide pas ; le directeur de la mission, si.
    const v2 = attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/modeles`, {
        hypotheses: { ...hypotheses, croissanceChiffreAffaires: [12, 10, 8] },
      }),
    );
    expect(v2.version).toBe(2);
    const refus = await a.chef.post(`/api/plans/${planId}/modeles/2/validation`);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("VALIDATION_REQUISE");
    expect((await a.directeur.post(`/api/plans/${planId}/modeles/2/validation`)).statusCode).toBe(
      200,
    );
    expect((await b.associe.post(`/api/plans/${planId}/modeles/2/validation`)).statusCode).toBe(
      404,
    );
    expect((await a.chef.get(`/api/plans/${planId}/modeles/99`)).statusCode).toBe(404);
  });

  it("liste paginée de la plus récente à la plus ancienne", async () => {
    const p1 = attendu(200, await consultant.get(`/api/plans/${planId}/modeles?limite=1`));
    expect(p1.elements.map((v: { version: number }) => v.version)).toEqual([2]);
    expect(p1.elements[0].resultat).toBeUndefined();
    const p2 = attendu(
      200,
      await consultant.get(`/api/plans/${planId}/modeles?limite=1&curseur=${p1.curseur_suivant}`),
    );
    expect(p2.elements.map((v: { version: number }) => v.version)).toEqual([1]);
    expect(p2.curseur_suivant).toBeNull();
  });

  it("comparaison de deux versions : hypothèses modifiées et séries côte à côte, du moteur", async () => {
    const c = attendu(
      200,
      await consultant.get(`/api/plans/${planId}/modeles/comparaison?de=1&a=2`),
    );
    expect(c.hypotheses_modifiees).toEqual(["croissanceChiffreAffaires"]);
    expect(c.ecarts_modifies).toEqual([]);
    const ca = c.series.find((s: { cle: string }) => s.cle === "chiffre_affaires");
    const m1 = moteur(hypotheses, 3);
    const m2 = moteur({ ...hypotheses, croissanceChiffreAffaires: [12, 10, 8] }, 3);
    expect(ca.de).toEqual(
      m1.base.annees.map(
        (x: { exercice: number; compteResultat: { chiffreAffaires: number } }) => ({
          exercice: x.exercice,
          valeur: x.compteResultat.chiffreAffaires,
        }),
      ),
    );
    expect(ca.a[0].valeur).toBe(m2.base.annees[0].compteResultat.chiffreAffaires);
    expect(
      (await consultant.get(`/api/plans/${planId}/modeles/comparaison?de=1&a=1`)).statusCode,
    ).toBe(400);
    expect(
      (await consultant.get(`/api/plans/${planId}/modeles/comparaison?de=1&a=7`)).statusCode,
    ).toBe(404);
  });
});

describe("garanties en base du modèle", () => {
  it("versions et validations en ajout seul", async () => {
    for (const sql of [
      "UPDATE plan_modele_versions SET resultat = '{}'::jsonb",
      "DELETE FROM plan_modele_versions",
      "DELETE FROM plan_modele_validations",
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/);
    }
    await proprietaire(async (c) => {
      for (const sql of [
        "UPDATE plan_modele_versions SET resultat = '{}'::jsonb",
        "DELETE FROM plan_modele_validations",
      ]) {
        await expect(c.query(sql), sql).rejects.toMatchObject({ code: "MPS01" });
      }
    });
  });

  it("une version hors de l'horizon du plan est refusée même hors API", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO plan_modele_versions (cabinet_id, plan_id, version, hypotheses, ecarts, resultat, moteur, cree_par)
           VALUES ($1, $2, 3, '{"horizon": 5, "devise": "XOF"}', '{}', '{}', 'test', $3)`,
          [a.cabinetId, planId, a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPS02" });
  });
});

describe("ROI par initiative et données de rapport", () => {
  let initiativeId: string;

  it("ROI : VAN et TRI du moteur sur [−budget, gains], au taux de la version validée", async () => {
    const axe = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements`, {
        type: "axe",
        donnees: { titre: "Export" },
      }),
    );
    initiativeId = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements`, {
        type: "initiative",
        parent_id: axe.id,
        donnees: {
          titre: "Comptoir à Dakar",
          echeance: "2027-12-31",
          budget: 1_000_000,
          gains_annuels: [600_000, 600_000, 0],
        },
      }),
    ).id;
    attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements`, {
        type: "initiative",
        parent_id: axe.id,
        donnees: { titre: "Sans gains saisis", echeance: "2028-03-31", budget: 0 },
      }),
    );
    const roi = attendu(200, await consultant.get(`/api/plans/${planId}/initiatives/roi`));
    expect(roi).toMatchObject({ modele_version: 2, taux_actualisation: 10, source_taux: "modele" });
    const flux = [-1_000_000, 600_000, 600_000, 0];
    expect(roi.initiatives[0]).toMatchObject({
      id: initiativeId,
      flux,
      valeur_actuelle_nette: valeurActuelleNette(flux, 10, 0),
      taux_rendement_interne: tauxRendementInterne(flux),
    });
    expect(roi.initiatives[1]).toMatchObject({ valeur_actuelle_nette: null, flux: null });
    // Plan sans modèle : taux par défaut du moteur.
    const vide = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Sans modèle" }),
    );
    const sansModele = attendu(200, await a.chef.get(`/api/plans/${vide.id}/initiatives/roi`));
    expect(sansModele).toMatchObject({
      modele_version: null,
      source_taux: "defaut",
      taux_actualisation: TAUX_ACTUALISATION_DEFAUT,
      initiatives: [],
    });
    const rapportVide = attendu(200, await a.chef.get(`/api/plans/${vide.id}/rapport`));
    expect(rapportVide).toMatchObject({ financier: null, pret_pour_client: false });
    expect((await b.associe.get(`/api/plans/${planId}/initiatives/roi`)).statusCode).toBe(404);
  });

  it("données de rapport : tableaux SYSCOHADA du moteur, séries par scénario, ROI, feuille de route", async () => {
    const r = attendu(200, await lecteur.get(`/api/plans/${planId}/rapport`));
    expect((await gestionnaire.get(`/api/plans/${planId}/rapport`)).statusCode).toBe(403);
    const m2 = moteur({ ...hypotheses, croissanceChiffreAffaires: [12, 10, 8] }, 3);
    expect(r.financier.version.version).toBe(2);
    const cr = r.financier.tableaux.compte_resultat;
    expect(cr.colonnes).toEqual([2027, 2028, 2029]);
    const rn = cr.lignes.find((l: { cle: string }) => l.cle === "resultat_net");
    expect(rn).toMatchObject({ libelle: "Résultat net", reference_syscohada: "XI" });
    expect(rn.valeurs).toEqual(
      m2.base.annees.map(
        (x: { compteResultat: { resultatNet: number } }) => x.compteResultat.resultatNet,
      ),
    );
    const totalActif = r.financier.tableaux.bilan.lignes.find(
      (l: { cle: string }) => l.cle === "total_actif",
    );
    const totalPassif = r.financier.tableaux.bilan.lignes.find(
      (l: { cle: string }) => l.cle === "total_passif",
    );
    expect(totalActif.valeurs).toEqual(totalPassif.valeurs);
    const tresorerie = r.financier.series.find(
      (s: { cle: string }) => s.cle === "tresorerie_nette",
    );
    expect(Object.keys(tresorerie.scenarios)).toEqual(["base", "optimiste", "pessimiste"]);
    expect(tresorerie.scenarios.pessimiste[2].valeur).toBe(
      m2.pessimiste.annees[2].bilan.tresorerieNette,
    );
    expect(r.financier.scenarios).toEqual(m2.synthese);
    expect(r.roi.initiatives.map((i: { id: string }) => i.id)).toContain(initiativeId);
    expect(r.feuille_de_route.initiatives.length).toBe(2);
    expect(r.sections.map((s: { type: string }) => s.type)).toEqual([
      "diagnostic",
      "swot",
      "vision_mission",
      "axe",
      "objectif",
      "initiative",
    ]);
    // Brouillons non validés : pas prêt pour le client.
    expect(r.pret_pour_client).toBe(false);
    // Version demandée explicitement (non validée ailleurs : la 1 l'est).
    const v1 = attendu(200, await lecteur.get(`/api/plans/${planId}/rapport?version=1`));
    expect(v1.financier.tableaux.compte_resultat.lignes[0].valeurs[0]).toBe(110_000_000);
    expect((await lecteur.get(`/api/plans/${planId}/rapport?version=9`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/plans/${planId}/rapport`)).statusCode).toBe(404);
  });

  it("prêt pour le client = même règle que le partage : une nouvelle version non validée bloque", async () => {
    const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    for (const e of plan.elements) {
      attendu(200, await a.chef.post(`/api/plans/${planId}/elements/${e.id}/validation`));
    }
    expect(attendu(200, await a.chef.get(`/api/plans/${planId}/rapport`)).pret_pour_client).toBe(
      true,
    );
    attendu(
      201,
      await consultant.post(`/api/plans/${planId}/modeles`, {
        hypotheses: { ...hypotheses, tauxMargeBrute: 42 },
      }),
    );
    // Le rapport retient toujours la dernière version validée (2), mais la 3 n'est pas validée.
    const r = attendu(200, await a.chef.get(`/api/plans/${planId}/rapport`));
    expect(r.financier.version.version).toBe(2);
    expect(r.pret_pour_client).toBe(false);
    expect(attendu(200, await a.chef.get(`/api/plans/${planId}`)).pret_pour_client).toBe(false);
    const partage = await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true });
    expect(partage.statusCode).toBe(409);
    attendu(200, await a.chef.post(`/api/plans/${planId}/modeles/3/validation`));
    attendu(200, await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true }));
  });

  it("non-régression : une nouvelle version du modèle (non validée) retire le partage", async () => {
    expect(attendu(200, await a.chef.get(`/api/plans/${planId}`)).partage_client).toBe(true);
    const v4 = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/modeles`, {
        hypotheses: { ...hypotheses, tauxMargeBrute: 43 },
      }),
    );
    expect(v4.validation).toBeNull();
    const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    expect(plan).toMatchObject({ partage_client: false, partage_par: null, partage_le: null });
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT details FROM journal_audit WHERE entite_id = $1 AND action = 'plan.retirer_partage'`,
            [planId],
          )
        ).rows,
    );
    expect(journal).toEqual([{ details: { automatique: true, cause: "modele.calculer" } }]);
    // La simulation n'enregistre rien et ne touche pas au partage.
    attendu(200, await a.directeur.post(`/api/plans/${planId}/modeles/4/validation`));
    attendu(200, await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true }));
    attendu(200, await consultant.post(`/api/plans/${planId}/modeles/simulation`, { hypotheses }));
    expect(attendu(200, await a.chef.get(`/api/plans/${planId}`)).partage_client).toBe(true);
  });
});

describe("non-régression : volume du modèle borné", () => {
  it("résultat figé d'au plus 1 Mio (base)", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO plan_modele_versions (cabinet_id, plan_id, version, hypotheses, ecarts,
             resultat, moteur, cree_par)
           VALUES ($1, $2, 2, '{"horizon": 5, "devise": "XOF"}', '{}',
             jsonb_build_object('x', repeat('a', 1048576)), 'test', $3)`,
          [a.cabinetId, plan5Id, a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it(`au plus ${VERSIONS_MODELE_PAR_PLAN_MAX} versions par plan (API 409, base MPS05)`, async () => {
    const plein = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/plans`, {
        titre: "Plan aux versions comptées",
      }),
    ).id;
    // Versions 1 à MAX insérées hors API (résultat minimal), une par une.
    await ctx.db.withTenant(a.cabinetId, async (db) => {
      for (let v = 1; v <= VERSIONS_MODELE_PAR_PLAN_MAX; v++) {
        await db.query(
          `INSERT INTO plan_modele_versions (cabinet_id, plan_id, version, hypotheses, ecarts,
             resultat, moteur, cree_par)
           VALUES ($1, $2, $3, '{"horizon": 5, "devise": "XOF"}', '{}', '{}', 'test', $4)`,
          [a.cabinetId, plein, v, a.associeId],
        );
      }
    });
    const r = await a.chef.post(`/api/plans/${plein}/modeles`, { hypotheses });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAN_PLAFOND_VERSIONS");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO plan_modele_versions (cabinet_id, plan_id, version, hypotheses, ecarts,
             resultat, moteur, cree_par)
           VALUES ($1, $2, $3, '{"horizon": 5, "devise": "XOF"}', '{}', '{}', 'test', $4)`,
          [a.cabinetId, plein, VERSIONS_MODELE_PAR_PLAN_MAX + 1, a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPS05" });
  });
});
