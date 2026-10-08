import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ajouterJours } from "@missionpilot/engines";
import type { MailerJournal } from "../src/notifications/mailer.js";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

const aujourdhui = new Date().toISOString().slice(0, 10);
const dans = (jours: number) => ajouterJours(aujourdhui, jours);

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Absences A");
  b = await preparerCabinet(ctx, "Cabinet Absences B");
});
afterAll(() => ctx.fermer());

const demande = (debut: number, fin: number, type = "conge_paye") => ({
  type,
  date_debut: dans(debut),
  date_fin: dans(fin),
});

describe("congés et absences (PLN-07)", () => {
  it("demande pour soi, validation par un tiers, notification du résultat (in-app et e-mail)", async () => {
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const ressources = await a.avecRoles(["ressources"]);
    const r = await consultant.post("/api/absences", { ...demande(20, 22), commentaire: "Repos" });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      collaborateur_id: consultant.collaborateurId,
      demandeur_id: consultant.utilisateurId,
      statut: "demandee",
      type: "conge_paye",
    });
    const id = r.json().id as string;
    // Le consultant ne valide pas (droit), même pour lui-même.
    expect((await consultant.post(`/api/absences/${id}/valider`)).statusCode).toBe(403);
    const v = await ressources.post(`/api/absences/${id}/valider`);
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json()).toMatchObject({ statut: "validee", decide_par: ressources.utilisateurId });
    expect((await ressources.post(`/api/absences/${id}/valider`)).statusCode).toBe(409);
    const notifs = (await consultant.get("/api/notifications")).json();
    expect(notifs.elements[0]).toMatchObject({ type: "absence_validee" });
    const boite = (ctx.app.mailer as MailerJournal).boite;
    expect(boite.some((m) => m.sujet.includes("validée"))).toBe(true);
  });

  it("refus avec motif obligatoire ; le valideur ne décide pas de sa propre demande (sauf associé)", async () => {
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const ressources = await utilisateurCollaborateur(a, ["ressources"]);
    const r = await consultant.post("/api/absences", demande(40, 41, "formation"));
    const id = r.json().id as string;
    expect((await ressources.post(`/api/absences/${id}/refuser`, {})).statusCode).toBe(400);
    expect((await ressources.post(`/api/absences/${id}/refuser`, { motif: "  " })).statusCode).toBe(
      400,
    );
    const refus = await ressources.post(`/api/absences/${id}/refuser`, {
      motif: "Période de clôture <b>chargée</b>",
    });
    expect(refus.statusCode, refus.body).toBe(200);
    expect(refus.json()).toMatchObject({ statut: "refusee" });
    const notif = (await consultant.get("/api/notifications")).json().elements[0];
    expect(notif.type).toBe("absence_refusee");
    expect(notif.corps).toContain("Motif : Période de clôture bchargée/b");
    expect(notif.corps).not.toMatch(/[<>]/);

    const propre = await ressources.post("/api/absences", demande(50, 50));
    const auto = await ressources.post(`/api/absences/${propre.json().id}/valider`);
    expect(auto.statusCode).toBe(403);
    expect(auto.json().erreur.code).toBe("AUTO_VALIDATION");

    const associeCollab = await a.associe.post("/api/collaborateurs", {
      nom: "Associé",
      utilisateur_id: a.associeId,
      grade_id: a.grades.associe,
    });
    expect(associeCollab.statusCode).toBe(201);
    const sienne = await a.associe.post("/api/absences", demande(70, 71));
    expect((await a.associe.post(`/api/absences/${sienne.json().id}/valider`)).statusCode).toBe(
      200,
    );
  });

  it("validation des entrées, chevauchement, compte sans collaborateur, expert externe", async () => {
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    expect(
      (await consultant.post("/api/absences", { ...demande(5, 6), type: "vacances" })).statusCode,
    ).toBe(400);
    expect((await consultant.post("/api/absences", demande(6, 5))).statusCode).toBe(400);
    expect(
      (await consultant.post("/api/absences", { ...demande(5, 6), collaborateur_id: "x" }))
        .statusCode,
    ).toBe(400);
    expect((await consultant.post("/api/absences", demande(5, 8))).statusCode).toBe(201);
    expect((await consultant.post("/api/absences", demande(8, 9))).statusCode).toBe(409);
    const sansCollab = await a.avecRoles(["consultant"]);
    expect((await sansCollab.post("/api/absences", demande(5, 6))).statusCode).toBe(409);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.post("/api/absences", demande(5, 6))).statusCode).toBe(403);
  });

  it("annulation par le demandeur seulement, et tant que l'absence n'a pas commencé", async () => {
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const ressources = await a.avecRoles(["ressources"]);
    const futur = (await consultant.post("/api/absences", demande(90, 91))).json().id;
    await ressources.post(`/api/absences/${futur}/valider`);
    expect((await ressources.post(`/api/absences/${futur}/annuler`)).statusCode).toBe(404);
    const ann = await consultant.post(`/api/absences/${futur}/annuler`);
    expect(ann.statusCode, ann.body).toBe(200);
    expect(ann.json().statut).toBe("annulee");
    expect((await consultant.post(`/api/absences/${futur}/annuler`)).statusCode).toBe(409);
    // Absence déclarée a posteriori (maladie) : commencée, elle ne s'annule plus.
    const passee = (await consultant.post("/api/absences", demande(-5, -4, "maladie"))).json().id;
    expect((await consultant.post(`/api/absences/${passee}/annuler`)).statusCode).toBe(409);
  });

  it("liste : ses propres demandes, ou toutes pour un valideur ; pagination par curseur", async () => {
    const c1 = await utilisateurCollaborateur(a, ["consultant"]);
    const c2 = await utilisateurCollaborateur(a, ["consultant"]);
    const ressources = await a.avecRoles(["ressources"]);
    for (const j of [100, 110, 120]) await c1.post("/api/absences", demande(j, j));
    await c2.post("/api/absences", demande(100, 100));
    const miennes = (await c1.get("/api/absences")).json().elements as { demandeur_id: string }[];
    expect(miennes).toHaveLength(3);
    expect(miennes.every((x) => x.demandeur_id === c1.utilisateurId)).toBe(true);
    // Filtre sur un autre collaborateur : toujours limité aux siennes.
    expect(
      (await c1.get(`/api/absences?collaborateur_id=${c2.collaborateurId}`)).json().elements,
    ).toEqual([]);
    const autre = (await c2.get("/api/absences")).json().elements[0].id as string;
    expect((await c1.get(`/api/absences/${autre}`)).statusCode).toBe(404);
    expect((await ressources.get(`/api/absences/${autre}`)).statusCode).toBe(200);
    const p1 = (
      await ressources.get(`/api/absences?collaborateur_id=${c1.collaborateurId}&limite=2`)
    ).json();
    expect(p1.elements).toHaveLength(2);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = (
      await ressources.get(
        `/api/absences?collaborateur_id=${c1.collaborateurId}&limite=2&curseur=${p1.curseur_suivant}`,
      )
    ).json();
    expect(p2.elements).toHaveLength(1);
    expect(p2.curseur_suivant).toBeNull();
    expect((await ressources.get("/api/absences?curseur=invalide")).statusCode).toBe(400);
  });

  it("isolation entre cabinets et historique intact (ni suppression, ni modification des dates)", async () => {
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const id = (await consultant.post("/api/absences", demande(130, 131))).json().id as string;
    const ressourcesB = await b.avecRoles(["ressources"]);
    expect((await ressourcesB.post(`/api/absences/${id}/valider`)).statusCode).toBe(404);
    expect((await ressourcesB.get(`/api/absences/${id}`)).statusCode).toBe(404);
    expect(
      (await ressourcesB.get("/api/absences"))
        .json()
        .elements.some((x: { id: string }) => x.id === id),
    ).toBe(false);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM absences WHERE id = $1", [id])),
    ).rejects.toThrow(/permission/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE absences SET date_fin = date_fin + 1 WHERE id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPF03" });
  });

  it("E1 : dates bornées (2000-2100) et durée plafonnée, en API comme en base", async () => {
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const r = await consultant.post("/api/absences", {
      type: "conge_paye",
      date_debut: "0001-01-01",
      date_fin: "9999-12-31",
    });
    expect(r.statusCode, r.body).toBe(400);
    expect((await consultant.get("/api/absences?debut=0001-01-01")).statusCode).toBe(400);
    // La base refuse aussi, même pour une écriture qui contournerait l'API.
    for (const [debut, fin] of [
      ["0001-01-01", "9999-12-31"],
      ["2026-01-01", "2027-06-01"],
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) =>
          db.query(
            `INSERT INTO absences (cabinet_id, collaborateur_id, demandeur_id, type, date_debut, date_fin)
             VALUES ($1, $2, $3, 'autre', $4, $5)`,
            [a.cabinetId, consultant.collaborateurId, consultant.utilisateurId, debut, fin],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("F2 : la décision (auteur, date, motif) ne se réécrit pas sans transition, puis est figée", async () => {
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    const ressources = await a.avecRoles(["ressources"]);
    const autre = await a.avecRoles(["ressources"]);
    const sql = (texte: string, params: unknown[]) =>
      ctx.db.withTenant(a.cabinetId, (db) => db.query(texte, params));

    // Demande en attente : impossible d'y poser une décision sans changer de statut.
    const enAttente = (await consultant.post("/api/absences", demande(140, 141))).json().id;
    await expect(
      sql("UPDATE absences SET decide_par = $2, decide_le = now() WHERE id = $1", [
        enAttente,
        autre.utilisateurId,
      ]),
    ).rejects.toMatchObject({ code: "MPF03" });
    await expect(
      sql("UPDATE absences SET motif_refus = 'x' WHERE id = $1", [enAttente]),
    ).rejects.toMatchObject({ code: "MPF03" });

    // Validée : auteur et date de la décision figés, motif interdit.
    const validee = (await consultant.post("/api/absences", demande(150, 151))).json().id;
    expect((await ressources.post(`/api/absences/${validee}/valider`)).statusCode).toBe(200);
    for (const [texte, params] of [
      ["UPDATE absences SET decide_par = $2 WHERE id = $1", [validee, autre.utilisateurId]],
      ["UPDATE absences SET decide_le = now() - interval '1 day' WHERE id = $1", [validee]],
      ["UPDATE absences SET motif_refus = 'après coup' WHERE id = $1", [validee]],
      // Même lors d'une transition légitime (annulation), la décision reste figée.
      [
        "UPDATE absences SET statut = 'annulee', annulee_le = now(), decide_par = $2 WHERE id = $1",
        [validee, autre.utilisateurId],
      ],
    ] as const) {
      await expect(sql(texte, [...params])).rejects.toMatchObject({ code: "MPF03" });
    }
    const lue = (await ressources.get(`/api/absences/${validee}`)).json();
    expect(lue).toMatchObject({ statut: "validee", decide_par: ressources.utilisateurId });
    // L'annulation par le demandeur reste possible.
    expect((await consultant.post(`/api/absences/${validee}/annuler`)).statusCode).toBe(200);
  });
});
