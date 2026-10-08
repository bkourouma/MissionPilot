import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCabinet } from "@missionpilot/shared";
import type { Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { factureDatee, feuilleValidee } from "./finance-outils.js";
import { creerMissionSignee, TOUS_LES_ROLES } from "./missions-outils.js";
import { missionTemps, type MissionTemps } from "./temps-outils.js";

/*
 * Reproduction chiffrée des indicateurs de pilotage du cabinet (PRD) sur un
 * jeu de données CALCULÉ À LA MAIN. Période du lundi 2026-09-07 au dimanche
 * 2026-10-04 : 4 semaines, 20 jours ouvrés, aucun jour férié saisi.
 *
 * Cabinet : 4 collaborateurs internes à 100 % (junior, senior S, manager M,
 * associé), coûts journaliers 50 000 / 90 000 / 150 000 / 300 000 FCFA.
 * Taux standard : senior 200 000, manager 300 000.
 * Mission en régie signée le 2026-09-01, tâche « Diagnostic » budgétée
 * senior 10 j + manager 5 j = 15 j :
 *   honoraires budget = 10 × 200 000 + 5 × 300 000 = 3 500 000
 *   coûts budget      = 10 × 90 000 + 5 × 150 000   = 1 650 000 → marge 1 850 000
 * Temps validés : S 8 j (2 par semaine), M 2 j (semaine 1) = 10 j.
 * Reste à faire déclaré : S 4 j, M 2 j → atterrissage 16 j, écart +1 j.
 *   atterrissage des coûts = 12 × 90 000 + 4 × 150 000 = 1 680 000 → +30 000
 * Affectations : S 10 j (07→18/09), M 5 j (07→11/09) → 15 j affectés.
 * Facture émise le 2026-09-30 : 1 500 000 HT (TVA 18 % : 1 770 000 TTC),
 * encaissée en totalité le 2026-10-02 (délai 2 j).
 * Feuilles de S (seul rattaché à un utilisateur) : soumises le 11/09 (à
 * temps), 22/09 (en retard, limite 20/09), 27/09 et 02/10 (à temps) → 3/4.
 * Jalons : prévu le 20/09 atteint le 18/09 (tenu), prévu le 25/09 non atteint.
 *
 *   Taux d'occupation       = 15 / 80                       = 0,1875
 *   Taux de facturabilité   = 10 / 80                       = 0,125
 *   Consommation budgétaire = 10 / 15                       = 0,6667
 *   Écart à terminaison     = 16 − 15 = +1 j (0,0667) ; +30 000 FCFA de coûts
 *   Marge                   = 1 500 000 − 8 × 90 000 − 2 × 150 000 = 480 000 (0,32)
 *   Valeur produite         = 8 × 200 000 + 2 × 300 000     = 2 200 000
 *   Taux de réalisation     = 1 500 000 / 2 200 000         = 0,6818
 *   Encours de production   = 2 200 000 − 1 500 000         = 700 000
 *   Carnet de commandes     = 3 500 000 − 2 200 000         = 1 300 000
 *   Délai moyen d'encaissement = 2 j ; respect des jalons 1/2 ; discipline 3/4
 */

let ctx: Contexte;
let c: CabinetFacturation;
let m: MissionTemps;
const DU = "2026-09-07";
const AU = "2026-10-04";
const SEMAINES = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"];
const SOUMISES = ["2026-09-11", "2026-09-22", "2026-09-27", "2026-10-02"];
const jourSuivant = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await demarrer();
  c = await preparerFacturation(ctx, "Cabinet Indicateurs");
  const S = c.collaborateurs.senior as string;
  const M = c.collaborateurs.manager as string;
  await proprietaire(async (cl) => {
    await cl.query(
      `UPDATE grades SET taux_vente_standard = CASE code WHEN 'senior' THEN 200000 ELSE 300000 END,
         devise = 'XOF' WHERE cabinet_id = $1 AND code IN ('senior', 'manager')`,
      [c.cabinetId],
    );
    await cl.query("UPDATE collaborateurs SET cree_le = '2026-01-01' WHERE cabinet_id = $1", [
      c.cabinetId,
    ]);
    await cl.query("UPDATE collaborateurs SET utilisateur_id = $2 WHERE id = $1", [
      S,
      c.chef.utilisateurId,
    ]);
  });
  m = await missionTemps(
    c,
    { Diagnostic: { senior: 10, manager: 5 } },
    { intitule: "Audit chiffré", debut: "2026-09-07", fin: "2026-11-27" },
  );
  attendre(
    200,
    await c.directeur.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-09-01" }),
    "signature",
  );
  const tache = m.taches.Diagnostic as string;
  await proprietaire(async (cl) => {
    await cl.query(
      `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, jours_alloues,
         date_debut, date_fin)
       VALUES ($1, $2, $3, $4, 10, '2026-09-07', '2026-09-18'),
              ($1, $2, $3, $5, 5, '2026-09-07', '2026-09-11')`,
      [c.cabinetId, m.id, tache, S, M],
    );
    await cl.query(
      `INSERT INTO mission_jalons (cabinet_id, mission_id, libelle, date_prevue, atteint, modifie_le)
       VALUES ($1, $2, 'Note de cadrage', '2026-09-20', true, '2026-09-18T10:00:00Z'),
              ($1, $2, 'Rapport de diagnostic', '2026-09-25', false, now())`,
      [c.cabinetId, m.id],
    );
    await cl.query(
      `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id, semaine, centiemes,
         declare_par)
       VALUES ($1, $2, $3, $4, '2026-09-28', 400, $6), ($1, $2, $3, $5, '2026-09-28', 200, $6)`,
      [c.cabinetId, m.id, tache, S, M, c.chef.utilisateurId],
    );
  });
  for (const [i, semaine] of SEMAINES.entries()) {
    await feuilleValidee({
      cabinetId: c.cabinetId,
      collaborateurId: S,
      semaine,
      auteurId: c.chef.utilisateurId,
      soumiseLe: SOUMISES[i],
      lignes: [semaine, jourSuivant(semaine)].map((date) => ({
        date,
        missionId: m.id,
        tacheId: tache,
        jours: 1,
      })),
    });
  }
  await feuilleValidee({
    cabinetId: c.cabinetId,
    collaborateurId: M,
    semaine: "2026-09-07",
    importePar: c.associeId,
    lignes: ["2026-09-07", "2026-09-08"].map((date) => ({
      date,
      missionId: m.id,
      tacheId: tache,
      jours: 1,
    })),
  });
  const f = await factureDatee(ctx, c, m.id, 1_500_000, "2026-09-30");
  attendre(
    201,
    await c.gestionnaire.post("/api/finance/encaissements", {
      client_id: c.clientId,
      date: "2026-10-02",
      montant: 1_770_000,
      mode: "virement",
      reference: "VIR-IND-1",
      imputations: [{ facture_id: f.id, montant: 1_770_000 }],
    }),
    "encaissement",
  );
});
afterAll(() => ctx.fermer());

const indicateurs = (par: Api, niveau = "cabinet") =>
  par.get(`/api/indicateurs/cabinet?du=${DU}&au=${AU}&niveau=${niveau}`);

describe("indicateurs de pilotage du cabinet : jeu calculé à la main", () => {
  it("niveau cabinet (gestionnaire : tous les droits financiers)", async () => {
    const r = await indicateurs(c.gestionnaire);
    expect(r.statusCode).toBe(200);
    expect(r.json().cabinet).toEqual({
      jours_disponibles: 80,
      jours_affectes: 15,
      taux_occupation: 0.1875,
      jours_facturables: 10,
      taux_facturabilite: 0.125,
      discipline_saisie: { reussis: 3, attendus: 4, taux: 0.75 },
      nombre_missions: 1,
      jours_budget: 15,
      jours_realises: 10,
      jours_atterrissage: 16,
      consommation_budgetaire: 0.6667,
      ecart_terminaison: { jours: 1, relatif_jours: 0.0667, couts_production: 30_000 },
      respect_jalons: { reussis: 1, attendus: 2, taux: 0.5 },
      marge: {
        honoraires: 1_500_000,
        couts_internes: 1_020_000,
        debours_non_refactures: 0,
        sous_traitance: 0,
        marge: 480_000,
        taux_marge: 0.32,
      },
      taux_realisation: 0.6818,
      encours: { encours_production: 700_000, facture_d_avance: 0 },
      carnet_commandes: 1_300_000,
      // Signé 3 500 000 − facturé 1 500 000.
      carnet_commandes_facture: 2_000_000,
      delai_moyen_encaissement: 2,
      factures_soldees: 1,
    });
    expect(r.json().devise).toBe("XOF");
  });

  it("niveaux collaborateur, grade, mission, associé et client", async () => {
    const parCollaborateur = (await indicateurs(c.gestionnaire, "collaborateur")).json().elements;
    expect(
      parCollaborateur.find(
        (x: { collaborateur_id: string }) => x.collaborateur_id === c.collaborateurs.senior,
      ),
    ).toMatchObject({
      jours_disponibles: 20,
      jours_affectes: 10,
      taux_occupation: 0.5,
      jours_facturables: 8,
      taux_facturabilite: 0.4,
      discipline_saisie: { reussis: 3, attendus: 4, taux: 0.75 },
    });
    const parGrade = (await indicateurs(c.gestionnaire, "grade")).json().elements;
    expect(parGrade.find((g: { grade_code: string }) => g.grade_code === "manager")).toMatchObject({
      nombre_collaborateurs: 1,
      jours_affectes: 5,
      taux_occupation: 0.25,
      jours_facturables: 2,
      taux_facturabilite: 0.1,
    });
    const [mission] = (await indicateurs(c.gestionnaire, "mission")).json().elements;
    expect(mission).toMatchObject({
      mission_id: m.id,
      consommation_budgetaire: 0.6667,
      respect_jalons: { taux: 0.5 },
      taux_realisation: 0.6818,
      encours: { encours_production: 700_000 },
    });
    const [associe] = (await indicateurs(c.gestionnaire, "associe")).json().elements;
    expect(associe).toMatchObject({
      directeur_id: c.directeur.utilisateurId,
      ecart_terminaison: { jours: 1, couts_production: 30_000 },
      carnet_commandes: 1_300_000,
    });
    const [client] = (await indicateurs(c.gestionnaire, "client")).json().elements;
    expect(client).toMatchObject({
      client_id: c.clientId,
      delai_moyen_encaissement: 2,
      marge: { marge: 480_000 },
    });
  });

  it("sans finance.lire : coûts, marges, réalisation et encours ABSENTS ; matrice des rôles", async () => {
    const r = (await indicateurs(c.directeur)).json();
    expect(r.cabinet).not.toHaveProperty("marge");
    expect(r.cabinet).not.toHaveProperty("taux_realisation");
    expect(r.cabinet).not.toHaveProperty("encours");
    expect(r.cabinet.ecart_terminaison).toEqual({ jours: 1, relatif_jours: 0.0667 });
    // Carnet valorisé (dérivé des taux de vente) ABSENT ; carnet sur le facturé servi.
    expect(r.cabinet).not.toHaveProperty("carnet_commandes");
    expect(r.cabinet.carnet_commandes_facture).toBe(2_000_000);
    expect(JSON.stringify(r)).not.toMatch(/480000|1020000|1300000|2200000|couts_internes/);
    const attendus: Record<RoleCabinet, number> = {
      associe: 200,
      directeur_mission: 200,
      gestionnaire: 200,
      chef_mission: 403,
      consultant: 403,
      ressources: 403,
      expert_metier: 403,
      expert_externe: 403,
    };
    for (const role of TOUS_LES_ROLES) {
      const u = await c.avecRoles([role]);
      expect((await indicateurs(u)).statusCode, role).toBe(attendus[role]);
    }
    for (const q of [
      "du=2026-09-07",
      `du=${AU}&au=${DU}`,
      "du=2026-01-01&au=2027-06-01",
      `du=${DU}&au=${AU}&niveau=x`,
    ]) {
      expect((await c.gestionnaire.get(`/api/indicateurs/cabinet?${q}`)).statusCode, q).toBe(400);
    }
  });

  it("M2 : directeur sans finance.lire : aucun champ dérivé des taux, rien ne se déduit jour par jour", async () => {
    // Le senior a 1 j validé le 2026-09-15 (taux de vente 200 000) : avant le
    // correctif, carnet_commandes(au=15/09) − carnet_commandes(au=14/09) = 200 000.
    const NON_MONETAIRES = new Set([
      "nombre_missions",
      "consommation_budgetaire",
      "ecart_terminaison",
      "respect_jalons",
      "taux_occupation",
      "taux_facturabilite",
      "discipline_saisie",
      "delai_moyen_encaissement",
      "factures_soldees",
      "mission_id",
      "intitule",
      "client_id",
      "directeur_id",
      "devise_mission",
      "nom",
    ]);
    const montants = (o: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(o).filter(([k]) => !k.startsWith("jours_") && !NON_MONETAIRES.has(k)),
      );
    const lire = async (au: string, niveau: string) => {
      const r = await c.directeur.get(
        `/api/indicateurs/cabinet?du=${DU}&au=${au}&niveau=${niveau}`,
      );
      expect(r.statusCode, r.body).toBe(200);
      return r.json();
    };
    for (const niveau of ["cabinet", "mission", "associe"]) {
      const [j14, j15] = [await lire("2026-09-14", niveau), await lire("2026-09-15", niveau)];
      for (const r of [j14, j15]) {
        expect(JSON.stringify(r)).not.toMatch(
          /"carnet_commandes"|valeur_produite|taux_realisation|encours|marge|couts_/,
        );
      }
      // Le temps a bien changé (jours visibles), mais aucun montant.
      expect(j15.cabinet.jours_facturables).toBeGreaterThan(j14.cabinet.jours_facturables);
      expect(montants(j15.cabinet)).toEqual(montants(j14.cabinet));
      expect(j15.elements.map(montants)).toEqual(j14.elements.map(montants));
      expect(montants(j14.cabinet)).toEqual({ carnet_commandes_facture: 3_500_000 });
    }
  });

  it("rentabilité (FIN-12) par mission et par associé ; finance.lire obligatoire", async () => {
    const r = await c.gestionnaire.get(`/api/finance/rentabilite?niveau=mission&du=${DU}&au=${AU}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().elements).toEqual([
      {
        cle: m.id,
        libelle: "Audit chiffré",
        nombre_missions: 1,
        honoraires: 1_500_000,
        couts_internes: 1_020_000,
        debours_non_refactures: 0,
        sous_traitance: 0,
        marge: 480_000,
        taux_marge: 0.32,
        valeur_produite: 2_200_000,
        budget: { honoraires: 3_500_000, marge: 1_850_000, jours: 15 },
        realise: { jours: 10 },
        atterrissage: { jours: 16 },
      },
    ]);
    expect(r.json().total).toMatchObject({ nombre_missions: 1, marge: 480_000, taux_marge: 0.32 });
    const associe = (
      await c.associe.get(`/api/finance/rentabilite?niveau=associe&du=${DU}&au=${AU}`)
    ).json();
    expect(associe.elements[0]).toMatchObject({ cle: c.directeur.utilisateurId, marge: 480_000 });
    // Période sans activité : aucun élément.
    const vide = (
      await c.gestionnaire.get("/api/finance/rentabilite?niveau=client&du=2026-01-01&au=2026-01-31")
    ).json();
    expect(vide.elements).toEqual([]);
    for (const role of TOUS_LES_ROLES) {
      const u = await c.avecRoles([role]);
      const statut = (await u.get(`/api/finance/rentabilite?du=${DU}&au=${AU}`)).statusCode;
      expect(statut, role).toBe(["associe", "gestionnaire"].includes(role) ? 200 : 403);
    }
    expect((await c.gestionnaire.get("/api/finance/rentabilite?du=2026-01-01")).statusCode).toBe(
      400,
    );
    // Période bornée à 366 jours (audit M3).
    expect(
      (await c.gestionnaire.get("/api/finance/rentabilite?du=2000-01-01&au=2026-10-04")).statusCode,
    ).toBe(400);
  });

  it("encours de production (FIN-11) : valorisé avec finance.lire, jours seuls sinon", async () => {
    const r = (await c.gestionnaire.get(`/api/finance/encours?date=${AU}`)).json();
    expect(r.cabinet).toEqual({ devise: "XOF", encours_production: 700_000, facture_d_avance: 0 });
    expect(r.missions[0]).toMatchObject({
      mission_id: m.id,
      jours_valides: 10,
      valeur_produite: 2_200_000,
      honoraires_factures: 1_500_000,
      encours_production: 700_000,
    });
    // Avant la facture : tout est encours.
    const avant = (
      await c.gestionnaire.get(`/api/missions/${m.id}/encours?date=2026-09-29`)
    ).json();
    expect(avant).toMatchObject({ encours_production: 2_200_000, facture_d_avance: 0 });
    const d = (await c.directeur.get(`/api/finance/encours?date=${AU}`)).json();
    expect(d).not.toHaveProperty("cabinet");
    expect(d.missions[0]).toEqual({
      mission_id: m.id,
      intitule: "Audit chiffré",
      client_id: c.clientId,
      statut: "signee",
      jours_valides: 10,
    });
    const consultant = await c.avecRoles(["consultant"]);
    expect((await consultant.get("/api/finance/encours")).statusCode).toBe(403);
  });

  it("bilan de clôture : snapshot immuable, retour d'expérience 30 jours", async () => {
    attendre(
      200,
      await c.directeur.post(`/api/missions/${m.id}/statut`, { statut: "en_cours" }),
      "en cours",
    );
    attendre(
      200,
      await c.directeur.post(`/api/missions/${m.id}/statut`, { statut: "a_cloturer" }),
      "à clôturer",
    );
    attendre(200, await c.directeur.post(`/api/missions/${m.id}/cloturer`), "clôture");
    const g = (await c.gestionnaire.get(`/api/missions/${m.id}/bilan`)).json();
    expect(g.jours).toMatchObject({
      budget: 15,
      realise: 10,
      reste_a_faire: 6,
      atterrissage: 16,
      ecart_atterrissage: 1,
      ecart_realise: -5,
      consommation: 0.6667,
    });
    expect(g.finance).toMatchObject({
      devise: "XOF",
      budget: { honoraires: 3_500_000, couts_internes: 1_650_000, marge: 1_850_000 },
      realise: {
        honoraires_factures: 1_500_000,
        valeur_produite: 2_200_000,
        valeur_standard: 2_200_000,
        couts_internes: 1_020_000,
        marge: 480_000,
        taux_marge: 0.32,
      },
      taux_realisation: 0.6818,
      ecart: { jours: -5, couts_production: -630_000, marge: -1_370_000 },
      encours: { encours_production: 700_000, facture_d_avance: 0 },
    });
    // Version « atterrissage » (FIN-03) : régie, jours d'atterrissage par grade.
    expect(g.atterrissage).toMatchObject({
      type: "atterrissage",
      synthese: { honoraires: 3_600_000, couts_internes: 1_680_000, marge: 1_920_000 },
      ecart_terminaison: { jours: 1, couts_production: 30_000 },
    });
    // Directeur (sans finance.lire) : jours seulement.
    const d = (await c.directeur.get(`/api/missions/${m.id}/bilan`)).json();
    expect(d).not.toHaveProperty("finance");
    expect(d).not.toHaveProperty("atterrissage");
    expect(d.jours.atterrissage).toBe(16);

    // Retour d'expérience : directeur oui, chef non ; journalisé.
    expect(
      (await c.chef.patch(`/api/missions/${m.id}/bilan/retour-experience`, { texte: "x" }))
        .statusCode,
    ).toBe(403);
    const rex = await c.directeur.patch(`/api/missions/${m.id}/bilan/retour-experience`, {
      texte: "Cadrer plus tôt les entretiens.",
    });
    expect(rex.statusCode).toBe(200);
    expect(rex.json().retour_experience).toBe("Cadrer plus tôt les entretiens.");
    expect(
      (await c.directeur.patch(`/api/missions/${m.id}/bilan/retour-experience`, { texte: "" }))
        .statusCode,
    ).toBe(400);
    const audit = (await c.associe.get("/api/audit?entite=bilan_mission")).json();
    expect(JSON.stringify(audit)).toContain("retour_experience");

    // Immuabilité en SQL direct (rôle applicatif, puis propriétaire).
    for (const sql of [
      "UPDATE bilans_mission SET jours = '{}' WHERE mission_id = $1",
      "DELETE FROM bilans_mission WHERE mission_id = $1",
    ]) {
      await expect(
        ctx.db.withTenant(c.cabinetId, (db) => db.query(sql, [m.id])),
      ).rejects.toMatchObject({
        code: "42501",
      });
    }
    await expect(
      proprietaire((cl) =>
        cl.query("UPDATE bilans_mission SET finance = '{}' WHERE mission_id = $1", [m.id]),
      ),
    ).rejects.toMatchObject({ code: "MPE03" });

    // Clôture ancienne de plus de 30 jours : retour d'expérience figé.
    const autre = await creerMissionSignee(c, { mode_facturation: "forfait" });
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO bilans_mission (cabinet_id, mission_id, cloture_le, date_cloture, devise, jours,
           finance, atterrissage, cree_par)
         VALUES ($1, $2, now() - interval '40 days', current_date - 40, 'XOF', '{}', '{}', '{}', $3)`,
        [c.cabinetId, autre.id, c.associeId],
      ),
    );
    const tard = await c.associe.patch(`/api/missions/${autre.id}/bilan/retour-experience`, {
      texte: "Trop tard",
    });
    expect(tard.statusCode).toBe(409);
    expect(tard.json().erreur.code).toBe("DELAI_DEPASSE");
    await expect(
      ctx.db.withTenant(c.cabinetId, (db) =>
        db.query("UPDATE bilans_mission SET retour_experience = 'x' WHERE mission_id = $1", [
          autre.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPE04" });
  });

  it("isolation : un autre cabinet ne voit ni le bilan ni les indicateurs de celui-ci", async () => {
    const autre = await preparerFacturation(ctx, "Cabinet Indicateurs B", false);
    expect((await autre.associe.get(`/api/missions/${m.id}/bilan`)).statusCode).toBe(404);
    expect((await autre.associe.get(`/api/missions/${m.id}/encours`)).statusCode).toBe(404);
    const r = (await indicateurs(autre.gestionnaire)).json();
    expect(r.cabinet).toMatchObject({ nombre_missions: 0, jours_affectes: 0, factures_soldees: 0 });
    const rent = (
      await autre.gestionnaire.get(`/api/finance/rentabilite?du=${DU}&au=${AU}`)
    ).json();
    expect(rent.elements).toEqual([]);
  });
});
