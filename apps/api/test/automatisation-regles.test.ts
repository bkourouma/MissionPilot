import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_AUTOMATISATIONS_ACTIVES } from "../src/automatisation/regles.js";
import {
  FENETRE_SIMULATION_MINUTES,
  SIMULATIONS_PAR_FENETRE,
} from "../src/automatisation/simulation.js";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";

/*
 * Automatisations du cabinet (AUT-02, AUT-03, AUT-06) : droits (401, 403, nominal, autre
 * cabinet), contrôles croisés de la définition, bibliothèque standard, versions immuables,
 * activation, coupe-circuits (levée réservée à un associé, doublée en base), simulation.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let anonyme: Api;

const DEFINITION = {
  evenement_code: "questionnaire.sans_reponse",
  condition: { type: "comparaison", champ: "jours_sans_reponse", operateur: "egal", valeur: 10 },
  actions: [
    {
      type: "notifier",
      destinataires: ["chef_mission"],
      titre: "Questionnaire « {{titre}} » sans réponse",
    },
  ],
};

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Automatisations A");
  b = await preparerCabinet(ctx, "Automatisations B");
  consultant = await a.avecRoles(["consultant"]);
  anonyme = api(ctx);
});

afterAll(async () => {
  await ctx.fermer();
});

async function creer(par: Api = a.associe, corps: Record<string, unknown> = {}) {
  const r = await par.post("/api/automatisations", {
    nom: "Alerte J+10",
    definition: DEFINITION,
    ...corps,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Record<string, unknown> & { id: string };
}

describe("droits", () => {
  it("401 sans session, 403 sans la permission, lecture par le chef, gestion par le directeur", async () => {
    expect((await anonyme.get("/api/automatisations")).statusCode).toBe(401);
    expect((await anonyme.get("/api/automatisations/catalogue")).statusCode).toBe(401);
    expect((await consultant.get("/api/automatisations")).statusCode).toBe(403);
    expect((await consultant.get("/api/automatisations/executions")).statusCode).toBe(403);
    expect((await a.chef.get("/api/automatisations")).statusCode).toBe(200);
    expect(
      (await a.chef.post("/api/automatisations", { nom: "X", definition: DEFINITION })).statusCode,
    ).toBe(403);
    const cree = await creer(a.directeur);
    expect(cree).toMatchObject({ active: false, version_courante: 1, standard_code: null });
    expect((await a.chef.post(`/api/automatisations/${cree.id}/activer`)).statusCode).toBe(403);
  });

  it("une automatisation d'un autre cabinet répond 404", async () => {
    const x = await creer();
    expect((await b.associe.get(`/api/automatisations/${x.id}`)).statusCode).toBe(404);
    expect((await b.associe.patch(`/api/automatisations/${x.id}`, { nom: "B" })).statusCode).toBe(
      404,
    );
    expect((await b.associe.post(`/api/automatisations/${x.id}/activer`)).statusCode).toBe(404);
    expect(
      (
        await b.associe.post(`/api/automatisations/${x.id}/coupe-circuit`, {
          actif: true,
          motif: "B",
        })
      ).statusCode,
    ).toBe(404);
    expect((await b.associe.post(`/api/automatisations/${x.id}/simulation`, {})).statusCode).toBe(
      404,
    );
    const liste = (await b.associe.get("/api/automatisations?limite=100")).json().elements as {
      id: string;
    }[];
    expect(liste.map((l) => l.id)).not.toContain(x.id);
  });
});

describe("catalogue et définition", () => {
  it("publie le catalogue des événements, le registre des actions et la bibliothèque", async () => {
    const c = (await a.chef.get("/api/automatisations/catalogue")).json();
    expect(c.evenements.map((e: { code: string }) => e.code)).toContain("mission.jalon_atteint");
    const relance = c.actions.find((x: { type: string }) => x.type === "relance_questionnaire");
    expect(relance).toMatchObject({ vers_client: true, classe_risque: "R0" });
    expect(c.standard).toHaveLength(4);
  });

  it("refuse une définition incohérente avec l'événement (400 et détails)", async () => {
    const essai = async (definition: Record<string, unknown>) =>
      a.associe.post("/api/automatisations", {
        nom: "X",
        definition: { ...DEFINITION, ...definition },
      });
    const r1 = await essai({
      condition: { type: "comparaison", champ: "inconnu", operateur: "egal", valeur: 1 },
    });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().erreur.code).toBe("DEFINITION_INVALIDE");
    expect(r1.json().erreur.details.erreurs[0]).toMatchObject({ code: "CHAMP_INCONNU" });
    const r2 = await essai({
      condition: { type: "comparaison", champ: "titre", operateur: "superieur", valeur: 3 },
    });
    expect(r2.json().erreur.details.erreurs[0].code).toBe("OPERATEUR_INCOMPATIBLE");
    const r3 = await essai({ mode_execution: "declencheur" });
    expect(r3.json().erreur.details.erreurs[0].code).toBe("DECLENCHEUR_ABSENT");
    const r4 = await essai({ actions: [{ type: "facture_brouillon" }] });
    expect(r4.json().erreur.details.erreurs[0].code).toBe("ACTION_INCOMPATIBLE");
    const r5 = await essai({
      actions: [{ type: "notifier", destinataires: ["responsable"], titre: "{{montant}}" }],
    });
    expect(r5.json().erreur.details.erreurs[0].code).toBe("VARIABLE_INCONNUE");
    const r6 = await essai({
      actions: [
        { type: "appeler_agent", agent_code: "inexistant", prompt_nom: "x", variables: {} },
      ],
    });
    expect(r6.json().erreur.details.erreurs[0].code).toBe("AGENT_INCONNU");
    const r7 = await essai({ actions: [{ type: "supprimer_mission" }] });
    expect(r7.statusCode).toBe(400);
  });
});

describe("bibliothèque standard, versions, activation", () => {
  it("ajoute une automatisation standard inactive, une seule fois", async () => {
    const r = await a.associe.post("/api/automatisations/standard/cloture_rappel_checklist");
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      active: false,
      standard_code: "cloture_rappel_checklist",
      evenement_code: "mission.cloture_demandee",
    });
    expect(
      (await a.associe.post("/api/automatisations/standard/cloture_rappel_checklist")).json().erreur
        .code,
    ).toBe("AUTOMATISATION_STANDARD_EXISTE");
    expect((await a.associe.post("/api/automatisations/standard/inconnue")).statusCode).toBe(404);
    const cat = (await a.associe.get("/api/automatisations/catalogue")).json();
    expect(
      cat.standard.find((s: { code: string }) => s.code === "cloture_rappel_checklist")
        .automatisation_id,
    ).toBe(r.json().id);
  });

  it("modifie par nouvelle version immuable, active puis désactive", async () => {
    const x = await creer();
    const m = await a.associe.patch(`/api/automatisations/${x.id}`, {
      nom: "Alerte J+14",
      definition: {
        ...DEFINITION,
        condition: {
          type: "comparaison",
          champ: "jours_sans_reponse",
          operateur: "egal",
          valeur: 14,
        },
      },
    });
    expect(m.statusCode, m.body).toBe(200);
    expect(m.json()).toMatchObject({ nom: "Alerte J+14", version_courante: 2 });
    expect(m.json().versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const act = await a.directeur.post(`/api/automatisations/${x.id}/activer`);
    expect(act.json()).toMatchObject({ active: true, responsable_id: a.directeur.utilisateurId });
    expect(
      (await a.directeur.post(`/api/automatisations/${x.id}/activer`)).json().erreur.code,
    ).toBe("ETAT_INCHANGE");
    expect((await a.directeur.post(`/api/automatisations/${x.id}/desactiver`)).json().active).toBe(
      false,
    );
    // Historique en ajout seul, même pour le rôle applicatif (MPU01).
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE automatisation_versions SET version = 9 WHERE automatisation_id = $1", [
          x.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|MPU01)$/) });
    await expect(
      proprietaire((c) =>
        c.query("DELETE FROM automatisation_versions WHERE automatisation_id = $1", [x.id]),
      ),
    ).rejects.toMatchObject({ code: "MPU01" });
  });

  it("modifier la définition d'une automatisation active la désactive (séparation des tâches)", async () => {
    const x = await creer(a.associe);
    const act = await a.associe.post(`/api/automatisations/${x.id}/activer`);
    expect(act.json()).toMatchObject({ active: true, responsable_id: a.associeId });

    // Nom et description seuls : l'exécution ne change pas, l'automatisation reste active.
    const texte = await a.directeur.patch(`/api/automatisations/${x.id}`, {
      nom: "Alerte renommée",
      description: "Nouvelle description",
    });
    expect(texte.statusCode, texte.body).toBe(200);
    expect(texte.json()).toMatchObject({
      nom: "Alerte renommée",
      active: true,
      version_courante: 1,
      responsable_id: a.associeId,
    });
    expect(texte.json().active_depuis).not.toBeNull();

    // Définition : un directeur (sans « facture.emettre ») ne fait pas exécuter son texte sous
    // l'identité de l'associé qui avait activé ; désactivation dans la même transaction.
    const def = await a.directeur.patch(`/api/automatisations/${x.id}`, {
      definition: {
        ...DEFINITION,
        condition: {
          type: "comparaison",
          champ: "jours_sans_reponse",
          operateur: "egal",
          valeur: 12,
        },
      },
    });
    expect(def.statusCode, def.body).toBe(200);
    expect(def.json()).toMatchObject({
      active: false,
      active_depuis: null,
      version_courante: 2,
      responsable_id: a.associeId,
    });
    const journal = await proprietaire((c) =>
      c.query(
        `SELECT utilisateur_id, details->>'cause' AS cause FROM journal_audit
         WHERE entite = 'automatisation' AND entite_id = $1 AND action = 'desactivation'`,
        [x.id],
      ),
    );
    expect(journal.rows).toEqual([
      { utilisateur_id: a.directeur.utilisateurId, cause: "modification de la définition" },
    ]);

    // Plus aucun événement ne la déclenche tant qu'elle n'est pas réactivée ; le réactivateur
    // devient le responsable.
    const re = await a.directeur.post(`/api/automatisations/${x.id}/activer`);
    expect(re.json()).toMatchObject({ active: true, responsable_id: a.directeur.utilisateurId });

    // Une automatisation inactive modifiée reste inactive.
    await a.directeur.post(`/api/automatisations/${x.id}/desactiver`);
    const inactive = await a.directeur.patch(`/api/automatisations/${x.id}`, {
      definition: DEFINITION,
    });
    expect(inactive.json()).toMatchObject({ active: false, version_courante: 3 });
  });

  it("une version courante incohérente est refusée en base (MPU05)", async () => {
    const x = await creer();
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE automatisations SET version_courante = 5 WHERE id = $1", [x.id]),
      ),
    ).rejects.toMatchObject({ code: "MPU05" });
  });
});

describe("plafond d'automatisations actives", () => {
  it("refuse (409) d'activer au-delà du plafond du cabinet, puis accepte après une désactivation", async () => {
    const c = await preparerCabinet(ctx, "Automatisations plafond");
    const ids = await ctx.db.withTenant(c.cabinetId, async (db) => {
      const r = await db.query(
        `WITH n AS (
           INSERT INTO automatisations (cabinet_id, nom, evenement_code, active, active_depuis,
             responsable_id, cree_par)
           SELECT $1, 'Active ' || g, 'questionnaire.sans_reponse', true, now(), $2, $2
           FROM generate_series(1, $4::int) g RETURNING id)
         INSERT INTO automatisation_versions (cabinet_id, automatisation_id, version, definition,
           cree_par) SELECT $1, id, 1, $3::jsonb, $2 FROM n RETURNING automatisation_id`,
        [c.cabinetId, c.associeId, JSON.stringify(DEFINITION), MAX_AUTOMATISATIONS_ACTIVES],
      );
      return r.rows.map((l) => l.automatisation_id as string);
    });
    expect(ids).toHaveLength(MAX_AUTOMATISATIONS_ACTIVES);

    const x = await creer(c.associe);
    const refus = await c.associe.post(`/api/automatisations/${x.id}/activer`);
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("PLAFOND_AUTOMATISATIONS_ATTEINT");
    expect((await c.associe.get(`/api/automatisations/${x.id}`)).json().active).toBe(false);

    // Un autre cabinet n'est pas concerné ; désactiver libère une place.
    const y = await creer(b.associe);
    expect((await b.associe.post(`/api/automatisations/${y.id}/activer`)).statusCode).toBe(200);
    expect((await c.associe.post(`/api/automatisations/${ids[0]}/desactiver`)).statusCode).toBe(
      200,
    );
    expect((await c.associe.post(`/api/automatisations/${x.id}/activer`)).statusCode).toBe(200);
    expect(
      (await c.associe.post(`/api/automatisations/${ids[0]}/activer`)).json().erreur.code,
    ).toBe("PLAFOND_AUTOMATISATIONS_ATTEINT");
  });
});

describe("coupe-circuits (AUT-06)", () => {
  it("couper : gestion ; lever : un associé seulement, doublé en base", async () => {
    const x = await creer();
    const coupe = await a.directeur.post(`/api/automatisations/${x.id}/coupe-circuit`, {
      actif: true,
      motif: "Relances en trop",
    });
    expect(coupe.statusCode, coupe.body).toBe(200);
    expect(coupe.json()).toMatchObject({ actif: true, motif: "Relances en trop" });
    const leve = await a.directeur.post(`/api/automatisations/${x.id}/coupe-circuit`, {
      actif: false,
      motif: "Corrigé",
    });
    expect(leve.statusCode).toBe(403);
    expect(leve.json().erreur.code).toBe("ACTION_RESERVEE");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO automatisation_coupe_circuits (cabinet_id, automatisation_id, actif, motif,
             auteur_id) VALUES ($1, $2, false, 'x', $3)`,
          [a.cabinetId, x.id, a.directeur.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPU02" });
    expect(
      (
        await a.associe.post(`/api/automatisations/${x.id}/coupe-circuit`, {
          actif: false,
          motif: "Corrigé",
        })
      ).json().actif,
    ).toBe(false);
    const liste = (await a.chef.get("/api/automatisations?limite=100")).json();
    expect(liste.elements.find((l: { id: string }) => l.id === x.id).coupee).toBe(false);

    // Cabinet : même règle.
    expect(
      (
        await a.directeur.post("/api/automatisations/coupe-circuit", {
          actif: true,
          motif: "Pause",
        })
      ).statusCode,
    ).toBe(200);
    expect((await a.chef.get("/api/automatisations/coupe-circuit")).json().actif).toBe(true);
    expect(
      (
        await a.associe.post("/api/automatisations/coupe-circuit", { actif: true, motif: "Pause" })
      ).json().erreur.code,
    ).toBe("COUPE_CIRCUIT_INCHANGE");
    expect(
      (
        await a.associe.post("/api/automatisations/coupe-circuit", {
          actif: false,
          motif: "Reprise",
        })
      ).statusCode,
    ).toBe(200);
    expect((await b.associe.get("/api/automatisations/coupe-circuit")).json().actif).toBe(false);
    expect(
      (await a.chef.post("/api/automatisations/coupe-circuit", { actif: true, motif: "x" }))
        .statusCode,
    ).toBe(403);
  });
});

describe("simulation (AUT-04)", () => {
  it("simule une définition sans effet, droits de lecture exigés", async () => {
    const r = await a.chef.post("/api/automatisations/simulation", { definition: DEFINITION });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ evenements: 0, declenchements: 0, tronque: false });
    expect(
      (await consultant.post("/api/automatisations/simulation", { definition: DEFINITION }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await a.chef.post("/api/automatisations/simulation", {
          definition: { ...DEFINITION, actions: [{ type: "facture_brouillon" }] },
        })
      ).statusCode,
    ).toBe(400);
  });

  it(`plafonne les simulations par utilisateur (${SIMULATIONS_PAR_FENETRE} par ${FENETRE_SIMULATION_MINUTES} min, 429)`, async () => {
    const c = await preparerCabinet(ctx, "Automatisations débit");
    for (let i = 0; i < SIMULATIONS_PAR_FENETRE; i++) {
      const r = await c.chef.post("/api/automatisations/simulation", { definition: DEFINITION });
      expect(r.statusCode, r.body).toBe(200);
    }
    const trop = await c.chef.post("/api/automatisations/simulation", { definition: DEFINITION });
    expect(trop.statusCode).toBe(429);
    expect(trop.json().erreur.code).toBe("TROP_DE_SIMULATIONS");
    // Le plafond est propre à l'utilisateur, et couvre aussi la simulation d'une automatisation.
    const x = await creer(c.associe);
    expect((await c.chef.post(`/api/automatisations/${x.id}/simulation`, {})).statusCode).toBe(429);
    expect(
      (await c.associe.post("/api/automatisations/simulation", { definition: DEFINITION }))
        .statusCode,
    ).toBe(200);
  });
});
