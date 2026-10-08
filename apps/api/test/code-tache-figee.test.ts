import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Migration 0076 : l'identité figée d'une tâche assignée lève MPC02 (et non plus
 * MPT01, code des feuilles de temps figées, 0030).
 */

let ctx: Contexte;
let a: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Code tâche");
});
afterAll(() => ctx.fermer());

describe("code SQLSTATE de la tâche figée", () => {
  it("MPC02 pour une tâche ; MPT01 reste celui des feuilles de temps", async () => {
    const assigne = await a.avecRoles(["consultant"]);
    const r = await a.chef.post("/api/taches-collaboration", {
      titre: "Tâche figée",
      assignee_id: assigne.utilisateurId,
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    await proprietaire(async (c) => {
      await expect(
        c.query("UPDATE taches_collaboration SET cree_par = $2 WHERE id = $1", [
          id,
          assigne.utilisateurId,
        ]),
      ).rejects.toMatchObject({ code: "MPC02" });
      const fonction = (
        await c.query("SELECT prosrc FROM pg_proc WHERE proname = 'controler_tache_collaboration'")
      ).rows[0].prosrc as string;
      expect(fonction).not.toContain("MPT01");
    });
  });
});
