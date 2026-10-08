import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import {
  attendre,
  factureEmise,
  preparerFacturation,
  type CabinetFacturation,
} from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMissionSignee } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";

/*
 * Check-list de clôture standard, bloquante et paramétrable (AUT-08) : modèle du cabinet,
 * évaluation, refus 409 CLOTURE_BLOQUEE de la clôture, dérogation motivée, attestation, historique
 * en ajout seul (MPX01) et réservé aux directeurs de mission et associés (MPX02).
 */

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Clôture A");
  b = await preparerFacturation(ctx, "Cabinet Clôture B");
});
afterAll(() => ctx.fermer());

async function mettreAClôturer(missionId: string): Promise<void> {
  for (const s of ["en_cours", "a_cloturer"]) {
    attendre(200, await a.directeur.post(`/api/missions/${missionId}/statut`, { statut: s }), s);
  }
}

const etat = (corps: { items: { controle: string; etat: string }[] }, controle: string) =>
  corps.items.find((i) => i.controle === controle)?.etat;

async function reglerModele(items: { controle: string; actif: boolean; bloquant: boolean }[]) {
  attendre(200, await a.associe.put("/api/cloture/modele", { items }), "modèle");
}

describe("modèle de check-list du cabinet", () => {
  it("exige une session et le droit de paramétrer", async () => {
    expect((await api(ctx).get("/api/cloture/modele")).statusCode).toBe(401);
    expect((await api(ctx).put("/api/cloture/modele", { items: [] })).statusCode).toBe(401);
    const corps = { items: [{ controle: "debours_traites", actif: true, bloquant: true }] };
    expect((await a.directeur.put("/api/cloture/modele", corps)).statusCode).toBe(403);
    expect((await a.chef.put("/api/cloture/modele", corps)).statusCode).toBe(403);
  });

  it("sert les valeurs par défaut, puis le réglage du cabinet, jamais celui d'un autre", async () => {
    const defaut = (await a.chef.get("/api/cloture/modele")).json();
    expect(defaut.items).toHaveLength(7);
    expect(
      defaut.items.find((i: { controle: string }) => i.controle === "temps_valides"),
    ).toMatchObject({ actif: true, bloquant: true, par_defaut: true });
    expect(
      defaut.items.find((i: { controle: string }) => i.controle === "capitalisation_faite"),
    ).toMatchObject({ actif: false, par_attestation: true });
    const r = await a.associe.put("/api/cloture/modele", {
      items: [{ controle: "encaissements_soldes", actif: true, bloquant: true }],
    });
    expect(r.statusCode).toBe(200);
    expect(
      r.json().items.find((i: { controle: string }) => i.controle === "encaissements_soldes"),
    ).toMatchObject({ bloquant: true, par_defaut: false });
    const chezB = (await b.chef.get("/api/cloture/modele")).json();
    expect(
      chezB.items.find((i: { controle: string }) => i.controle === "encaissements_soldes"),
    ).toMatchObject({ bloquant: false, par_defaut: true });
    await reglerModele([{ controle: "encaissements_soldes", actif: true, bloquant: false }]);
  });

  it("refuse un contrôle inconnu, un doublon et un item inactif bloquant", async () => {
    const put = (items: unknown[]) => a.associe.put("/api/cloture/modele", { items });
    expect((await put([{ controle: "inconnu", actif: true, bloquant: true }])).statusCode).toBe(
      400,
    );
    const dup = { controle: "debours_traites", actif: true, bloquant: true };
    expect((await put([dup, dup])).statusCode).toBe(400);
    expect((await put([{ ...dup, actif: false }])).statusCode).toBe(400);
    expect((await put([{ ...dup, extra: 1 }])).statusCode).toBe(400);
  });
});

describe("évaluation et clôture bloquée", () => {
  it("une mission vierge est verte ; les items inactifs sont ignorés", async () => {
    const m = await creerMissionSignee(a);
    await mettreAClôturer(m.id);
    const r = await a.chef.get(`/api/missions/${m.id}/cloture`);
    expect(r.statusCode).toBe(200);
    const corps = r.json();
    // Satisfaction non demandée : avertissement non bloquant ; le reste est conforme.
    expect(corps).toMatchObject({ autorisee: true, bloquants: [], statut_mission: "a_cloturer" });
    expect(etat(corps, "satisfaction_demandee")).toBe("avertissement");
    expect(etat(corps, "temps_valides")).toBe("conforme");
    expect(etat(corps, "capitalisation_faite")).toBe("inactif");
    expect((await a.directeur.post(`/api/missions/${m.id}/cloturer`)).statusCode).toBe(200);
  });

  it("401, 404 d'un autre cabinet et d'une mission invisible", async () => {
    const m = await creerMissionSignee(a);
    expect((await api(ctx).get(`/api/missions/${m.id}/cloture`)).statusCode).toBe(401);
    expect((await api(ctx).post(`/api/missions/${m.id}/cloture/evaluer`)).statusCode).toBe(401);
    expect((await b.associe.get(`/api/missions/${m.id}/cloture`)).statusCode).toBe(404);
    expect((await b.associe.post(`/api/missions/${m.id}/cloture/evaluer`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/missions/${m.id}/cloture/historique`)).statusCode).toBe(404);
    const autreChef = await a.avecRoles(["chef_mission"]);
    expect((await autreChef.get(`/api/missions/${m.id}/cloture`)).statusCode).toBe(404);
    const sans = await a.avecRoles(["gestionnaire"]);
    expect((await sans.post(`/api/missions/${m.id}/cloture/evaluer`)).statusCode).toBe(403);
  });

  it("un débours en attente bloque la clôture (409 CLOTURE_BLOQUEE), puis la décision le lève", async () => {
    const m = await creerMissionSignee(a, { mode_facturation: "forfait" });
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    attendre(
      201,
      await a.chef.post(`/api/missions/${m.id}/equipe`, {
        utilisateur_id: consultant.utilisateurId,
      }),
      "équipe",
    );
    const d = await consultant.post(`/api/missions/${m.id}/debours`, {
      date: "2026-10-05",
      categorie: "transport",
      libelle: "Billet",
      montant: 45_000,
      refacturable: true,
    });
    attendre(201, d, "débours");
    await mettreAClôturer(m.id);

    const bloque = await a.directeur.post(`/api/missions/${m.id}/cloturer`);
    expect(bloque.statusCode).toBe(409);
    expect(bloque.json().erreur).toMatchObject({
      code: "CLOTURE_BLOQUEE",
      details: { manquants: ["debours_traites"] },
    });
    expect(bloque.json().erreur.message).toContain("Débours traités");
    const lecture = (await a.chef.get(`/api/missions/${m.id}/cloture`)).json();
    expect(lecture).toMatchObject({ autorisee: false, bloquants: ["debours_traites"] });
    expect(
      lecture.items.find((i: { controle: string }) => i.controle === "debours_traites"),
    ).toMatchObject({ etat: "bloque", nombre_ecarts: 1 });

    attendre(200, await consultant.post(`/api/debours/${d.json().id}/soumettre`), "soumission");
    expect((await a.directeur.post(`/api/missions/${m.id}/cloturer`)).statusCode).toBe(409);
    attendre(200, await a.chef.post(`/api/debours/${d.json().id}/valider`), "validation");
    expect((await a.directeur.post(`/api/missions/${m.id}/cloturer`)).statusCode).toBe(200);
  });

  it("une facture émise non soldée n'avertit que si l'item est non bloquant, bloque sinon", async () => {
    const { missionId } = await factureEmise(a);
    await mettreAClôturer(missionId);
    const r = (await a.chef.get(`/api/missions/${missionId}/cloture`)).json();
    // Le gabarit d'échéancier laisse une échéance « prévue » : seule une échéance « à facturer » bloque.
    expect(etat(r, "encaissements_soldes")).toBe("avertissement");
    expect(r.autorisee).toBe(true);
    await reglerModele([{ controle: "encaissements_soldes", actif: true, bloquant: true }]);
    try {
      const bloque = await a.directeur.post(`/api/missions/${missionId}/cloturer`);
      expect(bloque.statusCode).toBe(409);
      expect(bloque.json().erreur.details.manquants).toEqual(["encaissements_soldes"]);

      // Dérogation : réservée au directeur de mission et à l'associé, motivée, ajout seul.
      const demande = { controle: "encaissements_soldes", motif: "Paiement convenu fin novembre" };
      const url = `/api/missions/${missionId}/cloture/derogations`;
      expect((await api(ctx).post(url, demande)).statusCode).toBe(401);
      expect((await a.chef.post(url, demande)).statusCode).toBe(403);
      expect((await b.associe.post(url, demande)).statusCode).toBe(404);
      expect((await a.directeur.post(url, { ...demande, motif: "court" })).statusCode).toBe(400);
      expect(
        (await a.directeur.post(url, { controle: "temps_valides", motif: "Sans objet réel ici" }))
          .statusCode,
      ).toBe(409);
      const ok = await a.directeur.post(url, demande);
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ autorisee: true, bloquants: [] });
      expect(etat(ok.json(), "encaissements_soldes")).toBe("deroge");
      expect(
        ok.json().items.find((i: { controle: string }) => i.controle === "encaissements_soldes")
          .derogation,
      ).toMatchObject({ motif: demande.motif, par: a.directeur.utilisateurId });
      expect((await a.directeur.post(url, demande)).statusCode).toBe(409);

      // Retrait par une nouvelle ligne : le blocage revient.
      const retrait = `${url}/encaissements_soldes/retrait`;
      expect((await a.chef.post(retrait, { motif: "Plus valable ici" })).statusCode).toBe(403);
      const retire = await a.associe.post(retrait, { motif: "Plus valable aujourd'hui" });
      expect(retire.statusCode).toBe(200);
      expect(retire.json().autorisee).toBe(false);
      expect(
        (await a.associe.post(retrait, { motif: "Plus valable aujourd'hui" })).statusCode,
      ).toBe(409);
      attendre(201, await a.directeur.post(url, demande), "nouvelle dérogation");
      // Séparation des tâches : le directeur qui a dérogé ne clôt pas (409, MPX03) ; un associé oui.
      const parDeroge = await a.directeur.post(`/api/missions/${missionId}/cloturer`);
      expect(parDeroge.statusCode).toBe(409);
      expect(parDeroge.json().erreur.code).toBe("DEROGATION_PAR_CLOTUREUR");
      attendre(200, await a.associe.post(`/api/missions/${missionId}/cloturer`), "clôture associé");

      // Historique lisible, trois lignes de dérogation (accordée, retirée, accordée).
      const h = (
        await a.chef.get(`/api/missions/${missionId}/cloture/historique?limite=10`)
      ).json();
      expect(h.derogations.map((d: { action: string }) => d.action)).toEqual([
        "accordee",
        "retiree",
        "accordee",
      ]);
      expect(
        h.verifications.some((v: { declencheur: string }) => v.declencheur === "cloture"),
      ).toBe(true);
      expect(
        (await a.chef.get(`/api/missions/${missionId}/cloture/historique?limite=0`)).statusCode,
      ).toBe(400);
    } finally {
      await reglerModele([{ controle: "encaissements_soldes", actif: true, bloquant: false }]);
    }
  });

  it("une dérogation sur une mission clôturée est refusée (409)", async () => {
    const m = await creerMissionSignee(a);
    await mettreAClôturer(m.id);
    attendre(200, await a.directeur.post(`/api/missions/${m.id}/cloturer`), "clôture");
    const r = await a.directeur.post(`/api/missions/${m.id}/cloture/derogations`, {
      controle: "temps_valides",
      motif: "Dérogation tardive injustifiée",
    });
    expect(r.statusCode).toBe(409);
    expect((await a.chef.get(`/api/missions/${m.id}/cloture`)).statusCode).toBe(200);
  });
});

describe("attestation (capitalisation faite)", () => {
  it("bloque tant qu'elle n'est pas attestée, puis passe au vert", async () => {
    await reglerModele([{ controle: "capitalisation_faite", actif: true, bloquant: true }]);
    try {
      const m = await creerMissionSignee(a);
      await mettreAClôturer(m.id);
      const url = `/api/missions/${m.id}/cloture/attestations`;
      const avant = (await a.chef.get(`/api/missions/${m.id}/cloture`)).json();
      expect(avant.bloquants).toEqual(["capitalisation_faite"]);
      expect(etat(avant, "capitalisation_faite")).toBe("bloque");
      expect((await a.directeur.post(`/api/missions/${m.id}/cloturer`)).statusCode).toBe(409);

      const corps = { controle: "capitalisation_faite", attestee: true, note: "Fiche déposée" };
      expect((await api(ctx).post(url, corps)).statusCode).toBe(401);
      expect((await b.associe.post(url, corps)).statusCode).toBe(404);
      expect((await a.gestionnaire.post(url, corps)).statusCode).toBe(403);
      expect((await a.chef.post(url, { ...corps, controle: "temps_valides" })).statusCode).toBe(
        400,
      );
      const ok = await a.chef.post(url, corps);
      expect(ok.statusCode).toBe(201);
      expect(ok.json().autorisee).toBe(true);
      expect(
        ok.json().items.find((i: { controle: string }) => i.controle === "capitalisation_faite")
          .attestation,
      ).toMatchObject({ attestee: true, note: "Fiche déposée", par: a.chef.utilisateurId });

      // Retrait de l'attestation : nouvelle ligne, le blocage revient.
      const retire = await a.chef.post(url, { controle: "capitalisation_faite", attestee: false });
      expect(retire.json().autorisee).toBe(false);
      attendre(201, await a.chef.post(url, corps), "attestation");
      expect((await a.directeur.post(`/api/missions/${m.id}/cloturer`)).statusCode).toBe(200);
    } finally {
      await reglerModele([{ controle: "capitalisation_faite", actif: false, bloquant: false }]);
    }
  });

  it("refuse l'attestation d'un item inactif", async () => {
    const m = await creerMissionSignee(a);
    const r = await a.chef.post(`/api/missions/${m.id}/cloture/attestations`, {
      controle: "capitalisation_faite",
      attestee: true,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("ITEM_INACTIF");
  });
});

describe("évaluation enregistrée et historiques en base", () => {
  it("n'ajoute une vérification que si le résultat change", async () => {
    const m = await creerMissionSignee(a);
    const url = `/api/missions/${m.id}/cloture/evaluer`;
    attendre(200, await a.chef.post(url), "évaluation 1");
    const compter = () =>
      proprietaire(async (db) =>
        Number(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM cloture_verifications WHERE mission_id = $1",
              [m.id],
            )
          ).rows[0].n,
        ),
      );
    const n1 = await compter();
    expect(n1).toBeGreaterThan(0);
    attendre(200, await a.chef.post(url), "évaluation 2");
    expect(await compter()).toBe(n1);
    // Une lecture n'écrit rien.
    await a.chef.get(`/api/missions/${m.id}/cloture`);
    expect(await compter()).toBe(n1);
  });

  it("refuse toute modification d'un historique (MPX01) et une dérogation sans rôle (MPX02)", async () => {
    const m = await creerMissionSignee(a);
    attendre(200, await a.chef.post(`/api/missions/${m.id}/cloture/evaluer`), "évaluation");
    await expect(
      proprietaire((db) =>
        db.query("UPDATE cloture_verifications SET resultat = 'conforme' WHERE mission_id = $1", [
          m.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPX01" });
    await expect(
      proprietaire((db) =>
        db.query("DELETE FROM cloture_verifications WHERE mission_id = $1", [m.id]),
      ),
    ).rejects.toMatchObject({ code: "MPX01" });
    await expect(
      proprietaire((db) =>
        db.query(
          `INSERT INTO cloture_derogations (cabinet_id, mission_id, controle, action, motif, par)
           VALUES ($1, $2, 'temps_valides', 'accordee', 'Motif suffisamment long', $3)`,
          [a.cabinetId, m.id, a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPX02" });
    await proprietaire((db) =>
      db.query(
        `INSERT INTO cloture_derogations (cabinet_id, mission_id, controle, action, motif, par)
         VALUES ($1, $2, 'temps_valides', 'accordee', 'Motif suffisamment long', $3)`,
        [a.cabinetId, m.id, a.directeur.utilisateurId],
      ),
    );
    await expect(
      proprietaire((db) =>
        db.query(
          "UPDATE cloture_derogations SET motif = 'Autre motif long' WHERE mission_id = $1",
          [m.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPX01" });
    // Le motif est obligatoire en base.
    await expect(
      proprietaire((db) =>
        db.query(
          `INSERT INTO cloture_derogations (cabinet_id, mission_id, controle, action, motif, par)
           VALUES ($1, $2, 'debours_traites', 'accordee', 'court', $3)`,
          [a.cabinetId, m.id, a.directeur.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("un livrable R2 non signé bloque jusqu'à sa signature ou une dérogation", async () => {
    const m = await creerMissionSignee(a);
    await mettreAClôturer(m.id);
    const { randomUUID } = await import("node:crypto");
    await proprietaire((db) =>
      db.query(
        `INSERT INTO qualite_suivis (cabinet_id, mission_id, type_livrable, livrable_id, libelle,
           classe_minimale, classe, statut, ouvert_par)
         VALUES ($1, $2, 'rapport', $3, 'Rapport final', 'R2', 'R2', 'valide', $4)`,
        [a.cabinetId, m.id, randomUUID(), a.chef.utilisateurId],
      ),
    );
    const r = (await a.chef.get(`/api/missions/${m.id}/cloture`)).json();
    expect(r.bloquants).toEqual(["livrables_signes"]);
    const d = await a.associe.post(`/api/missions/${m.id}/cloture/derogations`, {
      controle: "livrables_signes",
      motif: "Signature attendue du client la semaine prochaine",
    });
    expect(d.statusCode).toBe(201);
    expect((await a.directeur.post(`/api/missions/${m.id}/cloturer`)).statusCode).toBe(200);
  });
});

describe("séparation des tâches, droits financiers et pagination", () => {
  const deroger = (missionId: string, controle: string, action: string, par: string) =>
    proprietaire((db) =>
      db.query(
        `INSERT INTO cloture_derogations (cabinet_id, mission_id, controle, action, motif, par)
         VALUES ($1, $2, $3, $4, 'Motif suffisamment long', $5)`,
        [a.cabinetId, missionId, controle, action, par],
      ),
    );
  const cloreEnBase = (missionId: string, par: string) =>
    proprietaire((db) =>
      db.query(
        "UPDATE missions SET statut = 'cloturee', cloturee_le = now(), cloturee_par = $2 WHERE id = $1",
        [missionId, par],
      ),
    );

  it("l'auteur d'une dérogation en vigueur ne clôt pas (MPX03, API et base), sauf associé", async () => {
    // Base : refus pour le directeur, passage pour l'associé, passage après retrait.
    const m1 = await creerMissionSignee(a);
    await deroger(m1.id, "temps_valides", "accordee", a.directeur.utilisateurId);
    await expect(cloreEnBase(m1.id, a.directeur.utilisateurId)).rejects.toMatchObject({
      code: "MPX03",
    });
    await cloreEnBase(m1.id, a.associeId);
    const m2 = await creerMissionSignee(a);
    await deroger(m2.id, "temps_valides", "accordee", a.directeur.utilisateurId);
    await deroger(m2.id, "temps_valides", "retiree", a.directeur.utilisateurId);
    await cloreEnBase(m2.id, a.directeur.utilisateurId);

    // API : l'associé qui déroge peut clore lui-même ; le directeur reçoit le code dédié.
    const m3 = await creerMissionSignee(a);
    await mettreAClôturer(m3.id);
    await deroger(m3.id, "satisfaction_demandee", "accordee", a.associeId);
    attendre(200, await a.associe.post(`/api/missions/${m3.id}/cloturer`), "associé");
    const m4 = await creerMissionSignee(a);
    await mettreAClôturer(m4.id);
    await deroger(m4.id, "satisfaction_demandee", "accordee", a.directeur.utilisateurId);
    const refus = await a.directeur.post(`/api/missions/${m4.id}/cloturer`);
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("DEROGATION_PAR_CLOTUREUR");
    attendre(200, await a.associe.post(`/api/missions/${m4.id}/cloturer`), "associé");
  });

  it("sans facture.lire, les compteurs des contrôles financiers sont absents (pas de zéro)", async () => {
    const { missionId } = await factureEmise(a);
    const consultant = await utilisateurCollaborateur(a, ["consultant"]);
    attendre(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, {
        utilisateur_id: consultant.utilisateurId,
      }),
      "équipe",
    );
    const lire = async (u: typeof consultant | typeof a.chef) => {
      const r = await u.get(`/api/missions/${missionId}/cloture`);
      attendre(200, r, "clôture");
      return r.json().items as Record<string, unknown>[];
    };
    const sans = await lire(consultant);
    for (const controle of ["factures_emises", "encaissements_soldes"]) {
      const item = sans.find((i) => i.controle === controle) as Record<string, unknown>;
      expect(item).toBeDefined();
      expect("nombre_ecarts" in item).toBe(false);
      expect(item.etat).toBeDefined();
    }
    expect("nombre_ecarts" in (sans.find((i) => i.controle === "temps_valides") ?? {})).toBe(true);
    const avec = await lire(a.chef);
    expect(avec.find((i) => i.controle === "encaissements_soldes")?.nombre_ecarts).toBe(1);
    // L'historique obéit à la même projection.
    attendre(200, await a.chef.post(`/api/missions/${missionId}/cloture/evaluer`), "évaluation");
    const h = (await consultant.get(`/api/missions/${missionId}/cloture/historique`)).json();
    for (const v of h.verifications as Record<string, unknown>[]) {
      if (v.controle === "factures_emises" || v.controle === "encaissements_soldes") {
        expect("nombre_ecarts" in v).toBe(false);
      }
    }
  });

  it("l'historique se pagine par curseur, une liste après l'autre", async () => {
    const m = await creerMissionSignee(a);
    attendre(200, await a.chef.post(`/api/missions/${m.id}/cloture/evaluer`), "évaluation");
    await deroger(m.id, "temps_valides", "accordee", a.directeur.utilisateurId);
    await deroger(m.id, "temps_valides", "retiree", a.directeur.utilisateurId);
    const url = `/api/missions/${m.id}/cloture/historique`;
    const p1 = (await a.chef.get(`${url}?limite=1`)).json();
    expect(p1.verifications).toHaveLength(1);
    expect(p1.curseur_verifications_suivant).toEqual(expect.any(String));
    expect(p1.derogations).toHaveLength(1);
    expect(p1.derogations[0].action).toBe("retiree");
    const p2 = (
      await a.chef.get(
        `${url}?limite=1&curseur_verifications=${p1.curseur_verifications_suivant}&curseur_derogations=${p1.curseur_derogations_suivant}`,
      )
    ).json();
    expect(p2.verifications[0].id).not.toBe(p1.verifications[0].id);
    expect(p2.derogations[0].action).toBe("accordee");
    expect(p2.curseur_derogations_suivant).toBeNull();
    expect((await a.chef.get(`${url}?curseur_verifications=nimportequoi`)).statusCode).toBe(400);
  });
});
