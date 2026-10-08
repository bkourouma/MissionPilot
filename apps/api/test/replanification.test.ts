import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MailerJournal } from "../src/notifications/mailer.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Replanification A");
  b = await preparerCabinet(ctx, "Cabinet Replanification B");
});
afterAll(() => ctx.fermer());

interface Montage {
  id: string;
  p1: string;
  p2: string;
  t1: string;
  t2: string;
  affT2: string;
  consultant: Awaited<ReturnType<typeof utilisateurCollaborateur>>;
}

/**
 * Mission du 2026-11-02 au 2027-01-29 : P1/T1 (5 j, 02→06/11) puis P2/T2
 * (5 j, dépend de T1 : 09→13/11). Le consultant est affecté à T2 du 09 au 13.
 */
async function monter(
  c: CabinetMissions = a,
  corps: Record<string, unknown> = {},
): Promise<Montage> {
  const m = await creerMission(c, { type_mission_id: null, mode_facturation: "regie", ...corps });
  const post = async (chemin: string, corps: Record<string, unknown>) => {
    const r = await c.chef.post(`/api/missions/${m.id}/${chemin}`, corps);
    expect(r.statusCode, `${chemin} ${r.body}`).toBe(201);
    return r.json();
  };
  const p1 = await post("phases", { libelle: "Diagnostic", ordre: 1 });
  const p2 = await post("phases", { libelle: "Stratégie", ordre: 2 });
  const t1 = await post("taches", {
    parent_id: p1.id,
    libelle: "Entretiens",
    duree_jours_ouvres: 5,
  });
  const t2 = await post("taches", { parent_id: p2.id, libelle: "Atelier", duree_jours_ouvres: 5 });
  await post("dependances", { predecesseur_id: t1.id, successeur_id: t2.id });
  await c.chef.put(`/api/missions/${m.id}/taches/${t2.id}/budget`, {
    lignes: [{ grade_id: c.grades.senior, jours: 5 }],
  });
  const consultant = await utilisateurCollaborateur(c, ["consultant"]);
  const aff = await post("affectations", {
    tache_id: t2.id,
    collaborateur_id: consultant.collaborateurId,
    jours_alloues: 3,
    date_debut: "2026-11-09",
    date_fin: "2026-11-13",
  });
  return {
    id: m.id,
    p1: p1.id,
    p2: p2.id,
    t1: t1.id,
    t2: t2.id,
    affT2: aff.affectation.id,
    consultant,
  };
}

const datesTache = async (missionId: string, tacheId: string) => {
  const planning = (await a.chef.get(`/api/missions/${missionId}/planning`)).json();
  const t = planning.taches.find((x: { id: string }) => x.id === tacheId);
  return { debut: t.debut as string, fin: t.fin as string };
};

describe("re-planification (PLN-09)", () => {
  it("aperçu : calcule sans rien écrire ni notifier", async () => {
    const m = await monter();
    const r = await a.chef.post(`/api/missions/${m.id}/replanifier?apercu=true`, {
      phase_id: m.p1,
      decalage_jours_ouvres: 5,
    });
    expect(r.statusCode, r.body).toBe(200);
    const corps = r.json();
    expect(corps.apercu).toBe(true);
    expect(corps.taches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: m.t1,
          avant: { debut: "2026-11-02", fin: "2026-11-06" },
          apres: { debut: "2026-11-09", fin: "2026-11-13" },
        }),
        expect.objectContaining({
          id: m.t2,
          avant: { debut: "2026-11-09", fin: "2026-11-13" },
          apres: { debut: "2026-11-16", fin: "2026-11-20" },
        }),
      ]),
    );
    expect(corps.affectations).toEqual([
      expect.objectContaining({
        id: m.affT2,
        avant: { debut: "2026-11-09", fin: "2026-11-13" },
        apres: { debut: "2026-11-16", fin: "2026-11-20" },
      }),
    ]);
    expect(corps.personnes).toEqual([
      expect.objectContaining({
        collaborateur_id: m.consultant.collaborateurId,
        utilisateur_id: m.consultant.utilisateurId,
      }),
    ]);
    expect(await datesTache(m.id, m.t2)).toEqual({ debut: "2026-11-09", fin: "2026-11-13" });
    expect((await m.consultant.get("/api/notifications")).json().elements).toEqual([]);
  });

  it("écrit les dates des tâches et des affectations, et prévient les personnes concernées", async () => {
    const m = await monter();
    const r = await a.chef.post(`/api/missions/${m.id}/replanifier`, {
      phase_id: m.p1,
      decalage_jours_ouvres: 5,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().apercu).toBe(false);
    expect(await datesTache(m.id, m.t1)).toEqual({ debut: "2026-11-09", fin: "2026-11-13" });
    expect(await datesTache(m.id, m.t2)).toEqual({ debut: "2026-11-16", fin: "2026-11-20" });
    const aff = (await a.chef.get(`/api/missions/${m.id}/affectations`)).json().elements[0];
    expect(aff).toMatchObject({
      date_debut: "2026-11-16",
      date_fin: "2026-11-20",
      jours_alloues: 3,
    });
    const notifs = (await m.consultant.get("/api/notifications")).json();
    expect(notifs.non_lues).toBe(1);
    expect(notifs.elements[0]).toMatchObject({
      type: "replanification",
      lien: "/mon-planning?semaine=2026-11-16",
    });
    expect(notifs.elements[0].corps).toContain("du 2026-11-16 au 2026-11-20");
    // Recul : retour aux dates initiales.
    const retour = await a.chef.post(`/api/missions/${m.id}/replanifier`, {
      phase_id: m.p1,
      decalage_jours_ouvres: -5,
    });
    expect(retour.statusCode, retour.body).toBe(200);
    expect(await datesTache(m.id, m.t1)).toEqual({ debut: "2026-11-02", fin: "2026-11-06" });
  });

  it("refuse des dates hors mission (budget signé incohérent) et une mission sans date", async () => {
    const m = await monter();
    const tard = await a.chef.post(`/api/missions/${m.id}/replanifier`, {
      phase_id: m.p2,
      decalage_jours_ouvres: 60,
    });
    expect(tard.statusCode).toBe(409);
    expect(tard.json().erreur.code).toBe("DATES_HORS_MISSION");
    const tot = await a.chef.post(`/api/missions/${m.id}/replanifier`, {
      phase_id: m.p1,
      decalage_jours_ouvres: -1,
    });
    expect(tot.statusCode).toBe(409);
    const sansDate = await creerMission(a, {
      type_mission_id: null,
      mode_facturation: "regie",
      date_debut: null,
      date_fin: null,
    });
    const phase = (
      await a.chef.post(`/api/missions/${sansDate.id}/phases`, { libelle: "P" })
    ).json();
    const r = await a.chef.post(`/api/missions/${sansDate.id}/replanifier`, {
      phase_id: phase.id,
      decalage_jours_ouvres: 1,
    });
    expect(r.json().erreur.code).toBe("MISSION_SANS_DATES");
  });

  it("refuse un cycle de dépendances (moteur)", async () => {
    const m = await monter();
    await proprietaire((c) =>
      c.query(
        `INSERT INTO mission_dependances (cabinet_id, mission_id, predecesseur_id, successeur_id)
         VALUES ($1, $2, $3, $4)`,
        [a.cabinetId, m.id, m.t2, m.t1],
      ),
    );
    const r = await a.chef.post(`/api/missions/${m.id}/replanifier?apercu=true`, {
      phase_id: m.p1,
      decalage_jours_ouvres: 1,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("CYCLE_DEPENDANCES");
  });

  it("droits, validation et isolation", async () => {
    const m = await monter();
    const corps = { phase_id: m.p1, decalage_jours_ouvres: 1 };
    // Le consultant affecté voit la mission mais ne la planifie pas.
    expect((await m.consultant.post(`/api/missions/${m.id}/replanifier`, corps)).statusCode).toBe(
      403,
    );
    // Responsable des ressources : pas de mission.planifier.
    const ressources = await a.avecRoles(["ressources"]);
    expect((await ressources.post(`/api/missions/${m.id}/replanifier`, corps)).statusCode).toBe(
      403,
    );
    expect((await b.associe.post(`/api/missions/${m.id}/replanifier`, corps)).statusCode).toBe(404);
    const autre = await monter();
    expect(
      (
        await a.chef.post(`/api/missions/${m.id}/replanifier`, {
          phase_id: autre.p1,
          decalage_jours_ouvres: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await a.chef.post(`/api/missions/${m.id}/replanifier`, {
          phase_id: m.p1,
          decalage_jours_ouvres: 0,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await a.chef.post(`/api/missions/${m.id}/replanifier?apercu=oui`, corps)).statusCode,
    ).toBe(400);
  });

  it("F1 : une mission nommée « X\\nBcc: tiers@exemple » n'injecte aucun en-tête d'e-mail", async () => {
    const m = await monter(a, { intitule: "X\nBcc: tiers@exemple" });
    const r = await a.chef.post(`/api/missions/${m.id}/replanifier`, {
      phase_id: m.p1,
      decalage_jours_ouvres: 1,
    });
    expect(r.statusCode, r.body).toBe(200);
    const notif = (await m.consultant.get("/api/notifications")).json().elements[0];
    expect(notif.titre).toBe("Planning modifié : X Bcc: tiers@exemple");
    const boite = (ctx.app.mailer as MailerJournal).boite;
    const mails = boite.filter((x) => x.sujet.includes("tiers@exemple"));
    expect(mails.length).toBeGreaterThan(0);
    for (const mail of mails) expect(mail.sujet).not.toMatch(/[\r\n]/);
  });
});
