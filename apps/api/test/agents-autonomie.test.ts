import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest, type Api, type CabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Autonomie par brique et par cabinet (AGT-03, migration 0262) : déclaration,
 * niveau effectif (moteur pur), éligibilité, décision d'un associé, incident
 * majeur → rétrogradation automatique, coupe-circuit N4. Corrections d'audit :
 * incident majeur réservé, exécutions en mode dégradé hors éligibilité, brique
 * R0 réservée à un associé, plancher de classe de la méthode, restriction d'un
 * associé levée par un associé seulement.
 */

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
let expert: Api & { utilisateurId: string };
let consultant: Api & { utilisateurId: string };
let promptId: string;

function attendre<R extends { statusCode: number; body: string }>(statut: number, r: R): R {
  if (r.statusCode !== statut) throw new Error(`${r.statusCode} ${r.body}`);
  return r;
}

/**
 * Sème `n` exécutions décidées sur une brique (propriétaire : hors API, données de test) ;
 * `degrade` : exécutions en mode dégradé (gabarit, aucun modèle).
 */
async function semerExecutions(
  cabinetId: string,
  briqueCode: string,
  agent: string,
  declencheur: string,
  decisions: { acceptee?: number; modifiee?: number; rejetee?: number },
  degrade = false,
) {
  await proprietaire(async (c) => {
    const brique = (
      await c.query("SELECT id FROM agents_briques WHERE cabinet_id = $1 AND brique_code = $2", [
        cabinetId,
        briqueCode,
      ])
    ).rows[0].id as string;
    for (const [decision, n] of Object.entries(decisions)) {
      if (!n) continue;
      const d = await c.query(
        `INSERT INTO ia_demandes (cabinet_id, tache, prompt_id, prompt_nom, prompt_version,
           demandeur_id, statut, progression, entree_empreinte, entree_cle_version, entree_champs,
           termine_le)
         SELECT $1, 'redaction', $2, 'resume_neutre', 1, $3, 'terminee', 100, repeat('a', 64), 1,
           '{texte}', now() FROM generate_series(1, $4) RETURNING id`,
        [cabinetId, promptId, declencheur, n],
      );
      const ids = d.rows.map((x) => x.id as string);
      await c.query(
        `INSERT INTO ia_generations (cabinet_id, demande_id, version, statut_contenu, fournisseur,
           texte, gabarit, chiffres_non_verifies, auteur_id)
         SELECT $1, x, 1, 'brouillon_ia', 'gabarit', 'Texte de brouillon.', true, false, $3
         FROM unnest($2::uuid[]) x`,
        [cabinetId, ids, declencheur],
      );
      await c.query(
        `INSERT INTO ia_generations (cabinet_id, demande_id, version, statut_contenu, fournisseur,
           texte, gabarit, chiffres_non_verifies, auteur_id)
         SELECT $1, x, 2, 'valide', 'humain', 'Texte de brouillon.', true, false, $3
         FROM unnest($2::uuid[]) x`,
        [cabinetId, ids, declencheur],
      );
      const e = await c.query(
        `INSERT INTO agents_executions (cabinet_id, agent_code, agent_version, brique_id, demande_id,
           declencheur_id, niveau_effectif, prompt_nom, prompt_version, tache, fournisseur,
           mode_degrade, entree_empreinte, sortie_valide, chiffres_non_verifies)
         SELECT $1, $2, 1, $3, x, $4, 'N2', 'resume_neutre', 1, 'redaction',
           CASE WHEN $6 THEN 'gabarit' ELSE 'openrouter' END, $6,
           repeat('a', 64), true, false FROM unnest($5::uuid[]) x RETURNING id`,
        [cabinetId, agent, brique, declencheur, ids, degrade],
      );
      await c.query(
        `INSERT INTO agents_execution_decisions (cabinet_id, execution_id, decision,
           taux_modification_pct, seuil_pct, motif, decideur_id)
         SELECT $1, x, $2, $3, $4, $5, $6 FROM unnest($7::uuid[]) x`,
        [
          cabinetId,
          decision,
          decision === "rejetee" ? null : decision === "modifiee" ? 40 : 0,
          decision === "rejetee" ? null : 25,
          decision === "rejetee" ? "Hors sujet." : null,
          declencheur,
          e.rows.map((x) => x.id),
        ],
      );
    }
  });
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet A autonomie");
  b = await cabinetTest(ctx, "Cabinet B autonomie");
  expert = await a.avecRoles(["expert_metier"]);
  consultant = await a.avecRoles(["consultant"]);
  const prompts = attendre(200, await a.associe.get("/api/ia/prompts?nom=resume_neutre")).json();
  promptId = prompts.elements[0].id;
  // Une exécution d'agent exige un prompt évalué (0265) : jeu d'essai et évaluation réussie
  // sur un vrai fournisseur (aucun réglage d'évaluation locale hors API).
  await proprietaire(async (c) => {
    const jeu = await c.query(
      `INSERT INTO agents_jeux_essai (cabinet_id, prompt_nom, version, cas, auteur_id)
       VALUES ($1, 'resume_neutre', 1,
         '[{"code": "base", "variables": {"texte": "x"}, "chiffres": [],
            "attendu": {"contient": ["x"], "ne_contient_pas": [], "champs": {},
                        "sans_chiffres_non_verifies": true}}]', $2) RETURNING id`,
      [a.cabinetId, a.associeId],
    );
    await c.query(
      `INSERT INTO agents_evaluations (cabinet_id, jeu_id, prompt_id, modele, fournisseur, cas_total,
         cas_reussis, regressions, reussie, resultats, lance_par)
       VALUES ($1, $2, $3, 'anthropic/claude-sonnet-4.5', 'openrouter', 1, 1, 0, true, '[]', $4)`,
      [a.cabinetId, jeu.rows[0].id, promptId, a.associeId],
    );
  });
});

afterAll(async () => {
  await ctx.fermer();
});

describe("déclaration d'une brique", () => {
  const corps = {
    brique_code: "rapport.avancement",
    agent_code: "pmo",
    classe_risque: "R1",
    niveau_max: "N3",
  };

  it("401, 403 sans agent.gerer, 400 N4 hors R0", async () => {
    expect((await api(ctx).post("/api/agents/briques", corps)).statusCode).toBe(401);
    expect((await consultant.post("/api/agents/briques", corps)).statusCode).toBe(403);
    const n4 = await expert.post("/api/agents/briques", { ...corps, niveau_max: "N4" });
    expect(n4.statusCode).toBe(400);
  });

  it("l'expert métier confie la brique ; niveau initial N2, effectif N2", async () => {
    const r = attendre(201, await expert.post("/api/agents/briques", corps));
    expect(r.json()).toMatchObject({
      code: "rapport.avancement",
      niveau_max: "N3",
      niveau_accorde: "N2",
      autonomie: { niveau_effectif: "N2", plafond: "N3", raisons: [], coupe_circuit_n4: false },
      agent: { code: "pmo" },
    });
    const double = await expert.post("/api/agents/briques", corps);
    expect(double.statusCode).toBe(409);
    expect(double.json().erreur.code).toBe("BRIQUE_EXISTE");
    const plafond = await expert.post("/api/agents/briques", {
      ...corps,
      brique_code: "section.analyse",
      agent_code: "redacteur",
    });
    expect(plafond.statusCode).toBe(409);
    expect(plafond.json().erreur.code).toBe("PLAFOND_AGENT");
  });

  it("isolation : invisible d'un autre cabinet (404) ; liste vide", async () => {
    expect((await b.associe.get("/api/agents/briques/rapport.avancement")).statusCode).toBe(404);
    const liste = attendre(200, await b.associe.get("/api/agents/briques")).json();
    expect(liste.elements).toEqual([]);
    expect(
      (
        await b.associe.post("/api/agents/briques/rapport.avancement/decisions", {
          niveau: "N1",
          motif: "x",
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("éligibilité et décision d'un associé (N2 → N3)", () => {
  it("non éligible sans exécutions : 409 avec les critères manquants", async () => {
    const d = attendre(200, await consultant.get("/api/agents/briques/rapport.avancement")).json();
    expect(d.eligibilite.evaluation).toMatchObject({
      eligible: false,
      decisionRequise: "associe",
      raisons: ["EXECUTIONS_INSUFFISANTES", "TAUX_ACCEPTATION_INSUFFISANT"],
    });
    expect(d.eligibilite).toMatchObject({ niveau_suivant: "N3", criteres_requis: true });
    const r = await a.associe.post("/api/agents/briques/rapport.avancement/decisions", {
      niveau: "N3",
      motif: "Essai",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PROMOTION_NON_ELIGIBLE");
  });

  it("seul un associé décide (autonomie.decider) ; 401 sans session", async () => {
    const corps = { niveau: "N3", motif: "Résultats probants." };
    const url = "/api/agents/briques/rapport.avancement/decisions";
    expect((await api(ctx).post(url, corps)).statusCode).toBe(401);
    expect((await expert.post(url, corps)).statusCode).toBe(403);
    const directeur = await a.avecRoles(["directeur_mission"]);
    expect((await directeur.post(url, corps)).statusCode).toBe(403);
  });

  it("50 exécutions dont 96 % acceptées sans modification majeure : éligible, promue par l'associé", async () => {
    await semerExecutions(a.cabinetId, "rapport.avancement", "pmo", consultant.utilisateurId, {
      acceptee: 48,
      modifiee: 2,
    });
    const d = attendre(200, await consultant.get("/api/agents/briques/rapport.avancement")).json();
    expect(d.eligibilite.statistiques).toMatchObject({
      executions: 50,
      accepteesSansModificationMajeure: 48,
      incidentsMajeursFenetre: 0,
    });
    expect(d.eligibilite.evaluation).toMatchObject({
      eligible: true,
      niveauPropose: "N3",
      tauxAcceptation: 0.96,
    });
    const r = attendre(
      200,
      await a.associe.post("/api/agents/briques/rapport.avancement/decisions", {
        niveau: "N3",
        motif: "Résultats probants sur 50 rapports.",
      }),
    );
    expect(r.json()).toMatchObject({
      niveau_accorde: "N3",
      autonomie: { niveau_effectif: "N3" },
    });
    const h = attendre(200, await consultant.get("/api/agents/briques/rapport.avancement")).json();
    expect(h.historique.evenements[0]).toMatchObject({
      type: "promotion",
      niveau_avant: "N2",
      niveau_apres: "N3",
      auteur_id: a.associeId,
    });
    expect(h.historique.evenements[0].evaluation.eligible).toBe(true);
    // Les exécutions comptent depuis le passage au niveau actuel.
    expect(h.eligibilite.statistiques.executions).toBe(0);
    const inchange = await a.associe.post("/api/agents/briques/rapport.avancement/decisions", {
      niveau: "N3",
      motif: "x",
    });
    expect(inchange.json().erreur.code).toBe("NIVEAU_INCHANGE");
    const journal = await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("SELECT 1 FROM journal_audit WHERE action = 'promotion_autonomie_ia'"),
    );
    expect(journal.rows.length).toBe(1);
  });

  it("la base refuse une promotion en N3 décidée par un non-associé (MPG03) et toute modification", async () => {
    attendre(
      201,
      await expert.post("/api/agents/briques", {
        brique_code: "comite.preparation",
        agent_code: "pmo",
        classe_risque: "R1",
        niveau_max: "N3",
      }),
    );
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO autonomie_evenements (cabinet_id, brique_id, type, niveau_avant, niveau_apres,
             motif, auteur_id)
           SELECT $1, id, 'promotion', 'N2', 'N3', 'Contournement', $2 FROM agents_briques
           WHERE brique_code = 'comite.preparation'`,
          [a.cabinetId, expert.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPG03" });
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE autonomie_evenements SET motif = 'x'"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("incidents et rétrogradation automatique", () => {
  it("401 ; un incident mineur ne change rien", async () => {
    const url = "/api/agents/briques/rapport.avancement/incidents";
    expect((await api(ctx).post(url, { gravite: "mineur", description: "x" })).statusCode).toBe(
      401,
    );
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect((await gestionnaire.post(url, { gravite: "mineur", description: "x" })).statusCode).toBe(
      403,
    );
    const r = attendre(
      201,
      await consultant.post(url, { gravite: "mineur", description: "Coquille dans un rapport." }),
    );
    expect(r.json()).toMatchObject({ retrograde: false, niveau_avant: "N3", niveau_apres: "N3" });
  });

  it("un incident majeur exige agent.gerer ou autonomie.decider (403 sinon)", async () => {
    const r = await consultant.post("/api/agents/briques/rapport.avancement/incidents", {
      gravite: "majeur",
      description: "Signalement abusif.",
    });
    expect(r.statusCode).toBe(403);
    const d = attendre(200, await consultant.get("/api/agents/briques/rapport.avancement")).json();
    expect(d.niveau_accorde).toBe("N3");
  });

  it("un incident majeur ramène N3 à N2 sans décision humaine, journalisé", async () => {
    const r = attendre(
      201,
      await expert.post("/api/agents/briques/rapport.avancement/incidents", {
        gravite: "majeur",
        description: "Jalon contractuel annoncé décalé à tort.",
      }),
    );
    expect(r.json()).toMatchObject({ retrograde: true, niveau_avant: "N3", niveau_apres: "N2" });
    const d = attendre(200, await consultant.get("/api/agents/briques/rapport.avancement")).json();
    expect(d.niveau_accorde).toBe("N2");
    expect(d.historique.evenements[0]).toMatchObject({
      type: "retrogradation_auto",
      auteur_id: null,
      niveau_apres: "N2",
    });
    expect(d.historique.incidents.map((i: { gravite: string }) => i.gravite)).toEqual([
      "majeur",
      "mineur",
    ]);
    expect(d.eligibilite.evaluation.raisons).toContain("INCIDENT_MAJEUR_RECENT");
    const journal = await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        "SELECT utilisateur_id FROM journal_audit WHERE action = 'retrogradation_autonomie_ia'",
      ),
    );
    expect(journal.rows).toEqual([{ utilisateur_id: null }]);
  });

  it("l'associé abaisse librement ; une hausse se fait palier par palier", async () => {
    const r = attendre(
      200,
      await a.associe.post("/api/agents/briques/rapport.avancement/decisions", {
        niveau: "N1",
        motif: "Retour à la suggestion à la demande.",
      }),
    );
    expect(r.json().niveau_accorde).toBe("N1");
    attendre(
      200,
      await a.associe.post("/api/agents/briques/rapport.avancement/decisions", {
        niveau: "N2",
        motif: "Brouillons de nouveau.",
      }),
    );
    const saut = await a.associe.post("/api/agents/briques/comite.preparation/decisions", {
      niveau: "N4",
      motif: "x",
    });
    expect(saut.json().erreur.code).toBe("PROMOTION_PAR_PALIER");
  });
});

describe("N4 et coupe-circuit du cabinet", () => {
  it("une brique R0 atteint N4 sur décision ; le coupe-circuit la ramène à N3", async () => {
    const corpsR0 = {
      brique_code: "relance.questionnaire",
      agent_code: "collecte",
      classe_risque: "R0",
      niveau_max: "N4",
    };
    // Une brique R0 (jusqu'à N4) est déclarée par un associé (route et base, MPG07).
    const refus = await expert.post("/api/agents/briques", corpsR0);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("ACTION_RESERVEE");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO agents_briques (cabinet_id, brique_code, agent_code, classe_risque, niveau_max,
             cree_par) VALUES ($1, 'relance.directe', 'collecte', 'R0', 'N4', $2)`,
          [a.cabinetId, expert.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPG07" });
    attendre(201, await a.associe.post("/api/agents/briques", corpsR0));
    for (const niveau of ["N3", "N4"]) {
      await semerExecutions(
        a.cabinetId,
        "relance.questionnaire",
        "collecte",
        consultant.utilisateurId,
        {
          acceptee: 50,
        },
      );
      attendre(
        200,
        await a.associe.post("/api/agents/briques/relance.questionnaire/decisions", {
          niveau,
          motif: `Passage en ${niveau}.`,
        }),
      );
    }
    let d = attendre(200, await consultant.get("/api/agents/briques/relance.questionnaire")).json();
    expect(d.autonomie).toMatchObject({ niveau_effectif: "N4", raisons: [] });

    const url = "/api/agents/coupe-circuit";
    expect((await api(ctx).put(url, { actif: true, motif: "x" })).statusCode).toBe(401);
    expect((await consultant.put(url, { actif: true, motif: "x" })).statusCode).toBe(403);
    const coupe = attendre(200, await expert.put(url, { actif: true, motif: "Relance erronée." }));
    expect(coupe.json()).toMatchObject({ actif: true, motif: "Relance erronée." });
    d = attendre(200, await consultant.get("/api/agents/briques/relance.questionnaire")).json();
    expect(d.autonomie).toMatchObject({
      niveau_accorde: "N4",
      niveau_effectif: "N3",
      raisons: ["COUPE_CIRCUIT_N4"],
      coupe_circuit_n4: true,
    });
    // Le cabinet B n'est pas coupé.
    expect(attendre(200, await b.associe.get(url)).json().actif).toBe(false);
    // Lever le coupe-circuit revient à l'associé (route et base).
    expect((await expert.put(url, { actif: false, motif: "x" })).statusCode).toBe(403);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO autonomie_coupe_circuit (cabinet_id, actif, motif, auteur_id)
           VALUES ($1, false, 'x', $2)`,
          [a.cabinetId, expert.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPG03" });
    expect((await expert.put(url, { actif: true, motif: "x" })).json().erreur.code).toBe(
      "COUPE_CIRCUIT_INCHANGE",
    );
    attendre(200, await a.associe.put(url, { actif: false, motif: "Cause corrigée." }));
    d = attendre(200, await consultant.get("/api/agents/briques/relance.questionnaire")).json();
    expect(d.autonomie.niveau_effectif).toBe("N4");
  });

  it("un agent désactivé par le cabinet ramène ses briques à N0", async () => {
    attendre(
      200,
      await expert.put("/api/agents/collecte/restriction", { actif: false, motif: "Suspendu." }),
    );
    const d = attendre(
      200,
      await consultant.get("/api/agents/briques/relance.questionnaire"),
    ).json();
    expect(d.autonomie).toMatchObject({ plafond: "N0", niveau_effectif: "N0" });
    attendre(
      200,
      await expert.put("/api/agents/collecte/restriction", { actif: true, motif: "Repris." }),
    );
  });
});

describe("corrections d'audit : éligibilité, plancher de classe, restriction d'un associé", () => {
  it("les exécutions en mode dégradé ne comptent pas pour l'éligibilité", async () => {
    attendre(
      201,
      await expert.post("/api/agents/briques", {
        brique_code: "rapport.degrade",
        agent_code: "pmo",
        classe_risque: "R1",
        niveau_max: "N3",
      }),
    );
    await semerExecutions(
      a.cabinetId,
      "rapport.degrade",
      "pmo",
      consultant.utilisateurId,
      { acceptee: 50 },
      true,
    );
    const d = attendre(200, await consultant.get("/api/agents/briques/rapport.degrade")).json();
    expect(d.eligibilite.statistiques.executions).toBe(0);
    expect(d.eligibilite.evaluation.eligible).toBe(false);
    await semerExecutions(a.cabinetId, "rapport.degrade", "pmo", consultant.utilisateurId, {
      acceptee: 50,
    });
    const e = attendre(200, await consultant.get("/api/agents/briques/rapport.degrade")).json();
    expect(e.eligibilite.statistiques.executions).toBe(50);
    expect(e.eligibilite.evaluation.eligible).toBe(true);
  });

  it("la classe d'une brique n'est jamais sous le plancher de la méthode (409, MPG07)", async () => {
    // « reconstitution_ca » est R2 dans la méthode standard semée (0205).
    const corps = {
      brique_code: "reconstitution_ca",
      agent_code: "analyste",
      classe_risque: "R1",
      niveau_max: "N2",
    };
    const r = await expert.post("/api/agents/briques", corps);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("CLASSE_RISQUE_SOUS_PLANCHER");
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO agents_briques (cabinet_id, brique_code, agent_code, classe_risque, niveau_max,
             cree_par) VALUES ($1, 'reconstitution_ca', 'analyste', 'R1', 'N2', $2)`,
          [a.cabinetId, expert.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPG07" });
    attendre(201, await expert.post("/api/agents/briques", { ...corps, classe_risque: "R3" }));
  });

  it("une restriction posée par un associé n'est levée que par un associé (403, MPG08)", async () => {
    const url = "/api/agents/veille/restriction";
    attendre(200, await a.associe.put(url, { actif: false, motif: "Sources douteuses." }));
    const reactivation = await expert.put(url, { actif: true, motif: "x" });
    expect(reactivation.statusCode).toBe(403);
    expect(reactivation.json().erreur.code).toBe("ACTION_RESERVEE");
    // Plus sévère : admis, mais la référence reste la restriction de l'associé.
    attendre(200, await expert.put(url, { actif: false, niveau_max: "N1", motif: "Plus bas." }));
    expect((await expert.put(url, { actif: true, niveau_max: "N1", motif: "x" })).statusCode).toBe(
      403,
    );
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO agents_restrictions (cabinet_id, agent_code, actif, niveau_max, motif, auteur_id)
           VALUES ($1, 'veille', true, NULL, 'x', $2)`,
          [a.cabinetId, expert.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPG08" });
    attendre(
      200,
      await a.associe.put(url, { actif: true, niveau_max: "N2", motif: "Reprise encadrée." }),
    );
    // Sous le plafond posé par l'associé (N2), l'expert abaisse puis revient, sans le dépasser.
    attendre(200, await expert.put(url, { actif: true, niveau_max: "N1", motif: "Prudence." }));
    attendre(200, await expert.put(url, { actif: true, niveau_max: "N2", motif: "Retour." }));
    expect((await expert.put(url, { actif: true, niveau_max: "N3", motif: "x" })).statusCode).toBe(
      403,
    );
  });
});
