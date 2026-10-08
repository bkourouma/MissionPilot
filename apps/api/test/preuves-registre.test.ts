import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerAssertion,
  creerPreuve,
  INCONNU,
  lier,
  PREUVE_DOCUMENT,
  PREUVE_ENTRETIEN,
  preparerPreuves,
  type ScenarioPreuves,
} from "./preuves-outils.js";

/*
 * Registre des preuves (PRV-01) : droits (401, 403, matrice preuve.*), isolation entre cabinets
 * et IDOR (404), ajout seul (corrections par version avec motif), validations, masquage des
 * verbatims nominatifs sans accord, mission clôturée, pagination.
 */

let ctx: Contexte;
let s: ScenarioPreuves;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerPreuves(ctx, "PRV registre");
}, 180_000);
afterAll(() => ctx.fermer());

describe("droits et isolation", () => {
  it("401 sans session ; 403 sans la permission ; lecture seule de l'expert métier", async () => {
    const anonyme = api(ctx);
    expect((await anonyme.get(`/api/missions/${s.missionId}/preuves`)).statusCode).toBe(401);
    expect(
      (await anonyme.post(`/api/missions/${s.missionId}/preuves`, PREUVE_ENTRETIEN)).statusCode,
    ).toBe(401);
    for (const u of [s.gestionnaire, s.expertExterne]) {
      expect((await u.get(`/api/missions/${s.missionId}/preuves`)).statusCode).toBe(403);
      expect((await u.get(`/api/missions/${s.missionId}/assertions`)).statusCode).toBe(403);
      expect((await u.get(`/api/missions/${s.missionId}/preuves/triangulation`)).statusCode).toBe(
        403,
      );
    }
    expect((await s.expertMetier.get(`/api/missions/${s.missionId}/preuves`)).statusCode).toBe(200);
    expect(
      (await s.expertMetier.post(`/api/missions/${s.missionId}/preuves`, PREUVE_ENTRETIEN))
        .statusCode,
    ).toBe(403);
  });

  it("mission d'un autre cabinet ou hors équipe : 404, pour la lecture comme pour l'écriture", async () => {
    const p = await creerPreuve(s.a.chef, s.missionId);
    const assertion = await creerAssertion(s.a.chef, s.missionId);
    for (const u of [s.b.associe, s.consultantHors]) {
      expect((await u.get(`/api/missions/${s.missionId}/preuves`)).statusCode).toBe(404);
      expect(
        (await u.post(`/api/missions/${s.missionId}/preuves`, PREUVE_ENTRETIEN)).statusCode,
      ).toBe(404);
      expect((await u.get(`/api/preuves/${p.id}`)).statusCode).toBe(404);
      expect((await u.get(`/api/assertions/${assertion.id}`)).statusCode).toBe(404);
      expect(
        (await u.post(`/api/assertions/${assertion.id}/liens`, { preuve_id: p.id, sens: "pour" }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await u.post(`/api/preuves/${p.id}/versions`, {
            ...PREUVE_ENTRETIEN,
            motif: "Intrusion",
          })
        ).statusCode,
      ).toBe(404);
    }
    expect((await s.a.associe.get(`/api/preuves/${INCONNU}`)).statusCode).toBe(404);
  });

  it("un membre de l'équipe enregistre des preuves sans pouvoir modifier la mission", async () => {
    const r = await s.consultantEquipe.post(`/api/missions/${s.missionId}/preuves`, {
      ...PREUVE_ENTRETIEN,
      source_precise: "Observation en atelier",
      type_source: "observation",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().auteur.id).toBe(s.consultantEquipe.utilisateurId);
  });
});

describe("ajout seul : corrections par version", () => {
  it("une correction exige un motif, crée une version et garde l'historique", async () => {
    const p = await creerPreuve(s.a.chef, s.missionId);
    expect(p.version).toBe(1);
    const sansMotif = await s.a.chef.post(`/api/preuves/${p.id}/versions`, {
      ...PREUVE_ENTRETIEN,
      fiabilite: "C",
    });
    expect(sansMotif.statusCode).toBe(400);
    const r = await s.a.chef.post(`/api/preuves/${p.id}/versions`, {
      ...PREUVE_ENTRETIEN,
      fiabilite: "C",
      motif: "Source recoupée : fiabilité revue à la baisse.",
    });
    expect(r.statusCode).toBe(201);
    const d = r.json();
    expect(d.version).toBe(2);
    expect(d.fiabilite).toBe("C");
    expect(d.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(d.versions[1].fiabilite).toBe("B");
    // L'auteur d'origine est conservé quand la correction ne le précise pas.
    expect(d.auteur.id).toBe(s.a.chef.utilisateurId);
  });

  it("aucune route de modification ou de suppression destructive", async () => {
    const p = await creerPreuve(s.a.chef, s.missionId);
    expect((await s.a.chef.patch(`/api/preuves/${p.id}`, { fiabilite: "D" })).statusCode).toBe(404);
    expect((await s.a.chef.delete(`/api/preuves/${p.id}`)).statusCode).toBe(404);
    expect((await s.a.chef.put(`/api/preuves/${p.id}`, PREUVE_ENTRETIEN)).statusCode).toBe(404);
  });

  it("la correction de l'accord nominatif se trace par une nouvelle version", async () => {
    const p = await creerPreuve(s.a.chef, s.missionId, { nominatif: true });
    const r = await s.a.chef.post(`/api/preuves/${p.id}/versions`, {
      ...PREUVE_ENTRETIEN,
      nominatif: true,
      accord_nominatif: true,
      motif: "Accord écrit de la personne reçu.",
    });
    expect(r.statusCode).toBe(201);
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details FROM journal_audit WHERE entite_id = $1 AND action = 'preuve.corriger'",
            [p.id],
          )
        ).rows,
    );
    expect(journal).toHaveLength(1);
    expect(journal[0].details.accord_nominatif_apres).toBe(true);
    // Le journal ne contient jamais l'extrait.
    expect(JSON.stringify(journal[0].details)).not.toContain("classeur");
  });
});

describe("validations", () => {
  it("corps strict, valeurs bornées, un seul lien, accord nominatif cohérent", async () => {
    const url = `/api/missions/${s.missionId}/preuves`;
    const mauvais = [
      { ...PREUVE_ENTRETIEN, indice: 0.9 },
      { ...PREUVE_ENTRETIEN, fiabilite: "E" },
      { ...PREUVE_ENTRETIEN, type_source: "rumeur" },
      { ...PREUVE_ENTRETIEN, date_preuve: "2026-13-40" },
      { ...PREUVE_ENTRETIEN, source_precise: "" },
      { ...PREUVE_ENTRETIEN, fichier_id: INCONNU, document_id: INCONNU },
      { ...PREUVE_ENTRETIEN, nominatif: false, accord_nominatif: true },
      { ...PREUVE_DOCUMENT, accord_nominatif: true },
      { ...PREUVE_ENTRETIEN, dimensions: ["Majuscule"] },
    ];
    for (const corps of mauvais) {
      expect((await s.a.chef.post(url, corps)).statusCode, JSON.stringify(corps)).toBe(400);
    }
  });

  it("dimension inconnue : 400 ; dimension déclarée acceptée ; doublon 409", async () => {
    const url = `/api/missions/${s.missionId}/preuves`;
    const inconnue = await s.a.chef.post(url, { ...PREUVE_ENTRETIEN, dimensions: ["finance"] });
    expect(inconnue.statusCode).toBe(400);
    expect(inconnue.json().erreur.code).toBe("DIMENSION_INCONNUE");
    const d = await s.a.chef.post(`${url}/dimensions`, { code: "finance", libelle: "Finance" });
    expect(d.statusCode).toBe(201);
    expect(
      (await s.a.chef.post(`${url}/dimensions`, { code: "finance", libelle: "Bis" })).statusCode,
    ).toBe(409);
    const ok = await s.a.chef.post(url, { ...PREUVE_ENTRETIEN, dimensions: ["finance"] });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().dimensions).toEqual(["finance"]);
    // Une dimension désactivée ne peut plus être choisie, mais la preuve existante se corrige.
    const off = await s.a.chef.patch(`${url}/dimensions/${d.json().id}`, { actif: false });
    expect(off.statusCode).toBe(200);
    expect(
      (await s.a.chef.post(url, { ...PREUVE_ENTRETIEN, dimensions: ["finance"] })).statusCode,
    ).toBe(400);
    const corr = await s.a.chef.post(`/api/preuves/${ok.json().id}/versions`, {
      ...PREUVE_ENTRETIEN,
      dimensions: ["finance"],
      motif: "Correction de forme.",
    });
    expect(corr.statusCode).toBe(201);
  });

  it("le fichier, le document ou la réponse liés doivent exister dans le cabinet", async () => {
    const r = await s.a.chef.post(`/api/missions/${s.missionId}/preuves`, {
      ...PREUVE_ENTRETIEN,
      document_id: INCONNU,
    });
    expect(r.statusCode).toBe(400);
  });

  it("un document d'une autre mission ne se lie pas (PREUVE_INCOHERENTE) ; celui de la mission oui", async () => {
    const doc = async (mission: string) => {
      const r = await s.a.chef.post(`/api/missions/${mission}/documents`, {
        type: "autre",
        nom: "Rapport annuel",
      });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    const autre = await doc(s.mission2Id);
    const refus = await s.a.chef.post(`/api/missions/${s.missionId}/preuves`, {
      ...PREUVE_ENTRETIEN,
      document_id: autre,
    });
    expect(refus.statusCode).toBe(400);
    expect(refus.json().erreur.code).toBe("PREUVE_INCOHERENTE");
    const ok = await s.a.chef.post(`/api/missions/${s.missionId}/preuves`, {
      ...PREUVE_ENTRETIEN,
      document_id: await doc(s.missionId),
    });
    expect(ok.statusCode).toBe(201);
  });

  it("l'auteur désigné est un membre du cabinet", async () => {
    const r = await s.a.chef.post(`/api/missions/${s.missionId}/preuves`, {
      ...PREUVE_ENTRETIEN,
      auteur_id: s.consultantEquipe.utilisateurId,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().auteur.id).toBe(s.consultantEquipe.utilisateurId);
    const autreCabinet = await s.a.chef.post(`/api/missions/${s.missionId}/preuves`, {
      ...PREUVE_ENTRETIEN,
      auteur_id: s.b.associeId,
    });
    expect(autreCabinet.statusCode).toBe(400);
  });
});

describe("verbatims nominatifs (accord de la personne)", () => {
  it("l'extrait est masqué sans accord pour les autres membres, visible de l'auteur et du chef", async () => {
    const p = await creerPreuve(s.a.chef, s.missionId, {
      nominatif: true,
      accord_nominatif: false,
      source_precise: "Entretien avec M. Koné, directeur financier",
      extrait: "Je ne fais plus confiance au reporting mensuel.",
    });
    expect(p.masque).toBe(false);
    expect(p.extrait).toContain("reporting");

    const vue = (await s.consultantEquipe.get(`/api/preuves/${p.id}`)).json();
    expect(vue.masque).toBe(true);
    expect(vue.extrait).toBeNull();
    expect(JSON.stringify(vue)).not.toContain("Koné");
    expect(JSON.stringify(vue)).not.toContain("reporting");
    expect(vue.versions[0].extrait).toBeNull();

    const liste = (
      await s.consultantEquipe.get(`/api/missions/${s.missionId}/preuves?q=reporting`)
    ).json();
    expect(liste.elements).toHaveLength(0);
    const listeChef = (
      await s.a.chef.get(`/api/missions/${s.missionId}/preuves?q=reporting`)
    ).json();
    expect(listeChef.elements.map((e: { id: string }) => e.id)).toContain(p.id);

    // L'auteur désigné la voit.
    const parAuteur = await s.a.chef.post(`/api/missions/${s.missionId}/preuves`, {
      ...PREUVE_ENTRETIEN,
      nominatif: true,
      auteur_id: s.consultantEquipe.utilisateurId,
      extrait: "Propos nominatif recueilli par le consultant.",
    });
    const vueAuteur = (await s.consultantEquipe.get(`/api/preuves/${parAuteur.json().id}`)).json();
    expect(vueAuteur.masque).toBe(false);

    // Avec l'accord, tout le monde la lit.
    await s.a.chef.post(`/api/preuves/${p.id}/versions`, {
      ...PREUVE_ENTRETIEN,
      nominatif: true,
      accord_nominatif: true,
      extrait: "Je ne fais plus confiance au reporting mensuel.",
      motif: "Accord recueilli.",
    });
    const apres = (await s.consultantEquipe.get(`/api/preuves/${p.id}`)).json();
    expect(apres.masque).toBe(false);
    expect(apres.extrait).toContain("reporting");
  });

  it("le masquage vaut aussi dans le détail d'une assertion", async () => {
    const p = await creerPreuve(s.a.chef, s.missionId, {
      nominatif: true,
      extrait: "Citation nominative confidentielle.",
    });
    const a = await creerAssertion(s.a.chef, s.missionId);
    await lier(s.a.chef, a.id, p.id, "pour");
    const detail = (await s.consultantEquipe.get(`/api/assertions/${a.id}`)).json();
    expect(detail.preuves_pour[0].masque).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("confidentielle");
  });
});

describe("mission clôturée et plafonds", () => {
  it("une mission clôturée est en lecture seule (409 MISSION_CLOTUREE)", async () => {
    const m = (
      await s.a.associe.post("/api/missions", {
        intitule: "Mission à clore",
        client_id: s.a.clientId,
        type_mission_id: s.a.typePlanId,
        directeur_id: s.a.directeur.utilisateurId,
        chef_id: s.a.chef.utilisateurId,
        date_debut: "2026-11-02",
        date_fin: "2027-01-29",
      })
    ).json().id as string;
    const p = await creerPreuve(s.a.chef, m);
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), date_signature = '2026-10-01',
           signee_par = $2, taux_change = 1, devise_reference = 'XOF' WHERE id = $1`,
        [m, s.a.associeId],
      ),
    );
    const r = await s.a.chef.post(`/api/missions/${m}/preuves`, PREUVE_ENTRETIEN);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("MISSION_CLOTUREE");
    expect(
      (await s.a.chef.post(`/api/preuves/${p.id}/versions`, { ...PREUVE_ENTRETIEN, motif: "x" }))
        .statusCode,
    ).toBe(409);
    expect((await s.a.chef.get(`/api/missions/${m}/preuves`)).statusCode).toBe(200);
  });
});

describe("liste paginée", () => {
  it("curseur, filtres et ordre du plus récent au plus ancien", async () => {
    const m = (
      await s.a.associe.post("/api/missions", {
        intitule: "Mission pagination",
        client_id: s.a.clientId,
        type_mission_id: s.a.typePlanId,
        directeur_id: s.a.directeur.utilisateurId,
        chef_id: s.a.chef.utilisateurId,
        date_debut: "2026-11-02",
        date_fin: "2027-01-29",
      })
    ).json().id as string;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await creerPreuve(s.a.chef, m, { fiabilite: i % 2 === 0 ? "A" : "D" })).id);
    }
    const p1 = (await s.a.chef.get(`/api/missions/${m}/preuves?limite=2`)).json();
    expect(p1.elements.map((e: { id: string }) => e.id)).toEqual([ids[4], ids[3]]);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = (
      await s.a.chef.get(`/api/missions/${m}/preuves?limite=2&curseur=${p1.curseur_suivant}`)
    ).json();
    expect(p2.elements.map((e: { id: string }) => e.id)).toEqual([ids[2], ids[1]]);
    const p3 = (
      await s.a.chef.get(`/api/missions/${m}/preuves?limite=2&curseur=${p2.curseur_suivant}`)
    ).json();
    expect(p3.curseur_suivant).toBeNull();
    const fiables = (await s.a.chef.get(`/api/missions/${m}/preuves?fiabilite=A`)).json();
    expect(fiables.elements).toHaveLength(3);
    expect(
      (await s.a.chef.get(`/api/missions/${m}/preuves?curseur=n-importe-quoi`)).statusCode,
    ).toBe(400);
    expect((await s.a.chef.get(`/api/missions/${m}/preuves?limite=1000`)).statusCode).toBe(400);
  });
});

describe("durcissement (audit du 2026-10-08) : nominatif, auteur, fichier lié", () => {
  it("entretien et questionnaire sont nominatifs par défaut ; un document ne l'est pas", async () => {
    const url = `/api/missions/${s.missionId}/preuves`;
    const entretien = await s.a.chef.post(url, PREUVE_ENTRETIEN);
    expect(entretien.statusCode).toBe(201);
    expect(entretien.json()).toMatchObject({ nominatif: true, accord_nominatif: false });
    const questionnaire = await s.a.chef.post(url, {
      ...PREUVE_ENTRETIEN,
      type_source: "questionnaire",
    });
    expect(questionnaire.json().nominatif).toBe(true);
    const document = await s.a.chef.post(url, PREUVE_DOCUMENT);
    expect(document.json().nominatif).toBe(false);
    // Explicite : le choix de l'utilisateur prime.
    const explicite = await s.a.chef.post(url, { ...PREUVE_ENTRETIEN, nominatif: false });
    expect(explicite.json().nominatif).toBe(false);
    // Par défaut nominatif sans accord : masqué pour un membre qui n'en est pas l'auteur.
    const vue = (await s.consultantEquipe.get(`/api/preuves/${entretien.json().id}`)).json();
    expect(vue.masque).toBe(true);
  });

  it("l'auteur désigné est un membre ACTIF de la mission (400 AUTEUR_NON_MEMBRE, doublé en base)", async () => {
    const url = `/api/missions/${s.missionId}/preuves`;
    const hors = await s.a.chef.post(url, {
      ...PREUVE_ENTRETIEN,
      auteur_id: s.consultantHors.utilisateurId,
    });
    expect(hors.statusCode).toBe(400);
    expect(hors.json().erreur.code).toBe("AUTEUR_NON_MEMBRE");
    // Une correction ne peut pas non plus attribuer la preuve à un non-membre.
    const p = await creerPreuve(s.a.chef, s.missionId);
    const corr = await s.a.chef.post(`/api/preuves/${p.id}/versions`, {
      ...PREUVE_ENTRETIEN,
      auteur_id: s.consultantHors.utilisateurId,
      motif: "Réattribution",
    });
    expect(corr.statusCode).toBe(400);
    // En base, même pour le propriétaire du schéma (MPV02).
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO preuve_versions (cabinet_id, preuve_id, version, type_source, source_precise,
             date_preuve, auteur_id, fiabilite, motif, cree_par)
           VALUES ($1, $2, 2, 'document', 'x', '2026-10-01', $3, 'B', 'm', $4)`,
          [s.a.cabinetId, p.id, s.consultantHors.utilisateurId, s.a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPV02" });
  });

  async function fichier(envoyePar: string, supprime = false): Promise<string> {
    const id = randomUUID();
    await proprietaire(async (c) => {
      await c.query(
        `INSERT INTO fichiers (id, cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
         VALUES ($1, $2, $3, 'piece.pdf', 'application/pdf', 10, $4, $5)`,
        [
          id,
          s.a.cabinetId,
          randomUUID().replaceAll("-", ""),
          createHash("sha256").update(id).digest("hex"),
          envoyePar,
        ],
      );
      if (supprime) {
        await c.query(
          `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif, supprime_par)
           VALUES ($1, $2, 'retire', $3)`,
          [s.a.cabinetId, id, envoyePar],
        );
      }
    });
    return id;
  }

  it("un fichier lié est rattaché à la mission ou au client, ou est un orphelin de qui saisit (MPV02)", async () => {
    const url = `/api/missions/${s.missionId}/preuves`;
    const dAutrui = await fichier(s.consultantEquipe.utilisateurId);
    const refus = await s.a.chef.post(url, { ...PREUVE_DOCUMENT, fichier_id: dAutrui });
    expect(refus.statusCode).toBe(400);
    expect(refus.json().erreur.code).toBe("PREUVE_INCOHERENTE");
    const supprime = await fichier(s.a.chef.utilisateurId, true);
    expect(
      (await s.a.chef.post(url, { ...PREUVE_DOCUMENT, fichier_id: supprime })).statusCode,
    ).toBe(400);
    const mien = await fichier(s.a.chef.utilisateurId);
    const ok = await s.a.chef.post(url, { ...PREUVE_DOCUMENT, fichier_id: mien });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().fichier_id).toBe(mien);
    // La correction garde le fichier de la version précédente.
    const corr = await s.a.chef.post(`/api/preuves/${ok.json().id}/versions`, {
      ...PREUVE_DOCUMENT,
      fichier_id: mien,
      fiabilite: "B",
      motif: "Fiabilité revue",
    });
    expect(corr.statusCode).toBe(201);
  });
});
