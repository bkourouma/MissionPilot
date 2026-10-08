import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recalerFeuilleDeRoute } from "@missionpilot/engines";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Feuille de route du plan (PLA-05) : dépendances entre initiatives (contenu
 * versionné), contrôles du moteur (soi-même, inconnue, cycle) doublés en base
 * (0184), recalage calculé par le moteur à la lecture, application du
 * recalage par nouvelles versions (validation à refaire, partage retiré),
 * droits et isolation.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let missionId: string;
let planId: string;
let axeId: string;
let ini: Record<"a" | "b" | "c" | "d", string>;

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

function initiative(titre: string, debut: string | null, echeance: string, extra = {}) {
  return { titre, debut, echeance, budget: 1_000_000, ...extra };
}

async function creerInitiative(donnees: Record<string, unknown>): Promise<string> {
  return attendu(
    201,
    await a.chef.post(`/api/plans/${planId}/elements`, {
      type: "initiative",
      parent_id: axeId,
      donnees,
    }),
  ).id;
}

async function version(id: string, donnees: Record<string, unknown>, par: Api = a.chef) {
  return par.post(`/api/plans/${planId}/elements/${id}/versions`, { donnees });
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Feuille A");
  b = await preparerCabinet(ctx, "Feuille B");
  missionId = (await creerMission(a)).id;
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
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan à recaler" }),
  ).id;
  axeId = attendu(
    201,
    await a.chef.post(`/api/plans/${planId}/elements`, {
      type: "axe",
      donnees: { titre: "Croissance" },
    }),
  ).id;
  const ia = await creerInitiative(initiative("A — CRM", "2027-01-01", "2027-04-15"));
  const ib = await creerInitiative(
    initiative("B — Formation", "2027-03-01", "2027-03-31", { dependances: [ia] }),
  );
  const ic = await creerInitiative(
    initiative("C — Pilote", "2027-03-01", "2027-04-30", {
      dependances: [ia],
      statut: "en_cours",
    }),
  );
  const id = await creerInitiative(
    initiative("D — Déploiement", null, "2027-05-01", { dependances: [ib.toUpperCase()] }),
  );
  ini = { a: ia, b: ib, c: ic, d: id };
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("dépendances : contrôles à l'écriture", () => {
  it("les dépendances sont stockées en minuscules dans le contenu versionné", async () => {
    const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    const d = plan.elements.find((e: { id: string }) => e.id === ini.d);
    expect(d.donnees.dependances).toEqual([ini.b]);
  });

  it("refuse une dépendance vers soi-même, inconnue, vers un axe ou un autre plan (400)", async () => {
    const autrePlan = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Autre plan" }),
    ).id;
    const autreAxe = attendu(
      201,
      await a.chef.post(`/api/plans/${autrePlan}/elements`, {
        type: "axe",
        donnees: { titre: "Autre" },
      }),
    ).id;
    const etrangere = attendu(
      201,
      await a.chef.post(`/api/plans/${autrePlan}/elements`, {
        type: "initiative",
        parent_id: autreAxe,
        donnees: initiative("Étrangère", null, "2027-01-01"),
      }),
    ).id;
    for (const dependances of [[ini.a], [axeId], [etrangere], [crypto.randomUUID()]]) {
      const r = await version(
        ini.a,
        initiative("A — CRM", "2027-01-01", "2027-04-15", { dependances }),
      );
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json().erreur.code).toBe("DEPENDANCE_INVALIDE");
    }
    const doublon = await version(
      ini.d,
      initiative("D — Déploiement", null, "2027-05-01", { dependances: [ini.b, ini.b] }),
    );
    expect(doublon.statusCode).toBe(400);
  });

  it("refuse un cycle (moteur, 400 DEPENDANCE_CYCLIQUE)", async () => {
    const r = await version(
      ini.a,
      initiative("A — CRM", "2027-01-01", "2027-04-15", { dependances: [ini.d] }),
    );
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json().erreur.code).toBe("DEPENDANCE_CYCLIQUE");
  });

  it("la base double les contrôles structurels (MPS02)", async () => {
    for (const dependances of [[axeId], ["pas-un-uuid"], [ini.b, ini.b]]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) =>
          db.query(
            `INSERT INTO plan_element_versions (cabinet_id, element_id, version, statut_contenu,
               contenu, echeance, budget, statut_initiative, auteur_id)
             SELECT cabinet_id, element_id, version + 1, 'brouillon', $2::jsonb, echeance, budget,
               statut_initiative, auteur_id
             FROM plan_element_versions WHERE element_id = $1 ORDER BY version DESC LIMIT 1`,
            [ini.d, JSON.stringify({ titre: "D", dependances })],
          ),
        ),
        JSON.stringify(dependances),
      ).rejects.toMatchObject({ code: "MPS02" });
    }
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO plan_element_versions (cabinet_id, element_id, version, statut_contenu,
             contenu, auteur_id)
           VALUES ($1, $2, 2, 'brouillon', $3::jsonb, $4)`,
          [
            a.cabinetId,
            axeId,
            JSON.stringify({ titre: "Croissance", dependances: [ini.a] }),
            a.chef.utilisateurId,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPS02" });
  });
});

describe("recalage calculé par le moteur", () => {
  it("décale les initiatives à lancer, signale le conflit d'une initiative en cours", async () => {
    const f = attendu(200, await consultant.get(`/api/plans/${planId}/feuille-de-route`));
    const parId = Object.fromEntries(f.initiatives.map((i: { id: string }) => [i.id, i])) as Record<
      string,
      Record<string, unknown>
    >;
    const moteur = recalerFeuilleDeRoute([
      { id: ini.a, debut: "2027-01-01", echeance: "2027-04-15", statut: "a_lancer" },
      {
        id: ini.b,
        debut: "2027-03-01",
        echeance: "2027-03-31",
        statut: "a_lancer",
        dependances: [ini.a],
      },
      {
        id: ini.c,
        debut: "2027-03-01",
        echeance: "2027-04-30",
        statut: "en_cours",
        dependances: [ini.a],
      },
      { id: ini.d, debut: null, echeance: "2027-05-01", statut: "a_lancer", dependances: [ini.b] },
    ]);
    for (const r of moteur.initiatives) {
      expect(parId[r.id]).toMatchObject({
        debut_recale: r.debut,
        echeance_recalee: r.echeance,
        decalage_jours: r.decalageJours,
        recalee: r.recalee,
        contrainte_par: r.contraintePar,
        conflits: r.conflits,
      });
    }
    expect(parId[ini.b]).toMatchObject({
      debut: "2027-03-01",
      echeance: "2027-03-31",
      debut_recale: "2027-04-16",
      echeance_recalee: "2027-05-16",
      decalage_jours: 46,
      recalee: true,
      contrainte_par: ini.a,
      critique: true,
    });
    expect(parId[ini.d]).toMatchObject({ echeance_recalee: "2027-05-17", recalee: true });
    expect(parId[ini.c]).toMatchObject({ recalee: false, conflits: [ini.a] });
    expect(f.recalage).toEqual({
      fin: moteur.fin,
      chemin_critique: moteur.cheminCritique,
      nombre_recalees: 2,
      nombre_conflits: 1,
    });
    // Périodes calculées sur les dates recalées : D finit au T2 2027.
    expect(parId[ini.d]!.periode_fin).toBe("2027-T2");
  });

  it("une dépendance vers une initiative retirée est ignorée et signalée", async () => {
    const e = attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/elements`, {
        type: "initiative",
        parent_id: axeId,
        donnees: initiative("E — Après C", null, "2027-12-31", { dependances: [ini.c] }),
      }),
    );
    const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    const c = plan.elements.find((x: { id: string }) => x.id === ini.c);
    attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/elements/${ini.c}/versions`, {
        donnees: c.donnees,
        retire: true,
      }),
    );
    const f = attendu(200, await consultant.get(`/api/plans/${planId}/feuille-de-route`));
    const eVue = f.initiatives.find((i: { id: string }) => i.id === e.id);
    expect(eVue).toMatchObject({ dependances: [ini.c], dependances_ignorees: [ini.c] });
    expect(f.initiatives.some((i: { id: string }) => i.id === ini.c)).toBe(false);
    // Une nouvelle dépendance vers l'initiative retirée est refusée.
    const r = await version(
      ini.a,
      initiative("A — CRM", "2027-01-01", "2027-04-15", { dependances: [ini.c] }),
    );
    expect(r.statusCode).toBe(400);
  });
});

describe("application du recalage", () => {
  it("droits : 401 sans session, 403 sans plan.ecrire, 404 pour un autre cabinet", async () => {
    const corps = { initiatives: [ini.b] };
    expect(
      (await api(ctx).post(`/api/plans/${planId}/feuille-de-route/recalage`, corps)).statusCode,
    ).toBe(401);
    expect(
      (await gestionnaire.post(`/api/plans/${planId}/feuille-de-route/recalage`, corps)).statusCode,
    ).toBe(403);
    expect(
      (await b.associe.post(`/api/plans/${planId}/feuille-de-route/recalage`, corps)).statusCode,
    ).toBe(404);
    expect((await b.associe.get(`/api/plans/${planId}/feuille-de-route`)).statusCode).toBe(404);
    expect(
      (await consultant.post(`/api/plans/${planId}/feuille-de-route/recalage`, { initiatives: [] }))
        .statusCode,
    ).toBe(400);
  });

  it("refuse une initiative qui n'est pas (ou plus) à recaler : 409, rien n'est écrit", async () => {
    const r = await consultant.post(`/api/plans/${planId}/feuille-de-route/recalage`, {
      initiatives: [ini.b, ini.a],
    });
    expect(r.statusCode, r.body).toBe(409);
    const f = attendu(200, await consultant.get(`/api/plans/${planId}/feuille-de-route`));
    expect(f.recalage.nombre_recalees).toBe(2);
  });

  it("refuse un identifiant en double, même écrit avec une autre casse : 400, rien n'est écrit", async () => {
    const majuscules = ini.b.toUpperCase();
    expect(majuscules).not.toBe(ini.b);
    for (const initiatives of [
      [ini.b, majuscules],
      [majuscules, ini.b, ini.d],
    ]) {
      const r = await consultant.post(`/api/plans/${planId}/feuille-de-route/recalage`, {
        initiatives,
      });
      expect(r.statusCode, r.body).toBe(400);
    }
    const f = attendu(200, await consultant.get(`/api/plans/${planId}/feuille-de-route`));
    expect(f.recalage.nombre_recalees).toBe(2);
  });

  it("crée une version datée par le moteur, validation à refaire, partage retiré", async () => {
    // Plan partagé : tout valider (le directeur est dispensé), puis partager.
    const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    for (const e of plan.elements.filter(
      (x: { statut_contenu: string }) => x.statut_contenu !== "valide",
    )) {
      attendu(200, await a.directeur.post(`/api/plans/${planId}/elements/${e.id}/validation`));
    }
    attendu(200, await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true }));

    const r = attendu(
      200,
      await consultant.post(`/api/plans/${planId}/feuille-de-route/recalage`, {
        initiatives: [ini.b, ini.d],
      }),
    );
    expect(r.appliquees).toEqual([
      expect.objectContaining({ id: ini.b, debut: "2027-04-16", echeance: "2027-05-16" }),
      expect.objectContaining({ id: ini.d, debut: null, echeance: "2027-05-17" }),
    ]);
    const apres = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    expect(apres.partage_client).toBe(false);
    const bApres = apres.elements.find((e: { id: string }) => e.id === ini.b);
    expect(bApres).toMatchObject({ statut_contenu: "modifie" });
    expect(bApres.donnees).toMatchObject({
      debut: "2027-04-16",
      echeance: "2027-05-16",
      dependances: [ini.a],
      titre: "B — Formation",
      budget: 1_000_000,
    });
    const f = attendu(200, await consultant.get(`/api/plans/${planId}/feuille-de-route`));
    expect(f.recalage.nombre_recalees).toBe(0);
    expect(
      (
        await consultant.post(`/api/plans/${planId}/feuille-de-route/recalage`, {
          initiatives: [ini.b],
        })
      ).statusCode,
    ).toBe(409);
    const journal = await proprietaire((c) =>
      c.query(
        `SELECT action, details FROM journal_audit
         WHERE cabinet_id = $1 AND action IN ('plan.element.recaler', 'plan.retirer_partage')
         ORDER BY cree_le`,
        [a.cabinetId],
      ),
    );
    expect(journal.rows.filter((l) => l.action === "plan.element.recaler")).toHaveLength(2);
    expect(
      journal.rows.some(
        (l) =>
          l.action === "plan.retirer_partage" && l.details.cause === "feuille_de_route.recaler",
      ),
    ).toBe(true);
  });
});
