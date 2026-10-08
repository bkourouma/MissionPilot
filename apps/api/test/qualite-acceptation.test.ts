import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, cabinetTest } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre, preparerQualite, type ScenarioQualite } from "./qualite-outils.js";

/*
 * Acceptation de mission (QUA-07) : relations déclarées entre clients, conflits calculés par le
 * serveur, profil de risque (niveau jamais abaissé), décision motivée, historique en ajout seul.
 */

let ctx: Contexte;
let s: ScenarioQualite;
let clientConcurrent: string;
let relationId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQualite(ctx, "Cabinet Acceptation");
  const c = await s.c.associe.post("/api/clients", { raison_sociale: "Concurrent SA" });
  attendre(201, c, "client");
  clientConcurrent = c.json().id;
});
afterAll(async () => {
  await ctx.fermer();
});

describe("relations entre clients", () => {
  it("exige qualite.signer pour déclarer et retirer", async () => {
    const corps = {
      client_id: s.c.clientId,
      client_lie_id: clientConcurrent,
      nature: "concurrent",
    };
    expect((await api(ctx).post("/api/qualite/relations-clients", corps)).statusCode).toBe(401);
    expect((await s.c.chef.post("/api/qualite/relations-clients", corps)).statusCode).toBe(403);
    const ok = await s.c.directeur.post("/api/qualite/relations-clients", corps);
    expect(ok.statusCode).toBe(201);
    relationId = ok.json().id;
    expect(ok.json()).toMatchObject({ nature: "concurrent", client_lie_nom: "Concurrent SA" });
  });

  it("refuse le doublon, le sens inverse et le lien d'un client à lui-même", async () => {
    const dir = s.c.directeur;
    const corps = {
      client_id: s.c.clientId,
      client_lie_id: clientConcurrent,
      nature: "concurrent",
    };
    expect((await dir.post("/api/qualite/relations-clients", corps)).statusCode).toBe(409);
    const inverse = await dir.post("/api/qualite/relations-clients", {
      client_id: clientConcurrent,
      client_lie_id: s.c.clientId,
      nature: "concurrent",
    });
    expect(inverse.statusCode).toBe(409);
    expect(inverse.json().erreur.code).toBe("RELATION_EN_DOUBLE");
    const soi = await dir.post("/api/qualite/relations-clients", {
      client_id: s.c.clientId,
      client_lie_id: s.c.clientId,
      nature: "meme_groupe",
    });
    expect(soi.statusCode).toBe(400);
    const inconnu = await dir.post("/api/qualite/relations-clients", {
      client_id: s.c.clientId,
      client_lie_id: "00000000-0000-4000-8000-000000000000",
      nature: "meme_groupe",
    });
    expect(inconnu.statusCode).toBe(400);
  });

  it("liste les relations d'un client (dans les deux sens)", async () => {
    const r = await s.c.chef.get(`/api/qualite/relations-clients?client_id=${clientConcurrent}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().elements).toHaveLength(1);
    expect((await s.consultant.get("/api/qualite/relations-clients")).statusCode).toBe(403);
  });
});

describe("évaluation de l'acceptation", () => {
  let missionConcurrent: string;

  beforeAll(async () => {
    missionConcurrent = (await creerMission(s.c, { client_id: clientConcurrent })).id as string;
  });

  it("calcule les conflits côté serveur : concurrent déclaré avec une mission en cours", async () => {
    const r = await s.c.chef.get(`/api/qualite/missions/${s.missionId}/acceptation`);
    expect(r.statusCode).toBe(200);
    expect(r.json().derniere).toBeNull();
    expect(r.json().conflits_actuels).toEqual([
      expect.objectContaining({
        nature: "concurrent",
        client_lie_nom: "Concurrent SA",
        missions_en_cours: 1,
      }),
    ]);
    // Le conflit ne révèle pas l'intitulé des missions du client lié.
    expect(JSON.stringify(r.json())).not.toContain("Plan stratégique 2027-2031");
    expect(missionConcurrent).toBeTruthy();
  });

  it("une simple évaluation en attente suffit à qualite.relire ; décider exige qualite.signer", async () => {
    const attente = await s.c.chef.post(`/api/qualite/missions/${s.missionId}/acceptation`, {
      decision: "en_attente",
      facteurs: ["secteur_reglemente"],
    });
    expect(attente.statusCode).toBe(200);
    expect(attente.json().derniere).toMatchObject({
      decision: "en_attente",
      niveau_risque: "moyen",
      rang: 1,
    });
    const decide = await s.c.chef.post(`/api/qualite/missions/${s.missionId}/acceptation`, {
      decision: "acceptee",
      motif: "ok",
    });
    expect(decide.statusCode).toBe(403);
  });

  it("exige un motif pour accepter malgré un conflit, pour refuser et pour conditionner", async () => {
    const dir = s.c.directeur;
    const url = `/api/qualite/missions/${s.missionId}/acceptation`;
    const sansMotif = await dir.post(url, { decision: "acceptee" });
    expect(sansMotif.statusCode).toBe(409);
    expect(sansMotif.json().erreur.code).toBe("MOTIF_CONFLIT_REQUIS");
    expect((await dir.post(url, { decision: "refusee" })).statusCode).toBe(400);
    expect((await dir.post(url, { decision: "acceptee_sous_conditions" })).statusCode).toBe(400);
  });

  it("le niveau retenu ne descend pas sous celui des facteurs ; décision enregistrée en ajout seul", async () => {
    const dir = s.c.directeur;
    const url = `/api/qualite/missions/${s.missionId}/acceptation`;
    const bas = await dir.post(url, {
      decision: "acceptee",
      motif: "Muraille de Chine en place",
      facteurs: ["pays_a_risque", "gouvernance_opaque"],
      niveau_retenu: "faible",
    });
    expect(bas.statusCode).toBe(400);
    const ok = await dir.post(url, {
      decision: "acceptee_sous_conditions",
      motif: "Équipes séparées et accord écrit du client",
      facteurs: ["pays_a_risque", "gouvernance_opaque"],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().derniere).toMatchObject({
      rang: 2,
      decision: "acceptee_sous_conditions",
      niveau_risque: "eleve",
    });
    expect(ok.json().derniere.conflits).toHaveLength(1);
    expect(ok.json().historique).toHaveLength(2);
    expect(ok.json().derniere.profil_risque.facteurs).toEqual([
      "pays_a_risque",
      "gouvernance_opaque",
    ]);
  });

  it("ne sert que les missions visibles et le bon cabinet (404)", async () => {
    expect(
      (await s.etranger.get(`/api/qualite/missions/${s.missionId}/acceptation`)).statusCode,
    ).toBe(404);
    const autre = await cabinetTest(ctx, "Autre cabinet acceptation");
    expect(
      (await autre.associe.get(`/api/qualite/missions/${s.missionId}/acceptation`)).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx).get(`/api/qualite/missions/${s.missionId}/acceptation`)).statusCode,
    ).toBe(401);
    expect(
      (await s.consultant.get(`/api/qualite/missions/${s.missionId}/acceptation`)).statusCode,
    ).toBe(403);
  });

  it("un client lié d'un autre cabinet n'est pas déclarable", async () => {
    const autre = await cabinetTest(ctx, "Cabinet tiers");
    const c = await autre.associe.post("/api/clients", { raison_sociale: "Tiers SA" });
    const r = await s.c.directeur.post("/api/qualite/relations-clients", {
      client_id: s.c.clientId,
      client_lie_id: c.json().id,
      nature: "meme_groupe",
    });
    expect(r.statusCode).toBe(400);
  });

  it("retire une relation : le conflit disparaît (journalisé)", async () => {
    expect((await s.c.chef.delete(`/api/qualite/relations-clients/${relationId}`)).statusCode).toBe(
      403,
    );
    expect(
      (await s.c.directeur.delete(`/api/qualite/relations-clients/${relationId}`)).statusCode,
    ).toBe(204);
    expect(
      (await s.c.directeur.delete(`/api/qualite/relations-clients/${relationId}`)).statusCode,
    ).toBe(404);
    const r = await s.c.chef.get(`/api/qualite/missions/${s.missionId}/acceptation`);
    expect(r.json().conflits_actuels).toHaveLength(0);
    // Le dernier état reste tel qu'il a été évalué (les conflits sont figés dans la ligne).
    expect(r.json().derniere.conflits).toHaveLength(1);
  });
});
