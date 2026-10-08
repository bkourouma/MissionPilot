import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { televerser } from "./fichiers-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Dossier client vivant (DOS-01 à DOS-04, DOS-06, DOS-07) : droits et visibilité, faits
 * datés et sourcés en ajout seul, facteurs de contexte, états financiers contrôlés par le
 * moteur (acceptation automatique ou revue), imports CSV et Excel référencés, fiabilité,
 * frise, export tracé. Isolation entre cabinets.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let missionId: string;
let consultantEquipe: ApiUtilisateur;
let consultantHors: ApiUtilisateur;
let expert: ApiUtilisateur;
let gestionnaire: ApiUtilisateur;
const INCONNU = "00000000-0000-4000-8000-000000000000";

const base = () => `/api/dossiers/${a.clientId}`;

function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

const source = { type: "entretien", libelle: "Entretien avec le DAF, 2026-09-12" };

const fait = (corps: Record<string, unknown> = {}) => ({
  categorie: "organisation",
  cle: "effectif",
  valeur: { type: "nombre", nombre: 42 },
  date_effet: "2026-01-01",
  source,
  fiabilite: "B",
  ...corps,
});

/** État équilibré : actif 1 000 = passif 1 000 ; produits 500 − charges 400 = 100 au bilan. */
const lignesEquilibrees = () => [
  { code: "AZ", libelle: "Actif immobilisé", section: "actif", montant: 600 },
  { code: "BT", libelle: "Trésorerie", section: "actif", montant: 400 },
  { code: "BZ", libelle: "Total actif", section: "actif", montant: 1000, role: "total" },
  { code: "CA", libelle: "Capital", section: "passif", montant: 500 },
  { code: "CJ", libelle: "Résultat", section: "passif", montant: 100, role: "resultat_exercice" },
  { code: "DJ", libelle: "Fournisseurs", section: "passif", montant: 400 },
  { code: "RA", libelle: "Achats", section: "charges", montant: 400 },
  { code: "TA", libelle: "Ventes", section: "produits", montant: 500 },
];

const etat = (
  exercice: number,
  lignes: Record<string, unknown>[] = lignesEquilibrees(),
  corps: Record<string, unknown> = {},
) => ({
  exercice,
  date_cloture: `${exercice}-12-31`,
  devise: "XOF",
  source_libelle: `Liasse ${exercice}`,
  lignes,
  ...corps,
});

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Dossier A");
  b = await preparerCabinet(ctx, "Dossier B");
  missionId = (await creerMission(a, { intitule: "Diagnostic flash" })).id;
  await creerMission(b, { intitule: "Mission B" });
  consultantEquipe = await a.avecRoles(["consultant"]);
  consultantHors = await a.avecRoles(["consultant"]);
  expert = await a.avecRoles(["expert_metier"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  for (const u of [consultantEquipe, expert]) {
    attendre(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u.utilisateurId }),
      "équipe",
    );
  }
});

afterAll(async () => {
  await ctx?.fermer();
});

describe("droits et visibilité", () => {
  it("401 sans session, 403 sans dossier.lire, 403 en écriture sans dossier.ecrire", async () => {
    expect((await api(ctx).get(base())).statusCode).toBe(401);
    expect((await api(ctx).get("/api/dossiers")).statusCode).toBe(401);
    expect((await gestionnaire.get(base())).statusCode).toBe(403);
    expect((await gestionnaire.get("/api/dossiers")).statusCode).toBe(403);
    expect((await expert.get(base())).statusCode).toBe(200);
    expect((await expert.post(`${base()}/faits`, fait())).statusCode).toBe(403);
    expect((await expert.get(`${base()}/export`)).statusCode).toBe(403);
  });

  it("dossier visible par mission ; hors équipe ou autre cabinet : 404 ; liste filtrée", async () => {
    expect((await consultantEquipe.get(base())).statusCode).toBe(200);
    expect((await a.chef.get(base())).statusCode).toBe(200);
    expect((await a.directeur.get(base())).statusCode).toBe(200);
    expect((await consultantHors.get(base())).statusCode).toBe(404);
    expect((await consultantHors.post(`${base()}/faits`, fait())).statusCode).toBe(404);
    expect((await b.associe.get(base())).statusCode).toBe(404);
    expect((await b.associe.post(`${base()}/faits`, fait())).statusCode).toBe(404);
    expect((await a.associe.get(`/api/dossiers/${INCONNU}`)).statusCode).toBe(404);
    expect((await consultantHors.get("/api/dossiers")).json().elements).toEqual([]);
    const liste = (await consultantEquipe.get("/api/dossiers")).json();
    expect(liste.elements.map((e: { id: string }) => e.id)).toEqual([a.clientId]);
    const tous = (await a.associe.get("/api/dossiers?limite=1")).json();
    expect(tous.elements).toHaveLength(1);
    expect(
      (await b.associe.get("/api/dossiers")).json().elements.map((e: { id: string }) => e.id),
    ).toEqual([b.clientId]);
  });
});

describe("faits datés et sourcés (DOS-02)", () => {
  it("proposition, séparation des tâches, confirmation, rejet motivé", async () => {
    const r = await consultantEquipe.post(`${base()}/faits`, fait());
    attendre(201, r, "proposition");
    const f = r.json();
    expect(f).toMatchObject({
      statut: "propose",
      origine: "saisie",
      fiabilite: "B",
      cle: "effectif",
    });
    expect(f.source).toMatchObject({ type: "entretien", document_id: null });
    const parAuteur = await consultantEquipe.post(`${base()}/faits/${f.id}/decision`, {
      decision: "confirme",
    });
    expect(parAuteur.statusCode).toBe(403);
    expect(parAuteur.json().erreur.code).toBe("VALIDATION_REQUISE");
    const ok = await a.chef.post(`${base()}/faits/${f.id}/decision`, { decision: "confirme" });
    attendre(200, ok, "confirmation");
    expect(ok.json().statut).toBe("confirme");
    expect(ok.json().decision.par.id).toBe(a.chef.utilisateurId);
    const encore = await a.chef.post(`${base()}/faits/${f.id}/decision`, {
      decision: "rejete",
      motif: "x",
    });
    expect(encore.statusCode).toBe(409);

    const p = (
      await consultantEquipe.post(
        `${base()}/faits`,
        fait({ cle: "siege", valeur: { type: "texte", texte: "Abidjan" } }),
      )
    ).json();
    expect(
      (await consultantEquipe.post(`${base()}/faits/${p.id}/decision`, { decision: "rejete" }))
        .statusCode,
    ).toBe(400);
    const retrait = await consultantEquipe.post(`${base()}/faits/${p.id}/decision`, {
      decision: "rejete",
      motif: "Saisi par erreur",
    });
    attendre(200, retrait, "retrait");
    expect(retrait.json().statut).toBe("rejete");
    const remplacerRejete = await a.chef.post(
      `${base()}/faits`,
      fait({ cle: "siege", valeur: { type: "texte", texte: "Bouaké" }, remplace_id: p.id }),
    );
    expect(remplacerRejete.statusCode).toBe(409);
    expect(remplacerRejete.json().erreur.code).toBe("REMPLACEMENT_INVALIDE");
  });

  it("remplacement : nouvelle valeur, ancienne « remplacée », historique en chaîne", async () => {
    // Création directement confirmée : associé seulement (séparation des tâches), remplacement compris.
    const refus = await a.chef.post(
      `${base()}/faits`,
      fait({ cle: "ca_estime", categorie: "finances", statut: "confirme" }),
    );
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("VALIDATION_REQUISE");
    const v1 = (
      await a.associe.post(
        `${base()}/faits`,
        fait({
          cle: "ca_estime",
          statut: "confirme",
          categorie: "finances",
          valeur: { type: "montant", montant: 150_000_000, devise: "XOF" },
        }),
      )
    ).json();
    expect(v1.statut).toBe("confirme");
    expect(
      (
        await a.chef.post(
          `${base()}/faits`,
          fait({ cle: "ca_estime", categorie: "finances", statut: "confirme", remplace_id: v1.id }),
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await consultantEquipe.post(`${base()}/faits`, fait({ statut: "confirme" }))).statusCode,
    ).toBe(403);
    const v2r = await a.associe.post(
      `${base()}/faits`,
      fait({
        cle: "ca_estime",
        categorie: "finances",
        statut: "confirme",
        remplace_id: v1.id,
        valeur: { type: "montant", montant: 160_000_000, devise: "XOF" },
      }),
    );
    attendre(201, v2r, "remplacement");
    const v2 = v2r.json();
    const histo = (await a.chef.get(`${base()}/faits/${v1.id}/historique`)).json().elements;
    expect(histo.map((h: { id: string; statut: string }) => [h.id, h.statut])).toEqual([
      [v1.id, "remplace"],
      [v2.id, "confirme"],
    ]);
    const second = await a.chef.post(
      `${base()}/faits`,
      fait({ cle: "ca_estime", categorie: "finances", remplace_id: v1.id }),
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().erreur.code).toBe("DEJA_REMPLACE");
    const autreCle = await a.chef.post(
      `${base()}/faits`,
      fait({ cle: "autre", categorie: "finances", remplace_id: v2.id }),
    );
    expect(autreCle.json().erreur.code).toBe("REMPLACEMENT_INVALIDE");
    expect(
      (await a.chef.post(`${base()}/faits/${v1.id}/decision`, { decision: "rejete", motif: "x" }))
        .statusCode,
    ).toBe(409);
    const autreClient = await b.associe.post(
      `/api/dossiers/${b.clientId}/faits`,
      fait({ remplace_id: v2.id }),
    );
    expect(autreClient.statusCode).toBe(404);

    const dossier = (await a.chef.get(base())).json();
    const profil = dossier.profil.map((x: { cle: string; valeur: unknown }) => [x.cle, x.valeur]);
    expect(profil).toContainEqual([
      "ca_estime",
      { type: "montant", montant: 160_000_000, devise: "XOF" },
    ]);
    expect(profil).toContainEqual(["effectif", { type: "nombre", nombre: 42 }]);
    const tous = (await a.chef.get(`${base()}/faits?vue=tous&categorie=finances`)).json().elements;
    expect(tous).toHaveLength(2);
  });

  it("refuse une valeur mal typée, une source de document invalide ou un document illisible", async () => {
    expect(
      (await a.chef.post(`${base()}/faits`, fait({ valeur: { type: "nombre", nombre: "42" } })))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await a.chef.post(
          `${base()}/faits`,
          fait({ source: { type: "entretien", libelle: "x", page: 3 } }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.chef.post(
          `${base()}/faits`,
          fait({ source: { type: "document", libelle: "Statuts", document_id: INCONNU } }),
        )
      ).statusCode,
    ).toBe(404);
    expect((await a.chef.post(`${base()}/faits`, fait({ cle: "Majuscules" }))).statusCode).toBe(
      400,
    );
  });

  it("ajout seul en base (MPO01) ; un fait extrait par l'IA ne naît jamais confirmé (MPO03)", async () => {
    const erreurProprietaire = await proprietaire(async (c) => {
      try {
        await c.query("UPDATE dossier_faits SET cle = 'x' WHERE client_id = $1", [a.clientId]);
        return null;
      } catch (e) {
        return (e as { code: string }).code;
      }
    });
    expect(erreurProprietaire).toBe("MPO01");
    const refusApp = await ctx.db
      .withTenant(a.cabinetId, (db) => db.query("DELETE FROM dossier_faits_decisions"))
      .catch((e: { code: string }) => e.code);
    expect(refusApp).toBe("42501");

    const ia = await ctx.db
      .withTenant(a.cabinetId, async (db) => {
        const r = await db.query(
          `INSERT INTO dossier_faits (cabinet_id, client_id, categorie, cle, type_valeur, valeur, date_effet,
             source_type, source_libelle, source_page, fiabilite, origine, auteur_id)
           VALUES ($1, $2, 'finances', 'ca_2025', 'montant', '{"type":"montant","montant":1,"devise":"XOF"}',
             '2025-12-31', 'document', 'Liasse 2025', 4, 'C', 'ia', $3) RETURNING id`,
          [a.cabinetId, a.clientId, a.associeId],
        );
        await db.query(
          `INSERT INTO dossier_faits_decisions (cabinet_id, fait_id, decision, decideur_id)
           VALUES ($1, $2, 'confirme', $3)`,
          [a.cabinetId, r.rows[0].id, a.associeId],
        );
      })
      .catch((e: { code: string }) => e.code);
    expect(ia).toBe("MPO03");

    const id = await ctx.db.withTenant(a.cabinetId, async (db) => {
      const r = await db.query(
        `INSERT INTO dossier_faits (cabinet_id, client_id, categorie, cle, type_valeur, valeur, date_effet,
           source_type, source_libelle, source_page, fiabilite, origine, auteur_id)
         VALUES ($1, $2, 'finances', 'ca_2025', 'montant', '{"type":"montant","montant":1,"devise":"XOF"}',
           '2025-12-31', 'document', 'Liasse 2025', 4, 'C', 'ia', $3) RETURNING id`,
        [a.cabinetId, a.clientId, a.associeId],
      );
      return r.rows[0].id as string;
    });
    const propositions = (await a.chef.get(`${base()}/faits?vue=propositions`)).json().elements;
    expect(propositions.map((p: { id: string }) => p.id)).toContain(id);
    const confirme = await a.chef.post(`${base()}/faits/${id}/decision`, { decision: "confirme" });
    attendre(200, confirme, "confirmation IA");
    expect(confirme.json()).toMatchObject({ origine: "ia", statut: "confirme" });
  });
});

describe("facteurs de contexte (STD-04)", () => {
  it("valeurs typées et datées ; contexte courant ; valeurs de convention contrôlées", async () => {
    const ajout = (corps: Record<string, unknown>) =>
      a.chef.post(`${base()}/facteurs`, {
        date_effet: "2026-01-01",
        source,
        fiabilite: "B",
        ...corps,
      });
    attendre(
      201,
      await ajout({ code: "fiabilite_comptes", type: "enumeration", valeur: "non_certifies" }),
      "f1",
    );
    attendre(
      201,
      await ajout({ code: "part_informel", type: "enumeration", valeur: "forte" }),
      "f2",
    );
    attendre(201, await ajout({ code: "effectif", type: "nombre", valeur: 42 }), "f3");
    attendre(
      201,
      await ajout({ code: "effectif", type: "nombre", valeur: 45, date_effet: "2026-06-01" }),
      "f4",
    );
    attendre(
      201,
      await ajout({ code: "effectif", type: "nombre", valeur: 99, date_effet: "2099-01-01" }),
      "f5",
    );
    expect(
      (await ajout({ code: "part_informel", type: "enumeration", valeur: "enorme" })).statusCode,
    ).toBe(400);
    expect((await ajout({ code: "effectif", type: "nombre", valeur: "42" })).statusCode).toBe(400);
    // Code, type et valeur sont contrôlés contre facteurs_contexte (STD-04) : 400 CONTEXTE_INVALIDE.
    const inconnu = await ajout({ code: "constructor", type: "booleen", valeur: true });
    expect(inconnu.statusCode).toBe(400);
    expect(inconnu.json().erreur.code).toBe("CONTEXTE_INVALIDE");
    expect(
      (await ajout({ code: "facteur_invente", type: "nombre", valeur: 1 })).json().erreur.code,
    ).toBe("CONTEXTE_INVALIDE");
    const mauvaisType = await ajout({ code: "effectif", type: "enumeration", valeur: "42" });
    expect(mauvaisType.statusCode).toBe(400);
    expect(mauvaisType.json().erreur.code).toBe("CONTEXTE_INVALIDE");
    const horsValeurs = await ajout({
      code: "actionnariat",
      type: "enumeration",
      valeur: "valeur_hors_liste",
    });
    expect(horsValeurs.statusCode).toBe(400);
    expect(horsValeurs.json().erreur.code).toBe("CONTEXTE_INVALIDE");
    const lu = (await consultantEquipe.get(`${base()}/facteurs`)).json();
    expect(lu.contexte).toEqual({
      effectif: 45,
      fiabilite_comptes: "non_certifies",
      part_informel: "forte",
    });
    expect(lu.historique).toHaveLength(5);
  });
});

describe("états financiers (DOS-03)", () => {
  it("acceptation automatique si tous les contrôles passent ; remplacement du même exercice", async () => {
    const r = await a.chef.post(`${base()}/etats-financiers`, etat(2024));
    attendre(201, r, "saisie");
    const e = r.json();
    expect(e).toMatchObject({ statut: "accepte", controles_ok: true, ecarts: 0, exercice: 2024 });
    expect(e.decision).toMatchObject({ decision: "accepte", automatique: true, par: null });
    expect(e.lignes).toHaveLength(8);
    const bis = await a.chef.post(
      `${base()}/etats-financiers`,
      etat(2024, lignesEquilibrees(), { source_libelle: "Liasse corrigée" }),
    );
    attendre(201, bis, "remplacement");
    expect(bis.json().remplace_id).toBe(e.id);
    const ancien = (await a.chef.get(`${base()}/etats-financiers/${e.id}`)).json();
    expect(ancien.statut).toBe("remplace");
    expect(
      (
        await a.chef.post(`${base()}/etats-financiers/${e.id}/decision`, {
          decision: "rejete",
          motif: "x",
        })
      ).statusCode,
    ).toBe(409);
  });

  it("écart : file de revue, jamais d'acceptation silencieuse ; quatre yeux pour forcer", async () => {
    const lignes = lignesEquilibrees().map((l) => (l.code === "DJ" ? { ...l, montant: 390 } : l));
    const r = await a.chef.post(`${base()}/etats-financiers`, etat(2025, lignes));
    attendre(201, r, "écart");
    const e = r.json();
    expect(e).toMatchObject({
      statut: "en_revue",
      controles_ok: false,
      conforme: false,
      decision: null,
    });
    expect(e.ecarts).toBeGreaterThan(0);
    expect(e.constats.find((c: { code: string }) => c.code === "EQUILIBRE_BILAN")).toMatchObject({
      statut: "ecart",
      attendu: 1000,
      constate: 990,
      ecart: -10,
    });
    const url = `${base()}/etats-financiers/${e.id}/decision`;
    expect((await a.directeur.post(url, { decision: "accepte" })).statusCode).toBe(400);
    const parImportateur = await a.chef.post(url, { decision: "accepte", motif: "Arrondis" });
    expect(parImportateur.statusCode).toBe(403);
    const force = await a.directeur.post(url, {
      decision: "accepte",
      motif: "Écart d'arrondi confirmé par le CAC",
    });
    attendre(200, force, "acceptation motivée");
    expect(force.json()).toMatchObject({ statut: "accepte", decision: { automatique: false } });

    const incomplet = await a.chef.post(
      `${base()}/etats-financiers`,
      etat(2023, [
        { code: "A1", libelle: "Actif", section: "actif", montant: 10 },
        { code: "P1", libelle: "Passif", section: "passif", montant: 10 },
      ]),
    );
    expect(incomplet.json()).toMatchObject({ statut: "en_revue", conforme: true, complet: false });
    const rejet = await a.chef.post(`${base()}/etats-financiers/${incomplet.json().id}/decision`, {
      decision: "rejete",
      motif: "Compte de résultat manquant",
    });
    expect(rejet.json().statut).toBe("rejete");
    // Un rejet libère l'exercice : un nouvel état n'a rien à remplacer.
    const apres = await a.chef.post(`${base()}/etats-financiers`, etat(2023));
    expect(apres.json()).toMatchObject({ statut: "accepte", remplace_id: null });
  });

  it("tolérance non nulle : jamais d'acceptation automatique ; remplacer un état accepté par un humain passe en revue", async () => {
    // L'importateur choisit la tolérance : elle ne décide pas seule de l'acceptation.
    const tolere = await a.chef.post(
      `${base()}/etats-financiers`,
      etat(2016, lignesEquilibrees(), { tolerance: 10 }),
    );
    attendre(201, tolere, "tolérance");
    expect(tolere.json()).toMatchObject({ statut: "en_revue", decision: null, tolerance: 10 });
    const url = `${base()}/etats-financiers/${tolere.json().id}/decision`;
    expect((await a.directeur.post(url, { decision: "accepte" })).statusCode).toBe(400);
    expect((await a.chef.post(url, { decision: "accepte", motif: "Tolérance" })).statusCode).toBe(
      403,
    );
    const accepte = await a.directeur.post(url, {
      decision: "accepte",
      motif: "Tolérance de 10 unités validée avec le DAF",
    });
    attendre(200, accepte, "acceptation sous tolérance");
    expect(accepte.json()).toMatchObject({ statut: "accepte", decision: { automatique: false } });
    // Remplacer cet état accepté par un humain : revue obligatoire, même parfaitement équilibré.
    const remplace = await a.chef.post(`${base()}/etats-financiers`, etat(2016));
    attendre(201, remplace, "remplacement");
    expect(remplace.json()).toMatchObject({
      statut: "en_revue",
      controles_ok: true,
      decision: null,
      remplace_id: tolere.json().id,
    });
    const urlR = `${base()}/etats-financiers/${remplace.json().id}/decision`;
    expect((await a.chef.post(urlR, { decision: "accepte", motif: "Même état" })).statusCode).toBe(
      403,
    );
    attendre(200, await a.directeur.post(urlR, { decision: "accepte", motif: "Revu" }), "revue");
    // Base : une tolérance non nulle ne s'accepte pas automatiquement, même en contournant l'API.
    const code = await ctx.db
      .withTenant(a.cabinetId, async (db) => {
        const e = await db.query(
          `INSERT INTO dossier_etats_financiers (cabinet_id, client_id, exercice, date_cloture, devise, origine,
             tolerance, controles, totaux, conforme, complet, controles_ok, importe_par)
           VALUES ($1, $2, 2015, '2015-12-31', 'XOF', 'saisie', 5, '[]', '{}', true, true, true, $3)
           RETURNING id`,
          [a.cabinetId, a.clientId, a.associeId],
        );
        await db.query(
          `INSERT INTO dossier_etats_decisions (cabinet_id, etat_id, decision, automatique)
           VALUES ($1, $2, 'accepte', true)`,
          [a.cabinetId, e.rows[0].id],
        );
      })
      .catch((e: { code: string }) => e.code);
    expect(code).toBe("MPO04");
  });

  it("structure refusée par le moteur (400 avec son code) ; base : jamais d'acceptation automatique d'un écart", async () => {
    const cycle = await a.chef.post(
      `${base()}/etats-financiers`,
      etat(2022, [
        { code: "A", libelle: "A", section: "actif", montant: 1, parent: "B" },
        { code: "B", libelle: "B", section: "actif", montant: 1, parent: "A" },
      ]),
    );
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json().erreur.code).toBe("CYCLE_PARENTS");
    expect((await a.chef.post(`${base()}/etats-financiers`, etat(2022, [], {}))).statusCode).toBe(
      400,
    );
    expect(
      (
        await a.chef.post(
          `${base()}/etats-financiers`,
          etat(2022, lignesEquilibrees(), { date_cloture: "2030-12-31" }),
        )
      ).statusCode,
    ).toBe(400);

    const code = await ctx.db
      .withTenant(a.cabinetId, async (db) => {
        const r = await db.query(
          `INSERT INTO dossier_etats_financiers (cabinet_id, client_id, exercice, date_cloture, devise, origine,
             controles, totaux, conforme, complet, controles_ok, importe_par)
           VALUES ($1, $2, 2021, '2021-12-31', 'XOF', 'saisie', '[]', '{}', false, true, false, $3) RETURNING id`,
          [a.cabinetId, a.clientId, a.associeId],
        );
        await db.query(
          `INSERT INTO dossier_etats_decisions (cabinet_id, etat_id, decision, automatique)
           VALUES ($1, $2, 'accepte', true)`,
          [a.cabinetId, r.rows[0].id],
        );
      })
      .catch((e: { code: string }) => e.code);
    expect(code).toBe("MPO04");
  });

  it("import CSV : références de ligne ; ligne en erreur : rapport, rien d'écrit", async () => {
    const csv = [
      "Section;Code;Libellé;Montant;Rôle",
      ...lignesEquilibrees().map(
        (l) =>
          `${l.section};${l.code};${l.libelle};${l.montant.toLocaleString("fr-FR")};${l.role ?? ""}`,
      ),
    ].join("\n");
    const r = await a.chef.post(`${base()}/etats-financiers/csv`, {
      exercice: 2020,
      date_cloture: "2020-12-31",
      devise: "XOF",
      csv,
      nom_fichier: "../liasse 2020.csv",
    });
    attendre(201, r, "csv");
    const e = r.json();
    expect(e).toMatchObject({ origine: "csv", statut: "accepte" });
    expect(e.fichier.nom).toBe("liasse 2020.csv");
    expect(e.fichier.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(e.lignes[1].reference).toEqual({ fichier: "liasse 2020.csv", ligne: 3 });

    const faux = await a.chef.post(`${base()}/etats-financiers/csv`, {
      exercice: 2019,
      date_cloture: "2019-12-31",
      devise: "XOF",
      csv: "section;code;libelle;montant\nactif;A1;Actif;douze\nbilan;A2;X;1",
    });
    expect(faux.statusCode).toBe(400);
    expect(faux.json().erreur.code).toBe("IMPORT_INVALIDE");
    expect(faux.json().erreur.details.erreurs.map((x: { ligne: number }) => x.ligne)).toEqual([
      2, 3,
    ]);
    const sansColonne = await a.chef.post(`${base()}/etats-financiers/csv`, {
      exercice: 2019,
      date_cloture: "2019-12-31",
      devise: "XOF",
      csv: "section;code\nactif;A1",
    });
    expect(sansColonne.json().erreur.details.erreurs[0].message).toContain("libelle");
    const liste = (await a.chef.get(`${base()}/etats-financiers`)).json().elements;
    expect(liste.some((x: { exercice: number }) => x.exercice === 2019)).toBe(false);
  });

  it("import Excel : lecteur borné, référence de cellule ; dossier d'autrui : 404", async () => {
    const c = new ExcelJS.Workbook();
    const f = c.addWorksheet("Bilan");
    f.addRow(["Section", "Code", "Libellé", "Montant", "Rôle"]);
    for (const l of lignesEquilibrees())
      f.addRow([l.section, l.code, l.libelle, l.montant, l.role ?? ""]);
    const contenu = Buffer.from((await c.xlsx.writeBuffer()) as ArrayBuffer);
    const url = `${base()}/etats-financiers/excel?exercice=2018&date_cloture=2018-12-31&devise=XOF`;
    const r = await televerser(a.chef, url, "liasse.xlsx", contenu);
    attendre(201, r, "excel");
    expect(r.json()).toMatchObject({ origine: "excel", statut: "accepte" });
    expect(r.json().lignes[0].reference).toEqual({
      fichier: "liasse.xlsx",
      cellule: "D2",
      ligne: 2,
    });
    expect((await televerser(b.associe, url, "liasse.xlsx", contenu)).statusCode).toBe(404);
    expect((await televerser(expert, url, "liasse.xlsx", contenu)).statusCode).toBe(403);
    expect(
      (await televerser(a.chef, url, "faux.xlsx", Buffer.from("pas un classeur"))).statusCode,
    ).toBe(400);
  });
});

describe("fiabilité, frise, export (DOS-04, DOS-06, DOS-07)", () => {
  it("indice calculé par le moteur, analyses indicatives, instantanés", async () => {
    const r = (await consultantEquipe.get(`${base()}/fiabilite`)).json();
    expect(["A", "B", "C", "D"]).toContain(r.classe);
    expect(r.detail.certification).toBe(15);
    expect(r.detail.informel).toBe(0);
    expect(r.analyses_indicatives).toBe(true);
    expect(r.recommandations.map((x: { code: string }) => x.code)).toContain("INFORMEL_FORT");
    expect(r.historique.length).toBeGreaterThan(1);
  });

  it("frise : missions, décisions du dossier, triées ; tronquée signalée", async () => {
    const f = (await a.chef.get(`${base()}/frise`)).json();
    const types = new Set(f.evenements.map((e: { type: string }) => e.type));
    expect(types.has("mission")).toBe(true);
    expect(types.has("decision")).toBe(true);
    expect(types.has("fait")).toBe(true);
    const dates = f.evenements.map((e: { date: string }) =>
      Date.parse(e.date.length === 10 ? `${e.date}T00:00:00Z` : e.date),
    );
    expect([...dates].sort((x, y) => y - x)).toEqual(dates);
    const court = (await a.chef.get(`${base()}/frise?limite=1`)).json();
    expect(court.evenements).toHaveLength(1);
    expect(court.tronquee).toBe(true);
    expect((await a.chef.get(`${base()}/frise?limite=0`)).statusCode).toBe(400);
  });

  it("export JSON et ZIP : tracés, journalisés, sans membre du cabinet ni donnée FIN-02", async () => {
    const r = await a.chef.get(`${base()}/export`);
    attendre(200, r, "export");
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.headers["cache-control"]).toBe("private, no-store");
    const contenu = r.json();
    expect(contenu.format).toBe("missionpilot.dossier-client");
    expect(contenu.faits.length).toBeGreaterThan(3);
    expect(contenu.etats_financiers[0].lignes.length).toBeGreaterThan(0);
    const texte = r.body;
    // Les motifs de décision (fait rejeté, état accepté malgré un écart) sont internes au cabinet.
    expect(texte).not.toContain("Saisi par erreur");
    expect(texte).not.toContain("Écart d'arrondi confirmé par le CAC");
    expect(texte).not.toContain('"motif"');
    for (const interdit of [
      '"auteur"',
      '"importe_par"',
      '"par"',
      "cout_journalier",
      '"marge',
      '"taux',
    ]) {
      expect(texte).not.toContain(interdit);
    }
    const zip = await a.chef.get(`${base()}/export?format=zip`);
    attendre(200, zip, "zip");
    expect(zip.headers["content-type"]).toBe("application/zip");
    expect(zip.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(zip.rawPayload.includes(Buffer.from("faits.csv"))).toBe(true);
    const traces = await proprietaire(async (c) => {
      const e = await c.query(
        "SELECT format FROM dossier_exports WHERE client_id = $1 ORDER BY cree_le",
        [a.clientId],
      );
      const j = await c.query(
        "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'dossier.exporter' AND entite_id = $1",
        [a.clientId],
      );
      return { formats: e.rows.map((x) => x.format), journal: j.rows[0].n };
    });
    expect(traces).toEqual({ formats: ["json", "zip"], journal: 2 });
    expect((await b.associe.get(`${base()}/export`)).statusCode).toBe(404);
    expect((await a.chef.get(`${base()}/export?format=pdf`)).statusCode).toBe(400);
  });

  it("vue d'ensemble : profil, propositions, facteurs, finances sans constats détaillés", async () => {
    const d = (await expert.get(base())).json();
    expect(d.client.id).toBe(a.clientId);
    expect(d.etats_financiers.length).toBeGreaterThan(0);
    expect(d.etats_financiers[0].constats).toBeUndefined();
    expect(d.facteurs.map((x: { code: string }) => x.code)).toContain("fiabilite_comptes");
    expect(d.fiabilite.classe).toBeDefined();
  });
});
