import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest, type Api, type CabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Référentiel de méthodes (lot STD) : catalogue et standard en lecture seule,
 * dictionnaire et facteurs, cohérence, simulation et cas types, variante du
 * cabinet et ses différences, éditeur, publication et immuabilité (MPM01),
 * isolation entre cabinets, notes de contexte, comité méthode (STD-12).
 */

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
let expert: Api & { utilisateurId: string };
let expert2: Api & { utilisateurId: string };
let consultant: Api;
let gestionnaire: Api;
let notationId: string;
let notationV1: string;
let varianteId: string;
let varianteV1: string;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.statusCode === 204 ? null : r.json();
}

const BRIQUE = {
  code: "atelier_restitution_cabinet",
  libelle: "Atelier de restitution du cabinet",
  objet: "Restituer la note en atelier avec l'équipe de direction.",
  classe_risque: "R2",
  niveau_autonomie_max: "N1",
  active_par_defaut: true,
  temps_type_jours: 0.5,
};

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Méthodes A");
  b = await cabinetTest(ctx, "Méthodes B");
  expert = await a.avecRoles(["expert_metier"]);
  expert2 = await a.avecRoles(["expert_metier"]);
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
});

afterAll(async () => {
  await ctx.fermer();
});

describe("catalogue et standard MissionPilot", () => {
  it("sans session : 401 ; sans standard.lire (gestionnaire) : 403", async () => {
    expect((await api(ctx).get("/api/methodes")).statusCode).toBe(401);
    expect((await api(ctx).get("/api/standard/facteurs")).statusCode).toBe(401);
    expect((await gestionnaire.get("/api/methodes")).statusCode).toBe(403);
    expect((await gestionnaire.get("/api/derogations")).statusCode).toBe(403);
  });

  it("les deux méthodes phares du standard sont lisibles par tout cabinet, version 1 publiée", async () => {
    const page = attendu(200, await consultant.get("/api/methodes?limite=100"));
    const codes = page.elements.map((m: { code: string }) => m.code);
    expect(codes).toEqual(expect.arrayContaining(["notation_entreprise", "plan_strategique"]));
    const notation = page.elements.find((m: { code: string }) => m.code === "notation_entreprise");
    expect(notation).toMatchObject({
      origine: "standard",
      service_code: "notation",
      variante_id: null,
    });
    expect(notation.derniere_publiee.version).toBe(1);
    notationId = notation.id;
    notationV1 = notation.derniere_publiee.id;
    const pourB = attendu(200, await b.associe.get("/api/methodes?limite=100"));
    expect(pourB.elements.map((m: { id: string }) => m.id)).toContain(notationId);
  });

  it("la notation se décrit en cinq étapes de briques, avec règles, cas types et rubriques", async () => {
    const v = attendu(200, await consultant.get(`/api/methodes/versions/${notationV1}`));
    expect(v.etapes.map((e: { code: string }) => e.code)).toEqual([
      "cadrage",
      "collecte",
      "analyse",
      "notation",
      "restitution",
    ]);
    expect(v.modifiable).toBe(false);
    expect(v.regles).toHaveLength(5);
    expect(v.cas_types).toHaveLength(3);
    expect(v.rubriques).toHaveLength(2);
    expect(v.rubriques[0].ancrages).toHaveLength(5);
    const ecarts = v.briques.find((x: { code: string }) => x.code === "ecarts_perception");
    expect(ecarts).toMatchObject({
      etape_code: "analyse",
      moteur: "notation.ecarts_perception",
      classe_risque: "R2",
      niveau_autonomie_max: "N2",
      temps_type_jours: 0.5,
    });
  });

  it("le standard est cohérent : règles valides et cas types réussis", async () => {
    const validation = attendu(
      200,
      await consultant.get(`/api/methodes/versions/${notationV1}/validation`),
    );
    expect(validation.valide, JSON.stringify(validation.anomalies)).toBe(true);
    expect(validation.cas_types).toMatchObject({ reussi: true, reussis: 3, echoues: 0 });
    const execution = attendu(
      200,
      await consultant.post(`/api/methodes/versions/${notationV1}/cas-types/execution`),
    );
    expect(execution.reussi).toBe(true);
    const plan = attendu(200, await consultant.get("/api/methodes?limite=100")).elements.find(
      (m: { code: string }) => m.code === "plan_strategique",
    );
    const vp = attendu(
      200,
      await consultant.get(`/api/methodes/versions/${plan.derniere_publiee.id}/validation`),
    );
    expect(vp.valide, JSON.stringify(vp.anomalies)).toBe(true);
  });

  it("simulation sur deux contextes : différentiel des effets et des règles déclenchées", async () => {
    const s = attendu(
      200,
      await consultant.post(`/api/methodes/versions/${notationV1}/simulation`, {
        contexte_avant: { effectif: 800, actionnariat: "filiale_groupe" },
        contexte_apres: {
          effectif: 12,
          actionnariat: "familial",
          fiabilite_comptes: "non_certifies",
          part_informel: "forte",
        },
      }),
    );
    expect(s.differentiel.identique).toBe(false);
    expect(s.differentiel.regles_declenchees).toEqual([
      "comptes_fragiles",
      "gouvernance_familiale",
      "petite_structure",
    ]);
    expect(s.apres.etat.briques_actives).toContain("atelier_unique");
    expect(s.apres.etat.briques_actives).not.toContain("entretiens_individuels");
    expect(s.apres.etat.classes_risque_relevees).toEqual({ analyse_financiere: "R3" });
    expect(
      s.apres.journal.find((j: { regle: string }) => j.regle === "petite_structure"),
    ).toMatchObject({
      declenchee: true,
      effets_retenus: 3,
    });
    const r = await consultant.post(`/api/methodes/versions/${notationV1}/simulation`, {
      contexte_avant: { facteur_inconnu: true },
      contexte_apres: {},
    });
    expect(attendu(400, r).erreur.code).toBe("CONTEXTE_INVALIDE");
    const r2 = await consultant.post(`/api/methodes/versions/${notationV1}/simulation`, {
      contexte_avant: { effectif: "douze" },
      contexte_apres: {},
    });
    expect(r2.statusCode).toBe(400);
  });

  it("le standard est en lecture seule : 403 par l'API, aucune ligne touchée en base", async () => {
    const r = await expert.post(`/api/methodes/versions/${notationV1}/etapes`, {
      code: "intrus",
      libelle: "Intrus",
    });
    expect(attendu(403, r).erreur.code).toBe("STANDARD_LECTURE_SEULE");
    expect((await expert.post(`/api/methodes/versions/${notationV1}/publication`)).statusCode).toBe(
      403,
    );
    const touchees = await ctx.db.withTenant(a.cabinetId, async (db) => {
      const u = await db.query(`UPDATE methode_briques SET libelle = 'x' WHERE version_id = $1`, [
        notationV1,
      ]);
      const d = await db.query(`DELETE FROM methode_regles WHERE version_id = $1`, [notationV1]);
      return (u.rowCount ?? 0) + (d.rowCount ?? 0);
    });
    expect(touchees).toBe(0);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO methode_etapes (cabinet_id, version_id, code, libelle) VALUES ($1, $2, 'x', 'X')`,
          [a.cabinetId, notationV1],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPM01" });
  });

  it("sans contexte de cabinet, le standard reste invisible (échec sûr)", async () => {
    const n = await ctx.db.withoutTenant(
      async (db) => (await db.query("SELECT count(*)::int AS n FROM methodes")).rows[0].n,
    );
    expect(n).toBe(0);
  });
});

describe("dictionnaire de données, facteurs et notes de contexte", () => {
  it("facteurs typés du standard, dont les codes de convention du dossier client", async () => {
    const f = attendu(200, await consultant.get("/api/standard/facteurs"));
    const codes = f.elements.map((x: { code: string }) => x.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "secteur",
        "effectif",
        "fiabilite_comptes",
        "part_informel",
        "filieres",
      ]),
    );
    const effectif = f.elements.find((x: { code: string }) => x.code === "effectif");
    expect(effectif).toMatchObject({ type: "nombre", min: 0, origine: "standard" });
  });

  it("taxonomies paginées : 21 sections CITI rév. 4", async () => {
    const p1 = attendu(
      200,
      await consultant.get("/api/standard/taxonomies?taxonomie=secteur&limite=15"),
    );
    expect(p1.elements).toHaveLength(15);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = attendu(
      200,
      await consultant.get(
        `/api/standard/taxonomies?taxonomie=secteur&limite=15&curseur=${p1.curseur_suivant}`,
      ),
    );
    expect(p2.elements).toHaveLength(6);
    expect(p2.curseur_suivant).toBeNull();
  });

  it("le cabinet ajoute ses entrées et facteurs, sans écraser le standard ; l'autre cabinet ne les voit pas", async () => {
    expect(
      (
        await consultant.post("/api/standard/taxonomies", {
          taxonomie: "filiere",
          code: "x",
          libelle: "X",
        })
      ).statusCode,
    ).toBe(403);
    const t = attendu(
      201,
      await expert.post("/api/standard/taxonomies", {
        taxonomie: "filiere",
        code: "karite",
        libelle: "Karité",
        parent_code: "citi_a",
      }),
    );
    expect(t.origine).toBe("cabinet");
    expect(
      attendu(
        409,
        await expert.post("/api/standard/taxonomies", {
          taxonomie: "filiere",
          code: "cacao",
          libelle: "Cacao",
        }),
      ).erreur.code,
    ).toBe("CONFLIT");
    const f = attendu(
      201,
      await expert.post("/api/standard/facteurs", {
        code: "certification_bio",
        libelle: "Certification biologique",
        type: "booleen",
      }),
    );
    expect(f).toMatchObject({
      code: "certification_bio",
      origine: "cabinet",
      porte_par: "mission",
    });
    expect(
      (
        await expert.post("/api/standard/facteurs", {
          code: "effectif",
          libelle: "Doublon",
          type: "booleen",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await expert.post("/api/standard/facteurs", {
          code: "mauvais",
          libelle: "Liste",
          type: "enumeration",
        })
      ).statusCode,
    ).toBe(400);
    const pourB = attendu(200, await b.associe.get("/api/standard/facteurs"));
    expect(pourB.elements.map((x: { code: string }) => x.code)).not.toContain("certification_bio");
    const taxB = attendu(
      200,
      await b.associe.get("/api/standard/taxonomies?taxonomie=filiere&limite=100"),
    );
    expect(taxB.elements.map((x: { code: string }) => x.code)).not.toContain("karite");
  });

  it("notes de contexte (STD-06) : standard et cabinet, filtrées par cible", async () => {
    const n = attendu(
      201,
      await expert.post("/api/standard/notes", {
        cible_type: "brique",
        cible_code: "ecarts_perception",
        contexte: "Côte d'Ivoire",
        texte: "Prévoir un relais en dioula pour les équipes de production.",
      }),
    );
    expect(n.origine).toBe("cabinet");
    const liste = attendu(
      200,
      await consultant.get("/api/standard/notes?cible_type=brique&cible_code=ecarts_perception"),
    );
    expect(liste.elements).toHaveLength(1);
    const standard = attendu(200, await consultant.get("/api/standard/notes?cible_type=facteur"));
    expect(standard.elements.some((x: { origine: string }) => x.origine === "standard")).toBe(true);
    const pourB = attendu(
      200,
      await b.associe.get("/api/standard/notes?cible_code=ecarts_perception"),
    );
    expect(pourB.elements).toHaveLength(0);
  });
});

describe("variante du cabinet, éditeur et publication", () => {
  it("le consultant ne crée pas de variante ; l'expert métier crée la variante, copie du standard", async () => {
    expect((await consultant.post(`/api/methodes/${notationId}/variantes`)).statusCode).toBe(403);
    const v = attendu(201, await expert.post(`/api/methodes/${notationId}/variantes`, {}));
    varianteId = v.id;
    varianteV1 = v.version_id;
    expect(
      attendu(409, await expert.post(`/api/methodes/${notationId}/variantes`, {})).erreur.code,
    ).toBe("VARIANTE_EXISTANTE");
    const detail = attendu(200, await expert.get(`/api/methodes/versions/${varianteV1}`));
    expect(detail).toMatchObject({
      modifiable: true,
      methode: { origine: "variante", parent_id: notationId },
    });
    expect(detail.version.base_standard_id).toBe(notationV1);
    expect(detail.differences.diff.identique).toBe(true);
    expect(detail.briques).toHaveLength(19);
    const m = attendu(200, await consultant.get(`/api/methodes/${varianteId}`));
    expect(m.parent).toMatchObject({ id: notationId });
    expect(m.mise_a_jour_standard).toBeNull();
    const standard = attendu(200, await consultant.get(`/api/methodes/${notationId}`));
    expect(standard.variante).toMatchObject({ id: varianteId });
  });

  it("une variante d'une variante est refusée (400) ; l'autre cabinet ne voit pas la variante (404)", async () => {
    expect((await expert.post(`/api/methodes/${varianteId}/variantes`, {})).statusCode).toBe(400);
    expect((await b.associe.get(`/api/methodes/${varianteId}`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/methodes/versions/${varianteV1}`)).statusCode).toBe(404);
    expect(
      (
        await b.associe.post(`/api/methodes/versions/${varianteV1}/etapes`, {
          code: "x",
          libelle: "X",
        })
      ).statusCode,
    ).toBe(404);
    const liste = attendu(200, await b.associe.get("/api/methodes?limite=100"));
    expect(liste.elements.map((m: { id: string }) => m.id)).not.toContain(varianteId);
  });

  it("éditeur sans code : brique, élément, rubrique, règle et cas type ; différences visibles", async () => {
    const v = attendu(200, await expert.get(`/api/methodes/versions/${varianteV1}`));
    const restitution = v.etapes.find((e: { code: string }) => e.code === "restitution");
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${varianteV1}/briques`, {
        ...BRIQUE,
        etape_id: restitution.id,
      }),
    );
    expect(
      (
        await expert.post(`/api/methodes/versions/${varianteV1}/briques`, {
          ...BRIQUE,
          etape_id: restitution.id,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      attendu(
        400,
        await expert.post(`/api/methodes/versions/${varianteV1}/briques`, {
          ...BRIQUE,
          code: "autre",
          etape_id: restitution.id,
          moteur: "moteur.inconnu",
        }),
      ).erreur.code,
    ).toBe("MOTEUR_INCONNU");
    const brique = v.briques.find((x: { code: string }) => x.code === "plan_action");
    attendu(
      200,
      await expert.patch(`/api/methodes/versions/${varianteV1}/briques/${brique.id}`, {
        temps_type_jours: 1,
        libelle: "Plan d'action priorisé du cabinet",
      }),
    );
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${varianteV1}/elements`, {
        type: "livrable",
        code: "compte_rendu_atelier",
        libelle: "Compte rendu d'atelier",
      }),
    );
    const ancrages = [1, 2, 3, 4, 5].map((niveau) => ({ niveau, description: `Niveau ${niveau}` }));
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${varianteV1}/rubriques`, {
        code: "maitrise_risques",
        libelle: "Maîtrise des risques",
        ancrages,
      }),
    );
    expect(
      (
        await expert.post(`/api/methodes/versions/${varianteV1}/rubriques`, {
          code: "incomplete",
          libelle: "Incomplète",
          ancrages: ancrages.slice(0, 4),
        })
      ).statusCode,
    ).toBe(400);
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${varianteV1}/regles`, {
        code: "bio",
        priorite: 5,
        condition: {
          type: "comparaison",
          facteur: "certification_bio",
          comparateur: "egal",
          valeur: true,
        },
        effets: [{ type: "activer_brique", brique: BRIQUE.code }],
      }),
    );
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${varianteV1}/cas-types`, {
        code: "exploitation_bio",
        contexte: { certification_bio: true, effectif: 60 },
        attendu: {
          presents: [{ type: "activer_brique", brique: BRIQUE.code }],
          regles_declenchees: ["bio"],
        },
      }),
    );
    const apres = attendu(200, await expert.get(`/api/methodes/versions/${varianteV1}`));
    const diff = apres.differences.diff;
    expect(diff.identique).toBe(false);
    expect(diff.briques.ajoutes).toEqual([BRIQUE.code]);
    expect(diff.briques.modifies).toEqual([
      { code: "plan_action", champs: ["libelle", "temps_type_jours"] },
    ]);
    expect(diff.regles.ajoutes).toEqual(["bio"]);
    expect(diff.elements.ajoutes).toEqual(["compte_rendu_atelier"]);
    expect(diff.rubriques.ajoutes).toEqual(["maitrise_risques"]);
  });

  it("une règle incohérente bloque la publication (409), le contrôle la signale", async () => {
    const r = attendu(
      201,
      await expert.post(`/api/methodes/versions/${varianteV1}/regles`, {
        code: "fautive",
        priorite: 1,
        condition: {
          type: "comparaison",
          facteur: "inexistant",
          comparateur: "egal",
          valeur: true,
        },
        effets: [{ type: "activer_brique", brique: "brique_absente" }],
      }),
    );
    const validation = attendu(
      200,
      await expert.get(`/api/methodes/versions/${varianteV1}/validation`),
    );
    expect(validation.valide).toBe(false);
    expect(validation.anomalies.map((x: { code: string }) => x.code)).toEqual(
      expect.arrayContaining(["FACTEUR_INCONNU", "REFERENCE_INCONNUE"]),
    );
    expect(
      attendu(409, await expert2.post(`/api/methodes/versions/${varianteV1}/publication`)).erreur
        .code,
    ).toBe("VERSION_INCOHERENTE");
    attendu(204, await expert.delete(`/api/methodes/versions/${varianteV1}/regles/${r.id}`));
  });

  it("autonomie incompatible avec la classe de risque : erreur de cohérence", async () => {
    const v = attendu(200, await expert.get(`/api/methodes/versions/${varianteV1}`));
    const brique = v.briques.find((x: { code: string }) => x.code === BRIQUE.code);
    attendu(
      200,
      await expert.patch(`/api/methodes/versions/${varianteV1}/briques/${brique.id}`, {
        classe_risque: "R3",
        niveau_autonomie_max: "N3",
      }),
    );
    const validation = attendu(
      200,
      await expert.get(`/api/methodes/versions/${varianteV1}/validation`),
    );
    expect(validation.anomalies.map((x: { code: string }) => x.code)).toContain(
      "AUTONOMIE_INCOMPATIBLE",
    );
    attendu(
      200,
      await expert.patch(`/api/methodes/versions/${varianteV1}/briques/${brique.id}`, {
        classe_risque: "R2",
        niveau_autonomie_max: "N1",
      }),
    );
  });

  it("publication : version cohérente publiée, puis immuable (API 409, base MPM01)", async () => {
    expect(
      (await consultant.post(`/api/methodes/versions/${varianteV1}/publication`)).statusCode,
    ).toBe(403);
    // Quatre yeux : le créateur de la variante ne la publie pas (sauf associé) ; un autre expert le fait.
    expect(
      attendu(403, await expert.post(`/api/methodes/versions/${varianteV1}/publication`)).erreur
        .code,
    ).toBe("SEPARATION_DES_TACHES");
    const p = attendu(200, await expert2.post(`/api/methodes/versions/${varianteV1}/publication`));
    expect(p).toMatchObject({ statut: "publiee", validation: { valide: true } });
    expect(
      attendu(
        409,
        await expert.post(`/api/methodes/versions/${varianteV1}/etapes`, {
          code: "x",
          libelle: "X",
        }),
      ).erreur.code,
    ).toBe("VERSION_PUBLIEE");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(`UPDATE methode_briques SET libelle = 'modifiée' WHERE version_id = $1`, [
          varianteV1,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPM01" });
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(`UPDATE methode_versions SET notes_version = 'x' WHERE id = $1`, [varianteV1]),
      ),
    ).rejects.toMatchObject({ code: "MPM01" });
    await expect(
      proprietaire((c) => c.query(`DELETE FROM methode_versions WHERE id = $1`, [varianteV1])),
    ).rejects.toMatchObject({ code: "MPM01" });
  });

  it("nouvelle version : brouillon copié, notes de version exigées avant publication", async () => {
    const n = attendu(201, await expert.post(`/api/methodes/${varianteId}/versions`, {}));
    expect((await expert.post(`/api/methodes/${varianteId}/versions`, {})).statusCode).toBe(409);
    expect(
      attendu(409, await expert2.post(`/api/methodes/versions/${n.id}/publication`)).erreur.code,
    ).toBe("NOTES_VERSION_REQUISES");
    attendu(
      200,
      await expert.patch(`/api/methodes/versions/${n.id}`, {
        notes_version: "Ajustements mineurs.",
      }),
    );
    const detail = attendu(200, await expert.get(`/api/methodes/versions/${n.id}`));
    expect(detail.version.version).toBe(2);
    expect(detail.version.base_standard_id).toBe(notationV1);
    attendu(200, await expert2.post(`/api/methodes/versions/${n.id}/publication`));
    const comparaison = attendu(
      200,
      await consultant.get(`/api/methodes/versions/${n.id}/comparaison?avec=${varianteV1}`),
    );
    expect(comparaison.differences.identique).toBe(true);
  });

  it("le journal d'audit trace la variante et la publication", async () => {
    const actions = await proprietaire(async (c) =>
      (
        await c.query(
          `SELECT action FROM journal_audit WHERE cabinet_id = $1 AND action LIKE 'standard.%'`,
          [a.cabinetId],
        )
      ).rows.map((x) => x.action),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "standard.variante.creer",
        "standard.version.publier",
        "standard.brouillon.modifier",
      ]),
    );
  });
});

describe("comité méthode (STD-12)", () => {
  let propositionId: string;

  it("proposée → en revue (autre expert) → acceptée → publiée, l'auteur ne relit pas", async () => {
    expect(
      (await consultant.post("/api/standard/propositions", { titre: "x", description: "y" }))
        .statusCode,
    ).toBe(403);
    const p = attendu(
      201,
      await expert.post("/api/standard/propositions", {
        methode_id: notationId,
        titre: "Atelier de restitution",
        description: "Ajouter un atelier de restitution à la notation.",
      }),
    );
    propositionId = p.id;
    expect(p).toMatchObject({ statut: "proposee", methode_standard: true });
    expect(
      attendu(
        403,
        await expert.post(`/api/standard/propositions/${p.id}/revue`, {
          action: "prendre_en_revue",
        }),
      ).erreur.code,
    ).toBe("SEPARATION_DES_TACHES");
    attendu(
      200,
      await expert2.post(`/api/standard/propositions/${p.id}/revue`, {
        action: "prendre_en_revue",
      }),
    );
    expect(
      (await expert2.post(`/api/standard/propositions/${p.id}/revue`, { action: "refuser" }))
        .statusCode,
    ).toBe(400);
    const acceptee = attendu(
      200,
      await expert2.post(`/api/standard/propositions/${p.id}/revue`, {
        action: "accepter",
        avis: "Utile.",
      }),
    );
    expect(acceptee.statut).toBe("acceptee");
    expect(
      attendu(
        403,
        await expert.post(`/api/standard/propositions/${p.id}/publication`, {
          version_id: varianteV1,
        }),
      ).erreur.code,
    ).toBe("SEPARATION_DES_TACHES");
    expect(
      attendu(
        409,
        await expert2.post(`/api/standard/propositions/${p.id}/publication`, {
          version_id: notationV1,
        }),
      ).erreur.code,
    ).toBe("PROPOSITION_TRANSITION_REFUSEE");
    const publiee = attendu(
      200,
      await expert2.post(`/api/standard/propositions/${p.id}/publication`, {
        version_id: varianteV1,
      }),
    );
    expect(publiee).toMatchObject({ statut: "publiee", version_publiee_id: varianteV1 });
  });

  it("liste filtrée par statut ; l'autre cabinet ne voit rien ; transition refusée en base (MPM05)", async () => {
    const liste = attendu(200, await consultant.get("/api/standard/propositions?statut=publiee"));
    expect(liste.elements.map((x: { id: string }) => x.id)).toContain(propositionId);
    const pourB = attendu(200, await b.associe.get("/api/standard/propositions"));
    expect(pourB.elements).toHaveLength(0);
    expect(
      (
        await b.associe.post(`/api/standard/propositions/${propositionId}/revue`, {
          action: "accepter",
        })
      ).statusCode,
    ).toBe(404);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `UPDATE propositions_standard SET statut = 'refusee', avis = 'non' WHERE id = $1`,
          [propositionId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPM05" });
  });
});

describe("garde des variantes et visibilité du standard (audit de sécurité)", () => {
  const RANG_CLASSE: Record<string, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };
  const RANG_NIVEAU: Record<string, number> = { N0: 0, N1: 1, N2: 2, N3: 3, N4: 4 };
  const MAX_PAR_CLASSE: Record<string, string> = { R0: "N4", R1: "N3", R2: "N2", R3: "N2" };
  let bExpert: Api & { utilisateurId: string };
  let bExpert2: Api & { utilisateurId: string };
  let planId: string;
  let versionB: string;

  type BriqueApi = {
    id: string;
    code: string;
    classe_risque: string;
    niveau_autonomie_max: string;
  };
  const validation = async (acteur: Api, versionId: string) =>
    attendu(200, await acteur.get(`/api/methodes/versions/${versionId}/validation`));
  const codes = (v: { anomalies: { code: string }[] }) => v.anomalies.map((x) => x.code);
  const publierEnBase = (publiePar: string) =>
    ctx.db.withTenant(b.cabinetId, (db) =>
      db.query(
        `UPDATE methode_versions SET statut = 'publiee', publie_par = $2, publie_le = now() WHERE id = $1`,
        [versionB, publiePar],
      ),
    );

  beforeAll(async () => {
    bExpert = await b.avecRoles(["expert_metier"]);
    bExpert2 = await b.avecRoles(["expert_metier"]);
    const page = attendu(200, await bExpert.get("/api/methodes?limite=100"));
    planId = page.elements.find((m: { code: string }) => m.code === "plan_strategique").id;
  });

  it("variante : classe abaissée ou autonomie relevée = erreur de cohérence, publication refusée, doublé en base (MPM07)", async () => {
    const cree = attendu(201, await bExpert.post(`/api/methodes/${planId}/variantes`, {}));
    versionB = cree.version_id;
    const detail = attendu(200, await bExpert.get(`/api/methodes/versions/${versionB}`));
    const briques: BriqueApi[] = detail.briques;
    expect(codes(await validation(bExpert, versionB))).not.toContain("CLASSE_ABAISSEE");

    // Classe abaissée : une brique R2 ou R3 du standard passe en R0.
    const sensible = briques.find((x) => (RANG_CLASSE[x.classe_risque] ?? 0) >= 2)!;
    expect(sensible).toBeDefined();
    attendu(
      200,
      await bExpert.patch(`/api/methodes/versions/${versionB}/briques/${sensible.id}`, {
        classe_risque: "R0",
      }),
    );
    const v1 = await validation(bExpert, versionB);
    expect(v1.valide).toBe(false);
    expect(v1.anomalies).toContainEqual(
      expect.objectContaining({
        code: "CLASSE_ABAISSEE",
        gravite: "erreur",
        chemin: `briques.${sensible.code}.classe_risque`,
      }),
    );
    expect(
      attendu(409, await bExpert2.post(`/api/methodes/versions/${versionB}/publication`)).erreur
        .code,
    ).toBe("VERSION_INCOHERENTE");
    await expect(publierEnBase(bExpert2.utilisateurId)).rejects.toMatchObject({ code: "MPM07" });
    attendu(
      200,
      await bExpert.patch(`/api/methodes/versions/${versionB}/briques/${sensible.id}`, {
        classe_risque: sensible.classe_risque,
      }),
    );
    expect(codes(await validation(bExpert, versionB))).not.toContain("CLASSE_ABAISSEE");

    // Autonomie relevée : une brique dont l'autonomie du standard est inférieure au plafond de sa classe.
    const relevable = briques.find(
      (x) =>
        (RANG_NIVEAU[x.niveau_autonomie_max] ?? 0) <
        (RANG_NIVEAU[MAX_PAR_CLASSE[x.classe_risque] ?? "N0"] ?? 0),
    )!;
    expect(relevable).toBeDefined();
    const plafond = MAX_PAR_CLASSE[relevable.classe_risque] ?? "N0";
    attendu(
      200,
      await bExpert.patch(`/api/methodes/versions/${versionB}/briques/${relevable.id}`, {
        niveau_autonomie_max: plafond,
      }),
    );
    const v2 = await validation(bExpert, versionB);
    expect(codes(v2)).toContain("AUTONOMIE_RELEVEE");
    expect(codes(v2)).not.toContain("AUTONOMIE_INCOMPATIBLE");
    expect(
      attendu(409, await bExpert2.post(`/api/methodes/versions/${versionB}/publication`)).erreur
        .code,
    ).toBe("VERSION_INCOHERENTE");
    await expect(publierEnBase(bExpert2.utilisateurId)).rejects.toMatchObject({ code: "MPM07" });
    attendu(
      200,
      await bExpert.patch(`/api/methodes/versions/${versionB}/briques/${relevable.id}`, {
        niveau_autonomie_max: relevable.niveau_autonomie_max,
      }),
    );
    expect((await validation(bExpert, versionB)).valide).toBe(true);
  });

  it("variante : le créateur ne la publie pas (403, MPM08) ; un autre expert ou un associé le peut ; autre cabinet 404", async () => {
    expect(
      (await consultant.post(`/api/methodes/versions/${versionB}/publication`)).statusCode,
    ).toBe(403);
    expect((await api(ctx).post(`/api/methodes/versions/${versionB}/publication`)).statusCode).toBe(
      401,
    );
    expect((await expert2.post(`/api/methodes/versions/${versionB}/publication`)).statusCode).toBe(
      404,
    );
    expect(
      attendu(403, await bExpert.post(`/api/methodes/versions/${versionB}/publication`)).erreur
        .code,
    ).toBe("SEPARATION_DES_TACHES");
    await expect(publierEnBase(bExpert.utilisateurId)).rejects.toMatchObject({ code: "MPM08" });
    const publiee = attendu(
      200,
      await bExpert2.post(`/api/methodes/versions/${versionB}/publication`),
    );
    expect(publiee).toMatchObject({ statut: "publiee", validation: { valide: true } });

    // L'associé publie sa propre variante (exception de la séparation des tâches).
    const propre = attendu(201, await b.associe.post(`/api/methodes/${notationId}/variantes`, {}));
    const p = attendu(
      200,
      await b.associe.post(`/api/methodes/versions/${propre.version_id}/publication`),
    );
    expect(p.statut).toBe("publiee");
  });

  it("le brouillon du standard et son contenu restent invisibles d'un cabinet (seules les versions publiées se lisent)", async () => {
    const brouillon = await proprietaire(async (c) => {
      const v = await c.query(
        `INSERT INTO methode_versions (methode_id, version, notes_version)
         SELECT $1, max(version) + 1, 'Brouillon en préparation par ACC.'
           FROM methode_versions WHERE methode_id = $1 RETURNING id`,
        [notationId],
      );
      await c.query(
        `INSERT INTO methode_etapes (version_id, code, libelle) VALUES ($1, 'secrete', 'Étape secrète')`,
        [v.rows[0].id],
      );
      return v.rows[0].id as string;
    });
    try {
      expect((await consultant.get(`/api/methodes/versions/${brouillon}`)).statusCode).toBe(404);
      const detail = attendu(200, await consultant.get(`/api/methodes/${notationId}`));
      expect(detail.versions.map((x: { id: string }) => x.id)).not.toContain(brouillon);
      const lignes = await ctx.db.withTenant(a.cabinetId, async (db) => {
        const v = await db.query(`SELECT 1 FROM methode_versions WHERE id = $1`, [brouillon]);
        const e = await db.query(`SELECT 1 FROM methode_etapes WHERE version_id = $1`, [brouillon]);
        const pub = await db.query(`SELECT 1 FROM methode_etapes WHERE version_id = $1 LIMIT 1`, [
          notationV1,
        ]);
        return { v: v.rowCount, e: e.rowCount, publiee: pub.rowCount };
      });
      expect(lignes).toEqual({ v: 0, e: 0, publiee: 1 });
    } finally {
      await proprietaire(async (c) => {
        await c.query(`DELETE FROM methode_etapes WHERE version_id = $1`, [brouillon]);
        await c.query(`DELETE FROM methode_versions WHERE id = $1`, [brouillon]);
      });
    }
  });
});
