import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluerPrompt } from "../src/agents/evaluations.js";
import { creerFournisseurLocal } from "../src/ia/fournisseur-local.js";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { authDe } from "./ia-outils.js";

/*
 * Jeux d'essai et évaluations de non-régression (AGT-04, migration 0264) :
 * rejeu sur le fournisseur LOCAL déterministe (aucun appel à un modèle),
 * comparaison avec la version active, et gardes de la base : aucune activation
 * de prompt ni aucun choix de modèle sans évaluation réussie (MPG04).
 */

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
const ids: Record<string, string> = {};

function attendre<R extends { statusCode: number; body: string }>(statut: number, r: R): R {
  if (r.statusCode !== statut) throw new Error(`${r.statusCode} ${r.body}`);
  return r;
}

const JEU = {
  prompt_nom: "resume_neutre",
  description: "Résumés de référence.",
  cas: [
    {
      code: "climat",
      variables: { texte: "Le climat social est bon. Les équipes sont motivées." },
      attendu: { contient: ["climat social"], ne_contient_pas: ["licenciement"] },
    },
    {
      code: "marge",
      variables: { texte: "La marge progresse nettement sur l'exercice." },
      chiffres: [{ libelle: "Marge brute", valeur: 12.5, unite: "%" }],
      attendu: { contient: ["12,5"] },
    },
  ],
};

const versionPrompt = (gabarit: string) => ({
  nom: "resume_neutre",
  tache: "redaction",
  gabarit_utilisateur: gabarit,
  schema_sortie: { type: "texte" },
  activer: false,
});

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet A évaluations");
  b = await cabinetTest(ctx, "Cabinet B évaluations");
  const p = attendre(200, await a.associe.get("/api/ia/prompts?nom=resume_neutre")).json();
  ids.v1 = p.elements[0].id;
});

afterAll(async () => {
  await ctx.fermer();
});

describe("jeux d'essai", () => {
  it("401, 403 sans agent.gerer ou agent.lire, 404 prompt inconnu, 400 cas en double", async () => {
    expect((await api(ctx).post("/api/agents/jeux-essai", JEU)).statusCode).toBe(401);
    expect((await api(ctx).get("/api/agents/jeux-essai")).statusCode).toBe(401);
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.post("/api/agents/jeux-essai", JEU)).statusCode).toBe(403);
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect((await gestionnaire.get("/api/agents/jeux-essai")).statusCode).toBe(403);
    expect(
      (await a.associe.post("/api/agents/jeux-essai", { ...JEU, prompt_nom: "inconnu" }))
        .statusCode,
    ).toBe(404);
    const double = { ...JEU, cas: [JEU.cas[0], JEU.cas[0]] };
    expect((await a.associe.post("/api/agents/jeux-essai", double)).statusCode).toBe(400);
  });

  it("l'expert métier crée la version 1 du jeu ; invisible d'un autre cabinet", async () => {
    const expert = await a.avecRoles(["expert_metier"]);
    const r = attendre(201, await expert.post("/api/agents/jeux-essai", JEU)).json();
    expect(r).toMatchObject({ prompt_nom: "resume_neutre", version: 1 });
    expect(r.cas[0].attendu.sans_chiffres_non_verifies).toBe(true);
    expect(attendre(200, await b.associe.get("/api/agents/jeux-essai")).json().elements).toEqual(
      [],
    );
  });
});

describe("évaluations de non-régression", () => {
  it("401, 403, 409 sans jeu, 400 modèle non autorisé, 404 prompt d'un autre cabinet", async () => {
    const corps = { prompt_id: ids.v1 };
    expect((await api(ctx).post("/api/agents/evaluations", corps)).statusCode).toBe(401);
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.post("/api/agents/evaluations", corps)).statusCode).toBe(403);
    const reformulation = attendre(
      200,
      await a.associe.get("/api/ia/prompts?nom=reformulation"),
    ).json().elements[0].id;
    const sansJeu = await a.associe.post("/api/agents/evaluations", { prompt_id: reformulation });
    expect(sansJeu.json().erreur.code).toBe("JEU_ESSAI_ABSENT");
    const modele = await a.associe.post("/api/agents/evaluations", {
      prompt_id: ids.v1,
      modele: "inconnu/modele-x",
    });
    expect(modele.statusCode).toBe(400);
    expect((await b.associe.post("/api/agents/evaluations", corps)).statusCode).toBe(404);
  });

  it("la version active réussit le jeu sur le fournisseur local", async () => {
    const r = attendre(201, await a.associe.post("/api/agents/evaluations", { prompt_id: ids.v1 }));
    expect(r.json()).toMatchObject({
      prompt_version: 1,
      prompt_reference_id: null,
      modele: "anthropic/claude-sonnet-4.5",
      fournisseur: "local",
      cas_total: 2,
      cas_reussis: 2,
      regressions: 0,
      reussie: true,
    });
  });

  it("une version qui casse le jeu échoue (régressions) et ne peut être activée", async () => {
    const v2 = attendre(
      201,
      await a.associe.post("/api/ia/prompts", versionPrompt("Résume :\n{{contenu}}")),
    ).json();
    ids.v2 = v2.id;
    const r = attendre(201, await a.associe.post("/api/agents/evaluations", { prompt_id: v2.id }));
    expect(r.json()).toMatchObject({
      prompt_version: 2,
      prompt_reference_id: ids.v1,
      reussie: false,
      cas_reussis: 0,
      regressions: 2,
    });
    expect(r.json().resultats[0]).toMatchObject({
      code: "climat",
      reussi: false,
      raisons: ["VARIABLES_MANQUANTES", "VARIABLES_INCONNUES"],
      reference_reussi: true,
    });
    // La base refuse l'activation (MPG04), par la route IA comme en direct.
    const activation = await a.associe.post(`/api/ia/prompts/${v2.id}/activer`, {});
    expect(activation.statusCode).toBe(409);
    expect(activation.json().erreur.code).toBe("NON_REGRESSION_REQUISE");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO ia_prompt_activations (cabinet_id, nom, prompt_id, active_par)
           VALUES ($1, 'resume_neutre', $2, $3)`,
          [a.cabinetId, v2.id, a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPG04" });
    const actif = attendre(200, await a.associe.get("/api/ia/prompts")).json();
    expect(actif.elements.find((p: { nom: string }) => p.nom === "resume_neutre").version).toBe(1);
  });

  it("une version qui réussit le jeu s'active ; sans régression par rapport à la version active", async () => {
    const v3 = attendre(
      201,
      await a.associe.post(
        "/api/ia/prompts",
        versionPrompt("Résume en trois phrases.\nCHIFFRES :\n{{chiffres}}\nTEXTE :\n{{texte}}"),
      ),
    ).json();
    ids.v3 = v3.id;
    const r = attendre(201, await a.associe.post("/api/agents/evaluations", { prompt_id: v3.id }));
    expect(r.json()).toMatchObject({ reussie: true, regressions: 0, prompt_reference_id: ids.v1 });
    const activation = attendre(200, await a.associe.post(`/api/ia/prompts/${v3.id}/activer`, {}));
    expect(activation.json()).toMatchObject({ version: 3, actif: true });
  });

  it("un changement de modèle exige une évaluation réussie avec ce modèle", async () => {
    const changement = { modeles: { redaction: "anthropic/claude-haiku-4.5" } };
    const refus = await a.associe.put("/api/ia/parametres", changement);
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("NON_REGRESSION_REQUISE");
    attendre(
      201,
      await a.associe.post("/api/agents/evaluations", {
        prompt_id: ids.v3,
        modele: "anthropic/claude-haiku-4.5",
      }),
    );
    attendre(200, await a.associe.put("/api/ia/parametres", changement));
    // Le cabinet B, sans jeu d'essai, change de modèle librement.
    attendre(200, await b.associe.put("/api/ia/parametres", changement));
  });

  it("sous jeu d'essai, une version neuve est créée inactive par défaut ; activer: true → 409", async () => {
    const sansActiver: Partial<ReturnType<typeof versionPrompt>> =
      versionPrompt("Résume :\n{{texte}}");
    delete sansActiver.activer;
    const v = attendre(201, await a.associe.post("/api/ia/prompts", sansActiver)).json();
    expect(v.actif).toBe(false);
    const explicite = await a.associe.post("/api/ia/prompts", {
      ...sansActiver,
      activer: true,
    });
    expect(explicite.statusCode).toBe(409);
    expect(explicite.json().erreur.code).toBe("NON_REGRESSION_REQUISE");
    const versions = attendre(200, await a.associe.get("/api/ia/prompts?nom=resume_neutre"));
    // Rien n'a été créé par la demande refusée : la plus haute version est la nouvelle.
    expect(versions.json().elements[0].id).toBe(v.id);
    const actif = attendre(200, await a.associe.get("/api/ia/prompts")).json();
    expect(actif.elements.find((p: { nom: string }) => p.nom === "resume_neutre").id).toBe(ids.v3);
    // Sans jeu d'essai (cabinet B), le comportement par défaut reste « active ».
    const libre = attendre(201, await b.associe.post("/api/ia/prompts", sansActiver)).json();
    expect(libre.actif).toBe(true);
  });

  it("la garde-chiffres s'applique aux cas : un nombre inventé fait échouer le cas", async () => {
    const auth = await authDe(ctx, a.cabinetId, a.associeId);
    const r = await ctx.db.withTenant(a.cabinetId, (db) =>
      evaluerPrompt(db, auth, { prompt_id: ids.v3! }, () =>
        creerFournisseurLocal(() => "Le climat social est bon ; la marge atteint 47 %."),
      ),
    );
    expect(r).toMatchObject({ reussie: false });
    expect((r.resultats as { raisons: string[] }[])[0]!.raisons).toContain("CHIFFRES_NON_VERIFIES");
  });

  it("liste les évaluations (agent.lire) ; isolation ; ajout seul", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    const l = attendre(
      200,
      await consultant.get("/api/agents/evaluations?prompt_nom=resume_neutre"),
    );
    expect(l.json().elements.length).toBe(5);
    expect(attendre(200, await b.associe.get("/api/agents/evaluations")).json().elements).toEqual(
      [],
    );
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE agents_evaluations SET reussie = true"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM agents_jeux_essai")),
    ).rejects.toThrow(/permission denied/);
  });
});
