import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee, TOUS_LES_ROLES } from "./missions-outils.js";
import {
  aFacturer,
  attendre,
  factureEmise,
  missionAvecEcheancier,
  preparerFacturation,
  type CabinetFacturation,
  type EcheanceTest,
} from "./facturation-outils.js";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Cabinet Factures A");
  b = await preparerFacturation(ctx, "Cabinet Factures B");
});
afterAll(() => ctx.fermer());

/** Brouillon sur une échéance (passée « à facturer ») d'une nouvelle mission. */
async function brouillon(
  c: CabinetFacturation,
  rang = 0,
): Promise<{ missionId: string; id: string; echeance: EcheanceTest }> {
  const m = await missionAvecEcheancier(c);
  const echeance = m.echeances[rang] as EcheanceTest;
  await aFacturer(c.gestionnaire, echeance.id);
  const r = await c.gestionnaire.post(`/api/missions/${m.id}/factures`, {
    echeance_ids: [echeance.id],
  });
  attendre(201, r, "brouillon");
  return { missionId: m.id, id: r.json().id, echeance };
}

describe("facture : brouillon et calcul par le moteur (FIN-07)", () => {
  it("brouillon depuis une échéance à facturer : HT, TVA 18 %, TTC, net calculés par le moteur", async () => {
    const m = await missionAvecEcheancier(a);
    const [acompte] = m.echeances as [EcheanceTest];
    // Une échéance seulement « prévue » ne se facture pas.
    const prevue = await a.gestionnaire.post(`/api/missions/${m.id}/factures`, {
      echeance_ids: [acompte.id],
    });
    expect(prevue.statusCode).toBe(409);
    await aFacturer(a.gestionnaire, acompte.id);
    const r = await a.gestionnaire.post(`/api/missions/${m.id}/factures`, {
      echeance_ids: [acompte.id],
      objet: "Acompte",
    });
    expect(r.statusCode).toBe(201);
    const f = r.json();
    expect(f).toMatchObject({ statut: "brouillon", nature: "facture", numero: null });
    expect(f.lignes).toHaveLength(1);
    // 30 % de 15 600 000 = 4 680 000 ; TVA 18 % = 842 400 ; TTC 5 522 400.
    expect(acompte.montant).toBe(4_680_000);
    expect(f.total_ht).toBe(4_680_000);
    expect(f.tva).toEqual([{ taux: 18, base: 4_680_000, montant: 842_400 }]);
    expect(f.total_ttc).toBe(5_522_400);
    expect(f.net_a_payer).toBe(5_522_400);
    // L'échéance est rattachée : une seconde facture est refusée.
    const doublon = await a.gestionnaire.post(`/api/missions/${m.id}/factures`, {
      echeance_ids: [acompte.id],
    });
    expect(doublon.statusCode).toBe(409);
    const e = (await a.gestionnaire.get(`/api/missions/${m.id}/echeancier`)).json();
    expect(e.echeances[0].facture_id).toBe(f.id);
  });

  it("remise globale, TVA de ligne parmi les taux du cabinet, retenue à la source", async () => {
    const { id } = await brouillon(a);
    const f0 = (await a.gestionnaire.get(`/api/factures/${id}`)).json();
    const ligne = f0.lignes[0].id;
    expect(
      (await a.gestionnaire.patch(`/api/factures/${id}/lignes/${ligne}`, { taux_tva: 9 }))
        .statusCode,
    ).toBe(400);
    const r = await a.gestionnaire.patch(`/api/factures/${id}`, {
      remise_globale: { type: "pourcentage", valeur: 10 },
      retenue_active: true,
    });
    expect(r.statusCode).toBe(200);
    // Retenue paramétrée à 0 % (valeur de départ) : aucune retenue appliquée.
    expect(r.json()).toMatchObject({
      total_brut: 4_680_000,
      total_remises: 468_000,
      total_ht: 4_212_000,
      total_tva: 758_160,
      total_ttc: 4_970_160,
      total_retenues: 0,
    });
    // Remise fixe supérieure au montant : refusée par le moteur.
    const trop = await a.gestionnaire.patch(`/api/factures/${id}`, {
      remise_globale: { type: "montant", valeur: 99_000_000 },
    });
    expect(trop.statusCode).toBe(400);
    expect(trop.json().erreur.code).toBe("REMISE_INVALIDE");
  });

  it("retenue à la source paramétrée (7,5 % sur HT) : net à payer = TTC − retenue", async () => {
    const c = await preparerFacturation(ctx, "Cabinet Retenue");
    attendre(
      200,
      await c.gestionnaire.patch("/api/parametres-facturation", {
        retenue_active: true,
        retenue_taux: 7.5,
        retenue_base: "HT",
      }),
      "retenue",
    );
    const { id } = await brouillon(c);
    const f = (await c.gestionnaire.get(`/api/factures/${id}`)).json();
    // HT 4 680 000 ; TVA 842 400 ; TTC 5 522 400 ; retenue 7,5 % × HT = 351 000.
    expect(f).toMatchObject({ total_retenues: 351_000, net_a_payer: 5_171_400 });
    expect(f.retenues[0]).toMatchObject({ taux: 7.5, base: "HT", montant: 351_000 });
  });

  it("validation des entrées : liste vide, identifiant invalide, champ inconnu", async () => {
    const m = await missionAvecEcheancier(a);
    expect(
      (await a.gestionnaire.post(`/api/missions/${m.id}/factures`, { echeance_ids: [] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await a.gestionnaire.post(`/api/missions/${m.id}/factures`, { echeance_ids: ["x"] }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await a.gestionnaire.post(`/api/missions/${m.id}/factures`, {
          echeance_ids: [m.echeances[0]?.id],
          total_ht: 1,
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe("approbation selon les seuils (FIN-15)", () => {
  it("palier « chef de mission » : approuvée par le directeur désigné de la mission", async () => {
    const { id } = await brouillon(a);
    const s = await a.gestionnaire.post(`/api/factures/${id}/soumettre`);
    expect(s.statusCode).toBe(200);
    // 4 680 000 FCFA ≤ 5 000 000 : palier « chef de mission » (moteur).
    expect(s.json()).toMatchObject({ statut: "a_approuver", role_approbateur: "chef_mission" });
    // Contenu figé dès la soumission.
    expect((await a.gestionnaire.patch(`/api/factures/${id}`, { objet: "x" })).statusCode).toBe(
      409,
    );
    // Un autre directeur (non désigné sur cette mission) n'approuve pas.
    const autre = await a.avecRoles(["directeur_mission"]);
    expect((await autre.post(`/api/factures/${id}/approuver`)).statusCode).toBe(403);
    // Une facture non approuvée ne s'émet pas.
    expect((await a.gestionnaire.post(`/api/factures/${id}/emettre`)).statusCode).toBe(409);
    const ok = await a.directeur.post(`/api/factures/${id}/approuver`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().statut).toBe("approuvee");
  });

  it("une remise au-delà de 2,5 M FCFA exige un associé ; rejet motivé → brouillon", async () => {
    const { id } = await brouillon(a, 1); // solde : 10 920 000
    attendre(
      200,
      await a.gestionnaire.patch(`/api/factures/${id}`, {
        remise_globale: { type: "pourcentage", valeur: 30 },
      }),
      "remise",
    );
    const s = await a.gestionnaire.post(`/api/factures/${id}/soumettre`);
    expect(s.json().role_approbateur).toBe("associe");
    const refus = await a.directeur.post(`/api/factures/${id}/approuver`);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    const rejet = await a.directeur.post(`/api/factures/${id}/rejeter`, {
      motif: "Remise à revoir",
    });
    expect(rejet.statusCode).toBe(200);
    expect(rejet.json()).toMatchObject({ statut: "brouillon", motif_rejet: "Remise à revoir" });
    expect((await a.directeur.post(`/api/factures/${id}/rejeter`, {})).statusCode).toBe(400);
  });

  it("l'auteur d'une facture ne l'approuve pas lui-même, sauf associé", async () => {
    // Directeur ET gestionnaire, désigné directeur de la mission.
    const double = await a.avecRoles(["directeur_mission", "gestionnaire"]);
    const m = await creerMission(a, { directeur_id: double.utilisateurId });
    attendre(
      200,
      await double.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-10-01" }),
      "signature",
    );
    attendre(201, await double.post(`/api/missions/${m.id}/echeancier/generer`, {}), "échéancier");
    const e = (await double.get(`/api/missions/${m.id}/echeancier`)).json().echeances[0];
    await aFacturer(double, e.id);
    const f = await double.post(`/api/missions/${m.id}/factures`, { echeance_ids: [e.id] });
    attendre(201, f, "brouillon");
    attendre(200, await double.post(`/api/factures/${f.json().id}/soumettre`), "soumission");
    const refus = await double.post(`/api/factures/${f.json().id}/approuver`);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    // Un associé approuve, y compris sa propre facture.
    const m2 = await missionAvecEcheancier(a);
    await aFacturer(a.associe, m2.echeances[0]?.id as string);
    const f2 = await a.associe.post(`/api/missions/${m2.id}/factures`, {
      echeance_ids: [m2.echeances[0]?.id],
    });
    attendre(200, await a.associe.post(`/api/factures/${f2.json().id}/soumettre`), "soumission");
    expect((await a.associe.post(`/api/factures/${f2.json().id}/approuver`)).statusCode).toBe(200);
  });
});

describe("émission : numérotation continue et immuabilité (FIN-07)", () => {
  it("émission : numéro, date d'échéance, mentions figées, échéance facturée", async () => {
    const { facture, missionId } = await factureEmise(a);
    expect(facture.statut).toBe("emise");
    expect(facture.numero).toMatch(/^FA-\d{4}-\d{5}$/);
    expect(facture.date_echeance).not.toBeNull();
    const mentions = facture.mentions as Record<string, Record<string, unknown>>;
    expect(mentions.emetteur).toMatchObject({
      raison_sociale: "Cabinet Test Conseil SARL (fictif)",
      rccm: "CI-ABJ-TEST-B-0001",
    });
    expect(mentions.client?.raison_sociale).toBe("Client de Cabinet Factures A");
    // Les mentions sont un snapshot : changer les paramètres ne change pas la facture.
    attendre(
      200,
      await a.associe.patch("/api/parametres-facturation", { rccm: "CI-ABJ-NOUVEAU" }),
      "rccm",
    );
    const relue = (await a.gestionnaire.get(`/api/factures/${facture.id}`)).json();
    expect(relue.mentions.emetteur.rccm).toBe("CI-ABJ-TEST-B-0001");
    attendre(
      200,
      await a.associe.patch("/api/parametres-facturation", { rccm: "CI-ABJ-TEST-B-0001" }),
      "rccm",
    );
    const e = (await a.gestionnaire.get(`/api/missions/${missionId}/echeancier`)).json();
    expect(e.echeances[0].statut).toBe("facturee");
    // API : une facture émise ne se modifie ni ne se supprime.
    expect(
      (await a.gestionnaire.patch(`/api/factures/${facture.id}`, { objet: "x" })).statusCode,
    ).toBe(409);
    expect((await a.gestionnaire.delete(`/api/factures/${facture.id}`)).statusCode).toBe(409);
    // Une échéance facturée ne se modifie plus.
    expect(
      (await a.gestionnaire.patch(`/api/echeances/${e.echeances[0].id}`, { libelle: "x" }))
        .statusCode,
    ).toBe(409);
  });

  it("émission refusée sans mentions légales du cabinet (MENTIONS_INCOMPLETES)", async () => {
    const c = await preparerFacturation(ctx, "Cabinet Sans Mentions", false);
    const { id } = await brouillon(c);
    attendre(200, await c.gestionnaire.post(`/api/factures/${id}/soumettre`), "soumission");
    attendre(200, await c.associe.post(`/api/factures/${id}/approuver`), "approbation");
    const r = await c.gestionnaire.post(`/api/factures/${id}/emettre`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("MENTIONS_INCOMPLETES");
  });

  it("SQL direct (rôle applicatif) : UPDATE et DELETE d'une facture émise et de ses lignes refusés", async () => {
    const { facture } = await factureEmise(a);
    const id = facture.id as string;
    const essai = (sql: string) => ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, [id]));
    await expect(essai("UPDATE factures SET total_ht = 0 WHERE id = $1")).rejects.toThrow(
      /immuable/,
    );
    await expect(essai("UPDATE factures SET numero = 'FA-X' WHERE id = $1")).rejects.toThrow(
      /immuable/,
    );
    await expect(essai("UPDATE factures SET mentions = '{}' WHERE id = $1")).rejects.toThrow(
      /immuable/,
    );
    await expect(essai("UPDATE factures SET statut = 'brouillon' WHERE id = $1")).rejects.toThrow(
      /immuable/,
    );
    await expect(essai("DELETE FROM factures WHERE id = $1")).rejects.toThrow(
      /suppression refusée/,
    );
    await expect(
      essai("UPDATE facture_lignes SET prix_unitaire = 1 WHERE facture_id = $1"),
    ).rejects.toThrow(/lignes figées/);
    await expect(essai("DELETE FROM facture_lignes WHERE facture_id = $1")).rejects.toThrow(
      /lignes figées/,
    );
    await expect(
      essai(
        `INSERT INTO facture_lignes (cabinet_id, facture_id, mission_id, origine, echeance_id, libelle,
           quantite, prix_unitaire, taux_tva)
         SELECT cabinet_id, facture_id, mission_id, origine, echeance_id, 'Ajout', 1, 1, 0
         FROM facture_lignes WHERE facture_id = $1 LIMIT 1`,
      ),
    ).rejects.toThrow(/lignes figées/);
    await expect(essai("DELETE FROM facturation_liens WHERE facture_id = $1")).rejects.toThrow(
      /figé/,
    );
    // La séquence ne recule ni ne saute.
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE sequences_facturation SET dernier = dernier + 2"),
      ),
    ).rejects.toThrow(/incrément/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM sequences_facturation")),
    ).rejects.toThrow(/permission denied/);
    // Seule la date d'envoi se renseigne, une fois (point d'extension).
    const envoi = await a.gestionnaire.post(`/api/factures/${id}/marquer-envoyee`);
    expect(envoi.statusCode).toBe(200);
    expect(envoi.json().envoyee_le).not.toBeNull();
    expect((await a.gestionnaire.post(`/api/factures/${id}/marquer-envoyee`)).statusCode).toBe(409);
  });

  it("10 émissions simultanées → 10 numéros consécutifs distincts, sans trou", async () => {
    const c = await preparerFacturation(ctx, "Cabinet Concurrence");
    const m = await creerMissionSignee(c, { mode_facturation: "forfait" });
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const e = await c.gestionnaire.post(`/api/missions/${m.id}/echeances`, {
        type: "jalon",
        libelle: `Jalon ${i + 1}`,
        montant: 100_000,
        date_prevue: "2026-11-30",
      });
      attendre(201, e, "échéance");
      await aFacturer(c.gestionnaire, e.json().id);
      const f = await c.gestionnaire.post(`/api/missions/${m.id}/factures`, {
        echeance_ids: [e.json().id],
      });
      attendre(201, f, "brouillon");
      attendre(
        200,
        await c.gestionnaire.post(`/api/factures/${f.json().id}/soumettre`),
        "soumission",
      );
      attendre(200, await c.associe.post(`/api/factures/${f.json().id}/approuver`), "approbation");
      ids.push(f.json().id);
    }
    const reponses = await Promise.all(
      ids.map((id) => c.gestionnaire.post(`/api/factures/${id}/emettre`)),
    );
    expect(reponses.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
    const sequences = reponses.map((r) => r.json().sequence as number).sort((x, y) => x - y);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(reponses.map((r) => r.json().numero)).size).toBe(10);
    const annee = new Date().toISOString().slice(0, 4);
    expect(reponses.map((r) => r.json().numero).sort()).toContain(`FA-${annee}-00010`);
  });
});

describe("avoirs (FIN-07)", () => {
  it("avoir total : montants opposés, numéroté, annule la facture, libère l'échéance", async () => {
    const { facture, missionId } = await factureEmise(a);
    const sans = await a.gestionnaire.post(`/api/factures/${facture.id}/avoir`, {});
    expect(sans.statusCode).toBe(400);
    const r = await a.gestionnaire.post(`/api/factures/${facture.id}/avoir`, {
      motif: "Erreur de client",
    });
    expect(r.statusCode).toBe(201);
    const avoir = r.json();
    expect(avoir).toMatchObject({
      nature: "avoir",
      statut: "brouillon",
      facture_origine_id: facture.id,
      total_ht: -(facture.total_ht as number),
      total_tva: -(facture.total_tva as number),
      net_a_payer: -(facture.net_a_payer as number),
    });
    // Un seul avoir par facture ; jamais d'avoir d'avoir.
    expect(
      (await a.gestionnaire.post(`/api/factures/${facture.id}/avoir`, { motif: "Bis" })).statusCode,
    ).toBe(409);
    const s = await a.gestionnaire.post(`/api/factures/${avoir.id}/soumettre`);
    expect(s.json().role_approbateur).toBe("chef_mission"); // valeur absolue (moteur)
    attendre(200, await a.directeur.post(`/api/factures/${avoir.id}/approuver`), "approbation");
    const emis = await a.gestionnaire.post(`/api/factures/${avoir.id}/emettre`);
    expect(emis.statusCode).toBe(200);
    expect(emis.json().numero).toMatch(/^AV-\d{4}-\d{5}$/);
    const origine = (await a.gestionnaire.get(`/api/factures/${facture.id}`)).json();
    expect(origine).toMatchObject({ statut: "annulee", annulee_par_avoir_id: avoir.id });
    const avoirDAvoir = await a.gestionnaire.post(`/api/factures/${avoir.id}/avoir`, {
      motif: "Non",
    });
    expect(avoirDAvoir.statusCode).toBe(400);
    expect(avoirDAvoir.json().erreur.code).toBe("AVOIR_INVALIDE");
    // L'échéance redevient facturable.
    const e = (await a.gestionnaire.get(`/api/missions/${missionId}/echeancier`)).json();
    expect(e.echeances[0]).toMatchObject({ statut: "a_facturer", facture_id: null });
    const refacture = await a.gestionnaire.post(`/api/missions/${missionId}/factures`, {
      echeance_ids: [e.echeances[0].id],
    });
    expect(refacture.statusCode).toBe(201);
  });
});

describe("document imprimable (HTML sûr)", () => {
  it("texte échappé, aucun script, CSP stricte", async () => {
    const { id } = await brouillon(a);
    attendre(
      200,
      await a.gestionnaire.patch(`/api/factures/${id}`, {
        objet: `<script>alert("x")</script><img src=x onerror=alert(1)>`,
      }),
      "objet",
    );
    const r = await a.chef.get(`/api/factures/${id}/document`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.body).not.toContain("<script");
    expect(r.body).not.toContain("<img");
    expect(r.body).toContain("&lt;script&gt;");
    expect(r.body).toContain("BROUILLON");
    expect(r.body).toContain("4 680 000 FCFA");
  });
});

describe("matrice des droits sur les factures : 8 rôles", () => {
  it("lecture facture.lire, création facture.emettre, approbation facture.valider", async () => {
    const { id, missionId } = await brouillon(a);
    const m2 = await missionAvecEcheancier(a);
    await aFacturer(a.gestionnaire, m2.echeances[0]?.id as string);
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      const lit = ["associe", "directeur_mission", "gestionnaire"].includes(role);
      // Un chef de mission ne lit que les factures de ses missions : celle-ci → 404.
      const attendu = lit ? 200 : role === "chef_mission" ? 404 : 403;
      expect((await u.get(`/api/factures/${id}`)).statusCode, role).toBe(attendu);
      expect((await u.get("/api/factures")).statusCode, role).toBe(
        lit || role === "chef_mission" ? 200 : 403,
      );
      const emet = ["associe", "gestionnaire"].includes(role);
      const creation = await u.post(`/api/missions/${missionId}/factures`, {
        echeance_ids: ["00000000-0000-4000-8000-000000000000"],
      });
      // Avec le droit : 400 (échéance inconnue) ; sans : 403 avant toute lecture.
      expect(creation.statusCode, role).toBe(emet ? 400 : 403);
      const valide = ["associe", "directeur_mission"].includes(role);
      // Facture en brouillon : avec le droit, 409 (pas à approuver) ou 404 ; sans, 403.
      expect((await u.post(`/api/factures/${id}/approuver`)).statusCode, role).toBe(
        valide ? 409 : 403,
      );
    }
    // Le chef désigné de la mission lit ses factures, sans coût ni marge.
    const vue = await a.chef.get(`/api/factures/${id}`);
    expect(vue.statusCode).toBe(200);
    expect(vue.body).not.toMatch(/cout|marge/i);
    const liste = (await a.chef.get("/api/factures")).json();
    expect(liste.elements.some((f: { id: string }) => f.id === id)).toBe(true);
  });

  it("le journal des factures ne porte aucun montant", async () => {
    const { facture } = await factureEmise(a);
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details::text AS d FROM journal_audit WHERE entite IN ('facture', 'avoir') AND entite_id = $1",
            [facture.id],
          )
        ).rows,
    );
    expect(lignes.length).toBeGreaterThanOrEqual(4);
    for (const l of lignes) expect(l.d).not.toMatch(/montant|total|net_a_payer|taux/);
  });
});

describe("isolation des factures entre cabinets", () => {
  it("facture, document, échéancier et actions d'un autre cabinet : 404", async () => {
    const { facture, missionId } = await factureEmise(a);
    const id = facture.id as string;
    expect((await b.associe.get(`/api/factures/${id}`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/factures/${id}/document`)).statusCode).toBe(404);
    expect((await b.associe.post(`/api/factures/${id}/avoir`, { motif: "x" })).statusCode).toBe(
      404,
    );
    expect((await b.associe.post(`/api/factures/${id}/emettre`)).statusCode).toBe(404);
    expect((await b.associe.get(`/api/missions/${missionId}/echeancier`)).statusCode).toBe(404);
    expect(
      (await b.associe.post(`/api/missions/${missionId}/factures`, { echeance_ids: [missionId] }))
        .statusCode,
    ).toBe(404);
    const liste = (await b.associe.get("/api/factures")).json();
    expect(liste.elements.some((f: { id: string }) => f.id === id)).toBe(false);
  });

  it("pagination par curseur de la liste", async () => {
    const page1 = (await a.associe.get("/api/factures?limite=2")).json();
    expect(page1.elements).toHaveLength(2);
    expect(page1.curseur_suivant).not.toBeNull();
    const page2 = (
      await a.associe.get(`/api/factures?limite=2&curseur=${page1.curseur_suivant}`)
    ).json();
    const ids1 = page1.elements.map((f: { id: string }) => f.id);
    expect(page2.elements.every((f: { id: string }) => !ids1.includes(f.id))).toBe(true);
    expect((await a.associe.get("/api/factures?curseur=abc")).statusCode).toBe(400);
  });
});
