import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actionProposeeSchema,
  reponseCopiloteSchema,
  type ReponseCopilote,
} from "@missionpilot/shared";
import { KPI_ROUGES_PAR_FENETRE } from "../src/copilote/limites.js";
import { type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Copilote (AGT-08), gardes de l'audit de sécurité :
 * - niveau d'autonomie : proposer et confirmer une action modifiante exige N2 ; la LECTURE reste
 *   permise dès N1 ; N0 arrête tout ;
 * - plafond de débit propre à l'outil « KPI au rouge » (une évaluation par mission).
 */

vi.setConfig({ testTimeout: 60_000 });

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Copilote Garde A");
  b = await preparerCabinet(ctx, "Cabinet Copilote Garde B");
}, 120_000);
afterAll(() => ctx.fermer());

const poser = (u: Api, message: string) => u.post("/api/copilote/messages", { message });

async function demander(u: Api, message: string): Promise<ReponseCopilote> {
  const r = await poser(u, message);
  expect(r.statusCode, r.body).toBe(200);
  return reponseCopiloteSchema.parse(r.json());
}

const plafonner = async (c: CabinetMissions, niveau: string | null, actif = true) => {
  const r = await c.associe.put("/api/agents/copilote/restriction", {
    actif,
    niveau_max: niveau,
    motif: "Essai de la garde de niveau",
  });
  expect(r.statusCode, r.body).toBe(200);
};

const taches = (c: CabinetMissions, titre: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query("SELECT id FROM taches_collaboration WHERE cabinet_id = $1 AND titre = $2", [
          c.cabinetId,
          titre,
        ])
      ).rows,
  );

const propositions = (c: CabinetMissions) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query("SELECT count(*)::int AS n FROM copilote_actions WHERE cabinet_id = $1", [
          c.cabinetId,
        ])
      ).rows[0].n as number,
  );

describe("niveau d'autonomie du copilote : N2 pour une action", () => {
  it("par défaut (standard N2) : l'action est proposée puis confirmée", async () => {
    const rep = await demander(a.chef, "Crée une tâche : niveau par défaut");
    expect(rep.statut).toBe("action_proposee");
    const action = actionProposeeSchema.parse(rep.action);
    const r = await a.chef.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(r.statusCode, r.body).toBe(200);
    expect(await taches(a, "Niveau par défaut")).toHaveLength(1);
  });

  it("plafonné à N1 : la lecture reste permise, proposer et confirmer une action : 409", async () => {
    // Une proposition posée AVANT le plafonnement du cabinet.
    const avant = actionProposeeSchema.parse(
      (await demander(a.directeur, "Crée une tâche : posée avant le plafond")).action,
    );
    await plafonner(a, "N1");
    // Lecture : permise.
    expect((await demander(a.chef, "mes tâches")).statut).toBe("ok");
    // Nouvelle proposition : refusée, rien n'est inscrit.
    const compte = await propositions(a);
    const refus = await poser(a.chef, "Crée une tâche : interdite par le cabinet");
    expect(refus.statusCode, refus.body).toBe(409);
    expect(refus.json().erreur.code).toBe("COPILOTE_ACTION_NON_AUTORISEE");
    expect(refus.json().erreur.message).toContain("niveau d'autonomie N2");
    expect(await propositions(a)).toBe(compte);
    // Confirmation d'une proposition antérieure : refusée, rien n'est créé ni décidé.
    const conf = await a.directeur.post(`/api/copilote/actions/${avant.action_id}/confirmer`);
    expect(conf.statusCode, conf.body).toBe(409);
    expect(conf.json().erreur.code).toBe("COPILOTE_ACTION_NON_AUTORISEE");
    expect(await taches(a, "Posée avant le plafond")).toHaveLength(0);
    const etat = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT statut FROM copilote_actions WHERE id = $1", [avant.action_id]))
          .rows[0].statut as string,
    );
    expect(etat).toBe("proposee");
    // L'autre cabinet n'est pas touché.
    expect((await demander(b.chef, "Crée une tâche : cabinet B libre")).statut).toBe(
      "action_proposee",
    );
    // Cabinet rétabli : la même proposition (non expirée) peut être confirmée.
    await plafonner(a, null);
    const ok = await a.directeur.post(`/api/copilote/actions/${avant.action_id}/confirmer`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await taches(a, "Posée avant le plafond")).toHaveLength(1);
  });

  it("plafonné à N1, l'annulation d'une proposition reste possible", async () => {
    const action = actionProposeeSchema.parse(
      (await demander(a.chef, "Crée une tâche : à annuler sous plafond")).action,
    );
    await plafonner(a, "N1");
    const r = await a.chef.post(`/api/copilote/actions/${action.action_id}/annuler`);
    expect(r.statusCode, r.body).toBe(200);
    await plafonner(a, null);
  });

  it("plafonné à N0 ou désactivé : le copilote s'arrête, confirmation comprise (409)", async () => {
    const action = actionProposeeSchema.parse(
      (await demander(a.chef, "Crée une tâche : avant la coupure")).action,
    );
    await plafonner(a, null, false);
    const lecture = await poser(a.chef, "mes tâches");
    expect(lecture.statusCode).toBe(409);
    expect(lecture.json().erreur.code).toBe("COPILOTE_DESACTIVE");
    const conf = await a.chef.post(`/api/copilote/actions/${action.action_id}/confirmer`);
    expect(conf.statusCode, conf.body).toBe(409);
    expect(conf.json().erreur.code).toBe("COPILOTE_DESACTIVE");
    expect(await taches(a, "Avant la coupure")).toHaveLength(0);
    await plafonner(a, null, true);
  });
});

describe("plafond de débit de l'outil « KPI au rouge »", () => {
  it(`au plus ${KPI_ROUGES_PAR_FENETRE} demandes par 10 minutes et par utilisateur : message clair, pas d'erreur`, async () => {
    const u = await a.avecRoles(["chef_mission"]);
    const autre = await a.avecRoles(["chef_mission"]);
    for (let i = 0; i < KPI_ROUGES_PAR_FENETRE; i += 1) {
      const r = await demander(u, "kpi au rouge");
      expect(r.outil).toBe("kpi_rouges");
      expect(r.statut).toBe("ok");
    }
    const limite = await poser(u, "Quels KPI sont au rouge ?");
    expect(limite.statusCode, limite.body).toBe(200);
    const rep = reponseCopiloteSchema.parse(limite.json());
    expect(rep).toMatchObject({ outil: "kpi_rouges", statut: "refuse", elements: [] });
    expect(rep.texte).toContain("réessayez plus tard");
    // Une autre lecture n'est pas touchée, ni un autre utilisateur.
    expect((await demander(u, "mes tâches")).statut).toBe("ok");
    expect((await demander(autre, "kpi au rouge")).statut).toBe("ok");
    const comptes = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT count(*)::int AS n FROM journal_audit WHERE utilisateur_id = $1 AND action = 'copilote.kpi_rouges'",
            [u.utilisateurId],
          )
        ).rows[0].n as number,
    );
    expect(comptes).toBe(KPI_ROUGES_PAR_FENETRE);
    // Hors fenêtre (plus de 10 minutes) : les demandes ne comptent plus.
    await proprietaire((cl) =>
      cl.query(
        `UPDATE journal_audit SET cree_le = now() - interval '11 minutes'
         WHERE utilisateur_id = $1 AND action = 'copilote.kpi_rouges'`,
        [u.utilisateurId],
      ),
    );
    expect((await demander(u, "kpi au rouge")).statut).toBe("ok");
  });
});
