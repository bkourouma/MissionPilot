import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Documents A");
  b = await preparerCabinet(ctx, "Cabinet Documents B");
});
afterAll(() => ctx.fermer());

describe("documents de mission (SOC-05)", () => {
  it("versionnage par incrément, dernière version par défaut, historique sur demande", async () => {
    const { id } = await creerMission(a);
    const url = `/api/missions/${id}/documents`;
    const deposer = (corps: Record<string, unknown>) => a.chef.post(url, corps);
    const v1 = await deposer({ type: "livrable", nom: "Rapport de diagnostic" });
    expect(v1.statusCode).toBe(201);
    expect(v1.json()).toMatchObject({
      version: 1,
      auteur_id: a.chef.utilisateurId,
      chemin_stockage: null,
    });
    const v2 = await deposer({
      type: "livrable",
      nom: "Rapport de diagnostic",
      chemin_stockage: "missions/rapport-v2.pdf",
    });
    expect(v2.json()).toMatchObject({ version: 2, chemin_stockage: "missions/rapport-v2.pdf" });
    expect(
      (await deposer({ type: "proposition", nom: "Rapport de diagnostic" })).json().version,
    ).toBe(1);

    const derniers = (await a.chef.get(url)).json().elements;
    expect(derniers.map((d: { type: string; version: number }) => [d.type, d.version])).toEqual([
      ["livrable", 2],
      ["proposition", 1],
    ]);
    const historique = (await a.chef.get(`${url}?historique=true&type=livrable`)).json().elements;
    expect(historique.map((d: { version: number }) => d.version)).toEqual([2, 1]);
  });

  it("valide le type et le nom ; historique non modifiable en base", async () => {
    const { id } = await creerMission(a);
    const url = `/api/missions/${id}/documents`;
    expect((await a.chef.post(url, { type: "facture", nom: "X" })).statusCode).toBe(400);
    expect((await a.chef.post(url, { type: "autre", nom: "" })).statusCode).toBe(400);
    const doc = (await a.chef.post(url, { type: "autre", nom: "Note" })).json();
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE mission_documents SET nom = 'x' WHERE id = $1", [doc.id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("droits : un consultant de l'équipe dépose ; l'expert externe et un non-membre non", async () => {
    const { id } = await creerMission(a);
    const url = `/api/missions/${id}/documents`;
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.post(url, { type: "livrable", nom: "L" })).statusCode).toBe(404);
    await a.chef.post(`/api/missions/${id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    expect((await consultant.post(url, { type: "livrable", nom: "L" })).statusCode).toBe(201);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.post(url, { type: "livrable", nom: "L" })).statusCode).toBe(403);
    expect((await externe.get(url)).statusCode).toBe(403);
    const ressources = await a.avecRoles(["ressources"]);
    expect((await ressources.get(url)).statusCode).toBe(200);
    expect((await ressources.post(url, { type: "livrable", nom: "L" })).statusCode).toBe(403);
  });

  it("isolation : documents d'une mission d'un autre cabinet → 404", async () => {
    const { id } = await creerMission(b);
    await b.chef.post(`/api/missions/${id}/documents`, { type: "autre", nom: "Secret" });
    expect((await a.associe.get(`/api/missions/${id}/documents`)).statusCode).toBe(404);
    expect(
      (await a.associe.post(`/api/missions/${id}/documents`, { type: "autre", nom: "Secret" }))
        .statusCode,
    ).toBe(404);
  });
});
