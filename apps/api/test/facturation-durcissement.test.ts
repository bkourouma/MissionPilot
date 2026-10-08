import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decoder, totp } from "../src/auth/totp.js";
import type { Api } from "./api.js";
import { demarrer, MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee, type ApiUtilisateur } from "./missions-outils.js";
import {
  attendre as attendreTemps,
  consultantAffecte,
  lignesSemaine,
  missionTemps,
  saisirEtSoumettre,
} from "./temps-outils.js";
import {
  aFacturer,
  attendre,
  emettreFacture,
  missionAvecEcheancier,
  preparerFacturation,
  type CabinetFacturation,
  type EcheanceTest,
} from "./facturation-outils.js";

/*
 * Non-régression de l'audit de sécurité du commit 6f28b95 (facturation) :
 * chaque test rejoue le scénario d'attaque ; il échouait avant la correction.
 * M1 seuils FIN-15 contournables, M3 IBAN sans reconfirmation, F1 écritures
 * directes en base, F2 séparation des tâches, F6 taux de vente de la régie,
 * F7 échéance d'une mission invisible.
 */

let ctx: Contexte;
let c: CabinetFacturation;

beforeAll(async () => {
  ctx = await demarrer();
  c = await preparerFacturation(ctx, "Cabinet Durcissement Facturation");
});
afterAll(async () => {
  // Alertes de sécurité mises en file (M3, M5) : base de test partagée, rien ne doit rester.
  await proprietaire((cl) => cl.query("DELETE FROM jobs WHERE type = 'envoyer_email'"));
  await ctx.fermer();
});

/** Mission signée au forfait dont le budget dépasse 40 M FCFA (révision validée). */
async function missionBudgetEleve(): Promise<string> {
  const m = await creerMissionSignee(c, { mode_facturation: "forfait" });
  const rev = await c.associe.post(`/api/missions/${m.id}/budget/revisions`, {
    motif: "Extension du périmètre",
    lignes: [
      { libelle: "Forfait complémentaire", nature: "honoraires", montant_forfait: 50_000_000 },
    ],
  });
  attendre(201, rev, "révision");
  attendre(
    200,
    await c.associe.post(`/api/missions/${m.id}/budget/versions/${rev.json().id}/valider`),
    "validation",
  );
  return m.id;
}

async function echeance(par: Api, missionId: string, montant: number, libelle: string) {
  const r = await par.post(`/api/missions/${missionId}/echeances`, {
    type: "jalon",
    libelle,
    montant,
    date_prevue: "2026-12-15",
  });
  attendre(201, r, "échéance");
  return r.json() as EcheanceTest;
}

async function brouillonSur(missionId: string, echeanceId: string): Promise<string> {
  await aFacturer(c.gestionnaire, echeanceId);
  const f = await c.gestionnaire.post(`/api/missions/${missionId}/factures`, {
    echeance_ids: [echeanceId],
  });
  attendre(201, f, "brouillon");
  return f.json().id as string;
}

describe("M1 a : seuils d'approbation sur le cumul de la mission (FIN-15)", () => {
  it("deux factures de 20 M approuvées par le directeur : la seconde exige un associé", async () => {
    const id = await missionBudgetEleve();
    const e1 = await echeance(c.gestionnaire, id, 20_000_000, "Tranche 1");
    const e2 = await echeance(c.gestionnaire, id, 20_000_000, "Tranche 2");

    const f1 = await brouillonSur(id, e1.id);
    const s1 = await c.gestionnaire.post(`/api/factures/${f1}/soumettre`);
    // 20 M ≤ 25 M : palier « directeur » pour la première.
    expect(s1.json().role_approbateur).toBe("directeur_mission");
    attendre(200, await c.directeur.post(`/api/factures/${f1}/approuver`), "approbation 1");

    const f2 = await brouillonSur(id, e2.id);
    const s2 = await c.gestionnaire.post(`/api/factures/${f2}/soumettre`);
    // Cumul 40 M > 25 M : un associé, même si la facture seule reste sous le seuil.
    expect(s2.json().role_approbateur).toBe("associe");
    const refus = await c.directeur.post(`/api/factures/${f2}/approuver`);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    attendre(200, await c.associe.post(`/api/factures/${f2}/approuver`), "approbation associé");
  });
});

describe("M1 b : baisse de l'échéancier soumise au palier « remise »", () => {
  it("baisse d'une échéance de 10 M à 1 M par le directeur : refusée ; par un associé : admise", async () => {
    const m = await creerMissionSignee(c, { mode_facturation: "forfait" }); // budget 15,6 M
    const e = await echeance(c.directeur, m.id, 10_000_000, "Jalon principal");
    const baisse = await c.directeur.patch(`/api/echeances/${e.id}`, { montant: 1_000_000 });
    expect(baisse.statusCode).toBe(403);
    expect(baisse.json().erreur.code).toBe("APPROBATION_REQUISE");
    const suppression = await c.directeur.delete(`/api/echeances/${e.id}`);
    expect(suppression.statusCode).toBe(403);
    const inchangee = (await c.directeur.get(`/api/missions/${m.id}/echeancier`)).json();
    expect(inchangee.echeances[0].montant).toBe(10_000_000);
    expect(
      (await c.associe.patch(`/api/echeances/${e.id}`, { montant: 1_000_000 })).statusCode,
    ).toBe(200);
    // Une hausse reste libre dans la limite du budget.
    expect(
      (await c.directeur.patch(`/api/echeances/${e.id}`, { montant: 2_000_000 })).statusCode,
    ).toBe(200);
  });

  it("l'écart est CUMULÉ : de petites baisses successives ne contournent pas le palier", async () => {
    const m = await missionAvecEcheancier(c); // 4,68 M + 10,92 M = budget signé
    const solde = m.echeances[1] as EcheanceTest;
    // Écart 400 000 ≤ 500 000 : palier « chef de mission », le gestionnaire peut.
    const p1 = await c.gestionnaire.patch(`/api/echeances/${solde.id}`, { montant: 10_520_000 });
    expect(p1.statusCode).toBe(200);
    // Écart cumulé 800 000 > 500 000 : palier « directeur ».
    const p2 = await c.gestionnaire.patch(`/api/echeances/${solde.id}`, { montant: 10_120_000 });
    expect(p2.statusCode).toBe(403);
    expect(p2.json().erreur.code).toBe("APPROBATION_REQUISE");
    expect(
      (await c.directeur.patch(`/api/echeances/${solde.id}`, { montant: 10_120_000 })).statusCode,
    ).toBe(200);
  });
});

describe("F7 : échéance d'une mission invisible", () => {
  it("même réponse 404 qu'une échéance inexistante", async () => {
    const m = await missionAvecEcheancier(c);
    const etranger = await c.avecRoles(["chef_mission"]); // ni chef ni membre de cette mission
    const id = (m.echeances[0] as EcheanceTest).id;
    const r = await etranger.patch(`/api/echeances/${id}`, { libelle: "x" });
    const inconnue = await etranger.patch("/api/echeances/00000000-0000-4000-8000-000000000000", {
      libelle: "x",
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual(inconnue.json());
    const d = await etranger.delete(`/api/echeances/${id}`);
    expect(d.statusCode).toBe(404);
    expect(d.json()).toEqual(inconnue.json());
  });
});

describe("F2 : séparation des tâches sur un brouillon modifié", () => {
  it("qui a modifié le brouillon ne l'approuve pas (sauf associé)", async () => {
    const double = await c.avecRoles(["directeur_mission", "gestionnaire"]);
    const m = await creerMission(c, { directeur_id: double.utilisateurId });
    attendre(
      200,
      await double.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-10-01" }),
      "signature",
    );
    attendre(201, await c.gestionnaire.post(`/api/missions/${m.id}/echeancier/generer`, {}), "gen");
    const e = (await c.gestionnaire.get(`/api/missions/${m.id}/echeancier`)).json().echeances[0];
    const f = await brouillonSur(m.id, e.id);
    // Le directeur-gestionnaire modifie le brouillon créé et soumis par un autre.
    const brouillon = (await double.get(`/api/factures/${f}`)).json();
    attendre(
      200,
      await double.patch(`/api/factures/${f}/lignes/${brouillon.lignes[0].id}`, {
        libelle: "Acompte (modifié)",
      }),
      "modification",
    );
    attendre(200, await c.gestionnaire.post(`/api/factures/${f}/soumettre`), "soumission");
    const refus = await double.post(`/api/factures/${f}/approuver`);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    expect((await double.get(`/api/factures/${f}`)).json().modifie_par).toEqual([
      double.utilisateurId,
    ]);
    attendre(200, await c.associe.post(`/api/factures/${f}/approuver`), "associé");
  });
});

describe("F1 : écritures directes en base refusées par les déclencheurs", () => {
  const essai = (sql: string, params: unknown[]) =>
    ctx.db.withTenant(c.cabinetId, (db) => db.query(sql, params));

  it("une facture naît en brouillon sans numéro ; une séquence naît à zéro", async () => {
    const m = await missionAvecEcheancier(c);
    await expect(
      essai(
        `INSERT INTO factures (cabinet_id, mission_id, client_id, devise, statut, numero, exercice,
           sequence, date_emission, date_echeance, mentions, emise_par, emise_le, approuvee_par,
           approuvee_le, role_approbateur, cree_par)
         VALUES ($1, $2, $3, 'XOF', 'emise', 'FA-2026-99999', 2026, 99999, '2026-10-01',
           '2026-10-31', '{}', $4, now(), $4, now(), 'associe', $4)`,
        [c.cabinetId, m.id, c.clientId, c.associeId],
      ),
    ).rejects.toThrow(/brouillon/);
    await expect(
      essai(
        "INSERT INTO sequences_facturation (cabinet_id, nature, exercice, dernier) VALUES ($1, 'facture', 2031, 41)",
        [c.cabinetId],
      ),
    ).rejects.toThrow(/zéro/);
  });

  it("émise → annulée seulement par l'avoir émis de cette facture", async () => {
    const emises: string[] = [];
    for (let i = 0; i < 2; i++) {
      const m = await missionAvecEcheancier(c);
      const f = await brouillonSur(m.id, (m.echeances[0] as EcheanceTest).id);
      emises.push((await emettreFacture(c, f)).id as string);
    }
    await expect(
      essai(
        `UPDATE factures SET statut = 'annulee', annulee_le = now(), annulee_par_avoir_id = $2
         WHERE id = $1`,
        [emises[0], emises[1]],
      ),
    ).rejects.toThrow(/avoir/);
    // Le circuit normal (avoir émis) reste possible.
    const avoir = await c.gestionnaire.post(`/api/factures/${emises[0]}/avoir`, {
      motif: "Erreur",
    });
    attendre(201, avoir, "avoir");
    await emettreFacture(c, avoir.json().id);
    expect((await c.gestionnaire.get(`/api/factures/${emises[0]}`)).json().statut).toBe("annulee");
  });

  it("une ligne ou un rattachement porte la mission de sa facture", async () => {
    const m1 = await missionAvecEcheancier(c);
    const m2 = await missionAvecEcheancier(c);
    const f1 = await brouillonSur(m1.id, (m1.echeances[0] as EcheanceTest).id);
    const e2 = (m2.echeances[1] as EcheanceTest).id;
    await expect(
      essai(
        `INSERT INTO facture_lignes (cabinet_id, facture_id, mission_id, origine, echeance_id,
           libelle, quantite, prix_unitaire, taux_tva)
         VALUES ($1, $2, $3, 'echeance', $4, 'Ligne d''une autre mission', 1, 1000, 18)`,
        [c.cabinetId, f1, m2.id, e2],
      ),
    ).rejects.toThrow(/facture_lignes_mission_facture_fk/);
    await expect(
      essai(
        `INSERT INTO facturation_liens (cabinet_id, facture_id, mission_id, echeance_id)
         VALUES ($1, $2, $3, $4)`,
        [c.cabinetId, f1, m2.id, e2],
      ),
    ).rejects.toThrow(/facturation_liens_mission_facture_fk/);
  });
});

describe("F6 : taux de vente de la régie masqués sans finance.lire", () => {
  it("le chef de mission voit le total de la facture, pas le montant unitaire de régie", async () => {
    const m = await missionTemps(c, { Diagnostic: { senior: 10 } }, { intitule: "Régie masquée" });
    attendre(
      200,
      await c.directeur.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-10-01" }),
      "signature",
    );
    const senior = await consultantAffecte(c, m, { Diagnostic: 8 });
    const f1 = await saisirEtSoumettre(
      senior,
      "2026-11-02",
      lignesSemaine("2026-11-02", [{ tache_id: m.taches.Diagnostic as string, jours: 3 }]),
    );
    attendreTemps(200, await c.chef.post(`/api/feuilles-temps/${f1}/valider`, {}), "validation");
    // Le chef génère la régie (responsable de la mission) : réponse déjà masquée.
    const regie = await c.chef.post(`/api/missions/${m.id}/echeancier/regie`, {
      jusqu_au: "2026-12-31",
    });
    expect(regie.statusCode).toBe(201);
    expect(regie.json().elements[0]).toMatchObject({ type: "regie", montant: null });
    const vueChef = (await c.chef.get(`/api/missions/${m.id}/echeancier`)).json();
    expect(vueChef.echeances[0].montant).toBeNull();
    expect(vueChef.total).toBeNull();
    const vueGestion = (await c.gestionnaire.get(`/api/missions/${m.id}/echeancier`)).json();
    expect(vueGestion.echeances[0].montant).toBeGreaterThan(0);

    const f = await c.gestionnaire.post(`/api/missions/${m.id}/factures`, {
      echeance_ids: [vueGestion.echeances[0].id],
    });
    attendre(201, f, "facture");
    const facture = (await c.chef.get(`/api/factures/${f.json().id}`)).json();
    expect(facture.total_ht).toBe(vueGestion.echeances[0].montant);
    expect(facture.lignes[0]).toMatchObject({ regie: true, prix_unitaire: null, montant_ht: null });
    const document = await c.chef.get(`/api/factures/${f.json().id}/document`);
    expect(document.statusCode).toBe(200);
    expect(document.body).toContain('<td class="n">—</td>');
    const factureGestion = (await c.gestionnaire.get(`/api/factures/${f.json().id}`)).json();
    expect(factureGestion.lignes[0].prix_unitaire).toBe(vueGestion.echeances[0].montant);
  });
});

/* ----- M3 : coordonnées bancaires ----- */

const codeActuel = (secret: string) => totp(base32Decoder(secret), Date.now());

/** Active la 2FA du compte ; renvoie le secret (anti-rejeu remis à zéro). */
async function activer2fa(u: ApiUtilisateur): Promise<string> {
  const init = await u.post("/api/auth/2fa/initialiser", { mot_de_passe: MOT_DE_PASSE_TEST });
  attendre(200, init, "initialisation");
  const secret = init.json().secret as string;
  attendre(200, await u.post("/api/auth/2fa/activer", { code: codeActuel(secret) }), "activation");
  await proprietaire((cl) =>
    cl.query("UPDATE utilisateurs_2fa SET dernier_pas = NULL WHERE utilisateur_id = $1", [
      u.utilisateurId,
    ]),
  );
  return secret;
}

describe("M3 : changement d'IBAN reconfirmé, journalisé masqué, signalé aux associés", () => {
  it("sans reconfirmation : refus ; mot de passe seul sans 2FA ; IBAN complet absent du journal", async () => {
    const d = await preparerFacturation(ctx, "Cabinet IBAN", false);
    const ibanPirate = "FR7630006000011234567890189";
    const sans = await d.associe.patch("/api/parametres-facturation", { iban: ibanPirate });
    expect(sans.statusCode).toBe(403);
    expect(sans.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    const mauvais = await d.associe.patch("/api/parametres-facturation", {
      iban: ibanPirate,
      mot_de_passe: "mauvais",
    });
    expect(mauvais.statusCode).toBe(401);
    expect((await d.associe.get("/api/parametres-facturation")).json().iban).toBeNull();
    const ok = await d.associe.patch("/api/parametres-facturation", {
      iban: ibanPirate,
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().iban).toBe(ibanPirate);
    // Même IBAN renvoyé tel quel (formulaire complet) : pas de reconfirmation.
    expect(
      (await d.associe.patch("/api/parametres-facturation", { iban: ibanPirate, rccm: "X" }))
        .statusCode,
    ).toBe(200);

    const journal = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT details, details::text AS brut FROM journal_audit
             WHERE cabinet_id = $1 AND entite = 'parametres_facturation' ORDER BY cree_le`,
            [d.cabinetId],
          )
        ).rows,
    );
    const changement = journal.find((l) => l.details.iban_apres);
    expect(changement.details).toMatchObject({
      iban_avant: null,
      iban_apres: "FR…0189",
      facteur: "mot_de_passe",
    });
    for (const l of journal) expect(l.brut).not.toContain(ibanPirate);

    // Alerte de tous les associés actifs, e-mail mis en file (chiffré).
    const autreAssocie = await d.avecRoles(["associe"]);
    await d.associe.patch("/api/parametres-facturation", {
      iban: "CI93CI0000000000000000",
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    const alertes = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT destinataire_id, corps FROM notifications
             WHERE cabinet_id = $1 AND type = 'securite_coordonnees_bancaires'`,
            [d.cabinetId],
          )
        ).rows,
    );
    expect(alertes.map((a) => a.destinataire_id)).toEqual(
      expect.arrayContaining([d.associeId, autreAssocie.utilisateurId]),
    );
    for (const a of alertes) expect(a.corps).not.toContain(ibanPirate);
    const emails = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT charge::text AS charge FROM jobs WHERE cabinet_id = $1 AND type = 'envoyer_email'",
            [d.cabinetId],
          )
        ).rows,
    );
    expect(emails.length).toBeGreaterThanOrEqual(alertes.length);
    for (const e of emails) expect(e.charge).not.toContain("IBAN");
  });

  it("avec la 2FA active : mot de passe ET code exigés", async () => {
    const d = await preparerFacturation(ctx, "Cabinet IBAN 2FA", false);
    const associe = await d.avecRoles(["associe"]);
    const secret = await activer2fa(associe);
    const iban = "CI93CI0000000000000099";
    const sansCode = await associe.patch("/api/parametres-facturation", {
      iban,
      mot_de_passe: MOT_DE_PASSE_TEST,
    });
    expect(sansCode.statusCode).toBe(403);
    expect(sansCode.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    const fauxCode = await associe.patch("/api/parametres-facturation", {
      iban,
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: "000000",
    });
    expect(fauxCode.statusCode).toBe(401);
    expect(fauxCode.json().erreur.code).toBe("CODE_2FA_INVALIDE");
    const ok = await associe.patch("/api/parametres-facturation", {
      iban,
      mot_de_passe: MOT_DE_PASSE_TEST,
      code: codeActuel(secret),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().iban).toBe(iban);
  });
});
