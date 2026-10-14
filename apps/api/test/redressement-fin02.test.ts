import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  appeler,
  ouvrirDossierRed,
  preparerCasA,
  preparerRed,
  routesRedressement,
  toutesLesCles,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * FIN-02 traduit (SPEC-3a §9.8) : les montants, soldes, dettes et marges du module sont ceux du CLIENT,
 * pas du cabinet ; ils relèvent de `redressement.lire`, pas de `finance.lire`. Un chef de mission sans
 * `finance.lire` lit ratios, trésorerie et créanciers (200) ; aucune réponse ne porte une clé de donnée du
 * cabinet (parcours récursif) ; un gestionnaire, qui détient `finance.lire`, reçoit 403 sur les 37 routes.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dossierId: string;

const CLES_INTERDITES = [
  "cout",
  "couts",
  "taux",
  "marge_mission",
  "honoraires",
  "budget",
  "facturation",
  "tarif",
  "rentabilite",
];
const M = 1_000_000;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED fin02");
  dossierId = (await preparerCasA(s)).dossierId;
  const d = `/api/redressement/dossiers/${dossierId}`;
  attendre(
    201,
    await s.a.chef.post(`${d}/tresorerie/versions`, {
      date_debut: "2026-10-12",
      solde_initial: 50 * M,
      seuil_tension: 10 * M,
      lignes: [{ semaine: 1, sens: "decaissement", categorie: "salaires", montant: 25 * M }],
    }),
    "trésorerie",
  );
  attendre(
    201,
    await s.a.chef.post(`${d}/creanciers`, {
      nom: "Fournisseur",
      categorie: "fournisseur",
      principal: 10 * M,
      date_arrete: "2026-10-01",
    }),
    "créancier",
  );
  attendre(201, await s.a.chef.post(`${d}/urgences`, { reponses: { T1: "oui" } }), "urgence");
  attendre(201, await s.a.chef.post(`${d}/scores`, {}), "score");
  attendre(
    201,
    await s.a.chef.post(`${d}/actions`, {
      titre: "Action",
      volet: "quick_win",
      domaine: "tresorerie",
      echeance: "2026-12-01",
      responsable_id: s.a.chef.utilisateurId,
      levier: { code: "reduction_stocks", parametres: { reductionPb: 1500 } },
    }),
    "action",
  );
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("FIN-02 : données du client, pas du cabinet", () => {
  it("un chef de mission sans finance.lire lit ratios, trésorerie, créanciers, plan et dossier : aucune clé du cabinet", async () => {
    const d = `/api/redressement/dossiers/${dossierId}`;
    const lectures = [
      d,
      `${d}/ratios`,
      `${d}/tresorerie`,
      `${d}/creanciers`,
      `${d}/plan`,
      `${d}/urgences`,
      `${d}/scores`,
      `${d}/correspondances`,
      "/api/redressement/seuils",
      "/api/redressement/referentiel",
      "/api/redressement/dossiers",
      `/api/missions/${s.missionId}/redressement`,
    ];
    for (const url of lectures) {
      const r = await s.a.chef.get(url);
      expect(r.statusCode, url).toBe(200);
      const cles = toutesLesCles(r.json());
      for (const interdite of CLES_INTERDITES)
        expect(cles.has(interdite), `${url} : ${interdite}`).toBe(false);
    }
    // Les calculs aussi : point mort et simulation de levier.
    const pm = await s.a.chef.post(`${d}/point-mort`, {
      chiffre_affaires: 10 * M,
      charges_variables: 5 * M,
      charges_fixes: M,
    });
    expect(pm.statusCode).toBe(200);
    for (const interdite of CLES_INTERDITES)
      expect(toutesLesCles(pm.json()).has(interdite)).toBe(false);
    const lev = await s.a.chef.post(`${d}/leviers/simulation`, {
      code: "reduction_stocks",
      parametres: { reductionPb: 100 },
    });
    expect(lev.statusCode).toBe(200);
    for (const interdite of CLES_INTERDITES)
      expect(toutesLesCles(lev.json()).has(interdite)).toBe(false);
  });

  it("aucun honoraire, budget ou coût de la mission n'est joint : la vue ne contient que l'identité de la mission", async () => {
    const d = (await s.a.chef.get(`/api/redressement/dossiers/${dossierId}`)).json();
    expect(Object.keys(d.mission).sort()).toEqual(["id", "intitule"]);
    expect(Object.keys(d.client).sort()).toEqual(["id", "raison_sociale"]);
  });

  it("un gestionnaire (finance.lire) reçoit 403 sur les 37 routes : aucune permission redressement.*", async () => {
    const routes = routesRedressement({
      dossier: dossierId,
      mission: s.missionId,
      creancier: dossierId,
      action: dossierId,
      version: dossierId,
      seuils: dossierId,
    });
    expect(routes).toHaveLength(37);
    for (const r of routes) {
      const rep = await appeler(s.gestionnaire, r);
      expect(rep.statusCode, `${r.methode} ${r.url}`).toBe(403);
    }
  });

  it("le responsable des ressources et l'expert externe n'ont pas non plus accès", async () => {
    const routes = routesRedressement({
      dossier: dossierId,
      mission: s.missionId,
      creancier: dossierId,
      action: dossierId,
      version: dossierId,
      seuils: dossierId,
    });
    for (const u of [s.ressources, s.expertExterne]) {
      for (const r of routes)
        expect((await appeler(u, r)).statusCode, `${r.methode} ${r.url}`).toBe(403);
    }
  });

  it("sans session : 401 sur les 37 routes", async () => {
    const { api } = await import("./api.js");
    const routes = routesRedressement({
      dossier: dossierId,
      mission: s.missionId,
      creancier: dossierId,
      action: dossierId,
      version: dossierId,
      seuils: dossierId,
    });
    for (const r of routes)
      expect((await appeler(api(ctx), r)).statusCode, `${r.methode} ${r.url}`).toBe(401);
    expect((await creerMission(s.a, { intitule: "sentinelle" })).id).toBeTruthy();
    expect((await ouvrirDossierRed(s, s.missionB, {}, s.b.associe)).id).toBeTruthy();
  });
});
