import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  detecterEcarts,
  type DefinitionQuestionnaire,
  type GrilleNotation,
} from "@missionpilot/engines";
import { GRILLE_GENERIQUE } from "@missionpilot/shared";
import { calculerV2, type EntreesCalculNotation } from "../src/notation/calcul.js";
import {
  executerNotationMethode,
  methodeNotationMission,
  type MethodeNotation,
} from "../src/notation/via-methode.js";
import { reponsesSoumises } from "../src/questionnaires/envois.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  repondre,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";

/*
 * Condition de passage de la vague 1 (PRD complémentaire §18) : « la notation tourne sur le
 * référentiel avec des résultats identiques à la V2 ». La même notation est calculée par les
 * deux chemins — V2 directe (`calculerV2`) et depuis la méthode « Notation d'entreprise » du
 * standard (`executerNotationMethode`, méthode effective de la mission) — sur plusieurs grilles,
 * secteurs, stratégies et jeux de réponses, y compris avec des règles de modulation actives qui
 * n'ajustent pas le calcul : résultats STRICTEMENT identiques. Puis ce qui change quand une
 * règle ajuste une pondération ou un seuil, ou qu'une brique de calcul est retirée.
 */

/** Réponse au statut attendu (sinon erreur explicite), renvoyée pour lecture. */
function attendre<R extends { statusCode: number; body: string }>(
  statut: number,
  r: R,
  quoi: string,
): R {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
  return r;
}

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let definition: DefinitionQuestionnaire;
let envoiIndividuel: string;
let envoiCollectif: string;
let notationId: string;
let methode: MethodeNotation;

/** PME familiale de la filière cacao, comptes fragiles : quatre règles déclenchées (0205). */
const PME_CACAO = {
  effectif: 12,
  fiabilite_comptes: "non_certifies",
  part_informel: "forte",
  actionnariat: "familial",
  filieres: ["cacao"],
  agricole: true,
};

const GENERIQUE = GRILLE_GENERIQUE as GrilleNotation;

/** Grille du cabinet : poids de la première dimension triplé (comme notation-calcul.test.ts). */
const GRILLE_CABINET: GrilleNotation = {
  ...GENERIQUE,
  id: "grille_cabinet",
  dimensions: GENERIQUE.dimensions.map((d, i) => (i === 0 ? { ...d, poids: d.poids * 3 } : d)),
};

async function entrees(
  envoiId: string,
  collectif: boolean,
  grille: GrilleNotation,
  options: EntreesCalculNotation["options"],
): Promise<EntreesCalculNotation> {
  const soumises = await ctx.db.withTenant(s.a.cabinetId, (db) => reponsesSoumises(db, envoiId));
  return { grille, definition, collectif, soumises, options };
}

/** Méthode modifiée pour un essai (règles de calcul simulées sur la méthode effective réelle). */
function avec(
  m: MethodeNotation,
  changement: {
    ponderations?: Record<string, number>;
    seuils?: Record<string, number>;
    inactives?: string[];
  },
): MethodeNotation {
  return {
    ...m,
    ajustements: {
      ...m.ajustements,
      ponderations: { ...m.ajustements.ponderations, ...changement.ponderations },
      seuils: { ...m.ajustements.seuils, ...changement.seuils },
    },
    etapes: m.etapes.map((e) => ({
      ...e,
      briques: e.briques.map((b) =>
        changement.inactives?.includes(b.code) ? { ...b, active: false } : b,
      ),
    })),
  };
}

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  const v = await versionValidee(s.consultant, "notation_methode");
  definition = v.definition;
  envoiIndividuel = await envoyer(s.consultant, s.missionId, v.versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId },
    { utilisateur_id: s.contributeur.utilisateurId },
  ]);
  await repondre(s.dirigeant, envoiIndividuel, reponsesAuNiveau(definition, 5));
  await repondre(s.contributeur, envoiIndividuel, reponsesAuNiveau(definition, 2));
  envoiCollectif = await envoyer(
    s.consultant,
    s.missionId,
    v.versionId,
    [{ utilisateur_id: s.dirigeant.utilisateurId }],
    "collectif",
  );
  await repondre(s.dirigeant, envoiCollectif, reponsesAuNiveau(definition, 3));

  const liste = attendre(200, await s.a.associe.get("/api/methodes?limite=100"), "méthodes").json();
  const notationV1 = liste.elements.find((m: { code: string }) => m.code === "notation_entreprise")
    .derniere_publiee.id as string;
  attendre(
    200,
    await s.a.chef.put(`/api/missions/${s.missionId}/methode`, {
      version_id: notationV1,
      contexte: PME_CACAO,
      motif: "Contexte du dossier : PME cacao familiale.",
    }),
    "liaison de la méthode",
  );
  methode = (await ctx.db.withTenant(s.a.cabinetId, (db) =>
    methodeNotationMission(db, s.missionId),
  )) as MethodeNotation;
}, 240_000);
afterAll(() => ctx.fermer());

describe("non-régression : V2 directe et méthode du référentiel", () => {
  it("la méthode effective porte des règles actives qui n'ajustent pas le calcul", () => {
    expect(methode.version.methode_code).toBe("notation_entreprise");
    expect([...methode.modulation.regles_declenchees].sort()).toEqual([
      "comptes_fragiles",
      "filiere_agricole",
      "gouvernance_familiale",
      "petite_structure",
    ]);
    expect(methode.ajustements.ponderations).toEqual({});
    expect(methode.ajustements.seuils).toEqual({});
    // Les briques de 0205 désignent les moteurs existants par code.
    const moteurs = Object.fromEntries(
      methode.etapes.flatMap((e) => e.briques).map((b) => [b.code, b.moteur]),
    );
    expect(moteurs).toMatchObject({
      notation_repondants: "questionnaires.notation_repondants",
      ecarts_perception: "notation.ecarts_perception",
      calcul_note: "notation.score_global",
    });
  });

  const cas: [string, boolean, GrilleNotation, EntreesCalculNotation["options"]][] = [
    ["individuel, grille générique", false, GENERIQUE, { strategie: "ignorer" }],
    [
      "individuel, secteur industrie",
      false,
      GENERIQUE,
      { strategie: "ignorer", secteur: "industrie" },
    ],
    ["individuel, stratégie pénaliser", false, GENERIQUE, { strategie: "penaliser" }],
    ["individuel, grille du cabinet", false, GRILLE_CABINET, { strategie: "ignorer" }],
    ["collectif, grille générique", true, GENERIQUE, { strategie: "ignorer" }],
    [
      "collectif, secteur agro-industrie",
      true,
      GENERIQUE,
      { strategie: "ignorer", secteur: "agro_industrie" },
    ],
    ["collectif, grille du cabinet", true, GRILLE_CABINET, { strategie: "penaliser" }],
  ];
  for (const [libelle, collectif, grille, options] of cas) {
    it(`résultats strictement identiques : ${libelle}`, async () => {
      const e = await entrees(
        collectif ? envoiCollectif : envoiIndividuel,
        collectif,
        grille,
        options,
      );
      const v2 = calculerV2(e);
      const via = executerNotationMethode(methode, e);
      expect(via.resultat).toEqual(v2.resultat);
      expect(via.ecarts).toEqual(v2.ecarts);
      expect(JSON.stringify(via.resultat)).toBe(JSON.stringify(v2.resultat));
      expect(via.grille).toBe(grille);
      expect(via.journal.ponderations).toEqual([]);
      expect(via.journal.non_appliques).toEqual([]);
      expect(via.journal.briques.map((b) => [b.brique, b.statut])).toEqual(
        collectif
          ? [
              ["notation_repondants", "sans_objet"],
              ["ecarts_perception", "sans_objet"],
              ["calcul_note", "execute"],
            ]
          : [
              ["notation_repondants", "execute"],
              ["ecarts_perception", "execute"],
              ["calcul_note", "execute"],
            ],
      );
      if (!collectif) expect(v2.ecarts.length).toBeGreaterThan(0);
    });
  }
});

describe("ce qui change quand une règle ajuste le calcul", () => {
  it("pondération d'une rubrique rattachée à une dimension : poids remplacé, part de chaque dimension changée", async () => {
    const e = await entrees(envoiIndividuel, false, GENERIQUE, {
      strategie: "ignorer",
      secteur: "industrie",
    });
    const via = executerNotationMethode(
      avec(methode, { ponderations: { pilotage_performance: 30 } }),
      e,
    );
    const pilotage = GENERIQUE.dimensions.find((d) => d.id === "pilotage")!;
    const attendue: GrilleNotation = {
      ...GENERIQUE,
      dimensions: GENERIQUE.dimensions.map((d) => (d.id === "pilotage" ? { ...d, poids: 30 } : d)),
      secteurs: GENERIQUE.secteurs!.map((sec) => ({
        ...sec,
        poids: sec.poids.map((p) => (p.dimension === "pilotage" ? { ...p, poids: 30 } : p)),
      })),
    };
    expect(via.grille).toEqual(attendue);
    // Le calcul reste celui du moteur V2, sur la grille adaptée.
    expect(via.resultat).toEqual(calculerV2({ ...e, grille: attendue }).resultat);
    const v2 = calculerV2(e);
    expect(via.resultat.score).not.toBe(v2.resultat.score);
    // Le score d'une dimension ne change pas : seule la pondération globale bouge.
    expect(via.resultat.dimensions.map((d) => d.score)).toEqual(
      v2.resultat.dimensions.map((d) => d.score),
    );
    expect(via.journal.ponderations).toEqual([
      {
        cible: "pilotage_performance",
        dimension: "pilotage",
        poids_avant: pilotage.poids,
        poids_apres: 30,
        secteurs: GENERIQUE.secteurs!.map((x) => x.secteur),
      },
    ]);
  });

  it("pondération sans dimension de la grille et seuil d'une autre cible : sans effet, tracés", async () => {
    const e = await entrees(envoiIndividuel, false, GENERIQUE, { strategie: "ignorer" });
    const via = executerNotationMethode(
      avec(methode, {
        ponderations: { analyse_financiere: 2, gouvernance: 5 },
        seuils: { forces_faiblesses: 70, ecarts_perception: 1.5 },
      }),
      e,
    );
    expect(via.resultat).toEqual(calculerV2(e).resultat);
    expect(via.ecarts).toEqual(calculerV2(e).ecarts);
    expect(via.journal.non_appliques.map((n) => [n.type, n.cible])).toEqual([
      ["ponderation", "analyse_financiere"],
      // Rubrique « gouvernance » : sa dimension n'existe pas dans la grille générique.
      ["ponderation", "gouvernance"],
      ["seuil", "ecarts_perception"],
      ["seuil", "forces_faiblesses"],
    ]);
  });

  it("seuil de la brique des écarts de perception : passé au moteur des écarts", async () => {
    const e = await entrees(envoiIndividuel, false, GENERIQUE, { strategie: "ignorer" });
    const via = executerNotationMethode(avec(methode, { seuils: { ecarts_perception: 4 } }), e);
    const jeux = e.soumises.map((x) => ({
      repondant: x.repondant_id as string,
      reponses: x.reponses,
    }));
    expect(via.ecarts).toEqual(detecterEcarts(definition, jeux, { seuil: 4 }));
    expect(via.resultat).toEqual(calculerV2(e).resultat);
    expect(via.journal.seuil_ecarts).toEqual({ cible: "ecarts_perception", valeur: 4 });
  });

  it("brique de calcul retirée : écarts non calculés, ou calcul impossible (409)", async () => {
    const e = await entrees(envoiIndividuel, false, GENERIQUE, { strategie: "ignorer" });
    const sansEcarts = executerNotationMethode(
      avec(methode, { inactives: ["ecarts_perception"] }),
      e,
    );
    expect(sansEcarts.ecarts).toEqual([]);
    expect(sansEcarts.resultat).toEqual(calculerV2(e).resultat);
    expect(sansEcarts.journal.briques_inactives).toEqual([
      { brique: "ecarts_perception", moteur: "notation.ecarts_perception" },
    ]);
    for (const inactive of ["calcul_note", "notation_repondants"]) {
      expect(() => executerNotationMethode(avec(methode, { inactives: [inactive] }), e)).toThrow(
        expect.objectContaining({ code: "METHODE_NOTATION_INCOMPLETE", statut: 409 }),
      );
    }
    // En mode collectif, la préparation par répondant est sans objet.
    const c = await entrees(envoiCollectif, true, GENERIQUE, { strategie: "ignorer" });
    expect(
      executerNotationMethode(avec(methode, { inactives: ["notation_repondants"] }), c).resultat,
    ).toEqual(calculerV2(c).resultat);
  });

  it("pondérations en conflit sur une dimension, ou grille rendue invalide : 409", async () => {
    const e = await entrees(envoiIndividuel, false, GENERIQUE, { strategie: "ignorer" });
    const conflit = avec(
      {
        ...methode,
        rubriques: [...methode.rubriques, { code: "pilotage_bis", dimension: "pilotage" }],
      },
      { ponderations: { pilotage_performance: 10, pilotage_bis: 20 } },
    );
    expect(() => executerNotationMethode(conflit, e)).toThrow(
      expect.objectContaining({ code: "PONDERATIONS_EN_CONFLIT" }),
    );
    const zero = avec(
      {
        ...methode,
        rubriques: GENERIQUE.dimensions.map((d) => ({ code: `r_${d.id}`, dimension: d.id })),
      },
      { ponderations: Object.fromEntries(GENERIQUE.dimensions.map((d) => [`r_${d.id}`, 0])) },
    );
    expect(() => executerNotationMethode(zero, e)).toThrow(
      expect.objectContaining({ code: "PONDERATIONS_INVALIDES" }),
    );
  });
});

describe("méthode sans brique de calcul de la notation", () => {
  it("une mission liée au « Plan stratégique » garde le chemin V2 pour sa notation", async () => {
    const autre = (await creerMission(s.a, { intitule: "Plan de la même entreprise" })).id;
    const liste = attendre(
      200,
      await s.a.associe.get("/api/methodes?limite=100"),
      "méthodes",
    ).json();
    const planV1 = liste.elements.find((m: { code: string }) => m.code === "plan_strategique")
      .derniere_publiee.id as string;
    attendre(
      200,
      await s.a.chef.put(`/api/missions/${autre}/methode`, { version_id: planV1, contexte: {} }),
      "liaison du plan",
    );
    const m = await ctx.db.withTenant(s.a.cabinetId, (db) => methodeNotationMission(db, autre));
    expect(m).toBeNull();
  });
});

describe("route : la notation d'une mission liée enregistre sa méthode et son journal", () => {
  it("calcul par la route = moteur V2 ; version de méthode et journal de modulation enregistrés", async () => {
    notationId = attendre(
      201,
      await s.consultant.post(`/api/missions/${s.missionId}/notation`, {}),
      "notation",
    ).json().id;
    const r = attendre(
      201,
      await s.consultant.post(`/api/notations/${notationId}/calculs`, {
        envoi_id: envoiIndividuel,
      }),
      "calcul",
    ).json();
    const e = await entrees(envoiIndividuel, false, GENERIQUE, { strategie: "ignorer" });
    expect(r.resultat).toEqual(JSON.parse(JSON.stringify(calculerV2(e).resultat)));
    expect(r.methode).toMatchObject({
      methode_version_id: methode.version.id,
      mission_methode_id: methode.liaison.id,
      journal: {
        methode: { methode_code: "notation_entreprise", version: 1, origine: "standard" },
        liaison: { rang: 1, evenement: "liaison" },
        ponderations: [],
        non_appliques: [],
      },
    });
    const ligne = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `SELECT nm.modulation FROM notation_versions_methode nm
         JOIN notation_versions v ON v.id = nm.version_id WHERE v.notation_id = $1`,
        [notationId],
      ),
    );
    expect(ligne.rows).toHaveLength(1);
    expect(ligne.rows[0].modulation).toEqual(JSON.parse(JSON.stringify(methode.modulation)));
  });

  it("ajout seul (MPN06, même pour le propriétaire) ; liaison non courante refusée (MPN07)", async () => {
    await expect(
      ctx.db.withTenant(s.a.cabinetId, (db) =>
        db.query("UPDATE notation_versions_methode SET execution = '{}'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      proprietaire((c) => c.query("DELETE FROM notation_versions_methode")),
    ).rejects.toMatchObject({ code: "MPN06" });
    // Nouveau contexte : la liaison de rang 1 n'est plus la liaison courante.
    attendre(
      200,
      await s.a.chef.post(`/api/missions/${s.missionId}/methode/contexte`, {
        contexte: { ...PME_CACAO, effectif: 150 },
        motif: "Effectif réévalué",
      }),
      "changement de contexte",
    );
    const v = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `SELECT v.id FROM notation_versions v WHERE v.notation_id = $1 ORDER BY v.numero DESC LIMIT 1`,
        [notationId],
      ),
    );
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO notation_versions_methode (cabinet_id, version_id, mission_methode_id,
             methode_version_id, modulation, execution) VALUES ($1, $2, $3, $4, '{}', '{}')`,
          [s.a.cabinetId, v.rows[0].id, methode.liaison.id, methode.version.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPN07" });
    // Un nouveau calcul suit la liaison courante (rang 2) et ses règles.
    const r = attendre(
      201,
      await s.consultant.post(`/api/notations/${notationId}/calculs`, {
        envoi_id: envoiIndividuel,
      }),
      "second calcul",
    ).json();
    expect(r.methode.journal.liaison).toMatchObject({ rang: 2, evenement: "contexte" });
    expect(r.methode.journal.regles_declenchees).not.toContain("petite_structure");
  });

  it("invisible du portail et d'un autre cabinet", async () => {
    const n = await ctx.db.withTenant(s.a.cabinetId, async (db) => {
      await db.query("SELECT set_config('app.portail_client_id', $1, true)", [s.a.clientId]);
      await db.query("SELECT set_config('app.portail_utilisateur_id', $1, true)", [
        s.dirigeant.utilisateurId,
      ]);
      return (await db.query("SELECT count(*)::int AS n FROM notation_versions_methode")).rows[0].n;
    });
    expect(n).toBe(0);
    const autre = await ctx.db.withTenant(s.b.cabinetId, (db) =>
      db.query("SELECT count(*)::int AS n FROM notation_versions_methode"),
    );
    expect(autre.rows[0].n).toBe(0);
  });
});
