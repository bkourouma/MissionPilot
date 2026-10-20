import { calculerRatiosRedressement, calculerTendancesRedressement } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  CORRESPONDANCE_CAS_A,
  erreur,
  INCONNU,
  lignesCasA,
  lignesCasAPrecedent,
  ouvrirDossierRed,
  preparerCasA,
  preparerRed,
  RATIOS_CAS_A,
  semerEtat,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Correspondance de postes et ratios (routes 8 à 10) : états semés par `POST /api/dossiers/:id/
 * etats-financiers` ; LES VALEURS DU CAS A de SPEC-3a §6.3 rendues par l'API (14 postes, 10 ratios) ;
 * un état en revue ou remplacé n'entre jamais ; trois exercices au plus ; sans correspondance, les
 * postes sont « à renseigner » (jamais zéro) ; drapeau « analyses indicatives » repris du dossier.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dossierId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED ratios");
  dossierId = (await preparerCasA(s)).dossierId;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("correspondance de postes (routes 8 et 9)", () => {
  it("401, 403, 404 et autre cabinet", async () => {
    const url = `/api/redressement/dossiers/${dossierId}/correspondances`;
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    expect((await api(ctx).post(url, { postes: CORRESPONDANCE_CAS_A })).statusCode).toBe(401);
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      expect((await u.get(url)).statusCode).toBe(403);
      expect((await u.post(url, { postes: CORRESPONDANCE_CAS_A })).statusCode).toBe(403);
    }
    // L'expert métier lit (si la mission est visible) mais n'écrit pas.
    expect((await s.expert.post(url, { postes: CORRESPONDANCE_CAS_A })).statusCode).toBe(403);
    expect((await s.consultantHors.get(url)).statusCode).toBe(404);
    expect((await s.consultantHors.post(url, { postes: CORRESPONDANCE_CAS_A })).statusCode).toBe(
      404,
    );
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.post(url, { postes: CORRESPONDANCE_CAS_A })).statusCode).toBe(404);
  });

  it("lecture : courante, historique et proposition indicative du moteur", async () => {
    const r = await s.a.chef.get(`/api/redressement/dossiers/${dossierId}/correspondances`);
    expect(r.statusCode).toBe(200);
    const c = r.json();
    expect(c.courante.version).toBe(1);
    expect(c.courante.postes.stocks).toEqual({ codes: ["ST"], sans_objet: false });
    expect(c.courante.cree_par.id).toBe(s.a.chef.utilisateurId);
    expect(c.historique).toHaveLength(1);
    expect(Object.keys(c.indicative)).toHaveLength(10);
    expect(c.indicative.stocks).toEqual({ codes: ["BB"], sans_objet: false });
  });

  it("création : versions consécutives, validations du moteur et du schéma", async () => {
    const url = `/api/redressement/dossiers/${dossierId}/correspondances`;
    // Schéma : poste inconnu, sans objet avec codes, ni code ni sans objet, champ inconnu.
    expect(
      (await s.a.chef.post(url, { postes: { inconnu: { codes: ["A"], sans_objet: false } } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await s.a.chef.post(url, { postes: { stocks: { codes: ["A"], sans_objet: true } } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await s.a.chef.post(url, { postes: { stocks: { codes: [], sans_objet: false } } }))
        .statusCode,
    ).toBe(400);
    expect((await s.a.chef.post(url, { postes: {} })).statusCode).toBe(400);
    expect((await s.a.chef.post(url, { postes: CORRESPONDANCE_CAS_A, exces: 1 })).statusCode).toBe(
      400,
    );
    // Moteur : un code en double dans un poste.
    const doublon = await s.a.chef.post(url, {
      postes: { stocks: { codes: ["ST", "ST"], sans_objet: false } },
    });
    expect(doublon.statusCode).toBe(400);
    expect(erreur(doublon)).toBe("RED_CORRESPONDANCE_INVALIDE");
    // Version 2 : stocks sans objet.
    const v2 = await s.consultantEquipe.post(url, {
      postes: { ...CORRESPONDANCE_CAS_A, stocks: { codes: [], sans_objet: true } },
      motif: "Pas de stocks chez ce client",
    });
    attendre(201, v2, "version 2");
    expect(v2.json()).toMatchObject({ version: 2, motif: "Pas de stocks chez ce client" });
    const lu = (await s.a.chef.get(url)).json();
    expect(lu.courante.version).toBe(2);
    expect(lu.historique.map((h: { version: number }) => h.version)).toEqual([2, 1]);
    // Retour à la correspondance du cas A : version 3 (la suite des tests s'appuie sur elle).
    attendre(201, await s.a.chef.post(url, { postes: CORRESPONDANCE_CAS_A }), "version 3");
  });
});

describe("ratios (route 10)", () => {
  it("401, 403, 404, autre cabinet", async () => {
    const url = `/api/redressement/dossiers/${dossierId}/ratios`;
    expect((await api(ctx).get(url)).statusCode).toBe(401);
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      expect((await u.get(url)).statusCode).toBe(403);
    }
    expect((await s.consultantHors.get(url)).statusCode).toBe(404);
    expect((await s.b.associe.get(url)).statusCode).toBe(404);
    expect((await s.a.associe.get(`/api/redressement/dossiers/${INCONNU}/ratios`)).statusCode).toBe(
      404,
    );
  });

  it("les valeurs du cas A (points de base) : dix ratios et quatorze postes, identiques au moteur", async () => {
    const r = await s.a.chef.get(`/api/redressement/dossiers/${dossierId}/ratios`);
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.correspondance_version).toBe(3);
    expect(v.exercices).toHaveLength(2);
    const n = v.exercices[0];
    expect(n).toMatchObject({ exercice: 2025, devise: "XOF", accepte_sous_reserve: false });
    expect(n.date_cloture).toBe("2025-12-31");
    for (const [cle, attendu] of Object.entries(RATIOS_CAS_A)) {
      expect(n.ratios[cle], cle).toMatchObject({
        valeur: attendu,
        statut: "calcule",
        raison: null,
        manquants: [],
      });
    }
    expect(n.postes).toMatchObject({
      stocks: 120_000_000,
      creances_clients: 240_000_000,
      autres_creances: 30_000_000,
      tresorerie_actif: 60_000_000,
      capitaux_propres: 150_000_000,
      dettes_financieres: 200_000_000,
      dettes_fournisseurs: 180_000_000,
      dettes_court_terme: 330_000_000,
      chiffre_affaires: 1_200_000_000,
      cout_ventes: 780_000_000,
      resultat_exploitation: 48_000_000,
      charges_financieres: 24_000_000,
      resultat_net: 18_000_000,
    });
    // Le même calcul par le moteur donne exactement ces valeurs (aucun calcul dans l'API).
    const moteur = calculerRatiosRedressement(
      {
        exercice: 2025,
        devise: "XOF",
        lignes: lignesCasA().map((l) => ({ code: l.code, montant: l.montant })),
        totalActif: 800_000_000,
        totalPassif: 800_000_000,
        resultatNet: 18_000_000,
      },
      {
        stocks: { codes: ["ST"], sansObjet: false },
        creances_clients: { codes: ["CL"], sansObjet: false },
        autres_creances: { codes: ["AC"], sansObjet: false },
        tresorerie_actif: { codes: ["TR"], sansObjet: false },
        capitaux_propres: { codes: ["CP", "CJ"], sansObjet: false },
        dettes_financieres: { codes: ["DF"], sansObjet: false },
        dettes_fournisseurs: { codes: ["DJ"], sansObjet: false },
        dettes_court_terme: { codes: ["DJ", "DX"], sansObjet: false },
        chiffre_affaires: { codes: ["XB"], sansObjet: false },
        cout_ventes: { codes: ["RA"], sansObjet: false },
        resultat_exploitation: { codes: ["XE"], sansObjet: false },
        charges_financieres: { codes: ["RF"], sansObjet: false },
        resultat_net: { codes: ["XI"], sansObjet: false },
      },
    );
    for (const cle of Object.keys(RATIOS_CAS_A)) {
      expect(n.ratios[cle].valeur).toBe(moteur.ratios[cle as keyof typeof moteur.ratios].valeur);
    }
    expect(calculerTendancesRedressement(moteur, null).raison).toBe("exercice_precedent_absent");
    // Tendances : N (CA 1,2 G, marge 3500) contre N-1 (CA 1 G, coût 620 M, marge 3800).
    expect(v.tendances).toEqual({
      croissance_ca_pb: 2000,
      variation_marge_brute_pb: -300,
      raison: null,
    });
    expect(typeof v.analyses_indicatives).toBe("boolean");
    expect(v.fiabilite).toMatchObject({ classe: expect.any(String), points: expect.any(Number) });
    expect(v.etats_non_utilises).toEqual([]);
  });

  it("un état en revue ou remplacé n'entre jamais ; au plus trois exercices, le plus récent d'abord", async () => {
    // État 2026 en écart : en revue, jamais utilisé.
    const ecart = lignesCasA().map((l) => (l.code === "DX" ? { ...l, montant: 140_000_000 } : l));
    const enRevue = await semerEtat(s.a.chef, s.a.clientId, 2026, ecart);
    expect(enRevue.statut).toBe("en_revue");
    // 2024 remplacé par une nouvelle saisie identique : l'ancien est « remplacé ».
    const remplacant = await semerEtat(s.a.chef, s.a.clientId, 2024, lignesCasAPrecedent());
    expect(remplacant.statut).toBe("accepte");
    // Deux exercices acceptés de plus : quatre au total, trois servis.
    await semerEtat(s.a.chef, s.a.clientId, 2023, lignesCasAPrecedent());
    await semerEtat(s.a.chef, s.a.clientId, 2022, lignesCasAPrecedent());
    const v = (await s.a.chef.get(`/api/redressement/dossiers/${dossierId}/ratios`)).json();
    expect(v.exercices.map((e: { exercice: number }) => e.exercice)).toEqual([2025, 2024, 2023]);
    const nonUtilises = v.etats_non_utilises as {
      etat_id: string;
      exercice: number;
      statut: string;
    }[];
    expect(nonUtilises.find((e) => e.etat_id === enRevue.id)).toMatchObject({
      exercice: 2026,
      statut: "en_revue",
    });
    expect(nonUtilises.some((e) => e.statut === "remplace" && e.exercice === 2024)).toBe(true);
    // L'état en revue n'a servi à aucun exercice, ni à une tendance.
    expect(v.exercices.some((e: { etat_id: string }) => e.etat_id === enRevue.id)).toBe(false);
    expect(v.tendances.croissance_ca_pb).toBe(2000);
  });

  it("sans correspondance : postes à renseigner (jamais zéro), résultat net repris de l'état", async () => {
    const m = await creerMission(s.a, { intitule: "Sans correspondance" });
    const d = await ouvrirDossierRed(s, m.id);
    const v = (await s.a.chef.get(`/api/redressement/dossiers/${d.id}/ratios`)).json();
    expect(v.correspondance_version).toBeNull();
    const n = v.exercices[0];
    expect(n.ratios.liquidite_generale).toMatchObject({
      statut: "non_calculable",
      raison: "postes_manquants",
    });
    expect(n.ratios.liquidite_generale.manquants).toContain("stocks");
    expect(n.ratios.liquidite_generale.valeur).toBeNull();
    expect(n.postes.stocks).toBeUndefined();
    // Le résultat net déclaré par l'état est repris (ratios d'ensemble absents sans CA : marge nette manquante).
    expect(n.postes.resultat_net).toBe(18_000_000);
    expect(n.ratios.marge_nette).toMatchObject({
      statut: "non_calculable",
      manquants: ["chiffre_affaires"],
    });
  });

  it("sans aucun état accepté : exercices vides, tendances nulles", async () => {
    const autre = await creerMission(s.a, { intitule: "Autre client" });
    // Un client sans état : nouveau client du cabinet.
    const c = await s.a.associe.post("/api/clients", {
      raison_sociale: "Client sans états (fictif)",
    });
    attendre(201, c, "client");
    const m2 = await creerMission(s.a, {
      intitule: "Mission du client vide",
      client_id: c.json().id,
    });
    expect(autre.id).toBeTruthy();
    const d = await ouvrirDossierRed(s, m2.id);
    const v = (await s.a.chef.get(`/api/redressement/dossiers/${d.id}/ratios`)).json();
    expect(v.exercices).toEqual([]);
    expect(v.tendances).toBeNull();
    expect(v.etats_non_utilises).toEqual([]);
  });
});
