import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest, type Api, type CabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Contrôle de cohérence étendu (STD-11) : `GET /methodes/versions/:id/validation` compose le
 * contrôle existant, la cohérence interne du moteur (références, rubriques, règles) et la chaîne
 * d'héritage ; six catégories ; toute erreur bloque la publication (409 VERSION_INCOHERENTE),
 * un avertissement seul ne la bloque pas. Aucune régression sur le standard publié.
 */

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
let expert: Api & { utilisateurId: string };
let expert2: Api & { utilisateurId: string };
let consultant: Api;
let gestionnaire: Api;
let notationId: string;
let versionId: string;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.statusCode === 204 ? null : r.json();
}

interface Anomalie {
  code: string;
  gravite: string;
  regle: string | null;
  chemin: string;
  message: string;
}
interface Categorie {
  categorie: string;
  libelle: string;
  erreurs: number;
  avertissements: number;
}
const CATEGORIES = ["structure", "references", "regles", "rubriques", "heritage", "cas_types"];

const validation = async (acteur: Api, id: string) =>
  attendu(200, await acteur.get(`/api/methodes/versions/${id}/validation`)) as {
    valide: boolean;
    anomalies: Anomalie[];
    cas_types: unknown;
    categories: Categorie[];
  };
const codes = (v: { anomalies: Anomalie[] }) => v.anomalies.map((x) => x.code);
const categorie = (v: { categories: Categorie[] }, nom: string) =>
  v.categories.find((c) => c.categorie === nom)!;

/** Publication tentée par l'associé (exempt de la séparation des tâches) : refusée pour incohérence. */
async function publicationRefusee() {
  const r = await a.associe.post(`/api/methodes/versions/${versionId}/publication`);
  expect(attendu(409, r).erreur.code).toBe("VERSION_INCOHERENTE");
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cohérence A");
  b = await cabinetTest(ctx, "Cohérence B");
  expert = await a.avecRoles(["expert_metier"]);
  expert2 = await a.avecRoles(["expert_metier"]);
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  const liste = attendu(200, await consultant.get("/api/methodes?limite=100"));
  notationId = liste.elements.find((m: { code: string }) => m.code === "notation_entreprise").id;
  versionId = attendu(
    201,
    await expert.post(`/api/methodes/${notationId}/variantes`, {}),
  ).version_id;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("aucune régression sur le standard publié", () => {
  it("chaque version publiée du standard visible est valide, avec les six catégories dans l'ordre", async () => {
    const page = attendu(200, await consultant.get("/api/methodes?limite=100"));
    const standards = page.elements.filter((m: { origine: string }) => m.origine === "standard");
    expect(standards.length).toBeGreaterThanOrEqual(2);
    let verifiees = 0;
    for (const m of standards) {
      const d = attendu(200, await consultant.get(`/api/methodes/${m.id}`));
      for (const v of d.versions.filter((x: { statut: string }) => x.statut === "publiee")) {
        const r = await validation(consultant, v.id);
        expect(
          r.valide,
          `${m.code} v${v.version} : ${JSON.stringify(r.anomalies.filter((x) => x.gravite === "erreur"))}`,
        ).toBe(true);
        expect(r.categories.map((c) => c.categorie)).toEqual(CATEGORIES);
        expect(r.categories.reduce((n, c) => n + c.erreurs, 0)).toBe(0);
        verifiees += 1;
      }
    }
    expect(verifiees).toBeGreaterThanOrEqual(2);
  });

  it("une variante neuve (copie du standard) est valide ; format et libellés français des catégories", async () => {
    const r = await validation(consultant, versionId);
    expect(r.valide, JSON.stringify(r.anomalies)).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["anomalies", "cas_types", "categories", "valide"]);
    expect(r.categories).toEqual([
      expect.objectContaining({ categorie: "structure", libelle: "Structure" }),
      expect.objectContaining({ categorie: "references", libelle: "Références" }),
      expect.objectContaining({ categorie: "regles", libelle: "Règles de modulation" }),
      expect.objectContaining({ categorie: "rubriques", libelle: "Rubriques d'évaluation" }),
      expect.objectContaining({ categorie: "heritage", libelle: "Héritage" }),
      expect.objectContaining({ categorie: "cas_types", libelle: "Cas types" }),
    ]);
    for (const c of r.categories) {
      expect(Object.keys(c).sort()).toEqual(["avertissements", "categorie", "erreurs", "libelle"]);
    }
  });
});

describe("droits et isolation", () => {
  it("lecture avec standard.lire (consultant) ; gestionnaire 403 ; sans session 401 ; autre cabinet 404", async () => {
    attendu(200, await consultant.get(`/api/methodes/versions/${versionId}/validation`));
    expect(
      (await gestionnaire.get(`/api/methodes/versions/${versionId}/validation`)).statusCode,
    ).toBe(403);
    expect((await api(ctx).get(`/api/methodes/versions/${versionId}/validation`)).statusCode).toBe(
      401,
    );
    expect((await b.associe.get(`/api/methodes/versions/${versionId}/validation`)).statusCode).toBe(
      404,
    );
  });
});

describe("chaque nouvelle erreur bloque la publication", () => {
  it("référence cassée (cas type vers une brique inconnue) : erreur, catégorie « références »", async () => {
    const cas = attendu(
      201,
      await expert.post(`/api/methodes/versions/${versionId}/cas-types`, {
        code: "cas_brique_fantome",
        contexte: { effectif: 10 },
        briques_de_base: ["brique_fantome"],
        attendu: { regles_declenchees: ["regle_fantome"] },
      }),
    );
    const v = await validation(expert, versionId);
    expect(v.valide).toBe(false);
    expect(v.anomalies).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_CASSEE",
        gravite: "erreur",
        chemin: "cas_types.cas_brique_fantome.briques_de_base",
      }),
    );
    expect(categorie(v, "references").erreurs).toBeGreaterThanOrEqual(2);
    await publicationRefusee();
    attendu(204, await expert.delete(`/api/methodes/versions/${versionId}/cas-types/${cas.id}`));
    expect((await validation(expert, versionId)).valide).toBe(true);
  });

  it("règles contradictoires (même condition, même priorité, effets opposés) : erreur, catégorie « règles »", async () => {
    const condition = {
      type: "comparaison",
      facteur: "effectif",
      comparateur: "superieur",
      valeur: 99999,
    };
    const ids: string[] = [];
    for (const [code, effet] of [
      ["pour_plan", "activer_brique"],
      ["contre_plan", "retirer_brique"],
    ] as const) {
      const r = attendu(
        201,
        await expert.post(`/api/methodes/versions/${versionId}/regles`, {
          code,
          priorite: 7,
          condition,
          effets: [{ type: effet, brique: "plan_action" }],
        }),
      );
      ids.push(r.id);
    }
    const v = await validation(expert, versionId);
    expect(v.valide).toBe(false);
    expect(v.anomalies).toContainEqual(
      expect.objectContaining({
        code: "REGLES_CONTRADICTOIRES",
        gravite: "erreur",
        regle: "contre_plan",
      }),
    );
    expect(categorie(v, "regles").erreurs).toBeGreaterThanOrEqual(1);
    await publicationRefusee();
    for (const id of ids) {
      attendu(204, await expert.delete(`/api/methodes/versions/${versionId}/regles/${id}`));
    }
    expect((await validation(expert, versionId)).valide).toBe(true);
  });

  it("rubrique aux ancrages vides (insérée par le propriétaire, l'API la refuse) : erreur, catégorie « rubriques »", async () => {
    const refusee = await expert.post(`/api/methodes/versions/${versionId}/rubriques`, {
      code: "rubrique_vide",
      libelle: "Rubrique vide",
      ancrages: [1, 2, 3, 4, 5].map((niveau) => ({ niveau, description: "" })),
    });
    expect(refusee.statusCode).toBe(400);
    await proprietaire((c) =>
      c.query(
        `INSERT INTO methode_rubriques (cabinet_id, version_id, code, libelle, ancrages)
         VALUES ($1, $2, 'rubrique_vide', 'Rubrique vide', $3)`,
        [
          a.cabinetId,
          versionId,
          JSON.stringify([1, 2, 3, 4, 5].map((niveau) => ({ niveau, description: "  " }))),
        ],
      ),
    );
    const v = await validation(expert, versionId);
    expect(v.valide).toBe(false);
    expect(v.anomalies).toContainEqual(
      expect.objectContaining({
        code: "RUBRIQUE_SANS_ANCRAGE",
        gravite: "erreur",
        chemin: "rubriques.rubrique_vide.ancrages",
      }),
    );
    expect(categorie(v, "rubriques").erreurs).toBe(1);
    await publicationRefusee();
    await proprietaire((c) =>
      c.query(`DELETE FROM methode_rubriques WHERE version_id = $1 AND code = 'rubrique_vide'`, [
        versionId,
      ]),
    );
    expect((await validation(expert, versionId)).valide).toBe(true);
  });

  it("cycle d'héritage (version qui part d'elle-même, forcé par le propriétaire) : erreur, catégorie « héritage »", async () => {
    // Le déclencheur d'identité interdit ce lien : le propriétaire le suspend dans UNE transaction.
    const poser = (base: string | null) =>
      proprietaire(async (c) => {
        await c.query("BEGIN");
        try {
          await c.query("ALTER TABLE methode_versions DISABLE TRIGGER USER");
          await c.query(`UPDATE methode_versions SET base_standard_id = $2 WHERE id = $1`, [
            versionId,
            base,
          ]);
          await c.query("ALTER TABLE methode_versions ENABLE TRIGGER USER");
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      });
    const origine = await proprietaire(
      async (c) =>
        (await c.query(`SELECT base_standard_id FROM methode_versions WHERE id = $1`, [versionId]))
          .rows[0].base_standard_id as string,
    );
    await poser(versionId);
    try {
      const v = await validation(expert, versionId);
      expect(v.valide).toBe(false);
      expect(codes(v)).toContain("CYCLE_HERITAGE");
      expect(v.anomalies.find((x) => x.code === "CYCLE_HERITAGE")).toMatchObject({
        gravite: "erreur",
        chemin: `versions.${versionId}`,
      });
      expect(categorie(v, "heritage").erreurs).toBeGreaterThanOrEqual(1);
      await publicationRefusee();
    } finally {
      await poser(origine);
    }
    expect((await validation(expert, versionId)).valide).toBe(true);
  });
});

describe("un avertissement seul ne bloque pas", () => {
  it("règle inactive et rubrique sans exemple : avertissements, valide, publication acceptée", async () => {
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${versionId}/regles`, {
        code: "regle_en_attente",
        priorite: 1,
        active: false,
        condition: {
          type: "comparaison",
          facteur: "effectif",
          comparateur: "superieur",
          valeur: 10,
        },
        effets: [{ type: "activer_brique", brique: "plan_action" }],
      }),
    );
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${versionId}/rubriques`, {
        code: "rubrique_sans_exemple",
        libelle: "Rubrique sans exemple",
        dimension: "gouvernance",
        ancrages: [1, 2, 3, 4, 5].map((niveau) => ({ niveau, description: `Niveau ${niveau}` })),
      }),
    );
    const v = await validation(expert, versionId);
    expect(v.valide, JSON.stringify(v.anomalies.filter((x) => x.gravite === "erreur"))).toBe(true);
    expect(codes(v)).toEqual(expect.arrayContaining(["REGLE_INACTIVE", "RUBRIQUE_SANS_EXEMPLE"]));
    expect(v.anomalies.every((x) => x.gravite === "avertissement")).toBe(true);
    expect(categorie(v, "regles").avertissements).toBeGreaterThanOrEqual(1);
    expect(categorie(v, "rubriques").avertissements).toBeGreaterThanOrEqual(1);
    expect(v.categories.reduce((n, c) => n + c.erreurs, 0)).toBe(0);
    const p = attendu(200, await expert2.post(`/api/methodes/versions/${versionId}/publication`));
    expect(p).toMatchObject({ statut: "publiee", validation: { valide: true } });
    expect(p.validation.categories).toHaveLength(6);
  });

  it("après publication, la validation reste lisible (version immuable)", async () => {
    const v = await validation(consultant, versionId);
    expect(v.valide).toBe(true);
    expect(codes(v)).toContain("REGLE_INACTIVE");
  });
});
