import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { optimiserPortefeuille, scorerInitiative } from "@missionpilot/engines";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Priorisation du portefeuille (PLA-14) : évaluations versionnées (0423),
 * proposition du moteur sous contraintes de budget et de capacité, arbitrage
 * humain tracé (proposition recalculée par l'API, motif de chaque écart,
 * doublé en base, MPS08), droits et isolation.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let planId: string;
let ini: Record<"a" | "b" | "c" | "d", string>;

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

const evaluation = { valeur: 4, effort: 2, risque: 2, charge_jours: 20 };
const evaluer = (id: string, corps: Record<string, unknown> = evaluation, par: Api = consultant) =>
  par.put(`/api/plans/${planId}/portefeuille/initiatives/${id}`, corps);

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Portefeuille A");
  b = await preparerCabinet(ctx, "Portefeuille B");
  const missionId = (await creerMission(a)).id;
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultant.utilisateurId,
    }),
  );
  planId = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan à prioriser" }),
  ).id;
  const axe = attendu(
    201,
    await a.chef.post(`/api/plans/${planId}/elements`, { type: "axe", donnees: { titre: "Axe" } }),
  ).id;
  const creer = async (titre: string, budget: number, extra = {}) =>
    attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/elements`, {
        type: "initiative",
        parent_id: axe,
        donnees: { titre, echeance: "2027-12-31", budget, ...extra },
      }),
    ).id as string;
  const ia = await creer("A — Digitalisation", 6_000_000);
  const ib = await creer("B — Formation", 5_000_000);
  const ic = await creer("C — Recouvrement", 5_000_000);
  const id = await creer("D — Non évaluée", 1_000_000);
  ini = { a: ia, b: ib, c: ic, d: id };
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("évaluations", () => {
  it("évalue les initiatives (versions), 409 si identique, score du moteur", async () => {
    attendu(200, await evaluer(ini.a, { ...evaluation, valeur: 5 }));
    attendu(200, await evaluer(ini.b));
    const c = attendu(200, await evaluer(ini.c));
    expect(c.evaluation).toMatchObject({ version: 1, score: scorerInitiative(evaluation) });
    expect((await evaluer(ini.c)).statusCode).toBe(409);
    const v2 = attendu(
      200,
      await evaluer(ini.c, { ...evaluation, commentaire: "Revu en atelier" }),
    );
    expect(v2.evaluation.version).toBe(2);
  });

  it("refuse une note hors bornes, un tiers sans droit, un autre cabinet", async () => {
    expect((await evaluer(ini.a, { ...evaluation, valeur: 6 })).statusCode).toBe(400);
    expect((await evaluer(ini.a, evaluation, gestionnaire)).statusCode).toBe(403);
    expect((await evaluer(ini.a, evaluation, b.associe)).statusCode).toBe(404);
    expect((await evaluer(ini.a, evaluation, api(ctx))).statusCode).toBe(401);
    expect((await evaluer(planId)).statusCode).toBe(404);
  });

  it("lecture du portefeuille : initiatives actives, évaluations, aucun arbitrage", async () => {
    const p = attendu(200, await consultant.get(`/api/plans/${planId}/portefeuille`));
    expect(p.initiatives).toHaveLength(4);
    expect(p.initiatives.find((i: { id: string }) => i.id === ini.d).evaluation).toBeNull();
    expect(p.dernier_arbitrage).toBeNull();
    expect((await gestionnaire.get(`/api/plans/${planId}/portefeuille`)).statusCode).toBe(403);
    expect((await b.associe.get(`/api/plans/${planId}/portefeuille`)).statusCode).toBe(404);
  });
});

describe("proposition et arbitrage", () => {
  const contraintes = { budget_max: 10_000_000, capacite_max: null };

  it("la proposition du moteur est l'optimum sous contraintes (B et C, pas A)", async () => {
    const r = attendu(
      200,
      await consultant.post(`/api/plans/${planId}/portefeuille/proposition`, contraintes),
    );
    const note = { valeur: 4, effort: 2, risque: 2, charge: 20, dependances: [] };
    const attendue = optimiserPortefeuille(
      [
        { ...note, id: ini.a, valeur: 5, cout: 6_000_000 },
        { ...note, id: ini.b, cout: 5_000_000 },
        { ...note, id: ini.c, cout: 5_000_000 },
      ],
      { budgetMax: 10_000_000, capaciteMax: null },
    );
    expect(r.proposition.retenues.sort()).toEqual([...attendue.retenues].sort());
    expect(r.proposition.retenues.sort()).toEqual([ini.b, ini.c].sort());
    expect(r.non_evaluees).toEqual([ini.d]);
    expect(
      (
        await consultant.post(`/api/plans/${planId}/portefeuille/proposition`, {
          ...contraintes,
          obligatoires: [ini.d],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await consultant.post(`/api/plans/${planId}/portefeuille/proposition`, {
          ...contraintes,
          obligatoires: [ini.a],
          exclues: [ini.a],
        })
      ).statusCode,
    ).toBe(400);
  });

  it("plafond de débit : 429 TROP_DE_PROPOSITIONS au-delà de 30 propositions en 10 minutes", async () => {
    const lecteur = await a.avecRoles(["associe"]);
    const url = `/api/plans/${planId}/portefeuille/proposition`;
    attendu(200, await lecteur.post(url, contraintes));
    // 29 lignes de journal de plus (la proposition ci-dessus compte pour la trentième).
    await proprietaire((c) =>
      c.query(
        `INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite)
         SELECT $1, $2, 'proposition_portefeuille', 'plan' FROM generate_series(1, 29)`,
        [a.cabinetId, lecteur.utilisateurId],
      ),
    );
    const refus = await lecteur.post(url, contraintes);
    expect(refus.statusCode).toBe(429);
    expect(refus.json().erreur.code).toBe("TROP_DE_PROPOSITIONS");
    // Le plafond est par utilisateur : un autre lecteur n'est pas touché.
    attendu(200, await consultant.post(url, contraintes));
  });

  it("arbitrage conforme à la proposition : 201 sans motif ; réservé au responsable", async () => {
    const corps = { contraintes, retenues: [ini.b, ini.c] };
    expect(
      (await consultant.post(`/api/plans/${planId}/portefeuille/arbitrages`, corps)).statusCode,
    ).toBe(403);
    expect(
      (await b.associe.post(`/api/plans/${planId}/portefeuille/arbitrages`, corps)).statusCode,
    ).toBe(404);
    const r = attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/portefeuille/arbitrages`, corps),
    );
    expect(r.motifs).toEqual([]);
    expect(r.proposition.retenues.sort()).toEqual([ini.b, ini.c].sort());
  });

  it("un écart à la proposition exige un motif (400 MOTIF_REQUIS), puis est tracé", async () => {
    const corps = { contraintes, retenues: [ini.a, ini.b] };
    const refus = attendu(
      400,
      await a.chef.post(`/api/plans/${planId}/portefeuille/arbitrages`, corps),
    );
    expect(refus.erreur.code).toBe("MOTIF_REQUIS");
    expect(refus.erreur.details.manquants.sort()).toEqual([ini.a, ini.c].sort());
    const r = attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/portefeuille/arbitrages`, {
        ...corps,
        motifs: [
          { initiative_id: ini.a, motif: "Exigence du conseil d'administration" },
          { initiative_id: ini.c, motif: "Reporté à l'an prochain" },
        ],
        commentaire: "Arbitrage du comité de direction",
      }),
    );
    expect(r.motifs).toHaveLength(2);
    expect(
      (
        await a.chef.post(`/api/plans/${planId}/portefeuille/arbitrages`, {
          contraintes,
          retenues: [ini.d],
        })
      ).statusCode,
    ).toBe(400);
    const liste = attendu(
      200,
      await consultant.get(`/api/plans/${planId}/portefeuille/arbitrages?limite=1`),
    );
    expect(liste.elements).toHaveLength(1);
    expect(liste.elements[0].id).toBe(r.id);
    expect(liste.curseur_suivant).toBeTruthy();
    const suite = attendu(
      200,
      await consultant.get(
        `/api/plans/${planId}/portefeuille/arbitrages?limite=1&curseur=${liste.curseur_suivant}`,
      ),
    );
    expect(suite.elements).toHaveLength(1);
    expect(suite.elements[0].id).not.toBe(r.id);
    const p = attendu(200, await consultant.get(`/api/plans/${planId}/portefeuille`));
    expect(p.dernier_arbitrage.id).toBe(r.id);
  });
});

describe("défense en base", () => {
  it("arbitrage en ajout seul (MPS01) ; écart sans motif refusé (MPS08)", async () => {
    await proprietaire(async (c) => {
      await expect(c.query("DELETE FROM plan_portefeuille_arbitrages")).rejects.toMatchObject({
        code: "MPS01",
      });
      await expect(
        c.query("UPDATE plan_portefeuille_evaluations SET valeur = 1"),
      ).rejects.toMatchObject({ code: "MPS01" });
      await expect(
        c.query(
          `INSERT INTO plan_portefeuille_arbitrages (cabinet_id, plan_id, contraintes, proposition,
             retenues, moteur, decide_par)
           SELECT cabinet_id, plan_id, contraintes, proposition, $1::jsonb, moteur, decide_par
           FROM plan_portefeuille_arbitrages LIMIT 1`,
          [JSON.stringify([ini.a])],
        ),
      ).rejects.toMatchObject({ code: "MPS08" });
    });
  });
});
