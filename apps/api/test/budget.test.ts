import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMissionSignee,
  preparerCabinet,
  TOUS_LES_ROLES,
  type CabinetMissions,
} from "./missions-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Budget A");
  b = await preparerCabinet(ctx, "Cabinet Budget B");
});
afterAll(() => ctx.fermer());

/**
 * Mission vierge budgétée à la main : 10 j senior + 2 j manager sur une tâche,
 * plus 3 j du collaborateur senior nommé sur une autre.
 * Taux standard (catalogue) : senior 175 000, manager 275 000 FCFA.
 * Coûts (fixtures) : senior 90 000, manager 150 000 FCFA.
 */
async function missionChiffree(c: CabinetMissions): Promise<string> {
  const m = await c.associe.post("/api/missions", {
    intitule: "Audit chiffré",
    client_id: c.clientId,
    mode_facturation: "forfait",
    directeur_id: c.directeur.utilisateurId,
    chef_id: c.chef.utilisateurId,
    date_debut: "2026-11-02",
  });
  const id = m.json().id as string;
  const phase = (await c.chef.post(`/api/missions/${id}/phases`, { libelle: "Diagnostic" })).json();
  const t1 = (
    await c.chef.post(`/api/missions/${id}/taches`, { parent_id: phase.id, libelle: "Entretiens" })
  ).json();
  const t2 = (
    await c.chef.post(`/api/missions/${id}/taches`, { parent_id: phase.id, libelle: "Analyse" })
  ).json();
  const budget = (tacheId: string, lignes: unknown[]) =>
    c.chef.put(`/api/missions/${id}/taches/${tacheId}/budget`, { lignes });
  expect(
    (
      await budget(t1.id, [
        { grade_id: c.grades.senior, jours: 10 },
        { grade_id: c.grades.manager, jours: 2 },
      ])
    ).statusCode,
  ).toBe(200);
  expect(
    (await budget(t2.id, [{ collaborateur_id: c.collaborateurs.senior, jours: 3 }])).statusCode,
  ).toBe(200);
  return id;
}

async function signer(c: CabinetMissions, id: string, corps: Record<string, unknown> = {}) {
  const r = await c.directeur.post(`/api/missions/${id}/signer`, {
    date_signature: "2026-10-01",
    lignes_supplementaires: [
      { nature: "debours", libelle: "Billets d'avion", montant: 400_000, refacturable: true },
      { nature: "sous_traitance", libelle: "Enquête terrain", montant: 600_000 },
    ],
    ...corps,
  });
  expect(r.statusCode).toBe(200);
  return r.json();
}

describe("budget initial figé à la signature (MIS-07, FIN-01, FIN-03)", () => {
  it("calcule honoraires, coûts et marge par les moteurs", async () => {
    const id = await missionChiffree(a);
    const s = await signer(a, id);
    // Honoraires : 10×175 000 + 2×275 000 + 3×175 000 = 2 825 000.
    // Coûts internes : 10×90 000 + 2×150 000 + 3×90 000 = 1 470 000.
    // Marge : 2 825 000 − 1 470 000 − 600 000 (sous-traitance) = 755 000.
    // Le directeur signataire n'a pas « finance.lire » : coûts et marge absents de sa réponse.
    expect(s.budget_initial.synthese).not.toHaveProperty("marge");
    expect(s).not.toHaveProperty("couts_manquants");
    const complet = (await a.associe.get(`/api/missions/${id}/budget`)).json().versions[0];
    expect(complet.synthese).toEqual({
      devise: "XOF",
      jours_vendus: 15,
      honoraires: 2_825_000,
      debours_refacturables: 400_000,
      debours_non_refacturables: 0,
      couts_internes: 1_470_000,
      sous_traitance: 600_000,
      marge: 755_000,
      taux_marge: 0.2673, // ratio arrondi par le moteur
      jours_production: 15,
    });
    const cles = complet.lignes.map((l: { cle: string }) => l.cle).sort();
    expect(cles).toEqual(
      [
        `cout_interne:collaborateur:${a.collaborateurs.senior}`,
        "cout_interne:grade:manager",
        "cout_interne:grade:senior",
        "debours:billets_d_avion",
        `honoraires:collaborateur:${a.collaborateurs.senior}`,
        "honoraires:grade:manager",
        "honoraires:grade:senior",
        "sous_traitance:enquete_terrain",
      ].sort(),
    );
  });

  it("une version figée refusée par le moteur (PUT lignes → 409 BUDGET_FIGE)", async () => {
    const id = await missionChiffree(a);
    const s = await signer(a, id);
    const r = await a.associe.put(
      `/api/missions/${id}/budget/versions/${s.budget_initial.id}/lignes`,
      { lignes: [{ libelle: "Rabais", nature: "honoraires", montant_forfait: 1 }] },
    );
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("BUDGET_FIGE");
    expect(
      (await a.associe.delete(`/api/missions/${id}/budget/versions/${s.budget_initial.id}`))
        .statusCode,
    ).toBe(409);
    expect(
      (await a.directeur.post(`/api/missions/${id}/budget/versions/${s.budget_initial.id}/valider`))
        .statusCode,
    ).toBe(409);
  });

  it("protégée en base : le rôle applicatif ne modifie, ne supprime ni n'ajoute rien", async () => {
    const id = await missionChiffree(a);
    const versionId = (await signer(a, id)).budget_initial.id;
    const sql = (texte: string, params: unknown[]) =>
      ctx.db.withTenant(a.cabinetId, (db) => db.query(texte, params));
    const figee = { code: "MPF01" };
    await expect(
      sql("UPDATE budget_lignes SET prix_journalier = 1 WHERE version_id = $1", [versionId]),
    ).rejects.toMatchObject(figee);
    await expect(
      sql("DELETE FROM budget_lignes WHERE version_id = $1", [versionId]),
    ).rejects.toMatchObject(figee);
    await expect(
      sql(
        `INSERT INTO budget_lignes (cabinet_id, mission_id, version_id, cle, libelle, nature, montant_forfait)
         VALUES ($1, $2, $3, 'pirate', 'Pirate', 'debours', 1)`,
        [a.cabinetId, id, versionId],
      ),
    ).rejects.toMatchObject(figee);
    await expect(
      sql("UPDATE budget_versions SET figee = false, date_figeage = NULL WHERE id = $1", [
        versionId,
      ]),
    ).rejects.toMatchObject(figee);
    await expect(
      sql("UPDATE budget_versions SET motif = 'x' WHERE id = $1", [versionId]),
    ).rejects.toMatchObject(figee);
    // Seule une révision non figée peut être abandonnée (supprimée).
    await expect(
      sql("DELETE FROM budget_versions WHERE id = $1", [versionId]),
    ).rejects.toMatchObject(figee);
    // Rien n'a bougé.
    const lu = (await a.associe.get(`/api/missions/${id}/budget`)).json();
    expect(lu.versions[0].synthese.honoraires).toBe(2_825_000);
  });
});

describe("révisions (FIN-03) et seuils d'approbation (FIN-15)", () => {
  it("motif obligatoire, une seule révision en cours, historique conservé, comparaison", async () => {
    const id = await missionChiffree(a);
    const initial = (await signer(a, id)).budget_initial;
    const url = `/api/missions/${id}/budget/revisions`;
    expect((await a.chef.post(url, {})).statusCode).toBe(400);
    expect((await a.chef.post(url, { motif: "  " })).statusCode).toBe(400);

    const rev = await a.chef.post(url, { motif: "Avenant : extension du périmètre" });
    expect(rev.statusCode).toBe(201);
    expect(rev.json()).toMatchObject({ numero: 2, type: "revise", figee: false });
    expect((await a.chef.post(url, { motif: "Autre" })).statusCode).toBe(409);

    // Le chef (sans finance.lire) ajoute 4 j senior ; les coûts existants sont conservés.
    const lignes = [
      {
        cle: "honoraires:grade:senior",
        libelle: "Honoraires — senior",
        nature: "honoraires",
        jours: 14,
        prix_journalier: 175_000,
      },
      {
        cle: "honoraires:grade:manager",
        libelle: "Honoraires — manager",
        nature: "honoraires",
        jours: 2,
        prix_journalier: 275_000,
      },
    ];
    const versionUrl = `/api/missions/${id}/budget/versions/${rev.json().id}`;
    const coutParChef = await a.chef.put(`${versionUrl}/lignes`, {
      lignes: [...lignes, { libelle: "Coût", nature: "cout_interne", montant_forfait: 1 }],
    });
    expect(coutParChef.statusCode).toBe(403);
    const maj = await a.chef.put(`${versionUrl}/lignes`, { lignes });
    expect(maj.statusCode).toBe(200);
    expect(maj.json().synthese).toEqual({
      devise: "XOF",
      jours_vendus: 16,
      honoraires: 3_000_000,
      debours_refacturables: 0,
      debours_non_refacturables: 0,
    });
    const complete = (await a.associe.get(`/api/missions/${id}/budget`)).json();
    const revision = complete.versions.find((v: { id: string }) => v.id === rev.json().id);
    expect(revision.synthese.couts_internes).toBe(1_470_000);
    expect(revision.synthese.sous_traitance).toBe(600_000);

    const comp = await a.associe.get(
      `/api/missions/${id}/budget/comparaison?avant=${initial.id}&apres=${rev.json().id}`,
    );
    expect(comp.json()).toMatchObject({
      ecart_jours_vendus: 1,
      ecart_honoraires: 3_000_000 - 2_825_000,
      ecart_couts_internes: 0,
    });
    const compChef = (
      await a.chef.get(
        `/api/missions/${id}/budget/comparaison?avant=${initial.id}&apres=${rev.json().id}`,
      )
    ).json();
    expect(compChef).not.toHaveProperty("ecart_marge");
    expect(compChef).not.toHaveProperty("ecart_couts_internes");
    expect(compChef.lignes.some((l: { nature: string }) => l.nature === "cout_interne")).toBe(
      false,
    );

    // Le chef ne valide pas (pas de budget.reviser) ; le directeur valide (écart ≤ 10 M FCFA).
    expect((await a.chef.post(`${versionUrl}/valider`)).statusCode).toBe(403);
    const v = await a.directeur.post(`${versionUrl}/valider`);
    expect(v.statusCode).toBe(200);
    expect(v.json()).toMatchObject({ figee: true, role_approbateur: "directeur_mission" });

    const historique = (await a.chef.get(`/api/missions/${id}/budget`)).json();
    expect(historique.versions.map((x: { numero: number }) => x.numero)).toEqual([1, 2]);
    expect(historique.reference_id).toBe(rev.json().id);
    expect(historique.versions[0].synthese.honoraires).toBe(2_825_000);
  });

  it("au-delà de 10 M FCFA d'écart, seul un associé valide (APPROBATION_REQUISE)", async () => {
    const id = await missionChiffree(a);
    await signer(a, id);
    const rev = await a.associe.post(`/api/missions/${id}/budget/revisions`, {
      motif: "Extension majeure",
      lignes: [
        { libelle: "Forfait complémentaire", nature: "honoraires", montant_forfait: 20_000_000 },
      ],
    });
    expect(rev.statusCode).toBe(201);
    const url = `/api/missions/${id}/budget/versions/${rev.json().id}/valider`;
    const refus = await a.directeur.post(url);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    const ok = await a.associe.post(url);
    expect(ok.json()).toMatchObject({ figee: true, role_approbateur: "associe" });
  });

  it("recalcul depuis le découpage et abandon d'une révision en cours", async () => {
    const id = await missionChiffree(a);
    await signer(a, id);
    const d = (await a.chef.get(`/api/missions/${id}/decoupage`)).json();
    const tache = d.phases[0].taches.find((t: { libelle: string }) => t.libelle === "Entretiens");
    await a.chef.put(`/api/missions/${id}/taches/${tache.id}/budget`, {
      lignes: [{ grade_id: a.grades.senior, jours: 20 }],
    });
    const rev = await a.chef.post(`/api/missions/${id}/budget/revisions`, {
      motif: "Recalage sur le découpage",
      depuis_decoupage: true,
    });
    expect(rev.statusCode).toBe(201);
    // 20 j senior + 3 j du senior nommé : 23 j × 175 000 ; débours et sous-traitance repris.
    expect(rev.json().synthese).toMatchObject({ jours_vendus: 23, honoraires: 23 * 175_000 });
    expect(
      (await a.chef.delete(`/api/missions/${id}/budget/versions/${rev.json().id}`)).statusCode,
    ).toBe(204);
    const budget = (await a.chef.get(`/api/missions/${id}/budget`)).json();
    expect(budget.versions).toHaveLength(1);
  });

  it("révision impossible avant la signature", async () => {
    const id = await missionChiffree(a);
    expect(
      (await a.associe.post(`/api/missions/${id}/budget/revisions`, { motif: "x" })).statusCode,
    ).toBe(409);
  });
});

describe("matrice des droits sur le budget (FIN-02) : 8 rôles", () => {
  it("lecture : montants avec budget.lire_montants, coûts et marges avec finance.lire seulement", async () => {
    const { id } = await creerMissionSignee(a);
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      // Les rôles sans vue sur toutes les missions sont ajoutés à l'équipe.
      await a.associe.post(`/api/missions/${id}/equipe`, { utilisateur_id: u.utilisateurId });
      const r = await u.get(`/api/missions/${id}/budget`);
      const attendu = ["expert_metier", "expert_externe"].includes(role) ? 403 : 200;
      expect(r.statusCode, role).toBe(attendu);
      if (attendu !== 200) continue;
      const v = r.json().versions[0];
      const finance = ["associe", "gestionnaire"].includes(role);
      const montants = finance || ["directeur_mission", "chef_mission"].includes(role);
      for (const champ of ["couts_internes", "marge", "taux_marge", "sous_traitance"]) {
        expect(champ in v.synthese, `${role} ${champ}`).toBe(finance);
      }
      expect("honoraires" in v.synthese, `${role} honoraires`).toBe(montants);
      const natures = v.lignes.map((l: { nature: string }) => l.nature);
      expect(natures.includes("cout_interne"), `${role} lignes de coût`).toBe(finance);
      expect(
        v.lignes.some((l: Record<string, unknown>) => "prix_journalier" in l),
        `${role} prix`,
      ).toBe(montants);
      // Synthèse en jours : budget.lire_jours.
      expect((await u.get(`/api/missions/${id}/synthese`)).statusCode, role).toBe(attendu);
    }
  });

  it("écriture : révision budget.ecrire, validation budget.reviser", async () => {
    const { id } = await creerMissionSignee(a);
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      await a.associe.post(`/api/missions/${id}/equipe`, { utilisateur_id: u.utilisateurId });
      const r = await u.post(`/api/missions/${id}/budget/revisions`, { motif: `Essai ${role}` });
      const peut = ["associe", "directeur_mission"].includes(role);
      // Un chef simple membre de l'équipe (pas chef de cette mission) ne modifie pas : 403.
      expect(r.statusCode, role).toBe(peut ? 201 : 403);
      if (r.statusCode === 201) {
        await u.delete(`/api/missions/${id}/budget/versions/${r.json().id}`);
      }
    }
  });

  it("le journal du budget ne contient aucun montant", async () => {
    const id = await missionChiffree(a);
    await signer(a, id);
    const rev = (
      await a.chef.post(`/api/missions/${id}/budget/revisions`, { motif: "Motif journalisé" })
    ).json();
    await a.directeur.post(`/api/missions/${id}/budget/versions/${rev.id}/valider`);
    const details = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT details FROM journal_audit WHERE entite = 'budget_version' OR entite_id = $1`,
            [id],
          )
        ).rows,
    );
    expect(details.length).toBeGreaterThan(0);
    expect(JSON.stringify(details)).not.toMatch(/prix|montant|cout|honoraires|175000|2825000/);
  });
});

describe("isolation du budget entre cabinets", () => {
  it("version, comparaison, révision et validation d'un autre cabinet : 404", async () => {
    const { id, signature } = await creerMissionSignee(b);
    const versionId = (signature.budget_initial as { id: string }).id;
    const propre = await creerMissionSignee(a);
    const propreVersion = (propre.signature.budget_initial as { id: string }).id;
    for (const r of [
      await a.associe.get(`/api/missions/${id}/budget`),
      await a.associe.put(`/api/missions/${id}/budget/versions/${versionId}/lignes`, {
        lignes: [],
      }),
      await a.associe.post(`/api/missions/${id}/budget/versions/${versionId}/valider`),
      // Version d'un autre cabinet sur sa propre mission : 404 aussi.
      await a.associe.get(
        `/api/missions/${propre.id}/budget/comparaison?avant=${propreVersion}&apres=${versionId}`,
      ),
      await a.associe.post(`/api/missions/${propre.id}/budget/versions/${versionId}/valider`),
    ]) {
      expect(r.statusCode).toBe(404);
    }
  });
});
