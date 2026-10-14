import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LISTE_BLANCHE_PORTAIL } from "../src/portail/garde.js";
import { demarrer, type Contexte } from "./helpers.js";
import { inviterClient, type UtilisateurPortail } from "./portail-outils.js";
import {
  appeler,
  erreur,
  ouvrirDossierRed,
  preparerRed,
  routesRedressement,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Portail client fermé (SPEC-3a §9.8) : le client ne voit jamais son propre dossier de redressement dans
 * ce lot. Aucune route du module dans LISTE_BLANCHE_PORTAIL ; un `client_dirigeant`, un contributeur et un
 * investisseur reçoivent 403 PORTAIL_ROUTE_INTERDITE sur chacune des 37 routes.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dirigeant: UtilisateurPortail;
let contributeur: UtilisateurPortail;
let investisseur: UtilisateurPortail;
let dossierId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED portail");
  dossierId = (await ouvrirDossierRed(s)).id;
  dirigeant = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
  contributeur = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]);
  investisseur = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_investisseur"]);
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("portail fermé", () => {
  it("aucune route du module dans la liste blanche du portail", () => {
    const motifs = LISTE_BLANCHE_PORTAIL.map((r) => r.motif);
    expect(motifs.filter((m) => m.includes("redressement"))).toEqual([]);
  });

  it("403 PORTAIL_ROUTE_INTERDITE sur les 37 routes pour chaque rôle du portail", async () => {
    const routes = routesRedressement({
      dossier: dossierId,
      mission: s.missionId,
      creancier: dossierId,
      action: dossierId,
      version: dossierId,
      seuils: dossierId,
    });
    expect(routes).toHaveLength(37);
    for (const u of [dirigeant, contributeur, investisseur]) {
      for (const r of routes) {
        const rep = await appeler(u, r);
        expect(rep.statusCode, `${r.methode} ${r.url}`).toBe(403);
        expect(erreur(rep), `${r.methode} ${r.url}`).toBe("PORTAIL_ROUTE_INTERDITE");
      }
    }
  });

  it("le dossier reste intact : le portail n'y a rien écrit", async () => {
    const d = (await s.a.chef.get(`/api/redressement/dossiers/${dossierId}`)).json();
    expect(d.statut).toBe("ouvert");
    expect(d.intitule).toBe("Redressement du client");
  });
});
