import {
  agregerTresorerieMensuelle,
  calculerPlanFinancement,
  EMPLOIS_FINANCEMENT_RED,
  evaluerCovenants,
  FREQUENCES_COVENANT_RED,
  OPERATEURS_COVENANT_RED,
  projeterTresorerie,
  RATIOS_COVENANT_RED,
  RESSOURCES_FINANCEMENT_RED,
  TYPES_PERIODE_FINANCEMENT_RED,
  type CleRatioRedressement,
  type RatioRedressement,
} from "@missionpilot/engines";
import {
  RED_COVENANT_FREQUENCES,
  RED_COVENANT_OPERATEURS,
  RED_COVENANT_RATIOS,
  RED_FINANCEMENT_EMPLOIS,
  RED_FINANCEMENT_RESSOURCES,
  RED_FINANCEMENT_TYPES_PERIODE,
} from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Auth } from "../src/auth/contexte.js";
import { evaluerCovenantsDossier } from "../src/redressement/covenants.js";
import { lireDossier } from "../src/redressement/acces.js";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee } from "./missions-outils.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";
import {
  COVENANTS_CAS_A,
  codeSql,
  covenant,
  DEBUT,
  LIGNES_FIN,
  LIGNES_TRESO,
  ligneFin,
  M,
  nouveauDossier,
  planFin,
  realiseTreso,
  semerTresorerie,
  urlD,
} from "./redressement-financement-outils.js";
import {
  CORRESPONDANCE_CAS_A,
  erreur,
  INCONNU,
  ouvrirDossierRed,
  preparerCasA,
  preparerRed,
  RATIOS_CAS_A,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Vue mensuelle de la trésorerie, covenants bancaires et plan de financement (RED-06, lot 2) :
 * droits, portail fermé, isolation, valeurs exactes comparées aux moteurs, `non_calculable`,
 * ajout seul et versions consécutives (SQL), dossier clos, plafonds, entrées invalides, journal
 * sans montant ni texte libre. Un covenant « en défaut » est un constat arithmétique.
 */

let ctx: Contexte;
let s: ScenarioRed;
let cas: string; // dossier du cas A (états acceptés, correspondance)
let portail: UtilisateurPortail;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED financement");
  cas = (await preparerCasA(s)).dossierId;
  // L’expert métier est membre de l’équipe : il lit (200) sans écrire (403).
  attendre(
    201,
    await s.a.chef.post(`/api/missions/${s.missionId}/equipe`, {
      utilisateur_id: s.expert.utilisateurId,
    }),
    "équipe",
  );
  portail = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
}, 180_000);

afterAll(async () => {
  await ctx.fermer();
});

const ratiosMoteur = (vue: Record<string, Record<string, unknown>>) => {
  const r = {} as Record<CleRatioRedressement, RatioRedressement>;
  for (const [cle, v] of Object.entries(vue)) {
    r[cle as CleRatioRedressement] = {
      valeur: v.valeur as number | null,
      statut: v.statut as RatioRedressement["statut"],
      raison: v.raison as RatioRedressement["raison"],
      manquants: v.manquants as RatioRedressement["manquants"],
    };
  }
  return r;
};

/* ------------------------------------------------------------------------------------------ */
/* Droits                                                                                      */
/* ------------------------------------------------------------------------------------------ */

describe("accès : 401, 403, 404, portail fermé", () => {
  const defs = (id: string) =>
    [
      ["GET", urlD(id, "/tresorerie/mensuelle"), undefined, "lecture"],
      ["GET", urlD(id, "/covenants"), undefined, "lecture"],
      ["POST", urlD(id, "/covenants/versions"), { covenants: [covenant()] }, "ecriture"],
      ["GET", urlD(id, "/financement"), undefined, "lecture"],
      ["POST", urlD(id, "/financement/versions"), planFin(), "ecriture"],
      ["GET", urlD(id, "/financement/proposition"), undefined, "lecture"],
    ] as const;
  type Appelant = {
    get: (u: string) => Promise<{ statusCode: number }>;
    post: (u: string, b: unknown) => Promise<{ statusCode: number }>;
  };
  const appeler = (par: Appelant, d: ReturnType<typeof defs>[number]) =>
    d[0] === "GET" ? par.get(d[1]) : par.post(d[1], d[2]);

  it("sans session : 401 ; gestionnaire, ressources, expert externe : 403 ; portail : 403 PORTAIL_ROUTE_INTERDITE", async () => {
    for (const d of defs(cas)) {
      expect((await appeler(api(ctx), d)).statusCode, `401 ${d[1]}`).toBe(401);
      for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
        expect((await appeler(u, d)).statusCode, `403 ${d[1]}`).toBe(403);
      }
      const p = (await appeler(portail, d)) as { statusCode: number; json: () => never };
      expect(p.statusCode, `portail ${d[1]}`).toBe(403);
      expect(erreur(p), `portail ${d[1]}`).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("expert métier : lit (200), n'écrit pas (403)", async () => {
    for (const d of defs(cas)) {
      const code = (await appeler(s.expert, d)).statusCode;
      expect(code, d[1]).toBe(d[3] === "lecture" ? 200 : 403);
    }
  });

  it("consultant hors équipe et autre cabinet : 404 ; dossier inconnu : 404", async () => {
    for (const d of defs(cas)) {
      expect((await appeler(s.consultantHors, d)).statusCode, `hors équipe ${d[1]}`).toBe(404);
      expect((await appeler(s.b.associe, d)).statusCode, `autre cabinet ${d[1]}`).toBe(404);
    }
    for (const d of defs(INCONNU)) {
      expect((await appeler(s.a.associe, d)).statusCode, `inconnu ${d[1]}`).toBe(404);
    }
  });

  it("associé, chef de mission et consultant d'équipe écrivent (201)", async () => {
    for (const u of [s.a.associe, s.a.chef, s.consultantEquipe]) {
      attendre(
        201,
        await u.post(urlD(cas, "/covenants/versions"), { covenants: [covenant()] }),
        "covenants",
      );
      attendre(201, await u.post(urlD(cas, "/financement/versions"), planFin()), "financement");
    }
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Vue mensuelle                                                                               */
/* ------------------------------------------------------------------------------------------ */

describe("vue mensuelle de la trésorerie", () => {
  it("sans version de trésorerie : rien n'est calculé", async () => {
    const d = await nouveauDossier(s, "Mensuel vide");
    const r = await s.a.chef.get(urlD(d, "/tresorerie/mensuelle"));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ version: null, mensuel: null });
  });

  it("valeurs exactes, égales au moteur ; une semaine appartient au mois de son lundi", async () => {
    const d = await nouveauDossier(s, "Mensuel");
    await semerTresorerie(s.a.chef, d);
    const r = await s.a.chef.get(urlD(d, "/tresorerie/mensuelle"));
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.version).toMatchObject({ version: 1, date_debut: DEBUT, seuil_tension: 10 * M });
    const m = v.mensuel;
    expect(m.mois.map((x: { mois: string }) => x.mois)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
    expect(m.mois.map((x: { semaines: number[] }) => x.semaines)).toEqual([
      [1, 2, 3],
      [4, 5, 6, 7, 8],
      [9, 10, 11, 12],
      [13],
    ]);
    expect(m.mois[0]).toMatchObject({
      debut: DEBUT,
      fin: "2026-11-01",
      partiel: true,
      encaissements: 65 * M,
      decaissements: 130 * M,
      flux_net: -65 * M,
      solde_ouverture: 50 * M,
      solde_fin: -15 * M,
      solde_minimum: { semaine: 3, montant: -15 * M },
      tension: true,
      semaines_tension: [2, 3],
    });
    expect(m.mois[1]).toMatchObject({ encaissements: 90 * M, decaissements: 0, solde_fin: 75 * M });
    expect(m.mois[3]).toMatchObject({ decaissements: 5 * M, solde_fin: 70 * M, partiel: true });
    expect(m.mois_tension).toEqual(["2026-10"]);
    expect(m.solde_minimum).toEqual({ mois: "2026-10", semaine: 3, montant: -15 * M });
    // Le même calcul par les moteurs donne exactement ces valeurs.
    const moteur = agregerTresorerieMensuelle(
      projeterTresorerie({
        dateDebut: DEBUT,
        soldeInitial: 50 * M,
        seuilTension: 10 * M,
        lignes: LIGNES_TRESO,
        realises: [],
      } as never),
    );
    expect(m.mois.map((x: { flux_net: number }) => x.flux_net)).toEqual(
      moteur.mois.map((x) => x.fluxNet),
    );
    expect(m.mois.map((x: { solde_fin: number }) => x.solde_fin)).toEqual(
      moteur.mois.map((x) => x.soldeFin),
    );
    expect(m.totaux).toEqual({
      encaissements: moteur.totaux.encaissements,
      decaissements: moteur.totaux.decaissements,
      flux_net: moteur.totaux.fluxNet,
    });
    // Cohérence avec la vue hebdomadaire.
    const hebdo = (await s.a.chef.get(urlD(d, "/tresorerie"))).json().projection;
    expect(m.solde_minimum.montant).toBe(hebdo.solde_minimum.montant);
  });

  it("un réalisé remplace la prévision de sa semaine dans les flux du mois", async () => {
    const d = await nouveauDossier(s, "Mensuel réalisé");
    await semerTresorerie(s.a.chef, d, true);
    const m = (await s.a.chef.get(urlD(d, "/tresorerie/mensuelle"))).json().mensuel;
    expect(m.mois[0]).toMatchObject({
      semaines_realisees: 1,
      encaissements: (28 + 20 + 15) * M,
      decaissements: (66 + 30 + 35) * M,
    });
    expect(realiseTreso(DEBUT).flux.encaissement.clients).toBe(28 * M);
  });

  it("aucune écriture, aucun journal", async () => {
    const d = await nouveauDossier(s, "Mensuel lecture");
    await semerTresorerie(s.a.chef, d);
    const avant = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM journal_audit"),
    );
    await s.a.chef.get(urlD(d, "/tresorerie/mensuelle"));
    const apres = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM journal_audit"),
    );
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Covenants                                                                                   */
/* ------------------------------------------------------------------------------------------ */

describe("covenants bancaires", () => {
  it("sans version : lecture vide avec la mention", async () => {
    const d = await nouveauDossier(s, "Covenants vide");
    const v = (await s.a.chef.get(urlD(d, "/covenants"))).json();
    expect(v).toMatchObject({ version: null, exercice: null, synthese: null, historique: [] });
    expect(v.mention).toMatch(/Constat arithmétique/);
    expect(
      await ctx.db.withTenant(s.a.cabinetId, async (db) => {
        const dossier = await lireDossier(db, d);
        return evaluerCovenantsDossier(db, {} as Auth, dossier as never);
      }),
    ).toBeNull();
  });

  it("cas A : valeurs, marges et statuts exacts, égaux à ceux du moteur", async () => {
    const d = await nouveauDossier(s, "Covenants cas A");
    attendre(
      201,
      await s.a.associe.post(urlD(d, "/correspondances"), {
        postes: CORRESPONDANCE_CAS_A,
      }),
      "correspondance",
    );
    const r = await s.a.associe.post(urlD(d, "/covenants/versions"), {
      covenants: COVENANTS_CAS_A,
      motif: "Contrat de prêt",
    });
    attendre(201, r, "covenants");
    const v = r.json();
    expect(v.version).toMatchObject({ version: 1, motif: "Contrat de prêt" });
    expect(v.exercice).toMatchObject({
      exercice: 2025,
      devise: "XOF",
      accepte_sous_reserve: false,
    });
    const par = Object.fromEntries(
      v.version.covenants.map((c: { ratio: string; evaluation: unknown }) => [c.ratio, c]),
    );
    expect(par.liquidite_generale.evaluation).toMatchObject({
      statut: "respecte",
      valeur_pb: RATIOS_CAS_A.liquidite_generale,
      marge_pb: 0,
    });
    expect(par.endettement.evaluation).toMatchObject({
      statut: "en_defaut",
      valeur_pb: RATIOS_CAS_A.endettement,
      marge_pb: 12_000 - RATIOS_CAS_A.endettement,
    });
    expect(par.couverture_charges_financieres.evaluation).toMatchObject({
      statut: "respecte",
      marge_pb: RATIOS_CAS_A.couverture_charges_financieres - 15_000,
    });
    expect(par.autonomie_financiere.evaluation).toMatchObject({
      statut: "en_defaut",
      marge_pb: RATIOS_CAS_A.autonomie_financiere - 2_000,
    });
    expect(par.liquidite_generale).toMatchObject({
      rang: 1,
      operateur: "min",
      seuil_pb: 13_636,
      preteur: "Banque de développement",
      frequence: "annuelle",
    });
    expect(v.synthese).toEqual({ nombre: 4, respectes: 2, en_defaut: 2, non_calculables: 0 });
    // Le moteur, alimenté par les ratios de la route 10, rend les mêmes évaluations.
    const ratios = (await s.a.chef.get(urlD(d, "/ratios"))).json().exercices[0].ratios;
    const moteur = evaluerCovenants(
      COVENANTS_CAS_A.map((c) => ({
        ratio: c.ratio as never,
        operateur: c.operateur as never,
        seuilPb: c.seuil_pb,
        preteur: (c as { preteur?: string }).preteur ?? null,
        frequence: c.frequence as never,
      })),
      ratiosMoteur(ratios),
    );
    expect(
      v.version.covenants.map((c: { evaluation: { statut: string; marge_pb: number } }) => [
        c.evaluation.statut,
        c.evaluation.marge_pb,
      ]),
    ).toEqual(moteur.evaluations.map((e) => [e.statut, e.margePb]));
    // Réutilisable par le tableau de bord : nombre de covenants en défaut.
    const enDefaut = await ctx.db.withTenant(s.a.cabinetId, async (db) => {
      const dossier = await lireDossier(db, d);
      return evaluerCovenantsDossier(db, {} as Auth, dossier as never);
    });
    expect(enDefaut).toBe(2);
  });

  it("versions en ajout seul : la nouvelle devient courante, l'historique garde les anciennes", async () => {
    const d = await nouveauDossier(s, "Covenants versions");
    const un = await s.a.associe.post(urlD(d, "/covenants/versions"), {
      covenants: [covenant({ preteur: "Banque A" })],
    });
    attendre(201, un, "v1");
    const deux = await s.a.associe.post(urlD(d, "/covenants/versions"), {
      covenants: [
        covenant(),
        covenant({ ratio: "endettement", operateur: "max", seuil_pb: 20_000 }),
      ],
      motif: "Avenant",
    });
    attendre(201, deux, "v2");
    const v = deux.json();
    expect(v.version.version).toBe(2);
    expect(v.version.covenants).toHaveLength(2);
    expect(v.historique.map((h: { version: number }) => h.version)).toEqual([2, 1]);
    expect(v.historique.map((h: { nombre_covenants: number }) => h.nombre_covenants)).toEqual([
      2, 1,
    ]);
    // Une version vide retire tous les covenants (l'historique reste).
    const vide = await s.a.associe.post(urlD(d, "/covenants/versions"), { covenants: [] });
    attendre(201, vide, "v3");
    expect(vide.json().version.covenants).toEqual([]);
    expect(vide.json().synthese).toEqual({
      nombre: 0,
      respectes: 0,
      en_defaut: 0,
      non_calculables: 0,
    });
    expect(
      await ctx.db.withTenant(s.a.cabinetId, async (db) =>
        evaluerCovenantsDossier(db, {} as Auth, (await lireDossier(db, d)) as never),
      ),
    ).toBeNull();
    const n = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM red_covenants_lignes WHERE dossier_id = $1", [d]),
    );
    expect(n.rows[0].n).toBe(3);
  });

  it("non calculable : sans état accepté, puis sans correspondance (postes à renseigner)", async () => {
    const c = await s.a.associe.post("/api/clients", {
      raison_sociale: "Client sans états (fictif)",
    });
    attendre(201, c, "client");
    const m = await creerMission(s.a, { intitule: "Client vide", client_id: c.json().id });
    const vide = (await ouvrirDossierRed(s, m.id)).id;
    const r = await s.a.chef.post(urlD(vide, "/covenants/versions"), { covenants: [covenant()] });
    attendre(201, r, "covenant");
    expect(r.json().exercice).toBeNull();
    expect(r.json().version.covenants[0].evaluation).toMatchObject({
      statut: "non_calculable",
      valeur_pb: null,
      marge_pb: null,
      raison: "aucun_etat_accepte",
    });
    expect(r.json().synthese).toEqual({
      nombre: 1,
      respectes: 0,
      en_defaut: 0,
      non_calculables: 1,
    });

    const sansCorrespondance = await nouveauDossier(s, "Sans correspondance");
    const r2 = await s.a.chef.post(urlD(sansCorrespondance, "/covenants/versions"), {
      covenants: [covenant()],
    });
    attendre(201, r2, "covenant");
    const ev = r2.json().version.covenants[0].evaluation;
    expect(ev).toMatchObject({ statut: "non_calculable", raison: "ratio_non_calculable" });
    expect(ev.manquants).toContain("stocks");
    expect(r2.json().synthese.non_calculables).toBe(1);
  });

  it("entrées invalides : 400 (schéma) et aucune version créée", async () => {
    const d = await nouveauDossier(s, "Covenants invalides");
    const url = urlD(d, "/covenants/versions");
    const cas: unknown[] = [
      {},
      { covenants: [covenant({ ratio: "marge_brute" })] },
      { covenants: [covenant({ ratio: "bfr_jours" })] },
      { covenants: [covenant({ operateur: "egal" })] },
      { covenants: [covenant({ frequence: "mensuelle" })] },
      { covenants: [covenant({ seuil_pb: 1.5 })] },
      { covenants: [covenant({ seuil_pb: 100_000_001 })] },
      { covenants: [covenant({ preteur: "x".repeat(121) })] },
      { covenants: [covenant({ exces: 1 })] },
      { covenants: [covenant(), covenant({ seuil_pb: 1 })] },
      {
        covenants: [
          covenant({ seuil_pb: 20_000 }),
          covenant({ operateur: "max", seuil_pb: 10_000 }),
        ],
      },
      {
        covenants: RED_COVENANT_RATIOS.flatMap((ratio) => [
          covenant({ ratio, seuil_pb: 0 }),
          covenant({ ratio, operateur: "max", seuil_pb: 1 }),
        ]),
      },
      { covenants: [], motif: "x".repeat(501) },
      { covenants: [], exces: 1 },
    ];
    for (const c of cas) {
      expect((await s.a.chef.post(url, c)).statusCode, JSON.stringify(c).slice(0, 90)).toBe(400);
    }
    const lu = (await s.a.chef.get(urlD(d, "/covenants"))).json();
    expect(lu.historique).toEqual([]);
  });

  it("douze covenants (plafond d'une version) passent", async () => {
    const d = await nouveauDossier(s, "Covenants douze");
    const douze = RED_COVENANT_RATIOS.flatMap((ratio) => [
      covenant({ ratio, seuil_pb: 0 }),
      covenant({ ratio, operateur: "max", seuil_pb: 20_000 }),
    ]).slice(0, 12);
    const r = await s.a.chef.post(urlD(d, "/covenants/versions"), { covenants: douze });
    attendre(201, r, "douze covenants");
    expect(r.json().version.covenants).toHaveLength(12);
  });

  it("journal : identifiants et comptes seulement (ni prêteur, ni seuil, ni motif)", async () => {
    const d = await nouveauDossier(s, "Covenants journal");
    const r = await s.a.chef.post(urlD(d, "/covenants/versions"), {
      covenants: [covenant({ preteur: "Banque Confidentielle", seuil_pb: 13_636 })],
      motif: "Motif confidentiel",
    });
    attendre(201, r, "covenants");
    const j = await proprietaire((c) =>
      c.query(
        "SELECT details, details::text AS texte FROM journal_audit WHERE entite = 'red_covenants' AND action = 'covenants_version' AND entite_id = $1",
        [r.json().version.id],
      ),
    );
    expect(Object.keys(j.rows[0].details).sort()).toEqual([
      "dossier_id",
      "nombre_covenants",
      "version",
    ]);
    expect(j.rows[0].texte).not.toMatch(/Confidentielle|confidentiel|13636/);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Plan de financement                                                                         */
/* ------------------------------------------------------------------------------------------ */

describe("plan de financement", () => {
  it("sans version : lecture vide avec la devise du dossier", async () => {
    const d = await nouveauDossier(s, "Financement vide");
    const v = (await s.a.chef.get(urlD(d, "/financement"))).json();
    expect(v).toEqual({ devise: "XOF", version: null, plan: null, historique: [] });
  });

  it("totaux par période et cumulés, soldes, couvertures : égaux au moteur", async () => {
    const d = await nouveauDossier(s, "Financement plan");
    const r = await s.consultantEquipe.get(urlD(cas, "/financement"));
    expect(r.statusCode).toBe(200);
    const cree = await s.a.associe.post(urlD(d, "/financement/versions"), planFin());
    attendre(201, cree, "plan");
    const v = cree.json();
    expect(v.version).toMatchObject({
      version: 1,
      date_debut: "2026-07-01",
      type_periode: "annee",
      nombre_periodes: 3,
      motif: "Plan initial",
    });
    expect(v.version.lignes).toHaveLength(7);
    expect(v.version.lignes[1]).toMatchObject({
      rang: 2,
      periode: 1,
      sens: "emploi",
      nature: "besoin_fonds_roulement",
      libelle: "Reconstitution du BFR",
      montant: 50 * M,
    });
    const p = v.plan;
    expect(
      p.periodes.map(
        (x: { emplois: number; ressources: number; solde: number; statut: string }) => [
          x.emplois,
          x.ressources,
          x.solde,
          x.statut,
        ],
      ),
    ).toEqual([
      [150 * M, 120 * M, -30 * M, "insuffisance"],
      [80 * M, 40 * M, -40 * M, "insuffisance"],
      [0, 60 * M, 60 * M, "equilibre"],
    ]);
    expect(p.periodes[0]).toMatchObject({
      debut: "2026-07-01",
      fin: "2027-06-30",
      couverture_pb: 8000,
      cumul_emplois: 150 * M,
      solde_cumule: -30 * M,
    });
    expect(p.periodes[2]).toMatchObject({
      couverture_pb: null,
      solde_cumule: -10 * M,
      couverture_cumulee_pb: 9565,
      statut_cumule: "insuffisance",
    });
    expect(p.totaux).toEqual({ emplois: 230 * M, ressources: 220 * M, solde: -10 * M });
    expect(p).toMatchObject({
      couverture_totale_pb: 9565,
      periodes_insuffisance: [1, 2],
      premiere_periode_insuffisance: 1,
      insuffisance_maximale_cumulee: 70 * M,
      equilibre: false,
    });
    const moteur = calculerPlanFinancement({
      dateDebut: "2026-07-01",
      typePeriode: "annee",
      nombrePeriodes: 3,
      lignes: LIGNES_FIN.map((l) => ({
        periode: l.periode,
        sens: l.sens,
        nature: l.nature,
        montant: l.montant,
      })),
    });
    expect(p.periodes.map((x: { solde: number }) => x.solde)).toEqual(
      moteur.periodes.map((x) => x.solde),
    );
    expect(p.periodes.map((x: { couverture_pb: number | null }) => x.couverture_pb)).toEqual(
      moteur.periodes.map((x) => x.couverturePb),
    );
  });

  it("une seconde version (semestres) devient courante ; l'historique garde la première", async () => {
    const d = await nouveauDossier(s, "Financement versions");
    attendre(201, await s.a.associe.post(urlD(d, "/financement/versions"), planFin()), "v1");
    const deux = await s.a.associe.post(
      urlD(d, "/financement/versions"),
      planFin({
        type_periode: "semestre",
        nombre_periodes: 2,
        date_debut: "2027-01-01",
        lignes: [
          ligneFin(1, "emploi", "charges_restructuration", 10 * M),
          ligneFin(1, "ressource", "report_echeances_obtenu", 10 * M),
        ],
        motif: "Plan révisé",
      }),
    );
    attendre(201, deux, "v2");
    const v = deux.json();
    expect(v.version).toMatchObject({ version: 2, type_periode: "semestre", nombre_periodes: 2 });
    expect(v.plan.periodes.map((x: { fin: string }) => x.fin)).toEqual([
      "2027-06-30",
      "2027-12-31",
    ]);
    expect(v.plan).toMatchObject({ equilibre: true, couverture_totale_pb: 10000 });
    expect(
      v.historique.map((h: { version: number; nombre_lignes: number }) => [
        h.version,
        h.nombre_lignes,
      ]),
    ).toEqual([
      [2, 2],
      [1, 7],
    ]);
  });

  it("entrées invalides : 400 et aucune version créée", async () => {
    const d = await nouveauDossier(s, "Financement invalides");
    const url = urlD(d, "/financement/versions");
    const cas: unknown[] = [
      planFin({ date_debut: "2026-07-02" }),
      planFin({ date_debut: "1999-01-01" }),
      planFin({ type_periode: "trimestre" }),
      planFin({ nombre_periodes: 0 }),
      planFin({ nombre_periodes: 9 }),
      planFin({ lignes: [ligneFin(1, "emploi", "apport_associes", M)] }),
      planFin({ lignes: [ligneFin(1, "ressource", "investissements", M)] }),
      planFin({ lignes: [ligneFin(4, "emploi", "investissements", M)] }),
      planFin({ lignes: [ligneFin(1, "emploi", "investissements", 0)] }),
      planFin({ lignes: [ligneFin(1, "emploi", "investissements", 1.5)] }),
      planFin({ lignes: [ligneFin(1, "emploi", "investissements", 10_000_000_000_001)] }),
      planFin({ lignes: [ligneFin(1, "emploi", "investissements", M, { exces: 1 })] }),
      planFin({
        lignes: Array.from({ length: 201 }, () => ligneFin(1, "emploi", "investissements", 1)),
      }),
      planFin({ exces: 1 }),
    ];
    for (const c of cas) {
      expect((await s.a.chef.post(url, c)).statusCode, JSON.stringify(c).slice(0, 90)).toBe(400);
    }
    expect((await s.a.chef.get(urlD(d, "/financement"))).json().historique).toEqual([]);
  });

  it("plafonds de volume : 200 lignes d'un montant de 10^13 passent, sommes exactes", async () => {
    const d = await nouveauDossier(s, "Financement volume");
    const gros = 10_000_000_000_000;
    const r = await s.a.chef.post(
      urlD(d, "/financement/versions"),
      planFin({
        nombre_periodes: 1,
        lignes: Array.from({ length: 200 }, () => ligneFin(1, "emploi", "investissements", gros)),
      }),
    );
    attendre(201, r, "200 lignes");
    expect(r.json().plan.totaux).toEqual({
      emplois: 200 * gros,
      ressources: 0,
      solde: -200 * gros,
    });
  });

  it("journal : identifiants et comptes seulement (ni libellé, ni montant, ni motif)", async () => {
    const d = await nouveauDossier(s, "Financement journal");
    const r = await s.a.chef.post(
      urlD(d, "/financement/versions"),
      planFin({
        lignes: [
          ligneFin(1, "emploi", "investissements", 123_456_789, { libelle: "Libellé secret" }),
        ],
        motif: "Motif secret",
      }),
    );
    attendre(201, r, "plan");
    const j = await proprietaire((c) =>
      c.query(
        "SELECT details, details::text AS texte FROM journal_audit WHERE entite = 'red_financement' AND action = 'financement_version' AND entite_id = $1",
        [r.json().version.id],
      ),
    );
    expect(Object.keys(j.rows[0].details).sort()).toEqual([
      "dossier_id",
      "nombre_lignes",
      "version",
    ]);
    expect(j.rows[0].texte).not.toMatch(/secret|123456789/);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Proposition d'emplois                                                                       */
/* ------------------------------------------------------------------------------------------ */

describe("proposition d'emplois (n'écrit rien)", () => {
  let d: string;

  beforeAll(async () => {
    d = await nouveauDossier(s, "Proposition");
    const cr = await s.a.chef.post(urlD(d, "/creanciers"), {
      nom: "Banque de développement",
      categorie: "banque",
      principal: 90 * M,
      interets: 10 * M,
      date_arrete: "2026-10-01",
      echeance_initiale: "2026-09-30",
    });
    attendre(201, cr, "créancier");
    attendre(
      201,
      await s.a.chef.post(`/api/redressement/creanciers/${cr.json().id}/evenements`, {
        type: "accord",
        date_evenement: "2026-10-10",
        montant: 80 * M,
        echeancier: {
          mode: "regulier",
          nombre_echeances: 4,
          date_premiere: "2026-11-15",
          periodicite_mois: 1,
        },
      }),
      "accord",
    );
    await semerTresorerie(s.a.chef, d);
  });

  it("sans trésorerie ni accord : aucune ligne, cadre par défaut (3 années)", async () => {
    const vide = await nouveauDossier(s, "Proposition vide");
    const r = await s.a.chef.get(urlD(vide, "/financement/proposition"));
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v).toMatchObject({
      devise: "XOF",
      lignes: [],
      anterieures: 0,
      ulterieures: 0,
      besoin_hors_plan: false,
      besoin_tresorerie: null,
    });
    expect(v.cadre).toMatchObject({ type_periode: "annee", nombre_periodes: 3 });
    expect(v.cadre.date_debut).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("besoin de la trésorerie (25 M, point bas du 26 oct.) et échéances restantes de l'accord (4 × 20 M)", async () => {
    const r = await s.consultantEquipe.get(urlD(d, "/financement/proposition"));
    // Le consultant n'est pas de l'équipe de cette mission : 404 ; l'associé lit.
    expect(r.statusCode).toBe(404);
    const ok = (await s.a.associe.get(urlD(d, "/financement/proposition"))).json();
    expect(ok.cadre).toEqual({
      date_debut: "2026-10-01",
      type_periode: "annee",
      nombre_periodes: 3,
    });
    expect(ok.besoin_tresorerie).toEqual({ montant: 25 * M, date: "2026-10-26" });
    expect(ok.lignes).toEqual([
      {
        periode: 1,
        sens: "emploi",
        nature: "besoin_fonds_roulement",
        montant: 25 * M,
        origine: "tresorerie",
        nombre_echeances: 0,
      },
      {
        periode: 1,
        sens: "emploi",
        nature: "remboursement_dettes_accords",
        montant: 80 * M,
        origine: "accords",
        nombre_echeances: 4,
      },
    ]);
    expect(ok).toMatchObject({ anterieures: 0, ulterieures: 0, besoin_hors_plan: false });
    // Le besoin est celui de la route de trésorerie (moteur).
    const hebdo = (await s.a.chef.get(urlD(d, "/tresorerie"))).json().projection;
    expect(ok.besoin_tresorerie.montant).toBe(hebdo.besoin_financement);
  });

  it("cadre choisi : semestres à partir du 1er décembre (échéance de novembre antérieure, besoin hors plan)", async () => {
    const r = await s.a.chef.get(
      `${urlD(d, "/financement/proposition")}?date_debut=2026-12-01&type_periode=semestre&nombre_periodes=2`,
    );
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.cadre).toEqual({
      date_debut: "2026-12-01",
      type_periode: "semestre",
      nombre_periodes: 2,
    });
    expect(v.lignes).toEqual([
      {
        periode: 1,
        sens: "emploi",
        nature: "remboursement_dettes_accords",
        montant: 60 * M,
        origine: "accords",
        nombre_echeances: 3,
      },
    ]);
    expect(v).toMatchObject({ anterieures: 1, ulterieures: 0, besoin_hors_plan: true });
    expect(v.besoin_tresorerie).toEqual({ montant: 25 * M, date: "2026-10-26" });
  });

  it("rien n'est écrit ; le consultant retient les lignes puis crée la version", async () => {
    const avant = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM journal_audit"),
    );
    const prop = (await s.a.chef.get(urlD(d, "/financement/proposition"))).json();
    const apres = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM journal_audit"),
    );
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
    expect((await s.a.chef.get(urlD(d, "/financement"))).json().version).toBeNull();
    const cree = await s.a.chef.post(
      urlD(d, "/financement/versions"),
      planFin({
        date_debut: prop.cadre.date_debut,
        lignes: [
          ...prop.lignes.map((l: Record<string, unknown>) => ({
            periode: l.periode,
            sens: l.sens,
            nature: l.nature,
            montant: l.montant,
          })),
          ligneFin(1, "ressource", "apport_associes", 105 * M),
        ],
      }),
    );
    attendre(201, cree, "plan retenu");
    expect(cree.json().plan.periodes[0]).toMatchObject({
      emplois: 105 * M,
      solde: 0,
      statut: "equilibre",
    });
    // Sans paramètres, la proposition reprend le cadre de la version courante du plan.
    const reprise = (await s.a.chef.get(urlD(d, "/financement/proposition"))).json();
    expect(reprise.cadre).toEqual({
      date_debut: "2026-10-01",
      type_periode: "annee",
      nombre_periodes: 3,
    });
  });

  it("paramètres invalides : 400", async () => {
    for (const q of [
      "date_debut=2026-12-15",
      "type_periode=mois",
      "nombre_periodes=0",
      "nombre_periodes=9",
      "nombre_periodes=1.5",
      "exces=1",
    ]) {
      expect(
        (await s.a.chef.get(`${urlD(d, "/financement/proposition")}?${q}`)).statusCode,
        q,
      ).toBe(400);
    }
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Dossier clos, mission clôturée, plafonds de débit                                           */
/* ------------------------------------------------------------------------------------------ */

describe("dossier clos, mission clôturée, débit", () => {
  it("dossier clos : écritures refusées (409 RED_DOSSIER_CLOS), lectures permises", async () => {
    const d = await nouveauDossier(s, "Clos");
    attendre(
      201,
      await s.a.chef.post(urlD(d, "/covenants/versions"), { covenants: [covenant()] }),
      "cov",
    );
    attendre(201, await s.a.chef.post(urlD(d, "/financement/versions"), planFin()), "fin");
    attendre(
      200,
      await s.a.directeur.post(urlD(d, "/statut"), { statut: "clos", motif: "Objectifs atteints" }),
      "clôture",
    );
    for (const [url, corps] of [
      [urlD(d, "/covenants/versions"), { covenants: [covenant()] }],
      [urlD(d, "/financement/versions"), planFin()],
    ] as const) {
      const r = await s.a.chef.post(url, corps);
      expect(r.statusCode).toBe(409);
      expect(erreur(r)).toBe("RED_DOSSIER_CLOS");
    }
    for (const suffixe of [
      "/covenants",
      "/financement",
      "/financement/proposition",
      "/tresorerie/mensuelle",
    ]) {
      expect((await s.a.chef.get(urlD(d, suffixe))).statusCode, suffixe).toBe(200);
    }
    // La base le refuse aussi, même hors de l'API (MPZ03).
    const dossier = d;
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          "INSERT INTO red_covenants_versions (cabinet_id, dossier_id, version, cree_par) VALUES ($1, $2, 2, $3)",
          [s.a.cabinetId, dossier, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ03");
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_financement_versions (cabinet_id, dossier_id, version, date_debut, type_periode, nombre_periodes, cree_par)
           VALUES ($1, $2, 2, '2026-07-01', 'annee', 1, $3)`,
          [s.a.cabinetId, dossier, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ03");
  });

  it("mission clôturée : écritures refusées (409 RED_MISSION_CLOTUREE)", async () => {
    const m = await creerMissionSignee(s.a);
    const d = (await ouvrirDossierRed(s, m.id)).id;
    await proprietaire((c) =>
      c.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [m.id]),
    );
    for (const [url, corps] of [
      [urlD(d, "/covenants/versions"), { covenants: [covenant()] }],
      [urlD(d, "/financement/versions"), planFin()],
    ] as const) {
      const r = await s.a.associe.post(url, corps);
      expect(r.statusCode).toBe(409);
      expect(erreur(r)).toBe("RED_MISSION_CLOTUREE");
    }
    expect((await s.a.associe.get(urlD(d, "/covenants"))).statusCode).toBe(200);
  });

  it("plafond de débit : au plus 20 versions par 10 minutes et par utilisateur (429)", async () => {
    const d = await nouveauDossier(s, "Débit");
    for (let i = 0; i < 20; i += 1) {
      attendre(
        201,
        await s.associe2.post(urlD(d, "/covenants/versions"), { covenants: [] }),
        `cov ${i}`,
      );
    }
    const r = await s.associe2.post(urlD(d, "/covenants/versions"), { covenants: [] });
    expect(r.statusCode).toBe(429);
    expect(erreur(r)).toBe("RED_TROP_DE_VERSIONS_COVENANTS");
    for (let i = 0; i < 20; i += 1) {
      attendre(
        201,
        await s.associe2.post(urlD(d, "/financement/versions"), planFin({ lignes: [] })),
        `fin ${i}`,
      );
    }
    const f = await s.associe2.post(urlD(d, "/financement/versions"), planFin({ lignes: [] }));
    expect(f.statusCode).toBe(429);
    expect(erreur(f)).toBe("RED_TROP_DE_VERSIONS_FINANCEMENT");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Base de données : isolation, ajout seul, versions consécutives, cohérence, plafonds         */
/* ------------------------------------------------------------------------------------------ */

describe("base de données (migration 0489)", () => {
  const TABLES = [
    "red_covenants_versions",
    "red_covenants_lignes",
    "red_financement_versions",
    "red_financement_lignes",
  ] as const;
  let d: string;

  beforeAll(async () => {
    d = await nouveauDossier(s, "SQL");
    attendre(
      201,
      await s.a.chef.post(urlD(d, "/covenants/versions"), { covenants: [covenant()] }),
      "cov",
    );
    attendre(201, await s.a.chef.post(urlD(d, "/financement/versions"), planFin()), "fin");
  });

  const insererVersionCovenants = (version: number, dossier = d) =>
    codeSql(ctx, s.a.cabinetId, (db) =>
      db.query(
        "INSERT INTO red_covenants_versions (cabinet_id, dossier_id, version, cree_par) VALUES ($1, $2, $3, $4)",
        [s.a.cabinetId, dossier, version, s.a.chef.utilisateurId],
      ),
    );

  it("isolation : un autre cabinet ne voit rien et n'écrit rien dans ces tables", async () => {
    for (const t of TABLES) {
      const lues = await ctx.db.withTenant(
        s.b.cabinetId,
        async (db) => (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number,
      );
      expect(lues, t).toBe(0);
      const propres = await ctx.db.withTenant(
        s.a.cabinetId,
        async (db) => (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number,
      );
      expect(propres, t).toBeGreaterThan(0);
    }
    // Insérer pour le cabinet A depuis le cabinet B (qui ne voit aucune version : la numérotation repart de 1) : refusé par la politique de ligne.
    expect(
      await codeSql(ctx, s.b.cabinetId, (db) =>
        db.query(
          "INSERT INTO red_covenants_versions (cabinet_id, dossier_id, version, cree_par) VALUES ($1, $2, 1, $3)",
          [s.a.cabinetId, d, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("42501");
  });

  it("ajout seul : UPDATE et DELETE refusés au rôle applicatif (42501) et au propriétaire (MPZ01)", async () => {
    for (const t of TABLES) {
      for (const sql of [`UPDATE ${t} SET cabinet_id = cabinet_id`, `DELETE FROM ${t}`]) {
        expect(await codeSql(ctx, s.a.cabinetId, (db) => db.query(sql)), sql).toBe("42501");
        const proprio = await proprietaire(async (c) => {
          try {
            await c.query(sql);
            return "aucun";
          } catch (e) {
            return (e as { code?: string }).code ?? "inconnu";
          }
        });
        expect(proprio, `propriétaire ${sql}`).toBe("MPZ01");
      }
    }
  });

  it("versions consécutives (MPZ05) : ni trou ni doublon", async () => {
    expect(await insererVersionCovenants(5)).toBe("MPZ05");
    expect(await insererVersionCovenants(1)).toBe("MPZ05");
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_financement_versions (cabinet_id, dossier_id, version, date_debut, type_periode, nombre_periodes, cree_par)
           VALUES ($1, $2, 7, '2026-07-01', 'annee', 1, $3)`,
          [s.a.cabinetId, d, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ05");
  });

  it("une ligne naît dans la transaction de sa version (MPZ01)", async () => {
    const version = await ctx.db.withTenant(
      s.a.cabinetId,
      async (db) =>
        (await db.query("SELECT id FROM red_covenants_versions WHERE dossier_id = $1 LIMIT 1", [d]))
          .rows[0].id as string,
    );
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_covenants_lignes (cabinet_id, dossier_id, version_id, rang, ratio, operateur, seuil_pb, frequence)
           VALUES ($1, $2, $3, 9, 'endettement', 'max', 1, 'annuelle')`,
          [s.a.cabinetId, d, version],
        ),
      ),
    ).toBe("MPZ01");
    const planVersion = await ctx.db.withTenant(
      s.a.cabinetId,
      async (db) =>
        (
          await db.query("SELECT id FROM red_financement_versions WHERE dossier_id = $1 LIMIT 1", [
            d,
          ])
        ).rows[0].id as string,
    );
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_financement_lignes (cabinet_id, dossier_id, version_id, rang, periode, sens, nature, montant)
           VALUES ($1, $2, $3, 99, 1, 'emploi', 'investissements', 1)`,
          [s.a.cabinetId, d, planVersion],
        ),
      ),
    ).toBe("MPZ01");
  });

  const dansUneVersionCovenants = (
    dossier: string,
    version: number,
    lignes: [string, string, number][],
  ) =>
    codeSql(ctx, s.a.cabinetId, async (db) => {
      const v = await db.query(
        "INSERT INTO red_covenants_versions (cabinet_id, dossier_id, version, cree_par) VALUES ($1, $2, $3, $4) RETURNING id",
        [s.a.cabinetId, dossier, version, s.a.chef.utilisateurId],
      );
      let rang = 0;
      for (const [ratio, operateur, seuil] of lignes) {
        rang += 1;
        await db.query(
          `INSERT INTO red_covenants_lignes (cabinet_id, dossier_id, version_id, rang, ratio, operateur, seuil_pb, frequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'annuelle')`,
          [s.a.cabinetId, dossier, v.rows[0].id, rang, ratio, operateur, seuil],
        );
      }
    });

  it("covenant incohérent (MPZ15) : doublon (ratio, opérateur), plancher au-dessus du plafond", async () => {
    const dossier = await nouveauDossier(s, "SQL covenants");
    expect(
      await dansUneVersionCovenants(dossier, 1, [
        ["endettement", "max", 100],
        ["endettement", "max", 200],
      ]),
    ).toBe("MPZ15");
    expect(
      await dansUneVersionCovenants(dossier, 1, [
        ["endettement", "max", 100],
        ["endettement", "min", 200],
      ]),
    ).toBe("MPZ15");
    expect(
      await dansUneVersionCovenants(dossier, 1, [
        ["endettement", "min", 200],
        ["endettement", "max", 100],
      ]),
    ).toBe("MPZ15");
    // Cohérents : accepté (la transaction fautive n'a rien écrit, la version 1 est donc libre).
    expect(
      await dansUneVersionCovenants(dossier, 1, [
        ["endettement", "min", 100],
        ["endettement", "max", 100],
        ["liquidite_generale", "min", 5],
      ]),
    ).toBe("aucun");
  });

  it("plan de financement incohérent (MPZ16) : période au-delà du nombre de périodes de la version", async () => {
    const dossier = await nouveauDossier(s, "SQL financement");
    const ecrire = (periode: number) =>
      codeSql(ctx, s.a.cabinetId, async (db) => {
        const v = await db.query(
          `INSERT INTO red_financement_versions (cabinet_id, dossier_id, version, date_debut, type_periode, nombre_periodes, cree_par)
           VALUES ($1, $2, 1, '2026-07-01', 'annee', 2, $3) RETURNING id`,
          [s.a.cabinetId, dossier, s.a.chef.utilisateurId],
        );
        await db.query(
          `INSERT INTO red_financement_lignes (cabinet_id, dossier_id, version_id, rang, periode, sens, nature, montant)
           VALUES ($1, $2, $3, 1, $4, 'emploi', 'investissements', 1000)`,
          [s.a.cabinetId, dossier, v.rows[0].id, periode],
        );
      });
    expect(await ecrire(3)).toBe("MPZ16");
    expect(await ecrire(2)).toBe("aucun");
  });

  it("plafonds de volume (MPZ10) : 12 covenants par version, 200 lignes par plan", async () => {
    const dossier = await nouveauDossier(s, "SQL plafonds");
    const combinaisons: [string, string, number][] = RED_COVENANT_RATIOS.flatMap((r) => [
      [r, "min", 0] as [string, string, number],
      [r, "max", 100] as [string, string, number],
    ]);
    expect(await dansUneVersionCovenants(dossier, 1, combinaisons.slice(0, 13))).toBe("MPZ10");
    expect(
      await codeSql(ctx, s.a.cabinetId, async (db) => {
        const v = await db.query(
          `INSERT INTO red_financement_versions (cabinet_id, dossier_id, version, date_debut, type_periode, nombre_periodes, cree_par)
           VALUES ($1, $2, 1, '2026-07-01', 'annee', 1, $3) RETURNING id`,
          [s.a.cabinetId, dossier, s.a.chef.utilisateurId],
        );
        for (let rang = 1; rang <= 201; rang += 1) {
          await db.query(
            `INSERT INTO red_financement_lignes (cabinet_id, dossier_id, version_id, rang, periode, sens, nature, montant)
             VALUES ($1, $2, $3, $4, 1, 'emploi', 'investissements', 1)`,
            [s.a.cabinetId, dossier, v.rows[0].id, rang],
          );
        }
      }),
    ).toBe("MPZ10");
  });

  it("bornes de colonnes : montant, seuil, date, nature, devise du dossier inchangée (23514)", async () => {
    const dossier = await nouveauDossier(s, "SQL bornes");
    const ligne = (montant: number, nature = "investissements", sens = "emploi") =>
      codeSql(ctx, s.a.cabinetId, async (db) => {
        const v = await db.query(
          `INSERT INTO red_financement_versions (cabinet_id, dossier_id, version, date_debut, type_periode, nombre_periodes, cree_par)
           VALUES ($1, $2, 1, '2026-07-01', 'annee', 1, $3) RETURNING id`,
          [s.a.cabinetId, dossier, s.a.chef.utilisateurId],
        );
        await db.query(
          `INSERT INTO red_financement_lignes (cabinet_id, dossier_id, version_id, rang, periode, sens, nature, montant)
           VALUES ($1, $2, $3, 1, 1, $4, $5, $6)`,
          [s.a.cabinetId, dossier, v.rows[0].id, sens, nature, montant],
        );
      });
    // Montant au-delà de 10^13 ou nul : 23514 ; nature hors du sens : 23514.
    expect(await ligne(10_000_000_000_001)).toBe("23514");
    expect(await ligne(0)).toBe("23514");
    expect(await ligne(1, "apport_associes", "emploi")).toBe("23514");
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_financement_versions (cabinet_id, dossier_id, version, date_debut, type_periode, nombre_periodes, cree_par)
           VALUES ($1, $2, 1, '2026-07-15', 'annee', 1, $3)`,
          [s.a.cabinetId, dossier, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("23514");
    expect(
      await codeSql(ctx, s.a.cabinetId, async (db) => {
        const v = await db.query(
          "INSERT INTO red_covenants_versions (cabinet_id, dossier_id, version, cree_par) VALUES ($1, $2, 1, $3) RETURNING id",
          [s.a.cabinetId, dossier, s.a.chef.utilisateurId],
        );
        await db.query(
          `INSERT INTO red_covenants_lignes (cabinet_id, dossier_id, version_id, rang, ratio, operateur, seuil_pb, frequence)
           VALUES ($1, $2, $3, 1, 'marge_brute', 'min', 1, 'annuelle')`,
          [s.a.cabinetId, dossier, v.rows[0].id],
        );
      }),
    ).toBe("23514");
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Parité moteurs ↔ schémas partagés                                                           */
/* ------------------------------------------------------------------------------------------ */

describe("parité moteurs ↔ schémas partagés", () => {
  it("les listes fermées sont identiques", () => {
    expect([...RED_COVENANT_RATIOS]).toEqual([...RATIOS_COVENANT_RED]);
    expect([...RED_COVENANT_OPERATEURS]).toEqual([...OPERATEURS_COVENANT_RED]);
    expect([...RED_COVENANT_FREQUENCES]).toEqual([...FREQUENCES_COVENANT_RED]);
    expect([...RED_FINANCEMENT_EMPLOIS]).toEqual([...EMPLOIS_FINANCEMENT_RED]);
    expect([...RED_FINANCEMENT_RESSOURCES]).toEqual([...RESSOURCES_FINANCEMENT_RED]);
    expect([...RED_FINANCEMENT_TYPES_PERIODE]).toEqual([...TYPES_PERIODE_FINANCEMENT_RED]);
  });

  it("les clés de la vue de covenant sont celles d'un ratio du moteur", () => {
    for (const r of RED_COVENANT_RATIOS) expect(Object.keys(RATIOS_CAS_A)).toContain(r);
  });
});
