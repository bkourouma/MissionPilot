import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@missionpilot/shared";
import { api, type Api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  TOUS_LES_ROLES,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Tâches A");
  b = await preparerCabinet(ctx, "Cabinet Tâches B");
  consultant = await a.avecRoles(["consultant"]);
});
afterAll(() => ctx.fermer());

const URL = "/api/taches-collaboration";
const creer = (par: Api, corps: Record<string, unknown>) => par.post(URL, corps);

async function tache(par: Api, corps: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await creer(par, corps);
  if (r.statusCode !== 201) throw new Error(`${r.statusCode} ${r.body}`);
  return r.json();
}

async function notifications(par: Api, type: string) {
  const els = (await par.get("/api/notifications?limite=100")).json().elements as {
    type: string;
    titre: string;
    lien: string;
  }[];
  return els.filter((n) => n.type === type);
}

describe("tâches assignées (SOC-08)", () => {
  it("création, notification de l'assigné, « mes tâches » paginées (ouvertes d'abord, par échéance)", async () => {
    const assigne = await a.avecRoles(["consultant"]);
    const t1 = await tache(a.chef, {
      titre: "Relire le rapport",
      assignee_id: assigne.utilisateurId,
      echeance: "2026-10-20",
    });
    expect(t1).toMatchObject({
      statut: "a_faire",
      assignee_id: assigne.utilisateurId,
      cree_par: a.chef.utilisateurId,
      echeance: "2026-10-20",
      fait_le: null,
      entite_type: null,
    });
    await tache(a.chef, { titre: "Sans échéance", assignee_id: assigne.utilisateurId });
    await tache(a.directeur, {
      titre: "Urgent",
      assignee_id: assigne.utilisateurId,
      echeance: "2026-10-10",
    });
    const recues = await notifications(assigne, "tache_assignee");
    expect(recues).toHaveLength(3);
    expect(recues[0]?.lien).toBe("/mes-taches");
    const p1 = (await assigne.get(`${URL}?limite=2`)).json();
    expect(p1.elements.map((t: { titre: string }) => t.titre)).toEqual([
      "Urgent",
      "Relire le rapport",
    ]);
    const p2 = (await assigne.get(`${URL}?limite=2&curseur=${p1.curseur_suivant}`)).json();
    expect(p2.elements.map((t: { titre: string }) => t.titre)).toEqual(["Sans échéance"]);
    expect(p2.curseur_suivant).toBeNull();
    const creees = (await a.chef.get(`${URL}?vue=creees`)).json().elements;
    expect(creees.every((t: { cree_par: string }) => t.cree_par === a.chef.utilisateurId)).toBe(
      true,
    );
  });

  it("assigné : actif et du même cabinet ; sinon 400", async () => {
    const parti = await a.avecRoles(["consultant"]);
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [parti.utilisateurId]),
    );
    expect((await creer(a.chef, { titre: "x", assignee_id: parti.utilisateurId })).statusCode).toBe(
      400,
    );
    const ailleurs = await b.avecRoles(["consultant"]);
    expect(
      (await creer(a.chef, { titre: "x", assignee_id: ailleurs.utilisateurId })).statusCode,
    ).toBe(400);
    expect(
      (
        await creer(a.chef, {
          titre: "x",
          assignee_id: consultant.utilisateurId,
          echeance: "2101-01-01",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await creer(a.chef, { titre: "", assignee_id: consultant.utilisateurId })).statusCode,
    ).toBe(400);
  });

  it("droits : « tache.assigner » pour créer (matrice des 8 rôles) ; 401 sans session", async () => {
    const assignent = [
      "associe",
      "directeur_mission",
      "chef_mission",
      "ressources",
      "gestionnaire",
    ];
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role as Role]);
      const r = await creer(u, { titre: `Par ${role}`, assignee_id: consultant.utilisateurId });
      expect(r.statusCode, role).toBe(assignent.includes(role) ? 201 : 403);
    }
    expect(
      (await creer(api(ctx), { titre: "x", assignee_id: consultant.utilisateurId })).statusCode,
    ).toBe(401);
    expect((await api(ctx).get(URL)).statusCode).toBe(401);
  });

  it("l'assigné ne modifie que le statut ; le créateur modifie tout ; un tiers → 404", async () => {
    const assigne = await a.avecRoles(["consultant"]);
    const t = await tache(a.chef, {
      titre: "Préparer l'atelier",
      assignee_id: assigne.utilisateurId,
    });
    const url = `${URL}/${t.id}`;
    expect((await assigne.patch(url, { titre: "Autre" })).statusCode).toBe(403);
    expect((await assigne.patch(url, { statut: "en_cours" })).json().statut).toBe("en_cours");
    const fait = (await assigne.patch(url, { statut: "fait" })).json();
    expect(fait.fait_le).not.toBeNull();
    // Le créateur est prévenu quand la tâche est faite.
    expect(
      (await notifications(a.chef, "tache_faite")).some((n) => n.titre.includes("atelier")),
    ).toBe(true);
    expect((await a.chef.patch(url, { statut: "a_faire" })).json().fait_le).toBeNull();
    expect(
      (await a.chef.patch(url, { titre: "Préparer l'atelier v2", echeance: null })).json().titre,
    ).toBe("Préparer l'atelier v2");
    const tiers = await a.avecRoles(["chef_mission"]);
    expect((await tiers.get(url)).statusCode).toBe(404);
    expect((await tiers.patch(url, { statut: "fait" })).statusCode).toBe(404);
    expect((await a.associe.get(url)).statusCode).toBe(404);
    expect((await a.chef.patch(url, {})).statusCode).toBe(400);
    // Réassignation : le nouvel assigné est notifié, l'ancien perd l'accès.
    const nouveau = await a.avecRoles(["consultant"]);
    expect((await a.chef.patch(url, { assignee_id: nouveau.utilisateurId })).statusCode).toBe(200);
    expect(await notifications(nouveau, "tache_assignee")).toHaveLength(1);
    expect((await assigne.get(url)).statusCode).toBe(404);
  });

  it("entité liée : visible du créateur ET de l'assigné ; sinon 404 / 400", async () => {
    const m = (await creerMission(a)).id;
    const membre = await a.avecRoles(["consultant"]);
    await a.chef.post(`/api/missions/${m}/equipe`, { utilisateur_id: membre.utilisateurId });
    const lie = await tache(a.chef, {
      titre: "Relire le diagnostic",
      assignee_id: membre.utilisateurId,
      entite_type: "mission",
      entite_id: m,
    });
    expect(lie).toMatchObject({ entite_type: "mission", entite_id: m, mission_id: m });
    // L'assigné ne voit pas la mission : refus.
    expect(
      (
        await creer(a.chef, {
          titre: "x",
          assignee_id: consultant.utilisateurId,
          entite_type: "mission",
          entite_id: m,
        })
      ).statusCode,
    ).toBe(400);
    // Le créateur ne voit pas l'entité (autre cabinet) : 404.
    const mb = (await creerMission(b)).id;
    expect(
      (
        await creer(a.chef, {
          titre: "x",
          assignee_id: membre.utilisateurId,
          entite_type: "mission",
          entite_id: mb,
        })
      ).statusCode,
    ).toBe(404);
    // Réassigner à quelqu'un qui ne voit pas l'entité : refus.
    expect(
      (await a.chef.patch(`${URL}/${lie.id}`, { assignee_id: consultant.utilisateurId }))
        .statusCode,
    ).toBe(400);
  });

  it("isolation : tâche d'un autre cabinet → 404 par identifiant ; jamais de DELETE", async () => {
    const assigneB = await b.avecRoles(["consultant"]);
    const t = await tache(b.chef, { titre: "Interne B", assignee_id: assigneB.utilisateurId });
    expect((await a.associe.get(`${URL}/${t.id}`)).statusCode).toBe(404);
    expect((await a.associe.patch(`${URL}/${t.id}`, { statut: "fait" })).statusCode).toBe(404);
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query("DELETE FROM taches_collaboration WHERE id = $1", [t.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query("UPDATE taches_collaboration SET cree_par = $2 WHERE id = $1", [
          t.id,
          assigneB.utilisateurId,
        ]),
      ),
    ).rejects.toThrow(/figée/);
  });
});
