import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HORIZON_PLAN_DEFAUT, HORIZON_PLAN_MAX, HORIZON_PLAN_MIN } from "@missionpilot/engines";
import { HORIZON_PLAN } from "@missionpilot/shared";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Plan stratégique (service #3) : droits, isolation entre cabinets, IDOR,
 * horizon, contenus versionnés en ajout seul, statuts et historique de
 * validation, séparation des tâches, partage au client.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let missionId: string;
let consultant: ApiUtilisateur;
let consultantHors: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let planId: string;

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Plans A");
  b = await preparerCabinet(ctx, "Plans B");
  missionId = (await creerMission(a)).id;
  consultant = await a.avecRoles(["consultant"]);
  consultantHors = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultant.utilisateurId,
    }),
  );
});

afterAll(async () => {
  await ctx.fermer();
});

describe("plans : création, horizon et droits", () => {
  it("les bornes de l'horizon partagées sont celles du moteur (DECISIONS.md, PLA-06)", () => {
    expect(HORIZON_PLAN).toEqual({
      defaut: HORIZON_PLAN_DEFAUT,
      min: HORIZON_PLAN_MIN,
      max: HORIZON_PLAN_MAX,
    });
  });

  it("sans session : 401", async () => {
    const anonyme = api(ctx);
    expect(
      (await anonyme.post(`/api/missions/${missionId}/plans`, { titre: "x" })).statusCode,
    ).toBe(401);
    expect((await anonyme.get(`/api/missions/${missionId}/plans`)).statusCode).toBe(401);
  });

  it("le chef de mission crée un plan : horizon 5 ans par défaut, rien de partagé", async () => {
    const plan = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan Kora 2027-2031" }),
    );
    expect(plan).toMatchObject({
      mission_id: missionId,
      horizon: 5,
      devise: "XOF",
      partage_client: false,
      partage_par: null,
    });
    planId = plan.id;
  });

  it("horizon de 3 à 5 ans à la création ; hors bornes ou non entier : 400", async () => {
    const trois = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Court", horizon: 3 }),
    );
    expect(trois.horizon).toBe(3);
    for (const horizon of [2, 6, 0, 4.5, "5"]) {
      const r = await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "x", horizon });
      expect(r.statusCode, String(horizon)).toBe(400);
    }
  });

  it("un consultant membre de l'équipe ne crée pas de plan (403) ; sans droit d'écriture : 403", async () => {
    expect(
      (await consultant.post(`/api/missions/${missionId}/plans`, { titre: "x" })).statusCode,
    ).toBe(403);
    expect(
      (await gestionnaire.post(`/api/missions/${missionId}/plans`, { titre: "x" })).statusCode,
    ).toBe(403);
  });

  it("lecture : équipe et directeur ; hors équipe et autre cabinet : 404", async () => {
    expect((await consultant.get(`/api/plans/${planId}`)).statusCode).toBe(200);
    expect((await a.directeur.get(`/api/plans/${planId}`)).statusCode).toBe(200);
    expect((await consultantHors.get(`/api/plans/${planId}`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/plans/${planId}`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/missions/${missionId}/plans`)).statusCode).toBe(404);
    expect(
      (await b.associe.post(`/api/missions/${missionId}/plans`, { titre: "x" })).statusCode,
    ).toBe(404);
  });

  it("matrice plan.* : ni gestionnaire ni ressources, même en lisant toutes les missions ; l'expert métier de l'équipe lit seulement", async () => {
    const ressources = await a.avecRoles(["ressources"]);
    for (const u of [gestionnaire, ressources]) {
      expect((await u.get(`/api/plans/${planId}`)).statusCode).toBe(403);
      expect((await u.get(`/api/missions/${missionId}/plans`)).statusCode).toBe(403);
      expect((await u.get(`/api/plans/${planId}/rapport`)).statusCode).toBe(403);
    }
    const expert = await a.avecRoles(["expert_metier"]);
    const expertHors = await a.avecRoles(["expert_metier"]);
    attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, {
        utilisateur_id: expert.utilisateurId,
      }),
    );
    expect((await expert.get(`/api/plans/${planId}`)).statusCode).toBe(200);
    expect((await expertHors.get(`/api/plans/${planId}`)).statusCode).toBe(404);
    expect(
      (
        await expert.post(`/api/plans/${planId}/elements`, {
          type: "axe",
          donnees: { titre: "x" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("liste paginée des plans de la mission", async () => {
    const p1 = attendu(200, await a.chef.get(`/api/missions/${missionId}/plans?limite=1`));
    expect(p1.elements).toHaveLength(1);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = attendu(
      200,
      await a.chef.get(`/api/missions/${missionId}/plans?limite=1&curseur=${p1.curseur_suivant}`),
    );
    expect(p2.elements[0].id).not.toBe(p1.elements[0].id);
  });
});

describe("éléments du plan : versions, statuts, validation", () => {
  let axeId: string;
  let objectifId: string;
  let initiativeId: string;

  it("un consultant de l'équipe rédige : version 1 en brouillon", async () => {
    const axe = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements`, {
        type: "axe",
        donnees: { titre: "Croissance régionale", description: "Ouvrir deux pays" },
      }),
    );
    expect(axe).toMatchObject({
      type: "axe",
      version: 1,
      statut_contenu: "brouillon",
      retire: false,
      auteur_id: consultant.utilisateurId,
      donnees: { titre: "Croissance régionale" },
    });
    axeId = axe.id;
    const objectif = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements`, {
        type: "objectif",
        parent_id: axeId,
        donnees: { titre: "Doubler le CA export", perspective: "finances", cible: "x2" },
      }),
    );
    objectifId = objectif.id;
    const initiative = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements`, {
        type: "initiative",
        parent_id: objectifId,
        donnees: {
          titre: "Filiale au Sénégal",
          responsable_id: consultant.utilisateurId,
          debut: "2027-02-01",
          echeance: "2027-11-30",
          budget: 25_000_000,
        },
      }),
    );
    expect(initiative.donnees).toMatchObject({
      responsable_id: consultant.utilisateurId,
      debut: "2027-02-01",
      echeance: "2027-11-30",
      budget: 25_000_000,
      statut: "a_lancer",
    });
    initiativeId = initiative.id;
  });

  it("contrôles : parent, type unique, responsable, dates, gains, schéma strict", async () => {
    const autrePlan = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Autre" }),
    );
    // Parent d'un autre plan, objectif sous un objectif, sans parent.
    for (const corps of [
      { type: "objectif", parent_id: axeId, donnees: { titre: "x", perspective: "clients" } },
    ]) {
      expect((await a.chef.post(`/api/plans/${autrePlan.id}/elements`, corps)).statusCode).toBe(
        400,
      );
    }
    expect(
      (
        await a.chef.post(`/api/plans/${planId}/elements`, {
          type: "objectif",
          parent_id: objectifId,
          donnees: { titre: "x", perspective: "clients" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.chef.post(`/api/plans/${planId}/elements`, {
          type: "objectif",
          donnees: { titre: "x", perspective: "clients" },
        })
      ).statusCode,
    ).toBe(400);
    const initiative = (donnees: Record<string, unknown>) =>
      a.chef.post(`/api/plans/${planId}/elements`, {
        type: "initiative",
        parent_id: axeId,
        donnees: { titre: "x", echeance: "2027-06-30", budget: 0, ...donnees },
      });
    expect((await initiative({ responsable_id: b.associeId })).statusCode).toBe(400);
    expect((await initiative({ debut: "2027-07-01" })).statusCode).toBe(400);
    expect((await initiative({ gains_annuels: [1, 2, 3] })).statusCode).toBe(400);
    expect((await initiative({ budget: -1 })).statusCode).toBe(400);
    expect((await initiative({ inconnu: 1 })).statusCode).toBe(400);
    // Vision et mission : un seul par plan.
    const vision = { type: "vision_mission", donnees: { vision: "Leader", mission: "Servir" } };
    expect((await a.chef.post(`/api/plans/${planId}/elements`, vision)).statusCode).toBe(201);
    const doublon = await a.chef.post(`/api/plans/${planId}/elements`, vision);
    expect(doublon.statusCode).toBe(409);
  });

  it("modifier crée une version ; contenu identique : 409 ; le brouillon reste brouillon", async () => {
    const v2 = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements/${axeId}/versions`, {
        donnees: { titre: "Croissance régionale UEMOA", description: "Ouvrir deux pays" },
      }),
    );
    expect(v2).toMatchObject({ version: 2, statut_contenu: "brouillon" });
    const identique = await consultant.post(`/api/plans/${planId}/elements/${axeId}/versions`, {
      donnees: { description: "Ouvrir deux pays", titre: "Croissance régionale UEMOA" },
    });
    expect(identique.statusCode).toBe(409);
    // Le contenu d'une version suit le schéma du type de l'élément.
    const mauvais = await consultant.post(`/api/plans/${planId}/elements/${axeId}/versions`, {
      donnees: { vision: "x", mission: "y" },
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it("valider : responsable de la mission seulement ; l'auteur ne valide pas seul", async () => {
    // Le consultant (simple membre) ne valide pas.
    expect(
      (await consultant.post(`/api/plans/${planId}/elements/${axeId}/validation`)).statusCode,
    ).toBe(403);
    // Le chef n'a rien écrit sur cet axe : il valide.
    const v3 = attendu(200, await a.chef.post(`/api/plans/${planId}/elements/${axeId}/validation`));
    expect(v3).toMatchObject({
      version: 3,
      statut_contenu: "valide",
      auteur_id: a.chef.utilisateurId,
      donnees: { titre: "Croissance régionale UEMOA" },
    });
    // Déjà validé : 409.
    const encore = await a.chef.post(`/api/plans/${planId}/elements/${axeId}/validation`);
    expect(encore.statusCode).toBe(409);
    expect(encore.json().erreur.code).toBe("CONTENU_VALIDE");
    // Le chef modifie (« modifie ») puis ne peut pas valider sa propre modification.
    const v4 = attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/elements/${axeId}/versions`, {
        donnees: { titre: "Croissance régionale UEMOA et CEMAC" },
      }),
    );
    expect(v4).toMatchObject({ version: 4, statut_contenu: "modifie" });
    const refus = await a.chef.post(`/api/plans/${planId}/elements/${axeId}/validation`);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("VALIDATION_REQUISE");
    // Le directeur de la mission valide.
    const v5 = attendu(
      200,
      await a.directeur.post(`/api/plans/${planId}/elements/${axeId}/validation`),
    );
    expect(v5.version).toBe(5);
  });

  it("le directeur de la mission et l'associé sont dispensés de la séparation des tâches", async () => {
    attendu(
      201,
      await a.directeur.post(`/api/plans/${planId}/elements/${objectifId}/versions`, {
        donnees: { titre: "Doubler le CA export", perspective: "finances", cible: "x2,5" },
      }),
    );
    expect(
      (await a.directeur.post(`/api/plans/${planId}/elements/${objectifId}/validation`)).statusCode,
    ).toBe(200);
    attendu(
      201,
      await a.associe.post(`/api/plans/${planId}/elements/${initiativeId}/versions`, {
        donnees: {
          titre: "Filiale au Sénégal",
          responsable_id: consultant.utilisateurId,
          debut: "2027-02-01",
          echeance: "2027-11-30",
          budget: 25_000_000,
          statut: "en_cours",
        },
      }),
    );
    expect(
      (await a.associe.post(`/api/plans/${planId}/elements/${initiativeId}/validation`)).statusCode,
    ).toBe(200);
  });

  it("historique : versions de la plus récente à la plus ancienne, paginées, statuts tracés", async () => {
    const p1 = attendu(
      200,
      await consultant.get(`/api/plans/${planId}/elements/${axeId}/historique?limite=3`),
    );
    expect(p1.elements.map((v: { version: number }) => v.version)).toEqual([5, 4, 3]);
    expect(p1.elements.map((v: { statut_contenu: string }) => v.statut_contenu)).toEqual([
      "valide",
      "modifie",
      "valide",
    ]);
    const p2 = attendu(
      200,
      await consultant.get(
        `/api/plans/${planId}/elements/${axeId}/historique?limite=3&curseur=${p1.curseur_suivant}`,
      ),
    );
    expect(p2.elements.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(p2.elements[1]).toMatchObject({
      statut_contenu: "brouillon",
      auteur_id: consultant.utilisateurId,
      donnees: { titre: "Croissance régionale" },
    });
    expect(p2.curseur_suivant).toBeNull();
  });

  it("retirer un élément : nouvelle version, l'historique reste", async () => {
    const corps = {
      type: "axe",
      donnees: { titre: "Axe abandonné" },
    };
    const e = attendu(201, await consultant.post(`/api/plans/${planId}/elements`, corps));
    const retire = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements/${e.id}/versions`, {
        donnees: corps.donnees,
        retire: true,
      }),
    );
    expect(retire).toMatchObject({ version: 2, retire: true });
    const plan = attendu(200, await consultant.get(`/api/plans/${planId}`));
    expect(plan.elements.find((x: { id: string }) => x.id === e.id).retire).toBe(true);
  });

  it("IDOR : élément d'un autre plan ou d'un autre cabinet : 404", async () => {
    const autre = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan tiers" }),
    );
    expect(
      (
        await a.chef.post(`/api/plans/${autre.id}/elements/${axeId}/versions`, {
          donnees: { titre: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await a.chef.get(`/api/plans/${autre.id}/elements/${axeId}/historique`)).statusCode,
    ).toBe(404);
    expect(
      (
        await b.associe.post(`/api/plans/${planId}/elements/${axeId}/versions`, {
          donnees: { titre: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await b.associe.post(`/api/plans/${planId}/elements/${axeId}/validation`)).statusCode,
    ).toBe(404);
    expect(
      (
        await b.associe.post(`/api/plans/${planId}/elements`, {
          type: "axe",
          donnees: { titre: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await consultantHors.post(`/api/plans/${planId}/elements`, {
          type: "axe",
          donnees: { titre: "x" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("feuille de route par trimestre et par semestre", async () => {
    const t = attendu(200, await consultant.get(`/api/plans/${planId}/feuille-de-route`));
    expect(t.pas).toBe("trimestre");
    expect(t.periodes.map((p: { periode: string }) => p.periode)).toEqual([
      "2027-T1",
      "2027-T2",
      "2027-T3",
      "2027-T4",
    ]);
    expect(
      t.periodes.every((p: { initiatives: string[] }) => p.initiatives.includes(initiativeId)),
    ).toBe(true);
    expect(t.initiatives[0]).toMatchObject({
      id: initiativeId,
      periode_debut: "2027-T1",
      periode_fin: "2027-T4",
      statut: "en_cours",
      statut_libelle: "En cours",
    });
    const s = attendu(
      200,
      await consultant.get(`/api/plans/${planId}/feuille-de-route?pas=semestre`),
    );
    expect(s.periodes.map((p: { periode: string }) => p.periode)).toEqual(["2027-S1", "2027-S2"]);
    expect(
      (await consultant.get(`/api/plans/${planId}/feuille-de-route?pas=mois`)).statusCode,
    ).toBe(400);
  });
});

describe("partage au client", () => {
  it("rien n'est partagé tant que tout le contenu n'est pas validé", async () => {
    // Le consultant n'a pas « portail.gerer ».
    expect(
      (await consultant.post(`/api/plans/${planId}/partage`, { partage_client: true })).statusCode,
    ).toBe(403);
    const r = await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("CONTENU_NON_VALIDE");
    const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    expect(plan.partage_client).toBe(false);
    expect(plan.pret_pour_client).toBe(false);
  });

  it("tout validé : partage puis retrait, journalisés", async () => {
    const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    for (const e of plan.elements.filter(
      (x: { statut_contenu: string }) => x.statut_contenu !== "valide",
    )) {
      attendu(200, await a.directeur.post(`/api/plans/${planId}/elements/${e.id}/validation`));
    }
    expect(attendu(200, await a.chef.get(`/api/plans/${planId}`)).pret_pour_client).toBe(true);
    const partage = attendu(
      200,
      await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true }),
    );
    expect(partage).toMatchObject({ partage_client: true, partage_par: a.chef.utilisateurId });
    expect(
      (await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true })).statusCode,
    ).toBe(409);
    const retrait = attendu(
      200,
      await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: false }),
    );
    expect(retrait).toMatchObject({ partage_client: false, partage_par: null, partage_le: null });
    const journal = await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        "SELECT action FROM journal_audit WHERE entite_id = $1 AND action LIKE 'plan.%' ORDER BY cree_le",
        [planId],
      ),
    );
    expect(journal.rows.map((x) => x.action)).toEqual(
      expect.arrayContaining(["plan.creer", "plan.partager", "plan.retirer_partage"]),
    );
  });

  it("non-régression : une écriture non validée sur un plan partagé retire le partage", async () => {
    const partager = async () => {
      const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
      for (const e of plan.elements.filter(
        (x: { statut_contenu: string }) => x.statut_contenu !== "valide",
      )) {
        attendu(200, await a.directeur.post(`/api/plans/${planId}/elements/${e.id}/validation`));
      }
      attendu(200, await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: true }));
    };
    const retraitsAutomatiques = async () =>
      (
        await proprietaire((c) =>
          c.query(
            `SELECT details->>'cause' AS cause FROM journal_audit
             WHERE entite_id = $1 AND action = 'plan.retirer_partage'
               AND (details->>'automatique')::boolean ORDER BY cree_le`,
            [planId],
          ),
        )
      ).rows.map((x) => x.cause);
    const etatPartage = async () => {
      const p = attendu(200, await a.chef.get(`/api/plans/${planId}`));
      return {
        partage_client: p.partage_client,
        partage_par: p.partage_par,
        partage_le: p.partage_le,
      };
    };
    const nonPartage = { partage_client: false, partage_par: null, partage_le: null };

    // 1. Nouvelle version (brouillon ou modifiée) d'un élément validé.
    await partager();
    const plan = attendu(200, await a.chef.get(`/api/plans/${planId}`));
    const axe = plan.elements.find((x: { type: string; retire: boolean }) => x.type === "axe");
    attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements/${axe.id}/versions`, {
        donnees: { ...axe.donnees, description: "Révisée après partage" },
      }),
    );
    expect(await etatPartage()).toEqual(nonPartage);
    // 2. Nouvel élément.
    await partager();
    attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements`, {
        type: "axe",
        donnees: { titre: "Axe ajouté après partage" },
      }),
    );
    expect(await etatPartage()).toEqual(nonPartage);
    // 3. Retrait d'un élément (version « modifie », retire: true).
    await partager();
    const courant = attendu(200, await a.chef.get(`/api/plans/${planId}`)).elements.find(
      (x: { donnees: { titre?: string } }) => x.donnees.titre === "Axe ajouté après partage",
    );
    attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements/${courant.id}/versions`, {
        donnees: courant.donnees,
        retire: true,
      }),
    );
    expect(await etatPartage()).toEqual(nonPartage);
    expect(await retraitsAutomatiques()).toEqual([
      "element.version",
      "element.creer",
      "element.version",
    ]);
    // Une validation (contenu identique) ne retire pas le partage.
    await partager();
    expect((await etatPartage()).partage_client).toBe(true);
    attendu(200, await a.chef.post(`/api/plans/${planId}/partage`, { partage_client: false }));
  });
});

describe("garanties en base", () => {
  it("versions et éléments en ajout seul (rôle applicatif et propriétaire)", async () => {
    for (const sql of [
      "UPDATE plan_element_versions SET contenu = '{}'::jsonb",
      "DELETE FROM plan_element_versions",
      "UPDATE plan_elements SET type = 'axe'",
      "DELETE FROM plan_elements",
      "DELETE FROM plans_strategiques",
      "UPDATE plans_strategiques SET horizon = 4",
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/);
    }
    await proprietaire(async (c) => {
      for (const sql of [
        "UPDATE plan_element_versions SET contenu = '{}'::jsonb",
        "DELETE FROM plan_element_versions",
        "DELETE FROM plan_elements",
        "UPDATE plans_strategiques SET horizon = 4",
        "DELETE FROM plans_strategiques",
      ]) {
        await expect(c.query(sql), sql).rejects.toMatchObject({ code: "MPS01" });
      }
    });
  });

  it("le déclencheur refuse qu'un auteur valide son propre contenu, même hors API", async () => {
    const e = attendu(
      201,
      await consultant.post(`/api/plans/${planId}/elements`, {
        type: "axe",
        donnees: { titre: "Axe direct" },
      }),
    );
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO plan_element_versions (cabinet_id, element_id, version, statut_contenu, contenu, auteur_id)
           SELECT cabinet_id, element_id, 2, 'valide', contenu, auteur_id
           FROM plan_element_versions WHERE element_id = $1`,
          [e.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPS03" });
    // Une « validation » qui change le contenu est refusée.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO plan_element_versions (cabinet_id, element_id, version, statut_contenu, contenu, auteur_id)
           VALUES ($1, $2, 2, 'valide', '{"titre": "autre"}', $3)`,
          [a.cabinetId, e.id, a.directeur.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPS02" });
  });

  it("non-régression : tables du plan vides et non modifiables dans une transaction du portail", async () => {
    const tables = [
      "plans_strategiques",
      "plan_elements",
      "plan_element_versions",
      "plan_modele_versions",
      "plan_modele_validations",
    ];
    const vue = (portail: boolean) =>
      ctx.db.withTenant(a.cabinetId, async (db) => {
        if (portail) {
          await db.query("SELECT set_config('app.portail_client_id', $1, true)", [a.clientId]);
        }
        const n: Record<string, number> = {};
        for (const t of tables) {
          n[t] = (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;
        }
        return n;
      });
    const interne = await vue(false);
    expect(interne.plans_strategiques).toBeGreaterThan(0);
    expect(interne.plan_element_versions).toBeGreaterThan(0);
    expect(await vue(true)).toEqual(Object.fromEntries(tables.map((t) => [t, 0])));
    await expect(
      ctx.db.withTenant(a.cabinetId, async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [a.clientId]);
        await db.query(
          `INSERT INTO plans_strategiques (cabinet_id, mission_id, titre, cree_par)
           VALUES ($1, $2, 'Plan du portail', $3)`,
          [a.cabinetId, missionId, a.associeId],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
    const partage = await ctx.db.withTenant(a.cabinetId, async (db) => {
      await db.query("SELECT set_config('app.portail_client_id', $1, true)", [a.clientId]);
      return (
        await db.query("UPDATE plans_strategiques SET titre = 'Piraté' WHERE id = $1", [planId])
      ).rowCount;
    });
    expect(partage).toBe(0);
  });

  it("un autre cabinet ne voit aucune ligne du plan (RLS)", async () => {
    const n = await ctx.db.withTenant(b.cabinetId, (db) =>
      db.query(
        `SELECT (SELECT count(*) FROM plans_strategiques WHERE id = $1)::int
              + (SELECT count(*) FROM plan_elements WHERE plan_id = $1)::int AS n`,
        [planId],
      ),
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("mission clôturée : plus aucune rédaction (409), lecture possible", async () => {
    const m = await creerMission(a);
    const plan = attendu(201, await a.chef.post(`/api/missions/${m.id}/plans`, { titre: "Clos" }));
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [m.id, a.associeId],
      ),
    );
    const r = await a.chef.post(`/api/plans/${plan.id}/elements`, {
      type: "axe",
      donnees: { titre: "x" },
    });
    expect(r.statusCode).toBe(409);
    expect((await a.chef.get(`/api/plans/${plan.id}`)).statusCode).toBe(200);
  });
});
