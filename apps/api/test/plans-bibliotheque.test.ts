import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { echeanceDepuisDuree } from "@missionpilot/engines";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Bibliothèque d'initiatives types (PLA-13) : standard posé par migration
 * (0422) lisible de tous et immuable ; variante et initiatives propres au
 * cabinet, en versions ajout seul ; efficacité observée par contexte (moteur) ;
 * création d'une initiative du plan depuis la bibliothèque (origine tracée).
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let expert: ApiUtilisateur;
let expertB: ApiUtilisateur;
let consultant: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
let planId: string;
let planEurId: string;
let axeId: string;
let standardControle: string;

const DONNEES = {
  titre: "Comité des risques",
  description: "Instituer un comité des risques trimestriel.",
  prerequis: ["Cartographie des risques"],
  risques: [{ libelle: "Comité de façade", niveau: "moyen" }],
  cout_min: 1_000_000,
  cout_type: 3_000_000,
  cout_max: 6_000_000,
  devise: "XOF",
  duree_type_jours: 60,
  charge_type_jours: 15,
};

function attendu(statut: number, r: Awaited<ReturnType<Api["get"]>>) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

type Entree = { id: string; code: string; origine: string; titre: string };

async function toute(par: Api, chemin = "/api/bibliotheque-initiatives"): Promise<Entree[]> {
  const elements: Entree[] = [];
  let curseur: string | null = null;
  do {
    const sep = chemin.includes("?") ? "&" : "?";
    const r = attendu(
      200,
      await par.get(`${chemin}${sep}limite=5${curseur ? `&curseur=${curseur}` : ""}`),
    );
    elements.push(...r.elements);
    curseur = r.curseur_suivant;
  } while (curseur);
  return elements;
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Bibliothèque A");
  b = await preparerCabinet(ctx, "Bibliothèque B");
  expert = await a.avecRoles(["expert_metier"]);
  expertB = await b.avecRoles(["expert_metier"]);
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  attendu(
    200,
    await a.associe.patch(`/api/clients/${a.clientId}`, {
      secteur: "Banque",
      taille: "pme",
      pays: "CI",
    }),
  );
  const missionId = (await creerMission(a)).id;
  planId = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan bibliothèque" }),
  ).id;
  planEurId = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan EUR", devise: "EUR" }),
  ).id;
  axeId = attendu(
    201,
    await a.chef.post(`/api/plans/${planId}/elements`, {
      type: "axe",
      donnees: { titre: "Gouvernance" },
    }),
  ).id;
  standardControle = (await toute(a.chef)).find((e) => e.code === "controle_interne")?.id as string;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("lecture de la bibliothèque", () => {
  it("le standard (8 initiatives) est lisible de tous les cabinets, paginé par code", async () => {
    const liste = await toute(consultant);
    expect(liste).toHaveLength(8);
    expect(liste.every((e) => e.origine === "standard")).toBe(true);
    expect(liste.map((e) => e.code)).toEqual([...liste.map((e) => e.code)].sort());
    expect(await toute(b.chef)).toHaveLength(8);
    const detail = attendu(
      200,
      await consultant.get(`/api/bibliotheque-initiatives/${standardControle}`),
    );
    expect(detail).toMatchObject({ code: "controle_interne", version: 1, devise: "XOF" });
    expect(detail.prerequis.length).toBeGreaterThan(0);
    expect(detail.efficacite).toMatchObject({ retenue: null, seuil: 3 });
  });

  it("401 sans session, 403 sans plan.lire", async () => {
    expect((await api(ctx).get("/api/bibliotheque-initiatives")).statusCode).toBe(401);
    expect((await gestionnaire.get("/api/bibliotheque-initiatives")).statusCode).toBe(403);
    expect(
      (await gestionnaire.get(`/api/bibliotheque-initiatives/${standardControle}`)).statusCode,
    ).toBe(403);
  });
});

describe("initiatives du cabinet et variantes", () => {
  let propreId: string;
  let varianteId: string;

  it("crée une initiative propre (standard.gerer) ; 403 sans ce droit ; 409 sur un code du standard", async () => {
    const r = attendu(
      201,
      await expert.post("/api/bibliotheque-initiatives", {
        code: "comite_risques",
        donnees: DONNEES,
      }),
    );
    propreId = r.id;
    expect(r).toMatchObject({ origine: "cabinet", version: 1, cout_type: 3_000_000 });
    expect(
      (await consultant.post("/api/bibliotheque-initiatives", { code: "x", donnees: DONNEES }))
        .statusCode,
    ).toBe(403);
    const r409 = await expert.post("/api/bibliotheque-initiatives", {
      code: "controle_interne",
      donnees: DONNEES,
    });
    expect(attendu(409, r409).erreur.code).toBe("CODE_DU_STANDARD");
    expect(
      (
        await expert.post("/api/bibliotheque-initiatives", {
          code: "comite_risques",
          donnees: DONNEES,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await expert.post("/api/bibliotheque-initiatives", {
          code: "y",
          donnees: { ...DONNEES, cout_min: 9_000_000 },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("une variante remplace l'initiative du standard dans la vue du cabinet seulement", async () => {
    const v = attendu(
      201,
      await expert.post("/api/bibliotheque-initiatives", {
        standard_id: standardControle,
        donnees: { ...DONNEES, titre: "Contrôle interne (version cabinet)" },
      }),
    );
    varianteId = v.id;
    expect(v).toMatchObject({
      origine: "variante",
      code: "controle_interne",
      standard_id: standardControle,
    });
    expect(
      (
        await expert.post("/api/bibliotheque-initiatives", {
          standard_id: standardControle,
          donnees: DONNEES,
        })
      ).statusCode,
    ).toBe(409);
    const liste = await toute(consultant);
    expect(liste).toHaveLength(9);
    expect(liste.filter((e) => e.code === "controle_interne").map((e) => e.origine)).toEqual([
      "variante",
    ]);
    // Le cabinet B ne voit ni la variante ni l'initiative propre de A.
    expect((await toute(b.chef)).map((e) => e.origine)).not.toContain("variante");
    expect((await b.chef.get(`/api/bibliotheque-initiatives/${propreId}`)).statusCode).toBe(404);
    expect(
      (
        await expertB.post(`/api/bibliotheque-initiatives/${propreId}/versions`, {
          donnees: DONNEES,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("versionne une initiative du cabinet ; le standard est immuable (409)", async () => {
    const url = (id: string) => `/api/bibliotheque-initiatives/${id}/versions`;
    const r = attendu(
      201,
      await expert.post(url(propreId), { donnees: { ...DONNEES, duree_type_jours: 90 } }),
    );
    expect(r).toMatchObject({ version: 2, duree_type_jours: 90 });
    expect(
      (await expert.post(url(propreId), { donnees: { ...DONNEES, duree_type_jours: 90 } }))
        .statusCode,
    ).toBe(409);
    expect(
      attendu(409, await expert.post(url(standardControle), { donnees: DONNEES })).erreur.code,
    ).toBe("STANDARD_IMMUABLE");
    expect((await consultant.post(url(propreId), { donnees: DONNEES })).statusCode).toBe(403);
    attendu(201, await expert.post(url(varianteId), { donnees: DONNEES, retire: true }));
    // Variante retirée : ni elle ni l'initiative du standard ne figurent dans la vue du cabinet.
    expect((await toute(consultant)).some((e) => e.code === "controle_interne")).toBe(false);
  });
});

describe("historique des versions d'une initiative type", () => {
  it("50 versions les plus récentes, jamais coupées en silence (versions_tronquees)", async () => {
    const r = attendu(
      201,
      await expert.post("/api/bibliotheque-initiatives", {
        code: "longue_histoire",
        donnees: DONNEES,
      }),
    );
    const url = `/api/bibliotheque-initiatives/${r.id}`;
    const court = attendu(200, await expert.get(url));
    expect(court.versions).toHaveLength(1);
    expect(court.versions_tronquees).toBe(false);
    // 50 versions de plus : 51 au total, une de plus que l'affichage.
    for (let i = 1; i <= 50; i++) {
      attendu(
        201,
        await expert.post(`${url}/versions`, { donnees: { ...DONNEES, duree_type_jours: 60 + i } }),
      );
    }
    const long = attendu(200, await expert.get(url));
    expect(long.versions).toHaveLength(50);
    expect(long.versions_tronquees).toBe(true);
    // Les plus récentes d'abord : la version 51 en tête, la première (1) omise.
    expect(long.versions[0].version).toBe(51);
    expect(long.versions[49].version).toBe(2);
  }, 120_000);
});

describe("efficacité observée par contexte", () => {
  it("synthèse du moteur : contexte le plus précis au-dessus du seuil", async () => {
    const standard = (await toute(consultant)).find((e) => e.code === "recouvrement_creances");
    const url = `/api/bibliotheque-initiatives/${standard?.id}/observations`;
    for (const [efficacite, secteur, taille] of [
      [80, "Banque", "pme"],
      [70, "banque", "pme"],
      [60, "Banque", "pme"],
      [20, "Industrie", "eti"],
    ] as const) {
      attendu(201, await expert.post(url, { efficacite, secteur, taille, pays: "ci" }));
    }
    expect((await consultant.post(url, { efficacite: 50 })).statusCode).toBe(403);
    expect((await expert.post(url, { efficacite: 101 })).statusCode).toBe(400);
    const detail = attendu(
      200,
      await consultant.get(
        `/api/bibliotheque-initiatives/${standard?.id}?secteur=Banque&taille=pme&pays=CI`,
      ),
    );
    expect(detail.efficacite.retenue).toMatchObject({
      niveau: "secteur_taille_pays",
      observations: 3,
      moyenne: 70,
    });
    // Contexte du client du plan (Banque, PME, CI) appliqué par GET /plans/:id/bibliotheque.
    const vuePlan = await toute(a.chef, `/api/plans/${planId}/bibliotheque`);
    // Plan d'une mission dont le consultant n'est pas membre : 404.
    expect((await consultant.get(`/api/plans/${planId}/bibliotheque`)).statusCode).toBe(404);
    expect(vuePlan.find((e) => e.code === "recouvrement_creances")).toMatchObject({
      efficacite: { retenue: { niveau: "secteur_taille_pays", moyenne: 70 } },
    });
    // Les observations de A restent privées : B ne les voit pas.
    const detailB = attendu(200, await b.chef.get(`/api/bibliotheque-initiatives/${standard?.id}`));
    expect(detailB.efficacite.niveaux[0].observations).toBe(0);
  });

  it("refuse une observation citant une initiative d'un autre cabinet", async () => {
    const missionB = (await creerMission(b)).id;
    const planB = attendu(
      201,
      await b.chef.post(`/api/missions/${missionB}/plans`, { titre: "Plan B" }),
    ).id;
    const axeB = attendu(
      201,
      await b.chef.post(`/api/plans/${planB}/elements`, { type: "axe", donnees: { titre: "B" } }),
    ).id;
    const iniB = attendu(
      201,
      await b.chef.post(`/api/plans/${planB}/elements`, {
        type: "initiative",
        parent_id: axeB,
        donnees: { titre: "B", echeance: "2027-12-31", budget: 1 },
      }),
    ).id;
    expect(
      (
        await expert.post(`/api/bibliotheque-initiatives/${standardControle}/observations`, {
          efficacite: 50,
          plan_initiative_id: iniB,
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe("créer une initiative du plan depuis la bibliothèque", () => {
  it("reprend titre, coût type, échéance du moteur et trace l'origine", async () => {
    const standard = (await toute(consultant)).find(
      (e) => e.code === "formation_managers",
    ) as Entree & {
      cout_type: number;
      duree_type_jours: number;
    };
    const r = attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/initiatives/depuis-bibliotheque`, {
        initiative_type_id: standard.id,
        parent_id: axeId,
        debut: "2027-01-01",
      }),
    );
    expect(r).toMatchObject({
      type: "initiative",
      parent_id: axeId,
      statut_contenu: "brouillon",
      origine: { initiative_type_id: standard.id, version: 1, code: "formation_managers" },
    });
    expect(r.donnees).toMatchObject({
      titre: standard.titre,
      budget: standard.cout_type,
      debut: "2027-01-01",
      echeance: echeanceDepuisDuree("2027-01-01", standard.duree_type_jours),
    });
    expect(r.donnees.description).toContain("Prérequis");
    const surcharge = attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/initiatives/depuis-bibliotheque`, {
        initiative_type_id: standard.id,
        parent_id: axeId,
        debut: "2027-02-01",
        echeance: "2027-12-31",
        budget: 5,
        titre: "Formation adaptée",
      }),
    );
    expect(surcharge.donnees).toMatchObject({
      titre: "Formation adaptée",
      budget: 5,
      echeance: "2027-12-31",
    });
    const n = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM plan_initiatives_origines WHERE plan_id = $1", [
        planId,
      ]),
    );
    expect(n.rows[0].n).toBe(2);
  });

  it("devise différente : budget à saisir (400) ; droits et isolation", async () => {
    const standard = (await toute(consultant)).find((e) => e.code === "reduction_couts") as Entree;
    const axeEur = attendu(
      201,
      await a.chef.post(`/api/plans/${planEurId}/elements`, {
        type: "axe",
        donnees: { titre: "E" },
      }),
    ).id;
    const corps = { initiative_type_id: standard.id, parent_id: axeEur, debut: "2027-01-01" };
    const url = `/api/plans/${planEurId}/initiatives/depuis-bibliotheque`;
    expect(attendu(400, await a.chef.post(url, corps)).erreur.code).toBe("DEVISE_DIFFERENTE");
    attendu(201, await a.chef.post(url, { ...corps, budget: 10_000 }));
    expect((await gestionnaire.post(url, corps)).statusCode).toBe(403);
    expect((await b.associe.post(url, corps)).statusCode).toBe(404);
    expect((await api(ctx).post(url, corps)).statusCode).toBe(401);
  });
});

describe("défense en base", () => {
  it("le rôle applicatif n'écrit pas le standard ; tout est en ajout seul", async () => {
    await proprietaire(async (c) => {
      await expect(
        c.query("UPDATE initiative_type_versions SET titre = 'x' WHERE cabinet_id IS NULL"),
      ).rejects.toMatchObject({ code: "MPS01" });
      await expect(c.query("DELETE FROM initiative_type_observations")).rejects.toMatchObject({
        code: "MPS01",
      });
      // Variante d'une initiative qui n'est pas du standard.
      await expect(
        c.query(
          `INSERT INTO initiatives_types (cabinet_id, code, standard_id, cree_par)
           SELECT cabinet_id, 'comite_risques_bis', id, cree_par FROM initiatives_types
           WHERE code = 'comite_risques'`,
        ),
      ).rejects.toMatchObject({ code: "MPS07" });
    });
    const r = await ctx.db.withTenant(a.cabinetId, (db) =>
      db
        .query("INSERT INTO initiatives_types (cabinet_id, code) VALUES (NULL, 'standard_pirate')")
        .then(
          () => "accepte",
          (e: { code?: string }) => e.code,
        ),
    );
    expect(r).toBe("42501");
  });
});
