import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest, type Api, type CabinetTest } from "./api.js";
import { preparerFacturation } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Éditeur sans code (STD-11), modifications d'un brouillon du cabinet : éléments, rubriques, cas
 * types, facteurs de contexte (additifs). Droits par rôle, isolation entre cabinets, portail
 * fermé, version publiée immuable (API 409, base MPM01), facteurs doublés en base (MQS01, MQS02).
 */

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
let expert: Api & { utilisateurId: string };
let expert2: Api & { utilisateurId: string };
let consultant: Api;
let gestionnaire: Api;
let portail: UtilisateurPortail;
let notationV1: string;
let notationId: string;
let versionId: string;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.statusCode === 204 ? null : r.json();
}

const ANCRAGES = [1, 2, 3, 4, 5].map((niveau) => ({
  niveau,
  description: `Comportement observable du niveau ${niveau}`,
  exemples: [{ contexte: "PME", texte: `Exemple du niveau ${niveau}` }],
}));
const INCONNU = "00000000-0000-4000-8000-000000000000";

const detail = async (acteur: Api, id: string) =>
  attendu(200, await acteur.get(`/api/methodes/versions/${id}`));

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Éditeur A");
  b = await cabinetTest(ctx, "Éditeur B");
  expert = await a.avecRoles(["expert_metier"]);
  expert2 = await a.avecRoles(["expert_metier"]);
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  const liste = attendu(200, await consultant.get("/api/methodes?limite=100"));
  const notation = liste.elements.find((m: { code: string }) => m.code === "notation_entreprise");
  notationId = notation.id;
  notationV1 = notation.derniere_publiee.id;
  const v = attendu(201, await expert.post(`/api/methodes/${notationId}/variantes`, {}));
  versionId = v.version_id;
  const cabinetPortail = await preparerFacturation(ctx, "Éditeur portail", false);
  portail = await inviterClient(ctx, cabinetPortail.associe, cabinetPortail.clientId, [
    "client_dirigeant",
  ]);
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("éléments de méthode : modification", () => {
  let elementId: string;
  let briqueId: string;

  it("l'expert ajoute un élément puis le modifie ; type et code sont immuables", async () => {
    const v = await detail(expert, versionId);
    briqueId = v.briques.find((x: { code: string }) => x.code === "plan_action").id;
    elementId = attendu(
      201,
      await expert.post(`/api/methodes/versions/${versionId}/elements`, {
        type: "livrable",
        code: "note_synthese",
        libelle: "Note de synthèse",
      }),
    ).id;
    const url = `/api/methodes/versions/${versionId}/elements/${elementId}`;
    attendu(
      200,
      await expert.patch(url, {
        libelle: "Note de synthèse révisée",
        description: "Quatre pages au plus.",
        essentiel: true,
        brique_id: briqueId,
      }),
    );
    const apres = (await detail(expert, versionId)).elements.find(
      (e: { code: string }) => e.code === "note_synthese",
    );
    expect(apres).toMatchObject({
      libelle: "Note de synthèse révisée",
      description: "Quatre pages au plus.",
      essentiel: true,
      brique_code: "plan_action",
      type: "livrable",
    });
    expect((await expert.patch(url, { code: "autre" })).statusCode).toBe(400);
    expect((await expert.patch(url, { type: "item" })).statusCode).toBe(400);
    attendu(200, await expert.patch(url, { brique_id: null, description: null }));
    const detache = (await detail(expert, versionId)).elements.find(
      (e: { code: string }) => e.code === "note_synthese",
    );
    expect(detache).toMatchObject({ brique_code: null, description: null });
  });

  it("la brique doit être de la même version (400) ; élément inconnu : 404", async () => {
    const standard = await detail(consultant, notationV1);
    const etrangere = standard.briques[0].id;
    const url = `/api/methodes/versions/${versionId}/elements/${elementId}`;
    expect((await expert.patch(url, { brique_id: etrangere })).statusCode).toBe(400);
    expect((await expert.patch(url, { brique_id: INCONNU })).statusCode).toBe(400);
    expect(
      (
        await expert.patch(`/api/methodes/versions/${versionId}/elements/${INCONNU}`, {
          libelle: "X",
        })
      ).statusCode,
    ).toBe(404);
    expect((await expert.patch(url, { libelle: "" })).statusCode).toBe(400);
  });
});

describe("rubriques : modification", () => {
  let rubriqueId: string;

  it("l'expert modifie libellé, dimension et ancrages ; cinq niveaux exigés ; code immuable", async () => {
    rubriqueId = attendu(
      201,
      await expert.post(`/api/methodes/versions/${versionId}/rubriques`, {
        code: "maitrise_delais",
        libelle: "Maîtrise des délais",
        ancrages: ANCRAGES,
      }),
    ).id;
    const url = `/api/methodes/versions/${versionId}/rubriques/${rubriqueId}`;
    const nouveaux = ANCRAGES.map((x) => ({ ...x, description: `${x.description} (révisé)` }));
    attendu(
      200,
      await expert.patch(url, {
        libelle: "Respect des délais",
        dimension: "gestion",
        ancrages: nouveaux,
      }),
    );
    const r = (await detail(expert, versionId)).rubriques.find(
      (x: { code: string }) => x.code === "maitrise_delais",
    );
    expect(r).toMatchObject({
      libelle: "Respect des délais",
      dimension: "gestion",
      code: "maitrise_delais",
    });
    expect(r.ancrages[0].description).toContain("(révisé)");
    expect((await expert.patch(url, { ancrages: nouveaux.slice(0, 4) })).statusCode).toBe(400);
    expect((await expert.patch(url, { code: "autre" })).statusCode).toBe(400);
    expect((await expert.patch(url, { brique_id: INCONNU })).statusCode).toBe(400);
    expect(
      (await expert.patch(`/api/methodes/versions/${versionId}/rubriques/${INCONNU}`, {}))
        .statusCode,
    ).toBe(404);
  });
});

describe("cas types : remplacement", () => {
  let casId: string;
  const CAS = {
    code: "grande_structure",
    libelle: "Grande structure",
    contexte: { effectif: 900 },
    attendu: { regles_declenchees: [] as string[] },
  };

  it("PUT remplace le cas type de même code ; changer le code est refusé (400)", async () => {
    casId = attendu(
      201,
      await expert.post(`/api/methodes/versions/${versionId}/cas-types`, CAS),
    ).id;
    const url = `/api/methodes/versions/${versionId}/cas-types/${casId}`;
    attendu(
      200,
      await expert.put(url, {
        ...CAS,
        libelle: "Très grande structure",
        contexte: { effectif: 5000 },
      }),
    );
    const cas = (await detail(expert, versionId)).cas_types.find(
      (c: { code: string }) => c.code === "grande_structure",
    );
    expect(cas).toMatchObject({ libelle: "Très grande structure" });
    expect(cas.cas.contexte).toEqual({ effectif: 5000 });
    expect(attendu(400, await expert.put(url, { ...CAS, code: "autre_code" })).erreur.code).toBe(
      "REQUETE_INVALIDE",
    );
    expect((await expert.put(url, { ...CAS, extra: 1 })).statusCode).toBe(400);
    expect((await expert.put(url, { code: "grande_structure" })).statusCode).toBe(400);
    expect(
      (await expert.put(`/api/methodes/versions/${versionId}/cas-types/${INCONNU}`, CAS))
        .statusCode,
    ).toBe(404);
  });
});

describe("droits, isolation, standard et portail", () => {
  let facteurId: string;
  let elementId: string;
  let rubriqueId: string;
  let casId: string;

  beforeAll(async () => {
    const v = await detail(expert, versionId);
    elementId = v.elements.find((e: { code: string }) => e.code === "note_synthese").id;
    rubriqueId = v.rubriques.find((r: { code: string }) => r.code === "maitrise_delais").id;
    casId = v.cas_types.find((c: { code: string }) => c.code === "grande_structure").id;
    facteurId = attendu(
      201,
      await expert.post("/api/standard/facteurs", {
        code: "niveau_numerique",
        libelle: "Niveau numérique",
        type: "enumeration",
        valeurs: [
          { code: "faible", libelle: "Faible" },
          { code: "eleve", libelle: "Élevé" },
        ],
      }),
    ).id;
  });

  const routes = () => [
    () => ["patch", `/api/methodes/versions/${versionId}/elements/${elementId}`, { libelle: "X" }],
    () => [
      "patch",
      `/api/methodes/versions/${versionId}/rubriques/${rubriqueId}`,
      { libelle: "X" },
    ],
    () => [
      "put",
      `/api/methodes/versions/${versionId}/cas-types/${casId}`,
      { code: "grande_structure", contexte: {}, attendu: {} },
    ],
    () => ["patch", `/api/standard/facteurs/${facteurId}`, { libelle: "X" }],
    () => ["post", `/api/methodes/versions/${versionId}/apercu`, {}],
  ];
  async function appeler(acteur: Api, [m, url, corps]: unknown[]) {
    const f = (acteur as unknown as Record<string, (u: string, c?: unknown) => Promise<Reponse>>)[
      m as string
    ]!;
    return f(url as string, corps);
  }

  it("consultant et gestionnaire : 403 sur les modifications ; sans session : 401", async () => {
    for (const r of routes().slice(0, 4)) {
      expect((await appeler(consultant, r())).statusCode).toBe(403);
      expect((await appeler(gestionnaire, r())).statusCode).toBe(403);
      expect((await appeler(api(ctx), r())).statusCode).toBe(401);
    }
    expect(
      (await gestionnaire.post(`/api/methodes/versions/${versionId}/apercu`, {})).statusCode,
    ).toBe(403);
  });

  it("l'associé et l'expert métier peuvent modifier", async () => {
    attendu(
      200,
      await a.associe.patch(`/api/methodes/versions/${versionId}/elements/${elementId}`, {
        libelle: "Note associé",
      }),
    );
    attendu(
      200,
      await expert2.patch(`/api/methodes/versions/${versionId}/rubriques/${rubriqueId}`, {
        libelle: "Rubrique expert 2",
      }),
    );
    attendu(
      200,
      await a.associe.patch(`/api/standard/facteurs/${facteurId}`, {
        libelle: "Niveau numérique (A)",
      }),
    );
  });

  it("l'autre cabinet reçoit 404 sur la version, les éléments, l'aperçu et le facteur", async () => {
    for (const r of routes()) {
      expect((await appeler(b.associe, r())).statusCode, JSON.stringify(r())).toBe(404);
    }
    expect((await b.associe.get(`/api/methodes/versions/${versionId}`)).statusCode).toBe(404);
  });

  it("le standard reste en lecture seule : élément du standard 403, facteur du standard 403", async () => {
    const standard = await detail(consultant, notationV1);
    const element = standard.elements[0];
    expect(
      attendu(
        403,
        await expert.patch(`/api/methodes/versions/${notationV1}/elements/${element.id}`, {
          libelle: "Intrus",
        }),
      ).erreur.code,
    ).toBe("STANDARD_LECTURE_SEULE");
    expect(
      (
        await expert.patch(
          `/api/methodes/versions/${notationV1}/rubriques/${standard.rubriques[0].id}`,
          {
            libelle: "Intrus",
          },
        )
      ).statusCode,
    ).toBe(403);
    const facteurs = attendu(200, await expert.get("/api/standard/facteurs"));
    const effectif = facteurs.elements.find((f: { code: string }) => f.code === "effectif");
    expect(
      attendu(
        403,
        await expert.patch(`/api/standard/facteurs/${effectif.id}`, { libelle: "Intrus" }),
      ).erreur.code,
    ).toBe("STANDARD_LECTURE_SEULE");
  });

  it("portail client : 403 PORTAIL_ROUTE_INTERDITE sur chaque nouvelle route", async () => {
    for (const r of routes()) {
      const rep = await appeler(portail, r());
      expect(rep.statusCode, JSON.stringify(r())).toBe(403);
      expect(rep.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
    expect((await portail.get(`/api/methodes/versions/${versionId}/validation`)).statusCode).toBe(
      403,
    );
  });

  it("le journal d'audit trace les modifications d'éditeur et de facteur", async () => {
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT action, details FROM journal_audit
            WHERE cabinet_id = $1 AND action IN ('standard.brouillon.modifier', 'standard.facteur.modifier')`,
            [a.cabinetId],
          )
        ).rows,
    );
    const quoi = lignes
      .filter((l) => l.action === "standard.brouillon.modifier")
      .map((l) => l.details.quoi);
    expect(quoi).toEqual(
      expect.arrayContaining(["elements.modifier", "rubriques.modifier", "cas_types.modifier"]),
    );
    expect(lignes.some((l) => l.action === "standard.facteur.modifier")).toBe(true);
  });
});

describe("facteurs de contexte du cabinet : modification additive", () => {
  let enumId: string;
  let nombreId: string;
  let boolId: string;
  const url = (id: string) => `/api/standard/facteurs/${id}`;
  const lire = async (id: string) =>
    attendu(200, await expert.get("/api/standard/facteurs")).elements.find(
      (f: { id: string }) => f.id === id,
    );

  beforeAll(async () => {
    const creer = async (corps: Record<string, unknown>) =>
      attendu(201, await expert.post("/api/standard/facteurs", corps)).id as string;
    enumId = await creer({
      code: "maturite_rse",
      libelle: "Maturité RSE",
      type: "enumeration",
      valeurs: [
        { code: "debutant", libelle: "Débutant" },
        { code: "confirme", libelle: "Confirmé" },
      ],
    });
    nombreId = await creer({
      code: "nb_sites",
      libelle: "Nombre de sites",
      type: "nombre",
      min: 1,
      max: 50,
    });
    boolId = await creer({ code: "agrement_bio", libelle: "Agrément bio", type: "booleen" });
  });

  it("libellé et description libres ; une valeur s'ajoute, ses libellés se corrigent", async () => {
    const f = attendu(
      200,
      await expert.patch(url(enumId), {
        libelle: "Maturité RSE (échelle)",
        description: "Échelle interne.",
        valeurs: [
          { code: "debutant", libelle: "Débutante" },
          { code: "confirme", libelle: "Confirmée" },
          { code: "exemplaire", libelle: "Exemplaire" },
        ],
      }),
    );
    expect(f).toMatchObject({
      code: "maturite_rse",
      type: "enumeration",
      origine: "cabinet",
      libelle: "Maturité RSE (échelle)",
      description: "Échelle interne.",
    });
    expect(f.valeurs.map((v: { code: string }) => v.code)).toEqual([
      "debutant",
      "confirme",
      "exemplaire",
    ]);
    // Le nouveau code est immédiatement accepté dans un contexte.
    const apercu = await expert.post(`/api/methodes/versions/${versionId}/apercu`, {
      contexte: { maturite_rse: "exemplaire" },
    });
    expect(apercu.statusCode, apercu.body).toBe(200);
  });

  it("retirer une valeur est refusé (409 FACTEUR_RETRAIT_INTERDIT) ; l'état reste intact", async () => {
    const r = await expert.patch(url(enumId), {
      valeurs: [
        { code: "debutant", libelle: "Débutante" },
        { code: "exemplaire", libelle: "Exemplaire" },
      ],
    });
    expect(attendu(409, r).erreur.code).toBe("FACTEUR_RETRAIT_INTERDIT");
    expect((await lire(enumId)).valeurs).toHaveLength(3);
    expect(
      (
        await expert.patch(url(enumId), {
          valeurs: [
            { code: "a", libelle: "A" },
            { code: "a", libelle: "B" },
          ],
        })
      ).statusCode,
    ).toBe(400);
  });

  it("bornes : élargir ou supprimer passe, resserrer ou en poser une nouvelle est refusé", async () => {
    attendu(200, await expert.patch(url(nombreId), { min: 0, max: 80 }));
    expect(await lire(nombreId)).toMatchObject({ min: 0, max: 80 });
    expect(attendu(409, await expert.patch(url(nombreId), { min: 5 })).erreur.code).toBe(
      "FACTEUR_RETRAIT_INTERDIT",
    );
    expect(attendu(409, await expert.patch(url(nombreId), { max: 60 })).erreur.code).toBe(
      "FACTEUR_RETRAIT_INTERDIT",
    );
    expect((await expert.patch(url(nombreId), { min: 90 })).statusCode).toBe(400);
    expect((await expert.patch(url(nombreId), { min: 10, max: 5 })).statusCode).toBe(400);
    attendu(200, await expert.patch(url(nombreId), { max: null }));
    expect(await lire(nombreId)).toMatchObject({ min: 0, max: null });
    // Une borne supprimée ne se repose pas (ce serait resserrer).
    expect(attendu(409, await expert.patch(url(nombreId), { max: 500 })).erreur.code).toBe(
      "FACTEUR_RETRAIT_INTERDIT",
    );
  });

  it("types incompatibles : valeurs sur un booléen ou un nombre, bornes sur un non-nombre (400)", async () => {
    const valeurs = [{ code: "x", libelle: "X" }];
    expect((await expert.patch(url(boolId), { valeurs })).statusCode).toBe(400);
    expect((await expert.patch(url(nombreId), { valeurs })).statusCode).toBe(400);
    expect((await expert.patch(url(boolId), { min: 0 })).statusCode).toBe(400);
    expect((await expert.patch(url(enumId), { max: 10 })).statusCode).toBe(400);
  });

  it("identité figée : code, type et porteur ne se modifient pas (400, schéma strict)", async () => {
    for (const corps of [{ code: "autre" }, { type: "booleen" }, { porte_par: "dossier" }, {}]) {
      const r = await expert.patch(url(enumId), corps);
      expect(r.statusCode === 400 || Object.keys(corps).length === 0).toBe(true);
    }
    expect(
      (await expert.patch("/api/standard/facteurs/pas-un-uuid", { libelle: "X" })).statusCode,
    ).toBe(400);
    expect((await expert.patch(url(INCONNU), { libelle: "X" })).statusCode).toBe(404);
  });

  it("la base refuse aussi : colonnes figées, retrait, resserrement, facteur du standard", async () => {
    const espion = async (sql: string, params: unknown[]) =>
      ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, params));
    await expect(
      espion(`UPDATE facteurs_contexte SET code = 'pirate' WHERE id = $1`, [enumId]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      espion(`DELETE FROM facteurs_contexte WHERE id = $1`, [enumId]),
    ).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      espion(
        `UPDATE facteurs_contexte SET valeurs = '[{"code":"debutant","libelle":"D"}]' WHERE id = $1`,
        [enumId],
      ),
    ).rejects.toMatchObject({ code: "MQS02" });
    await expect(
      espion(`UPDATE facteurs_contexte SET min = 3 WHERE id = $1`, [nombreId]),
    ).rejects.toMatchObject({ code: "MQS02" });
    // Le propriétaire (migrations) est lui aussi tenu par le déclencheur.
    await expect(
      proprietaire((c) =>
        c.query(`UPDATE facteurs_contexte SET code = 'pirate' WHERE id = $1`, [enumId]),
      ),
    ).rejects.toMatchObject({ code: "MQS01" });
    await expect(
      proprietaire((c) =>
        c.query(
          `UPDATE facteurs_contexte SET libelle = 'Pirate' WHERE cabinet_id IS NULL AND code = 'effectif'`,
        ),
      ),
    ).rejects.toMatchObject({ code: "MQS01" });
    // Rôle applicatif : une ligne du standard n'est pas visible en écriture (RLS), rien n'est touché.
    const r = await espion(
      `UPDATE facteurs_contexte SET libelle = 'Pirate' WHERE cabinet_id IS NULL AND code = 'effectif'`,
      [],
    );
    expect(r.rowCount).toBe(0);
    // Écriture légitime en base : l'ajout d'une valeur passe.
    await espion(`UPDATE facteurs_contexte SET libelle = 'Maturité RSE (base)' WHERE id = $1`, [
      enumId,
    ]);
    expect((await lire(enumId)).libelle).toBe("Maturité RSE (base)");
  });
});

describe("version publiée : immuable", () => {
  let elementId: string;
  let rubriqueId: string;
  let casId: string;

  it("publiée par un autre expert, la version refuse toute nouvelle modification (409, MPM01)", async () => {
    const v = await detail(expert, versionId);
    elementId = v.elements.find((e: { code: string }) => e.code === "note_synthese").id;
    rubriqueId = v.rubriques.find((r: { code: string }) => r.code === "maitrise_delais").id;
    casId = v.cas_types.find((c: { code: string }) => c.code === "grande_structure").id;
    const p = attendu(200, await expert2.post(`/api/methodes/versions/${versionId}/publication`));
    expect(p).toMatchObject({ statut: "publiee", validation: { valide: true } });

    const code = async (r: Reponse) => attendu(409, r).erreur.code;
    expect(
      await code(
        await expert.patch(`/api/methodes/versions/${versionId}/elements/${elementId}`, {
          libelle: "Trop tard",
        }),
      ),
    ).toBe("VERSION_PUBLIEE");
    expect(
      await code(
        await expert.patch(`/api/methodes/versions/${versionId}/rubriques/${rubriqueId}`, {
          libelle: "Trop tard",
        }),
      ),
    ).toBe("VERSION_PUBLIEE");
    expect(
      await code(
        await expert.put(`/api/methodes/versions/${versionId}/cas-types/${casId}`, {
          code: "grande_structure",
          contexte: {},
          attendu: {},
        }),
      ),
    ).toBe("VERSION_PUBLIEE");
  });

  it("la base la refuse aussi, par requête directe du rôle applicatif", async () => {
    for (const [sql, params] of [
      [`UPDATE methode_elements SET libelle = 'Pirate' WHERE id = $1`, [elementId]],
      [`UPDATE methode_rubriques SET libelle = 'Pirate' WHERE id = $1`, [rubriqueId]],
      [`UPDATE methode_cas_types SET libelle = 'Pirate' WHERE id = $1`, [casId]],
    ] as const) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, [...params])),
      ).rejects.toMatchObject({ code: "MPM01" });
    }
  });
});
