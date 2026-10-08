import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENTS_STANDARD, OUTILS_AGENT } from "@missionpilot/shared";
import { CHAMPS_ACTION_INTERDITS, contratSortieAgent } from "../src/ia/sortie-agent.js";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Registre des agents (AGT-01, migration 0260) : 14 agents standard en lecture
 * seule, restriction par cabinet (ajout seul, ne peut que restreindre),
 * isolation entre cabinets.
 */

let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Cabinet A agents");
  b = await cabinetTest(ctx, "Cabinet B agents");
});

afterAll(async () => {
  await ctx.fermer();
});

describe("registre des agents", () => {
  it("401 sans session, 403 sans agent.lire", async () => {
    expect((await api(ctx).get("/api/agents")).statusCode).toBe(401);
    expect((await api(ctx).get("/api/agents/analyste")).statusCode).toBe(401);
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect((await gestionnaire.get("/api/agents")).statusCode).toBe(403);
    expect((await gestionnaire.get("/api/agents/analyste")).statusCode).toBe(403);
  });

  it("sert les 14 agents du standard, avec mission, outils, droits et niveau maximal", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    const r = await consultant.get("/api/agents");
    expect(r.statusCode).toBe(200);
    const agents = r.json().elements as Record<string, unknown>[];
    expect(agents.map((x) => x.code).sort()).toEqual([...AGENTS_STANDARD].sort());
    for (const x of agents) {
      expect(x.actif).toBe(true);
      expect(typeof x.mission).toBe("string");
      expect(typeof x.ne_fait_jamais).toBe("string");
      expect((x.outils_autorises as string[]).every((o) => OUTILS_AGENT.includes(o as never))).toBe(
        true,
      );
      expect(x.niveau_max).toBe(x.niveau_max_standard);
      // AGT-02 / AGT-07 : un contrat de sortie ne porte aucun champ de commande.
      const contrat = contratSortieAgent(x.schema_sortie);
      if (contrat.type === "objet") {
        expect(Object.keys(contrat.champs).some((c) => CHAMPS_ACTION_INTERDITS.includes(c))).toBe(
          false,
        );
      }
    }
    const redacteur = agents.find((x) => x.code === "redacteur")!;
    expect(redacteur.ne_fait_jamais).toMatch(/chiffre non fourni par un moteur/);
    // Seules les briques R0 (relances, accusés de réception) vont jusqu'à N4.
    expect(
      agents
        .filter((x) => x.niveau_max === "N4")
        .map((x) => x.code)
        .sort(),
    ).toEqual(["collecte", "documentaire"]);
  });

  it("détaille un agent avec le modèle routé par tâche (AGT-06) ; 404 pour un code inconnu", async () => {
    const r = await a.associe.get("/api/agents/documentaire");
    expect(r.statusCode).toBe(200);
    expect(r.json().modeles).toEqual([
      { tache: "classification", modele: "google/gemini-2.5-flash" },
      { tache: "extraction", modele: "google/gemini-2.5-flash" },
    ]);
    expect((await a.associe.get("/api/agents/inconnu")).statusCode).toBe(404);
    expect((await a.associe.get("/api/agents/Mauvais-Code")).statusCode).toBe(400);
  });

  it("le registre standard est en lecture seule pour le rôle applicatif", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE agents_registre SET nom = 'x' WHERE code = 'analyste'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO agents_registre (code, version, nom, mission, ne_fait_jamais, entrees,
             outils_autorises, droits, briques, taches, niveau_max, schema_sortie, lit_contenu_client)
           VALUES ('pirate', 1, 'x', 'x', 'x', '{x}', '{}', '{}', '{}', '{redaction}', 'N4',
             '{"type":"texte"}', false)`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    // Même le propriétaire ne modifie pas une version publiée (ajout seul, MPG01).
    await expect(
      proprietaire((c) => c.query("UPDATE agents_registre SET nom = 'x' WHERE code = 'analyste'")),
    ).rejects.toMatchObject({ code: "MPG01" });
  });
});

describe("restriction d'un agent par le cabinet", () => {
  it("401, 403 sans agent.gerer, 400 corps invalide", async () => {
    const corps = { actif: false, motif: "Pas d'usage." };
    expect((await api(ctx).put("/api/agents/veille/restriction", corps)).statusCode).toBe(401);
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.put("/api/agents/veille/restriction", corps)).statusCode).toBe(403);
    expect(
      (await a.associe.put("/api/agents/veille/restriction", { actif: false })).statusCode,
    ).toBe(400);
  });

  it("un expert métier désactive ou abaisse un agent ; jamais au-delà du standard", async () => {
    const expert = await a.avecRoles(["expert_metier"]);
    const r = await expert.put("/api/agents/veille/restriction", {
      actif: true,
      niveau_max: "N1",
      motif: "Prudence au démarrage.",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ niveau_max: "N1", niveau_max_cabinet: "N1", actif: true });
    expect(r.json().restriction.motif).toBe("Prudence au démarrage.");

    const trop = await expert.put("/api/agents/redacteur/restriction", {
      actif: true,
      niveau_max: "N4",
      motif: "Plus d'autonomie.",
    });
    expect(trop.statusCode).toBe(409);
    expect(trop.json().erreur.code).toBe("PLAFOND_AGENT");

    const off = await expert.put("/api/agents/veille/restriction", {
      actif: false,
      motif: "Agent non utilisé.",
    });
    expect(off.json()).toMatchObject({ actif: false, niveau_max: "N0" });

    // Le cabinet B n'est pas touché.
    const vuB = await b.associe.get("/api/agents/veille");
    expect(vuB.json()).toMatchObject({ actif: true, niveau_max: "N3", restriction: null });

    // Ajout seul : la restriction ne se modifie pas.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE agents_restrictions SET actif = true"),
      ),
    ).rejects.toThrow(/permission denied/);
    const journal = await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("SELECT details FROM journal_audit WHERE action = 'restriction_agent_ia'"),
    );
    expect(journal.rows.length).toBe(2);
  });

  it("la base refuse une restriction au-delà du standard même hors API (MPG02)", async () => {
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO agents_restrictions (cabinet_id, agent_code, actif, niveau_max, motif, auteur_id)
           VALUES ($1, 'redacteur', true, 'N3', 'x', $2)`,
          [a.cabinetId, a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPG02" });
  });
});
