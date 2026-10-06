import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tauxDeSignature } from "../src/routes/missions.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  creerMissionSignee,
  preparerCabinet,
  type CabinetMissions,
} from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Missions A");
  b = await preparerCabinet(ctx, "Cabinet Missions B");
});
afterAll(() => ctx.fermer());

describe("création d'une mission (MIS-09, MIS-10, MIS-12)", () => {
  it("depuis un type du catalogue : fiche, axes analytiques et découpage copiés", async () => {
    const m = await creerMission(a, { activite: "Conseil", secteur: "Agro", bureau: "Abidjan" });
    expect(m).toMatchObject({
      statut: "proposition",
      mode_facturation: "forfait",
      devise: "XOF",
      activite: "Conseil",
      bureau: "Abidjan",
      directeur_id: a.directeur.utilisateurId,
      chef_id: a.chef.utilisateurId,
    });
    const d = (await a.associe.get(`/api/missions/${m.id}/decoupage`)).json();
    const modele = (await a.associe.get(`/api/types-mission/${a.typePlanId}`)).json();
    const phasesModele = modele.elements.filter((e: { niveau: number }) => e.niveau === 1);
    expect(d.phases.map((p: { libelle: string }) => p.libelle)).toEqual(
      phasesModele.map((p: { libelle: string }) => p.libelle),
    );
    const taches = d.phases.flatMap((p: { lots: { taches: unknown[] }[] }) =>
      p.lots.flatMap((l) => l.taches),
    );
    expect(taches.length).toBe(
      modele.elements.filter((e: { niveau: number }) => e.niveau === 3).length,
    );
    expect(taches.every((t: { budget: unknown[] }) => t.budget.length > 0)).toBe(true);
    // Les éléments marqués jalon dans le modèle deviennent des jalons.
    expect(d.jalons.length).toBe(
      modele.elements.filter((e: { est_jalon: boolean }) => e.est_jalon).length,
    );
  });

  it("mission vierge : mode de facturation requis, dates cohérentes", async () => {
    const base = { intitule: "Vierge", client_id: a.clientId };
    expect((await a.associe.post("/api/missions", base)).statusCode).toBe(400);
    const ok = await a.associe.post("/api/missions", { ...base, mode_facturation: "regie" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().mode_facturation).toBe("regie");
    expect(
      (
        await a.associe.post("/api/missions", {
          ...base,
          mode_facturation: "regie",
          date_debut: "2026-12-01",
          date_fin: "2026-11-01",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await a.associe.post("/api/missions", { ...base, mode_facturation: "gratuit" })).statusCode,
    ).toBe(400);
  });

  it("refuse un client, un type ou un responsable d'un autre cabinet", async () => {
    const base = { intitule: "X", mode_facturation: "forfait" };
    expect(
      (await a.associe.post("/api/missions", { ...base, client_id: b.clientId })).statusCode,
    ).toBe(400);
    expect(
      (
        await a.associe.post("/api/missions", {
          ...base,
          client_id: a.clientId,
          type_mission_id: b.typePlanId,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.associe.post("/api/missions", {
          ...base,
          client_id: a.clientId,
          directeur_id: b.directeur.utilisateurId,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("un directeur doit avoir le rôle requis", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    const r = await a.associe.post("/api/missions", {
      intitule: "X",
      client_id: a.clientId,
      mode_facturation: "forfait",
      directeur_id: consultant.utilisateurId,
    });
    expect(r.statusCode).toBe(400);
  });

  it("un chef de mission qui crée une mission en devient le chef", async () => {
    const chef = await a.avecRoles(["chef_mission"]);
    const r = await chef.post("/api/missions", {
      intitule: "Ma mission",
      client_id: a.clientId,
      mode_facturation: "forfait",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().chef_id).toBe(chef.utilisateurId);
    expect((await chef.get(`/api/missions/${r.json().id}`)).statusCode).toBe(200);
  });

  it("droits : création mission.creer", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    const r = await consultant.post("/api/missions", {
      intitule: "X",
      client_id: a.clientId,
      mode_facturation: "forfait",
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("visibilité des missions (règle de src/missions/acces.ts)", () => {
  it("chef : ses missions et celles de son équipe ; associé, directeur, ressources, gestionnaire : tout", async () => {
    const m1 = await creerMission(a); // chef = a.chef
    const autreChef = await a.avecRoles(["chef_mission"]);
    const consultant = await a.avecRoles(["consultant"]);
    const ids = async (api: typeof a.associe) =>
      (await api.get("/api/missions")).json().elements.map((m: { id: string }) => m.id);

    expect(await ids(a.chef)).toContain(m1.id);
    expect(await ids(autreChef)).not.toContain(m1.id);
    expect((await autreChef.get(`/api/missions/${m1.id}`)).statusCode).toBe(404);
    expect((await consultant.get(`/api/missions/${m1.id}`)).statusCode).toBe(404);
    expect((await consultant.get(`/api/missions/${m1.id}/decoupage`)).statusCode).toBe(404);

    // Membre de l'équipe : il voit la mission, sans pouvoir la modifier.
    for (const u of [autreChef, consultant]) {
      expect(
        (await a.chef.post(`/api/missions/${m1.id}/equipe`, { utilisateur_id: u.utilisateurId }))
          .statusCode,
      ).toBe(201);
    }
    expect(await ids(autreChef)).toContain(m1.id);
    expect(await ids(consultant)).toContain(m1.id);
    expect((await consultant.get(`/api/missions/${m1.id}/synthese`)).statusCode).toBe(200);
    expect(
      (await autreChef.post(`/api/missions/${m1.id}/phases`, { libelle: "Intrus" })).statusCode,
    ).toBe(403);

    for (const roles of [
      ["associe"],
      ["directeur_mission"],
      ["ressources"],
      ["gestionnaire"],
    ] as const) {
      const u = await a.avecRoles([...roles]);
      expect(await ids(u)).toContain(m1.id);
    }
    // Retiré de l'équipe : il ne la voit plus.
    expect(
      (await a.chef.delete(`/api/missions/${m1.id}/equipe/${consultant.utilisateurId}`)).statusCode,
    ).toBe(200);
    expect((await consultant.get(`/api/missions/${m1.id}`)).statusCode).toBe(404);
  });

  it("un chef ne réattribue pas la mission", async () => {
    const m = await creerMission(a);
    const r = await a.chef.patch(`/api/missions/${m.id}`, { chef_id: null });
    expect(r.statusCode).toBe(403);
    const ok = await a.chef.patch(`/api/missions/${m.id}`, { bureau: "Dakar" });
    expect(ok.json().bureau).toBe("Dakar");
  });

  it("expert externe : aucune mission (pas de mission.lire)", async () => {
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.get("/api/missions")).statusCode).toBe(403);
  });
});

describe("cycle de vie et signature (MIS-07, FIN-04)", () => {
  it("transitions permises et refusées", async () => {
    const m = await creerMission(a, { statut: "opportunite" });
    const statut = (s: string) => a.chef.post(`/api/missions/${m.id}/statut`, { statut: s });
    expect((await statut("en_cours")).statusCode).toBe(409);
    expect((await statut("proposition")).json().statut).toBe("proposition");
    expect((await statut("a_cloturer")).statusCode).toBe(409);
  });

  it("signature : budget initial figé, taux de change, lettre de mission ; puis clôture", async () => {
    const { id, signature } = await creerMissionSignee(a);
    expect(signature.mission).toMatchObject({
      statut: "signee",
      date_signature: "2026-10-01",
      taux_change: 1,
      devise_reference: "XOF",
      signee_par: a.directeur.utilisateurId,
    });
    expect(signature.budget_initial).toMatchObject({
      numero: 1,
      type: "initial",
      figee: true,
      date_figeage: "2026-10-01",
    });
    // Seconde signature refusée.
    expect(
      (await a.directeur.post(`/api/missions/${id}/signer`, { date_signature: "2026-10-02" }))
        .statusCode,
    ).toBe(409);
    const docs = (await a.chef.get(`/api/missions/${id}/documents`)).json().elements;
    expect(docs).toEqual([
      expect.objectContaining({ type: "lettre_de_mission", nom: "Lettre de mission", version: 1 }),
    ]);
    // La devise est figée à la signature.
    expect((await a.associe.patch(`/api/missions/${id}`, { devise: "EUR" })).statusCode).toBe(409);

    // Cycle jusqu'à la clôture ; le chef n'a pas le droit de clôturer.
    for (const s of ["en_cours", "a_cloturer"]) {
      expect((await a.chef.post(`/api/missions/${id}/statut`, { statut: s })).statusCode).toBe(200);
    }
    expect((await a.chef.post(`/api/missions/${id}/cloturer`)).statusCode).toBe(403);
    const close = await a.directeur.post(`/api/missions/${id}/cloturer`);
    expect(close.json()).toMatchObject({ statut: "cloturee" });
    // Mission clôturée : plus aucune modification.
    expect((await a.associe.post(`/api/missions/${id}/phases`, { libelle: "X" })).statusCode).toBe(
      409,
    );
  });

  it("signature refusée au chef de mission et sans directeur désigné", async () => {
    const m = await creerMission(a);
    expect(
      (await a.chef.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-10-01" }))
        .statusCode,
    ).toBe(403);
    const sans = await creerMission(a, { directeur_id: null });
    expect(
      (await a.associe.post(`/api/missions/${sans.id}/signer`, { date_signature: "2026-10-01" }))
        .statusCode,
    ).toBe(400);
  });

  it("mission en euros : taux EUR/FCFA figé (parité légale par défaut) et budget en euros", async () => {
    const m = await creerMission(a, { devise: "EUR" });
    // Pas de taux de vente des grades en euros : la signature exige les taux.
    const refus = await a.directeur.post(`/api/missions/${m.id}/signer`, {
      date_signature: "2026-10-01",
    });
    expect(refus.statusCode).toBe(400);
    expect(refus.json().erreur.code).toBe("TAUX_INCONNU");
    const s = await a.directeur.post(`/api/missions/${m.id}/signer`, {
      date_signature: "2026-10-01",
      taux_vente: { associe: 90000, manager: 45000, senior: 30000, junior: 15000 },
    });
    expect(s.statusCode).toBe(200);
    expect(s.json().mission).toMatchObject({ devise: "EUR", taux_change: 655.957 });
    expect(s.json().budget_initial.devise).toBe("EUR");
    // Le taux de change figé ne se modifie pas, même en SQL direct (rôle applicatif).
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE missions SET taux_change = 600 WHERE id = $1", [m.id]),
      ),
    ).rejects.toMatchObject({ code: "MPF01" });
  });

  it("taux de signature : même devise 1, FCFA 1:1, EUR parité, sinon requis", () => {
    expect(tauxDeSignature("XOF", "XOF")).toBe(1);
    expect(tauxDeSignature("XAF", "XOF")).toBe(1);
    expect(tauxDeSignature("EUR", "XOF")).toBe(655.957);
    expect(tauxDeSignature("USD", "XOF", 600)).toBe(600);
    expect(() => tauxDeSignature("USD", "XOF")).toThrow(/requis/);
  });
});

describe("duplication et enregistrement en modèle (MIS-12)", () => {
  it("duplique le découpage et les budgets en jours, sans signature ni budget", async () => {
    const { id } = await creerMissionSignee(a);
    const r = await a.associe.post(`/api/missions/${id}/dupliquer`, { intitule: "Copie" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      intitule: "Copie",
      statut: "proposition",
      mission_source_id: id,
      date_signature: null,
    });
    const source = (await a.associe.get(`/api/missions/${id}/synthese`)).json();
    const copie = (await a.associe.get(`/api/missions/${r.json().id}/synthese`)).json();
    expect(copie.arborescence.suivi.budget).toBe(source.arborescence.suivi.budget);
    expect(copie.arborescence.enfants.length).toBe(source.arborescence.enfants.length);
    const budget = (await a.associe.get(`/api/missions/${r.json().id}/budget`)).json();
    expect(budget.versions).toEqual([]);
  });

  it("enregistre le découpage comme type du catalogue (catalogue.ecrire)", async () => {
    const m = await creerMission(a);
    expect(
      (await a.chef.post(`/api/missions/${m.id}/modele`, { code: "x", libelle: "X" })).statusCode,
    ).toBe(403);
    const r = await a.associe.post(`/api/missions/${m.id}/modele`, {
      code: "plan_depuis_mission",
      libelle: "Plan (depuis mission)",
    });
    expect(r.statusCode).toBe(201);
    const type = (await a.associe.get(`/api/types-mission/${r.json().id}`)).json();
    const source = (await a.associe.get(`/api/types-mission/${a.typePlanId}`)).json();
    expect(type.elements.length).toBe(source.elements.length);
    const somme = (els: { jours_par_grade: Record<string, number> }[]) =>
      els.reduce((s, e) => s + Object.values(e.jours_par_grade).reduce((x, y) => x + y, 0), 0);
    expect(somme(type.elements)).toBe(somme(source.elements));
    expect(
      (
        await a.associe.post(`/api/missions/${m.id}/modele`, {
          code: "plan_depuis_mission",
          libelle: "Doublon",
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe("isolation entre cabinets (404 pour chaque ressource)", () => {
  it("toutes les routes de mission répondent 404 pour une mission d'un autre cabinet", async () => {
    const { id } = await creerMissionSignee(b);
    const appels = [
      a.associe.get(`/api/missions/${id}`),
      a.associe.patch(`/api/missions/${id}`, { bureau: "X" }),
      a.associe.post(`/api/missions/${id}/statut`, { statut: "en_cours" }),
      a.associe.post(`/api/missions/${id}/signer`, { date_signature: "2026-10-01" }),
      a.associe.post(`/api/missions/${id}/cloturer`),
      a.associe.post(`/api/missions/${id}/dupliquer`, { intitule: "Vol" }),
      a.associe.post(`/api/missions/${id}/modele`, { code: "vol", libelle: "Vol" }),
      a.associe.post(`/api/missions/${id}/equipe`, { utilisateur_id: a.associeId }),
      a.associe.get(`/api/missions/${id}/decoupage`),
      a.associe.get(`/api/missions/${id}/synthese`),
      a.associe.get(`/api/missions/${id}/planning`),
      a.associe.get(`/api/missions/${id}/budget`),
      a.associe.get(`/api/missions/${id}/documents`),
      a.associe.post(`/api/missions/${id}/documents`, { type: "autre", nom: "x" }),
      a.associe.post(`/api/missions/${id}/phases`, { libelle: "x" }),
      a.associe.post(`/api/missions/${id}/budget/revisions`, { motif: "x" }),
    ];
    for (const r of await Promise.all(appels)) expect(r.statusCode).toBe(404);
    expect(
      (await a.associe.get("/api/missions")).json().elements.map((m: { id: string }) => m.id),
    ).not.toContain(id);
  });

  it("le journal trace la création et la signature, sans montant", async () => {
    const { id } = await creerMissionSignee(a);
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT action, details FROM journal_audit WHERE entite_id = $1 ORDER BY id",
            [id],
          )
        ).rows,
    );
    expect(lignes.map((l) => l.action)).toEqual(["creation", "signature"]);
    expect(JSON.stringify(lignes)).not.toMatch(/prix|montant|cout|honoraires/);
  });
});
