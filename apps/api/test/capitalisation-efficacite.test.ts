import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { attendu } from "./capitalisation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerKpi, mesurer, preparerKpi, type ScenarioKpi } from "./kpi-outils.js";
import type { ApiUtilisateur } from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";

/*
 * Efficacité des recommandations (CAP-03) : droits, isolation, mission invisible, plan et KPI
 * d'une autre mission, ajout seul, score masqué sous le seuil, portail fermé. Les dates dérivent
 * de la date du jour.
 */

const B = "/api/capitalisation/efficacite";

function jour(delta: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

let ctx: Contexte;
let s: ScenarioKpi;
let kpi1: string;
let kpi1bis: string;
let kpi2: string;
let initiative1: string;
let initiative2: string;
let recId: string;
let rec2Id: string;
let horsMission: ApiUtilisateur;

async function creerPlanInitiative(par: ApiUtilisateur, missionId: string): Promise<string> {
  const plan = attendu(201, await par.post(`/api/missions/${missionId}/plans`, { titre: "Plan" }));
  const axe = attendu(
    201,
    await par.post(`/api/plans/${plan.id}/elements`, { type: "axe", donnees: { titre: "Axe" } }),
  );
  return attendu(
    201,
    await par.post(`/api/plans/${plan.id}/elements`, {
      type: "initiative",
      parent_id: axe.id,
      donnees: { titre: "Programme de formation", echeance: jour(200), budget: 1000 },
    }),
  ).id as string;
}

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerKpi(ctx, "Efficacité");
  horsMission = await s.a.avecRoles(["chef_mission"]);
  const debut = jour(-200);
  kpi1 = (await creerKpi(s.a.chef, s.missionId, { debut_suivi: debut })).id;
  kpi1bis = (await creerKpi(s.a.chef, s.missionId, { debut_suivi: debut, libelle: "Autre" })).id;
  kpi2 = (await creerKpi(s.a.chef, s.missionA2, { debut_suivi: debut })).id;
  initiative1 = await creerPlanInitiative(s.a.chef, s.missionId);
  initiative2 = await creerPlanInitiative(s.a.chef, s.missionA2);
  await proprietaire((cl) =>
    cl.query(`UPDATE clients SET secteur = 'Agro-industrie', taille = 'pme' WHERE id = $1`, [
      s.a.clientId,
    ]),
  );
}, 240_000);

afterAll(async () => {
  await ctx.fermer();
});

const corps = (extra: Record<string, unknown> = {}) => ({
  mission_id: s.missionId,
  kpi_id: kpi1,
  plan_initiative_id: initiative1,
  libelle: "Former les équipes commerciales",
  type_initiative: "Formation",
  valeur_cible: "200",
  ...extra,
});

describe("recommandations : droits et cohérence", () => {
  it("401, 403 sans mission.planifier, 404 mission invisible ou autre cabinet", async () => {
    expect((await api(ctx).post(`${B}/recommandations`, corps())).statusCode).toBe(401);
    expect((await s.consultantEquipe.post(`${B}/recommandations`, corps())).statusCode).toBe(403);
    expect((await s.expertExterne.get(`${B}/recommandations`)).statusCode).toBe(403);
    expect((await horsMission.post(`${B}/recommandations`, corps())).statusCode).toBe(404);
    expect((await s.b.associe.post(`${B}/recommandations`, corps())).statusCode).toBe(404);
  });

  it("KPI ou initiative d'une autre mission refusés ; schéma strict", async () => {
    expect((await s.a.chef.post(`${B}/recommandations`, corps({ kpi_id: kpi2 }))).statusCode).toBe(
      404,
    );
    expect(
      (await s.a.chef.post(`${B}/recommandations`, corps({ plan_initiative_id: initiative2 })))
        .statusCode,
    ).toBe(404);
    expect((await s.a.chef.post(`${B}/recommandations`, corps({ inconnu: 1 }))).statusCode).toBe(
      400,
    );
    expect(
      (await s.a.chef.post(`${B}/recommandations`, corps({ valeur_cible: "1e5" }))).statusCode,
    ).toBe(400);
  });

  it("le chef recommande : contexte copié du client, historique, journal ; doublon 409", async () => {
    const r = attendu(201, await s.a.chef.post(`${B}/recommandations`, corps()));
    recId = r.id;
    expect(r).toMatchObject({
      statut: "recommandee",
      secteur: "Agro-industrie",
      taille: "pme",
      type_initiative: "Formation",
      valeur_cible: "200",
      peut_agir: true,
    });
    expect(r.historique).toHaveLength(1);
    const d = attendu(409, await s.a.chef.post(`${B}/recommandations`, corps()));
    expect(d.erreur.code).toBe("RECOMMANDATION_EXISTANTE");
    const j = await proprietaire((cl) =>
      cl.query(
        `SELECT count(*)::int AS n FROM journal_audit WHERE entite_id = $1
         AND action = 'capitalisation.efficacite.recommander'`,
        [recId],
      ),
    );
    expect(j.rows[0].n).toBe(1);
  });
});

describe("mise en oeuvre et mesure de l'effet", () => {
  it("mesurer avant la mise en oeuvre : 409 ; date future : 400", async () => {
    expect(
      attendu(409, await s.a.chef.post(`${B}/recommandations/${recId}/mesurer`, {})).erreur.code,
    ).toBe("NON_MISE_EN_OEUVRE");
    const f = await s.a.chef.post(`${B}/recommandations/${recId}/mise-en-oeuvre`, {
      mise_en_oeuvre_le: jour(5),
    });
    expect(attendu(400, f).erreur.code).toBe("DATE_FUTURE");
    expect(
      (
        await s.consultantEquipe.post(`${B}/recommandations/${recId}/mise-en-oeuvre`, {
          mise_en_oeuvre_le: jour(-60),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await horsMission.post(`${B}/recommandations/${recId}/mise-en-oeuvre`, {
          mise_en_oeuvre_le: jour(-60),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("mise en oeuvre, puis effet non évaluable sans mesure, puis score du moteur", async () => {
    const r = attendu(
      200,
      await s.a.chef.post(`${B}/recommandations/${recId}/mise-en-oeuvre`, {
        mise_en_oeuvre_le: jour(-60),
      }),
    );
    expect(r.statut).toBe("mise_en_oeuvre");
    expect(r.historique).toHaveLength(2);
    expect(
      attendu(409, await s.a.chef.post(`${B}/recommandations/${recId}/abandon`, { motif: "x" }))
        .erreur.code,
    ).toBe("TRANSITION_INTERDITE");

    const vide = attendu(201, await s.a.chef.post(`${B}/recommandations/${recId}/mesurer`, {}));
    expect(vide.resultat).toMatchObject({ evaluable: false, score: null });
    expect(vide.resultat.raison).toContain("valeur de base");

    await mesurer(s.a.chef, kpi1, jour(-70), 100);
    const sansEffet = attendu(
      201,
      await s.a.chef.post(`${B}/recommandations/${recId}/mesurer`, {}),
    );
    expect(sansEffet.resultat.raison_code).toBe("AUCUNE_MESURE_D_EFFET");

    const effet = await mesurer(s.a.chef, kpi1, jour(-20), 150);
    const ok = attendu(201, await s.a.chef.post(`${B}/recommandations/${recId}/mesurer`, {}));
    expect(ok.resultat).toMatchObject({ evaluable: true, score: 50, part_comblee_pour_mille: 500 });

    // Une correction remplace la mesure d'effet : seule la mesure effective compte.
    attendu(
      201,
      await s.a.chef.post(`/api/kpi/mesures/${effet.id}/corrections`, {
        date_mesure: jour(-20),
        valeur: 200,
        motif: "Valeur définitive",
      }),
    );
    const corrige = attendu(201, await s.a.chef.post(`${B}/recommandations/${recId}/mesurer`, {}));
    expect(corrige.resultat.score).toBe(100);

    const d = attendu(200, await s.a.chef.get(`${B}/recommandations/${recId}`));
    expect(d.dernier_instantane.score).toBe(100);
    expect(d.instantanes).toHaveLength(4);
  });

  it("une recommandation abandonnée ne se met plus en oeuvre ni ne se mesure", async () => {
    const r = attendu(
      201,
      await s.a.chef.post(
        `${B}/recommandations`,
        corps({ kpi_id: kpi1bis, plan_initiative_id: null }),
      ),
    );
    attendu(
      200,
      await s.a.chef.post(`${B}/recommandations/${r.id}/abandon`, { motif: "Hors budget" }),
    );
    expect(
      (
        await s.a.chef.post(`${B}/recommandations/${r.id}/mise-en-oeuvre`, {
          mise_en_oeuvre_le: jour(-1),
        })
      ).statusCode,
    ).toBe(409);
    expect((await s.a.chef.post(`${B}/recommandations/${r.id}/mesurer`, {})).statusCode).toBe(409);
    expect(
      (await s.a.chef.post(`${B}/recommandations/${r.id}/abandon`, { motif: "y" })).statusCode,
    ).toBe(409);
  });
});

describe("ajout seul et identité figée (base)", () => {
  it("MQK01, MQK03, MQK04, MQK05 et privilèges de l'application", async () => {
    const code = async (sql: string, params: unknown[]) => {
      try {
        await proprietaire((cl) => cl.query(sql, params));
      } catch (e) {
        return (e as { code?: string }).code;
      }
      return null;
    };
    expect(
      await code(`UPDATE cap_efficacite_mesures SET score = 1 WHERE recommandation_id = $1`, [
        recId,
      ]),
    ).toBe("MQK01");
    expect(
      await code(`DELETE FROM cap_efficacite_mesures WHERE recommandation_id = $1`, [recId]),
    ).toBe("MQK01");
    expect(
      await code(`UPDATE cap_recommandation_statuts SET motif = 'x' WHERE recommandation_id = $1`, [
        recId,
      ]),
    ).toBe("MQK01");
    expect(
      await code(`UPDATE cap_recommandations SET libelle = 'Autre' WHERE id = $1`, [recId]),
    ).toBe("MQK03");
    expect(
      await code(`UPDATE cap_recommandations SET valeur_cible = 1 WHERE id = $1`, [recId]),
    ).toBe("MQK03");
    expect(
      await code(
        `UPDATE cap_recommandations SET statut = 'abandonnee', mise_en_oeuvre_le = NULL WHERE id = $1`,
        [recId],
      ),
    ).toBe("MQK04");
    expect(await code(`DELETE FROM cap_recommandations WHERE id = $1`, [recId])).toBe("MQK01");
    // Instantané sur une recommandation non mise en oeuvre.
    const abandonnee = await proprietaire((cl) =>
      cl.query(
        `SELECT id, cabinet_id FROM cap_recommandations WHERE statut = 'abandonnee' LIMIT 1`,
      ),
    );
    expect(
      await code(
        `INSERT INTO cap_efficacite_mesures (cabinet_id, recommandation_id, evaluable, raison,
           delai_effet_jours, cible, resultat, calcule_par)
         VALUES ($1, $2, false, 'x', 30, 1, '{}', $3)`,
        [abandonnee.rows[0].cabinet_id, abandonnee.rows[0].id, s.a.associeId],
      ),
    ).toBe("MQK05");
    // Rôle applicatif : ni UPDATE de l'identité ni DELETE.
    for (const sql of [
      `UPDATE cap_recommandations SET libelle = 'x'`,
      `DELETE FROM cap_recommandations`,
      `UPDATE cap_efficacite_mesures SET score = 1`,
      `DELETE FROM cap_recommandation_statuts`,
    ]) {
      let c: string | undefined;
      try {
        await ctx.db.withTenant(s.a.cabinetId, (db) => db.query(sql));
      } catch (e) {
        c = (e as { code?: string }).code;
      }
      expect(c, sql).toBe("42501");
    }
  });
});

describe("scores par contexte : seuil, agrégats, visibilité", () => {
  it("sous le seuil : score et effectif masqués ; le seuil ne peut que monter", async () => {
    // Seconde recommandation (autre mission du cabinet) : même type, score 50.
    const r2 = attendu(
      201,
      await s.a.chef.post(
        `${B}/recommandations`,
        corps({ mission_id: s.missionA2, kpi_id: kpi2, plan_initiative_id: initiative2 }),
      ),
    );
    rec2Id = r2.id;
    attendu(
      200,
      await s.a.chef.post(`${B}/recommandations/${rec2Id}/mise-en-oeuvre`, {
        mise_en_oeuvre_le: jour(-60),
      }),
    );
    await mesurer(s.a.chef, kpi2, jour(-70), 100);
    await mesurer(s.a.chef, kpi2, jour(-20), 150);
    attendu(201, await s.a.chef.post(`${B}/recommandations/${rec2Id}/mesurer`, {}));

    const defaut = attendu(200, await s.consultantEquipe.get(`${B}/scores`));
    expect(defaut.seuil).toBe(5);
    expect(defaut.recommandations_suivies).toBe(2);
    const type = defaut.elements.find(
      (e: { cle: string }) => e.cle === "type_initiative=Formation",
    );
    expect(type).toMatchObject({
      effectif: null,
      score_moyen: null,
      mediane: null,
      raison: "effectif insuffisant",
    });
    expect(JSON.stringify(defaut)).not.toContain("Kora");

    // Le seuil ne peut que RELEVER le masquage : 7 masque encore, sous 5 est refusé.
    const haut = attendu(200, await s.consultantEquipe.get(`${B}/scores?seuil=7`));
    expect(haut.seuil).toBe(7);
    const t7 = haut.elements.find((e: { cle: string }) => e.cle === "type_initiative=Formation");
    expect(t7).toMatchObject({ effectif: null, score_moyen: null, mediane: null });
    // Aucun effectif de contexte sous le seuil (il pourrait identifier une recommandation).
    expect(haut.elements.every((e: { effectif: number | null }) => e.effectif === null)).toBe(true);
    for (const bas of ["4", "2", "1"]) {
      expect((await s.consultantEquipe.get(`${B}/scores?seuil=${bas}`)).statusCode).toBe(400);
    }
    expect((await s.consultantEquipe.get(`${B}/scores?seuil=0`)).statusCode).toBe(400);
  });

  it("liste : libellé et mission masqués hors mission visible ; détail 404", async () => {
    const hors = attendu(200, await s.consultantHors.get(`${B}/recommandations`));
    expect(hors.elements.length).toBe(3);
    for (const e of hors.elements) {
      expect(e).toMatchObject({
        visible: false,
        libelle: null,
        mission_id: null,
        type_initiative: null,
        secteur: null,
        taille: null,
        score: null,
        evaluable: null,
        raison: null,
      });
    }
    expect((await s.consultantHors.get(`${B}/recommandations/${recId}`)).statusCode).toBe(404);
    const chef = attendu(200, await s.a.chef.get(`${B}/recommandations?mission_id=${s.missionId}`));
    expect(chef.elements.every((e: { visible: boolean }) => e.visible)).toBe(true);
    expect(chef.elements.length).toBe(2);
    const vu = chef.elements.find((e: { id: string }) => e.id === recId);
    expect(vu).toMatchObject({ statut: "mise_en_oeuvre", score: 100 });
    const filtre = attendu(200, await s.a.chef.get(`${B}/recommandations?statut=abandonnee`));
    expect(filtre.elements.every((e: { statut: string }) => e.statut === "abandonnee")).toBe(true);
  });

  it("options de mission : KPI et initiatives du plan, réservées aux responsables", async () => {
    const o = attendu(200, await s.a.chef.get(`${B}/missions/${s.missionId}/options`));
    expect(o.kpi.length).toBe(2);
    expect(o.initiatives[0]).toMatchObject({ id: initiative1, titre: "Programme de formation" });
    expect((await s.consultantEquipe.get(`${B}/missions/${s.missionId}/options`)).statusCode).toBe(
      403,
    );
    expect((await horsMission.get(`${B}/missions/${s.missionId}/options`)).statusCode).toBe(404);
  });
});

describe("isolation entre cabinets et portail", () => {
  it("un autre cabinet ne voit ni liste, ni détail, ni agrégat", async () => {
    const l = attendu(200, await s.b.associe.get(`${B}/recommandations`));
    expect(l.elements).toEqual([]);
    expect((await s.b.associe.get(`${B}/recommandations/${recId}`)).statusCode).toBe(404);
    expect((await s.b.associe.post(`${B}/recommandations/${recId}/mesurer`, {})).statusCode).toBe(
      404,
    );
    const sc = attendu(200, await s.b.associe.get(`${B}/scores`));
    expect(sc.elements).toEqual([]);
    expect(sc.recommandations_suivies).toBe(0);
  });

  it("portail client : routes fermées (403 PORTAIL_ROUTE_INTERDITE)", async () => {
    const client = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
    for (const chemin of [`${B}/recommandations`, `${B}/scores`, `${B}/recommandations/${recId}`]) {
      const r = await client.get(chemin);
      expect(r.statusCode, chemin).toBe(403);
      expect(r.json().erreur.code, chemin).toBe("PORTAIL_ROUTE_INTERDITE");
    }
    expect((await client.post(`${B}/recommandations`, corps())).statusCode).toBe(403);
  });
});
