import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Référentiel de méthodes appliqué aux missions : mission figée sur une
 * version (STD-08), journal d'application des règles (STD-05), méthode
 * effective (standard → contexte → dérogations), migration assistée avec
 * analyse d'impact, mise à jour du standard proposée à une variante
 * (STD-03), dérogations approuvées selon la classe de risque (STD-07).
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let expert: ApiUtilisateur;
let missionId: string;
let notationV1: string;
let testStandardId: string;
let testV1: string;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

const PME_CACAO = {
  effectif: 12,
  fiabilite_comptes: "non_certifies",
  part_informel: "forte",
  actionnariat: "familial",
  filieres: ["cacao"],
  agricole: true,
};

/** Méthode du standard propre au test (propriétaire : comme une migration d'ACC), version 1 publiée. */
async function creerStandardTest(): Promise<{ methodeId: string; versionId: string }> {
  return proprietaire(async (c) => {
    const m = await c.query(
      `INSERT INTO methodes (service_id, code, libelle)
       SELECT id, 'methode_test_maj', 'Méthode de test' FROM services_conseil
        WHERE cabinet_id IS NULL AND code = 'pilotage_kpi' RETURNING id`,
    );
    const methodeId = m.rows[0].id as string;
    const v = await c.query(
      `INSERT INTO methode_versions (methode_id, version) VALUES ($1, 1) RETURNING id`,
      [methodeId],
    );
    const versionId = v.rows[0].id as string;
    await remplirVersion(c, versionId, false);
    await c.query(
      `UPDATE methode_versions SET statut = 'publiee', publie_le = now() WHERE id = $1`,
      [versionId],
    );
    return { methodeId, versionId };
  });
}

async function remplirVersion(
  c: { query: (sql: string, p?: unknown[]) => Promise<unknown> },
  versionId: string,
  v2: boolean,
) {
  await c.query(
    `INSERT INTO methode_etapes (version_id, code, libelle, ordre) VALUES ($1, 'cadrage', 'Cadrage', 1)`,
    [versionId],
  );
  const briques: [string, string, boolean][] = [
    ["cadrage_test", "R1", true],
    ["option_test", "R2", false],
  ];
  if (v2) briques.push(["brique_v2", "R1", true]);
  for (const [code, classe, active] of briques) {
    await c.query(
      `INSERT INTO methode_briques (version_id, etape_id, code, libelle, objet, classe_risque,
         niveau_autonomie_max, active_par_defaut)
       SELECT $1, id, $2, $2, 'Objet de test', $3, 'N1', $4 FROM methode_etapes
        WHERE version_id = $1 AND code = 'cadrage'`,
      [versionId, code, classe, active],
    );
  }
  await c.query(`INSERT INTO methode_regles (version_id, code, regle) VALUES ($1, 'grande', $2)`, [
    versionId,
    JSON.stringify({
      code: "grande",
      priorite: 10,
      condition: {
        type: "comparaison",
        facteur: "effectif",
        comparateur: "superieur",
        valeur: 100,
      },
      effets: [{ type: "activer_brique", brique: "option_test" }],
    }),
  ]);
}

async function publierStandardV2(methodeId: string): Promise<string> {
  return proprietaire(async (c) => {
    const v = await c.query(
      `INSERT INTO methode_versions (methode_id, version, notes_version)
       VALUES ($1, 2, 'Ajout de la brique v2.') RETURNING id`,
      [methodeId],
    );
    const versionId = v.rows[0].id as string;
    await remplirVersion(c, versionId, true);
    await c.query(
      `UPDATE methode_versions SET statut = 'publiee', publie_le = now() WHERE id = $1`,
      [versionId],
    );
    return versionId;
  });
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Méthodes missions A");
  b = await preparerCabinet(ctx, "Méthodes missions B");
  consultant = await a.avecRoles(["consultant"]);
  expert = await a.avecRoles(["expert_metier"]);
  missionId = (await creerMission(a)).id;
  for (const u of [consultant, expert]) {
    attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u.utilisateurId }),
    );
  }
  const liste = attendu(200, await a.associe.get("/api/methodes?limite=100"));
  notationV1 = liste.elements.find((m: { code: string }) => m.code === "notation_entreprise")
    .derniere_publiee.id;
  const t = await creerStandardTest();
  testStandardId = t.methodeId;
  testV1 = t.versionId;
});

afterAll(async () => {
  await ctx.fermer();
});

describe("mission figée sur une version de méthode (STD-08)", () => {
  it("sans méthode : liaison nulle ; sans session 401 ; autre cabinet 404", async () => {
    expect(attendu(200, await consultant.get(`/api/missions/${missionId}/methode`))).toEqual({
      liaison: null,
    });
    expect((await api(ctx).get(`/api/missions/${missionId}/methode`)).statusCode).toBe(401);
    expect((await b.associe.get(`/api/missions/${missionId}/methode`)).statusCode).toBe(404);
  });

  it("lier : le consultant ne peut pas (403), un contexte invalide est refusé (400)", async () => {
    const corps = { version_id: notationV1, contexte: PME_CACAO };
    expect((await consultant.put(`/api/missions/${missionId}/methode`, corps)).statusCode).toBe(
      403,
    );
    expect((await b.associe.put(`/api/missions/${missionId}/methode`, corps)).statusCode).toBe(404);
    const r = await a.chef.put(`/api/missions/${missionId}/methode`, {
      version_id: notationV1,
      contexte: { effectif: -3 },
    });
    expect(attendu(400, r).erreur.code).toBe("CONTEXTE_INVALIDE");
  });

  it("le chef lie la notation du standard : méthode effective modulée et journal d'application", async () => {
    // Ce contexte active ou retire des briques de classe R2 ou R3 : motif obligatoire.
    const sansMotif = attendu(
      400,
      await a.chef.put(`/api/missions/${missionId}/methode`, {
        version_id: notationV1,
        contexte: PME_CACAO,
      }),
    );
    expect(sansMotif.erreur.code).toBe("MOTIF_REQUIS");
    expect(
      (
        await a.chef.put(`/api/missions/${missionId}/methode`, {
          version_id: notationV1,
          contexte: PME_CACAO,
          motif: "   ",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      attendu(200, await consultant.get(`/api/missions/${missionId}/methode`)).liaison,
    ).toBeNull();
    const m = attendu(
      200,
      await a.chef.put(`/api/missions/${missionId}/methode`, {
        version_id: notationV1,
        contexte: PME_CACAO,
        motif: "Contexte du dossier : PME cacao familiale, comptes non certifiés.",
      }),
    );
    expect(m.liaison).toMatchObject({
      rang: 1,
      evenement: "liaison",
      methode_version_id: notationV1,
      motif: "Contexte du dossier : PME cacao familiale, comptes non certifiés.",
    });
    expect(m.version).toMatchObject({ methode_code: "notation_entreprise", origine: "standard" });
    const briques = Object.fromEntries(
      m.etapes
        .flatMap((e: { briques: { code: string }[] }) => e.briques)
        .map((x: { code: string }) => [x.code, x]),
    );
    expect(briques.atelier_unique).toMatchObject({ active: true, origine: "modulation" });
    expect(briques.entretiens_individuels).toMatchObject({ active: false, origine: "modulation" });
    expect(briques.analyse_financiere).toMatchObject({
      classe_risque_base: "R2",
      classe_risque: "R3",
      ajustements: { formulation: "indicative" },
      garde_requise: { quatre_yeux: true, signature: true },
    });
    expect(briques.ecarts_perception.garde_requise.etapes).toEqual([
      "validation_consultant",
      "relecture_chef_mission",
    ]);
    expect(m.modulation.regles_declenchees).toHaveLength(4);
    const journal = m.modulation.journal.find(
      (j: { regle: string }) => j.regle === "comptes_fragiles",
    );
    expect(journal.verifications.map((v: { lu: unknown }) => v.lu)).toEqual([
      "non_certifies",
      "forte",
    ]);
    const item = m.elements.find((e: { code: string }) => e.code === "item_succession");
    expect(item).toMatchObject({ actif: true, origine: "modulation" });
    expect(m.recommandations_candidates).toEqual(["kpi_pertes_post_recolte"]);
    expect(m.mise_a_jour).toBeNull();
    expect(
      attendu(
        409,
        await a.chef.put(`/api/missions/${missionId}/methode`, {
          version_id: notationV1,
          contexte: {},
        }),
      ).erreur.code,
    ).toBe("METHODE_DEJA_LIEE");
  });

  it("lecture : équipe (consultant, expert) ; changement de contexte journalisé au rang 2", async () => {
    expect((await consultant.get(`/api/missions/${missionId}/methode`)).statusCode).toBe(200);
    expect(
      (await consultant.post(`/api/missions/${missionId}/methode/contexte`, { contexte: {} }))
        .statusCode,
    ).toBe(403);
    const m = attendu(
      200,
      await a.directeur.post(`/api/missions/${missionId}/methode/contexte`, {
        contexte: { ...PME_CACAO, effectif: 45 },
        motif: "Effectif consolidé du groupe familial.",
      }),
    );
    expect(m.liaison).toMatchObject({ rang: 2, evenement: "contexte" });
    expect(m.historique.map((h: { rang: number }) => h.rang)).toEqual([2, 1]);
    expect(m.modulation.regles_declenchees).not.toContain("petite_structure");
  });

  it("changer de contexte : motif obligatoire seulement si une brique de classe R2 ou R3 est activée ou retirée", async () => {
    const url = `/api/missions/${missionId}/methode/contexte`;
    // Retire des briques R2 ou R3 (les facteurs du dossier disparaissent) : sans motif, 400, rien d'écrit.
    const refus = attendu(400, await a.directeur.post(url, { contexte: { effectif: 46 } }));
    expect(refus.erreur.code).toBe("MOTIF_REQUIS");
    expect(
      attendu(400, await a.directeur.post(url, { contexte: { effectif: 46 }, motif: " " })).erreur
        .code,
    ).toBe("MOTIF_REQUIS");
    const apres = attendu(200, await consultant.get(`/api/missions/${missionId}/methode`));
    expect(apres.liaison.rang).toBe(2);
    // Même ensemble de briques R2 et R3 : pas de motif exigé.
    const ok = attendu(
      200,
      await a.directeur.post(url, { contexte: { ...PME_CACAO, effectif: 46 } }),
    );
    expect(ok.liaison).toMatchObject({ rang: 3, evenement: "contexte", motif: null });
  });

  it("l'historique de la mission est en ajout seul (MPM03)", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(`DELETE FROM mission_methodes WHERE mission_id = $1`, [missionId]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      proprietaire((c) =>
        c.query(`UPDATE mission_methodes SET motif = 'x' WHERE mission_id = $1`, [missionId]),
      ),
    ).rejects.toMatchObject({ code: "MPM03" });
  });

  it("une version d'un autre cabinet ou en brouillon ne se lie pas", async () => {
    const autre = (await creerMission(a)).id;
    const variante = attendu(
      201,
      await b.associe.post(`/api/methodes/${testStandardId}/variantes`, {}),
    );
    expect(
      (
        await a.chef.put(`/api/missions/${autre}/methode`, {
          version_id: variante.version_id,
          contexte: {},
        })
      ).statusCode,
    ).toBe(404);
    const propre = attendu(201, await expert.post(`/api/methodes/${testStandardId}/variantes`, {}));
    expect(
      (
        await a.chef.put(`/api/missions/${autre}/methode`, {
          version_id: propre.version_id,
          contexte: {},
        })
      ).statusCode,
    ).toBe(409);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO mission_methodes (cabinet_id, mission_id, rang, evenement, methode_version_id,
             contexte, resultat, cree_par) VALUES ($1, $2, 1, 'liaison', $3, '{}', '{}', $4)`,
          [a.cabinetId, autre, variante.version_id, a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPM06" });
  });
});

describe("évolution du standard : migration de mission et mise à jour de variante", () => {
  let mission2: string;
  let varianteId: string;
  let varianteV1: string;
  let testV2: string;

  it("préparation : mission liée à la v1, variante du cabinet publiée avec un écart propre", async () => {
    mission2 = (await creerMission(a)).id;
    attendu(
      200,
      await a.chef.put(`/api/missions/${mission2}/methode`, {
        version_id: testV1,
        contexte: { effectif: 300 },
        motif: "Grande structure : l'option est activée.",
      }),
    );
    const detail = attendu(200, await a.associe.get(`/api/methodes/${testStandardId}`));
    varianteId = detail.variante.id;
    const variante = attendu(200, await expert.get(`/api/methodes/${varianteId}`));
    varianteV1 = variante.versions[0].id;
    const v = attendu(200, await expert.get(`/api/methodes/versions/${varianteV1}`));
    const option = v.briques.find((x: { code: string }) => x.code === "option_test");
    attendu(
      200,
      await expert.patch(`/api/methodes/versions/${varianteV1}/briques/${option.id}`, {
        libelle: "Option du cabinet",
      }),
    );
    // Quatre yeux : le créateur de la variante (expert) ne la publie pas, l'associé le peut.
    expect(
      attendu(403, await expert.post(`/api/methodes/versions/${varianteV1}/publication`)).erreur
        .code,
    ).toBe("SEPARATION_DES_TACHES");
    attendu(200, await a.associe.post(`/api/methodes/versions/${varianteV1}/publication`));
  });

  it("le standard publie une v2 : rien ne change en silence, la mise à jour est proposée", async () => {
    testV2 = await publierStandardV2(testStandardId);
    const m = attendu(200, await a.chef.get(`/api/missions/${mission2}/methode`));
    expect(m.liaison.methode_version_id).toBe(testV1);
    expect(m.mise_a_jour).toMatchObject({ id: testV2, version: 2 });
    const variante = attendu(200, await expert.get(`/api/methodes/${varianteId}`));
    expect(variante.mise_a_jour_standard).toMatchObject({ disponible: { id: testV2, version: 2 } });
    const analyse = attendu(
      200,
      await expert.get(`/api/methodes/versions/${varianteV1}/mise-a-jour`),
    );
    expect(analyse.disponible).toBe(true);
    expect(analyse.evolutions_standard.briques.ajoutes).toEqual(["brique_v2"]);
    expect(analyse.ecarts_cabinet.briques.modifies).toEqual([
      { code: "option_test", champs: ["libelle"] },
    ]);
    expect(analyse.conflits).toEqual([]);
  });

  it("analyse d'impact de la migration (STD-08), puis migration motivée au rang 2", async () => {
    const analyse = attendu(
      200,
      await a.chef.get(`/api/missions/${mission2}/methode/migration?version_id=${testV2}`),
    );
    expect(analyse.differences.briques.ajoutes).toEqual(["brique_v2"]);
    expect(analyse.modulation.ajoutes.map((e: { cle: string }) => e.cle)).toEqual([]);
    expect(analyse.version_cible).toMatchObject({
      version: 2,
      notes_version: "Ajout de la brique v2.",
    });
    expect(
      (
        await a.chef.post(`/api/missions/${mission2}/methode/migration`, {
          version_id: testV2,
          motif: "court",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await consultant.post(`/api/missions/${mission2}/methode/migration`, {
          version_id: testV2,
          motif: "Adopter la version 2 du standard.",
        })
      ).statusCode,
    ).toBe(403);
    const m = attendu(
      200,
      await a.chef.post(`/api/missions/${mission2}/methode/migration`, {
        version_id: testV2,
        motif: "Adopter la version 2 du standard.",
      }),
    );
    expect(m.liaison).toMatchObject({
      rang: 2,
      evenement: "migration",
      methode_version_id: testV2,
    });
    expect(m.mise_a_jour).toBeNull();
    const codes = m.etapes[0].briques.map((x: { code: string }) => x.code);
    expect(codes).toContain("brique_v2");
    expect(
      attendu(
        409,
        await a.chef.post(`/api/missions/${mission2}/methode/migration`, {
          version_id: testV1,
          motif: "Retour à la version 1.",
        }),
      ).erreur.code,
    ).toBe("VERSION_NON_LIABLE");
  });

  it("la variante se rebase : choix du cabinet conservés, nouveauté du standard reprise", async () => {
    const n = attendu(
      201,
      await expert.post(`/api/methodes/${varianteId}/versions`, { rebaser: true }),
    );
    expect(n.conflits).toEqual([]);
    const v = attendu(200, await expert.get(`/api/methodes/versions/${n.id}`));
    expect(v.version.base_standard_id).toBe(testV2);
    expect(v.version.notes_version).toMatch(/version 2 du standard/);
    const codes = v.briques.map((x: { code: string }) => x.code);
    expect(codes).toEqual(expect.arrayContaining(["brique_v2", "option_test", "cadrage_test"]));
    expect(v.briques.find((x: { code: string }) => x.code === "option_test").libelle).toBe(
      "Option du cabinet",
    );
    expect(v.differences.diff.briques.modifies).toEqual([
      { code: "option_test", champs: ["libelle"] },
    ]);
  });
});

describe("dérogations (STD-07)", () => {
  let derogationR2: string;
  let derogationR3: string;

  it("droits : sans methode.deroger 403 ; autre cabinet 404 ; brique inconnue 400 ; motif court 400", async () => {
    const corps = {
      brique_code: "restitution_dirigeants",
      nature: "retirer_brique",
      motif: "Restitution faite en conseil d'administration.",
    };
    expect(
      (await consultant.post(`/api/missions/${missionId}/derogations`, corps)).statusCode,
    ).toBe(403);
    expect((await b.associe.post(`/api/missions/${missionId}/derogations`, corps)).statusCode).toBe(
      404,
    );
    expect(
      (
        await a.chef.post(`/api/missions/${missionId}/derogations`, {
          ...corps,
          brique_code: "inconnue",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await a.chef.post(`/api/missions/${missionId}/derogations`, { ...corps, motif: "court" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await a.chef.post(`/api/missions/${missionId}/derogations`, {
          ...corps,
          brique_code: "atelier_unique",
        })
      ).statusCode,
    ).toBe(409);
  });

  it("R1 : approuvée dès la demande (validation de l'auteur), appliquée à la méthode effective", async () => {
    const d = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/derogations`, {
        brique_code: "forces_faiblesses",
        nature: "retirer_brique",
        motif: "Les forces et faiblesses sont reprises du diagnostic précédent.",
      }),
    );
    expect(d).toMatchObject({ classe_risque: "R1", statut: "approuvee" });
    expect(d.validations.map((v: { etape: string }) => v.etape)).toEqual(["validation_auteur"]);
    const m = attendu(200, await consultant.get(`/api/missions/${missionId}/methode`));
    const brique = m.etapes
      .flatMap((e: { briques: { code: string }[] }) => e.briques)
      .find((x: { code: string }) => x.code === "forces_faiblesses");
    expect(brique).toMatchObject({ active: false, origine: "derogation", derogations: [d.id] });
  });

  it("R2 : relecture du chef ou du directeur, jamais par le demandeur", async () => {
    const d = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/derogations`, {
        brique_code: "restitution_dirigeants",
        nature: "retirer_brique",
        motif: "Restitution faite en conseil d'administration.",
      }),
    );
    derogationR2 = d.id;
    // Garde doublée en base : approuvée sans la relecture exigée par la classe R2 → MPM04.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(`UPDATE derogations SET statut = 'approuvee', decide_le = now() WHERE id = $1`, [
          d.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPM04" });
    expect(d).toMatchObject({
      classe_risque: "R2",
      statut: "demandee",
      garde: { prochaine_etape: "relecture_chef_mission" },
    });
    const decision = { etape: "relecture_chef_mission", decision: "approuve" };
    expect((await a.chef.post(`/api/derogations/${d.id}/decisions`, decision)).statusCode).toBe(
      403,
    );
    expect((await consultant.post(`/api/derogations/${d.id}/decisions`, decision)).statusCode).toBe(
      403,
    );
    expect((await b.associe.post(`/api/derogations/${d.id}/decisions`, decision)).statusCode).toBe(
      404,
    );
    expect(
      attendu(
        409,
        await a.directeur.post(`/api/derogations/${d.id}/decisions`, {
          ...decision,
          etape: "revue_second_expert",
        }),
      ).erreur.code,
    ).toBe("ETAPE_INATTENDUE");
    const ok = attendu(200, await a.directeur.post(`/api/derogations/${d.id}/decisions`, decision));
    expect(ok.statut).toBe("approuvee");
    expect(
      attendu(409, await a.directeur.post(`/api/derogations/${d.id}/decisions`, decision)).erreur
        .code,
    ).toBe("DEROGATION_DECIDEE");
  });

  it("R3 (classe relevée par une règle) : relecture, second expert, signature ; quatre yeux", async () => {
    const d = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/derogations`, {
        brique_code: "analyse_financiere",
        nature: "adapter_brique",
        description: "Limiter l'analyse aux deux derniers exercices.",
        motif: "Le premier exercice n'a pas été arrêté par le client.",
      }),
    );
    derogationR3 = d.id;
    expect(d.classe_risque).toBe("R3");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(`UPDATE derogations SET statut = 'approuvee', decide_le = now() WHERE id = $1`, [
          d.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPM04" });
    expect(d.garde.etapes_requises).toEqual([
      "validation_consultant",
      "relecture_chef_mission",
      "revue_second_expert",
      "signature_directeur_mission",
    ]);
    attendu(
      200,
      await a.directeur.post(`/api/derogations/${d.id}/decisions`, {
        etape: "relecture_chef_mission",
        decision: "approuve",
      }),
    );
    expect(
      (
        await consultant.post(`/api/derogations/${d.id}/decisions`, {
          etape: "revue_second_expert",
          decision: "approuve",
        })
      ).statusCode,
    ).toBe(403);
    attendu(
      200,
      await expert.post(`/api/derogations/${d.id}/decisions`, {
        etape: "revue_second_expert",
        decision: "approuve",
      }),
    );
    const cumul = await a.directeur.post(`/api/derogations/${d.id}/decisions`, {
      etape: "signature_directeur_mission",
      decision: "approuve",
    });
    expect(attendu(403, cumul).erreur.code).toBe("SEPARATION_DES_TACHES");
    const signee = attendu(
      200,
      await a.associe.post(`/api/derogations/${d.id}/decisions`, {
        etape: "signature_directeur_mission",
        decision: "approuve",
        commentaire: "Signé par l'associé.",
      }),
    );
    expect(signee.statut).toBe("approuvee");
    const m = attendu(200, await consultant.get(`/api/missions/${missionId}/methode`));
    const brique = m.etapes
      .flatMap((e: { briques: { code: string }[] }) => e.briques)
      .find((x: { code: string }) => x.code === "analyse_financiere");
    expect(brique).toMatchObject({
      active: true,
      classe_risque: "R3",
      adaptations: ["Limiter l'analyse aux deux derniers exercices."],
    });
  });

  it("refus motivé ; décision définitive en base (MPM04)", async () => {
    const d = attendu(
      201,
      await a.chef.post(`/api/missions/${missionId}/derogations`, {
        brique_code: "plan_action",
        nature: "retirer_brique",
        motif: "Le client a déjà un plan d'action en cours.",
      }),
    );
    expect(
      (
        await a.directeur.post(`/api/derogations/${d.id}/decisions`, {
          etape: "relecture_chef_mission",
          decision: "refuse",
        })
      ).statusCode,
    ).toBe(400);
    const r = attendu(
      200,
      await a.directeur.post(`/api/derogations/${d.id}/decisions`, {
        etape: "relecture_chef_mission",
        decision: "refuse",
        commentaire: "Le plan d'action fait partie du livrable promis.",
      }),
    );
    expect(r.statut).toBe("refusee");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(`UPDATE derogations SET statut = 'approuvee' WHERE id = $1`, [d.id]),
      ),
    ).rejects.toMatchObject({ code: "MPM04" });
  });

  it("tableau de bord : compteurs, filtre, visibilité ; détail ; autre cabinet 404", async () => {
    const t = attendu(200, await consultant.get("/api/derogations?limite=2"));
    expect(t.compteurs).toEqual({ demandee: 0, approuvee: 3, refusee: 1 });
    expect(t.elements).toHaveLength(2);
    expect(t.curseur_suivant).toBeTruthy();
    const p2 = attendu(
      200,
      await consultant.get(`/api/derogations?limite=2&curseur=${t.curseur_suivant}`),
    );
    expect(p2.elements).toHaveLength(2);
    const approuvees = attendu(
      200,
      await consultant.get("/api/derogations?statut=approuvee&limite=10"),
    );
    expect(approuvees.elements).toHaveLength(3);
    const hors = await a.avecRoles(["consultant"]);
    expect(attendu(200, await hors.get("/api/derogations")).elements).toHaveLength(0);
    expect((await hors.get(`/api/derogations/${derogationR2}`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/derogations/${derogationR3}`)).statusCode).toBe(404);
    const detail = attendu(200, await consultant.get(`/api/derogations/${derogationR3}`));
    expect(detail.validations).toHaveLength(4);
    const liste = attendu(200, await consultant.get(`/api/missions/${missionId}/derogations`));
    expect(liste.elements).toHaveLength(4);
    expect((await b.associe.get(`/api/missions/${missionId}/derogations`)).statusCode).toBe(404);
  });
});
